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
