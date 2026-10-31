/** Pure editing model for the DAW-style studio. No DOM access: everything here is
 * unit tested with node --test. A timeline is the same JSON that timeline.mjs
 * renders; extra layer fields (name, color) and timeline.gridMode are ignored by
 * the renderer and validator, so the deterministic RGBW output is unchanged.
 */
import { BAR_IDS } from './engine.mjs';
import { validateTimeline, snapTimeToBeat, DEFAULT_BAND, sanitizeKeyframes } from './timeline.mjs';
import { SPECTRUM_MAX_HZ, SPECTRUM_MIN_HZ } from './audio-spectrum.mjs';

export const MIN_CLIP_SEC = 0.05;
export const LAYER_COLORS = Object.freeze(['#3aa0ff', '#b25cff', '#ff5c8a', '#ffb23a', '#3affb0', '#ff7a3a', '#9bff3a', '#3adfff']);
export const SNAP_MODES = Object.freeze({ none: 'Bez snapa', bar: 'Takt', 1: 'Beat', 2: '1/2 beata', 4: '1/4 beata', 8: '1/8 beata' });

const EPS = 1e-4;
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
let counter = 0;
export const uid = prefix => `${prefix}-${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;
export const refKey = ref => `${ref.layerId}/${ref.clipId}`;

/* ---------------------------------------------------------------- envelope */

export function easeValue(aValue, bValue, fraction, easeMode = 'linear') {
  let u = clamp(fraction, 0, 1);
  if (easeMode === 'smooth' || easeMode === 'both' || easeMode === 'ease') {
    u = u * u * (3 - 2 * u);
  } else if (easeMode === 'in') {
    u = u * u;
  } else if (easeMode === 'out') {
    u = 1 - (1 - u) * (1 - u);
  }
  return aValue + (bValue - aValue) * u;
}

export function envelopeAt(keys, t) {
  if (!Array.isArray(keys) || !keys.length) return 1;
  if (t <= keys[0].timeSec) return keys[0].value;
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i].timeSec) {
      const a = keys[i - 1], b = keys[i];
      const span = b.timeSec - a.timeSec;
      const fraction = span > 1e-9 ? (t - a.timeSec) / span : 1;
      const ease = a.ease || b.ease || 'linear';
      return easeValue(a.value, b.value, fraction, ease);
    }
  }
  return keys.at(-1).value;
}

/** Cut keyframes to [lo, hi] (clip-local seconds) and rebase to start at 0.
 * Boundary values are interpolated, so the visible envelope is unchanged.
 */
export function trimKeyframes(keys, lo, hi) {
  const len = Math.max(EPS, hi - lo);
  if (!Array.isArray(keys) || !keys.length) return [{ timeSec: 0, value: 1 }, { timeSec: len, value: 1 }];
  const out = [{ timeSec: 0, value: clamp(envelopeAt(keys, lo), 0, 1), ...(keys[0]?.ease ? { ease: keys[0].ease } : {}) }];
  for (const key of keys) {
    if (key.timeSec > lo + EPS && key.timeSec < hi - EPS) {
      const t = key.timeSec - lo;
      if (t > out.at(-1).timeSec + 1e-6 && t < len - 1e-6) {
        out.push({ timeSec: t, value: clamp(key.value, 0, 1), ...(key.ease ? { ease: key.ease } : {}) });
      }
    }
  }
  if (len > out.at(-1).timeSec + 1e-6) {
    out.push({ timeSec: len, value: clamp(envelopeAt(keys, hi), 0, 1), ...(keys.at(-1)?.ease ? { ease: keys.at(-1).ease } : {}) });
  } else {
    out[out.length - 1].timeSec = len;
  }
  return out;
}

/* ------------------------------------------------------------------- grid */

/** Uniform or analysis-derived beat grid. Analysis grid wins unless the user
 * took manual control (gridMode 'manual', set by editing the tempo).
 */
export function gridBeats(timeline, analysis) {
  const beats = analysis?.beatsSec;
  const usable = timeline?.gridMode !== 'manual' && Array.isArray(beats) && beats.length >= 2 && beats.every(Number.isFinite);
  return usable ? beats : [];
}

/** Fractional beat index of a time; beat 0 is the first beat of the grid. */
export function beatPosition(sec, timeline, analysis) {
  const beats = gridBeats(timeline, analysis);
  if (!beats.length) return (sec - timeline.beatOffsetSec) * timeline.bpm / 60;
  const n = beats.length;
  if (sec <= beats[0]) return (sec - beats[0]) / (beats[1] - beats[0]);
  if (sec >= beats[n - 1]) return n - 1 + (sec - beats[n - 1]) / (beats[n - 1] - beats[n - 2]);
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (beats[mid] <= sec) lo = mid; else hi = mid; }
  return lo + (sec - beats[lo]) / (beats[hi] - beats[lo]);
}

export function timeAtBeat(pos, timeline, analysis) {
  const beats = gridBeats(timeline, analysis);
  if (!beats.length) return timeline.beatOffsetSec + pos * 60 / timeline.bpm;
  const n = beats.length;
  if (pos <= 0) return beats[0] + pos * (beats[1] - beats[0]);
  if (pos >= n - 1) return beats[n - 1] + (pos - (n - 1)) * (beats[n - 1] - beats[n - 2]);
  const i = Math.floor(pos);
  return beats[i] + (pos - i) * (beats[i + 1] - beats[i]);
}

export function formatBBT(pos) {
  const bar = Math.floor(pos / 4) + 1, beat = ((Math.floor(pos) % 4) + 4) % 4 + 1;
  const ticks = Math.floor((pos - Math.floor(pos)) * 100);
  return `${bar}:${beat}:${String(ticks).padStart(2, '0')}`;
}

export function formatClock(sec) {
  const safe = Math.max(0, sec || 0), m = Math.floor(safe / 60), s = Math.floor(safe % 60), ms = Math.floor(safe % 1 * 1000);
  return `${m}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}

