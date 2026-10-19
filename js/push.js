// Powiadomienia z serwera (Web Push): działają, gdy aplikacja jest zamknięta. Opcjonalne – wymaga własnego serwera (server/).
import { state, onChange } from './store.js';
import { computeAlarms, briefFor, notifPermission } from './notify.js';

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
  const r = await fetch(`${cfg.url}${path}`, { method, headers: { 'Content-Type': 'application/json', ...(cfg.token ? { Authorization: `Bearer ${cfg.token}` } : {}) }, body: method === 'POST' ? JSON.stringify(body || {}) : undefined }).catch(() => { throw new Error('Nie mogę połączyć się z serwerem. Sprawdź adres i internet.'); });
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
  const cfg = { url, deviceId: newId(), token: '', at: Date.now() };
  const res = await api(cfg, '/subscribe', { deviceId: cfg.deviceId, setup: String(code || '').trim(), subscription: sub.toJSON() });
  cfg.token = res.token;
  write(cfg);
  await pushSync(true);
  return cfg;
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

let lastSig = '';
export async function pushSync(force = false) {
  const cfg = read();
  if (!cfg || !cfg.token || !state.settings.notifyEnabled) return false;
  const alarms = alarmsPayload();
  const sig = JSON.stringify(alarms);
  if (!force && sig === lastSig) return true;
  try {
    await api(cfg, '/sync', { deviceId: cfg.deviceId, alarms });
    lastSig = sig;
    cfg.syncedAt = Date.now(); cfg.error = '';
    write(cfg);
    return true;
  } catch (e) {
    cfg.error = e.message || 'Błąd'; write(cfg);
    if (e.status === 401) { /* serwer nas nie zna – użytkownik musi połączyć ponownie */ }
    return false;
  }
}

export async function pushTest() {
  const cfg = read();
  if (!cfg) throw new Error('Najpierw połącz z serwerem.');
  await api(cfg, '/test', { deviceId: cfg.deviceId });
}

let timer = null;
export function schedulePushSync(ms = 4000) {
  if (!read()) return;
  clearTimeout(timer);
  timer = setTimeout(() => pushSync(), ms);
}
export function initPush() {
  onChange(() => schedulePushSync());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') schedulePushSync(1500); });
  schedulePushSync(2500);
}
