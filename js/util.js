// Narzędzia: daty, formatowanie po polsku, drobne helpery.

export const DAYS_FULL = ['niedziela', 'poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek', 'sobota'];
export const DAYS_SHORT = ['ndz', 'pon', 'wt', 'śr', 'czw', 'pt', 'sob'];
export const DAYS_LETTER = ['N', 'P', 'W', 'Ś', 'C', 'P', 'S'];
export const MONTHS = ['styczeń', 'luty', 'marzec', 'kwiecień', 'maj', 'czerwiec', 'lipiec', 'sierpień', 'wrzesień', 'październik', 'listopad', 'grudzień'];
export const MONTHS_GEN = ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca', 'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia'];
export const MONTHS_SHORT = ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru'];

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export const pad = (n) => String(n).padStart(2, '0');
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes());
export const addMinutes = (d, n) => new Date(d.getTime() + n * 60000);
export const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
export const diffDays = (a, b) => Math.round((startOfDay(a) - startOfDay(b)) / 86400000);

export function startOfWeek(d, weekStart = 1) {
  const s = startOfDay(d);
  const diff = (s.getDay() - weekStart + 7) % 7;
  return addDays(s, -diff);
}

export const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseYmd = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};
export const fmtDT = (d) => `${ymd(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
export const parseDT = (s) => {
  const [dt, tm = '00:00'] = s.split('T');
  const [y, m, d] = dt.split('-').map(Number);
  const [hh, mm] = tm.split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm || 0);
};
export const fmtTime = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
export const minutesOfDay = (d) => d.getHours() * 60 + d.getMinutes();

export const fmtDayLong = (d) => `${DAYS_FULL[d.getDay()]} ${d.getDate()} ${MONTHS_GEN[d.getMonth()]}`;
export const fmtDayMid = (d) => `${DAYS_SHORT[d.getDay()]}, ${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;

export function relDay(d, now = new Date()) {
  const n = diffDays(d, now);
  if (n === 0) return 'Dziś';
  if (n === 1) return 'Jutro';
  if (n === 2) return 'Pojutrze';
  if (n === -1) return 'Wczoraj';
  return fmtDayMid(d);
}

export function fmtDuration(min) {
  min = Math.round(min);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h >= 24 && m === 0 && h % 24 === 0) {
    const days = h / 24;
    return days === 1 ? '1 dzień' : `${days} dni`;
  }
  return m ? `${h} godz. ${m} min` : `${h} godz.`;
}

// Odmiana dla krótkich odliczań: „za 1 godz. 12 min".
export function fmtCountdown(ms) {
  const totalMin = Math.max(0, Math.round(ms / 60000));
  if (totalMin < 1) return 'teraz';
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  if (d >= 1) return d === 1 ? `za 1 dzień${h ? ' ' + h + ' godz.' : ''}` : `za ${d} dni`;
  if (h >= 1) return m ? `za ${h} godz. ${m} min` : `za ${h} godz.`;
  return `za ${m} min`;
}

export function fmtReminder(min) {
  if (min === 0) return 'W chwili startu';
  if (min < 60) return `${min} min wcześniej`;
  if (min < 1440) {
    const h = min / 60;
    return h === 1 ? '1 godz. wcześniej' : `${h} godz. wcześniej`;
  }
  const d = min / 1440;
  return d === 1 ? '1 dzień wcześniej' : d === 7 ? 'Tydzień wcześniej' : `${d} dni wcześniej`;
}

