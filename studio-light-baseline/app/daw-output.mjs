/** Output dock: WLED/DDP settings, arming, 25 fps frame transport, Bluetooth
 * offset and calibration. The same final RGBW frame feeds preview and output.
 */
import { BAR_IDS } from './engine.mjs';
import { clamp, h, toast } from './daw-ui.mjs';

const call = async (path, value) => {
  const response = await fetch(`/api/${path}`, value === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Veza nije uspjela');
  return result;
};

export function createOutput(host, { badge, status, isBlackout, onConfig }) {
  const s = { config: null, armed: false, lastSent: 0, sending: false, failed: false, offsetSec: 0, calibrateFrom: 0, calibrateUntil: 0 };
  const note = h('p', { class: 'out-status', 'aria-live': 'polite' }, 'Izlaz nije uključen.');
  const mode = h('select', { 'aria-label': 'Način izlaza' }, h('option', { value: 'rgbw' }, 'RGBW · zaseban bijeli kanal'), h('option', { value: 'rgb' }, 'RGB · aproksimacija bijele'));
  const nodes = h('div', { class: 'out-nodes' }), mapping = h('div', { class: 'out-mapping' });
  const arm = h('button', { type: 'button', class: 'primary', onClick: toggleArm }, 'Uključi izlaz');
  const offset = h('input', { type: 'number', min: -2000, max: 2000, step: 10, value: 0, 'aria-label': 'Bluetooth pomak u ms', title: 'Negativna vrijednost odgađa svjetlo' });
  const calibrate = h('button', { type: 'button', onClick: runCalibration }, 'Kalibracijski klik + bljesak');

  host.append(
    h('div', { class: 'live-col' }, h('div', { class: 'dock-title' }, 'WLED IZLAZ (DDP)'), h('label', {}, 'Način', mode), nodes,
      h('div', { class: 'live-row' }, h('button', { type: 'button', onClick: saveConfig }, 'Spremi postavke'), arm), note,
      h('small', { class: 'live-hint' }, 'IP adrese su početno prazne; bez njih ništa ne izlazi. Svjetlina je ograničena na 60. To nije zaštita napajanja.')),
    h('div', { class: 'live-col wide' }, h('div', { class: 'dock-title' }, 'MAPIRANJE TRAKA'), mapping,
      h('small', { class: 'live-hint' }, '12 grupa i 72 diode po baru su procjene dok se ne izmjere na traci.')),
    h('div', { class: 'live-col' }, h('div', { class: 'dock-title' }, 'BLUETOOTH KALIBRACIJA'), h('label', {}, 'Pomak (ms; negativno = kasnije svjetlo)', offset), calibrate,
      h('small', { class: 'live-hint' }, 'Klik i bljesak stižu za oko 2 s. Usporedi ih na zvučniku i traci; mjerenje je ručno, svaki uređaj zasebno.')));

  const updateOffset = () => { s.offsetSec = clamp(Number(offset.value) || 0, -2000, 2000) / 1000; localStorage.setItem('ledicated-bluetooth-offset-ms', String(Math.round(s.offsetSec * 1000))); };
  offset.addEventListener('change', updateOffset);
  offset.value = localStorage.getItem('ledicated-bluetooth-offset-ms') || '0'; updateOffset();

  function updateBadge() {
    badge.textContent = s.armed ? 'IZLAZ UKLJUČEN' : 'SIMULACIJA'; badge.classList.toggle('live', s.armed);
    arm.textContent = s.armed ? 'Isključi izlaz' : 'Uključi izlaz'; arm.classList.toggle('on', s.armed);
    note.textContent = s.armed ? `DDP ${(s.config?.transport || 'rgb').toUpperCase()} slanje uključeno · prijem na trakama nije potvrđen.` : 'Izlaz nije uključen.';
  }

  function render() {
    if (!s.config) return;
    mode.value = s.config.transport || 'rgb'; nodes.replaceChildren(); mapping.replaceChildren();
    for (const n of s.config.nodes) nodes.append(h('label', { class: 'node-row' }, n.id, h('input', { value: n.host, placeholder: '192.168…', dataset: { node: n.id }, title: 'IP adresa WLED kontrolera' })));
    mapping.append(h('div', { class: 'mapping-head' }, h('span', {}, 'Bar → čvor'), h('span', {}, 'Grupe'), h('span', {}, 'Fizičke LED'), h('span', {}, 'Smjer')));
    for (const b of s.config.bars) mapping.append(h('div', { class: 'mapping-row' }, h('span', {}, `${b.id} → ${b.node}`),
      h('input', { type: 'number', min: 1, max: 72, value: b.pixels, dataset: { count: b.id }, 'aria-label': `Adresabilne grupe ${b.id}` }),
      h('input', { type: 'number', min: 1, max: 600, value: b.physicalLeds ?? b.pixels * 6, dataset: { physical: b.id }, 'aria-label': `Fizičke LED diode ${b.id}` }),
      h('label', {}, h('input', { type: 'checkbox', checked: b.reverse, dataset: { reverse: b.id } }), ' Obrni')));
  }

  async function saveConfig() {
    try {
      const updated = structuredClone(s.config); updated.transport = mode.value;
      for (const n of updated.nodes) n.host = host.querySelector(`[data-node="${n.id}"]`).value.trim();
      for (const b of updated.bars) { b.pixels = Number(host.querySelector(`[data-count="${b.id}"]`).value); b.physicalLeds = Number(host.querySelector(`[data-physical="${b.id}"]`).value); b.reverse = host.querySelector(`[data-reverse="${b.id}"]`).checked; }
      const saved = await call('config', updated); s.config = saved.config || updated; onConfig?.(s.config); note.textContent = 'Postavke spremljene.';
    } catch (error) { note.textContent = error.message; toast(error.message, 'error'); }
  }

  async function toggleArm() {
    try {
      if (isBlackout() && !s.armed) throw new Error('Prvo otpusti BLACKOUT.');
      const result = await call('arm', { armed: !s.armed }); s.armed = result.armed; s.failed = false; updateBadge();
    } catch (error) { note.textContent = error.message; toast(error.message, 'error'); }
  }

  async function runCalibration() {
    const audioContext = new AudioContext(), oscillator = audioContext.createOscillator(), gain = audioContext.createGain(), clickAt = audioContext.currentTime + 2.1;
    oscillator.frequency.value = 880; gain.gain.setValueAtTime(.18, clickAt); gain.gain.exponentialRampToValueAtTime(.001, clickAt + .08);
    oscillator.connect(gain).connect(audioContext.destination); oscillator.start(clickAt); oscillator.stop(clickAt + .08); oscillator.onended = () => audioContext.close();
    s.calibrateFrom = performance.now() + 2100 - s.offsetSec * 1000; s.calibrateUntil = s.calibrateFrom + 120;
    status('Klik i bljesak stižu za oko 2 s. Negativan pomak odgađa svjetlo; usporedi ih na zvučniku i traci.');
  }

  async function blackout() { try { await call('blackout', {}); } catch (error) { toast(error.message, 'error'); } }

  async function init() {
    try {
      const state = await call('state'); s.config = state.config; s.armed = state.armed;
      if (s.armed) { await blackout(); s.armed = false; }
      render(); onConfig?.(s.config);
    } catch (error) { toast(`Lokalna veza nije dostupna: ${error.message}`, 'error'); }
    updateBadge();
  }

  document.addEventListener('visibilitychange', async () => { if (document.hidden && s.armed) { s.armed = false; updateBadge(); await blackout(); toast('Izlaz isključen jer preglednik nije vidljiv.', 'error'); } });
  addEventListener('pagehide', () => navigator.sendBeacon('/api/blackout', new Blob(['{}'], { type: 'application/json' })));

  return {
    init, blackout, updateBadge, render,
    get config() { return s.config; }, get armed() { return s.armed; }, get offsetSec() { return s.offsetSec; },
    disarm() { s.armed = false; updateBadge(); },
    /** Returns a white calibration frame while the flash window is open. */
    calibrationFrame(brightness60) {
      const t = performance.now();
      if (t < s.calibrateFrom || t >= s.calibrateUntil) return null;
      const white = Math.round(100 * clamp(brightness60 / 60, 0, 1));
      return { bars: Object.fromEntries(BAR_IDS.map(id => [id, Array.from({ length: 12 }, () => [0, 0, 0, white])])) };
    },
    send(frame, t) {
      if (!s.armed || s.sending || t - s.lastSent <= 1 / 25) return;
      s.sending = true; s.lastSent = t;
      call('frame', { bars: frame.bars }).catch(async error => {
        s.armed = false; updateBadge();
        if (!s.failed) { s.failed = true; toast(`Izlaz zaustavljen: ${error.message}`, 'error'); }
        await blackout();
      }).finally(() => { s.sending = false; });
    }
  };
}
