// Widget Kalendarza dla Scriptable (ładowany przez loader; DATA_URL pochodzi z loadera).
// Parametr widgetu (opcjonalny): "slate" = chłodny grafit jak w widgecie Pogoda (domyślnie: ciemne szkło w tonie tapety).
const fm = FileManager.local();
const CACHE = fm.joinPath(fm.documentsDirectory(), 'kalendarz-widget-data.json');
const WXCACHE = fm.joinPath(fm.documentsDirectory(), 'kalendarz-widget-wx.json');
const APP_URL = 'https://lewym90.github.io/kalendarz/';
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const DAYS = ['niedziela', 'poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek', 'sobota'];
const DAYS3 = ['ndz.', 'pon.', 'wt.', 'śr.', 'czw.', 'pt.', 'sob.'];
const MONTHS = ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca', 'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia'];
const MONTHS_N = ['styczeń', 'luty', 'marzec', 'kwiecień', 'maj', 'czerwiec', 'lipiec', 'sierpień', 'wrzesień', 'październik', 'listopad', 'grudzień'];
const ACCENT = '#ff8a5c';
const C = (hex, a) => (a == null ? new Color(hex) : new Color(hex, a));
const WHITE = () => Color.white();
const DIM = () => C('#ffffff', 0.68);
const FAINT = () => C('#ffffff', 0.42);

async function cached(url, file, maxAgeMs, ok) {
  try { if (maxAgeMs && fm.fileExists(file)) { const o = JSON.parse(fm.readString(file)); if (Date.now() - o.t < maxAgeMs) return { v: o.v, stale: false }; } } catch (e) { /* */ }
  try { const v = await new Request(url).loadJSON(); if (v && ok(v)) { fm.writeString(file, JSON.stringify({ t: Date.now(), v })); return { v, stale: false }; } } catch (e) { /* offline */ }
  try { if (fm.fileExists(file)) return { v: JSON.parse(fm.readString(file)).v, stale: true }; } catch (e) { /* */ }
  return { v: null, stale: true };
}

// ---------- Pogoda (Open-Meteo, bez klucza) ----------
const wxUrl = (g) => `https://api.open-meteo.com/v1/forecast?latitude=${g.lat}&longitude=${g.lon}&current=temperature_2m,weather_code,is_day&hourly=temperature_2m,precipitation_probability,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=3`;
function wxModel(w, now) {
  if (!w || !w.current || !w.daily || !w.hourly) return null;
  const times = w.hourly.time || [];
  const idx = Math.max(0, times.findIndex((t) => new Date(t) >= new Date(now.getTime() - 1800000)));
  const hours = [];
  for (let i = idx; i < idx + 6 && i < times.length; i++) hours.push({ h: new Date(times[i]).getHours(), t: Math.round(w.hourly.temperature_2m[i]), code: w.hourly.weather_code[i] });
  const r = (a, i) => (a && a[i] != null ? Math.round(a[i]) : null);
  return { t: Math.round(w.current.temperature_2m), code: w.current.weather_code, day: w.current.is_day === 1, hi: r(w.daily.temperature_2m_max, 0), lo: r(w.daily.temperature_2m_min, 0), rain: (w.daily.precipitation_probability_max || [])[0] || 0, tmHi: r(w.daily.temperature_2m_max, 1), tmCode: (w.daily.weather_code || [])[1], hours };
}
function wxSym(code, day) {
  if (code === 0) return day ? 'sun.max.fill' : 'moon.stars.fill';
  if (code <= 2) return day ? 'cloud.sun.fill' : 'cloud.moon.fill';
  if (code === 3) return 'cloud.fill';
  if (code === 45 || code === 48) return 'cloud.fog.fill';
  if (code >= 51 && code <= 57) return 'cloud.drizzle.fill';
  if (code >= 80 && code <= 82) return 'cloud.heavyrain.fill';
  if (code >= 61 && code <= 67) return 'cloud.rain.fill';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'cloud.snow.fill';
  if (code >= 95) return 'cloud.bolt.rain.fill';
  return 'cloud.fill';
}
const wxText = (c) => (c === 0 ? 'Bezchmurnie' : c <= 2 ? 'Częściowo pochmurno' : c === 3 ? 'Pochmurno' : c <= 48 ? 'Mgła' : c <= 57 ? 'Mżawka' : c <= 67 ? 'Deszcz' : c <= 77 ? 'Śnieg' : c <= 82 ? 'Przelotny deszcz' : c <= 86 ? 'Przelotny śnieg' : 'Burza');

