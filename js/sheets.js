// Arkusze ustawień: kopia na serwerze, historia zmian, bufory czasowe, pamięć preferencji.
import { $, esc, ICON, haptic } from './util.js';
import { state, save, catOf, historyList, undoTo } from './store.js';
import { openSheet, closeSheet, toast, rerender } from './ui.js';
import { pushConfig } from './push.js';
import { backupOn, backupInfo, backupEnable, backupNow, backupOff, backupVersions, backupRestore } from './backup.js';
import { learned, addPref, removePref, toggleLearned } from './prefs.js';
import { glyphFor, glyphHtml } from './glyphs.js';

const head = (t) => `<div class="grab"><i></i></div><div class="sheet-h"><h3>${t}</h3><button type="button" class="round" data-x="close" aria-label="Zamknij"><span class="ico">${ICON.close}</span></button></div>`;
const fmtAt = (at) => new Date(at).toLocaleString('pl-PL', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export function openBackup() {
  const h = openSheet(`${head('Kopia na serwerze')}<div class="sheet-b" id="bk"></div>`);
  const el = $('#bk', h.el);
  const paint = (msg = '') => {
    const i = backupInfo();
    if (!pushConfig()) { el.innerHTML = '<p class="note p0">Najpierw połącz aplikację z serwerem.</p>'; return; }
    el.innerHTML = `
      ${backupOn() ? `<p class="note p0">Kopia zapisuje się sama po zmianach. Serwer trzyma najnowszą wersję z każdego z ostatnich 7 dni.</p>
        <div class="list"><div class="row"><span class="rt"><b>Ostatnia kopia</b><small>${i.at ? esc(fmtAt(i.at)) : 'jeszcze nie było'}</small></span><button type="button" class="btn small" data-b="now">Zapisz teraz</button></div></div>`
    : `<p class="note p0">Ustaw hasło. Dane zostaną zaszyfrowane w telefonie, a serwer przechowa tylko nieczytelny blok.</p>
        <div class="field"><input id="bk-p1" type="password" placeholder="Hasło do kopii (min. 6 znaków)" autocomplete="new-password"></div>
        <div class="field"><input id="bk-p2" type="password" placeholder="Powtórz hasło" autocomplete="new-password"></div>
        <p class="note warn p0"><b>Zapisz hasło w bezpiecznym miejscu.</b> Bez niego kopii nie da się odczytać i nikt jej nie odzyska.</p>
        <button type="button" class="btn primary block" data-b="on">Włącz kopię</button>`}
      <div class="lbl">Przywróć dane</div>
      <div class="field"><input id="bk-r" type="password" placeholder="Hasło do kopii" autocomplete="current-password"></div>
      <button type="button" class="btn block" data-b="list">Pokaż zapisane kopie</button>
      <div id="bk-list"></div>
      ${backupOn() ? '<button type="button" class="link off" data-b="off">Wyłącz automatyczną kopię</button>' : ''}
      ${msg ? `<p class="note warn p0">${esc(msg)}</p>` : ''}`;
  };
  paint();
  let keys = null;
  h.el.addEventListener('click', async (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.x) return closeSheet(h);
    const b = t.dataset.b;
    try {
      if (b === 'on') {
        const p = $('#bk-p1', el).value;
        if (p.length < 6) return paint('Hasło musi mieć co najmniej 6 znaków.');
        if (p !== $('#bk-p2', el).value) return paint('Hasła się różnią.');
        t.disabled = true; t.textContent = 'Zapisuję…';
        await backupEnable(p);
        toast('Kopia włączona'); paint(); rerender();
      } else if (b === 'now') { t.disabled = true; const ok = await backupNow(true); toast(ok ? 'Kopia zapisana' : backupInfo().err || 'Nie udało się'); paint(); rerender(); } else if (b === 'off') { backupOff(); paint(); rerender(); } else if (b === 'list') {
        t.disabled = true; t.textContent = 'Sprawdzam…';
        const r = await backupVersions($('#bk-r', el).value);
        keys = r.keys;
        t.disabled = false; t.textContent = 'Pokaż zapisane kopie';
        $('#bk-list', el).innerHTML = r.versions.length ? `<div class="list mt">${r.versions.map((at) => `<button type="button" class="row" data-at="${at}"><span class="rt"><b>${esc(fmtAt(at))}</b></span><span class="val">Przywróć</span></button>`).join('')}</div>` : '<p class="note p0">Nie ma kopii z tym hasłem.</p>';
      } else if (t.dataset.at) {
        t.disabled = true;
        await backupRestore(keys, +t.dataset.at);
        closeSheet(h); rerender(); toast('Dane przywrócone');
      }
    } catch (err) { paint(err.status === 404 ? 'Zaktualizuj serwer, żeby włączyć kopię.' : err.message || 'Nie udało się'); }
  });
}

