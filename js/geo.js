// Pogoda wg lokalizacji telefonu: przy otwarciu aplikacji ustalamy pozycję i, jeśli się zmieniła, podmieniamy miasto.
import { state, save } from './store.js';

const km = (a, b, c, d) => {
  const r = Math.PI / 180, x = (c - a) * r, y = (d - b) * r;
  const h = Math.sin(x / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin(y / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
};

const position = () => new Promise((resolve) => {
  if (!('geolocation' in navigator)) return resolve({ err: { code: 0 } });
  navigator.geolocation.getCurrentPosition((p) => resolve(p), (e) => resolve({ err: e }), { enableHighAccuracy: false, timeout: 9000, maximumAge: 10 * 60000 });
});

async function cityName(lat, lon) {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 5000);
    const r = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=pl`, { signal: ctl.signal });
    clearTimeout(t);
    const j = await r.json();
    return String(j.city || j.locality || j.principalSubdivision || '').trim() || '';
  } catch (_) { return ''; }
}

let busy = false;
// Zwraca true, gdy miasto się zmieniło. Przy braku zgody po cichu zostaje dotychczasowe miasto.
export async function updateLocation() {
  const s = state.settings;
  if (!s.autoLoc || busy) return false;
  busy = true;
  try {
    const p = await position();
    if (!p || p.err) { s.locDenied = !!(p && p.err && p.err.code === 1); return false; }
    s.locDenied = false;
    const lat = Math.round(p.coords.latitude * 1e4) / 1e4, lon = Math.round(p.coords.longitude * 1e4) / 1e4;
    const c = s.city || {};
    if (c.auto && c.name && Number.isFinite(c.lat) && km(c.lat, c.lon, lat, lon) < 3) return false;
    const name = (await cityName(lat, lon)) || (c.auto && c.name) || 'Moja lokalizacja';
    s.city = { name, lat, lon, auto: true };
    save();
    return true;
  } finally { busy = false; }
}
