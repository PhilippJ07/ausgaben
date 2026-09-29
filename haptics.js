// Kurzer haptischer "Tick".
// iPhone: Safari hat keine Vibrations-API. Ab iOS 18 löst das Umschalten eines
// <input type="checkbox" switch> aber den System-Tick aus. Den nutzen wir unsichtbar.
// Android/andere: navigator.vibrate mit sehr kurzer Dauer.

let label = null;

function ensureSwitch() {
  if (label) return label;
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.setAttribute('switch', '');
  input.id = 'haptic-switch';
  input.tabIndex = -1;
  input.setAttribute('aria-hidden', 'true');
  label = document.createElement('label');
  label.htmlFor = input.id;
  label.setAttribute('aria-hidden', 'true');
  for (const el of [input, label]) {
    Object.assign(el.style, { position: 'fixed', left: '-100px', top: '0', width: '1px', height: '1px', opacity: '0', pointerEvents: 'none' });
  }
  document.body.append(input, label);
  return label;
}

const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export function tick(strength = 'light') {
  try {
    if (isIOS) {
      const keep = document.activeElement;
      const fire = () => { ensureSwitch().click(); if (keep && keep !== document.body && keep.isConnected) keep.focus({ preventScroll: true }); };
      fire();
      if (strength === 'success') setTimeout(fire, 90);
      return;
    }
    if (navigator.vibrate && matchMedia('(pointer: coarse)').matches) navigator.vibrate(strength === 'success' ? [8, 60, 8] : 6);
  } catch { /* egal */ }
}
