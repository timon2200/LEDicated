/** High-performance pre-baked timeline cache & show engine for LEDicated.
 * Pre-renders timeline frames into a flat zero-GC Uint8Array buffer at 60 FPS
 * with priority lookahead baking around the playhead and incremental invalidation
 * when clips/layers are edited. Live Board effects add onto cached frames in real time.
 */
import { BAR_IDS, PIXELS_PER_BAR } from './engine.mjs';
import { renderTimelineFrame } from './timeline.mjs';

export const DEFAULT_CACHE_FPS = 60;
export const CHANNELS_PER_PIXEL = 4;
export const BAR_COUNT = BAR_IDS.length;
export const BYTES_PER_BAR = PIXELS_PER_BAR * CHANNELS_PER_PIXEL; // 48
export const BYTES_PER_FRAME = BAR_COUNT * BYTES_PER_BAR; // 432

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function packFrameToBuffer(frame, target, byteOffset = 0) {
  const bars = frame?.bars || frame;
  let ptr = byteOffset;
  for (let b = 0; b < BAR_COUNT; b++) {
    const barPixels = bars?.[BAR_IDS[b]];
    for (let p = 0; p < PIXELS_PER_BAR; p++) {
      const px = barPixels?.[p];
      target[ptr++] = px ? (px[0] & 0xff) : 0;
      target[ptr++] = px ? (px[1] & 0xff) : 0;
      target[ptr++] = px ? (px[2] & 0xff) : 0;
      target[ptr++] = px ? (px[3] & 0xff) : 0;
    }
  }
}

export function unpackFrameFromBuffer(source, byteOffset = 0, scale = 1) {
  const bars = {};
  let ptr = byteOffset;
  const applyScale = scale !== 1;
  const s = clamp(scale, 0, 1);
  for (let b = 0; b < BAR_COUNT; b++) {
    const pixels = new Array(PIXELS_PER_BAR);
    for (let p = 0; p < PIXELS_PER_BAR; p++) {
      const r = source[ptr++];
      const g = source[ptr++];
      const bl = source[ptr++];
      const w = source[ptr++];
      pixels[p] = applyScale
        ? [Math.round(r * s), Math.round(g * s), Math.round(bl * s), Math.round(w * s)]
        : [r, g, bl, w];
    }
    bars[BAR_IDS[b]] = pixels;
  }
  return { bars };
}

function clipSignature(clip) {
  const kf = clip.keyframes ? clip.keyframes.map(k => `${k.timeSec.toFixed(4)}:${k.value.toFixed(4)}:${k.ease || ''}`).join(',') : '';
  const band = clip.band ? `${clip.band.source || 'm'}:${clip.band.lowHz}:${clip.band.highHz}:${clip.band.threshold}:${clip.band.ceiling}:${clip.band.mode}:${clip.band.releaseSec}` : '';
  const params = clip.params ? JSON.stringify(clip.params) : '';
  const targets = Array.isArray(clip.targets) ? clip.targets.join(',') : clip.targets;
  const color = Array.isArray(clip.color) ? clip.color.map(c => Number(c).toFixed(4)).join(',') : '';
  return `${clip.id}|${clip.preset}|${clip.startSec.toFixed(4)}|${clip.durationSec.toFixed(4)}|${targets}|${color}|${clip.driver}|${clip.driverGain ?? 1}|${clip.speed ?? 1}|${clip.direction || ''}|${clip.timing || ''}|${clip.motionMode || ''}|${clip.chaseMode || ''}|${band}|${params}|${kf}`;
}

function snapshotClipMap(timeline) {
  const map = new Map();
  if (!timeline?.layers) return map;
  for (let li = 0; li < timeline.layers.length; li++) {
    const layer = timeline.layers[li];
    const layerPrefix = `${li}:${layer.id}:${layer.enabled ? 1 : 0}:${layer.blend}:${Number(layer.opacity).toFixed(4)}`;
    for (const clip of layer.clips || []) {
      if (clip.recording) continue;
      map.set(`${layer.id}/${clip.id}`, {
        startSec: clip.startSec,
        endSec: clip.startSec + clip.durationSec,
        sig: `${layerPrefix}|${clipSignature(clip)}`
      });
    }
  }
  return map;
}

