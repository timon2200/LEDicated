/** Editable song timeline. All times are song seconds, colors are normalized RGBW,
 * and output channels are bytes 0–255.
 * This module is pure: one saved timeline and one analysis produce the same frame
 * for a given song time, regardless of playback or scrub order.
 */
import { BAR_IDS, PIXELS_PER_BAR } from './engine.mjs';
import { SPECTRUM_MAX_HZ, SPECTRUM_MIN_HZ, rangeLevel, getSpectrumForSource } from './audio-spectrum.mjs';
import { detectSections } from './audio-sections.mjs';

export const TIMELINE_PRESETS = Object.freeze([
  'wash', 'pulse', 'columns', 'chase', 'flash', 'wave',
  'strobe', 'sparkle', 'spiral', 'ripple', 'rain', 'bounce', 'fire', 'alternate', 'center', 'sweep'
]);
export const TIMELINE_BLENDS = Object.freeze(['add', 'screen', 'multiply', 'max', 'replace']);
const DRIVERS = ['none', 'drums', 'bass', 'vocals', 'other', 'band'];

export const PALETTES = Object.freeze({
  club: Object.freeze([[0.04, 0.06, 0.72, 0], [0.58, 0.04, 0.85, 0], [0.02, 0.72, 0.95, 0], [0.15, 0.25, 0.85, 0.55]]),
  ember: Object.freeze([[0.85, 0.06, 0.02, 0], [0.96, 0.36, 0.02, 0], [0.98, 0.68, 0.04, 0], [0.45, 0.18, 0.02, 0.50]]),
  midnight: Object.freeze([[0.04, 0.06, 0.72, 0], [0.58, 0.04, 0.85, 0], [0.02, 0.72, 0.95, 0], [0.15, 0.25, 0.85, 0.55]]),
  cyber: Object.freeze([[0.95, 0.02, 0.62, 0], [0.02, 0.88, 0.96, 0], [0.18, 0.12, 0.98, 0], [0.45, 0.05, 0.85, 0.50]]),
  sunset: Object.freeze([[0.85, 0.06, 0.02, 0], [0.96, 0.36, 0.02, 0], [0.98, 0.68, 0.04, 0], [0.45, 0.18, 0.02, 0.50]]),
  rave: Object.freeze([[0.02, 0.85, 0.28, 0], [0.52, 0.98, 0.04, 0], [0.02, 0.88, 0.82, 0], [0.20, 0.65, 0.15, 0.65]]),
  inferno: Object.freeze([[0.92, 0.01, 0.02, 0], [0.98, 0.24, 0.01, 0], [0.98, 0.55, 0.02, 0], [0.65, 0.22, 0.02, 0.65]]),
  ice: Object.freeze([[0.02, 0.28, 0.75, 0], [0.02, 0.68, 0.92, 0], [0.22, 0.48, 0.98, 0], [0.18, 0.42, 0.75, 0.65]]),
  royal: Object.freeze([[0.42, 0.02, 0.78, 0], [0.88, 0.02, 0.28, 0], [0.95, 0.65, 0.06, 0], [0.45, 0.12, 0.35, 0.55]]),
  mono: Object.freeze([[0.35, 0.42, 0.55, 0], [0.65, 0.72, 0.85, 0], [0.85, 0.88, 0.95, 0], [0.55, 0.55, 0.55, 0.85]])
});

const THEME_LIST = [
  {
    id: 'midnight',
    name: 'Klupska ponoć',
    description: 'Plava / Cijan / Ljubičasta',
    colors: PALETTES.midnight,
    defaultPresets: Object.freeze(['pulse', 'chase', 'sweep', 'strobe', 'flash', 'ripple', 'rain', 'spiral', 'alternate', 'bounce'])
  },
  {
    id: 'cyber',
    name: 'Cyber Neon',
    description: 'Magenta / Cijan / Električna plava',
    colors: PALETTES.cyber,
    defaultPresets: Object.freeze(['chase', 'sweep', 'strobe', 'flash', 'columns', 'alternate', 'spiral', 'pulse', 'bounce'])
  },
  {
    id: 'sunset',
    name: 'Topli zalazak',
    description: 'Crvena / Jantar / Zlatna',
    colors: PALETTES.sunset,
    defaultPresets: Object.freeze(['wash', 'pulse', 'wave', 'sweep', 'fire', 'sparkle', 'ripple', 'flash', 'center'])
  },
  {
    id: 'rave',
    name: 'Acid Rave',
    description: 'Smaragdna / Limeta / Cijan / Bijela',
    colors: PALETTES.rave,
    defaultPresets: Object.freeze(['strobe', 'chase', 'alternate', 'flash', 'pulse', 'spiral', 'bounce', 'columns', 'sweep'])
  },
  {
    id: 'inferno',
    name: 'Inferno',
    description: 'Krvavo crvena / Narančasta / Zlatni bljesak',
    colors: PALETTES.inferno,
    defaultPresets: Object.freeze(['fire', 'pulse', 'strobe', 'flash', 'chase', 'sweep', 'columns', 'alternate', 'center'])
  },
  {
    id: 'ice',
    name: 'Arktički kristal',
    description: 'Ledeno plava / Tirkiz / Hladna bijela',
    colors: PALETTES.ice,
    defaultPresets: Object.freeze(['sparkle', 'rain', 'ripple', 'sweep', 'pulse', 'chase', 'strobe', 'flash', 'wave'])
  },
  {
    id: 'royal',
    name: 'Kraljevski baršun',
    description: 'Duboka ljubičasta / Grimizna / Zlatna',
    colors: PALETTES.royal,
    defaultPresets: Object.freeze(['pulse', 'wave', 'center', 'sweep', 'sparkle', 'columns', 'ripple', 'flash', 'chase'])
  },
  {
    id: 'mono',
    name: 'Čisti stroboskop',
    description: 'Topla i hladna bijela',
    colors: PALETTES.mono,
    defaultPresets: Object.freeze(['strobe', 'flash', 'pulse', 'chase', 'alternate', 'columns', 'sweep'])
  }
];
for (const theme of THEME_LIST) {
  Object.freeze(theme);
  Object.defineProperty(THEME_LIST, theme.id, { value: theme, enumerable: false, configurable: false, writable: false });
}
Object.defineProperty(THEME_LIST, 'club', { value: THEME_LIST[0], enumerable: false, configurable: false, writable: false });
Object.defineProperty(THEME_LIST, 'ember', { value: THEME_LIST[2], enumerable: false, configurable: false, writable: false });
export const SHOW_THEMES = Object.freeze(THEME_LIST);

