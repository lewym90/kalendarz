// Testy serwera push: autoryzacja, synchronizacja, wysyłka (atrapa web-push), czyszczenie wygasłych subskrypcji, CORS.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kp-'));
Object.assign(process.env, { DATA_FILE: path.join(dir, 'db.json'), SETUP_CODE: 'KOD123', VAPID_PUBLIC: 'pub', VAPID_PRIVATE: 'priv', PORT: '0' });
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
srv.close(); console.log(`\n${ok} testów serwera OK`); process.exit(0);
