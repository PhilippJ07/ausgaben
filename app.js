import * as store from './store.js';
import * as sync from './sync.js';
import { CATS, catById } from './categories.js';
import {
  eur, eur0, pct, budgetStr, parseAmount, todayYmd, ymd, parseYmd, monthOf, addMonths, daysInMonth,
  monthLabel, monthName, monthShort, dayLabel, shortDate, MONTHS, esc,
} from './format.js';
import { tick } from './haptics.js';
import {
  icons, isMobile, onLayoutChange, openPanel, closeAllPanels, topPanel, toast, tween, createWheel,
  attachSwipe, collapse, shake, pressable,
} from './ui.js';
import { createDonut } from './donut.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const LAST_CAT = 'ausgaben.lastCat';
const lastCat = () => { try { return localStorage.getItem(LAST_CAT) || 'einkaeufe'; } catch { return 'einkaeufe'; } };
const setLastCat = c => { try { localStorage.setItem(LAST_CAT, c); } catch { /* egal */ } };

let currentView = 'overview';
let view = null;           // { el, update(reason), destroy?() }
let justAdded = null;      // ID für Einblend-Animation
let entriesFilter = null;

// =====================================================================
// Rahmen: Kopfzeile, Navigation, Monatswechsel, Tabbar
// =====================================================================

function setupChrome() {
  $$('[data-view]').forEach(b => b.addEventListener('click', () => go(b.dataset.view)));
  $('#fab').innerHTML = `${icons.plus}<span>Ausgabe</span>`;
  $('#fab').addEventListener('click', () => { tick(); openEntry(); });
  $('.m-prev').innerHTML = icons.chevL;
  $('.m-next').innerHTML = icons.chevR;
  $('.m-prev').addEventListener('click', () => { tick(); shiftMonth(-1); });
  $('.m-next').addEventListener('click', () => { tick(); shiftMonth(1); });
  $$('#tabbar [data-view]').forEach(b => { b.querySelector('.ti').innerHTML = icons[b.dataset.icon]; });
  renderMonthLabel(0);
  pressable(document.body);

  addEventListener('keydown', e => {
    if (topPanel() || e.metaKey || e.ctrlKey || e.altKey) return;
    const typing = e.target.closest('input,textarea,[contenteditable]');
    if (typing) return;
    if (e.key === 'ArrowLeft' && currentView !== 'stats') { e.preventDefault(); shiftMonth(-1); }
    else if (e.key === 'ArrowRight' && currentView !== 'stats') { e.preventDefault(); shiftMonth(1); }
    else if (e.key === 'n' || e.key === 'N') {
      e.preventDefault();
      if (isMobile()) openEntry();
      else { if (currentView !== 'overview') go('overview'); requestAnimationFrame(() => $('#q-amt')?.focus()); }
    }
  });

  enableMonthSwipe();
  sync.onStatus(renderSyncDot);
  onLayoutChange(() => { closeAllPanels(); mountView(); });
  addEventListener('resize', positionIndicators);
  document.fonts?.ready.then(positionIndicators);
}

// iPhone: auf Home und Einträge per Wischen den Monat wechseln (die Pfeile bleiben)
function enableMonthSwipe() {
  const host = $('#view');
  let start = null;
  host.addEventListener('touchstart', e => {
    const blocked = !['overview', 'entries'].includes(currentView) || !isMobile() || e.touches.length > 1
      || e.target.closest('.entry,.pills-row,input');
    start = blocked ? null : { x: e.touches[0].clientX, y: e.touches[0].clientY, t: performance.now() };
  }, { passive: true });
  host.addEventListener('touchend', e => {
    if (!start) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x, dy = t.clientY - start.y, dt = performance.now() - start.t;
    start = null;
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.8 || dt > 700) return;
    const dir = dx < 0 ? 1 : -1;
    shiftMonth(dir); // bewusst ohne Haptik, damit es ruhig wirkt
    view?.el.animate(
      [{ opacity: 0.35, transform: `translateX(${dir * 26}px)` }, { opacity: 1, transform: 'none' }],
      { duration: 420, easing: 'cubic-bezier(.22,1,.36,1)' },
    );
  }, { passive: true });
}

function shiftMonth(dir) {
  store.setMonth(addMonths(store.state.month, dir));
  renderMonthLabel(dir);
}

function renderMonthLabel(dir) {
  const el = $('.m-label');
  el.textContent = monthLabel(store.state.month);
  if (dir) { el.classList.remove('slide-l', 'slide-r'); void el.offsetWidth; el.classList.add(dir > 0 ? 'slide-l' : 'slide-r'); }
  const cur = monthOf(todayYmd());
  $('.m-today').hidden = store.state.month === cur;
}

function go(name) {
  if (name === currentView) { scrollTo({ top: 0, behavior: 'smooth' }); return; }
  currentView = name;
  tick();
  mountView();
  scrollTo({ top: 0 });
}