// ---------- Dane dnia ----------
const at = (day, hm, end) => new Date(`${day}T${hm || (end ? '23:59' : '00:00')}:00`);
const left = (ms) => { const m = Math.max(1, Math.round(ms / 60000)); if (m < 60) return `${m} min`; const h = Math.floor(m / 60), r = m % 60; return r ? `${h} godz. ${r} min` : `${h} godz.`; };
function model(data, now = new Date()) {
  const today = ymd(now), tomorrow = ymd(new Date(now.getTime() + 86400000));
  const dayOf = (k) => ((data && data.days) || []).find((d) => d.d === k) || { d: k, items: [] };
  const mk = (day) => dayOf(day).items.map((i) => ({ ...i, start: i.ad ? at(day, '') : at(day, i.s), end: i.ad ? at(day, '', true) : (i.e ? at(day, i.e) : at(day, i.s)) }));
  const t = mk(today), tm = mk(tomorrow);
  const events = t.filter((i) => i.k === 'e' && !i.ad), allday = t.filter((i) => i.k === 'e' && i.ad), tasks = t.filter((i) => i.k === 't');
  const ongoing = events.find((i) => i.start <= now && now < i.end) || null;
  const upcoming = events.filter((i) => i.start > now);
  const rows = [];
  if (ongoing) rows.push({ ...ongoing, isNow: true });
  upcoming.forEach((i) => rows.push(i));
  allday.forEach((i) => rows.push({ ...i, label: 'cały dz.' }));
  tasks.forEach((i) => rows.push(i));
  const cnt = { ...((data && data.cnt) || {}) };
  ((data && data.days) || []).forEach((d) => { if (d.items.length && !cnt[d.d]) cnt[d.d] = d.items.length; });
  return { now, tm, ongoing, upcoming, allday, tasks, rows, remaining: upcoming.length + (ongoing ? 1 : 0) + tasks.length + allday.length, tomorrowFirst: tm.find((i) => i.k === 'e') || tm[0] || null, cnt };
}
const line = (i) => `${i.k === 't' ? '☐ ' : ''}${i.s ? i.s + ' ' : ''}${i.t}`;

// ---------- Klocki ----------
function txt(p, s, size, weight, color, lines = 1) {
  const t = p.addText(String(s));
  t.font = weight === 'h' ? Font.heavySystemFont(size) : weight === 'b' ? Font.boldSystemFont(size) : weight === 'm' ? Font.mediumSystemFont(size) : Font.systemFont(size);
  if (color) t.textColor = color;
  t.lineLimit = lines; t.minimumScaleFactor = 0.8;
  return t;
}
function icon(p, name, size, color) {
  try { const s = SFSymbol.named(name); s.applyFont(Font.systemFont(size)); const im = p.addImage(s.image); im.imageSize = new Size(size, size); im.tintColor = color || WHITE(); return im; } catch (e) { return null; }
}
function centered(p, fn) { const s = p.addStack(); s.addSpacer(); fn(s); s.addSpacer(); return s; }

