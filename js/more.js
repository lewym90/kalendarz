// Ekrany: Statystyki, Automatyzacje, Wspólny.
import { esc, ymd, startOfWeek, addDays, fmtDuration, DAYS_FULL, MONTHS, ICON, parseYmd, relDay, pad, capFirst } from './util.js';
import { state, catOf, PERSON_COLORS, describeRule as describeRuleDef } from './store.js';
import { instancesInRange } from './recur.js';
import { nav } from './ui.js';
import { pushConfig } from './push.js';
import { peerList, peersOn } from './peers.js';
import { autoName } from './editors.js';
import { glyphFor, glyphHtml } from './glyphs.js';
import { invitesForMe, invitesFromMe, sharedList, spaceErr, me as myName } from './space.js';

const sw = (path, on) => `<button type="button" class="switch ${on ? 'on' : ''}" role="switch" aria-checked="${on}" data-tog="${path}"></button>`;
const head = (title, sub = '') => `<header class="sub-h"><button type="button" class="round" data-act="tab" data-tab="${nav.back || 'hub'}" aria-label="Wróć"><span class="ico">${ICON.back}</span></button><div><h1>${title}</h1>${sub ? `<p>${sub}</p>` : ''}</div></header>`;
const plural = (n, one, few, many) => (n === 1 ? one : n % 10 >= 2 && n % 10 <= 4 && !(n % 100 >= 12 && n % 100 <= 14) ? few : many);

// ---------- Statystyki ----------
export function periodRange(kind, offset, ws, now = new Date()) {
  if (kind === 'year') { const y = now.getFullYear() + offset; return [new Date(y, 0, 1), new Date(y + 1, 0, 1)]; }
  if (kind === 'month') { const a = new Date(now.getFullYear(), now.getMonth() + offset, 1); return [a, new Date(a.getFullYear(), a.getMonth() + 1, 1)]; }
  const a = addDays(startOfWeek(now, ws), offset * 7);
  return [a, addDays(a, 7)];
}
export function statsFor(from, to, st = state) {
  const insts = instancesInRange(st.events, from, to).filter((i) => !i.allDay);
  const byCat = new Map();
  const perDay = new Map();
  let total = 0; let meetings = 0;
  for (const i of insts) {
    const m = Math.max(0, (Math.min(i.end, to) - Math.max(i.start, from)) / 60000);
    total += m;
    byCat.set(i.ev.cat, (byCat.get(i.ev.cat) || 0) + m);
    if (glyphFor(i.ev) === 22) meetings += m;
    const k = ymd(i.start);
    const d = perDay.get(k) || { min: 0, n: 0 }; d.min += m; d.n += 1; perDay.set(k, d);
  }
  const f = from.getTime(); const t = to.getTime();
  const done = st.tasks.filter((x) => x.done && x.doneAt >= f && x.doneAt < t);
  const dated = done.filter((x) => x.origDue || x.due);
  const onTime = dated.filter((x) => ymd(new Date(x.doneAt)) <= (x.origDue || x.due)).length;
  let busiest = null;
  for (const [k, v] of perDay) if (!busiest || v.n > busiest.n || (v.n === busiest.n && v.min > busiest.min)) busiest = { d: k, ...v };
  return { count: insts.length, total, byCat, perDay, meetings, done: done.length, punctual: dated.length ? Math.round((onTime / dated.length) * 100) : null, busiest };
}
export const mostMoved = (st = state) => st.tasks.filter((t) => !t.done && t.rolled > 0).sort((a, b) => b.rolled - a.rolled).slice(0, 3);

