// Parser zdań po polsku: „jutro 17 siłownia", „co drugi wtorek dentysta 9:30", „urodziny Ani 14 marca".
import { startOfDay, addDays, startOfWeek, ymd, pad, capFirst } from './util.js';

const MAP = { ą: 'a', ć: 'c', ę: 'e', ł: 'l', ń: 'n', ó: 'o', ś: 's', ź: 'z', ż: 'z' };
export const norm = (s) => (s || '').toLowerCase().replace(/[ąćęłńóśźż]/g, (c) => MAP[c]);

const NUMW = { jeden: 1, jedna: 1, jedno: 1, dwa: 2, dwie: 2, drugi: 2, drugie: 2, trzy: 3, trzeci: 3, cztery: 4, czwarty: 4, piec: 5, piaty: 5, szesc: 6, siedem: 7, osiem: 8, dziewiec: 9, dziesiec: 10 };
const num = (s) => (s == null ? null : /^\d/.test(s) ? parseFloat(s.replace(',', '.')) : NUMW[s] ?? null);

const WD_STEMS = ['poniedzialek|poniedzialku|poniedzialki', 'wtorek|wtorku|wtorki', 'sroda|srode|srody', 'czwartek|czwartku|czwartki', 'piatek|piatku|piatki', 'sobota|sobote|soboty', 'niedziela|niedziele|niedziel'];
const WD_ABBR = 'pon|wt|czw|pt|sob|niedz|ndz';
const WD = `(?:${WD_STEMS.join('|')}|${WD_ABBR})`;
const MONTHS = 'stycznia|styczen|lutego|luty|marca|marzec|kwietnia|kwiecien|maja|maj|czerwca|czerwiec|lipca|lipiec|sierpnia|sierpien|wrzesnia|wrzesien|pazdziernika|pazdziernik|listopada|listopad|grudnia|grudzien';
const MONTH_IDX = { styczn: 0, luty: 1, lutego: 1, marc: 2, kwiet: 3, maj: 4, czerw: 5, lip: 6, sierp: 7, wrzes: 8, pazdz: 9, listop: 10, grudn: 11 };

function wdIndex(w) {
  if (w.startsWith('pon')) return 1;
  if (w.startsWith('wt')) return 2;
  if (w.startsWith('sr')) return 3;
  if (w.startsWith('cz')) return 4;
  if (w.startsWith('pi') || w === 'pt') return 5;
  if (w.startsWith('so')) return 6;
  return 0; // niedziela, ndz, niedz
}
function monthIndex(w) {
  for (const k of Object.keys(MONTH_IDX)) if (w.startsWith(k)) return MONTH_IDX[k];
  return 0;
}

const CAT_KEYWORDS = [
  ['sport', /silown|trening|\bbieg\b|biegani|basen|joga|\brower|pilates|crossfit|mecz|plywani|fitness|spacer/],
  ['zdrowie', /dentyst|lekarz|badani|szczepien|wizyta|fizjoter|okulist|kontrola|apteka|terapi|ortodont|rehabilit/],
  ['rodzina', /urodzin|imienin|rodzin|babci|dziadk|dzieci|przedszkol|zebranie w szkole|kolacja u|chrzest|slub|wesel/],
  ['praca', /spotkani|\bcall\b|stand-?up|prezentacj|klient|deadline|projekt|sprint|1:1|\bszef|ofert|retro|planowani|rozmowa kwalif|demo\b/],
  ['finanse', /rachunek|oplat|przelew|podatek|\brata\b|faktur|\bzus\b|\bpit\b|kredyt|ksiegow|abonament|ubezpiecz/],
  ['nauka', /kurs|lekcj|\bnauka\b|egzamin|wyklad|szkolen|studia|angielski|hiszpanski|niemiecki|korepet|czytani/],
  ['dom', /sprzatan|zakupy|pranie|napraw|hydraulik|paczk|wywoz|smieci|gotowan|serwis|przeglad|remont|ogrod/],
];

