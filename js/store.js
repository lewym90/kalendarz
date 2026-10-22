// Stan aplikacji, zapis lokalny, kopie zapasowe, reguły i przykładowe dane.
import { uid, ymd, addDays, startOfDay, fmtDT, parseDT, parseYmd, fmtTime, pad } from './util.js';

const KEY = 'kalendarz.v1';

export const DEFAULT_CATS = [
  { id: 'praca', name: 'Praca', color: '#7C9BFF' },
  { id: 'dom', name: 'Dom', color: '#4FD1B0' },
  { id: 'sport', name: 'Sport', color: '#FF8A5B' },
  { id: 'zdrowie', name: 'Zdrowie', color: '#FF6B8B' },
  { id: 'rodzina', name: 'Rodzina', color: '#C58BFF' },
  { id: 'finanse', name: 'Finanse', color: '#F2C14E' },
  { id: 'nauka', name: 'Nauka', color: '#5AC8FA' },
  { id: 'inne', name: 'Inne', color: '#9AA3B8' },
];

export const CAT_PALETTE = ['#7C9BFF', '#4FD1B0', '#FF8A5B', '#FF6B8B', '#C58BFF', '#F2C14E', '#5AC8FA', '#9AA3B8', '#8BE05A', '#FF5E5E'];

export const DEFAULT_RULES = [
  { id: 'r-praca', name: 'Praca: przypomnij pół godziny wcześniej', on: true, when: { cat: 'praca' }, then: { remind: [30] } },
  { id: 'r-loc', name: 'Wydarzenie z miejscem: przypomnij godzinę wcześniej', on: true, when: { hasLoc: true }, then: { remind: [60] } },
  { id: 'r-zdrowie', name: 'Zdrowie: przypomnij dzień wcześniej', on: true, when: { cat: 'zdrowie' }, then: { remind: [1440] } },
  { id: 'r-urodziny', name: 'Urodziny: wpisz do kategorii Rodzina', on: true, when: { text: 'urodziny' }, then: { setCat: 'rodzina' } },
];

const DEFAULT_SETTINGS = {
  theme: 'auto',
  accent: 'zorza',
  weekStart: 1,
  defaultRemind: [10],
  badge: 'all', // off | events | all
  rollover: true,
  notifyEnabled: true,
  morning: { on: true, time: '07:30' },
  evening: { on: false, time: '20:30' },
  weekly: { on: true, day: 0, time: '18:00' },
  taskRemindTime: '09:00',
  dayStart: '07:00',
  dayEnd: '23:00',
  city: { name: 'Warszawa', lat: 52.2297, lon: 21.0122 },
  skin: 'dusk',
  accentCustom: '',
  welcomed: false,
  autoLoc: true,
  voiceHq: true,
  share: { on: true, view: false, name: '', color: '#34d3ff' },
};

function fresh() {
  return {
    v: 1,
    events: [],
    tasks: [],
    cats: structuredClone(DEFAULT_CATS),
    rules: structuredClone(DEFAULT_RULES),
    settings: structuredClone(DEFAULT_SETTINGS),
    fired: {},
    snoozes: [],
    history: {},
    lastRollover: '',
  };
}

function load() {
  const base = fresh();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return base;
    const data = JSON.parse(raw);
    return {
      ...base,
      ...data,
      settings: { ...base.settings, ...(data.settings || {}) },
    };
  } catch (e) {
    console.warn('Nie udało się wczytać danych', e);
    return base;
  }
}

export const state = load();
const listeners = new Set();
let saveTimer;

export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function save(silent = false) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) {
      console.warn('Zapis nieudany', e);
    }
  }, 120);
  if (!silent) listeners.forEach((fn) => fn());
}

export function flushSave() {
  clearTimeout(saveTimer);
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (_) { /* brak miejsca */ }
}

// Cofanie ostatniej zmiany (zdarzenia + zadania).
let undoSnapshot = null;
let batching = false;
export function batch(fn) {
  snapshot();
  batching = true;
  try { return fn(); } finally { batching = false; }
}
export function snapshot() {
  if (batching) return;
  undoSnapshot = JSON.stringify({ events: state.events, tasks: state.tasks });
}
export function undo() {
  if (!undoSnapshot) return false;
  const s = JSON.parse(undoSnapshot);
  state.events = s.events;
  state.tasks = s.tasks;
  undoSnapshot = null;
  save();
  return true;
}

