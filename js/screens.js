// Ekrany: Dziś, Kalendarz (miesiąc, tydzień, dzień, agenda), Zadania, Więcej.
import {
  esc, ymd, parseYmd, parseDT, fmtTime, pad, addDays, addMinutes, startOfDay, startOfWeek, sameDay, diffDays, relDay, fmtDayLong, fmtDayMid, fmtCountdown, fmtDuration, clamp, ICON,
  DAYS_FULL, DAYS_SHORT, DAYS_LETTER, MONTHS, MONTHS_GEN, MONTHS_SHORT, capFirst, haptic,
} from './util.js';
import { state, catOf, updateEvent, detachOccurrence, undo, newEvent, addEvent, updateTask, batch, describeRule as describeRuleDef } from './store.js';
import { instancesInRange, layoutColumns, describeRule } from './recur.js';
import { nav, toast, rerender } from './ui.js';
import { weatherKind, cachedWeather, hourlyFor, dailyFor, isOutdoor, weatherAlerts } from './weather.js';
import { lockOn, lockSummary } from './lock.js';
import { dayInfo, nameDays, isoWeek, sunTimes } from './extras.js';
import { glyphFor, glyphHtml } from './glyphs.js';
import { skyName, skyUrl } from './sky.js';
import { backupOn, backupInfo } from './backup.js';
import { invitesForMe } from './space.js';
import { colorChips } from './more.js';
import { nextUp } from './plan.js';
import { pushConfig, pushSupported } from './push.js';
import { peerEvents, peerList, peersOn } from './peers.js';
import { notifPermission, notifSupported, isStandalone } from './notify.js';
import { openEventEditor, defaultDraftFor } from './editors.js';

export const dragState = { endedAt: 0, active: false };

const plural = (n, one, few, many) => (n === 1 ? one : n % 10 >= 2 && n % 10 <= 4 && !(n % 100 >= 12 && n % 100 <= 14) ? few : many);
const hmToMin = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + (m || 0); };
const minOf = (d) => d.getHours() * 60 + d.getMinutes();

const evs = () => { const p = peerEvents(); return p.length ? state.events.concat(p) : state.events; };
export const myColor = () => state.settings.share?.color || '#2E8BFF';
// Kolor wpisu to kolor osoby: moje mają mój, jej mają jej. Kategorię pokazuje ikonka.
const catOfEv = (ev) => (ev.peer ? { id: 'peer', name: ev.peer.name, color: ev.peer.color } : { ...catOf(ev.cat), color: myColor() });

// Filtry widoków kalendarza: osoba i kategorie.
const filterOn = () => nav.filterWho !== 'all' || nav.filterCats.length > 0;
function calEvs() {
  const list = evs();
  if (!filterOn()) return list;
  return list.filter((e) => {
    if (nav.filterWho === 'me' && e.peer) return false;
    if (nav.filterWho === 'peer' && !e.peer) return false;
    if (nav.filterCats.length && !e.peer && !nav.filterCats.includes(e.cat)) return false;
    return true;
  });
}

export function instOf(key) {
  const [id, date] = key.split('@');
  const ev = state.events.find((e) => e.id === id) || peerEvents().find((e) => e.id === id);
  if (!ev) return null;
  const d = parseYmd(date);
  return instancesInRange([ev], addDays(d, -45), addDays(d, 2)).find((i) => i.key === key) || null;
}

function spanDates(inst) {
  const out = [];
  const last = new Date(inst.end.getTime() - 1);
  for (let d = startOfDay(inst.start); d <= last; d = addDays(d, 1)) out.push(ymd(d));
  return out.length ? out : [ymd(inst.start)];
}

function groupByDay(insts) {
  const m = new Map();
  for (const i of insts) for (const k of spanDates(i)) { if (!m.has(k)) m.set(k, []); m.get(k).push(i); }
  return m;
}

// ---------- Wspólne klocki ----------
const repeatMini = `<span class="ico" style="width:13px;height:13px;display:inline-flex;vertical-align:-2px">${ICON.repeat}</span>`;

function evRow(inst, now) {
  const c = catOfEv(inst.ev);
  const past = inst.end <= now;
  const live = inst.start <= now && inst.end > now;
  let wx = '';
  if (!inst.allDay && !past && isOutdoor(inst.ev)) {
    const h = hourlyFor(cachedWeather(), inst.date, inst.start.getHours());
    if (h) wx = `<span class="wx ${h.pop >= 50 ? 'wet' : ''}"><span class="ico">${wIcon(h.code)}</span>${Math.round(h.temp)}°${h.pop >= 20 ? ` · ${h.pop}%` : ''}</span>`;
  }
  const pb = inst.ev.peer ? `<span class="pbadge" style="--pc:${inst.ev.peer.color}">${esc(inst.ev.peer.name.charAt(0).toUpperCase())}</span>` : '';
  return `<button type="button" class="ev ${past ? 'past' : ''} ${live ? 'live' : ''} ${inst.ev.peer ? 'peer' : ''}" style="--c:${c.color}" data-act="open-ev" data-key="${inst.key}">
    ${glyphHtml(glyphFor(inst.ev), 'sm')}<div class="evb"><div class="t">${pb}${esc(inst.title)}${inst.ev.private && !inst.ev.peer ? `<span class="ico lockmini">${ICON.lock}</span>` : ''}</div>
    <div class="s">${inst.allDay ? '<span>Cały dzień</span>' : `<span>${fmtTime(inst.start)}–${fmtTime(inst.end)}</span>`}${inst.ev.loc ? `<span>${esc(inst.ev.loc)}</span>` : ''}${inst.recurring ? `<span>${repeatMini}</span>` : ''}${wx}</div></div>
  </button>`;
}

function taskRow(t, today = ymd(new Date())) {
  const c = { name: catOf(t.cat).name, color: myColor() };
  const late = t.due && t.due < today && !t.done;
  const meta = [];
  if (t.due) meta.push(`<span class="${late ? 'late' : ''}">${esc(relDay(parseYmd(t.due)))}${t.dueTime ? ', ' + t.dueTime : ''}</span>`);
  meta.push(`<span>${esc(c.name)}</span>`);
  if (t.rolled && !t.done) meta.push(`<span>przeniesione ${t.rolled}×</span>`);
  return `<div class="task ${t.done ? 'done' : ''}" style="--c:${c.color}" data-id="${t.id}">
    <button type="button" class="chk" data-act="toggle-task" data-id="${t.id}" aria-label="${t.done ? 'Cofnij wykonanie' : 'Oznacz jako zrobione'}"><span class="ico">${ICON.check}</span></button>
    <button type="button" class="tt" data-act="open-task" data-id="${t.id}"><b>${esc(t.title)}</b><small>${meta.join('')}</small></button>
    ${t.prio === 2 ? '<span class="tag-p" title="Pilne"></span>' : t.prio === 1 ? '<span class="tag-p p1" title="Ważne"></span>' : ''}
  </div>`;
}

const wIcon = (code) => ICON[weatherKind(code).icon] || ICON.cloud;

