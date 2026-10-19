// Szukanie wolnych terminów między wydarzeniami.
import { startOfDay, addDays } from './util.js';
import { instancesInRange } from './recur.js';

const toMin = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + (m || 0); };

// Wolne luki dnia (w minutach od północy) w oknie [lo, hi] po odjęciu zajętych przedziałów.
export function freeGaps(busy, lo, hi) {
  const gaps = [];
  let cur = lo;
  for (const [a, b] of [...busy].sort((x, y) => x[0] - y[0])) {
    if (b <= cur) continue;
    if (a > cur) gaps.push([cur, Math.min(a, hi)]);
    cur = Math.max(cur, b);
    if (cur >= hi) break;
  }
  if (cur < hi) gaps.push([cur, hi]);
  return gaps.filter(([a, b]) => b > a);
}

// Zwraca { start: Date, end: Date, gap: minuty } — pierwsze wolne okna o długości durMin (jedno na lukę).
export function findSlots(events, { now = new Date(), durMin = 60, days = 7, from = '09:00', to = '18:00', weekdaysOnly = false, count = 8, step = 15, buffer = 0 } = {}) {
  const out = [];
  const day0 = startOfDay(now);
  const insts = instancesInRange(events, day0, addDays(day0, days + 1)).filter((i) => !i.allDay);
  for (let k = 0; k < days && out.length < count; k++) {
    const d = addDays(day0, k);
    if (weekdaysOnly && (d.getDay() === 0 || d.getDay() === 6)) continue;
    const busy = insts
      .map((i) => [Math.round((i.start - d) / 60000) - buffer, Math.round((i.end - d) / 60000) + buffer])
      .filter(([a, b]) => b > 0 && a < 1440);
    let lo = toMin(from);
    if (k === 0) lo = Math.max(lo, now.getHours() * 60 + now.getMinutes() + 5);
    lo = Math.ceil(lo / step) * step;
    for (const [a, b] of freeGaps(busy, lo, toMin(to))) {
      const s = Math.ceil(a / step) * step;
      if (s + durMin > b) continue;
      out.push({ start: new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, s), end: new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, s + durMin), gap: b - a });
      if (out.length >= count) break;
    }
  }
  return out;
}
