// Powiadomienia: harmonogram alarmów, przypomnienia reguł, poranny brief, licznik na ikonie.
import { state, save, effectiveReminders } from './store.js';
import { instancesInRange } from './recur.js';
import { addDays, startOfDay, ymd, parseYmd, fmtTime, pad, relDay, DAYS_FULL, startOfWeek, fmtDayLong } from './util.js';

let handlers = { banner: () => {} };
export function setHandlers(h) { handlers = { ...handlers, ...h }; }

const hmToMin = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + (m || 0); };
const atTime = (day, hm) => { const [h, m] = hm.split(':').map(Number); return new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m); };

export function isStandalone() {
  return !!(navigator.standalone || window.matchMedia('(display-mode: standalone)').matches);
}
export const notifSupported = () => 'Notification' in window && 'serviceWorker' in navigator;
export const notifPermission = () => (notifSupported() ? Notification.permission : 'unsupported');

export async function enableNotifications() {
  if (!notifSupported()) return 'unsupported';
  const res = await Notification.requestPermission();
  return res;
}

function whenLabel(start, now) {
  return `${relDay(start, now)}, ${fmtTime(start)}`;
}

export function briefFor(kind, now = new Date()) {
  const events = state.events;
  const fmtList = (list, max = 3) => list.slice(0, max).map((i) => (i.allDay ? i.title : `${fmtTime(i.start)} ${i.title}`)).join(', ') + (list.length > max ? ` i ${list.length - max} więcej` : '');
  if (kind === 'weekly') {
    const mon = startOfWeek(addDays(startOfDay(now), 1), 1);
    const inst = instancesInRange(events, mon, addDays(mon, 7));
    const per = Array(7).fill(0);
    inst.forEach((i) => { per[(i.start.getDay() + 6) % 7]++; });
    const busiest = per.indexOf(Math.max(...per));
    const dayName = ['poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek', 'sobota', 'niedziela'][busiest];
    const tasks = state.tasks.filter((t) => !t.done && t.due && t.due >= ymd(mon) && t.due < ymd(addDays(mon, 7))).length;
    return { title: 'Przegląd tygodnia', body: inst.length ? `Przed Tobą ${inst.length} wydarzeń i ${tasks} zadań. Najgęstszy dzień: ${dayName}.` : 'Nadchodzący tydzień jest pusty. Dobry moment, żeby coś zaplanować.' };
  }
  const day = kind === 'evening' ? addDays(startOfDay(now), 1) : startOfDay(now);
  const inst = instancesInRange(events, day, addDays(day, 1)).filter((i) => i.end > now || kind === 'evening');
  const tasks = state.tasks.filter((t) => !t.done && t.due && t.due <= ymd(day));
  const label = kind === 'evening' ? 'Jutro' : 'Dziś';
  const head = inst.length ? `${label}: ${inst.length} ${inst.length === 1 ? 'wydarzenie' : inst.length < 5 ? 'wydarzenia' : 'wydarzeń'}` : `${label}: bez wydarzeń`;
  const body = [inst.length ? fmtList(inst) : '', tasks.length ? `Zadań do zrobienia: ${tasks.length}` : ''].filter(Boolean).join('. ');
  return { title: kind === 'evening' ? 'Podgląd jutra' : 'Dzień dobry', body: `${head}${body ? '. ' + body : ''}` };
}

