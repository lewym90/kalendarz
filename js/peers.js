// Wspólny kalendarz: wpisy drugiej osoby (tylko do odczytu), pobierane z Twojego serwera.
import { state } from './store.js';
import { pushConfig, pushApi } from './push.js';

const KEY = 'kalendarz.peers';
let cache = { list: [], at: 0 };
try { const c = JSON.parse(localStorage.getItem(KEY) || 'null'); if (c && Array.isArray(c.list)) cache = c; } catch (_) { /* brak */ }
let built = null;
const subs = new Set();
export const onPeers = (fn) => { subs.add(fn); return () => subs.delete(fn); };

export const peersOn = () => !!(state.settings.share && state.settings.share.view) && !!pushConfig();
export const peerList = () => cache.list;

export function peerEvents() {
  if (!peersOn()) return [];
  if (built && built.src === cache) return built.out;
  const out = [];
  for (const p of cache.list) {
    const peer = { id: p.id, name: p.name, color: p.color };
    p.events.forEach((e, i) => {
      out.push({
        id: `p:${p.id}:${i}`, title: e.p ? 'Zajęte' : (e.t || 'Wydarzenie'), loc: e.l || '', notes: '', cat: 'inne', rrule: null, exdates: [], reminders: [], private: !!e.p,
        allDay: !!e.ad, start: `${e.d}T${e.ad ? '00:00' : e.s || '00:00'}`, end: `${e.ed || e.d}T${e.ad ? '23:59' : e.e || e.s || '00:00'}`, peer,
      });
    });
  }
  built = { src: cache, out };
  return out;
}

let busy = false;
export async function fetchPeers() {
  if (busy || !peersOn()) return false;
  busy = true;
  try {
    const r = await pushApi('/peers', {});
    const list = Array.isArray(r.peers) ? r.peers : [];
    if (JSON.stringify(list) !== JSON.stringify(cache.list)) {
      cache = { list, at: Date.now() };
      try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch (_) { /* brak */ }
      subs.forEach((f) => f());
    }
    return true;
  } catch (_) { return false; } finally { busy = false; }
}
export function clearPeers() { cache = { list: [], at: 0 }; built = null; try { localStorage.removeItem(KEY); } catch (_) { /* brak */ } }