/** Snap a time to the grid. mode: 'none' | 'bar' | integer beat division. */
export function snapTime(sec, mode, timeline, analysis) {
  const t = Math.max(0, sec);
  if (mode === 'none' || mode === false || !timeline) return t;
  if (mode === 'bar') return Math.max(0, timeAtBeat(Math.round(beatPosition(t, timeline, analysis) / 4) * 4, timeline, analysis));
  return snapTimeToBeat(t, timeline.bpm, timeline.beatOffsetSec, Number(mode) || 1, gridBeats(timeline, analysis));
}

/** Seconds covered by one snap step at a time position (used for nudging). */
export function snapStepSec(mode, timeline, analysis, at = 0) {
  const pos = beatPosition(at, timeline, analysis);
  const beats = mode === 'bar' ? 4 : mode === 'none' ? 0.25 : 1 / (Number(mode) || 1);
  return Math.max(0.01, timeAtBeat(pos + beats, timeline, analysis) - timeAtBeat(pos, timeline, analysis));
}

/* ---------------------------------------------------------------- lookups */

export function findClip(timeline, ref) {
  const layerIndex = timeline.layers.findIndex(l => l.id === ref.layerId);
  if (layerIndex < 0) return null;
  const layer = timeline.layers[layerIndex], clipIndex = layer.clips.findIndex(c => c.id === ref.clipId);
  return clipIndex < 0 ? null : { layer, layerIndex, clip: layer.clips[clipIndex], clipIndex };
}
export const clipEnd = clip => clip.startSec + clip.durationSec;

export function allRefs(timeline) {
  return timeline.layers.flatMap(layer => layer.clips.map(clip => ({ layerId: layer.id, clipId: clip.id })));
}

/** Clips intersecting a time range and an inclusive layer-index range. */
export function clipsInRect(timeline, t0, t1, layer0, layer1) {
  const [a, b] = t0 <= t1 ? [t0, t1] : [t1, t0], [l0, l1] = layer0 <= layer1 ? [layer0, layer1] : [layer1, layer0];
  const refs = [];
  timeline.layers.forEach((layer, li) => {
    if (li < l0 || li > l1) return;
    for (const clip of layer.clips) if (clip.startSec < b && clipEnd(clip) > a) refs.push({ layerId: layer.id, clipId: clip.id });
  });
  return refs;
}

/* --------------------------------------------------------- timeline setup */

