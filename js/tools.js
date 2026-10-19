// Narzędzia: znajdź wolny termin, statystyki, import .ics.
import { esc, ymd, startOfDay, startOfWeek, addDays, fmtTime, fmtDuration, relDay, DAYS_FULL, MONTHS_GEN, ICON, haptic } from './util.js';
import { state, catOf, addEvent, newEvent, batch, applyCreationRules } from './store.js';
import { instancesInRange } from './recur.js';
import { findSlots } from './planner.js';
import { parseICS } from './ics.js';
import { openSheet, closeSheet, toast, rerender, nav } from './ui.js';
import { openEventEditor } from './editors.js';

// ---------- Znajdź wolny termin ----------
export function openFindSlot({ title = '' } = {}) {
  const o = { durMin: 60, days: 7, win: 'day', weekdays: false };
  const WIN = { morning: ['08:00', '12:00', 'Rano'], day: ['09:00', '18:00', 'Dzień'], evening: ['17:00', '21:00', 'Wieczór'], custom: [state.settings.dayStart, state.settings.dayEnd, 'Cały dzień'] };
  const chip = (on, attr, label) => `<button type="button" class="chip ${on ? 'on' : ''}" ${attr}>${label}</button>`;
  const body = () => {
    const [from, to] = WIN[o.win];
    const slots = findSlots(state.events, { durMin: o.durMin, days: o.days, from, to, weekdaysOnly: o.weekdays, count: 8 });
    return `
      <div class="lbl">Jak długo</div>
      <div class="chips">${[[30, '30 min'], [60, '1 godz.'], [90, '1,5 godz.'], [120, '2 godz.'], [180, '3 godz.']].map(([m, l]) => chip(o.durMin === m, `data-dur="${m}"`, l)).join('')}</div>
      <div class="lbl">Pora dnia</div>
      <div class="chips">${Object.entries(WIN).map(([k, v]) => chip(o.win === k, `data-win="${k}"`, `${v[2]}`)).join('')}</div>
      <div class="lbl">Zakres</div>
      <div class="chips">${chip(o.days === 7, 'data-days="7"', '7 dni')}${chip(o.days === 14, 'data-days="14"', '14 dni')}${chip(o.weekdays, 'data-wk="1"', 'Tylko dni robocze')}</div>
      <div class="lbl">Pierwsze wolne okna</div>
      <div class="list">${slots.length ? slots.map((s, i) => `<button type="button" class="row" data-slot="${i}"><span class="ico">${ICON.clock}</span><span class="rt"><b>${esc(relDay(s.start))}, ${fmtTime(s.start)}–${fmtTime(s.end)}</b><small>${DAYS_FULL[s.start.getDay()]} ${s.start.getDate()} ${MONTHS_GEN[s.start.getMonth()]}${s.gap >= o.durMin + 30 ? `, luka ${fmtDuration(s.gap)}` : ''}</small></span><span class="val">Wybierz</span></button>`).join('') : '<div class="empty" style="padding:16px">Brak wolnych okien w tym zakresie. Spróbuj krótszego czasu albo szerszej pory dnia.</div>'}</div>`;
  };
  const h = openSheet(`
    <div class="grab"><i></i></div>
    <div class="sheet-h"><h3>Znajdź wolny termin</h3><button type="button" class="round" data-x="close" aria-label="Zamknij"><span class="ico">${ICON.close}</span></button></div>
    <div class="sheet-b" id="fs-body">${body()}</div>`);
  const bodyEl = h.el.querySelector('#fs-body');
  h.el.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.x === 'close') return closeSheet(h);
    if (t.dataset.dur) o.durMin = +t.dataset.dur;
    else if (t.dataset.win) o.win = t.dataset.win;
    else if (t.dataset.days) o.days = +t.dataset.days;
    else if (t.dataset.wk) o.weekdays = !o.weekdays;
    else if (t.dataset.slot != null) {
      const [from, to] = WIN[o.win];
      const s = findSlots(state.events, { durMin: o.durMin, days: o.days, from, to, weekdaysOnly: o.weekdays, count: 8 })[+t.dataset.slot];
      if (s) {
        haptic();
        closeSheet(h);
        setTimeout(() => openEventEditor({ draft: { title, start: `${ymd(s.start)}T${fmtTime(s.start)}`, end: `${ymd(s.end)}T${fmtTime(s.end)}` } }), 220);
      }
      return;
    } else return;
    const top = bodyEl.scrollTop;
    bodyEl.innerHTML = body();
    bodyEl.scrollTop = top;
  });
  return h;
}

// ---------- Statystyki ----------
function periodRange(kind, offset, ws) {
  const now = new Date();
  if (kind === 'month') {
    const a = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    return [a, new Date(a.getFullYear(), a.getMonth() + 1, 1)];
  }
  const a = addDays(startOfWeek(now, ws), offset * 7);
  return [a, addDays(a, 7)];
}

