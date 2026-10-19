// Pogoda z Open-Meteo (bez klucza). Wynik jest buforowany, więc aplikacja działa też offline.
const CK = 'kalendarz.weather';

export function weatherKind(code) {
  if (code === 0) return { icon: 'sun', label: 'Słonecznie' };
  if (code <= 2) return { icon: 'sun', label: 'Pogodnie' };
  if (code === 3) return { icon: 'cloud', label: 'Pochmurno' };
  if (code <= 48) return { icon: 'fog', label: 'Mgła' };
  if (code <= 57) return { icon: 'rain', label: 'Mżawka' };
  if (code <= 67) return { icon: 'rain', label: 'Deszcz' };
  if (code <= 77) return { icon: 'snow', label: 'Śnieg' };
  if (code <= 82) return { icon: 'rain', label: 'Przelotne opady' };
  if (code <= 86) return { icon: 'snow', label: 'Opady śniegu' };
  return { icon: 'storm', label: 'Burza' };
}

export function cachedWeather() {
  try {
    return JSON.parse(localStorage.getItem(CK) || 'null');
  } catch (_) {
    return null;
  }
}

export async function loadWeather(city, force = false) {
  const key = `v2:${city.lat},${city.lon}`;
  const c = cachedWeather();
  if (!force && c && c.key === key && Date.now() - c.t < 30 * 60000) return c;
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${city.lat}&longitude=${city.lon}&current=temperature_2m,apparent_temperature,weather_code,is_day&hourly=temperature_2m,precipitation_probability,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=7`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const j = await res.json();
    const out = {
      key,
      t: Date.now(),
      temp: Math.round(j.current.temperature_2m),
      feels: Math.round(j.current.apparent_temperature),
      code: j.current.weather_code,
      isDay: !!j.current.is_day,
      hi: Math.round(j.daily.temperature_2m_max[0]),
      lo: Math.round(j.daily.temperature_2m_min[0]),
      pop: j.daily.precipitation_probability_max[0],
      daily: j.daily.time.map((t, i) => ({ d: t, code: j.daily.weather_code[i], hi: Math.round(j.daily.temperature_2m_max[i]), lo: Math.round(j.daily.temperature_2m_min[i]), pop: j.daily.precipitation_probability_max[i] })),
      hourly: j.hourly.time.map((t, i) => ({ t, temp: j.hourly.temperature_2m[i], pop: j.hourly.precipitation_probability[i], code: j.hourly.weather_code[i] })),
    };
    try { localStorage.setItem(CK, JSON.stringify(out)); } catch (_) { /* pełny magazyn */ }
    return out;
  } catch (e) {
    return c && c.key === key ? { ...c, stale: true } : null;
  }
}

export async function searchCity(name) {
  const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=5&language=pl&format=json`);
  if (!res.ok) throw new Error('Nie udało się wyszukać miejscowości.');
  const j = await res.json();
  return (j.results || []).map((r) => ({ name: r.name + (r.admin1 ? `, ${r.admin1}` : ''), lat: r.latitude, lon: r.longitude }));
}

// Krótka podpowiedź o opadach na dziś, np. „Deszcz około 17:00".
export function rainInsight(w, now = new Date()) {
  if (!w?.hourly) return null;
  const day = now.toISOString().slice(0, 10);
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const hrs = w.hourly.filter((h) => h.t.startsWith(todayStr) && +h.t.slice(11, 13) >= now.getHours() && +h.t.slice(11, 13) <= 22);
  const wet = hrs.find((h) => h.pop >= 55);
  if (!wet) return null;
  void day;
  return `Możliwy deszcz około ${wet.t.slice(11, 16)} (${wet.pop}%). Weź parasol.`;
}

export const dailyFor = (w, dateStr) => w?.daily?.find((x) => x.d === dateStr) || null;

// Prognoza na godzinę wydarzenia, np. { temp, pop, code } albo null (poza zakresem 7 dni).
export function hourlyFor(w, dateStr, hour) {
  const t = `${dateStr}T${String(hour).padStart(2, '0')}:00`;
  return w?.hourly?.find((h) => h.t === t) || null;
}

const OUTDOOR = /(bieg|biegan|spacer|rower|rowerem|piknik|grill|ognisk|mecz|trening na|boisk|park|ogród|ogrod|działk|dzialk|wycieczk|szlak|góry|gory|plaż|plaz|kajak|żagl|zagl|jezior|zoo|festiwal|koncert plener|rynek|rajd|nordic|golf|tenis|piłk|pilk)/i;
export const isOutdoor = (ev) => !!ev && (ev.outdoor === true || (ev.outdoor !== false && (OUTDOOR.test(`${ev.title || ''} ${ev.loc || ''}`) || ev.cat === 'sport')));