/** Strip transient recording flags and repair colliding keyframe timestamps without mutating layer metadata. */
export function sanitizeTimelineClips(timeline) {
  if (!timeline || typeof timeline !== 'object') return timeline;
  if (!Array.isArray(timeline.layers)) return timeline;
  for (const layer of timeline.layers) {
    if (!layer || typeof layer !== 'object' || !Array.isArray(layer.clips)) continue;
    for (const clip of layer.clips) {
      if (!clip || typeof clip !== 'object') continue;
      delete clip.recording;
      if (Number.isFinite(clip.durationSec) && clip.durationSec > 0 && Array.isArray(clip.keyframes) && clip.keyframes.length > 0) {
        let needsRepair = false;
        let allFinite = true;
        let prev = -Infinity;
        for (const k of clip.keyframes) {
          if (!k || typeof k !== 'object' || !Number.isFinite(k.timeSec) || !Number.isFinite(k.value)) {
            allFinite = false;
            break;
          }
          if (k.timeSec < 0 || k.timeSec > clip.durationSec || k.timeSec <= prev || k.value < 0 || k.value > 1) {
            needsRepair = true;
          }
          prev = k.timeSec;
        }
        if (allFinite && needsRepair) {
          clip.keyframes = sanitizeKeyframes(clip.keyframes, clip.durationSec);
        }
      }
    }
  }
  return timeline;
}

/** Ensure editor-only fields exist and keyframe invariants hold. Idempotent; returns the same object. */
export function normalizeTimeline(timeline) {
  if (!timeline || typeof timeline !== 'object') return timeline;
  if (!Array.isArray(timeline.layers)) timeline.layers = [];
  timeline.layers.forEach((layer, i) => {
    if (!layer || typeof layer !== 'object') return;
    layer.name ??= layer.id;
    layer.color ??= LAYER_COLORS[i % LAYER_COLORS.length];
  });
  return sanitizeTimelineClips(timeline);
}

/* ------------------------------------------------------------- layer ops */

export function addLayer(timeline, options = {}) {
  const layer = {
    id: uid('layer'), name: options.name ?? `Sloj ${timeline.layers.length + 1}`, color: options.color ?? LAYER_COLORS[timeline.layers.length % LAYER_COLORS.length],
    enabled: true, blend: options.blend ?? 'screen', opacity: options.opacity ?? 0.7, clips: []
  };
  const index = options.index ?? timeline.layers.length;
  timeline.layers.splice(clamp(index, 0, timeline.layers.length), 0, layer);
  return layer;
}
export function removeLayer(timeline, layerId) {
  const index = timeline.layers.findIndex(l => l.id === layerId);
  if (index >= 0) timeline.layers.splice(index, 1);
  return index;
}
export function moveLayer(timeline, from, to) {
  if (from < 0 || from >= timeline.layers.length) return false;
  const [layer] = timeline.layers.splice(from, 1);
  timeline.layers.splice(clamp(to, 0, timeline.layers.length), 0, layer);
  return true;
}
export function duplicateLayer(timeline, layerId) {
  const index = timeline.layers.findIndex(l => l.id === layerId);
  if (index < 0) return null;
  const copy = structuredClone(timeline.layers[index]);
  copy.id = uid('layer'); copy.name = `${copy.name ?? 'Sloj'} kopija`;
  copy.clips.forEach(c => { c.id = uid('clip'); });
  timeline.layers.splice(index + 1, 0, copy);
  return copy;
}

/* -------------------------------------------------------------- clip ops */

export const CLIP_DEFAULTS = Object.freeze({
  preset: 'pulse', targets: 'all', color: [.6, .05, .8, 0], driver: 'none', driverGain: 1, speed: 1,
  direction: 'ltr', timing: 'beat', motionMode: 'serial', params: {}
});

function driverSignature(clip) {
  if (!clip || !clip.driver || clip.driver === 'none') return 'none';
  if (clip.driver === 'band' && clip.band) {
    const b = clip.band;
    return `band:${b.source || 'master'}:${b.lowHz}-${b.highHz}:${b.mode || 'follow'}`;
  }
  return clip.driver;
}

/** Infer the audio driver for a layer from its existing driven clips (weighted by
 * total duration so primary section clips beat tiny build/accent slices), falling
 * back to the layer's name or ID when no driven clips exist on the layer yet.
 */
