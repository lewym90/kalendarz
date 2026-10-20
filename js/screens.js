// Ekrany: Dziś, Kalendarz (miesiąc, tydzień, dzień, agenda), Zadania, Centrum.
import {
  esc, ymd, parseYmd, parseDT, fmtTime, pad, addDays, addMinutes, startOfDay, startOfWeek, sameDay, diffDays, relDay, fmtDayLong, fmtDayMid, fmtCountdown, fmtDuration, clamp, ICON,
  DAYS_FULL, DAYS_SHORT, DAYS_LETTER, MONTHS, MONTHS_GEN, MONTHS_SHORT, capFirst, haptic,
} from './util.js';
import { state, catOf, effectiveReminders, updateEvent, detachOccurrence, undo, newEvent, addEvent, updateTask, batch, describeRule as describeRuleDef } from './store.js';
import { instancesInRange, layoutColumns, describeRule } from './recur.js';
import { nav, toast, rerender } from './ui.js';
import { weatherKind, cachedWeather, hourlyFor, dailyFor, isOutdoor } from './weather.js';
import { lockOn, lockSummary } from './lock.js';
import { dayInfo, nameDays, isoWeek, sunTimes } from './extras.js';
import { pushConfig, pushSupported } from './push.js';
import { peerEvents, peerList, peersOn } from './peers.js';
import { notifPermission, notifSupported, isStandalone } from './notify.js';
import { shortRemind, openEventEditor, defaultDraftFor, openQuickAdd, autoName } from './editors.js';

export const dragState = { endedAt: 0, active: false };

const plural = (n, one, few, many) => (n === 1 ? one : n % 10 >= 2 && n % 10 <= 4 && !(n % 100 >= 12 && n % 100 <= 14) ? few : many);
const hmToMin = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + (m || 0); };
const minOf = (d) => d.getHours() * 60 + d.getMinutes();

