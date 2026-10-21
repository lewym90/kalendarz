// Arkusze: szybkie dodawanie, edytor wydarzenia i zadania, reguły, kategorie, szukanie, miasto.
import { record, transcribe, loadModel, modelReady, canRecord } from './voice.js';
import {
  $, $$, esc, ymd, parseYmd, parseDT, fmtDT, fmtTime, pad, addDays, addMinutes, startOfDay, relDay, fmtDayLong, fmtDayMid, fmtDuration, fmtReminder, ICON, haptic, uid, debounce, DAYS_LETTER, MONTHS_GEN, DAYS_SHORT,
} from './util.js';
import {
  state, save, catOf, newEvent, addEvent, updateEvent, deleteEvent, deleteOccurrence, detachOccurrence, splitSeries, deleteFollowing, batch, newTask, addTask, updateTask, deleteTask, undo, topHistory, effectiveReminders, applyCreationRules, describeRule as describeRuleDef, CAT_PALETTE,
} from './store.js';
import { parse, parseMulti, toEventFields, norm } from './nlp.js';
import { instancesInRange, describeRule, eventSpan } from './recur.js';
import { openSheet, closeSheet, toast, rerender, confirmSheet, nav } from './ui.js';
import { searchCity } from './weather.js';

const REMIND_OPTS = [0, 5, 10, 15, 30, 60, 120, 1440, 2880];
export const shortRemind = (m) => (m === 0 ? 'o starcie' : m < 60 ? `${m} min` : m < 1440 ? `${m / 60} godz.` : m === 1440 ? '1 dzień' : `${m / 1440} dni`);

export function whenLabel(inst, now = new Date()) {
  const day = relDay(inst.start, now);
  if (inst.allDay) return `${day}, całodniowe`;
  return `${day}, ${fmtTime(inst.start)}–${fmtTime(inst.end)}`;
}

const catDots = (selected, attr = 'data-cat') =>
  state.cats.map((c) => `<button type="button" class="catdot ${c.id === selected ? 'on' : ''}" style="--c:${c.color}" ${attr}="${c.id}">${esc(c.name)}</button>`).join('');

const examples = [
  'jutro 17 siłownia',
  'co drugi wtorek 9:30 dentysta',
  'lunch z Anią w piątek o 13',
  'urodziny Ani 14 marca',
  'codziennie 7:00 tabletki',
  'zadanie: odpisać do piątku',
];