export function inferLayerDriver(layer, startSec = null) {
  if (!layer || typeof layer !== 'object') return { driver: 'none', driverGain: 1 };
  const driven = Array.isArray(layer.clips)
    ? layer.clips.filter(c => c && c.driver && c.driver !== 'none')
    : [];

  if (driven.length > 0) {
    const groups = new Map();
    for (const c of driven) {
      const sig = driverSignature(c);
      let g = groups.get(sig);
      if (!g) {
        g = { sig, totalDur: 0, count: 0, clips: [] };
        groups.set(sig, g);
      }
      g.totalDur += Math.max(MIN_CLIP_SEC, Number.isFinite(c.durationSec) ? c.durationSec : 0);
      g.count += 1;
      g.clips.push(c);
    }

    let bestGroup = null;
    for (const g of groups.values()) {
      if (
        !bestGroup ||
        g.totalDur > bestGroup.totalDur + 1e-6 ||
        (Math.abs(g.totalDur - bestGroup.totalDur) <= 1e-6 && g.count > bestGroup.count)
      ) {
        bestGroup = g;
      }
    }

    let chosen = bestGroup.clips[0];
    if (Number.isFinite(startSec) && bestGroup.clips.length > 1) {
      let bestDist = Infinity;
      for (const c of bestGroup.clips) {
        const cStart = Number.isFinite(c.startSec) ? c.startSec : 0;
        const cEnd = cStart + (Number.isFinite(c.durationSec) ? c.durationSec : 0);
        const dist = startSec >= cStart && startSec <= cEnd
          ? 0
          : Math.min(Math.abs(startSec - cStart), Math.abs(startSec - cEnd));
        if (dist < bestDist) {
          bestDist = dist;
          chosen = c;
        }
      }
    }

    const res = {
      driver: chosen.driver,
      driverGain: Number.isFinite(chosen.driverGain) ? clamp(chosen.driverGain, 0, 2) : 1
    };
    if (chosen.driver === 'band') {
      res.band = chosen.band ? clampBand(chosen.band) : structuredClone(DEFAULT_BAND);
    }
    return res;
  }

  const rawText = `${layer.id || ''} ${layer.name || ''}`
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd');

  if (/\b(sub|bas|bass|low|dubok\w*)\b/.test(rawText)) {
    return { driver: 'bass', driverGain: 1 };
  }
  if (/\b(atmosfer\w*|atmosphere\w*|baza|base|wash|pad|ambijent\w*|ambient\w*|ostalo|other|sint\w*|synth\w*|melod\w*|harmoni\w*)\b/.test(rawText)) {
    if (/\b(vokal\w*|vocal\w*|glas\w*|voice\w*)\b/.test(rawText) && !/\b(sint\w*|synth\w*|atmosfer\w*|baza|wash)\b/.test(rawText)) {
      return { driver: 'vocals', driverGain: 1 };
    }
    return { driver: 'other', driverGain: 1 };
  }
  if (/\b(vokal\w*|vocal\w*|glas\w*|voice\w*|pjev\w*|lead)\b/.test(rawText)) {
    return { driver: 'vocals', driverGain: 1 };
  }
  if (/\b(ritam\w*|rhythm\w*|kretanj\w*|motion|bubnj\w*|drum\w*|kick\w*|snare\w*|clap\w*|hat|hihat|beat\w*|udar\w*|perkus\w*|perc\w*|akcent\w*|accent\w*|strob\w*|flash\w*)\b/.test(rawText)) {
    return { driver: 'drums', driverGain: 1 };
  }

  return { driver: 'none', driverGain: 1 };
}

function applyInferredDriverToClip(clip, layer, startSec = clip?.startSec) {
  const inferred = inferLayerDriver(layer, startSec);
  if (!inferred.driver || inferred.driver === 'none') return false;
  clip.driver = inferred.driver;
  clip.driverGain = inferred.driverGain;
  if (inferred.driver === 'band') {
    clip.band = inferred.band ? structuredClone(inferred.band) : structuredClone(DEFAULT_BAND);
  } else {
    delete clip.band;
  }
  return true;
}

export function addClip(timeline, layerId, spec = {}) {
  const layer = timeline.layers.find(l => l.id === layerId);
  if (!layer) throw new RangeError('layer does not exist');
  const durationSec = Math.max(MIN_CLIP_SEC, Number.isFinite(spec.durationSec) ? spec.durationSec : 2);
  const startSec = Math.max(0, Number.isFinite(spec.startSec) ? spec.startSec : 0);
  const rawKeys = spec.keyframes ? structuredClone(spec.keyframes) : [{ timeSec: 0, value: 1 }, { timeSec: durationSec, value: 1 }];
  const inheritedDriver = spec.driver === undefined ? inferLayerDriver(layer, startSec) : {};
  const clip = {
    ...structuredClone(CLIP_DEFAULTS), ...inheritedDriver, ...structuredClone(spec),
    id: uid('clip'), startSec, durationSec,
    keyframes: sanitizeKeyframes(rawKeys, durationSec)
  };
  if (clip.driver === 'band' && !clip.band) {
    clip.band = inheritedDriver.band ? structuredClone(inheritedDriver.band) : structuredClone(DEFAULT_BAND);
  }
  layer.clips.push(clip);
  return { layerId, clipId: clip.id };
}

