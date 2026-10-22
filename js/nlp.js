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
    put(st, en, str) {
      const rep = (x) => x.slice(0, st) + str + ' '.repeat(Math.max(0, en - st - str.length)) + x.slice(en);
      raw = rep(raw);
      n = rep(n);
    },
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

const HOUR_WORDS = {
  'dwudziestej czwartej': 0, 'dwudziestej trzeciej': 23, 'dwudziestej drugiej': 22, 'dwudziestej pierwszej': 21, 'dwudziesta czwarta': 0, 'dwudziesta trzecia': 23, 'dwudziesta druga': 22, 'dwudziesta pierwsza': 21,
  pierwszej: 1, pierwsza: 1, drugiej: 2, druga: 2, trzeciej: 3, trzecia: 3, czwartej: 4, czwarta: 4, piatej: 5, piata: 5, szostej: 6, szosta: 6, siodmej: 7, siodma: 7, osmej: 8, osma: 8,
  dziewiatej: 9, dziewiata: 9, dziesiatej: 10, dziesiata: 10, jedenastej: 11, jedenasta: 11, dwunastej: 12, dwunasta: 12, trzynastej: 13, trzynasta: 13, czternastej: 14, czternasta: 14,
  pietnastej: 15, pietnasta: 15, szesnastej: 16, szesnasta: 16, siedemnastej: 17, siedemnasta: 17, osiemnastej: 18, osiemnasta: 18, dziewietnastej: 19, dziewietnasta: 19, dwudziestej: 20, dwudziesta: 20,
};
const MIN_WORDS = { 'czterdziesci piec': 45, trzydziesci: 30, pietnascie: 15, dziesiec: 10, dwadziescia: 20, czterdziesci: 40, piecdziesiat: 50, 'dwadziescia piec': 25, 'trzydziesci piec': 35 };
const byLen = (o) => Object.keys(o).sort((a, b) => b.length - a.length).join('|');
const HW = byLen(HOUR_WORDS);
const MW = byLen(MIN_WORDS);
const HW_A = new RegExp(`\\b(o|na|od|do|godz\\.?|okolo|ok\\.?)(\\s+)(${HW})(?:\\s+(${MW}))?(?![\\p{L}])`, 'u');
const HW_B = new RegExp(`\\bw\\s?pol\\s+do\\s+(${HW})(?![\\p{L}])`, 'u');

// „o piątej", „o szesnastej trzydzieści", „wpół do ósmej" -> „o 5:00" itd. (długość tekstu zostaje, więc indeksy się zgadzają)
function wordTimes(E) {
  const hhmm = (h, mi) => `${h}:${String(mi).padStart(2, '0')}`;
  for (let guard = 0; guard < 4; guard++) {
    let m = HW_B.exec(E.n);
    if (m) { E.put(m.index, m.index + m[0].length, 'o ' + hhmm((HOUR_WORDS[m[1]] + 23) % 24, 30)); continue; }
    m = HW_A.exec(E.n);
    if (!m) return;
    const st = m.index + m[1].length + m[2].length;
    E.put(st, m.index + m[0].length, hhmm(HOUR_WORDS[m[3]], m[4] ? MIN_WORDS[m[4]] : 0));
  }
}

