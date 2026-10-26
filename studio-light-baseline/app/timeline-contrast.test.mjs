import test from 'node:test';
import assert from 'node:assert/strict';
import { BAR_IDS, PIXELS_PER_BAR } from './engine.mjs';
import { measureTimelineContrast, measurePreDropBlackout } from './timeline-contrast.mjs';
import { pattern, createAutoShow } from './timeline.mjs';

const clip = (overrides = {}) => ({
  id: 'clip', startSec: 0, durationSec: 2, preset: 'wash', targets: 'all', color: [1, 1, 1, 0],
  driver: 'none', driverGain: 1, speed: 1, keyframes: [{ timeSec: 0, value: 1 }], ...overrides
});

const timeline = (clips = [clip()], overrides = {}) => ({
  version: 1, durationSec: 2, bpm: 120, beatOffsetSec: 0, blackout: false,
  layers: [{ id: 'test', enabled: true, blend: 'add', opacity: 1, clips }], ...overrides
});

test('measureTimelineContrast rejects invalid timelines and invalid durations', () => {
  assert.throws(() => measureTimelineContrast(null, null), TypeError);
  assert.throws(() => measureTimelineContrast({ version: 2 }, null), TypeError);
  assert.throws(() => measureTimelineContrast(timeline([], { durationSec: -1 }), null), TypeError);
});

test('blackout timeline produces 0% duty cycle, 0% peak/trough, and 1.0 contrast ratio', () => {
  const tl = timeline([clip()], { blackout: true, durationSec: 2 });
  const metrics = measureTimelineContrast(tl, null);

  assert.equal(metrics.dutyCycle, 0);
  assert.equal(metrics.peakBrightness, 0);
  assert.equal(metrics.troughBrightness, 0);
  assert.equal(metrics.contrastRatio, 1);
  assert.equal(metrics.spatialOccupancy, 0);
  assert.equal(metrics.preDropBlackoutSec, 0);
});

test('full rig full brightness clip produces 100% duty cycle and 9 active bars', () => {
  // A solid white clip on all 9 bars
  const tl = timeline([clip({ color: [1, 1, 1, 1], preset: 'wash', params: { mood: 'still' } })], { durationSec: 2 });
  const metrics = measureTimelineContrast(tl, null);

  assert.equal(metrics.dutyCycle, 100);
  assert.equal(metrics.peakBrightness, 100);
  assert.equal(metrics.troughBrightness, 100);
  assert.equal(metrics.contrastRatio, 1);
  assert.equal(metrics.spatialOccupancy, 9);
});

test('bottom row only targets produce exactly 3 active bars and ~33.3% duty cycle', () => {
  const bottomRow = ['L3', 'C3', 'R3'];
  const tl = timeline([clip({ targets: bottomRow, color: [1, 1, 1, 1], params: { mood: 'still' } })], { durationSec: 2 });
  const metrics = measureTimelineContrast(tl, null);

  assert.equal(metrics.spatialOccupancy, 3);
  assert.equal(metrics.dutyCycle, 33.33);
  assert.ok(Math.abs(metrics.peakBrightness - 33.33) < 1);
  assert.ok(Math.abs(metrics.troughBrightness - 33.33) < 1);
});

test('strobe produces razor-sharp peak-to-trough contrast with 0% trough brightness', () => {
  // Strobe with sharp duty on cross bars
  const tl = timeline([
    clip({
      preset: 'strobe',
      targets: ['C1', 'L2', 'C2', 'R2', 'C3'],
      color: [1, 1, 1, 1],
      params: { duty: 'sharp', rate: '1/4' }
    })
  ], { durationSec: 2, bpm: 120 });

  const metrics = measureTimelineContrast(tl, null, { stepSec: 0.02 });
  assert.equal(metrics.troughBrightness, 0);
  assert.ok(metrics.peakBrightness > 50, `peak should be high: ${metrics.peakBrightness}`);
  assert.ok(metrics.contrastRatio > 50, `contrast ratio should be high: ${metrics.contrastRatio}`);
  assert.ok(metrics.dutyCycle < 40, `duty cycle should be low: ${metrics.dutyCycle}`);
});