// ---------- Szybkie dodawanie ----------
export function openQuickAdd({ text = '', mode = 'event', ctxDate = null } = {}) {
  let kind = mode;
  let forced = mode === 'task' ? 'task' : null;
  let parsed = null;
  let parsedAll = [];
  let exIdx = Math.floor(Math.random() * examples.length);
  const hist = topHistory(7);
  const defaults = ['Lunch', 'Trening', 'Spotkanie', 'Zakupy'];
  const sug = hist.length ? hist.map((h) => h.title) : defaults;

  const h = openSheet(`
    <div class="grab"><i></i></div>
    <div class="sheet-b" style="padding-top:2px">
      <div class="qa-row">
        <div class="seg" role="tablist"><button type="button" data-k="event" class="${kind === 'event' ? 'on' : ''}">Wydarzenie</button><button type="button" data-k="task" class="${kind === 'task' ? 'on' : ''}">Zadanie</button></div>
        <button type="button" class="link" data-d="more">Więcej opcji</button>
      </div>
      <form id="qa-form" autocomplete="off" class="qa-wrap">
        <input id="qa" class="qa-input" type="text" enterkeyhint="done" autocapitalize="sentences" autocomplete="off" placeholder="${esc(examples[exIdx])}" value="${esc(text)}" aria-label="Opisz wydarzenie zdaniem">
        <button type="button" class="qa-mic" id="qa-mic" aria-label="Dyktuj głosem">${ICON.mic}</button>
      </form>
      <div class="mic-hint" id="qa-mic-hint" hidden></div>
      <div class="preview" id="qa-prev"></div>
      <div class="lbl">Ostatnio dodawane</div>
      <div class="chips scroll" id="qa-sug">${sug.map((s) => `<button type="button" class="chip" data-s="${esc(s)}">${esc(s)}</button>`).join('')}</div>
    </div>
    <div class="sheet-f"><button type="button" class="btn primary" id="qa-add" disabled>Dodaj</button></div>`);

  const el = h.el;
  const input = $('#qa', el);
  const prev = $('#qa-prev', el);
  const addBtn = $('#qa-add', el);

  const run = () => {
    const all = parseMulti(input.value, { now: new Date(), cats: state.cats, mode: forced || 'event', force: !!forced, history: state.history });
    const p = all[0];
    for (const q of all) fixCtx(q);
    parsedAll = all;
    if (!forced && p.kind !== kind) { kind = p.kind; syncSeg(); }
    parsed = p;
    addBtn.disabled = !all.some((x) => x.title);
    addBtn.textContent = all.length > 1 ? `Dodaj ${all.length}` : 'Dodaj';
    renderPreview(p);
  };

  const fixCtx = (p) => {
    if (ctxDate && !p.date && !p.rrule) {
      p.date = ymd(ctxDate);
      if (p.kind === 'event' && !p.time) {
        const today = ymd(new Date()) === p.date;
        const t = today ? new Date(Date.now() + 3600000) : null;
        p.time = today ? `${pad(t.getHours())}:00` : '09:00';
        p.allDay = false;
      }
    }
  };

  const syncSeg = () => $$('.seg button', el).forEach((b) => b.classList.toggle('on', b.dataset.k === kind));

  const buildFields = (p) => {
    const f = toEventFields(p);
    const ev = newEvent({ title: f.title, start: f.start, end: f.end, allDay: f.allDay, cat: p.cat || 'inne', loc: f.loc, rrule: f.rrule, reminders: p.remind ?? (f.allDay ? [0] : [...state.settings.defaultRemind]), bday: !!f.bday, byear: f.byear || null });
    return ev;
  };

  const renderPreview = (p) => {
    if (!input.value.trim()) {
      prev.innerHTML = `<div class="hint">Wpisz jedno zdanie, a resztę zrobię sam. Na przykład:
        <div class="chips" style="margin-top:10px">${examples.slice(0, 3).map((x) => `<button type="button" class="chip" data-ex="${esc(x)}">${esc(x)}</button>`).join('')}</div>
        <div style="margin-top:10px">Dodatki: <b>@miejsce</b>, <b>#kategoria</b>, <b>przypomnij 30 min wcześniej</b>.</div></div>`;
      return;
    }
    if (parsedAll.length > 1) {
      prev.innerHTML = `<div class="pt">${parsedAll.length} pozycje w jednym zdaniu</div>` + parsedAll.map((q) => {
        const when = q.kind === 'task' ? (q.date ? relDay(parseYmd(q.date)) : 'bez terminu') : (() => { const e2 = buildFields(q); const s2 = parseDT(e2.start); return `${relDay(s2)}${e2.allDay ? ', cały dzień' : ', ' + fmtTime(s2)}`; })();
        const c2 = catOf(q.cat || 'inne');
        return `<div class="chips" style="margin:6px 0"><span class="chip c pop" style="--c:${c2.color}">${esc(c2.name)}</span><span class="chip pop"><b style="font-weight:700">${esc(q.title || '…')}</b></span><span class="chip pop"><span class="ico">${ICON.cal}</span>${esc(when)}</span>${q.loc ? `<span class="chip pop"><span class="ico">${ICON.pin}</span>${esc(q.loc)}</span>` : ''}</div>`;
      }).join('');
      return;
    }
    const chips = [];
    if (p.kind === 'task') {
      chips.push(`<span class="chip pop"><span class="ico">${ICON.flag}</span>${p.date ? relDay(parseYmd(p.date)) : 'Bez terminu'}${p.time ? ', ' + p.time : ''}</span>`);
    } else {
      const ev = buildFields(p);
      const s = parseDT(ev.start);
      const e = parseDT(ev.end);
      const noInfo = !p.date && !p.time && !p.rrule;
      chips.push(`<span class="chip pop ${noInfo ? 'ghost' : ''}"><span class="ico">${ICON.cal}</span>${relDay(s)}${ev.allDay ? ', cały dzień' : `, ${fmtTime(s)}–${fmtTime(e)}`}${noInfo ? ' (domyślnie)' : ''}</span>`);
      if (!ev.allDay && !p.durDefault) chips.push(`<span class="chip pop"><span class="ico">${ICON.clock}</span>${fmtDuration((e - s) / 60000)}</span>`);
      if (ev.rrule) chips.push(`<span class="chip pop"><span class="ico">${ICON.repeat}</span>${esc(describeRule(ev.rrule, s))}</span>`);
      if (ev.loc) chips.push(`<span class="chip pop"><span class="ico">${ICON.pin}</span>${esc(ev.loc)}</span>`);
      if (ev.bday) chips.push(`<span class="chip pop"><span class="ico">${ICON.sparkle}</span>Urodziny${ev.byear ? ', rocznik ' + ev.byear : ''}</span>`);
      const rem = effectiveReminders(ev).all;
      if (rem.length) chips.push(`<span class="chip pop"><span class="ico">${ICON.bell}</span>${rem.map(shortRemind).join(', ')}</span>`);
      if (noInfo) chips.push('<button type="button" class="chip ghost" data-k="task">Dodać jako zadanie?</button>');
    }
    const c = catOf(p.cat || 'inne');
    chips.splice(1, 0, `<span class="chip c pop" style="--c:${c.color}">${esc(c.name)}</span>`);
    prev.innerHTML = `<div class="pt">${p.title ? esc(p.title) : '<span style="color:var(--text3)">Dopisz nazwę</span>'}</div><div class="chips">${chips.join('')}</div>`;
  };

  const submit = () => {
    const list = parsedAll.filter((x) => x.title);
    if (!list.length) return;
    haptic();
    let lastMsg = '';
    batch(() => { for (const p of list) {
      if (p.kind === 'task' || (kind === 'task' && list.length === 1)) {
        const t = newTask({ title: p.title, due: p.date || null, dueTime: p.time || null, cat: p.cat || 'inne' });
        addTask(t);
        lastMsg = `Dodano zadanie: ${t.title}`;
      } else {
        const ev = buildFields(p);
        applyCreationRules(ev);
        addEvent(ev);
        const inst = instancesInRange([ev], startOfDay(parseDT(ev.start)), addDays(startOfDay(parseDT(ev.start)), 2))[0];
        lastMsg = `Dodano: ${ev.title}, ${inst ? whenLabel(inst).toLowerCase() : ''}`;
      }
    } });
    toast(list.length > 1 ? `Dodano ${list.length} pozycje` : lastMsg, { action: 'Cofnij', onAction: () => { undo(); rerender(); } });
    closeSheet(h);
    rerender();
  };


  // --- Głos: nagranie + rozpoznawanie w aplikacji (Whisper); Web Speech tylko w zwykłej przeglądarce
  const micBtn = $('#qa-mic', el);
  const micHint = $('#qa-mic-hint', el);
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const standalone = window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
  let rec = null;
  let listening = false;
  let recSession = null;
  const hint = (msg) => { micHint.hidden = !msg; micHint.textContent = msg || ''; };
  const setListening = (on) => { listening = on; micBtn.classList.toggle('on', on); micBtn.setAttribute('aria-pressed', on ? 'true' : 'false'); };
  const kbFallback = (why) => {
    setListening(false);
    hint(why || 'Dotknij mikrofonu na klawiaturze iPhone’a i mów — zdanie pojawi się samo.');
    input.focus();
  };
  const putText = (t) => {
    const base = input.value.trim();
    input.value = (base ? base + ' ' : '') + t;
    run();
  };
  const startWhisper = async () => {
    haptic();
    const first = !modelReady();
    let pct = 0;
    let phase = 'listen';
    const status = () => {
      if (phase === 'listen') hint(first ? `Słucham… (jednorazowo pobieram model głosu: ${pct}%)` : 'Słucham… powiedz zdanie.');
      else if (phase === 'think') hint(pct < 100 && first ? `Pobieram model głosu: ${pct}% (jednorazowo, potem działa offline)` : 'Rozpoznaję…');
    };
    let ready;
    try {
      recSession = await record({ onLevel: (l) => micBtn.style.setProperty('--lvl', Math.min(1, l * 3).toFixed(2)) });
    } catch (e) {
      recSession = null;
      return kbFallback(e && e.name === 'NotAllowedError' ? 'Brak zgody na mikrofon. Zezwól w Ustawieniach iPhone’a albo użyj mikrofonu klawiatury.' : undefined);
    }
    setListening(true);
    status();
    ready = loadModel((v) => { pct = v; status(); });
    ready.catch(() => {});
    input.blur();
    const sess = recSession;
    try {
      const { pcm, heard } = await sess.done;
      setListening(false);
      micBtn.style.removeProperty('--lvl');
      recSession = null;
      if (!heard) { hint('Nic nie usłyszałem — dotknij mikrofonu i spróbuj jeszcze raz.'); return; }
      phase = 'think';
      pct = first ? pct : 100;
      status();
      const text = await transcribe(pcm);
      if (!text) { hint('Nie udało się rozpoznać mowy — spróbuj jeszcze raz.'); return; }
      putText(text);
      hint('Sprawdź podgląd i dotknij „Dodaj”.');
    } catch (e) {
      setListening(false);
      recSession = null;
      kbFallback('Nie udało się uruchomić rozpoznawania (potrzebny internet przy pierwszym użyciu). Użyj mikrofonu klawiatury.');
    }
  };
  const startSR = () => {
    haptic();
    let started = false;
    let got = false;
    try {
      rec = new SR();
      rec.lang = 'pl-PL';
      rec.interimResults = true;
      rec.continuous = false;
    } catch { return startWhisper(); }
    const base = input.value.trim();
    const timer = setTimeout(() => { if (!started) { try { rec.abort(); } catch { /* */ } rec = null; startWhisper(); } }, 2500);
    rec.onstart = () => { started = true; clearTimeout(timer); setListening(true); hint('Słucham… powiedz zdanie.'); input.blur(); };
    rec.onresult = (e) => {
      let t = '';
      for (let i = 0; i < e.results.length; i++) t += e.results[i][0].transcript;
      got = true;
      input.value = (base ? base + ' ' : '') + t.trim();
      run();
    };
    rec.onerror = (e) => { clearTimeout(timer); if (started) { setListening(false); hint('Nic nie usłyszałem — spróbuj jeszcze raz.'); } else if (e.error !== 'aborted') { rec = null; startWhisper(); } };
    rec.onend = () => { clearTimeout(timer); if (started) { setListening(false); hint(got ? 'Sprawdź podgląd i dotknij „Dodaj”.' : 'Nic nie usłyszałem — spróbuj jeszcze raz.'); } rec = null; };
    try { rec.start(); } catch { clearTimeout(timer); startWhisper(); }
  };
  micBtn.addEventListener('click', () => {
    if (recSession) { recSession.stop(); return; }
    if (listening && rec) { try { rec.stop(); } catch { /* */ } return; }
    if (SR && !standalone) startSR();
    else if (canRecord()) startWhisper();
    else kbFallback();
  });
  if (canRecord() && modelReady() && !(SR && !standalone)) setTimeout(() => loadModel().catch(() => {}), 600);
  input.addEventListener('input', () => hint(''));
  input.addEventListener('input', run);
  $('#qa-form', el).addEventListener('submit', (e) => { e.preventDefault(); submit(); });
  addBtn.addEventListener('click', submit);
  el.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.k) { kind = t.dataset.k; forced = kind; syncSeg(); run(); haptic(); }
    else if (t.dataset.s) {
      input.value = t.dataset.s;
      run();
      input.focus();
    } else if (t.dataset.ex) {
      input.value = t.dataset.ex;
      run();
      input.focus();
    } else if (t.dataset.d === 'more') {
      closeSheet(h);
      if (kind === 'task') openTaskEditor({ draft: { title: parsed?.title || input.value, due: parsed?.date || null, cat: parsed?.cat || 'inne' } });
      else {
        const base = parsed && parsed.title ? buildFields(parsed) : null;
        openEventEditor({ draft: base ? { ...base } : ctxDate ? defaultDraftFor(ctxDate) : null });
      }
    }
  });
  const cycle = setInterval(() => {
    if (h.closed) return clearInterval(cycle);
    if (input.value) return;
    exIdx = (exIdx + 1) % examples.length;
    input.placeholder = examples[exIdx];
  }, 2600);

  run();
  setTimeout(() => input.focus(), 60);
  return h;
}