function engine(text) {
  let raw = text;
  let n = norm(text);
  const blank = (s, e) => {
    raw = raw.slice(0, s) + ' '.repeat(e - s) + raw.slice(e);
    n = n.slice(0, s) + ' '.repeat(e - s) + n.slice(e);
  };
  return {
    blank,
    get raw() { return raw; },
    get n() { return n; },
    take(re) {
      const m = re.exec(n);
      if (!m) return null;
      blank(m.index, m.index + m[0].length);
      return m;
    },
    takeIf(re, pred) {
      const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
      let m;
      while ((m = g.exec(n))) {
        if (pred(m, n.slice(m.index + m[0].length))) {
          blank(m.index, m.index + m[0].length);
          return m;
        }
        if (m[0].length === 0) g.lastIndex++;
      }
      return null;
    },
    takeRaw(re) {
      const m = re.exec(raw);
      if (!m) return null;
      blank(m.index, m.index + m[0].length);
      return m;
    },
  };
}

const startsWithMonth = (rest) => new RegExp(`^\\s*(?:${MONTHS})\\b`).test(rest);

export function parse(text, opts = {}) {
  const now = opts.now || new Date();
  const cats = opts.cats || [];
  const history = opts.history || {};
  const today = startOfDay(now);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const E = engine(text || '');

  const r = {
    title: '', kind: opts.mode === 'task' ? 'task' : 'event',
    date: null, time: null, endTime: null, durMin: null, allDay: false,
    rrule: null, cat: null, catInferred: false, loc: '', remind: null, relative: false,
  };

  // --- Rodzaj
  if (E.take(/^\s*(zadanie|todo|task)\b\s*[:\-–]?\s*/)) r.kind = 'task';

  // --- Kategoria #tag
  const tag = E.takeRaw(/#([\p{L}\p{N}_]+)/u);
  if (tag) {
    const t = norm(tag[1]);
    const c = cats.find((c) => norm(c.name).startsWith(t) || c.id.startsWith(t));
    if (c) r.cat = c.id;
  }

  // --- Miejsce @miejsce lub @"Dłuższa nazwa"
  const q = E.takeRaw(/@"([^"]+)"/);
  const loc = q || E.takeRaw(/@([\p{L}\p{N}_\-.,]+)/u);
  if (loc) r.loc = loc[1].replace(/_/g, ' ').replace(/[.,]+$/, '');

  // --- Przypomnienia
  const unitMin = (u, amount) => (/^(min)/.test(u) ? amount : /^(godz|h)/.test(u) ? amount * 60 : /^(dzien|dni|dnia)/.test(u) ? amount * 1440 : amount * 10080);
  if (E.take(/\bbez przypomnien\w*\b/)) r.remind = [];
  let m = E.take(/\bprzypomn\w*(?:\s+mi)?(?:\s+o\s+tym)?\s+(?:(\d+(?:[.,]\d+)?)|(jeden|jedna|dwa|dwie|trzy|cztery|piec|pol))?\s*(minut\w*|min|godzin\w*|godz|h|dzien|dni|dnia|tydzien)\s+(?:wczesniej|przed)\b/);
  if (m) {
    let amount = m[1] ? num(m[1]) : m[2] === 'pol' ? 0.5 : m[2] ? num(m[2]) : 1;
    r.remind = [...(r.remind || []), Math.round(unitMin(m[3], amount))];
  }
  m = E.take(/\b(?:z\s+)?przypomnieni\w*\s+(\d+)\s*(min\w*|godz\w*|h|dni|dzien)\b/);
  if (m) r.remind = [...(r.remind || []), Math.round(unitMin(m[2], +m[1]))];

  // --- Powtarzanie
  let rule = null;
  const wdList = (str) => [...new Set([...str.matchAll(new RegExp(`\\b${WD}\\b`, 'g'))].map((x) => wdIndex(x[0])))];
  if (E.take(/\bcodziennie\b|\bco dzien\b|\bkazdego dnia\b|\bkazdy dzien\b/)) rule = { freq: 'daily', interval: 1 };
  else if (E.take(/\b(?:w\s+)?dni(?:ach)?\s+(?:robocz\w*|powszedni\w*)\b|\bod poniedzialku do piatku\b|\bpon-pt\b/)) rule = { freq: 'weekly', interval: 1, byday: [1, 2, 3, 4, 5] };
  else if (E.take(/\bw weekendy\b|\bco weekend\b|\bkazdy weekend\b|\bkazdego weekendu\b/)) rule = { freq: 'weekly', interval: 1, byday: [6, 0] };
  else if ((m = E.take(new RegExp(`\\bco\\s+(?:(\\d+|drugi|trzeci|czwarty|piaty)\\s+)?(${WD})((?:\\s*(?:,|i|oraz)\\s*${WD})*)\\b`)))) {
    rule = { freq: 'weekly', interval: m[1] ? num(m[1]) : 1, byday: wdList(m[0]) };
  } else if ((m = E.take(/\bco\s+(?:(\d+|drugi|drugie|trzeci|czwarty)\s+)?(?:tydzien|tygodnie|tygodni|tygodnia)\b/))) rule = { freq: 'weekly', interval: m[1] ? num(m[1]) : 1, byday: [] };
  else if (E.take(/\braz w tygodniu\b|\btygodniowo\b/)) rule = { freq: 'weekly', interval: 1, byday: [] };
  else if ((m = E.take(new RegExp(`\\b(?:w\\s+)?kazd\\w*\\s+(${WD})((?:\\s*(?:,|i|oraz)\\s*${WD})*)\\b`)))) rule = { freq: 'weekly', interval: 1, byday: wdList(m[0]) };
  else if ((m = E.take(new RegExp(`\\bw\\s+(?:poniedzialki|wtorki|srody|czwartki|piatki|soboty)((?:\\s*(?:,|i|oraz)\\s*${WD})*)\\b`)))) rule = { freq: 'weekly', interval: 1, byday: wdList(m[0]) };
  else if ((m = E.take(/\bco\s+(?:(\d+|drugi|drugie|trzeci)\s+)?(?:miesiac|miesiace|miesiecy)\b|\bmiesiecznie\b/))) rule = { freq: 'monthly', interval: m[1] ? num(m[1]) : 1 };
  else if ((m = E.take(/\bco\s+(?:(\d+|drugi|drugie)\s+)?(?:rok|roku|lata|lat)\b|\brocznie\b/))) rule = { freq: 'yearly', interval: m[1] ? num(m[1]) : 1 };

  if (rule) {
    m = E.take(new RegExp(`\\bdo\\s+(\\d{1,2})\\s+(${MONTHS})(?:\\s+(\\d{4}))?\\b`));
    if (m) {
      let y = m[3] ? +m[3] : today.getFullYear();
      let d = new Date(y, monthIndex(m[2]), +m[1]);
      if (!m[3] && d < today) d = new Date(y + 1, monthIndex(m[2]), +m[1]);
      rule.until = ymd(d);
    }
  }

  // --- Czas trwania
  let durMin = null;
  m = E.take(/\b(?:na|przez)\s+(?:(\d+)\s*(?:h|godz\w*)\s*(?:i\s*)?(\d+)\s*min\w*|pol\s+godziny|(?:(\d+(?:[.,]\d+)?)|(jeden|jedna|dwa|dwie|trzy|cztery|piec))\s*(h|godz\w*|min\w*)|godzine|godzinke)\b/);
  if (m) {
    if (m[1]) durMin = +m[1] * 60 + +m[2];
    else if (/pol\s+godziny/.test(m[0])) durMin = 30;
    else if (/godzin(e|ke)\b/.test(m[0]) && !m[5]) durMin = 60;
    else {
      const a = m[3] ? num(m[3]) : num(m[4]);
      durMin = Math.round(/^min/.test(m[5]) ? a : a * 60);
    }
  }

  // --- Godziny
  let time = null; // minuty od północy
  let endTime = null;
  const hm = (h, mi) => (+h) * 60 + (mi ? +mi : 0);
  const okHM = (h, mi) => +h <= 23 && (!mi || +mi <= 59);
  const applyPart = (mins, part) => {
    if (!part) return mins;
    const h = Math.floor(mins / 60);
    if (/wiecz|po\s?poludniu|popoludniu/.test(part) && h < 12) return mins + 720;
    if (/noc/.test(part) && h >= 6 && h < 12) return mins + 720;
    return mins;
  };

  m = E.takeIf(/(?:\b(od|o|godz\.?|godzinie)\s+)?\b(\d{1,2})(?:[:.](\d{2}))?\s*(?:-|–|do)\s*(\d{1,2})(?:[:.](\d{2}))?\b/, (mm, rest) => mm[1] || mm[3] || mm[5] ? okHM(mm[2], mm[3]) && okHM(mm[4], mm[5]) && !startsWithMonth(rest) && (+mm[4] > +mm[2] || mm[3]) : false);
  if (m) { time = hm(m[2], m[3]); endTime = hm(m[4], m[5]); }

  if (time == null) {
    m = E.take(/\b(?:o\s+)?(\d{1,2})(?:[:.](\d{2}))?\s*(rano|wieczorem|po poludniu|popoludniu|w nocy)\b/);
    if (m && okHM(m[1], m[2])) time = applyPart(hm(m[1], m[2]), m[3]);
  }
  if (time == null) {
    m = E.takeIf(/\b(o|na|godz\.?|godzinie|okolo|ok\.?)\s+(\d{1,2})(?:[:.](\d{2}))?(?:\s*(?:h|godz\.?|godzin\w*))?(?!\d)/, (mm, rest) => okHM(mm[2], mm[3]) && !startsWithMonth(rest) && !/^\s*(?:osob|razy|minut|min\b|dni|tyg)/.test(rest) && (mm[1] !== 'na' || mm[3] || (+mm[2] >= 6 && +mm[2] <= 23)));
    if (m) {
      time = hm(m[2], m[3]);
      const part = E.take(/\b(rano|wieczorem|po poludniu|popoludniu|w nocy)\b/);
      if (part) time = applyPart(time, part[1]);
    }
  }

  // --- Daty
  let dateSpec = null;
  let relDate = null; // wynik „za X minut/godzin"
  m = E.take(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (m) dateSpec = { type: 'abs', d: new Date(+m[1], +m[2] - 1, +m[3]) };

  if (!dateSpec) {
    m = E.takeIf(/\b(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?\b/, (mm) => +mm[1] >= 1 && +mm[1] <= 31 && +mm[2] >= 1 && +mm[2] <= 12);
    if (m) {
      let y = m[3] ? (+m[3] < 100 ? 2000 + +m[3] : +m[3]) : today.getFullYear();
      let d = new Date(y, +m[2] - 1, +m[1]);
      if (!m[3] && d < today) d = new Date(y + 1, +m[2] - 1, +m[1]);
      dateSpec = { type: 'abs', d };
    }
  }
  if (!dateSpec) {
    m = E.take(new RegExp(`\\b(?:dnia\\s+)?(\\d{1,2})\\s+(${MONTHS})(?:\\s+(\\d{4}))?\\b`));
    if (m && +m[1] >= 1 && +m[1] <= 31) {
      let y = m[3] ? +m[3] : today.getFullYear();
      let d = new Date(y, monthIndex(m[2]), +m[1]);
      if (!m[3] && d < today) d = new Date(y + 1, monthIndex(m[2]), +m[1]);
      dateSpec = { type: 'abs', d };
    }
  }
  if (!dateSpec) {
    m = E.take(/\bza\s+(?:(\d+(?:[.,]\d+)?)|(jeden|jedna|dwa|dwie|trzy|cztery|piec|szesc|siedem|osiem|dziewiec|dziesiec)|(pol))?\s*(minut\w*|min|godzin\w*|godz|dni|dzien|dnia|tygodni\w*|tydzien|miesiac\w*|miesiecy)\b/);
    if (m) {
      const a = m[1] ? num(m[1]) : m[2] ? num(m[2]) : m[3] ? 0.5 : 1;
      const u = m[4];
      if (/^(min|godz)/.test(u)) {
        const t = new Date(now.getTime() + (/^min/.test(u) ? a : a * 60) * 60000);
        relDate = t;
        dateSpec = { type: 'abs', d: startOfDay(t) };
        time = t.getHours() * 60 + t.getMinutes();
        r.relative = true;
      } else if (/^(dni|dzien|dnia)/.test(u)) dateSpec = { type: 'abs', d: addDays(today, Math.round(a)) };
      else if (/^tydz|^tygod/.test(u)) dateSpec = { type: 'abs', d: addDays(today, Math.round(a * 7)) };
      else dateSpec = { type: 'abs', d: new Date(today.getFullYear(), today.getMonth() + Math.round(a), today.getDate()) };
    }
  }
  if (!dateSpec) {
    m = E.take(/\b(dzis|dzisiaj|jutro|pojutrze|wczoraj)\b/);
    if (m) { dateSpec = { type: 'abs', d: addDays(today, { dzis: 0, dzisiaj: 0, jutro: 1, pojutrze: 2, wczoraj: -1 }[m[1]]) }; bareAfter(m); }
  }
  function bareAfter(mm) {
    if (time != null || !mm) return;
    const end = mm.index + mm[0].length;
    const rest = E.n.slice(end);
    const tail = `(?!\\s*(?:${MONTHS}|osob|razy|min|godz|dni|tyg|zl|pln))`;
    let k = new RegExp(`^\\s*(\\d{1,2})(?:[:.](\\d{2}))?\\s*(?:-|–|do)\\s*(\\d{1,2})(?:[:.](\\d{2}))?\\b${tail}`).exec(rest);
    if (k && okHM(k[1], k[2]) && okHM(k[3], k[4])) {
      time = hm(k[1], k[2]); endTime = hm(k[3], k[4]);
      E.blank(end, end + k[0].length);
      return;
    }
    k = new RegExp(`^\\s*(\\d{1,2})(?:[:.](\\d{2}))?\\b${tail}`).exec(rest);
    if (k && okHM(k[1], k[2])) {
      time = hm(k[1], k[2]);
      E.blank(end, end + k[0].length);
      const part = E.take(/\b(rano|wieczorem|po poludniu|popoludniu|w nocy)\b/);
      if (part) time = applyPart(time, part[1]);
    }
  }
  let nextWeek = !!E.take(/\b(?:w\s+)?(?:przyszl\w+|nastepn\w+)\s+tygodni\w*\b/);
  if (!dateSpec) {
    m = E.take(new RegExp(`\\b(?:(?:w|we|na|do|od)\\s+)?(?:(przyszl\\w+|nastepn\\w+)\\s+)?(${WD})\\b`));
    if (m) { dateSpec = { type: 'wd', wd: wdIndex(m[2]), next: !!m[1] || nextWeek }; bareAfter(m); }
  }
  if (!dateSpec) {
    m = E.take(/\b(?:w|na)\s+(?:ten\s+)?weekend\b/);
    if (m) dateSpec = { type: 'wd', wd: 6, next: nextWeek };
  }
  if (!dateSpec && nextWeek) dateSpec = { type: 'abs', d: addDays(today, 7) };

  // --- Godziny wolnostojące
  if (time == null) {
    m = E.takeIf(/\b([01]?\d|2[0-3])[:.]([0-5]\d)\b/, () => true);
    if (m) {
      time = hm(m[1], m[2]);
      const part = E.take(/\b(rano|wieczorem|po poludniu|popoludniu|w nocy)\b/);
      if (part) time = applyPart(time, part[1]);
    }
  }
  if (time == null) {
    m = E.take(/\b(w poludnie|w poludniu|rano|po poludniu|popoludniu|wieczorem|wieczor)\b/);
    if (m) time = { 'w poludnie': 720, 'w poludniu': 720, rano: 480, 'po poludniu': 900, popoludniu: 900, wieczorem: 1140, wieczor: 1140 }[m[1]];
  }

  // --- Rozstrzygnięcie daty
  const timeAhead = time != null && time > nowMin;
  let date = null;
  if (dateSpec?.type === 'abs') date = dateSpec.d;
  else if (dateSpec?.type === 'wd') {
    if (dateSpec.next) date = addDays(startOfWeek(addDays(today, 7), 1), (dateSpec.wd + 6) % 7);
    else {
      let diff = (dateSpec.wd - today.getDay() + 7) % 7;
      if (diff === 0 && !timeAhead && r.kind !== 'task') diff = 7;
      date = addDays(today, diff);
    }
  }

  if (rule) {
    if (rule.freq === 'weekly') {
      if (!rule.byday?.length) rule.byday = [(date || today).getDay()];
      let c = date || (time != null && time <= nowMin ? addDays(today, 1) : today);
      for (let i = 0; i < 8 && !rule.byday.includes(c.getDay()); i++) c = addDays(c, 1);
      date = c;
    } else if (!date) date = time != null && time <= nowMin && rule.freq === 'daily' ? addDays(today, 1) : today;
    r.rrule = rule;
  }

  if (r.kind === 'event') {
    if (time != null && !date) date = time > nowMin ? today : addDays(today, 1);
    if (date && time == null) r.allDay = true;
  }

  // --- Miejsce w tytule: „w Warszawie" zostaje w tytule; nic nie zgadujemy.

  // --- Tytuł
  let title = E.raw.replace(/\s+/g, ' ').trim();
  let prev;
  do {
    prev = title;
    title = title
      .replace(/^(?:w|we|na|o|od|do|dnia|okolo|ok\.?|godz\.?)\s+/i, '')
      .replace(/\s+(?:w|we|na|o|od|do|dnia|okolo|ok\.?|godz\.?)$/i, '')
      .replace(/^[\s,;:\-–.]+|[\s,;:\-–]+$/g, '');
  } while (title !== prev);
  r.title = capFirst(title);

  // --- Kategoria
  if (!r.cat) {
    const nt = norm(r.title);
    for (const [id, re] of CAT_KEYWORDS) {
      if (re.test(nt) && cats.some((c) => c.id === id)) { r.cat = id; r.catInferred = true; break; }
    }
  }

  // --- Wyniki
  if (date) r.date = ymd(date);
  if (time != null) r.time = `${pad(Math.floor(time / 60))}:${pad(time % 60)}`;
  if (endTime != null) {
    if (endTime <= time) endTime += 0; // zakończenie przed startem: zostanie skorygowane niżej
    r.endTime = `${pad(Math.floor((endTime % 1440) / 60))}:${pad(endTime % 60)}`;
  }
  if (durMin != null) r.durMin = durMin;
  else if (endTime != null && time != null) r.durMin = Math.max(5, endTime > time ? endTime - time : endTime + 1440 - time);
  else {
    const h = history[norm(r.title)];
    r.durMin = h?.dur || 60;
    r.durDefault = true;
  }
  return r;
}

// Zamiana wyniku parsera na gotowy obiekt wydarzenia/zadania (bez id).
export function toEventFields(p, now = new Date()) {
  const today = startOfDay(now);
  let date = p.date ? new Date(p.date + 'T00:00') : today;
  if (p.allDay) return { title: p.title, allDay: true, start: `${ymd(date)}T00:00`, end: `${ymd(date)}T23:59`, rrule: p.rrule, cat: p.cat, loc: p.loc, remind: p.remind };
  let hh, mm;
  if (p.time) [hh, mm] = p.time.split(':').map(Number);
  else {
    const n = new Date(now.getTime() + 3600000);
    hh = n.getHours();
    mm = 0;
    if (n.getDate() !== now.getDate()) { hh = 23; }
  }
  const s = new Date(date.getFullYear(), date.getMonth(), date.getDate(), hh, mm);
  const e = new Date(s.getTime() + (p.durMin || 60) * 60000);
  const f = (d) => `${ymd(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return { title: p.title, allDay: false, start: f(s), end: f(e), rrule: p.rrule, cat: p.cat, loc: p.loc, remind: p.remind };
}