export function normalizeColor(color) {
  if (typeof color === 'string') {
    const raw = color.trim().replace(/^#/, '');
    if (raw.length === 3) {
      const [r, g, b] = raw.split('').map(c => parseInt(c + c, 16) / 255);
      if ([r, g, b].every(Number.isFinite)) return [clamp(r), clamp(g), clamp(b), 0];
    }
    if (raw.length === 6) {
      const r = parseInt(raw.slice(0, 2), 16) / 255;
      const g = parseInt(raw.slice(2, 4), 16) / 255;
      const b = parseInt(raw.slice(4, 6), 16) / 255;
      if ([r, g, b].every(Number.isFinite)) return [clamp(r), clamp(g), clamp(b), 0];
    }
    if (raw.length === 8) {
      const r = parseInt(raw.slice(0, 2), 16) / 255;
      const g = parseInt(raw.slice(2, 4), 16) / 255;
      const b = parseInt(raw.slice(4, 6), 16) / 255;
      const w = parseInt(raw.slice(6, 8), 16) / 255;
      if ([r, g, b, w].every(Number.isFinite)) return [clamp(r), clamp(g), clamp(b), clamp(w)];
    }
    return [1, 1, 1, 0];
  }
  if (Array.isArray(color)) {
    return [
      clamp(number(color[0], 1)),
      clamp(number(color[1], 1)),
      clamp(number(color[2], 1)),
      clamp(number(color[3], 0))
    ];
  }
  return [1, 1, 1, 0];
}

/** Frequency-band driver (like an audio-reactive EQ): the clip is driven by the
 * peak level inside [lowHz, highHz]. Level below `threshold` gives 0, level at
 * `ceiling` gives 1. mode 'gate' snaps to 1 above the threshold (a trigger).
 * `releaseSec` is how long the driver takes to fall back after a peak.
 * `source` can be 'master' or an isolated stem ('drums', 'bass', 'vocals', 'other').
 */
export const DEFAULT_BAND = Object.freeze({ source: 'master', lowHz: 40, highHz: 120, threshold: 0.5, ceiling: 1, mode: 'follow', releaseSec: 0.12 });
export const BAND_PRESETS = Object.freeze([
  ['Kick', { source: 'master', lowHz: 40, highHz: 110, threshold: 0.6, ceiling: 1, mode: 'gate', releaseSec: 0.14 }],
  ['Bas', { source: 'master', lowHz: 30, highHz: 180, threshold: 0.4, ceiling: 0.95, mode: 'follow', releaseSec: 0.2 }],
  ['Snare', { source: 'master', lowHz: 160, highHz: 400, threshold: 0.6, ceiling: 1, mode: 'gate', releaseSec: 0.12 }],
  ['Vokal', { source: 'master', lowHz: 300, highHz: 3000, threshold: 0.45, ceiling: 1, mode: 'follow', releaseSec: 0.15 }],
  ['Hi-hat', { source: 'master', lowHz: 6000, highHz: 16000, threshold: 0.5, ceiling: 1, mode: 'gate', releaseSec: 0.06 }],
  ['Sve', { source: 'master', lowHz: 25, highHz: 18000, threshold: 0.4, ceiling: 1, mode: 'follow', releaseSec: 0.1 }]
]);

export const STEM_BAND_PRESETS = Object.freeze({
  master: BAND_PRESETS,
  drums: Object.freeze([
    ['Kick', { source: 'drums', lowHz: 40, highHz: 110, threshold: 0.55, ceiling: 1, mode: 'gate', releaseSec: 0.14 }],
    ['Snare', { source: 'drums', lowHz: 160, highHz: 450, threshold: 0.55, ceiling: 1, mode: 'gate', releaseSec: 0.12 }],
    ['Hi-hat', { source: 'drums', lowHz: 5000, highHz: 16000, threshold: 0.45, ceiling: 1, mode: 'gate', releaseSec: 0.07 }],
    ['Cijeli bubanj', { source: 'drums', lowHz: 25, highHz: 18000, threshold: 0.35, ceiling: 1, mode: 'follow', releaseSec: 0.12 }],
    ['Top kick', { source: 'drums', lowHz: 70, highHz: 160, threshold: 0.5, ceiling: 1, mode: 'gate', releaseSec: 0.1 }],
    ['Sub kick', { source: 'drums', lowHz: 35, highHz: 75, threshold: 0.6, ceiling: 1, mode: 'gate', releaseSec: 0.16 }]
  ]),
  bass: Object.freeze([
    ['Sub bas', { source: 'bass', lowHz: 25, highHz: 75, threshold: 0.45, ceiling: 1, mode: 'follow', releaseSec: 0.2 }],
    ['Bas linija', { source: 'bass', lowHz: 40, highHz: 180, threshold: 0.4, ceiling: 0.95, mode: 'follow', releaseSec: 0.18 }],
    ['Slap / Attack', { source: 'bass', lowHz: 600, highHz: 2500, threshold: 0.5, ceiling: 1, mode: 'gate', releaseSec: 0.1 }],
    ['Cijeli bas', { source: 'bass', lowHz: 25, highHz: 18000, threshold: 0.35, ceiling: 1, mode: 'follow', releaseSec: 0.2 }]
  ]),
  vocals: Object.freeze([
    ['Tijelo vokala', { source: 'vocals', lowHz: 280, highHz: 1100, threshold: 0.4, ceiling: 1, mode: 'follow', releaseSec: 0.15 }],
    ['Prisutnost', { source: 'vocals', lowHz: 1100, highHz: 3500, threshold: 0.45, ceiling: 1, mode: 'follow', releaseSec: 0.15 }],
    ['Sibilanti', { source: 'vocals', lowHz: 4000, highHz: 9000, threshold: 0.5, ceiling: 1, mode: 'gate', releaseSec: 0.08 }],
    ['Cijeli vokal', { source: 'vocals', lowHz: 25, highHz: 18000, threshold: 0.35, ceiling: 1, mode: 'follow', releaseSec: 0.15 }]
  ]),
  other: Object.freeze([
    ['Zrak / Činele', { source: 'other', lowHz: 5000, highHz: 16000, threshold: 0.4, ceiling: 1, mode: 'gate', releaseSec: 0.08 }],
    ['Sintesajzer', { source: 'other', lowHz: 1000, highHz: 6000, threshold: 0.4, ceiling: 1, mode: 'follow', releaseSec: 0.18 }],
    ['Cijeli stem', { source: 'other', lowHz: 25, highHz: 18000, threshold: 0.35, ceiling: 1, mode: 'follow', releaseSec: 0.12 }]
  ])
});

export function bandErrors(band, path) {
  if (!band || typeof band !== 'object') return [`${path} must be an object`];
  const errors = [];
  const ok = (v, lo, hi) => Number.isFinite(v) && v >= lo && v <= hi;
  if (!ok(band.lowHz, SPECTRUM_MIN_HZ, SPECTRUM_MAX_HZ) || !ok(band.highHz, SPECTRUM_MIN_HZ, SPECTRUM_MAX_HZ) || !(band.lowHz < band.highHz)) errors.push(`${path} needs lowHz < highHz within ${SPECTRUM_MIN_HZ}–${SPECTRUM_MAX_HZ}`);
  if (!ok(band.threshold, 0, 1) || !ok(band.ceiling, 0, 1) || band.ceiling <= band.threshold) errors.push(`${path} needs 0 ≤ threshold < ceiling ≤ 1`);
  if (!['follow', 'gate'].includes(band.mode)) errors.push(`${path}.mode must be follow or gate`);
  if (!ok(band.releaseSec, 0, 2)) errors.push(`${path}.releaseSec must be 0–2`);
  if (band.source !== undefined && !['master', 'drums', 'bass', 'vocals', 'other'].includes(band.source)) {
    errors.push(`${path}.source must be master, drums, bass, vocals or other`);
  }
  return errors;
}

const bandHopCache = new WeakMap();

/** Driver level 0–1 of a band at one song time (stateless, so scrubbing is exact). */
export function bandLevel(analysis, band, timeSec) {
  const sp = getSpectrumForSource(analysis, band?.source);
  if (!sp || !band) {
    if (band && (analysis?.features || analysis?.envelopes)) {
      const src = (band.source && band.source !== 'master') ? band.source : 'drums';
      const x = featureAt(analysis, src, timeSec);
      const span = Math.max(1e-6, band.ceiling - band.threshold);
      return band.mode === 'gate' ? (x >= band.threshold ? 1 : 0) : clamp((x - band.threshold) / span);
    }
    return 0;
  }
  const hop = sp.hopSec, position = (timeSec - sp.startSec) / hop, base = Math.floor(position), frac = position - base;
  const span = Math.max(1e-6, band.ceiling - band.threshold);
  const totalFrames = sp.frames || 0;
  let mapped;
  if (totalFrames > 0) {
    let byKey = bandHopCache.get(sp);
    if (!byKey) {
      byKey = new Map();
      bandHopCache.set(sp, byKey);
    }
    const cacheKey = `${band.lowHz}|${band.highHz}|${band.threshold}|${band.ceiling}|${band.mode}`;
    let mappedArr = byKey.get(cacheKey);
    if (!mappedArr) {
      mappedArr = new Float64Array(totalFrames);
      const isGate = band.mode === 'gate';
      const thresh = band.threshold;
      for (let f = 0; f < totalFrames; f++) {
        const x = rangeLevel(sp, f, band.lowHz, band.highHz);
        mappedArr[f] = isGate ? (x >= thresh ? 1 : 0) : clamp((x - thresh) / span);
      }
      byKey.set(cacheKey, mappedArr);
    }
    mapped = frame => mappedArr[Math.max(0, Math.min(totalFrames - 1, frame))];
  } else {
    mapped = frame => {
      const x = rangeLevel(sp, frame, band.lowHz, band.highHz);
      return band.mode === 'gate' ? (x >= band.threshold ? 1 : 0) : clamp((x - band.threshold) / span);
    };
  }
  const current = mapped(base) * (1 - frac) + mapped(base + 1) * frac;
  if (!(band.releaseSec > 0)) return clamp(current);
  let best = current;
  const taps = Math.min(40, Math.ceil(3 * band.releaseSec / hop));
  for (let k = 0; k <= taps; k++) best = Math.max(best, mapped(base - k) * Math.exp(-(k + frac) * hop / band.releaseSec));
  return clamp(best);
}

function hasAudioFeatures(analysis) {
  if (!analysis || typeof analysis !== 'object') return false;
  if (analysis.spectrum || analysis.features || analysis.envelopes) return true;
  if (analysis.drums || analysis.bass || analysis.vocals || analysis.other) return true;
  return false;
}

/** 0–1 level of whichever driver the clip uses, without gain; 1 for no driver. */
export function driverLevel(analysis, clip, timeSec) {
  if (clip.driver === 'none') return 1;
  if (!hasAudioFeatures(analysis)) return 0.85;
  if (clip.driver === 'band') return bandLevel(analysis, clip.band, timeSec);
  return featureAt(analysis, clip.driver, timeSec);
}
const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const number = (v, fallback = 0) => Number.isFinite(v) ? v : fallback;
const zeroBars = () => Object.fromEntries(BAR_IDS.map(id => [id, Array.from({ length: PIXELS_PER_BAR }, () => [0, 0, 0, 0])]));

/** Snap a song time to the nearest beat subdivision. A supplied beat grid wins
 * over a tempo estimate; otherwise bpm and offset define a uniform grid.
 */
export function snapTimeToBeat(timeSec, bpm, beatOffsetSec = 0, division = 1, beats = []) {
  if (!Number.isFinite(timeSec) || timeSec < 0) throw new RangeError('timeSec must be non-negative');
  if (!Number.isInteger(division) || division < 1 || division > 16) throw new RangeError('division must be 1–16');
  const grid = Array.isArray(beats) ? beats.map(b => typeof b === 'number' ? b : b?.timeSec).filter(Number.isFinite).sort((a, b) => a - b) : [];
  if (grid.length >= 2 && timeSec >= grid[0] && timeSec <= grid.at(-1)) {
    let nearest = grid[0], distance = Math.abs(timeSec - nearest);
    for (let i = 0; i < grid.length - 1; i++) {
      const step = (grid[i + 1] - grid[i]) / division;
      if (step <= 0) continue;
      const candidate = grid[i] + clamp(Math.round((timeSec - grid[i]) / step), 0, division) * step;
      const d = Math.abs(timeSec - candidate);
      if (d < distance) { nearest = candidate; distance = d; }
    }
    return Math.max(0, nearest);
  }
  const interval = 60 / clamp(number(bpm, 120), 40, 240) / division;
  return Math.max(0, beatOffsetSec + Math.round((timeSec - beatOffsetSec) / interval) * interval);
}

/** Returns {valid, errors}; suitable for checking edited JSON before saving. */
export function validateTimeline(timeline) {
  const errors = [];
  if (!timeline || typeof timeline !== 'object' || Array.isArray(timeline)) return { valid: false, errors: ['timeline must be an object'] };
  if (timeline.version !== 1) errors.push('version must be 1');
  if (!Number.isFinite(timeline.durationSec) || timeline.durationSec <= 0) errors.push('durationSec must be positive');
  if (!Number.isFinite(timeline.bpm) || timeline.bpm < 40 || timeline.bpm > 240) errors.push('bpm must be 40–240');
  if (!Number.isFinite(timeline.beatOffsetSec)) errors.push('beatOffsetSec must be finite');
  if (typeof timeline.blackout !== 'boolean') errors.push('blackout must be boolean');
  if (!Array.isArray(timeline.layers)) return { valid: false, errors: [...errors, 'layers must be an array'] };
  const layerIds = new Set();
  for (const [li, layer] of timeline.layers.entries()) {
    const path = `layers[${li}]`;
    if (!layer || typeof layer !== 'object') { errors.push(`${path} must be an object`); continue; }
    if (typeof layer.id !== 'string' || !layer.id || layerIds.has(layer.id)) errors.push(`${path}.id must be unique and nonempty`);
    layerIds.add(layer.id);
    if (typeof layer.enabled !== 'boolean') errors.push(`${path}.enabled must be boolean`);
    if (!TIMELINE_BLENDS.includes(layer.blend)) errors.push(`${path}.blend is unknown`);
    if (!Number.isFinite(layer.opacity) || layer.opacity < 0 || layer.opacity > 1) errors.push(`${path}.opacity must be 0–1`);
    if (!Array.isArray(layer.clips)) { errors.push(`${path}.clips must be an array`); continue; }
    const clipIds = new Set();
    for (const [ci, clip] of layer.clips.entries()) {
      const cp = `${path}.clips[${ci}]`;
      if (!clip || typeof clip !== 'object') { errors.push(`${cp} must be an object`); continue; }
      if (typeof clip.id !== 'string' || !clip.id || clipIds.has(clip.id)) errors.push(`${cp}.id must be unique and nonempty`);
      clipIds.add(clip.id);
      if (!Number.isFinite(clip.startSec) || clip.startSec < 0) errors.push(`${cp}.startSec must be non-negative`);
      if (!Number.isFinite(clip.durationSec) || clip.durationSec <= 0) errors.push(`${cp}.durationSec must be positive`);
      if (!TIMELINE_PRESETS.includes(clip.preset)) errors.push(`${cp}.preset is unknown`);
      if (clip.targets !== 'all' && (!Array.isArray(clip.targets) || !clip.targets.length || clip.targets.some(id => !BAR_IDS.includes(id)))) errors.push(`${cp}.targets must be all or bar IDs`);
      if (!Array.isArray(clip.color) || clip.color.length !== 4 || clip.color.some(v => !Number.isFinite(v) || v < 0 || v > 1)) errors.push(`${cp}.color must be four values in 0–1`);
      if (!DRIVERS.includes(clip.driver)) errors.push(`${cp}.driver is unknown`);
      if (clip.driver === 'band') errors.push(...bandErrors(clip.band, `${cp}.band`));
      if (clip.speed !== undefined && (!Number.isFinite(clip.speed) || clip.speed <= 0 || clip.speed > 32)) errors.push(`${cp}.speed must be positive number <= 32`);
      if (clip.chaseMode !== undefined && !['row', 'syncRow', 'col'].includes(clip.chaseMode)) errors.push(`${cp}.chaseMode must be row, syncRow or col`);
      if (clip.direction !== undefined && !['ltr', 'rtl', 'ttb', 'btt'].includes(clip.direction)) errors.push(`${cp}.direction must be ltr, rtl, ttb or btt`);
      if (clip.timing !== undefined && !['half', 'beat', 'bar', '2bar', '4bar'].includes(clip.timing)) errors.push(`${cp}.timing must be half, beat, bar, 2bar or 4bar`);
      if (clip.motionMode !== undefined && !['serial', 'sync'].includes(clip.motionMode)) errors.push(`${cp}.motionMode must be serial or sync`);
      if (clip.params !== undefined && (typeof clip.params !== 'object' || clip.params === null || Array.isArray(clip.params))) errors.push(`${cp}.params must be an object`);
      if (!Array.isArray(clip.keyframes) || !clip.keyframes.length) { errors.push(`${cp}.keyframes must be a nonempty array`); continue; }
      let previous = -Infinity;
      for (const [ki, key] of clip.keyframes.entries()) {
        if (!key || !Number.isFinite(key.timeSec) || key.timeSec < 0 || key.timeSec > clip.durationSec || key.timeSec <= previous || !Number.isFinite(key.value) || key.value < 0 || key.value > 1) errors.push(`${cp}.keyframes[${ki}] must have ordered timeSec and value 0–1`);
        previous = key?.timeSec ?? previous;
      }
    }
  }
  return { valid: errors.length === 0, errors };
}

function envelope(clip, localTime) {
  const keys = clip.keyframes;
  if (localTime <= keys[0].timeSec) return keys[0].value;
  for (let i = 1; i < keys.length; i++) {
    if (localTime <= keys[i].timeSec) {
      const a = keys[i - 1], b = keys[i];
      let t = (localTime - a.timeSec) / (b.timeSec - a.timeSec);
      const ease = a.ease || b.ease;
      if (ease === 'smooth' || ease === 'both' || ease === 'ease') t = t * t * (3 - 2 * t);
      else if (ease === 'in') t = t * t;
      else if (ease === 'out') t = 1 - (1 - t) * (1 - t);
      return a.value + (b.value - a.value) * t;
    }
  }
  return keys.at(-1).value;
}

function featureAt(analysis, driver, timeSec) {
  if (driver === 'none') return 1;
  const features = analysis?.features;
  let samples = features?.[driver] ?? features?.stems?.[driver] ?? analysis?.envelopes?.[driver] ?? analysis?.[driver];
  if (!(Array.isArray(samples) || ArrayBuffer.isView(samples)) || !samples.length) {
    if (driver === 'vocals' && features && !features.vocals && !features.stems?.vocals) {
      samples = analysis?.waveform?.mid ?? features.drums ?? features.bass;
    } else if (driver === 'other' && features && !features.other && !features.stems?.other) {
      samples = analysis?.waveform?.high ?? features.drums ?? features.bass;
    }
  }
  if (!(Array.isArray(samples) || ArrayBuffer.isView(samples)) || !samples.length) return 0;
  const hop = number(features?.hopSec, number(analysis?.hopSec, number(analysis?.waveform?.binSec, 0)));
  if (typeof samples[0] === 'number') {
    if (hop <= 0) return clamp(number(samples[0]));
    const startSec = number(features?.startSec, 0);
    const position = Math.max(0, (timeSec - startSec) / hop), a = Math.min(samples.length - 1, Math.floor(position)), b = Math.min(samples.length - 1, a + 1);
    return clamp(number(samples[a]) + (number(samples[b]) - number(samples[a])) * (position - Math.floor(position)));
  }
  const points = samples.map(s => ({ timeSec: s?.timeSec ?? s?.t, value: s?.value ?? s?.level ?? s?.[driver] })).filter(s => Number.isFinite(s.timeSec) && Number.isFinite(s.value)).sort((a, b) => a.timeSec - b.timeSec);
  if (!points.length) return 0;
  if (timeSec <= points[0].timeSec) return clamp(points[0].value);
  for (let i = 1; i < points.length; i++) {
    if (timeSec <= points[i].timeSec) {
      const a = points[i - 1], b = points[i], t = (timeSec - a.timeSec) / (b.timeSec - a.timeSec || 1);
      return clamp(a.value + (b.value - a.value) * t);
    }
  }
  return clamp(points.at(-1).value);
}

export function pattern(preset, row, col, pixel, timeSec, localTime, beatSec, clip = null, barId = null) {
  const y = (pixel + .5) / PIXELS_PER_BAR;
  const speed = (clip && Number.isFinite(clip.speed) && clip.speed > 0) ? clip.speed : 1;
  const targetId = barId || BAR_IDS[row * 3 + col];
  const timing = clip?.timing || 'beat';
  const intervalBeats = timing === 'half' ? 0.5 : (timing === 'bar' ? 4 : (timing === '2bar' ? 8 : (timing === '4bar' ? 16 : 1)));
  const stepSec = beatSec * intervalBeats;
  const p = clip?.params || {};

  switch (preset) {
    case 'wash': {
      const mood = p.mood || 'drift';
      if (mood === 'breath') return .3 + .5 * (.5 + .5 * Math.sin(timeSec * 2));
      if (mood === 'still') return .5 + .2 * (1 - Math.abs(col - 1) * 0.4);
      return .45 + .13 * Math.sin(timeSec * 1.3 + col + y);
    }
    case 'pulse': {
      const curve = p.curve || 'punch';
      const floor = Number.isFinite(p.floor) ? p.floor : 0.2;
      const phase = ((localTime / stepSec) % 1);
      let val = 0;
      if (curve === 'breath') val = .5 + .5 * Math.cos(phase * 2 * Math.PI);
      else if (curve === 'swell') val = Math.exp((phase - 1) * 3.5);
      else val = Math.exp(-phase * 4);
      return clamp(floor + (1 - floor) * val);
    }
    case 'columns': {
      const activeBars = (!clip || clip.targets === 'all' || p.pathMode === 'keep')
        ? [...BAR_IDS]
        : BAR_IDS.filter(id => clip.targets.includes(id));
      const dir = clip?.direction || 'ltr';
      const mode = p.mode || 'single';

      if (dir === 'ttb' || dir === 'btt') {
        const barRow = id => (id[1] === '1' ? 0 : (id[1] === '2' ? 1 : 2));
        const hasOuterTop = activeBars.includes('L1') || activeBars.includes('R1');
        const effectiveBars = hasOuterTop ? activeBars : activeBars.filter(id => id !== 'C1');
        let activeRows = [...new Set(effectiveBars.map(barRow))].sort((a, b) => a - b);
        if (!activeRows.length) activeRows = [0, 1, 2];
        if (dir === 'btt') activeRows = [...activeRows].reverse();
        const stepIndex = Math.floor(localTime / stepSec) % activeRows.length;
        const curRow = activeRows[stepIndex];
        if (mode === 'invert') return row !== curRow ? 1 : 0.05;
        if (mode === 'double') {
          const nextRow = activeRows[(stepIndex + 1) % activeRows.length];
          return (row === curRow || row === nextRow) ? 1 : 0.05;
        }
        return row === curRow ? 1 : 0.05;
      } else {
        const barCol = id => (id[0] === 'L' ? 0 : (id[0] === 'C' ? 1 : 2));
        let activeCols = [...new Set(activeBars.map(barCol))].sort((a, b) => a - b);
        if (!activeCols.length) activeCols = [0, 1, 2];
        if (dir === 'rtl') activeCols = [...activeCols].reverse();
        const stepIndex = Math.floor(localTime / stepSec) % activeCols.length;
        const curCol = activeCols[stepIndex];
        if (mode === 'invert') return col !== curCol ? 1 : 0.05;
        if (mode === 'double') {
          const nextCol = activeCols[(stepIndex + 1) % activeCols.length];
          return (col === curCol || col === nextCol) ? 1 : 0.05;
        }
        return col === curCol ? 1 : 0.05;
      }
    }
    case 'chase': {
      const activeBars = (!clip || clip.targets === 'all' || p.pathMode === 'keep')
        ? [...BAR_IDS]
        : BAR_IDS.filter(id => clip.targets.includes(id));
      if (!activeBars.length) return 0;

      const barCol = id => (id[0] === 'L' ? 0 : (id[0] === 'C' ? 1 : 2));
      const barRow = id => (id[1] === '1' ? 0 : (id[1] === '2' ? 1 : 2));

      const targetList = (!clip || clip.targets === 'all') ? [...BAR_IDS] : BAR_IDS.filter(id => clip.targets.includes(id));
      const hasLeft = targetList.some(id => id.startsWith('L'));
      const hasRight = targetList.some(id => id.startsWith('R'));
      const hasCenter = targetList.some(id => id.startsWith('C'));
      const activeColCount = new Set(targetList.map(id => id[0])).size;
      const hasMultipleRows = new Set(targetList.map(id => id[1])).size > 1;
      const isDualFlank = hasLeft && hasRight && !hasCenter && hasMultipleRows;
      const isSingleColumn = activeColCount === 1 && hasMultipleRows;

      // Support direction and motionMode, backward compatible with legacy chaseMode.
      // If only a single vertical column (e.g. L1-L3) is targeted and no explicit vertical direction is set, default to ttb.
      let dir = clip?.direction || (clip?.chaseMode === 'col' || isSingleColumn ? 'ttb' : 'ltr');
      if (isSingleColumn && (dir === 'ltr' || dir === 'rtl')) {
        dir = dir === 'rtl' ? 'btt' : 'ttb';
      }
      let motion = clip?.motionMode || (clip?.chaseMode === 'syncRow' ? 'sync' : 'serial');
      if (isSingleColumn) motion = 'serial';

      // Physical inter-bar gap compensation:
      // Each bar is 120 cm (12 pixels -> 10 cm/pixel). Between L1 and L2 (and L2 and L3)
      // there is ~55–60 cm (5.8 pixels) of empty physical space.
      const gapMode = p.gap || 'physical';
      const verticalGapPx = gapMode === 'none' ? 0 : (gapMode === 'tight' ? 3.0 : (gapMode === 'wide' ? 9.0 : (Number.isFinite(p.gapCm) ? p.gapCm / 10 : 5.8)));
      const horizGapPx = gapMode === 'wide' ? 4.0 : (gapMode === 'tight' ? 1.5 : 0);

      let position = 0;
      let pathLen = 0;

      if (isDualFlank) {
        const isRev = dir === 'btt' || dir === 'rtl';
        const isLeft = targetId.startsWith('L');
        const isRight = targetId.startsWith('R');
        if (!isLeft && !isRight) return 0;

        const sideBars = isLeft
          ? (isRev ? ['L3', 'L2', 'L1'] : ['L1', 'L2', 'L3']).filter(id => activeBars.includes(id))
          : (isRev ? ['R3', 'R2', 'R1'] : ['R1', 'R2', 'R3']).filter(id => activeBars.includes(id));
        const idx = sideBars.indexOf(targetId);
        if (idx === -1) return 0;

        const n = sideBars.length;
        const gap = n > 1 ? verticalGapPx : 0;
        const endFlyout = gap > 0 ? Math.min(3.4, gap * 0.6) : 0;
        const px = isRev ? (PIXELS_PER_BAR - 1 - pixel) : pixel;
        position = idx * (PIXELS_PER_BAR + gap) + px;
        pathLen = n * PIXELS_PER_BAR + Math.max(0, n - 1) * gap + endFlyout;
      } else if (motion === 'sync') {
        const hasOuterTop = activeBars.includes('L1') || activeBars.includes('R1');
        const effectiveSyncBars = hasOuterTop ? activeBars : activeBars.filter(id => id !== 'C1');
        if (dir === 'ttb') {
          let activeRows = [...new Set(effectiveSyncBars.map(barRow))].sort((a, b) => a - b);
          if (!activeRows.length) activeRows = [0, 1, 2];
          const rowIdx = activeRows.indexOf(row);
          if (rowIdx === -1) return 0;
          const n = activeRows.length;
          const gap = n > 1 ? verticalGapPx : 0;
          const endFlyout = gap > 0 ? Math.min(3.4, gap * 0.6) : 0;
          position = rowIdx * (PIXELS_PER_BAR + gap) + pixel;
          pathLen = n * PIXELS_PER_BAR + Math.max(0, n - 1) * gap + endFlyout;
        } else if (dir === 'btt') {
          let activeRows = [...new Set(effectiveSyncBars.map(barRow))].sort((a, b) => b - a);
          if (!activeRows.length) activeRows = [2, 1, 0];
          const rowIdx = activeRows.indexOf(row);
          if (rowIdx === -1) return 0;
          const n = activeRows.length;
          const gap = n > 1 ? verticalGapPx : 0;
          const endFlyout = gap > 0 ? Math.min(3.4, gap * 0.6) : 0;
          position = rowIdx * (PIXELS_PER_BAR + gap) + ((PIXELS_PER_BAR - 1) - pixel);
          pathLen = n * PIXELS_PER_BAR + Math.max(0, n - 1) * gap + endFlyout;
        } else if (dir === 'rtl') {
          let activeCols = [...new Set(activeBars.map(barCol))].sort((a, b) => b - a);
          if (!activeCols.length) activeCols = [2, 1, 0];
          const colIdx = activeCols.indexOf(col);
          if (colIdx === -1) return 0;
          const n = activeCols.length;
          const gap = n > 1 ? horizGapPx : 0;
          position = colIdx * (PIXELS_PER_BAR + gap) + ((PIXELS_PER_BAR - 1) - pixel);
          pathLen = n * PIXELS_PER_BAR + Math.max(0, n - 1) * gap;
        } else { // 'ltr'
          let activeCols = [...new Set(activeBars.map(barCol))].sort((a, b) => a - b);
          if (!activeCols.length) activeCols = [0, 1, 2];
          const colIdx = activeCols.indexOf(col);
          if (colIdx === -1) return 0;
          const n = activeCols.length;
          const gap = n > 1 ? horizGapPx : 0;
          position = colIdx * (PIXELS_PER_BAR + gap) + pixel;
          pathLen = n * PIXELS_PER_BAR + Math.max(0, n - 1) * gap;
        }
      } else {
        // 'serial' mode: single beam traversing through active panels in directional sequence
        let ORDER;
        let revPixel = false;
        if (dir === 'rtl') {
          ORDER = ['R1', 'C1', 'L1', 'R2', 'C2', 'L2', 'R3', 'C3', 'L3'];
          revPixel = true;
        } else if (dir === 'ttb') {
          ORDER = ['L1', 'L2', 'L3', 'C1', 'C2', 'C3', 'R1', 'R2', 'R3'];
          revPixel = false;
        } else if (dir === 'btt') {
          ORDER = ['L3', 'L2', 'L1', 'C3', 'C2', 'C1', 'R3', 'R2', 'R1'];
          revPixel = true;
        } else { // 'ltr'
          ORDER = ['L1', 'C1', 'R1', 'L2', 'C2', 'R2', 'L3', 'C3', 'R3'];
          revPixel = false;
        }

        const serialBars = hasMultipleRows ? activeBars.filter(id => id !== 'C1') : activeBars;
        const pathBars = ORDER.filter(id => serialBars.includes(id));
        const idx = pathBars.indexOf(targetId);
        if (idx === -1) return 0;

        // Accumulate physical distance along pathBars including the 55-60 cm vertical gap
        // whenever consecutive bars step across vertical rows (e.g. L1 -> L2 -> L3).
        let cursor = 0;
        let targetBarStart = 0;
        let totalGapAdded = 0;
        for (let i = 0; i < pathBars.length; i++) {
          if (i > 0) {
            const prevId = pathBars[i - 1];
            const curId = pathBars[i];
            const rowStep = Math.abs(barRow(curId) - barRow(prevId));
            const sameCol = barCol(curId) === barCol(prevId);
            const stepGap = (sameCol && rowStep > 0)
              ? verticalGapPx * rowStep
              : (rowStep > 0 ? verticalGapPx * 0.5 : horizGapPx);
            cursor += stepGap;
            totalGapAdded += stepGap;
          }
          if (i === idx) targetBarStart = cursor;
          cursor += PIXELS_PER_BAR;
        }
        const endFlyout = totalGapAdded > 0 ? Math.min(3.4, verticalGapPx * 0.6) : 0;
        pathLen = cursor + endFlyout;
        const px = revPixel ? (PIXELS_PER_BAR - 1 - pixel) : pixel;
        position = targetBarStart + px;
      }

      if (pathLen <= 0) return 0;

      // Sweep rate: constant physical velocity (cm/s) across both bars and 58 cm gaps.
      // When p.oneShot is true (Live Board hit shots), each runner travels once from start
      // to end and exits off the last bar without wrapping around modulo pathLen.
      const head = p.oneShot
        ? (localTime / stepSec) * pathLen
        : ((localTime / stepSec) * pathLen) % pathLen;
      let d = head - position;
      if (!p.oneShot) {
        if (d < -pathLen / 2) d += pathLen;
        if (d > pathLen / 2) d -= pathLen;
      }

      // Beam profile: needle (1.0), razor (2.2), beam (4.2), comet (7.5)
      let tail;
      if (p.beam === 'needle') tail = 1.0;
      else if (p.beam === 'razor') tail = 2.2;
      else if (p.beam === 'beam') tail = 4.2;
      else if (p.beam === 'comet') tail = 7.5;
      else tail = speed >= 8 ? 2.0 : (speed >= 4 ? 2.8 : (speed >= 2 ? 3.8 : 5.0));

      const glow = Number.isFinite(p.glow) ? p.glow : 0;
      const baseGlow = glow * 0.15;

      // Smooth sub-pixel Gaussian leading wavefront (prevents abrupt 1-frame step pop when entering a bar after a gap)
      const lead = Math.min(1.6, Math.max(0.75, tail * 0.34));
      const maxLead = lead * 2.1;
      const maxTail = tail * 3.1;
      if (d < -maxLead || d > maxTail) return baseGlow;

      let beamVal = 0;
      if (d < 0) {
        const u = -d / lead;
        const taper = 1 - (-d / maxLead);
        beamVal = Math.exp(-u * u * 1.15) * taper;
      } else {
        const taper = 1 - Math.pow(d / maxTail, 2.2);
        beamVal = Math.exp(-d / tail) * Math.max(0, taper);
      }
      return clamp(baseGlow + (1 - baseGlow) * beamVal);
    }
    case 'flash': {
      if (p.focus || p.decay) {
        const focus = p.focus || 'center';
        const decay = p.decay || 'fast';
        const decayMult = decay === 'instant' ? 8 : (decay === 'slow' ? 2 : 4);
        const env = Math.exp(-((localTime / stepSec) % 1) * decayMult);
        if (focus === 'all') return env;
        if (focus === 'edges') return env * (Math.abs(col - 1) / 1.5 + Math.abs(row - 1) * 0.3);
        return (.35 + .65 * (1 - Math.abs(col - 1) / 2)) * env;
      }
      return .55 + .45 * (1 - Math.abs(col - 1) / 2);
    }
    case 'wave': {
      const shape = p.shape || 'sine';
      const angle = p.angle || 'diag';
      const density = p.density || 'med';
      const freqMult = density === 'low' ? 0.5 : (density === 'high' ? 2.5 : 1.0);
      // 1.4833 accounts for 120 cm bar + 58 cm physical vertical gap between rows
      const physY = row * 1.4833 + y;

      let spatialPos = (col + physY * 0.45);
      if (angle === 'horiz') spatialPos = col * 1.3 + y * 0.15;
      else if (angle === 'vert') spatialPos = physY;

      const phase = (spatialPos * freqMult * Math.PI - timeSec * Math.PI / beatSec);
      let w = 0;
      if (shape === 'triangle') {
        const norm = ((phase / Math.PI) % 2 + 2) % 2;
        w = Math.abs(norm - 1);
      } else if (shape === 'saw') {
        w = ((phase / (2 * Math.PI)) % 1 + 1) % 1;
      } else {
        w = .5 + .5 * Math.sin(phase);
      }
      return clamp(.15 + .85 * w);
    }
    case 'strobe': {
      const rate = p.rate || p.division || '1/4';
      const duty = p.duty || p.shutter || 'normal';
      const pat = p.pattern || 'all';

      let div = 4;
      if (rate === '1/2') div = 2;
      else if (rate === '1/8') div = 8;
      else if (rate === '1/16') div = 16;
      else if (rate === '1/32') div = 32;
      else if (rate === 'chaos') div = 11.3;

      let dutyCut = (duty === 'sharp' || duty === 'razor') ? 0.16 : (duty === 'wide' ? 0.55 : 0.35);

      // Protection against DDP/WLED aliasing at 40 FPS (25ms frame boundary):
      // Ensure strobe on-time does not fall below 25 ms (0.025s) even at high BPMs.
      const periodSec = beatSec / div;
      const effPeriodSec = speed > 0 ? (periodSec / speed) : periodSec;
      if (effPeriodSec > 0) {
        const minDuty = Math.min(0.85, 0.025 / effPeriodSec);
        if (dutyCut < minDuty) dutyCut = minDuty;
      }

      let offset = 0;
      if (pat === 'checker') offset = ((row + col) % 2 === 0) ? 0 : 0.5;
      else if (pat === 'chaos') offset = ((row * 7 + col * 13) % 10) / 10;

      const phase = ((localTime / (beatSec / div) + offset) % 1 + 1) % 1;
      return phase < dutyCut ? 1 : 0;
    }
    case 'sparkle': {
      const density = p.density || 'stars';
      const glint = p.glint || 'crisp';
      const s1 = Math.sin((row * 7 + col * 13 + pixel * 31) * 83 + timeSec * 9);
      const s2 = Math.cos((row * 11 + col * 5 + pixel * 17) * 47 - timeSec * 7);
      const raw = Math.max(0, s1 * s2);

      let thresh = 0.25;
      if (density === 'firefly') thresh = 0.55;
      else if (density === 'glitter') thresh = 0.05;

      if (raw < thresh) return 0;
      const power = glint === 'soft' ? 1.8 : 3.5;
      return clamp(Math.pow((raw - thresh) / (1 - thresh || 1), power));
    }
    case 'spiral': {
      const dir = p.direction || p.dir || 'cw';
      const tailMode = p.tail || 'med';
      const centerMode = p.center || 'pulse';

      const perimeterIndex = [
        [0, 1, 2],
        [7, -1, 3],
        [6, 5, 4]
      ][row][col];

      if (perimeterIndex === -1) {
        if (centerMode === 'off') return 0;
        if (centerMode === 'on') return 1;
        return clamp(0.2 + 0.6 * (.5 + .5 * Math.sin(timeSec * 3)));
      }

      const order = dir === 'ccw' ? [0, 7, 6, 5, 4, 3, 2, 1] : [0, 1, 2, 3, 4, 5, 6, 7];
      const idAtPerimeter = ['L1', 'C1', 'R1', 'R2', 'R3', 'C3', 'L3', 'L2'];
      const path = p.pathMode === 'skip' && clip?.targets !== 'all' ? order.filter(i => clip.targets.includes(idAtPerimeter[i])) : order;
      if (!path.length) return 0;
      const pIdx = path.indexOf(perimeterIndex);
      if (pIdx < 0) return 0;
      const head = (localTime / beatSec * 2) % path.length;
      const dist = (head - pIdx + path.length) % path.length;
      const tailSpread = tailMode === 'point' ? 1.0 : (tailMode === 'snake' ? 6.0 : 3.0);
      return clamp(0.08 + 0.92 * Math.exp(-dist * dist / tailSpread));
    }
    case 'ripple': {
      const origin = p.origin || 'center';
      const dir = p.direction || p.dir || 'out';
      const width = p.width || 'sharp';

      let oCol = 1, oRow = 1;
      if (origin === 'top') { oCol = 1; oRow = 0; }
      else if (origin === 'bottom') { oCol = 1; oRow = 2; }
      else if (origin === 'corners') { oCol = col === 0 ? 0 : 2; oRow = row === 0 ? 0 : 2; }

      const rDist = Math.hypot(col - oCol, (row - oRow) * 1.1) + Math.abs(y - 0.5) * 0.4;
      let rPhase = (localTime / (beatSec * 2) - (dir === 'in' ? -rDist : rDist) * 0.38) % 1;
      rPhase = (rPhase + 1) % 1;
      const decayPower = width === 'wide' ? 2.5 : 4.5;
      return Math.exp(-rPhase * decayPower);
    }
    case 'rain': {
      const streak = p.streak || p.style || 'streak';
      const spread = p.spread || 'random';
      const colShift = spread === 'sync' ? 0 : (col * 0.28);
      // 1.4833 accounts for 120 cm bar + 58 cm physical vertical gap between rows
      const vert = row * 1.4833 + y;
      const phase = ((localTime / (beatSec * 1.5) - vert * 0.26 + colShift) % 1 + 1) % 1;
      const dropPower = streak === 'drops' ? 9.0 : ((streak === 'beam' || streak === 'heavy') ? 2.5 : 5.0);
      return Math.exp(-phase * dropPower);
    }
    case 'bounce': {
      const axis = p.axis || 'horiz';
      const curve = p.curve || p.physics || 'pendulum';
      const rawPos = (localTime / beatSec) % 2;
      let sweep = 0;
      if (curve === 'elastic') {
        sweep = 1 + (rawPos < 1 ? (rawPos * 2 - 1) : (3 - rawPos * 2));
      } else {
        sweep = 1 + Math.sin(localTime / beatSec * Math.PI);
      }
      const targetPos = axis === 'vert' ? row : col;
      return Math.exp(-Math.pow(targetPos - sweep, 2) * 3);
    }
    case 'fire': {
      const height = p.height || 'mid';
      const turbulence = p.turbulence || 'normal';
      const hLimit = height === 'low' ? 1.8 : (height === 'full' ? 3.4 : 2.6);
      const flameH = Math.max(0, (hLimit - (row + y * 0.8)) / hLimit);
      const tMult = turbulence === 'calm' ? 0.6 : (turbulence === 'storm' ? 2.2 : 1.0);
      const flicker = 0.65 + 0.35 * Math.sin(timeSec * 16 * tMult + col * 3.7 + pixel * 0.4) * Math.sin(timeSec * 8.3 * tMult - row * 1.9);
      return clamp(flameH * flicker);
    }
    case 'alternate': {
      const pat = p.pattern || 'checker';
      const trans = p.transition || 'cut';
      let isEven = false;
      if (pat === 'rows') isEven = row % 2 === 0;
      else if (pat === 'cols') isEven = col % 2 === 0;
      else if (pat === 'cross') isEven = (row === 1 || col === 1);
      else isEven = (row + col) % 2 === 0;

      const progress = (localTime / stepSec);
      const stepIndex = Math.floor(progress);
      const on = (isEven === (stepIndex % 2 === 0));

      if (trans === 'fade') {
        const frac = progress % 1;
        const wave = 0.5 + 0.5 * Math.cos(frac * Math.PI);
        return on ? (0.1 + 0.9 * wave) : (0.1 + 0.9 * (1 - wave));
      }
      return on ? 1 : 0.08;
    }
    case 'center': {
      const mode = p.geometry || p.mode || 'cross';
      const breathing = p.breathe === true || p.breathe === 'on' || (p.breathe === undefined && p.pulse === true);
      const pulseVal = breathing ? clamp(.2 + .8 * (.5 + .5 * Math.sin(timeSec * 3))) : 1;
      if (row === 1 && col === 1) return pulseVal;
      if (mode === 'cross' && (row === 1 || col === 1)) return clamp(pulseVal * 0.65);
      if (mode === 'iris') {
        const d = Math.hypot(col - 1, row - 1);
        return clamp(pulseVal * (1 - d / 2));
      }
      return clamp(0.12 + 0.15 * (.5 + .5 * Math.sin(timeSec * 2 + row + col)));
    }
    case 'sweep': {
      const style = p.style || 'horiz';
      const width = p.width || 'laser';
      const beamExp = width === 'fan' ? 2.5 : 10.0;

      let bDist = 0;
      if (style === 'vert') {
        const beamPos = ((localTime / (beatSec * 2)) % 1) * 3.2 - 0.1;
        bDist = Math.abs(row + y - beamPos);
      } else if (style === 'radar') {
        const angle = ((localTime / (beatSec * 2)) % 1) * Math.PI * 2;
        const cellAngle = Math.atan2(row - 1, col - 1) + Math.PI;
        let diff = Math.abs(angle - cellAngle);
        if (diff > Math.PI) diff = 2 * Math.PI - diff;
        bDist = diff * 1.5;
      } else { // 'horiz' (default)
        const beamPos = ((localTime / (beatSec * 2)) % 1) * 3.4 - 0.2;
        bDist = Math.abs((col + row * 0.3 + y * 0.2) - beamPos);
      }
      return Math.exp(-bDist * bDist * beamExp);
    }
    default: return 0;
  }
}

function blend(dst, src, mode) {
  switch (mode) {
    case 'add': return clamp(dst + src);
    case 'screen': return 1 - (1 - dst) * (1 - src);
    case 'multiply': return dst * src;
    case 'max': return Math.max(dst, src);
    case 'replace': return src;
    default: return dst;
  }
}

/** Render the final RGBW frame. baseFrame may be {bars} from LightingEngine or
 * a bare bars map. Explicit timeline.blackout or baseFrame.blackout forces zero.
 */
export function renderTimelineFrame(timeline, analysis, timeSec, baseFrame = null, skipValidation = false) {
  if (!skipValidation) {
    const check = validateTimeline(timeline);
    if (!check.valid) throw new TypeError(`Invalid timeline: ${check.errors.join('; ')}`);
  }
  if (!Number.isFinite(timeSec)) throw new TypeError('timeSec must be finite');
  const out = zeroBars();
  if (timeline.blackout || baseFrame?.blackout) return { bars: out };
  const input = baseFrame?.bars ?? baseFrame;
  if (input) {
    for (const id of BAR_IDS) for (let p = 0; p < PIXELS_PER_BAR; p++) for (let c = 0; c < 4; c++) out[id][p][c] = clamp(number(input?.[id]?.[p]?.[c]), 0, 255) / 255;
  }
  const beatSec = 60 / timeline.bpm;
  for (const layer of timeline.layers) {
    if (!layer.enabled || layer.opacity === 0) continue;
    for (const clip of layer.clips) {
      const localTime = timeSec - clip.startSec;
      if (localTime < 0 || localTime >= clip.durationSec) continue;
      const gain = Number.isFinite(clip.driverGain) ? clip.driverGain : 1;
      const strength = clamp(layer.opacity * envelope(clip, localTime) * (clip.driver === 'none' ? 1 : driverLevel(analysis, clip, Number.isFinite(clip.driverTimeSec) ? clip.driverTimeSec : timeSec) * gain));
      if (strength <= 0) continue;
      const speed = (Number.isFinite(clip.speed) && clip.speed > 0) ? clip.speed : 1;
      const animLocalTime = localTime * speed;
      const animTimeSec = timeSec * speed;
      for (const [index, id] of BAR_IDS.entries()) {
        if (clip.targets !== 'all' && !clip.targets.includes(id)) continue;
        const row = Math.floor(index / 3), col = index % 3;
        for (let p = 0; p < PIXELS_PER_BAR; p++) {
          const amount = strength * pattern(clip.preset, row, col, p, animTimeSec, animLocalTime, beatSec, clip, id);
          for (let c = 0; c < 4; c++) out[id][p][c] = blend(out[id][p][c], clip.color[c] * amount, layer.blend);
        }
      }
    }
  }
  for (const id of BAR_IDS) for (const pixel of out[id]) for (let c = 0; c < 4; c++) pixel[c] = Math.round(clamp(pixel[c]) * 255);
  return { bars: out };
}

/** Build an editable energetic first pass; uses structural track sections when
 * available to produce dynamic, section-tailored lighting arrangements.
 */
export function createAutoShow(analysis = {}, options = {}) {
  const durationSec = number(analysis?.durationSec, number(analysis?.duration, 0));
  if (durationSec <= 0) throw new RangeError('analysis.durationSec must be positive');
  const bpm = clamp(number(analysis?.bpm, 120), 40, 240);
  const beats = analysis?.beatsSec ?? analysis?.beats ?? [];
  const beatOffsetSec = number(analysis?.beatOffsetSec, typeof beats?.[0] === 'number' ? beats[0] : number(beats?.[0]?.timeSec, 0));
  const energy = clamp(number(options.energy, .8));
  const division = options.snapSubdivision ?? 1;

  let palette;
  if (Array.isArray(options.customColors) && options.customColors.length > 0) {
    const normalized = options.customColors.map(normalizeColor);
    palette = [0, 1, 2, 3].map(i => normalized[i % normalized.length]);
  } else {
    const paletteKey = options.palette ?? options.theme ?? options.style ?? 'club';
    palette = PALETTES[paletteKey];
    if (!palette) throw new RangeError('unknown palette');
  }

  let allowedSet = null;
  if (options.allowedPresets instanceof Set || Array.isArray(options.allowedPresets)) {
    const valid = [...options.allowedPresets].filter(p => TIMELINE_PRESETS.includes(p));
    if (valid.length > 0) allowedSet = new Set(valid);
  }

  const pickPreset = (preferred, fallbacks = [], set = allowedSet) => {
    if (!set || set.size === 0) return preferred;
    if (set.has(preferred)) return preferred;
    for (const fb of fallbacks) {
      if (set.has(fb)) return fb;
    }
    return set.values().next().value;
  };

  const sanitizeKeyframes = (keys, len) => {
    if (!Array.isArray(keys) || !keys.length) return [{ timeSec: 0, value: 1 }];
    const sorted = keys
      .map(k => ({ timeSec: clamp(number(k.timeSec, 0), 0, len), value: clamp(number(k.value, 1), 0, 1), ...(k.ease ? { ease: k.ease } : {}) }))
      .sort((a, b) => a.timeSec - b.timeSec);
    const out = [];
    for (const k of sorted) {
      if (!out.length || k.timeSec > out.at(-1).timeSec + 1e-6) {
        out.push(k);
      } else {
        out[out.length - 1] = k;
      }
    }
    return out.length ? out : [{ timeSec: 0, value: 1 }];
  };

  const makeClip = (id, preset, color, driver = 'other', targets = 'all', startSec = 0, length = durationSec, gain = 1, speed = 1, params = null, keyframes = null, band = null, timing = 'beat') => {
    const finalPreset = pickPreset(preset);
    const defaultKeys = [{ timeSec: 0, value: 0 }, { timeSec: Math.min(.4, length / 3), value: 1 }, { timeSec: length - Math.min(.4, length / 3), value: 1 }, { timeSec: length, value: 0 }];
    return {
      id,
      startSec,
      durationSec: length,
      preset: finalPreset,
      targets,
      color: normalizeColor(color),
      driver,
      driverGain: gain,
      speed,
      timing,
      ...(params ? { params } : {}),
      ...(band ? { band } : {}),
      keyframes: sanitizeKeyframes(keyframes || defaultKeys, length)
    };
  };

  // Strip warm white (W) channel on non-drop sections so drops own the full RGBW punch
  const rgbOnly = (c, scale = 1) => {
    let [r = 0, g = 0, b = 0, w = 0] = normalizeColor(c);
    if (r + g + b < 0.05 && w > 0) {
      r = w * 0.55;
      g = w * 0.58;
      b = w * 0.65;
    }
    return [clamp(r * scale), clamp(g * scale), clamp(b * scale), 0];
  };

  // Boost RGB and warm white (W) channel for maximum drop punch
  const dropColor = (c, minW = 0.35, boost = 1.25) => {
    let [r = 0, g = 0, b = 0, w = 0] = normalizeColor(c);
    if (r + g + b < 0.05 && w > 0) {
      r = w * 0.85;
      g = w * 0.85;
      b = w * 0.90;
    }
    const maxCh = Math.max(r, g, b, 0.01);
    const s = maxCh < 0.75 ? Math.min(boost, 0.96 / maxCh) : boost;
    return [clamp(r * s), clamp(g * s), clamp(b * s), clamp(Math.max(w, minW))];
  };

  const ceilKeys = (len, ceiling = 0.5, isPreDrop = false) => {
    const fadeIn = Math.min(0.35, len * 0.18);
    const fadeOut = Math.min(0.35, len * 0.18);
    return sanitizeKeyframes([
      { timeSec: 0, value: clamp(ceiling * 0.45) },
      { timeSec: fadeIn, value: clamp(ceiling) },
      { timeSec: Math.max(fadeIn + 0.01, len - fadeOut), value: clamp(ceiling) },
      { timeSec: len, value: isPreDrop ? clamp(ceiling * 0.85) : clamp(ceiling * 0.35) }
    ], len);
  };

  const buildRampKeys = (len, startVal = 0.45, endVal = 0.88) => sanitizeKeyframes([
    { timeSec: 0, value: clamp(startVal) },
    { timeSec: len, value: clamp(endVal) }
  ], len);

  const dropKeys = (len) => sanitizeKeyframes([
    { timeSec: 0, value: 1 },
    { timeSec: Math.max(0.01, len - Math.min(0.18, len * 0.1)), value: 1 },
    { timeSec: len, value: 0.9 }
  ], len);

  const sections = (Array.isArray(analysis?.sections) && analysis.sections.length)
    ? analysis.sections
    : detectSections(analysis);

  // If track has detected sections and sufficient length, create a section-aware arrangement
  if (sections.length >= 2 && durationSec >= 20) {
    const washClips = [];
    const rhythmClips = [];
    const bassClips = [];
    const synthClips = [];
    const accentClips = [];

    const whiteBlinder = [1, 0.98, 0.92, 1];
    const wings = ['L1', 'R1', 'L2', 'R2', 'L3', 'R3'];
    const centerCol = ['C1', 'C2', 'C3'];
    const leftCol = ['L1', 'L2', 'L3'];
    const rightCol = ['R1', 'R2', 'R3'];
    const cross = ['C1', 'L2', 'C2', 'R2', 'C3'];
    const upperCross = ['C1', 'L2', 'C2', 'R2'];
    const crossNoCenter = ['C1', 'L2', 'R2', 'C3'];
    const bottomRow = ['L3', 'C3', 'R3'];
    const perimeter = ['L1', 'C1', 'R1', 'R2', 'R3', 'C3', 'L3', 'L2'];
    const corners = ['L1', 'R1', 'L3', 'R3'];

    const beatSec = 60 / bpm;
    const barSec = 4 * beatSec;

    const hasVocals = Boolean(analysis?.features?.vocals || analysis?.features?.stems?.vocals);

    // Tuned frequency-band gates directly modeled on user's curated Sounds project
    const kickGate = {
      source: analysis?.features?.drums ? 'drums' : 'master',
      lowHz: 40, highHz: 110, threshold: 0.55, ceiling: 1, mode: 'gate', releaseSec: 0.14
    };
    const snareGate = {
      source: analysis?.features?.drums ? 'drums' : 'master',
      lowHz: 180, highHz: 450, threshold: 0.60, ceiling: 1, mode: 'gate', releaseSec: 0.12
    };
    const vocalFollow = {
      source: hasVocals ? 'vocals' : 'other',
      lowHz: 350, highHz: 3400, threshold: 0.38, ceiling: 0.95, mode: 'follow', releaseSec: 0.15
    };

    let dropIdx = 0;
    let buildIdx = 0;
    let verseIdx = 0;

    const dropSections = sections.filter(s => s.type === 'drop');

    sections.forEach((sec, idx) => {
      const start = Math.max(0, sec.startSec);
      const rawLen = Math.max(0.1, Math.min(sec.durationSec ?? ((sec.endSec ?? durationSec) - start), durationSec - start));
      if (rawLen <= 0.05) return;

      const nextSec = sections[idx + 1];
      const isPreDrop = nextSec && nextSec.type === 'drop';
      let blackoutSec = 0;
      if (isPreDrop) {
        const dropNumber = dropSections.indexOf(nextSec) + 1;
        let targetSec;
        if (Number.isFinite(options.preDropBlackoutSec)) {
          targetSec = options.preDropBlackoutSec;
        } else if (Number.isFinite(options.preDropBlackoutBeats)) {
          targetSec = options.preDropBlackoutBeats * beatSec;
        } else {
          // Drop 1: 1 beat; Drop 2 and later: 2 beats (half bar)
          const blackoutBeats = dropNumber <= 1 ? 1 : 2;
          targetSec = blackoutBeats * beatSec;
        }
        blackoutSec = Math.min(rawLen * 0.5, Math.max(0.05, targetSec));
      }
      const len = rawLen - blackoutSec;
      if (len <= 0.05) return;

      if (sec.type === 'intro') {
        // Intro: controlled 0.38–0.52 ceiling, deep RGB without W, stem-driven
        washClips.push(makeClip(`wash-intro-${idx}`, pickPreset('pulse', ['wash', 'wave']), rgbOnly(palette[0], 0.85), 'other', wings, start, len, 0.98, 1, { floor: 0.2, curve: 'breath' }, ceilKeys(len, 0.44, isPreDrop), null, 'beat'));
        synthClips.push(makeClip(`syn-intro-${idx}`, pickPreset('pulse', ['center', 'wave', 'wash']), rgbOnly(palette[1], 0.85), 'vocals', centerCol, start, len, 1.0, 1, { floor: 0.18, curve: 'swell' }, ceilKeys(len, 0.46, isPreDrop), null, 'bar'));
        // Final 1-2 bars of intro: transition sweeps driven by drums
        if (len >= barSec) {
          const swLen = Math.min(barSec, len / 2);
          const swStart = start + len - swLen;
          accentClips.push(makeClip(`acc-intro-sw1-${idx}`, pickPreset('sweep', ['chase', 'wave', 'pulse']), rgbOnly(palette[2], 0.9), 'drums', wings, swStart, swLen, 1.02, 1, null, ceilKeys(swLen, 0.48, isPreDrop), null, 'beat'));
          if (swLen >= 2 * beatSec) {
            accentClips.push(makeClip(`acc-intro-sw2-${idx}`, pickPreset('sweep', ['flash', 'chase', 'pulse']), rgbOnly(palette[2], 1.0), 'drums', centerCol, swStart + swLen - beatSec, beatSec, 1.05, 1, null, ceilKeys(beatSec, 0.52, isPreDrop), null, 'beat'));
          }
        }
      } else if (sec.type === 'build') {
        buildIdx++;
        // Build-up: ramp 0.45 -> 0.88, accelerating speed 1 -> 2 -> 4 -> 8 -> 16, cutting to pre-drop blackout
        const climaxLen = Math.min(len * 0.65, Math.max(4 * beatSec, 2 * barSec));
        const firstLen = len - climaxLen;
        if (firstLen > 0.5) {
          synthClips.push(makeClip(`syn-bld-bnc-${idx}`, pickPreset('bounce', ['pulse', 'chase', 'wave']), rgbOnly(palette[1], 0.95), 'other', crossNoCenter, start, firstLen, 1.1, 1, { physics: 'elastic', axis: 'horiz' }, buildRampKeys(firstLen, 0.45, 0.64)));
          rhythmClips.push(makeClip(`rhy-bld-open-${idx}`, pickPreset('chase', ['columns', 'pulse', 'alternate']), rgbOnly(palette[0], 0.95), 'drums', wings, start, firstLen, 1.1, 1, null, buildRampKeys(firstLen, 0.45, 0.64), null, 'beat'));
        }

        const climaxStart = start + firstLen;
        // Dual column chase speed 16 on kick gate
        bassClips.push(makeClip(`bass-bld-chL-${idx}`, pickPreset('chase', ['columns', 'pulse', 'sweep']), rgbOnly(palette[2], 1.0), 'band', leftCol, climaxStart, climaxLen, 1.25, 16, null, buildRampKeys(climaxLen, 0.60, 0.88), kickGate, '4bar'));
        rhythmClips.push(makeClip(`rhy-bld-chR-${idx}`, pickPreset('chase', ['columns', 'pulse', 'sweep']), rgbOnly(palette[2], 1.0), 'band', rightCol, climaxStart, climaxLen, 1.25, 16, null, buildRampKeys(climaxLen, 0.60, 0.88), kickGate, '4bar'));
        // Snare gate flash on all
        accentClips.push(makeClip(`acc-bld-fl-${idx}`, pickPreset('flash', ['strobe', 'pulse']), rgbOnly(palette[3], 1.0), 'band', 'all', climaxStart, climaxLen, 1.3, 0.5, null, buildRampKeys(climaxLen, 0.55, 0.88), snareGate, 'beat'));

        // Accelerating spiral (2 -> 4 -> 8 -> 16) on perimeter in the final 2-4 bars
        const spiralPhase = Math.min(climaxLen, 4 * barSec);
        const spStart = climaxStart + climaxLen - spiralPhase;
        const barChunk = Math.max(0.05, spiralPhase / 4);
        const spPreset = pickPreset('spiral', ['chase', 'sweep', 'pulse']);
        washClips.push(makeClip(`wash-bld-sp1-${idx}`, spPreset, rgbOnly(palette[2], 0.95), 'band', perimeter, spStart, barChunk, 1.1, 2, null, buildRampKeys(barChunk, 0.52, 0.62), vocalFollow));
        washClips.push(makeClip(`wash-bld-sp2-${idx}`, spPreset, rgbOnly(palette[2], 0.98), 'band', perimeter, spStart + barChunk, barChunk, 1.15, 4, null, buildRampKeys(barChunk, 0.62, 0.72), vocalFollow));
        washClips.push(makeClip(`wash-bld-sp3-${idx}`, spPreset, rgbOnly(palette[2], 1.0), 'band', perimeter, spStart + 2 * barChunk, barChunk, 1.2, 8, null, buildRampKeys(barChunk, 0.72, 0.80), vocalFollow));
        washClips.push(makeClip(`wash-bld-sp4-${idx}`, spPreset, rgbOnly(palette[2], 1.0), 'band', perimeter, spStart + 3 * barChunk, barChunk, 1.25, 16, null, buildRampKeys(barChunk, 0.80, 0.88), vocalFollow));
      } else if (sec.type === 'drop') {
        dropIdx++;
        const dropMod = dropIdx % 3;

        // 1. Core Kick Rhythm: full rig or perimeter kick-gated punch at max brightness
        if (dropMod === 1) {
          rhythmClips.push(makeClip(`rhy-drop-kick-${idx}`, pickPreset('pulse', ['alternate', 'columns', 'flash']), dropColor(palette[0], 0.42), 'band', 'all', start, len, 1.45, 1, { floor: 0.25, curve: 'punch' }, dropKeys(len), kickGate, 'beat'));
        } else {
          const chunkSec = 2 * beatSec;
          let cCount = 0;
          for (let t = start; t < start + len; t += chunkSec) {
            const cLen = Math.min(chunkSec, start + len - t);
            if (cLen > 0.05) {
              const isEven = (cCount % 2 === 0);
              const preset = isEven
                ? pickPreset('alternate', ['columns', 'pulse', 'chase'])
                : pickPreset('columns', ['pulse', 'alternate', 'chase']);
              const targets = isEven ? perimeter : 'all';
              const col = isEven ? dropColor(palette[1], 0.42) : dropColor(palette[0], 0.40);
              rhythmClips.push(makeClip(`rhy-drop-alt-${idx}-${cCount}`, preset, col, 'band', targets, t, cLen, 1.42, 2, null, dropKeys(cLen), kickGate, 'beat'));
              cCount++;
            }
          }
        }

        // 2. Bas layer: heavy sub-bass punch on bottomRow ['L3', 'C3', 'R3']
        bassClips.push(makeClip(`bass-drop-${idx}`, pickPreset('pulse', ['fire', 'wash', 'columns']), dropColor(palette[1], 0.45), 'bass', bottomRow, start, len, 1.45, 1, { floor: 0.2, curve: 'punch' }, dropKeys(len)));

        // 3. Wings high-speed stem-driven motion ['L1','R1','L2','R2','L3','R3']
        if (len > 32) {
          const mid = start + Math.round(len / 2);
          synthClips.push(makeClip(`syn-drop-rn1-${idx}`, pickPreset('chase', ['rain', 'sweep', 'wave', 'pulse']), dropColor(palette[2], 0.38), 'other', wings, start, mid - start, 1.30, 4, null, dropKeys(mid - start)));
          synthClips.push(makeClip(`syn-drop-sw2-${idx}`, pickPreset('sweep', ['chase', 'wave', 'rain', 'pulse']), dropColor(palette[0], 0.38), 'drums', wings, mid, start + len - mid, 1.30, 4, null, dropKeys(start + len - mid)));
        } else {
          synthClips.push(makeClip(`syn-drop-rn-${idx}`, pickPreset('chase', ['rain', 'sweep', 'wave', 'pulse']), dropColor(palette[2], 0.38), 'other', wings, start, len, 1.30, 4, null, dropKeys(len)));
        }

        // 4. Center Cross: ripple / bounce / spiral driven by drums
        washClips.push(makeClip(`wash-drop-rip-${idx}`, pickPreset('ripple', ['bounce', 'spiral', 'pulse', 'wash']), dropColor(palette[1], 0.40), 'drums', cross, start, len, 1.35, 2, { width: 'wide' }, dropKeys(len)));

        // 5. Accents: instant beat-1 blinder + strobe on upperCross (never C3) + corner snare flashes
        const hitLen = Math.min(0.06, beatSec * 0.25);
        accentClips.push(makeClip(`acc-drop-hit-${idx}`, pickPreset('flash', ['strobe', 'pulse']), whiteBlinder, 'drums', 'all', start, hitLen, 1.50, 1, { decay: 'instant', focus: 'all' }, dropKeys(hitLen)));

        const strobeLen = Math.min(6.32, Math.max(0.8, len / 2));
        accentClips.push(makeClip(`acc-drop-str-${idx}`, pickPreset('strobe', ['flash', 'pulse']), whiteBlinder, 'drums', upperCross, start, strobeLen, 1.45, 1, { duty: 'sharp', rate: '1/4' }, dropKeys(strobeLen)));
        if (len > strobeLen + 0.5) {
          accentClips.push(makeClip(`acc-drop-fl-${idx}`, pickPreset('flash', ['strobe', 'pulse']), whiteBlinder, 'band', corners, start + strobeLen, len - strobeLen, 1.45, 1, { decay: 'fast', focus: 'all' }, dropKeys(len - strobeLen), snareGate));
        }
      } else if (sec.type === 'breakdown') {
        // Breakdown: controlled 0.35–0.50 ceiling, intimate center spine vocal pulse + soft wing movement
        synthClips.push(makeClip(`syn-brk-vox-${idx}`, pickPreset('pulse', ['center', 'wave', 'wash']), rgbOnly(palette[2], 0.88), 'vocals', centerCol, start, len, 1.05, 1, { floor: 0.2, curve: 'breath' }, ceilKeys(len, 0.46, isPreDrop), null, 'bar'));

        // 1-bar cycling textures on wings driven by 'other'
        const fxCycle = ['wave', 'rain', 'sparkle', 'sweep'];
        let cycleIdx = 0;
        for (let t = start; t < start + len; t += barSec) {
          const bLen = Math.min(barSec, start + len - t);
          if (bLen <= 0.05) continue;
          const rawFx = fxCycle[cycleIdx % fxCycle.length];
          const fx = pickPreset(rawFx, ['wave', 'wash', 'pulse', 'sweep']);
          const isEnd = (t + bLen >= start + len - 1e-4);
          washClips.push(makeClip(`wash-brk-${rawFx}-${idx}-${cycleIdx}`, fx, rgbOnly(palette[0], 0.85), 'other', wings, t, bLen, 0.98, 1, null, ceilKeys(bLen, 0.40, isPreDrop && isEnd)));
          cycleIdx++;
        }
        // 2-beat chunks of alternate on perimeter driven by 'drums'
        const chunkSec = 2 * beatSec;
        let cCount = 0;
        for (let t = start; t < start + len; t += chunkSec * 2) {
          const cLen = Math.min(chunkSec, start + len - t);
          if (cLen > 0.05) {
            const isEnd = (t + cLen >= start + len - 1e-4);
            rhythmClips.push(makeClip(`rhy-brk-alt-${idx}-${cCount}`, pickPreset('alternate', ['pulse', 'columns', 'chase']), rgbOnly(palette[3], 0.82), 'drums', perimeter, t, cLen, 0.98, 1, null, ceilKeys(cLen, 0.38, isPreDrop && isEnd)));
            cCount++;
          }
        }
      } else if (sec.type === 'outro') {
        const outroKeys = (l) => sanitizeKeyframes([
          { timeSec: 0, value: 0.50 },
          { timeSec: Math.max(0.01, l * 0.85), value: 0.22 },
          { timeSec: l, value: isPreDrop ? 0.22 : 0.15 }
        ], l);
        washClips.push(makeClip(`wash-out-${idx}`, pickPreset('wave', ['wash', 'pulse']), rgbOnly(palette[0], 0.85), 'other', wings, start, len, 0.95, 1, null, outroKeys(len)));
        synthClips.push(makeClip(`syn-out-${idx}`, pickPreset('rain', ['wave', 'wash', 'pulse']), rgbOnly(palette[2], 0.85), 'vocals', centerCol, start, len, 0.95, 1, null, outroKeys(len)));
      } else {
        // Verse: controlled 0.50–0.65 ceiling, deep RGB without W, stem-driven
        verseIdx++;
        const hasStrongBass = (analysis?.features?.bass || []).some(v => v > 0.25);
        washClips.push(makeClip(`wash-vrs-${idx}`, pickPreset('rain', ['wave', 'wash', 'chase', 'pulse']), rgbOnly(palette[0], 0.92), 'other', wings, start, len, 1.05, 2, null, ceilKeys(len, 0.56, isPreDrop)));
        if (hasStrongBass) {
          bassClips.push(makeClip(`bass-vrs-${idx}`, pickPreset('pulse', ['columns', 'wash']), rgbOnly(palette[1], 0.92), 'bass', bottomRow, start, len, 1.12, 1, { floor: 0.15, curve: 'punch' }, ceilKeys(len, 0.58, isPreDrop), null, 'beat'));
        }
        synthClips.push(makeClip(`syn-vrs-${idx}`, pickPreset('pulse', ['wave', 'center', 'wash']), rgbOnly(palette[2], 0.92), 'vocals', centerCol, start, len, 1.15, 1, { floor: 0.2, curve: 'breath' }, ceilKeys(len, 0.62, isPreDrop), null, 'half'));
        rhythmClips.push(makeClip(`rhy-vrs-${idx}`, pickPreset('bounce', ['chase', 'columns', 'alternate', 'pulse']), rgbOnly(palette[1], 0.92), 'drums', crossNoCenter, start, len, 1.10, 2, { physics: 'elastic', axis: 'horiz' }, ceilKeys(len, 0.58, isPreDrop)));
        accentClips.push(makeClip(`acc-vrs-${idx}`, pickPreset('sparkle', ['flash', 'pulse', 'strobe']), rgbOnly(palette[2], 0.88), 'drums', corners, start, len, 1.08, 1, null, ceilKeys(len, 0.52, isPreDrop)));
      }
    });

    const timeline = {
      version: 1, durationSec, bpm, beatOffsetSec, blackout: options.blackout === true,
      layers: [
        { id: 'base-wash', name: 'Atmosfera i baza', color: '#3aa0ff', enabled: true, blend: 'screen', opacity: .72, clips: washClips },
        { id: 'bass', name: 'Sub i bas', color: '#b25cff', enabled: true, blend: 'add', opacity: .82, clips: bassClips },
        { id: 'synth', name: 'Sint i vokal', color: '#00d2ff', enabled: true, blend: 'screen', opacity: .72, clips: synthClips },
        { id: 'motion', name: 'Ritam i kretanje', color: '#ffb23a', enabled: true, blend: 'add', opacity: .82, clips: rhythmClips },
        { id: 'drums', name: 'Akcenti i stroboskop', color: '#ff5c8a', enabled: true, blend: 'add', opacity: .88, clips: accentClips }
      ]
    };
    const check = validateTimeline(timeline);
    if (!check.valid) throw new TypeError(`Auto show generation failed: ${check.errors.join('; ')}`);
    return timeline;
  }

  // Fallback for short tracks or synthetic audio
  const phraseSec = 8 * 60 / bpm;
  const chaseClips = [];
  for (let target = beatOffsetSec; target < durationSec; target += phraseSec * 2) {
    const start = snapTimeToBeat(Math.max(0, target), bpm, beatOffsetSec, division, beats);
    if (start >= durationSec) break;
    const length = Math.min(phraseSec, durationSec - start);
    if (length > 0) chaseClips.push(makeClip(`chase-${chaseClips.length + 1}`, pickPreset('chase', ['sweep', 'pulse', 'alternate']), palette[2], 'drums', 'all', start, length, 1.15));
  }
  const timeline = {
    version: 1, durationSec, bpm, beatOffsetSec, blackout: options.blackout === true,
    layers: [
      { id: 'base-wash', enabled: true, blend: 'screen', opacity: .3 + energy * .22, clips: [makeClip('wash', pickPreset('wash', ['pulse', 'wave']), palette[0], 'other', 'all', 0, durationSec, 1.0)] },
      { id: 'bass', enabled: true, blend: 'add', opacity: .5 + energy * .22, clips: [makeClip('bass-columns', pickPreset('columns', ['pulse', 'wash']), palette[1], 'bass', 'all', 0, durationSec, 1.2)] },
      { id: 'motion', enabled: true, blend: 'screen', opacity: .35 + energy * .3, clips: chaseClips },
      { id: 'drums', enabled: true, blend: 'add', opacity: .3 + energy * .28, clips: [makeClip('drum-accents', pickPreset('flash', ['strobe', 'pulse']), palette[3], 'drums', ['C1', 'L2', 'C2', 'R2', 'C3'], 0, durationSec, 1.3)] }
    ]
  };
  const check = validateTimeline(timeline);
  if (!check.valid) throw new TypeError(`Auto show generation failed: ${check.errors.join('; ')}`);
  return timeline;
}

/** Replace clips within [section.startSec, section.endSec) across timeline layers
 * with newly generated clips for that section's type and selected theme/options.
 */
export function regenerateSectionClips(timeline, analysis, sectionIndex, options = {}) {
  if (!timeline || typeof timeline !== 'object' || !Array.isArray(timeline.layers)) {
    throw new TypeError('timeline must be a valid timeline object');
  }
  const durationSec = number(timeline.durationSec, number(analysis?.durationSec, 0));
  const rawSections = (Array.isArray(analysis?.sections) && analysis.sections.length)
    ? analysis.sections
    : detectSections(analysis);

  let idx = -1;
  if (typeof sectionIndex === 'number' && Number.isInteger(sectionIndex)) {
    idx = sectionIndex;
  } else if (typeof sectionIndex === 'string') {
    idx = rawSections.findIndex(s => s.id === sectionIndex);
  } else if (sectionIndex && typeof sectionIndex === 'object') {
    idx = rawSections.findIndex(s => s === sectionIndex || (s.id && s.id === sectionIndex.id) || (Math.abs((s.startSec ?? -1) - (sectionIndex.startSec ?? -2)) < 1e-3));
  }
  if (idx < 0 || idx >= rawSections.length) {
    throw new RangeError(`Invalid sectionIndex: ${sectionIndex}`);
  }

  const effectiveSections = rawSections.map((sec, i) => {
    if (i !== idx) return { ...sec };
    const overrideType = options.sectionType || options.type || sec.type;
    return { ...sec, type: overrideType };
  });

  const targetSec = effectiveSections[idx];
  const secStart = Math.max(0, number(targetSec.startSec, 0));
  const secDur = Math.max(0.1, number(targetSec.durationSec, number(targetSec.endSec, durationSec) - secStart));
  const secEnd = Math.min(durationSec, Number.isFinite(targetSec.endSec) ? targetSec.endSec : (secStart + secDur));

  const effectiveAnalysis = {
    ...(analysis || {}),
    durationSec: Math.max(20, durationSec),
    bpm: number(analysis?.bpm, number(timeline.bpm, 120)),
    beatOffsetSec: number(analysis?.beatOffsetSec, number(timeline.beatOffsetSec, 0)),
    sections: effectiveSections.length >= 2 ? effectiveSections : [
      targetSec,
      { id: 'sec-pad', type: 'outro', startSec: secEnd, durationSec: Math.max(0.5, Math.max(20, durationSec) - secEnd) }
    ]
  };

  const generated = createAutoShow(effectiveAnalysis, options);

  for (const genLayer of generated.layers) {
    let targetLayer = timeline.layers.find(l => l.id === genLayer.id);
    if (!targetLayer) {
      targetLayer = { ...genLayer, clips: [] };
      timeline.layers.push(targetLayer);
    }

    // Remove or trim existing clips that overlap [secStart, secEnd)
    const keptClips = [];
    for (const c of targetLayer.clips) {
      const cStart = c.startSec;
      const cEnd = c.startSec + c.durationSec;
      if (cStart >= secStart - 1e-4 && cStart < secEnd - 1e-4) {
        continue;
      }
      if (cStart < secStart - 1e-4 && cEnd > secStart + 1e-4) {
        const newDur = Math.max(0.05, secStart - cStart);
        const trimmedKeys = (c.keyframes || [{ timeSec: 0, value: 1 }])
          .map(k => ({ ...k, timeSec: clamp(k.timeSec, 0, newDur) }))
          .filter((k, ki, arr) => ki === 0 || k.timeSec > arr[ki - 1].timeSec + 1e-6);
        keptClips.push({ ...c, durationSec: newDur, keyframes: trimmedKeys.length ? trimmedKeys : [{ timeSec: 0, value: 1 }] });
        continue;
      }
      keptClips.push(c);
    }

    const usedIds = new Set(keptClips.map(c => c.id));
    const sectionNewClips = genLayer.clips
      .filter(c => c.startSec >= secStart - 1e-4 && c.startSec < secEnd - 1e-4 && c.startSec < durationSec)
      .map(c => {
        let clipId = c.id;
        let suffix = 1;
        while (usedIds.has(clipId)) {
          clipId = `${c.id}-r${suffix++}`;
        }
        usedIds.add(clipId);
        const clampedDur = Math.min(c.durationSec, Math.max(0.05, durationSec - c.startSec));
        return {
          ...c,
          id: clipId,
          durationSec: clampedDur,
          keyframes: c.keyframes.map(k => ({ ...k, timeSec: clamp(k.timeSec, 0, clampedDur) }))
        };
      });

    targetLayer.clips = [...keptClips, ...sectionNewClips].sort((a, b) => a.startSec - b.startSec);
  }

  return timeline;
}