export function moveClip(timeline, ref, { startSec, layerId } = {}) {
  const hit = findClip(timeline, ref);
  if (!hit) return null;
  if (Number.isFinite(startSec)) hit.clip.startSec = Math.max(0, startSec);
  if (layerId && layerId !== hit.layer.id) {
    const target = timeline.layers.find(l => l.id === layerId);
    if (!target) return ref;
    hit.layer.clips.splice(hit.clipIndex, 1);
    if (target.clips.some(c => c.id === hit.clip.id)) hit.clip.id = uid('clip');
    applyInferredDriverToClip(hit.clip, target, hit.clip.startSec);
    target.clips.push(hit.clip);
    return { layerId: target.id, clipId: hit.clip.id };
  }
  return ref;
}

/** Resize from the start or end edge. Keyframes keep their absolute position;
 * trimmed segments are cut with interpolated boundary values.
 */
export function resizeClip(timeline, ref, edge, timeSec, limitSec = Infinity) {
  const hit = findClip(timeline, ref);
  if (!hit) return false;
  const { clip } = hit, end = clipEnd(clip);
  if (!Array.isArray(clip.keyframes) || !clip.keyframes.length) {
    clip.keyframes = [{ timeSec: 0, value: 1 }, { timeSec: clip.durationSec, value: 1 }];
  }
  if (edge === 'end') {
    const newEnd = clamp(timeSec, clip.startSec + MIN_CLIP_SEC, Math.max(limitSec, clip.startSec + MIN_CLIP_SEC));
    const length = Math.max(MIN_CLIP_SEC, newEnd - clip.startSec);
    if (length < clip.durationSec) clip.keyframes = trimKeyframes(clip.keyframes, 0, length);
    else if (length > clip.durationSec) {
      const last = clip.keyframes.at(-1);
      if (clip.keyframes.length === 1 || last.timeSec < clip.durationSec - EPS) {
        clip.keyframes.push({ timeSec: length, value: last.value, ...(last.ease ? { ease: last.ease } : {}) });
      } else {
        last.timeSec = length;
      }
    }
    clip.keyframes = sanitizeKeyframes(clip.keyframes, length);
    clip.durationSec = length;
    return true;
  }
  const newStart = clamp(timeSec, 0, end - MIN_CLIP_SEC), delta = newStart - clip.startSec;
  if (Math.abs(delta) < EPS) return true;
  const length = Math.max(MIN_CLIP_SEC, end - newStart);
  if (delta > 0) clip.keyframes = trimKeyframes(clip.keyframes, delta, clip.durationSec);
  else {
    const shifted = clip.keyframes.map(k => ({ timeSec: k.timeSec - delta, value: k.value, ...(k.ease ? { ease: k.ease } : {}) }));
    clip.keyframes = [{ timeSec: 0, value: shifted[0].value, ...(shifted[0].ease ? { ease: shifted[0].ease } : {}) }, ...shifted];
    if (clip.keyframes.length > 1 && clip.keyframes[1].timeSec <= EPS) clip.keyframes.splice(0, 1);
    clip.keyframes[0].timeSec = 0;
  }
  clip.keyframes.at(-1).timeSec = length;
  clip.keyframes = sanitizeKeyframes(clip.keyframes, length);
  clip.startSec = newStart; clip.durationSec = length;
  return true;
}

export function splitClip(timeline, ref, atSec) {
  const hit = findClip(timeline, ref);
  if (!hit) return null;
  const { clip, layer, clipIndex } = hit, local = atSec - clip.startSec;
  if (local < MIN_CLIP_SEC || clip.durationSec - local < MIN_CLIP_SEC) return null;
  const right = structuredClone(clip);
  right.id = uid('clip'); right.startSec = atSec; right.durationSec = clip.durationSec - local;
  right.keyframes = trimKeyframes(clip.keyframes, local, clip.durationSec);
  clip.keyframes = trimKeyframes(clip.keyframes, 0, local); clip.durationSec = local;
  layer.clips.splice(clipIndex + 1, 0, right);
  return [ref, { layerId: layer.id, clipId: right.id }];
}

export function deleteClips(timeline, refs) {
  let removed = 0;
  for (const ref of refs) {
    const hit = findClip(timeline, ref);
    if (hit) { hit.layer.clips.splice(hit.clipIndex, 1); removed++; }
  }
  return removed;
}

