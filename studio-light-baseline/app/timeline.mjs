/** Editable song timeline. All times are song seconds, colors are normalized RGBW,
 * and output channels are bytes limited to 153. The limit is visual, not electrical.
 * This module is pure: one saved timeline and one analysis produce the same frame
 * for a given song time, regardless of playback or scrub order.
 */
import { BAR_IDS, PIXELS_PER_BAR } from './engine.mjs';
import { SPECTRUM_MAX_HZ, SPECTRUM_MIN_HZ, rangeLevel } from './audio-spectrum.mjs';
import { detectSections } from './audio-sections.mjs';

export const TIMELINE_PRESETS = Object.freeze([
  'wash', 'pulse', 'columns', 'chase', 'flash', 'wave',
  'strobe', 'sparkle', 'spiral', 'ripple', 'rain', 'bounce', 'fire', 'alternate', 'center', 'sweep'
]);
export const TIMELINE_BLENDS = Object.freeze(['add', 'screen', 'multiply', 'max', 'replace']);
const DRIVERS = ['none', 'drums', 'bass', 'vocals', 'other', 'band'];

/** Frequency-band driver (like an audio-reactive EQ): the clip is driven by the
 * peak level inside [lowHz, highHz]. Level below `threshold` gives 0, level at
 * `ceiling` gives 1. mode 'gate' snaps to 1 above the threshold (a trigger).
 * `releaseSec` is how long the driver takes to fall back after a peak.
 */
export const DEFAULT_BAND = Object.freeze({ lowHz: 40, highHz: 120, threshold: 0.5, ceiling: 1, mode: 'follow', releaseSec: 0.12 });
export const BAND_PRESETS = Object.freeze([
  ['Kick', { lowHz: 40, highHz: 110, threshold: 0.6, ceiling: 1, mode: 'gate', releaseSec: 0.14 }],
  ['Bas', { lowHz: 30, highHz: 180, threshold: 0.4, ceiling: 0.95, mode: 'follow', releaseSec: 0.2 }],
  ['Snare', { lowHz: 160, highHz: 400, threshold: 0.6, ceiling: 1, mode: 'gate', releaseSec: 0.12 }],
  ['Vokal', { lowHz: 300, highHz: 3000, threshold: 0.45, ceiling: 1, mode: 'follow', releaseSec: 0.15 }],
  ['Hi-hat', { lowHz: 6000, highHz: 16000, threshold: 0.5, ceiling: 1, mode: 'gate', releaseSec: 0.06 }],
  ['Sve', { lowHz: 25, highHz: 18000, threshold: 0.4, ceiling: 1, mode: 'follow', releaseSec: 0.1 }]
]);

export function bandErrors(band, path) {
  if (!band || typeof band !== 'object') return [`${path} must be an object`];
  const errors = [];
  const ok = (v, lo, hi) => Number.isFinite(v) && v >= lo && v <= hi;
  if (!ok(band.lowHz, SPECTRUM_MIN_HZ, SPECTRUM_MAX_HZ) || !ok(band.highHz, SPECTRUM_MIN_HZ, SPECTRUM_MAX_HZ) || !(band.lowHz < band.highHz)) errors.push(`${path} needs lowHz < highHz within ${SPECTRUM_MIN_HZ}–${SPECTRUM_MAX_HZ}`);
  if (!ok(band.threshold, 0, 1) || !ok(band.ceiling, 0, 1) || band.ceiling <= band.threshold) errors.push(`${path} needs 0 ≤ threshold < ceiling ≤ 1`);
  if (!['follow', 'gate'].includes(band.mode)) errors.push(`${path}.mode must be follow or gate`);
  if (!ok(band.releaseSec, 0, 2)) errors.push(`${path}.releaseSec must be 0–2`);
  return errors;
}

