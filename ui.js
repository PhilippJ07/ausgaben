// UI-Bausteine: Sheets/Dialoge, Toast, Zahlen-Animation, Drehrad, Wischen, Icons.
import { tick } from './haptics.js';

export const MOBILE_QUERY = '(max-width: 899px), (max-height: 520px) and (pointer: coarse)';
const mq = matchMedia(MOBILE_QUERY);
export const isMobile = () => mq.matches;
export const onLayoutChange = fn => mq.addEventListener('change', fn);
export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------- Icons (1.5px Linien, ruhig) ----------
const svg = (d, s = 20) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
export const icons = {
  overview: svg('<circle cx="12" cy="12" r="8"/><path d="M12 4v8l5.5 5.5"/>'),
  home: svg('<path d="M4 11l8-7 8 7"/><path d="M6 9.5V20h12V9.5"/><path d="M10 20v-6h4v6"/>'),
  stats: svg('<path d="M6 20v-7M12 20V5M18 20v-10"/>'),
  list: svg('<path d="M8 7h11M8 12h11M8 17h11"/><circle cx="4.5" cy="7" r=".6" fill="currentColor"/><circle cx="4.5" cy="12" r=".6" fill="currentColor"/><circle cx="4.5" cy="17" r=".6" fill="currentColor"/>'),
  budgets: svg('<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>', 18),
  edit: svg('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>', 16),
  trash: svg('<path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12"/>', 16),
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>', 18),
  chevL: svg('<path d="M14 6l-6 6 6 6"/>', 16),
  chevR: svg('<path d="M10 6l6 6-6 6"/>', 16),
  chevD: svg('<path d="M7 10l5 5 5-5"/>', 14),
  backspace: svg('<path d="M9 5h10a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H9l-6-7z"/><path d="M12 9.5l5 5M17 9.5l-5 5"/>', 26),
  repeat: svg('<path d="M4 11V9a3 3 0 0 1 3-3h12l-3-3M20 13v2a3 3 0 0 1-3 3H5l3 3"/>', 12),
  note: svg('<path d="M5 4h14v16H5z"/><path d="M9 9h6M9 13h6"/>', 14),
};

// ---------- Zahlen weich hochzählen ----------
const easeOut = t => 1 - Math.pow(1 - t, 3); // entspricht --ease-ring in styles.css
export function tween(el, to, fmt, dur = 1500) {
  const from = el._cur ?? 0;
  cancelAnimationFrame(el._raf);
  clearTimeout(el._end);
  if (reducedMotion() || from === to) { el._cur = to; el.textContent = fmt(to); return; }
  const t0 = performance.now();
  const step = t => {
    const p = Math.min(1, (t - t0) / dur);
    el._cur = from + (to - from) * easeOut(p);
    el.textContent = fmt(el._cur);
    if (p < 1) el._raf = requestAnimationFrame(step);
  };
  el._raf = requestAnimationFrame(step);
  // Falls der Browser Frames pausiert (Hintergrund), steht am Ende trotzdem der richtige Wert da
  el._end = setTimeout(() => { cancelAnimationFrame(el._raf); el._cur = to; el.textContent = fmt(to); }, dur + 80);
}

// ---------- Panels: Sheet (mobil), Dialog & Drawer (Mac) ----------
const layer = () => document.getElementById('layer');
const stack = [];

export function openPanel({ type = isMobile() ? 'sheet' : 'dialog', className = '', onClose, label = '' } = {}) {
  const wrap = document.createElement('div');
  wrap.className = `pwrap pwrap-${type}`;
  wrap.innerHTML = `<div class="backdrop"></div>
    <div class="panel panel-${type} ${className}" role="dialog" aria-modal="true" aria-label="${label}">
      ${type === 'sheet' ? '<div class="grab-zone" data-drag><div class="grabber"></div></div>' : ''}
      <div class="panel-body"></div>
    </div>`;
  layer().appendChild(wrap);
  const panel = wrap.querySelector('.panel');
  const body = wrap.querySelector('.panel-body');
  const prevFocus = document.activeElement;

  let closed = false;
  const api = {
    el: panel, body, wrap, type,
    close(reason) {
      if (closed) return;
      closed = true;
      wrap.classList.remove('open');
      wrap.classList.add('closing');
      panel.style.transform = '';
      const i = stack.indexOf(api);
      if (i >= 0) stack.splice(i, 1);
      updateBodyState();
      const done = () => { wrap.remove(); onClose?.(reason); };
      if (reducedMotion()) done(); else setTimeout(done, type === 'sheet' ? 420 : 260);
      if (prevFocus?.focus && !isMobile()) prevFocus.focus({ preventScroll: true });
    },
  };
  stack.push(api);
  updateBodyState();
  wrap.querySelector('.backdrop').addEventListener('click', () => api.close('backdrop'));
  if (type === 'sheet') enableSheetDrag(panel, api);
  requestAnimationFrame(() => requestAnimationFrame(() => wrap.classList.add('open')));
  return api;
}