export const catOf = (id) => state.cats.find((c) => c.id === id) || state.cats.find((c) => c.id === 'inne') || state.cats[state.cats.length - 1];

// ---------- Wydarzenia ----------
export function newEvent(partial = {}) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours() + 1, 0);
  return {
    id: uid(),
    title: '',
    start: fmtDT(start),
    end: fmtDT(new Date(start.getTime() + 3600000)),
    allDay: false,
    cat: 'inne',
    loc: '',
    notes: '',
    rrule: null, // {freq, interval, byday, until}
    reminders: [...state.settings.defaultRemind],
    exdates: [],
    private: false,
    ...partial,
  };
}

export function addEvent(ev) {
  snapshot();
  applyCreationRules(ev);
  state.events.push(ev);
  bumpHistory(ev.title, ev);
  save();
  return ev;
}

export function updateEvent(id, patch) {
  snapshot();
  const i = state.events.findIndex((e) => e.id === id);
  if (i < 0) return null;
  state.events[i] = { ...state.events[i], ...patch };
  save();
  return state.events[i];
}

export function deleteEvent(id) {
  snapshot();
  state.events = state.events.filter((e) => e.id !== id);
  save();
}

export function deleteOccurrence(id, dateStr) {
  snapshot();
  const ev = state.events.find((e) => e.id === id);
  if (!ev) return;
  ev.exdates = [...(ev.exdates || []), dateStr];
  save();
}

// Przesunięcie pojedynczego wystąpienia serii: seria dostaje wyjątek, a wystąpienie staje się osobnym wydarzeniem.
export function detachOccurrence(inst, patch) {
  snapshot();
  const ev = state.events.find((e) => e.id === inst.ev.id);
  if (!ev) return null;
  ev.exdates = [...(ev.exdates || []), inst.date];
  const copy = { ...structuredClone(ev), id: uid(), rrule: null, exdates: [], start: fmtDT(inst.start), end: fmtDT(inst.end), ...patch };
  state.events.push(copy);
  save();
  return copy;
}

// „Ten i kolejne”: seria kończy się dzień przed wystąpieniem, a od niego zaczyna się nowa.
export function splitSeries(inst, patch) {
  snapshot();
  const ev = state.events.find((e) => e.id === inst.ev.id);
  if (!ev) return null;
  const first = ymd(parseDT(ev.start)) === inst.date;
  if (first) { Object.assign(ev, patch); save(); return ev; }
  const prev = ymd(addDays(parseYmd(inst.date), -1));
  const copy = { ...structuredClone(ev), id: uid(), exdates: (ev.exdates || []).filter((x) => x >= inst.date), ...patch };
  ev.rrule = { ...ev.rrule, until: prev };
  ev.exdates = (ev.exdates || []).filter((x) => x <= prev);
  state.events.push(copy);
  save();
  return copy;
}

export function deleteFollowing(inst) {
  snapshot();
  const ev = state.events.find((e) => e.id === inst.ev.id);
  if (!ev) return;
  if (ymd(parseDT(ev.start)) === inst.date) state.events = state.events.filter((e) => e.id !== ev.id);
  else ev.rrule = { ...ev.rrule, until: ymd(addDays(parseYmd(inst.date), -1)) };
  save();
}

function bumpHistory(title, ev) {
  const key = (title || '').trim().toLowerCase();
  if (!key) return;
  const h = state.history[key] || { title: title.trim(), n: 0, cat: ev.cat, loc: ev.loc, dur: 60 };
  h.n += 1;
  h.cat = ev.cat;
  h.loc = ev.loc;
  h.last = Date.now();
  if (!ev.allDay) {
    h.dur = Math.max(5, Math.round((parseDT(ev.end) - parseDT(ev.start)) / 60000));
    const st = parseDT(ev.start);
    h.tm = `${pad(st.getHours())}:${pad(st.getMinutes())}`;
  }
  state.history[key] = h;
}

export function topHistory(limit = 6) {
  return Object.values(state.history)
    .sort((a, b) => b.n - a.n || (b.last || 0) - (a.last || 0))
    .slice(0, limit);
}

