/** Shared deterministic RGBW renderer. Times are monotonic seconds; pixels are bytes.
 * This is a visual/output limit, not an electrical current limiter.
 */
export const BAR_IDS = Object.freeze(['L1', 'C1', 'R1', 'L2', 'C2', 'R2', 'L3', 'C3', 'R3']);
export const PIXELS_PER_BAR = 12; // Provisional: verify strip IC grouping before installation.
// Runner follows each complete column, top to bottom, independent of wiring order.
export const RUNNER_PATH = Object.freeze(['L1', 'L2', 'L3', 'C1', 'C2', 'C3', 'R1', 'R2', 'R3']);
export const SCENES = Object.freeze({ ambient: 'Ambijent', pulse: 'Puls', columns: 'Stupci', rows: 'Redovi', runner: 'Trkač', mirror: 'Zrcalo', wave: 'Val', build: 'Gradnja' });
export const PALETTES = Object.freeze({
  midnight: { name: 'Ponoć', colors: [[.12, .18, 1, 0], [.62, .08, 1, 0], [0, .8, 1, 0]] },
  ember: { name: 'Žar', colors: [[1, .12, 0, 0], [1, .5, .03, 0], [.72, .03, .14, 0]] },
  ice: { name: 'Led', colors: [[0, .66, 1, 0], [.08, .22, 1, 0], [0, .18, .24, .65]] },
  magenta: { name: 'Magenta', colors: [[1, .02, .45, 0], [.5, .02, 1, 0], [1, .16, .08, 0]] },
  warm: { name: 'Topla bijela', colors: [[0, 0, 0, 1], [.3, .06, 0, .72], [.08, .02, 0, .9]] }
});
export const DEFAULT_STATE = Object.freeze({ scene: 'wave', palette: 'midnight', brightness: .35, speed: 1, energy: .6, audioLevel: 0, reactive: false, blackout: false, bpm: 120 });
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const fract = x => x - Math.floor(x);
const smoothstep = x => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
const median = values => { const sorted = [...values].sort((a, b) => a - b); const m = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2; };

/** Warm-white display / RGB transport approximation, identical in preview and bridge.
 * This is not calibrated colorimetry; WLED auto-white also needs bench verification.
 */
export function rgbwToRgb([r = 0, g = 0, b = 0, w = 0]) {
  return [r + w, g + .78 * w, b + .45 * w].map(v => Math.round(clamp(finite(v, 0), 0, 153)));
}

/** Phase-preserving manual clock. Tap resets phase to the operator's beat. */
export class BeatClock {
  constructor(bpm = 120) { this.bpm = clamp(finite(bpm, 120), 40, 240); this.anchorTime = 0; this.anchorBeat = 0; this.taps = []; }
  beats(nowSec) { return this.anchorBeat + (finite(nowSec, 0) - this.anchorTime) * this.bpm / 60; }
  setBpm(bpm, nowSec) { this.anchorBeat = this.beats(nowSec); this.anchorTime = nowSec; this.bpm = clamp(finite(bpm, this.bpm), 40, 240); return this.bpm; }
  tap(nowSec) {
    if (!Number.isFinite(nowSec)) return this.bpm;
    const beatAtTap = this.beats(nowSec);
    const last = this.taps.at(-1);
    if (last !== undefined && (nowSec - last > 2 || nowSec <= last)) this.taps = [];
    if (last !== undefined && nowSec - last < .2 && nowSec > last) return this.bpm;
    this.taps.push(nowSec); this.taps = this.taps.slice(-8);
    if (this.taps.length >= 2) {
      const intervals = this.taps.slice(1).map((t, i) => t - this.taps[i]);
      this.bpm = clamp(60 / median(intervals), 40, 240);
    }
    this.anchorTime = nowSec; this.anchorBeat = Math.round(beatAtTap);
    return this.bpm;
  }
  nudge(beats) { this.anchorBeat += finite(beats, 0); }
}

/** Estimates periodicity of already detected audio onsets, not song/downbeat metadata.
 * Irregular rhythms and half/double tempo need operator correction. Silence holds
 * the last estimate, then expires it; it never invents a tempo.
 */
export class OnsetTempoEstimator {
  constructor() { this.onsets = []; this.bpm = null; this.confidence = 0; }
  addOnset(nowSec, strength = 1) {
    if (!Number.isFinite(nowSec) || !Number.isFinite(strength) || strength < .15) return this.get(nowSec);
    const previous = this.onsets.at(-1);
    if (previous !== undefined && nowSec - previous < .2) return this.get(nowSec);
    if (previous !== undefined && nowSec - previous > 2.5) { this.onsets = []; this.bpm = null; this.confidence = 0; }
    this.onsets.push(nowSec); this.onsets = this.onsets.slice(-16);
    if (this.onsets.length >= 5) {
      const intervals = this.onsets.slice(1).map((t, i) => t - this.onsets[i]).filter(x => x >= .25 && x <= 1.5);
      if (intervals.length >= 4) {
        const center = median(intervals);
        const accepted = intervals.filter(x => Math.abs(x - center) < center * .18);
        const spread = accepted.length ? Math.sqrt(accepted.reduce((sum, x) => sum + (x - center) ** 2, 0) / accepted.length) / center : 1;
        this.confidence = clamp((accepted.length / intervals.length) * (1 - spread * 3) * Math.min(1, accepted.length / 8), 0, 1);
        if (this.confidence >= .4) this.bpm = clamp(60 / median(accepted), 40, 240);
      } else { this.confidence = 0; }
    }
    return this.get(nowSec);
  }
  get(nowSec) {
    const age = this.onsets.length ? Math.max(0, finite(nowSec, this.onsets.at(-1)) - this.onsets.at(-1)) : Infinity;
    if (age > 15) return { bpm: null, confidence: 0, status: 'waiting' };
    const status = this.bpm === null ? 'listening' : age > 2.5 ? 'hold' : this.confidence >= .7 ? 'tracking' : 'uncertain';
    return { bpm: this.bpm, confidence: this.confidence * (age > 2.5 ? Math.max(0, 1 - (age - 2.5) / 12.5) : 1), status };
  }
}