// Zwraca alarmy z zakresu czasu [from, to].
export function computeAlarms(from, to) {
  const out = [];
  const maxLead = 8 * 86400000;
  const lo = new Date(from.getTime() - 86400000);
  const hi = new Date(to.getTime() + maxLead);
  const taskTime = state.settings.taskRemindTime || '09:00';

  for (const inst of instancesInRange(state.events, startOfDay(lo), hi)) {
    const { all } = effectiveReminders(inst.ev);
    for (const r of all) {
      const base = inst.allDay ? atTime(startOfDay(inst.start), taskTime) : inst.start;
      const at = new Date(base.getTime() - r * 60000);
      if (at < from || at > to) continue;
      const loc = inst.ev.loc ? `, ${inst.ev.loc}` : '';
      out.push({
        id: `e:${inst.key}:${r}`,
        at,
        kind: 'event',
        ref: inst.key,
        evId: inst.ev.id,
        title: inst.title,
        body: inst.allDay ? `${relDay(inst.start, at)}, całodniowe${loc}` : `${r === 0 ? 'Zaczyna się teraz' : whenLabel(inst.start, at)}${loc}`,
      });
    }
  }

  for (const t of state.tasks) {
    if (t.done || !t.due) continue;
    const at = atTime(parseYmd(t.due), t.dueTime || taskTime);
    if (at >= from && at <= to) out.push({ id: `t:${t.id}:${t.due}`, at, kind: 'task', ref: t.id, title: t.title, body: 'Zadanie na dziś' });
  }

  const s = state.settings;
  for (let d = startOfDay(lo); d <= to; d = addDays(d, 1)) {
    const push = (kind, hm, ok) => {
      if (!ok) return;
      const at = atTime(d, hm);
      if (at >= from && at <= to) out.push({ id: `b:${kind}:${ymd(d)}`, at, kind: 'brief', brief: kind, ref: kind, title: '', body: '' });
    };
    push('morning', s.morning.time, s.morning.on);
    push('evening', s.evening.time, s.evening.on);
    push('weekly', s.weekly.time, s.weekly.on && d.getDay() === s.weekly.day);
  }

  for (const sn of state.snoozes || []) {
    const at = new Date(sn.at);
    if (at >= from && at <= to) out.push({ ...sn, at });
  }
  return out.sort((a, b) => a.at - b.at);
}

async function showSystem(a) {
  try {
    if (Notification.permission !== 'granted') return false;
    const reg = await navigator.serviceWorker.ready;
    await reg.showNotification(a.title, {
      body: a.body,
      tag: a.id,
      icon: 'icons/icon-192.png',
      data: { url: `./?alarm=${encodeURIComponent(a.id)}`, evId: a.evId || null },
    });
    return true;
  } catch (e) {
    return false;
  }
}

export function deliver(a) {
  if (a.kind === 'brief') {
    const b = briefFor(a.brief);
    a.title = b.title;
    a.body = b.body;
  }
  if (document.visibilityState === 'visible') handlers.banner(a);
  else showSystem(a);
}

export function tick(now = new Date()) {
  if (!state.settings.notifyEnabled) return;
  const from = new Date(now.getTime() - 15 * 60000);
  const due = computeAlarms(from, now).filter((a) => !state.fired[a.id]);
  if (!due.length) return;
  // Gdy po powrocie do aplikacji czeka wiele zaległych alarmów, pokaż najnowsze (max 3).
  due.slice(-3).forEach((a) => deliver(a));
  due.forEach((a) => { state.fired[a.id] = Date.now(); });
  state.snoozes = (state.snoozes || []).filter((s) => !state.fired[s.id]);
  const cutoff = Date.now() - 3 * 86400000;
  for (const k of Object.keys(state.fired)) if (state.fired[k] < cutoff) delete state.fired[k];
  save(true);
}

export function snooze(a, minutes = 10) {
  const at = new Date(Date.now() + minutes * 60000);
  const copy = { ...a, id: `s:${a.id}:${at.getTime()}`, at: at.toISOString(), body: a.body };
  state.snoozes = [...(state.snoozes || []), copy];
  save(true);
}

// Licznik na ikonie aplikacji.
export function badgeCount(now = new Date()) {
  const mode = state.settings.badge;
  if (mode === 'off') return 0;
  const day = startOfDay(now);
  const inst = instancesInRange(state.events, day, addDays(day, 1)).filter((i) => i.allDay || i.end > now);
  let n = inst.length;
  if (mode === 'all') n += state.tasks.filter((t) => !t.done && t.due && t.due <= ymd(day)).length;
  return n;
}

export async function updateBadge(now = new Date()) {
  try {
    const n = badgeCount(now);
    if (n > 0 && navigator.setAppBadge) await navigator.setAppBadge(n);
    else if (navigator.clearAppBadge) await navigator.clearAppBadge();
  } catch (_) { /* brak wsparcia lub zgody */ }
}

export function testNotification() {
  const a = { id: 'test:' + Date.now(), title: 'Test powiadomienia', body: 'Tak będą wyglądać Twoje przypomnienia.', kind: 'test', ref: 'test' };
  if (Notification.permission === 'granted') return showSystem(a);
  return false;
}

export { fmtDayLong, DAYS_FULL, pad, hmToMin };