function mountView() {
  view?.destroy?.();
  const host = $('#view');
  document.body.classList.toggle('view-stats', currentView === 'stats');
  view = ({ overview: Overview, entries: Entries, budgets: Budgets, stats: Stats })[currentView]();
  host.replaceChildren(view.el);
  view.update('mount');
  $$('[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === currentView));
  positionIndicators();
}

function positionIndicators() {
  for (const nav of $$('.nav, #tabbar .tabs')) {
    const a = nav.querySelector('.active');
    const ind = nav.querySelector('.nav-ind');
    if (!a || !ind) continue;
    ind.style.width = `${a.offsetWidth}px`;
    ind.style.transform = `translateX(${a.offsetLeft}px)`;
  }
}

function renderSyncDot(status) {
  const dot = $('#sync-dot');
  const text = {
    local: 'Nur auf diesem Gerät gespeichert',
    connecting: 'Verbinde …',
    syncing: 'Synchronisiere …',
    synced: 'Synchronisiert',
    offline: 'Offline, wird später synchronisiert',
    error: 'Sync-Fehler, neuer Versuch folgt',
    'signed-out': 'Nicht angemeldet',
  }[status] || '';
  dot.dataset.status = status;
  dot.title = text;
  dot.setAttribute('aria-label', text);
  if (currentView === 'budgets') view?.update('sync');
}

// =====================================================================
// Einträge (gemeinsame Zeile)
// =====================================================================

function entryRow(e, { showDate = true } = {}) {
  const cat = catById(e.category);
  const title = e.note || cat.name;
  const sub = [e.note ? cat.name : null, showDate ? shortDate(e.date) : null].filter(Boolean).join(' · ');
  return `<div class="entry${e.id === justAdded ? ' enter' : ''}" data-id="${esc(e.id)}">
    <div class="entry-del"><span>${icons.trash}Löschen</span></div>
    <div class="entry-inner" tabindex="0" role="button" aria-label="${esc(title)}, ${eur(e.amount)}, bearbeiten">
      <span class="dot" style="--c:${cat.color}"></span>
      <span class="entry-txt"><span class="t1">${esc(title)}${e.subId ? `<span class="tag">${icons.repeat}Abo</span>` : ''}</span>${sub ? `<span class="t2">${esc(sub)}</span>` : ''}</span>
      <span class="entry-amt mono">${eur(e.amount)}</span>
      <span class="entry-actions">
        <button class="icon-btn act-edit" type="button" title="Bearbeiten" tabindex="-1">${icons.edit}</button>
        <button class="icon-btn act-del" type="button" title="Löschen" tabindex="-1">${icons.trash}</button>
      </span>
    </div>
  </div>`;
}

function bindEntries(root) {
  for (const row of $$('.entry', root)) {
    const id = row.dataset.id;
    const inner = row.querySelector('.entry-inner');
    const swipe = attachSwipe(row, { onDelete: () => removeExpense(id, row) });
    inner.addEventListener('click', ev => {
      if (row._suppressClick) return;
      if (row.classList.contains('swiped')) { swipe.close(); return; }
      if (ev.target.closest('.act-del')) { ev.stopPropagation(); removeExpense(id, row); return; }
      const e = store.expenseById(id);
      if (e) openEntry(e);
    });
    inner.addEventListener('keydown', ev => {
      if (ev.key === 'Enter') inner.click();
      if (ev.key === 'Backspace' || ev.key === 'Delete') removeExpense(id, row);
    });
  }
}

function removeExpense(id, row) {
  tick();
  collapse(row, () => {
    const prev = store.deleteExpense(id);
    if (!prev) return;
    toast('Eintrag gelöscht', {
      action: 'Rückgängig',
      onAction: () => { store.restoreExpense(prev); tick(); },
    });
  });
}

const clearJustAdded = () => { if (justAdded) setTimeout(() => { justAdded = null; }, 50); };

// =====================================================================
// Kennzahlen
// =====================================================================

function computeMonth(m) {
  const { total, byCat } = store.monthTotals(m);
  const budget = store.budgetForMonth(m) || 0;
  const prevM = addMonths(m, -1);
  const prevTotal = store.monthTotals(prevM).total;
  const today = todayYmd();
  const cur = monthOf(today);
  const [y, mo] = m.split('-').map(Number);
  const dim = daysInMonth(y, mo);
  const daysLeft = m === cur ? dim - parseYmd(today).getDate() + 1 : m > cur ? dim : 0;
  const left = budget - total;
  const alerts = [];
  for (const c of CATS) {
    const b = store.budgetFor(c.id);
    if (!b) continue;
    const v = byCat[c.id];
    if (v > b) alerts.push({ id: c.id, level: 'over', text: `${c.name}: ${eur(v - b)} über Budget` });
    else if (v >= b * 0.8) alerts.push({ id: c.id, level: 'warn', text: `${c.name}: ${pct((v / b) * 100)} vom Budget` });
  }
  if (budget && total >= budget * 0.8 && total <= budget) alerts.unshift({ id: null, level: 'warn', text: `Monatsbudget zu ${pct((total / budget) * 100)} erreicht` });
  if (budget && total > budget) alerts.unshift({ id: null, level: 'over', text: `Monatsbudget um ${eur(total - budget)} überschritten` });
  return { m, total, byCat, budget, prevM, prevTotal, cur, daysLeft, left, alerts };
}

function catState(v, b) {
  if (!b) return v > 0 ? '' : 'zero';
  if (v > b) return 'over';
  if (v >= b * 0.8) return 'warn';
  return v > 0 ? '' : 'zero';
}

// =====================================================================
// Übersicht
// =====================================================================

function Overview() {
  const el = document.createElement('section');
  el.className = 'view ov';
  el.innerHTML = `
    <form class="quick" autocomplete="off">
      <label class="q-lbl" for="q-amt">Neue Ausgabe</label><span class="q-div"></span>
      <span class="q-amt-wrap"><input id="q-amt" class="q-amt" inputmode="decimal" placeholder="0,00" aria-label="Betrag in Euro"><span class="q-eur">€</span></span>
      <div class="q-pills pills-row" role="radiogroup" aria-label="Kategorie"></div>
      <button class="q-date chip-btn" type="button" title="Datum ändern"></button>
      <button class="q-add btn-dark" type="submit" disabled>Hinzufügen<span class="kbd">↵</span></button>
    </form>
    <div class="kpis">
      <div class="kpi k1"><span class="lbl">Ausgegeben</span><span class="val" id="k-spent"></span><span class="cap" id="k-spent-cap"></span></div>
      <div class="kpi k2"><span class="lbl">Noch verfügbar</span><span class="val" id="k-left"></span><span class="cap" id="k-left-cap"></span></div>
      <div class="kpi k3"><span class="lbl" id="k-cmp-lbl"></span><span class="val" id="k-cmp"></span><span class="cap" id="k-cmp-cap"></span></div>
    </div>
    <div class="alerts" aria-live="polite"></div>
    <div class="chart"><div class="donut-host"></div><div class="legend"></div></div>
    <div class="cats">
      <div class="sec-h"><span>Kategorien</span><span class="hide-m">Betrag / Budget</span></div>
      <div class="cat-list"></div>
    </div>
    <div class="recent">
      <div class="sec-h"><span>Letzte Einträge</span><button class="link" type="button">Alle anzeigen</button></div>
      <div class="recent-list"></div>
    </div>`;

  const mobile = isMobile();
  const donut = createDonut({
    size: 220, stroke: mobile ? 8 : 9,
    onOpen: id => openCategory(id),
    onActive: id => highlight(id),
  });
  $('.donut-host', el).appendChild(donut.el);
  $('.recent .link', el).addEventListener('click', () => go('entries'));

  // Kategoriezeilen einmal bauen, danach nur Werte ändern (damit Balken weich animieren)
  const catList = $('.cat-list', el);
  catList.innerHTML = CATS.map(c => `
    <button class="cat-row" type="button" data-id="${c.id}" style="--c:${c.color}">
      <span class="dot"></span><span class="name">${esc(c.name)}</span>
      <span class="bar"><i></i></span>
      <span class="amt mono"><span class="a"></span><span class="bud"></span></span>
    </button>`).join('');
  const hoverBind = container => {
    container.addEventListener('pointerover', e => {
      if (e.pointerType !== 'mouse') return;
      const r = e.target.closest('[data-id]');
      if (r) donut.setActive(r.dataset.id);
    });
    container.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') donut.setActive(null); });
    container.addEventListener('click', e => { const r = e.target.closest('[data-id]'); if (r) { tick(); openCategory(r.dataset.id); } });
  };
  hoverBind(catList);
  hoverBind($('.legend', el));

  function highlight(id) {
    el.classList.toggle('has-hl', !!id);
    $$('[data-id]', $('.cat-list', el)).concat($$('.legend [data-id]', el))
      .forEach(r => r.classList.toggle('hl', r.dataset.id === id));
  }

  // ----- Schnelleingabe (Mac) -----
  const form = $('.quick', el);
  const amt = $('#q-amt', el);
  const addBtn = $('.q-add', el);
  const pills = $('.q-pills', el);
  let qCat = lastCat();
  let qDate = todayYmd();
  pills.innerHTML = CATS.map(c => `<button type="button" class="pill" role="radio" data-cat="${c.id}" style="--c:${c.color}"><span class="dot"></span>${esc(c.name)}</button>`).join('');
  const syncPills = () => $$('.pill', pills).forEach(p => { const on = p.dataset.cat === qCat; p.classList.toggle('sel', on); p.setAttribute('aria-checked', on); });
  const syncDate = () => { const d = $('.q-date', el); d.textContent = qDate === todayYmd() ? 'Heute' : shortDate(qDate); d.classList.toggle('set', qDate !== todayYmd()); };
  const valid = () => parseAmount(amt.value) > 0 && !!qCat;
  const syncBtn = () => { addBtn.disabled = !valid(); };
  syncPills(); syncDate(); syncBtn();
  pills.addEventListener('click', e => {
    const p = e.target.closest('.pill');
    if (!p) return;
    qCat = p.dataset.cat;
    syncPills(); syncBtn();
    p.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    amt.focus();
  });
  amt.addEventListener('input', () => {
    amt.value = amt.value.replace(/[^\d.,]/g, '');
    syncBtn();
  });
  amt.addEventListener('keydown', e => {
    // ↑/↓ wechselt die Kategorie, ohne die Tastatur zu verlassen
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    const i = CATS.findIndex(c => c.id === qCat);
    qCat = CATS[(i + (e.key === 'ArrowDown' ? 1 : -1) + CATS.length) % CATS.length].id;
    syncPills(); syncBtn();
    $(`.pill[data-cat="${qCat}"]`, pills).scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  });
  $('.q-date', el).addEventListener('click', () => pickDate(qDate, d => { qDate = d; syncDate(); amt.focus(); }));
  form.addEventListener('submit', e => {
    e.preventDefault();
    const a = parseAmount(amt.value);
    if (!(a > 0)) { shake(form); amt.focus(); return; }
    const exp = store.addExpense({ amount: a, category: qCat, date: qDate });
    setLastCat(qCat);
    amt.value = '';
    qDate = todayYmd();
    syncDate(); syncBtn();
    form.classList.remove('saved'); void form.offsetWidth; form.classList.add('saved');
    if (monthOf(exp.date) !== store.state.month) { store.setMonth(monthOf(exp.date)); renderMonthLabel(0); }
    toast(`${eur(a)} · ${catById(qCat).name}`, { action: 'Rückgängig', onAction: () => store.deleteExpense(exp.id) });
    amt.focus();
  });

  function update() {
    const mob = isMobile();
    const d = computeMonth(store.state.month);
    const cur = d.m === d.cur;

    // Kennzahlen
    tween($('#k-spent', el), d.total, eur);
    $('#k-spent-cap', el).textContent = d.budget ? `${pct((d.total / d.budget) * 100)} von ${eur(d.budget)} Budget` : 'Kein Monatsbudget festgelegt';
    const left = $('#k-left', el);
    if (!d.budget) { left._cur = 0; left.textContent = '—'; left.classList.remove('neg'); }
    else { tween(left, d.left, eur); left.classList.toggle('neg', d.left < 0); }
    $('#k-left-cap', el).textContent = !d.budget ? 'Monatsbudget unter „Budgets“ festlegen'
      : d.left < 0 ? 'über dem Monatsbudget'
      : cur ? `≈ ${eur(d.left / d.daysLeft)} pro Tag · noch ${d.daysLeft} ${d.daysLeft === 1 ? 'Tag' : 'Tage'}`
      : d.m < d.cur ? 'Monat abgeschlossen' : `≈ ${eur(d.left / d.daysLeft)} pro Tag`;
    $('#k-cmp-lbl', el).textContent = mob ? `vs. ${monthName(d.prevM)}` : `Vergleich zum ${monthName(d.prevM)}`;
    const cmp = $('#k-cmp', el);
    if (d.prevTotal > 0) {
      const delta = ((d.total - d.prevTotal) / d.prevTotal) * 100;
      tween(cmp, delta, v => (v > 0.05 ? '+' : '') + pct(v, 1));
      cmp.className = `val ${delta <= 0 ? 'pos' : 'neg'}`;
      const diff = Math.abs(d.total - d.prevTotal);
      $('#k-cmp-cap', el).textContent = mob ? `${eur(diff)} ${d.total <= d.prevTotal ? 'weniger' : 'mehr'}` : `${eur(diff)} ${d.total <= d.prevTotal ? 'weniger' : 'mehr'} als ${eur(d.prevTotal)}`;
    } else {
      cmp._cur = 0; cmp.textContent = '—'; cmp.className = 'val';
      $('#k-cmp-cap', el).textContent = `Keine Ausgaben im ${monthName(d.prevM)}`;
    }

    // Hinweise ab 80 %
    const alerts = $('.alerts', el);
    const sorted = [...d.alerts].sort((a, b) => (a.level === b.level ? 0 : a.level === 'over' ? -1 : 1));
    const maxAlerts = mob ? 2 : 3;
    const shown = sorted.slice(0, maxAlerts);
    const alertsHtml = shown.map(a => `<button type="button" class="alert ${a.level}" ${a.id ? `data-cat="${a.id}"` : 'data-go="budgets"'}><span class="adot"></span>${esc(a.text)}</button>`).join('')
      + (sorted.length > maxAlerts ? `<button type="button" class="alert more" data-go="budgets">+${sorted.length - maxAlerts} weitere</button>` : '');
    if (alerts._html !== alertsHtml) {
      alerts._html = alertsHtml;
      alerts.innerHTML = alertsHtml;
      $$('.alert[data-go]', alerts).forEach(b => b.addEventListener('click', () => go('budgets')));
      $$('.alert[data-cat]', alerts).forEach(b => b.addEventListener('click', () => openCategory(b.dataset.cat)));
    }
    alerts.classList.toggle('has', d.alerts.length > 0);

    // Ring
    donut.update(d.byCat);
    const def = donut.layers.def;
    $('.d-lbl', def).textContent = d.total > 0 ? (mob ? 'Ausgegeben' : monthName(d.m)) : 'Noch keine Ausgaben';
    tween($('.d-val', def), d.total, mob ? eur : eur0);
    $('.d-sub', def).textContent = d.budget ? `von ${eur0(d.budget)}` : '';
    donut.renderActive = id => {
      const act = donut.layers.act;
      const v = store.monthTotals(store.state.month).byCat[id];
      const tot = store.monthTotals(store.state.month).total;
      const b = store.budgetFor(id);
      $('.d-lbl', act).textContent = catById(id).name;
      $('.d-val', act).textContent = mob ? eur(v) : eur(v);
      $('.d-sub', act).textContent = `${pct((v / tot) * 100)}${b ? ` · von ${eur0(b)}` : ''}`;
      act.style.setProperty('--c', catById(id).color);
    };
    if (donut.active) donut.renderActive(donut.active);

    // Legende (Mac)
    $('.legend', el).innerHTML = CATS.filter(c => d.byCat[c.id] > 0).map(c => `
      <div class="legend-row ${donut.active === c.id ? 'hl' : ''}" data-id="${c.id}" style="--c:${c.color}"><span class="dot"></span><span class="name">${esc(c.name)}</span><span class="share mono">${pct((d.byCat[c.id] / d.total) * 100)}</span></div>`).join('');

    // Kategorien
    for (const row of $$('.cat-row', catList)) {
      const id = row.dataset.id;
      const v = d.byCat[id];
      const b = store.budgetFor(id);
      const w = b ? Math.min(100, (v / b) * 100) : d.total ? (v / d.total) * 100 : 0;
      row.className = `cat-row ${catState(v, b)} ${b ? '' : 'nobudget'} ${donut.active === id ? 'hl' : ''}`;
      $('.bar i', row).style.width = `${w}%`;
      $('.a', row).textContent = eur(v);
      $('.bud', row).textContent = mob ? '' : ` / ${b ? eur(b) : '—'}`;
    }

    // Letzte Einträge
    const recent = store.recentExpenses(3);
    const rl = $('.recent-list', el);
    rl.innerHTML = recent.length ? recent.map(e => entryRow(e)).join('')
      : `<div class="empty">Noch keine Einträge. ${mob ? 'Tippe unten auf „+ Ausgabe“.' : 'Gib oben einfach einen Betrag ein.'}</div>`;
    bindEntries(rl);
    clearJustAdded();
  }

  return { el, update, destroy: () => donut.destroy() };
}

// =====================================================================
// Einträge
// =====================================================================

function Entries() {
  const el = document.createElement('section');
  el.className = 'view entries';
  el.innerHTML = `
    <div class="page-h"><h1>Einträge</h1><span class="page-sub" id="e-sum"></span></div>
    <div class="filter pills-row" role="radiogroup" aria-label="Filter"></div>
    <div class="groups"></div>`;
  const filter = $('.filter', el);
  filter.addEventListener('click', e => {
    const p = e.target.closest('.pill');
    if (!p) return;
    entriesFilter = p.dataset.cat || null;
    tick();
    update();
  });

  function update() {
    const m = store.state.month;
    const all = store.monthExpenses(m);
    const counts = {};
    all.forEach(e => { counts[e.category] = (counts[e.category] || 0) + 1; });
    if (entriesFilter && !counts[entriesFilter]) entriesFilter = null;
    filter.innerHTML = `<button type="button" class="pill ${entriesFilter ? '' : 'sel'}" data-cat="">Alle<span class="cnt">${all.length}</span></button>` +
      CATS.filter(c => counts[c.id]).map(c => `<button type="button" class="pill ${entriesFilter === c.id ? 'sel' : ''}" data-cat="${c.id}" style="--c:${c.color}"><span class="dot"></span>${esc(c.name)}<span class="cnt">${counts[c.id]}</span></button>`).join('');

    const list = entriesFilter ? all.filter(e => e.category === entriesFilter) : all;
    const sum = list.reduce((a, e) => a + e.amount, 0);
    $('#e-sum', el).textContent = list.length ? `${list.length} ${list.length === 1 ? 'Eintrag' : 'Einträge'} · ${eur(sum)}` : '';
    const groups = {};
    list.forEach(e => (groups[e.date] ||= []).push(e));
    const g = $('.groups', el);
    g.innerHTML = list.length ? Object.keys(groups).map(date => `
      <div class="group">
        <div class="group-h"><span>${dayLabel(date)}</span><span class="mono">${eur(groups[date].reduce((a, e) => a + e.amount, 0))}</span></div>
        ${groups[date].map(e => entryRow(e, { showDate: false })).join('')}
      </div>`).join('')
      : `<div class="empty big">Keine Einträge im ${monthLabel(m)}.</div>`;
    bindEntries(g);
    clearJustAdded();
  }
  return { el, update };
}

// =====================================================================
// Statistik
// =====================================================================

const signed = n => (n > 0 ? '+' : '') + eur(n);

function Stats() {
  const el = document.createElement('section');
  el.className = 'view stats';
  el.innerHTML = `
    <div class="st-chart-h"><div class="st-t"></div><div class="st-v"></div></div>
    <div class="st-chart"></div>
    <div class="st-grid">
      <div class="st-bilanz">
        <div class="st-lbl">Bilanz</div>
        <div class="st-val"></div>
        <div class="st-cap"></div>
        <div class="st-avg" hidden><span>Ø Ausgaben pro Monat</span><span class="mono"></span></div>
      </div>
      <div class="st-list"></div>
    </div>`;
  const chart = $('.st-chart', el);
  let selected = null, rows = [], shown = false;

  function pick(m) {
    const r = rows.find(x => x.m === m);
    chart.classList.toggle('has', !!r);
    $$('.st-col', chart).forEach(c => c.classList.toggle('sel', c.dataset.m === m));
    const v = $('.st-v', el);
    $('.st-t', el).textContent = r ? monthLabel(r.m) + (r.live ? ' · läuft noch' : '') : 'Ergebnis pro Monat';
    if (!r || r.result == null) { v.textContent = r ? 'Kein Budget festgelegt' : ''; v.className = 'st-v'; return; }
    v.textContent = r.live ? (r.result >= 0 ? `noch ${eur(r.result)}` : `${eur(-r.result)} drüber`) : signed(r.result);
    v.className = `st-v ${r.live ? '' : r.result >= 0 ? 'st-pos' : 'st-neg'}`;
  }

  function update() {
    rows = store.monthlyResults();
    const mobile = isMobile();
    const done = rows.filter(r => !r.live && r.result != null);
    const sum = done.length ? done[done.length - 1].sum : 0;
    const closed = rows.filter(r => !r.live);

    // Säulen: letzte 6 Monate (iPhone) bzw. 12 (Mac). Die Nulllinie entspricht dem Budget.
    const visible = rows.slice(mobile ? -6 : -12);
    const H = mobile ? 210 : 270, labelH = 26, pad = 20;
    const maxDone = Math.max(...visible.filter(r => !r.live).map(r => Math.abs(r.result ?? 0)), 1);
    const value = r => (r.live ? Math.max(0, Math.min(r.result ?? 0, maxDone * 0.6)) : r.result ?? 0);
    const vals = visible.map(value);
    const maxP = Math.max(...vals, 1), maxN = Math.max(...vals.map(v => -v), 0);
    const scale = (H - labelH - pad * (maxN > 0 ? 2 : 1)) / (maxP + maxN);
    const zero = pad + maxP * scale;
    chart.style.height = `${H}px`;
    chart.innerHTML = `<div class="st-zero" style="top:${zero}px"></div>` + visible.map((r, i) => {
      const v = vals[i], h = Math.max(3, Math.abs(v) * scale), up = v >= 0;
      return `<button type="button" class="st-col ${r.m === selected ? 'sel' : ''}" data-m="${r.m}" style="--i:${i}" aria-label="${monthLabel(r.m)}">
        <span class="st-bar ${up ? 'up' : 'down'} ${r.live ? 'live' : ''}" style="top:${up ? zero - h : zero}px;height:${h}px"></span>
        <span class="st-num" style="top:${up ? zero - h - 17 : zero + h + 3}px">${r.live || r.result == null ? '' : `${r.result > 0 ? '+' : ''}${eur0(r.result).replace(' €', '')}`}</span>
        <span class="st-mon">${monthShort(r.m)}</span>
      </button>`;
    }).join('');
    $$('.st-col', chart).forEach(c => {
      const m = c.dataset.m;
      c.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') pick(m); });
      c.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') pick(selected); });
      c.addEventListener('click', () => { selected = selected === m ? null : m; tick(); pick(selected); });
    });
    pick(selected);

    // Säulen wachsen nur beim Öffnen hoch
    if (shown) chart.classList.add('grown');
    else {
      shown = true;
      void chart.offsetWidth;
      setTimeout(() => chart.classList.add('grown'), 30);
    }

    // Bilanz
    const val = $('.st-val', el);
    tween(val, sum, signed, 1000);
    val.classList.toggle('st-pos', sum > 0);
    val.classList.toggle('st-neg', sum < 0);
    const under = done.filter(r => r.result >= 0).length, over = done.length - under;
    const word = n => (n === 1 ? 'Monat' : 'Monate');
    $('.st-cap', el).textContent = !done.length ? 'Zählt, sobald der erste Monat abgeschlossen ist.'
      : `seit ${monthName(done[0].m)} · ${[under && `${under} ${word(under)} unter Budget`, over && `${over} ${word(over)} darüber`].filter(Boolean).join(', ')}`;
    const avg = $('.st-avg', el);
    avg.hidden = !closed.length;
    if (closed.length) $('.mono', avg).textContent = eur(closed.reduce((a, r) => a + r.total, 0) / closed.length);

    // Monatsliste, neuester zuerst
    $('.st-list', el).innerHTML = [...rows].reverse().map(r => `
      <div class="st-row ${r.live ? 'live' : ''}">
        <div><div class="st-m">${monthLabel(r.m)}${r.live ? '<span class="tag">läuft noch</span>' : ''}</div>
          <div class="st-s">${eur(r.total)}${r.budget ? ` von ${eur(r.budget)}` : ''}</div></div>
        <div class="st-r">${r.result == null ? '<div class="st-s">Kein Budget</div>'
          : r.live ? `<div class="st-e muted">${r.result >= 0 ? `noch ${eur(r.result)}` : `${eur(-r.result)} drüber`}</div><div class="st-s">zählt ab Monatsende</div>`
          : `<div class="st-e ${r.result >= 0 ? 'st-pos' : 'st-neg'}">${signed(r.result)}</div><div class="st-s">Summe ${signed(r.sum)}</div>`}</div>
      </div>`).join('');
  }
  return { el, update };
}

// =====================================================================
// Budgets, Abos, Konto
// =====================================================================

function Budgets() {
  const el = document.createElement('section');
  el.className = 'view budgets';
  el.innerHTML = `
    <div class="page-h"><h1>Budgets</h1><span class="page-sub">${monthLabel(store.state.month)}</span></div>
    <section class="b-sec">
      <div class="b-h"><span>Monatsbudget</span></div>
      <label class="b-total"><input class="b-total-in money-in" inputmode="decimal" placeholder="0" aria-label="Monatsbudget in Euro"><span>€</span></label>
      <div class="b-cap" id="b-cap"></div>
    </section>
    <section class="b-sec">
      <div class="b-h"><span>Pro Kategorie</span><span class="muted" id="b-sum"></span></div>
      <div class="b-list">${CATS.map(c => `
        <div class="b-row" data-id="${c.id}" style="--c:${c.color}">
          <span class="dot"></span><span class="name">${esc(c.name)}</span>
          <span class="b-spent mono"></span>
          <label class="b-in"><input class="money-in" inputmode="decimal" placeholder="—" aria-label="Budget ${esc(c.name)}"><span>€</span></label>
          <span class="bar"><i></i></span>
        </div>`).join('')}</div>
    </section>
    <section class="b-sec">
      <div class="b-h"><span>Abos</span><span class="muted" id="s-sum"></span></div>
      <p class="hint">Abos werden jeden Monat automatisch am gewählten Tag eingetragen.</p>
      <div class="s-list"></div>
      <button class="btn-soft add-sub" type="button">${icons.plus}Abo hinzufügen</button>
    </section>
    <section class="b-sec">
      <div class="b-h"><span>Konto &amp; Synchronisierung</span></div>
      <div class="acct"></div>
    </section>`;

  const total = $('.b-total-in', el);
  const fitTotal = () => { total.style.width = `${Math.max(1, total.value.length || 1) * 0.62 + 0.15}em`; };
  total.addEventListener('input', fitTotal);
  total.addEventListener('change', () => {
    const n = parseAmount(total.value);
    store.setMonthlyBudget(n > 0 ? n : null);
    tick();
  });
  for (const row of $$('.b-row', el)) {
    const inp = $('input', row);
    inp.addEventListener('change', () => { const n = parseAmount(inp.value); store.setCategoryBudget(row.dataset.id, n > 0 ? n : null); tick(); });
  }
  $$('.money-in', el).forEach(i => {
    i.addEventListener('keydown', e => { if (e.key === 'Enter') i.blur(); });
    i.addEventListener('input', () => { i.value = i.value.replace(/[^\d.,]/g, ''); });
    i.addEventListener('focus', () => setTimeout(() => i.select(), 0));
  });
  $('.add-sub', el).addEventListener('click', () => openSub());

  function update() {
    const s = store.state.settings;
    const m = store.state.month;
    const { byCat } = store.monthTotals(m);
    $('.page-sub', el).textContent = `Ausgaben im ${monthLabel(m)}`;
    if (document.activeElement !== total) total.value = budgetStr(s.monthlyBudget);
    fitTotal();
    const sumCats = CATS.reduce((a, c) => a + (store.budgetFor(c.id) || 0), 0);
    const free = (s.monthlyBudget || 0) - sumCats;
    $('#b-cap', el).innerHTML = s.monthlyBudget
      ? `${eur(sumCats)} auf Kategorien verteilt · <span class="${free < 0 ? 'neg' : ''}">${free < 0 ? `${eur(-free)} zu viel verteilt` : `${eur(free)} frei`}</span>`
      : 'Trag ein, wie viel du im Monat ausgeben möchtest.';
    $('#b-sum', el).textContent = `Summe ${eur(sumCats)}`;
    for (const row of $$('.b-row', el)) {
      const id = row.dataset.id;
      const b = store.budgetFor(id);
      const v = byCat[id];
      const inp = $('input', row);
      if (document.activeElement !== inp) inp.value = budgetStr(b);
      $('.b-spent', row).textContent = `${eur(v)} ausgegeben`;
      $('.bar i', row).style.width = b ? `${Math.min(100, (v / b) * 100)}%` : '0%';
      row.dataset.state = catState(v, b);
    }

    // Abos
    const subs = store.activeSubs().sort((a, b) => a.day - b.day);
    const act = subs.filter(x => x.active);
    $('#s-sum', el).textContent = subs.length ? `${eur(act.reduce((a, x) => a + x.amount, 0))} / Monat` : '';
    const sl = $('.s-list', el);
    sl.innerHTML = subs.map(x => `
      <button type="button" class="s-row ${x.active ? '' : 'paused'}" data-id="${x.id}" style="--c:${catById(x.category).color}">
        <span class="dot"></span>
        <span class="s-txt"><span class="t1">${esc(x.name)}</span><span class="t2">am ${x.day}. · ${esc(catById(x.category).name)}${x.active ? '' : ' · pausiert'}</span></span>
        <span class="mono">${eur(x.amount)}</span>
      </button>`).join('') || '<div class="empty">Noch keine Abos, z. B. Gym, Spotify oder Handyvertrag.</div>';
    $$('.s-row', sl).forEach(b => b.addEventListener('click', () => openSub(store.state.subs.find(x => x.id === b.dataset.id))));

    renderAccount($('.acct', el));
  }
  return { el, update };
}

function exportCsv() {
  const rows = store.activeExpenses().sort((a, b) => a.date.localeCompare(b.date));
  const q = s => `"${String(s ?? '').replace(/"/g, '""')}"`;
  const lines = ['Datum;Kategorie;Betrag;Notiz;Abo'].concat(rows.map(e =>
    [e.date, q(catById(e.category).name), e.amount.toFixed(2).replace('.', ','), q(e.note), e.subId ? 'ja' : ''].join(';')));
  const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `ausgaben-${todayYmd()}.csv`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  toast(`${rows.length} Einträge exportiert`);
}

function renderAccount(box) {
  const st = sync.getStatus();
  const exportBtn = '<button class="btn-soft export" type="button">Daten als CSV exportieren</button>';
  const bindExport = () => box.querySelector('.export')?.addEventListener('click', exportCsv);
  if (!sync.enabled) {
    box.innerHTML = `<p class="hint">Die Synchronisierung ist noch nicht eingerichtet. Deine Daten liegen gerade nur auf diesem Gerät. Die Anleitung steht in der <span class="mono">README.md</span>.</p>
      <div class="acct-actions">${exportBtn}</div>`;
    bindExport();
    return;
  }
  const s = sync.getSession();
  const label = { synced: 'Alles synchronisiert', syncing: 'Synchronisiere …', offline: 'Offline, Änderungen werden später hochgeladen', error: 'Sync-Fehler, neuer Versuch folgt', connecting: 'Verbinde …' }[st] || '';
  box.innerHTML = s ? `
    <div class="acct-row"><span class="sync-state" data-status="${st}"></span><span>${esc(label)}</span></div>
    <div class="acct-row muted">Angemeldet als ${esc(s.user.email)}</div>
    <p class="hint">Neues Gerät hinzufügen: Öffne die App dort und melde dich mit derselben E-Mail an. Alle Daten erscheinen automatisch.</p>
    <div class="acct-actions"><button class="btn-soft sync-now" type="button">Jetzt synchronisieren</button>${exportBtn}<button class="btn-ghost sign-out" type="button">Abmelden</button></div>`
    : '<p class="hint">Nicht angemeldet.</p>';
  bindExport();
  box.querySelector('.sync-now')?.addEventListener('click', () => { tick(); sync.syncNow(); });
  box.querySelector('.sign-out')?.addEventListener('click', () => {
    if (confirm('Abmelden? Die Daten bleiben online gespeichert und werden von diesem Gerät entfernt.')) sync.signOut();
  });
}

// =====================================================================
// Ausgabe eingeben / bearbeiten
// =====================================================================

const amountToStr = n => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace('.', ','));
const displayAmount = s => {
  if (!s) return '0';
  const [i, d] = s.split(',');
  const int = Number(i || 0).toLocaleString('de-DE');
  return d != null ? `${int},${d}` : int;
};