test('measurePreDropBlackout accurately detects blackout duration preceding a drop', () => {
  // Timeline with intro clip that stops at t = 1.5s, drop starts at t = 2.0s
  // Pre-drop blackout should be exactly 0.5s!
  const tl = timeline([
    clip({ id: 'intro', startSec: 0, durationSec: 1.5, keyframes: [{ timeSec: 0, value: 1 }, { timeSec: 1.5, value: 0 }] }),
    clip({ id: 'drop', startSec: 2.0, durationSec: 2.0, keyframes: [{ timeSec: 0, value: 1 }, { timeSec: 2.0, value: 0 }] })
  ], { durationSec: 4 });

  const blackoutWithGap = measurePreDropBlackout(tl, null, 2.0, { probeStepSec: 0.01 });
  assert.ok(blackoutWithGap >= 0.49 && blackoutWithGap <= 0.51, `expected ~0.5s blackout, got ${blackoutWithGap}s`);

  // Now timeline where intro clip runs continuously until t = 2.0s (no blackout)
  const tlNoGap = timeline([
    clip({ id: 'intro', startSec: 0, durationSec: 2.0, keyframes: [{ timeSec: 0, value: 1 }, { timeSec: 2.0, value: 1 }] }),
    clip({ id: 'drop', startSec: 2.0, durationSec: 2.0, keyframes: [{ timeSec: 0, value: 1 }, { timeSec: 2.0, value: 0 }] })
  ], { durationSec: 4 });

  const blackoutNoGap = measurePreDropBlackout(tlNoGap, null, 2.0, { probeStepSec: 0.01 });
  assert.equal(blackoutNoGap, 0, 'expected 0s blackout when clip runs until drop');
});

test('measureTimelineContrast reports per-section metrics and overall metrics', () => {
  const analysis = {
    durationSec: 10,
    bpm: 120,
    sections: [
      { id: 'sec-1', name: 'Intro', type: 'intro', startSec: 0, endSec: 4, durationSec: 4 },
      { id: 'sec-2', name: 'Drop 1', type: 'drop', startSec: 4, endSec: 10, durationSec: 6 }
    ]
  };

  const tl = timeline([
    clip({ id: 'intro-c', startSec: 0, durationSec: 3.5, targets: ['C2'], color: [1, 0, 0, 0] }),
    clip({ id: 'drop-c', startSec: 4.0, durationSec: 6.0, targets: ['L3', 'C3', 'R3'], color: [0, 1, 0, 0] })
  ], { durationSec: 10 });

  const res = measureTimelineContrast(tl, analysis, { stepSec: 0.025 });

  assert.equal(res.sections.length, 2);
  const introSec = res.sections.find(s => s.id === 'sec-1');
  const dropSec = res.sections.find(s => s.id === 'sec-2');

  assert.ok(introSec);
  assert.ok(dropSec);
  assert.equal(dropSec.type, 'drop');
  assert.ok(dropSec.preDropBlackoutSec >= 0.49 && dropSec.preDropBlackoutSec <= 0.51);

  assert.ok(Number.isFinite(res.overall.dutyCycle));
  assert.ok(Number.isFinite(res.overall.contrastRatio));
  assert.ok(Number.isFinite(res.overall.spatialOccupancy));
  assert.equal(res.drops.length, 1);
});

test('measureTimelineContrast respects custom stepSec within 20ms–50ms', () => {
  const tl = timeline([clip()], { durationSec: 2 });
  const m20 = measureTimelineContrast(tl, null, { stepSec: 0.020 });
  const m50 = measureTimelineContrast(tl, null, { stepSec: 0.050 });

  assert.ok(Number.isFinite(m20.dutyCycle));
  assert.ok(Number.isFinite(m50.dutyCycle));
  assert.equal(m20.dutyCycle, 100);
  assert.equal(m50.dutyCycle, 100);
});

test('strobe on-time never drops below 25ms to prevent DDP/WLED aliasing at high BPM', () => {
  const bpm = 160;
  const beatSec = 60 / bpm;
  const strobeClip = { preset: 'strobe', params: { rate: '1/4', duty: 'sharp' } };
  const period = beatSec / 4;
  let onMs = 0;
  const dt = 0.001; // 1ms step
  for (let t = 0; t < period; t += dt) {
    if (pattern('strobe', 1, 1, 0, t, t, beatSec, strobeClip, 'C2') === 1) {
      onMs++;
    }
  }
  assert.ok(onMs >= 25, `Expected on-time >= 25ms at 160 BPM, got ${onMs}ms`);
});

