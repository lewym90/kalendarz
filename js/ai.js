// Asystent: rozumie polecenia, odpowiada na pytania o plan i proponuje zmiany. Model tylko proponuje; wolne terminy liczy nasz planer,
// aplikacja sprawdza każdą propozycję, a zapis następuje dopiero po zatwierdzeniu i można go cofnąć.
import { state, catOf, newEvent, newTask, addEvent, addTask, updateEvent, updateTask, deleteEvent, deleteOccurrence, detachOccurrence, toggleTask, batch, undo } from './store.js';
import { $, esc, ymd, addDays, startOfDay, parseDT, fmtDT, fmtTime, relDay, DAYS_FULL, ICON, haptic, pad, parseYmd } from './util.js';
import { instancesInRange, eventSpan } from './recur.js';
import { openSheet, closeSheet, rerender, toast } from './ui.js';
import { findSlots } from './planner.js';
import { peerEvents, peersOn } from './peers.js';
import { pushApi, pushConfig } from './push.js';
import { activePrefs, addPref } from './prefs.js';
import { glyphFor, glyphHtml } from './glyphs.js';
import { bufferOf } from './tools.js';

const norm = (s) => (s || '').toLowerCase().replace(/[ąćęłńóśźż]/g, (c) => ({ ą: 'a', ć: 'c', ę: 'e', ł: 'l', ń: 'n', ó: 'o', ś: 's', ź: 'z', ż: 'z' }[c]));

// Czy tekst z pola to polecenie dla asystenta, a nie zwykły wpis do kalendarza.
export function isCommand(text) {
  const t = norm(text).trim();
  if (!t) return false;
  if (t.endsWith('?')) return true;
  return /^(znajdz|przenies|przeloz|zaplanuj|uloz|uloz mi|dopasuj|przebuduj|zmien plan|odwolaj|usun|co mam|co mnie|co moge|co dzis|co jutro|kiedy|ile|czy|jak|pokaz|przygotuj|podsumuj|zapamietaj|wypadlo|wypadl|wypadla|nie zdaze|spoznie|mam wolne)\b/.test(t) || /\b(wypadlo mi|wypadl mi|wypadla mi|dopasuj reszte|przebuduj dzien|nie zdaze)\b/.test(t);
}

// ---------- Dane dla modelu ----------
const line = (i, who) => {
  const priv = i.ev.private || i.ev.peer?.name && i.title === 'Zajęte';
  const o = { key: who ? undefined : i.key, who, title: priv ? 'Zajęte' : i.title, date: i.date, start: i.allDay ? undefined : fmtTime(i.start), end: i.allDay ? undefined : fmtTime(i.end), allDay: i.allDay || undefined, cat: who ? undefined : i.ev.cat, loc: priv ? undefined : i.ev.loc || undefined, recurring: i.recurring || undefined, locked: (who || i.ev.private) ? true : undefined };
  return o;
};
export function buildContext(now = new Date()) {
  const d0 = addDays(startOfDay(now), -1);
  const d1 = addDays(startOfDay(now), 15);
  const me = state.settings.displayName?.trim() || state.settings.share?.name?.trim() || '';
  const mine = instancesInRange(state.events, d0, d1).map((i) => line(i));
  const peers = peersOn() ? instancesInRange(peerEvents(), d0, d1).map((i) => line(i, i.ev.peer.name)) : [];
  const tasks = state.tasks.filter((t) => !t.done).slice(0, 60).map((t) => ({ id: t.id, title: t.title, due: t.due || undefined, time: t.dueTime || undefined, prio: t.prio || undefined, cat: t.cat, moved: t.rolled || undefined }));
  return {
    now: `${ymd(now)} ${fmtTime(now)}, ${DAYS_FULL[now.getDay()]}`, name: me, dayHours: `${state.settings.dayStart}-${state.settings.dayEnd}`, bufferMin: state.settings.buffer?.def || 0,
    categories: state.cats.map((c) => ({ id: c.id, name: c.name })), events: mine, partnerEvents: peers, tasks, preferences: activePrefs(now).map((p) => p.text),
  };
}
export const SYSTEM = `Jesteś asystentem w polskiej aplikacji Kalendarz. Mówisz krótko, po koleżeńsku, na Ty, po polsku. Jeśli znasz imię, używaj go rzadko.
Zawsze odpowiadaj WYŁĄCZNIE jednym obiektem JSON: {"reply":"tekst","need":null,"actions":[],"remember":null}.
need: gdy brakuje danych, zamiast zgadywać poproś o nie: {"search":"słowo"} przeszukuje całą historię wpisów, {"slots":{"dur":60,"days":7,"from":"09:00","to":"18:00","both":false,"weekdays":false}} zwraca wolne okna (both=true: wolne dla obojga). Wtedy zostaw actions puste. Dostaniesz wynik w kolejnej wiadomości.
actions: propozycje zmian, użytkownik sam je zatwierdzi. Typy:
{"type":"add_event","title":"","date":"RRRR-MM-DD","start":"GG:MM","end":"GG:MM","allDay":false,"cat":"id","loc":""}
{"type":"move_event","key":"klucz z events","date":"RRRR-MM-DD","start":"GG:MM","end":"GG:MM"}
{"type":"delete_event","key":"klucz z events"}
{"type":"add_task","title":"","due":"RRRR-MM-DD","time":"GG:MM","cat":"id","prio":0}
{"type":"move_task","id":"id zadania","due":"RRRR-MM-DD","time":"GG:MM"}
{"type":"done_task","id":"id zadania"}
Zasady: używaj wyłącznie kluczy i id z danych. Nie wolno zmieniać wpisów locked ani partnerEvents, ale są zajętym czasem. Godziny do propozycji bierz z wyniku slots albo sprawdzaj, żeby nie nachodziły na inne wpisy, z uwzględnieniem bufferMin. Nie zmieniaj niczego, o co nie proszono. Gdy coś wypadło lub pojawiło się pilne spotkanie: dodaj je i przesuń tylko to, co koliduje, a resztę zostaw. Pytania o plan: odpowiedz w reply, actions puste. W reply opisz propozycję jednym lub dwoma zdaniami, bez listowania wszystkich zmian. Gdy użytkownik podaje trwałą zasadę lub prosi o zapamiętanie, wpisz ją w remember jednym zdaniem. Nie wymyślaj wpisów, których nie ma w danych. Jeśli czegoś nie wiesz, powiedz to wprost.`;