const STORES = { biedronce: 'Biedronka', lidlu: 'Lidl', zabce: 'Żabka', kauflandzie: 'Kaufland', rossmannie: 'Rossmann', castoramie: 'Castorama', ikei: 'IKEA', carrefourze: 'Carrefour', decathlonie: 'Decathlon', orlenie: 'Orlen', stokrotce: 'Stokrotka', auchan: 'Auchan', netto: 'Netto', aldi: 'Aldi', dino: 'Dino', tesco: 'Tesco', warszawie: 'Warszawa', krakowie: 'Kraków', gdansku: 'Gdańsk', poznaniu: 'Poznań', wroclawiu: 'Wrocław', lodzi: 'Łódź', lublinie: 'Lublin', katowicach: 'Katowice', szczecinie: 'Szczecin', gdyni: 'Gdynia', sopocie: 'Sopot', bialymstoku: 'Białystok', bydgoszczy: 'Bydgoszcz', toruniu: 'Toruń', rzeszowie: 'Rzeszów', kielcach: 'Kielce', olsztynie: 'Olsztyn', opolu: 'Opole' };

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

  wordTimes(E);

  // --- Urodziny: rok urodzenia wycinamy przed parsowaniem daty
  if (/urodzin/.test(E.n)) {
    r.bday = true;
    const by = E.takeIf(/\b(19\d{2}|20[0-2]\d)\b/, () => true);
    if (by) r.byear = +by[1];
  }

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

  // --- Miejsce: „w Biedronce", „u Ani" nie, ale znane sklepy i miasta oraz wielka litera po „w/we/przy/obok"
  if (!r.loc) {
    const rest = E.raw.replace(/\s+/g, ' ').trim();
    let pm = new RegExp(`\\b(?:w|we|przy|obok)\\s+(${Object.keys(STORES).join('|')}|leroy merlin)\\b`).exec(E.n);
    if (pm) {
      r.loc = STORES[pm[1]] || 'Leroy Merlin';
      E.blank(pm.index, pm.index + pm[0].length);
    } else if ((pm = /(?:^|\s)(?:w|we|przy|obok)\s+([A-ZĄĆĘŁŃÓŚŹŻ][\p{L}-]+(?:\s+[A-ZĄĆĘŁŃÓŚŹŻ][\p{L}-]+)?)/u.exec(E.raw)) && rest.replace(pm[0].trim(), '').replace(/[^\p{L}]/gu, '').length >= 3) {
      const w = pm[1];
      r.loc = STORES[norm(w)] || w;
      const at = pm.index + (pm[0].length - pm[0].trimStart().length);
      E.blank(at, pm.index + pm[0].length);
    }
  }


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

  // --- Urodziny
  if (r.bday && r.kind === 'event') {
    if (!r.rrule) r.rrule = { freq: 'yearly', interval: 1 };
    if (!r.cat) r.cat = 'rodzina';
    if (r.remind == null) r.remind = [0, 1440];
    if (date && !r.allDay && time == null) r.allDay = true;
    r.allDay = true;
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
  if (p.allDay) return { title: p.title, allDay: true, start: `${ymd(date)}T00:00`, end: `${ymd(date)}T23:59`, rrule: p.rrule, cat: p.cat, loc: p.loc, remind: p.remind, bday: !!p.bday, byear: p.byear || null };
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
  return { title: p.title, allDay: false, start: f(s), end: f(e), rrule: p.rrule, cat: p.cat, loc: p.loc, remind: p.remind, bday: !!p.bday, byear: p.byear || null };
}

// ---------- Kilka wydarzeń w jednym zdaniu ----------
const TIME_CUE = /\b(jutro|pojutrze|dzis|dzisiaj|o\s+\d|na\s+\d|\d{1,2}[:.]\d{2}|\d{1,2}\s*-\s*\d{1,2}|(?:w|we)\s+(?:poniedzialk|wtork|wtorek|sro|czwart|piat|sobot|niedziel)|za\s+(?:\d+|pol|godzine|chwile)|rano|wieczorem|przed poludniem)/;
const DATE_CUE = /\b(jutro|pojutrze|dzis|dzisiaj|wczoraj|poniedzialk|wtork|wtorek|srod[aey]?|czwartk|czwartek|piatek|piatk|sobot|niedziel|\d{1,2}[./]\d{1,2}|codziennie|co\s|za\s+\d+\s+(?:dni|dzien|tyg)|weekend|przyszl|nastepn)/;

