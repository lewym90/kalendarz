// Infrastruktura interfejsu: arkusze, toasty, banery, stan nawigacji.
import { $, startOfDay, esc, haptic } from './util.js';

const NAV_KEY = 'kalendarz.nav';
const today0 = startOfDay(new Date());
export const nav = {
  tab: 'today',
  calView: 'month',
  cursor: today0,
  selected: today0,
  agendaDays: 45,
  taskFilter: 'all',
  showPast: false,
};
try {
  const saved = JSON.parse(localStorage.getItem(NAV_KEY) || 'null');
  if (saved) {
    nav.tab = saved.tab || nav.tab;
    nav.calView = saved.calView || nav.calView;
    nav.taskFilter = saved.taskFilter || nav.taskFilter;
  }
} catch (_) { /* ignoruj */ }

export function saveNav() {
  try { localStorage.setItem(NAV_KEY, JSON.stringify({ tab: nav.tab, calView: nav.calView, taskFilter: nav.taskFilter })); } catch (_) { /* ignoruj */ }
}

let renderFn = () => {};
export const setRender = (f) => { renderFn = f; };
export const rerender = () => renderFn();

// ---------- Arkusze ----------
const stack = [];
const scrim = () => $('#scrim');
const host = () => $('#sheets');

export function openSheet(html, { onClose, className = '' } = {}) {
  const el = document.createElement('section');
  el.className = `sheet ${className}`;
  el.style.zIndex = 60 + stack.length * 2;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.innerHTML = html;
  host().appendChild(el);
  const handle = { el, onClose, closed: false, close: () => closeSheet(handle) };
  stack.push(handle);
  scrim().style.zIndex = 59 + (stack.length - 1) * 2;
  scrim().classList.add('on');
  void el.offsetHeight;
  requestAnimationFrame(() => el.classList.add('on'));
  attachDrag(handle);
  layoutForKeyboard();
  return handle;
}

export function closeSheet(handle) {
  if (!handle || handle.closed) return;
  handle.closed = true;
  const i = stack.indexOf(handle);
  if (i >= 0) stack.splice(i, 1);
  handle.el.classList.remove('on');
  handle.el.style.transform = '';
  if (document.activeElement && handle.el.contains(document.activeElement)) document.activeElement.blur();
  if (!stack.length) scrim().classList.remove('on');
  else scrim().style.zIndex = 59 + (stack.length - 1) * 2;
  setTimeout(() => handle.el.remove(), 400);
  handle.onClose?.();
}

export function closeTopSheet() {
  const top = stack[stack.length - 1];
  if (top) closeSheet(top);
  return !!top;
}
export const sheetOpen = () => stack.length > 0;
export const topSheet = () => stack[stack.length - 1];

function attachDrag(h) {
  const el = h.el;
  let y0 = null;
  let dy = 0;
  const start = (e) => {
    const t = e.target.closest('.grab, .sheet-h');
    if (!t) return;
    y0 = (e.touches ? e.touches[0] : e).clientY;
    dy = 0;
    el.classList.add('dragging');
  };
  const move = (e) => {
    if (y0 == null) return;
    dy = Math.max(0, (e.touches ? e.touches[0] : e).clientY - y0);
    el.style.transform = `translateY(${dy}px)`;
    if (e.cancelable) e.preventDefault();
  };
  const end = () => {
    if (y0 == null) return;
    el.classList.remove('dragging');
    if (dy > 110) closeSheet(h);
    else el.style.transform = '';
    y0 = null;
  };
  el.addEventListener('touchstart', start, { passive: true });
  el.addEventListener('touchmove', move, { passive: false });
  el.addEventListener('touchend', end);
  el.addEventListener('touchcancel', end);
}

// Arkusz nad klawiaturą iOS.
export function layoutForKeyboard() {
  const vv = window.visualViewport;
  if (!vv) return;
  const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
  for (const h of stack) {
    h.el.style.bottom = kb > 0 ? kb + 'px' : '';
    h.el.style.maxHeight = Math.round(vv.height * 0.94) + 'px';
  }
}
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', layoutForKeyboard);
  window.visualViewport.addEventListener('scroll', layoutForKeyboard);
}

// ---------- Toast ----------
let toastTimer;
export function toast(msg, { action, onAction, ms = 4200 } = {}) {
  const t = $('#toast');
  t.innerHTML = `<span>${esc(msg)}</span>${action ? `<button type="button">${esc(action)}</button>` : ''}`;
  t.classList.add('on');
  const btn = t.querySelector('button');
  if (btn) btn.onclick = () => { onAction?.(); hideToast(); };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, ms);
}
export function hideToast() { $('#toast').classList.remove('on'); }

// ---------- Baner powiadomienia w aplikacji ----------
let bannerTimer;
export function showBanner(a, { onOpen, onSnooze } = {}) {
  const b = $('#banner');
  b.innerHTML = `<div class="bt">${esc(a.title)}</div><div class="bb">${esc(a.body)}</div>
    <div class="ba">
      ${a.kind === 'event' ? '<button class="btn small" data-b="snooze" type="button">Odłóż o 10 min</button>' : ''}
      <button class="btn small" data-b="open" type="button">${a.kind === 'brief' ? 'Pokaż dzień' : 'Otwórz'}</button>
      <button class="btn small primary" data-b="ok" type="button">OK</button>
    </div>`;
  b.classList.add('on');
  haptic();
  const hide = () => b.classList.remove('on');
  b.onclick = (e) => {
    const k = e.target.closest('[data-b]')?.dataset.b;
    if (!k) return;
    if (k === 'snooze') onSnooze?.(a);
    if (k === 'open') onOpen?.(a);
    hide();
  };
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(hide, a.kind === 'event' ? 20000 : 9000);
}

export function confirmSheet({ title, text, confirmLabel = 'Usuń', danger = true, extra, extras = [] }) {
  return new Promise((resolve) => {
    let answered = false;
    const h = openSheet(`
      <div class="grab"><i></i></div>
      <div class="sheet-h"><h3>${esc(title)}</h3></div>
      <div class="sheet-b"><p style="color:var(--text2)">${esc(text || '')}</p></div>
      <div class="sheet-f" style="flex-direction:column">
        ${extra ? `<button class="btn block" data-c="extra" type="button">${esc(extra)}</button>` : ''}
        ${extras.map((x) => `<button class="btn block" data-c="x:${esc(x.id)}" type="button">${esc(x.label)}</button>`).join('')}
        <button class="btn block ${danger ? 'danger' : 'primary'}" data-c="yes" type="button">${esc(confirmLabel)}</button>
        <button class="btn block" data-c="no" type="button">Anuluj</button>
      </div>`, { onClose: () => { if (!answered) resolve(null); } });
    h.el.addEventListener('click', (e) => {
      const c = e.target.closest('[data-c]')?.dataset.c;
      if (!c) return;
      answered = true;
      resolve(c === 'yes' ? 'yes' : c === 'extra' ? 'extra' : c.startsWith('x:') ? c.slice(2) : null);
      closeSheet(h);
    });
  });
}
