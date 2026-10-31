import { BAR_IDS, PIXELS_PER_BAR } from './engine.mjs';
import { PRESETS } from './timeline.mjs';
import { createPerformance, DEFAULT_PADS, PAD_KEYS, hsvToRgbw, rgbwToHsv, sampleSpatialPanelEffect } from './live-performance-state.mjs';
import { createZoneGridIcon } from './daw-ui.mjs';

const PRESET_LABELS = {
  solid: 'Panel',
  pulse: 'Impuls',
  chase: 'Potjera',
  sweep: 'Val',
  strobe: 'Strobo',
  flash: 'Bljesak',
  wash: 'Preljev',
  sparkle: 'Iskre',
  wave: 'Sinus',
  ripple: 'Koncentrični',
  rain: 'Kiša',
  spiral: 'Spirala',
  fire: 'Vatra',
  columns: 'Stupci',
  bounce: 'Odskok',
  prism: 'Prizma',
  aurora: 'Aurora',
  comet: 'Komet',
  scanner: 'Skener',
  heartbeat: 'Otkucaj',
  plasma: 'Plazma',
  glitch: 'Glitch',
  supernova: 'Supernova',
  horizon: 'Horizont',
  vortex: 'Vrtlog',
  meteor: 'Meteor',
  shimmer: 'Treperenje'
};

const COLOR_SWATCHES = [
  ['#00f2ff', '#38bdf8'],
  ['#ff2e93', '#a855f7'],
  ['#ffb800', '#ff5500'],
  ['#10b981', '#00f2ff'],
  ['#ffffff', '#ffecd6'],
  ['#6366f1', '#ec4899'],
  ['#ef4444', '#f59e0b'],
  ['#a855f7', '#00f2ff']
];

const ZONE_PRESETS = {
  left: ['L1', 'L2', 'L3'],
  center: ['C1', 'C2', 'C3'],
  right: ['R1', 'R2', 'R3'],
  edge: ['L1', 'C1', 'R1', 'L2', 'R2', 'L3', 'C3', 'R3'].filter(id => id.startsWith('L') || id.startsWith('R')),
  all: [...BAR_IDS],
  cross: ['C1', 'L2', 'C2', 'R2', 'C3'],
  top: ['L1', 'C1', 'R1'],
  mid: ['L2', 'C2', 'R2'],
  bot: ['L3', 'C3', 'R3'],
  outer: ['L1', 'L2', 'L3', 'R1', 'R2', 'R3']
};

