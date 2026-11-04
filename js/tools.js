// Narzędzia: znajdź wolny termin, statystyki, import .ics.
import { esc, ymd, fmtTime, relDay, ICON, haptic } from './util.js';
import { state, addEvent, newEvent, batch } from './store.js';
import { findSlots } from './planner.js';
import { parseICS } from './ics.js';
import { openSheet, closeSheet } from './ui.js';
import { openEventEditor } from './editors.js';
import { peerEvents, peersOn } from './peers.js';

// Bufor wokół wydarzenia: ustawiony dla kategorii albo domyślny. Wpisy bez kategorii (druga osoba) dostają domyślny.
export function bufferOf(ev) {
  const b = state.settings.buffer || {};
  return (ev && b.cats?.[ev.cat]) ?? b.def ?? 0;
}

// ---------- Znajdź wolny termin ----------
export function openFindSlot({ title = '', both = false } = {}) {
  const o = { durMin: 60, days: 7, win: 'day', weekdays: false, both: both && peersOn() };
  const slotsNow = () => { const [from, to] = WIN[o.win]; return findSlots(o.both ? state.events.concat(peerEvents()) : state.events, { durMin: o.durMin, days: o.days, from, to, weekdaysOnly: o.weekdays, count: 8, bufferOf, allDayBusy: o.both }); };
  const WIN = { morning: ['08:00', '12:00', 'Rano'], day: ['09:00', '18:00', 'Dzień'], evening: ['17:00', '21:00', 'Wieczór'], custom: [state.settings.dayStart, state.settings.dayEnd, 'Cały dzień'] };
  const chip = (on, attr, label) => `<button type="button" class="chip ${on ? 'on' : ''}" ${attr}>${label}</button>`;
  const body = () => {
    const slots = slotsNow();
    return `
      <div class="lbl">Jak długo</div>
      <div class="chips">${[[30, '30 min'], [60, '1 godz.'], [90, '1,5 godz.'], [120, '2 godz.'], [180, '3 godz.']].map(([m, l]) => chip(o.durMin === m, `data-dur="${m}"`, l)).join('')}</div>
      <div class="lbl">Pora dnia</div>
      <div class="chips">${Object.entries(WIN).map(([k, v]) => chip(o.win === k, `data-win="${k}"`, `${v[2]}`)).join('')}</div>
      <div class="lbl">Zakres</div>
      <div class="chips">${chip(o.days === 7, 'data-days="7"', '7 dni')}${chip(o.days === 14, 'data-days="14"', '14 dni')}${chip(o.weekdays, 'data-wk="1"', 'Tylko dni robocze')}</div>
      ${peersOn() ? `<div class="lbl">Dla kogo</div><div class="chips">${chip(!o.both, 'data-both="0"', 'Tylko ja')}${chip(o.both, 'data-both="1"', 'Dla nas obojga')}</div>` : ''}
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
    else if (t.dataset.both) o.both = t.dataset.both === '1';
    else if (t.dataset.slot != null) {
      const s = slotsNow()[+t.dataset.slot];
      if (s) {
        haptic();
        closeSheet(h);
        setTimeout(() => openEventEditor({ draft: { title, start: `${ymd(s.start)}T${fmtTime(s.start)}`, end: `${ymd(s.end)}T${fmtTime(s.end)}` }, shared: o.both }), 220);
      }
      return;
    } else return;
    const top = bodyEl.scrollTop;
    bodyEl.innerHTML = body();
    bodyEl.scrollTop = top;
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
