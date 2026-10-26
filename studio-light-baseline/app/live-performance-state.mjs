/** Small, deterministic performance desk. Pad definitions are local preferences;
 * active gestures are ephemeral and never change the saved song arrangement. */
import { BAR_IDS } from './engine.mjs';
import { TIMELINE_PRESETS, renderTimelineFrame } from './timeline.mjs';

export const PAD_KEYS = Object.freeze(['q', 'w', 'e', 'r', 'a', 's', 'd', 'f', 'z', 'x', 'c', 'v']);
export const HOLD_THRESHOLD_SEC = .22;
/** Values map directly to the existing timeline renderer's effect parameters. */
export const LIVE_PARAM_OPTIONS = Object.freeze({
  wash: [['mood', 'Karakter', [['drift', 'Lebdeći'], ['breath', 'Disanje'], ['still', 'Mirno']]]],
  pulse: [['curve', 'Puls', [['punch', 'Udar'], ['breath', 'Disanje'], ['swell', 'Gradnja']]]],
  columns: [['mode', 'Broj osvijetljenih', [['single', 'Jedan'], ['double', 'Dva'], ['invert', 'Sve osim aktivnog']]], ['pathMode', 'Ugašeni barovi', [['skip', 'Preskoči'], ['keep', 'Broji kao tamni korak']]]],
  chase: [['beam', 'Oblik zrake', [['beam', 'Široka'], ['needle', 'Točka'], ['razor', 'Oštra'], ['comet', 'Komet']]], ['pathMode', 'Ugašeni barovi', [['skip', 'Preskoči'], ['keep', 'Prođi kroz tamne']]]],
  flash: [['focus', 'Žarište', [['center', 'Centar'], ['all', 'Svi'], ['edges', 'Rubovi']]], ['decay', 'Raspad', [['fast', 'Brzi'], ['instant', 'Trenutni'], ['slow', 'Spori']]]],
  wave: [['shape', 'Valni oblik', [['sine', 'Sinus'], ['triangle', 'Trokut'], ['saw', 'Pila']]], ['angle', 'Smjer vala', [['diag', 'Dijagonalno'], ['horiz', 'Vodoravno'], ['vert', 'Okomito']]], ['density', 'Gustoća valova', [['med', 'Srednja'], ['low', 'Rijetka'], ['high', 'Gusta']]]],
  strobe: [['rate', 'Učestalost', [['1/4', 'Standard'], ['1/2', 'Sporo'], ['1/8', 'Brzo'], ['1/16', 'Vrlo brzo']]], ['duty', 'Trajanje bljeska', [['sharp', 'Kratko'], ['normal', 'Srednje'], ['wide', 'Široko']]], ['pattern', 'Raspored', [['all', 'Svi'], ['checker', 'Šahovnica'], ['chaos', 'Razmaknuto']]]],
  sparkle: [['density', 'Gustoća', [['stars', 'Zvijezde'], ['firefly', 'Rijetko'], ['glitter', 'Gusto']]], ['glint', 'Sjaj', [['crisp', 'Oštar'], ['soft', 'Mekan']]]],
  spiral: [['direction', 'Rotacija', [['cw', 'Udesno'], ['ccw', 'Ulijevo']]], ['tail', 'Rep', [['med', 'Srednji'], ['point', 'Točka'], ['snake', 'Dugi']]], ['center', 'Središnji bar', [['pulse', 'Pulsira'], ['on', 'Stalno svijetli'], ['off', 'Ugašen']]], ['pathMode', 'Ugašeni barovi', [['keep', 'Broji kao tamne'], ['skip', 'Preskoči']]]],
  ripple: [['origin', 'Žarište', [['center', 'Centar'], ['top', 'Vrh'], ['bottom', 'Dno'], ['corners', 'Kutovi']]], ['direction', 'Smjer', [['out', 'Širenje'], ['in', 'Skupljanje']]], ['width', 'Širina vala', [['sharp', 'Oštra'], ['wide', 'Široka']]]],
  rain: [['streak', 'Kapi', [['streak', 'Tragovi'], ['drops', 'Kratke'], ['beam', 'Snopovi']]], ['spread', 'Raspored', [['random', 'Naizmjenično'], ['sync', 'Sinkronizirano']]]],
  bounce: [['axis', 'Os', [['horiz', 'Vodoravno'], ['vert', 'Okomito']]], ['curve', 'Gibanje', [['pendulum', 'Klatno'], ['elastic', 'Oštro']]]],
  fire: [['height', 'Visina', [['mid', 'Srednje'], ['low', 'Nisko'], ['full', 'Visoko']]], ['turbulence', 'Kretanje', [['normal', 'Vjetar'], ['calm', 'Mirno'], ['storm', 'Oluja']]]],
  alternate: [['pattern', 'Uzorak', [['checker', 'Šahovnica'], ['rows', 'Redovi'], ['cols', 'Stupci'], ['cross', 'Križ']]], ['transition', 'Prijelaz', [['cut', 'Rez'], ['fade', 'Pretapanje']]]],
  center: [['geometry', 'Oblik', [['cross', 'Križ'], ['solo', 'Samo C2'], ['iris', 'Prsten']]], ['breathe', 'Disanje', [['off', 'Mirno'], ['on', 'Pulsira']]]],
  sweep: [['style', 'Prelet', [['horiz', 'Vodoravno'], ['vert', 'Okomito'], ['radar', 'Radar']]], ['width', 'Širina', [['laser', 'Usko'], ['fan', 'Široko']]]]
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
  const active = new Map(), pending = new Map(), held = new Map();
  let quantize = false;
  let lastSongTime = null;
  const api = {
    pads, active, pending, held,
    get quantize() { return quantize; },
    setQuantize(value) { quantize = Boolean(value); },
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
      lastSongTime = playing ? songTime : null;
    },
    clear() { active.clear(); pending.clear(); held.clear(); },
    render(baseFrame, clockTime, bpm = 120, scale = 1, analysis = null, songTime = 0) {
      if (!active.size) return baseFrame;
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
      if (!layers.length) return baseFrame;
      return renderTimelineFrame({ version: 1, durationSec: 86400, bpm: clamp(bpm, 40, 240), beatOffsetSec: 0, blackout: false, layers }, analysis, clockTime, baseFrame);
    }
  };
  return api;
}