const clientId = (() => {
  try {
    const saved = localStorage.getItem('ledicated.pad.clientId');
    if (saved) return saved;
    const next = `iphone-pad-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem('ledicated.pad.clientId', next);
    return next;
  } catch {
    return `iphone-pad-${Math.random().toString(36).slice(2, 10)}`;
  }
})();

const desk = createPerformance(DEFAULT_PADS);
let selectedPadIndex = 0;
let holdLatchMode = false;
let inspectorOnTapMode = false;
let zonePaintOpen = false;
let activeSurface = 'pads'; // 'pads' | 'xy'
let isStageOwner = true;
let isRecordingSession = false;
let studioConnected = false;
let lastRttMs = 0;

const studioState = {
  trackId: null,
  trackTitle: 'LEDicated Live Performance',
  sectionName: 'LIVE',
  isPlaying: false,
  timeSec: 0,
  durationSec: 180,
  bpm: 124,
  master: 35,
  blackout: false,
  lastSyncPerfMs: performance.now(),
  sections: [],
  tracks: []
};

// DOM Elements
const connDot = document.getElementById('conn-dot');
const btnStageRole = document.getElementById('btn-stage-role');
const stageRoleLabel = document.getElementById('stage-role-label');
const latencyReadout = document.getElementById('latency-readout');
const btnRecSession = document.getElementById('btn-rec-session');
const btnOpenTransport = document.getElementById('btn-open-transport');
const topBpmLabel = document.getElementById('top-bpm-label');
const btnBlackout = document.getElementById('btn-blackout');

const btnTrackBanner = document.getElementById('btn-track-banner');
const playIndicator = document.getElementById('play-indicator');
const trackTitleEl = document.getElementById('track-title');
const sectionTagEl = document.getElementById('section-tag');
const timeCodeEl = document.getElementById('time-code');
const beatPips = Array.from(document.querySelectorAll('.beat-pip'));

const stageCanvas = document.getElementById('stage-canvas');
const stageCtx = stageCanvas.getContext('2d');
const zonePaintOverlay = document.getElementById('zone-paint-overlay');
const btnZonePaint = document.getElementById('btn-zone-paint');
const btnZoneAll = document.getElementById('btn-zone-all');
const zoneSummaryEl = document.getElementById('zone-summary');

const meterR = document.getElementById('meter-r');
const meterG = document.getElementById('meter-g');
const meterB = document.getElementById('meter-b');
const meterW = document.getElementById('meter-w');
const wattsReadout = document.getElementById('watts-readout');

const surfaceTabs = Array.from(document.querySelectorAll('.surface-tab'));
const btnQuantize = document.getElementById('btn-quantize');
const btnHoldLatch = document.getElementById('btn-hold-latch');
const btnEditMode = document.getElementById('btn-edit-mode');
const btnPanicPads = document.getElementById('btn-panic-pads');

const padMatrixGrid = document.getElementById('pad-matrix-grid');
const xyMorphSurface = document.getElementById('xy-morph-surface');
const xyPadStage = document.getElementById('xy-pad-stage');
const xyCanvas = document.getElementById('xy-canvas');
const xyCtx = xyCanvas.getContext('2d');
const xyIntensityTrack = document.getElementById('xy-intensity-track');
const xyIntensityFill = document.getElementById('xy-intensity-fill');
const xyIntensityThumb = document.getElementById('xy-intensity-thumb');
const xyIntensityVal = document.getElementById('xy-intensity-val');
const xySpreadTrack = document.getElementById('xy-spread-track');
const xySpreadFill = document.getElementById('xy-spread-fill');
const xySpreadThumb = document.getElementById('xy-spread-thumb');
const xySpreadVal = document.getElementById('xy-spread-val');
const xyEffectSelect = document.getElementById('xy-effect-select');
const xyWheelWrap = document.getElementById('xy-wheel-wrap');
const xyWheelCanvas = document.getElementById('xy-wheel-canvas');
const xyWheelPuck = document.getElementById('xy-wheel-puck');
const xyColorVal = document.getElementById('xy-color-val');

const dialIntensity = document.getElementById('dial-intensity');
const valIntensity = document.getElementById('val-intensity');
const dialSpeed = document.getElementById('dial-speed');
const valSpeed = document.getElementById('val-speed');
const dialWhite = document.getElementById('dial-white');
const valWhite = document.getElementById('val-white');

const btnPlayToggle = document.getElementById('btn-play-toggle');
const dockPlayIcon = document.getElementById('dock-play-icon');
const dockPlayText = document.getElementById('dock-play-text');
const selectedPadSummary = document.getElementById('selected-pad-summary');
const selPadKey = document.getElementById('sel-pad-key');
const selPadName = document.getElementById('sel-pad-name');
const selPadSub = document.getElementById('sel-pad-sub');
const btnInspectPad = document.getElementById('btn-inspect-pad');

// Dialogs
const inspectorDialog = document.getElementById('pad-inspector-dialog');
const transportDialog = document.getElementById('transport-sheet-dialog');

// Tactile Haptics & Subtle Audio Feedback
let audioCtx = null;
function triggerTactileFeedback(kind = 'press') {
  try {
    if (navigator.vibrate) {
      navigator.vibrate(kind === 'press' ? 10 : 5);
    }
  } catch {}
  try {
    if (!audioCtx && (window.AudioContext || window.webkitAudioContext)) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      audioCtx = new Ctx();
    }
    if (audioCtx && audioCtx.state === 'running') {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      const now = audioCtx.currentTime;
      osc.type = 'sine';
      osc.frequency.setValueAtTime(kind === 'press' ? 135 : 92, now);
      osc.frequency.exponentialRampToValueAtTime(38, now + 0.028);
      gain.gain.setValueAtTime(kind === 'press' ? 0.025 : 0.012, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.028);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now);
      osc.stop(now + 0.03);
    }
  } catch {}
}

function getInterpolatedTimeSec() {
  if (!studioState.isPlaying) return studioState.timeSec;
  const elapsed = Math.max(0, (performance.now() - studioState.lastSyncPerfMs) / 1000);
  return Math.min(studioState.durationSec || 9999, studioState.timeSec + elapsed);
}

function getPerfContext() {
  return {
    clockTime: performance.now() / 1000,
    bpm: studioState.bpm || 124,
    playing: studioState.isPlaying,
    songTime: getInterpolatedTimeSec()
  };
}

function rgbArrayToHex(rgb, fallback = '#00f2ff') {
  if (!Array.isArray(rgb) || rgb.length < 3) return fallback;
  const toHex = v => Math.max(0, Math.min(255, Math.round(Number(v || 0) * 255))).toString(16).padStart(2, '0');
  return `#${toHex(rgb[0])}${toHex(rgb[1])}${toHex(rgb[2])}`;
}

function hexToRgbArray(hex) {
  const clean = String(hex || '#00f2ff').replace('#', '');
  if (clean.length !== 6) return [0, 0.95, 1];
  const n = parseInt(clean, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

// Network Command Sender
async function sendCommand(payload) {
  const t0 = performance.now();
  try {
    const res = await fetch('/api/live/command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId,
        clientName: 'iPhone Live Pad',
        source: 'pad',
        ...payload
      })
    });
    if (res.ok) {
      lastRttMs = Math.max(1, Math.round(performance.now() - t0));
      latencyReadout.textContent = `LAN ${lastRttMs} ms`;
      connDot.classList.add('online');
      connDot.classList.remove('offline');
      studioConnected = true;
      return await res.json().catch(() => null);
    }
  } catch {
    connDot.classList.remove('online');
    connDot.classList.add('offline');
    studioConnected = false;
  }
  return null;
}

// Build 12 Multi-Touch Pad Elements
const padElements = [];
function buildPadGrid() {
  padMatrixGrid.innerHTML = '';
  padElements.length = 0;

  for (let i = 0; i < 12; i++) {
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'live-pad-tile';
    tile.dataset.index = String(i);

    const miniDots = BAR_IDS.map(barId => `<span class="pad-mini-dot" data-bar="${barId}"></span>`).join('');
    tile.innerHTML = `
      <div class="pad-tile-top">
        <span class="pad-key-badge">${PAD_KEYS[i]}</span>
        <div class="pad-top-right">
          <div class="pad-mini-matrix">${miniDots}</div>
          <span class="pad-mode-pill">HIT</span>
        </div>
      </div>
      <div class="pad-tile-body">
        <div class="pad-title">Pad ${i + 1}</div>
        <div class="pad-preset-sub">PULSE</div>
      </div>
      <div class="pad-progress-bar"></div>
    `;

    padMatrixGrid.appendChild(tile);
    padElements.push(tile);
  }

  refreshPadTilesUI();
}

function refreshPadTilesUI() {
  for (let i = 0; i < 12; i++) {
    const pad = desk.pads[i];
    const tile = padElements[i];
    if (!tile) continue;

    tile.classList.toggle('selected', i === selectedPadIndex);
    if (!pad) {
      tile.style.setProperty('--pad-accent', '#475569');
      tile.style.setProperty('--pad-secondary', '#334155');
      tile.querySelector('.pad-title').textContent = `Prazan (${PAD_KEYS[i]})`;
      tile.querySelector('.pad-preset-sub').textContent = 'DODIRNI ZA DODJELU';
      continue;
    }

    const colA = rgbArrayToHex(pad.color, '#00f2ff');
    const colB = rgbArrayToHex(pad.colorSecondary || pad.color, colA);
    tile.style.setProperty('--pad-accent', colA);
    tile.style.setProperty('--pad-secondary', colB);

    const keyLabel = PAD_KEYS[i].toUpperCase();
    tile.querySelector('.pad-key-badge').textContent = keyLabel;
    tile.querySelector('.pad-title').textContent = pad.name || `${PRESET_LABELS[pad.preset] || pad.preset} ${keyLabel}`;
    const modePill = tile.querySelector('.pad-mode-pill');
    const isLoop = pad.mode === 'loop';
    modePill.textContent = isLoop ? 'LOOP' : 'HIT';
    modePill.classList.toggle('loop', isLoop);

    const presetLabel = PRESET_LABELS[pad.preset] || pad.preset;
    const barsList = Array.isArray(pad.bars) ? pad.bars : (pad.targets === 'all' ? BAR_IDS : (Array.isArray(pad.targets) ? pad.targets : BAR_IDS));
    const barCount = barsList.length;
    tile.querySelector('.pad-preset-sub').textContent = `${presetLabel} · ${barCount === 9 ? '9 BAROVA' : `${barCount}/9 ZONA`}`;

    const targetSet = new Set(barsList);
    for (const dot of tile.querySelectorAll('.pad-mini-dot')) {
      dot.classList.toggle('lit', targetSet.has(dot.dataset.bar));
    }
  }

  updateSelectedPadDock();
  updateZoneOverlayUI();
}

function selectPad(index) {
  selectedPadIndex = Math.max(0, Math.min(11, index));
  refreshPadTilesUI();
}

function updateSelectedPadDock() {
  const pad = desk.pads[selectedPadIndex];
  const keyUp = PAD_KEYS[selectedPadIndex].toUpperCase();
  selPadKey.textContent = keyUp;
  if (!pad) {
    selPadName.textContent = 'Prazan slot';
    selPadSub.textContent = 'Dodirni za kreiranje efekta';
    return;
  }
  const colA = rgbArrayToHex(pad.color, '#00f2ff');
  selPadKey.style.color = colA;
  selPadName.textContent = pad.name || `${PRESET_LABELS[pad.preset] || pad.preset} ${keyUp}`;
  const barsList = Array.isArray(pad.bars) ? pad.bars : (pad.targets === 'all' ? BAR_IDS : (Array.isArray(pad.targets) ? pad.targets : BAR_IDS));
  const barCount = barsList.length;
  selPadSub.textContent = `${(PRESET_LABELS[pad.preset] || pad.preset).toUpperCase()} · ${pad.mode.toUpperCase()} · ${barCount}/9 barova`;

  // Sync bottom expression dials to selected pad
  const intensityPct = Math.round(Number(pad.intensity ?? 1) * 100);
  dialIntensity.value = String(intensityPct);
  valIntensity.textContent = `${intensityPct}%`;

  const speedVal = Number(pad.speed ?? pad.params?.speed ?? 1.0);
  dialSpeed.value = String(Math.round(speedVal * 10));
  valSpeed.textContent = `${speedVal.toFixed(1)}×`;

  const whitePct = Math.round(Number(pad.color?.[3] ?? pad.white ?? 0) * 100);
  dialWhite.value = String(whitePct);
  valWhite.textContent = `${whitePct}%`;
}

function updateZoneOverlayUI() {
  const pad = desk.pads[selectedPadIndex];
  const bars = Array.isArray(pad?.bars) && pad.bars.length ? pad.bars : (Array.isArray(pad?.targets) ? pad.targets : BAR_IDS);
  const barSet = new Set(bars);
  zoneSummaryEl.textContent = bars.length === 9 ? 'SVI (9)' : bars.join(',');
  for (const chip of zonePaintOverlay.querySelectorAll('.zone-bar-chip')) {
    chip.classList.toggle('selected', barSet.has(chip.dataset.bar));
  }
}

// Multi-Touch Pointer Handler for 12 Pads
const activePointers = new Map(); // pointerId -> padIndex

function setupMultiTouchPadEvents() {
  padMatrixGrid.addEventListener('pointerdown', e => {
    const tile = e.target.closest('.live-pad-tile');
    if (!tile) return;
    e.preventDefault();
    const index = Number(tile.dataset.index);
    if (!Number.isInteger(index)) return;

    try {
      tile.setPointerCapture(e.pointerId);
    } catch {}

    selectPad(index);
    triggerTactileFeedback('press');

    if (inspectorOnTapMode) {
      openPadInspector(index);
      return;
    }

    if (!desk.pads[index]) {
      desk.setPad(index, { preset: 'flash', mode: 'hit' });
      refreshPadTilesUI();
      sendCommand({ type: 'live_pad', action: 'set', index, pad: desk.pads[index] });
    }

    const pad = desk.pads[index];
    activePointers.set(e.pointerId, index);

    if (pad.mode === 'loop') {
      desk.trigger(index, getPerfContext());
      sendCommand({ type: 'live_pad', action: 'trigger', index });
    } else {
      desk.press(index, getPerfContext());
      sendCommand({ type: 'live_pad', action: 'press', index });
    }
  });

  const handlePointerRelease = e => {
    const index = activePointers.get(e.pointerId);
    if (index === undefined) return;
    activePointers.delete(e.pointerId);
    const pad = desk.pads[index];
    if (!pad || pad.mode === 'loop' || holdLatchMode) return;
    desk.release(index, getPerfContext());
    sendCommand({ type: 'live_pad', action: 'release', index });
  };

  padMatrixGrid.addEventListener('pointerup', handlePointerRelease);
  padMatrixGrid.addEventListener('pointercancel', handlePointerRelease);
}

// XY Spatial 3x3 Guitar / Draw Surface + Edge Lock Bubbles + Intensity & Spread Sliders
const xyPointers = new Map();
const xyBubbleHolds = new Map(); // pointerId -> { kind: 'col'|'row', index, startedAt, initiallyLocked, completed }
const XY_BUBBLE_HOLD_SEC = 0.40;
let xyMoveThrottle = 0;

function syncXYControlsUI() {
  const pct = Math.round(desk.intensity * 100);
  if (xyIntensityFill) xyIntensityFill.style.height = `${pct}%`;
  if (xyIntensityThumb) xyIntensityThumb.style.bottom = `calc(${pct}% - 4px)`;
  if (xyIntensityVal) xyIntensityVal.textContent = `${pct}%`;
  if (xyIntensityTrack) xyIntensityTrack.setAttribute('aria-valuenow', String(pct));

  const spreadPct = Math.round((desk.spread ?? 0) * 100);
  if (xySpreadFill) xySpreadFill.style.height = `${spreadPct}%`;
  if (xySpreadThumb) xySpreadThumb.style.bottom = `calc(${spreadPct}% - 4px)`;
  if (xySpreadVal) xySpreadVal.textContent = `${spreadPct}%`;
  if (xySpreadTrack) xySpreadTrack.setAttribute('aria-valuenow', String(spreadPct));

  if (xyEffectSelect && xyEffectSelect.value !== desk.effect) {
    xyEffectSelect.value = desk.effect;
  }

  const { hue, sat } = rgbwToHsv(desk.color);
  const rad = (hue * Math.PI) / 180;
  const px = 50 + Math.cos(rad) * sat * 42;
  const py = 50 + Math.sin(rad) * sat * 42;
  const colHex = rgbArrayToHex(desk.color, '#00f2ff');
  if (xyWheelPuck) {
    xyWheelPuck.style.left = `${px.toFixed(1)}%`;
    xyWheelPuck.style.top = `${py.toFixed(1)}%`;
    xyWheelPuck.style.backgroundColor = colHex;
  }
  if (xyColorVal) {
    xyColorVal.textContent = sat < 0.12 ? 'BIJELA' : `${Math.round(hue)}°`;
  }
}

function drawColorWheelStatic() {
  if (!xyWheelCanvas) return;
  const ctx = xyWheelCanvas.getContext('2d');
  if (!ctx) return;
  const w = xyWheelCanvas.width;
  const h = xyWheelCanvas.height;
  const img = ctx.createImageData(w, h);
  const rMax = w / 2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x - rMax + 0.5;
      const dy = y - rMax + 0.5;
      const dist = Math.hypot(dx, dy);
      if (dist > rMax) continue;
      const sat = Math.max(0, Math.min(1, dist / (rMax - 1)));
      const hue = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
      const [r, g, b, ww] = hsvToRgbw(hue, sat, 1);
      const idx = (y * w + x) * 4;
      img.data[idx] = Math.min(255, Math.round((r + ww * 0.85) * 255));
      img.data[idx + 1] = Math.min(255, Math.round((g + ww * 0.75) * 255));
      img.data[idx + 2] = Math.min(255, Math.round((b + ww * 0.55) * 255));
      img.data[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

function setupXYSurface() {
  drawColorWheelStatic();
  syncXYControlsUI();

  const normCoord = e => {
    const rect = xyPadStage.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (e.clientX - rect.left) / Math.max(1, rect.width))),
      y: Math.max(0, Math.min(1, (e.clientY - rect.top) / Math.max(1, rect.height)))
    };
  };

  const hitTestEdgeBubble = (nx, ny, rect) => {
    const w = Math.max(1, rect.width);
    const h = Math.max(1, rect.height);
    const px = nx * w;
    const py = ny * h;
    const hitRadius = 26;
    for (let col = 0; col < 3; col++) {
      const cx = ((col + 0.5) / 3) * w;
      const cy = h - 13;
      if (Math.hypot(px - cx, py - cy) <= hitRadius) {
        return { kind: 'col', index: col };
      }
    }
    for (let row = 0; row < 3; row++) {
      const cx = 13;
      const cy = ((row + 0.5) / 3) * h;
      if (Math.hypot(px - cx, py - cy) <= hitRadius) {
        return { kind: 'row', index: row };
      }
    }
    return null;
  };

  xyEffectSelect?.addEventListener('change', () => {
    desk.setEffect(xyEffectSelect.value);
    triggerTactileFeedback('tap');
    sendCommand({ type: 'live_pad', action: 'set_effect', effect: desk.effect });
  });

  xyPadStage.addEventListener('pointerdown', e => {
    e.preventDefault();
    try { xyPadStage.setPointerCapture(e.pointerId); } catch {}
    const rect = xyPadStage.getBoundingClientRect();
    const { x, y } = normCoord(e);
    const bubbleHit = hitTestEdgeBubble(x, y, rect);
    if (bubbleHit) {
      const isLocked = bubbleHit.kind === 'col'
        ? desk.lockedCols.includes(bubbleHit.index)
        : desk.lockedRows.includes(bubbleHit.index);
      xyBubbleHolds.set(e.pointerId, {
        kind: bubbleHit.kind,
        index: bubbleHit.index,
        startedAt: getPerfContext().clockTime,
        initiallyLocked: isLocked,
        completed: false
      });
      triggerTactileFeedback('press');
      return;
    }

    const id = `p-${e.pointerId}`;
    xyPointers.set(e.pointerId, id);
    triggerTactileFeedback('press');
    desk.touchDown(id, {
      x,
      y,
      clockTime: getPerfContext().clockTime,
      color: desk.color,
      intensity: desk.intensity,
      spread: desk.spread,
      velocityGain: 0.78,
      effect: desk.effect
    });
    sendCommand({
      type: 'live_pad',
      action: 'touch_down',
      id,
      x,
      y,
      color: desk.color,
      intensity: desk.intensity,
      spread: desk.spread,
      velocityGain: 0.78,
      effect: desk.effect,
      lockedCols: desk.lockedCols,
      lockedRows: desk.lockedRows
    });
  });

  xyPadStage.addEventListener('pointermove', e => {
    if (xyBubbleHolds.has(e.pointerId)) return;
    const id = xyPointers.get(e.pointerId);
    if (!id) return;
    const { x, y } = normCoord(e);
    const res = desk.touchMove(id, { x, y, clockTime: getPerfContext().clockTime });
    if (res === 'strummed') {
      triggerTactileFeedback('tap');
    }
    const touch = desk.touches.get(id);
    const velocityGain = touch ? touch.velocityGain : 1;
    const now = performance.now();
    if (res === 'strummed' || now - xyMoveThrottle >= 22) {
      xyMoveThrottle = now;
      sendCommand({ type: 'live_pad', action: 'touch_move', id, x, y, velocityGain });
    }
  });

  const endXYPointer = (e, cancel = false) => {
    if (xyBubbleHolds.has(e.pointerId)) {
      xyBubbleHolds.delete(e.pointerId);
      return;
    }
    const id = xyPointers.get(e.pointerId);
    if (!id) return;
    xyPointers.delete(e.pointerId);
    desk.touchUp(id, { clockTime: getPerfContext().clockTime, cancel });
    sendCommand({ type: 'live_pad', action: 'touch_up', id, cancel });
  };

  xyPadStage.addEventListener('pointerup', e => endXYPointer(e, false));
  xyPadStage.addEventListener('pointercancel', e => endXYPointer(e, true));

  // Right-Side Big Vertical Intensity Slider
  let draggingSlider = false;
  const updateSliderFromEvent = e => {
    const rect = xyIntensityTrack.getBoundingClientRect();
    const val = Math.max(0, Math.min(1, 1 - (e.clientY - rect.top) / Math.max(1, rect.height)));
    desk.setIntensity(val);
    syncXYControlsUI();
    sendCommand({ type: 'live_pad', action: 'set_intensity', intensity: desk.intensity });
  };
  xyIntensityTrack?.addEventListener('pointerdown', e => {
    e.preventDefault();
    draggingSlider = true;
    try { xyIntensityTrack.setPointerCapture(e.pointerId); } catch {}
    updateSliderFromEvent(e);
  });
  xyIntensityTrack?.addEventListener('pointermove', e => {
    if (draggingSlider) updateSliderFromEvent(e);
  });
  xyIntensityTrack?.addEventListener('pointerup', () => { draggingSlider = false; });
  xyIntensityTrack?.addEventListener('pointercancel', () => { draggingSlider = false; });

  // Right-Side Vertical Spread Slider
  let draggingSpread = false;
  const updateSpreadFromEvent = e => {
    const rect = xySpreadTrack.getBoundingClientRect();
    const val = Math.max(0, Math.min(1, 1 - (e.clientY - rect.top) / Math.max(1, rect.height)));
    desk.setSpread(val);
    syncXYControlsUI();
    sendCommand({ type: 'live_pad', action: 'set_spread', spread: desk.spread });
  };
  xySpreadTrack?.addEventListener('pointerdown', e => {
    e.preventDefault();
    draggingSpread = true;
    try { xySpreadTrack.setPointerCapture(e.pointerId); } catch {}
    updateSpreadFromEvent(e);
  });
  xySpreadTrack?.addEventListener('pointermove', e => {
    if (draggingSpread) updateSpreadFromEvent(e);
  });
  xySpreadTrack?.addEventListener('pointerup', () => { draggingSpread = false; });
  xySpreadTrack?.addEventListener('pointercancel', () => { draggingSpread = false; });

  // Right-Side Interactive Color Wheel
  let draggingWheel = false;
  const updateWheelFromEvent = e => {
    const rect = xyWheelCanvas.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = e.clientX - cx;
    const dy = e.clientY - cy;
    const rMax = Math.max(1, Math.min(rect.width, rect.height) / 2);
    const sat = Math.max(0, Math.min(1, Math.hypot(dx, dy) / rMax));
    const hue = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
    const nextColor = hsvToRgbw(hue, sat, 1);
    desk.setColor(nextColor);
    syncXYControlsUI();
    sendCommand({ type: 'live_pad', action: 'set_color', color: desk.color });
  };
  xyWheelWrap?.addEventListener('pointerdown', e => {
    e.preventDefault();
    draggingWheel = true;
    try { xyWheelWrap.setPointerCapture(e.pointerId); } catch {}
    updateWheelFromEvent(e);
  });
  xyWheelWrap?.addEventListener('pointermove', e => {
    if (draggingWheel) updateWheelFromEvent(e);
  });
  xyWheelWrap?.addEventListener('pointerup', () => { draggingWheel = false; });
  xyWheelWrap?.addEventListener('pointercancel', () => { draggingWheel = false; });
}