/** Duplicate clips with a time offset and an optional layer-index offset. */
export function duplicateClips(timeline, refs, offsetSec = 0, layerOffset = 0) {
  const created = [];
  const sources = refs.map(ref => findClip(timeline, ref)).filter(Boolean);
  for (const hit of sources) {
    const target = timeline.layers[clamp(hit.layerIndex + layerOffset, 0, timeline.layers.length - 1)];
    const copy = structuredClone(hit.clip);
    copy.id = uid('clip'); copy.startSec = Math.max(0, hit.clip.startSec + offsetSec);
    if (target.id !== hit.layer.id || !copy.driver || copy.driver === 'none') {
      applyInferredDriverToClip(copy, target, copy.startSec);
    }
    target.clips.push(copy);
    created.push({ layerId: target.id, clipId: copy.id });
  }
  return created;
}

export function copyClips(timeline, refs) {
  const hits = refs.map(ref => findClip(timeline, ref)).filter(Boolean);
  if (!hits.length) return null;
  const originSec = Math.min(...hits.map(h => h.clip.startSec)), baseLayer = Math.min(...hits.map(h => h.layerIndex));
  return { items: hits.map(h => ({ layerOffset: h.layerIndex - baseLayer, offsetSec: h.clip.startSec - originSec, clip: structuredClone(h.clip) })) };
}

export function pasteClips(timeline, clipboard, atSec, baseLayerIndex = 0) {
  const created = [];
  if (!clipboard?.items?.length || !timeline.layers.length) return created;
  const maxOffset = Math.max(...clipboard.items.map(i => i.layerOffset));
  const base = clamp(baseLayerIndex, 0, Math.max(0, timeline.layers.length - 1 - maxOffset));
  for (const item of clipboard.items) {
    const layer = timeline.layers[clamp(base + item.layerOffset, 0, timeline.layers.length - 1)];
    const clip = structuredClone(item.clip);
    clip.id = uid('clip'); clip.startSec = Math.max(0, atSec + item.offsetSec);
    applyInferredDriverToClip(clip, layer, clip.startSec);
    layer.clips.push(clip);
    created.push({ layerId: layer.id, clipId: clip.id });
  }
  return created;
}

/** Keep a band driver valid whatever the UI sends: ordered edges, threshold below ceiling. */
export function clampBand(band) {
  const lowHz = clamp(band.lowHz, SPECTRUM_MIN_HZ, SPECTRUM_MAX_HZ - 10);
  const highHz = clamp(Math.max(band.highHz, lowHz * 1.05), lowHz * 1.05, SPECTRUM_MAX_HZ);
  const threshold = clamp(band.threshold, 0, 0.98);
  const ceiling = clamp(Math.max(band.ceiling, threshold + 0.02), threshold + 0.02, 1);
  const source = ['master', 'drums', 'bass', 'vocals', 'other'].includes(band.source) ? band.source : 'master';
  return { source, lowHz, highHz, threshold, ceiling, mode: band.mode === 'gate' ? 'gate' : 'follow', releaseSec: clamp(band.releaseSec, 0, 2) };
}

/** Apply a property patch to clips; targets 'all'/array normalised, color kept 0–1. */
export function patchClips(timeline, refs, patch) {
  for (const ref of refs) {
    const hit = findClip(timeline, ref);
    if (!hit) continue;
    const clip = hit.clip;
    for (const [key, value] of Object.entries(patch)) {
      if (key === 'color') clip.color = value.map(v => clamp(v, 0, 1));
      else if (key === 'driverGain') clip.driverGain = clamp(value, 0, 2);
      else if (key === 'targets') clip.targets = normalizeTargets(value);
      else if (key === 'driver') { clip.driver = value; if (value === 'band' && !clip.band) clip.band = structuredClone(DEFAULT_BAND); }
      else if (key === 'band') clip.band = clampBand({ ...(clip.band ?? DEFAULT_BAND), ...value });
      else if (key === 'preset') clip.preset = value;
      else if (key === 'speed') clip.speed = clamp(Number(value) || 1, 0.1, 32);
      else if (key === 'chaseMode') clip.chaseMode = value;
      else if (key === 'direction') clip.direction = value;
      else if (key === 'timing') clip.timing = value;
      else if (key === 'motionMode') clip.motionMode = value;
      else if (key === 'params') clip.params = { ...(clip.params ?? {}), ...value };
    }
  }
}