function openEntry(exp = null, { category } = {}) {
  const editing = !!exp;
  const mobile = isMobile();
  const p = openPanel({ className: 'entry-panel', label: editing ? 'Ausgabe bearbeiten' : 'Neue Ausgabe' });
  let amountStr = editing ? amountToStr(exp.amount) : '';
  let cat = exp?.category || category || lastCat();
  let date = exp?.date || todayYmd();

  p.body.innerHTML = `
    <div class="ef-head" data-drag>
      <span class="ef-title">${editing ? 'Ausgabe bearbeiten' : 'Neue Ausgabe'}</span>
      <button class="ef-date chip-btn" type="button"><span></span>${icons.chevD}</button>
    </div>
    <div class="ef-amount">${mobile
      ? '<span class="ef-num"></span><span class="ef-eur">€</span>'
      : '<input class="ef-in" inputmode="decimal" placeholder="0,00" aria-label="Betrag in Euro"><span class="ef-eur">€</span>'}</div>
    <div class="ef-pills pills-wrap" role="radiogroup" aria-label="Kategorie">${CATS.map(c => `
      <button type="button" class="pill press" role="radio" data-cat="${c.id}" style="--c:${c.color}"><span class="dot"></span>${esc(c.name)}</button>`).join('')}</div>
    <label class="ef-note">${icons.note}<input class="ef-note-in" placeholder="Notiz (optional)" maxlength="60" enterkeyhint="done"></label>
    ${mobile ? `<div class="keypad">${['1', '2', '3', '4', '5', '6', '7', '8', '9', ',', '0', '⌫']
      .map(k => `<button type="button" class="key press" data-k="${k}" aria-label="${k === '⌫' ? 'Löschen' : k}">${k === '⌫' ? icons.backspace : k}</button>`).join('')}</div>` : ''}
    <div class="ef-actions">
      ${editing ? `<button class="btn-ghost ef-del" type="button">${icons.trash}Löschen</button>` : ''}
      <button class="btn-dark ef-save press" type="button">Speichern</button>
    </div>`;

  const body = p.body;
  const amountBox = $('.ef-amount', body);
  const input = $('.ef-in', body);
  const num = $('.ef-num', body);
  const note = $('.ef-note-in', body);
  note.value = exp?.note || '';

  const current = () => (mobile ? parseAmount(amountStr) : parseAmount(input.value));
  const renderDate = () => { $('.ef-date span', body).textContent = dayLabel(date); };
  const renderPills = () => $$('.pill', body).forEach(b => { const on = b.dataset.cat === cat; b.classList.toggle('sel', on); b.setAttribute('aria-checked', on); });
  const renderSave = () => { $('.ef-save', body).classList.toggle('ready', current() > 0 && !!cat); };
  const renderAmount = (bump = true) => {
    if (!num) return;
    num.textContent = displayAmount(amountStr);
    amountBox.classList.toggle('placeholder', !amountStr);
    amountBox.dataset.len = Math.min(9, displayAmount(amountStr).length);
    if (bump) { amountBox.classList.remove('bump'); void amountBox.offsetWidth; amountBox.classList.add('bump'); }
    renderSave();
  };

  if (input) {
    input.value = editing ? amountToStr(exp.amount) : '';
    const fit = () => { input.style.width = `${Math.max(4, input.value.length) + 0.4}ch`; };
    fit();
    input.addEventListener('input', () => { input.value = input.value.replace(/[^\d.,]/g, ''); fit(); renderSave(); });
    input.addEventListener('keydown', e => { if (e.key === 'Enter') save(); });
    setTimeout(() => { input.focus(); input.select(); }, 60);
  }
  renderDate(); renderPills(); renderAmount(false);

  $('.ef-pills', body).addEventListener('click', e => {
    const b = e.target.closest('.pill');
    if (!b) return;
    cat = b.dataset.cat;
    tick();
    renderPills(); renderSave();
  });
  $('.ef-date', body).addEventListener('click', () => pickDate(date, d => { date = d; renderDate(); }));
  note.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); note.blur(); if (!mobile) save(); } });

  function press(k) {
    const [i, d] = amountStr.split(',');
    if (k === '⌫') amountStr = amountStr.slice(0, -1);
    else if (k === ',') { if (d != null) return shake(amountBox); amountStr = (amountStr || '0') + ','; }
    else if (d != null) { if (d.length >= 2) return shake(amountBox); amountStr += k; }
    else if (i.length >= 5) return shake(amountBox);
    else amountStr = amountStr === '0' ? k : amountStr + k;
    tick();
    renderAmount();
  }
  $('.keypad', body)?.addEventListener('click', e => { const k = e.target.closest('.key'); if (k) press(k.dataset.k); });
  const onKey = e => {
    if (!mobile || topPanel() !== p || e.target === note) return;
    if (/^\d$/.test(e.key)) press(e.key);
    else if (e.key === ',' || e.key === '.') press(',');
    else if (e.key === 'Backspace') press('⌫');
    else if (e.key === 'Enter') save();
  };
  addEventListener('keydown', onKey);
  const origClose = p.close;
  p.close = r => { removeEventListener('keydown', onKey); origClose(r); };

  function save() {
    const a = current();
    if (!(a > 0)) { shake(amountBox); tick(); return; }
    if (!cat) { shake($('.ef-pills', body)); return; }
    if (editing) {
      const prev = store.updateExpense(exp.id, { amount: a, category: cat, date, note: note.value });
      toast('Änderung gespeichert', { action: 'Rückgängig', onAction: () => store.restoreExpense(prev) });
    } else {
      const e = store.addExpense({ amount: a, category: cat, date, note: note.value });
      toast(`${eur(a)} · ${catById(cat).name}`, { action: 'Rückgängig', onAction: () => store.deleteExpense(e.id) });
    }
    setLastCat(cat);
    if (monthOf(date) !== store.state.month) { store.setMonth(monthOf(date)); renderMonthLabel(0); }
    tick('success');
    p.close('saved');
  }
  $('.ef-save', body).addEventListener('click', save);
  $('.ef-del', body)?.addEventListener('click', () => {
    const prev = store.deleteExpense(exp.id);
    tick();
    p.close('deleted');
    toast('Eintrag gelöscht', { action: 'Rückgängig', onAction: () => store.restoreExpense(prev) });
  });
}