// ---------- Głos: polecenia, liczebniki porządkowe, podział na pozycje ----------
const ORD_U = { pierwszego: 1, drugiego: 2, trzeciego: 3, czwartego: 4, piatego: 5, szostego: 6, siodmego: 7, osmego: 8, dziewiatego: 9, dziesiatego: 10, jedenastego: 11, dwunastego: 12, trzynastego: 13, czternastego: 14, pietnastego: 15, szesnastego: 16, siedemnastego: 17, osiemnastego: 18, dziewietnastego: 19 };
const ORD_RE = new RegExp(`\\b(?:(dwudziestego|trzydziestego)(?:\\s+(pierwszego|drugiego|trzeciego|czwartego|piatego|szostego|siodmego|osmego|dziewiatego))?|(${Object.keys(ORD_U).join('|')}))\\s+(?=(?:${MONTHS})\\b)`, 'g');

// „trzeciego listopada" -> „3 listopada" (raw i norm mają tę samą długość, więc tniemy po indeksach)
function ordinalDates(text) {
  const n = norm(text);
  let out = '';
  let last = 0;
  let m;
  ORD_RE.lastIndex = 0;
  while ((m = ORD_RE.exec(n))) {
    const v = m[3] ? ORD_U[m[3]] : (m[1] === 'dwudziestego' ? 20 : 30) + (m[2] ? ORD_U[m[2]] : 0);
    out += text.slice(last, m.index) + v + ' ';
    last = m.index + m[0].length;
  }
  return out + text.slice(last);
}

const VERBS = 'kup|kupic|znajdz|znalezc|umow|umowic|zadzwon|zadzwonic|zaplac|zaplacic|zalatw|zalatwic|sprawdz|sprawdzic|napisz|napisac|wyslij|wyslac|odbierz|odebrac|zamow|zamowic|zrob|zrobic|przygotuj|przygotowac|oddaj|oddac|wez|wziac|pamietaj|wymien|wymienic|umyj|posprzataj|wynies|zanies|odnies|zarezerwuj|zarezerwowac|anuluj|wydrukuj|ogarnij|skocz|popros|zapytaj|podlej|nakarm|rozlicz|wypelnij|zloz|odnow|odnowic|ustaw|poszukaj|wyszukaj|dokup|przeczytaj|obejrzyj|naladuj|wyprasuj|ugotuj|upiecz|pozmywaj|wysprzataj|dostarcz|podpisz|zglos|odpisz|oddzwon|przelej|wplac|wyplac|odwiedz|zawiez|przywiez|zajrzyj|powiedz|spytaj|zainstaluj|zaktualizuj|zarejestruj|naprawic|napraw';
const LEAD_CUE = '(?:(?:w|we|na|do|od)\\s+)?(?:(?:przyszly|przyszla|przyszle|nastepny|nastepna|nastepne)\\s+)?(?:jutro|pojutrze|dzis|dzisiaj|rano|wieczorem|poniedzialek|poniedzialku|wtorek|wtorku|sroda|srode|czwartek|czwartku|piatek|piatku|sobota|sobote|niedziela|niedziele|weekend|\\d{1,2}\\s+(?:' + MONTHS + ')|\\d{1,2}[./]\\d{1,2})';
const VERB_LED = new RegExp(`^\\s*(?:(?:${LEAD_CUE}|o\\s+\\d{1,2}(?:[:.]\\d{2})?|prosze|mi|nie zapomnij|zeby|trzeba|musze)\\s+)*(?:${VERBS})\\b`);
const CUE = new RegExp(`${TIME_CUE.source}|${DATE_CUE.source}|\\d{1,2}\\s+(?:${MONTHS})\\b`);
const verbLed = (piece) => VERB_LED.test(norm(piece));
const DATE_ANY = new RegExp(`${DATE_CUE.source}|\\d{1,2}\\s+(?:${MONTHS})\\b`);
const hasCue = (piece) => CUE.test(norm(piece));