export const topPanel = () => stack[stack.length - 1];
export const closeAllPanels = () => [...stack].reverse().forEach(p => p.close());

function updateBodyState() {
  const hasSheet = stack.some(p => p.type === 'sheet');
  const app = document.getElementById('app');
  if (hasSheet && !document.body.classList.contains('sheet-open')) {
    app.style.transformOrigin = `50% ${scrollY + innerHeight / 2}px`;
  }
  document.body.classList.toggle('sheet-open', hasSheet);
  document.documentElement.classList.toggle('no-scroll', stack.length > 0);
}

addEventListener('keydown', e => {
  if (e.key === 'Escape' && stack.length) { e.preventDefault(); topPanel().close('esc'); }
});

function enableSheetDrag(panel, api) {
  let y0 = null, dy = 0, t0 = 0, dragging = false;
  panel.addEventListener('pointerdown', e => {
    const handle = e.target.closest('[data-drag]');
    const body = panel.querySelector('.panel-body');
    if (!handle && (e.target.closest('input,textarea,button,.wheel,.keypad,.no-drag') || body.scrollTop > 0)) return;
    y0 = e.clientY; dy = 0; t0 = performance.now(); dragging = false;
  });
  panel.addEventListener('pointermove', e => {
    if (y0 == null) return;
    const d = e.clientY - y0;
    if (!dragging) {
      if (d > 6) { dragging = true; try { panel.setPointerCapture(e.pointerId); } catch { /* egal */ } panel.classList.add('dragging'); }
      else if (d < -6) { y0 = null; return; }
      else return;
    }
    dy = Math.max(0, d);
    panel.style.transform = `translateY(${dy}px)`;
    panel.parentElement.style.setProperty('--drag', Math.max(0, 1 - dy / 400));
  });
  const end = () => {
    if (y0 == null) return;
    y0 = null;
    if (!dragging) return;
    dragging = false;
    panel.classList.remove('dragging');
    panel.parentElement.style.removeProperty('--drag');
    const v = dy / Math.max(1, performance.now() - t0);
    if (dy > 140 || (v > 0.6 && dy > 40)) api.close('drag');
    else panel.style.transform = '';
  };
  panel.addEventListener('pointerup', end);
  panel.addEventListener('pointercancel', end);
}

// ---------- Toast mit Rückgängig ----------
let toastTimer;
export function toast(message, { action, onAction, duration = 4200 } = {}) {
  const el = document.getElementById('toast');
  clearTimeout(toastTimer);
  el.innerHTML = `<span class="toast-msg"></span>${action ? `<button class="toast-btn" type="button"></button>` : ''}`;
  el.querySelector('.toast-msg').textContent = message;
  if (action) {
    const b = el.querySelector('.toast-btn');
    b.textContent = action;
    b.onclick = () => { hide(); onAction?.(); };
  }
  el.classList.remove('show');
  void el.offsetWidth;
  el.classList.add('show');
  const hide = () => { el.classList.remove('show'); };
  toastTimer = setTimeout(hide, duration);
}

