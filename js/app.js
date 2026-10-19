// Start aplikacji: nawigacja, obsługa akcji, zegary, powiadomienia, rejestracja service workera.
import { $, $$, esc, ymd, parseYmd, startOfDay, addDays, startOfWeek, sameDay, ICON, haptic, fmtDayLong, fmtTime, relDay } from './util.js';
import {
  state, onChange, save, flushSave, loadSample, toggleTask, undo, exportData, importData, wipeAll, icsExport, rolloverTasks, addTask, newTask, updateEvent,
} from './store.js';
import { parse } from './nlp.js';
import { instancesInRange } from './recur.js';
import { nav, saveNav, setRender, rerender, toast, showBanner, confirmSheet, closeTopSheet, sheetOpen, openSheet, closeSheet } from './ui.js';
import { renderToday, renderCal, renderTasks, renderHub, paintWeather, bindGridDrag, bindMonthDrag, bindTray, dragState, instOf, skyPhase } from './screens.js';
import { openQuickAdd, openEventEditor, openTaskEditor, openRuleEditor, openCatEditor, openSearch, openCitySheet, defaultDraftFor } from './editors.js';
import { pushConfig, pushConnect, pushDisconnect, pushTest, pushSync, initPush, pushSupported } from './push.js';
import { tick, snooze, updateBadge, enableNotifications, testNotification, setHandlers, briefFor } from './notify.js';
import { initLock, openLockSettings } from './lock.js';
import { openFindSlot, openStats, importICS } from './tools.js';
import { loadWeather, cachedWeather, rainInsight, weatherKind } from './weather.js';

const view = $('#view');
const dock = $('#dock');
let weather = null;

// ---------- Motyw ----------
function applyTheme() {
  const t = state.settings.theme;
  const dark = t === 'auto' ? matchMedia('(prefers-color-scheme: dark)').matches : t === 'dark';
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.documentElement.dataset.accent = state.settings.accent;
  document.documentElement.dataset.skin = state.settings.skin || 'dusk';
  const st = document.documentElement.style;
  if (state.settings.accentCustom) { st.setProperty('--a1', state.settings.accentCustom); st.setProperty('--a2', 'color-mix(in oklab, ' + state.settings.accentCustom + ' 70%, #7a4dff)'); } else { st.removeProperty('--a1'); st.removeProperty('--a2'); }
  requestAnimationFrame(() => document.querySelector('meta[name="theme-color"]')?.setAttribute('content', getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || (dark ? '#131029' : '#f1eff9')));
}
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', applyTheme);

// ---------- Dock ----------
function renderDock() {
  const today = ymd(new Date());
  const due = state.tasks.filter((t) => !t.done && t.due && t.due <= today).length;
  const tab = (k, label, icon, badge = 0) => `<button type="button" class="tab ${nav.tab === k ? 'on' : ''}" data-act="tab" data-tab="${k}" aria-label="${label}" ${nav.tab === k ? 'aria-current="page"' : ''}><span class="ico">${icon}</span>${label}${badge ? `<span class="badge">${badge > 9 ? '9+' : badge}</span>` : ''}</button>`;
  dock.innerHTML = `${tab('today', 'Dziś', ICON.today)}${tab('cal', 'Kalendarz', ICON.cal)}<button type="button" class="fab" data-act="quick" aria-label="Dodaj wydarzenie lub zadanie"><span class="ico">${ICON.plus}</span></button>${tab('tasks', 'Zadania', ICON.tasks, due)}${tab('hub', 'Centrum', ICON.hub)}`;
}

// ---------- Renderowanie ----------
let lastKey = '';
let needScroll = true;
let nextAnim = '';
let animT = 0;