function donut(cats, total) {
  const R = 44; const C = 2 * Math.PI * R; let off = 0;
  const arcs = cats.map(([id, m]) => { const len = (m / total) * C; const a = `<circle cx="60" cy="60" r="${R}" fill="none" stroke="${catOf(id).color}" stroke-width="13" stroke-dasharray="${Math.max(0, len - 2.5)} ${C}" stroke-dashoffset="${-off}" transform="rotate(-90 60 60)"/>`; off += len; return a; }).join('');
  return `<svg class="donut" viewBox="0 0 120 120" role="img" aria-label="Podział czasu według kategorii"><circle cx="60" cy="60" r="${R}" fill="none" stroke="rgba(120,170,255,.12)" stroke-width="13"/>${arcs}<text x="60" y="58" text-anchor="middle" class="dn">${Math.round(total / 60)} h</text><text x="60" y="73" text-anchor="middle" class="ds">w planie</text></svg>`;
}
const LABEL = { week: ['tym tygodniu', 'poprzednim tygodniem'], month: ['tym miesiącu', 'poprzednim miesiącem'], year: ['tym roku', 'poprzednim rokiem'] };
export function renderStats() {
  const kind = nav.statKind || 'week';
  const ws = state.settings.weekStart;
  const [a, b] = periodRange(kind, 0, ws);
  const [pa, pb] = periodRange(kind, -1, ws);
  const cur = statsFor(a, b);
  const prev = statsFor(pa, pb);
  const cats = [...cur.byCat.entries()].sort((x, y) => y[1] - x[1]);
  const pct = prev.total ? Math.round(((cur.total - prev.total) / prev.total) * 100) : null;
  const of = (id) => cur.byCat.get(id) || 0;
  const legend = cats.map(([id, m]) => `<div><i style="background:${catOf(id).color}"></i><span>${esc(catOf(id).name)}</span><b>${Math.round((m / cur.total) * 100)}%</b></div>`).join('');
  const barsData = kind === 'year'
    ? Array.from({ length: 12 }, (_, m) => { let n = 0; for (const [k, v] of cur.perDay) if (+k.slice(5, 7) === m + 1) n += v.n; return { l: MONTHS[m].slice(0, 1).toUpperCase(), n, on: new Date().getMonth() === m }; })
    : Array.from({ length: 7 }, (_, k) => { const wd = (ws + k) % 7; let n = 0; for (const [d, v] of cur.perDay) if (parseYmd(d).getDay() === wd) n += v.n; return { l: DAYS_FULL[wd].slice(0, 1).toUpperCase(), n, on: new Date().getDay() === wd }; });
  const max = Math.max(1, ...barsData.map((x) => x.n));
  const bars = barsData.map((x) => `<div class="${x.on ? 't' : ''}"><i style="height:${Math.max(4, (x.n / max) * 100)}%"></i><span>${x.l}</span></div>`).join('');
  const card = (l, v, s = '') => `<div class="st-card"><small>${l}</small><b>${v}</b>${s ? `<span class="dl same">${s}</span>` : ''}</div>`;
  const moved = mostMoved();
  return `${head('Statystyki')}
  <div class="pad-x"><div class="seg wide">${[['week', 'Tydzień'], ['month', 'Miesiąc'], ['year', 'Rok']].map(([k, l]) => `<button type="button" class="${kind === k ? 'on' : ''}" data-act="statkind" data-v="${k}">${l}</button>`).join('')}</div></div>
  ${cats.length ? `<section class="card donut-c">${donut(cats, cur.total)}<div class="legend">${legend}</div></section>` : `<section class="card"><div class="empty"><b>Brak danych</b>W ${LABEL[kind][0]} nie ma jeszcze wydarzeń z godzinami.</div></section>`}
  ${pct != null ? `<section class="card trend"><div class="tr-n ${pct >= 0 ? 'up' : 'down'}">${pct >= 0 ? '↑ +' : '↓ '}${pct}%</div><p>${pct >= 0 ? 'Więcej' : 'Mniej'} czasu w planie w porównaniu z ${LABEL[kind][1]}.</p></section>` : ''}
  <section class="card"><div class="c-h"><span>Najgęstszy dzień</span><b>${cur.busiest ? `${capFirst(DAYS_FULL[parseYmd(cur.busiest.d).getDay()])} · ${cur.busiest.n} ${plural(cur.busiest.n, 'wydarzenie', 'wydarzenia', 'wydarzeń')}` : 'brak'}</b></div><div class="bars">${bars}</div></section>
  <div class="st-grid pad-x">
    ${card('Czas pracy', fmtDuration(of('praca')) )}${card('Treningi', fmtDuration(of('sport')))}
    ${card('Odpoczynek', fmtDuration(of('odpoczynek')))}${card('Spotkania', fmtDuration(cur.meetings))}
    ${card('Wykonane zadania', cur.done, prev.done ? `poprzednio ${prev.done}` : '')}${card('Terminowość', cur.punctual == null ? 'brak' : `${cur.punctual}%`, 'zadania na czas')}
  </div>
  ${moved.length ? `<section class="sec"><div class="sec-h"><h2>Najczęściej przekładane</h2></div><div class="list">${moved.map((t) => `<button type="button" class="row" data-act="open-task" data-id="${t.id}"><span class="rt"><b>${esc(t.title)}</b></span><span class="val">${t.rolled}×</span></button>`).join('')}</div></section>` : ''}
  <div class="spacer"></div>`;
}