export function parseReply(text) {
  const t = String(text || '').replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try { const j = JSON.parse(t); return { reply: String(j.reply || ''), need: j.need || null, actions: Array.isArray(j.actions) ? j.actions : [], remember: j.remember || null }; } catch (_) { return { reply: t.slice(0, 1200), need: null, actions: [], remember: null }; }
}

export function searchHistory(q, now = new Date()) {
  const w = norm(q);
  const found = [];
  for (const ev of state.events) {
    if (ev.private || !norm(`${ev.title} ${ev.loc} ${ev.notes}`).includes(w)) continue;
    if (!ev.rrule) { found.push({ title: ev.title, date: ev.start.slice(0, 10), time: ev.allDay ? undefined : ev.start.slice(11), loc: ev.loc || undefined }); continue; }
    const list = instancesInRange([ev], addDays(now, -400), addDays(now, 200));
    const past = list.filter((i) => i.start <= now).pop(); const next = list.find((i) => i.start > now);
    for (const i of [past, next]) if (i) found.push({ title: ev.title, date: i.date, time: i.allDay ? undefined : fmtTime(i.start), recurring: true });
  }
  for (const t of state.tasks) if (norm(t.title).includes(w)) found.push({ task: t.title, due: t.due || undefined, done: t.done || undefined });
  return found.sort((a, b) => String(b.date || b.due).localeCompare(String(a.date || a.due))).slice(0, 25);
}
function slotsFor(o, now = new Date()) {
  const events = o.both && peersOn() ? state.events.concat(peerEvents()) : state.events;
  return findSlots(events, { now, durMin: Math.max(5, +o.dur || 60), days: Math.min(21, +o.days || 7), from: /^\d\d:\d\d$/.test(o.from) ? o.from : state.settings.dayStart, to: /^\d\d:\d\d$/.test(o.to) ? o.to : state.settings.dayEnd, weekdaysOnly: !!o.weekdays, count: 12, bufferOf, allDayBusy: !!o.both }).map((s) => ({ date: ymd(s.start), start: fmtTime(s.start), end: fmtTime(s.end), wolneMin: s.gap }));
}

// Rozmowa z modelem: najwyżej kilka kroków zbierania danych, potem odpowiedź.
export async function askModel(turns, call = (b) => pushApi('/ai', b), now = new Date()) {
  const convo = [...turns];
  const ctx = JSON.stringify(buildContext(now));
  for (let i = 0; i < 4; i++) {
    const r = await call({ system: `${SYSTEM}\nDANE:\n${ctx}`, turns: convo });
    const p = parseReply(r.text);
    if (!p.need) return { ...p, raw: r.text };
    convo.push({ role: 'model', text: r.text });
    const res = p.need.search ? { search: p.need.search, wyniki: searchHistory(p.need.search, now) } : p.need.slots ? { wolneOkna: slotsFor(p.need.slots, now) } : { blad: 'nieznane need' };
    convo.push({ role: 'user', text: `WYNIK: ${JSON.stringify(res)}` });
  }
  return { reply: 'Nie udało mi się tego ustalić. Spróbuj prościej.', actions: [] };
}