export function defaultDraftFor(date, hour) {
  const d = startOfDay(date);
  const now = new Date();
  const h = hour != null ? hour : ymd(d) === ymd(now) ? Math.min(23, now.getHours() + 1) : 9;
  const s = new Date(d.getFullYear(), d.getMonth(), d.getDate(), Math.floor(h), Math.round((h % 1) * 60));
  return { start: fmtDT(s), end: fmtDT(addMinutes(s, 60)) };
}

// ---------- Edytor wydarzenia ----------
export function openEventEditor({ inst = null, ev = null, draft = null } = {}) {
  const existing = inst ? inst.ev : ev;
  let base;
  let s;
  let e;
  if (existing) {
    base = structuredClone(existing);
    if (inst) { s = new Date(inst.start); e = new Date(inst.end); } else { ({ s, e } = eventSpan(existing)); }
  } else {
    base = newEvent(draft || {});
    ({ s, e } = eventSpan(base));
  }
  const d = {
    title: base.title,
    allDay: !!base.allDay,
    s, e,
    cat: base.cat,
    loc: base.loc || '',
    notes: base.notes || '',
    rrule: base.rrule ? structuredClone(base.rrule) : null,
    reminders: [...(base.reminders || [])],
    scope: 'series',
    bday: !!base.bday,
    byear: base.byear || null,
    priv: !!base.private,
  };
  const recurringExisting = !!(existing && existing.rrule);
  const isNew = !existing;

  const dateVal = (x) => ymd(x);
  const timeVal = (x) => `${pad(x.getHours())}:${pad(x.getMinutes())}`;
  const showDates = () => !recurringExisting || d.scope === 'one';
  const scopeTxt = { one: 'Zmiany dotyczą tylko tego dnia', following: 'Zmiany obejmą ten dzień i kolejne', series: 'Zmiany obejmą całą serię' };

  const freqChip = (f, label) => `<button type="button" class="chip ${(d.rrule ? d.rrule.freq : 'none') === f ? 'on' : ''}" data-f="${f}">${label}</button>`;

  const body = () => {
    const eff = effectiveReminders({ ...base, ...d, start: fmtDT(d.s), end: fmtDT(d.e), reminders: d.reminders });
    const viaRules = eff.viaRules;
    const dow = [1, 2, 3, 4, 5, 6, 0];
    const byday = d.rrule?.byday?.length ? d.rrule.byday : d.rrule?.freq === 'weekly' ? [d.s.getDay()] : [];
    return `
      <input id="e-title" class="title-in" type="text" placeholder="Nazwa wydarzenia" value="${esc(d.title)}" autocapitalize="sentences" autocomplete="off">
      ${recurringExisting ? `<div class="field" style="flex-wrap:wrap"><span class="ico">${ICON.repeat}</span><div class="grow"><b style="font-weight:600">Wystąpienie: ${esc(fmtDayMid(inst ? inst.start : d.s))}</b><div style="font-size:13px;color:var(--text2)">${scopeTxt[d.scope]}</div></div><div class="seg" style="width:100%;margin-top:10px">${[['one', 'Tylko ten'], ['following', 'Ten i kolejne'], ['series', 'Cała seria']].map(([k, l]) => `<button type="button" class="${d.scope === k ? 'on' : ''}" data-scope="${k}">${l}</button>`).join('')}</div></div>` : ''}
      <div class="field"><label class="grow" for="e-allday">Cały dzień</label><button type="button" id="e-allday" class="switch ${d.allDay ? 'on' : ''}" role="switch" aria-checked="${d.allDay}" data-t="allday"></button></div>
      ${showDates() ? `
      <div class="field"><span class="ico">${ICON.clock}</span><label class="grow">Początek</label><input type="date" id="e-sd" value="${dateVal(d.s)}">${d.allDay ? '' : `<input type="time" id="e-st" value="${timeVal(d.s)}" style="max-width:96px">`}</div>
      <div class="field"><span class="ico"></span><label class="grow">Koniec</label><input type="date" id="e-ed" value="${dateVal(d.e)}">${d.allDay ? '' : `<input type="time" id="e-et" value="${timeVal(d.e)}" style="max-width:96px">`}</div>` : (d.allDay ? '' : `
      <div class="field"><span class="ico">${ICON.clock}</span><label class="grow">Godzina</label><input type="time" id="e-st" value="${timeVal(d.s)}" style="max-width:96px"><span style="color:var(--text3)">do</span><input type="time" id="e-et" value="${timeVal(d.e)}" style="max-width:96px"></div>`)}
      <div class="lbl">Kategoria</div>
      <div class="catrow">${catDots(d.cat)}</div>
      <div class="lbl">Miejsce</div>
      <div class="field"><span class="ico">${ICON.pin}</span><input id="e-loc" type="text" placeholder="Dodaj miejsce" value="${esc(d.loc)}" autocomplete="off"></div>
      <div class="lbl">Powtarzanie</div>
      <div class="chips">${freqChip('none', 'Nie')}${freqChip('daily', 'Codziennie')}${freqChip('weekly', 'Co tydzień')}${freqChip('monthly', 'Co miesiąc')}${freqChip('yearly', 'Co rok')}</div>
      ${d.rrule ? `
        <div class="field" style="margin-top:10px"><label class="grow">Co ile</label><input id="e-int" type="number" min="1" max="99" value="${d.rrule.interval || 1}" inputmode="numeric" style="max-width:70px;text-align:right"><span style="color:var(--text2)">${{ daily: 'dni', weekly: 'tyg.', monthly: 'mies.', yearly: 'lat' }[d.rrule.freq]}</span></div>
        ${d.rrule.freq === 'weekly' ? `<div class="dayrow" style="margin-bottom:8px">${dow.map((x) => `<button type="button" class="${byday.includes(x) ? 'on' : ''}" data-dow="${x}">${DAYS_SHORT[x] === 'ndz' ? 'nd' : DAYS_SHORT[x]}</button>`).join('')}</div>` : ''}
        <div class="field"><label class="grow">Do dnia (opcjonalnie)</label><input id="e-until" type="date" value="${d.rrule.until || ''}"></div>` : ''}
      <div class="field" style="margin-top:12px"><span class="ico">${ICON.sparkle}</span><label class="grow">To urodziny<small style="display:block;color:var(--text2);font-size:12.5px">Co roku, z wiekiem w tytule</small></label><button type="button" class="switch ${d.bday ? 'on' : ''}" role="switch" aria-checked="${!!d.bday}" data-t="bday"></button></div>
      <div class="field"><span class="ico">${ICON.lock}</span><label class="grow">Prywatne<small style="display:block;color:var(--text2);font-size:12.5px">Druga osoba zobaczy tylko „Zajęte", bez tytułu</small></label><button type="button" class="switch ${d.priv ? 'on' : ''}" role="switch" aria-checked="${!!d.priv}" data-t="priv"></button></div>
      ${d.bday ? `<div class="field"><label class="grow">Rok urodzenia (opcjonalnie)</label><input id="e-byear" type="number" inputmode="numeric" min="1900" max="2100" placeholder="np. 1990" value="${d.byear || ''}" style="max-width:100px;text-align:right"></div>` : ''}
      <div class="lbl">Przypomnienia</div>
      <div class="chips">${REMIND_OPTS.map((m) => `<button type="button" class="chip ${d.reminders.includes(m) ? 'on' : ''}" data-r="${m}">${m === 0 ? 'W chwili startu' : shortRemind(m)}</button>`).join('')}</div>
      ${viaRules.length ? `<div class="note" style="padding:8px 2px 0"><span class="ico" style="display:inline-flex;width:14px;height:14px;vertical-align:-2px;color:var(--a1)">${ICON.bolt}</span> Reguły dodają: ${viaRules.map((m) => fmtReminder(m).toLowerCase()).join(', ')}</div>` : ''}
      <div class="lbl">Notatki</div>
      <div class="field"><span class="ico">${ICON.note}</span><textarea id="e-notes" rows="2" placeholder="Dodaj notatkę">${esc(d.notes)}</textarea></div>`;
  };

  const h = openSheet(`
    <div class="grab"><i></i></div>
    <div class="sheet-h"><h3>${isNew ? 'Nowe wydarzenie' : 'Wydarzenie'}</h3><button type="button" class="round" data-x="close" aria-label="Zamknij"><span class="ico">${ICON.close}</span></button></div>
    <div class="sheet-b" id="e-body">${body()}</div>
    <div class="sheet-f">${isNew ? '' : '<button type="button" class="btn danger" id="e-del" style="flex:0 0 auto" aria-label="Usuń"><span class="ico">' + ICON.trash + '</span></button>'}<button type="button" class="btn primary" id="e-save">Zapisz</button></div>`);
  const el = h.el;
  const bodyEl = $('#e-body', el);

  const redraw = () => {
    const top = bodyEl.scrollTop;
    bodyEl.innerHTML = body();
    bodyEl.scrollTop = top;
  };

  const keepDuration = (newS) => {
    const dur = d.e - d.s;
    d.s = newS;
    d.e = new Date(newS.getTime() + dur);
  };
  const dtOf = (dateStr, timeStr, fallback) => {
    if (!dateStr) return fallback;
    const [y, m, dd] = dateStr.split('-').map(Number);
    const [hh, mm] = (timeStr || '00:00').split(':').map(Number);
    return new Date(y, m - 1, dd, hh, mm);
  };

  // Pola daty/godziny nie mogą być odtwarzane podczas wybierania (iOS zamyka wtedy okienko). Aktualizujemy je „w miejscu”,
  // a pełne odświeżenie formularza robimy dopiero po zamknięciu okienka.
  let dtDirty = false;
  const putVal = (id, v) => { const x = $(id, el); if (x && x.value !== v) x.value = v; };
  const dtSoft = () => {
    dtDirty = true;
    putVal('#e-sd', dateVal(d.s)); putVal('#e-ed', dateVal(d.e));
    if (!d.allDay) { putVal('#e-st', timeVal(d.s)); putVal('#e-et', timeVal(d.e)); }
  };
  el.addEventListener('focusout', (ev2) => {
    if (!dtDirty || !/^(date|time)$/.test(ev2.target.type || '')) return;
    setTimeout(() => {
      const ae = document.activeElement;
      if (ae && /^(date|time)$/.test(ae.type || '') && el.contains(ae)) return;
      if (!dtDirty) return;
      dtDirty = false; redraw();
    }, 350);
  });

  el.addEventListener('input', (ev2) => {
    const t = ev2.target;
    if (t.id === 'e-title') d.title = t.value;
    else if (t.id === 'e-loc') d.loc = t.value;
    else if (t.id === 'e-notes') d.notes = t.value;
    else if (t.id === 'e-byear') d.byear = parseInt(t.value, 10) || null;
    else if (t.id === 'e-int') d.rrule.interval = Math.max(1, parseInt(t.value || '1', 10) || 1);
  });
  el.addEventListener('change', (ev2) => {
    const t = ev2.target;
    if ((t.id === 'e-st' || t.id === 'e-et') && !showDates()) return; // obsłuży to kolejny nasłuch (tryb serii)
    if (t.id === 'e-sd' || t.id === 'e-st') {
      const ns = dtOf($('#e-sd', el)?.value, $('#e-st', el)?.value || '00:00', d.s);
      keepDuration(d.allDay ? startOfDay(ns) : ns);
      if (d.allDay) d.e = new Date(d.e.getFullYear(), d.e.getMonth(), d.e.getDate(), 23, 59);
      dtSoft();
    } else if (t.id === 'e-ed' || t.id === 'e-et') {
      let ne = dtOf($('#e-ed', el)?.value || ymd(d.e), $('#e-et', el)?.value || timeVal(d.e), d.e);
      if (!showDates()) ne = new Date(d.s.getFullYear(), d.s.getMonth(), d.s.getDate(), ne.getHours(), ne.getMinutes());
      if (d.allDay) ne = new Date(ne.getFullYear(), ne.getMonth(), ne.getDate(), 23, 59);
      if (ne <= d.s) ne = d.allDay ? new Date(d.s.getFullYear(), d.s.getMonth(), d.s.getDate(), 23, 59) : addMinutes(d.s, 30);
      d.e = ne;
      dtSoft();
    } else if (t.id === 'e-until') {
      d.rrule.until = t.value || null;
    }
  });
  // Dla trybu serii pola godzin nie mają dat — obsłuż zmianę godzin osobno.
  el.addEventListener('change', (ev2) => {
    const t = ev2.target;
    if ((t.id === 'e-st' || t.id === 'e-et') && !showDates()) {
      const st = $('#e-st', el)?.value || timeVal(d.s);
      const et = $('#e-et', el)?.value || timeVal(d.e);
      const day = new Date(d.s.getFullYear(), d.s.getMonth(), d.s.getDate());
      const [sh, sm] = st.split(':').map(Number);
      const [eh, em] = et.split(':').map(Number);
      d.s = new Date(day.getFullYear(), day.getMonth(), day.getDate(), sh, sm);
      let ne = new Date(day.getFullYear(), day.getMonth(), day.getDate(), eh, em);
      if (ne <= d.s) ne = addMinutes(d.s, 30);
      d.e = ne;
      dtSoft();
    }
  });

  el.addEventListener('click', async (ev2) => {
    const t = ev2.target.closest('button');
    if (!t) return;
    if (t.dataset.x === 'close') return closeSheet(h);
    if (t.dataset.t === 'allday') {
      d.allDay = !d.allDay;
      if (d.allDay) { d.s = startOfDay(d.s); d.e = new Date(d.e.getFullYear(), d.e.getMonth(), d.e.getDate(), 23, 59); if (!d.reminders.length) d.reminders = [0]; } else {
        const now = new Date();
        d.s = new Date(d.s.getFullYear(), d.s.getMonth(), d.s.getDate(), Math.min(23, now.getHours() + 1), 0);
        d.e = addMinutes(d.s, 60);
      }
      haptic();
      return redraw();
    }
    if (t.dataset.t === 'priv') { d.priv = !d.priv; haptic(); redraw(); return; }
    if (t.dataset.t === 'bday') {
      d.bday = !d.bday;
      if (d.bday) {
        d.allDay = true; d.s = startOfDay(d.s); d.e = new Date(d.s.getFullYear(), d.s.getMonth(), d.s.getDate(), 23, 59);
        d.rrule = { freq: 'yearly', interval: 1, byday: [], until: null };
        if (d.cat === 'inne') d.cat = 'rodzina';
        if (!d.reminders.length) d.reminders = [0, 1440];
      }
      haptic();
      return redraw();
    }
    if (t.dataset.cat) { d.cat = t.dataset.cat; haptic(); return redraw(); }
    if (t.dataset.f) {
      const f = t.dataset.f;
      d.rrule = f === 'none' ? null : { freq: f, interval: d.rrule?.interval || 1, byday: f === 'weekly' ? [d.s.getDay()] : [], until: d.rrule?.until || null };
      return redraw();
    }
    if (t.dataset.dow != null) {
      const x = +t.dataset.dow;
      const cur = new Set(d.rrule.byday?.length ? d.rrule.byday : [d.s.getDay()]);
      if (cur.has(x)) { if (cur.size > 1) cur.delete(x); } else cur.add(x);
      d.rrule.byday = [...cur];
      return redraw();
    }
    if (t.dataset.r != null) {
      const m = +t.dataset.r;
      d.reminders = d.reminders.includes(m) ? d.reminders.filter((x) => x !== m) : [...d.reminders, m].sort((a, b) => a - b);
      return redraw();
    }
    if (t.dataset.scope) { d.scope = t.dataset.scope; return redraw(); }
    if (t.id === 'e-del') {
      if (recurringExisting && inst) {
        const ans = await confirmSheet({ title: 'Usunąć wydarzenie cykliczne?', text: 'Wybierz, co usunąć.', confirmLabel: 'Usuń całą serię', extra: 'Tylko ten dzień', extras: [{ id: 'following', label: 'Ten dzień i kolejne' }] });
        if (ans === 'extra') deleteOccurrence(existing.id, inst.date);
        else if (ans === 'following') deleteFollowing(inst);
        else if (ans === 'yes') deleteEvent(existing.id);
        else return;
      } else deleteEvent(existing.id);
      closeSheet(h);
      rerender();
      toast('Usunięto wydarzenie', { action: 'Cofnij', onAction: () => { undo(); rerender(); } });
      return;
    }
    if (t.id === 'e-save') {
      if (!d.title.trim()) {
        const ti = $('#e-title', el);
        ti.focus();
        ti.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }, { transform: 'translateX(0)' }], { duration: 240 });
        return;
      }
      const common = { title: d.title.trim(), cat: d.cat, loc: d.loc.trim(), notes: d.notes.trim(), reminders: [...new Set(d.reminders)].sort((a, b) => a - b), allDay: d.allDay, private: !!d.priv, bday: !!d.bday, byear: d.bday ? d.byear || null : null };
      const rr = d.rrule ? { ...d.rrule, byday: d.rrule.freq === 'weekly' ? (d.rrule.byday?.length ? d.rrule.byday : [d.s.getDay()]) : [], until: d.rrule.until || null } : null;
      if (isNew) {
        const evn = newEvent({ ...common, start: fmtDT(d.s), end: fmtDT(d.e), rrule: rr });
        addEvent(evn);
      } else if (!recurringExisting) {
        const p = { ...common, start: fmtDT(d.s), end: fmtDT(d.e), rrule: rr };
        applyCreationRules(p);
        updateEvent(existing.id, p);
      } else if (d.scope === 'one') {
        detachOccurrence(inst, { ...common, start: fmtDT(d.s), end: fmtDT(d.e), rrule: null });
      } else if (d.scope === 'following') {
        const dur = d.e - d.s;
        const day = parseYmd(inst.date);
        const ns = new Date(day.getFullYear(), day.getMonth(), day.getDate(), d.s.getHours(), d.s.getMinutes());
        splitSeries(inst, { ...common, start: fmtDT(d.allDay ? startOfDay(ns) : ns), end: fmtDT(d.allDay ? new Date(ns.getFullYear(), ns.getMonth(), ns.getDate(), 23, 59) : new Date(ns.getTime() + dur)), rrule: rr });
      } else {
        const anchor = parseDT(existing.start);
        const dur = d.e - d.s;
        const ns = rr ? new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate(), d.s.getHours(), d.s.getMinutes()) : new Date(d.s);
        updateEvent(existing.id, { ...common, start: fmtDT(d.allDay ? startOfDay(ns) : ns), end: fmtDT(d.allDay ? new Date(ns.getFullYear(), ns.getMonth(), ns.getDate(), 23, 59) : new Date(ns.getTime() + dur)), rrule: rr });
      }
      haptic();
      closeSheet(h);
      rerender();
      toast(isNew ? 'Dodano wydarzenie' : 'Zapisano zmiany', { action: 'Cofnij', onAction: () => { undo(); rerender(); } });
    }
  });
  if (isNew) setTimeout(() => $('#e-title', el)?.focus(), 80);
  return h;
}

