// Blokada aplikacji: Face ID / Touch ID przez WebAuthn (klucz dostępu na urządzeniu) + awaryjny kod PIN.
// To blokada lokalna: chroni przed postronną osobą z odblokowanym telefonem, nie szyfruje danych.
import { $, esc, ICON, haptic } from './util.js';
import { openSheet, closeSheet, toast } from './ui.js';

const KEY = 'kalendarz.lock';
const cfg = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null') || {}; } catch (_) { return {}; } };
const saveCfg = (c) => { try { localStorage.setItem(KEY, JSON.stringify(c)); } catch (_) { /* brak miejsca */ } };

export const lockOn = () => !!cfg().cred;
export const lockSupported = () => !!(window.PublicKeyCredential && navigator.credentials);
const DELAYS = [[0, 'Od razu'], [60, 'Po 1 minucie'], [300, 'Po 5 minutach']];
export function lockSummary() {
  const c = cfg();
  if (!c.cred) return 'Wymagaj Face ID przy otwarciu aplikacji';
  return `Włączona. Blokada: ${DELAYS.find(([s]) => s === (c.delay ?? 0))?.[1].toLowerCase() || 'od razu'}`;
}

const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const rand = (n) => crypto.getRandomValues(new Uint8Array(n));

async function hashPin(pin, salt) {
  const data = new TextEncoder().encode(salt + ':' + pin);
  return b64(await crypto.subtle.digest('SHA-256', data));
}

async function createCredential() {
  const cred = await navigator.credentials.create({
    publicKey: {
      rp: { name: 'Kalendarz' },
      user: { id: rand(16), name: 'kalendarz', displayName: 'Kalendarz' },
      challenge: rand(32),
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
      timeout: 60000,
    },
  });
  return b64(cred.rawId);
}

async function verifyBiometric() {
  const c = cfg();
  if (!c.cred) return true;
  await navigator.credentials.get({
    publicKey: { challenge: rand(32), allowCredentials: [{ type: 'public-key', id: unb64(c.cred) }], userVerification: 'required', timeout: 60000 },
  });
  return true;
}

// ---------- Nakładka blokady ----------
let overlay = null;
let hiddenAt = 0;
let locked = false;

function ensureOverlay() {
  if (overlay) return overlay;
  overlay = document.createElement('div');
  overlay.id = 'lock';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-label', 'Aplikacja zablokowana');
  document.body.appendChild(overlay);
  overlay.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-l]');
    if (!b) return;
    if (b.dataset.l === 'bio') tryBio();
    else if (b.dataset.l === 'pin') showPin();
    else if (b.dataset.l === 'back') paint();
    else if (b.dataset.l === 'ok') checkPin();
  });
  overlay.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.id === 'lock-pin') checkPin(); });
  return overlay;
}

function paint(msg = '') {
  ensureOverlay().innerHTML = `
    <div class="lock-in">
      <div class="lock-ico">${ICON.lock}</div>
      <h2>Kalendarz</h2>
      <p>${esc(msg) || 'Aplikacja jest zablokowana.'}</p>
      <button type="button" class="btn primary" data-l="bio">Odblokuj Face ID</button>
      <button type="button" class="link" data-l="pin">Użyj kodu PIN</button>
    </div>`;
}
function showPin(err = '') {
  ensureOverlay().innerHTML = `
    <div class="lock-in">
      <div class="lock-ico">${ICON.lock}</div>
      <h2>Podaj kod PIN</h2>
      <p style="color:${err ? 'var(--danger)' : 'inherit'}">${esc(err) || 'Awaryjne odblokowanie.'}</p>
      <input id="lock-pin" type="password" inputmode="numeric" autocomplete="off" maxlength="8" placeholder="••••" class="lock-pin">
      <button type="button" class="btn primary" data-l="ok">Odblokuj</button>
      <button type="button" class="link" data-l="back">Wróć</button>
    </div>`;
  setTimeout(() => $('#lock-pin')?.focus(), 50);
}

export function lockNow(auto = true) {
  if (!lockOn()) return;
  locked = true;
  ensureOverlay();
  overlay.classList.add('on');
  document.documentElement.classList.add('is-locked');
  paint();
  if (auto) setTimeout(tryBio, 350);
}
function unlockUI() {
  locked = false;
  overlay?.classList.remove('on');
  document.documentElement.classList.remove('is-locked');
  haptic();
}
let busy = false;
async function tryBio() {
  if (busy) return;
  busy = true;
  try { await verifyBiometric(); unlockUI(); } catch (_) { paint('Nie udało się. Spróbuj ponownie albo użyj kodu PIN.'); } finally { busy = false; }
}
async function checkPin() {
  const c = cfg();
  const v = $('#lock-pin')?.value || '';
  if (c.pin && (await hashPin(v, c.pin.salt)) === c.pin.hash) unlockUI();
  else showPin('Zły kod.');
}