export function openHistory() {
  const list = historyList();
  const h = openSheet(`${head('Historia zmian')}<div class="sheet-b">${list.length ? `<p class="note p0">Ostatnie zmiany z tej sesji. Dotknij, żeby wrócić do stanu sprzed zmiany.</p><div class="list mt">${list.map((x) => `<button type="button" class="row" data-s="${x.steps}"><span class="rt"><b>${esc(x.changes[0])}</b><small>${x.changes.length > 1 ? `i ${x.changes.length - 1} więcej · ` : ''}${new Date(x.at).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}</small></span><span class="val">Cofnij</span></button>`).join('')}</div>` : '<div class="empty"><b>Brak zmian</b>Tu pojawią się zmiany wprowadzone od otwarcia aplikacji.</div>'}</div>`);
  h.el.addEventListener('click', (e) => {
    if (e.target.closest('[data-x]')) return closeSheet(h);
    const b = e.target.closest('[data-s]');
    if (!b) return;
    undoTo(+b.dataset.s); haptic(); closeSheet(h); rerender(); toast('Cofnięto');
  });
}

export function openBuffers() {
  const OPT = [0, 5, 10, 15, 30, 45];
  const body = () => {
    const b = state.settings.buffer;
    const chips = (cur, attr) => OPT.map((m) => `<button type="button" class="chip ${cur === m ? 'on' : ''}" ${attr}="${m}">${m ? `${m} min` : 'Brak'}</button>`).join('');
    return `<p class="note p0">Margines przed i po wydarzeniu na dojazd, przygotowanie albo przerwę. Uwzględnia go szukanie wolnych terminów, asystent i ostrzeżenia przy dodawaniu.</p>
      <div class="lbl">Domyślnie</div><div class="chips">${chips(b.def || 0, 'data-d')}</div>
      <div class="lbl">Dla kategorii</div>
      <div class="list mt">${state.cats.map((c) => `<div class="row col">${''}<span class="rt rowh">${glyphHtml(glyphFor({ cat: c.id }), 'xs')}<b>${esc(c.name)}</b></span><div class="chips"><button type="button" class="chip ${b.cats[c.id] == null ? 'on' : ''}" data-c="${c.id}" data-m="">Domyślny</button>${OPT.map((m) => `<button type="button" class="chip ${b.cats[c.id] === m ? 'on' : ''}" data-c="${c.id}" data-m="${m}">${m} min</button>`).join('')}</div></div>`).join('')}</div>`;
  };
  const h = openSheet(`${head('Bufory czasowe')}<div class="sheet-b" id="bf">${body()}</div>`);
  const el = $('#bf', h.el);
  h.el.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.x) return closeSheet(h);
    const b = state.settings.buffer;
    if (t.dataset.d != null) b.def = +t.dataset.d;
    else if (t.dataset.c) { if (t.dataset.m === '') delete b.cats[t.dataset.c]; else b.cats[t.dataset.c] = +t.dataset.m; } else return;
    haptic(); save(); const top = el.scrollTop; el.innerHTML = body(); el.scrollTop = top;
  });
}

export function openPrefs() {
  const body = () => {
    const l = learned();
    const off = state.prefsOff || [];
    return `<p class="note p0">Asystent bierze to pod uwagę przy układaniu planu. Masz pełną kontrolę nad tą listą.</p>
      <div class="lbl">Moje zasady</div>
      <form class="add-bar flat" id="pf-f" autocomplete="off"><input id="pf-in" type="text" placeholder="np. Nie planuj treningów po 20" autocapitalize="sentences"><button type="submit" aria-label="Dodaj"><span class="ico">${ICON.plus}</span></button></form>
      <div class="list mt">${(state.prefs || []).map((p) => `<div class="row"><span class="rt"><b>${esc(p.text)}</b></span><button type="button" class="round sm" data-del="${p.id}" aria-label="Usuń"><span class="ico">${ICON.close}</span></button></div>`).join('') || '<div class="empty">Dodaj zasadę albo powiedz ją asystentowi.</div>'}</div>
      <div class="lbl">Policzone z historii</div>
      <div class="list mt">${l.map((p) => `<div class="row"><span class="rt"><b>${esc(p.text)}</b></span><button type="button" class="switch ${off.includes(p.id) ? '' : 'on'}" role="switch" aria-checked="${!off.includes(p.id)}" data-l="${esc(p.id)}" aria-label="Używaj"></button></div>`).join('') || '<div class="empty">Pojawi się tu, gdy zbierze się więcej wpisów.</div>'}</div>`;
  };
  const h = openSheet(`${head('Pamięć preferencji')}<div class="sheet-b" id="pf">${body()}</div>`);
  const el = $('#pf', h.el);
  const redraw = () => { el.innerHTML = body(); };
  h.el.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.x) return closeSheet(h);
    if (t.dataset.del) { removePref(t.dataset.del); redraw(); }
    if (t.dataset.l) { toggleLearned(t.dataset.l); redraw(); }
  });
  h.el.addEventListener('submit', (e) => { e.preventDefault(); addPref($('#pf-in', el).value); redraw(); });
}
void catOf;