// ---------- Edytor zadania ----------
export function openTaskEditor({ id = null, draft = null } = {}) {
  const existing = id ? state.tasks.find((t) => t.id === id) : null;
  const d = existing ? { ...existing } : { title: '', due: null, dueTime: null, cat: 'inne', prio: 0, ...(draft || {}) };
  const today = startOfDay(new Date());
  const quick = (n) => ymd(addDays(today, n));

  const body = () => `
    <input id="t-title" class="title-in" type="text" placeholder="Co trzeba zrobić?" value="${esc(d.title)}" autocomplete="off" autocapitalize="sentences">
    <div class="lbl">Termin</div>
    <div class="chips">
      <button type="button" class="chip ${d.due === quick(0) ? 'on' : ''}" data-due="${quick(0)}">Dziś</button>
      <button type="button" class="chip ${d.due === quick(1) ? 'on' : ''}" data-due="${quick(1)}">Jutro</button>
      <button type="button" class="chip ${d.due === quick(7) ? 'on' : ''}" data-due="${quick(7)}">Za tydzień</button>
      <button type="button" class="chip ${!d.due ? 'on' : ''}" data-due="">Bez terminu</button>
    </div>
    <div class="field" style="margin-top:10px"><span class="ico">${ICON.cal}</span><label class="grow">Data</label><input type="date" id="t-due" value="${d.due || ''}"></div>
    ${d.due ? `<div class="field"><span class="ico">${ICON.bell}</span><label class="grow">Przypomnij o</label><input type="time" id="t-time" value="${d.dueTime || ''}" style="max-width:110px"></div>` : ''}
    <div class="lbl">Kategoria</div>
    <div class="catrow">${catDots(d.cat)}</div>
    <div class="lbl">Ważność</div>
    <div class="chips">${['Zwykłe', 'Ważne', 'Pilne'].map((l, i) => `<button type="button" class="chip ${d.prio === i ? 'on' : ''}" data-p="${i}">${l}</button>`).join('')}</div>`;

  const h = openSheet(`
    <div class="grab"><i></i></div>
    <div class="sheet-h"><h3>${existing ? 'Zadanie' : 'Nowe zadanie'}</h3><button type="button" class="round" data-x="close" aria-label="Zamknij"><span class="ico">${ICON.close}</span></button></div>
    <div class="sheet-b" id="t-body">${body()}</div>
    <div class="sheet-f">${existing ? '<button type="button" class="btn danger" id="t-del" style="flex:0 0 auto" aria-label="Usuń"><span class="ico">' + ICON.trash + '</span></button>' : ''}<button type="button" class="btn primary" id="t-save">Zapisz</button></div>`);
  const el = h.el;
  const bodyEl = $('#t-body', el);
  const redraw = () => { const top = bodyEl.scrollTop; bodyEl.innerHTML = body(); bodyEl.scrollTop = top; };
  let dueDirty = false;
  el.addEventListener('input', (e) => { if (e.target.id === 't-title') d.title = e.target.value; });
  el.addEventListener('change', (e) => {
    if (e.target.id === 't-due') { d.due = e.target.value || null; dueDirty = true; }
    if (e.target.id === 't-time') d.dueTime = e.target.value || null;
  });
  el.addEventListener('focusout', (e) => {
    if (!dueDirty || !/^(date|time)$/.test(e.target.type || '')) return;
    setTimeout(() => {
      const ae = document.activeElement;
      if (ae && /^(date|time)$/.test(ae.type || '') && el.contains(ae)) return;
      if (dueDirty) { dueDirty = false; redraw(); }
    }, 350);
  });
  el.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.x === 'close') return closeSheet(h);
    if (t.dataset.due != null) { d.due = t.dataset.due || null; if (!d.due) d.dueTime = null; haptic(); return redraw(); }
    if (t.dataset.cat) { d.cat = t.dataset.cat; return redraw(); }
    if (t.dataset.p != null) { d.prio = +t.dataset.p; return redraw(); }
    if (t.id === 't-del') { deleteTask(existing.id); closeSheet(h); rerender(); toast('Usunięto zadanie', { action: 'Cofnij', onAction: () => { undo(); rerender(); } }); return; }
    if (t.id === 't-save') {
      if (!d.title.trim()) { $('#t-title', el).focus(); return; }
      const fields = { title: d.title.trim(), due: d.due, dueTime: d.due ? d.dueTime || null : null, cat: d.cat, prio: d.prio };
      if (existing) updateTask(existing.id, fields);
      else addTask(newTask(fields));
      haptic();
      closeSheet(h);
      rerender();
    }
  });
  if (!existing) setTimeout(() => $('#t-title', el)?.focus(), 80);
  return h;
}

