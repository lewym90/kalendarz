// Pamięć preferencji: fakty policzone z historii oraz zasady powiedziane wprost. Wszystko widać i można wyłączyć.
import { state, save } from './store.js';
import { instancesInRange } from './recur.js';
import { addDays, startOfDay, uid, DAYS_SHORT, fmtDuration, pad } from './util.js';

const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const hm = (m) => `${pad(Math.floor(m / 60))}:${pad(Math.round(m % 60 / 15) * 15 % 60)}`;

export function learned(now = new Date()) {
  const from = addDays(startOfDay(now), -90);
  const insts = instancesInRange(state.events, from, addDays(startOfDay(now), 1)).filter((i) => !i.allDay);
  const out = [];
  const byCat = (id) => insts.filter((i) => i.ev.cat === id);
  const typical = (list, label, key) => {
    if (list.length < 4) return;
    const days = new Map();
    for (const i of list) days.set(i.start.getDay(), (days.get(i.start.getDay()) || 0) + 1);
    const top = [...days.entries()].filter(([, n]) => n >= Math.max(2, list.length * 0.18)).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([d]) => DAYS_SHORT[d]);
    const st = median(list.map((i) => i.start.getHours() * 60 + i.start.getMinutes()));
    out.push({ id: key, text: `${label}: zwykle ${top.length ? top.join(', ') + ', ' : ''}około ${hm(st)}` });
  };
  typical(byCat('sport'), 'Treningi', 'l-sport');
  const work = byCat('praca');
  if (work.length >= 4) {
    const s = median(work.map((i) => i.start.getHours() * 60 + i.start.getMinutes()));
    const e = median(work.map((i) => i.end.getHours() * 60 + i.end.getMinutes()));
    out.push({ id: 'l-praca', text: `Praca: zwykle ${hm(s)}–${hm(e)}` });
  }
  for (const h of Object.values(state.history).filter((x) => x.n >= 3 && x.dur).sort((a, b) => b.n - a.n).slice(0, 5)) {
    out.push({ id: `l-t-${h.title.toLowerCase()}`, text: `${h.title}: zwykle ${fmtDuration(h.dur)}${h.tm ? `, około ${h.tm}` : ''}` });
  }
  return out;
}
export const activePrefs = (now = new Date()) => [...learned(now).filter((x) => !state.prefsOff?.includes(x.id)), ...(state.prefs || []).map((x) => ({ id: x.id, text: x.text }))];
export function addPref(text) {
  const t = String(text || '').trim().slice(0, 160);
  if (!t) return;
  state.prefs = [...(state.prefs || []), { id: uid(), text: t }];
  save();
}
export function removePref(id) { state.prefs = (state.prefs || []).filter((x) => x.id !== id); save(); }
export function toggleLearned(id) {
  const off = new Set(state.prefsOff || []);
  if (off.has(id)) off.delete(id); else off.add(id);
  state.prefsOff = [...off];
  save();
}
