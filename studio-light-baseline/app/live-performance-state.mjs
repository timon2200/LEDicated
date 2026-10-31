/** Small, deterministic performance desk. Pad definitions are local preferences;
 * active gestures are ephemeral and never change the saved song arrangement. */
import { BAR_IDS, PIXELS_PER_BAR } from './engine.mjs';
import { TIMELINE_PRESETS, renderTimelineFrame } from './timeline.mjs';

export const PAD_KEYS = Object.freeze(['q', 'w', 'e', 'r', 'a', 's', 'd', 'f', 'z', 'x', 'c', 'v']);
export const HOLD_THRESHOLD_SEC = .22;
export const QUICK_PRESS_SEC = .22;
export const HOLD_FADE_SEC = 1.5;
export const STROBE_DURATION_SEC = .42;
export const STROBE_HZ = 18;
export const RELEASE_TAIL_SEC = .1;
export const DEFAULT_LIVE_COLOR = Object.freeze([0, .82, 1, 0]);
export const DEFAULT_LIVE_INTENSITY = 1;
export const DEFAULT_LIVE_EFFECT = 'solid';
export const SPATIAL_TOUCH_EFFECTS = Object.freeze([
  'solid',
  'pulse',
  'wash',
  'wave',
  'sparkle',
  'fire',
  'rain',
  'chase',
  'flash',
  'ripple',
  'bounce',
  'sweep',
  'spiral',
  'columns',
  'alternate',
  'center',
  'strobe'
]);

export function sampleSpatialPanelEffect(effect, pixel, row, col, barId, timeSec, localTime, beatSec) {
  const u = PIXELS_PER_BAR > 1 ? pixel / (PIXELS_PER_BAR - 1) : 0;
  const centerDist = Math.abs(u - 0.5) * 2;
  const safeBeat = Math.max(0.2, beatSec || 0.5);
  const beatPhase = (timeSec / safeBeat) % 1;

  switch (effect) {
    case 'solid':
      return 1;
    case 'pulse': {
      const wave = 0.5 + 0.5 * Math.sin(localTime * (2 * Math.PI / safeBeat) + Math.PI * 0.5);
      return 0.22 + 0.78 * Math.pow(wave, 1.35);
    }
    case 'wash': {
      const drift = 0.5 + 0.5 * Math.sin(timeSec * 2.2 + u * 2.6 + row * 0.7 + col * 0.5);
      return 0.45 + 0.55 * drift;
    }
    case 'wave': {
      const w = 0.5 + 0.5 * Math.sin(localTime * 6.5 - u * Math.PI * 2.2);
      return 0.15 + 0.85 * w;
    }
    case 'sparkle': {
      const tick = Math.floor(timeSec * 18);
      const seed = (pixel * 73 + row * 19 + col * 37 + tick * 29) % 97;
      const glint = seed < 26 ? 1 : (seed < 48 ? 0.45 : 0.12);
      return glint;
    }
    case 'fire': {
      const flame = Math.max(0, 1 - u * 0.65);
      const flicker = 0.55 + 0.45 * Math.sin(timeSec * 13 + pixel * 1.7) * Math.cos(timeSec * 7.3 - pixel * 0.9);
      return clamp(flame * flicker + 0.15, 0.08, 1);
    }
    case 'rain': {
      const pos = (localTime * 1.9 + col * 0.27) % 1;
      const d = Math.abs(u - pos);
      const wrapD = Math.min(d, 1 - d);
      return clamp(Math.exp(-wrapD * 6.5) + 0.1, 0, 1);
    }
    case 'chase': {
      const head = (localTime * (1.2 / safeBeat)) % 1;
      const d = Math.min(Math.abs(u - head), 1 - Math.abs(u - head));
      return clamp(Math.exp(-d * d * 28) + 0.08, 0, 1);
    }
    case 'flash': {
      const decay = Math.exp(-((localTime % safeBeat) / safeBeat) * 3.4);
      const edgeBoost = 1 - centerDist * 0.25;
      return clamp(decay * edgeBoost, 0.12, 1);
    }
    case 'ripple': {
      const r = (localTime * 1.8) % 1;
      const ring = Math.exp(-Math.pow((centerDist - r) / 0.28, 2));
      return clamp(ring * 0.9 + 0.15, 0, 1);
    }
    case 'bounce': {
      const b = 0.5 + 0.5 * Math.sin(localTime * (Math.PI * 2 / safeBeat));
      const d = Math.abs(u - b);
      return clamp(Math.exp(-d * d * 18) + 0.1, 0, 1);
    }
    case 'sweep': {
      const sw = (localTime * 1.35) % 1;
      const d = Math.abs(u - sw);
      return clamp(Math.exp(-d * 5.2) + 0.1, 0, 1);
    }
    case 'spiral': {
      const phase = (localTime * 4.8 + (row * 3 + col) * 0.45 + u * 2.4) % (Math.PI * 2);
      return 0.2 + 0.8 * (0.5 + 0.5 * Math.sin(phase));
    }
    case 'columns': {
      const seg = Math.floor(u * 3) % 2;
      const flip = Math.floor(localTime / (safeBeat * 0.5)) % 2;
      return seg === flip ? 1 : 0.18;
    }
    case 'alternate': {
      const half = pixel < PIXELS_PER_BAR / 2 ? 0 : 1;
      const step = Math.floor(localTime / (safeBeat * 0.5)) % 2;
      return half === step ? 1 : 0.15;
    }
    case 'center': {
      const core = Math.exp(-centerDist * centerDist * 3.2);
      const breathe = 0.72 + 0.28 * Math.sin(localTime * 4);
      return clamp(core * breathe, 0.12, 1);
    }
    case 'strobe': {
      const on = ((localTime * 12) % 1) < 0.48;
      return on ? 1 : 0.04;
    }
    default:
      return 1;
  }
}