// ---------- Reguła automatyzacji ----------
export function openRuleEditor(id = null) {
  const existing = id ? state.rules.find((r) => r.id === id) : null;
  const d = existing ? structuredClone(existing) : { id: 'r-' + uid(), name: '', on: true, when: {}, then: { remind: [30] } };
  const remindOpts = [5, 10, 15, 30, 60, 120, 1440];
  const body = () => `
    <div class="lbl" style="margin-top:4px">Jeśli wydarzenie…</div>
    <div class="field"><label class="grow">ma kategorię</label><select id="r-cat"><option value="">dowolną</option>${state.cats.map((c) => `<option value="${c.id}" ${d.when.cat === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
    <div class="field"><label class="grow">ma wpisane miejsce</label><button type="button" class="switch ${d.when.hasLoc ? 'on' : ''}" data-t="hasLoc" role="switch" aria-checked="${!!d.when.hasLoc}"></button></div>
    <div class="field"><label class="grow">jest całodniowe</label><button type="button" class="switch ${d.when.allDay ? 'on' : ''}" data-t="allDay" role="switch" aria-checked="${!!d.when.allDay}"></button></div>
    <div class="field"><label class="grow">jest cykliczne</label><button type="button" class="switch ${d.when.recurring ? 'on' : ''}" data-t="recurring" role="switch" aria-checked="${!!d.when.recurring}"></button></div>
    <div class="field"><label>tytuł zawiera</label><input id="r-text" type="text" placeholder="np. spotkanie" value="${esc(d.when.text || '')}" style="text-align:right" autocomplete="off"></div>
    <div class="lbl">To…</div>
    <div class="lbl" style="margin-top:0;font-weight:500">Dodatkowe przypomnienie</div>
    <div class="chips"><button type="button" class="chip ${!d.then.remind ? 'on' : ''}" data-rm="">Brak</button>${remindOpts.map((m) => `<button type="button" class="chip ${d.then.remind?.includes(m) ? 'on' : ''}" data-rm="${m}">${shortRemind(m)} wcześniej</button>`).join('')}</div>
    <div class="field" style="margin-top:10px"><label class="grow">ustaw kategorię (gdy tytuł zawiera tekst)</label><select id="r-setcat"><option value="">bez zmiany</option>${state.cats.map((c) => `<option value="${c.id}" ${d.then.setCat === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>`;
  const h = openSheet(`
    <div class="grab"><i></i></div>
    <div class="sheet-h"><h3>${existing ? 'Reguła' : 'Nowa reguła'}</h3><button type="button" class="round" data-x="close" aria-label="Zamknij"><span class="ico">${ICON.close}</span></button></div>
    <div class="sheet-b" id="r-body">${body()}</div>
    <div class="sheet-f">${existing ? '<button type="button" class="btn danger" id="r-del" style="flex:0 0 auto" aria-label="Usuń"><span class="ico">' + ICON.trash + '</span></button>' : ''}<button type="button" class="btn primary" id="r-save">Zapisz</button></div>`);
  const el = h.el;
  const bodyEl = $('#r-body', el);
  const redraw = () => { const t = bodyEl.scrollTop; bodyEl.innerHTML = body(); bodyEl.scrollTop = t; };
  el.addEventListener('change', (e) => {
    const t = e.target;
    if (t.id === 'r-cat') d.when.cat = t.value || undefined;
    if (t.id === 'r-setcat') { if (t.value) d.then.setCat = t.value; else delete d.then.setCat; }
  });
  el.addEventListener('input', (e) => { if (e.target.id === 'r-text') d.when.text = e.target.value.trim() || undefined; });
  el.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.x === 'close') return closeSheet(h);
    if (t.dataset.t) { d.when[t.dataset.t] = d.when[t.dataset.t] ? undefined : true; haptic(); return redraw(); }
    if (t.dataset.rm != null) {
      if (t.dataset.rm === '') delete d.then.remind;
      else d.then.remind = [+t.dataset.rm];
      return redraw();
    }
    if (t.id === 'r-del') { state.rules = state.rules.filter((r) => r.id !== existing.id); save(); closeSheet(h); rerender(); return; }
    if (t.id === 'r-save') {
      Object.keys(d.when).forEach((k) => d.when[k] === undefined && delete d.when[k]);
      if (!d.then.remind && !d.then.setCat) { toast('Wybierz, co ma się stać'); return; }
      d.name = autoName(d);
      if (existing) Object.assign(state.rules.find((r) => r.id === existing.id), d);
      else state.rules.push(d);
      save();
      closeSheet(h);
      rerender();
    }
  });
  return h;
}