const evs = () => { const p = peerEvents(); return p.length ? state.events.concat(p) : state.events; };
const catOfEv = (ev) => (ev.peer ? { id: 'peer', name: ev.peer.name, color: ev.peer.color } : catOf(ev.cat));

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
    <div class="t">${pb}${esc(inst.title)}${inst.ev.private && !inst.ev.peer ? `<span class="ico lockmini">${ICON.lock}</span>` : ''}</div>
    <div class="s">${inst.allDay ? '<span>Cały dzień</span>' : `<span>${fmtTime(inst.start)}–${fmtTime(inst.end)}</span>`}${inst.ev.loc ? `<span>${esc(inst.ev.loc)}</span>` : ''}${inst.recurring ? `<span>${repeatMini}</span>` : ''}${wx}</div>
  </button>`;
}

function taskRow(t, today = ymd(new Date())) {
  const c = catOf(t.cat);
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
  if (h < 5) return 'night';
  if (h < 8) return 'dawn';
  if (h < 12) return 'morning';
  if (h < 17) return 'day';
  if (h < 20) return 'dusk';
  return 'night';
}

function insightsFor(timed, now, today, weather) {
  const out = [];
  for (let i = 0; i < timed.length; i++) {
    for (let j = i + 1; j < timed.length; j++) {
      const a = timed[i];
      const b = timed[j];
      if (b.start < a.end && b.end > now) {
        out.push({ warn: true, icon: 'alert', html: `<b>Nakładają się:</b> ${esc(a.title)} i ${esc(b.title)} (${fmtTime(b.start)})`, act: `data-act="open-ev" data-key="${b.key}"` });
        break;
      }
    }
    if (out.length >= 1) break;
  }
  const overdue = state.tasks.filter((t) => !t.done && t.due && t.due < ymd(today)).length;
  if (overdue) out.push({ warn: true, icon: 'tasks', html: `<b>${overdue} ${plural(overdue, 'zaległe zadanie', 'zaległe zadania', 'zaległych zadań')}</b>`, act: 'data-act="tab" data-tab="tasks"' });

  const dayStart = hmToMin(state.settings.dayStart);
  const dayEnd = hmToMin(state.settings.dayEnd);
  const from = Math.max(minOf(now), dayStart);
  if (timed.length && from < dayEnd - 60) {
    const busy = timed.map((i) => [Math.max(minOf(i.start), from), Math.min(minOf(i.end), dayEnd)]).filter(([a, b]) => b > a).sort((a, b) => a[0] - b[0]);
    const gaps = [];
    let cur = from;
    for (const [a, b] of busy) { if (a - cur >= 90) gaps.push([cur, a]); cur = Math.max(cur, b); }
    if (dayEnd - cur >= 90) gaps.push([cur, dayEnd]);
    if (gaps.length) {
      const f = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
      out.push({ icon: 'clock', act: 'data-act="find-slot"', html: `<b>Wolne okna:</b> ${gaps.slice(0, 2).map(([a, b]) => `${f(a)}–${f(b)}`).join(' i ')}` });
    }
  }
  const booked = timed.reduce((s, i) => s + (i.end - i.start) / 60000, 0);
  if (booked >= 360) out.push({ icon: 'bolt', html: `<b>Gęsty dzień:</b> ${fmtDuration(booked)} w kalendarzu` });
  return out.slice(0, 4);
}

export function renderToday() {
  const now = new Date();
  const today = startOfDay(now);
  const s = state.settings;
  const insts = instancesInRange(state.events, today, addDays(today, 1));
  const timed = insts.filter((i) => !i.allDay);
  const allday = insts.filter((i) => i.allDay);
  const phase = skyPhase(now);
  const hr = now.getHours() + now.getMinutes() / 60;
  const p = hr >= 6 && hr < 20 ? (hr - 6) / 14 : ((hr - 20 + 24) % 24) / 10;
  const orbX = 22 + p * 66;
  const orbY = 66 - Math.sin(p * Math.PI) * 22;
  const stars = phase === 'night' ? 1 : phase === 'dawn' || phase === 'dusk' ? 0.35 : 0;
  const greet = hr < 5 ? 'Późna pora' : hr < 18 ? 'Dzień dobry' : hr < 23 ? 'Dobry wieczór' : 'Dobranoc';

  // Pasek dnia
  let ds = hmToMin(s.dayStart);
  let de = hmToMin(s.dayEnd);
  for (const i of timed) {
    ds = Math.min(ds, Math.floor(minOf(i.start) / 60) * 60);
    de = Math.max(de, i.end.getDate() !== i.start.getDate() ? 1440 : Math.ceil(minOf(i.end) / 60) * 60);
  }
  ds = Math.max(0, ds); de = Math.min(1440, de);
  const total = Math.max(60, de - ds);
  const pct = (m) => clamp(((m - ds) / total) * 100, 0, 100);
  const items = timed.map((i) => ({ i, sMin: clamp(minOf(i.start), ds, de), eMin: clamp(i.end.getDate() !== i.start.getDate() ? de : minOf(i.end), ds, de) })).filter((x) => x.eMin > x.sMin);
  layoutColumns(items);
  const segs = items.map((x) => {
    const c = catOfEv(x.i.ev);
    const lh = 100 / x.cols;
    return `<i class="seg" style="--c:${c.color};left:${pct(x.sMin)}%;width:calc(${pct(x.eMin) - pct(x.sMin)}% - 2px);top:calc(${x.col * lh}% + 3px);height:calc(${lh}% - 6px)"></i>`;
  }).join('');
  const nowPct = pct(minOf(now));
  const lbl = (m) => `${Math.floor(m / 60)}:${pad(m % 60)}`;

  // Następne
  const nextInst = timed.find((i) => i.end > now);
  let nextHtml;
  if (!state.events.length && !state.tasks.length) {
    nextHtml = `<div class="next empty fade-in">
      <div class="empty-ico"><span class="ico">${ICON.sparkle}</span></div>
      <div class="cd">Co masz dziś w planach?</div>
      <div class="nt">Wystarczy jedno zdanie. Datę, godzinę i powtarzanie rozpoznam sam.</div>
      <div class="ex-chips">${['jutro 17 siłownia', 'co wtorek 9:30 dentysta', 'piątek 19 kolacja u Oli'].map((t) => `<button type="button" class="ex-chip" data-act="quick-text" data-text="${esc(t)}">${esc(t)}</button>`).join('')}</div>
      <div class="empty-act"><button type="button" class="btn primary small" data-act="quick">Dodaj wydarzenie</button><button type="button" class="btn small" data-act="sample">Wczytaj przykłady</button></div></div>`;
  } else if (nextInst) {
    const c = catOfEv(nextInst.ev);
    const live = nextInst.start <= now;
    const prog = live ? clamp(((now - nextInst.start) / (nextInst.end - nextInst.start)) * 100, 0, 100) : 0;
    nextHtml = `<button type="button" class="next fade-in" style="--c:${c.color};text-align:left;width:calc(100% - 32px)" data-act="open-ev" data-key="${nextInst.key}">
      <div class="cd">${live ? 'Trwa teraz' : fmtCountdown(nextInst.start - now)}${live ? `<small>koniec ${fmtCountdown(nextInst.end - now).replace('za ', 'za ')}</small>` : ''}</div>
      <div class="nt">${esc(nextInst.title)}</div>
      <div class="meta"><span><span class="ico">${ICON.clock}</span>${fmtTime(nextInst.start)}–${fmtTime(nextInst.end)}</span>${nextInst.ev.loc ? `<span><span class="ico">${ICON.pin}</span>${esc(nextInst.ev.loc)}</span>` : ''}<span>${esc(c.name)}</span></div>
      ${live ? `<div class="prog"><i style="width:${prog}%"></i></div>` : ''}
    </button>`;
  } else {
    const fut = instancesInRange(state.events, addDays(today, 1), addDays(today, 30)).find((i) => !i.allDay) || instancesInRange(state.events, addDays(today, 1), addDays(today, 30))[0];
    nextHtml = `<div class="next empty fade-in"><div class="cd">${timed.length || allday.length ? 'Na dziś to już wszystko' : 'Dziś masz wolne'}</div>
      <div class="nt" style="font-weight:500;color:var(--text2);font-size:16px">${fut ? `Następne: ${esc(relDay(fut.start).toLowerCase())}${fut.allDay ? '' : ', ' + fmtTime(fut.start)}, ${esc(fut.title)}` : 'Nic więcej nie zaplanowano.'}</div></div>`;
  }

  const allI = instancesInRange(evs(), today, addDays(today, 1));
  const timedA = allI.filter((i) => !i.allDay);
  const alldayA = allI.filter((i) => i.allDay);
  // Oś dnia
  let tl = '';
  if (alldayA.length) tl += `<div class="chips" style="padding:0 20px 12px">${alldayA.map((i) => `<button type="button" class="chip c" style="--c:${catOfEv(i.ev).color}" data-act="open-ev" data-key="${i.key}">${esc(i.title)}</button>`).join('')}</div>`;
  if (timedA.length) {
    let placed = false;
    const nowLine = `<div class="tl-now"><span>${fmtTime(now)}</span></div>`;
    tl += '<div class="tl">';
    const pastList = timedA.filter((i) => i.end <= now);
    if (pastList.length) tl += `<div class="tl-row"><div class="tl-time"></div><button type="button" class="past-sum" data-act="toggle-past">${pastList.length} ${plural(pastList.length, 'zakończone wydarzenie', 'zakończone wydarzenia', 'zakończonych wydarzeń')}<span class="ico" style="transform:rotate(${nav.showPast ? 270 : 90}deg)">${ICON.chevR}</span></button></div>`;
    for (const i of timedA) {
      if (i.end <= now && !nav.showPast) continue;
      if (!placed && i.start > now) { tl += nowLine; placed = true; }
      tl += `<div class="tl-row"><div class="tl-time">${fmtTime(i.start)}<small>${fmtTime(i.end)}</small></div>${evRow(i, now)}</div>`;
    }
    if (!placed) tl += nowLine;
    tl += '</div>';
  } else if (!alldayA.length) tl = '<div class="empty"><b>Dzień bez planów</b>Dodaj coś zdaniem, na przykład „dziś 18 spacer".</div>';

  const insights = insightsFor(timed, now, today, null);
  const insHtml = insights.length ? `<div class="insights" id="insights">${insights.map((x) => `<${x.act ? 'button type="button" ' + x.act : 'div'} class="insight ${x.warn ? 'warn' : ''}"><span class="ico">${ICON[x.icon]}</span><span>${x.html}</span></${x.act ? 'button' : 'div'}>`).join('')}</div>` : '<div class="insights" id="insights"></div>';

  const tdy = ymd(today);
  const dueTasks = state.tasks.filter((t) => !t.done && t.due && t.due <= tdy).sort((a, b) => b.prio - a.prio || a.due.localeCompare(b.due));
  const tasksHtml = dueTasks.length ? `<section class="sec"><div class="sec-h"><h2>Zadania na dziś</h2><button type="button" class="link" data-act="tab" data-tab="tasks">Wszystkie</button></div><div class="tasks">${dueTasks.slice(0, 5).map((t) => taskRow(t, tdy)).join('')}</div></section>` : '';

  const tomorrow = addDays(today, 1);
  const tmw = instancesInRange(evs(), tomorrow, addDays(tomorrow, 1));
  const tmwHtml = tmw.length ? `<section class="sec"><div class="sec-h"><h2>Jutro</h2><button type="button" class="link" data-act="goto-day" data-date="${ymd(tomorrow)}">Zobacz dzień</button></div><div class="tl">${tmw.slice(0, 3).map((i) => `<div class="tl-row"><div class="tl-time">${i.allDay ? '' : fmtTime(i.start)}</div>${evRow(i, now)}</div>`).join('')}${tmw.length > 3 ? `<div class="empty" style="padding:6px">i ${tmw.length - 3} więcej</div>` : ''}</div></section>` : '';

  // Pasek tygodnia
  const ws = startOfWeek(today, s.weekStart);
  const wk = instancesInRange(evs(), ws, addDays(ws, 7));
  const byDay = groupByDay(wk);
  const strip = Array.from({ length: 7 }, (_, k) => {
    const d = addDays(ws, k);
    const list = byDay.get(ymd(d)) || [];
    const cols = [...new Set(list.map((i) => catOfEv(i.ev).color))].slice(0, 3);
    return `<button type="button" class="wd ${sameDay(d, today) ? 'today' : ''}" data-act="goto-day" data-date="${ymd(d)}"><span class="l">${DAYS_SHORT[d.getDay()]}</span><span class="n">${d.getDate()}</span><span class="dots">${cols.map((c) => `<i style="--c:${c}"></i>`).join('')}</span></button>`;
  }).join('');

  return `
  <header class="sky" data-phase="${phase}" style="--orb-x:${orbX}%;--orb-y:${orbY}%;--stars:${stars}">
    <div class="sky-stars"></div>
    <div class="sky-top">
      <div class="greet">${greet}</div>
      <div class="sky-actions">
        <button type="button" class="pill-btn" id="wx" data-act="weather" aria-label="Pogoda"><span class="ico">${ICON.cloud}</span><span id="wx-t">Pogoda</span></button>
        <button type="button" class="icon-btn" data-act="search" aria-label="Szukaj"><span class="ico">${ICON.search}</span></button>
      </div>
    </div>
    <h1 class="date-hero"><span class="dnum">${now.getDate()}</span><span class="dtxt"><span class="dow">${DAYS_FULL[now.getDay()]}</span><span class="mon">${MONTHS_GEN[now.getMonth()]} ${now.getFullYear()}</span></span></h1>
    <div class="hero-meta">${dayMeta(now, { week: true })}</div>
    <div class="daybar" aria-hidden="true">${segs}<span class="past" style="width:${nowPct}%"></span><span class="now" style="left:calc(${nowPct}% - 1px)"></span></div>
    <div class="daybar-lbl"><span>${lbl(ds)}</span><span>${lbl(Math.round((ds + de) / 2 / 30) * 30)}</span><span>${lbl(de)}</span></div>
  </header>
  ${nextHtml}
  ${insHtml}
  <section class="sec"><div class="sec-h"><h2>Plan dnia</h2><button type="button" class="link" data-act="goto-day" data-date="${ymd(today)}">Pełny widok</button></div>${tl}</section>
  ${tasksHtml}
  ${tmwHtml}
  <section class="sec"><div class="sec-h"><h2>Ten tydzień</h2><button type="button" class="link" data-act="goto-week">Otwórz</button></div><div class="weekstrip">${strip}</div></section>
  <div class="spacer"></div>`;
}

export function paintWeather(w) {
  const t = document.getElementById('wx-t');
  const b = document.getElementById('wx');
  if (!t || !b) return;
  if (!w) { t.textContent = state.settings.city.name; return; }
  b.querySelector('.ico').innerHTML = wIcon(w.code);
  t.textContent = `${w.temp}°  ${state.settings.city.name}`;
  b.title = `${weatherKind(w.code).label}, odczuwalna ${w.feels}°, dziś ${w.lo}° do ${w.hi}°`;
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

export function renderCal() {
  const v = nav.calView;
  const head = `<header class="cal-head" id="cal-head">
    <div class="cal-title"><h1>${calTitle()}</h1>
      <div class="cal-nav">
        <button type="button" class="round" data-act="search" aria-label="Szukaj"><span class="ico">${ICON.search}</span></button>
        ${v === 'agenda' ? '' : `<button type="button" class="round" data-act="cal-prev" aria-label="Poprzedni"><span class="ico">${ICON.chevL}</span></button><button type="button" class="round" data-act="cal-next" aria-label="Następny"><span class="ico">${ICON.chevR}</span></button>`}
      </div></div>
    <div class="cal-views"><div class="seg">${[['month', 'Miesiąc'], ['week', 'Tydzień'], ['3day', '3 dni'], ['day', 'Dzień'], ['agenda', 'Agenda']].map(([k, l]) => `<button type="button" class="${v === k ? 'on' : ''}" data-act="calview" data-v="${k}">${l}</button>`).join('')}</div>${v === 'agenda' ? '' : '<button type="button" class="btn small" data-act="cal-today">Dziś</button>'}</div>
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
  const insts = instancesInRange(evs(), gridStart, addDays(gridStart, weeks * 7));
  const by = groupByDay(insts);
  const head = Array.from({ length: 7 }, (_, k) => `<div>${DAYS_SHORT[(ws + k) % 7]}</div>`).join('');
  let cells = '';
  for (let k = 0; k < weeks * 7; k++) {
    const d = addDays(gridStart, k);
    const list = by.get(ymd(d)) || [];
    const n = list.length;
    const cols = [...new Set(list.map((i) => catOfEv(i.ev).color))].slice(0, 3);
    const heat = n >= 5 ? 3 : n >= 3 ? 2 : n >= 1 ? 1 : 0;
    const hi = dayInfo(d);
    cells += `<button type="button" class="mcell ${hi?.off ? 'hol' : ''} ${d.getMonth() !== c.getMonth() ? 'out' : ''} ${sameDay(d, now) ? 'today' : ''} ${sameDay(d, nav.selected) ? 'sel' : ''} ${heat ? 'heat' + heat : ''}" data-act="pick-day" data-date="${ymd(d)}" aria-label="${fmtDayLong(d)}${n ? ', ' + n + ' wydarzeń' : ''}"><span class="n">${d.getDate()}</span><span class="dots">${cols.map((x) => `<i style="--c:${x}"></i>`).join('')}${n > 3 ? `<span class="more">+</span>` : ''}</span></button>`;
  }
  const sel = nav.selected;
  const dayList = (by.get(ymd(sel)) || instancesInRange(evs(), startOfDay(sel), addDays(startOfDay(sel), 1)));
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
  const insts = instancesInRange(evs(), from, to);
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
  const tray = trayTasks.length ? `<div class="tray ${ncols === 3 ? 'three' : ''}"><div class="tray-l"><span class="tray-lbl" title="Przytrzymaj zadanie i upuść na osi czasu">Zablokuj czas:</span>${trayTasks.map((t) => `<span class="tk" style="--c:${catOf(t.cat).color}" data-task="${t.id}">${esc(t.title)}</span>`).join('')}</div></div>` : '';
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
  const insts = instancesInRange(evs(), today, to);
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

