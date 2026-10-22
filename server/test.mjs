// Testy serwera push: autoryzacja, synchronizacja, wysyłka (atrapa web-push), czyszczenie wygasłych subskrypcji, CORS.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kp-'));
Object.assign(process.env, { DATA_FILE: path.join(dir, 'db.json'), SETUP_CODE: 'KOD123', VAPID_PUBLIC: 'pub', VAPID_PRIVATE: 'priv', PORT: '0' });
import http from 'node:http';
let sttGot = null;
const fakeStt = http.createServer((q, r) => { const ch = []; q.on('data', (c) => ch.push(c)); q.on('end', () => { sttGot = { url: q.url, n: Buffer.concat(ch).length }; r.writeHead(200, { 'Content-Type': 'application/json' }); r.end(JSON.stringify({ text: 'siłownia w piątek o 16' })); }); });
await new Promise((r) => fakeStt.listen(0, '127.0.0.1', r));
process.env.STT_URL = `http://127.0.0.1:${fakeStt.address().port}`;
let cloudGot = null;
const fakeCloud = http.createServer((q, r) => { const ch = []; q.on('data', (c) => ch.push(c)); q.on('end', () => { const b = Buffer.concat(ch); cloudGot = { auth: q.headers.authorization, ct: q.headers['content-type'], has: b.includes('whisper-large-v3-turbo') && b.includes('RIFF') && b.includes('Siłownia') }; r.writeHead(200, { 'Content-Type': 'application/json' }); r.end(JSON.stringify({ text: 'Siłownia w piątek o 16' })); }); });
await new Promise((r) => fakeCloud.listen(0, '127.0.0.1', r));
const cloudUrl = `http://127.0.0.1:${fakeCloud.address().port}`;
const S = await import('./push-server.mjs');
const sent = [];
let fail = 0;
S.setSender(async (sub, payload) => { if (fail) throw Object.assign(new Error('gone'), { statusCode: fail }); sent.push({ sub, payload: JSON.parse(payload) }); });
S.loadDb();
const srv = S.createServer(); await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${srv.address().port}`;
const call = async (m, p, body, tok, origin) => { const r = await fetch(base + p, { method: m, headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}), ...(origin ? { Origin: origin } : {}) }, body: m === 'POST' ? JSON.stringify(body || {}) : undefined }); return [r.status, await r.json(), r.headers]; };
const sub = { endpoint: 'https://push.example/abc', keys: { p256dh: 'p', auth: 'a' } };
const ID = 'device_0123456789abcdef';
let ok = 0; const t = async (n, f) => { await f(); ok++; console.log('ok', n); };

await t('health i vapid', async () => { assert.equal((await call('GET', '/health'))[0], 200); assert.equal((await call('GET', '/vapid'))[1].publicKey, 'pub'); });
await t('zły kod odrzucony', async () => assert.equal((await call('POST', '/subscribe', { deviceId: ID, setup: 'zly', subscription: sub }))[0], 401));
await t('zła subskrypcja odrzucona', async () => assert.equal((await call('POST', '/subscribe', { deviceId: ID, setup: 'KOD123', subscription: { endpoint: 'http://x' } }))[0], 400));
let token;
await t('rejestracja', async () => { const [c, j] = await call('POST', '/subscribe', { deviceId: ID, setup: 'KOD123', subscription: sub }); assert.equal(c, 200); token = j.token; assert.ok(token.length > 20); });
await t('ponowna subskrypcja wymaga tokenu', async () => { assert.equal((await call('POST', '/subscribe', { deviceId: ID, setup: 'KOD123', subscription: sub }))[0], 401); assert.equal((await call('POST', '/subscribe', { deviceId: ID, subscription: { ...sub, endpoint: 'https://push.example/new' } }, token))[0], 200); });
await t('sync bez tokenu 401', async () => assert.equal((await call('POST', '/sync', { deviceId: ID, alarms: [] }))[0], 401));
const now = Date.now();
await t('sync filtruje i zapisuje', async () => {
  const al = [{ id: 'a1', at: now + 60000, title: 'Za minutę', body: 'x' }, { id: 'old', at: now - 5 * 3600000, title: 'stary' }, { id: 'far', at: now + 40 * 86400000, title: 'daleko' }, { id: 'a2', at: now + 3600000, title: 'Za godzinę' }];
  const [c, j] = await call('POST', '/sync', { deviceId: ID, alarms: al }, token); assert.equal(c, 200); assert.equal(j.queued, 2);
});
await t('nic przed czasem', async () => { assert.equal(await S.runDue(now), 0); assert.equal(sent.length, 0); });
await t('wysyłka po czasie, raz', async () => {
  assert.equal(await S.runDue(now + 61000), 1); assert.equal(sent[0].payload.title, 'Za minutę'); assert.equal(sent[0].payload.tag, 'a1');
  assert.equal(await S.runDue(now + 62000), 0);
  await call('POST', '/sync', { deviceId: ID, alarms: [{ id: 'a1', at: now + 60000, title: 'Za minutę' }] }, token);
  assert.equal(await S.runDue(now + 63000), 0, 'ponowny sync nie wysyła drugi raz');
});
await t('zaległości: tylko 3 najnowsze', async () => {
  const al = [1, 2, 3, 4, 5].map((i) => ({ id: `m${i}`, at: now + 100000 + i * 1000, title: `m${i}` }));
  await call('POST', '/sync', { deviceId: ID, alarms: al }, token); sent.length = 0;
  assert.equal(await S.runDue(now + 200000), 3); assert.deepEqual(sent.map((x) => x.payload.title), ['m3', 'm4', 'm5']);
});
let wt;
await t('agenda i token widgetu', async () => {
  const day = new Date().toISOString().slice(0, 10);
  const [c, j] = await call('POST', '/sync', { deviceId: ID, alarms: [], agenda: { days: [{ d: day, items: [{ k: 'e', s: '09:30', e: '10:00', t: 'Dentysta', l: 'Mokotów', c: '#ff8800' }, { k: 'x', t: '<b>zły</b>', c: 'red' }, { k: 'e', s: '12:00', e: '13:00', t: 'Cudze', c: '#ff6fb5', w: 'OLA' }] }, { d: 'zła-data', items: [] }], cnt: { '2026-10-25': 3, zly: 1, '2026-10-26': 500 }, pcnt: { '2026-10-25': 2, bad: 1 }, pcol: '#ff6fb5', geo: { n: 'Lublin', lat: 51.25, lon: 22.57 } } }, token);
  assert.equal(c, 200); wt = j.widget; assert.ok(wt && wt.length > 20);
  const [c2, w] = await call('GET', `/widget/${wt}`); assert.equal(c2, 200);
  assert.equal(w.days.length, 1); assert.equal(w.days[0].items[0].t, 'Dentysta'); assert.equal(w.days[0].items[1].c, ''); assert.equal(w.days[0].items[1].k, 'e'); assert.equal(w.days[0].items[2].w, 'O'); assert.equal(w.days[0].items[0].w, '');
  assert.deepEqual(w.cnt, { '2026-10-25': 3, '2026-10-26': 99 }); assert.equal(w.geo.n, 'Lublin'); assert.deepEqual(w.pcnt, { '2026-10-25': 2 }); assert.equal(w.pcol, '#ff6fb5');
  assert.equal((await call('GET', '/widget/zlytokenzlytokenzlytoken'))[0], 404);
  const [, j2] = await call('POST', '/sync', { deviceId: ID, alarms: [] }, token); assert.equal(j2.widget, wt, 'token stały');
  const raw = JSON.parse(fs.readFileSync(process.env.DATA_FILE, 'utf8')); assert.ok(raw.devices[ID].agenda.days[0].items[0].t === 'Dentysta');
});
await t('sync z tokenem w treści (bez nagłówka, text/plain) – prosty request bez preflightu', async () => {
  const r = await fetch(base + '/sync', { method: 'POST', headers: { 'Content-Type': 'text/plain', Origin: 'https://lewym90.github.io' }, body: JSON.stringify({ deviceId: ID, token, alarms: [], agenda: { days: [{ d: new Date().toISOString().slice(0, 10), items: [] }] } }) });
  assert.equal(r.status, 200); assert.equal(r.headers.get('access-control-allow-origin'), 'https://lewym90.github.io');
  const r2 = await fetch(base + '/sync', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ deviceId: ID, token: 'zly', alarms: [] }) });
  assert.equal(r2.status, 401);
  const [, w] = await call('GET', `/widget/${wt}`); assert.equal(w.days[0].items.length, 0, 'usunięcie wpisów dociera do widgetu'); assert.ok(w.gen > 0);
});
await t('ponowne połączenie zachowuje token widgetu', async () => {
  const D = 'rejoin_0123456789abcdef', WT = 'wtoken_0123456789abcdefghij';
  const [c, j] = await call('POST', '/subscribe', { deviceId: D, setup: 'KOD123', wtoken: WT, subscription: sub }); assert.equal(c, 200);
  const [, s2] = await call('POST', '/sync', { deviceId: D, alarms: [], agenda: { days: [{ d: new Date().toISOString().slice(0, 10), items: [] }] } }, j.token);
  assert.equal(s2.widget, WT, 'ten sam adres widgetu po ponownym połączeniu');
  assert.equal((await call('GET', `/widget/${WT}`))[0], 200);
  await call('POST', '/unsubscribe', { deviceId: D }, j.token);
  const [c3, j3] = await call('POST', '/subscribe', { deviceId: 'inny_0123456789abcdef', setup: 'KOD123', wtoken: 'krotki', subscription: sub }); assert.equal(c3, 200);
  const [, s3] = await call('POST', '/sync', { deviceId: 'inny_0123456789abcdef', alarms: [] }, j3.token); assert.notEqual(s3.widget, 'krotki');
  await call('POST', '/unsubscribe', { deviceId: 'inny_0123456789abcdef' }, j3.token);
});
await t('test z serwera', async () => { sent.length = 0; assert.equal((await call('POST', '/test', { deviceId: ID }, token))[0], 200); assert.match(sent[0].payload.title, /Test/); });
await t('zapis na dysk i odczyt', async () => { const raw = JSON.parse(fs.readFileSync(process.env.DATA_FILE, 'utf8')); assert.ok(raw.devices[ID]); assert.ok(!JSON.stringify(raw).includes(token), 'token tylko jako skrót'); });
await t('CORS i preflight', async () => { const r = await fetch(base + '/sync', { method: 'OPTIONS', headers: { Origin: 'https://lewym90.github.io' } }); assert.equal(r.status, 204); assert.equal(r.headers.get('access-control-allow-origin'), 'https://lewym90.github.io'); const [, , h] = await call('GET', '/health', null, null, 'https://zly.example'); assert.equal(h.get('access-control-allow-origin'), 'https://lewym90.github.io'); });
await t('wygasła subskrypcja (410) usuwa urządzenie', async () => {
  await call('POST', '/sync', { deviceId: ID, alarms: [{ id: 'z1', at: Date.now() + 1000, title: 'z' }] }, token);
  fail = 410; await S.runDue(Date.now() + 5000); fail = 0;
  assert.equal((await call('POST', '/sync', { deviceId: ID, alarms: [] }, token))[0], 401);
});
await t('limit urządzeń i wyrejestrowanie', async () => {
  const toks = [];
  for (let i = 0; i < 5; i++) { const [c, j] = await call('POST', '/subscribe', { deviceId: `dev_${i}_0123456789abcd`, setup: 'KOD123', subscription: sub }); assert.equal(c, 200); toks.push(j.token); }
  assert.equal((await call('POST', '/subscribe', { deviceId: 'dev_x_0123456789abcdef', setup: 'KOD123', subscription: sub }))[0], 403);
  assert.equal((await call('POST', '/unsubscribe', { deviceId: 'dev_0_0123456789abcd' }, toks[0]))[0], 200);
});
await t('wspólny kalendarz: publikacja, odczyt, prywatność, ten sam autor pominięty', async () => {
  const mk = async (id) => { const [, j] = await call('POST', '/subscribe', { deviceId: id, setup: 'KOD123', subscription: sub }); return j.token; };
  await call('POST', '/unsubscribe', { deviceId: 'dev_1_0123456789abcd' }, undefined);
  const A = 'share_A_0123456789abc', B = 'share_B_0123456789abc', B2 = 'share_B2_0123456789ab';
  for (const d of Object.keys(S.getDb().devices)) delete S.getDb().devices[d];
  const ta = await mk(A), tb = await mk(B), tb2 = await mk(B2);
  const ev = [{ d: '2026-10-21', s: '10:00', ed: '2026-10-21', e: '11:00', t: 'Dentysta', l: 'Mokotów' }, { d: '2026-10-22', ad: 1, ed: '2026-10-24', t: 'Urlop' }, { d: '2026-10-23', s: '19:00', e: '20:00', t: 'Tajne', l: 'Hotel', p: 1 }, { d: 'zla', t: 'x' }];
  assert.equal((await call('POST', '/sync', { deviceId: A, alarms: [], share: { name: 'Ola', color: '#ff6fb5', events: ev } }, ta))[0], 200);
  assert.equal((await call('POST', '/sync', { deviceId: B, alarms: [], share: { name: 'Marek', color: 'zly', events: [] } }, tb))[0], 200);
  assert.equal((await call('POST', '/sync', { deviceId: B2, alarms: [], share: { name: 'marek', color: '#3aa0ff', events: [] } }, tb2))[0], 200);
  const [c, j] = await call('POST', '/peers', { deviceId: B }, tb); assert.equal(c, 200);
  assert.equal(j.peers.length, 1, 'drugie urządzenie Marka pominięte'); const o = j.peers[0];
  assert.equal(o.name, 'Ola'); assert.equal(o.color, '#ff6fb5'); assert.equal(o.events.length, 3);
  assert.equal(o.events[2].t, ''); assert.equal(o.events[2].l, ''); assert.equal(o.events[2].p, 1);
  assert.equal(o.events[1].ad, 1); assert.equal(o.events[1].ed, '2026-10-24');
  assert.ok(!JSON.stringify(j).includes('Hotel') && !JSON.stringify(j).includes('Tajne'), 'prywatne nie opuszczają serwera');
  assert.equal((await call('POST', '/peers', { deviceId: B }))[0], 401);
  const [, o2] = await call('POST', '/peers', { deviceId: A }, ta); assert.equal(o2.peers.length, 1); assert.equal(o2.peers[0].color, '#3aa0ff', 'z duplikatów imienia wygrywa najnowsze urządzenie'); assert.equal(S.cleanShare({ name: 'x', color: 'zly' }).color, '#34d3ff', 'zły kolor zastąpiony domyślnym');
  await call('POST', '/sync', { deviceId: A, alarms: [], share: null }, ta);
  assert.equal((await call('POST', '/peers', { deviceId: B }, tb))[1].peers.length, 0, 'wyłączenie udostępniania usuwa dane');
});
await t('powiadomienia o nowych wpisach drugiej osoby', async () => {
  const mk = async (id, ep) => (await call('POST', '/subscribe', { deviceId: id, setup: 'KOD123', subscription: { endpoint: ep, keys: { p256dh: 'p', auth: 'a' } } }))[1].token;
  const MA = 'marek_device_0123456789', OA = 'ola_device_0123456789a';
  const ta = await mk(MA, 'https://push.example/ma'), tb = await mk(OA, 'https://push.example/oa');
  const mine = () => sent.filter((x) => x.sub.endpoint === 'https://push.example/ma');
  const day = (n) => new Date(Date.now() + n * 86400000).toLocaleDateString('sv-SE', { timeZone: 'Europe/Warsaw' });
  const ev = (d, t, extra = {}) => ({ d, s: '19:00', ed: d, e: '20:00', ad: 0, p: 0, t, l: '', ...extra });
  const share = (name, events) => ({ name, color: '#34d3ff', events });
  await call('POST', '/sync', { deviceId: MA, alarms: [], share: share('Marek', [ev(day(2), 'Siłownia')]) }, ta);
  await call('POST', '/sync', { deviceId: OA, alarms: [], share: share('Ola', [ev(day(3), 'Joga')]), np: true }, tb);
  sent.length = 0;
  await S.flushPeerNotes(Date.now() + 120000); assert.equal(mine().length, 0, 'pierwsza synchronizacja nie powiadamia');
  // Ola dodaje: nowe wydarzenie, to samo z innym czasem (edycja), cykliczne z tym samym tytułem, przeszłe, prywatne
  await call('POST', '/sync', { deviceId: OA, alarms: [], share: share('Ola', [ev(day(3), 'Joga'), ev(day(5), 'Kino'), ev(day(4), 'Joga', { s: '18:00' }), ev(day(-3), 'Dawne'), ev(day(6), '', { p: 1 })]), np: true }, tb);
  await S.flushPeerNotes(Date.now() + 1000); assert.equal(mine().length, 0, 'najpierw odczekanie (grupowanie)');
  await S.flushPeerNotes(Date.now() + 120000);
  assert.equal(mine().length, 1); assert.equal(sent.filter((x) => x.sub.endpoint === 'https://push.example/oa').length, 0, 'autor nie dostaje własnych'); const pl = mine()[0].payload;
  assert.match(pl.title, /^Ola: 2 nowe wydarzenia$/); assert.match(pl.body, /Kino, Zajęty termin/); assert.ok(!pl.body.includes('Dawne') && !pl.body.includes('Joga'));
  assert.ok(pl.url.startsWith('./?day='));
  // pojedyncze, z godziną i dniem tygodnia
  sent.length = 0;
  await call('POST', '/sync', { deviceId: OA, alarms: [], share: share('Ola', [ev(day(3), 'Joga'), ev(day(5), 'Kino'), ev(day(4), 'Joga', { s: '18:00' }), ev(day(6), '', { p: 1 }), ev(day(7), 'Obiad')]), np: true }, tb);
  await S.flushPeerNotes(Date.now() + 120000);
  assert.equal(mine()[0].payload.title, 'Ola: nowe wydarzenie'); assert.match(mine()[0].payload.body, /^Obiad · (pon|wt|śr|czw|pt|sob|ndz) \d\d\.\d\d 19:00$/);
  // wyłączone u odbiorcy
  sent.length = 0;
  await call('POST', '/sync', { deviceId: MA, alarms: [], share: share('Marek', [ev(day(2), 'Siłownia')]), np: false }, ta);
  await call('POST', '/sync', { deviceId: OA, alarms: [], share: share('Ola', [ev(day(8), 'Zakupy'), ev(day(7), 'Obiad')]), np: true }, tb);
  await S.flushPeerNotes(Date.now() + 120000);
  assert.equal(mine().length, 0, 'odbiorca z wyłączonym powiadamianiem nic nie dostaje');
  // odległy horyzont nie powiadamia
  await call('POST', '/sync', { deviceId: MA, alarms: [], share: share('Marek', [ev(day(2), 'Siłownia')]), np: true }, ta);
  await call('POST', '/sync', { deviceId: OA, alarms: [], share: share('Ola', [ev(day(8), 'Zakupy'), ev(day(7), 'Obiad'), ev(day(115), '', { p: 1 })]), np: true }, tb);
  await S.flushPeerNotes(Date.now() + 120000);
  assert.equal(mine().length, 0, 'okno 100 dni');
  await call('POST', '/unsubscribe', { deviceId: MA }, ta); await call('POST', '/unsubscribe', { deviceId: OA }, tb);
});
await t('rozpoznawanie mowy: autoryzacja i przekazanie', async () => {
  const pcm = Buffer.alloc(32000);
  const SID = 'stt_device_0123456789ab';
  const [, reg] = await call('POST', '/subscribe', { deviceId: SID, setup: 'KOD123', subscription: { endpoint: 'https://push.example/stt', keys: { p256dh: 'p', auth: 'a' } } });
  const token = reg.token;
  const post = (q, tok) => fetch(`${base}/stt?${q}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) }, body: pcm });
  assert.equal((await post(`d=${SID}`)).status, 401);
  assert.equal((await post(`d=${SID}`, 'zly')).status, 401);
  const r = await post(`d=${SID}&p=${encodeURIComponent('Siłownia')}`, token);
  assert.equal(r.status, 200); assert.equal((await r.json()).text, 'siłownia w piątek o 16');
  assert.equal(sttGot.n, 32000); assert.ok(sttGot.url.includes('p=Si%C5%82ownia'));
  process.env.GROQ_API_KEY = 'sekret'; process.env.GROQ_URL = cloudUrl;
  const rc = await post(`d=${SID}&p=${encodeURIComponent('Siłownia')}`, token);
  assert.equal(rc.status, 200); const jc = await rc.json(); assert.equal(jc.via, 'cloud'); assert.equal(jc.text, 'Siłownia w piątek o 16');
  assert.equal(cloudGot.auth, 'Bearer sekret'); assert.ok(cloudGot.has, 'WAV, model i podpowiedź w żądaniu'); assert.ok(/multipart\/form-data/.test(cloudGot.ct));
  delete process.env.GROQ_API_KEY; delete process.env.GROQ_URL; fakeCloud.close();
  fakeStt.close();
  const r2 = await post(`d=${SID}`, token); assert.equal(r2.status, 503);
});
srv.close(); console.log(`\n${ok} testów serwera OK`); process.exit(0);
