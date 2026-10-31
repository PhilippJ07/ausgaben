// Synchronisierung mit Supabase (Mac <-> iPhone).
// Prinzip: Jede Änderung landet sofort lokal und in einer Warteschlange ("pending").
// Online wird die Schlange hochgeladen, danach der Serverstand gezogen. Echtzeit-Updates halten Geräte gleich.
import { CONFIG } from './config.js';
import * as store from './store.js';

const CDN = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
const PKEY = 'ausgaben.pending';
const TABLE = { expenses: 'expenses', subs: 'subscriptions', settings: 'settings' };

export const enabled = Boolean(CONFIG.supabaseUrl && CONFIG.supabaseAnonKey);

let sb = null;
let session = null;
let status = enabled ? 'connecting' : 'local';
let flushing = false;
let flushTimer = null;
let channel = null;
const statusListeners = new Set();
const authListeners = new Set();

let pending = (() => { try { return JSON.parse(localStorage.getItem(PKEY)) || {}; } catch { return {}; } })();
const savePending = () => { try { localStorage.setItem(PKEY, JSON.stringify(pending)); } catch { /* egal */ } };
const isPending = key => key in pending;

store.setChangeHook((table, row) => {
  const key = `${table}:${table === 'settings' ? 'me' : row.id}`;
  pending[key] = { table, row: JSON.parse(JSON.stringify(row)) };
  savePending();
  scheduleFlush();
});

export const onStatus = fn => { statusListeners.add(fn); fn(status); return () => statusListeners.delete(fn); };
export const onAuth = fn => { authListeners.add(fn); return () => authListeners.delete(fn); };
export const getSession = () => session;
export const getStatus = () => status;
function setStatus(s) { if (s === status) return; status = s; statusListeners.forEach(fn => fn(s)); }

// ---------- Mapping lokal <-> Datenbank ----------
const toDb = {
  expenses: r => ({ id: r.id, amount: r.amount, category: r.category, date: r.date, note: r.note || '', sub_id: r.subId, created_at: r.createdAt, updated_at: r.updatedAt, deleted: !!r.deleted }),
  subs: r => ({ id: r.id, name: r.name, amount: r.amount, category: r.category, day: r.day, start_month: r.startMonth, active: !!r.active, created_at: r.createdAt, updated_at: r.updatedAt, deleted: !!r.deleted }),
  settings: r => ({ monthly_budget: r.monthlyBudget, budgets: r.budgets, updated_at: r.updatedAt }),
};
const iso = t => new Date(t).toISOString();
const fromDb = {
  expenses: r => ({ id: r.id, amount: Number(r.amount), category: r.category, date: r.date, note: r.note || '', subId: r.sub_id, createdAt: iso(r.created_at), updatedAt: iso(r.updated_at), deleted: !!r.deleted }),
  subs: r => ({ id: r.id, name: r.name, amount: Number(r.amount), category: r.category, day: r.day, startMonth: r.start_month, active: !!r.active, createdAt: iso(r.created_at), updatedAt: iso(r.updated_at), deleted: !!r.deleted }),
  settings: r => ({ monthlyBudget: r.monthly_budget == null ? null : Number(r.monthly_budget), budgets: r.budgets || {}, updatedAt: iso(r.updated_at) }),
};

// ---------- Hochladen ----------
function scheduleFlush(delay = 400) {
  if (!sb || !session) return;
  clearTimeout(flushTimer);
  flushTimer = setTimeout(flush, delay);
}

async function flush() {
  if (!sb || !session || flushing) return;
  if (!navigator.onLine) { setStatus('offline'); return; }
  const entries = Object.entries(pending);
  if (!entries.length) { setStatus('synced'); return; }
  flushing = true;
  setStatus('syncing');
  try {
    const groups = {};
    for (const [key, { table, row }] of entries) {
      const generated = table === 'expenses' && row.updatedAt === store.EPOCH;
      (groups[`${table}|${generated}`] ||= []).push([key, row]);
    }
    for (const g of Object.keys(groups)) {
      const [table, generated] = g.split('|');
      const rows = groups[g].map(([, r]) => ({ ...toDb[table](r), user_id: session.user.id }));
      const { error } = await sb.from(TABLE[table]).upsert(rows, {
        onConflict: table === 'settings' ? 'user_id' : 'id',
        ignoreDuplicates: generated === 'true',
      });
      if (error) throw error;
      for (const [key, r] of groups[g]) if (pending[key]?.row.updatedAt === r.updatedAt) delete pending[key];
    }
    savePending();
    setStatus(Object.keys(pending).length ? 'syncing' : 'synced');
  } catch (err) {
    console.warn('[sync] Upload fehlgeschlagen', err);
    setStatus(navigator.onLine ? 'error' : 'offline');
  } finally {
    flushing = false;
    if (Object.keys(pending).length && status !== 'offline') scheduleFlush(status === 'error' ? 8000 : 300);
  }
}

// ---------- Herunterladen ----------
async function pull() {
  if (!sb || !session || !navigator.onLine) return;
  try {
    for (const table of ['settings', 'subs', 'expenses']) {
      const { data, error } = await sb.from(TABLE[table]).select('*');
      if (error) throw error;
      store.mergeRemote(table, data.map(fromDb[table]), isPending);
    }
    store.bookSubscriptions();
  } catch (err) {
    console.warn('[sync] Download fehlgeschlagen', err);
    setStatus('error');
  }
}

export async function syncNow() { await flush(); await pull(); await flush(); }

function startRealtime() {
  if (channel) return;
  channel = sb.channel('ausgaben-sync');
  for (const table of Object.keys(TABLE)) {
    channel.on('postgres_changes', { event: '*', schema: 'public', table: TABLE[table] }, payload => {
      if (payload.new && Object.keys(payload.new).length) store.mergeRemote(table, [fromDb[table](payload.new)], isPending);
    });
  }
  channel.subscribe();
}

let started = false;
function start() {
  if (started) return;
  started = true;
  syncNow();
  startRealtime();
}

function stop() {
  started = false;
  if (channel) { sb.removeChannel(channel); channel = null; }
}

addEventListener('online', () => { if (session) syncNow(); });
addEventListener('offline', () => { if (enabled) setStatus('offline'); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && session) syncNow(); });

// ---------- Anmeldung ----------
/** @returns {'local'|'signed-in'|'signed-out'|'unavailable'} */
export async function init() {
  if (!enabled) return 'local';
  try {
    const { createClient } = await import(CDN);
    sb = createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'ausgaben.auth' },
    });
  } catch (err) {
    // Offline ohne Cache: App trotzdem lokal nutzen, später erneut versuchen.
    console.warn('[sync] Supabase nicht erreichbar', err);
    setStatus('offline');
    return 'unavailable';
  }
  const { data } = await sb.auth.getSession();
  session = data.session;
  sb.auth.onAuthStateChange((_event, s) => {
    const had = !!session;
    session = s;
    if (s && !had) start();
    if (!s && had) stop();
    if (!!s !== had) authListeners.forEach(fn => fn(s));
  });
  if (session) { start(); return 'signed-in'; }
  setStatus('signed-out');
  return 'signed-out';
}

export async function sendCode(email) {
  const { error } = await sb.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: location.origin + location.pathname, shouldCreateUser: true },
  });
  if (error) throw error;
}

export async function verifyCode(email, token) {
  const { error } = await sb.auth.verifyOtp({ email, token, type: 'email' });
  if (error) throw error;
}

export async function signOut() {
  stop();
  await sb.auth.signOut();
  pending = {};
  savePending();
  store.resetLocal();
}
