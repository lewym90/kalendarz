import './setup.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
const { state, newEvent, addEvent, splitSeries, deleteFollowing, undo, batch, deleteOccurrence } = await import('../js/store.js');
const { instancesInRange } = await import('../js/recur.js');
const D = (y, m, d) => new Date(y, m - 1, d);
const mk = () => {
  state.events = [];
  const ev = newEvent({ title: 'Seria', start: '2026-10-05T10:00', end: '2026-10-05T11:00', rrule: { freq: 'weekly', interval: 1, byday: [1], until: null }, reminders: [] });
  state.events.push(ev);
  return ev;
};
test('„ten i kolejne” dzieli serię', () => {
  const ev = mk();
  const inst = instancesInRange(state.events, D(2026, 10, 19), D(2026, 10, 20))[0];
  splitSeries(inst, { title: 'Nowa', start: '2026-10-19T12:00', end: '2026-10-19T13:00', rrule: { freq: 'weekly', interval: 1, byday: [1], until: null } });
  assert.equal(state.events.length, 2);
  assert.equal(ev.rrule.until, '2026-10-18');
  const l = instancesInRange(state.events, D(2026, 10, 1), D(2026, 11, 10));
  assert.deepEqual(l.map((i) => [i.title, i.date, i.start.getHours()]), [['Seria', '2026-10-05', 10], ['Seria', '2026-10-12', 10], ['Nowa', '2026-10-19', 12], ['Nowa', '2026-10-26', 12], ['Nowa', '2026-11-02', 12], ['Nowa', '2026-11-09', 12]]);
});
test('usuń ten i kolejne', () => {
  const ev = mk();
  const inst = instancesInRange(state.events, D(2026, 10, 19), D(2026, 10, 20))[0];
  deleteFollowing(inst);
  assert.equal(ev.rrule.until, '2026-10-18');
  assert.equal(instancesInRange(state.events, D(2026, 10, 1), D(2026, 12, 1)).length, 2);
});
test('usuń tylko jeden dzień', () => {
  const ev = mk();
  deleteOccurrence(ev.id, '2026-10-12');
  assert.equal(instancesInRange(state.events, D(2026, 10, 5), D(2026, 10, 20)).length, 2);
});
test('batch to jedno cofnięcie', () => {
  state.events = [];
  batch(() => { addEvent(newEvent({ title: 'A' })); addEvent(newEvent({ title: 'B' })); });
  assert.equal(state.events.length, 2);
  undo();
  assert.equal(state.events.length, 0);
});