// ---------- Centrum ----------
const sw = (path, on) => `<button type="button" class="switch ${on ? 'on' : ''}" role="switch" aria-checked="${on}" data-tog="${path}"></button>`;

const SHARE_COLORS = ['#34d3ff', '#ff6fb5', '#3fd08a', '#ffbf3f', '#9a6bff', '#ff6a6a', '#3ee0c8', '#a9a9c4'];
function shareSection() {
  const sh = state.settings.share;
  const peers = peerList();
  const sw = (path, on) => `<button type="button" class="switch ${on ? 'on' : ''}" role="switch" aria-checked="${on}" data-tog="${path}"></button>`;
  const sub = !sh.name ? 'Wpisz swoje imię, żeby inni widzieli, czyje to wpisy.' : peers.length ? `Widzisz: ${peers.map((p) => esc(p.name)).join(', ')}` : sh.view ? 'Nikt jeszcze nie udostępnia kalendarza.' : 'Włącz, żeby zobaczyć wpisy drugiej osoby.';
  return `<section class="sec"><div class="sec-h"><h2>Wspólny kalendarz</h2></div>
    <div class="list">
      <div class="row"><span class="ico">${ICON.today}</span><span class="rt"><b>Moje imię</b><small>Tak będą podpisane Twoje wpisy</small></span><input type="text" data-in="share.name" value="${esc(sh.name)}" maxlength="24" placeholder="np. Marek" autocapitalize="words" autocomplete="off" style="max-width:130px;text-align:right" aria-label="Moje imię"></div>
      <div class="row" style="flex-wrap:wrap"><span class="rt"><b>Mój kolor</b></span><div class="chips">${SHARE_COLORS.map((c) => `<button type="button" class="chip ${sh.color === c ? 'on' : ''}" style="padding:0;width:34px;justify-content:center;background:${c}" data-act="share-color" data-v="${c}" aria-label="Kolor ${c}">${sh.color === c ? `<span class="ico" style="color:#fff">${ICON.check}</span>` : ''}</button>`).join('')}</div></div>
      <div class="row"><span class="ico">${ICON.cal}</span><span class="rt"><b>Udostępniaj mój kalendarz</b><small>Inni zobaczą Twoje wydarzenia (prywatne jako „Zajęte")</small></span>${sw('share.on', sh.on)}</div>
      <div class="row"><span class="ico">${ICON.today}</span><span class="rt"><b>Pokaż kalendarz drugiej osoby</b><small>${sub}</small></span>${sw('share.view', sh.view)}</div>
    </div></section>`;
}