// Święto, imieniny, wschód i zachód słońca dla wybranego dnia.
function dayMeta(d, { sun = true, week = false } = {}) {
  const parts = [];
  const info = dayInfo(d);
  if (info) parts.push(`<span class="dm hol ${info.off ? 'off' : ''}">${esc(info.name)}</span>`);
  const nd = nameDays(d);
  if (nd) parts.push(`<span class="dm">Imieniny: ${esc(nd.split(', ').slice(0, 3).join(', '))}</span>`);
  if (sun) {
    const st = sunTimes(d, state.settings.city.lat, state.settings.city.lon);
    if (st) parts.push(`<span class="dm sun"><span class="ico">${ICON.sun}</span>${fmtTime(st.rise)} – ${fmtTime(st.set)}</span>`);
  }
  if (week) parts.push(`<span class="dm">tydzień ${isoWeek(d)}</span>`);
  return parts.join('');
}

// ---------- Dziś ----------
export function skyPhase(now) {
  const h = now.getHours();
  return h < 5 ? 'night' : h < 8 ? 'dawn' : h < 12 ? 'morning' : h < 17 ? 'day' : h < 20 ? 'dusk' : 'night';
}

let shownSky = '';
export const currentSky = (now = new Date()) => skyName(now, state.settings.city.lat, state.settings.city.lon, cachedWeather()?.code);

function planRow(i, now, next) {
  const c = catOfEv(i.ev);
  const past = i.end <= now;
  const live = !i.allDay && i.start <= now && i.end > now;
  const isNext = next && i.key === next.key;
  const dur = i.allDay ? '' : fmtDuration((i.end - i.start) / 60000).replace(' godz.', ' h');
  const place = i.ev.loc ? `<span class="pin"><span class="ico">${ICON.pin}</span>${esc(i.ev.loc)}</span>` : '';
  const sub = [place, dur].filter(Boolean).join('<span class="sep">·</span>');
  const pb = i.ev.peer ? `<span class="pbadge" style="--pc:${i.ev.peer.color}">${esc(i.ev.peer.name.charAt(0).toUpperCase())}</span>` : '';
  const shared = i.ev.sharedId ? `<span class="shr" title="Wspólne"><span class="ico">${ICON.users}</span></span>` : '';
  let right = '';
  if (past) right = `<span class="st ok"><span class="ico">${ICON.check}</span></span>`;
  else if (live) right = `<span class="st live"><b>Trwa</b><small>${Math.max(1, Math.round((i.end - now) / 60000))} min</small></span>`;
  const prog = live ? clamp(((now - i.start) / (i.end - i.start)) * 100, 0, 100) : 0;
  return `<button type="button" class="pl ${past ? 'past' : ''} ${live ? 'live' : ''} ${isNext ? 'next' : ''} ${i.ev.peer ? 'peer' : ''}" style="--c:${c.color}" data-act="open-ev" data-key="${i.key}">
    ${isNext ? `<span class="nx">Następne · ${esc(fmtCountdown(i.start - now))}</span>` : ''}
    <span class="pl-in"><span class="tm">${i.allDay ? 'Cały dzień' : `${fmtTime(i.start)}–${fmtTime(i.end)}`}</span>${glyphHtml(glyphFor(i.ev))}<span class="pl-t"><b>${pb}${esc(i.title)}${shared}</b>${sub ? `<small>${sub}</small>` : ''}</span>${right}</span>
    ${live ? `<span class="pl-prog"><i style="width:${prog}%"></i></span>` : ''}
  </button>`;
}

export function alertCard(w, now = new Date()) {
  const today = startOfDay(now);
  const plan = instancesInRange(state.events, today, addDays(today, 1)).filter((i) => !i.allDay && isOutdoor(i.ev));
  const list = weatherAlerts(w, now, plan);
  if (!list.length) return '';
  const a = list[0];
  return `<button type="button" class="wxcard" data-act="weather"><span class="wxi"><span class="ico">${ICON[a.icon] || ICON.alert}</span></span><span class="rt"><b>${esc(a.title)}</b><small>${esc(a.sub)}</small></span><span class="ico chev">${ICON.chevR}</span></button>`;
}

export function renderToday() {
  const now = new Date();
  const today = startOfDay(now);
  const s = state.settings;
  const hr = now.getHours() + now.getMinutes() / 60;
  const greet = hr < 5 ? 'Dobranoc' : hr < 18 ? 'Dzień dobry' : hr < 23 ? 'Dobry wieczór' : 'Dobranoc';
  const name = (s.displayName || '').trim();
  const list = instancesInRange(evs(), today, addDays(today, 1));
  const { next } = nextUp(list, now);
  const nTasks = state.tasks.filter((t) => !t.done && t.due && t.due <= ymd(today)).length;
  const st = sunTimes(now, s.city.lat, s.city.lon);
  const nd = nameDays(now);
  const info = dayInfo(now);
  const w = cachedWeather();
  const sky = currentSky(now);
  const prevSky = shownSky && shownSky !== sky ? shownSky : '';
  shownSky = sky;
  const count = `${list.length} ${plural(list.length, 'wydarzenie', 'wydarzenia', 'wydarzeń')} · ${nTasks} ${plural(nTasks, 'zadanie', 'zadania', 'zadań')}`;
  const tile = (act, ico, col, label) => `<button type="button" class="tile" ${act} style="--c:${col}"><span class="ti"><span class="ico">${ico}</span></span><span>${label}</span></button>`;
  const invites = invitesForMe().length;
  return `
  <header class="hero">
    <div class="hero-img" style="background-image:url(${skyUrl(prevSky || sky)})"></div>
    ${prevSky ? `<div class="hero-img fade" style="background-image:url(${skyUrl(sky)})"></div>` : ''}
    <div class="hero-in">
      <div class="hero-l">
        <h1><span class="ico">${ICON[hr < 18 && hr >= 5 ? 'sun' : 'moon']}</span>${esc(greet)}${name ? `, ${esc(name)}` : ''}</h1>
        <p class="d">${esc(capFirst(DAYS_FULL[now.getDay()]))}, ${now.getDate()} ${MONTHS_GEN[now.getMonth()]} ${now.getFullYear()}</p>
        <p>Tydzień ${isoWeek(now)}${nd ? `<span class="vs"></span>Imieniny: ${esc(nd.split(', ').slice(0, 2).join(', '))}` : ''}</p>
        ${info ? `<p class="hol ${info.off ? 'off' : ''}">${esc(info.name)}</p>` : ''}
        ${st ? `<p class="sun"><span class="ico">${ICON.sun}</span>${fmtTime(st.rise)}<span class="ico mo">${ICON.moon}</span>${fmtTime(st.set)}</p>` : ''}
      </div>
      <button type="button" class="hero-w" id="wx" data-act="weather" aria-label="Pogoda"><span class="ico" id="wx-i">${w ? wIcon(w.code) : ICON.cloud}</span><b id="wx-t">${w ? `${w.temp}°C` : ''}</b><small id="wx-c">${esc(s.city.name)}</small></button>
    </div>
  </header>
  <form class="cmd" id="cmd-form" autocomplete="off"><span class="ico spark">${ICON.sparkle}</span><input id="cmd-in" type="text" enterkeyhint="send" autocapitalize="sentences" placeholder="Powiedz lub wpisz, co masz zrobić…" aria-label="Asystent"><button type="button" class="cmd-mic" data-act="cmd-mic" aria-label="Dyktuj głosem"><span class="ico">${ICON.mic}</span></button></form>
  <div class="tiles">
    ${tile('data-act="quick"', ICON.calplus, '#19C8FF', 'Dodaj')}
    ${tile('data-act="quick-task"', ICON.check, '#27E05F', 'Zadanie')}
    ${tile('data-act="tab" data-tab="shared"', `${ICON.users}${invites ? `<em>${invites}</em>` : ''}`, '#A45CFF', 'Wspólny')}
    ${tile('data-act="tab" data-tab="auto"', ICON.bolt, '#FFC400', 'Automatyzacje')}
    ${tile('data-act="tab" data-tab="stats"', ICON.bars, '#2E8BFF', 'Statystyki')}
  </div>
  <section class="plan">
    <div class="plan-h"><h2>Dziś – Twój plan</h2><button type="button" data-act="tab" data-tab="tasks">${count}</button></div>
    ${list.length ? list.map((i) => planRow(i, now, next)).join('') : '<div class="pl-empty"><b>Na dziś nic nie ma w planie</b>Napisz wyżej, co chcesz zrobić.</div>'}
  </section>
  <div id="wx-alert">${alertCard(w, now)}</div>
  <div class="spacer"></div>`;
}