export function autoName(r) {
  const w = r.when || {};
  const cond = [];
  if (w.cat) cond.push(catOf(w.cat).name);
  if (w.hasLoc) cond.push('z miejscem');
  if (w.allDay) cond.push('całodniowe');
  if (w.recurring) cond.push('cykliczne');
  if (w.text) cond.push(`„${w.text}"`);
  const head = cond.length ? cond.join(', ') : 'Każde wydarzenie';
  const acts = [];
  if (r.then.remind) acts.push(`przypomnij ${shortRemind(r.then.remind[0])} wcześniej`);
  if (r.then.setCat) acts.push(`kategoria ${catOf(r.then.setCat).name}`);
  return `${head}: ${acts.join(', ')}`;
}

// ---------- Kategoria ----------
export function openCatEditor(id = null) {
  const existing = id ? state.cats.find((c) => c.id === id) : null;
  const d = existing ? { ...existing } : { id: 'c-' + uid(), name: '', color: CAT_PALETTE[state.cats.length % CAT_PALETTE.length] };
  const body = () => `
    <input id="c-name" class="title-in" type="text" placeholder="Nazwa kategorii" value="${esc(d.name)}" autocomplete="off">
    <div class="lbl">Kolor</div>
    <div class="catrow">${CAT_PALETTE.map((c) => `<button type="button" class="catdot ${d.color === c ? 'on' : ''}" style="--c:${c}" data-col="${c}" aria-label="Kolor ${c}">&nbsp;</button>`).join('')}</div>`;
  const h = openSheet(`
    <div class="grab"><i></i></div>
    <div class="sheet-h"><h3>${existing ? 'Kategoria' : 'Nowa kategoria'}</h3><button type="button" class="round" data-x="close" aria-label="Zamknij"><span class="ico">${ICON.close}</span></button></div>
    <div class="sheet-b" id="c-body">${body()}</div>
    <div class="sheet-f">${existing && existing.id !== 'inne' ? '<button type="button" class="btn danger" id="c-del" style="flex:0 0 auto" aria-label="Usuń"><span class="ico">' + ICON.trash + '</span></button>' : ''}<button type="button" class="btn primary" id="c-save">Zapisz</button></div>`);
  const el = h.el;
  el.addEventListener('input', (e) => { if (e.target.id === 'c-name') d.name = e.target.value; });
  el.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.x === 'close') return closeSheet(h);
    if (t.dataset.col) { d.color = t.dataset.col; $('#c-body', el).innerHTML = body(); return; }
    if (t.id === 'c-del') {
      state.events.forEach((ev) => { if (ev.cat === existing.id) ev.cat = 'inne'; });
      state.tasks.forEach((tk) => { if (tk.cat === existing.id) tk.cat = 'inne'; });
      state.cats = state.cats.filter((c) => c.id !== existing.id);
      save(); closeSheet(h); rerender(); return;
    }
    if (t.id === 'c-save') {
      if (!d.name.trim()) return $('#c-name', el).focus();
      d.name = d.name.trim();
      if (existing) Object.assign(state.cats.find((c) => c.id === existing.id), d);
      else state.cats.splice(Math.max(0, state.cats.length - 1), 0, d);
      save(); closeSheet(h); rerender();
    }
  });
  if (!existing) setTimeout(() => $('#c-name', el)?.focus(), 80);
  return h;
}

