/** Contrast, duty cycle, and spatial occupancy measurement for timelines.
 * Determines visual dynamics, drop punch, and saturation levels deterministically.
 */
import { BAR_IDS, PIXELS_PER_BAR } from './engine.mjs';
import { renderTimelineFrame, validateTimeline } from './timeline.mjs';
import { detectSections } from './audio-sections.mjs';

/** Measure pre-drop blackout duration immediately preceding dropStartSec. */
export function measurePreDropBlackout(timeline, analysis, dropStartSec, options = {}) {
  if (!Number.isFinite(dropStartSec) || dropStartSec <= 0) return 0;
  const probeStep = Math.max(0.001, Number(options.probeStepSec ?? 0.01));
  const threshold = Number.isFinite(options.blackoutThreshold) ? options.blackoutThreshold : 0;
  let blackoutSec = 0;
  let probeTime = dropStartSec - probeStep / 2;

  while (probeTime >= 0) {
    const frame = renderTimelineFrame(timeline, analysis, probeTime);
    let isDark = true;
    for (const id of BAR_IDS) {
      for (const px of frame.bars[id]) {
        if ((px[0] + px[1] + px[2] + px[3]) > threshold) {
          isDark = false;
          break;
        }
      }
      if (!isDark) break;
    }
    if (!isDark) break;
    blackoutSec += probeStep;
    probeTime -= probeStep;
  }
  return Number(blackoutSec.toFixed(3));
}

/** Measure contrast, duty cycle, spatial occupancy and pre-drop blackouts.
 * Samples renderTimelineFrame at intervals of 20 ms to 50 ms (default: 25 ms / 0.025s).
 */
export function measureTimelineContrast(timeline, analysis, options = {}) {
  const check = validateTimeline(timeline);
  if (!check.valid) throw new TypeError(`Invalid timeline: ${check.errors.join('; ')}`);

  const durationSec = Number(timeline.durationSec || analysis?.durationSec);
  if (!Number.isFinite(durationSec) || durationSec <= 0) throw new RangeError('durationSec must be positive');

  const stepSec = Math.max(0.01, Math.min(0.1, Number(options.stepSec ?? 0.025)));
  const activeThreshold = Number.isFinite(options.activeThreshold) ? options.activeThreshold : 24;

  const rawSections = (Array.isArray(analysis?.sections) && analysis.sections.length)
    ? analysis.sections
    : detectSections(analysis);

  const sectionsList = rawSections.length
    ? rawSections.map((s, idx) => ({
        id: s.id || `sec-${idx + 1}`,
        name: s.name || `Section ${idx + 1}`,
        type: s.type || 'section',
        startSec: Math.max(0, s.startSec ?? 0),
        endSec: Math.min(durationSec, s.endSec ?? ((s.startSec ?? 0) + (s.durationSec ?? 0))),
        durationSec: s.durationSec ?? ((s.endSec ?? durationSec) - (s.startSec ?? 0))
      }))
    : [{
        id: 'sec-full',
        name: 'Puna pjesma',
        type: 'full',
        startSec: 0,
        endSec: durationSec,
        durationSec
      }];

  function computeMetrics(frames) {
    if (!frames.length) {
      return {
        dutyCycle: 0,
        peakBrightness: 0,
        troughBrightness: 0,
        contrastRatio: 1,
        spatialOccupancy: 0
      };
    }

    const frameCount = frames.length;
    const totalPixels = frameCount * (BAR_IDS.length * PIXELS_PER_BAR);
    let totalLitPixels = 0;
    let totalActiveBars = 0;
    let minFrameBrightness = 1;
    let maxFrameBrightness = 0;

    for (const frame of frames) {
      let frameSum = 0;
      let activeBars = 0;
      for (const id of BAR_IDS) {
        let barLit = false;
        for (const px of frame.bars[id]) {
          const chSum = px[0] + px[1] + px[2] + px[3];
          if (chSum > activeThreshold) {
            totalLitPixels++;
            barLit = true;
          }
          frameSum += Math.min(1, chSum / 255);
        }
        if (barLit) activeBars++;
      }
      const frameBrightness = frameSum / (BAR_IDS.length * PIXELS_PER_BAR);
      minFrameBrightness = Math.min(minFrameBrightness, frameBrightness);
      maxFrameBrightness = Math.max(maxFrameBrightness, frameBrightness);
      totalActiveBars += activeBars;
    }

    const dutyCycle = Number(((totalLitPixels / totalPixels) * 100).toFixed(2));
    const peakBrightness = Number((maxFrameBrightness * 100).toFixed(2));
    const troughBrightness = Number((minFrameBrightness * 100).toFixed(2));
    const contrastRatio = Number(((maxFrameBrightness + 0.01) / (minFrameBrightness + 0.01)).toFixed(2));
    const spatialOccupancy = Number((totalActiveBars / frameCount).toFixed(2));

    return {
      dutyCycle,
      peakBrightness,
      troughBrightness,
      contrastRatio,
      spatialOccupancy
    };
  }

  // Pre-sample frames across the entire song
  const allSamples = [];
  for (let t = 0; t < durationSec; t += stepSec) {
    allSamples.push({
      t,
      frame: renderTimelineFrame(timeline, analysis, t)
    });
  }

  // Section metrics
  const analyzedSections = sectionsList.map(sec => {
    const secSamples = allSamples
      .filter(s => s.t >= sec.startSec && s.t < sec.endSec)
      .map(s => s.frame);

    const metrics = computeMetrics(secSamples);
    const preDropBlackoutSec = sec.type === 'drop'
      ? measurePreDropBlackout(timeline, analysis, sec.startSec, options)
      : 0;

    return {
      ...sec,
      ...metrics,
      preDropBlackoutSec
    };
  });

  const overallMetrics = computeMetrics(allSamples.map(s => s.frame));
  const drops = analyzedSections.filter(s => s.type === 'drop');
  const avgPreDropBlackout = drops.length
    ? Number((drops.reduce((a, d) => a + d.preDropBlackoutSec, 0) / drops.length).toFixed(3))
    : 0;

  const overall = {
    ...overallMetrics,
    preDropBlackoutSec: avgPreDropBlackout
  };

  return {
    overall,
    sections: analyzedSections,
    drops,
    dutyCycle: overall.dutyCycle,
    peakBrightness: overall.peakBrightness,
    troughBrightness: overall.troughBrightness,
    contrastRatio: overall.contrastRatio,
    spatialOccupancy: overall.spatialOccupancy,
    preDropBlackoutSec: avgPreDropBlackout
  };
}
