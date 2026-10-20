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
// Rozmiary widgetów (pt) wg szerokości ekranu: [średni szer., średni wys., duży wys.]
const SIZES = { 440: [364, 170, 382], 430: [364, 170, 382], 428: [364, 170, 382], 414: [360, 169, 376], 402: [350, 162, 359], 393: [338, 158, 354], 390: [338, 158, 354], 375: [321, 148, 324], 360: [304, 142, 306] };
const SZ = SIZES[Math.round(Device.screenSize().width)] || SIZES[393];
const C = (hex, a) => (a == null ? new Color(hex) : new Color(hex, a));
const WHITE = () => Color.white();
const DIM = () => C('#ffffff', 0.68);
const FAINT = () => C('#ffffff', 0.42);

async function cached(url, file, maxAgeMs, ok) {
  try { if (maxAgeMs && fm.fileExists(file)) { const o = JSON.parse(fm.readString(file)); if (Date.now() - o.t < maxAgeMs) return { v: o.v, stale: false, fail: '' }; } } catch (e) { /* */ }
  let fail = '';
  try {
    const rq = new Request(url); const v = await rq.loadJSON();
    if (v && ok(v)) { fm.writeString(file, JSON.stringify({ t: Date.now(), v })); return { v, stale: false, fail: '' }; }
    fail = String((rq.response && rq.response.statusCode) || 'dane');
  } catch (e) { fail = 'sieć'; }
  try { if (fm.fileExists(file)) return { v: JSON.parse(fm.readString(file)).v, stale: true, fail }; } catch (e) { /* */ }
  return { v: null, stale: true, fail };
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
const wxText = (c) => (c === 0 ? 'Bezchmurnie' : c === 1 ? 'Pogodnie' : c === 2 ? 'Zmienne chmury' : c === 3 ? 'Pochmurno' : c <= 48 ? 'Mgła' : c <= 57 ? 'Mżawka' : c <= 67 ? 'Deszcz' : c <= 77 ? 'Śnieg' : c <= 82 ? 'Przelotny deszcz' : c <= 86 ? 'Przelotny śnieg' : 'Burza');

// ---------- Dane dnia ----------
const at = (day, hm, end) => new Date(`${day}T${hm || (end ? '23:59' : '00:00')}:00`);
const left = (ms) => { const m = Math.max(1, Math.round(ms / 60000)); if (m < 60) return `${m} min`; const h = Math.floor(m / 60), r = m % 60; return r ? `${h} godz. ${r} min` : `${h} godz.`; };
function model(data, now = new Date()) {
  const today = ymd(now), tomorrow = ymd(new Date(now.getTime() + 86400000));
  const dayOf = (k) => ((data && data.days) || []).find((d) => d.d === k) || { d: k, items: [] };
  const mk = (day) => dayOf(day).items.map((i) => ({ ...i, start: i.ad ? at(day, '') : at(day, i.s), end: i.ad ? at(day, '', true) : (i.e ? at(day, i.e) : at(day, i.s)) }));
  const t = mk(today), tm = mk(tomorrow);
  const own = (i) => !i.w;
  const events = t.filter((i) => i.k === 'e' && !i.ad && own(i)), allday = t.filter((i) => i.k === 'e' && i.ad && own(i)), tasks = t.filter((i) => i.k === 't');
  const ongoing = events.find((i) => i.start <= now && now < i.end) || null;
  const upcoming = events.filter((i) => i.start > now);
  // plan do wyświetlenia: trwające moje, potem wszystkie przyszłe (moje i cudze) wg czasu, całodniowe, zadania
  const timedAll = t.filter((i) => i.k === 'e' && !i.ad && i.end > now && i !== ongoing).sort((a, b) => a.start - b.start);
  const rows = [];
  if (ongoing) rows.push({ ...ongoing, isNow: true });
  timedAll.forEach((i) => rows.push(i));
  t.filter((i) => i.k === 'e' && i.ad).forEach((i) => rows.push({ ...i, label: 'cały dz.' }));
  tasks.forEach((i) => rows.push(i));
  const cnt = { ...((data && data.cnt) || {}) };
  ((data && data.days) || []).forEach((d) => { const n = d.items.filter(own).length; if (n && !cnt[d.d]) cnt[d.d] = n; });
  return { now, tm: tm.filter(own), ongoing, upcoming, allday, tasks, rows, remaining: upcoming.length + (ongoing ? 1 : 0) + tasks.length + allday.length, tomorrowFirst: tm.filter(own).find((i) => i.k === 'e') || tm.filter(own)[0] || null, cnt, pcnt: (data && data.pcnt) || {}, pcol: (data && data.pcol) || '#34d3ff' };
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
  const cw = o.w / 7, TOP = o.title + o.hrow + 2, rh = (o.h - TOP) / rows;
  const pill = Math.min(cw - 3, rh - 5.5), fs = Math.max(9, pill * 0.7);
  const dc = new DrawContext();
  dc.size = new Size(o.w, o.h); dc.opaque = false; dc.respectScreenScale = true;
  const put = (s, x, y0, w, h, font, color, center) => { dc.setFont(font); dc.setTextColor(color); if (center) dc.setTextAlignedCenter(); else dc.setTextAlignedLeft(); dc.drawTextInRect(String(s), new Rect(x, y0, w, h)); };
  put(MONTHS_N[mo][0].toUpperCase() + MONTHS_N[mo].slice(1) + ' ' + y, 1, 0, o.w, o.title + 4, Font.boldSystemFont(o.title), C(ACCENT), false);
  ['P', 'W', 'Ś', 'C', 'P', 'S', 'N'].forEach((d, i) => put(d, i * cw, o.title + 2, cw, o.hrow, Font.mediumSystemFont(fs - 1.5), i > 4 ? FAINT() : DIM(), true));
  const dot = (cx, y0, col) => { dc.setFillColor(col); dc.fillEllipse(new Rect(cx - 1.6, y0, 3.2, 3.2)); };
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < 7; c++) {
      const day = r * 7 + c - first + 1;
      if (day < 1 || day > dim) continue;
      const key = `${y}-${pad(mo + 1)}-${pad(day)}`, isToday = day === now.getDate();
      const cx = c * cw + cw / 2, top = TOP + r * rh + (rh - pill - 4.5) / 2, cy = top + pill / 2;
      if (isToday) { dc.setFillColor(C(ACCENT)); dc.fillEllipse(new Rect(cx - pill / 2, top, pill, pill)); }
      put(day, c * cw, cy - fs * 0.62, cw, fs + 4, isToday ? Font.heavySystemFont(fs) : Font.mediumSystemFont(fs), isToday ? WHITE() : (c > 4 ? C('#ffffff', 0.62) : WHITE()), true);
      const a = !!m.cnt[key], b = !!m.pcnt[key], dy = top + pill + 1.4;
      if (a && b) { dot(cx - 2.6, dy, C(ACCENT)); dot(cx + 2.6, dy, C(m.pcol)); } else if (a) dot(cx, dy, C(ACCENT)); else if (b) dot(cx, dy, C(m.pcol));
    }
  }
  return { img: dc.getImage(), size: new Size(o.w, o.h) };
}
function monthGrid(p, m, o) { const r = monthImage(m, o); const im = p.addImage(r.img); im.imageSize = r.size; return im; }
function planRow(p, i, now, o) {
  const r = p.addStack(); r.centerAlignContent(); r.spacing = 5; r.size = new Size(o.w, o.h);
  const bar = r.addStack(); bar.size = new Size(3, o.h - 4); bar.cornerRadius = 1.5; bar.backgroundColor = i.isNow ? C(ACCENT) : (i.c ? C(i.c) : C('#ffffff', 0.5));
  const tm = r.addStack(); tm.size = new Size(o.tw, 0);
  txt(tm, i.isNow ? 'teraz' : (i.label || i.s || (i.k === 't' ? 'zadanie' : '')), o.size - 1, 'b', i.isNow ? C(ACCENT) : DIM());
  if (i.w) { const b = r.addStack(); b.size = new Size(12, 12); b.cornerRadius = 6; b.backgroundColor = C(i.c || '#34d3ff'); b.centerAlignContent(); centered(b, (q) => txt(q, i.w, 8, 'h', WHITE())); }
  txt(r, (i.k === 't' ? '☐ ' : '') + i.t, o.size, 'm', WHITE());
  return r;
}
function plan(p, m, max, o) {
  if (!m.rows.length) {
    txt(p, 'Dziś bez planów', o.size + 1, 'b', WHITE());
    if (m.tomorrowFirst) txt(p, `Jutro: ${line(m.tomorrowFirst)}`, o.size - 1, 'm', DIM(), 2);
    return;
  }
  const n = m.rows.length <= max ? max : max - 1;
  m.rows.slice(0, n).forEach((i) => planRow(p, i, m.now, o));
  if (m.rows.length > n) txt(p, `+${m.rows.length - n} więcej`, o.size - 2, 'm', FAINT());
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

  const colSp = (p, wd, h) => { const x = p.addStack(); x.size = new Size(wd, h); return x; };
  if (family === 'medium') {
    const W = SZ[0], H = SZ[1], pl = 10, pr = 12, pv = 8, CH = H - 2 * pv, LW = 136;
    w.setPadding(pv, pl, pv, pr);
    const body = w.addStack(); body.size = new Size(W - pl - pr, CH); body.centerAlignContent(); body.spacing = 0;
    const lc = body.addStack(); lc.size = new Size(LW, CH);
    monthGrid(lc, m, { w: LW, h: CH, title: 13, hrow: 12 });
    colSp(body, 6, CH);
    const dv = body.addStack(); dv.size = new Size(0.5, CH - 10); dv.backgroundColor = C('#ffffff', 0.18);
    colSp(body, 10, CH);
    const RW = W - pl - pr - LW - 16.5;
    const rc = body.addStack(); rc.layoutVertically(); rc.size = new Size(RW, CH); rc.spacing = 3;
    const hd = rc.addStack(); hd.centerAlignContent(); hd.size = new Size(RW, 16);
    txt(hd, `${DAYS3[now.getDay()].replace('.', '')} ${now.getDate()} ${MONTHS[now.getMonth()]}`.replace(/^./, (c) => c.toUpperCase()), 12.5, 'b', WHITE());
    hd.addSpacer();
    // Znacznik widać tylko, gdy coś jest nie tak: brak połączenia albo dane starsze niż 3 godziny.
    if (dres.stale) txt(hd, `⚠ ${dres.fail || 'offline'}`, 8.5, 'b', C(ACCENT));
    else if (syncGen && now.getTime() - syncGen > 3 * 3600000) txt(hd, `⚠ ${pad(new Date(syncGen).getHours())}:${pad(new Date(syncGen).getMinutes())}`, 8.5, 'b', C(ACCENT));
    weatherRow(rc, wx, { icon: 22, temp: 25, size: 10.5 });
    const hr = rc.addStack(); hr.size = new Size(RW, 0.5); hr.backgroundColor = C('#ffffff', 0.16);
    plan(rc, m, 4, { size: 12, h: 20, tw: 33, w: RW });
    rc.addSpacer();
    return;
  }

  // large
  const W = SZ[0], H = SZ[2], pad2 = 13, CW = W - 2 * pad2, CH = H - 2 * pad2;
  w.setPadding(pad2, pad2, pad2, pad2);
  const col = w.addStack(); col.layoutVertically(); col.size = new Size(CW, CH); col.spacing = 0;
  const top = col.addStack(); top.size = new Size(CW, 40); top.centerAlignContent();
  const tl = top.addStack(); tl.layoutVertically(); tl.spacing = 1;
  txt(tl, `${DAYS[now.getDay()]} ${now.getDate()} ${MONTHS[now.getMonth()]}`.replace(/^./, (c) => c.toUpperCase()), 13, 'b', WHITE());
  weatherRow(tl, wx, { icon: 20, temp: 24, size: 10.5 });
  top.addSpacer(); if (stale) txt(top, 'offline', 10, 'm', FAINT());
  const hh = col.addStack(); hh.size = new Size(CW, 46); hourly(hh, wx, { w: CW / 6, size: 12, icon: 15 });
  const hr = col.addStack(); hr.size = new Size(CW, 0.5); hr.backgroundColor = C('#ffffff', 0.16);
  const MH = CH - 40 - 46 - 0.5 - 24 - 12;
  const mid = col.addStack(); mid.size = new Size(CW, MH + 12); mid.centerAlignContent(); mid.spacing = 0;
  const LWl = 162;
  const lc = mid.addStack(); lc.size = new Size(LWl, MH); monthGrid(lc, m, { w: LWl, h: MH, title: 13, hrow: 13 });
  colSp(mid, 8, MH);
  const dv = mid.addStack(); dv.size = new Size(0.5, MH - 10); dv.backgroundColor = C('#ffffff', 0.18);
  colSp(mid, 10, MH);
  const RWl = CW - LWl - 18.5;
  const rc = mid.addStack(); rc.layoutVertically(); rc.size = new Size(RWl, MH); rc.spacing = 3;
  txt(rc, `Plan dnia · ${m.remaining}`, 12, 'b', DIM());
  plan(rc, m, 8, { size: 12, h: 22, tw: 33, w: RWl });
  rc.addSpacer();
  const tmr = col.addStack(); tmr.size = new Size(CW, 24); tmr.centerAlignContent(); tmr.spacing = 6;
  const te = m.tm.filter((i) => i.k === 'e').slice(0, 2);
  txt(tmr, 'Jutro', 11, 'b', C(ACCENT));
  txt(tmr, te.length ? te.map((i) => `${i.ad ? '' : i.s + ' '}${i.t}`).join(' · ') : 'bez wydarzeń', 11, 'm', WHITE());
  if (wx && wx.tmHi != null) { tmr.addSpacer(); icon(tmr, wxSym(wx.tmCode == null ? 3 : wx.tmCode, true), 11, DIM()); txt(tmr, `${wx.tmHi}°`, 11, 'b', DIM()); }
}