function monthImage(m, o) {
  const now = m.now, y = now.getFullYear(), mo = now.getMonth();
  const first = (new Date(y, mo, 1).getDay() + 6) % 7, dim = new Date(y, mo + 1, 0).getDate();
  const rows = Math.ceil((first + dim) / 7);
  const W = o.cell * 7, TOP = o.title + o.hrow + 2, H = TOP + 6 * o.row;
  const dc = new DrawContext();
  dc.size = new Size(W, H); dc.opaque = false; dc.respectScreenScale = true;
  const put = (s, x, y0, w, h, font, color, center) => { dc.setFont(font); dc.setTextColor(color); if (center) dc.setTextAlignedCenter(); else dc.setTextAlignedLeft(); dc.drawTextInRect(String(s), new Rect(x, y0, w, h)); };
  put(MONTHS_N[mo][0].toUpperCase() + MONTHS_N[mo].slice(1) + ' ' + y, 1, 0, W, o.title + 3, Font.boldSystemFont(o.title), C(ACCENT), false);
  ['P', 'W', 'Ś', 'C', 'P', 'S', 'N'].forEach((d, i) => put(d, i * o.cell, o.title + 2, o.cell, o.hrow, Font.mediumSystemFont(o.size - 2), i > 4 ? FAINT() : DIM(), true));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < 7; c++) {
      const day = r * 7 + c - first + 1;
      if (day < 1 || day > dim) continue;
      const key = `${y}-${pad(mo + 1)}-${pad(day)}`, isToday = day === now.getDate();
      const cx = c * o.cell + o.cell / 2, cy = TOP + r * o.row + o.pill / 2;
      if (isToday) { dc.setFillColor(C(ACCENT)); dc.fillEllipse(new Rect(cx - o.pill / 2, cy - o.pill / 2, o.pill, o.pill)); }
      put(day, c * o.cell, cy - o.size * 0.62, o.cell, o.size + 4, isToday ? Font.heavySystemFont(o.size) : Font.mediumSystemFont(o.size), isToday ? WHITE() : (c > 4 ? C('#ffffff', 0.6) : WHITE()), true);
      if (m.cnt[key] && !isToday) { dc.setFillColor(C(ACCENT)); dc.fillEllipse(new Rect(cx - 1.5, cy + o.pill / 2 + 0.5, 3, 3)); }
    }
  }
  return { img: dc.getImage(), size: new Size(W, H) };
}
function monthGrid(p, m, o) { const r = monthImage(m, o); const im = p.addImage(r.img); im.imageSize = r.size; return im; }
function planRow(p, i, now, o) {
  const r = p.addStack(); r.centerAlignContent(); r.spacing = 6; r.size = new Size(o.w, o.h);
  const bar = r.addStack(); bar.size = new Size(3, o.h - 3); bar.cornerRadius = 1.5; bar.backgroundColor = i.isNow ? C(ACCENT) : (i.c ? C(i.c) : C('#ffffff', 0.5));
  const tm = r.addStack(); tm.size = new Size(o.tw, 0);
  txt(tm, i.isNow ? 'teraz' : (i.label || i.s || (i.k === 't' ? 'zadanie' : '')), o.size - 1, 'b', i.isNow ? C(ACCENT) : DIM());
  txt(r, (i.k === 't' ? '☐ ' : '') + i.t, o.size, 'm', WHITE());
  return r;
}
function plan(p, m, max, o) {
  if (!m.rows.length) {
    txt(p, 'Dziś bez planów', o.size + 1, 'b', WHITE());
    if (m.tomorrowFirst) txt(p, `Jutro: ${line(m.tomorrowFirst)}`, o.size - 1, 'm', DIM(), 2);
    return;
  }
  m.rows.slice(0, max).forEach((i) => planRow(p, i, m.now, o));
  if (m.rows.length > max) txt(p, `+${m.rows.length - max} więcej`, o.size - 2, 'm', FAINT());
}
function weatherRow(p, wx, o) {
  const r = p.addStack(); r.centerAlignContent(); r.spacing = 7;
  if (!wx) return r;
  icon(r, wxSym(wx.code, wx.day), o.icon, C(ACCENT));
  txt(r, `${wx.t}°`, o.temp, 'h', WHITE());
  const c = r.addStack(); c.layoutVertically(); c.spacing = 0;
  txt(c, wxText(wx.code), o.size, 'b', WHITE());
  txt(c, `${wx.lo}° / ${wx.hi}°${wx.rain >= 30 ? '  ·  ' + wx.rain + '%' : ''}`, o.size - 1, 'm', DIM());
  return r;
}
function hourly(p, wx, o) {
  if (!wx) return;
  const r = p.addStack(); r.centerAlignContent(); r.spacing = 0;
  wx.hours.forEach((h, i) => {
    const c = r.addStack(); c.layoutVertically(); c.centerAlignContent(); c.spacing = 2; c.size = new Size(o.w, 0);
    centered(c, (s) => txt(s, i === 0 ? 'Teraz' : `${h.h}`, o.size - 2, 'm', DIM()));
    centered(c, (s) => icon(s, wxSym(h.code, h.h >= 6 && h.h < 20), o.icon, WHITE()));
    centered(c, (s) => txt(s, `${h.t}°`, o.size, 'b', WHITE()));
  });
}

