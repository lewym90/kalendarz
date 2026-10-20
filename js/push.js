// Powiadomienia z serwera (Web Push): działają, gdy aplikacja jest zamknięta. Opcjonalne – wymaga własnego serwera (server/).
import { state, onChange, catOf } from './store.js';
import { instancesInRange } from './recur.js';
import { ymd, startOfDay, addDays, pad } from './util.js';
import { computeAlarms, briefFor, notifPermission } from './notify.js';
import { peerEvents } from './peers.js';

const KEY = 'kalendarz.push';
const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch (_) { return null; } };
const write = (v) => { try { v ? localStorage.setItem(KEY, JSON.stringify(v)) : localStorage.removeItem(KEY); } catch (_) { /* brak */ }};

export const pushConfig = () => read();
export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
export const normUrl = (u) => String(u || '').trim().replace(/\/+$/, '');

const b64ToBytes = (s) => {
  const p = '='.repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + p).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};
const newId = () => { const a = new Uint8Array(18); crypto.getRandomValues(a); return btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, ''); };

async function api(cfg, path, body, method = 'POST') {
  // /sync idzie jako „prosty” request (text/plain, token w treści): bez zapytania wstępnego (preflight),
  // dzięki czemu iOS zdąża go wysłać nawet przy zamykaniu aplikacji.
  const simple = method === 'POST' && path === '/sync';
  const init = simple
    ? { method, headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ ...(body || {}), token: cfg.token }), keepalive: true }
    : { method, headers: { 'Content-Type': 'application/json', ...(cfg.token ? { Authorization: `Bearer ${cfg.token}` } : {}) }, body: method === 'POST' ? JSON.stringify(body || {}) : undefined };
  const r = await fetch(`${cfg.url}${path}`, init).catch(() => { throw new Error('Nie mogę połączyć się z serwerem. Sprawdź adres i internet.'); });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || `Błąd ${r.status}`), { status: r.status });
  return j;
}

export async function pushConnect(url, code) {
  if (!pushSupported()) throw new Error('Ta przeglądarka nie obsługuje push. Dodaj aplikację do ekranu początkowego.');
  url = normUrl(url);
  if (!/^https:\/\//.test(url) && !/^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(url)) throw new Error('Adres musi zaczynać się od https://');
  if (notifPermission() !== 'granted') {
    const p = await Notification.requestPermission();
    if (p !== 'granted') throw new Error('Najpierw zezwól na powiadomienia.');
  }
  const { publicKey } = await api({ url }, '/vapid', null, 'GET');
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (sub) { try { await sub.unsubscribe(); } catch (_) { /* nic */ } }
  sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) });
  // Ponowne połączenie używa tego samego identyfikatora i tajnego adresu widgetu, więc skryptu w Scriptable nie trzeba wklejać od nowa.
  const prev = read();
  const attempt = async (reuse) => {
    const cfg = { url, deviceId: reuse && prev && prev.deviceId ? prev.deviceId : newId(), token: reuse && prev ? prev.token || '' : '', code: String(code || '').trim(), widget: reuse && prev ? prev.widget : '', at: Date.now() };
    const res = await api(cfg, '/subscribe', { deviceId: cfg.deviceId, setup: cfg.code, wtoken: cfg.widget || undefined, subscription: sub.toJSON() });
    if (res.token) cfg.token = res.token;
    return cfg;
  };
  let cfg;
  try { cfg = await attempt(true); } catch (e) { if (e.status === 401 && /uprawnie/.test(e.message)) cfg = await attempt(false); else throw e; }
  write(cfg);
  await pushSync(true);
  return cfg;
}

// Serwer nie zna już tego telefonu (np. wygasła subskrypcja): spróbuj zarejestrować się ponownie zapamiętanym kodem.
async function rejoin(cfg) {
  if (!cfg.code || !pushSupported()) return false;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return false;
    const res = await api({ url: cfg.url }, '/subscribe', { deviceId: cfg.deviceId, setup: cfg.code, wtoken: cfg.widget || undefined, subscription: sub.toJSON() });
    if (!res.token) return false;
    cfg.token = res.token; write(cfg);
    return true;
  } catch (_) { return false; }
}