// ---------- Start ----------
const dres = await cached(DATA_URL, CACHE, 0, (v) => !!v.days);
const data = dres.v;
let wx = null;
let geo = data && data.geo && data.geo.lat != null ? data.geo : null;
// Aktualna lokalizacja telefonu (Scriptable pyta o zgodę raz); gdy się nie uda, bierzemy miasto z aplikacji.
try {
  Location.setAccuracyToThreeKilometers();
  const l = await Promise.race([Location.current(), new Promise((_, rej) => Timer.schedule(4000, false, () => rej(new Error('t'))))]);
  if (l && Number.isFinite(l.latitude)) geo = { n: geo ? geo.n : '', lat: l.latitude, lon: l.longitude };
} catch (e) { /* bez lokalizacji */ }
if (geo) {
  const wcache = WXCACHE.replace('.json', `-${(+geo.lat).toFixed(1)}_${(+geo.lon).toFixed(1)}.json`);
  const wres = await cached(wxUrl(geo), wcache, 15 * 60000, (v) => !!v.current);
  wx = wxModel(wres.v, new Date());
}
const m = model(data);
const syncGen = data && data.gen ? +data.gen : 0;
const family = config.widgetFamily || 'medium';
const param = String(args.widgetParameter || '').toLowerCase();
const w = new ListWidget();
w.url = APP_URL;
w.refreshAfterDate = new Date(Date.now() + 5 * 60000);
if (!data) w.addText('Kalendarz: brak danych. Otwórz aplikację i połącz powiadomienia z serwerem.');
else if (family.startsWith('accessory')) lockWidget(w, family, m, wx, dres.stale);
else homeWidget(w, family, m, wx, dres.stale, param);
if (config.runsInWidget) Script.setWidget(w);
else if (family.startsWith('accessory') || family === 'small') await w.presentSmall();
else if (family === 'large') await w.presentLarge();
else await w.presentMedium();
Script.complete();
