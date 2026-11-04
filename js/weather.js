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
  const key = `v3:${city.lat},${city.lon}`;
  const c = cachedWeather();
  if (!force && c && c.key === key && Date.now() - c.t < 30 * 60000) return c;
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${city.lat}&longitude=${city.lon}&current=temperature_2m,apparent_temperature,weather_code,is_day&hourly=temperature_2m,apparent_temperature,precipitation_probability,weather_code,wind_gusts_10m&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=7`;
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
      hourly: j.hourly.time.map((t, i) => ({ t, temp: j.hourly.temperature_2m[i], feels: j.hourly.apparent_temperature[i], pop: j.hourly.precipitation_probability[i], code: j.hourly.weather_code[i], gust: j.hourly.wind_gusts_10m[i] })),
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

const pora = (h) => (h < 12 ? 'Rano' : h < 18 ? 'Po południu' : 'Wieczorem');
const LOW = { Rano: 'rano', 'Po południu': 'po południu', Wieczorem: 'wieczorem' };

// Ostrzeżenia na resztę dnia, od najważniejszych: { kind, icon, title, sub, sev }. „plan” to dzisiejsze wystąpienia wydarzeń na zewnątrz.
export function weatherAlerts(w, now = new Date(), plan = []) {
  if (!w?.hourly) return [];
  const pad = (n) => String(n).padStart(2, '0');
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const hrs = w.hourly.filter((h) => h.t.startsWith(today) && +h.t.slice(11, 13) >= now.getHours());
  if (!hrs.length) return [];
  const hh = (h) => +h.t.slice(11, 13);
  const out = [];
  const add = (x) => out.push(x);
  const storm = hrs.find((h) => h.code >= 95);
  if (storm) add({ kind: 'storm', icon: 'storm', sev: 5, at: storm, title: `${pora(hh(storm))} możliwa burza`, sub: `Około ${pad(hh(storm))}:00. Lepiej zostań pod dachem.` });
  const ice = hrs.find((h) => h.code === 56 || h.code === 57 || h.code === 66 || h.code === 67 || (h.temp <= 1 && h.temp >= -3 && h.pop >= 40));
  if (ice) add({ kind: 'ice', icon: 'alert', sev: 4, at: ice, title: `${pora(hh(ice))} może być ślisko`, sub: `Około ${pad(hh(ice))}:00 grozi gołoledź. Zaplanuj więcej czasu na drogę.` });
  const snow = hrs.find((h) => (h.code >= 71 && h.code <= 77) || h.code === 85 || h.code === 86);
  if (snow) add({ kind: 'snow', icon: 'snow', sev: 3, at: snow, title: `${pora(hh(snow))} możliwy śnieg`, sub: `Około ${pad(hh(snow))}:00. Ubierz się ciepło.` });
  const gust = hrs.find((h) => h.gust >= 60);
  if (gust) add({ kind: 'wind', icon: 'wind', sev: 3, at: gust, title: `${pora(hh(gust))} silny wiatr`, sub: `Porywy do ${Math.round(gust.gust)} km/h około ${pad(hh(gust))}:00.` });
  const rain = hrs.find((h) => h.pop >= 55 && h.code >= 51);
  if (rain && !snow) add({ kind: 'rain', icon: 'umbrella', sev: 2, at: rain, title: `${hh(rain) === now.getHours() ? 'Teraz' : `Dziś ${LOW[pora(hh(rain))]}`} możliwy deszcz`, sub: 'Weź ze sobą parasol.' });
  const hot = hrs.find((h) => h.feels >= 30);
  if (hot) add({ kind: 'heat', icon: 'sun', sev: 2, at: hot, title: 'Dziś upał', sub: `Odczuwalnie do ${Math.round(Math.max(...hrs.map((h) => h.feels)))}°. Pij dużo wody.` });
  const cold = hrs.find((h) => h.feels <= -10);
  if (cold) add({ kind: 'frost', icon: 'snow', sev: 2, at: cold, title: 'Dziś silny mróz', sub: `Odczuwalnie do ${Math.round(Math.min(...hrs.map((h) => h.feels)))}°. Ubierz się ciepło.` });
  out.sort((a, b) => b.sev - a.sev);
  // Dopasowanie do planu: wydarzenie na zewnątrz w godzinie zagrożenia.
  for (const x of out) {
    const bad = hrs.filter((h) => (x.kind === 'rain' ? h.pop >= 55 : x.kind === 'wind' ? h.gust >= 60 : x.kind === 'storm' ? h.code >= 95 : false)).map(hh);
    const ev = plan.find((i) => i.end > now && bad.some((b) => b >= i.start.getHours() && b <= i.end.getHours()));
    if (ev) { x.sub = `O ${pad(ev.start.getHours())}:${pad(ev.start.getMinutes())} masz: ${ev.title}. ${x.sub}`; break; }
  }
  return out.map(({ at, ...r }) => r);
}

export const dailyFor = (w, dateStr) => w?.daily?.find((x) => x.d === dateStr) || null;

// Prognoza na godzinę wydarzenia, np. { temp, pop, code } albo null (poza zakresem 7 dni).
export function hourlyFor(w, dateStr, hour) {
  const t = `${dateStr}T${String(hour).padStart(2, '0')}:00`;
  return w?.hourly?.find((h) => h.t === t) || null;
}

const OUTDOOR = /(bieg|biegan|spacer|rower|rowerem|piknik|grill|ognisk|mecz|trening na|boisk|park|ogród|ogrod|działk|dzialk|wycieczk|szlak|góry|gory|plaż|plaz|kajak|żagl|zagl|jezior|zoo|festiwal|koncert plener|rynek|rajd|nordic|golf|tenis|piłk|pilk)/i;
export const isOutdoor = (ev) => !!ev && (ev.outdoor === true || (ev.outdoor !== false && (OUTDOOR.test(`${ev.title || ''} ${ev.loc || ''}`) || ev.cat === 'sport')));