function headerSignature(timeline, analysis) {
  if (!timeline) return 'empty';
  const layerMeta = (timeline.layers || []).map(l => `${l.id}:${l.enabled ? 1 : 0}:${l.blend}:${Number(l.opacity).toFixed(4)}`).join(';');
  const hasSpec = Boolean(analysis?.spectrum);
  const hasFeat = Boolean(analysis?.features);
  return `v${timeline.version}|d${Number(timeline.durationSec).toFixed(3)}|bpm${Number(timeline.bpm).toFixed(2)}|off${Number(timeline.beatOffsetSec).toFixed(4)}|blk${timeline.blackout ? 1 : 0}|sp${hasSpec ? 1 : 0}|ft${hasFeat ? 1 : 0}|L:${layerMeta}`;
}

export function createShowEngine({ fps = DEFAULT_CACHE_FPS, lookaheadSec = 20, lookbehindSec = 2 } = {}) {
  const frameRate = clamp(Math.round(fps) || DEFAULT_CACHE_FPS, 10, 120);
  let timeline = null;
  let analysis = null;
  let totalFrames = 0;
  let buffer = new Uint8Array(0);
  let valid = new Uint8Array(0);
  let bakedCount = 0;
  let cacheHits = 0;
  let cacheMisses = 0;
  let prevHeaderSig = '';
  let prevClipMap = new Map();
  let prevSpectrum = null;
  let prevFeatures = null;
  let prevVersion = undefined;
  let timelineValid = false;
  let scanCursor = 0;

  function invalidateRange(startSec, endSec) {
    if (totalFrames <= 0) return;
    const f0 = clamp(Math.floor(startSec * frameRate) - 1, 0, totalFrames - 1);
    const f1 = clamp(Math.ceil(endSec * frameRate) + 1, 0, totalFrames - 1);
    for (let f = f0; f <= f1; f++) {
      if (valid[f]) {
        valid[f] = 0;
        bakedCount--;
      }
    }
    if (f0 < scanCursor) scanCursor = f0;
  }

  function invalidateAll() {
    valid.fill(0);
    bakedCount = 0;
    scanCursor = 0;
  }

  function sync(nextTimeline, nextAnalysis) {
    if (!nextTimeline || typeof nextTimeline !== 'object') {
      timeline = null;
      analysis = null;
      totalFrames = 0;
      bakedCount = 0;
      prevHeaderSig = '';
      prevClipMap.clear();
      prevSpectrum = null;
      prevFeatures = null;
      prevVersion = undefined;
      timelineValid = false;
      return false;
    }

    const nextSp = nextAnalysis?.spectrum ?? null;
    const nextFt = nextAnalysis?.features ?? null;
    if (
      nextTimeline === timeline &&
      nextAnalysis === analysis &&
      nextSp === prevSpectrum &&
      nextFt === prevFeatures &&
      nextTimeline._v !== undefined &&
      nextTimeline._v === prevVersion
    ) {
      return false;
    }

    const durationSec = Math.max(0.1, Number(nextTimeline.durationSec) || Number(nextAnalysis?.durationSec) || 60);
    const nextTotalFrames = Math.max(1, Math.ceil(durationSec * frameRate) + 1);
    const nextHeaderSig = headerSignature(nextTimeline, nextAnalysis);
    const nextClipMap = snapshotClipMap(nextTimeline);

    const needsResize = nextTotalFrames !== totalFrames || buffer.length < nextTotalFrames * BYTES_PER_FRAME;
    if (needsResize) {
      totalFrames = nextTotalFrames;
      buffer = new Uint8Array(totalFrames * BYTES_PER_FRAME);
      valid = new Uint8Array(totalFrames);
      bakedCount = 0;
      scanCursor = 0;
      prevHeaderSig = nextHeaderSig;
      prevClipMap = nextClipMap;
      prevSpectrum = nextSp;
      prevFeatures = nextFt;
      prevVersion = nextTimeline._v;
      timelineValid = false;
      timeline = nextTimeline;
      analysis = nextAnalysis;
      return true;
    }

    timeline = nextTimeline;
    analysis = nextAnalysis;
    prevSpectrum = nextSp;
    prevFeatures = nextFt;
    prevVersion = nextTimeline._v;

    // Global property or layer structure changed -> invalidate all frames
    if (nextHeaderSig !== prevHeaderSig) {
      prevHeaderSig = nextHeaderSig;
      prevClipMap = nextClipMap;
      timelineValid = false;
      invalidateAll();
      return true;
    }

    // Check clip-level diffs for surgical range invalidation
    let changed = false;
    for (const [key, prev] of prevClipMap) {
      const cur = nextClipMap.get(key);
      if (!cur) {
        invalidateRange(prev.startSec, prev.endSec);
        changed = true;
      } else if (cur.sig !== prev.sig) {
        invalidateRange(Math.min(prev.startSec, cur.startSec), Math.max(prev.endSec, cur.endSec));
        changed = true;
      }
    }
    for (const [key, cur] of nextClipMap) {
      if (!prevClipMap.has(key)) {
        invalidateRange(cur.startSec, cur.endSec);
        changed = true;
      }
    }
    if (changed) {
      prevClipMap = nextClipMap;
      timelineValid = false;
    }
    return changed;
  }

  function bakeFrameIndex(f) {
    if (f < 0 || f >= totalFrames) return;
    if (valid[f]) return;
    const tSec = f / frameRate;
    const rendered = renderTimelineFrame(timeline, analysis, tSec, null, timelineValid);
    timelineValid = true;
    packFrameToBuffer(rendered, buffer, f * BYTES_PER_FRAME);
    valid[f] = 1;
    bakedCount++;
  }

  function warmLookahead(playheadSec = 0, maxFramesToBake = 120, maxBudgetMs = Infinity) {
    if (!timeline || totalFrames <= 0 || bakedCount >= totalFrames) return 0;
    let bakedNow = 0;
    const useBudget = Number.isFinite(maxBudgetMs) && maxBudgetMs > 0;
    const startMs = useBudget ? performance.now() : 0;
    const centerFrame = clamp(Math.round(playheadSec * frameRate), 0, totalFrames - 1);
    const aheadEnd = clamp(centerFrame + Math.ceil(lookaheadSec * frameRate), 0, totalFrames - 1);
    const behindStart = clamp(centerFrame - Math.ceil(lookbehindSec * frameRate), 0, totalFrames - 1);

    // 1. Immediate lookahead window [playhead .. playhead + lookaheadSec]
    for (let f = centerFrame; f <= aheadEnd && bakedNow < maxFramesToBake; f++) {
      if (!valid[f]) {
        bakeFrameIndex(f);
        bakedNow++;
        if (useBudget && (performance.now() - startMs) >= maxBudgetMs) return bakedNow;
      }
    }

    // 2. Immediate lookbehind window [playhead - lookbehindSec .. playhead]
    for (let f = centerFrame - 1; f >= behindStart && bakedNow < maxFramesToBake; f--) {
      if (!valid[f]) {
        bakeFrameIndex(f);
        bakedNow++;
        if (useBudget && (performance.now() - startMs) >= maxBudgetMs) return bakedNow;
      }
    }

    // 3. Background full-song progressive pre-baking
    let scanned = 0;
    while (bakedCount < totalFrames && bakedNow < maxFramesToBake && scanned < totalFrames) {
      if (scanCursor >= totalFrames) scanCursor = 0;
      if (!valid[scanCursor]) {
        bakeFrameIndex(scanCursor);
        bakedNow++;
        if (useBudget && (performance.now() - startMs) >= maxBudgetMs) {
          scanCursor++;
          return bakedNow;
        }
      }
      scanCursor++;
      scanned++;
    }
    return bakedNow;
  }

  function bakeAll(nextTimeline = null, nextAnalysis = null) {
    if (nextTimeline) sync(nextTimeline, nextAnalysis);
    if (!timeline || totalFrames <= 0) return 0;
    let count = 0;
    for (let f = 0; f < totalFrames; f++) {
      if (!valid[f]) {
        bakeFrameIndex(f);
        count++;
      }
    }
    return count;
  }

  function getCachedTimelineFrame(timeSec, masterScale = 1) {
    if (!timeline || totalFrames <= 0) {
      return { bars: Object.fromEntries(BAR_IDS.map(id => [id, Array.from({ length: PIXELS_PER_BAR }, () => [0, 0, 0, 0])])) };
    }
    const f = clamp(Math.round(Math.max(0, timeSec) * frameRate), 0, totalFrames - 1);
    if (valid[f]) {
      cacheHits++;
    } else {
      cacheMisses++;
      bakeFrameIndex(f);
    }
    return unpackFrameFromBuffer(buffer, f * BYTES_PER_FRAME, masterScale);
  }

  /** Renders the authoritative frame for preview or hardware output:
   * - Reads pre-baked timeline frame from O(1) cache (baking on-demand if needed).
   * - Adds active Live Board effects on top of the timeline animation.
   * - Applies master brightness scaling.
   */
  function renderFrame({
    timeline: nextTimeline,
    analysis: nextAnalysis,
    songTimeSec = 0,
    clockTimeSec = 0,
    masterScale = 1,
    masterBrightness,
    masterBrightness60,
    performDesk = null,
    bpm
  } = {}) {
    if (nextTimeline) sync(nextTimeline, nextAnalysis);
    const activePads = performDesk?.desk?.active ?? performDesk?.active;
    const hasLivePads = Boolean(activePads?.size > 0);
    const effectiveBpm = bpm ?? timeline?.bpm ?? 120;
    // Get unscaled cached timeline frame first so Live Board additive blending
    // operates in full 0..255 internal dynamic range before master scaling.
    const base = getCachedTimelineFrame(songTimeSec, 1);
    const withLive = hasLivePads
      ? performDesk.render(base, clockTimeSec, effectiveBpm, 1, analysis, songTimeSec)
      : base;
    const scale = masterBrightness !== undefined
      ? clamp(Number(masterBrightness) / 100, 0, 1)
      : masterBrightness60 !== undefined
        ? clamp(Number(masterBrightness60) / 100, 0, 1)
        : clamp(masterScale, 0, 1);
    if (scale === 1) return withLive;
    for (let b = 0; b < BAR_COUNT; b++) {
      const pixels = withLive.bars[BAR_IDS[b]];
      for (let p = 0; p < PIXELS_PER_BAR; p++) {
        const px = pixels[p];
        px[0] = Math.round(px[0] * scale);
        px[1] = Math.round(px[1] * scale);
        px[2] = Math.round(px[2] * scale);
        px[3] = Math.round(px[3] * scale);
      }
    }
    return withLive;
  }

  function stats(playheadSec = 0) {
    if (!timeline || totalFrames <= 0) {
      return {
        fps: frameRate,
        totalFrames: 0,
        bakedFrames: 0,
        validFrames: 0,
        coverage: 0,
        coveragePct: 0,
        lookaheadPct: 0,
        cacheHits,
        cacheMisses,
        memoryBytes: 0
      };
    }
    const f0 = clamp(Math.round(playheadSec * frameRate), 0, totalFrames - 1);
    const f1 = clamp(f0 + Math.ceil(lookaheadSec * frameRate), 0, totalFrames - 1);
    let aheadBaked = 0;
    const aheadTotal = Math.max(1, f1 - f0 + 1);
    for (let f = f0; f <= f1; f++) if (valid[f]) aheadBaked++;
    return {
      fps: frameRate,
      totalFrames,
      bakedFrames: bakedCount,
      validFrames: bakedCount,
      coverage: bakedCount / totalFrames,
      coveragePct: Math.round((bakedCount / totalFrames) * 100),
      lookaheadPct: Math.round((aheadBaked / aheadTotal) * 100),
      cacheHits,
      cacheMisses,
      memoryBytes: buffer.byteLength
    };
  }

  return {
    get fps() { return frameRate; },
    sync,
    warmLookahead,
    bakeAll,
    getCachedTimelineFrame,
    renderFrame,
    invalidateRange,
    invalidateAll,
    stats
  };
}
