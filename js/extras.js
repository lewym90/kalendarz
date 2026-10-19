// Polski kalendarz: święta (także ruchome), imieniny, numer tygodnia ISO, wschód i zachód słońca.
import IMIENINY from './data/imieniny.js';
import { ymd } from './util.js';

const pad = (n) => String(n).padStart(2, '0');
const key = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

// Wielkanoc (algorytm Gaussa / Meeusa), zwraca Date lokalną.
export function easter(y) {
  const a = y % 19; const b = Math.floor(y / 100); const c = y % 100;
  const d = Math.floor(b / 4); const e = b % 4; const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3); const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4); const k = c % 4; const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mo = Math.floor((h + l - 7 * m + 114) / 31); const da = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(y, mo - 1, da);
}
const plus = (dt, n) => new Date(dt.getFullYear(), dt.getMonth(), dt.getDate() + n);

const cache = new Map();
// Zwraca Map 'YYYY-MM-DD' -> { name, off } (off = dzień wolny od pracy).
export function daysOfYear(y) {
  if (cache.has(y)) return cache.get(y);
  const m = new Map();
  const add = (k, name, off) => m.set(k, { name, off });
  const fixed = [[1, 1, 'Nowy Rok'], [1, 6, 'Trzech Króli'], [5, 1, 'Święto Pracy'], [5, 3, 'Święto Konstytucji 3 Maja'], [8, 15, 'Wniebowzięcie NMP'], [11, 1, 'Wszystkich Świętych'], [11, 11, 'Święto Niepodległości'], [12, 25, 'Boże Narodzenie'], [12, 26, 'Drugi dzień Świąt']];
  fixed.forEach(([mo, d, n]) => add(key(y, mo, d), n, true));
  if (y >= 2025) add(key(y, 12, 24), 'Wigilia', true);
  const e = easter(y);
  const ek = (n) => ymd(plus(e, n));
  add(ek(0), 'Wielkanoc', true);
  add(ek(1), 'Poniedziałek Wielkanocny', true);
  add(ek(49), 'Zielone Świątki', true);
  add(ek(60), 'Boże Ciało', true);
  add(ek(-52), 'Tłusty czwartek', false);
  add(ek(-46), 'Popielec', false);
  add(ek(-7), 'Niedziela Palmowa', false);
  add(ek(-2), 'Wielki Piątek', false);
  add(ek(-1), 'Wielka Sobota', false);
  const obs = [[1, 21, 'Dzień Babci'], [1, 22, 'Dzień Dziadka'], [2, 14, 'Walentynki'], [3, 8, 'Dzień Kobiet'], [5, 26, 'Dzień Matki'], [6, 1, 'Dzień Dziecka'], [6, 23, 'Dzień Ojca'], [10, 14, 'Dzień Edukacji Narodowej'], [12, 6, 'Mikołajki']];
  obs.forEach(([mo, d, n]) => { if (!m.has(key(y, mo, d))) add(key(y, mo, d), n, false); });
  if (!m.has(key(y, 12, 24))) add(key(y, 12, 24), 'Wigilia', false);
  cache.set(y, m);
  return m;
}

export function dayInfo(date) {
  const k = ymd(date);
  return daysOfYear(date.getFullYear()).get(k) || null;
}

export function nameDays(date) {
  return IMIENINY[`${pad(date.getMonth() + 1)}-${pad(date.getDate())}`] || '';
}

// Numer tygodnia ISO 8601.
export function isoWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dow = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dow);
  const y0 = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d - y0) / 86400000 + 1) / 7);
}

// Wschód i zachód słońca (algorytm NOAA). Zwraca { rise, set } jako Date lokalne albo null (noc/dzień polarny).
export function sunTimes(date, lat, lon) {
  const rad = Math.PI / 180;
  const n = Math.floor((Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - Date.UTC(date.getFullYear(), 0, 0)) / 86400000);
  const calc = (rising) => {
    const lngHour = lon / 15;
    const t = n + ((rising ? 6 : 18) - lngHour) / 24;
    const M = 0.9856 * t - 3.289;
    let L = M + 1.916 * Math.sin(M * rad) + 0.02 * Math.sin(2 * M * rad) + 282.634;
    L = ((L % 360) + 360) % 360;
    let RA = Math.atan(0.91764 * Math.tan(L * rad)) / rad;
    RA = ((RA % 360) + 360) % 360;
    RA += Math.floor(L / 90) * 90 - Math.floor(RA / 90) * 90;
    RA /= 15;
    const sinDec = 0.39782 * Math.sin(L * rad);
    const cosDec = Math.cos(Math.asin(sinDec));
    const cosH = (Math.cos(90.833 * rad) - sinDec * Math.sin(lat * rad)) / (cosDec * Math.cos(lat * rad));
    if (cosH > 1 || cosH < -1) return null;
    const H = (rising ? 360 - Math.acos(cosH) / rad : Math.acos(cosH) / rad) / 15;
    const T = H + RA - 0.06571 * t - 6.622;
    const UT = (((T - lngHour) % 24) + 24) % 24;
    const ms = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) + UT * 3600000;
    return new Date(ms);
  };
  const rise = calc(true);
  const set = calc(false);
  if (!rise || !set) return null;
  if (set < rise) set.setTime(set.getTime() + 86400000);
  return { rise, set };
}