// ---------- Szukanie ----------
export function openSearch() {
  const h = openSheet(`
    <div class="grab"><i></i></div>
    <div class="sheet-b" style="padding-top:2px;min-height:50dvh">
      <div class="field" style="margin-top:6px"><span class="ico">${ICON.search}</span><input id="s-in" type="search" placeholder="Szukaj wydarzeń i zadań" autocomplete="off" enterkeyhint="search"></div>
      <div id="s-res"></div>
    </div>`);
  const el = h.el;
  const res = $('#s-res', el);
  const run = () => {
    const q = norm($('#s-in', el).value.trim());
    if (!q) { res.innerHTML = '<div class="empty">Wpisz fragment nazwy, miejsca albo notatki.</div>'; return; }
    const now = new Date();
    const evs = state.events
      .filter((e) => norm(`${e.title} ${e.loc} ${e.notes}`).includes(q))
      .map((e) => {
        const inst = instancesInRange([e], startOfDay(now), addDays(now, 400))[0];
        const { s, e: en } = eventSpan(e);
        return { e, inst, sort: inst ? inst.start : s };
      })
      .sort((a, b) => a.sort - b.sort)
      .slice(0, 25);
    const tasks = state.tasks.filter((t) => norm(t.title).includes(q)).slice(0, 15);
    let html = '';
    if (evs.length) {
      html += '<div class="lbl">Wydarzenia</div><div class="dlist" style="padding:0">';
      for (const { e, inst, sort } of evs) {
        const c = catOf(e.cat);
        html += `<button type="button" class="ev" style="--c:${c.color}" data-ev="${e.id}"><div class="t">${esc(e.title)}</div><div class="s"><span>${esc(fmtDayMid(sort))}${e.allDay ? '' : ', ' + fmtTime(sort)}</span>${e.rrule ? `<span>${esc(describeRule(e.rrule, sort))}</span>` : ''}${e.loc ? `<span>${esc(e.loc)}</span>` : ''}</div></button>`;
      }
      html += '</div>';
    }
    if (tasks.length) {
      html += '<div class="lbl">Zadania</div><div class="list" style="margin:0">';
      for (const t of tasks) html += `<button type="button" class="row" data-tk="${t.id}"><span class="rt"><b>${esc(t.title)}</b><small>${t.done ? 'Zrobione' : t.due ? esc(relDay(parseYmd(t.due))) : 'Bez terminu'}</small></span></button>`;
      html += '</div>';
    }
    res.innerHTML = html || '<div class="empty"><b>Nic nie znaleziono</b>Spróbuj innego fragmentu nazwy.</div>';
  };
  $('#s-in', el).addEventListener('input', debounce(run, 90));
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-ev],[data-tk]');
    if (!b) return;
    closeSheet(h);
    if (b.dataset.ev) {
      const ev = state.events.find((x) => x.id === b.dataset.ev);
      const inst = instancesInRange([ev], startOfDay(new Date()), addDays(new Date(), 400))[0];
      setTimeout(() => openEventEditor(inst ? { inst } : { ev }), 120);
    } else setTimeout(() => openTaskEditor({ id: b.dataset.tk }), 120);
  });
  run();
  setTimeout(() => $('#s-in', el).focus(), 80);
}