// =====================================================================
// Datum wählen (Drehräder wie in der iOS-Uhr)
// =====================================================================

function pickDate(cur, onPick) {
  const p = openPanel({ className: 'date-panel', label: 'Datum wählen' });
  const d0 = parseYmd(cur);
  let y = d0.getFullYear(), m = d0.getMonth() + 1, day = d0.getDate();
  const thisYear = new Date().getFullYear();
  const years = [];
  for (let yy = Math.min(y, thisYear - 2); yy <= Math.max(y, thisYear + 1); yy++) years.push(yy);

  p.body.innerHTML = `
    <div class="ef-head" data-drag><span class="ef-title">Datum</span><span class="dp-preview"></span></div>
    <div class="dp-quick">
      <button type="button" class="pill press" data-q="0">Heute</button>
      <button type="button" class="pill press" data-q="1">Gestern</button>
      <button type="button" class="pill press" data-q="2">Vorgestern</button>
    </div>
    <div class="dp-wheels"><div class="dp-band"></div></div>
    <button class="btn-dark dp-ok press" type="button">Übernehmen</button>`;

  const host = $('.dp-wheels', p.body);
  const dayItems = () => Array.from({ length: daysInMonth(y, m) }, (_, i) => `${i + 1}.`);
  const preview = () => {
    const s = ymd(new Date(y, m - 1, day));
    $('.dp-preview', p.body).textContent = dayLabel(s);
    $$('.dp-quick .pill', p.body).forEach(b => {
      const t = new Date(); t.setDate(t.getDate() - Number(b.dataset.q));
      b.classList.toggle('sel', ymd(t) === s);
    });
  };
  const fixDays = () => {
    const n = daysInMonth(y, m);
    if (day > n) day = n;
    if ($$('.wheel-item', wd.el).length !== n) wd.setItems(dayItems(), day - 1);
    preview();
  };
  const wd = createWheel({ items: dayItems(), index: day - 1, onChange: i => { day = i + 1; preview(); }, className: 'w-day' });
  const wm = createWheel({ items: MONTHS, index: m - 1, onChange: i => { m = i + 1; fixDays(); }, className: 'w-month' });
  const wy = createWheel({ items: years.map(String), index: years.indexOf(y), onChange: i => { y = years[i]; fixDays(); }, className: 'w-year' });
  host.append(wd.el, wm.el, wy.el);
  preview();

  $('.dp-quick', p.body).addEventListener('click', e => {
    const b = e.target.closest('[data-q]');
    if (!b) return;
    const t = new Date(); t.setDate(t.getDate() - Number(b.dataset.q));
    y = t.getFullYear(); m = t.getMonth() + 1; day = t.getDate();
    wy.jump(years.indexOf(y)); wm.jump(m - 1);
    wd.setItems(dayItems(), day - 1);
    tick();
    preview();
  });
  $('.dp-ok', p.body).addEventListener('click', () => {
    tick();
    onPick(ymd(new Date(y, m - 1, day)));
    p.close('ok');
  });
}