function sanitize(patch, previous) {
  return {
    scene: Object.hasOwn(SCENES, patch.scene) ? patch.scene : previous.scene,
    palette: Object.hasOwn(PALETTES, patch.palette) ? patch.palette : previous.palette,
    brightness: clamp(finite(patch.brightness, previous.brightness), 0, .6),
    speed: clamp(finite(patch.speed, previous.speed), .25, 4),
    energy: clamp(finite(patch.energy, previous.energy), 0, 1),
    audioLevel: clamp(finite(patch.audioLevel, previous.audioLevel), 0, 1),
    reactive: typeof patch.reactive === 'boolean' ? patch.reactive : previous.reactive,
    blackout: typeof patch.blackout === 'boolean' ? patch.blackout : previous.blackout,
    bpm: clamp(finite(patch.bpm, previous.bpm), 40, 240)
  };
}

function render(state, beat) {
  const phase = beat * state.speed;
  const colors = PALETTES[state.palette].colors;
  const level = state.reactive ? .2 + .8 * state.audioLevel : 1;
  const result = {};
  BAR_IDS.forEach((id, index) => {
    const row = Math.floor(index / 3), col = index % 3;
    result[id] = Array.from({ length: PIXELS_PER_BAR }, (_, p) => {
      const y = (p + .5) / PIXELS_PER_BAR;
      let intensity = .3, colorPosition = col / 2;
      switch (state.scene) {
        case 'ambient': intensity = .36 + .08 * Math.sin(phase * Math.PI / 8 + col); colorPosition = .4; break;
        case 'pulse': intensity = .12 + .88 * Math.exp(-fract(phase) * (3 + state.energy * 4)); colorPosition = row / 2; break;
        case 'columns': intensity = col === Math.floor(phase) % 3 ? .95 : .08; colorPosition = col / 2; break;
        case 'rows': intensity = row === Math.floor(phase) % 3 ? .95 : .08; colorPosition = row / 2; break;
        case 'runner': {
          const length = RUNNER_PATH.length * PIXELS_PER_BAR;
          const location = RUNNER_PATH.indexOf(id) * PIXELS_PER_BAR + p;
          const head = fract(phase / 4) * length;
          const distance = (head - location + length) % length;
          intensity = .05 + .95 * Math.exp(-distance / (5 + state.energy * 14)); colorPosition = fract(location / length + phase / 16); break;
        }
        case 'mirror': intensity = .15 + .85 * (.5 + .5 * Math.cos((Math.abs(col - 1) + y + row * .2) * Math.PI * 2 - phase * Math.PI)); colorPosition = Math.abs(col - 1); break;
        case 'wave': intensity = .12 + .88 * (.5 + .5 * Math.sin((col + row * .7 + y) * Math.PI - phase * Math.PI / 2)); colorPosition = fract((col + y + row * .3) / 3 + phase / 16); break;
        case 'build': intensity = .08 + .92 * clamp(fract(phase / 16) * 4 - row - (1 - y), 0, 1); colorPosition = fract(phase / 16); break;
      }
      const position = clamp(colorPosition, 0, 1) * (colors.length - 1), a = Math.floor(position), b = Math.min(a + 1, colors.length - 1), t = position - a;
      const gain = state.brightness * intensity * level;
      return colors[a].map((channel, c) => Math.round(clamp((channel * (1 - t) + colors[b][c] * t) * gain * 255, 0, 153)));
    });
  });
  return result;
}

export class LightingEngine {
  constructor({ state = {} } = {}) { this.state = sanitize(state, DEFAULT_STATE); this.clock = new BeatClock(this.state.bpm); this.transition = null; }
  setState(patch, nowSec = 0) {
    const next = sanitize(patch, this.state);
    if (Object.hasOwn(patch, 'bpm') && next.bpm !== this.clock.bpm) this.clock.setBpm(next.bpm, nowSec);
    next.bpm = this.clock.bpm;
    if (next.blackout || this.state.blackout || next.brightness === 0) this.transition = null;
    else if (next.scene !== this.state.scene || next.palette !== this.state.palette) this.transition = { from: this.frame(nowSec).bars, brightness: this.state.brightness, start: nowSec };
    this.state = next;
    return { ...this.state };
  }
  frame(nowSec = 0) {
    const beat = this.clock.beats(nowSec);
    const bars = this.state.blackout ? Object.fromEntries(BAR_IDS.map(id => [id, Array.from({ length: PIXELS_PER_BAR }, () => [0, 0, 0, 0])])) : render(this.state, beat);
    if (!this.state.blackout && this.transition) {
      const t = smoothstep((nowSec - this.transition.start) / .6);
      if (t >= 1) this.transition = null;
      else {
        // The master fader applies to both sides of a fade on every frame.
        // Snapshot bytes already contain the master gain active at capture time.
        const outgoingScale = this.transition.brightness > 0 ? this.state.brightness / this.transition.brightness : 0;
        const ceiling = Math.round(this.state.brightness * 255);
        BAR_IDS.forEach(id => bars[id].forEach((pixel, p) => pixel.forEach((channel, c) => {
          pixel[c] = Math.round(clamp(this.transition.from[id][p][c] * outgoingScale * (1 - t) + channel * t, 0, ceiling));
        })));
      }
    }
    return { bars, beatPhase: fract(beat), beatCount: Math.floor(beat), bpm: this.clock.bpm };
  }
}