// ---------- Automatyzacje ----------
export function renderAuto() {
  const s = state.settings;
  const w = s.weekly;
  const row = (ico, col, title, sub, right) => `<div class="row"><span class="tile-s" style="--c:${col}"><span class="ico">${ico}</span></span><span class="rt"><b>${title}</b><small>${sub}</small></span>${right}</div>`;
  const rules = state.rules.map((r) => `<div class="row"><span class="tile-s" style="--c:#2E8BFF"><span class="ico">${ICON.bolt}</span></span><button type="button" class="rt" data-act="edit-rule" data-id="${r.id}" style="text-align:left"><b>${esc(r.name || autoName(r))}</b><small>Jeśli: ${esc(describeRuleDef(r))}</small></button>${sw(`rule:${r.id}`, r.on)}</div>`).join('');
  return `${head('Automatyzacje')}
  <div class="list">
    ${row(ICON.sun, '#FFC400', 'Poranny brief', 'Codziennie rano', `<input type="time" data-in="morning.time" value="${s.morning.time}" aria-label="Godzina porannego briefu">${sw('morning.on', s.morning.on)}`)}
    ${row(ICON.moon, '#A45CFF', 'Wieczorny podgląd', 'Co Cię czeka jutro', `<input type="time" data-in="evening.time" value="${s.evening.time}" aria-label="Godzina wieczornego podglądu">${sw('evening.on', s.evening.on)}`)}
    ${row(ICON.sparkle, '#19C8FF', 'Przegląd tygodnia', `<select data-in="weekly.day" data-num="1" aria-label="Dzień przeglądu">${[1, 2, 3, 4, 5, 6, 0].map((d) => `<option value="${d}" ${w.day === d ? 'selected' : ''}>${DAYS_FULL[d]}</option>`).join('')}</select>`, `<input type="time" data-in="weekly.time" value="${w.time}" aria-label="Godzina przeglądu tygodnia">${sw('weekly.on', w.on)}`)}
    ${row(ICON.repeat, '#27E05F', 'Przenoś zaległe zadania', 'Niezrobione same wskakują na dziś', sw('rollover', s.rollover))}
  </div>
  <section class="sec"><div class="sec-h"><h2>Moje reguły (jeśli–to)</h2></div>
    <div class="list">${rules || '<div class="empty">Brak reguł. Dodaj pierwszą.</div>'}</div>
    <div class="pad-x" style="margin-top:12px"><button type="button" class="btn block" data-act="edit-rule" data-id=""><span class="ico">${ICON.plus}</span>Dodaj regułę</button></div>
  </section>
  <div class="spacer"></div>`;
}