export function normalizeTargets(value) {
  if (value === 'all') return 'all';
  const set = BAR_IDS.filter(id => value.includes(id));
  return set.length === 0 ? 'all' : set.length === BAR_IDS.length ? 'all' : set;
}

/** Toggle one bar in a clip's target set; never leaves the set empty. */
export function toggleTarget(targets, barId) {
  const current = targets === 'all' ? [...BAR_IDS] : [...targets];
  const next = current.includes(barId) ? current.filter(id => id !== barId) : [...current, barId];
  return next.length ? normalizeTargets(next) : normalizeTargets(current);
}

/* ------------------------------------------------------------- keyframes */

export function addKeyframe(clip, timeSec, value, ease) {
  const t = clamp(timeSec, 0, clip.durationSec);
  if (clip.keyframes.some(k => Math.abs(k.timeSec - t) < 0.01)) return -1;
  const entry = { timeSec: t, value: clamp(value, 0, 1) };
  if (ease && ease !== 'linear') entry.ease = ease;
  clip.keyframes.push(entry);
  clip.keyframes.sort((a, b) => a.timeSec - b.timeSec);
  return clip.keyframes.findIndex(k => k.timeSec === t);
}

export function moveKeyframe(clip, index, timeSec, value) {
  const keys = clip.keyframes, key = keys?.[index];
  if (!key) return index;
  const prevT = index > 0 ? keys[index - 1].timeSec : null;
  const nextT = index < keys.length - 1 ? keys[index + 1].timeSec : null;
  let lo = prevT !== null ? prevT + 0.005 : 0;
  let hi = nextT !== null ? nextT - 0.005 : clip.durationSec;
  if (lo > hi) {
    const mid = prevT !== null && nextT !== null
      ? (prevT + nextT) / 2
      : prevT !== null
        ? Math.min(clip.durationSec, prevT + 1e-5)
        : Math.max(0, nextT - 1e-5);
    lo = hi = mid;
  }
  key.timeSec = clamp(timeSec, lo, hi);
  key.value = clamp(value, 0, 1);
  return index;
}

export function moveKeyframes(clip, initialKeys, indices, dt, dv) {
  const base = initialKeys || clip.keyframes.map(k => ({ ...k }));
  if (!indices || !indices.length || !base.length) return { dt: 0, dv: 0 };
  const set = new Set(indices);
  let minDt = -Infinity;
  let maxDt = Infinity;
  let minDv = -Infinity;
  let maxDv = Infinity;

  for (let i = 0; i < base.length; i++) {
    if (!set.has(i)) continue;
    const k = base[i];
    minDt = Math.max(minDt, -k.timeSec);
    maxDt = Math.min(maxDt, clip.durationSec - k.timeSec);

    for (let p = i - 1; p >= 0; p--) {
      if (!set.has(p)) {
        minDt = Math.max(minDt, Math.min(0, base[p].timeSec + 0.005 - k.timeSec));
        break;
      }
    }
    for (let n = i + 1; n < base.length; n++) {
      if (!set.has(n)) {
        maxDt = Math.min(maxDt, Math.max(0, base[n].timeSec - 0.005 - k.timeSec));
        break;
      }
    }

    minDv = Math.max(minDv, -k.value);
    maxDv = Math.min(maxDv, 1 - k.value);
  }

  const effectiveDt = minDt > maxDt ? 0 : clamp(dt, minDt, maxDt);
  const effectiveDv = minDv > maxDv ? 0 : clamp(dv, minDv, maxDv);

  clip.keyframes = sanitizeKeyframes(base.map((k, i) => {
    if (set.has(i)) {
      return {
        timeSec: clamp(k.timeSec + effectiveDt, 0, clip.durationSec),
        value: clamp(k.value + effectiveDv, 0, 1),
        ...(k.ease ? { ease: k.ease } : {})
      };
    }
    return { timeSec: k.timeSec, value: k.value, ...(k.ease ? { ease: k.ease } : {}) };
  }), clip.durationSec);

  return { dt: effectiveDt, dv: effectiveDv };
}

export function setKeyframeEase(clip, index, ease = 'linear') {
  const key = clip.keyframes?.[index];
  if (!key) return false;
  if (ease === 'linear') delete key.ease;
  else key.ease = ease;
  return true;
}

export function removeKeyframe(clip, index) {
  if (!Array.isArray(clip.keyframes) || clip.keyframes.length <= 1 || !clip.keyframes[index]) return false;
  clip.keyframes.splice(index, 1);
  return true;
}

