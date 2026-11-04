import './setup.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
const S = await import('../js/store.js');
const { state, newEvent, addEvent, addTask, newTask, updateTask, rolloverTasks, undo, historyList, undoTo, migrate, DEFAULT_CATS } = S;
const { findSlots } = await import('../js/planner.js');
const { weatherAlerts } = await import('../js/weather.js');
const { skyName } = await import('../js/sky.js');
const { nextUp } = await import('../js/plan.js');
const { glyphFor } = await import('../js/glyphs.js');
const { isCommand, parseReply, checkActions, applyAction, askModel, searchHistory } = await import('../js/ai.js');
const { statsFor, mostMoved, periodRange } = await import('../js/more.js');
const { sealText, openText, deriveKeys } = await import('../js/backup.js');
const { instancesInRange } = await import('../js/recur.js');
const reset = () => { while (undo()); state.events = []; state.tasks = []; state.settings.buffer = { def: 0, cats: {} }; };
const now = new Date(2026, 10, 2, 8, 0); // poniedziałek

test('bufory odsuwają wolne okna, także per kategoria', () => {
  reset();
  state.events.push(newEvent({ title: 'A', cat: 'praca', start: '2026-11-02T10:00', end: '2026-11-02T11:00' }));
  const o = { now, durMin: 60, days: 1, from: '09:00', to: '13:00' };
  assert.equal(findSlots(state.events, o)[1].start.getHours(), 11);
  const b = findSlots(state.events, { ...o, bufferOf: (e) => (e.cat === 'praca' ? 30 : 0) });
  assert.equal(b.length, 1); assert.equal(b[0].start.getHours(), 11); assert.equal(b[0].start.getMinutes(), 30);
});
test('wpis całodniowy blokuje dzień tylko dla wspólnego terminu', () => {
  reset();
  state.events.push(newEvent({ title: 'Urlop', allDay: true, start: '2026-11-02T00:00', end: '2026-11-02T23:59' }));
  const o = { now, durMin: 60, days: 2, from: '09:00', to: '12:00' };
  assert.equal(findSlots(state.events, o)[0].start.getDate(), 2);
  assert.equal(findSlots(state.events, { ...o, allDayBusy: true })[0].start.getDate(), 3);
});
test('cofanie wielu kroków, historia i cofnięcie do punktu', () => {
  reset();
  addEvent(newEvent({ title: 'Jeden' })); addEvent(newEvent({ title: 'Dwa' })); addTask(newTask({ title: 'Trzy' }));
  assert.deepEqual(historyList().map((x) => x.changes[0]), ['Dodano: Trzy', 'Dodano: Dwa', 'Dodano: Jeden']);
  undo(); assert.equal(state.tasks.length, 0); undo(); assert.equal(state.events.length, 1);
  addEvent(newEvent({ title: 'X' })); addEvent(newEvent({ title: 'Y' }));
  const h = historyList(); undoTo(h[1].steps); assert.deepEqual(state.events.map((e) => e.title), ['Jeden']);
});
test('pierwotny termin przetrwa przenoszenie i zmianę', () => {
  reset(); state.settings.rollover = true; state.lastRollover = '';
  const t = addTask(newTask({ title: 'Z', due: '2026-11-01' }));
  rolloverTasks(now); assert.equal(t.due, '2026-11-02'); assert.equal(t.origDue, '2026-11-01'); assert.equal(t.rolled, 1);
  updateTask(t.id, { due: '2026-11-09' }); assert.equal(t.origDue, '2026-11-01');
  const leg = { id: 'l', title: 'L', due: '2026-10-30', done: false, rolled: 0 }; state.tasks.push(leg); state.lastRollover = '';
  rolloverTasks(now); assert.equal(leg.origDue, '2026-10-30');
});
test('dane ze starej wersji dostają żywe kolory i kategorię Odpoczynek', () => {
  const st = migrate({ cats: [{ id: 'sport', name: 'Sport', color: '#FF8A5B' }, { id: 'moja', name: 'Moja', color: '#123456' }, { id: 'inne', name: 'Inne', color: '#9AA3B8' }] });
  assert.equal(st.cats[0].color, '#27E05F'); assert.equal(st.cats[1].color, '#123456');
  assert.deepEqual(st.cats.map((c) => c.id), ['sport', 'moja', 'odpoczynek', 'inne']);
  assert.equal(migrate(st).cats.length, 4); assert.ok(DEFAULT_CATS.length >= 9);
});
const H = (h, x = {}) => ({ t: `2026-11-04T${String(h).padStart(2, '0')}:00`, temp: 10, feels: 9, pop: 0, code: 2, gust: 10, ...x });
test('ostrzeżenia pogodowe: kolejność, dopasowanie do planu, tylko reszta dnia', () => {
  const at = new Date(2026, 10, 4, 12);
  assert.equal(weatherAlerts({ hourly: [H(13), H(14)] }, at).length, 0);
  const rain = weatherAlerts({ hourly: [H(8, { pop: 90, code: 61 }), H(13), H(15, { pop: 70, code: 61 })] }, at);
  assert.equal(rain[0].title, 'Dziś po południu możliwy deszcz'); assert.equal(rain[0].sub, 'Weź ze sobą parasol.');
  assert.equal(weatherAlerts({ hourly: [H(8, { pop: 90, code: 61 }), H(13)] }, at).length, 0);
  const a = weatherAlerts({ hourly: [H(13, { code: 95, pop: 80 }), H(14, { pop: 70, code: 61 }), H(15, { gust: 70 })] }, at);
  assert.equal(a[0].kind, 'storm'); assert.ok(a.some((x) => x.kind === 'wind'));
  const plan = [{ title: 'Bieganie', start: new Date(2026, 10, 4, 15), end: new Date(2026, 10, 4, 16) }];
  assert.ok(weatherAlerts({ hourly: [H(15, { pop: 70, code: 61 })] }, at, plan)[0].sub.startsWith('O 15:00 masz: Bieganie.'));
  assert.equal(weatherAlerts({ hourly: [H(13, { temp: 0, feels: -3, pop: 50, code: 3 })] }, at)[0].kind, 'ice');
});
test('zdjęcie: pora ze słońca, pogoda ma pierwszeństwo', () => {
  const lat = 51.25; const lon = 22.57; const d = (h, m = 0) => new Date(2026, 10, 4, h, m);
  assert.equal(skyName(d(2), lat, lon, 0), 'noc'); assert.equal(skyName(d(6, 30), lat, lon, 0), 'swit');
  assert.equal(skyName(d(9, 30), lat, lon, 0), 'przedpoludnie'); assert.equal(skyName(d(11), lat, lon, 0), 'poludnie'); assert.equal(skyName(d(15, 50), lat, lon, 0), 'zachod');
  assert.equal(skyName(d(16, 30), lat, lon, 0), 'zmierzch'); assert.equal(skyName(d(12), lat, lon, 61), 'deszcz-dzien');
  assert.equal(skyName(d(22), lat, lon, 71), 'snieg-noc'); assert.equal(skyName(d(12), lat, lon, 3), 'pochmurno-dzien');
  assert.equal(skyName(d(11), lat, lon, null), 'poludnie');
});
test('następne wydarzenie', () => {
  const at = new Date(2026, 10, 4, 10, 30); const I = (k, a, b, allDay = false) => ({ key: k, allDay, start: new Date(2026, 10, 4, a), end: new Date(2026, 10, 4, b) });
  const r = nextUp([I('c', 0, 23, true), I('a', 8, 9), I('b', 10, 11), I('n', 13, 14), I('z', 17, 18)], at);
  assert.equal(r.next.key, 'n'); assert.equal(r.live[0].key, 'b'); assert.equal(nextUp([I('a', 8, 9)], at).next, null);
});
test('ikonki: treść, a potem kategoria', () => {
  const g = (title, cat = 'inne') => glyphFor({ title, cat });
  assert.equal(g('Siłownia'), 0); assert.equal(g('Dentysta'), 8); assert.equal(g('Lunch z Anią'), 24); assert.equal(g('Spotkanie z klientem'), 22);
  assert.equal(g('Fryzjer'), 14); assert.equal(g('Coś', 'finanse'), 48); assert.equal(g('Coś'), 56); assert.equal(glyphFor({ title: 'Ola', bday: true }), 29);
});
test('rozpoznawanie poleceń dla asystenta', () => {
  for (const t of ['Co mam jutro?', 'znajdź trzy godziny na projekt', 'Wypadło mi pilne spotkanie o 16, dopasuj resztę dnia', 'przenieś zaległe zadania', 'czy mam wolny piątek', 'jutro nie zdążę na 9']) assert.ok(isCommand(t), t);
  for (const t of ['jutro 17 siłownia', 'co drugi wtorek 9:30 dentysta', 'kup mleko', 'lunch z Anią w piątek o 13', 'zadanie: odpisać do piątku', '']) assert.ok(!isCommand(t), t);
});
test('asystent: pobiera dane, sprawdza propozycje, odrzuca zmyślone i prywatne', async () => {
  reset();
  const a = newEvent({ title: 'Dentysta', cat: 'zdrowie', start: '2026-11-04T10:00', end: '2026-11-04T11:00' });
  const p = newEvent({ title: 'Tajne', private: true, start: '2026-11-04T12:00', end: '2026-11-04T13:00' });
  state.events.push(a, p);
  const t = addTask(newTask({ title: 'Faktura' }));
  const at = new Date(2026, 10, 4, 8);
  const seen = [];
  const calls = [
    '```json\n{"reply":"","need":{"search":"dentysta"},"actions":[]}\n```',
    JSON.stringify({ reply: '', need: { slots: { dur: 60, days: 1, from: '09:00', to: '12:00' } }, actions: [] }),
    JSON.stringify({ reply: 'Gotowe', need: null, remember: 'Nie planuj po 20', actions: [
      { type: 'move_event', key: `${a.id}@2026-11-04`, date: '2026-11-04', start: '12:30', end: '13:30' },
      { type: 'move_event', key: `${p.id}@2026-11-04`, date: '2026-11-04', start: '15:00', end: '16:00' },
      { type: 'move_event', key: 'zmyslony@2026-11-04', date: '2026-11-04', start: '15:00', end: '16:00' },
      { type: 'add_event', title: 'Zła', date: 'jutro', start: '25:00', end: '26:00' },
      { type: 'add_event', title: 'Spotkanie', date: '2026-11-04', start: '16:00', end: '17:00', cat: 'nieznana' },
      { type: 'move_task', id: t.id, due: '2026-11-06' }, { type: 'done_task', id: 'brak' }] }),
  ];
  const r = await askModel([{ role: 'user', text: 'x' }], async (b) => { seen.push(JSON.parse(JSON.stringify(b))); return { text: calls.shift() }; }, at);
  assert.equal(seen.length, 3); assert.ok(seen[1].turns.at(-1).text.includes('Dentysta')); assert.ok(seen[2].turns.at(-1).text.includes('wolneOkna'));
  assert.ok(!seen[0].system.includes('Tajne'), 'prywatny tytuł nie idzie do modelu');
  const c = checkActions(r.actions); assert.equal(c.length, 3);
  assert.ok(c[0].warn.includes('Zajęte') || c[0].warn.includes('Tajne') || c[0].warn.startsWith('Koliduje'));
  S.batch(() => c.forEach(applyAction));
  assert.equal(state.events.find((e) => e.id === a.id).start, '2026-11-04T12:30');
  assert.equal(state.events.find((e) => e.title === 'Spotkanie').cat, 'inne'); assert.equal(t.due, '2026-11-06');
  undo(); assert.equal(state.events.find((e) => e.id === a.id).start, '2026-11-04T10:00'); assert.equal(state.events.length, 2);
  assert.equal(parseReply('zwykły tekst').reply, 'zwykły tekst'); assert.equal(searchHistory('tajne', at).length, 0);
});
test('asystent: przeniesienie w serii zmienia tylko ten dzień', () => {
  reset();
  const s = newEvent({ title: 'Seria', start: '2026-11-02T10:00', end: '2026-11-02T11:00', rrule: { freq: 'daily', interval: 1 } }); state.events.push(s);
  const [c] = checkActions([{ type: 'move_event', key: `${s.id}@2026-11-03`, date: '2026-11-03', start: '15:00', end: '16:00' }]);
  applyAction(c);
  const l = instancesInRange(state.events, new Date(2026, 10, 2), new Date(2026, 10, 5));
  assert.deepEqual(l.map((i) => i.start.getHours()), [10, 15, 10]);
});
test('statystyki: terminowość liczona od pierwszego terminu, przekładane, rok', () => {
  reset();
  state.events.push(newEvent({ title: 'Spotkanie', cat: 'praca', start: '2026-11-03T10:00', end: '2026-11-03T12:00' }), newEvent({ title: 'Trening', cat: 'sport', start: '2026-11-03T18:00', end: '2026-11-03T19:00' }));
  const T = (due, origDue, doneDay) => ({ id: due + doneDay, title: 't', done: true, due, origDue, doneAt: new Date(2026, 10, doneDay, 12).getTime(), rolled: 0 });
  state.tasks.push(T('2026-11-03', '2026-11-03', 3), T('2026-11-05', '2026-11-02', 4), { id: 'r', title: 'Odkładane', done: false, rolled: 5 });
  const [a, b] = periodRange('week', 0, 1, now);
  const s = statsFor(a, b);
  assert.equal(s.total, 180); assert.equal(s.meetings, 120); assert.equal(s.done, 2); assert.equal(s.punctual, 50); assert.equal(s.busiest.n, 2);
  assert.equal(mostMoved()[0].title, 'Odkładane');
  assert.equal(periodRange('year', -1, 1, now)[0].getFullYear(), 2025);
});
test('kopia: szyfrowanie w obie strony, złe hasło nie odczyta', async () => {
  const k = await deriveKeys('tajne-haslo'); const k2 = await deriveKeys('inne-haslo');
  assert.equal((await deriveKeys('tajne-haslo')).bid, k.bid); assert.notEqual(k.bid, k2.bid); assert.ok(/^[a-f0-9]{48}$/.test(k.bid));
  const blob = await sealText('{"zażółć":1}', k.k); assert.ok(!blob.includes('za'));
  assert.equal(await openText(blob, k.k), '{"zażółć":1}'); await assert.rejects(openText(blob, k2.k));
});
