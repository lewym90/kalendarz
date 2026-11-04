// Wspólna przestrzeń dwojga: wydarzenia za zgodą drugiej osoby, wspólne zadania i lista zakupów.
// Zmiany czekają w kolejce, więc działa też bez sieci; serwer nadaje kolejność, ostatnia zmiana wygrywa.
import { state, save, onChange, newEvent, addEvent } from './store.js';
import { pushConfig, pushApi } from './push.js';
import { uid, parseDT, fmtDayMid, fmtTime } from './util.js';

const KEY = 'kalendarz.space';
let st = { v: 0, items: {}, queue: [], sigs: {} };
try { const c = JSON.parse(localStorage.getItem(KEY) || 'null'); if (c && c.items) st = { ...st, ...c }; } catch (_) { /* brak */ }
const keep = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (_) { /* brak */ } };
const subs = new Set();
export const onSpace = (f) => { subs.add(f); return () => subs.delete(f); };
const tell = (msg) => subs.forEach((f) => f(msg));

export const me = () => String(state.settings.share?.name || '').trim();
export const spaceReady = () => !!pushConfig()?.token && !!me();
export let spaceErr = '';

const evData = (ev) => ({ title: ev.title, start: ev.start, end: ev.end, allDay: !!ev.allDay, cat: ev.cat, loc: ev.loc || '', notes: ev.notes || '', rrule: ev.rrule || null, exdates: ev.exdates || [] });
const when = (d) => { const s = parseDT(d.start); return `${fmtDayMid(s)}${d.allDay ? '' : `, ${fmtTime(s)}`}`; };
const sig = (ev) => JSON.stringify(evData(ev));

function push(id, kind, data, note, deleted = false) {
  st.items[id] = { id, kind, data, deleted, by: me(), at: Date.now(), v: st.items[id]?.v || 0 };
  st.queue = st.queue.filter((q) => q.id !== id).concat({ id, kind, data, deleted, note });
  keep();
  schedule();
}

// ---------- Wydarzenia ----------
export function inviteEvent(ev, title = ev.title) {
  const id = uid();
  ev.sharedId = id;
  st.sigs[id] = sig(ev);
  push(id, 'event', { ...evData(ev), status: 'pending', from: me() }, `Zaproszenie: ${title} · ${when(ev)}`);
  save();
}
export const invitesForMe = () => Object.values(st.items).filter((x) => x.kind === 'event' && !x.deleted && x.data.status === 'pending' && x.data.from !== me());
export const invitesFromMe = () => Object.values(st.items).filter((x) => x.kind === 'event' && !x.deleted && x.data.status === 'pending' && x.data.from === me());
export function acceptInvite(id) {
  const it = st.items[id];
  if (!it) return;
  const { status, from, ...d } = it.data;
  const ev = newEvent({ ...d, sharedId: id });
  st.sigs[id] = sig(ev);
  addEvent(ev);
  push(id, 'event', { ...it.data, status: 'accepted' }, `Przyjęto: ${d.title}`);
}
export function declineInvite(id) {
  const it = st.items[id];
  if (it) push(id, 'event', { ...it.data, status: 'declined' }, `Odrzucono: ${it.data.title}`);
}
function watchEvents() {
  const seen = new Set();
  for (const ev of state.events) {
    if (!ev.sharedId) continue;
    seen.add(ev.sharedId);
    const s = sig(ev);
    const id = ev.sharedId;
    if (st.sigs[id] === undefined) { st.sigs[id] = s; continue; }
    if (st.sigs[id] !== s) {
      st.sigs[id] = s;
      const old = st.items[id]?.data || { status: 'accepted', from: me() };
      push(id, 'event', { ...evData(ev), status: old.status, from: old.from }, `Zmiana: ${ev.title} · ${when(ev)}`);
    }
  }
  for (const id of Object.keys(st.sigs)) {
    if (seen.has(id)) continue;
    delete st.sigs[id];
    const it = st.items[id];
    if (it && !it.deleted) push(id, 'event', null, `Odwołano: ${it.data?.title || 'wspólne wydarzenie'}`, true);
  }
  keep();
}
function applyEvent(it, prev) {
  const local = state.events.find((e) => e.sharedId === it.id);
  if (it.deleted) {
    if (local) { state.events = state.events.filter((e) => e !== local); delete st.sigs[it.id]; save(); tell(`Odwołano wspólne: ${local.title}`); }
    return;
  }
  const d = it.data;
  if (d.status === 'declined') {
    if (local) { delete local.sharedId; delete st.sigs[it.id]; save(); }
    if (d.from === me() && prev?.data?.status !== 'declined') tell(`${it.by || 'Druga osoba'} nie może: ${d.title}`);
    return;
  }
  if (local) {
    const data = { ...d }; delete data.status; delete data.from;
    const s = JSON.stringify(evData({ ...local, ...data }));
    if (s !== sig(local)) { Object.assign(local, data); st.sigs[it.id] = sig(local); save(); }
    if (d.status === 'accepted' && prev?.data?.status === 'pending' && d.from === me()) tell(`${it.by || 'Druga osoba'} przyjęła: ${d.title}`);
  }
}

// ---------- Zadania i zakupy ----------
export const sharedList = (kind) => Object.values(st.items).filter((x) => x.kind === kind && !x.deleted).sort((a, b) => (a.data.done ? 1 : 0) - (b.data.done ? 1 : 0) || (a.data.created || 0) - (b.data.created || 0));
export function addShared(kind, data, note) { const id = uid(); push(id, kind, { ...data, by: me(), created: Date.now() }, note); return id; }
export function patchShared(id, patch, note) { const it = st.items[id]; if (it) push(id, it.kind, { ...it.data, ...patch }, note); }
export function removeShared(id) { const it = st.items[id]; if (it) push(id, it.kind, null, undefined, true); }
export const clearBoughtShop = () => sharedList('shop').filter((x) => x.data.done).forEach((x) => removeShared(x.id));

// ---------- Synchronizacja ----------
let timer = 0;
let busy = false;
export function schedule(ms = 600) { clearTimeout(timer); timer = setTimeout(spaceSync, ms); }
export async function spaceSync() {
  if (busy || !spaceReady()) return false;
  busy = true;
  const sending = st.queue.slice(0, 200);
  try {
    const r = await pushApi('/space/sync', { me: me(), since: st.v, changes: sending });
    st.queue = st.queue.filter((q) => !sending.includes(q));
    spaceErr = '';
    let changed = false;
    for (const it of r.items || []) {
      if (st.queue.some((q) => q.id === it.id)) continue;
      const prev = st.items[it.id];
      if (prev && prev.v === it.v) continue;
      st.items[it.id] = it;
      changed = true;
      if (it.kind === 'event') applyEvent(it, prev);
    }
    st.v = r.v || st.v;
    keep();
    if (changed) tell();
    return true;
  } catch (e) {
    spaceErr = e.status === 404 ? 'Zaktualizuj serwer, żeby włączyć wspólne wpisy.' : '';
    return false;
  } finally { busy = false; }
}
export function initSpace() {
  onChange(watchEvents);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') spaceSync(); });
  setInterval(() => { if (document.visibilityState === 'visible') spaceSync(); }, 45000);
  setTimeout(spaceSync, 2000);
}
export const _testState = () => st;