export function removeKeyframes(clip, indices) {
  if (!indices || !indices.length || !Array.isArray(clip.keyframes)) return false;
  const set = new Set(indices);
  const remaining = clip.keyframes.filter((_, i) => !set.has(i));
  if (remaining.length === 0) {
    clip.keyframes = [{ timeSec: 0, value: 1 }, { timeSec: clip.durationSec, value: 1 }];
  } else {
    clip.keyframes = remaining;
  }
  return true;
}


/* ----------------------------------------------------------------- store */

/** Snapshot undo/redo store. commit() is atomic and rolls back invalid edits;
 * begin()/update()/end() coalesce a drag gesture into one undo step.
 * beginRecording()/endRecording()/cancelRecording() isolate live performance
 * recording sessions so concurrent UI clicks/drags never corrupt or abort them.
 */
export function createStore(initial, { limit = 120 } = {}) {
  let timeline = initial, undoStack = [], redoStack = [], gesture = null, recordingSnapshot = null;
  const subscribers = new Set(), emit = kind => subscribers.forEach(fn => fn(kind));
  const push = (snapshot, label) => {
    // Ensure undo snapshots never retain transient recording flags
    if (snapshot?.layers) {
      for (const l of snapshot.layers) if (l?.clips) for (const c of l.clips) delete c.recording;
    }
    undoStack.push({ snapshot, label });
    if (undoStack.length > limit) undoStack.shift();
    redoStack = [];
  };
  return {
    get timeline() { return timeline; },
    get canUndo() { return undoStack.length > 0; },
    get canRedo() { return redoStack.length > 0; },
    get undoLabel() { return undoStack.at(-1)?.label ?? ''; },
    get redoLabel() { return redoStack.at(-1)?.label ?? ''; },
    subscribe(fn) { subscribers.add(fn); return () => subscribers.delete(fn); },
    replace(next) { timeline = next; undoStack = []; redoStack = []; gesture = null; recordingSnapshot = null; emit('replace'); },
    commit(label, mutate) {
      const before = structuredClone(timeline);
      let result;
      try { result = mutate(timeline); } catch (error) { timeline = before; emit('change'); throw error; }
      const check = validateTimeline(timeline);
      if (!check.valid) { timeline = before; emit('change'); return { error: check.errors[0] }; }
      if (JSON.stringify(before) !== JSON.stringify(timeline)) push(before, label);
      emit('change');
      return { result };
    },
    begin() { gesture = structuredClone(timeline); },
    update(mutate) { const result = mutate(timeline); emit('transient'); return result; },
    end(label) {
      if (!gesture) return false;
      const snapshot = gesture; gesture = null;
      if (!validateTimeline(timeline).valid) { timeline = snapshot; emit('change'); return false; }
      const changed = JSON.stringify(snapshot) !== JSON.stringify(timeline);
      if (changed) { push(snapshot, label); emit('change'); }
      return changed;
    },
    cancel() { if (gesture) { timeline = gesture; gesture = null; emit('change'); } },
    discardGesture() { gesture = null; },
    beginRecording() {
      recordingSnapshot = structuredClone(timeline);
    },
    endRecording(label = 'Snimi izvedbu') {
      const snapshot = recordingSnapshot ?? gesture;
      recordingSnapshot = null;
      gesture = null;
      if (!snapshot) return false;
      normalizeTimeline(timeline);
      if (!validateTimeline(timeline).valid) {
        timeline = snapshot;
        emit('change');
        return false;
      }
      const changed = JSON.stringify(snapshot) !== JSON.stringify(timeline);
      if (changed) {
        push(snapshot, label);
        emit('change');
      }
      return changed;
    },
    cancelRecording() {
      if (recordingSnapshot) {
        timeline = recordingSnapshot;
        recordingSnapshot = null;
        gesture = null;
        emit('change');
      } else if (gesture) {
        timeline = gesture;
        gesture = null;
        emit('change');
      }
    },
    undo() { const entry = undoStack.pop(); if (!entry) return false; redoStack.push({ snapshot: structuredClone(timeline), label: entry.label }); timeline = entry.snapshot; emit('change'); return true; },
    redo() { const entry = redoStack.pop(); if (!entry) return false; undoStack.push({ snapshot: structuredClone(timeline), label: entry.label }); timeline = entry.snapshot; emit('change'); return true; }
  };
}