// 60 FPS Stage Visualizer & Telemetry Loop
const BAR_COORDS = [
  { id: 'L1', col: 0, row: 0 },
  { id: 'C1', col: 1, row: 0 },
  { id: 'R1', col: 2, row: 0 },
  { id: 'L2', col: 0, row: 1 },
  { id: 'C2', col: 1, row: 1 },
  { id: 'R2', col: 2, row: 1 },
  { id: 'L3', col: 0, row: 2 },
  { id: 'C3', col: 1, row: 2 },
  { id: 'R3', col: 2, row: 2 }
];

function renderTick() {
  const perfCtx = getPerfContext();
  desk.tick(perfCtx);

  // Update active/queued states on the 12 pad tiles
  for (let i = 0; i < 12; i++) {
    const tile = padElements[i];
    if (!tile) continue;
    const isActive = desk.active.has(i);
    const isQueued = desk.pending.has(i);
    tile.classList.toggle('active', isActive);
    tile.classList.toggle('queued', isQueued);

    const progEl = tile.querySelector('.pad-progress-bar');
    if (isActive) {
      const state = desk.active.get(i);
      const pad = desk.pads[i];
      if (pad?.mode === 'loop') {
        progEl.style.width = '100%';
      } else {
        const elapsed = Math.max(0, perfCtx.clockTime - (state?.start ?? perfCtx.clockTime));
        const dur = Math.max(0.15, (state?.until ?? (perfCtx.clockTime + 0.5)) - (state?.start ?? perfCtx.clockTime));
        const pct = Math.max(0, Math.min(100, (1 - elapsed / dur) * 100));
        progEl.style.width = `${pct.toFixed(1)}%`;
      }
    } else {
      progEl.style.width = '0%';
    }
  }

  // Update Beat Phase HUD & Timecode
  const tSec = perfCtx.songTime;
  const mins = Math.floor(tSec / 60);
  const secs = (tSec % 60).toFixed(1).padStart(4, '0');
  timeCodeEl.textContent = `${String(mins).padStart(2, '0')}:${secs}`;

  const beatDur = 60 / Math.max(40, studioState.bpm || 124);
  const beatIndex = Math.floor(tSec / beatDur) % 4;
  beatPips.forEach((pip, idx) => {
    pip.classList.toggle('active', idx === beatIndex && (studioState.isPlaying || desk.active.size > 0));
  });

  // Render 3x3 Diffused RGBW Bar Frame (always full brightness regardless of master brightness)
  const nowPerf = performance.now();
  const hasRemoteBars = Boolean(studioState.remoteBars && (nowPerf - (studioState.remoteBarsAt || 0) < (studioState.isPlaying ? 2000 : 10000)));
  const baseFrame = {
    bars: Object.fromEntries(BAR_IDS.map(id => {
      const rem = hasRemoteBars ? studioState.remoteBars[id] : null;
      return [
        id,
        Array.isArray(rem) && rem.length === PIXELS_PER_BAR
          ? rem.map(px => [px[0] || 0, px[1] || 0, px[2] || 0, px[3] || 0])
          : Array.from({ length: PIXELS_PER_BAR }, () => [0, 0, 0, 0])
      ];
    }))
  };
  const rendered = studioState.blackout
    ? { bars: Object.fromEntries(BAR_IDS.map(id => [id, Array.from({ length: PIXELS_PER_BAR }, () => [0, 0, 0, 0])])) }
    : (hasRemoteBars && (nowPerf - (studioState.lastLocalPadAt || 0) > 180)
        ? baseFrame
        : desk.render(baseFrame, perfCtx.clockTime, perfCtx.bpm, 1, null, perfCtx.songTime));

  drawStageCanvas(rendered.bars);
  if (activeSurface === 'xy') {
    drawXYCanvas();
  }

  requestAnimationFrame(renderTick);
}