function render() {
  const key = nav.tab + (nav.tab === 'cal' ? ':' + nav.calView : '');
  const scroll = view.scrollTop;
  const html = nav.tab === 'today' ? renderToday() : nav.tab === 'cal' ? renderCal() : nav.tab === 'tasks' ? renderTasks() : renderHub();
  const anim = key !== lastKey ? 'tab' : nextAnim;
  nextAnim = '';
  clearTimeout(animT);
  if (anim) { view.dataset.anim = anim; animT = setTimeout(() => { delete view.dataset.anim; }, 650); } else delete view.dataset.anim;
  view.innerHTML = html;
  view.dataset.tab = nav.tab;
  const same = key === lastKey && !needScroll;
  view.scrollTop = same ? scroll : 0;
  lastKey = key;

  if (nav.tab === 'today') {
    paintWeather(weather || cachedWeather());
    extraInsights(weather || cachedWeather());
  }
  if (nav.tab === 'cal') {
    const head = $('#cal-head');
    if (head) view.style.setProperty('--head-h', head.offsetHeight + 'px');
    const grid = $('#tgrid');
    if (grid) {
      bindGridDrag(grid);
      if (needScroll) {
        const HH = 58;
        const now = new Date();
        const showNow = nav.calView === 'day' || nav.calView === '3day' ? sameDay(nav.cursor, now) : nav.calView === 'week' && sameDay(startOfWeek(nav.cursor, state.settings.weekStart), startOfWeek(now, state.settings.weekStart));
        const targetMin = showNow ? Math.max(0, now.getHours() * 60 - 90) : 7 * 60;
        view.scrollTop = Math.max(0, grid.offsetTop + (targetMin / 60) * HH - (head?.offsetHeight || 0) - (nav.calView === 'week' || nav.calView === '3day' ? 54 : 0));
      }
    }
  }
  needScroll = false;
  renderDock();
}
setRender(render);

function extraInsights(w) {
  const box = $('#insights');
  const r = rainInsight(w);
  if (!box || !r || box.querySelector('[data-rain]')) return;
  box.insertAdjacentHTML('beforeend', `<div class="insight" data-rain><span class="ico">${ICON.rain}</span><span>${esc(r)}</span></div>`);
}

async function refreshWeather(force = false) {
  const w = await loadWeather(state.settings.city, force);
  if (w) {
    weather = w;
    if (nav.tab === 'today') { paintWeather(w); extraInsights(w); }
  }
  return w;
}

// ---------- Pomocnicze ----------
function setPath(obj, path, val) {
  const parts = path.split('.');
  let o = obj;
  for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]];
  o[parts[parts.length - 1]] = val;
}
const getPath = (obj, path) => path.split('.').reduce((o, k) => o?.[k], obj);