export function initLock() {
  if (lockOn()) lockNow(true);
  document.addEventListener('visibilitychange', () => {
    if (!lockOn()) return;
    if (document.visibilityState === 'hidden') {
      hiddenAt = Date.now();
      // zasłoń treść w przełączniku aplikacji
      ensureOverlay();
      if (!locked) { overlay.classList.add('on', 'veil'); paintVeil(); }
    } else {
      const delay = (cfg().delay ?? 0) * 1000;
      if (locked) { overlay.classList.remove('veil'); paint(); tryBio(); return; }
      if (Date.now() - hiddenAt >= delay) lockNow(true);
      else { overlay.classList.remove('on', 'veil'); }
    }
  });
}
function paintVeil() { overlay.innerHTML = `<div class="lock-in"><div class="lock-ico">${ICON.lock}</div><h2>Kalendarz</h2></div>`; }

// ---------- Ustawienia blokady ----------
export function openLockSettings() {
  const on = lockOn();
  const c = cfg();
  const body = () => on
    ? `<p style="color:var(--text2)">Aplikacja prosi o Face ID przy otwarciu. Kod PIN służy tylko awaryjnie.</p>
       <div class="lbl">Kiedy blokować</div>
       <div class="chips">${DELAYS.map(([s, l]) => `<button type="button" class="chip ${(c.delay ?? 0) === s ? 'on' : ''}" data-delay="${s}">${l}</button>`).join('')}</div>
       <div class="lbl">Zmień kod PIN</div>
       <div class="field"><input id="lk-pin" type="password" inputmode="numeric" maxlength="8" placeholder="Nowy PIN (4–8 cyfr)"></div>
       <p class="note">Blokada jest lokalna: chroni przed osobą, która ma Twój odblokowany telefon. Nie szyfruje danych w pamięci aplikacji.</p>`
    : `<p style="color:var(--text2)">Po włączeniu aplikacja będzie wymagała Face ID (lub Touch ID) przy każdym otwarciu.</p>
       <div class="lbl">Awaryjny kod PIN</div>
       <div class="field"><input id="lk-pin" type="password" inputmode="numeric" maxlength="8" placeholder="PIN (4–8 cyfr)"></div>
       <p class="note">PIN pozwoli wejść, gdy Face ID zawiedzie. Zapamiętaj go: bez niego i bez Face ID trzeba wyczyścić dane przeglądarki.</p>
       ${lockSupported() ? '' : '<p class="note" style="color:var(--danger)">Ta przeglądarka nie obsługuje kluczy dostępu.</p>'}`;
  const h = openSheet(`
    <div class="grab"><i></i></div>
    <div class="sheet-h"><h3>Blokada Face ID</h3><button type="button" class="round" data-x="close" aria-label="Zamknij"><span class="ico">${ICON.close}</span></button></div>
    <div class="sheet-b">${body()}</div>
    <div class="sheet-f">${on ? '<button type="button" class="btn danger" id="lk-off">Wyłącz blokadę</button><button type="button" class="btn primary" id="lk-save">Zapisz PIN</button>' : '<button type="button" class="btn primary" id="lk-on">Włącz Face ID</button>'}</div>`);
  const getPin = () => {
    const v = $('#lk-pin', h.el).value.trim();
    if (!/^\d{4,8}$/.test(v)) { toast('PIN ma mieć od 4 do 8 cyfr'); return null; }
    return v;
  };
  h.el.addEventListener('click', async (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.x === 'close') return closeSheet(h);
    if (t.dataset.delay != null) {
      const cc = cfg(); cc.delay = +t.dataset.delay; saveCfg(cc); haptic();
      h.el.querySelectorAll('[data-delay]').forEach((b) => b.classList.toggle('on', b === t));
      return;
    }
    if (t.id === 'lk-on') {
      const pin = getPin();
      if (!pin) return;
      try {
        const cred = await createCredential();
        const salt = b64(rand(12));
        saveCfg({ cred, pin: { salt, hash: await hashPin(pin, salt) }, delay: 0 });
        toast('Blokada włączona');
        closeSheet(h);
      } catch (err) { toast(err?.name === 'NotAllowedError' ? 'Anulowano. Blokada nie została włączona.' : 'Nie udało się włączyć Face ID na tym urządzeniu.'); }
    } else if (t.id === 'lk-save') {
      const pin = getPin();
      if (!pin) return;
      const cc = cfg(); const salt = b64(rand(12)); cc.pin = { salt, hash: await hashPin(pin, salt) }; saveCfg(cc);
      toast('Zapisano nowy PIN');
    } else if (t.id === 'lk-off') {
      try { await verifyBiometric(); try { localStorage.removeItem(KEY); } catch (_) { /* nic */ } toast('Blokada wyłączona'); closeSheet(h); } catch (_) { toast('Najpierw potwierdź Face ID'); }
    }
  });
  return h;
}