// ---------- Wspólny ----------
export function renderShared() {
  const sh = state.settings.share;
  const pcfg = pushConfig();
  const partner = peerList()[0]?.name || 'druga osoba';
  const swr = (ico, t, s, path, on) => `<div class="row"><span class="ico">${ico}</span><span class="rt"><b>${t}</b><small>${s}</small></span>${sw(path, on)}</div>`;
  if (!pcfg) return `${head('Wspólny')}<section class="card"><div class="empty"><b>Połącz z serwerem</b>Wspólny kalendarz działa po połączeniu aplikacji z serwerem.</div><button type="button" class="btn primary block" data-act="push-connect">Połącz</button></section>`;
  const inv = invitesForMe();
  const out = invitesFromMe();
  const tasks = sharedList('task');
  const shop = sharedList('shop');
  const whenS = (d) => { const a = d.start; return `${relDay(parseYmd(a.slice(0, 10)))}${d.allDay ? '' : `, ${a.slice(11)}`}`; };
  const invHtml = inv.map((x) => `<section class="card invite">${glyphHtml(glyphFor(x.data))}<div class="rt"><small>${esc(x.data.from)} zaprasza</small><b>${esc(x.data.title)}</b><span>${esc(whenS(x.data))}${x.data.loc ? ` · ${esc(x.data.loc)}` : ''}</span></div><div class="inv-b"><button type="button" class="btn small" data-act="inv-no" data-id="${x.id}">Nie mogę</button><button type="button" class="btn small primary" data-act="inv-yes" data-id="${x.id}">Przyjmuję</button></div></section>`).join('');
  const item = (x, kind) => `<div class="task ${x.data.done ? 'done' : ''}" style="--c:${sh.color}"><button type="button" class="chk" data-act="sh-done" data-id="${x.id}" aria-label="Oznacz"><span class="ico">${ICON.check}</span></button><div class="tt"><b>${esc(x.data.title)}</b><small>${kind === 'task' ? `${x.data.assignee ? `Dla: ${esc(x.data.assignee)}` : 'Dla obojga'}${x.data.due ? ` · ${esc(relDay(parseYmd(x.data.due)))}` : ''}` : `Dodał(a): ${esc(x.data.by || '')}`}</small></div><button type="button" class="round sm" data-act="sh-del" data-id="${x.id}" aria-label="Usuń"><span class="ico">${ICON.close}</span></button></div>`;
  const names = [...new Set([myName(), ...peerList().map((p) => p.name)])].filter(Boolean);
  return `${head('Wspólny', peersOn() ? `Ty i ${esc(partner)}` : '')}
  ${spaceErr ? `<p class="note warn">${esc(spaceErr)}</p>` : ''}
  ${invHtml}
  ${out.length ? `<p class="note">Czeka na odpowiedź: ${out.map((x) => esc(x.data.title)).join(', ')}</p>` : ''}
  <div class="pad-x two"><button type="button" class="btn block" data-act="find-both"><span class="ico">${ICON.clock}</span>Wspólny wolny termin</button></div>
  <section class="sec"><div class="sec-h"><h2>Lista zakupów</h2>${shop.some((x) => x.data.done) ? '<button type="button" class="link" data-act="shop-clear">Usuń kupione</button>' : ''}</div>
    <form class="add-bar" data-sh="shop" autocomplete="off"><input type="text" enterkeyhint="done" placeholder="Dodaj do listy" autocapitalize="sentences"><button type="submit" aria-label="Dodaj"><span class="ico">${ICON.plus}</span></button></form>
    <div class="tasks card-l">${shop.map((x) => item(x, 'shop')).join('')}</div></section>
  <section class="sec"><div class="sec-h"><h2>Wspólne zadania</h2></div>
    <form class="add-bar" data-sh="task" autocomplete="off"><input type="text" enterkeyhint="done" placeholder="Nowe wspólne zadanie" autocapitalize="sentences"><button type="submit" aria-label="Dodaj"><span class="ico">${ICON.plus}</span></button></form>
    <div class="chips pad-x assign"><button type="button" class="chip ${!nav.shAssign ? 'on' : ''}" data-act="sh-assign" data-v="">Dla obojga</button>${names.map((n) => `<button type="button" class="chip ${nav.shAssign === n ? 'on' : ''}" data-act="sh-assign" data-v="${esc(n)}">${esc(n)}</button>`).join('')}</div>
    <div class="tasks card-l">${tasks.map((x) => item(x, 'task')).join('')}</div></section>
  <section class="sec"><div class="sec-h"><h2>Ustawienia</h2></div>
    <div class="list">
      <div class="row"><span class="ico">${ICON.person}</span><span class="rt"><b>Imię widoczne dla drugiej osoby</b><small>Tak będą podpisane Twoje wpisy</small></span><input type="text" data-in="share.name" value="${esc(sh.name)}" maxlength="24" placeholder="np. Marek" autocapitalize="words" autocomplete="off" style="max-width:120px;text-align:right" aria-label="Moje imię"></div>
      ${swr(ICON.cal, 'Udostępniaj mój kalendarz', 'Prywatne wpisy widać jako „Zajęte”', 'share.on', sh.on)}
      ${swr(ICON.users, 'Pokaż kalendarz drugiej osoby', peerList().length ? `Widzisz: ${peerList().map((p) => esc(p.name)).join(', ')}` : 'Włącz, żeby zobaczyć jej wpisy', 'share.view', sh.view)}
      ${swr(ICON.bell, 'Powiadamiaj o jej wpisach', 'Także przy zamkniętej aplikacji', 'share.notify', sh.notify !== false)}
    </div></section>
  <div class="spacer"></div>`;
}
export const colorChips = (sel) => PERSON_COLORS.map((c) => `<button type="button" class="pc ${sel === c ? 'on' : ''}" style="--c:${c}" data-act="my-color" data-v="${c}" aria-label="Kolor ${c}"></button>`).join('');
void pad;