function drawStageCanvas(bars) {
  const w = stageCanvas.width;
  const h = stageCanvas.height;
  stageCtx.clearRect(0, 0, w, h);

  // Subtle stage grid lines
  stageCtx.fillStyle = '#04060a';
  stageCtx.fillRect(0, 0, w, h);

  const padX = 24;
  const padY = 18;
  const gapX = 26;
  const gapY = 22;
  const barW = (w - padX * 2 - gapX * 2) / 3;
  const barH = (h - padY * 2 - gapY * 2) / 3;

  let sumR = 0, sumG = 0, sumB = 0, sumW = 0, pxCount = 0;

  for (const item of BAR_COORDS) {
    const x = padX + item.col * (barW + gapX);
    const y = padY + item.row * (barH + gapY);
    const pixels = bars[item.id] || [];
    const segW = barW / PIXELS_PER_BAR;

    // Bar chassis housing
    stageCtx.fillStyle = '#0e131f';
    stageCtx.beginPath();
    stageCtx.roundRect(x - 3, y - 3, barW + 6, barH + 6, 10);
    stageCtx.fill();

    for (let p = 0; p < PIXELS_PER_BAR; p++) {
      const [r = 0, g = 0, b = 0, ww = 0] = pixels[p] || [0, 0, 0, 0];
      sumR += r; sumG += g; sumB += b; sumW += ww;
      pxCount++;

      // Blend warm white channel into visible preview RGB with punchy display gamma
      const rawR = Math.min(1, Math.max(0, (r + ww * 0.95) / 255));
      const rawG = Math.min(1, Math.max(0, (g + ww * 0.78) / 255));
      const rawB = Math.min(1, Math.max(0, (b + ww * 0.48) / 255));
      const dispR = Math.round(Math.pow(rawR, 1 / 1.85) * 255);
      const dispG = Math.round(Math.pow(rawG, 1 / 1.85) * 255);
      const dispB = Math.round(Math.pow(rawB, 1 / 1.85) * 255);

      const sx = x + p * segW;
      stageCtx.fillStyle = (dispR + dispG + dispB > 6) ? `rgb(${dispR}, ${dispG}, ${dispB})` : '#080c14';
      stageCtx.fillRect(sx + 0.5, y, Math.max(1, segW - 1), barH);

      if (dispR + dispG + dispB > 45) {
        stageCtx.fillStyle = `rgba(${dispR}, ${dispG}, ${dispB}, 0.28)`;
        stageCtx.fillRect(sx - 2, y - 5, segW + 4, barH + 10);
      }
    }

    // Bar ID label
    stageCtx.fillStyle = 'rgba(255, 255, 255, 0.55)';
    stageCtx.font = '700 11px "SF Mono", monospace';
    stageCtx.fillText(item.id, x + 6, y + barH - 6);
  }

  const maxTotal = Math.max(1, pxCount * 255);
  const rPct = Math.min(100, Math.round((sumR / maxTotal) * 100));
  const gPct = Math.min(100, Math.round((sumG / maxTotal) * 100));
  const bPct = Math.min(100, Math.round((sumB / maxTotal) * 100));
  const wPct = Math.min(100, Math.round((sumW / maxTotal) * 100));

  meterR.style.width = `${rPct}%`;
  meterG.style.width = `${gPct}%`;
  meterB.style.width = `${bPct}%`;
  meterW.style.width = `${wPct}%`;

  const avgLoad = (sumR + sumG + sumB + sumW) / (maxTotal * 4);
  const watts = studioState.blackout ? 0 : Math.round(8 + avgLoad * 192);
  wattsReadout.textContent = `${watts} W`;
}