function download(name, text, type) {
  const file = new File([text], name, { type });
  if (navigator.canShare?.({ files: [file] })) {
    navigator.share({ files: [file], title: name }).catch(() => {});
    return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

function gotoDay(date) {
  nav.cursor = date;
  nav.selected = date;
  nav.tab = 'cal';
  nav.calView = 'day';
  needScroll = true;
  saveNav();
  render();
}

function shiftCal(dir) {
  nextAnim = dir > 0 ? 'next' : 'prev';
  const c = nav.cursor;
  if (nav.calView === 'month') {
    nav.cursor = new Date(c.getFullYear(), c.getMonth() + dir, 1);
    const now = new Date();
    nav.selected = nav.cursor.getMonth() === now.getMonth() && nav.cursor.getFullYear() === now.getFullYear() ? startOfDay(now) : nav.cursor;
  } else if (nav.calView === 'week') {
    nav.cursor = addDays(c, dir * 7);
    nav.selected = nav.cursor;
  } else if (nav.calView === '3day') {
    nav.cursor = addDays(c, dir * 3);
    nav.selected = nav.cursor;
  } else {
    nav.cursor = addDays(c, dir);
    nav.selected = nav.cursor;
  }
  needScroll = nav.calView !== 'month' ? nav.calView !== 'agenda' : false;
  render();
}

// ---------- Akcje ----------
const actions = {
  tab(el) {
    nav.tab = el.dataset.tab;
    if (nav.tab === 'cal') { nav.cursor = nav.cursor || startOfDay(new Date()); needScroll = true; }
    saveNav();
    render();
  },
  quick() { haptic(); openQuickAdd(); },
  sample() { loadSample(); toast('Wczytano przykładowe dane'); },
  'open-ev'(el) {
    const inst = instOf(el.dataset.key);
    if (inst) openEventEditor({ inst });
  },
  'open-task'(el) { openTaskEditor({ id: el.dataset.id }); },
  'toggle-task'(el) {
    const id = el.dataset.id;
    const row = el.closest('.task');
    haptic();
    row?.classList.toggle('done');
    setTimeout(() => {
      const done = toggleTask(id);
      if (done) toast('Zrobione', { action: 'Cofnij', onAction: () => { undo(); rerender(); } });
    }, 380);
  },
  'goto-day'(el) { gotoDay(parseYmd(el.dataset.date)); },
  'toggle-past'() { nav.showPast = !nav.showPast; render(); },
  'goto-week'() { nav.cursor = startOfDay(new Date()); nav.selected = nav.cursor; nav.tab = 'cal'; nav.calView = 'week'; needScroll = true; saveNav(); render(); },
  'pick-day'(el) {
    const d = parseYmd(el.dataset.date);
    if (sameDay(d, nav.selected)) return gotoDay(d);
    haptic();
    nav.selected = d;
    if (d.getMonth() !== nav.cursor.getMonth()) nav.cursor = new Date(d.getFullYear(), d.getMonth(), 1);
    render();
  },
  calview(el) { nav.calView = el.dataset.v; needScroll = true; saveNav(); render(); },
  'cal-prev'() { shiftCal(-1); },
  'cal-next'() { shiftCal(1); },
  'cal-today'() { nav.cursor = startOfDay(new Date()); nav.selected = nav.cursor; needScroll = true; render(); },
  'add-on'(el) { openQuickAdd({ ctxDate: parseYmd(el.dataset.date) }); },
  search() { openSearch(); },
  async weather() {
    const w = weather || cachedWeather();
    if (!w) { toast('Pobieram pogodę…'); const r = await refreshWeather(true); if (!r) toast('Nie mogę pobrać pogody. Sprawdź połączenie.'); return; }
    toast(`${weatherKind(w.code).label}, odczuwalna ${w.feels}°. Dziś ${w.lo}° do ${w.hi}°, opady ${w.pop}%.`, { ms: 5200 });
    refreshWeather(true);
  },
  'agenda-more'() { nav.agendaDays += 30; render(); },
  taskfilter(el) { nav.taskFilter = el.dataset.v; saveNav(); render(); },
  set(el) {
    const v = el.dataset.num ? Number(el.dataset.v) : el.dataset.v;
    state.settings[el.dataset.k] = v;
    if (el.dataset.k === 'accent') state.settings.accentCustom = '';
    applyTheme();
    save();
  },
  'edit-cat'(el) { openCatEditor(el.dataset.id || null); },
  'edit-rule'(el) { openRuleEditor(el.dataset.id || null); },
  async 'enable-notif'() {
    const r = await enableNotifications();
    if (r === 'granted') { toast('Powiadomienia włączone'); testNotification(); } else if (r === 'denied') toast('Powiadomienia zablokowane w ustawieniach iPhone\'a');
    else toast('Powiadomienia nie są tu dostępne. Dodaj aplikację do ekranu początkowego.');
    render();
  },
  'push-connect'() {
    const h = openSheet(`<div class="grab"><i></i></div>
      <div class="sheet-h"><h3>Powiadomienia z serwera</h3><button type="button" class="round" data-x="close" aria-label="Zamknij"><span class="ico">${ICON.close}</span></button></div>
      <div class="sheet-b">
      <p class="note" style="margin:0 0 12px">Wpisz adres i kod, które wypisał instalator na serwerze. Dzięki temu przypomnienia dotrą, nawet gdy aplikacja jest zamknięta.</p>
      <div class="field"><label class="grow" for="pc-url">Adres</label><input id="pc-url" type="url" inputmode="url" autocapitalize="off" autocorrect="off" placeholder="https://…/kalendarz-push"></div>
      <div class="field"><label class="grow" for="pc-code">Kod</label><input id="pc-code" type="text" autocapitalize="off" autocorrect="off" placeholder="kod z instalatora"></div>
      <p class="note" id="pc-err" style="color:#e5484d" hidden></p>
      <button type="button" class="btn primary" id="pc-go" style="width:100%;margin-top:10px">Połącz</button></div>`);
    const q = (x) => h.el.querySelector(x);
    q('[data-x=close]').onclick = () => closeSheet(h);
    q('#pc-go').onclick = async () => {
      const b = q('#pc-go'); b.disabled = true; b.textContent = 'Łączę…'; q('#pc-err').hidden = true;
      try { await pushConnect(q('#pc-url').value, q('#pc-code').value); closeSheet(h); toast('Połączono z serwerem'); render(); }
      catch (e) { q('#pc-err').textContent = e.message || 'Nie udało się połączyć'; q('#pc-err').hidden = false; b.disabled = false; b.textContent = 'Połącz'; }
    };
  },
  async 'push-disconnect'() { await pushDisconnect(); toast('Rozłączono'); render(); },
  async 'push-test'() { try { await pushTest(); toast('Wysłano test z serwera'); } catch (e) { toast(e.message || 'Test nie powiódł się'); } },
  async 'push-sync'() { const ok = await pushSync(true); toast(ok ? 'Zsynchronizowano' : 'Synchronizacja nie powiodła się'); render(); },
  'test-notif'() { testNotification(); toast('Wysłano testowe powiadomienie'); },
  export() { download(`kalendarz-kopia-${ymd(new Date())}.json`, exportData(), 'application/json'); },
  'export-ics'() { download(`kalendarz-${ymd(new Date())}.ics`, icsExport(), 'text/calendar'); },
  import() { const f = $('#file-in'); f.accept = 'application/json,.json'; f.click(); },
  'import-ics'() { const f = $('#file-in'); f.accept = '.ics,text/calendar'; f.click(); },
  stats() { openStats(); },
  'lock-setup'() { openLockSettings(); },
  'find-slot'() { openFindSlot(); },
  async wipe() {
    const ans = await confirmSheet({ title: 'Usunąć wszystkie dane?', text: 'Wydarzenia, zadania, reguły i ustawienia znikną z tego telefonu. Najpierw zrób kopię zapasową.', confirmLabel: 'Usuń wszystko' });
    if (ans === 'yes') { wipeAll(); toast('Dane usunięte'); }
  },
  city() { openCitySheet(() => { weather = null; refreshWeather(true); render(); }); },
};

document.addEventListener('click', (e) => {
  if (Date.now() - dragState.endedAt < 380) return;
  const tog = e.target.closest('[data-tog]');
  if (tog) {
    const p = tog.dataset.tog;
    haptic();
    if (p.startsWith('rule:')) {
      const r = state.rules.find((x) => x.id === p.slice(5));
      if (r) r.on = !r.on;
    } else setPath(state.settings, p, !getPath(state.settings, p));
    applyTheme();
    save();
    return;
  }
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const fn = actions[el.dataset.act];
  if (fn) fn(el, e);
});

document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.id === 'file-in') {
    const f = t.files?.[0];
    if (!f) return;
    f.text().then((txt) => {
      try {
        if (/\.ics$/i.test(f.name) || /^\s*BEGIN:VCALENDAR/i.test(txt)) {
          const r = importICS(txt);
          toast(`Zaimportowano ${r.added} ${r.added === 1 ? 'wydarzenie' : 'wydarzeń'}${r.skipped ? `, pominięto ${r.skipped} już istniejących` : ''}`, { action: 'Cofnij', onAction: () => { undo(); rerender(); }, ms: 6000 });
        } else { importData(txt); toast('Kopia wczytana'); }
      } catch (err) { toast(err.message || 'Nie udało się wczytać pliku'); }
      t.value = '';
    });
    return;
  }
  const path = t.dataset?.in;
  if (!path) return;
  let v = t.value;
  if (t.dataset.arr) v = JSON.parse(v);
  else if (t.dataset.num) v = Number(v);
  setPath(state.settings, path, v);
  applyTheme();
  save();
});

