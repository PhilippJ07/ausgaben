// Feiner Ring (SVG). Segmente morphen weich zwischen Monaten, das aktive Segment wird dicker,
// die übrigen werden blass. Mitte blendet zwischen Gesamt- und Kategorieansicht über.
import { CATS } from './categories.js';
import { isMobile } from './ui.js';
import { tick } from './haptics.js';

const NS = 'http://www.w3.org/2000/svg';

export function createDonut({ size = 220, stroke = 9, gapDeg = 1.6, onOpen, onActive }) {
  const r = (size - stroke) / 2;
  const C = 2 * Math.PI * r;
  const c = size / 2;
  const root = document.createElement('div');
  root.className = 'donut';
  root.style.setProperty('--size', `${size}px`);
  root.style.setProperty('--stroke', stroke);
  root.innerHTML = `
    <svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" overflow="visible">
      <circle class="d-track" cx="${c}" cy="${c}" r="${r}" stroke-width="${stroke}"/>
      <g class="d-segs" transform="rotate(-90 ${c} ${c})"></g>
      <g class="d-hits" transform="rotate(-90 ${c} ${c})"></g>
    </svg>
    <div class="d-center">
      <div class="d-layer d-default"><span class="d-lbl"></span><span class="d-val"></span><span class="d-sub"></span></div>
      <div class="d-layer d-active"><span class="d-lbl"></span><span class="d-val"></span><span class="d-sub"></span></div>
    </div>`;
  const svg = root.querySelector('svg');
  const segG = root.querySelector('.d-segs');
  const hitG = root.querySelector('.d-hits');
  const segs = {}, hits = {};
  let data = {}, active = null, first = true;

  for (const cat of CATS) {
    const s = document.createElementNS(NS, 'circle');
    Object.entries({ cx: c, cy: c, r, 'stroke-width': stroke, class: 'd-seg' }).forEach(([k, v]) => s.setAttribute(k, v));
    s.style.stroke = cat.color;
    s.style.strokeDasharray = `0 ${C}`;
    segG.appendChild(s);
    segs[cat.id] = s;
    const h = document.createElementNS(NS, 'circle');
    Object.entries({ cx: c, cy: c, r, 'stroke-width': stroke + 22, class: 'd-hit' }).forEach(([k, v]) => h.setAttribute(k, v));
    h.dataset.id = cat.id;
    h.style.strokeDasharray = `0 ${C}`;
    hitG.appendChild(h);
    hits[cat.id] = h;
  }

  function setActive(id, { silent = false } = {}) {
    if (id && !(data[id] > 0)) id = null;
    if (id === active) return;
    active = id;
    root.classList.toggle('has-active', !!id);
    for (const k in segs) segs[k].classList.toggle('on', k === id);
    if (id) api.renderActive?.(id);
    if (!silent) onActive?.(id);
  }

  // Maus: Hover hebt hervor, Klick öffnet. Touch: erster Tipp hebt hervor, zweiter öffnet.
  hitG.addEventListener('pointerover', e => { if (e.pointerType === 'mouse') setActive(e.target.dataset.id); });
  hitG.addEventListener('pointerout', e => { if (e.pointerType === 'mouse' && !hitG.contains(e.relatedTarget)) setActive(null); });
  hitG.addEventListener('click', e => {
    const id = e.target.dataset.id;
    if (!id) return;
    if (isMobile() && active !== id) { setActive(id); tick(); return; }
    onOpen?.(id);
  });
  root.querySelector('.d-center').addEventListener('click', () => { if (active) onOpen?.(active); });
  const outside = e => {
    if (e.pointerType !== 'mouse' && active && !root.contains(e.target) && !e.target.closest('.cat-row,.legend-row')) setActive(null);
  };
  document.addEventListener('pointerdown', outside);

  // Zeichnet immer den aktuellen Stand (auch wenn zwischen zwei Frames neue Daten kamen)
  let pendingFrame = 0;
  function apply() {
    pendingFrame = 0;
    const vals = Object.values(data);
    const total = vals.reduce((a, b) => a + b, 0);
    const gap = vals.filter(v => v > 0).length > 1 ? (C * gapDeg) / 360 : 0;
    let start = 0;
    for (const cat of CATS) {
      const v = data[cat.id] || 0;
      const len = total > 0 ? (v / total) * C : 0;
      segs[cat.id].style.strokeDasharray = `${Math.max(0, len - gap)} ${C}`;
      segs[cat.id].style.strokeDashoffset = `${-(start + gap / 2)}`;
      hits[cat.id].style.strokeDasharray = `${len} ${C}`;
      hits[cat.id].style.strokeDashoffset = `${-start}`;
      segs[cat.id].classList.toggle('zero', v <= 0);
      start += len;
    }
  }

  const api = {
    el: root,
    setActive,
    get active() { return active; },
    /** values: {catId: betrag} */
    update(values) {
      data = values;
      root.classList.toggle('empty', !Object.values(values).some(v => v > 0));
      if (first) {
        // Erst im übernächsten Frame zeichnen, damit der Ring beim Öffnen "einläuft"
        first = false;
        pendingFrame = requestAnimationFrame(() => { pendingFrame = requestAnimationFrame(apply); });
      } else if (!pendingFrame) apply();
      if (active && !(values[active] > 0)) setActive(null);
      else if (active) api.renderActive?.(active);
    },
    destroy() { document.removeEventListener('pointerdown', outside); cancelAnimationFrame(pendingFrame); },
    layers: {
      def: root.querySelector('.d-default'),
      act: root.querySelector('.d-active'),
    },
  };
  return api;
}