function drawXYCanvas() {
  const w = xyCanvas.width;
  const h = xyCanvas.height;
  xyCtx.clearRect(0, 0, w, h);

  const cellW = w / 3;
  const cellH = h / 3;
  const perfCtx = getPerfContext();
  const nowSec = perfCtx.clockTime;
  const visuals = desk.getTouchVisuals(nowSec);
  const beatSec = 60 / Math.max(40, Math.min(240, perfCtx.bpm || 120));
  const lockedCols = desk.lockedCols;
  const lockedRows = desk.lockedRows;
  const masterHex = rgbArrayToHex(desk.color, '#00f2ff');

  // Tick any active edge bubble hold gestures
  for (const [, hold] of xyBubbleHolds) {
    if (hold.completed) continue;
    const progress = Math.min(1, Math.max(0, (nowSec - hold.startedAt) / XY_BUBBLE_HOLD_SEC));
    if (progress >= 1) {
      hold.completed = true;
      const nextLocked = !hold.initiallyLocked;
      if (hold.kind === 'col') desk.setColumnLocked(hold.index, nextLocked);
      else desk.setRowLocked(hold.index, nextLocked);
      triggerTactileFeedback('press');
      sendCommand({
        type: 'live_pad',
        action: 'set_locks',
        lockedCols: desk.lockedCols,
        lockedRows: desk.lockedRows
      });
    }
  }

  const activeByBar = new Map();
  for (const v of visuals) {
    for (const barId of BAR_IDS) {
      const barGain = desk.getBarGainForTouch(v.id, barId, nowSec);
      const lvl = Math.max(0, Math.min(1, barGain * (desk.intensity ?? 1)));
      if (lvl > 0.005) {
        if (!activeByBar.has(barId) || activeByBar.get(barId).level < lvl) {
          activeByBar.set(barId, { touch: v, level: lvl, vel: barGain });
        }
      }
    }
  }

  // 1. Draw 3x3 Panels & Velocity-Reactive Illumination (Seamless when columns/rows are locked)
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      const barId = BAR_IDS[row * 3 + col];
      const x = col * cellW;
      const y = row * cellH;
      const isColLocked = lockedCols.includes(col);
      const isRowLocked = lockedRows.includes(row);
      const topInset = (isColLocked && row > 0) ? 0 : 4;
      const botInset = (isColLocked && row < 2) ? 0 : 4;
      const leftInset = (isRowLocked && col > 0) ? 0 : 4;
      const rightInset = (isRowLocked && col < 2) ? 0 : 4;

      const rx = x + leftInset;
      const ry = y + topInset;
      const rw = cellW - leftInset - rightInset;
      const rh = cellH - topInset - botInset;
      const activeInfo = activeByBar.get(barId);

      xyCtx.fillStyle = 'rgba(255, 255, 255, 0.022)';
      xyCtx.beginPath();
      xyCtx.roundRect(rx, ry, rw, rh, (isColLocked || isRowLocked) ? 6 : 12);
      xyCtx.fill();

      if (activeInfo) {
        const active = activeInfo.touch;
        const level = activeInfo.level;
        const colHex = rgbArrayToHex(active.color, '#00f2ff');

        xyCtx.save();
        xyCtx.beginPath();
        xyCtx.roundRect(rx, ry, rw, rh, (isColLocked || isRowLocked) ? 6 : 12);
        xyCtx.clip();
        xyCtx.fillStyle = `${colHex}${Math.round((0.12 + level * 0.36) * 255).toString(16).padStart(2, '0')}`;
        xyCtx.fillRect(rx, ry, rw, rh);

        const localTime = Math.max(0, nowSec - (active.startAt ?? nowSec));
        const segAreaX = rx + 10;
        const segAreaW = rw - 20;
        const segAreaY = ry + rh * 0.5 - 8;
        const segW = segAreaW / PIXELS_PER_BAR;
        for (let p = 0; p < PIXELS_PER_BAR; p++) {
          const fx = sampleSpatialPanelEffect(active.effect || 'solid', p, row, col, barId, nowSec, localTime, beatSec);
          const segAlpha = Math.max(0.10, Math.min(1, level * fx));
          xyCtx.fillStyle = colHex;
          xyCtx.globalAlpha = segAlpha;
          xyCtx.fillRect(segAreaX + p * segW + 1, segAreaY, Math.max(2, segW - 2), 16);
        }
        xyCtx.globalAlpha = 1;
        xyCtx.restore();

        if (!isColLocked && !isRowLocked) {
          xyCtx.strokeStyle = colHex;
          xyCtx.lineWidth = 2.0;
          xyCtx.beginPath();
          xyCtx.roundRect(rx, ry, rw, rh, 12);
          xyCtx.stroke();
        }

        if (active.col === col && active.row === row) {
          const pct = Math.round(activeInfo.vel * 100);
          const fxLabel = active.effect && active.effect !== 'solid'
            ? `${(PRESET_LABELS[active.effect] || active.effect).toUpperCase()} · ${pct}%`
            : `${pct}%`;
          xyCtx.fillStyle = '#ffffff';
          xyCtx.font = '800 11px "SF Mono", monospace';
          const textW = xyCtx.measureText(fxLabel).width;
          xyCtx.fillText(fxLabel, rx + rw - textW - 10, ry + 22);
        }
      }

      xyCtx.fillStyle = activeInfo ? '#ffffff' : 'rgba(255, 255, 255, 0.5)';
      xyCtx.font = '800 15px "SF Mono", monospace';
      xyCtx.fillText(barId, x + 14, y + 26);
    }
  }

  // 2. Dashed Internal Grid Lines (Erased inside locked columns / rows)
  xyCtx.save();
  xyCtx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
  xyCtx.lineWidth = 1.2;
  xyCtx.setLineDash([6, 5]);
  for (let colBoundary = 1; colBoundary <= 2; colBoundary++) {
    const xPos = colBoundary * cellW;
    for (let row = 0; row < 3; row++) {
      if (lockedRows.includes(row)) continue;
      xyCtx.beginPath();
      xyCtx.moveTo(xPos, row * cellH + 8);
      xyCtx.lineTo(xPos, (row + 1) * cellH - 8);
      xyCtx.stroke();
    }
  }
  for (let rowBoundary = 1; rowBoundary <= 2; rowBoundary++) {
    const yPos = rowBoundary * cellH;
    for (let col = 0; col < 3; col++) {
      if (lockedCols.includes(col)) continue;
      xyCtx.beginPath();
      xyCtx.moveTo(col * cellW + 8, yPos);
      xyCtx.lineTo((col + 1) * cellW - 8, yPos);
      xyCtx.stroke();
    }
  }
  xyCtx.setLineDash([]);
  xyCtx.restore();

  // 3. Solid Glowing Outer Border around Locked Columns & Rows
  for (const col of lockedCols) {
    xyCtx.save();
    xyCtx.shadowColor = masterHex;
    xyCtx.shadowBlur = 12;
    xyCtx.strokeStyle = masterHex;
    xyCtx.lineWidth = 2.2;
    xyCtx.beginPath();
    xyCtx.roundRect(col * cellW + 3.5, 3.5, cellW - 7, h - 7, 16);
    xyCtx.stroke();
    xyCtx.restore();
  }
  for (const row of lockedRows) {
    xyCtx.save();
    xyCtx.shadowColor = masterHex;
    xyCtx.shadowBlur = 12;
    xyCtx.strokeStyle = masterHex;
    xyCtx.lineWidth = 2.2;
    xyCtx.beginPath();
    xyCtx.roundRect(3.5, row * cellH + 3.5, w - 7, cellH - 7, 16);
    xyCtx.stroke();
    xyCtx.restore();
  }

  // 4. Edge Lock Bubbles (Bottom edge = Columns 0..2, Left edge = Rows 0..2)
  const colHolds = new Map();
  const rowHolds = new Map();
  for (const [, hold] of xyBubbleHolds) {
    if (hold.kind === 'col') colHolds.set(hold.index, hold);
    else rowHolds.set(hold.index, hold);
  }

  for (let col = 0; col < 3; col++) {
    const cx = (col + 0.5) * cellW;
    const cy = h - 13;
    const isLocked = lockedCols.includes(col);
    const hold = colHolds.get(col);
    if (hold && !hold.completed) {
      const raw = Math.min(1, Math.max(0, (nowSec - hold.startedAt) / XY_BUBBLE_HOLD_SEC));
      const eased = 1 - Math.pow(1 - raw, 2.2);
      const spanFrac = hold.initiallyLocked ? (1 - eased) : eased;
      const beamH = Math.max(20, (h - 14) * spanFrac);
      xyCtx.save();
      xyCtx.fillStyle = `${masterHex}38`;
      xyCtx.strokeStyle = masterHex;
      xyCtx.shadowColor = masterHex;
      xyCtx.shadowBlur = 10;
      xyCtx.lineWidth = 2;
      xyCtx.beginPath();
      xyCtx.roundRect(col * cellW + 5, h - 7 - beamH, cellW - 10, beamH, 14);
      xyCtx.fill();
      xyCtx.stroke();
      xyCtx.restore();
    }
    const r = (hold && !hold.completed) ? 8.5 : (isLocked ? 6 : 4.5);
    xyCtx.save();
    if (isLocked || (hold && !hold.completed)) {
      xyCtx.shadowColor = masterHex;
      xyCtx.shadowBlur = 8;
      xyCtx.fillStyle = masterHex;
    } else {
      xyCtx.fillStyle = 'rgba(255, 255, 255, 0.38)';
    }
    xyCtx.beginPath();
    xyCtx.arc(cx, cy, r, 0, Math.PI * 2);
    xyCtx.fill();
    if (isLocked || (hold && !hold.completed)) {
      xyCtx.strokeStyle = '#ffffff';
      xyCtx.lineWidth = 1.5;
      xyCtx.stroke();
    }
    xyCtx.restore();
  }

  for (let row = 0; row < 3; row++) {
    const cx = 13;
    const cy = (row + 0.5) * cellH;
    const isLocked = lockedRows.includes(row);
    const hold = rowHolds.get(row);
    if (hold && !hold.completed) {
      const raw = Math.min(1, Math.max(0, (nowSec - hold.startedAt) / XY_BUBBLE_HOLD_SEC));
      const eased = 1 - Math.pow(1 - raw, 2.2);
      const spanFrac = hold.initiallyLocked ? (1 - eased) : eased;
      const beamW = Math.max(20, (w - 14) * spanFrac);
      xyCtx.save();
      xyCtx.fillStyle = `${masterHex}38`;
      xyCtx.strokeStyle = masterHex;
      xyCtx.shadowColor = masterHex;
      xyCtx.shadowBlur = 10;
      xyCtx.lineWidth = 2;
      xyCtx.beginPath();
      xyCtx.roundRect(7, row * cellH + 5, beamW, cellH - 10, 14);
      xyCtx.fill();
      xyCtx.stroke();
      xyCtx.restore();
    }
    const r = (hold && !hold.completed) ? 8.5 : (isLocked ? 6 : 4.5);
    xyCtx.save();
    if (isLocked || (hold && !hold.completed)) {
      xyCtx.shadowColor = masterHex;
      xyCtx.shadowBlur = 8;
      xyCtx.fillStyle = masterHex;
    } else {
      xyCtx.fillStyle = 'rgba(255, 255, 255, 0.38)';
    }
    xyCtx.beginPath();
    xyCtx.arc(cx, cy, r, 0, Math.PI * 2);
    xyCtx.fill();
    if (isLocked || (hold && !hold.completed)) {
      xyCtx.strokeStyle = '#ffffff';
      xyCtx.lineWidth = 1.5;
      xyCtx.stroke();
    }
    xyCtx.restore();
  }

  // 5. Smooth Guitar Strum Ribbon & Finger Touch Puck
  for (const v of visuals) {
    const colHex = rgbArrayToHex(v.color, '#00f2ff');
    const pts = v.trailPoints || [];
    if (pts.length >= 2) {
      xyCtx.save();
      xyCtx.lineCap = 'round';
      xyCtx.lineJoin = 'round';
      for (let i = 1; i < pts.length; i++) {
        const p0 = pts[i - 1];
        const p1 = pts[i];
        const age = Math.max(0, nowSec - p1.time);
        const life = Math.max(0, Math.min(1, 1 - age / 0.36));
        if (life <= 0.02) continue;
        xyCtx.strokeStyle = colHex;
        xyCtx.globalAlpha = life * 0.55;
        xyCtx.lineWidth = 3 + life * 9 * (v.velocityGain ?? 1);
        xyCtx.beginPath();
        xyCtx.moveTo(p0.x * w, p0.y * h);
        xyCtx.lineTo(p1.x * w, p1.y * h);
        xyCtx.stroke();
      }
      xyCtx.globalAlpha = 1;
      xyCtx.restore();
    }

    const px = v.x * w;
    const py = v.y * h;
    const puckR = 9 + (v.velocityGain ?? 1) * 4;
    xyCtx.beginPath();
    xyCtx.arc(px, py, puckR, 0, Math.PI * 2);
    xyCtx.fillStyle = '#ffffff';
    xyCtx.fill();
    xyCtx.strokeStyle = colHex;
    xyCtx.lineWidth = 3;
    xyCtx.stroke();
  }
}

