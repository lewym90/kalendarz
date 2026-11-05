// Widget Kalendarza dla Scriptable (ładowany przez loader; DATA_URL pochodzi z loadera).
// Styl: granatowe szkło, zdjęcie gór zależne od pory dnia i pogody, świetlista ramka. Tło składamy z gotowych grafik z img/widget/.
const fm = FileManager.local();
const CACHE = fm.joinPath(fm.documentsDirectory(), 'kalendarz-widget-data.json');
const WXCACHE = fm.joinPath(fm.documentsDirectory(), 'kalendarz-widget-wx.json');
const APP_URL = 'https://lewym90.github.io/kalendarz/';
const ASSETS = `${APP_URL}img/widget/`;
const ASSET_V = 2; // podbij po wymianie grafik, wtedy widget pobierze je od nowa
const ADIR = fm.joinPath(fm.documentsDirectory(), `kalendarz-widget-assets-${ASSET_V}`);
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

// Grafiki pobieramy raz i trzymamy w telefonie; bez sieci widget działa na kopii, a gdy jej nie ma, rysuje się bez niej.
const aPath = (n) => fm.joinPath(ADIR, n.replace(/\//g, '-'));
async function asset(n) {
  const p = aPath(n);
  if (fm.fileExists(p)) return true;
  try { if (!fm.fileExists(ADIR)) fm.createDirectory(ADIR, true); const rq = new Request(ASSETS + n); const d = await rq.load(); if (!d || (rq.response && rq.response.statusCode !== 200)) return false; fm.write(p, d); return true; } catch (e) { return false; }
}
const aImg = (n) => { try { const p = aPath(n); return fm.fileExists(p) ? fm.readImage(p) : null; } catch (e) { return null; } };

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
const wxUrl = (g) => `https://api.open-meteo.com/v1/forecast?latitude=${g.lat}&longitude=${g.lon}&current=temperature_2m,weather_code,is_day&hourly=temperature_2m,precipitation_probability,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset&timezone=auto&forecast_days=3`;
function wxModel(w, now) {
  if (!w || !w.current || !w.daily || !w.hourly) return null;
  const times = w.hourly.time || [];
  const idx = Math.max(0, times.findIndex((t) => new Date(t) >= new Date(now.getTime() - 1800000)));
  const hours = [];
  for (let i = idx; i < idx + 6 && i < times.length; i++) hours.push({ h: new Date(times[i]).getHours(), t: Math.round(w.hourly.temperature_2m[i]), code: w.hourly.weather_code[i] });
  const r = (a, i) => (a && a[i] != null ? Math.round(a[i]) : null);
  return { t: Math.round(w.current.temperature_2m), code: w.current.weather_code, day: w.current.is_day === 1, hi: r(w.daily.temperature_2m_max, 0), lo: r(w.daily.temperature_2m_min, 0), rain: (w.daily.precipitation_probability_max || [])[0] || 0, tmHi: r(w.daily.temperature_2m_max, 1), tmCode: (w.daily.weather_code || [])[1], sunrise: (w.daily.sunrise || [])[0], sunset: (w.daily.sunset || [])[0], hours };
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
const wxPic = (code, day) => {
  if (code <= 1) return day ? 'slonce' : 'ksiezyc';
  if (code === 2) return day ? 'slonce-chmura' : 'ksiezyc-chmura';
  if (code === 3) return 'chmura';
  if (code === 45 || code === 48) return 'mgla';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snieg';
  if (code >= 95) return 'burza';
  return 'deszcz';
};
// Ta sama logika co zdjęcie w aplikacji: pora dnia z godzin słońca, pogoda ma pierwszeństwo przed czystym niebem.
function skyName(now, wx) {
  const mins = (s, f) => { if (!s) return f; const d = new Date(s); return d.getHours() * 60 + d.getMinutes(); };
  const r = mins(wx && wx.sunrise, 420), s = mins(wx && wx.sunset, 1020), mn = now.getHours() * 60 + now.getMinutes(), c = wx ? wx.code : null;
  const day = mn >= r - 30 && mn <= s + 20;
  if (c != null) {
    if ((c >= 71 && c <= 77) || c === 85 || c === 86) return day ? 'snieg-dzien' : 'snieg-noc';
    if ((c >= 51 && c <= 67) || (c >= 80 && c <= 82) || c >= 95) return day ? 'deszcz-dzien' : 'deszcz-noc';
    if (c === 3 || c === 45 || c === 48) return day ? 'pochmurno-dzien' : 'pochmurno-noc';
  }
  if (mn < r - 60 || mn >= s + 75) return 'noc';
  if (mn < r + 35) return 'swit';
  if (mn < r + 150) return 'poranek';
  if (mn >= s + 20) return 'zmierzch';
  if (mn >= s - 50) return 'zachod';
  if (mn >= s - 150) return 'zlota';
  const a = r + 150, p = Math.max(1, (s - 150 - a) / 3);
  return mn < a + p ? 'przedpoludnie' : mn < a + 2 * p ? 'poludnie' : 'popoludnie';
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
  // Jutro: wszystko po kolei, także wpisy drugiej osoby; najpierw całodniowe, potem wg godziny, na końcu zadania.
  const tmAll = [...tm.filter((i) => i.k === 'e' && i.ad).map((i) => ({ ...i, label: 'cały dz.' })), ...tm.filter((i) => i.k === 'e' && !i.ad).sort((a, b) => a.start - b.start), ...tm.filter((i) => i.k === 't')];
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
  return { now, tm: tm.filter(own), ongoing, upcoming, allday, tasks, rows, remaining: upcoming.length + (ongoing ? 1 : 0) + tasks.length + allday.length, tmAll, tomorrowFirst: tmAll[0] || null, cnt, pcnt: (data && data.pcnt) || {}, pcol: (data && data.pcol) || '#34d3ff', mcol: (data && data.mcol) || ACCENT };
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
function wxIcon(p, code, day, size, tint) {
  const pic = aImg(`pogoda-${wxPic(code, day)}.png`);
  if (pic) { const im = p.addImage(pic); im.imageSize = new Size(size, size); return im; }
  return icon(p, wxSym(code, day), size, tint || C(ACCENT));
}
function centered(p, fn) { const s = p.addStack(); s.addSpacer(); fn(s); s.addSpacer(); return s; }

function monthImage(m, o) {
  const now = m.now, y = now.getFullYear(), mo = now.getMonth();
  const first = (new Date(y, mo, 1).getDay() + 6) % 7, dim = new Date(y, mo + 1, 0).getDate();
  const rows = Math.ceil((first + dim) / 7);
  const cw = o.w / 7, TOP = o.hrow + 2, rh = (o.h - TOP) / rows;
  const pill = Math.min(cw - 2, rh - 4.5), fs = Math.max(9, pill * 0.7);
  const dc = new DrawContext();
  dc.size = new Size(o.w, o.h); dc.opaque = false; dc.respectScreenScale = true;
  const put = (s, x, y0, w, h, font, color, center) => { dc.setFont(font); dc.setTextColor(color); if (center) dc.setTextAlignedCenter(); else dc.setTextAlignedLeft(); dc.drawTextInRect(String(s), new Rect(x, y0, w, h)); };
  ['P', 'W', 'Ś', 'C', 'P', 'S', 'N'].forEach((d, i) => put(d, i * cw, 0, cw, o.hrow, Font.mediumSystemFont(fs - 1.5), i > 4 ? FAINT() : DIM(), true));
  const dot = (cx, y0, col) => { dc.setFillColor(col); dc.fillEllipse(new Rect(cx - 1.7, y0, 3.4, 3.4)); };
  const tile = aImg('dzis.png');
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < 7; c++) {
      const day = r * 7 + c - first + 1;
      if (day < 1 || day > dim) continue;
      const key = `${y}-${pad(mo + 1)}-${pad(day)}`, isToday = day === now.getDate();
      const cx = c * cw + cw / 2, top = TOP + r * rh + (rh - pill - 4.5) / 2, cy = top + pill / 2;
      if (isToday) {
        if (tile) { const z = pill * 1.62; dc.drawImageInRect(tile, new Rect(cx - z / 2, cy - z / 2, z, z)); } else { dc.setFillColor(C(ACCENT)); dc.fillEllipse(new Rect(cx - pill / 2, top, pill, pill)); }
      }
      put(day, c * cw, cy - fs * 0.62, cw, fs + 4, isToday ? Font.heavySystemFont(fs) : Font.mediumSystemFont(fs), isToday ? WHITE() : (c > 4 ? C('#ffffff', 0.58) : WHITE()), true);
      const a = !!m.cnt[key], b = !!m.pcnt[key], dy = top + pill + 1.2;
      if (a && b) { dot(cx - 2.8, dy, C(m.mcol)); dot(cx + 2.8, dy, C(m.pcol)); } else if (a) dot(cx, dy, C(m.mcol)); else if (b) dot(cx, dy, C(m.pcol));
    }
  }
  return { img: dc.getImage(), size: new Size(o.w, o.h) };
}
// Nagłówek jak w projekcie: ikona, miesiąc na biało, rok na pomarańczowo, świecąca linia.
function monthGrid(p, m, o) {
  p.layoutVertically(); p.spacing = 2;
  const mo = MONTHS_N[m.now.getMonth()];
  const h = p.addStack(); h.centerAlignContent(); h.spacing = 5; h.size = new Size(o.w, o.title + 3);
  icon(h, 'calendar', o.title + 1, C(ACCENT));
  txt(h, mo[0].toUpperCase() + mo.slice(1), o.title, 'b', WHITE());
  txt(h, m.now.getFullYear(), o.title, 'b', C(ACCENT));
  h.addSpacer();
  const ln = p.addStack(); ln.size = new Size(o.w * 0.72, 1.5); ln.cornerRadius = 0.75;
  const g = new LinearGradient(); g.colors = [C(ACCENT, 0), C(ACCENT), C(ACCENT, 0)]; g.locations = [0, 0.5, 1]; g.startPoint = new Point(0, 0.5); g.endPoint = new Point(1, 0.5); ln.backgroundGradient = g;
  const r = monthImage(m, { ...o, h: o.h - o.title - 3 - 1.5 - 4 });
  const im = p.addImage(r.img); im.imageSize = r.size;
  return im;
}
function planRow(p, i, now, o) {
  const r = p.addStack(); r.centerAlignContent(); r.spacing = 5; r.size = new Size(o.w, o.h);
  const bar = r.addStack(); bar.size = new Size(3, o.h - 4); bar.cornerRadius = 1.5; bar.backgroundColor = i.isNow ? C(ACCENT) : (i.c ? C(i.c) : C('#ffffff', 0.5));
  const tm = r.addStack(); tm.size = new Size(o.tw, 0);
  txt(tm, i.isNow ? 'teraz' : (i.label || i.s || (i.k === 't' ? 'zadanie' : '')), o.size - 1, 'b', i.isNow ? C(ACCENT) : DIM());
  if (i.w) { const b = r.addStack(); b.size = new Size(15, 15); b.cornerRadius = 7.5; b.backgroundColor = C(i.c || '#34d3ff'); b.centerAlignContent(); const lt = b.addText(String(i.w)); lt.font = Font.heavySystemFont(10); lt.textColor = WHITE(); lt.lineLimit = 1; lt.centerAlignText(); }
  txt(r, (i.k === 't' ? '☐ ' : '') + i.t, o.size, 'm', WHITE());
  r.addSpacer();
  return r;
}
function leftRow(p, o, fn) { const r = p.addStack(); r.centerAlignContent(); r.spacing = 6; if (o && o.w) r.size = new Size(o.w, o.h || 0); fn(r); r.addSpacer(); return r; }
function tomorrowRows(p, m, free, o) {
  if (free < 2 || !m.tmAll.length) return;
  if (free === 2 && m.tmAll.length > 1) { const f = m.tmAll[0]; leftRow(p, { w: o.w, h: o.h }, (r) => { txt(r, 'Jutro', o.size - 1, 'b', C(ACCENT)); txt(r, `${f.label || f.s || ''} ${f.t}`.trim(), o.size - 1, 'm', WHITE()); txt(r, `+${m.tmAll.length - 1}`, o.size - 1, 'b', DIM()); }); return; }
  leftRow(p, { w: o.w, h: o.size + 3 }, (r) => txt(r, 'Jutro', o.size - 1, 'b', C(ACCENT)));
  const fit = free - 1, n = m.tmAll.length <= fit ? fit : fit - 1;
  m.tmAll.slice(0, n).forEach((i) => planRow(p, i, m.now, o));
  if (m.tmAll.length > n) leftRow(p, { w: o.w }, (r) => txt(r, `+${m.tmAll.length - n} jutro`, o.size - 2, 'm', FAINT()));
}
function plan(p, m, max, o) {
  if (!m.rows.length) {
    leftRow(p, { w: o.w, h: o.h }, (r) => { icon(r, 'checkmark.circle', o.size + 4, C(ACCENT)); txt(r, 'Dziś bez planów', o.size + 1, 'b', WHITE()); });
    if (!o.noTomorrow) tomorrowRows(p, m, max - 1, o);
    return;
  }
  const n = m.rows.length <= max ? max : max - 1;
  m.rows.slice(0, n).forEach((i) => planRow(p, i, m.now, o));
  if (m.rows.length > n) leftRow(p, { w: o.w }, (r) => txt(r, `+${m.rows.length - n} więcej`, o.size - 2, 'm', FAINT()));
  else if (!o.noTomorrow) tomorrowRows(p, m, max - m.rows.length, o);
}
function weatherRow(p, wx, o) {
  const r = p.addStack(); r.centerAlignContent(); r.spacing = 7;
  if (!wx) return r;
  wxIcon(r, wx.code, wx.day, o.icon);
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
    centered(c, (s) => wxIcon(s, h.code, h.h >= 6 && h.h < 20, o.icon, WHITE()));
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
// Tło: zdjęcie, przyciemnienie zależne od liczby wpisów i nakładka ze szkłem oraz ramką. Plan zawsze ma pierwszeństwo przed zdjęciem.
function backdrop(w, family, m, wx, size) {
  const dc = new DrawContext();
  dc.size = size; dc.opaque = true; dc.respectScreenScale = true;
  dc.setFillColor(C('#0d1420')); dc.fillRect(new Rect(0, 0, size.width, size.height));
  const photo = aImg(`niebo/${skyName(m.now, wx)}.jpg`);
  const n = m.rows.length + (family === 'large' || m.rows.length > 2 ? 0 : Math.min(m.tmAll.length, 3));
  if (photo) {
    if (family === 'medium') { const pw = size.width * 1.06, ph = pw / 1.5; dc.drawImageInRect(photo, new Rect(size.width * 0.74 - pw / 2, size.height - ph * 0.82, pw, ph)); }
    else { const ph = Math.max(size.height * 1.05, size.width / 1.5), pw = ph * 1.5; dc.drawImageInRect(photo, new Rect((size.width - pw) / 2, size.height - ph * 0.86, pw, ph)); }
    // Granatowa warstwa wtapia zdjęcie w tło, także jasne poranne; im więcej wpisów, tym ciemniej.
    const dim = n === 0 ? 0.2 : n === 1 ? 0.4 : n <= 3 ? 0.58 : 0.74;
    dc.setFillColor(C('#0a111c', dim));
    dc.fillRect(new Rect(0, 0, size.width, size.height));
  }
  const fr = aImg(`ramka-${family === 'small' ? 'maly' : family === 'large' ? 'duzy' : 'sredni'}.png`);
  if (fr) dc.drawImageInRect(fr, new Rect(0, 0, size.width, size.height));
  w.backgroundImage = dc.getImage();
}
function homeWidget(w, family, m, wx, stale) {
  backdrop(w, family, m, wx, family === 'small' ? new Size(SZ[1], SZ[1]) : family === 'large' ? new Size(SZ[0], SZ[2]) : new Size(SZ[0], SZ[1]));
  const now = m.now;
  const dateStr = `${DAYS[now.getDay()]} ${now.getDate()} ${MONTHS[now.getMonth()]}`;

  if (family === 'small') {
    w.setPadding(12, 13, 10, 13);
    const top = w.addStack(); top.centerAlignContent();
    const dc = top.addStack(); dc.layoutVertically();
    txt(dc, DAYS3[now.getDay()].toUpperCase(), 11, 'b', C(ACCENT)); txt(dc, now.getDate(), 30, 'h', WHITE());
    top.addSpacer();
    if (wx) { const wc = top.addStack(); wc.layoutVertically(); centered(wc, (s) => wxIcon(s, wx.code, wx.day, 26)); centered(wc, (s) => txt(s, `${wx.t}°`, 22, 'h', WHITE())); }
    w.addSpacer(3);
    plan(w, m, 4, { size: 12, h: 18, tw: 34, w: SZ[1] - 26 });
    w.addSpacer();
    return;
  }

  const colSp = (p, wd, h) => { const x = p.addStack(); x.size = new Size(wd, h); return x; };
  if (family === 'medium') {
    const W = SZ[0], H = SZ[1], pl = 10, pr = 12, pv = 8, CH = H - 2 * pv, LW = 136;
    w.setPadding(pv, pl, pv, pr);
    const body = w.addStack(); body.size = new Size(W - pl - pr, CH); body.centerAlignContent(); body.spacing = 0;
    const lc = body.addStack(); lc.size = new Size(LW, CH);
    monthGrid(lc, m, { w: LW, h: CH, title: 13, hrow: 11 });
    colSp(body, 6, CH);
    const dv = body.addStack(); dv.size = new Size(0.5, CH - 10); dv.backgroundColor = C('#ffffff', 0.18);
    colSp(body, 10, CH);
    const RW = W - pl - pr - LW - 16.5;
    const tight = m.rows.length > 4; // przy dużej liczbie wpisów pogoda przechodzi do nagłówka, a plan dostaje więcej miejsca
    const rc = body.addStack(); rc.layoutVertically(); rc.size = new Size(RW, CH); rc.spacing = tight ? 1 : 3;
    const hd = rc.addStack(); hd.centerAlignContent(); hd.spacing = 5; hd.size = new Size(RW, 16);
    const mk = hd.addStack(); mk.size = new Size(2.5, 13); mk.cornerRadius = 1.25; mk.backgroundColor = C(ACCENT);
    txt(hd, `${DAYS3[now.getDay()].replace('.', '')} ${now.getDate()} ${MONTHS[now.getMonth()]}`.replace(/^./, (c) => c.toUpperCase()), 12.5, 'b', WHITE());
    hd.addSpacer();
    // Znacznik widać tylko, gdy coś jest nie tak: brak połączenia z serwerem albo dane starsze niż 6 dni (plan jest wysyłany na 7 dni do przodu).
    if (tight && wx) { wxIcon(hd, wx.code, wx.day, 15); txt(hd, `${wx.t}°`, 12.5, 'b', WHITE()); }
    if (dres.stale) txt(hd, `⚠ ${dres.fail || 'offline'}`, 8.5, 'b', C(ACCENT));
    else if (syncGen && now.getTime() - syncGen > 6 * 86400000) txt(hd, '⚠ stare dane', 8.5, 'b', C(ACCENT));
    if (!tight) { const wr = rc.addStack(); wr.size = new Size(RW, 32); wr.centerAlignContent(); weatherRow(wr, wx, { icon: 30, temp: 26, size: 10.5 }); wr.addSpacer(); }
    const hr = rc.addStack(); hr.size = new Size(RW, 0.5); hr.backgroundColor = C('#ffffff', 0.16);
    if (tight) plan(rc, m, 6, { size: 12, h: 19, tw: 33, w: RW }); else plan(rc, m, 4, { size: 12, h: 20, tw: 33, w: RW });
    rc.addSpacer();
    return;
  }

  // large
  const W = SZ[0], H = SZ[2], pad2 = 13, CW = W - 2 * pad2, CH = H - 2 * pad2;
  w.setPadding(pad2, pad2, pad2, pad2);
  const col = w.addStack(); col.layoutVertically(); col.size = new Size(CW, CH); col.spacing = 0;
  const top = col.addStack(); top.size = new Size(CW, 45); top.centerAlignContent();
  const tl = top.addStack(); tl.layoutVertically(); tl.spacing = 1;
  txt(tl, `${DAYS[now.getDay()]} ${now.getDate()} ${MONTHS[now.getMonth()]}`.replace(/^./, (c) => c.toUpperCase()), 13, 'b', WHITE());
  weatherRow(tl, wx, { icon: 24, temp: 24, size: 10.5 });
  top.addSpacer(); if (stale) txt(top, 'offline', 10, 'm', FAINT());
  const hh = col.addStack(); hh.size = new Size(CW, 46); hourly(hh, wx, { w: CW / 6, size: 12, icon: 18 });
  const hr = col.addStack(); hr.size = new Size(CW, 0.5); hr.backgroundColor = C('#ffffff', 0.16);
  const MH = CH - 45 - 46 - 0.5 - 24 - 12;
  const mid = col.addStack(); mid.size = new Size(CW, MH + 12); mid.centerAlignContent(); mid.spacing = 0;
  const LWl = 162;
  const lc = mid.addStack(); lc.size = new Size(LWl, MH); monthGrid(lc, m, { w: LWl, h: MH, title: 13, hrow: 13 });
  colSp(mid, 8, MH);
  const dv = mid.addStack(); dv.size = new Size(0.5, MH - 10); dv.backgroundColor = C('#ffffff', 0.18);
  colSp(mid, 10, MH);
  const RWl = CW - LWl - 18.5;
  const manyL = m.rows.length > 8;
  const rc = mid.addStack(); rc.layoutVertically(); rc.size = new Size(RWl, MH); rc.spacing = manyL ? 1 : 3;
  txt(rc, `Plan dnia · ${m.remaining}`, 12, 'b', DIM());
  if (manyL) plan(rc, m, 10, { size: 12, h: 18, tw: 33, w: RWl, noTomorrow: true }); else plan(rc, m, 8, { size: 12, h: 19, tw: 33, w: RWl, noTomorrow: true });
  rc.addSpacer();
  const tmr = col.addStack(); tmr.size = new Size(CW, 24); tmr.centerAlignContent(); tmr.spacing = 6;
  const te = m.tmAll.filter((i) => i.k === 'e').slice(0, 3);
  const tl2 = tmr.addStack(); tl2.size = new Size(36, 16); txt(tl2, 'Jutro', 11, 'b', C(ACCENT));
  const tc2 = tmr.addStack(); tc2.size = new Size(CW - 36 - 48 - 12, 16); txt(tc2, te.length ? te.map((i) => `${i.ad ? '' : i.s + ' '}${i.t}`).join(' · ') : 'bez wydarzeń', 11, 'm', WHITE());
  if (wx && wx.tmHi != null) { tmr.addSpacer(); wxIcon(tmr, wx.tmCode == null ? 3 : wx.tmCode, true, 13, DIM()); txt(tmr, `${wx.tmHi}°`, 11, 'b', DIM()); }
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
if (!family.startsWith('accessory')) {
  const need = ['dzis.png', `niebo/${skyName(m.now, wx)}.jpg`, `ramka-${family === 'small' ? 'maly' : family === 'large' ? 'duzy' : 'sredni'}.png`];
  if (wx) { need.push(`pogoda-${wxPic(wx.code, wx.day)}.png`); wx.hours.forEach((h) => need.push(`pogoda-${wxPic(h.code, h.h >= 6 && h.h < 20)}.png`)); if (wx.tmCode != null) need.push(`pogoda-${wxPic(wx.tmCode, true)}.png`); }
  await Promise.all([...new Set(need)].map(asset));
}
const w = new ListWidget();
w.url = APP_URL;
w.refreshAfterDate = new Date(Date.now() + 5 * 60000);
if (!data) w.addText('Kalendarz: brak danych. Otwórz aplikację i połącz powiadomienia z serwerem.');
else if (family.startsWith('accessory')) lockWidget(w, family, m, wx, dres.stale);
else homeWidget(w, family, m, wx, dres.stale);
if (config.runsInWidget) Script.setWidget(w);
else if (family.startsWith('accessory') || family === 'small') await w.presentSmall();
else if (family === 'large') await w.presentLarge();
else await w.presentMedium();
Script.complete();
