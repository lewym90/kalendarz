// Widget Kalendarza dla aplikacji Scriptable. Uruchamiany przez mały loader (DATA_URL jest zmienną z loadera).
const fm = FileManager.local();
const CACHE = fm.joinPath(fm.documentsDirectory(), 'kalendarz-widget-data.json');
const APP_URL = 'https://lewym90.github.io/kalendarz/';
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const DAYS = ['niedziela', 'poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek', 'sobota'];
const MONTHS = ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca', 'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia'];

async function loadData() {
  try {
    const d = await new Request(DATA_URL).loadJSON();
    if (d && d.days) { fm.writeString(CACHE, JSON.stringify(d)); return { data: d, stale: false }; }
  } catch (e) { /* offline */ }
  try { if (fm.fileExists(CACHE)) return { data: JSON.parse(fm.readString(CACHE)), stale: true }; } catch (e) { /* brak */ }
  return { data: null, stale: true };
}

const at = (day, hm, fallbackEnd) => {
  if (!hm) return new Date(`${day}T${fallbackEnd ? '23:59' : '00:00'}:00`);
  return new Date(`${day}T${hm}:00`);
};
const left = (ms) => {
  const m = Math.max(1, Math.round(ms / 60000));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h} godz. ${r} min` : `${h} godz.`;
};

function model(data, now = new Date()) {
  const today = ymd(now);
  const tomorrow = ymd(new Date(now.getTime() + 86400000));
  const dayOf = (k) => ((data && data.days) || []).find((d) => d.d === k) || { d: k, items: [] };
  const mk = (day) => dayOf(day).items.map((i) => ({ ...i, day, start: i.ad ? at(day, '') : at(day, i.s), end: i.ad ? at(day, '', true) : (i.e ? at(day, i.e) : at(day, i.s)) }));
  const t = mk(today), tm = mk(tomorrow);
  const events = t.filter((i) => i.k === 'e' && !i.ad);
  const allday = t.filter((i) => i.k === 'e' && i.ad);
  const tasks = t.filter((i) => i.k === 't');
  const ongoing = events.find((i) => i.start <= now && now < i.end) || null;
  const upcoming = events.filter((i) => i.start > now);
  const remaining = upcoming.length + (ongoing ? 1 : 0) + tasks.length;
  return { now, today, t, tm, events, allday, tasks, ongoing, upcoming, remaining, tomorrowFirst: tm.find((i) => i.k === 'e') || tm[0] || null };
}

const line = (i) => `${i.k === 't' ? '☐ ' : ''}${i.s ? i.s + ' ' : ''}${i.t}`;

function inlineText(m) {
  if (m.ongoing) return `Teraz: ${m.ongoing.t}`;
  if (m.upcoming[0]) return `${m.upcoming[0].s} ${m.upcoming[0].t}`;
  if (m.tasks[0]) return `☐ ${m.tasks[0].t}`;
  if (m.allday[0]) return m.allday[0].t;
  if (m.tomorrowFirst) return `Jutro ${m.tomorrowFirst.s ? m.tomorrowFirst.s + ' ' : ''}${m.tomorrowFirst.t}`;
  return 'Brak planów';
}

function text(stack, s, size, weight, color, lines = 1) {
  const t = stack.addText(s);
  t.font = weight === 'b' ? Font.boldSystemFont(size) : weight === 'm' ? Font.mediumSystemFont(size) : Font.systemFont(size);
  if (color) t.textColor = color;
  t.lineLimit = lines;
  t.minimumScaleFactor = 0.8;
  return t;
}

function lockWidget(w, family, m, stale) {
  if (family === 'accessoryInline') { w.addText(inlineText(m)); return; }
  if (family === 'accessoryCircular') {
    const st = w.addStack(); st.layoutVertically(); st.centerAlignContent();
    const a = st.addStack(); a.addSpacer(); text(a, String(m.remaining), 24, 'b'); a.addSpacer();
    const b = st.addStack(); b.addSpacer(); text(b, 'dziś', 10, 'm'); b.addSpacer();
    return;
  }
  // accessoryRectangular
  const head = m.ongoing ? `Teraz · ${left(m.ongoing.end - m.now)}` : `Dziś · ${m.remaining}${stale ? ' ·' : ''}`;
  text(w, head, 12, 'b');
  const rows = [];
  if (m.ongoing) rows.push(m.ongoing);
  m.upcoming.slice(0, 3).forEach((i) => rows.push(i));
  m.tasks.slice(0, 3).forEach((i) => rows.push(i));
  if (!rows.length) { text(w, m.tomorrowFirst ? `Jutro: ${line(m.tomorrowFirst)}` : 'Brak planów', 12, 'm', null, 2); return; }
  rows.slice(0, m.ongoing ? 2 : 3).forEach((i) => text(w, line(i), 12, 'm'));
}

function homeWidget(w, family, m, stale) {
  const g = new LinearGradient();
  g.colors = [new Color('#2c2563'), new Color('#1d1a4a'), new Color('#0e0c26')];
  g.locations = [0, 0.5, 1];
  w.backgroundGradient = g;
  w.setPadding(14, 14, 12, 14);
  const white = Color.white();
  const dim = new Color('#ffffff', 0.62);
  const now = m.now;
  const accent = new Color('#ff8a5c');
  const max = family === 'small' ? 3 : family === 'medium' ? 4 : 8;

  const head = w.addStack(); head.centerAlignContent();
  text(head, `${DAYS[now.getDay()]} ${now.getDate()} ${MONTHS[now.getMonth()]}`, family === 'small' ? 12 : 13, 'b', accent);
  head.addSpacer();
  if (stale) text(head, 'offline', 10, 'm', dim);
  w.addSpacer(family === 'small' ? 6 : 8);

  const rows = [];
  m.allday.forEach((i) => rows.push({ ...i, label: 'cały dzień', ongoing: false }));
  if (m.ongoing) rows.push({ ...m.ongoing, ongoing: true });
  m.upcoming.forEach((i) => rows.push(i));
  m.tasks.forEach((i) => rows.push(i));

  if (!rows.length) {
    text(w, 'Dziś bez planów', 16, 'b', white);
    if (m.tomorrowFirst) text(w, `Jutro: ${line(m.tomorrowFirst)}`, 12, 'm', dim, 2);
  }
  rows.slice(0, max).forEach((i, idx) => {
    const r = w.addStack(); r.centerAlignContent(); r.spacing = 6;
    const dot = r.addStack(); dot.size = new Size(4, family === 'small' ? 26 : 18); dot.cornerRadius = 2;
    dot.backgroundColor = i.c ? new Color(i.c) : accent;
    const col = r.addStack(); col.layoutVertically();
    const top = i.ongoing ? `Teraz · jeszcze ${left(i.end - now)}` : (i.label || (i.s ? i.s : (i.k === 't' ? 'zadanie' : '')));
    if (family === 'small') {
      text(col, i.t, idx === 0 ? 14 : 12, 'b', white, 1);
      text(col, top + (i.l ? ' · ' + i.l : ''), 10, 'm', dim, 1);
    } else {
      const one = col.addStack(); one.centerAlignContent(); one.spacing = 6;
      text(one, top, 12, 'b', i.ongoing ? accent : dim);
      text(one, (i.k === 't' ? '☐ ' : '') + i.t, 14, 'm', white, 1);
      if (i.l && family === 'large') text(col, i.l, 11, 'm', dim, 1);
    }
    w.addSpacer(family === 'small' ? 4 : 5);
  });
  if (rows.length > max) text(w, `+ ${rows.length - max} więcej`, 11, 'm', dim);

  if (family === 'large') {
    w.addSpacer();
    text(w, 'Jutro', 12, 'b', accent);
    const tl = m.tm.filter((i) => i.k === 'e').slice(0, 3);
    if (!tl.length) text(w, 'Bez wydarzeń', 12, 'm', dim);
    tl.forEach((i) => text(w, `${i.ad ? 'cały dzień' : i.s} ${i.t}`, 12, 'm', white));
  }
  w.addSpacer();
}

const { data, stale } = await loadData();
const m = model(data);
const family = config.widgetFamily || 'medium';
const w = new ListWidget();
w.url = APP_URL;
w.refreshAfterDate = new Date(Date.now() + 10 * 60000);
if (!data) {
  w.addText('Kalendarz: brak danych. Otwórz aplikację i połącz powiadomienia z serwerem.');
} else if (family.startsWith('accessory')) lockWidget(w, family, m, stale);
else homeWidget(w, family, m, stale);

if (config.runsInWidget) Script.setWidget(w);
else { if (family.startsWith('accessory')) await w.presentSmall(); else await w.presentMedium(); }
Script.complete();
