// Serwer powiadomień Web Push dla Kalendarza. Lekka, osobna usługa: nasłuchuje tylko na 127.0.0.1.
// Aplikacja wysyła tu listę nadchodzących alarmów; serwer o właściwej godzinie wysyła powiadomienie push
// (iOS dostarcza je, nawet gdy aplikacja jest zamknięta i telefon w trybie cichym — z wibracją wg ustawień systemu).
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import webpush from 'web-push';

const cfg = {
  port: +(process.env.PORT || 8790),
  host: process.env.HOST || '127.0.0.1',
  dataFile: process.env.DATA_FILE || '/opt/kalendarz/data/db.json',
  setupCode: process.env.SETUP_CODE || '',
  vapidPublic: process.env.VAPID_PUBLIC || '',
  vapidPrivate: process.env.VAPID_PRIVATE || '',
  subject: process.env.VAPID_SUBJECT || 'https://lewym90.github.io/kalendarz/',
  origin: process.env.ALLOW_ORIGIN || 'https://lewym90.github.io',
  maxDevices: +(process.env.MAX_DEVICES || 5),
  maxAlarms: +(process.env.MAX_ALARMS || 600),
  lateMs: +(process.env.LATE_MS || 2 * 3600000),   // alarmy spóźnione o więcej nie są wysyłane
  tickMs: +(process.env.TICK_MS || 15000),
  sttUrl: process.env.STT_URL || 'http://127.0.0.1:8791',
  get groqKey() { return process.env.GROQ_API_KEY || ''; },
  get groqUrl() { return process.env.GROQ_URL || 'https://api.groq.com/openai/v1/audio/transcriptions'; },
  get groqModel() { return process.env.GROQ_MODEL || 'whisper-large-v3-turbo'; },
  get geminiKey() { return process.env.GEMINI_API_KEY || ''; },
  get geminiUrl() { return process.env.GEMINI_URL || 'https://generativelanguage.googleapis.com/v1beta'; },
  get geminiModel() { return process.env.GEMINI_MODEL || ''; },
  backupMaxBytes: 6_000_000,
  backupDirs: 8,
  backupKeepDays: 7,
};

export const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const safeEq = (a, b) => { const x = Buffer.from(a); const y = Buffer.from(b); return x.length === y.length && crypto.timingSafeEqual(x, y); };

// ---------- Magazyn (plik JSON, zapis atomowy) ----------
let db = { devices: {} };
export function loadDb(file = cfg.dataFile) {
  try { db = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { db = { devices: {} }; }
  db.devices ||= {};
  return db;
}
let dirty = false;
export function saveDb(file = cfg.dataFile) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db), { mode: 0o600 });
  fs.renameSync(tmp, file);
  dirty = false;
}
const touch = () => { dirty = true; };
export const getDb = () => db;

// ---------- Wysyłka ----------
export let sender = (sub, payload, opts) => webpush.sendNotification(sub, payload, opts);
export const setSender = (f) => { sender = f; };

export async function sendTo(id, dev, a) {
  const payload = JSON.stringify({ title: a.title || 'Kalendarz', body: a.body || '', tag: a.tag || a.id, url: a.url || './', badge: a.badge });
  try {
    await sender(dev.sub, payload, { TTL: 3600, urgency: 'high', vapidDetails: { subject: cfg.subject, publicKey: cfg.vapidPublic, privateKey: cfg.vapidPrivate } });
    log(`wysłano do ${id.slice(0, 6)}: „${(a.title || '').slice(0, 40)}” (${a.id.slice(0, 40)})`);
    return true;
  } catch (e) {
    if (e.statusCode === 404 || e.statusCode === 410) { delete db.devices[id]; touch(); log(`urządzenie ${id.slice(0, 6)} wygasło (${e.statusCode}) – usunięto`); } else log(`błąd wysyłki ${e.statusCode || ''} ${e.message || e} ${String(e.body || '').slice(0, 120)}`);
    return false;
  }
}