export async function pushDisconnect() {
  const cfg = read();
  write(null);
  try { if (cfg) await api(cfg, '/unsubscribe', { deviceId: cfg.deviceId }); } catch (_) { /* serwer mógł być niedostępny */ }
  try { const reg = await navigator.serviceWorker.ready; const s = await reg.pushManager.getSubscription(); if (s) await s.unsubscribe(); } catch (_) { /* nic */ }
}

export function alarmsPayload(now = new Date()) {
  const to = new Date(now.getTime() + 14 * 86400000);
  return computeAlarms(now, to)
    .filter((a) => a.at > now && a.at <= to && !state.fired[a.id])
    .slice(0, 500)
    .map((a) => {
      const t = a.kind === 'brief' ? briefFor(a.brief, a.at) : a;
      return { id: a.id, at: a.at.getTime(), title: t.title, body: t.body, tag: a.id, url: `./?alarm=${encodeURIComponent(a.id)}` };
    });
}

// Plan dnia na 7 dni dla widgetu (Scriptable): serwer wystawia go pod tajnym adresem.
export function agendaPayload(now = new Date()) {
  const from = startOfDay(now);
  const to = addDays(from, 7);
  const hm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const inst = instancesInRange(state.events, from, to);
  const pev = peerEvents();
  const pinst = pev.length ? instancesInRange(pev, from, to) : [];
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d0 = addDays(from, i), d1 = addDays(from, i + 1), key = ymd(d0);
    const items = inst.filter((x) => x.start < d1 && x.end > d0).map((x) => ({
      k: 'e', ad: x.allDay ? 1 : 0, s: x.allDay ? '' : hm(x.start < d0 ? d0 : x.start), e: x.allDay ? '' : hm(x.end > d1 ? new Date(d1.getTime() - 60000) : x.end),
      t: x.title, l: x.ev.loc || '', c: (catOf(x.ev.cat) || {}).color || '', _o: x.start.getTime(),
    }));
    for (const x of pinst) {
      if (!(x.start < d1 && x.end > d0)) continue;
      items.push({ k: 'e', ad: x.allDay ? 1 : 0, s: x.allDay ? '' : hm(x.start < d0 ? d0 : x.start), e: x.allDay ? '' : hm(x.end > d1 ? new Date(d1.getTime() - 60000) : x.end), t: x.title, l: x.ev.loc || '', c: x.ev.peer.color, w: x.ev.peer.name.charAt(0).toUpperCase(), _o: x.start.getTime() });
    }
    for (const t of state.tasks) {
      if (t.done || !t.due) continue;
      if (t.due === key || (i === 0 && t.due < key)) items.push({ k: 't', ad: 0, s: t.dueTime || '', e: '', t: t.title, l: '', c: (catOf(t.cat) || {}).color || '', done: 0, _o: t.dueTime ? 0 : 9e15 });
    }
    items.sort((a, b) => (a.ad ? 0 : 1) - (b.ad ? 0 : 1) || (a.s || '99:99').localeCompare(b.s || '99:99') || a._o - b._o);
    days.push({ d: key, items: items.map(({ _o, ...r }) => r) });
  }
  // Liczba pozycji na dzień (60 dni) do kropek w miniaturze miesiąca.
  const cnt = {};
  const far = addDays(from, 60);
  for (const x of instancesInRange(state.events, from, far)) {
    for (let d = startOfDay(x.start); d < x.end && d < far; d = addDays(d, 1)) { const k = ymd(d); cnt[k] = (cnt[k] || 0) + 1; }
  }
  for (const t of state.tasks) if (!t.done && t.due && t.due >= ymd(from) && t.due < ymd(far)) cnt[t.due] = (cnt[t.due] || 0) + 1;
  const pcnt = {};
  for (const x of instancesInRange(pev, from, far)) {
    for (let d = startOfDay(x.start); d < x.end && d < far; d = addDays(d, 1)) { const k = ymd(d); pcnt[k] = (pcnt[k] || 0) + 1; }
  }
  const pcol = pev.length ? pev[0].peer.color : '';
  const c = state.settings.city || {};
  return { days, cnt, pcnt, pcol, geo: { n: c.name || '', lat: c.lat, lon: c.lon } };
}

export function pushApi(path, body) {
  const cfg = read();
  if (!cfg || !cfg.token) return Promise.reject(new Error('brak połączenia z serwerem'));
  return api(cfg, path, { deviceId: cfg.deviceId, ...body });
}

