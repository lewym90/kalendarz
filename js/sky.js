// Zdjęcie w nagłówku: pora dnia liczona z prawdziwych godzin słońca, pogoda ma pierwszeństwo przed czystym niebem.
import { sunTimes } from './extras.js';

const SNOW = (c) => (c >= 71 && c <= 77) || c === 85 || c === 86;
const RAIN = (c) => (c >= 51 && c <= 67) || (c >= 80 && c <= 82) || c >= 95;
const GREY = (c) => c === 3 || c === 45 || c === 48;

export function skyName(now, lat, lon, code) {
  const st = sunTimes(now, lat, lon);
  const m = now.getHours() * 60 + now.getMinutes();
  const dayMin = (d) => d.getHours() * 60 + d.getMinutes();
  const r = st ? dayMin(st.rise) : 420;
  const s = st ? dayMin(st.set) : 1140;
  const isDay = m >= r - 30 && m <= s + 20;
  if (code != null) {
    if (SNOW(code)) return isDay ? 'snieg-dzien' : 'snieg-noc';
    if (RAIN(code)) return isDay ? 'deszcz-dzien' : 'deszcz-noc';
    if (GREY(code)) return isDay ? 'pochmurno-dzien' : 'pochmurno-noc';
  }
  if (m < r - 60 || m >= s + 75) return 'noc';
  if (m < r + 35) return 'swit';
  if (m < r + 150) return 'poranek';
  if (m >= s + 20) return 'zmierzch';
  if (m >= s - 50) return 'zachod';
  if (m >= s - 150) return 'zlota';
  const a = r + 150; const part = Math.max(1, (s - 150 - a) / 3);
  return m < a + part ? 'przedpoludnie' : m < a + 2 * part ? 'poludnie' : 'popoludnie';
}
export const skyUrl = (n) => `img/niebo/${n}.webp`;
