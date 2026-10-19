import test from 'node:test';
import assert from 'node:assert/strict';
import { instancesInRange } from '../js/recur.js';
import { easter, dayInfo, nameDays, isoWeek, sunTimes } from '../js/extras.js';
import { parseICS } from '../js/ics.js';
import { findSlots, freeGaps } from '../js/planner.js';

const D = (y, m, d, h = 0, mi = 0) => new Date(y, m - 1, d, h, mi);

test('cykliczne co tydzień z wyjątkiem i końcem', () => {
  const ev = { id: 'a', title: 'x', start: '2026-10-05T10:00', end: '2026-10-05T11:00', rrule: { freq: 'weekly', interval: 1, byday: [1], until: '2026-10-26' }, exdates: ['2026-10-12'] };
  const l = instancesInRange([ev], D(2026, 10, 1), D(2026, 11, 30));
  assert.deepEqual(l.map((i) => i.date), ['2026-10-05', '2026-10-19', '2026-10-26']);
});
test('urodziny: wiek w tytule', () => {
  const ev = { id: 'b', title: 'Ola', start: '2020-03-12T00:00', end: '2020-03-12T23:59', allDay: true, bday: true, byear: 1990, rrule: { freq: 'yearly', interval: 1 } };
  const l = instancesInRange([ev], D(2027, 3, 1), D(2027, 3, 31));
  assert.equal(l.length, 1); assert.equal(l[0].title, 'Ola (37)');
});
test('Wielkanoc i święta ruchome', () => {
  assert.equal(easter(2026).getMonth(), 3); assert.equal(easter(2026).getDate(), 5);
  assert.equal(easter(2027).getDate(), 28);
  assert.equal(dayInfo(D(2026, 6, 4)).name, 'Boże Ciało');
  assert.equal(dayInfo(D(2026, 5, 24)).name, 'Zielone Świątki');
  assert.equal(dayInfo(D(2026, 12, 24)).off, true);
  assert.equal(dayInfo(D(2024, 12, 24)).off, false);
  assert.equal(dayInfo(D(2026, 10, 19)), null);
});
test('imieniny i numer tygodnia ISO', () => {
  assert.ok(nameDays(D(2026, 1, 1)).includes('Mieczysław'));
  assert.equal(isoWeek(D(2026, 10, 19)), 43); assert.equal(isoWeek(D(2026, 1, 1)), 1); assert.equal(isoWeek(D(2024, 12, 30)), 1); assert.equal(isoWeek(D(2021, 1, 3)), 53);
});
test('wschód i zachód słońca w Warszawie', () => {
  const s = sunTimes(D(2026, 6, 21), 52.2297, 21.0122);
  const h = (d) => d.getUTCHours() + d.getUTCMinutes() / 60;
  assert.ok(h(s.rise) > 2.0 && h(s.rise) < 2.6, `wschód UTC ${h(s.rise)}`); // ok. 4:15 czasu letniego
  assert.ok(h(s.set) > 18.7 && h(s.set) < 19.3, `zachód UTC ${h(s.set)}`);
});
test('import .ics: powtarzanie z COUNT, alarm, wydarzenie całodniowe', () => {
  const ics = `BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:1\r\nSUMMARY:Plan\\, Q4\r\nDTSTART:20261021T080000Z\r\nDTEND:20261021T093000Z\r\nRRULE:FREQ=WEEKLY;COUNT=3;BYDAY=WE\r\nBEGIN:VALARM\r\nTRIGGER:-PT15M\r\nEND:VALARM\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:2\r\nSUMMARY:Urlop\r\nDTSTART;VALUE=DATE:20261101\r\nDTEND;VALUE=DATE:20261104\r\nEND:VEVENT\r\nEND:VCALENDAR`;
  const [a, b] = parseICS(ics);
  assert.equal(a.title, 'Plan, Q4'); assert.deepEqual(a.reminders, [15]); assert.equal(a.rrule.until, '2026-11-04'); assert.deepEqual(a.rrule.byday, [3]);
  assert.equal(b.allDay, true); assert.equal(b.end, '2026-11-03T23:59');
});
test('wolne luki i sloty', () => {
  assert.deepEqual(freeGaps([[600, 660], [720, 780]], 540, 1080), [[540, 600], [660, 720], [780, 1080]]);
  const ev = { id: 'c', title: 'x', start: '2026-10-20T09:00', end: '2026-10-20T12:00' };
  const slots = findSlots([ev], { now: D(2026, 10, 19, 18, 0), durMin: 60, days: 3, from: '09:00', to: '13:00', count: 3 });
  assert.equal(slots[0].start.getDate(), 20); assert.equal(slots[0].start.getHours(), 12);
});