// Wspólny kalendarz: moje wydarzenia na ~4 miesiące; prywatne bez tytułu i miejsca.
export function sharePayload(now = new Date()) {
  const sh = state.settings.share || {};
  const name = String(sh.name || '').trim();
  if (!sh.on || !name) return null;
  const from = addDays(startOfDay(now), -7), to = addDays(startOfDay(now), 120);
  const hm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const events = instancesInRange(state.events, from, to).slice(0, 900).map((x) => {
    const last = new Date(x.end.getTime() - 1);
    return { d: ymd(x.start), s: x.allDay ? '' : hm(x.start), ed: ymd(x.allDay ? last : x.end), e: x.allDay ? '' : hm(x.end), ad: x.allDay ? 1 : 0, p: x.ev.private ? 1 : 0, t: x.ev.private ? '' : x.title, l: x.ev.private ? '' : (x.ev.loc || '') };
  });
  return { name, color: sh.color, events };
}

let lastSig = '';
let retries = 0;
let rejoined = false;
let retryT = 0;
export async function pushSync(force = false) {
  const cfg = read();
  if (!cfg || !cfg.token) return false;
  const alarms = state.settings.notifyEnabled ? alarmsPayload() : [];
  const agenda = agendaPayload();
  const share = sharePayload();
  const sig = JSON.stringify([alarms, agenda, share]);
  if (!force && sig === lastSig) return true;
  try {
    const res = await api(cfg, '/sync', { deviceId: cfg.deviceId, alarms, agenda, share });
    lastSig = sig; retries = 0;
    if (res.widget) cfg.widget = res.widget;
    cfg.syncedAt = Date.now(); cfg.error = '';
    write(cfg);
    return true;
  } catch (e) {
    if (e.status === 401 && !rejoined) {
      rejoined = true;
      const ok = await rejoin(cfg);
      rejoined = false;
      if (ok) return pushSync(true);
    }
    cfg.error = e.status === 401 ? 'Serwer nie rozpoznaje tego telefonu. Dotknij „Połącz ponownie”.' : (e.message || 'Błąd'); write(cfg);
    if (e.status !== 401 && retries < 6) { retries++; clearTimeout(retryT); retryT = setTimeout(() => pushSync(true), Math.min(120000, 5000 * 2 ** retries)); }
    return false;
  }
}

export async function pushTest() {
  const cfg = read();
  if (!cfg) throw new Error('Najpierw połącz z serwerem.');
  await api(cfg, '/test', { deviceId: cfg.deviceId });
}

let timer = null;
export function schedulePushSync(ms = 300) {
  if (!read()) return;
  clearTimeout(timer);
  timer = setTimeout(() => pushSync(), ms);
}
export function initPush() {
  onChange(() => schedulePushSync());
  const flush = () => { if (!read()) return; clearTimeout(timer); pushSync(); };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') schedulePushSync(1500); else flush(); });
  window.addEventListener('pagehide', flush);
  schedulePushSync(2500);
}

// Skrypt do wklejenia w aplikacji Scriptable: sam pobiera aktualny kod widgetu i dane z serwera.
export function widgetLoaderScript() {
  const cfg = read();
  if (!cfg || !cfg.widget) return '';
  const base = new URL('widgets/kalendarz-widget.js', location.href).href;
  return `// Kalendarz: widget (ładuje aktualny kod z internetu, offline używa kopii)
const DATA_URL = "${cfg.url}/widget/${cfg.widget}";
const CODE_URL = "${base}";
const fm = FileManager.local();
const path = fm.joinPath(fm.documentsDirectory(), "kalendarz-widget-code.js");
let code = "";
try { code = await new Request(CODE_URL + "?t=" + Math.floor(Date.now() / 600000)).loadString(); if (code.length > 500) fm.writeString(path, code); else code = ""; } catch (e) { code = ""; }
if (!code && fm.fileExists(path)) code = fm.readString(path);
if (!code) throw new Error("Brak kodu widgetu (potrzebny internet przy pierwszym uruchomieniu)");
await new Function("DATA_URL", "return (async () => {" + code + String.fromCharCode(10) + "})()")(DATA_URL);
`;
}
