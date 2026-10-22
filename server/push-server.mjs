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

export async function runDue(now = Date.now()) {
  let sent = 0;
  for (const [id, dev] of Object.entries(db.devices)) {
    dev.sent ||= {};
    const due = (dev.alarms || []).filter((a) => a.at <= now && a.at > now - cfg.lateMs && !dev.sent[a.id]);
    // po dłuższej przerwie nie zalewamy telefonu: najpóźniej 3 najnowsze
    for (const a of due.slice(-3)) {
      dev.sent[a.id] = now;
      touch();
      if (await sendTo(id, dev, a)) sent++;
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
      const body = req.method === 'POST' ? await readBody(req) : {};
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
  setInterval(() => { runDue().catch((e) => log('tick', e.message)); flushPeerNotes().catch((e) => log('peer', e.message)); }, cfg.tickMs);
  const bye = () => { try { if (dirty) saveDb(); } catch (_) { /* nic */ } process.exit(0); };
  process.on('SIGTERM', bye); process.on('SIGINT', bye);
}
