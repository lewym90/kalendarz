// Kalendarz biura (Moja Agencja): sprawy firmy obok prywatnych, tylko do odczytu.
// Adres .ics z programu biura (Kalendarz → W telefonie); pobierany co 15 minut.
import { parseICS } from './ics.js';

const KEY = 'kalendarz.biuro';
export const BIURO = { id: 'biuro', name: 'Biuro', color: '#D7B068' };
let cache = { url: '', list: [], at: 0, err: '' };
try { const c = JSON.parse(localStorage.getItem(KEY) || 'null'); if (c && typeof c.url === 'string') cache = { ...cache, ...c }; } catch (_) { /* brak */ }
let built = null;
const subs = new Set();
const zapisz = () => { try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch (_) { /* brak */ } };

export const onBiuro = (fn) => { subs.add(fn); return () => subs.delete(fn); };
export const biuroInfo = () => ({ url: cache.url, at: cache.at, err: cache.err, count: cache.list.length });

export function biuroEvents() {
  if (!cache.url) return [];
  if (built && built.src === cache.list) return built.out;
  const out = cache.list.map((e, i) => ({
    id: `b:${e.uid || i}`, title: e.title, loc: e.loc || '', notes: e.notes || '', cat: 'praca',
    rrule: null, exdates: [], reminders: [], private: false, allDay: e.allDay, start: e.start, end: e.end, peer: BIURO,
  }));
  built = { src: cache.list, out };
  return out;
}

let busy = false;
export async function fetchBiuro() {
  if (busy || !cache.url) return false;
  busy = true;
  try {
    const r = await fetch(cache.url, { cache: 'no-store' });
    if (!r.ok) throw new Error(r.status === 404 ? 'Adres nieaktualny — skopiuj nowy z programu biura' : `Serwer odpowiedział ${r.status}`);
    const list = parseICS(await r.text()).map(({ uid, title, start, end, allDay, loc, notes }) => ({ uid, title, start, end, allDay, loc, notes }));
    const zmiana = JSON.stringify(list) !== JSON.stringify(cache.list) || cache.err;
    cache = { ...cache, list, at: Date.now(), err: '' };
    zapisz();
    if (zmiana) subs.forEach((f) => f());
    return true;
  } catch (e) {
    cache = { ...cache, err: e.message || 'Brak połączenia' };
    zapisz();
    return false;
  } finally { busy = false; }
}

export async function setBiuro(url) {
  const u = String(url || '').trim().replace(/^webcal:\/\//i, 'https://');
  if (u && !/^https:\/\/.+\.ics(\?.*)?$/i.test(u)) throw new Error('To nie wygląda na adres kalendarza (.ics)');
  cache = { url: u, list: [], at: 0, err: '' };
  built = null;
  zapisz();
  subs.forEach((f) => f());
  if (u && !(await fetchBiuro())) throw new Error(cache.err || 'Nie udało się pobrać kalendarza');
}