// ---------- Drehrad (wie iOS-Uhr/Wecker) ----------
export function createWheel({ items, index = 0, onChange, rows = 5, h = 40, className = '' }) {
  const el = document.createElement('div');
  el.className = `wheel ${className}`;
  el.style.setProperty('--rows', rows);
  el.style.setProperty('--h', `${h}px`);
  const inner = document.createElement('div');
  inner.className = 'wheel-inner';
  el.appendChild(inner);
  let cur = index, raf = 0, settleTimer = 0, programmatic = false;

  const paint = () => {
    raf = 0;
    const center = el.scrollTop + el.clientHeight / 2;
    for (const child of inner.children) {
      const d = (child.offsetTop + h / 2 - center) / h;
      const a = Math.max(-80, Math.min(80, -d * 20));
      child.style.transform = `rotateX(${a}deg) translateZ(0)`;
      child.style.opacity = Math.max(0.12, 1 - Math.abs(d) * 0.3).toFixed(3);
      child.classList.toggle('sel', Math.abs(d) < 0.5);
    }
  };
  const setIdx = i => {
    i = Math.max(0, Math.min(inner.children.length - 1, i));
    if (i === cur) return;
    cur = i;
    if (!programmatic) tick();
    onChange?.(i);
  };
  el.addEventListener('scroll', () => {
    if (!raf) raf = requestAnimationFrame(paint);
    setIdx(Math.round(el.scrollTop / h));
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => { programmatic = false; }, 120);
  }, { passive: true });
  inner.addEventListener('click', e => {
    const item = e.target.closest('.wheel-item');
    if (!item) return;
    el.scrollTo({ top: [...inner.children].indexOf(item) * h, behavior: 'smooth' });
  });

  const api = {
    el,
    get index() { return cur; },
    setItems(list, i = cur) {
      inner.innerHTML = list.map(t => `<div class="wheel-item">${t}</div>`).join('');
      cur = Math.max(0, Math.min(list.length - 1, i));
      api.jump(cur);
    },
    jump(i, smooth = false) {
      programmatic = true;
      const apply = () => { el.scrollTo({ top: i * h, behavior: smooth ? 'smooth' : 'instant' }); paint(); };
      // Sofort, falls schon eingehängt; sonst direkt nach dem Einhängen (Microtask) und zur Sicherheit im nächsten Frame
      if (el.isConnected) apply();
      else queueMicrotask(() => { if (el.isConnected) apply(); });
      requestAnimationFrame(apply);
    },
  };
  api.setItems(items, index);
  return api;
}

// ---------- Nach links wischen zum Löschen (Touch) ----------
let openRow = null;
export function attachSwipe(row, { onDelete }) {
  const inner = row.querySelector('.entry-inner');
  const W = 84;
  let x0 = null, y0 = 0, dx = 0, dragging = false, isOpen = false, armed = false;
  const set = (x, anim) => {
    inner.style.transition = anim ? '' : 'none';
    inner.style.transform = x ? `translateX(${x}px)` : '';
  };
  const close = () => { isOpen = false; set(0, true); row.classList.remove('swiped'); if (openRow === api) openRow = null; };
  const api = { close };

  inner.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse') return;
    if (openRow && openRow !== api) openRow.close();
    x0 = e.clientX; y0 = e.clientY; dragging = false; dx = isOpen ? -W : 0;
  });
  inner.addEventListener('pointermove', e => {
    if (x0 == null) return;
    const mx = e.clientX - x0, my = e.clientY - y0;
    if (!dragging) {
      if (Math.abs(mx) > 8 && Math.abs(mx) > Math.abs(my) * 1.3) { dragging = true; try { inner.setPointerCapture(e.pointerId); } catch { /* egal */ } }
      else if (Math.abs(my) > 10) { x0 = null; return; } else return;
    }
    let x = (isOpen ? -W : 0) + mx;
    if (x > 0) x = x * 0.2;
    const full = row.offsetWidth * 0.5;
    const nowArmed = x < -full;
    if (nowArmed !== armed) { armed = nowArmed; row.classList.toggle('armed', armed); tick(); }
    dx = x;
    set(x, false);
    row.classList.toggle('swiped', x < -4);
  });
  const end = () => {
    if (x0 == null) return;
    x0 = null;
    if (!dragging) return;
    dragging = false;
    row._suppressClick = true;
    setTimeout(() => { row._suppressClick = false; }, 60);
    if (armed) { armed = false; set(-row.offsetWidth, true); onDelete(); return; }
    if (dx < -W / 2) { isOpen = true; openRow = api; set(-W, true); }
    else close();
  };
  inner.addEventListener('pointerup', end);
  inner.addEventListener('pointercancel', end);
  row.querySelector('.entry-del')?.addEventListener('click', e => { e.stopPropagation(); onDelete(); });
  return api;
}

/** Zeile weich zusammenklappen, dann Callback. */
export function collapse(el, cb) {
  if (!el || reducedMotion()) { cb(); return; }
  el.style.height = el.offsetHeight + 'px';
  el.style.overflow = 'hidden';
  void el.offsetHeight;
  el.classList.add('collapsing');
  el.style.height = '0px';
  setTimeout(cb, 300);
}

/** Kurzes "Nein"-Schütteln. */
export function shake(el) {
  el.classList.remove('shake');
  void el.offsetWidth;
  el.classList.add('shake');
}

/** Drückeffekt für Buttons auf Touch (iOS ignoriert :active sonst oft). */
export function pressable(root) {
  root.addEventListener('pointerdown', e => {
    const b = e.target.closest('.press');
    if (!b) return;
    b.classList.add('pressed');
    const up = () => { b.classList.remove('pressed'); removeEventListener('pointerup', up); removeEventListener('pointercancel', up); };
    addEventListener('pointerup', up);
    addEventListener('pointercancel', up);
  });
}