// Dialog Light-Dismiss Helper (Modern Web Guidance `light-dismiss-a-dialog`)
function setupLightDismissDialog(dialogEl, closeBtnId) {
  const closeBtn = document.getElementById(closeBtnId);
  closeBtn?.addEventListener('click', () => dialogEl.close());
  // Safari fallback when clicking the ::backdrop directly
  dialogEl.addEventListener('click', e => {
    if (e.target === dialogEl) dialogEl.close();
  });
}

// Pad Inspector Logic
const inspPadKey = document.getElementById('inspector-pad-key');
const inspName = document.getElementById('insp-name');
const inspModeSwitch = document.getElementById('insp-mode-switch');
const inspBarGrid = document.getElementById('insp-bar-grid');
const inspPresetGrid = document.getElementById('insp-preset-grid');
const inspColorA = document.getElementById('insp-color-a');
const inspColorB = document.getElementById('insp-color-b');
const inspSwatchStrip = document.getElementById('insp-swatch-strip');
const inspDriverRow = document.getElementById('insp-driver-row');
const inspDuration = document.getElementById('insp-duration');
const inspDurVal = document.getElementById('insp-dur-val');

function initInspectorControls() {
  setupLightDismissDialog(inspectorDialog, 'btn-close-inspector');
  document.getElementById('btn-done-inspector')?.addEventListener('click', () => inspectorDialog.close());

  // Populate 16 presets
  inspPresetGrid.innerHTML = '';
  for (const preset of PRESETS.slice(0, 16)) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'preset-chip';
    chip.dataset.preset = preset;
    chip.textContent = PRESET_LABELS[preset] || preset;
    chip.addEventListener('click', () => {
      const pad = ensureSelectedPad();
      pad.preset = preset;
      syncSelectedPadToStudio();
      populateInspectorFromPad();
    });
    inspPresetGrid.appendChild(chip);
  }

  // Populate color swatches
  inspSwatchStrip.innerHTML = '';
  for (const [hexA, hexB] of COLOR_SWATCHES) {
    const sw = document.createElement('button');
    sw.type = 'button';
    sw.className = 'color-swatch-btn';
    sw.style.background = `linear-gradient(135deg, ${hexA}, ${hexB})`;
    sw.addEventListener('click', () => {
      const pad = ensureSelectedPad();
      pad.color = hexToRgbArray(hexA);
      pad.colorSecondary = hexToRgbArray(hexB);
      syncSelectedPadToStudio();
      populateInspectorFromPad();
    });
    inspSwatchStrip.appendChild(sw);
  }

  inspName.addEventListener('input', () => {
    const pad = ensureSelectedPad();
    pad.name = inspName.value.trim() || `Pad ${PAD_KEYS[selectedPadIndex]}`;
    syncSelectedPadToStudio();
  });

  inspModeSwitch.querySelectorAll('.seg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const pad = ensureSelectedPad();
      pad.mode = btn.dataset.mode === 'loop' ? 'loop' : 'hit';
      syncSelectedPadToStudio();
      populateInspectorFromPad();
    });
  });

  inspBarGrid.querySelectorAll('.insp-bar-cell').forEach(cell => {
    cell.addEventListener('click', () => {
      toggleBarOnSelectedPad(cell.dataset.bar);
      populateInspectorFromPad();
    });
  });

  document.querySelectorAll('[data-zone-preset]').forEach(btn => {
    const presetIds = ZONE_PRESETS[btn.dataset.zonePreset] || BAR_IDS;
    const labelText = btn.textContent.trim();
    btn.textContent = '';
    btn.append(createZoneGridIcon(presetIds, BAR_IDS));
    const span = document.createElement('span');
    span.className = 'zone-btn-label';
    span.textContent = labelText;
    btn.append(span);
    btn.addEventListener('click', () => {
      const pad = ensureSelectedPad();
      pad.bars = [...presetIds];
      pad.targets = presetIds.length === 9 ? 'all' : [...presetIds];
      syncSelectedPadToStudio();
      populateInspectorFromPad();
    });
  });

  inspColorA.addEventListener('input', () => {
    const pad = ensureSelectedPad();
    pad.color = hexToRgbArray(inspColorA.value);
    syncSelectedPadToStudio();
  });

  inspColorB.addEventListener('input', () => {
    const pad = ensureSelectedPad();
    pad.name = inspName.value.trim() || `Pad ${PAD_KEYS[selectedPadIndex]}`;
    syncSelectedPadToStudio();
  });

  inspModeSwitch.querySelectorAll('.seg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const pad = ensureSelectedPad();
      pad.mode = btn.dataset.mode === 'loop' ? 'loop' : 'hit';
      syncSelectedPadToStudio();
      populateInspectorFromPad();
    });
  });

  inspBarGrid.querySelectorAll('.insp-bar-cell').forEach(cell => {
    cell.addEventListener('click', () => {
      toggleBarOnSelectedPad(cell.dataset.bar);
      populateInspectorFromPad();
    });
  });

  document.querySelectorAll('[data-zone-preset]').forEach(btn => {
    const presetIds = ZONE_PRESETS[btn.dataset.zonePreset] || BAR_IDS;
    const labelText = btn.textContent.trim();
    btn.textContent = '';
    btn.append(createZoneGridIcon(presetIds, BAR_IDS));
    const span = document.createElement('span');
    span.className = 'zone-btn-label';
    span.textContent = labelText;
    btn.append(span);
    btn.addEventListener('click', () => {
      const pad = ensureSelectedPad();
      pad.bars = [...presetIds];
      pad.targets = presetIds.length === 9 ? 'all' : [...presetIds];
      syncSelectedPadToStudio();
      populateInspectorFromPad();
    });
  });

  inspColorA.addEventListener('input', () => {
    const pad = ensureSelectedPad();
    pad.color = hexToRgbArray(inspColorA.value);
    syncSelectedPadToStudio();
  });

  inspColorB.addEventListener('input', () => {
    const pad = ensureSelectedPad();
    pad.colorSecondary = hexToRgbArray(inspColorB.value);
    syncSelectedPadToStudio();
  });

  inspDriverRow.querySelectorAll('[data-driver]').forEach(btn => {
    btn.addEventListener('click', () => {
      const pad = ensureSelectedPad();
      pad.driver = btn.dataset.driver;
      syncSelectedPadToStudio();
      populateInspectorFromPad();
    });
  });

  inspDuration.addEventListener('input', () => {
    const pad = ensureSelectedPad();
    const dur = Number(inspDuration.value) / 100;
    pad.duration = dur;
    inspDurVal.textContent = `${dur.toFixed(2)} s`;
    syncSelectedPadToStudio();
  });

  document.getElementById('btn-test-insp-pad')?.addEventListener('click', () => {
    triggerTactileFeedback('press');
    desk.trigger(selectedPadIndex, getPerfContext());
    sendCommand({ type: 'live_pad', action: 'trigger', index: selectedPadIndex });
  });
}