// ---------- Zadania ----------
export function newTask(partial = {}) {
  return { id: uid(), title: '', due: null, done: false, cat: 'inne', prio: 0, created: Date.now(), rolled: 0, ...partial };
}
export function addTask(t) {
  snapshot();
  state.tasks.push(t);
  save();
  return t;
}
export function updateTask(id, patch) {
  const t = state.tasks.find((x) => x.id === id);
  if (!t) return;
  snapshot();
  Object.assign(t, patch);
  save();
}
export function toggleTask(id) {
  const t = state.tasks.find((x) => x.id === id);
  if (!t) return;
  snapshot();
  t.done = !t.done;
  t.doneAt = t.done ? Date.now() : null;
  save();
  return t.done;
}
export function deleteTask(id) {
  snapshot();
  state.tasks = state.tasks.filter((t) => t.id !== id);
  save();
}

// Zaległe zadania same przenoszą się na dziś (raz dziennie).
export function rolloverTasks(now = new Date()) {
  if (!state.settings.rollover) return 0;
  const today = ymd(now);
  if (state.lastRollover === today) return 0;
  let n = 0;
  for (const t of state.tasks) {
    if (!t.done && t.due && t.due < today) {
      t.due = today;
      t.rolled = (t.rolled || 0) + 1;
      n++;
    }
  }
  state.lastRollover = today;
  save(true);
  return n;
}

// ---------- Reguły (jeśli → to) ----------
const norm = (s) => (s || '').toLowerCase().replace(/[ąćęłńóśźż]/g, (c) => ({ ą: 'a', ć: 'c', ę: 'e', ł: 'l', ń: 'n', ó: 'o', ś: 's', ź: 'z', ż: 'z' }[c]));

export function ruleMatches(rule, ev) {
  const w = rule.when || {};
  if (w.cat && ev.cat !== w.cat) return false;
  if (w.hasLoc === true && !(ev.loc || '').trim()) return false;
  if (w.allDay === true && !ev.allDay) return false;
  if (w.recurring === true && !ev.rrule) return false;
  if (w.text && !norm(ev.title).includes(norm(w.text))) return false;
  return true;
}

// Akcje „ustaw kategorię" działają w chwili zapisu; przypomnienia liczą się na bieżąco.
export function applyCreationRules(ev) {
  for (const r of state.rules) {
    if (!r.on || !r.then?.setCat) continue;
    const w = { ...r.when };
    if (!w.text) continue; // setCat tylko dla reguł tekstowych, żeby nie nadpisywać ręcznego wyboru
    if (ev.cat === 'inne' && ruleMatches(r, ev) && state.cats.some((c) => c.id === r.then.setCat)) ev.cat = r.then.setCat;
  }
}

export function effectiveReminders(ev) {
  const set = new Set(ev.reminders || []);
  const via = [];
  for (const r of state.rules) {
    if (!r.on || !r.then?.remind) continue;
    if (ruleMatches(r, ev)) r.then.remind.forEach((m) => { if (!set.has(m)) via.push(m); set.add(m); });
  }
  return { all: [...set].sort((a, b) => a - b), viaRules: via };
}

export function describeRule(r) {
  const w = r.when || {};
  const parts = [];
  if (w.cat) parts.push(`kategoria „${state.cats.find((c) => c.id === w.cat)?.name || w.cat}"`);
  if (w.hasLoc) parts.push('ma miejsce');
  if (w.allDay) parts.push('całodniowe');
  if (w.recurring) parts.push('cykliczne');
  if (w.text) parts.push(`tytuł zawiera „${w.text}"`);
  return parts.join(' i ') || 'każde wydarzenie';
}

// ---------- Kopie ----------
export function exportData() {
  return JSON.stringify({ app: 'kalendarz', exportedAt: new Date().toISOString(), data: state }, null, 2);
}

export function importData(text) {
  const parsed = JSON.parse(text);
  const d = parsed.data || parsed;
  if (!d || !Array.isArray(d.events)) throw new Error('To nie wygląda na kopię kalendarza.');
  snapshot();
  const base = fresh();
  Object.assign(state, base, d, { settings: { ...base.settings, ...(d.settings || {}), share: { ...base.settings.share, ...((d.settings || {}).share || {}) } } });
  save();
}

export function wipeAll() {
  Object.assign(state, fresh());
  save();
}