export function statsFor(from, to) {
  const insts = instancesInRange(state.events, from, to).filter((i) => !i.allDay);
  const byCat = new Map();
  let total = 0;
  const perDay = new Map();
  for (const i of insts) {
    const s = Math.max(i.start, from);
    const e = Math.min(i.end, to);
    const m = Math.max(0, (e - s) / 60000);
    total += m;
    byCat.set(i.ev.cat, (byCat.get(i.ev.cat) || 0) + m);
    const k = ymd(i.start);
    perDay.set(k, (perDay.get(k) || 0) + m);
  }
  const doneTasks = state.tasks.filter((t) => t.done && t.doneAt >= from.getTime() && t.doneAt < to.getTime()).length;
  let busiest = null;
  for (const [k, v] of perDay) if (!busiest || v > busiest[1]) busiest = [k, v];
  return { count: insts.length, total, byCat, doneTasks, busiest, days: Math.round((to - from) / 86400000) };
}

const delta = (cur, prev, unit = 'h') => {
  if (!prev && !cur) return '';
  const d = cur - prev;
  if (Math.abs(d) < 6) return `<span class="dl same">bez zmian</span>`;
  const txt = unit === 'h' ? fmtDuration(Math.abs(d)) : `${Math.abs(d)}`;
  return `<span class="dl ${d > 0 ? 'up' : 'down'}">${d > 0 ? '▲' : '▼'} ${txt}</span>`;
};

export function openStats() {
  let kind = 'week';
  const body = () => {
    const ws = state.settings.weekStart;
    const [a, b] = periodRange(kind, 0, ws);
    const [pa, pb] = periodRange(kind, -1, ws);
    const cur = statsFor(a, b);
    const prev = statsFor(pa, pb);
    const cats = [...cur.byCat.entries()].sort((x, y) => y[1] - x[1]);
    const max = Math.max(1, ...cats.map(([, v]) => v), ...[...prev.byCat.values()]);
    const rows = cats.map(([id, m]) => {
      const c = catOf(id);
      const pm = prev.byCat.get(id) || 0;
      return `<div class="st-row"><div class="st-h"><span class="catdot-s" style="--c:${c.color}"></span><b>${esc(c.name)}</b><span class="st-v">${fmtDuration(m)} ${delta(m, pm)}</span></div><div class="st-bar"><i style="width:${Math.max(3, (m / max) * 100)}%;--c:${c.color}"></i><u style="left:${(pm / max) * 100}%"></u></div></div>`;
    }).join('');
    const label = kind === 'week' ? 'ten tydzień' : 'ten miesiąc';
    const prevLabel = kind === 'week' ? 'zeszłego tygodnia' : 'zeszłego miesiąca';
    const free = Math.max(0, cur.days * 16 * 60 - cur.total);
    return `
      <div class="seg" style="margin-bottom:14px"><button type="button" class="${kind === 'week' ? 'on' : ''}" data-k="week">Tydzień</button><button type="button" class="${kind === 'month' ? 'on' : ''}" data-k="month">Miesiąc</button></div>
      <div class="st-grid">
        <div class="st-card"><small>Czas w kalendarzu</small><b>${fmtDuration(cur.total) || '0 min'}</b>${delta(cur.total, prev.total)}</div>
        <div class="st-card"><small>Wydarzenia</small><b>${cur.count}</b>${delta(cur.count, prev.count, 'n')}</div>
        <div class="st-card"><small>Zrobione zadania</small><b>${cur.doneTasks}</b>${delta(cur.doneTasks, prev.doneTasks, 'n')}</div>
        <div class="st-card"><small>Najgęstszy dzień</small><b class="cap">${cur.busiest ? DAYS_FULL[new Date(cur.busiest[0] + 'T00:00').getDay()] : '–'}</b><span class="dl same">${cur.busiest ? fmtDuration(cur.busiest[1]) : ''}</span></div>
      </div>
      <div class="lbl">Czas wg kategorii, ${label}</div>
      ${rows || '<div class="empty" style="padding:14px 0">Brak wydarzeń z godzinami w tym okresie.</div>'}
      <p class="note" style="padding:10px 2px 0">Kreska na pasku to wynik ${prevLabel}. Wolnego czasu w dniach 8–24 zostaje ok. ${fmtDuration(free)}.</p>`;
  };
  const h = openSheet(`
    <div class="grab"><i></i></div>
    <div class="sheet-h"><h3>Statystyki</h3><button type="button" class="round" data-x="close" aria-label="Zamknij"><span class="ico">${ICON.close}</span></button></div>
    <div class="sheet-b" id="st-body">${body()}</div>`);
  const el = h.el.querySelector('#st-body');
  h.el.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.x === 'close') return closeSheet(h);
    if (t.dataset.k) { kind = t.dataset.k; el.innerHTML = body(); haptic(); }
  });
  return h;
}

// ---------- Import .ics ----------
export function importICS(text) {
  const list = parseICS(text);
  if (!list.length) throw new Error('W pliku nie znalazłem żadnych wydarzeń.');
  const have = new Set(state.events.map((e) => e.uid).filter(Boolean));
  let added = 0;
  let skipped = 0;
  batch(() => {
    for (const x of list) {
      if (x.uid && have.has(x.uid)) { skipped++; continue; }
      const ev = newEvent({ title: x.title, start: x.start, end: x.end, allDay: x.allDay, loc: x.loc, notes: x.notes, rrule: x.rrule, exdates: x.exdates, reminders: x.reminders.length ? x.reminders : x.allDay ? [0] : [...state.settings.defaultRemind], uid: x.uid || undefined, cat: 'inne' });
      addEvent(ev);
      added++;
    }
  });
  return { added, skipped };
}