// ---------- Ekran blokady ----------
function lockWidget(w, family, m, wx, stale) {
  const t = wx ? `${wx.t}° · ` : '';
  if (family === 'accessoryInline') {
    w.addText(m.ongoing ? `${t}Teraz: ${m.ongoing.t}` : m.upcoming[0] ? `${t}${m.upcoming[0].s} ${m.upcoming[0].t}` : m.tasks[0] ? `${t}☐ ${m.tasks[0].t}` : m.allday[0] ? `${t}${m.allday[0].t}` : m.tomorrowFirst ? `${t}Jutro ${m.tomorrowFirst.s ? m.tomorrowFirst.s + ' ' : ''}${m.tomorrowFirst.t}` : `${t}Brak planów`);
    return;
  }
  if (family === 'accessoryCircular') {
    const st = w.addStack(); st.layoutVertically(); st.centerAlignContent();
    centered(st, (s) => txt(s, String(m.remaining), 24, 'b'));
    centered(st, (s) => txt(s, wx ? `${wx.t}°` : 'dziś', 10, 'm'));
    return;
  }
  const h = w.addStack(); h.centerAlignContent();
  txt(h, m.ongoing ? `Teraz · ${left(m.ongoing.end - m.now)}` : `Dziś · ${m.remaining}${stale ? ' ·' : ''}`, 12, 'b'); h.addSpacer();
  if (wx) txt(h, `${wx.t}°`, 12, 'b');
  const rows = [];
  if (m.ongoing) rows.push(m.ongoing);
  m.upcoming.slice(0, 3).forEach((i) => rows.push(i)); m.tasks.slice(0, 3).forEach((i) => rows.push(i));
  if (!rows.length) { txt(w, m.tomorrowFirst ? `Jutro: ${line(m.tomorrowFirst)}` : 'Brak planów', 12, 'm', null, 2); return; }
  rows.slice(0, m.ongoing ? 2 : 3).forEach((i) => txt(w, line(i), 12, 'm'));
}