// ---------- Przykładowe dane ----------
export function loadSample(now = new Date()) {
  const day = (n, h, m = 0, dur = 60, extra = {}) => {
    const s = new Date(now.getFullYear(), now.getMonth(), now.getDate() + n, h, m);
    return newEvent({ start: fmtDT(s), end: fmtDT(new Date(s.getTime() + dur * 60000)), ...extra });
  };
  const allDay = (n, extra = {}) => {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + n);
    return newEvent({ start: `${ymd(d)}T00:00`, end: `${ymd(d)}T23:59`, allDay: true, reminders: [], ...extra });
  };
  const evs = [
    day(0, 8, 0, 45, { title: 'Poranny trening', cat: 'sport', loc: 'Klub Pulse', rrule: { freq: 'weekly', interval: 1, byday: [1, 3, 5] } }),
    day(0, 10, 0, 60, { title: 'Stand-up zespołu', cat: 'praca', rrule: { freq: 'weekly', interval: 1, byday: [1, 2, 3, 4, 5] }, reminders: [5] }),
    day(0, 12, 30, 60, { title: 'Lunch z Anią', cat: 'rodzina', loc: 'Bistro Nowy Świat' }),
    day(0, 15, 0, 90, { title: 'Prezentacja dla klienta', cat: 'praca', loc: 'Biuro, sala 4', notes: 'Wydrukować ofertę, zabrać adapter.' }),
    day(0, 15, 30, 30, { title: 'Call z księgową', cat: 'finanse' }),
    day(0, 19, 0, 60, { title: 'Angielski online', cat: 'nauka', rrule: { freq: 'weekly', interval: 1, byday: [1, 4] } }),
    day(1, 9, 30, 45, { title: 'Dentysta', cat: 'zdrowie', loc: 'Dent-Art, Mokotów' }),
    day(1, 18, 0, 90, { title: 'Kolacja u rodziców', cat: 'rodzina' }),
    day(2, 14, 0, 60, { title: 'Przegląd samochodu', cat: 'dom', loc: 'Serwis Auto-Plus' }),
    day(3, 11, 0, 60, { title: '1:1 z szefem', cat: 'praca', rrule: { freq: 'weekly', interval: 2, byday: [4] } }),
    allDay(4, { title: 'Urodziny Marka', cat: 'rodzina', reminders: [1440, 0] }),
    day(5, 10, 0, 120, { title: 'Zakupy i porządki', cat: 'dom' }),
    allDay(8, { title: 'Termin: rata kredytu', cat: 'finanse', reminders: [1440] }),
    day(-1, 17, 0, 60, { title: 'Siłownia', cat: 'sport' }),
  ];
  evs.forEach((e) => { state.events.push(e); bumpHistory(e.title, e); });
  const t = (title, off, extra = {}) => newTask({ title, due: off == null ? null : ymd(addDays(startOfDay(now), off)), ...extra });
  state.tasks.push(
    t('Wysłać fakturę do klienta', 0, { cat: 'finanse', prio: 2 }),
    t('Kupić prezent dla Marka', 2, { cat: 'rodzina', prio: 1 }),
    t('Zamówić bilety na weekend', 0, { cat: 'dom' }),
    t('Odpisać na maile', -1, { cat: 'praca', rolled: 1 }),
    t('Umówić przegląd rowerów', null, { cat: 'sport' }),
    t('Przeczytać raport kwartalny', 3, { cat: 'praca' }),
  );
  state.settings.welcomed = true;
  save();
}

export function icsExport() {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Kalendarz//PL'];
  const f = (s) => s.replace(/[-:]/g, '') + '00';
  for (const e of state.events) {
    lines.push('BEGIN:VEVENT', `UID:${e.id}@kalendarz`, `SUMMARY:${e.title.replace(/[,;\n]/g, ' ')}`);
    if (e.allDay) lines.push(`DTSTART;VALUE=DATE:${e.start.slice(0, 10).replace(/-/g, '')}`);
    else lines.push(`DTSTART:${f(e.start)}`, `DTEND:${f(e.end)}`);
    if (e.loc) lines.push(`LOCATION:${e.loc.replace(/[,;\n]/g, ' ')}`);
    if (e.rrule) {
      const days = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
      const fr = { daily: 'DAILY', weekly: 'WEEKLY', monthly: 'MONTHLY', yearly: 'YEARLY' }[e.rrule.freq];
      let r = `RRULE:FREQ=${fr};INTERVAL=${e.rrule.interval || 1}`;
      if (e.rrule.freq === 'weekly' && e.rrule.byday?.length) r += `;BYDAY=${e.rrule.byday.map((d) => days[d]).join(',')}`;
      if (e.rrule.until) r += `;UNTIL=${e.rrule.until.replace(/-/g, '')}T235959`;
      lines.push(r);
    }
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

export { parseYmd, fmtTime };