export function paintWeather(w) {
  const t = document.getElementById('wx-t');
  const i = document.getElementById('wx-i');
  const c = document.getElementById('wx-c');
  if (c) c.textContent = state.settings.city.name;
  if (!w || !t) return;
  i.innerHTML = wIcon(w.code);
  t.textContent = `${w.temp}°C`;
  const a = document.getElementById('wx-alert');
  if (a) a.innerHTML = alertCard(w);
}

// ---------- Kalendarz ----------
function calTitle() {
  const c = nav.cursor;
  const v = nav.calView;
  if (v === 'month') return `${capFirst(MONTHS[c.getMonth()])}<small>${c.getFullYear()}</small>`;
  if (v === 'week') {
    const s = startOfWeek(c, state.settings.weekStart);
    const e = addDays(s, 6);
    return s.getMonth() === e.getMonth() ? `${s.getDate()}–${e.getDate()} ${MONTHS_SHORT[s.getMonth()]}<small>${e.getFullYear()}</small>` : `${s.getDate()} ${MONTHS_SHORT[s.getMonth()]} – ${e.getDate()} ${MONTHS_SHORT[e.getMonth()]}`;
  }
  if (v === '3day') {
    const e = addDays(c, 2);
    return c.getMonth() === e.getMonth() ? `${c.getDate()}–${e.getDate()} ${MONTHS_SHORT[c.getMonth()]}<small>${e.getFullYear()}</small>` : `${c.getDate()} ${MONTHS_SHORT[c.getMonth()]} – ${e.getDate()} ${MONTHS_SHORT[e.getMonth()]}`;
  }
  if (v === 'day') return `${c.getDate()} ${MONTHS_SHORT[c.getMonth()]}<small>${DAYS_FULL[c.getDay()]}</small>`;
  return 'Agenda';
}

function filterBar() {
  const who = [['all', 'Wszyscy'], ['me', 'Moje']];
  const p = peerList()[0]?.name;
  if (peersOn() && p) who.push(['peer', p]);
  return `<div class="filters"><div class="chips scroll">${who.map(([k, l]) => `<button type="button" class="chip ${nav.filterWho === k ? 'on' : ''}" data-act="filter-who" data-v="${k}">${esc(l)}</button>`).join('')}${state.cats.map((c) => `<button type="button" class="chip cf ${nav.filterCats.includes(c.id) ? 'on' : ''}" data-act="filter-cat" data-v="${c.id}">${glyphHtml(glyphFor({ cat: c.id }), 'xs')}${esc(c.name)}</button>`).join('')}</div></div>`;
}

export function renderCal() {
  const v = nav.calView;
  const head = `<header class="cal-head" id="cal-head">
    <div class="cal-title"><h1>${calTitle()}</h1>
      <div class="cal-nav">
        <button type="button" class="round" data-act="search" aria-label="Szukaj"><span class="ico">${ICON.search}</span></button>
        <button type="button" class="round ${filterOn() ? 'lit' : ''}" data-act="filter-toggle" aria-label="Filtry" aria-expanded="${!!nav.showFilter}"><span class="ico">${ICON.filter}</span></button>
        ${v === 'agenda' ? '' : `<button type="button" class="round" data-act="cal-prev" aria-label="Poprzedni"><span class="ico">${ICON.chevL}</span></button><button type="button" class="round" data-act="cal-next" aria-label="Następny"><span class="ico">${ICON.chevR}</span></button>`}
      </div></div>
    <div class="cal-views"><div class="seg">${[['month', 'Miesiąc'], ['week', 'Tydzień'], ['3day', '3 dni'], ['day', 'Dzień'], ['agenda', 'Agenda']].map(([k, l]) => `<button type="button" class="${v === k ? 'on' : ''}" data-act="calview" data-v="${k}">${l}</button>`).join('')}</div>${v === 'agenda' ? '' : '<button type="button" class="btn small" data-act="cal-today">Dziś</button>'}</div>
    ${nav.showFilter ? filterBar() : ''}
  </header>`;
  const body = v === 'month' ? renderMonth() : v === 'week' ? renderGrid(7) : v === '3day' ? renderGrid(3) : v === 'day' ? renderGrid(1) : renderAgenda();
  return head + body;
}

function renderMonth() {
  const now = new Date();
  const ws = state.settings.weekStart;
  const c = nav.cursor;
  const first = new Date(c.getFullYear(), c.getMonth(), 1);
  const gridStart = startOfWeek(first, ws);
  const weeks = Math.ceil((diffDays(first, gridStart) + new Date(c.getFullYear(), c.getMonth() + 1, 0).getDate()) / 7);
  const insts = instancesInRange(calEvs(), gridStart, addDays(gridStart, weeks * 7));
  const by = groupByDay(insts);
  const head = Array.from({ length: 7 }, (_, k) => `<div>${DAYS_SHORT[(ws + k) % 7]}</div>`).join('');
  let cells = '';
  for (let k = 0; k < weeks * 7; k++) {
    const d = addDays(gridStart, k);
    const list = by.get(ymd(d)) || [];
    const n = list.length;
    const cols = [...new Set(list.map((i) => catOfEv(i.ev).color))].slice(0, 3);
        const hi = dayInfo(d);
    cells += `<button type="button" class="mcell ${hi?.off ? 'hol' : ''} ${d.getMonth() !== c.getMonth() ? 'out' : ''} ${sameDay(d, now) ? 'today' : ''} ${sameDay(d, nav.selected) ? 'sel' : ''}" data-act="pick-day" data-date="${ymd(d)}" aria-label="${fmtDayLong(d)}${n ? ', ' + n + ' wydarzeń' : ''}"><span class="n">${d.getDate()}</span><span class="dots">${cols.map((x) => `<i style="--c:${x}"></i>`).join('')}${n > 3 ? `<span class="more">+</span>` : ''}</span></button>`;
  }
  const sel = nav.selected;
  const dayList = (by.get(ymd(sel)) || instancesInRange(calEvs(), startOfDay(sel), addDays(startOfDay(sel), 1)));
  const tasks = state.tasks.filter((t) => !t.done && t.due === ymd(sel));
  const rows = dayList.map((i) => `<div class="drow"><div class="tm">${i.allDay ? '' : fmtTime(i.start)}${i.allDay ? '' : `<small>${fmtTime(i.end)}</small>`}</div>${evRow(i, now)}</div>`).join('');
  return `<div class="month"><div class="mhead">${head}</div><div class="mgrid">${cells}</div></div>
  <div class="dayhead"><h2>${relDay(sel) === fmtDayMid(sel) ? capFirst(DAYS_FULL[sel.getDay()]) : relDay(sel)}<small style="margin-left:8px;font-weight:500">${sel.getDate()} ${MONTHS_GEN[sel.getMonth()]}</small></h2><button type="button" class="link" data-act="add-on" data-date="${ymd(sel)}">Dodaj</button></div>
  <div class="dayinfo">${dayMeta(sel, { week: true })}</div>
  <div class="dlist">${rows || '<div class="empty" style="padding:14px 4px">Brak wydarzeń tego dnia.</div>'}</div>
  ${tasks.length ? `<div class="tasks" style="margin-top:8px">${tasks.map((t) => taskRow(t)).join('')}</div>` : ''}
  <div class="spacer"></div>`;
}