// ---------- Miasto do pogody ----------
export function openCitySheet(onPick) {
  const h = openSheet(`
    <div class="grab"><i></i></div>
    <div class="sheet-h"><h3>Miejscowość dla pogody</h3></div>
    <div class="sheet-b" style="min-height:40dvh">
      <div class="field"><span class="ico">${ICON.search}</span><input id="w-in" type="search" placeholder="np. Kraków" autocomplete="off" enterkeyhint="search"></div>
      <div id="w-res" class="list" style="margin:8px 0 0"></div>
    </div>`);
  const el = h.el;
  const go = debounce(async () => {
    const q = $('#w-in', el).value.trim();
    const res = $('#w-res', el);
    if (q.length < 2) { res.innerHTML = ''; return; }
    try {
      const list = await searchCity(q);
      res.innerHTML = list.length ? list.map((c, i) => `<button type="button" class="row" data-i="${i}"><span class="ico">${ICON.pin}</span><span class="rt"><b>${esc(c.name)}</b></span></button>`).join('') : '<div class="empty">Nie znaleziono takiej miejscowości.</div>';
      res._list = list;
    } catch (err) {
      res.innerHTML = '<div class="empty">Brak połączenia. Spróbuj ponownie, gdy będziesz online.</div>';
    }
  }, 300);
  $('#w-in', el).addEventListener('input', go);
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-i]');
    if (!b) return;
    const c = $('#w-res', el)._list[+b.dataset.i];
    state.settings.city = { name: c.name.split(',')[0], lat: c.lat, lon: c.lon };
    state.settings.autoLoc = false;
    save();
    closeSheet(h);
    onPick?.();
  });
  setTimeout(() => $('#w-in', el).focus(), 80);
}

export { describeRuleDef };
