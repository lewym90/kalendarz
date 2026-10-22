import test from 'node:test';
import assert from 'node:assert/strict';
import { parse, parseMulti } from '../js/nlp.js';
import { DEFAULT_CATS } from '../js/store.js';

const now = new Date(2026, 9, 19, 18, 45); // poniedziałek 19.10.2026 18:45
const P = (t) => parse(t, { now, cats: DEFAULT_CATS });

test('data i godzina: jutro 17 siłownia', () => {
  const p = P('jutro 17 siłownia');
  assert.equal(p.title, 'Siłownia'); assert.equal(p.date, '2026-10-20'); assert.equal(p.time, '17:00'); assert.equal(p.cat, 'sport');
});
test('powtarzanie: co drugi wtorek', () => {
  const p = P('co drugi wtorek dentysta 9:30');
  assert.equal(p.rrule.freq, 'weekly'); assert.equal(p.rrule.interval, 2); assert.deepEqual(p.rrule.byday, [2]); assert.equal(p.cat, 'zdrowie');
});
test('zakres godzin, miejsce i kategoria', () => {
  const p = P('spotkanie z klientem w środę 14-15:30 @Biuro #praca');
  assert.equal(p.time, '14:00'); assert.equal(p.endTime, '15:30'); assert.equal(p.loc, 'Biuro'); assert.equal(p.cat, 'praca'); assert.equal(p.durMin, 90);
});
test('zadanie z terminem', () => {
  const p = P('zadanie: wysłać fakturę do piątku');
  assert.equal(p.kind, 'task'); assert.equal(p.date, '2026-10-23');
});
test('za 2 godziny', () => {
  const p = P('za 2 godziny zadzwonić do mamy');
  assert.equal(p.date, '2026-10-19'); assert.equal(p.time, '20:45');
});
test('godziny słowami', () => {
  assert.equal(P('jutro o piątej po południu spotkanie').time, '17:00');
  assert.equal(P('kolacja jutro o dwudziestej pierwszej').time, '21:00');
  assert.equal(P('jutro o dziewiątej trzydzieści kawa').time, '09:30');
  assert.equal(P('wpół do ósmej rano budzik jutro').time, '07:30');
});
test('miejsce: sklep i miasto', () => {
  const a = P('zakupy w Biedronce jutro o 18');
  assert.equal(a.loc, 'Biedronka'); assert.equal(a.title, 'Zakupy');
  const b = P('spotkanie w Warszawie w piątek o 10');
  assert.equal(b.loc, 'Warszawa'); assert.equal(b.title, 'Spotkanie');
});
test('urodziny z rokiem', () => {
  const p = P('urodziny Oli 12 marca 1990');
  assert.equal(p.bday, true); assert.equal(p.byear, 1990); assert.equal(p.rrule.freq, 'yearly'); assert.equal(p.date, '2027-03-12'); assert.equal(p.allDay, true);
});
test('kilka wydarzeń w jednym zdaniu', () => {
  const l = parseMulti('jutro dentysta o 9 i siłownia o 18', { now, cats: DEFAULT_CATS });
  assert.equal(l.length, 2);
  assert.deepEqual(l.map((x) => [x.title, x.date, x.time]), [['Dentysta', '2026-10-20', '09:00'], ['Siłownia', '2026-10-20', '18:00']]);
});
test('„i” w tytule nie rozdziela', () => {
  const l = parseMulti('mecz Polska i Niemcy w sobotę o 20', { now, cats: DEFAULT_CATS });
  assert.equal(l.length, 1); assert.equal(l[0].title, 'Mecz Polska i Niemcy');
});
test('przypomnienie i dni robocze', () => {
  assert.deepEqual(P('przegląd auta 12.11 o 10 przypomnij 1 dzień wcześniej').remind, [1440]);
  assert.deepEqual(P('w dni robocze o 8 stand-up').rrule.byday, [1, 2, 3, 4, 5]);
});

test('głos: polecenie i data słowna', () => {
  const now = new Date(2026, 9, 21, 8, 30);
  const l = parseMulti('dodaj do kalendarza wizyta u lekarza trzeciego listopada o 17', { now, cats: DEFAULT_CATS });
  assert.equal(l.length, 1); assert.equal(l[0].title, 'Wizyta u lekarza'); assert.equal(l[0].date, '2026-11-03'); assert.equal(l[0].time, '17:00');
});
test('głos: trzy wydarzenia w jednym zdaniu', () => {
  const now = new Date(2026, 9, 21, 8, 30);
  const l = parseMulti('dodaj do kalendarza wizytę u lekarza 3 listopada o 17, wyjazd do rodziców 17 listopada o 12 i dentysta 2 grudnia 15.45', { now, cats: DEFAULT_CATS });
  assert.deepEqual(l.map((x) => [x.date, x.time]), [['2026-11-03', '17:00'], ['2026-11-17', '12:00'], ['2026-12-02', '15:45']]);
});
test('głos: zadania z różnymi dniami', () => {
  const now = new Date(2026, 9, 21, 8, 30);
  const a = parseMulti('znajdź dziś opony zimowe, kup mleko', { now, cats: DEFAULT_CATS });
  assert.deepEqual(a.map((x) => [x.kind, x.date]), [['task', '2026-10-21'], ['task', '2026-10-21']]);
  const b = parseMulti('kup dziś mleko, jutro znajdź opony zimowe a w przyszły poniedziałek umów się do fryzjera', { now, cats: DEFAULT_CATS });
  assert.deepEqual(b.map((x) => [x.kind, x.date]), [['task', '2026-10-21'], ['task', '2026-10-22'], ['task', '2026-10-26']]);
  assert.equal(parseMulti('kup chleb i mleko', { now, cats: DEFAULT_CATS }).length, 1);
});

test('głos: poprawianie słownikiem', async () => {
  const { fixVoice } = await import('../js/nlp.js');
  assert.equal(fixVoice('Szyłownia w piątek o 16.'), 'Siłownia w piątek o 16');
  assert.equal(fixVoice('Śniłownia jutro o 17'), 'Siłownia jutro o 17');
  assert.equal(fixVoice('wizyta u lekarzu 3 listopada o 17,30'), 'wizyta u lekarza 3 listopada o 17:30');
  assert.equal(fixVoice('Sniadanie z Olą'), 'Śniadanie z Olą');
  assert.equal(fixVoice('spotkanie z Anią'), 'spotkanie z Anią');
});