function ensureSelectedPad() {
  if (!desk.pads[selectedPadIndex]) {
    desk.setPad(selectedPadIndex, { preset: 'pulse', mode: 'hit' });
  }
  return desk.pads[selectedPadIndex];
}

function toggleBarOnSelectedPad(barId) {
  const pad = ensureSelectedPad();
  const existing = Array.isArray(pad.bars) ? pad.bars : (Array.isArray(pad.targets) ? pad.targets : BAR_IDS);
  const current = new Set(existing.length ? existing : BAR_IDS);
  if (current.has(barId) && current.size > 1) {
    current.delete(barId);
  } else {
    current.add(barId);
  }
  const nextBars = BAR_IDS.filter(id => current.has(id));
  pad.bars = nextBars;
  pad.targets = nextBars.length === 9 ? 'all' : nextBars;
  syncSelectedPadToStudio();
}

function syncSelectedPadToStudio() {
  const pad = desk.pads[selectedPadIndex];
  refreshPadTilesUI();
  if (pad) {
    sendCommand({ type: 'live_pad', action: 'set', index: selectedPadIndex, pad });
  }
}

function populateInspectorFromPad() {
  const pad = ensureSelectedPad();
  inspPadKey.textContent = PAD_KEYS[selectedPadIndex];
  inspName.value = pad.name || '';

  inspModeSwitch.querySelectorAll('.seg-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === pad.mode);
  });

  const barSet = new Set(Array.isArray(pad.bars) && pad.bars.length ? pad.bars : BAR_IDS);
  inspBarGrid.querySelectorAll('.insp-bar-cell').forEach(cell => {
    cell.classList.toggle('selected', barSet.has(cell.dataset.bar));
  });
  document.querySelectorAll('[data-zone-preset]').forEach(btn => {
    const presetIds = ZONE_PRESETS[btn.dataset.zonePreset] || BAR_IDS;
    const active = presetIds.length === barSet.size && presetIds.every(id => barSet.has(id));
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', String(active));
  });

  inspPresetGrid.querySelectorAll('.preset-chip').forEach(chip => {
    chip.classList.toggle('active', chip.dataset.preset === pad.preset);
  });

  inspColorA.value = rgbArrayToHex(pad.color, '#00f2ff');
  inspColorB.value = rgbArrayToHex(pad.colorSecondary || pad.color, '#38bdf8');

  inspDriverRow.querySelectorAll('[data-driver]').forEach(btn => {
    btn.classList.toggle('active', (pad.driver || 'none') === btn.dataset.driver);
  });

  const dur = Number(pad.duration || 0.85);
  inspDuration.value = String(Math.round(dur * 100));
  inspDurVal.textContent = `${dur.toFixed(2)} s`;
}

function openPadInspector(index = selectedPadIndex) {
  selectPad(index);
  populateInspectorFromPad();
  if (!inspectorDialog.open) inspectorDialog.showModal();
}

// Transport & Track Sheet
const sheetMasterSlider = document.getElementById('sheet-master-slider');
const sheetMasterVal = document.getElementById('sheet-master-val');
const sheetSectionsBlock = document.getElementById('sheet-sections-block');
const sheetSectionsGrid = document.getElementById('sheet-sections-grid');
const sheetTrackList = document.getElementById('sheet-track-list');

function initTransportSheet() {
  setupLightDismissDialog(transportDialog, 'btn-close-transport');

  sheetMasterSlider.addEventListener('input', () => {
    const val = Number(sheetMasterSlider.value);
    studioState.master = val;
    sheetMasterVal.textContent = `${val}%`;
    sendCommand({ type: 'master', value: val });
  });

  document.getElementById('sheet-btn-rewind')?.addEventListener('click', () => {
    studioState.timeSec = 0;
    studioState.lastSyncPerfMs = performance.now();
    sendCommand({ type: 'seek', timeSec: 0 });
  });

  document.getElementById('sheet-btn-play')?.addEventListener('click', () => {
    toggleStudioPlay();
  });

  document.getElementById('sheet-btn-claim')?.addEventListener('click', async () => {
    await toggleStageOwnership();
  });
}

async function openTransportSheet() {
  sheetMasterSlider.value = String(studioState.master || 35);
  sheetMasterVal.textContent = `${studioState.master || 35}%`;
  renderSectionsInSheet();
  if (!transportDialog.open) transportDialog.showModal();
  await loadLibraryTracks();
}

async function loadLibraryTracks() {
  try {
    const res = await fetch('/api/library/tracks');
    const data = await res.json();
    if (Array.isArray(data.tracks)) {
      studioState.tracks = data.tracks;
      sheetTrackList.innerHTML = '';
      for (const t of data.tracks) {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = `track-row-btn ${t.id === studioState.trackId ? 'active' : ''}`;
        const bpmTxt = t.bpm ? `${Math.round(t.bpm)} BPM` : '';
        row.innerHTML = `<strong>${t.title || t.originalName}</strong><small>${bpmTxt}</small>`;
        row.addEventListener('click', () => {
          studioState.trackId = t.id;
          studioState.trackTitle = t.title || t.originalName;
          trackTitleEl.textContent = studioState.trackTitle;
          sendCommand({ type: 'select_track', trackId: t.id });
          loadLibraryTracks();
        });
        sheetTrackList.appendChild(row);
      }
    }
  } catch {}
}

function renderSectionsInSheet() {
  if (!Array.isArray(studioState.sections) || studioState.sections.length === 0) {
    sheetSectionsBlock.hidden = true;
    return;
  }
  sheetSectionsBlock.hidden = false;
  sheetSectionsGrid.innerHTML = '';
  for (const sec of studioState.sections) {
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'tiny-pill';
    pill.textContent = `${sec.label || sec.kind} (${Math.floor(sec.startSec)}s)`;
    pill.addEventListener('click', () => {
      studioState.timeSec = Number(sec.startSec) || 0;
      studioState.lastSyncPerfMs = performance.now();
      sendCommand({ type: 'seek', timeSec: studioState.timeSec });
    });
    sheetSectionsGrid.appendChild(pill);
  }
}

function toggleStudioPlay() {
  triggerTactileFeedback('press');
  studioState.isPlaying = !studioState.isPlaying;
  studioState.lastSyncPerfMs = performance.now();
  syncTransportUI();
  sendCommand({ type: studioState.isPlaying ? 'play' : 'pause' });
}

async function toggleStageOwnership() {
  triggerTactileFeedback('press');
  try {
    const res = await fetch('/api/lan/claim-stage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId,
        name: 'iPhone Live Pad',
        source: 'pad',
        release: isStageOwner
      })
    });
    const data = await res.json();
    if (data.ok) {
      isStageOwner = Boolean(data.isStageOwner);
      syncStageRoleUI();
    }
  } catch {}
}

function syncStageRoleUI() {
  btnStageRole.classList.toggle('solo', !isStageOwner);
  stageRoleLabel.textContent = isStageOwner ? 'ON AIR' : 'SOLO · PREUZMI';
}

function syncTransportUI() {
  playIndicator.textContent = studioState.isPlaying ? '▶' : '⏸';
  dockPlayIcon.textContent = studioState.isPlaying ? '⏸' : '▶';
  dockPlayText.textContent = studioState.isPlaying ? 'Pause' : 'Play';
  btnPlayToggle.classList.toggle('playing', studioState.isPlaying);
  trackTitleEl.textContent = studioState.trackTitle || 'LEDicated Live Performance';
  sectionTagEl.textContent = (studioState.sectionName || 'LIVE').toUpperCase();
  topBpmLabel.textContent = `${Math.round(studioState.bpm || 124)} BPM`;
  btnBlackout.setAttribute('aria-pressed', String(Boolean(studioState.blackout)));
  btnQuantize.setAttribute('aria-pressed', String(Boolean(desk.quantize)));
}

