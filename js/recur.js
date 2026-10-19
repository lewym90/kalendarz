// Rozwijanie wydarzeń (także powtarzalnych) do konkretnych wystąpień w zadanym zakresie.
import { parseDT, ymd, startOfDay, addDays, startOfWeek, diffDays, addMinutes } from './util.js';

const daysInMonth = (y, m) => new Date(y, m + 1, 0).getDate();

function matches(rule, s0, d) {
  const interval = Math.max(1, rule.interval || 1);
  if (diffDays(d, s0) < 0) return false;
  switch (rule.freq) {
    case 'daily':
      return diffDays(d, s0) % interval === 0;
    case 'weekly': {
      const byday = rule.byday?.length ? rule.byday : [s0.getDay()];
      const weeks = Math.round(diffDays(startOfWeek(d, 1), startOfWeek(s0, 1)) / 7);
      return weeks % interval === 0 && byday.includes(d.getDay());
    }
    case 'monthly': {
      const months = (d.getFullYear() - s0.getFullYear()) * 12 + d.getMonth() - s0.getMonth();
      return months >= 0 && months % interval === 0 && d.getDate() === Math.min(s0.getDate(), daysInMonth(d.getFullYear(), d.getMonth()));
    }
    case 'yearly': {
      const years = d.getFullYear() - s0.getFullYear();
      return years >= 0 && years % interval === 0 && d.getMonth() === s0.getMonth() && d.getDate() === Math.min(s0.getDate(), daysInMonth(d.getFullYear(), d.getMonth()));
    }
    default:
      return false;
  }
}

export function eventSpan(ev) {
  const s = parseDT(ev.start);
  let e = parseDT(ev.end || ev.start);
  if (e < s) e = addMinutes(s, 30);
  return { s, e };
}

// from: włącznie, to: wyłącznie.
export function instancesInRange(events, from, to) {
  const out = [];
  for (const ev of events) {
    const { s, e } = eventSpan(ev);
    const dur = e - s;
    if (!ev.rrule) {
      const overlap = dur > 0 ? s < to && e > from : s >= from && s < to;
      if (overlap) out.push(make(ev, s, e, false));
      continue;
    }
    const until = ev.rrule.until ? addDays(startOfDay(new Date(ev.rrule.until + 'T00:00')), 1) : null;
    const ex = new Set(ev.exdates || []);
    let d = startOfDay(new Date(Math.max(startOfDay(new Date(from.getTime() - dur)).getTime(), startOfDay(s).getTime())));
    for (; d < to; d = addDays(d, 1)) {
      if (until && d >= until) break;
      if (!matches(ev.rrule, s, d)) continue;
      const is = new Date(d.getFullYear(), d.getMonth(), d.getDate(), s.getHours(), s.getMinutes());
      const ie = new Date(is.getTime() + dur);
      if (ex.has(ymd(is))) continue;
      const overlap = dur > 0 ? is < to && ie > from : is >= from && is < to;
      if (overlap) out.push(make(ev, is, ie, true));
    }
  }
  return out.sort((a, b) => a.start - b.start || b.end - a.end);
}

function make(ev, start, end, recurring) {
  const date = ymd(start);
  return { ev, id: ev.id, date, start, end, allDay: !!ev.allDay, recurring, key: `${ev.id}@${date}` };
}

export function instancesOnDay(events, day) {
  const from = startOfDay(day);
  return instancesInRange(events, from, addDays(from, 1));
}

// Układ kolumnowy dla nakładających się bloków w siatce godzin.
export function layoutColumns(items) {
  const sorted = [...items].sort((a, b) => a.sMin - b.sMin || b.eMin - a.eMin);
  const groups = [];
  let cur = null;
  for (const it of sorted) {
    if (!cur || it.sMin >= cur.end) {
      cur = { items: [], end: it.eMin };
      groups.push(cur);
    }
    cur.items.push(it);
    cur.end = Math.max(cur.end, it.eMin);
  }
  for (const g of groups) {
    const cols = [];
    for (const it of g.items) {
      let c = cols.findIndex((last) => last <= it.sMin);
      if (c < 0) { c = cols.length; cols.push(0); }
      cols[c] = it.eMin;
      it.col = c;
    }
    g.items.forEach((it) => { it.cols = cols.length; });
  }
  return sorted;
}

// Opis powtarzania po polsku.
export function describeRule(rule, startDate) {
  if (!rule) return 'Nie powtarza się';
  const n = rule.interval || 1;
  const names = ['niedziele', 'poniedziałki', 'wtorki', 'środy', 'czwartki', 'piątki', 'soboty'];
  let txt;
  switch (rule.freq) {
    case 'daily': txt = n === 1 ? 'Codziennie' : `Co ${n} dni`; break;
    case 'weekly': {
      const days = rule.byday?.length ? [...rule.byday] : [startDate.getDay()];
      const sorted = days.sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
      if (sorted.length === 5 && !sorted.includes(0) && !sorted.includes(6) && n === 1) txt = 'W dni robocze';
      else if (sorted.length === 2 && sorted.includes(0) && sorted.includes(6) && n === 1) txt = 'W weekendy';
      else {
        const list = sorted.map((d) => names[d]).join(', ');
        txt = n === 1 ? `Co tydzień: ${list}` : `Co ${n} tyg.: ${list}`;
      }
      break;
    }
    case 'monthly': txt = n === 1 ? 'Co miesiąc' : `Co ${n} mies.`; break;
    case 'yearly': txt = n === 1 ? 'Co roku' : `Co ${n} lata`; break;
    default: txt = 'Powtarza się';
  }
  if (rule.until) txt += `, do ${rule.until.split('-').reverse().join('.')}`;
  return txt;
}