// ---------- Sprawdzanie propozycji ----------
const okD = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
const okT = (s) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s || '');
const catId = (c) => (state.cats.some((x) => x.id === c) ? c : 'inne');
const findInst = (key) => {
  const [id, date] = String(key || '').split('@');
  const ev = state.events.find((e) => e.id === id);
  if (!ev || !date) return null;
  const d = parseYmd(date);
  return instancesInRange([ev], addDays(d, -45), addDays(d, 2)).find((i) => i.key === key) || null;
};
const whenTxt = (date, a, b) => `${relDay(parseYmd(date))}${a ? `, ${a}${b ? `–${b}` : ''}` : ''}`;
function clash(date, a, b, skipKey) {
  if (!a || !b) return null;
  const s = parseDT(`${date}T${a}`); const e = parseDT(`${date}T${b}`);
  const all = peersOn() ? state.events.concat(peerEvents()) : state.events;
  const hit = instancesInRange(all, startOfDay(s), addDays(startOfDay(s), 1)).find((i) => !i.allDay && i.key !== skipKey && i.start < e && i.end > s);
  return hit ? `Koliduje z: ${hit.title} (${fmtTime(hit.start)})` : null;
}
export function checkActions(list) {
  const out = [];
  for (const a of list.slice(0, 40)) {
    if (a.type === 'add_event' && a.title && okD(a.date) && (a.allDay || (okT(a.start) && okT(a.end)))) {
      out.push({ a, ico: glyphFor({ title: a.title, cat: catId(a.cat) }), head: 'Nowe', title: a.title, after: whenTxt(a.date, a.allDay ? null : a.start, a.allDay ? null : a.end), warn: a.allDay ? null : clash(a.date, a.start, a.end) });
    } else if (a.type === 'move_event' && okD(a.date) && okT(a.start) && okT(a.end)) {
      const i = findInst(a.key);
      if (!i || i.ev.private) continue;
      out.push({ a, i, ico: glyphFor(i.ev), head: 'Przenieś', title: i.title, before: whenTxt(i.date, fmtTime(i.start), fmtTime(i.end)), after: whenTxt(a.date, a.start, a.end), warn: clash(a.date, a.start, a.end, a.key) });
    } else if (a.type === 'delete_event') {
      const i = findInst(a.key);
      if (!i || i.ev.private) continue;
      out.push({ a, i, ico: glyphFor(i.ev), head: 'Usuń', title: i.title, before: whenTxt(i.date, i.allDay ? null : fmtTime(i.start), i.allDay ? null : fmtTime(i.end)) });
    } else if (a.type === 'add_task' && a.title) {
      out.push({ a, ico: 56, head: 'Nowe zadanie', title: a.title, after: okD(a.due) ? whenTxt(a.due, okT(a.time) ? a.time : null) : 'Bez terminu' });
    } else if (a.type === 'move_task' && okD(a.due)) {
      const t = state.tasks.find((x) => x.id === a.id);
      if (!t) continue;
      out.push({ a, t, ico: 57, head: 'Zadanie', title: t.title, before: t.due ? whenTxt(t.due, t.dueTime) : 'Bez terminu', after: whenTxt(a.due, okT(a.time) ? a.time : null) });
    } else if (a.type === 'done_task') {
      const t = state.tasks.find((x) => x.id === a.id);
      if (t) out.push({ a, t, ico: 57, head: 'Zrobione', title: t.title });
    }
  }
  return out;
}
export function applyAction(c) {
  const a = c.a;
  if (a.type === 'add_event') {
    const st = a.allDay ? `${a.date}T00:00` : `${a.date}T${a.start}`;
    const en = a.allDay ? `${a.date}T23:59` : `${a.date}T${a.end}`;
    addEvent(newEvent({ title: a.title, start: st, end: en, allDay: !!a.allDay, cat: catId(a.cat), loc: a.loc || '', reminders: a.allDay ? [0] : [...state.settings.defaultRemind] }));
  } else if (a.type === 'move_event') {
    const p = { start: `${a.date}T${a.start}`, end: `${a.date}T${a.end}` };
    if (c.i.recurring) detachOccurrence(c.i, p); else updateEvent(c.i.ev.id, p);
  } else if (a.type === 'delete_event') {
    if (c.i.recurring) deleteOccurrence(c.i.ev.id, c.i.date); else deleteEvent(c.i.ev.id);
  } else if (a.type === 'add_task') {
    addTask(newTask({ title: a.title, due: okD(a.due) ? a.due : null, dueTime: okT(a.time) ? a.time : null, cat: catId(a.cat), prio: [0, 1, 2].includes(a.prio) ? a.prio : 0 }));
  } else if (a.type === 'move_task') updateTask(c.t.id, { due: a.due, dueTime: okT(a.time) ? a.time : null });
  else if (a.type === 'done_task') toggleTask(c.t.id);
}