// Wire Topbar, Macro & Expression Controls
function setupControls() {
  btnStageRole.addEventListener('click', toggleStageOwnership);

  btnRecSession.addEventListener('click', () => {
    isRecordingSession = !isRecordingSession;
    btnRecSession.setAttribute('aria-pressed', String(isRecordingSession));
    triggerTactileFeedback('press');
  });

  btnOpenTransport.addEventListener('click', openTransportSheet);
  btnTrackBanner.addEventListener('click', openTransportSheet);

  btnBlackout.addEventListener('click', () => {
    triggerTactileFeedback('press');
    studioState.blackout = !studioState.blackout;
    if (studioState.blackout) desk.clear();
    syncTransportUI();
    sendCommand({ type: 'blackout', value: studioState.blackout });
  });

  btnZonePaint.addEventListener('click', () => {
    zonePaintOpen = !zonePaintOpen;
    zonePaintOverlay.hidden = !zonePaintOpen;
    btnZonePaint.setAttribute('aria-pressed', String(zonePaintOpen));
  });

  btnZoneAll.addEventListener('click', () => {
    const pad = ensureSelectedPad();
    pad.bars = [...BAR_IDS];
    syncSelectedPadToStudio();
  });

  zonePaintOverlay.querySelectorAll('.zone-bar-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      toggleBarOnSelectedPad(chip.dataset.bar);
    });
  });

  surfaceTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      activeSurface = tab.dataset.surface;
      surfaceTabs.forEach(t => {
        const active = t === tab;
        t.classList.toggle('active', active);
        t.setAttribute('aria-selected', String(active));
      });
      padMatrixGrid.hidden = activeSurface !== 'pads';
      xyMorphSurface.hidden = activeSurface !== 'xy';
    });
  });

  btnQuantize.addEventListener('click', () => {
    desk.setQuantize(!desk.quantize);
    btnQuantize.setAttribute('aria-pressed', String(desk.quantize));
    sendCommand({ type: 'live_pad', action: 'quantize', value: desk.quantize });
  });

  btnHoldLatch.addEventListener('click', () => {
    holdLatchMode = !holdLatchMode;
    btnHoldLatch.setAttribute('aria-pressed', String(holdLatchMode));
    if (!holdLatchMode) {
      desk.releaseAll(getPerfContext());
      sendCommand({ type: 'live_pad', action: 'release_all' });
    }
  });

  btnEditMode.addEventListener('click', () => {
    inspectorOnTapMode = !inspectorOnTapMode;
    btnEditMode.setAttribute('aria-pressed', String(inspectorOnTapMode));
  });

  btnPanicPads.addEventListener('click', () => {
    triggerTactileFeedback('press');
    desk.clear();
    sendCommand({ type: 'live_pad', action: 'clear' });
  });

  // Expression Dials
  let dialSyncTimer = 0;
  const pushDialUpdate = () => {
    const now = performance.now();
    if (now - dialSyncTimer < 60) return;
    dialSyncTimer = now;
    const pad = desk.pads[selectedPadIndex];
    if (pad) sendCommand({ type: 'live_pad', action: 'set', index: selectedPadIndex, pad });
  };

  dialIntensity.addEventListener('input', () => {
    const pad = ensureSelectedPad();
    const pct = Number(dialIntensity.value);
    pad.intensity = Number((pct / 100).toFixed(2));
    valIntensity.textContent = `${pct}%`;
    pushDialUpdate();
  });

  dialSpeed.addEventListener('input', () => {
    const pad = ensureSelectedPad();
    const spd = Number(dialSpeed.value) / 10;
    pad.params = { ...(pad.params || {}), speed: spd };
    valSpeed.textContent = `${spd.toFixed(1)}×`;
    pushDialUpdate();
  });

  dialWhite.addEventListener('input', () => {
    const pad = ensureSelectedPad();
    const wPct = Number(dialWhite.value);
    pad.white = Number((wPct / 100).toFixed(2));
    valWhite.textContent = `${wPct}%`;
    pushDialUpdate();
  });

  btnPlayToggle.addEventListener('click', toggleStudioPlay);
  selectedPadSummary.addEventListener('click', () => openPadInspector(selectedPadIndex));
  btnInspectPad.addEventListener('click', () => openPadInspector(selectedPadIndex));
}

// SSE Live Stream & Initial Sync
async function connectStudioStream() {
  try {
    const res = await fetch('/api/live/pads');
    if (res.ok) {
      const data = await res.json();
      connDot.classList.add('online');
      connDot.classList.remove('offline');
      studioConnected = true;
      if (Array.isArray(data.pads)) {
        data.pads.forEach((p, idx) => {
          if (p) {
            desk.setPad(idx, p);
            desk.pads[idx].name = p.name;
            desk.pads[idx].bars = p.bars;
          } else {
            desk.removePad(idx);
          }
        });
      }
      if (typeof data.quantize === 'boolean') {
        desk.setQuantize(data.quantize);
      }
      if (data.liveState) applyRemoteLiveState(data.liveState);
      refreshPadTilesUI();
      syncTransportUI();
    }
  } catch {
    connDot.classList.add('offline');
  }

  const sse = new EventSource(`/api/live/stream?clientId=${encodeURIComponent(clientId)}&name=${encodeURIComponent('iPhone Live Pad')}&role=companion`);

  sse.addEventListener('open', () => {
    connDot.classList.add('online');
    connDot.classList.remove('offline');
    studioConnected = true;
  });

  sse.addEventListener('error', () => {
    connDot.classList.remove('online');
    connDot.classList.add('offline');
  });

  sse.addEventListener('command', event => {
    let cmd;
    try { cmd = JSON.parse(event.data); } catch { return; }
    if (!cmd || cmd.clientId === clientId) return;

    if (cmd.type === 'frame_sync') {
      if (cmd.bars && typeof cmd.bars === 'object') {
        studioState.remoteBars = cmd.bars;
        studioState.remoteBarsAt = performance.now();
      }
      if (typeof cmd.isPlaying === 'boolean' && studioState.isPlaying !== cmd.isPlaying) {
        studioState.isPlaying = cmd.isPlaying;
        syncTransportUI();
      }
      if (Number.isFinite(cmd.timeSec)) {
        studioState.timeSec = Number(cmd.timeSec);
        studioState.lastSyncPerfMs = performance.now();
      }
      if (Number.isFinite(cmd.bpm) && cmd.bpm > 0) {
        studioState.bpm = Number(cmd.bpm);
      }
      if (typeof cmd.blackout === 'boolean' && studioState.blackout !== cmd.blackout) {
        studioState.blackout = cmd.blackout;
        syncTransportUI();
      }
      return;
    }

    if (cmd.type === 'pads_sync' && Array.isArray(cmd.pads)) {
      cmd.pads.forEach((p, idx) => {
        if (p) {
          desk.setPad(idx, p);
          desk.pads[idx].name = p.name;
          desk.pads[idx].bars = p.bars;
        } else {
          desk.removePad(idx);
        }
      });
      if (typeof cmd.quantize === 'boolean') desk.setQuantize(cmd.quantize);
      refreshPadTilesUI();
      syncTransportUI();
      return;
    }

    if (cmd.type === 'live_pad') {
      const idx = Number.isInteger(cmd.index) ? cmd.index : PAD_KEYS.indexOf(String(cmd.key || '').toLowerCase());
      const act = cmd.action || 'trigger';
      const ctx = getPerfContext();
      if (act === 'clear' || act === 'stop_all') desk.clear();
      else if (act === 'release_all') desk.releaseAll();
      else if (act === 'quantize') desk.setQuantize(Boolean(cmd.value));
      else if (idx >= 0 && idx < 12) {
        if (act === 'set' && cmd.pad) {
          desk.setPad(idx, cmd.pad);
          desk.pads[idx].name = cmd.pad.name;
          desk.pads[idx].bars = cmd.pad.bars;
          refreshPadTilesUI();
        } else if (act === 'press') {
          desk.press(idx, ctx);
        } else if (act === 'release') {
          desk.release(idx, ctx);
        } else if (act === 'trigger' || act === 'hit' || act === 'loop') {
          desk.trigger(idx, ctx);
        }
      }
      syncTransportUI();
    } else if (cmd.type === 'play') {
      studioState.isPlaying = true;
      studioState.lastSyncPerfMs = performance.now();
      syncTransportUI();
    } else if (cmd.type === 'pause') {
      studioState.isPlaying = false;
      syncTransportUI();
    } else if (cmd.type === 'seek' && Number.isFinite(cmd.timeSec)) {
      studioState.timeSec = Number(cmd.timeSec);
      studioState.lastSyncPerfMs = performance.now();
    } else if (cmd.type === 'blackout') {
      studioState.blackout = Boolean(cmd.value);
      if (studioState.blackout) desk.clear();
      syncTransportUI();
    } else if (cmd.type === 'lan_presence') {
      isStageOwner = !cmd.stageOwnerId || cmd.stageOwnerId === clientId;
      syncStageRoleUI();
    }
  });

  // Periodic lightweight status poll to keep playhead & track metadata fresh
  setInterval(async () => {
    try {
      const res = await fetch('/api/live/status');
      if (!res.ok) return;
      const data = await res.json();
      if (data.liveState) applyRemoteLiveState(data.liveState);
    } catch {}
  }, 1500);
}

function applyRemoteLiveState(live) {
  if (!live || typeof live !== 'object') return;
  if (live.trackId) studioState.trackId = live.trackId;
  if (live.trackTitle) studioState.trackTitle = live.trackTitle;
  if (live.sectionName) studioState.sectionName = live.sectionName;
  if (typeof live.isPlaying === 'boolean') studioState.isPlaying = live.isPlaying;
  if (Number.isFinite(live.timeSec)) {
    studioState.timeSec = Number(live.timeSec);
    studioState.lastSyncPerfMs = performance.now();
  }
  if (Number.isFinite(live.durationSec)) studioState.durationSec = Number(live.durationSec);
  if (Number.isFinite(live.bpm) && live.bpm > 0) studioState.bpm = Number(live.bpm);
  if (Number.isFinite(live.master)) studioState.master = Number(live.master);
  if (typeof live.blackout === 'boolean') studioState.blackout = live.blackout;
  if (Array.isArray(live.sections)) studioState.sections = live.sections;
  if (Array.isArray(live.pads)) {
    live.pads.forEach((p, idx) => {
      if (p) {
        desk.setPad(idx, p);
        desk.pads[idx].name = p.name;
        desk.pads[idx].bars = p.bars;
      } else {
        desk.removePad(idx);
      }
    });
    refreshPadTilesUI();
  }
  syncTransportUI();
}

// Initialize Everything
buildPadGrid();
setupMultiTouchPadEvents();
setupXYSurface();
initInspectorControls();
initTransportSheet();
setupControls();
connectStudioStream();
requestAnimationFrame(renderTick);