test('createAutoShow produces differentiated pre-drop blackout: 1 beat for Drop 1, 2 beats for Drop 2+', () => {
  const analysis = {
    durationSec: 80,
    bpm: 120, // beatSec = 0.5s
    sections: [
      { id: 's1', name: 'Intro', type: 'intro', startSec: 0, durationSec: 10 },
      { id: 's2', name: 'Drop 1', type: 'drop', startSec: 10, durationSec: 20 },
      { id: 's3', name: 'Verse', type: 'verse', startSec: 30, durationSec: 10 },
      { id: 's4', name: 'Drop 2', type: 'drop', startSec: 40, durationSec: 20 },
      { id: 's5', name: 'Breakdown', type: 'breakdown', startSec: 60, durationSec: 5 },
      { id: 's6', name: 'Drop 3', type: 'drop', startSec: 65, durationSec: 15 }
    ]
  };
  const show = createAutoShow(analysis);
  const metrics = measureTimelineContrast(show, analysis);

  const drop1 = metrics.sections.find(s => s.id === 's2');
  const drop2 = metrics.sections.find(s => s.id === 's4');
  const drop3 = metrics.sections.find(s => s.id === 's6');

  // Drop 1: 1 beat = 0.5s
  assert.ok(drop1.preDropBlackoutSec >= 0.48 && drop1.preDropBlackoutSec <= 0.52, `Drop 1 blackout expected ~0.5s, got ${drop1.preDropBlackoutSec}s`);
  // Drop 2 & 3: 2 beats = 1.0s
  assert.ok(drop2.preDropBlackoutSec >= 0.98 && drop2.preDropBlackoutSec <= 1.02, `Drop 2 blackout expected ~1.0s, got ${drop2.preDropBlackoutSec}s`);
  assert.ok(drop3.preDropBlackoutSec >= 0.98 && drop3.preDropBlackoutSec <= 1.02, `Drop 3 blackout expected ~1.0s, got ${drop3.preDropBlackoutSec}s`);
});

test('createAutoShow eliminates C3 overlap on drops by targeting upperCross for strobe', () => {
  const analysis = {
    durationSec: 40,
    bpm: 120,
    sections: [
      { id: 's1', name: 'Intro', type: 'intro', startSec: 0, durationSec: 10 },
      { id: 's2', name: 'Drop 1', type: 'drop', startSec: 10, durationSec: 30 }
    ]
  };
  const show = createAutoShow(analysis);

  // Strobe clips on drop must target upperCross ('C1', 'L2', 'C2', 'R2') and never C3
  const dropStrobeClips = show.layers
    .flatMap(l => l.clips)
    .filter(c => c.preset === 'strobe' && c.id.startsWith('acc-drop-str'));

  assert.ok(dropStrobeClips.length > 0);
  for (const c of dropStrobeClips) {
    assert.deepEqual(c.targets, ['C1', 'L2', 'C2', 'R2']);
    assert.equal(c.targets.includes('C3'), false, 'Strobe must NOT include C3 on drops');
  }

  // Bass clips target bottomRow ('L3', 'C3', 'R3')
  const bassClips = show.layers
    .find(l => l.id === 'bass')
    .clips.filter(c => c.id.startsWith('bass-drop'));
  assert.ok(bassClips.length > 0);
  for (const c of bassClips) {
    assert.deepEqual(c.targets, ['L3', 'C3', 'R3']);
  }
});

test('createAutoShow drop sections achieve maximum peakBrightness and contrast over non-drop sections', () => {
  const analysis = {
    durationSec: 60,
    bpm: 128,
    sections: [
      { id: 's1', name: 'Intro', type: 'intro', startSec: 0, durationSec: 12 },
      { id: 's2', name: 'Verse', type: 'verse', startSec: 12, durationSec: 12 },
      { id: 's3', name: 'Breakdown', type: 'breakdown', startSec: 24, durationSec: 12 },
      { id: 's4', name: 'Drop 1', type: 'drop', startSec: 36, durationSec: 24 }
    ]
  };
  const show = createAutoShow(analysis, { palette: 'midnight' });
  const metrics = measureTimelineContrast(show, analysis, { stepSec: 0.05 });

  const intro = metrics.sections.find(s => s.id === 's1');
  const verse = metrics.sections.find(s => s.id === 's2');
  const breakdown = metrics.sections.find(s => s.id === 's3');
  const drop = metrics.sections.find(s => s.id === 's4');

  assert.ok(drop.peakBrightness > intro.peakBrightness * 1.4, `Drop peak (${drop.peakBrightness}) must exceed Intro peak (${intro.peakBrightness})`);
  assert.ok(drop.peakBrightness > verse.peakBrightness * 1.2, `Drop peak (${drop.peakBrightness}) must exceed Verse peak (${verse.peakBrightness})`);
  assert.ok(drop.peakBrightness > breakdown.peakBrightness * 1.4, `Drop peak (${drop.peakBrightness}) must exceed Breakdown peak (${breakdown.peakBrightness})`);
});