document.addEventListener('submit', (e) => {
  if (e.target.id !== 'task-form') return;
  e.preventDefault();
  const input = $('#task-in');
  const text = input.value.trim();
  if (!text) return;
  const p = parse(text, { now: new Date(), cats: state.cats, mode: 'task' });
  if (!p.title) return;
  addTask(newTask({ title: p.title, due: p.date || null, dueTime: p.time || null, cat: p.cat || 'inne' }));
  haptic();
  setTimeout(() => $('#task-in')?.focus(), 30);
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeTopSheet();
});

// Przesunięcie palcem między okresami w kalendarzu.
(() => {
  let x0 = null;
  let y0 = null;
  view.addEventListener('touchstart', (e) => {
    if (nav.tab !== 'cal' || nav.calView === 'agenda' || e.target.closest('.blk, .rs, .tray')) { x0 = null; return; }
    x0 = e.touches[0].clientX; y0 = e.touches[0].clientY;
  }, { passive: true });
  view.addEventListener('touchend', (e) => {
    if (x0 == null) return;
    const dx = e.changedTouches[0].clientX - x0;
    const dy = e.changedTouches[0].clientY - y0;
    x0 = null;
    if (Math.abs(dx) > 70 && Math.abs(dy) < 45 && Date.now() - dragState.endedAt > 400) { haptic(); shiftCal(dx < 0 ? 1 : -1); }
  }, { passive: true });
})();