// =====================================================================
// Kategorie im Detail
// =====================================================================

function openCategory(id) {
  const cat = catById(id);
  const p = openPanel({ type: isMobile() ? 'sheet' : 'drawer', className: 'cat-panel', label: cat.name });
  p.el.style.setProperty('--c', cat.color);
  let editingBudget = false;

  const render = () => {
    const m = store.state.month;
    const { total, byCat } = store.monthTotals(m);
    const v = byCat[id];
    const b = store.budgetFor(id);
    const list = store.monthExpenses(m, id);
    const months = Array.from({ length: 6 }, (_, i) => addMonths(m, i - 5));
    const vals = months.map(mm => store.monthTotals(mm).byCat[id]);
    const max = Math.max(...vals, b || 0, 1);
    const state = catState(v, b);
    const scrollTop = p.body.scrollTop;

    p.body.innerHTML = `
      <div class="cd-head" data-drag>
        <span class="dot lg"></span><h2>${esc(cat.name)}</h2>
        <button class="icon-btn cd-close" type="button" aria-label="Schließen">${icons.close}</button>
      </div>
      <div class="cd-amount">${eur(v)}</div>
      <div class="cd-month">im ${monthLabel(m)}</div>
      <div class="cd-budget ${state}">
        ${b ? `<div class="bar"><i style="width:${p.body.classList.contains('shown') ? Math.min(100, (v / b) * 100) : 0}%"></i></div>
          <div class="cd-bl"><span>${pct((v / b) * 100)} von ${eur(b)}</span><span>${v > b ? `${eur(v - b)} drüber` : `${eur(b - v)} übrig`}</span></div>`
          : '<div class="cd-bl muted">Kein Budget festgelegt</div>'}
        <div class="cd-bedit" ${editingBudget ? '' : 'hidden'}>
          <label class="b-in"><input class="money-in cd-bin" inputmode="decimal" placeholder="—" value="${budgetStr(b)}" aria-label="Budget"><span>€</span></label>
          <button class="btn-dark cd-bsave" type="button">Fertig</button>
        </div>
        <button class="link cd-bbtn" type="button" ${editingBudget ? 'hidden' : ''}>${b ? 'Budget ändern' : 'Budget festlegen'}</button>
      </div>
      <div class="cd-stats">
        <div><span class="lbl">Anteil</span><span class="v">${total ? pct((v / total) * 100) : '—'}</span></div>
        <div><span class="lbl">Einträge</span><span class="v">${list.length}</span></div>
        <div><span class="lbl">Ø pro Eintrag</span><span class="v">${list.length ? eur(v / list.length) : '—'}</span></div>
      </div>
      <div class="cd-trend">
        <div class="sec-h"><span>Letzte 6 Monate</span>${b ? '<span class="legend-b">– – Budget</span>' : ''}</div>
        <div class="tbars">
          ${b ? `<span class="tline" style="bottom:${(b / max) * 100}%"></span>` : ''}
          ${months.map((mm, i) => `<div class="tcol ${mm === m ? 'cur' : ''}" style="--h:${(vals[i] / max) * 100}%" title="${monthLabel(mm)}: ${eur(vals[i])}">
            <span class="tv mono">${vals[i] ? eur0(vals[i]) : ''}</span>
            <span class="tb"></span>
            <span class="tl">${monthShort(mm)}</span></div>`).join('')}
        </div>
      </div>
      <div class="cd-list">
        <div class="sec-h"><span>Einträge</span></div>
        <div class="cd-entries">${list.map(e => entryRow(e)).join('') || '<div class="empty">In diesem Monat noch nichts.</div>'}</div>
      </div>
      <button class="btn-soft cd-add" type="button">${icons.plus}Ausgabe in ${esc(cat.name)}</button>`;

    p.body.scrollTop = scrollTop;
    bindEntries($('.cd-entries', p.body));
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const bar = $('.cd-budget .bar i', p.body);
      if (bar) bar.style.width = `${Math.min(100, (v / b) * 100)}%`;
      p.body.classList.add('shown');
    }));
    $('.cd-close', p.body).addEventListener('click', () => p.close());
    $('.cd-add', p.body).addEventListener('click', () => openEntry(null, { category: id }));
    $('.cd-bbtn', p.body).addEventListener('click', () => { editingBudget = true; render(); setTimeout(() => $('.cd-bin', p.body)?.focus(), 30); });
    const saveBudget = () => {
      const n = parseAmount($('.cd-bin', p.body).value);
      editingBudget = false;
      store.setCategoryBudget(id, n > 0 ? n : null);
      tick();
    };
    $('.cd-bsave', p.body).addEventListener('click', saveBudget);
    $('.cd-bin', p.body).addEventListener('keydown', e => { if (e.key === 'Enter') saveBudget(); });
  };

  render();
  const unsub = store.subscribe(render);
  const origClose = p.close;
  p.close = r => { unsub(); origClose(r); };
}