export function renderHub() {
  const s = state.settings;
  const now = new Date();
  const ws = startOfWeek(now, s.weekStart);
  const wk = instancesInRange(state.events, ws, addDays(ws, 7));
  const hoursPer = Array(7).fill(0);
  let hoursTotal = 0;
  wk.forEach((i) => {
    if (i.allDay) return;
    const h = (i.end - i.start) / 3600000;
    hoursTotal += h;
    hoursPer[(i.start.getDay() - s.weekStart + 7) % 7] += h;
  });
  const maxH = Math.max(1, ...hoursPer);
  const busiest = hoursPer.indexOf(Math.max(...hoursPer));
  const bars = hoursPer.map((h, k) => {
    const d = addDays(ws, k);
    return `<div class="${sameDay(d, now) ? 't' : ''}"><i style="height:${Math.max(4, (h / maxH) * 100)}%"></i><span>${DAYS_LETTER[d.getDay()]}</span></div>`;
  }).join('');
  const perm = notifPermission();
  const pcfg = pushConfig();
  const pushSub = pcfg ? (pcfg.error ? `Błąd: ${pcfg.error}` : pcfg.syncedAt ? `Połączono. Ostatnia synchronizacja: ${new Date(pcfg.syncedAt).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}.` : 'Połączono.') : 'Przypomnienia także przy zamkniętej aplikacji (własny serwer).';
  const standalone = isStandalone();
  const notifSub = !notifSupported() ? 'Ta przeglądarka nie obsługuje powiadomień.' : perm === 'granted' ? 'Włączone. Przypomnienia pojawią się na ekranie blokady.' : perm === 'denied' ? 'Zablokowane. Włącz w Ustawieniach iPhone\'a, w sekcji Powiadomienia.' : standalone ? 'Włącz, żeby dostawać przypomnienia i poranny brief.' : 'Najpierw dodaj aplikację do ekranu początkowego.';
  const catRows = state.cats.map((c) => `<button type="button" class="row" data-act="edit-cat" data-id="${c.id}"><span class="catdot" style="--c:${c.color};padding:0;height:auto;background:none"></span><span class="rt"><b>${esc(c.name)}</b></span><span class="val">${state.events.filter((e) => e.cat === c.id).length}</span></button>`).join('');
  const ruleRows = state.rules.map((r) => `<div class="row"><button type="button" class="rt" data-act="edit-rule" data-id="${r.id}" style="text-align:left"><b>${esc(r.name || autoName(r))}</b><small>Jeśli: ${esc(describeRuleDef(r))}</small></button>${sw(`rule:${r.id}`, r.on)}</div>`).join('');
  const w = s.weekly;

  return `<header class="page-h"><h1>Centrum</h1><p>Automatyzacje, powiadomienia i wygląd</p></header>
  <div class="spacer"></div>
  <button type="button" class="stat-card" data-act="stats" style="display:block;width:calc(100% - 32px);text-align:left"><div class="big">${wk.length}<small>${plural(wk.length, 'wydarzenie', 'wydarzenia', 'wydarzeń')} w tym tygodniu</small></div>
    <div style="color:var(--text2);font-size:14px;margin-top:8px">${hoursTotal ? `${fmtDuration(hoursTotal * 60)} w kalendarzu. Najgęstszy dzień: ${DAYS_FULL[addDays(ws, busiest).getDay()]}.` : 'Ten tydzień jest jeszcze pusty.'}</div>
    <div class="bars">${bars}</div><div class="stat-more">Statystyki i porównanie tygodni ›</div></button>

  <section class="sec"><div class="sec-h"><h2>Narzędzia</h2></div>
    <div class="list">
      <button type="button" class="row" data-act="find-slot"><span class="ico">${ICON.clock}</span><span class="rt"><b>Znajdź wolny termin</b><small>Pierwsze wolne okna między wydarzeniami</small></span></button>
      <button type="button" class="row" data-act="stats"><span class="ico">${ICON.bolt}</span><span class="rt"><b>Statystyki</b><small>Czas wg kategorii i porównanie z poprzednim okresem</small></span></button>
      <button type="button" class="row" data-act="lock-setup"><span class="ico">${ICON.lock || ICON.check}</span><span class="rt"><b>Blokada Face ID</b><small>${lockSummary()}</small></span><span class="val">${lockOn() ? 'Wł.' : 'Wył.'}</span></button>
    </div>
  </section>

  <section class="sec"><div class="sec-h"><h2>Automatyzacje</h2></div>
    <div class="list">
      <div class="row"><span class="ico">${ICON.sun}</span><span class="rt"><b>Poranny brief</b><small>Podsumowanie dnia na starcie</small></span><input type="time" data-in="morning.time" value="${s.morning.time}" aria-label="Godzina porannego briefu">${sw('morning.on', s.morning.on)}</div>
      <div class="row"><span class="ico">${ICON.moon}</span><span class="rt"><b>Podgląd jutra</b><small>Wieczorem, co Cię czeka rano</small></span><input type="time" data-in="evening.time" value="${s.evening.time}" aria-label="Godzina wieczornego podglądu">${sw('evening.on', s.evening.on)}</div>
      <div class="row"><span class="ico">${ICON.sparkle}</span><span class="rt"><b>Przegląd tygodnia</b><small><select data-in="weekly.day" data-num="1" aria-label="Dzień przeglądu">${[1, 2, 3, 4, 5, 6, 0].map((d) => `<option value="${d}" ${w.day === d ? 'selected' : ''}>${DAYS_FULL[d]}</option>`).join('')}</select></small></span><input type="time" data-in="weekly.time" value="${w.time}" aria-label="Godzina przeglądu tygodnia">${sw('weekly.on', w.on)}</div>
      <div class="row"><span class="ico">${ICON.repeat}</span><span class="rt"><b>Przenoś zaległe zadania</b><small>Niezrobione zadania same wskakują na dziś</small></span>${sw('rollover', s.rollover)}</div>
    </div>
    <div class="sec-h" style="padding-top:20px"><h2 style="font-size:19px">Reguły</h2><button type="button" class="link" data-act="edit-rule" data-id="">Nowa reguła</button></div>
    <div class="list">${ruleRows || '<div class="empty">Brak reguł. Dodaj pierwszą.</div>'}</div>
    <p class="note">Reguły działają na bieżąco: jeśli wydarzenie spełnia warunek, dostaje dodatkowe przypomnienie albo kategorię.</p>
  </section>

  <section class="sec"><div class="sec-h"><h2>Powiadomienia</h2></div>
    <div class="list">
      <div class="row"><span class="ico">${ICON.bell}</span><span class="rt"><b>Przypomnienia na telefonie</b><small>${esc(notifSub)}</small></span>${perm === 'default' && notifSupported() ? '<button type="button" class="btn small primary" data-act="enable-notif">Włącz</button>' : perm === 'granted' ? '<button type="button" class="btn small" data-act="test-notif">Test</button>' : ''}</div>
      <div class="row"><span class="ico">${ICON.bell}</span><span class="rt"><b>Powiadomienia z serwera</b><small>${esc(pushSub)}</small></span>${pcfg ? (pcfg.error ? '<button type="button" class="btn small primary" data-act="push-connect">Połącz ponownie</button>' : '<button type="button" class="btn small" data-act="push-test">Test</button>') + '<button type="button" class="btn small" data-act="push-disconnect">Rozłącz</button>' : pushSupported() && standalone ? '<button type="button" class="btn small primary" data-act="push-connect">Połącz</button>' : ''}</div>
      ${pcfg ? `<div class="row"><span class="ico">${ICON.cal}</span><span class="rt"><b>Widget (Scriptable)</b><small>Plan dnia na ekranie blokady i głównym. Skopiuj skrypt i wklej go w aplikacji Scriptable.</small></span><button type="button" class="btn small" data-act="copy-widget">Kopiuj skrypt</button></div>` : ''}
      <div class="row"><span class="ico">${ICON.today}</span><span class="rt"><b>Licznik na ikonie</b><small>Ile rzeczy czeka dziś</small></span><select data-in="badge" aria-label="Licznik na ikonie"><option value="off" ${s.badge === 'off' ? 'selected' : ''}>Wyłączony</option><option value="events" ${s.badge === 'events' ? 'selected' : ''}>Wydarzenia</option><option value="all" ${s.badge === 'all' ? 'selected' : ''}>Wydarzenia i zadania</option></select></div>
      <div class="row"><span class="ico">${ICON.clock}</span><span class="rt"><b>Domyślne przypomnienie</b><small>Dla nowych wydarzeń</small></span><select data-in="defaultRemind" data-arr="1" aria-label="Domyślne przypomnienie">${[[[], 'Brak'], [[0], 'W chwili startu'], [[5], '5 min'], [[10], '10 min'], [[15], '15 min'], [[30], '30 min'], [[60], '1 godz.']].map(([v, l]) => `<option value='${JSON.stringify(v)}' ${JSON.stringify(s.defaultRemind) === JSON.stringify(v) ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
    </div>
    ${pcfg ? shareSection() : ''}
    ${!standalone ? `<p class="note"><b>Instalacja:</b> w Safari dotknij Udostępnij, potem „Dodaj do ekranu początkowego". Dopiero wtedy iOS pozwala na powiadomienia i licznik na ikonie.</p>` : ''}
    <p class="note">Wibracje przy powiadomieniach zależą od systemu: w Ustawienia, Dźwięki i haptyka, włącz „Odtwarzaj haptykę w trybie cichym".</p>
  </section>

  <section class="sec"><div class="sec-h"><h2>Wygląd</h2></div>
    <div class="list">
      <div class="row"><span class="rt"><b>Motyw</b></span><div class="seg">${[['auto', 'Auto'], ['dark', 'Ciemny'], ['light', 'Jasny']].map(([k, l]) => `<button type="button" class="${s.theme === k ? 'on' : ''}" data-act="set" data-k="theme" data-v="${k}">${l}</button>`).join('')}</div></div>
      <div class="row" style="flex-wrap:wrap"><span class="rt"><b>Tło</b></span><div class="skins" style="width:100%;margin-top:10px">${[['dusk', 'Zmierzch', '#131029'], ['midnight', 'Północ', '#000000'], ['ink', 'Atrament', '#0e1522'], ['wine', 'Wino', '#1d0d17'], ['forest', 'Las', '#0b1a15'], ['paper', 'Papier', '#f6f1e7']].map(([k, l, c]) => `<button type="button" class="skin ${(s.skin || 'dusk') === k ? 'on' : ''}" data-act="set" data-k="skin" data-v="${k}"><i style="--c:${c}"></i>${l}</button>`).join('')}</div>${(s.skin || 'dusk') === 'paper' ? '<small style="color:var(--text3);margin-top:8px;display:block;width:100%">Papier działa w jasnym motywie.</small>' : ''}</div>
      <div class="row" style="flex-wrap:wrap"><span class="rt"><b>Kolor akcentu</b></span><div class="chips">${[['zorza', '#ff6a6a'], ['roza', '#ff6fb5'], ['zloto', '#ffbf3f'], ['las', '#3fd08a'], ['mieta', '#3ee0c8'], ['ocean', '#3aa0ff'], ['fiolet', '#9a6bff'], ['grafit', '#a9a9c4']].map(([k, c]) => `<button type="button" class="chip ${!s.accentCustom && s.accent === k ? 'on' : ''}" style="padding:0;width:34px;justify-content:center;background:${c}" data-act="set" data-k="accent" data-v="${k}" aria-label="Akcent ${k}">${!s.accentCustom && s.accent === k ? `<span class="ico" style="color:#fff">${ICON.check}</span>` : ''}</button>`).join('')}<label class="colorpick ${s.accentCustom ? 'on' : ''}" aria-label="Własny kolor"><input type="color" data-in="accentCustom" value="${s.accentCustom || '#ff6a6a'}"></label></div></div>
      <div class="row"><span class="rt"><b>Tydzień zaczyna się</b></span><div class="seg">${[[1, 'Pon'], [0, 'Ndz']].map(([k, l]) => `<button type="button" class="${s.weekStart === k ? 'on' : ''}" data-act="set" data-k="weekStart" data-v="${k}" data-num="1">${l}</button>`).join('')}</div></div>
      <div class="row"><span class="rt"><b>Pasek dnia</b><small>Zakres godzin na ekranie Dziś</small></span><input type="time" data-in="dayStart" value="${s.dayStart}" aria-label="Początek dnia"><input type="time" data-in="dayEnd" value="${s.dayEnd}" aria-label="Koniec dnia"></div>
      <button type="button" class="row" data-act="city"><span class="ico">${ICON.cloud}</span><span class="rt"><b>Pogoda</b><small>${esc(s.city.name)}</small></span><span class="val">Zmień</span></button>
    </div>
  </section>

  <section class="sec"><div class="sec-h"><h2>Kategorie</h2><button type="button" class="link" data-act="edit-cat" data-id="">Nowa</button></div><div class="list">${catRows}</div></section>

  <section class="sec"><div class="sec-h"><h2>Dane</h2></div>
    <div class="list">
      <button type="button" class="row" data-act="export"><span class="ico">${ICON.download}</span><span class="rt"><b>Zapisz kopię zapasową</b><small>Plik JSON ze wszystkim, co masz w aplikacji</small></span></button>
      <button type="button" class="row" data-act="import"><span class="ico">${ICON.upload}</span><span class="rt"><b>Wczytaj kopię</b><small>Przywróć dane z pliku JSON</small></span></button>
      <button type="button" class="row" data-act="import-ics"><span class="ico">${ICON.upload}</span><span class="rt"><b>Importuj plik .ics</b><small>Wydarzenia z innych kalendarzy (bez duplikatów)</small></span></button>
      <button type="button" class="row" data-act="export-ics"><span class="ico">${ICON.cal}</span><span class="rt"><b>Eksport do pliku .ics</b><small>Do innych kalendarzy</small></span></button>
      <button type="button" class="row" data-act="sample"><span class="ico">${ICON.sparkle}</span><span class="rt"><b>Wczytaj przykładowe dane</b><small>Żeby zobaczyć, jak to wygląda w akcji</small></span></button>
      <button type="button" class="row" data-act="wipe"><span class="ico" style="color:var(--danger)">${ICON.trash}</span><span class="rt"><b style="color:var(--danger)">Usuń wszystkie dane</b></span></button>
    </div>
    <p class="note">Dane są zapisane tylko w tym telefonie. Rób kopię zapasową co jakiś czas, zwłaszcza przed zmianą telefonu.</p>
  </section>
  <div class="spacer"></div>`;
}