const HH = 58;
function renderGrid(ncols) {
  const now = new Date();
  const ws = state.settings.weekStart;
  const days = ncols === 7 ? Array.from({ length: 7 }, (_, k) => addDays(startOfWeek(nav.cursor, ws), k)) : ncols === 3 ? [0, 1, 2].map((k) => addDays(startOfDay(nav.cursor), k)) : [startOfDay(nav.cursor)];
  const from = days[0];
  const to = addDays(days[days.length - 1], 1);
  const insts = instancesInRange(calEvs(), from, to);
  const tight = ncols > 1;
  const narrow = ncols === 7;

  const wxAll = cachedWeather();
  const headDays = days.map((d) => {
    const dw = dailyFor(wxAll, ymd(d));
    const hi = dayInfo(d);
    return `<button type="button" class="wk-d ${sameDay(d, now) ? 'today' : ''} ${sameDay(d, nav.selected) && tight ? 'sel' : ''} ${hi?.off ? 'hol' : ''}" data-act="goto-day" data-date="${ymd(d)}" ${hi ? `title="${esc(hi.name)}"` : ''}><span class="l">${DAYS_SHORT[d.getDay()]}</span><span class="n">${d.getDate()}</span>${dw ? `<span class="w ${dw.pop >= 50 ? 'wet' : ''}"><span class="ico">${wIcon(dw.code)}</span>${dw.hi}°</span>` : '<span class="w"></span>'}${hi ? '<i class="hd"></i>' : ''}</button>`;
  }).join('');
  const header = tight ? `<div class="wk-head"><div class="wk-no"><small>tydz.</small>${isoWeek(days[0])}</div><div class="wk-days" style="grid-template-columns:repeat(${ncols},1fr)">${headDays}</div></div>` : '';

  const alldayItems = insts.filter((i) => i.allDay || i.end - i.start >= 86400000);
  const adCells = days.map((d) => {
    const k = ymd(d);
    const list = alldayItems.filter((i) => spanDates(i).includes(k));
    return `<div>${list.map((i) => `<button type="button" class="ad" style="--c:${catOfEv(i.ev).color}" data-act="open-ev" data-key="${i.key}">${esc(i.title)}</button>`).join('')}</div>`;
  }).join('');
  const allday = alldayItems.length ? `<div class="allday-row"><div></div><div class="cells" style="grid-template-columns:repeat(${ncols},1fr)">${adCells}</div></div>` : '';

  let hours = '';
  let lines = '';
  for (let h = 0; h <= 24; h++) {
    if (h > 0 && h < 24) hours += `<span style="top:${h * HH}px">${pad(h)}:00</span>`;
    lines += `<div class="hl" style="top:${h * HH}px"></div>`;
    if (h < 24 && ncols < 7) lines += `<div class="hl half" style="top:${h * HH + HH / 2}px"></div>`;
  }

  const cols = days.map((d) => {
    const k = ymd(d);
    const dayStart = startOfDay(d);
    const items = insts
      .filter((i) => !i.allDay && i.end - i.start < 86400000 && spanDates(i).includes(k))
      .map((i) => ({ i, sMin: i.start < dayStart ? 0 : minOf(i.start), eMin: i.end >= addDays(dayStart, 1) ? 1440 : Math.max(minOf(i.end), (i.start < dayStart ? 0 : minOf(i.start)) + 15) }));
    layoutColumns(items);
    const blocks = items.map((x) => {
      const c = catOfEv(x.i.ev);
      const top = (x.sMin / 60) * HH;
      const height = Math.max(20, ((x.eMin - x.sMin) / 60) * HH - 1);
      const left = (x.col / x.cols) * 100;
      const width = 100 / x.cols;
      const drag = sameDay(x.i.start, x.i.end) && !x.i.ev.peer ? 'data-drag="1"' : '';
      const tall = height > 44;
      return `<button type="button" class="blk ${narrow ? 'nar' : ''} ${x.i.ev.peer ? 'peer' : ''}" style="--c:${c.color};top:${top}px;height:${height}px;left:calc(${left}% + 1px);width:calc(${width}% - 3px);${narrow ? 'font-size:11px;padding:3px 3px 3px 6px' : ''}" data-act="open-ev" data-key="${x.i.key}" ${drag} data-s="${x.sMin}" data-e="${x.eMin}">
        <b>${x.i.ev.peer ? `<span class="pbadge" style="--pc:${x.i.ev.peer.color}">${esc(x.i.ev.peer.name.charAt(0).toUpperCase())}</span>` : ''}${esc(x.i.title)}</b>${narrow ? '' : `<span class="tm">${fmtTime(x.i.start)}–${fmtTime(x.i.end)}</span>${tall && x.i.ev.loc ? `<span style="display:block">${esc(x.i.ev.loc)}</span>` : ''}`}${drag ? '<i class="rs"></i>' : ''}</button>`;
    }).join('');
    const nowLine = sameDay(d, now) ? `<div class="nowline" style="top:${(minOf(now) / 60) * HH}px"></div>` : '';
    return `<div class="col" data-date="${k}" style="height:${24 * HH}px">${blocks}${nowLine}</div>`;
  }).join('');

  const pageHead = tight ? '' : `<div class="dayhead" style="padding-top:10px"><h2>${relDay(days[0]) === fmtDayMid(days[0]) ? capFirst(DAYS_FULL[days[0].getDay()]) : relDay(days[0])}</h2><button type="button" class="link" data-act="add-on" data-date="${ymd(days[0])}">Dodaj</button></div><div class="dayinfo">${dayMeta(days[0], { week: true })}</div>`;
  const trayTasks = !narrow ? state.tasks.filter((t) => !t.done && (!t.due || t.due <= ymd(days[days.length - 1]))).sort((a, b) => b.prio - a.prio || (a.due || '9').localeCompare(b.due || '9')).slice(0, 14) : [];
  const tray = trayTasks.length ? `<div class="tray ${ncols === 3 ? 'three' : ''}"><div class="tray-l"><span class="tray-lbl" title="Przytrzymaj zadanie i upuść na osi czasu">Zablokuj czas:</span>${trayTasks.map((t) => ` <span class="tk" style="--c:${myColor()}" data-task="${t.id}">${esc(t.title)}</span>`).join('')}</div></div>` : '';
  const dayTasks = !tight ? state.tasks.filter((t) => !t.done && t.due === ymd(days[0])) : [];
  return `${header}${pageHead}${tray}${allday}
  <div class="tgrid" id="tgrid" style="--hh:${HH}px;height:${24 * HH}px"><div class="hours">${hours}</div><div class="cols" style="grid-template-columns:repeat(${ncols},1fr);height:${24 * HH}px"><div style="position:absolute;inset:0;pointer-events:none">${lines}</div>${cols}</div></div>
  ${dayTasks.length ? `<div class="sec"><div class="sec-h"><h2>Zadania</h2></div><div class="tasks">${dayTasks.map((t) => taskRow(t)).join('')}</div></div>` : ''}
  <div class="spacer"></div>`;
}

