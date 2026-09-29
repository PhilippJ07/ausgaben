// Zentraler Zustand: Ausgaben, Abos, Budgets. Lokal gespeichert, Sync hängt sich über onChange ein.
import { CATS, DEFAULT_BUDGETS, DEFAULT_MONTHLY_BUDGET } from './categories.js';
import { todayYmd, monthOf, addMonths, daysInMonth, uid, pad, round2 } from './format.js';

const KEY = 'ausgaben.v1';
/** Automatisch erzeugte Abo-Buchungen bekommen diesen Zeitstempel, damit jede Server-Version gewinnt. */
export const EPOCH = '1970-01-01T00:00:00.000Z';
const now = () => new Date().toISOString();

function defaults() {
  return {
    expenses: [],
    subs: [],
    settings: { monthlyBudget: DEFAULT_MONTHLY_BUDGET, budgets: { ...DEFAULT_BUDGETS }, updatedAt: EPOCH },
    month: monthOf(todayYmd()),
  };
}

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && Array.isArray(s.expenses)) return { ...defaults(), ...s, month: monthOf(todayYmd()) };
  } catch { /* leer starten */ }
  return defaults();
}

export const state = load();

const listeners = new Set();
let onChange = () => {};
export const setChangeHook = fn => { onChange = fn; };

// Neu angelegte/wiederhergestellte Einträge kurz hervorheben (wird beim nächsten Rendern abgeholt)
let highlightId = null;
export const takeHighlight = () => { const id = highlightId; highlightId = null; return id; };
export const subscribe = fn => { listeners.add(fn); return () => listeners.delete(fn); };

let saveTimer;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(KEY, JSON.stringify({ expenses: state.expenses, subs: state.subs, settings: state.settings })); } catch { /* voll/privat */ }
  }, 120);
}
function emit(reason) { persist(); listeners.forEach(fn => fn(reason)); }

export function resetLocal() {
  Object.assign(state, defaults());
  try { localStorage.removeItem(KEY); } catch { /* egal */ }
  emit('reset');
}

// ---------- Monat ----------
export function setMonth(m) { state.month = m; listeners.forEach(fn => fn('month')); }

// ---------- Ausgaben ----------
const findExpense = id => state.expenses.find(e => e.id === id);

export function addExpense({ amount, category, date, note = '' }) {
  const t = now();
  const e = { id: uid(), amount: round2(amount), category, date, note: note.trim(), subId: null, createdAt: t, updatedAt: t, deleted: false };
  state.expenses.push(e);
  highlightId = e.id;
  onChange('expenses', e);
  emit('expenses');
  return e;
}

/** Gibt den vorherigen Stand zurück (für "Rückgängig"). */
export function updateExpense(id, patch) {
  const e = findExpense(id);
  if (!e) return null;
  const prev = { ...e };
  Object.assign(e, patch, { updatedAt: now() });
  if (patch.note != null) e.note = patch.note.trim();
  onChange('expenses', e);
  emit('expenses');
  return prev;
}

export const deleteExpense = id => updateExpense(id, { deleted: true });

export function restoreExpense(snapshot) {
  const { updatedAt, ...rest } = snapshot;
  highlightId = snapshot.id;
  return updateExpense(snapshot.id, rest);
}

// ---------- Budgets ----------
export function setMonthlyBudget(n) {
  state.settings = { ...state.settings, monthlyBudget: n, updatedAt: now() };
  onChange('settings', state.settings);
  emit('settings');
}

export function setCategoryBudget(cat, n) {
  const budgets = { ...state.settings.budgets };
  if (n == null || !(n > 0)) delete budgets[cat]; else budgets[cat] = n;
  state.settings = { ...state.settings, budgets, updatedAt: now() };
  onChange('settings', state.settings);
  emit('settings');
}

// ---------- Abos ----------
export function saveSub(data) {
  const t = now();
  let s = data.id && state.subs.find(x => x.id === data.id);
  // Nach einer Pause erst ab dem aktuellen Monat weiterbuchen (keine Nachbuchung der Pausenmonate)
  if (s && !s.active && data.active) data = { ...data, startMonth: monthOf(todayYmd()) };
  if (s) Object.assign(s, data, { updatedAt: t });
  else {
    s = { id: uid(), active: true, deleted: false, startMonth: monthOf(todayYmd()), createdAt: t, ...data, updatedAt: t };
    state.subs.push(s);
  }
  onChange('subs', s);
  bookSubscriptions(false);
  emit('subs');
  return s;
}

export function deleteSub(id) {
  const s = state.subs.find(x => x.id === id);
  if (!s) return;
  Object.assign(s, { deleted: true, updatedAt: now() });
  onChange('subs', s);
  emit('subs');
}

/** Legt fällige Abo-Buchungen an (idempotent, deterministische IDs). */
export function bookSubscriptions(notify = true) {
  const today = todayYmd();
  const cur = monthOf(today);
  let added = 0;
  for (const s of state.subs) {
    if (s.deleted || !s.active) continue;
    for (let m = s.startMonth; m <= cur; m = addMonths(m, 1)) {
      const [y, mo] = m.split('-').map(Number);
      const day = Math.min(s.day, daysInMonth(y, mo));
      const date = `${m}-${pad(day)}`;
      if (date > today) break;
      const id = `sub:${s.id}:${m}`;
      if (findExpense(id)) continue;
      const e = { id, amount: s.amount, category: s.category, date, note: s.name, subId: s.id, createdAt: `${date}T08:00:00.000Z`, updatedAt: EPOCH, deleted: false };
      state.expenses.push(e);
      onChange('expenses', e);
      added++;
    }
  }
  if (added && notify) emit('expenses');
  return added;
}

// ---------- Server-Daten einmischen ----------
export function mergeRemote(table, rows, isPending) {
  if (table === 'settings') {
    const r = rows[0];
    if (r && (r.updatedAt >= state.settings.updatedAt || !isPending('settings:me'))) state.settings = r;
  } else {
    const list = table === 'expenses' ? state.expenses : state.subs;
    const idx = new Map(list.map((x, i) => [x.id, i]));
    for (const r of rows) {
      const i = idx.get(r.id);
      if (i == null) { list.push(r); idx.set(r.id, list.length - 1); continue; }
      const local = list[i];
      if (isPending(`${table}:${r.id}`) && local.updatedAt > r.updatedAt) continue;
      list[i] = r;
    }
  }
  emit('remote');
}

// ---------- Abgeleitete Werte ----------
const sortDesc = (a, b) => (b.date.localeCompare(a.date)) || (b.createdAt.localeCompare(a.createdAt));

export const activeExpenses = () => state.expenses.filter(e => !e.deleted);
export const monthExpenses = (m, cat) => activeExpenses()
  .filter(e => e.date.startsWith(m) && (!cat || e.category === cat))
  .sort(sortDesc);
/** Zuletzt eingetragen (nicht nach Datum), damit man Vertipper sofort sieht. */
export const recentExpenses = (n = 3) => activeExpenses().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, n);

export function monthTotals(m) {
  const byCat = Object.fromEntries(CATS.map(c => [c.id, 0]));
  let total = 0;
  for (const e of activeExpenses()) {
    if (!e.date.startsWith(m)) continue;
    const c = byCat[e.category] != null ? e.category : 'sonstiges';
    byCat[c] += e.amount;
    total += e.amount;
  }
  for (const k in byCat) byCat[k] = round2(byCat[k]);
  return { total: round2(total), byCat };
}

export const budgetFor = cat => state.settings.budgets[cat] ?? null;
export const activeSubs = () => state.subs.filter(s => !s.deleted);
export const expenseById = findExpense;