// ---------- Okno asystenta ----------
const EX = ['Co mam jutro?', 'Znajdź trzy godziny na projekt w tym tygodniu', 'Wypadło mi pilne spotkanie o 16, dopasuj resztę dnia', 'Przenieś zaległe zadania na wolne terminy', 'Kiedy oboje mamy wolny wieczór?'];
export function openAssistant(first = '') {
  const turns = [];
  const h = openSheet(`<div class="grab"><i></i></div>
    <div class="sheet-h"><h3 class="ai-h">${glyphHtml(63, 'sm')}Asystent</h3><button type="button" class="round" data-x="close" aria-label="Zamknij"><span class="ico">${ICON.close}</span></button></div>
    <div class="sheet-b ai-log" id="ai-log"><div class="ai-ex">${EX.map((t) => `<button type="button" class="ex-chip" data-ex="${esc(t)}">${esc(t)}</button>`).join('')}</div></div>
    <form class="sheet-f ai-form" id="ai-form" autocomplete="off"><input id="ai-in" type="text" enterkeyhint="send" placeholder="Napisz, co zmienić albo o co zapytać" autocapitalize="sentences"><button type="submit" class="ai-send" aria-label="Wyślij"><span class="ico">${ICON.send}</span></button></form>`, { className: 'tall' });
  const log = $('#ai-log', h.el);
  const input = $('#ai-in', h.el);
  const bubble = (cls, html) => { const d = document.createElement('div'); d.className = `ai-m ${cls}`; d.innerHTML = html; log.appendChild(d); log.scrollTop = log.scrollHeight; return d; };
  const card = (cands) => {
    const box = bubble('plan', `<div class="ai-plan-h">Proponowane zmiany</div>${cands.map((c, i) => `<label class="ai-c"><input type="checkbox" data-i="${i}" checked>${glyphHtml(c.ico, 'sm')}<span class="ai-ct"><small>${esc(c.head)}</small><b>${esc(c.title)}</b>${c.before ? `<span class="was">${esc(c.before)}</span>` : ''}${c.after ? `<span class="now">${esc(c.after)}</span>` : ''}${c.warn ? `<span class="warn">${esc(c.warn)}</span>` : ''}</span></label>`).join('')}<button type="button" class="btn primary block" data-apply="1">Zastosuj zaznaczone</button>`);
    box.addEventListener('click', (e) => {
      if (!e.target.closest('[data-apply]')) return;
      const on = [...box.querySelectorAll('input:checked')].map((x) => cands[+x.dataset.i]);
      if (!on.length) return;
      haptic();
      batch(() => on.forEach(applyAction));
      box.querySelector('[data-apply]').remove();
      box.querySelectorAll('input').forEach((x) => { x.disabled = true; });
      bubble('me sys', 'Zapisane');
      rerender();
      toast(`Zastosowano zmiany: ${on.length}`, { action: 'Cofnij', onAction: () => { undo(); rerender(); } });
    });
  };
  const ask = async (text) => {
    if (!text) return;
    log.querySelector('.ai-ex')?.remove();
    bubble('me', esc(text));
    turns.push({ role: 'user', text });
    const wait = bubble('bot wait', '<i></i><i></i><i></i>');
    try {
      if (!pushConfig()?.token) throw new Error('Najpierw połącz aplikację z serwerem w zakładce Więcej.');
      const r = await askModel(turns);
      wait.remove();
      turns.push({ role: 'model', text: r.raw || r.reply });
      if (r.reply) bubble('bot', esc(r.reply));
      if (r.remember) { addPref(r.remember); bubble('me sys', `Zapamiętane: ${esc(r.remember)}`); }
      const c = checkActions(r.actions || []);
      if (c.length) card(c);
    } catch (e) {
      wait.remove();
      bubble('bot err', esc(e.status === 404 ? 'Zaktualizuj serwer, żeby włączyć asystenta.' : e.message || 'Asystent chwilowo nie odpowiada.'));
    }
  };
  h.el.addEventListener('click', (e) => {
    if (e.target.closest('[data-x]')) return closeSheet(h);
    const ex = e.target.closest('[data-ex]');
    if (ex) ask(ex.dataset.ex);
  });
  $('#ai-form', h.el).addEventListener('submit', (e) => { e.preventDefault(); const t = input.value.trim(); input.value = ''; ask(t); });
  if (first) ask(first); else setTimeout(() => input.focus(), 80);
  return h;
}
void catOf; void fmtDT; void eventSpan; void pad;