/** Convert HSV (hue 0..360, sat 0..1, val 0..1) into normalized RGBW [r, g, b, w] (0..1).
 * Center of the color wheel (sat -> 0) blends smoothly into warm-white W + RGB. */
export function hsvToRgbw(hue = 0, sat = 1, val = 1) {
  const h = ((Number(hue) || 0) % 360 + 360) % 360;
  const s = Math.max(0, Math.min(1, Number.isFinite(sat) ? sat : 1));
  const v = Math.max(0, Math.min(1, Number.isFinite(val) ? val : 1));
  const c = v * s;
  const x = c * (1 - Math.abs((h / 60) % 2 - 1));
  const m = v - c;
  let r1 = 0, g1 = 0, b1 = 0;
  if (h < 60) { r1 = c; g1 = x; }
  else if (h < 120) { r1 = x; g1 = c; }
  else if (h < 180) { g1 = c; b1 = x; }
  else if (h < 240) { g1 = x; b1 = c; }
  else if (h < 300) { r1 = x; b1 = c; }
  else { r1 = c; b1 = x; }
  const w = Math.pow(1 - s, 1.35) * v;
  const r = Math.min(1, (r1 + m * 0.65));
  const g = Math.min(1, (g1 + m * 0.65));
  const b = Math.min(1, (b1 + m * 0.65));
  return [Number(r.toFixed(4)), Number(g.toFixed(4)), Number(b.toFixed(4)), Number(w.toFixed(4))];
}

/** Inverse approximation from normalized RGBW [r, g, b, w] to { hue, sat } on the color wheel. */
export function rgbwToHsv(color = DEFAULT_LIVE_COLOR) {
  const [r = 0, g = 0, b = 0, w = 0] = Array.isArray(color) ? color : DEFAULT_LIVE_COLOR;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let hue = 0;
  if (d > 1e-4) {
    if (max === r) hue = ((g - b) / d + (g < b ? 6 : 0)) * 60;
    else if (max === g) hue = ((b - r) / d + 2) * 60;
    else hue = ((r - g) / d + 4) * 60;
  }
  const rgbSat = max > 1e-4 ? d / max : 0;
  const sat = Math.max(0, Math.min(1, rgbSat * (1 - Math.min(1, w * 0.85))));
  return { hue: Math.round(hue) % 360, sat: Number(sat.toFixed(3)) };
}

/** Map normalized pad coordinate (x, y) in [0..1] to the 3x3 bar ID (L1 top-left .. R3 bottom-right). */
export function barIdAtCoord(x = 0.5, y = 0.5) {
  const col = Math.max(0, Math.min(2, Math.floor(Math.max(0, Math.min(0.9999, x)) * 3)));
  const row = Math.max(0, Math.min(2, Math.floor(Math.max(0, Math.min(0.9999, y)) * 3)));
  return BAR_IDS[row * 3 + col];
}

export function colWithHysteresis(x, prevCol, deadband = 0.016) {
  const nx = clamp(Number.isFinite(x) ? x : 0.5, 0, 1);
  if (prevCol === 0) {
    if (nx >= 1 / 3 + deadband) return nx >= 2 / 3 + deadband ? 2 : 1;
    return 0;
  }
  if (prevCol === 1) {
    if (nx <= 1 / 3 - deadband) return 0;
    if (nx >= 2 / 3 + deadband) return 2;
    return 1;
  }
  if (prevCol === 2) {
    if (nx <= 2 / 3 - deadband) return nx <= 1 / 3 - deadband ? 0 : 1;
    return 2;
  }
  return Math.max(0, Math.min(2, Math.floor(Math.min(0.9999, nx) * 3)));
}