// =====================================================================
// Abo anlegen / bearbeiten
// =====================================================================

function openSub(sub = null) {
  const editing = !!sub;
  const p = openPanel({ className: 'sub-panel', label: editing ? 'Abo bearbeiten' : 'Neues Abo' });
  let cat = sub?.category || 'abos';
  let day = sub?.day || new Date().getDate();
  let active = sub ? sub.active : true;

  p.body.innerHTML = `
    <div class="ef-head" data-drag><span class="ef-title">${editing ? 'Abo bearbeiten' : 'Neues Abo'}</span></div>
    <label class="field"><span>Name</span><input class="f-name" placeholder="z. B. Gym, Spotify, Handy" maxlength="40" value="${esc(sub?.name || '')}"></label>
    <label class="field"><span>Betrag pro Monat</span><span class="f-money"><input class="f-amt money-in" inputmode="decimal" placeholder="0,00" value="${sub ? amountToStr(sub.amount) : ''}"><span>€</span></span></label>
    <div class="field"><span>Kategorie</span><div class="pills-wrap left">${CATS.map(c => `
      <button type="button" class="pill press" data-cat="${c.id}" style="--c:${c.color}"><span class="dot"></span>${esc(c.name)}</button>`).join('')}</div></div>
    <div class="field row"><span>Wird eingetragen am</span><div class="sub-wheel"><div class="dp-band"></div></div></div>
    ${editing ? `<label class="field row switch-row"><span>Aktiv</span><input type="checkbox" class="f-active" switch ${active ? 'checked' : ''}></label>` : ''}
    <div class="ef-actions">
      ${editing ? `<button class="btn-ghost s-del" type="button">${icons.trash}Löschen</button>` : ''}
      <button class="btn-dark s-save press" type="button">Speichern</button>
    </div>`;
  const b = p.body;
  const renderPills = () => $$('.pill', b).forEach(x => x.classList.toggle('sel', x.dataset.cat === cat));
  renderPills();
  $('.pills-wrap', b).addEventListener('click', e => { const x = e.target.closest('.pill'); if (x) { cat = x.dataset.cat; tick(); renderPills(); } });
  const w = createWheel({ items: Array.from({ length: 31 }, (_, i) => `${i + 1}.`), index: day - 1, rows: 3, h: 36, onChange: i => { day = i + 1; } });
  $('.sub-wheel', b).appendChild(w.el);
  $('.f-amt', b).addEventListener('input', e => { e.target.value = e.target.value.replace(/[^\d.,]/g, ''); });
  $('.f-active', b)?.addEventListener('change', e => { active = e.target.checked; });
  if (!editing && !isMobile()) setTimeout(() => $('.f-name', b).focus(), 60);

  $('.s-save', b).addEventListener('click', () => {
    const name = $('.f-name', b).value.trim();
    const amount = parseAmount($('.f-amt', b).value);
    if (!name) { shake($('.f-name', b).closest('.field')); return; }
    if (!(amount > 0)) { shake($('.f-amt', b).closest('.field')); return; }
    store.saveSub({ ...(sub ? { id: sub.id } : {}), name, amount, category: cat, day, active });
    tick('success');
    p.close('saved');
    toast(editing ? 'Abo gespeichert' : `Abo angelegt · jeden Monat am ${day}.`);
  });
  $('.s-del', b)?.addEventListener('click', () => {
    if (!confirm(`„${sub.name}“ löschen? Bereits eingetragene Beträge bleiben erhalten.`)) return;
    store.deleteSub(sub.id);
    p.close('deleted');
    toast('Abo gelöscht');
  });
}

