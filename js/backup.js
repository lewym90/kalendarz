// Automatyczna kopia na serwerze. Dane są szyfrowane w telefonie (AES-GCM), serwer widzi tylko nieczytelny blok.
// Klucz powstaje z hasła; bez hasła kopii nie da się odczytać, nawet z dostępem do serwera.
import { exportData, importData, onChange } from './store.js';
import { pushApi, pushConfig } from './push.js';

const KEY = 'kalendarz.bk';
const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (_) { return null; } };
const write = (v) => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (_) { /* brak */ } };
const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 8192) s += String.fromCharCode(...u8.subarray(i, i + 8192)); return btoa(s); };
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const hex = (u8) => [...u8].map((x) => x.toString(16).padStart(2, '0')).join('');

export const backupOn = () => !!read()?.k;
export const backupInfo = () => read() || {};
export function backupOff() { try { localStorage.removeItem(KEY); } catch (_) { /* brak */ } }

// Z hasła powstają dwie niezależne części: klucz szyfrujący i identyfikator kopii.
export async function deriveKeys(pass) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveBits']);
  const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode('kalendarz-kopia-v1'), iterations: 250000 }, base, 512));
  return { k: b64(bits.subarray(0, 32)), bid: hex(bits.subarray(32, 56)) };
}
const aes = (k) => crypto.subtle.importKey('raw', unb64(k), 'AES-GCM', false, ['encrypt', 'decrypt']);
export async function sealText(text, k) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aes(k), new TextEncoder().encode(text)));
  const out = new Uint8Array(12 + ct.length); out.set(iv); out.set(ct, 12);
  return b64(out);
}
export async function openText(blob, k) {
  const u = unb64(blob);
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: u.subarray(0, 12) }, await aes(k), u.subarray(12)));
}

let last = '';
let timer = 0;
export async function backupNow(force = false) {
  const c = read();
  if (!c?.k || !pushConfig()?.token) return false;
  const text = exportData().replace(/"exportedAt":"[^"]*",?/, '');
  if (!force && text === last) return true;
  if (!force && c.at && Date.now() - c.at < 10 * 60000) return false;
  try {
    const r = await pushApi('/backup/put', { bid: c.bid, blob: await sealText(exportData(), c.k) });
    last = text;
    write({ ...read(), at: Date.now(), err: '', versions: r.versions?.length || 0 });
    return true;
  } catch (e) {
    write({ ...read(), err: e.status === 404 ? 'Zaktualizuj serwer, żeby włączyć kopię.' : (e.message || 'Błąd zapisu') });
    return false;
  }
}
export async function backupEnable(pass) {
  const keys = await deriveKeys(pass);
  write(keys);
  const ok = await backupNow(true);
  if (!ok) { const e = read()?.err; backupOff(); throw new Error(e || 'Nie udało się zapisać kopii'); }
}
export async function backupVersions(pass) {
  const keys = await deriveKeys(pass);
  const r = await pushApi('/backup/list', { bid: keys.bid });
  return { keys, versions: r.versions || [] };
}
export async function backupRestore(keys, at) {
  const r = await pushApi('/backup/get', { bid: keys.bid, at });
  let text;
  try { text = await openText(r.blob, keys.k); } catch (_) { throw new Error('Złe hasło do kopii'); }
  importData(text);
  write({ ...keys, at: Date.now() });
}
export function initBackup() {
  const plan = () => { clearTimeout(timer); timer = setTimeout(() => backupNow(), 45000); };
  onChange(plan);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState !== 'visible') backupNow(); });
  setTimeout(() => backupNow(), 8000);
}