// ---------- Powiadomienia i zegary ----------
function openAlarm(a) {
  if (a.kind === 'event') {
    const key = a.ref || a.id.split(':')[1];
    const inst = instOf(key);
    if (inst) return openEventEditor({ inst });
  }
  nav.tab = a.kind === 'task' ? 'tasks' : 'today';
  saveNav();
  render();
}

setHandlers({
  banner: (a) => showBanner(a, { onOpen: openAlarm, onSnooze: (x) => { snooze(x, 10); toast('Przypomnę za 10 minut'); } }),
});

function handleLaunchParams() {
  const q = new URLSearchParams(location.search);
  if (q.get('new')) { setTimeout(() => openQuickAdd({ mode: q.get('new') === 'task' ? 'task' : 'event' }), 250); }
  if (q.get('alarm')) { const id = q.get('alarm'); openAlarm({ id, kind: id[0] === 'e' ? 'event' : id[0] === 't' ? 'task' : 'brief' }); }
  if (q.has('new') || q.has('alarm')) history.replaceState({}, '', location.pathname);
}

let lastDay = ymd(new Date());
function everyTick() {
  const now = new Date();
  if (ymd(now) !== lastDay) { lastDay = ymd(now); rolloverTasks(now); nav.selected = startOfDay(now); render(); }
  tick(now);
  updateBadge(now);
}

let lastPaint = 0;
function softRefresh() {
  if (document.visibilityState !== 'visible' || sheetOpen() || dragState.active) return;
  if (document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
  if (Date.now() - lastPaint < 25000) return;
  if (nav.tab === 'today' || (nav.tab === 'cal' && (nav.calView === 'day' || nav.calView === 'week' || nav.calView === '3day'))) { lastPaint = Date.now(); render(); }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') { flushSave(); return; }
  rolloverTasks();
  everyTick();
  lastPaint = 0;
  softRefresh();
  refreshWeather();
});

initPush();
onChange(() => { lastPaint = Date.now(); render(); updateBadge(); });

bindMonthDrag(view);
bindTray(view);

// ---------- Start ----------
applyTheme();
initLock();
rolloverTasks();
render();
updateBadge();
handleLaunchParams();
refreshWeather();
setInterval(everyTick, 15000);
setInterval(softRefresh, 30000);
setTimeout(everyTick, 800);

const fileInput = document.createElement('input');
fileInput.type = 'file';
fileInput.id = 'file-in';
fileInput.accept = 'application/json,.json';
fileInput.className = 'sr';
document.body.appendChild(fileInput);

if ('serviceWorker' in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW', e));
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController && !reloaded && !sheetOpen()) { reloaded = true; location.reload(); }
  });
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data?.type === 'alarm') {
      const id = new URL(e.data.url, location.href).searchParams.get('alarm') || '';
      if (id) openAlarm({ id, kind: id[0] === 'e' ? 'event' : id[0] === 't' ? 'task' : 'brief' });
    }
  });
}
navigator.storage?.persist?.().catch(() => {});

export { briefFor, skyPhase, updateEvent, instancesInRange, fmtDayLong, fmtTime, relDay, defaultDraftFor, $$ };