// =====================================================================
// Anmeldung (einmalig per E-Mail-Code oder -Link)
// =====================================================================

function showLogin(show) {
  const el = $('#login');
  if (!show) { el.classList.remove('show'); setTimeout(() => { el.hidden = true; }, 400); return; }
  el.hidden = false;
  void el.offsetWidth; // Layout erzwingen, damit das Einblenden animiert
  el.classList.add('show');
  let email = '';
  const step1 = () => {
    el.querySelector('.login-body').innerHTML = `
      <p class="login-lead">Melde dich einmal an, damit Mac und iPhone dieselben Daten sehen.</p>
      <form class="login-form">
        <input type="email" class="l-email" placeholder="E-Mail-Adresse" autocomplete="email" required value="${esc(email)}">
        <button class="btn-dark press" type="submit">Anmeldecode senden</button>
        <p class="l-err" role="alert"></p>
      </form>`;
    const f = el.querySelector('.login-form');
    f.addEventListener('submit', async e => {
      e.preventDefault();
      email = f.querySelector('.l-email').value.trim();
      const btn = f.querySelector('button');
      btn.disabled = true; btn.textContent = 'Sende …';
      try { await sync.sendCode(email); step2(); }
      catch (err) { f.querySelector('.l-err').textContent = friendlyError(err); btn.disabled = false; btn.textContent = 'Anmeldecode senden'; }
    });
  };
  const step2 = () => {
    el.querySelector('.login-body').innerHTML = `
      <p class="login-lead">Wir haben dir eine E-Mail an <b>${esc(email)}</b> geschickt. Gib den Code ein oder tippe auf den Link in der Mail.</p>
      <form class="login-form">
        <input class="l-code mono" inputmode="numeric" autocomplete="one-time-code" placeholder="Code" maxlength="8" required>
        <button class="btn-dark press" type="submit">Anmelden</button>
        <p class="l-err" role="alert"></p>
        <button class="link l-back" type="button">Andere E-Mail verwenden</button>
      </form>`;
    const f = el.querySelector('.login-form');
    f.querySelector('.l-code').focus();
    f.querySelector('.l-back').addEventListener('click', step1);
    f.addEventListener('submit', async e => {
      e.preventDefault();
      const btn = f.querySelector('button[type=submit]');
      btn.disabled = true; btn.textContent = 'Prüfe …';
      try { await sync.verifyCode(email, f.querySelector('.l-code').value.replace(/\s/g, '')); }
      catch (err) { f.querySelector('.l-err').textContent = friendlyError(err); btn.disabled = false; btn.textContent = 'Anmelden'; shake(f); }
    });
  };
  step1();
}