/** Map a bar ID ('L1'..'R3') to its normalized center coordinate { x, y } on the 3x3 pad. */
export function coordForBarId(barId = 'C2') {
  const idx = Math.max(0, BAR_IDS.indexOf(barId));
  const row = Math.floor(idx / 3), col = idx % 3;
  return {
    x: col === 0 ? 0 : (col === 1 ? 0.5 : 1),
    y: row === 0 ? 0 : (row === 1 ? 0.5 : 1),
    centerX: (col + 0.5) / 3,
    centerY: (row + 0.5) / 3
  };
}
/** Values map directly to the existing timeline renderer's effect parameters. */
export const LIVE_PARAM_OPTIONS = Object.freeze({
  wash: [['mood', 'Karakter', [['drift', 'Lebdeći', '≋'], ['breath', 'Disanje', '◉'], ['still', 'Mirno', '━']]]],
  pulse: [['curve', 'Puls', [['punch', 'Udar', '⚡'], ['breath', 'Disanje', '∿'], ['swell', 'Gradnja', '◢']]]],
  columns: [['mode', 'Broj osvijetljenih', [['single', 'Jedan', '▌'], ['double', 'Dva', '▌▌'], ['invert', 'Sve osim aktivnog', '░']]], ['pathMode', 'Ugašeni barovi', [['skip', 'Preskoči', '↷'], ['keep', 'Broji kao tamni korak', '⋯']]]],
  chase: [['beam', 'Oblik zrake', [['beam', 'Široka', '━'], ['needle', 'Točka', '⌖'], ['razor', 'Oštra', '✦'], ['comet', 'Komet', '☄']]], ['pathMode', 'Ugašeni barovi', [['skip', 'Preskoči', '↷'], ['keep', 'Prođi kroz tamne', '⋯']]]],
  flash: [['focus', 'Žarište', [['center', 'Centar', '⊙'], ['all', 'Svi', '✦'], ['edges', 'Rubovi', '◫']]], ['decay', 'Raspad', [['fast', 'Brzi', '◒'], ['instant', 'Trenutni', '⚡'], ['slow', 'Spori', '◔']]]],
  wave: [['shape', 'Valni oblik', [['sine', 'Sinus', '∿'], ['triangle', 'Trokut', '⋀'], ['saw', 'Pila', '◺']]], ['angle', 'Smjer vala', [['diag', 'Dijagonalno', '⤡'], ['horiz', 'Vodoravno', '↔'], ['vert', 'Okomito', '↕']]], ['density', 'Gustoća valova', [['med', 'Srednja', '≈'], ['low', 'Rijetka', '∼'], ['high', 'Gusta', '≋']]]],
  strobe: [['rate', 'Učestalost', [['1/4', 'Standard', '¼'], ['1/2', 'Sporo', '½'], ['1/8', 'Brzo', '⅛'], ['1/16', 'Vrlo brzo', '⚡']]], ['duty', 'Trajanje bljeska', [['sharp', 'Kratko', '▏'], ['normal', 'Srednje', '◒'], ['wide', 'Široko', '◑']]], ['pattern', 'Raspored', [['all', 'Svi', '▦'], ['checker', 'Šahovnica', '⚅'], ['chaos', 'Razmaknuto', '✧']]]],
  sparkle: [['density', 'Gustoća', [['stars', 'Zvijezde', '∴'], ['firefly', 'Rijetko', '·'], ['glitter', 'Gusto', '⁙']]], ['glint', 'Sjaj', [['crisp', 'Oštar', '✦'], ['soft', 'Mekan', '✧']]]],
  spiral: [['direction', 'Rotacija', [['cw', 'Udesno', '↻'], ['ccw', 'Ulijevo', '↺']]], ['tail', 'Rep', [['med', 'Srednji', '⤹'], ['point', 'Točka', '•'], ['snake', 'Dugi', '〰']]], ['center', 'Središnji bar', [['pulse', 'Pulsira', '◉'], ['on', 'Stalno svijetli', '●'], ['off', 'Ugašen', '○']]], ['pathMode', 'Ugašeni barovi', [['keep', 'Broji kao tamne', '⋯'], ['skip', 'Preskoči', '↷']]]],
  ripple: [['origin', 'Žarište', [['center', 'Centar', '⊙'], ['top', 'Vrh', '↑'], ['bottom', 'Dno', '↓'], ['corners', 'Kutovi', '⛶']]], ['direction', 'Smjer', [['out', 'Širenje', '↗'], ['in', 'Skupljanje', '↙']]], ['width', 'Širina vala', [['sharp', 'Oštra', '━'], ['wide', 'Široka', '≈']]]],
  rain: [['streak', 'Kapi', [['streak', 'Tragovi', '│'], ['drops', 'Kratke', '•'], ['beam', 'Snopovi', '║']]], ['spread', 'Raspored', [['random', 'Naizmjenično', '∷'], ['sync', 'Sinkronizirano', '⇉']]]],
  bounce: [['axis', 'Os', [['horiz', 'Vodoravno', '↔'], ['vert', 'Okomito', '↕']]], ['curve', 'Gibanje', [['pendulum', 'Klatno', '∿'], ['elastic', 'Oštro', '⚡']]]],
  fire: [['height', 'Visina', [['mid', 'Srednje', '▃'], ['low', 'Nisko', '▂'], ['full', 'Visoko', '▇']]], ['turbulence', 'Kretanje', [['normal', 'Vjetar', '∿'], ['calm', 'Mirno', '≈'], ['storm', 'Oluja', '⚡']]]],
  alternate: [['pattern', 'Uzorak', [['checker', 'Šahovnica', '⚅'], ['rows', 'Redovi', '☰'], ['cols', 'Stupci', '▥'], ['cross', 'Križ', '✚']]], ['transition', 'Prijelaz', [['cut', 'Rez', '⚡'], ['fade', 'Pretapanje', '∿']]]],
  center: [['geometry', 'Oblik', [['cross', 'Križ', '✚'], ['solo', 'Samo C2', '⊙'], ['iris', 'Prsten', '◎']]], ['breathe', 'Disanje', [['off', 'Mirno', '●'], ['on', 'Pulsira', '◉']]]],
  sweep: [['style', 'Prelet', [['horiz', 'Vodoravno', '↔'], ['vert', 'Okomito', '↕'], ['radar', 'Radar', '↻']]], ['width', 'Širina', [['laser', 'Usko', '━'], ['fan', 'Široko', '◢']]]]
});
export const DEFAULT_PADS = Object.freeze([
  { preset: 'flash', color: [1, .7, .3, .5], intensity: .9, speed: 1, targets: 'all', mode: 'hit' },
  { preset: 'pulse', color: [.18, .35, 1, 0], intensity: .75, speed: 1, targets: 'all', mode: 'loop' },
  { preset: 'chase', color: [1, .23, .5, 0], intensity: .75, speed: 1, targets: 'all', mode: 'loop' },
  { preset: 'strobe', color: [1, 1, 1, 1], intensity: 1, speed: 1, targets: 'all', mode: 'hit', params: { rate: '1/8', duty: 'sharp', pattern: 'all' } },
  { preset: 'wash', color: [.12, .35, 1, 0], intensity: .55, speed: 1, targets: 'all', mode: 'loop' },
  { preset: 'spiral', color: [.75, .18, 1, 0], intensity: .7, speed: 1, targets: 'all', mode: 'loop' },
  { preset: 'center', color: [1, .35, .12, .35], intensity: .8, speed: 1, targets: ['C2'], mode: 'loop' },
  { preset: 'sparkle', color: [1, .65, .22, .1], intensity: .65, speed: 1, targets: 'all', mode: 'loop' },
  null, null, null, null
]);
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const DRIVERS = ['none', 'drums', 'bass', 'vocals', 'other', 'band'];
const DEFAULT_BAND = Object.freeze({ lowHz: 40, highHz: 180, threshold: .12, ceiling: .7, mode: 'follow', releaseSec: .2 });
const timingBeats = timing => timing === 'half' ? .5 : timing === 'bar' ? 4 : timing === '2bar' ? 8 : timing === '4bar' ? 16 : 1;
export function hitDuration(pad, bpm) {
  const beatSec = 60 / clamp(bpm, 40, 240);
  if (pad.preset === 'chase') return Math.max(.08, beatSec * timingBeats(pad.timing) * ({ quarter: .25, half: .5, full: 1 }[pad.hitTravel] || 1) / pad.speed);
  if (pad.preset === 'spiral') {
    const outer = ['L1', 'C1', 'R1', 'R2', 'R3', 'C3', 'L3', 'L2'];
    const steps = pad.params.pathMode === 'skip' && pad.targets !== 'all' ? outer.filter(id => pad.targets.includes(id)).length : 8;
    return Math.max(.08, beatSec * Math.max(1, steps) / 2 * ({ quarter: .25, half: .5, full: 1 }[pad.hitTravel] || 1) / pad.speed);
  }
  return Math.max(.08, beatSec * pad.hitBeats);
}
export function normalizePad(value, fallback = DEFAULT_PADS[0]) {
  const p = value && typeof value === 'object' ? value : fallback;
  const preset = TIMELINE_PRESETS.includes(p.preset) ? p.preset : fallback.preset;
  const params = {};
  for (const [key, , options] of LIVE_PARAM_OPTIONS[preset] || []) {
    const valid = options.some(([value]) => value === p.params?.[key]);
    params[key] = valid ? p.params[key] : options[0][0];
  }
  if (preset === 'pulse') params.floor = clamp(Number.isFinite(p.params?.floor) ? p.params.floor : .2, 0, .8);
  if (preset === 'chase') params.glow = clamp(Number.isFinite(p.params?.glow) ? p.params.glow : 0, 0, 1);
  const lowHz = clamp(Number.isFinite(p.band?.lowHz) ? p.band.lowHz : DEFAULT_BAND.lowHz, 25, 17999);
  const threshold = clamp(Number.isFinite(p.band?.threshold) ? p.band.threshold : DEFAULT_BAND.threshold, 0, .99);
  return {
    preset, params,
    color: Array.isArray(p.color) && p.color.length === 4 ? p.color.map((v, i) => clamp(Number.isFinite(v) ? v : fallback.color[i], 0, 1)) : [...fallback.color],
    intensity: clamp(Number.isFinite(p.intensity) ? p.intensity : fallback.intensity, 0, 1),
    speed: clamp(Number.isFinite(p.speed) ? p.speed : fallback.speed, .25, 4),
    targets: p.targets === 'all' ? 'all' : Array.isArray(p.targets) && p.targets.length && p.targets.every(id => BAR_IDS.includes(id)) ? [...new Set(p.targets)] : fallback.targets,
    mode: p.mode === 'hit' || p.mode === 'loop' ? p.mode : fallback.mode,
    direction: ['ltr', 'rtl', 'ttb', 'btt'].includes(p.direction) ? p.direction : 'ltr',
    timing: ['half', 'beat', 'bar', '2bar', '4bar'].includes(p.timing) ? p.timing : 'beat',
    motionMode: ['serial', 'sync'].includes(p.motionMode) ? p.motionMode : 'serial',
    hitTravel: ['quarter', 'half', 'full'].includes(p.hitTravel) ? p.hitTravel : 'full',
    hitBeats: clamp(Number.isFinite(p.hitBeats) ? p.hitBeats : .5, .125, 4),
    driver: DRIVERS.includes(p.driver) ? p.driver : 'none',
    driverGain: clamp(Number.isFinite(p.driverGain) ? p.driverGain : 1, 0, 3),
    band: {
      lowHz,
      highHz: clamp(Number.isFinite(p.band?.highHz) ? p.band.highHz : DEFAULT_BAND.highHz, lowHz + 1, 18000),
      threshold,
      ceiling: clamp(Number.isFinite(p.band?.ceiling) ? p.band.ceiling : DEFAULT_BAND.ceiling, threshold + .01, 1),
      mode: ['follow', 'gate'].includes(p.band?.mode) ? p.band.mode : 'follow',
      releaseSec: clamp(Number.isFinite(p.band?.releaseSec) ? p.band.releaseSec : DEFAULT_BAND.releaseSec, 0, 2)
    }
  };
}
export function nextBeat(timeSec, bpm, beatOffsetSec = 0, beatTimes = null) {
  if (Array.isArray(beatTimes) && beatTimes.length > 1) {
    const next = beatTimes.find(item => (typeof item === 'number' ? item : item?.timeSec) > timeSec + 1e-5);
    if (next !== undefined) return typeof next === 'number' ? next : next.timeSec;
  }
  const step = 60 / clamp(bpm || 120, 40, 240);
  return beatOffsetSec + (Math.floor((timeSec - beatOffsetSec) / step + 1e-7) + 1) * step;
}
export function createPerformance(initialPads = DEFAULT_PADS) {
  const pads = DEFAULT_PADS.map((fallback, i) => {
    const value = i < initialPads.length ? initialPads[i] : fallback;
    return value === null ? null : normalizePad(value, fallback || DEFAULT_PADS[0]);
  });
  const active = new Map(), pending = new Map(), held = new Map(), touches = new Map();
  let quantize = false;
  let lastSongTime = null;
  let masterColor = [...DEFAULT_LIVE_COLOR];
  let masterIntensity = DEFAULT_LIVE_INTENSITY;
  let masterSpread = 0;
  let masterEffect = DEFAULT_LIVE_EFFECT;
  const lockedCols = new Set();
  const lockedRows = new Set();

  function sanitizeColor(c, fallback = masterColor) {
    if (!Array.isArray(c) || c.length < 3) return [...fallback];
    return [
      clamp(Number.isFinite(c[0]) ? c[0] : fallback[0], 0, 1),
      clamp(Number.isFinite(c[1]) ? c[1] : fallback[1], 0, 1),
      clamp(Number.isFinite(c[2]) ? c[2] : fallback[2], 0, 1),
      clamp(Number.isFinite(c[3]) ? c[3] : (fallback[3] ?? 0), 0, 1)
    ];
  }

  function expandedCoordsFor(col, row) {
    const c = Math.max(0, Math.min(2, col));
    const r = Math.max(0, Math.min(2, row));
    const seen = new Set();
    const list = [];
    const add = (cc, rr) => {
      const id = BAR_IDS[rr * 3 + cc];
      if (!seen.has(id)) {
        seen.add(id);
        list.push({ col: cc, row: rr, barId: id });
      }
    };
    add(c, r);
    if (lockedCols.has(c)) {
      for (let rr = 0; rr < 3; rr++) add(c, rr);
    }
    if (lockedRows.has(r)) {
      for (let cc = 0; cc < 3; cc++) add(cc, r);
    }
    return list;
  }

  function advanceTouch(touch, clockTime) {
    if (!touch || !Number.isFinite(clockTime)) return;
    touch.lastTickAt = Math.max(touch.lastTickAt, clockTime);
  }

  function computeTouchEnvelope(touch) {
    if (!touch) return 0;
    return clamp((touch.velocityGain ?? 1) * (1 - clamp(touch.dragDown || 0, 0, 1)), 0, 1);
  }

  function computeBarGainForTouch(touch, barIdx, clockTime) {
    const bRow = Math.floor(barIdx / 3);
    const bCol = barIdx % 3;
    const barId = BAR_IDS[barIdx];
    const vel = clamp(computeTouchEnvelope(touch), 0.15, 1);

    const isDirect = (bCol === touch.col && bRow === touch.row)
      || (lockedCols.has(touch.col) && bCol === touch.col)
      || (lockedRows.has(touch.row) && bRow === touch.row);
    let bestGain = isDirect ? vel : 0;

    if (touch.panelHits && touch.panelHits.has(barId)) {
      const hit = touch.panelHits.get(barId);
      const age = Math.max(0, clockTime - hit.lastHitAt);
      if (age < 0.42) {
        const trailGain = hit.peakGain * Math.exp(-age / 0.14);
        if (trailGain > bestGain) bestGain = trailGain;
      }
    }

    const spread = clamp(Number.isFinite(touch.spread) ? touch.spread : masterSpread, 0, 1);
    if (spread > 0.005 && bestGain < vel) {
      const effColDist = (lockedRows.has(touch.row) || (lockedCols.has(touch.col) && bCol === touch.col))
        ? 0
        : Math.abs(bCol - touch.col);
      const effRowDist = (lockedCols.has(touch.col) || (lockedRows.has(touch.row) && bRow === touch.row))
        ? 0
        : Math.abs(bRow - touch.row);
      const gridDist = Math.hypot(effColDist, effRowDist);
      if (gridDist > 0) {
        const sigmaSq = 0.36 + spread * 2.25;
        const bleed = vel * spread * Math.exp(-(gridDist * gridDist) / sigmaSq);
        if (bleed > bestGain) bestGain = bleed;
      }
    }

    return clamp(bestGain, 0, 1);
  }

  function renderSpatialTouches(inputFrame, clockTime, scale = 1, bpm = 120) {
    if (!touches.size) return inputFrame;
    const srcBars = inputFrame?.bars ?? inputFrame;
    const out = {};
    for (const id of BAR_IDS) {
      out[id] = Array.from({ length: PIXELS_PER_BAR }, (_, p) => {
        const px = srcBars?.[id]?.[p];
        return px ? [px[0] || 0, px[1] || 0, px[2] || 0, px[3] || 0] : [0, 0, 0, 0];
      });
    }

    const beatSec = 60 / clamp(bpm || 120, 40, 240);

    for (const [, touch] of touches) {
      advanceTouch(touch, clockTime);
      const localTime = Math.max(0, clockTime - touch.startAt);
      const effectName = touch.effect || masterEffect || DEFAULT_LIVE_EFFECT;

      for (let barIdx = 0; barIdx < BAR_IDS.length; barIdx++) {
        const barId = BAR_IDS[barIdx];
        const bRow = Math.floor(barIdx / 3);
        const bCol = barIdx % 3;
        const barGain = computeBarGainForTouch(touch, barIdx, clockTime);
        const gain = clamp(barGain * touch.intensity * scale, 0, 1);
        if (gain <= 1e-4) continue;

        for (let p = 0; p < PIXELS_PER_BAR; p++) {
          const fxMod = sampleSpatialPanelEffect(effectName, p, bRow, bCol, barId, clockTime, localTime, beatSec);
          const amount = gain * clamp(fxMod, 0, 1) * 255;
          if (amount <= 0.2) continue;
          const pixel = out[barId][p];
          for (let c = 0; c < 4; c++) {
            pixel[c] = Math.round(clamp(pixel[c] + touch.color[c] * amount, 0, 255));
          }
        }
      }
    }

    return { bars: out };
  }

  const api = {
    pads, active, pending, held, touches,
    get quantize() { return quantize; },
    setQuantize(value) { quantize = Boolean(value); },
    get color() { return [...masterColor]; },
    setColor(nextColor) {
      masterColor = sanitizeColor(nextColor, masterColor);
      for (const touch of touches.values()) {
        touch.color = [...masterColor];
      }
      return [...masterColor];
    },
    get intensity() { return masterIntensity; },
    setIntensity(value) {
      masterIntensity = clamp(Number.isFinite(Number(value)) ? Number(value) : masterIntensity, 0, 1);
      for (const touch of touches.values()) {
        touch.intensity = masterIntensity;
      }
      return masterIntensity;
    },
    get spread() { return masterSpread; },
    setSpread(value) {
      masterSpread = clamp(Number.isFinite(Number(value)) ? Number(value) : masterSpread, 0, 1);
      for (const touch of touches.values()) {
        touch.spread = masterSpread;
      }
      return masterSpread;
    },
    get lockedCols() { return [...lockedCols].sort(); },
    get lockedRows() { return [...lockedRows].sort(); },
    setColumnLocked(col, locked) {
      const c = Math.max(0, Math.min(2, Number(col) || 0));
      if (locked) lockedCols.add(c);
      else lockedCols.delete(c);
      return [...lockedCols].sort();
    },
    setRowLocked(row, locked) {
      const r = Math.max(0, Math.min(2, Number(row) || 0));
      if (locked) lockedRows.add(r);
      else lockedRows.delete(r);
      return [...lockedRows].sort();
    },
    setLocks({ lockedCols: nextCols, lockedRows: nextRows } = {}) {
      if (Array.isArray(nextCols)) {
        lockedCols.clear();
        for (const c of nextCols) {
          if (Number.isInteger(c) && c >= 0 && c <= 2) lockedCols.add(c);
        }
      }
      if (Array.isArray(nextRows)) {
        lockedRows.clear();
        for (const r of nextRows) {
          if (Number.isInteger(r) && r >= 0 && r <= 2) lockedRows.add(r);
        }
      }
      return { lockedCols: [...lockedCols].sort(), lockedRows: [...lockedRows].sort() };
    },
    get effect() { return masterEffect; },
    setEffect(nextEffect) {
      if (typeof nextEffect === 'string' && SPATIAL_TOUCH_EFFECTS.includes(nextEffect)) {
        masterEffect = nextEffect;
      } else {
        masterEffect = DEFAULT_LIVE_EFFECT;
      }
      for (const touch of touches.values()) {
        touch.effect = masterEffect;
      }
      return masterEffect;
    },
    touchDown(id = 'default', { x = 0.5, y = 0.5, clockTime = 0, color = null, intensity = null, spread = null, velocityGain = null, effect = null, lockedCols: remoteCols = null, lockedRows: remoteRows = null } = {}) {
      const key = String(id);
      const nx = clamp(Number.isFinite(x) ? x : 0.5, 0, 1);
      const ny = clamp(Number.isFinite(y) ? y : 0.5, 0, 1);
      const now = Number.isFinite(clockTime) ? clockTime : 0;
      if (Array.isArray(remoteCols) || Array.isArray(remoteRows)) {
        api.setLocks({ lockedCols: remoteCols, lockedRows: remoteRows });
      }
      const touchColor = color ? sanitizeColor(color, masterColor) : [...masterColor];
      const touchIntensity = Number.isFinite(intensity) ? clamp(intensity, 0, 1) : masterIntensity;
      const touchSpread = Number.isFinite(spread) ? clamp(spread, 0, 1) : masterSpread;
      const initialVel = Number.isFinite(velocityGain) ? clamp(velocityGain, 0.2, 1) : 1;
      const touchEffect = (typeof effect === 'string' && SPATIAL_TOUCH_EFFECTS.includes(effect)) ? effect : masterEffect;
      const col = Math.max(0, Math.min(2, Math.floor(Math.min(0.9999, nx) * 3)));
      const row = Math.max(0, Math.min(2, Math.floor(Math.min(0.9999, ny) * 3)));
      const dragSpan = Math.max(0.18, Math.min(0.45, 0.96 - ny));
      const panelHits = new Map();
      for (const item of expandedCoordsFor(col, row)) {
        panelHits.set(item.barId, { barId: item.barId, row: item.row, col: item.col, lastHitAt: now, peakGain: initialVel });
      }
      touches.set(key, {
        id: key,
        col,
        row,
        startX: nx,
        startY: ny,
        originX: nx,
        originY: ny,
        x: nx,
        y: ny,
        startAt: now,
        lastTickAt: now,
        lastMoveAt: now,
        velocityGain: initialVel,
        fadeProgress: 0,
        dragDown: 0,
        dragSpan,
        maxDragDown: 0,
        snappedCount: 0,
        mode: 'hold',
        effect: touchEffect,
        color: touchColor,
        intensity: touchIntensity,
        spread: touchSpread,
        barId: BAR_IDS[row * 3 + col],
        panelHits,
        trailPoints: [{ x: nx, y: ny, time: now }],
        until: Infinity
      });
      return 'started';
    },
    touchMove(id = 'default', { x, y, velocityGain, dragDown, clockTime = 0 } = {}) {
      const key = String(id);
      const touch = touches.get(key);
      if (!touch) return 'ignored';
      const now = Number.isFinite(clockTime) ? clockTime : touch.lastTickAt;
      advanceTouch(touch, now);
      const nx = Number.isFinite(x) ? clamp(x, 0, 1) : touch.x;
      const ny = Number.isFinite(y) ? clamp(y, 0, 1) : touch.y;
      const dt = Math.max(0.004, Math.min(0.25, now - (touch.lastMoveAt ?? touch.startAt)));
      const dist = Math.hypot(nx - touch.x, ny - touch.y);
      const rawSpeed = dist / dt;

      if (Number.isFinite(velocityGain)) {
        touch.velocityGain = clamp(velocityGain, 0.2, 1);
        touch.lastMoveAt = now;
      } else if (dist > 0.001) {
        const targetVel = clamp(0.26 + Math.pow(Math.min(1, rawSpeed / 1.55), 0.72) * 0.74, 0.28, 1);
        const alpha = targetVel > touch.velocityGain ? 0.50 : 0.16;
        touch.velocityGain = clamp(touch.velocityGain + (targetVel - touch.velocityGain) * alpha, 0.28, 1);
        touch.lastMoveAt = now;
      }

      if (Number.isFinite(dragDown)) {
        touch.dragDown = clamp(dragDown, 0, 1);
      } else {
        touch.dragDown = 0;
      }

      const newCol = Math.max(0, Math.min(2, Math.floor(Math.min(0.9999, nx) * 3)));
      const newRow = Math.max(0, Math.min(2, Math.floor(Math.min(0.9999, ny) * 3)));
      const changedPanel = (newCol !== touch.col) || (newRow !== touch.row);

      touch.x = nx;
      touch.y = ny;
      touch.originX = nx;
      touch.originY = ny;

      if (changedPanel) {
        touch.col = newCol;
        touch.row = newRow;
        touch.barId = BAR_IDS[newRow * 3 + newCol];
        touch.snappedCount = (touch.snappedCount || 0) + 1;
      }

      if (!touch.panelHits) touch.panelHits = new Map();
      for (const item of expandedCoordsFor(touch.col, touch.row)) {
        const prevPeak = touch.panelHits.get(item.barId)?.peakGain ?? 0;
        const nextPeak = changedPanel ? touch.velocityGain : Math.max(touch.velocityGain, prevPeak * 0.92);
        touch.panelHits.set(item.barId, {
          barId: item.barId,
          row: item.row,
          col: item.col,
          lastHitAt: now,
          peakGain: nextPeak
        });
      }
      for (const [bId, hit] of touch.panelHits) {
        if (now - hit.lastHitAt > 0.45) touch.panelHits.delete(bId);
      }

      if (!Array.isArray(touch.trailPoints)) touch.trailPoints = [];
      touch.trailPoints.push({ x: nx, y: ny, time: now });
      if (touch.trailPoints.length > 36) touch.trailPoints.splice(0, touch.trailPoints.length - 36);
      touch.trailPoints = touch.trailPoints.filter(pt => (now - pt.time) <= 0.36);

      return changedPanel ? 'strummed' : 'moved';
    },
    touchUp(id = 'default', { cancel = false } = {}) {
      const key = String(id);
      const touch = touches.get(key);
      if (!touch) return 'ignored';
      touches.delete(key);
      return cancel ? 'cancelled' : 'released';
    },
    getBarGainForTouch(touchId, barId, clockTime = 0) {
      const touch = touches.get(String(touchId));
      const barIdx = BAR_IDS.indexOf(barId);
      if (!touch || barIdx < 0) return 0;
      return computeBarGainForTouch(touch, barIdx, clockTime);
    },
    getTouchVisuals(clockTime = 0) {
      const list = [];
      for (const [id, touch] of touches) {
        advanceTouch(touch, clockTime);
        const env = computeTouchEnvelope(touch);
        list.push({
          id,
          x: touch.x,
          y: touch.y,
          originX: touch.originX,
          originY: touch.originY,
          startX: touch.startX,
          startY: touch.startY,
          row: touch.row,
          col: touch.col,
          startAt: touch.startAt,
          mode: touch.mode,
          effect: touch.effect || masterEffect,
          velocityGain: touch.velocityGain ?? 1,
          level: clamp(env * touch.intensity, 0, 1),
          envelope: env,
          dragDown: touch.dragDown || 0,
          fadeProgress: 0,
          radius: 0.28,
          color: [...touch.color],
          barId: touch.barId,
          trailPoints: Array.isArray(touch.trailPoints) ? [...touch.trailPoints] : []
        });
      }
      return list;
    },
    setPad(index, patch) { if (index < 0 || index >= pads.length) return false; if (pads[index] && patch.mode && patch.mode !== pads[index].mode) { active.delete(index); pending.delete(index); held.delete(index); } pads[index] = normalizePad({ ...(pads[index] || DEFAULT_PADS[0]), ...patch }, DEFAULT_PADS[index] || DEFAULT_PADS[0]); return true; },
    removePad(index) { if (index < 0 || index >= pads.length) return false; pads[index] = null; active.delete(index); pending.delete(index); held.delete(index); return true; },
    movePad(from, to) {
      if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < 0 || from >= pads.length || to >= pads.length || from === to || !pads[from]) return false;
      [pads[from], pads[to]] = [pads[to], pads[from]];
      for (const map of [active, pending, held]) {
        const a = map.get(from), b = map.get(to);
        map.delete(from); map.delete(to);
        if (a) map.set(to, a);
        if (b) map.set(from, b);
      }
      return true;
    },
    trigger(index, { songTime = 0, clockTime = 0, playing = false, bpm = 120, beatOffsetSec = 0, beatTimes = null } = {}) {
      const pad = pads[index]; if (!pad) return 'invalid';
      if (pending.has(index)) { pending.delete(index); return 'cancelled'; }
      if (pad.mode === 'loop' && active.has(index)) { active.delete(index); return 'stopped'; }
      if (quantize && playing) { pending.set(index, { songAt: nextBeat(songTime, bpm, beatOffsetSec, beatTimes), clockAt: clockTime }); return 'queued'; }
      if (pad.mode === 'hit') {
        const until = clockTime + hitDuration(pad, bpm);
        const existing = active.get(index);
        const prevShots = existing?.shots ? existing.shots.filter(s => clockTime < s.until) : [];
        const newShot = { start: clockTime, until, oneShot: false, repeated: false };
        const shots = [...prevShots.slice(-15), newShot];
        active.set(index, { start: clockTime, until, shots });
      } else {
        active.set(index, { start: clockTime, until: Infinity });
      }
      return 'started';
    },
    press(index, context = {}) {
      const pad = pads[index]; if (!pad) return 'invalid';
      if (held.has(index)) return 'held';
      const wasActive = active.has(index) || pending.has(index);
      held.set(index, { sourceIndex: index, downAt: context.clockTime ?? 0, wasActive, mode: pad.mode });
      if (pad.mode === 'loop' && wasActive) return 'held';
      return api.trigger(index, context);
    },
    release(index, { clockTime = 0, cancel = false } = {}) {
      const actualIndex = held.has(index) && held.get(index).sourceIndex === index ? index : [...held].find(([, run]) => run.sourceIndex === index)?.[0];
      if (actualIndex === undefined) return 'ignored';
      const run = held.get(actualIndex); held.delete(actualIndex);
      const pad = pads[actualIndex];
      const longPress = cancel || clockTime - run.downAt >= HOLD_THRESHOLD_SEC;
      if (run.mode === 'loop') {
        if (longPress || run.wasActive) { active.delete(actualIndex); pending.delete(actualIndex); return 'stopped'; }
        return 'latched';
      }
      const activeRun = active.get(actualIndex);
      const latestShot = activeRun?.shots?.at(-1);
      // For chase hits, allow a single pass to finish its travel unless it already repeated while held or was explicitly cancelled
      const shouldStopHeldHit = longPress && (cancel || pad?.preset !== 'chase' || Boolean(latestShot?.repeated));
      if (shouldStopHeldHit) {
        pending.delete(actualIndex);
        if (activeRun?.shots?.length > 1) {
          const remaining = activeRun.shots.slice(0, -1).filter(s => s.oneShot && clockTime < s.until);
          if (remaining.length) {
            const last = remaining.at(-1);
            active.set(actualIndex, { start: last.start, until: last.until, shots: remaining });
          } else {
            active.delete(actualIndex);
          }
        } else {
          active.delete(actualIndex);
        }
        return 'stopped';
      }
      if (latestShot) latestShot.oneShot = true;
      return 'one-shot';
    },
    releaseAll() {
      for (const index of held.keys()) { active.delete(index); pending.delete(index); }
      held.clear();
      touches.clear();
    },
    tick({ songTime = 0, clockTime = 0, playing = false, bpm = 120 } = {}) {
      if (!playing || (lastSongTime !== null && songTime < lastSongTime - .1)) pending.clear();
      for (const [index, cue] of pending) {
        if (playing && songTime >= cue.songAt - .02) {
          pending.delete(index);
          const pad = pads[index]; if (!pad) continue;
          if (pad.mode === 'hit') {
            const until = clockTime + hitDuration(pad, bpm);
            const existing = active.get(index);
            const prevShots = existing?.shots ? existing.shots.filter(s => clockTime < s.until) : [];
            const shots = [...prevShots.slice(-15), { start: clockTime, until, oneShot: false, repeated: false }];
            active.set(index, { start: clockTime, until, shots });
          } else {
            active.set(index, { start: clockTime, until: Infinity });
          }
        }
      }
      for (const [index, run] of active) {
        if (run.shots && pads[index]?.mode === 'hit') {
          const lastShot = run.shots.at(-1);
          if (lastShot && clockTime >= lastShot.until && held.has(index)) {
            const cycle = hitDuration(pads[index], bpm);
            const elapsed = Math.max(0, clockTime - lastShot.start);
            const turns = Math.max(1, Math.floor(elapsed / cycle));
            lastShot.start += turns * cycle;
            lastShot.until = lastShot.start + cycle;
            lastShot.repeated = true;
          }
          run.shots = run.shots.filter(s => clockTime < s.until);
          if (!run.shots.length) {
            active.delete(index);
          } else {
            const latest = run.shots.at(-1);
            run.start = latest.start;
            run.until = latest.until;
          }
          continue;
        }
        if (clockTime < run.until) continue;
        if (held.has(index) && pads[index]?.mode === 'hit') {
          const cycle = hitDuration(pads[index], bpm);
          const elapsed = Math.max(0, clockTime - run.start);
          const turns = Math.max(1, Math.floor(elapsed / cycle));
          run.start += turns * cycle; run.until = run.start + cycle;
        } else active.delete(index);
      }
      for (const [id, touch] of touches) {
        advanceTouch(touch, clockTime);
        if ((touch.mode === 'strobe' || touch.mode === 'release') && clockTime >= touch.until) {
          touches.delete(id);
        }
      }
      lastSongTime = playing ? songTime : null;
    },
    clear() { active.clear(); pending.clear(); held.clear(); touches.clear(); },
    render(baseFrame, clockTime, bpm = 120, scale = 1, analysis = null, songTime = 0) {
      if (!active.size && !touches.size) return baseFrame;
      let frame = baseFrame;
      if (active.size) {
        const layers = [];
        for (const [index, run] of active) {
          const pad = pads[index]; if (!pad) continue;
          const shots = run.shots?.length ? run.shots : [{ start: run.start, until: run.until }];
          for (let sIdx = 0; sIdx < shots.length; sIdx++) {
            const shot = shots[sIdx];
            if (clockTime < shot.start || clockTime >= shot.until) continue;
            const isFiniteHit = shot.until !== Infinity;
            const isHeldLatest = held.has(index) && sIdx === shots.length - 1;
            const fadeWindow = (pad.preset === 'chase' && isFiniteHit) ? 0.04 : 0.09;
            const life = !isFiniteHit || isHeldLatest || pad.preset === 'strobe'
              ? 1
              : clamp((shot.until - clockTime) / fadeWindow, 0, 1);
            const clipParams = pad.preset === 'strobe'
              ? { rate: '1/4', duty: 'sharp', ...pad.params }
              : (pad.preset === 'chase' && isFiniteHit ? { ...pad.params, oneShot: true } : pad.params);
            layers.push({
              id: `live-${index}-${sIdx}`,
              enabled: true,
              opacity: pad.intensity * scale * life,
              blend: 'add',
              clips: [{
                id: `pad-${index}-${sIdx}`,
                preset: pad.preset,
                startSec: shot.start,
                durationSec: isFiniteHit ? shot.until - shot.start : 86400,
                targets: pad.targets,
                color: pad.color,
                driver: pad.mode === 'loop' ? pad.driver : 'none',
                driverGain: pad.driverGain,
                band: pad.band,
                driverTimeSec: songTime,
                speed: pad.speed,
                direction: pad.direction,
                timing: pad.timing,
                motionMode: pad.motionMode,
                params: clipParams,
                keyframes: [{ timeSec: 0, value: 1 }]
              }]
            });
          }
        }
        if (layers.length) {
          frame = renderTimelineFrame({ version: 1, durationSec: 86400, bpm: clamp(bpm, 40, 240), beatOffsetSec: 0, blackout: false, layers }, analysis, clockTime, baseFrame);
        }
      }
      if (touches.size) {
        frame = renderSpatialTouches(frame, clockTime, scale, bpm);
      }
      return frame;
    }
  };
  return api;
}
