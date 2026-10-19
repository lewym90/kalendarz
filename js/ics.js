// Import plików .ics (iCalendar): SUMMARY, DTSTART/DTEND, RRULE, EXDATE, LOCATION, DESCRIPTION, VALARM.
import { ymd, fmtDT, addDays, startOfDay } from './util.js';
import { instancesInRange } from './recur.js';

const pad = (n) => String(n).padStart(2, '0');

function unfold(text) {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n[ \t]/g, '').split('\n');
}
const unesc = (v) => (v || '').replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');

function splitLine(line) {
  const i = (() => { let q = false; for (let k = 0; k < line.length; k++) { const c = line[k]; if (c === '"') q = !q; else if (c === ':' && !q) return k; } return -1; })();
  if (i < 0) return null;
  const head = line.slice(0, i);
  const value = line.slice(i + 1);
  const [name, ...ps] = head.split(';');
  const params = {};
  ps.forEach((p) => { const [k, ...v] = p.split('='); params[k.toUpperCase()] = v.join('=').replace(/"/g, ''); });
  return { name: name.toUpperCase(), params, value };
}

// Zwraca { date: 'YYYY-MM-DD', time: 'HH:mm'|null, allDay }. Czas z „Z" przeliczamy na lokalny.
function parseDate(value, params) {
  const v = value.trim();
  let m = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
  if (m) return { date: `${m[1]}-${m[2]}-${m[3]}`, time: null, allDay: true };
  m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/.exec(v);
  if (!m) return null;
  if (m[7]) {
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)));
    return { date: ymd(d), time: `${pad(d.getHours())}:${pad(d.getMinutes())}`, allDay: false };
  }
  void params; // TZID: traktujemy jako czas lokalny (zwykle tak jest w eksportach użytkownika)
  return { date: `${m[1]}-${m[2]}-${m[3]}`, time: `${m[4]}:${m[5]}`, allDay: false };
}

const DAY = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

function parseRRule(value, startDate) {
  const o = {};
  value.split(';').forEach((p) => { const [k, v] = p.split('='); o[k.toUpperCase()] = v; });
  const freq = { DAILY: 'daily', WEEKLY: 'weekly', MONTHLY: 'monthly', YEARLY: 'yearly' }[o.FREQ];
  if (!freq) return null;
  const rule = { freq, interval: Math.max(1, +o.INTERVAL || 1), byday: [], until: null };
  if (freq === 'weekly' && o.BYDAY) rule.byday = o.BYDAY.split(',').map((x) => DAY[x.slice(-2)]).filter((x) => x != null);
  if (o.UNTIL) { const u = parseDate(o.UNTIL, {}); if (u) rule.until = u.date; }
  if (o.COUNT && !rule.until) {
    // wyznaczamy datę ostatniego wystąpienia
    const probe = { id: 'p', start: `${startDate}T00:00`, end: `${startDate}T00:00`, rrule: { ...rule }, exdates: [] };
    const from = startOfDay(new Date(startDate + 'T00:00'));
    const list = instancesInRange([probe], from, addDays(from, 366 * 15));
    const n = +o.COUNT;
    if (list[n - 1]) rule.until = list[n - 1].date;
  }
  return rule;
}

export function parseICS(text) {
  const lines = unfold(text);
  const events = [];
  let cur = null;
  let alarm = null;
  for (const ln of lines) {
    if (ln === 'BEGIN:VEVENT') { cur = { props: [], alarms: [] }; continue; }
    if (ln === 'END:VEVENT') { if (cur) events.push(cur); cur = null; continue; }
    if (!cur) continue;
    if (ln === 'BEGIN:VALARM') { alarm = {}; continue; }
    if (ln === 'END:VALARM') { if (alarm) cur.alarms.push(alarm); alarm = null; continue; }
    const p = splitLine(ln);
    if (!p) continue;
    if (alarm) { if (p.name === 'TRIGGER') alarm.trigger = p.value; continue; }
    cur.props.push(p);
  }
  const out = [];
  for (const e of events) {
    const get = (n) => e.props.find((p) => p.name === n);
    const all = (n) => e.props.filter((p) => p.name === n);
    const ds = get('DTSTART');
    if (!ds) continue;
    const s = parseDate(ds.value, ds.params);
    if (!s) continue;
    const de = get('DTEND');
    const dur = get('DURATION');
    let end;
    if (de) {
      const x = parseDate(de.value, de.params);
      if (x) end = x;
    }
    let start;
    let endStr;
    if (s.allDay) {
      start = `${s.date}T00:00`;
      let ed = end ? end.date : s.date;
      if (end && end.allDay) ed = ymd(addDays(new Date(end.date + 'T00:00'), -1)); // DTEND jest wyłączny
      if (ed < s.date) ed = s.date;
      endStr = `${ed}T23:59`;
    } else {
      start = `${s.date}T${s.time}`;
      if (end && !end.allDay) endStr = `${end.date}T${end.time}`;
      else if (dur) {
        const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?/.exec(dur.value);
        const mins = m ? (+m[1] || 0) * 1440 + (+m[2] || 0) * 60 + (+m[3] || 0) : 60;
        const d = new Date(`${start}:00`);
        endStr = fmtDT(new Date(d.getTime() + mins * 60000));
      } else {
        const d = new Date(`${start}:00`);
        endStr = fmtDT(new Date(d.getTime() + 3600000));
      }
    }
    const rr = get('RRULE');
    const rrule = rr ? parseRRule(rr.value, s.date) : null;
    const exdates = [];
    all('EXDATE').forEach((p) => p.value.split(',').forEach((v) => { const d = parseDate(v, p.params); if (d) exdates.push(d.date); }));
    const reminders = e.alarms.map((a) => {
      const m = /^-?P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?/.exec(a.trigger || '');
      if (!m || !/^-/.test(a.trigger || '')) return a.trigger === 'PT0S' ? 0 : null;
      return (+m[1] || 0) * 1440 + (+m[2] || 0) * 60 + (+m[3] || 0);
    }).filter((x) => x != null);
    out.push({
      uid: get('UID')?.value || null,
      title: unesc(get('SUMMARY')?.value) || 'Bez nazwy',
      start, end: endStr, allDay: s.allDay,
      loc: unesc(get('LOCATION')?.value),
      notes: unesc(get('DESCRIPTION')?.value),
      rrule, exdates, reminders,
    });
  }
  return out;
}