function friendlyError(err) {
  const m = String(err?.message || err);
  if (/expired|invalid/i.test(m)) return 'Der Code ist ungültig oder abgelaufen.';
  if (/rate|too many|seconds/i.test(m)) return 'Kurz warten, dann nochmal versuchen.';
  if (/fetch|network/i.test(m)) return 'Keine Verbindung. Bist du online?';
  return m;
}

// =====================================================================
// Start
// =====================================================================

async function boot() {
  setupChrome();
  store.bookSubscriptions();
  mountView();
  store.subscribe(reason => {
    const h = store.takeHighlight();
    if (h) justAdded = h;
    if (reason === 'month') renderMonthLabel(0);
    view?.update(reason);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    store.bookSubscriptions();
    view?.update('visible');
  });
  const toToday = () => { if (store.state.month !== monthOf(todayYmd())) { store.setMonth(monthOf(todayYmd())); renderMonthLabel(0); tick(); } };
  $('.m-today').addEventListener('click', toToday);
  $('.m-label').addEventListener('click', toToday);

  const mode = await sync.init();
  if (mode === 'signed-out') showLogin(true);
  sync.onAuth(s => {
    if (s) { showLogin(false); toast(`Angemeldet als ${s.user.email}`); }
    else showLogin(true);
    view?.update('auth');
  });

  if ('serviceWorker' in navigator && !new URLSearchParams(location.search).has('nosw')) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

boot();