// ---------- Poranny brief, podgląd jutra i przegląd tygodnia: treść liczona w chwili wysyłki ----------
// Telefon wysyła gotowy tekst z góry (na 14 dni), więc wpis dodany później przez drugą osobę nie byłby w nim widoczny.
// Dlatego serwer przy wysyłce składa treść od nowa: własne wydarzenia z ostatniej synchronizacji + aktualne wydarzenia
// drugiej osoby (jeśli użytkownik ma włączony podgląd jej kalendarza). Gdy brakuje danych, zostaje tekst z telefonu.
const addDay = (k, n) => { const [y, m, d] = k.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
const warsawHm = (ms) => new Date(ms).toLocaleTimeString('en-GB', { timeZone: 'Europe/Warsaw', hour: '2-digit', minute: '2-digit', hour12: false });
const WD_FULL = ['niedziela', 'poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek', 'sobota'];
const nEv = (n) => (n === 1 ? 'wydarzenie' : n < 5 ? 'wydarzenia' : 'wydarzeń');

export function briefBody(dev, a, devices = db.devices) {
  try {
    if (!dev.agenda || !Array.isArray(dev.agenda.days)) return null;
    const base = warsawToday(a.at);
    const first = a.br === 'evening' ? addDay(base, 1) : a.br === 'weekly' ? null : base;
    let keys;
    if (a.br === 'weekly') {
      const t = addDay(base, 1);
      const [y, m, d] = t.split('-').map(Number);
      const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
      const mon = addDay(t, -((dow + 6) % 7));
      keys = Array.from({ length: 7 }, (_, i) => addDay(mon, i));
    } else keys = [first];
    const byDay = new Map(dev.agenda.days.map((x) => [x.d, x.items]));
    if (!keys.every((k) => byDay.has(k))) return null;
    const me = (dev.share && dev.share.name || '').toLowerCase();
    const peers = [];
    if (a.pv) {
      const seen = new Set();
      for (const d of Object.values(devices).filter((x) => x.share && x.share.name.toLowerCase() !== me).sort((x, y) => y.share.gen - x.share.gen)) {
        const n = d.share.name.toLowerCase();
        if (seen.has(n)) continue;
        seen.add(n); peers.push(...d.share.events);
      }
    }
    const forDay = (k) => {
      const own = byDay.get(k).filter((i) => i.k === 'e' && !i.w).map((i) => ({ ad: i.ad, s: i.s, e: i.e, t: i.t }));
      const oth = peers.filter((e) => e.d <= k && (e.ed || e.d) >= k).map((e) => ({ ad: e.ad, s: e.s, e: e.e, t: e.p ? 'Zajęte' : e.t || 'Wydarzenie' }));
      return own.concat(oth).sort((x, y) => (y.ad ? 1 : 0) - (x.ad ? 1 : 0) || (x.s || '').localeCompare(y.s || ''));
    };
    if (a.br === 'weekly') {
      const per = keys.map((k) => forDay(k).length);
      const total = per.reduce((x, y) => x + y, 0);
      if (!total) return 'Nadchodzący tydzień jest pusty. Dobry moment, żeby coś zaplanować.';
      const [y, m, d] = keys[per.indexOf(Math.max(...per))].split('-').map(Number);
      return `Przed Tobą ${total} wydarzeń i ${a.tk || 0} zadań. Najgęstszy dzień: ${WD_FULL[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}.`;
    }
    const nowHm = warsawHm(a.at);
    let list = forDay(first);
    if (a.br === 'morning') list = list.filter((i) => i.ad || !i.e || i.e > nowHm);
    const label = a.br === 'evening' ? 'Jutro' : 'Dziś';
    const head = list.length ? `${label}: ${list.length} ${nEv(list.length)}` : `${label}: bez wydarzeń`;
    const names = list.slice(0, 3).map((i) => (i.ad ? i.t : `${i.s} ${i.t}`)).join(', ') + (list.length > 3 ? ` i ${list.length - 3} więcej` : '');
    return [head, list.length ? names : '', a.tk ? `Zadań do zrobienia: ${a.tk}` : ''].filter(Boolean).join('. ');
  } catch (_) { return null; }
}

export async function runDue(now = Date.now()) {
  let sent = 0;
  for (const [id, dev] of Object.entries(db.devices)) {
    dev.sent ||= {};
    const due = (dev.alarms || []).filter((a) => a.at <= now && a.at > now - cfg.lateMs && !dev.sent[a.id]);
    // po dłuższej przerwie nie zalewamy telefonu: najpóźniej 3 najnowsze
    for (const a of due.slice(-3)) {
      dev.sent[a.id] = now;
      touch();
      if (await sendTo(id, dev, a.br ? { ...a, body: briefBody(dev, a) || a.body } : a)) sent++;
      if (!db.devices[id]) break;
    }
    due.slice(0, -3).forEach((a) => { dev.sent[a.id] = now; touch(); });
    if (!db.devices[id]) continue;
    const before = dev.alarms.length;
    dev.alarms = dev.alarms.filter((a) => a.at > now - cfg.lateMs && !dev.sent[a.id]);
    for (const k of Object.keys(dev.sent)) if (dev.sent[k] < now - 3 * 86400000) delete dev.sent[k];
    if (dev.alarms.length !== before) touch();
  }
  if (dirty) saveDb();
  return sent;
}

// ---------- HTTP ----------
const log = (...a) => console.log(new Date().toISOString(), ...a);
const hits = new Map();
const limited = (ip) => {
  const m = Math.floor(Date.now() / 60000);
  const k = `${ip}:${m}`;
  hits.set(k, (hits.get(k) || 0) + 1);
  if (hits.size > 5000) for (const x of hits.keys()) if (!x.endsWith(`:${m}`)) hits.delete(x);
  return hits.get(k) > 120;
};

function readRaw(req, max) {
  return new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on('data', (c) => { n += c.length; if (n > max) { reject(Object.assign(new Error('za duże'), { code: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const wavOf = (pcm) => {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(16000, 24); h.writeUInt32LE(32000, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
};
// Opcjonalnie: chmura (Groq, Whisper large-v3-turbo) — klucz tylko na serwerze, nigdy w aplikacji.
async function sttCloud(raw, prompt) {
  const f = new FormData();
  f.append('file', new Blob([wavOf(raw)], { type: 'audio/wav' }), 'mowa.wav');
  f.append('model', cfg.groqModel); f.append('language', 'pl'); f.append('temperature', '0'); f.append('response_format', 'json');
  if (prompt) f.append('prompt', prompt);
  const r = await fetch(cfg.groqUrl, { method: 'POST', headers: { Authorization: `Bearer ${cfg.groqKey}` }, body: f, signal: AbortSignal.timeout(30000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j.error && j.error.message) || `Groq ${r.status}`);
  return String(j.text || '').trim();
}

// Rozpoznawanie mowy: aplikacja wysyła próbki PCM, serwer przekazuje je do lokalnej usługi kalendarz-stt (jeśli zainstalowana).
export async function handleStt(req) {
  const u = new URL(req.url, 'http://x');
  const id = u.searchParams.get('d');
  const tok = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const dev = validId(id) ? db.devices[id] : null;
  if (!dev || !tok || !safeEq(sha(tok), dev.tokenHash)) return [401, { error: 'brak uprawnień' }];
  if (u.searchParams.get('warm') && cfg.groqKey) { req.resume(); return [200, { ok: true, cloud: true }]; }
  if (u.searchParams.get('warm')) {
    // rozgrzanie modelu na czas nagrywania (odpowiedź nie czeka na wynik)
    http.get(`${cfg.sttUrl}/warm`, { timeout: 3000 }, (r2) => r2.resume()).on('error', () => {}).on('timeout', function () { this.destroy(); });
    req.resume();
    return [200, { ok: true }];
  }
  const raw = await readRaw(req, 1_200_000);
  if (raw.length < 3200) return [400, { error: 'za krótkie nagranie' }];
  const prompt = (u.searchParams.get('p') || '').slice(0, 400);
  if (cfg.groqKey) {
    try { return [200, { text: await sttCloud(raw, prompt), via: 'cloud' }]; } catch (e) { log('stt chmura:', e.message); /* spadamy na usługę lokalną */ }
  }
  return new Promise((resolve) => {
    const r = http.request(`${cfg.sttUrl}/transcribe?p=${encodeURIComponent(prompt)}`, { method: 'POST', headers: { 'Content-Length': raw.length }, timeout: 90000 }, (res2) => {
      const ch = []; res2.on('data', (c) => ch.push(c));
      res2.on('end', () => { try { resolve([res2.statusCode === 200 ? 200 : 502, JSON.parse(Buffer.concat(ch).toString('utf8'))]); } catch (_) { resolve([502, { error: 'zła odpowiedź' }]); } });
    });
    r.on('timeout', () => { r.destroy(); resolve([504, { error: 'za długo' }]); });
    r.on('error', () => resolve([503, { error: 'usługa rozpoznawania nie działa' }]));
    r.end(raw);
  });
}

function readBody(req, max = 600_000) {
  return new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on('data', (c) => { n += c.length; if (n > max) { reject(Object.assign(new Error('za duże'), { code: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (_) { reject(Object.assign(new Error('zły JSON'), { code: 400 })); } });
    req.on('error', reject);
  });
}

const validSub = (s) => s && typeof s.endpoint === 'string' && /^https:\/\//.test(s.endpoint) && s.keys && typeof s.keys.p256dh === 'string' && typeof s.keys.auth === 'string';
const validId = (s) => typeof s === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(s);
const clean = (a) => ({
  id: String(a.id).slice(0, 120), at: Math.round(+a.at), title: String(a.title || '').slice(0, 140), body: String(a.body || '').slice(0, 300),
  tag: String(a.tag || a.id).slice(0, 120), url: String(a.url || './').slice(0, 200),
  ...(a.br === 'morning' || a.br === 'evening' || a.br === 'weekly' ? { br: a.br, tk: Math.max(0, Math.min(999, Math.round(+a.tk) || 0)), pv: a.pv ? 1 : 0 } : {}),
});

const str = (v, n) => String(v == null ? '' : v).slice(0, n);
export function cleanAgenda(a) {
  if (!a || !Array.isArray(a.days)) return null;
  const days = a.days.slice(0, 8).map((d) => ({
    d: str(d.d, 10),
    items: (Array.isArray(d.items) ? d.items : []).slice(0, 60).map((i) => ({
      k: i.k === 't' ? 't' : 'e', s: str(i.s, 5), e: str(i.e, 5), ad: i.ad ? 1 : 0, t: str(i.t, 120), l: str(i.l, 80), c: /^#[0-9a-fA-F]{6}$/.test(i.c || '') ? i.c : '', done: i.done ? 1 : 0, w: str(i.w, 1),
    })),
  })).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.d));
  const cnt = {};
  if (a.cnt && typeof a.cnt === 'object') for (const [k, v] of Object.entries(a.cnt).slice(0, 70)) if (/^\d{4}-\d{2}-\d{2}$/.test(k) && Number.isFinite(+v)) cnt[k] = Math.max(0, Math.min(99, Math.round(+v)));
  const pcnt = {};
  if (a.pcnt && typeof a.pcnt === 'object') for (const [k, v] of Object.entries(a.pcnt).slice(0, 70)) if (/^\d{4}-\d{2}-\d{2}$/.test(k) && Number.isFinite(+v)) pcnt[k] = Math.max(0, Math.min(99, Math.round(+v)));
  const pcol = /^#[0-9a-fA-F]{6}$/.test(a.pcol || '') ? a.pcol : '';
  const g = a.geo || {};
  const geo = Number.isFinite(+g.lat) && Number.isFinite(+g.lon) && Math.abs(+g.lat) <= 90 && Math.abs(+g.lon) <= 180 ? { n: str(g.n, 40), lat: +g.lat, lon: +g.lon } : null;
  return { gen: Date.now(), days, cnt, pcnt, pcol, geo };
}

const RE_D = /^\d{4}-\d{2}-\d{2}$/;
const RE_T = /^\d{2}:\d{2}$/;
// Wspólny kalendarz: urządzenie publikuje swoje wydarzenia (prywatne bez tytułu); inne urządzenia je tylko czytają.
export function cleanShare(a) {
  if (!a || typeof a !== 'object') return null;
  const name = str(a.name, 24).trim();
  if (!name) return null;
  const events = (Array.isArray(a.events) ? a.events : []).slice(0, 900).filter((x) => x && RE_D.test(x.d || '')).map((x) => ({
    d: x.d, s: RE_T.test(x.s || '') ? x.s : '', ed: RE_D.test(x.ed || '') ? x.ed : x.d, e: RE_T.test(x.e || '') ? x.e : '', ad: x.ad ? 1 : 0,
    t: x.p ? '' : str(x.t, 100), l: x.p ? '' : str(x.l, 60), p: x.p ? 1 : 0,
  }));
  return { name, color: /^#[0-9a-fA-F]{6}$/.test(a.color || '') ? a.color : '#34d3ff', events, gen: Date.now() };
}

// ---------- Powiadomienia o nowych wpisach drugiej osoby ----------
const pend = new Map(); // senderId -> { name, groups: Map(tytuł -> pierwsze wydarzenie), due }
const WD = ['ndz', 'pon', 'wt', 'śr', 'czw', 'pt', 'sob'];
const warsawToday = (now = Date.now()) => new Date(now).toLocaleDateString('sv-SE', { timeZone: 'Europe/Warsaw' });
const evKey = (e) => `${e.d}|${e.s}|${e.ed}|${e.e}|${e.ad}|${e.p}|${e.t}`;
const whenTxt = (e) => { const [y, m, d] = e.d.split('-').map(Number); return `${WD[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${String(d).padStart(2, '0')}.${String(m).padStart(2, '0')}${e.ad ? ', cały dzień' : e.s ? ' ' + e.s : ''}`; };
const plural = (n) => (n === 1 ? 'nowe wydarzenie' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 > 20) ? 'nowe wydarzenia' : 'nowych wydarzeń');

// Nowe = brak w poprzedniej liście i brak wpisu o tym samym tytule (przesunięcie/edycja nie liczy się), tylko przyszłe i bliższe niż 100 dni
// (dalszy horyzont przesuwa się codziennie wraz z oknem synchronizacji). Pierwsza synchronizacja nie powiadamia.
export function noteNewShared(senderId, prev, next, now = Date.now()) {
  if (!prev || !Array.isArray(prev.events) || !next || prev.name.toLowerCase() !== next.name.toLowerCase()) return 0;
  const today = warsawToday(now);
  const limit = warsawToday(now + 100 * 86400000);
  const keys = new Set(prev.events.map(evKey));
  const titles = new Set(prev.events.filter((e) => e.t).map((e) => e.t));
  const fresh = next.events.filter((e) => e.d >= today && e.d <= limit && !keys.has(evKey(e)) && !(e.t && titles.has(e.t)));
  if (!fresh.length) return 0;
  const p = pend.get(senderId) || { name: next.name, groups: new Map(), due: now + 45000 };
  p.name = next.name;
  for (const e of fresh) { const g = e.t || '\u0000prywatne'; if (!p.groups.has(g)) p.groups.set(g, e); }
  pend.set(senderId, p);
  return fresh.length;
}

export async function flushPeerNotes(now = Date.now()) {
  let sent = 0;
  for (const [sid, p] of [...pend]) {
    if (p.due > now) continue;
    pend.delete(sid);
    const items = [...p.groups.entries()];
    const [t0, e0] = items[0];
    const label = (t, e) => (t.startsWith('\u0000') ? 'Zajęty termin' : t || 'Zajęty termin') + (e ? '' : '');
    const title = items.length === 1 ? `${p.name}: nowe wydarzenie` : `${p.name}: ${items.length} ${plural(items.length)}`;
    const body = items.length === 1 ? `${label(t0)} · ${whenTxt(e0)}` : items.slice(0, 3).map(([t]) => label(t)).join(', ') + (items.length > 3 ? '…' : '');
    for (const [rid, rdev] of Object.entries(db.devices)) {
      if (rid === sid || !rdev.sub || !rdev.share || rdev.np === false) continue;
      if (rdev.share.name.toLowerCase() === p.name.toLowerCase()) continue;
      if (await sendTo(rid, rdev, { id: `peer:${sha(sid).slice(0, 8)}:${now}`, title, body, tag: `peer-${sha(sid).slice(0, 8)}`, url: `./?day=${e0.d}` })) sent++;
    }
  }
  return sent;
}

// ---------- Automatyczna kopia zapasowa: serwer trzyma tylko zaszyfrowany blok (klucz zna wyłącznie telefon) ----------
const bkRoot = () => path.join(path.dirname(cfg.dataFile), 'backups');
const validBid = (s) => typeof s === 'string' && /^[a-f0-9]{32,64}$/.test(s);
const bkFiles = (bid) => { try { return fs.readdirSync(path.join(bkRoot(), bid)).filter((f) => /^\d+\.bin$/.test(f)).map((f) => +f.slice(0, -4)).sort((a, b) => b - a); } catch (_) { return []; } };

// Zostaje najnowsza wersja z każdego z ostatnich 7 dni, w których coś zapisano.
export function backupKeep(list) {
  const out = []; const days = new Set();
  for (const at of [...list].sort((a, b) => b - a)) {
    const d = warsawToday(at);
    if (days.has(d)) continue;
    if (days.size >= cfg.backupKeepDays) break;
    days.add(d); out.push(at);
  }
  return out;
}
export function backupPut(bid, blob, now = Date.now()) {
  const dir = path.join(bkRoot(), bid);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(bkRoot(), { recursive: true });
    if (fs.readdirSync(bkRoot()).length >= cfg.backupDirs) throw Object.assign(new Error('za dużo kopii'), { code: 400 });
    fs.mkdirSync(dir);
  }
  const tmp = path.join(dir, `${now}.tmp`);
  fs.writeFileSync(tmp, blob, { mode: 0o600 });
  fs.renameSync(tmp, path.join(dir, `${now}.bin`));
  const all = bkFiles(bid);
  const keep = new Set(backupKeep(all));
  for (const at of all) if (!keep.has(at)) fs.rmSync(path.join(dir, `${at}.bin`), { force: true });
  return [...keep].sort((a, b) => b - a);
}

// ---------- Wspólna przestrzeń: wydarzenia dla dwojga, wspólne zadania, lista zakupów ----------
const KINDS = new Set(['event', 'task', 'shop']);
const pendSpace = new Map(); // nadawca -> { me, notes, due }
const space = () => { db.space ||= { v: 0, items: {} }; return db.space; };
export function spaceSync(id, dev, body, now = Date.now()) {
  const sp = space();
  const me = str(body.me, 24).trim();
  if (me) { dev.me = me; touch(); }
  const notes = [];
  for (const c of (Array.isArray(body.changes) ? body.changes : []).slice(0, 200)) {
    if (!c || typeof c.id !== 'string' || !/^[A-Za-z0-9_-]{4,40}$/.test(c.id) || !KINDS.has(c.kind)) continue;
    const data = c.deleted ? null : c.data;
    if (!c.deleted && (!data || typeof data !== 'object' || JSON.stringify(data).length > 4000)) continue;
    sp.v += 1;
    sp.items[c.id] = { id: c.id, kind: c.kind, deleted: !!c.deleted, data, by: me, at: now, v: sp.v };
    if (c.note) notes.push(str(c.note, 120));
    touch();
  }
  const cut = now - 30 * 86400000;
  for (const [k, it] of Object.entries(sp.items)) if (it.deleted && it.at < cut) delete sp.items[k];
  if (notes.length && me) {
    const p = pendSpace.get(id) || { me, notes: [], due: now + 15000 };
    p.notes.push(...notes); pendSpace.set(id, p);
  }
  const since = +body.since || 0;
  return { v: sp.v, items: Object.values(sp.items).filter((x) => x.v > since) };
}
export async function flushSpaceNotes(now = Date.now()) {
  let sent = 0;
  for (const [sid, p] of [...pendSpace]) {
    if (p.due > now) continue;
    pendSpace.delete(sid);
    const body = p.notes.slice(0, 3).join(', ') + (p.notes.length > 3 ? '…' : '');
    for (const [rid, rdev] of Object.entries(db.devices)) {
      if (rid === sid || !rdev.sub || !rdev.me || rdev.me.toLowerCase() === p.me.toLowerCase()) continue;
      if (await sendTo(rid, rdev, { id: `space:${sha(sid).slice(0, 8)}:${now}`, title: p.me, body, tag: `space-${sha(sid).slice(0, 8)}`, url: './?shared=1' })) sent++;
    }
  }
  return sent;
}

// ---------- Asystent: pośrednik do Gemini. Klucz zostaje na serwerze, model można wymienić bez zmian w aplikacji. ----------
const gem = { model: '' };
export function bestModel(names) {
  const score = (n) => { const m = /^gemini-(\d+(?:\.\d+)?)-flash(-lite)?$/.exec(n); return m ? +m[1] * 10 - (m[2] ? 3 : 0) : -1; };
  return [...names].sort((a, b) => score(b) - score(a)).find((n) => score(n) >= 0) || names.find((n) => /flash/.test(n) && !/preview|exp|image|tts|live|audio/.test(n)) || '';
}
async function pickModel(force = false) {
  if (cfg.geminiModel && !force) return cfg.geminiModel;
  if (gem.model && !force) return gem.model;
  const r = await fetch(`${cfg.geminiUrl}/models?pageSize=200`, { headers: { 'x-goog-api-key': cfg.geminiKey }, signal: AbortSignal.timeout(15000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error((j.error && j.error.message) || `Gemini ${r.status}`), { status: r.status });
  gem.model = bestModel((j.models || []).filter((m) => (m.supportedGenerationMethods || []).includes('generateContent')).map((m) => m.name.replace(/^models\//, '')));
  if (!gem.model) throw new Error('Gemini nie udostępnia żadnego modelu tekstowego');
  return gem.model;
}
async function geminiCall(system, turns, tries = 2) {
  const model = await pickModel();
  const res = await fetch(`${cfg.geminiUrl}/models/${model}:generateContent`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': cfg.geminiKey }, signal: AbortSignal.timeout(50000),
    body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: turns.map((t) => ({ role: t.role === 'model' ? 'model' : 'user', parts: [{ text: t.text }] })), generationConfig: { responseMimeType: 'application/json', temperature: 0.2 } }),
  });
  const j = await res.json().catch(() => ({}));
  if (res.status === 404 && tries > 1 && !cfg.geminiModel) { gem.model = ''; await pickModel(true); return geminiCall(system, turns, tries - 1); }
  if ((res.status === 503 || res.status === 500) && tries > 1) { await new Promise((r) => setTimeout(r, 1500)); return geminiCall(system, turns, tries - 1); }
  if (!res.ok) throw Object.assign(new Error((j.error && j.error.message) || `Gemini ${res.status}`), { status: res.status });
  return ((j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || []).map((p) => p.text || '').join('');
}
export async function handleAi(body) {
  if (!cfg.geminiKey) return [503, { error: 'Asystent nie ma jeszcze klucza Gemini na serwerze.', code: 'nokey' }];
  const system = str(body.system, 30000);
  const turns = (Array.isArray(body.turns) ? body.turns : []).slice(-14).map((t) => ({ role: t && t.role, text: str(t && t.text, 30000) })).filter((t) => t.text);
  if (!turns.length) return [400, { error: 'puste polecenie' }];
  try { return [200, { text: await geminiCall(system, turns) }]; } catch (e) {
    log('ai:', e.message);
    if (e.status === 429) return [429, { error: 'Skończył się chwilowy limit darmowego klucza Gemini. Spróbuj za kilka minut.' }];
    if (/location/i.test(e.message)) return [502, { error: 'Google nie obsługuje tego klucza w lokalizacji serwera.' }];
    return [502, { error: 'Asystent chwilowo nie odpowiada.' }];
  }
}

export async function handle(method, url, headers, body) {
  const route = url.split('?')[0].replace(/\/+$/, '') || '/';
  if (method === 'GET' && route === '/health') return [200, { ok: true, devices: Object.keys(db.devices).length }];
  if (method === 'GET' && route === '/vapid') return [200, { publicKey: cfg.vapidPublic }];
  if (method === 'GET' && route.startsWith('/widget/')) {
    const tok = route.slice(8);
    const dev = tok.length >= 16 ? Object.values(db.devices).find((x) => x.wtoken && safeEq(x.wtoken, tok)) : null;
    if (!dev || !dev.agenda) return [404, { error: 'brak danych' }];
    return [200, { ...dev.agenda, now: Date.now() }];
  }
  const auth = (headers.authorization || '').replace(/^Bearer\s+/i, '') || (body && typeof body.token === 'string' ? body.token : '');
  if (method === 'POST' && route === '/subscribe') {
    const { deviceId, setup, subscription } = body || {};
    if (!validId(deviceId) || !validSub(subscription)) return [400, { error: 'nieprawidłowe dane' }];
    const dev = db.devices[deviceId];
    if (dev) {
      if (!auth || !safeEq(sha(auth), dev.tokenHash)) return [401, { error: 'brak uprawnień' }];
      dev.sub = subscription; touch();
      return [200, { ok: true }];
    }
    if (!cfg.setupCode || typeof setup !== 'string' || !safeEq(setup, cfg.setupCode)) return [401, { error: 'zły kod połączenia' }];
    if (Object.keys(db.devices).length >= cfg.maxDevices) return [403, { error: 'za dużo urządzeń' }];
    const token = crypto.randomBytes(24).toString('base64url');
    const dev0 = { tokenHash: sha(token), sub: subscription, alarms: [], sent: {}, created: Date.now() };
    // Ponowne połączenie tego samego telefonu: zachowaj dotychczasowy tajny adres widgetu (żeby nie wklejać skryptu od nowa).
    const wt = body.wtoken;
    if (typeof wt === 'string' && /^[A-Za-z0-9_-]{20,64}$/.test(wt) && !Object.values(db.devices).some((x) => x.wtoken === wt)) dev0.wtoken = wt;
    db.devices[deviceId] = dev0;
    touch(); saveDb();
    return [200, { ok: true, token }];
  }
  const id = body && body.deviceId;
  const dev = validId(id) ? db.devices[id] : null;
  if (!dev || !auth || !safeEq(sha(auth), dev.tokenHash)) return [401, { error: 'brak uprawnień' }];
  if (method === 'POST' && route === '/sync') {
    const now = Date.now();
    const list = (Array.isArray(body.alarms) ? body.alarms : []).filter((a) => a && a.id && Number.isFinite(+a.at) && +a.at > now - cfg.lateMs && +a.at < now + 15 * 86400000).slice(0, cfg.maxAlarms).map(clean);
    dev.alarms = list.filter((a) => !(dev.sent || {})[a.id]);
    const ag = cleanAgenda(body.agenda);
    if (ag) dev.agenda = ag;
    if (body.share === null) delete dev.share;
    else if (body.share) { const sh = cleanShare(body.share); if (sh) { noteNewShared(id, dev.share, sh, now); dev.share = sh; } }
    if (typeof body.np === 'boolean') dev.np = body.np;
    if (!dev.wtoken) dev.wtoken = crypto.randomBytes(24).toString('base64url');
    dev.sync = now; touch(); saveDb();
    return [200, { ok: true, queued: dev.alarms.length, widget: dev.wtoken }];
  }
  if (method === 'POST' && route === '/peers') {
    const me = (dev.share && dev.share.name || '').toLowerCase();
    const peers = Object.entries(db.devices)
      .filter(([k, d]) => k !== id && d.share && d.share.name.toLowerCase() !== me)
      .map(([k, d]) => ({ id: sha(k).slice(0, 10), name: d.share.name, color: d.share.color, gen: d.share.gen, events: d.share.events }))
      .sort((x, y) => y.gen - x.gen);
    const seen = new Set();
    return [200, { peers: peers.filter((x) => { const n = x.name.toLowerCase(); if (seen.has(n)) return false; seen.add(n); return true; }), now: Date.now() }];
  }
  if (method === 'POST' && route === '/backup/put') {
    if (!validBid(body.bid) || typeof body.blob !== 'string' || !body.blob || body.blob.length > cfg.backupMaxBytes) return [400, { error: 'nieprawidłowa kopia' }];
    return [200, { ok: true, versions: backupPut(body.bid, body.blob) }];
  }
  if (method === 'POST' && route === '/backup/list') {
    if (!validBid(body.bid)) return [400, { error: 'nieprawidłowa kopia' }];
    return [200, { versions: bkFiles(body.bid) }];
  }
  if (method === 'POST' && route === '/backup/get') {
    if (!validBid(body.bid) || !bkFiles(body.bid).includes(+body.at)) return [404, { error: 'nie ma takiej kopii' }];
    return [200, { blob: fs.readFileSync(path.join(bkRoot(), body.bid, `${+body.at}.bin`), 'utf8') }];
  }
  if (method === 'POST' && route === '/space/sync') { const r = spaceSync(id, dev, body); saveDb(); return [200, r]; }
  if (method === 'POST' && route === '/ai') return handleAi(body);
  if (method === 'POST' && route === '/unsubscribe') { delete db.devices[id]; touch(); saveDb(); return [200, { ok: true }]; }
  if (method === 'POST' && route === '/test') {
    const ok = await sendTo(id, dev, { id: `test:${Date.now()}`, title: 'Test powiadomienia z serwera', body: 'Działa. Przypomnienia dotrą, nawet gdy aplikacja jest zamknięta.', url: './' });
    return [ok ? 200 : 502, { ok }];
  }
  return [404, { error: 'nie znaleziono' }];
}

export function createServer() {
  return http.createServer(async (req, res) => {
    const origin = req.headers.origin;
    const cors = { 'Access-Control-Allow-Origin': origin && origin === cfg.origin ? origin : cfg.origin, 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Max-Age': '86400', Vary: 'Origin' };
    const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...cors }); res.end(JSON.stringify(obj)); };
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
    const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
    if (limited(ip)) return send(429, { error: 'za dużo żądań' });
    try {
      if (req.method === 'POST' && req.url.split('?')[0].replace(/\/+$/, '') === '/stt') { const [c, o] = await handleStt(req); return send(c, o); }
      const body = req.method === 'POST' ? await readBody(req, req.url.startsWith('/backup') ? cfg.backupMaxBytes + 2000 : undefined) : {};
      const [code, obj] = await handle(req.method, req.url, req.headers, body);
      send(code, obj);
    } catch (e) { send(e.code === 413 || e.code === 400 ? e.code : 500, { error: e.message || 'błąd' }); }
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (!cfg.vapidPublic || !cfg.vapidPrivate || !cfg.setupCode) { console.error('Brak VAPID_PUBLIC / VAPID_PRIVATE / SETUP_CODE w środowisku.'); process.exit(1); }
  loadDb();
  const srv = createServer();
  srv.listen(cfg.port, cfg.host, () => log(`Kalendarz push: ${cfg.host}:${cfg.port}, urządzeń: ${Object.keys(db.devices).length}`));
  setInterval(() => { runDue().catch((e) => log('tick', e.message)); flushPeerNotes().catch((e) => log('peer', e.message)); flushSpaceNotes().catch((e) => log('space', e.message)); }, cfg.tickMs);
  const bye = () => { try { if (dirty) saveDb(); } catch (_) { /* nic */ } process.exit(0); };
  process.on('SIGTERM', bye); process.on('SIGINT', bye);
}