/** Driver level 0–1 of a band at one song time (stateless, so scrubbing is exact). */
export function bandLevel(analysis, band, timeSec) {
  const sp = analysis?.spectrum;
  if (!sp || !band) return 0;
  const hop = sp.hopSec, position = (timeSec - sp.startSec) / hop, base = Math.floor(position), frac = position - base;
  const span = Math.max(1e-6, band.ceiling - band.threshold);
  const mapped = frame => {
    const x = rangeLevel(sp, frame, band.lowHz, band.highHz);
    return band.mode === 'gate' ? (x >= band.threshold ? 1 : 0) : clamp((x - band.threshold) / span);
  };
  const current = mapped(base) * (1 - frac) + mapped(base + 1) * frac;
  if (!(band.releaseSec > 0)) return clamp(current);
  let best = current;
  const taps = Math.min(40, Math.ceil(3 * band.releaseSec / hop));
  for (let k = 0; k <= taps; k++) best = Math.max(best, mapped(base - k) * Math.exp(-(k + frac) * hop / band.releaseSec));
  return clamp(best);
}

/** 0–1 level of whichever driver the clip uses, without gain; 1 for no driver. */
export function driverLevel(analysis, clip, timeSec) {
  if (clip.driver === 'none') return 1;
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
  const samples = features?.[driver] ?? analysis?.envelopes?.[driver] ?? analysis?.[driver];
  if (!(Array.isArray(samples) || ArrayBuffer.isView(samples)) || !samples.length) return 0;
  const hop = number(features?.hopSec, number(analysis?.hopSec, 0));
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
        let activeRows = [...new Set(activeBars.map(barRow))].sort((a, b) => a - b);
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

      // Support direction and motionMode, backward compatible with legacy chaseMode
      let dir = clip?.direction || (clip?.chaseMode === 'col' ? 'ttb' : 'ltr');
      let motion = clip?.motionMode || (clip?.chaseMode === 'syncRow' ? 'sync' : 'serial');

      let position = 0;
      let pathLen = 0;

      const barCol = id => (id[0] === 'L' ? 0 : (id[0] === 'C' ? 1 : 2));
      const barRow = id => (id[1] === '1' ? 0 : (id[1] === '2' ? 1 : 2));

      const targetList = (!clip || clip.targets === 'all') ? [...BAR_IDS] : BAR_IDS.filter(id => clip.targets.includes(id));
      const hasLeft = targetList.some(id => id.startsWith('L'));
      const hasRight = targetList.some(id => id.startsWith('R'));
      const hasCenter = targetList.some(id => id.startsWith('C'));
      const hasMultipleRows = new Set(targetList.map(id => id[1])).size > 1;
      const isDualFlank = hasLeft && hasRight && !hasCenter && hasMultipleRows;

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

        pathLen = sideBars.length * PIXELS_PER_BAR;
        const px = isRev ? (PIXELS_PER_BAR - 1 - pixel) : pixel;
        position = idx * PIXELS_PER_BAR + px;
      } else if (motion === 'sync') {
        if (dir === 'ttb') {
          let activeRows = [...new Set(activeBars.map(barRow))].sort((a, b) => a - b);
          if (!activeRows.length) activeRows = [0, 1, 2];
          const rowIdx = activeRows.indexOf(row);
          if (rowIdx === -1) return 0;
          pathLen = activeRows.length * PIXELS_PER_BAR;
          position = rowIdx * PIXELS_PER_BAR + pixel;
        } else if (dir === 'btt') {
          let activeRows = [...new Set(activeBars.map(barRow))].sort((a, b) => b - a);
          if (!activeRows.length) activeRows = [2, 1, 0];
          const rowIdx = activeRows.indexOf(row);
          if (rowIdx === -1) return 0;
          pathLen = activeRows.length * PIXELS_PER_BAR;
          position = rowIdx * PIXELS_PER_BAR + ((PIXELS_PER_BAR - 1) - pixel);
        } else if (dir === 'rtl') {
          let activeCols = [...new Set(activeBars.map(barCol))].sort((a, b) => b - a);
          if (!activeCols.length) activeCols = [2, 1, 0];
          const colIdx = activeCols.indexOf(col);
          if (colIdx === -1) return 0;
          pathLen = activeCols.length * PIXELS_PER_BAR;
          position = colIdx * PIXELS_PER_BAR + ((PIXELS_PER_BAR - 1) - pixel);
        } else { // 'ltr'
          let activeCols = [...new Set(activeBars.map(barCol))].sort((a, b) => a - b);
          if (!activeCols.length) activeCols = [0, 1, 2];
          const colIdx = activeCols.indexOf(col);
          if (colIdx === -1) return 0;
          pathLen = activeCols.length * PIXELS_PER_BAR;
          position = colIdx * PIXELS_PER_BAR + pixel;
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

        const pathBars = ORDER.filter(id => activeBars.includes(id));
        const idx = pathBars.indexOf(targetId);
        if (idx === -1) return 0;

        pathLen = pathBars.length * PIXELS_PER_BAR;
        const px = revPixel ? (PIXELS_PER_BAR - 1 - pixel) : pixel;
        position = idx * PIXELS_PER_BAR + px;
      }

      if (pathLen <= 0) return 0;

      // Sweep rate: one full loop of active path in stepSec
      const head = ((localTime / stepSec) * pathLen) % pathLen;
      let d = head - position;
      if (d < -pathLen / 2) d += pathLen;
      if (d > pathLen / 2) d -= pathLen;

      // Beam profile: needle (1.0), razor (2.2), beam (4.2), comet (7.5)
      let tail;
      if (p.beam === 'needle') tail = 1.0;
      else if (p.beam === 'razor') tail = 2.2;
      else if (p.beam === 'beam') tail = 4.2;
      else if (p.beam === 'comet') tail = 7.5;
      else tail = speed >= 8 ? 2.0 : (speed >= 4 ? 2.8 : (speed >= 2 ? 3.8 : 5.0));

      const glow = Number.isFinite(p.glow) ? p.glow : 0;
      if (d < -0.8 || d > tail * 2.8) return glow * 0.15;

      const dist = d < 0 ? Math.abs(d) * 1.8 : d;
      return clamp(glow * 0.15 + (1 - glow * 0.15) * Math.exp(-dist / tail));
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

      let spatialPos = (col + row * 0.65 + y);
      if (angle === 'horiz') spatialPos = col * 1.3 + y * 0.15;
      else if (angle === 'vert') spatialPos = row + y;

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
      const rate = p.rate || '1/4';
      const duty = p.duty || 'normal';
      const pat = p.pattern || 'all';

      let div = 4;
      if (rate === '1/2') div = 2;
      else if (rate === '1/8') div = 8;
      else if (rate === '1/16') div = 16;
      else if (rate === '1/32') div = 32;
      else if (rate === 'chaos') div = 11.3;

      const dutyCut = duty === 'sharp' ? 0.16 : (duty === 'wide' ? 0.55 : 0.35);
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
      const dir = p.direction || 'cw';
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
      const dir = p.direction || 'out';
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
      const streak = p.streak || 'streak';
      const spread = p.spread || 'random';
      const colShift = spread === 'sync' ? 0 : (col * 0.28);
      const vert = row + y;
      const phase = ((localTime / (beatSec * 1.5) - vert * 0.35 + colShift) % 1 + 1) % 1;
      const dropPower = streak === 'drops' ? 9.0 : (streak === 'beam' ? 2.5 : 5.0);
      return Math.exp(-phase * dropPower);
    }
    case 'bounce': {
      const axis = p.axis || 'horiz';
      const curve = p.curve || 'pendulum';
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
export function renderTimelineFrame(timeline, analysis, timeSec, baseFrame = null) {
  const check = validateTimeline(timeline);
  if (!check.valid) throw new TypeError(`Invalid timeline: ${check.errors.join('; ')}`);
  if (!Number.isFinite(timeSec)) throw new TypeError('timeSec must be finite');
  const out = zeroBars();
  if (timeline.blackout || baseFrame?.blackout) return { bars: out };
  const input = baseFrame?.bars ?? baseFrame;
  for (const id of BAR_IDS) for (let p = 0; p < PIXELS_PER_BAR; p++) for (let c = 0; c < 4; c++) out[id][p][c] = clamp(number(input?.[id]?.[p]?.[c]), 0, 153) / 153;
  const beatSec = 60 / timeline.bpm;
  for (const layer of timeline.layers) {
    if (!layer.enabled || layer.opacity === 0) continue;
    for (const clip of layer.clips) {
      const localTime = timeSec - clip.startSec;
      if (localTime < 0 || localTime >= clip.durationSec) continue;
      const strength = clamp(layer.opacity * envelope(clip, localTime) * (clip.driver === 'none' ? 1 : driverLevel(analysis, clip, Number.isFinite(clip.driverTimeSec) ? clip.driverTimeSec : timeSec) * clip.driverGain));
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
  for (const id of BAR_IDS) for (const pixel of out[id]) for (let c = 0; c < 4; c++) pixel[c] = Math.round(clamp(pixel[c]) * 153);
  return { bars: out };
}

/** Build an editable energetic first pass; uses structural track sections when
 * available to produce dynamic, section-tailored lighting arrangements.
 */
export function createAutoShow(analysis, options = {}) {
  const durationSec = number(analysis?.durationSec, number(analysis?.duration, 0));
  if (durationSec <= 0) throw new RangeError('analysis.durationSec must be positive');
  const bpm = clamp(number(analysis?.bpm, 120), 40, 240);
  const beats = analysis?.beatsSec ?? analysis?.beats ?? [];
  const beatOffsetSec = number(analysis?.beatOffsetSec, typeof beats?.[0] === 'number' ? beats[0] : number(beats?.[0]?.timeSec, 0));
  const energy = clamp(number(options.energy, .8));
  const division = options.snapSubdivision ?? 1;
  const palette = {
    club: [[.03, .02, .42, 0], [.62, .01, .46, 0], [.02, .62, .85, 0], [0, 0, 0, .48]],
    ember: [[.45, .02, 0, 0], [.9, .18, .01, 0], [.95, .04, .12, 0], [0, 0, 0, .35]],
    ice: [[0, .18, .55, 0], [0, .52, .8, 0], [.15, .3, .9, 0], [0, 0, 0, .5]]
  }[options.palette ?? 'club'];
  if (!palette) throw new RangeError('unknown palette');

  const makeClip = (id, preset, color, driver = 'none', targets = 'all', startSec = 0, length = durationSec, gain = 1, speed = 1) => ({
    id, startSec, durationSec: length, preset, targets, color, driver, driverGain: gain, speed,
    keyframes: [{ timeSec: 0, value: 0 }, { timeSec: Math.min(.4, length / 3), value: 1 }, { timeSec: length - Math.min(.4, length / 3), value: 1 }, { timeSec: length, value: 0 }]
  });

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

    const whiteBlinder = [0.1, 0.15, 0.25, 0.95];
    const perimeter = ['L1', 'C1', 'R1', 'R2', 'R3', 'C3', 'L3', 'L2'];
    const cross = ['C1', 'L2', 'C2', 'R2', 'C3'];
    const corners = ['L1', 'R1', 'L3', 'R3'];
    const bottomRow = ['L3', 'C3', 'R3'];
    const centerCol = ['C1', 'C2', 'C3'];

    let dropIdx = 0;
    let buildIdx = 0;
    let verseIdx = 0;

    sections.forEach((sec, idx) => {
      const start = Math.max(0, sec.startSec);
      const len = Math.max(0.1, Math.min(sec.durationSec, durationSec - start));
      if (len <= 0.05) return;

      if (sec.type === 'intro') {
        washClips.push(makeClip(`wash-intro-${idx}`, 'wave', palette[0], 'none', 'all', start, len));
        synthClips.push(makeClip(`syn-intro-${idx}`, 'sparkle', [0.1, 0.3, 0.6, 0.08], 'none', perimeter, start, len));
        if (len >= 6) {
          const pStart = start + len / 2, pLen = len / 2;
          rhythmClips.push(makeClip(`rhy-intro-${idx}`, 'pulse', palette[1], 'drums', centerCol, pStart, pLen, 1.1));
        }
        if (len >= 2) {
          accentClips.push(makeClip(`acc-intro-${idx}`, 'flash', whiteBlinder, 'none', ['C2'], start + len - Math.min(1.6, len / 2), Math.min(1.6, len / 2), 1));
        }
      } else if (sec.type === 'build') {
        buildIdx++;
        washClips.push(makeClip(`wash-bld-${idx}`, 'rain', palette[0], 'none', 'all', start, len));
        synthClips.push(makeClip(`syn-bld-${idx}`, 'sweep', palette[2], 'none', 'all', start, len));
        rhythmClips.push(makeClip(`rhythm-bld-${idx}`, 'pulse', palette[1], 'drums', 'all', start, len, 1.3));
        accentClips.push(makeClip(`acc-bld-${idx}`, 'spiral', palette[2], 'none', perimeter, start, len));
        const preDropLen = Math.min(3.16, Math.max(0.8, len / 3));
        if (len > preDropLen + 0.5) {
          accentClips.push(makeClip(`acc-bld-strobe-${idx}`, 'strobe', whiteBlinder, 'drums', cross, start + len - preDropLen, preDropLen, 1.4));
        }
      } else if (sec.type === 'drop') {
        dropIdx++;
        const dropMod = dropIdx % 3;
        washClips.push(makeClip(`wash-drop-${idx}`, dropMod === 2 ? 'wave' : 'wash', palette[0], 'none', 'all', start, len));

        if (len > 32) {
          const mid = start + Math.round(len / 2);
          const len1 = mid - start;
          const len2 = start + len - mid;
          bassClips.push(makeClip(`bass-drop-p1-${idx}`, 'ripple', palette[1], 'bass', 'all', start, len1, 1.35));
          rhythmClips.push(makeClip(`rhy-drop-p1-${idx}`, 'alternate', palette[2], 'drums', 'all', start, len1, 1.35));
          synthClips.push(makeClip(`syn-drop-p1-${idx}`, 'bounce', palette[1], 'none', 'all', start, len1, 1.1));

          bassClips.push(makeClip(`bass-drop-p2-${idx}`, 'fire', palette[1], 'bass', [...bottomRow, 'C2'], mid, len2, 1.3));
          rhythmClips.push(makeClip(`rhy-drop-p2-${idx}`, 'spiral', palette[2], 'drums', perimeter, mid, len2, 1.3));
          synthClips.push(makeClip(`syn-drop-p2-${idx}`, 'columns', palette[0], 'none', 'all', mid, len2, 1.1));
        } else if (dropMod === 1) {
          bassClips.push(makeClip(`bass-drop-${idx}`, 'ripple', palette[1], 'bass', 'all', start, len, 1.35));
          rhythmClips.push(makeClip(`rhythm-drop-${idx}`, 'alternate', palette[1], 'drums', 'all', start, len, 1.4));
          synthClips.push(makeClip(`syn-drop-${idx}`, 'bounce', palette[2], 'vocals', 'all', start, len, 1.2));
        } else if (dropMod === 2) {
          bassClips.push(makeClip(`bass-drop-${idx}`, 'fire', palette[1], 'bass', [...bottomRow, 'C2'], start, len, 1.3));
          rhythmClips.push(makeClip(`rhythm-drop-${idx}`, 'spiral', palette[2], 'drums', perimeter, start, len, 1.3));
          synthClips.push(makeClip(`syn-drop-${idx}`, 'sweep', palette[0], 'none', 'all', start, len, 1.1));
        } else {
          bassClips.push(makeClip(`bass-drop-${idx}`, 'ripple', palette[2], 'bass', 'all', start, len, 1.4));
          rhythmClips.push(makeClip(`rhythm-drop-${idx}`, 'alternate', palette[1], 'drums', cross, start, len, 1.4));
          synthClips.push(makeClip(`syn-drop-${idx}`, 'center', palette[2], 'vocals', ['C2'], start, len, 1.3));
        }

        const strobeLen = Math.min(6.32, Math.max(0.8, len / 2));
        accentClips.push(makeClip(`acc-drop-str-${idx}`, 'strobe', whiteBlinder, 'drums', cross, start, strobeLen, 1.4));
        if (len > strobeLen + 4) {
          accentClips.push(makeClip(`acc-drop-fl-${idx}`, 'flash', palette[3], 'drums', corners, start + strobeLen, len - strobeLen, 1.2));
        }
      } else if (sec.type === 'breakdown') {
        washClips.push(makeClip(`wash-brk-${idx}`, 'sparkle', palette[3], 'none', 'all', start, len));
        synthClips.push(makeClip(`syn-brk-${idx}`, 'center', palette[2], 'vocals', ['C2'], start, len, 1.4));
        accentClips.push(makeClip(`acc-brk-${idx}`, 'wave', palette[0], 'none', corners, start, len, 1.0));
      } else if (sec.type === 'outro') {
        washClips.push(makeClip(`wash-out-${idx}`, 'wave', palette[0], 'none', 'all', start, len));
        synthClips.push(makeClip(`syn-out-${idx}`, 'rain', palette[2], 'none', centerCol, start, len));
      } else {
        verseIdx++;
        washClips.push(makeClip(`wash-vrs-${idx}`, verseIdx % 2 === 0 ? 'wave' : 'wash', palette[0], 'none', 'all', start, len));
        bassClips.push(makeClip(`bass-vrs-${idx}`, 'columns', palette[1], 'bass', 'all', start, len, 1.2));
        synthClips.push(makeClip(`syn-vrs-${idx}`, 'center', palette[2], 'vocals', ['C2'], start, len, 1.35));
        rhythmClips.push(makeClip(`rhythm-vrs-${idx}`, 'bounce', palette[1], 'drums', 'all', start, len, 1.1));
        accentClips.push(makeClip(`acc-vrs-${idx}`, 'sparkle', [0.1, 0.3, 0.8, 0.25], 'other', corners, start, len, 1.1));
      }
    });

    const timeline = {
      version: 1, durationSec, bpm, beatOffsetSec, blackout: options.blackout === true,
      layers: [
        { id: 'base-wash', name: 'Atmosfera', color: '#3aa0ff', enabled: true, blend: 'screen', opacity: .35 + energy * .2, clips: washClips },
        { id: 'bass', name: 'Sub i bas', color: '#b25cff', enabled: true, blend: 'add', opacity: .45 + energy * .25, clips: bassClips },
        { id: 'synth', name: 'Sint i vokal', color: '#00d2ff', enabled: true, blend: 'screen', opacity: .4 + energy * .25, clips: synthClips },
        { id: 'motion', name: 'Ritam i kretanje', color: '#ffb23a', enabled: true, blend: 'screen', opacity: .4 + energy * .3, clips: rhythmClips },
        { id: 'drums', name: 'Akcenti i stroboskop', color: '#ff5c8a', enabled: true, blend: 'add', opacity: .35 + energy * .3, clips: accentClips }
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
    if (length > 0) chaseClips.push(makeClip(`chase-${chaseClips.length + 1}`, 'chase', palette[2], 'none', 'all', start, length));
  }
  const timeline = {
    version: 1, durationSec, bpm, beatOffsetSec, blackout: options.blackout === true,
    layers: [
      { id: 'base-wash', enabled: true, blend: 'screen', opacity: .3 + energy * .22, clips: [makeClip('wash', 'wash', palette[0])] },
      { id: 'bass', enabled: true, blend: 'add', opacity: .5 + energy * .22, clips: [makeClip('bass-columns', 'columns', palette[1], 'bass', 'all', 0, durationSec, 1.2)] },
      { id: 'motion', enabled: true, blend: 'screen', opacity: .35 + energy * .3, clips: chaseClips },
      { id: 'drums', enabled: true, blend: 'add', opacity: .3 + energy * .28, clips: [makeClip('drum-accents', 'flash', palette[3], 'drums', ['C1', 'L2', 'C2', 'R2', 'C3'], 0, durationSec, 1.3)] }
    ]
  };
  const check = validateTimeline(timeline);
  if (!check.valid) throw new TypeError(`Auto show generation failed: ${check.errors.join('; ')}`);
  return timeline;
}
