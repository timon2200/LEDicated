/** Small DOM helpers and DAW controls (knob, fader, context menu, toast). */

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function h(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'style') Object.assign(node.style, value);
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key in node && key !== 'list' && key !== 'type' && typeof value !== 'object') node[key] = value;
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat(Infinity)) if (child !== null && child !== undefined && child !== false) node.append(child);
  return node;
}

/* ---------------------------------------------------------------- toast */
let toastTimer = 0;
export function toast(message, kind = 'info') {
  let box = document.getElementById('toast');
  if (!box) { box = h('div', { id: 'toast', role: 'status', 'aria-live': 'polite' }); document.body.append(box); }
  box.textContent = message; box.dataset.kind = kind; box.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => box.classList.remove('show'), kind === 'error' ? 6000 : 2800);
}

/* ----------------------------------------------------------------- menu */
let openMenu = null;
export function closeMenu() { openMenu?.remove(); openMenu = null; }
export function showMenu(x, y, items) {
  closeMenu();
  const menu = h('div', { class: 'ctx-menu', role: 'menu' });
  for (const item of items) {
    if (item.separator) { menu.append(h('hr')); continue; }
    if (item.input) { menu.append(h('label', { class: 'ctx-input' }, item.label, item.input)); continue; }
    const button = h('button', { type: 'button', role: 'menuitem', class: item.danger ? 'danger' : '', disabled: item.disabled === true, onClick: () => { closeMenu(); item.onClick?.(); } },
      h('span', {}, item.label), item.shortcut ? h('kbd', {}, item.shortcut) : null);
    menu.append(button);
  }
  document.body.append(menu); openMenu = menu;
  const rect = menu.getBoundingClientRect();
  menu.style.left = `${clamp(x, 4, innerWidth - rect.width - 4)}px`; menu.style.top = `${clamp(y, 4, innerHeight - rect.height - 4)}px`;
  menu.querySelector('button:not(:disabled)')?.focus();
  const dismiss = event => { if (!menu.contains(event.target)) { closeMenu(); removeEventListener('pointerdown', dismiss, true); } };
  setTimeout(() => addEventListener('pointerdown', dismiss, true));
  menu.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeMenu(); return; }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const buttons = [...menu.querySelectorAll('button:not(:disabled)')], index = buttons.indexOf(document.activeElement);
    buttons[(index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
  });
  return menu;
}

/* ----------------------------------------------------------------- knob */
/** Rotary control: drag vertically, wheel, arrow keys, double-click resets. */
export function createKnob({ label, min = 0, max = 1, value = 0, step = 0.01, reset = value, size = 38, format = v => String(Math.round(v * 100)), onInput, onChange, title }) {
  let current = value, startY = 0, startValue = 0;
  const ring = h('div', { class: 'knob-ring' }), readout = h('output', {}, format(value));
  const root = h('div', { class: 'knob', role: 'slider', tabIndex: 0, 'aria-label': label, 'aria-valuemin': min, 'aria-valuemax': max, title: title || label, style: { '--size': `${size}px` } },
    ring, h('span', { class: 'knob-label' }, label), readout);
  const paint = () => {
    const fraction = (current - min) / (max - min);
    root.style.setProperty('--turn', `${fraction * 270 - 135}deg`); root.style.setProperty('--fill', `${fraction * 270}deg`);
    root.setAttribute('aria-valuenow', current.toFixed(2)); readout.textContent = format(current);
  };
  const apply = (next, final) => { next = clamp(Math.round(next / step) * step, min, max); const changed = next !== current; current = next; paint(); if (changed) onInput?.(current); if (final) onChange?.(current); };
  root.addEventListener('pointerdown', event => { root.setPointerCapture(event.pointerId); startY = event.clientY; startValue = current; root.classList.add('active'); event.preventDefault(); root.focus(); });
  root.addEventListener('pointermove', event => { if (root.hasPointerCapture(event.pointerId)) apply(startValue + (startY - event.clientY) / (event.shiftKey ? 600 : 150) * (max - min), false); });
  const release = event => { if (root.hasPointerCapture(event.pointerId)) { root.releasePointerCapture(event.pointerId); root.classList.remove('active'); onChange?.(current); } };
  root.addEventListener('pointerup', release); root.addEventListener('pointercancel', release);
  root.addEventListener('dblclick', () => apply(reset, true));
  root.addEventListener('wheel', event => { event.preventDefault(); apply(current - Math.sign(event.deltaY) * step * (event.shiftKey ? 1 : 5), true); }, { passive: false });
  root.addEventListener('keydown', event => {
    const delta = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 }[event.key];
    if (delta) { event.preventDefault(); apply(current + delta * step * (event.shiftKey ? 10 : 1), true); }
  });
  paint();
  return { element: root, set(next) { current = clamp(next, min, max); paint(); }, get value() { return current; } };
}