// ---------- Ekran główny ----------
function glass(w, param) {
  const g = new LinearGradient();
  if (param === 'szklo') g.colors = [C('#33261f', 0.84), C('#14100e', 0.92)];
  else g.colors = [C('#3b4357', 0.94), C('#232837', 0.97)];
  g.locations = [0, 1];
  w.backgroundGradient = g;
}
function homeWidget(w, family, m, wx, stale, param) {
  glass(w, param);
  const now = m.now;
  const dateStr = `${DAYS[now.getDay()]} ${now.getDate()} ${MONTHS[now.getMonth()]}`;

  if (family === 'small') {
    w.setPadding(12, 13, 10, 13);
    const top = w.addStack(); top.centerAlignContent();
    const dc = top.addStack(); dc.layoutVertically();
    txt(dc, DAYS3[now.getDay()].toUpperCase(), 11, 'b', C(ACCENT)); txt(dc, now.getDate(), 30, 'h', WHITE());
    top.addSpacer();
    if (wx) { const wc = top.addStack(); wc.layoutVertically(); centered(wc, (s) => icon(s, wxSym(wx.code, wx.day), 22, C(ACCENT))); centered(wc, (s) => txt(s, `${wx.t}°`, 22, 'h', WHITE())); }
    w.addSpacer(6);
    plan(w, m, 2, { size: 12, h: 18, tw: 34, w: 140 });
    w.addSpacer();
    return;
  }

  if (family === 'medium') {
    w.setPadding(10, 13, 8, 13);
    const body = w.addStack(); body.spacing = 11; body.centerAlignContent();
    const lc = body.addStack(); lc.layoutVertically();
    monthGrid(lc, m, { cell: 20, row: 17, hrow: 12, pill: 15, size: 10.5, title: 11.5 });
    const dv = body.addStack(); dv.size = new Size(0.5, 128); dv.backgroundColor = C('#ffffff', 0.16);
    const rc = body.addStack(); rc.layoutVertically(); rc.spacing = 4;
    txt(rc, dateStr.charAt(0).toUpperCase() + dateStr.slice(1), 12, 'b', WHITE());
    weatherRow(rc, wx, { icon: 24, temp: 26, size: 11 });
    const hr = rc.addStack(); hr.size = new Size(160, 0.5); hr.backgroundColor = C('#ffffff', 0.14);
    plan(rc, m, 3, { size: 12, h: 19, tw: 36, w: 160 });
    rc.addSpacer();
    return;
  }

  // large
  w.setPadding(14, 15, 12, 15);
  const top = w.addStack(); top.centerAlignContent();
  const tl = top.addStack(); tl.layoutVertically(); tl.spacing = 2;
  txt(tl, dateStr, 13, 'b', C(ACCENT));
  weatherRow(tl, wx, { icon: 28, temp: 32, size: 12 });
  top.addSpacer(); if (stale) txt(top, 'offline', 10, 'm', FAINT());
  if (wx) { w.addSpacer(6); hourly(w, wx, { w: 52, size: 12, icon: 15 }); }
  w.addSpacer(8);
  const mid = w.addStack(); mid.spacing = 14;
  const lc = mid.addStack(); lc.layoutVertically(); monthGrid(lc, m, { cell: 22, row: 21, hrow: 14, pill: 17, size: 11.5, title: 12.5 });
  const rc = mid.addStack(); rc.layoutVertically(); rc.spacing = 3;
  txt(rc, `Plan dnia · ${m.remaining}`, 12, 'b', DIM());
  plan(rc, m, 6, { size: 12, h: 21, tw: 38, w: 150 });
  w.addSpacer();
  const tmr = w.addStack(); tmr.centerAlignContent(); tmr.spacing = 6;
  const te = m.tm.filter((i) => i.k === 'e').slice(0, 2);
  txt(tmr, 'Jutro', 11, 'b', C(ACCENT));
  txt(tmr, te.length ? te.map((i) => `${i.ad ? '' : i.s + ' '}${i.t}`).join(' · ') : 'bez wydarzeń', 11, 'm', WHITE());
  if (wx && wx.tmHi != null) { tmr.addSpacer(); icon(tmr, wxSym(wx.tmCode == null ? 3 : wx.tmCode, true), 11, DIM()); txt(tmr, `${wx.tmHi}°`, 11, 'b', DIM()); }
}

// ---------- Start ----------
const dres = await cached(DATA_URL, CACHE, 0, (v) => !!v.days);
const data = dres.v;
let wx = null;
if (data && data.geo && data.geo.lat != null) {
  const wres = await cached(wxUrl(data.geo), WXCACHE, 15 * 60000, (v) => !!v.current);
  wx = wxModel(wres.v, new Date());
}
const m = model(data);
const family = config.widgetFamily || 'medium';
const param = String(args.widgetParameter || '').toLowerCase();
const w = new ListWidget();
w.url = APP_URL;
w.refreshAfterDate = new Date(Date.now() + 10 * 60000);
if (!data) w.addText('Kalendarz: brak danych. Otwórz aplikację i połącz powiadomienia z serwerem.');
else if (family.startsWith('accessory')) lockWidget(w, family, m, wx, dres.stale);
else homeWidget(w, family, m, wx, dres.stale, param);
if (config.runsInWidget) Script.setWidget(w);
else if (family.startsWith('accessory') || family === 'small') await w.presentSmall();
else if (family === 'large') await w.presentLarge();
else await w.presentMedium();
Script.complete();