// „Dodaj do kalendarza …", „zapisz zadanie …", „przypomnij mi …" -> { text, mode }
export function stripCommand(text) {
  let t = (text || '').trim();
  let mode = null;
  const re = /^\s*(?:prosz[eę]\s+)?(?:dodaj|zapisz|wpisz|dopisz|stw[oó]rz|utw[oó]rz|zaplanuj|ustaw)(?:\s+mi)?\s*(?:(?:do\s+)?(kalendarza|kalendarz|wydarzenie|spotkanie)|(?:do\s+)?(zada[nń]|zadanie|zadania|listy|przypomnienie|przypomnienia|todo))?\s*[:,\-–]?\s*/iu;
  const m = re.exec(t);
  if (m && m[0].trim()) {
    if (m[1]) mode = 'event';
    else if (m[2]) mode = 'task';
    t = t.slice(m[0].length);
  } else {
    const r2 = /^\s*przypomnij\s+mi\s+(?:[żz]eby\s+|[żz]e\s+|o\s+)?/iu.exec(t);
    if (r2) { t = t.slice(r2[0].length); mode = 'task'; }
  }
  return { text: t.trim(), mode };
}

export function splitSentences(text) {
  const out = [];
  const hard = (text || '').split(/\s*(?:;|\n)\s*/).filter((x) => x.trim());
  for (const chunk of hard) {
    // kandydaci na cięcie: przecinki (nie w liczbach), spójniki, „data + czasownik" bez spójnika
    const cuts = [];
    const re = /\s*,(?!\d)\s*|\s+(?:a\s+potem|i\s+potem|a\s+nast[eę]pnie|potem|nast[eę]pnie|oraz|a|i)\s+/giu;
    let m;
    while ((m = re.exec(chunk))) cuts.push([m.index, m.index + m[0].length, m[0]]);
    const re2 = new RegExp(`\\s+(?=${LEAD_CUE}\\s+(?:${VERBS})\\b)`, 'g');
    const nChunk = norm(chunk);
    while ((m = re2.exec(nChunk))) {
      const before = nChunk.slice(0, m.index).split(/\s+/).pop();
      if (m[0].length && !/^(?:w|we|na|do|od|o|przyszly|przyszla|przyszle|nastepny|nastepna|nastepne)$/.test(before) && !cuts.some((c) => Math.abs(c[1] - (m.index + m[0].length)) < 2)) cuts.push([m.index, m.index + m[0].length, ' ']);
    }
    cuts.sort((a, b) => a[0] - b[0]);
    const pieces = [];
    let pos = 0;
    for (const [a, b, sep] of cuts) {
      if (a < pos) continue;
      pieces.push({ t: chunk.slice(pos, a), sep });
      pos = b;
    }
    pieces.push({ t: chunk.slice(pos), sep: '' });
    const titled = (x) => !!parse(x, { now: new Date(2026, 0, 5, 8, 0) }).title;
    let cur = pieces[0].t;
    for (let k = 1; k < pieces.length; k++) {
      const right = pieces[k].t;
      const sep = pieces[k - 1].sep;
      const left = cur;
      const boundary = !!left.trim() && !!right.trim() && titled(left) && (verbLed(right) || (hasCue(right) && (hasCue(left) || verbLed(left)) && titled(right)));
      if (boundary) { out.push(left.trim()); cur = right; }
      else cur = left + (/,/.test(sep) ? ', ' : sep) + right;
    }
    out.push(cur.trim());
  }
  return out.filter(Boolean);
}

export function parseMulti(text, opts = {}) {
  const cmd = stripCommand(ordinalDates(text || ''));
  const force = opts.force ? opts.mode : cmd.mode;
  const base = { ...opts };
  const kindOf = (part) => (force ? force : verbLed(part) ? 'task' : opts.mode === 'task' ? 'task' : 'event');
  const parts = splitSentences(cmd.text);
  if (parts.length < 2) return [parse(cmd.text, { ...base, mode: kindOf(cmd.text) })];
  const res = [];
  let prev = null;
  for (const part of parts) {
    const p = parse(part, { ...base, mode: kindOf(part) });
    if (prev && prev.date && !p.rrule && !DATE_ANY.test(norm(part)) && !p.relative && !p.date) {
      p.date = prev.date;
      if (p.kind === 'event' && p.time) p.allDay = false;
    } else if (prev && prev.date && p.kind === 'event' && !p.rrule && !DATE_ANY.test(norm(part)) && !p.relative) {
      p.date = prev.date;
      if (p.time) p.allDay = false;
    }
    res.push(p);
    prev = p.date ? p : prev;
  }
  return res;
}