function renderAgenda() {
  const now = new Date();
  const today = startOfDay(now);
  const to = addDays(today, nav.agendaDays);
  const insts = instancesInRange(calEvs(), today, to);
  const by = groupByDay(insts);
  let html = '';
  let shown = 0;
  for (let k = 0; k < nav.agendaDays; k++) {
    const d = addDays(today, k);
    const key = ymd(d);
    const list = by.get(key) || [];
    const tasks = state.tasks.filter((t) => !t.done && t.due === key);
    if (!list.length && !tasks.length) continue;
    shown++;
    const rel = relDay(d);
    html += `<div class="agenda-day"><div class="agenda-h ${k === 0 ? 'today' : ''}"><b>${rel === fmtDayMid(d) ? capFirst(DAYS_FULL[d.getDay()]) : rel}</b><small>${d.getDate()} ${MONTHS_GEN[d.getMonth()]}</small></div>
      <div class="dlist">${list.map((i) => `<div class="drow"><div class="tm">${i.allDay ? '' : fmtTime(i.start)}${i.allDay ? '' : `<small>${fmtTime(i.end)}</small>`}</div>${evRow(i, now)}</div>`).join('')}</div>
      ${tasks.length ? `<div class="tasks">${tasks.map((t) => taskRow(t)).join('')}</div>` : ''}</div>`;
  }
  if (!shown) html = '<div class="empty" style="padding-top:60px"><b>Pusto na najbliższe tygodnie</b>Dodaj wydarzenie zdaniem, przyciskiem plus na dole.</div>';
  return `${html}<div style="padding:18px 16px 0"><button type="button" class="btn block" data-act="agenda-more">Pokaż kolejne 30 dni</button></div><div class="spacer"></div>`;
}