export function capFirst(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

export function debounce(fn, ms) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

// Ikony (inline SVG, jedna rodzina: 1.8px obrys, zaokrąglone zakończenia).
const P = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
export const ICON = {
  today: P('<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4"/>'),
  cal: P('<rect x="3.5" y="5" width="17" height="15.5" rx="4"/><path d="M8 3v4M16 3v4M3.5 10h17"/>'),
  tasks: P('<circle cx="12" cy="12" r="8.5"/><path d="m8.3 12.3 2.6 2.6 4.9-5.4"/>'),
  hub: P('<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>'),
  plus: P('<path d="M12 5v14M5 12h14"/>'),
  search: P('<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/>'),
  chevL: P('<path d="m14.5 6-6 6 6 6"/>'),
  chevR: P('<path d="m9.5 6 6 6-6 6"/>'),
  close: P('<path d="M6 6l12 12M18 6 6 18"/>'),
  pin: P('<path d="M12 21s6.5-5.6 6.5-10.5a6.5 6.5 0 1 0-13 0C5.5 15.4 12 21 12 21Z"/><circle cx="12" cy="10.5" r="2.3"/>'),
  repeat: P('<path d="M4 11V9.5A3.5 3.5 0 0 1 7.5 6H19m0 0-2.5-2.5M19 6l-2.5 2.5M20 13v1.5a3.5 3.5 0 0 1-3.5 3.5H5m0 0 2.5 2.5M5 18l2.5-2.5"/>'),
  bell: P('<path d="M6 16.5V11a6 6 0 1 1 12 0v5.5l1.5 1.5h-15L6 16.5ZM10 20.5a2.2 2.2 0 0 0 4 0"/>'),
  trash: P('<path d="M5 7h14M10 4h4M7 7l.8 12a1.5 1.5 0 0 0 1.5 1.4h5.4a1.5 1.5 0 0 0 1.5-1.4L17 7M10 11v5M14 11v5"/>'),
  bolt: P('<path d="M13 3 5.5 13.5H12L11 21l7.5-10.5H12L13 3Z"/>'),
  alert: P('<path d="M12 4 3 19h18L12 4ZM12 10v4M12 16.8v.2"/>'),
  clock: P('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
  note: P('<path d="M6 4h9l3 3v13H6V4ZM9 11h6M9 15h6"/>'),
  check: P('<path d="m5 12.5 4.5 4.5L19 7.5"/>'),
  sparkle: P('<path d="M12 3.5 13.8 9l5.7 1.8-5.7 1.8L12 18l-1.8-5.4L4.5 10.8 10.2 9 12 3.5ZM19 15l.7 2.1 2.1.7-2.1.7L19 20.6l-.7-2.1-2.1-.7 2.1-.7L19 15Z"/>'),
  download: P('<path d="M12 4v11m0 0-4-4m4 4 4-4M5 19.5h14"/>'),
  lock: P('<rect x="5" y="11" width="14" height="9" rx="2.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'),
  upload: P('<path d="M12 15V4m0 0L8 8m4-4 4 4M5 19.5h14"/>'),
  moon: P('<path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10Z"/>'),
  sun: P('<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4"/>'),
  cloud: P('<path d="M7 18.5h10a4 4 0 0 0 .6-7.95A5.5 5.5 0 0 0 7 9.6 4.5 4.5 0 0 0 7 18.5Z"/>'),
  rain: P('<path d="M7 15h10a4 4 0 0 0 .6-7.95A5.5 5.5 0 0 0 7 6.1 4.5 4.5 0 0 0 7 15ZM8.5 18l-1 2.5M12.5 18l-1 2.5M16.5 18l-1 2.5"/>'),
  snow: P('<path d="M12 3v18M4.5 7.5l15 9M19.5 7.5l-15 9M9.5 4.5 12 6.5l2.5-2M9.5 19.5 12 17.5l2.5 2"/>'),
  storm: P('<path d="M7 14.5h10a4 4 0 0 0 .6-7.95A5.5 5.5 0 0 0 7 5.6a4.5 4.5 0 0 0 0 8.9ZM12.5 14l-2 3.5h3L11.5 21"/>'),
  fog: P('<path d="M5 9h14M3.5 13h17M6 17h12"/>'),
  more: P('<circle cx="6" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="18" cy="12" r="1.2"/>'),
  copy: P('<rect x="8" y="8" width="11" height="12" rx="2.5"/><path d="M5 15.5V6a2 2 0 0 1 2-2h8"/>'),
  flag: P('<path d="M6 21V4m0 0h11l-2 4 2 4H6"/>'),
};

// Haptyka: iOS 17.4+ odpala delikatną wibrację przy przełączeniu systemowego „switcha".
let hapticLabel;
export function haptic() {
  try {
    if (navigator.vibrate) navigator.vibrate(8);
    if (!hapticLabel) {
      hapticLabel = document.createElement('label');
      hapticLabel.setAttribute('aria-hidden', 'true');
      hapticLabel.style.cssText = 'position:fixed;left:-100px;top:-100px;width:1px;height:1px;opacity:0.01;pointer-events:none;';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.setAttribute('switch', '');
      input.tabIndex = -1;
      hapticLabel.appendChild(input);
      document.body.appendChild(hapticLabel);
    }
    hapticLabel.click();
  } catch (_) { /* ignoruj */ }
}