/* ---------------------------------------------------------------- fader */
/** Vertical fader with a live meter. value 0..1 */
export function createFader({ label, value = 0.7, max = 1, onInput, onChange, format = v => `${Math.round(v * 100)}` }) {
  let current = value;
  const fill = h('div', { class: 'fader-fill' }), thumb = h('div', { class: 'fader-thumb' }), meter = h('div', { class: 'fader-meter' }, h('i'));
  const track = h('div', { class: 'fader-track' }, fill, thumb);
  const readout = h('output', {}, format(value));
  const root = h('div', { class: 'fader', role: 'slider', tabIndex: 0, 'aria-label': label, 'aria-valuemin': 0, 'aria-valuemax': max }, track, meter, readout);
  const paint = () => { const f = current / max * 100; fill.style.height = `${f}%`; thumb.style.bottom = `${f}%`; readout.textContent = format(current); root.setAttribute('aria-valuenow', current.toFixed(2)); };
  const fromPointer = event => { const r = track.getBoundingClientRect(); return clamp(1 - (event.clientY - r.top) / r.height, 0, 1) * max; };
  const apply = (next, final) => { current = clamp(next, 0, max); paint(); onInput?.(current); if (final) onChange?.(current); };
  root.addEventListener('pointerdown', event => { if (event.target === readout) return; root.setPointerCapture(event.pointerId); apply(fromPointer(event), false); event.preventDefault(); root.focus(); });
  root.addEventListener('pointermove', event => { if (root.hasPointerCapture(event.pointerId)) apply(fromPointer(event), false); });
  const release = event => { if (root.hasPointerCapture(event.pointerId)) { root.releasePointerCapture(event.pointerId); onChange?.(current); } };
  root.addEventListener('pointerup', release); root.addEventListener('pointercancel', release);
  root.addEventListener('dblclick', () => apply(value, true));
  root.addEventListener('keydown', event => { const d = { ArrowUp: 1, ArrowDown: -1 }[event.key]; if (d) { event.preventDefault(); apply(current + d * max * (event.shiftKey ? .1 : .01), true); } });
  paint();
  return { element: root, set(next) { current = clamp(next, 0, max); paint(); }, level(v) { meter.firstChild.style.height = `${clamp(v, 0, 1) * 100}%`; }, get value() { return current; } };
}

/** Compact draggable number (BPM style): drag vertically or type. */
export function createDragNumber({ id, label, value, min, max, step = 1, decimals = 0, onChange }) {
  let current = value, startY = 0, startValue = 0, moved = false;
  const input = h('input', { id, type: 'number', min, max, step: decimals ? Math.pow(10, -decimals) : 1, value: current.toFixed(decimals), 'aria-label': label });
  const root = h('div', { class: 'dragnum', title: `${label}: povuci gore/dolje ili upiši` }, h('span', {}, label), input);
  const set = (next, notify) => { current = clamp(next, min, max); input.value = current.toFixed(decimals); if (notify) onChange?.(current); };
  root.addEventListener('pointerdown', event => { if (event.target === input && document.activeElement === input) return; startY = event.clientY; startValue = current; moved = false; root.setPointerCapture(event.pointerId); });
  root.addEventListener('pointermove', event => { if (!root.hasPointerCapture(event.pointerId)) return; const delta = (startY - event.clientY) * step * (event.shiftKey ? .1 : 1) * (decimals ? 1 : 1); if (Math.abs(startY - event.clientY) > 2) { moved = true; set(Math.round((startValue + delta) * 10 ** decimals) / 10 ** decimals, true); } });
  root.addEventListener('pointerup', event => { if (root.hasPointerCapture(event.pointerId)) root.releasePointerCapture(event.pointerId); if (!moved) { input.focus(); input.select(); } });
  input.addEventListener('change', () => set(Number(input.value) || current, true));
  input.addEventListener('keydown', event => { if (event.key === 'Enter') input.blur(); });
  return { element: root, input, set: v => set(v, false), get value() { return current; } };
}

export const hexToRgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
export const rgbToHex = rgb => '#' + rgb.slice(0, 3).map(v => Math.round(clamp(v, 0, 1) * 255).toString(16).padStart(2, '0')).join('');

/** Bright UI colour for an RGBW clip colour (hue kept, brightness normalised). */
export function clipUiColor(color) {
  const [r, g, b, w] = color;
  let rgb = [r + w, g + .78 * w, b + .45 * w];
  const max = Math.max(...rgb, 1e-6);
  rgb = rgb.map(v => Math.round(clamp(v / max, 0, 1) * (0.55 + 0.45 * Math.min(1, max)) * 255));
  return rgb;
}