// Przeciąganie bloków w widoku dnia: przytrzymaj, aby przenieść; uchwyt na dole zmienia długość.
export function bindGridDrag(grid) {
  if (!grid) return;
  let st = null;
  const getY = (e) => (e.touches ? e.touches[0] : e).clientY;
  const getX = (e) => (e.touches ? e.touches[0] : e).clientX;
  const SNAP = 5;

  const begin = (e) => {
    if (e.type === 'mousedown' && e.button !== 0) return;
    const rs = e.target.closest('.rs');
    const blk = e.target.closest('.blk[data-drag]');
    const col = e.target.closest('.col');
    const touch = !!e.touches;
    if (rs && blk) st = { mode: 'resize', el: blk, y0: getY(e), active: true };
    else if (blk) st = { mode: 'move', el: blk, y0: getY(e), x0: getX(e), active: false };
    else if (col && !e.target.closest('.blk')) st = { mode: 'create', el: col, y0: getY(e), active: false };
    else return;
    st.s0 = +(blk?.dataset.s ?? 0);
    st.e0 = +(blk?.dataset.e ?? 0);
    st.dy = 0;
    st.dx = 0;
    st.inst = blk ? instOf(blk.dataset.key) : null;
    if (st.mode === 'resize') { blk.classList.add('drag'); dragState.active = true; haptic(); if (touch) e.stopPropagation(); }
    else {
      st.timer = setTimeout(() => {
        if (!st) return;
        st.active = true;
        dragState.active = true;
        haptic();
        if (st.mode === 'move') st.el.classList.add('drag');
        if (st.mode === 'create') {
          const rect = st.el.getBoundingClientRect();
          const min = Math.floor(((st.y0 - rect.top) / HH) * 60 / 15) * 15;
          const date = parseYmd(st.el.dataset.date);
          const h = clamp(min / 60, 0, 23);
          dragState.endedAt = Date.now();
          st = null;
          openEventEditor({ draft: defaultDraftFor(date, h) });
        }
      }, touch ? 380 : 260);
    }
  };

  const move = (e) => {
    if (!st) return;
    const dy = getY(e) - st.y0;
    if (!st.active) {
      if (Math.abs(dy) > 9) { clearTimeout(st.timer); st = null; }
      return;
    }
    if (st.mode === 'create') return;
    if (e.cancelable) e.preventDefault();
    st.dy = dy;
    if (st.mode === 'move') {
      const dx = getX(e) - st.x0;
      st.dx = dx;
      st.el.style.transform = `translateX(${dx}px)`;
      st.el.style.zIndex = 20;
      const cols = [...grid.querySelectorAll('.col')];
      const hit = cols.find((c) => { const r = c.getBoundingClientRect(); return getX(e) >= r.left && getX(e) < r.right; });
      cols.forEach((c) => c.classList.toggle('drop', c === hit && cols.length > 1));
      st.target = hit?.dataset.date || null;
    }
    const delta = Math.round(((dy / HH) * 60) / SNAP) * SNAP;
    const tm = st.el.querySelector('.tm');
    if (st.mode === 'move') {
      const dur = st.e0 - st.s0;
      const ns = clamp(st.s0 + delta, 0, 1440 - dur);
      st.newS = ns;
      st.el.style.top = `${(ns / 60) * HH}px`;
      if (tm) tm.textContent = `${pad(Math.floor(ns / 60))}:${pad(ns % 60)}–${pad(Math.floor((ns + dur) / 60))}:${pad((ns + dur) % 60)}`;
    } else {
      const ne = clamp(st.e0 + delta, st.s0 + SNAP, 1440);
      st.newE = ne;
      st.el.style.height = `${Math.max(20, ((ne - st.s0) / 60) * HH - 1)}px`;
      if (tm) tm.textContent = `${pad(Math.floor(st.s0 / 60))}:${pad(st.s0 % 60)}–${pad(Math.floor(ne / 60))}:${pad(ne % 60)}`;
    }
  };

  const end = () => {
    if (!st) return;
    clearTimeout(st.timer);
    const s = st;
    st = null;
    dragState.active = false;
    if (!s.active || s.mode === 'create') return;
    dragState.endedAt = Date.now();
    s.el.classList.remove('drag');
    s.el.style.transform = '';
    grid.querySelectorAll('.col.drop').forEach((c) => c.classList.remove('drop'));
    const inst = s.inst;
    if (!inst) return rerender();
    const day = s.mode === 'move' && s.target ? parseYmd(s.target) : startOfDay(inst.start);
    const sameD = ymd(day) === ymd(inst.start);
    let ns = s.mode === 'move' ? s.newS ?? s.s0 : s.s0;
    let ne = s.mode === 'move' ? ns + (s.e0 - s.s0) : s.newE ?? s.e0;
    if (ns === s.s0 && ne === s.e0 && sameD) return rerender();
    const start = addMinutes(day, ns);
    const endD = addMinutes(day, ne);
    const f = (d) => `${ymd(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    if (inst.recurring) detachOccurrence(inst, { start: f(start), end: f(endD) });
    else updateEvent(inst.ev.id, { start: f(start), end: f(endD) });
    haptic();
    toast(inst.recurring ? 'Zmieniono tylko ten dzień' : `Przeniesiono: ${sameD ? '' : fmtDayMid(day) + ', '}${fmtTime(start)}–${fmtTime(endD)}`, { action: 'Cofnij', onAction: () => { undo(); rerender(); } });
  };

  grid.addEventListener('touchstart', begin, { passive: true });
  grid.addEventListener('touchmove', move, { passive: false });
  grid.addEventListener('touchend', end);
  grid.addEventListener('touchcancel', end);
  grid.addEventListener('mousedown', begin);
  window.addEventListener('mousemove', (e) => st && move(e));
  window.addEventListener('mouseup', end);
}

// Blokowanie czasu: przeciągnięcie zadania z paska nad siatką na oś czasu tworzy wydarzenie.
export function bindTray(root) {
  let st = null;
  let raf = 0;
  const pt = (e) => e.touches?.[0] || e.changedTouches?.[0] || e;
  const colAt = (x, y) => { st.ghost.style.display = 'none'; const c = document.elementFromPoint(x, y)?.closest('.col'); st.ghost.style.display = ''; return c; };
  const minAt = (col, y) => {
    const r = col.getBoundingClientRect();
    return Math.max(0, Math.min(1440 - 60, Math.round((((y - r.top) / HH) * 60) / 15) * 15));
  };
  const clearInd = () => root.querySelectorAll('.drop-ind').forEach((n) => n.remove());
  const loop = () => {
    if (!st?.active) return;
    const y = st.y;
    const vh = window.innerHeight;
    const v = root;
    if (y > vh - 150) v.scrollTop += Math.min(18, (y - (vh - 150)) / 4);
    else if (y < 170) v.scrollTop -= Math.min(18, (170 - y) / 4);
    raf = requestAnimationFrame(loop);
  };
  root.addEventListener('touchstart', (e) => {
    const t = e.target.closest('.tray .tk');
    if (!t) return;
    const p = pt(e);
    st = { t, x0: p.clientX, y0: p.clientY, x: p.clientX, y: p.clientY, active: false };
    st.timer = setTimeout(() => {
      if (!st) return;
      st.active = true;
      dragState.active = true;
      haptic();
      const g = document.createElement('div');
      g.className = 'tk-ghost';
      g.textContent = t.textContent;
      g.style.cssText = `--c:${t.style.getPropertyValue('--c')}`;
      document.body.appendChild(g);
      st.ghost = g;
      g.style.left = `${st.x}px`;
      g.style.top = `${st.y}px`;
      t.style.opacity = '.35';
      raf = requestAnimationFrame(loop);
    }, 320);
  }, { passive: true });
  root.addEventListener('touchmove', (e) => {
    if (!st) return;
    const p = pt(e);
    st.x = p.clientX; st.y = p.clientY;
    if (!st.active) {
      if (Math.hypot(p.clientX - st.x0, p.clientY - st.y0) > 9) { clearTimeout(st.timer); st = null; }
      return;
    }
    if (e.cancelable) e.preventDefault();
    st.ghost.style.left = `${p.clientX}px`;
    st.ghost.style.top = `${p.clientY}px`;
    clearInd();
    const col = colAt(p.clientX, p.clientY);
    root.querySelectorAll('.col.drop').forEach((c) => c.classList.remove('drop'));
    if (col) {
      col.classList.add('drop');
      const m = minAt(col, p.clientY);
      const ind = document.createElement('div');
      ind.className = 'drop-ind';
      ind.style.top = `${(m / 60) * HH}px`;
      ind.style.height = `${HH}px`;
      ind.innerHTML = `<span>${pad(Math.floor(m / 60))}:${pad(m % 60)}</span>`;
      col.appendChild(ind);
    }
  }, { passive: false });
  const end = (e) => {
    if (!st) return;
    clearTimeout(st.timer);
    cancelAnimationFrame(raf);
    const s = st;
    st = null;
    dragState.active = false;
    if (!s.active) return;
    dragState.endedAt = Date.now();
    const p = pt(e);
    s.st = s;
    const col = (() => { s.ghost.style.display = 'none'; const c = document.elementFromPoint(p.clientX, p.clientY)?.closest('.col'); return c; })();
    s.ghost.remove();
    s.t.style.opacity = '';
    clearInd();
    root.querySelectorAll('.col.drop').forEach((c) => c.classList.remove('drop'));
    if (!col) return;
    const task = state.tasks.find((x) => x.id === s.t.dataset.task);
    if (!task) return;
    const m = minAt(col, p.clientY);
    const day = parseYmd(col.dataset.date);
    const a = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, m);
    const b = addMinutes(a, task.est || 60);
    const f = (d) => `${ymd(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    batch(() => {
      addEvent(newEvent({ title: task.title, cat: task.cat, start: f(a), end: f(b), fromTask: task.id }));
      updateTask(task.id, { due: ymd(day), dueTime: fmtTime(a) });
    });
    haptic();
    toast(`Zablokowano czas: ${fmtDayMid(day)}, ${fmtTime(a)}–${fmtTime(b)}`, { action: 'Cofnij', onAction: () => { undo(); rerender(); } });
  };
  root.addEventListener('touchend', end);
  root.addEventListener('touchcancel', end);
}

// Przeniesienie wydarzenia na inny dzień z zachowaniem godzin (miesiąc: przytrzymaj wiersz i upuść na dniu).
export function moveInstToDay(inst, day) {
  const delta = diffDays(day, startOfDay(inst.start));
  if (!delta) return false;
  const f = (d) => `${ymd(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const start = addDays(inst.start, delta);
  const end = addDays(inst.end, delta);
  if (inst.recurring) detachOccurrence(inst, { start: f(start), end: f(end) });
  else updateEvent(inst.ev.id, { start: f(start), end: f(end) });
  haptic();
  toast(`Przeniesiono na ${fmtDayMid(day)}`, { action: 'Cofnij', onAction: () => { undo(); rerender(); } });
  return true;
}

export function bindMonthDrag(root) {
  if (!root) return;
  let st = null;
  const pt = (e) => e.touches?.[0] || e.changedTouches?.[0] || e;
  const cellAt = (x, y) => document.elementFromPoint(x, y)?.closest('.mcell');
  root.addEventListener('touchstart', (e) => {
    const b = e.target.closest('.dlist .ev');
    if (!b || b.classList.contains('peer')) return;
    const p = pt(e);
    st = { b, x0: p.clientX, y0: p.clientY, active: false };
    st.timer = setTimeout(() => {
      if (!st) return;
      st.active = true;
      dragState.active = true;
      haptic();
      const r = b.getBoundingClientRect();
      const g = b.cloneNode(true);
      g.className = 'ev drag-ghost';
      g.style.cssText = `position:fixed;left:${r.left}px;top:${r.top}px;width:${r.width}px;z-index:80;pointer-events:none;opacity:.92;transform:scale(.96);box-shadow:var(--shadow)`;
      document.body.appendChild(g);
      st.ghost = g;
      b.style.opacity = '.35';
    }, 380);
  }, { passive: true });
  root.addEventListener('touchmove', (e) => {
    if (!st) return;
    const p = pt(e);
    if (!st.active) {
      if (Math.hypot(p.clientX - st.x0, p.clientY - st.y0) > 9) { clearTimeout(st.timer); st = null; }
      return;
    }
    if (e.cancelable) e.preventDefault();
    st.ghost.style.transform = `translate(${p.clientX - st.x0}px, ${p.clientY - st.y0}px) scale(.96)`;
    root.querySelectorAll('.mcell.drop').forEach((c) => c.classList.remove('drop'));
    cellAt(p.clientX, p.clientY)?.classList.add('drop');
  }, { passive: false });
  const end = (e) => {
    if (!st) return;
    clearTimeout(st.timer);
    const s = st;
    st = null;
    dragState.active = false;
    if (!s.active) return;
    dragState.endedAt = Date.now();
    s.ghost?.remove();
    s.b.style.opacity = '';
    root.querySelectorAll('.mcell.drop').forEach((c) => c.classList.remove('drop'));
    const p = pt(e);
    const cell = cellAt(p.clientX, p.clientY);
    const inst = instOf(s.b.dataset.key);
    if (cell && inst && !inst.ev.peer) moveInstToDay(inst, parseYmd(cell.dataset.date));
  };
  root.addEventListener('touchend', end);
  root.addEventListener('touchcancel', end);
}

// ---------- Zadania ----------
export function renderTasks() {
  const today = ymd(new Date());
  const f = nav.taskFilter;
  const all = state.tasks;
  const open = all.filter((t) => !t.done);
  const sortFn = (a, b) => b.prio - a.prio || (a.due || '9').localeCompare(b.due || '9') || a.created - b.created;
  const late = open.filter((t) => t.due && t.due < today).sort(sortFn);
  const td = open.filter((t) => t.due === today).sort(sortFn);
  const up = open.filter((t) => t.due && t.due > today).sort(sortFn);
  const none = open.filter((t) => !t.due).sort(sortFn);
  const done = all.filter((t) => t.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0)).slice(0, 8);
  const group = (title, list, cls = '', note = '') => (list.length ? `<section class="group ${cls}"><div class="group-h"><h2>${title}</h2><small>${note || list.length}</small></div><div class="tasks">${list.map((t) => taskRow(t, today)).join('')}</div></section>` : '');
  let body = '';
  if (f === 'all') body = group('Zaległe', late, 'late') + group('Dziś', td) + group('Nadchodzące', up) + group('Bez terminu', none) + group('Zrobione', done, '', 'ostatnie');
  else if (f === 'today') body = group('Zaległe', late, 'late') + group('Dziś', td);
  else body = group('Bez terminu', none);
  if (!body.trim()) body = `<div class="empty" style="padding-top:50px"><b>${f === 'today' ? 'Na dziś czysto' : 'Nic tu nie ma'}</b>${f === 'today' ? 'Wszystko zrobione albo jeszcze nic nie zaplanowano.' : 'Dodaj zadanie polem powyżej.'}</div>`;
  const total = open.length;
  return `<header class="page-h"><h1>Zadania</h1><p>${total ? `${total} ${plural(total, 'do zrobienia', 'do zrobienia', 'do zrobienia')}${late.length ? `, w tym ${late.length} ${plural(late.length, 'zaległe', 'zaległe', 'zaległych')}` : ''}` : 'Wszystko zrobione'}</p></header>
  <form class="add-bar" id="task-form" autocomplete="off"><input id="task-in" type="text" enterkeyhint="done" placeholder="Nowe zadanie, np. kup mleko jutro" autocapitalize="sentences"><button type="submit" aria-label="Dodaj zadanie"><span class="ico">${ICON.plus}</span></button></form>
  <div style="padding:14px 16px 0"><div class="seg">${[['all', 'Wszystkie'], ['today', 'Dziś'], ['none', 'Bez terminu']].map(([k, l]) => `<button type="button" class="${f === k ? 'on' : ''}" data-act="taskfilter" data-v="${k}">${l}</button>`).join('')}</div></div>
  ${body}<div class="spacer"></div>`;
}

// ---------- Więcej ----------
export function renderHub() {
  const s = state.settings;
  const perm = notifPermission();
  const pcfg = pushConfig();
  const pushSub = pcfg ? (pcfg.error ? `Błąd: ${pcfg.error}` : pcfg.syncedAt ? `Połączono. Ostatnio: ${new Date(pcfg.syncedAt).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}.` : 'Połączono.') : 'Przypomnienia także przy zamkniętej aplikacji.';
  const standalone = isStandalone();
  const notifSub = !notifSupported() ? 'Ta przeglądarka nie obsługuje powiadomień.' : perm === 'granted' ? 'Włączone.' : perm === 'denied' ? 'Zablokowane. Włącz w Ustawieniach iPhone\'a.' : standalone ? 'Włącz, żeby dostawać przypomnienia.' : 'Najpierw dodaj aplikację do ekranu początkowego.';
  const catRows = state.cats.map((c) => `<button type="button" class="row" data-act="edit-cat" data-id="${c.id}">${glyphHtml(glyphFor({ cat: c.id }), 'xs')}<span class="rt"><b>${esc(c.name)}</b></span><span class="val">${state.events.filter((e) => e.cat === c.id).length}</span></button>`).join('');
  const go = (ico, col, title, sub, act) => `<button type="button" class="row" ${act}><span class="tile-s" style="--c:${col}"><span class="ico">${ico}</span></span><span class="rt"><b>${title}</b>${sub ? `<small>${sub}</small>` : ''}</span><span class="ico chev">${ICON.chevR}</span></button>`;
  const bk = backupInfo();
  const bkSub = !pcfg ? 'Wymaga połączenia z serwerem' : bk.err ? esc(bk.err) : backupOn() ? (bk.at ? `Włączona. Ostatnio: ${new Date(bk.at).toLocaleString('pl-PL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : 'Włączona') : 'Szyfrowana kopia ostatnich 7 dni';
  const buf = s.buffer?.def || 0;
  return `<header class="page-h"><h1>Więcej</h1></header>
  <section class="sec first"><div class="sec-h"><h2>Ty</h2></div><div class="list">
    <div class="row"><span class="ico">${ICON.person}</span><span class="rt"><b>Jak mam się do Ciebie zwracać</b><small>Powitanie i asystent</small></span><input type="text" data-in="displayName" value="${esc(s.displayName || '')}" maxlength="24" placeholder="Imię" autocapitalize="words" autocomplete="off" style="max-width:112px;text-align:right" aria-label="Jak mam się do Ciebie zwracać"></div>
    <div class="row col"><span class="rt"><b>Kolor moich wpisów</b><small>Ten kolor mają wszystkie Twoje wpisy</small></span><div class="pcs">${colorChips(s.share.color)}</div></div>
  </div></section>
  <section class="sec"><div class="sec-h"><h2>Asystent i planowanie</h2></div><div class="list">
    ${go(ICON.sparkle, '#FF3FA4', 'Centrum AI', 'Zapytaj albo zmień plan', 'data-act="ai-open"')}
    ${go(ICON.brain, '#A45CFF', 'Pamięć preferencji', 'Co asystent wie o Twoich nawykach', 'data-act="prefs"')}
    ${go(ICON.clock, '#19C8FF', 'Znajdź wolny termin', 'Pierwsze wolne okna', 'data-act="find-slot"')}
    ${go(ICON.bolt, '#FFC400', 'Bufory czasowe', buf ? `Domyślnie ${buf} min wokół wydarzeń` : 'Margines przed i po wydarzeniach', 'data-act="buffers"')}
    ${go(ICON.bolt, '#FFC400', 'Automatyzacje', 'Briefy i reguły jeśli–to', 'data-act="tab" data-tab="auto"')}
    ${go(ICON.bars, '#2E8BFF', 'Statystyki', 'Czas, zadania, porównania', 'data-act="tab" data-tab="stats"')}
    ${go(ICON.users, '#A45CFF', 'Wspólny kalendarz', 'Zaproszenia, zadania, zakupy', 'data-act="tab" data-tab="shared"')}
  </div></section>
  <section class="sec"><div class="sec-h"><h2>Powiadomienia</h2></div>
    <div class="list">
      <div class="row"><span class="ico">${ICON.bell}</span><span class="rt"><b>Przypomnienia na telefonie</b><small>${esc(notifSub)}</small></span>${perm === 'default' && notifSupported() ? '<button type="button" class="btn small primary" data-act="enable-notif">Włącz</button>' : perm === 'granted' ? '<button type="button" class="btn small" data-act="test-notif">Test</button>' : ''}</div>
      <div class="row"><span class="ico">${ICON.bell}</span><span class="rt"><b>Połączenie z serwerem</b><small>${esc(pushSub)}</small></span>${pcfg ? (pcfg.error ? '<button type="button" class="btn small primary" data-act="push-connect">Połącz ponownie</button>' : '<button type="button" class="btn small" data-act="push-test">Test</button>') + '<button type="button" class="btn small" data-act="push-disconnect">Rozłącz</button>' : pushSupported() && standalone ? '<button type="button" class="btn small primary" data-act="push-connect">Połącz</button>' : ''}</div>
      ${pcfg ? `<div class="row"><span class="ico">${ICON.cal}</span><span class="rt"><b>Widgety (Scriptable)</b><small>Plan dnia na ekranie blokady i głównym</small></span><button type="button" class="btn small" data-act="copy-widget">Kopiuj skrypt</button></div>` : ''}
      <div class="row"><span class="ico">${ICON.today}</span><span class="rt"><b>Licznik na ikonie</b></span><select data-in="badge" aria-label="Licznik na ikonie"><option value="off" ${s.badge === 'off' ? 'selected' : ''}>Wyłączony</option><option value="events" ${s.badge === 'events' ? 'selected' : ''}>Wydarzenia</option><option value="all" ${s.badge === 'all' ? 'selected' : ''}>Wydarzenia i zadania</option></select></div>
      <div class="row"><span class="ico">${ICON.clock}</span><span class="rt"><b>Domyślne przypomnienie</b></span><select data-in="defaultRemind" data-arr="1" aria-label="Domyślne przypomnienie">${[[[], 'Brak'], [[0], 'W chwili startu'], [[5], '5 min'], [[10], '10 min'], [[15], '15 min'], [[30], '30 min'], [[60], '1 godz.']].map(([v, l]) => `<option value='${JSON.stringify(v)}' ${JSON.stringify(s.defaultRemind) === JSON.stringify(v) ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
    </div>
    ${!standalone ? '<p class="note"><b>Instalacja:</b> w Safari dotknij Udostępnij, potem „Dodaj do ekranu początkowego”.</p>' : ''}
  </section>
  <section class="sec"><div class="sec-h"><h2>Ustawienia</h2></div>
    <div class="list">
      <div class="row"><span class="rt"><b>Tydzień zaczyna się</b></span><div class="seg">${[[1, 'Pon'], [0, 'Ndz']].map(([k, l]) => `<button type="button" class="${s.weekStart === k ? 'on' : ''}" data-act="set" data-k="weekStart" data-v="${k}" data-num="1">${l}</button>`).join('')}</div></div>
      <div class="row"><span class="rt"><b>Godziny dnia</b><small>Dla asystenta i wolnych okien</small></span><input type="time" data-in="dayStart" value="${s.dayStart}" aria-label="Początek dnia"><input type="time" data-in="dayEnd" value="${s.dayEnd}" aria-label="Koniec dnia"></div>
      <div class="row"><span class="ico">${ICON.pin}</span><span class="rt"><b>Pogoda wg lokalizacji</b><small>${s.autoLoc ? (s.locDenied ? 'Brak zgody na lokalizację w Ustawieniach iOS.' : `Miasto ustala się samo: ${esc(s.city.name)}`) : 'Wyłączone'}</small></span><button type="button" class="switch ${s.autoLoc ? 'on' : ''}" role="switch" aria-checked="${!!s.autoLoc}" data-tog="autoLoc"></button></div>
      <button type="button" class="row" data-act="city"><span class="ico">${ICON.cloud}</span><span class="rt"><b>Pogoda</b><small>${esc(s.city.name)}</small></span><span class="val">Zmień</span></button>
      <button type="button" class="row" data-act="lock-setup"><span class="ico">${ICON.shield}</span><span class="rt"><b>Blokada Face ID</b><small>${lockSummary()}</small></span><span class="val">${lockOn() ? 'Wł.' : 'Wył.'}</span></button>
    </div>
  </section>
  <section class="sec"><div class="sec-h"><h2>Kategorie</h2><button type="button" class="link" data-act="edit-cat" data-id="">Nowa</button></div><div class="list">${catRows}</div></section>
  <section class="sec"><div class="sec-h"><h2>Kopie i dane</h2></div>
    <div class="list">
      ${go(ICON.shield, '#27E05F', 'Kopia na serwerze', bkSub, 'data-act="backup"')}
      ${go(ICON.history, '#19C8FF', 'Historia zmian', 'Cofnij kilka kroków', 'data-act="history"')}
      <button type="button" class="row" data-act="export"><span class="ico">${ICON.download}</span><span class="rt"><b>Zapisz kopię do pliku</b></span></button>
      <button type="button" class="row" data-act="import"><span class="ico">${ICON.upload}</span><span class="rt"><b>Wczytaj kopię z pliku</b></span></button>
      <button type="button" class="row" data-act="import-ics"><span class="ico">${ICON.upload}</span><span class="rt"><b>Importuj plik .ics</b></span></button>
      <button type="button" class="row" data-act="export-ics"><span class="ico">${ICON.cal}</span><span class="rt"><b>Eksportuj plik .ics</b></span></button>
      <button type="button" class="row" data-act="wipe"><span class="ico" style="color:var(--danger)">${ICON.trash}</span><span class="rt"><b style="color:var(--danger)">Usuń wszystkie dane</b></span></button>
    </div>
  </section>
  <div class="spacer"></div>`;
}