// ---------- Poprawianie rozpoznanej mowy słownikiem (siłownia, nie „szyłownia") ----------
const VOICE_WORDS = ('siłownia siłowni siłownię trening treningi basen basenie joga jogi pilates bieganie bieg rower rowerem spacer lekarz lekarza lekarzem dentysta dentystę dentysty ortodonta okulista okulisty fizjoterapeuta fizjoterapeuty wizyta wizytę wizyty spotkanie spotkania spotkaniu zakupy zakupów urodziny urodzin imieniny imienin fryzjer fryzjera fryzjerze kosmetyczka kosmetyczki weterynarz weterynarza przegląd przeglądu rachunek rachunki rachunków przelew podatek faktura faktury kolacja kolację obiad obiadu lunch lunchu śniadanie mecz meczu kino kina teatr teatru koncert koncertu szkoła szkole przedszkole przedszkola zebranie rodzice rodziców rodzicami babcia babci dziadek dziadka wyjazd wyjazdu urlop urlopu wakacje podróż lotnisko pociąg samolot paczka paczkę sprzątanie pranie naprawa hydraulik serwis remont ogród śmieci mleko chleb masło opony opon zimowe zimowych tabletki leki apteka apteki kurs lekcja lekcje egzamin wykład szkolenie angielski hiszpański niemiecki korepetycje praca pracy projekt prezentacja klient klienta deadline sprint termin telefon zadzwonić zadzwoń kup kupić znajdź znaleźć umów umówić zapłać zapłacić załatw załatwić sprawdź sprawdzić napisz napisać wyślij wyślij odbierz odebrać zamów zamówić zrób zrobić przygotuj oddaj weź pamiętaj wymień wymienić umyj posprzątaj wynieś zanieś odnieś zarezerwuj anuluj wydrukuj ogarnij podlej nakarm rozlicz wypełnij złóż odnów ustaw poszukaj dokup przeczytaj obejrzyj jutro pojutrze dzisiaj poniedziałek wtorek środa środę czwartek piątek sobota sobotę niedziela niedzielę stycznia lutego marca kwietnia maja czerwca lipca sierpnia września października listopada grudnia tydzień weekend przypomnij przypomnienie kalendarza zadanie wydarzenie').split(/\s+/);
const nn = (s) => norm(s).replace(/[^a-z0-9]/g, '');

function editDist(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev[j - 2] + 1);
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev.splice(0, prev.length, ...cur);
  }
  return prev[b.length];
}

export function fixVoice(text, extra = []) {
  const known = new Map();
  for (const w of [...VOICE_WORDS, ...extra]) {
    const k = nn(w);
    if (k.length >= 4 && !known.has(k)) known.set(k, w.toLowerCase());
  }
  const out = (text || '').trim().replace(/[.!?…]+$/u, '').replace(/\s+/g, ' ').replace(/\b(\d{1,2})[.,](\d{2})\b/g, '$1:$2');
  return out.replace(/[\p{L}]{4,}/gu, (word) => {
    const k = nn(word);
    const cap0 = word[0] !== word[0].toLowerCase();
    if (known.has(k)) { const o = known.get(k); return cap0 ? o[0].toUpperCase() + o.slice(1) : o; }
    const max = k.length >= 8 ? 2 : k.length >= 5 ? 1 : 0;
    if (!max) return word;
    let best = null;
    let bd = max + 1;
    for (const [kk, orig] of known) {
      if (kk[0] !== k[0] && !(kk[0] === 's' && k[0] === 's') && !/^(sz|s)/.test(k) ) continue;
      const d = editDist(k, kk, max);
      if (d < bd) { bd = d; best = orig; }
      else if (d === bd && best && Math.abs(kk.length - k.length) < Math.abs(nn(best).length - k.length)) best = orig;
    }
    if (!best || bd > max) return word;
    const cap = word[0] !== word[0].toLowerCase();
    return cap ? best[0].toUpperCase() + best.slice(1) : best;
  });
}
