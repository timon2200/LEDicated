import test from 'node:test';
import assert from 'node:assert/strict';
import { BAR_IDS, PIXELS_PER_BAR } from './engine.mjs';
import { createAutoShow, renderTimelineFrame, snapTimeToBeat, validateTimeline, TIMELINE_PRESETS } from './timeline.mjs';

const empty = () => ({ bars: Object.fromEntries(BAR_IDS.map(id => [id, Array.from({ length: PIXELS_PER_BAR }, () => [0, 0, 0, 0])])) });
const clip = (overrides = {}) => ({
  id: 'clip', startSec: 0, durationSec: 2, preset: 'wash', targets: 'all', color: [1, 0, 0, 0],
  driver: 'none', driverGain: 1, keyframes: [{ timeSec: 0, value: 1 }], ...overrides
});
const timeline = (clips = [clip()], overrides = {}) => ({
  version: 1, durationSec: 2, bpm: 120, beatOffsetSec: 0, blackout: false,
  layers: [{ id: 'test', enabled: true, blend: 'add', opacity: 1, clips }], ...overrides
});

test('auto show is editable JSON with known presets and valid short clips', () => {
  for (const durationSec of [.05, .25, 18]) {
    const show = createAutoShow({ durationSec, bpm: 124, beatsSec: [0, .48, .97] });
    assert.equal(validateTimeline(show).valid, true);
    assert.deepEqual(JSON.parse(JSON.stringify(show)), show);
    assert.ok(show.layers.flatMap(layer => layer.clips).every(item => TIMELINE_PRESETS.includes(item.preset)));
  }
});

test('scrubbing in any order is deterministic and does not mutate inputs', () => {
  const analysis = { durationSec: 10, bpm: 120, features: { kind: 'frequency-band-estimates', hopSec: .5, drums: [0, 1, 0], bass: [1, .5, 0] } };
  const show = createAutoShow(analysis);
  const base = empty();
  const originalShow = structuredClone(show), originalBase = structuredClone(base);
  const first = renderTimelineFrame(show, analysis, .75, base);
  renderTimelineFrame(show, analysis, 2.5, base);
  renderTimelineFrame(show, analysis, 0, base);
  assert.deepEqual(renderTimelineFrame(show, analysis, .75, base), first);
  assert.deepEqual(show, originalShow);
  assert.deepEqual(base, originalBase);
});

test('keyframes interpolate clip opacity in local time', () => {
  const show = timeline([clip({ startSec: 1, durationSec: 2, keyframes: [
    { timeSec: 0, value: 0 }, { timeSec: 1, value: 1 }, { timeSec: 2, value: 0 }
  ] })], { durationSec: 3 });
  const atStart = renderTimelineFrame(show, null, 1).bars.C2[0][0];
  const halfway = renderTimelineFrame(show, null, 1.5).bars.C2[0][0];
  const peak = renderTimelineFrame(show, null, 2).bars.C2[0][0];
  assert.equal(atStart, 0);
  assert.ok(halfway > 0 && halfway < peak);
});

test('beat snap follows tempo or supplied irregular beat grid', () => {
  assert.equal(snapTimeToBeat(.74, 120), .5);
  assert.equal(snapTimeToBeat(.74, 120, 0, 2), .75);
  assert.equal(snapTimeToBeat(.74, 120, 0, 1, [0, .6, 1.3]), .6);
  assert.equal(snapTimeToBeat(4.1, 120, 0, 1, [0, .6, 1.3]), 4);
  const show = createAutoShow({ durationSec: 20, bpm: 120, beatsSec: [0, .6, 1.3] });
  assert.equal(show.beatOffsetSec, 0);
  assert.ok(show.layers.find(layer => layer.id === 'motion').clips.every(item => item.startSec >= 0));
});

test('all channels cap at 153, and explicit blackout overrides clips', () => {
  const base = empty();
  base.bars.C2[0] = [255, 300, 999, 160];
  const show = timeline([clip({ color: [1, 1, 1, 1] })]);
  const lit = renderTimelineFrame(show, null, 1, base);
  for (const id of BAR_IDS) for (const pixel of lit.bars[id]) for (const channel of pixel) assert.ok(Number.isInteger(channel) && channel >= 0 && channel <= 153);
  assert.deepEqual(lit.bars.C2[0], [153, 153, 153, 153]);
  assert.ok(renderTimelineFrame({ ...show, blackout: true }, null, 1, base).bars.C2.every(pixel => pixel.every(v => v === 0)));
  assert.ok(renderTimelineFrame(show, null, 1, { ...base, blackout: true }).bars.C2.every(pixel => pixel.every(v => v === 0)));
});

test('drums and bass estimates independently drive distinct RGBW channels', () => {
  const show = timeline([], { layers: [
    { id: 'bass', enabled: true, blend: 'add', opacity: 1, clips: [clip({ id: 'bass', driver: 'bass', color: [1, 0, 0, 0] })] },
    { id: 'drums', enabled: true, blend: 'add', opacity: 1, clips: [clip({ id: 'drums', driver: 'drums', preset: 'flash', color: [0, 0, 0, 1] })] }
  ] });
  const analysis = { features: { kind: 'frequency-band-estimates', hopSec: 1, drums: new Float32Array([0, 1]), bass: [1, 0] } };
  const bass = renderTimelineFrame(show, analysis, 0).bars.C2[0];
  const drums = renderTimelineFrame(show, analysis, 1).bars.C2[0];
  assert.ok(bass[0] > 0 && bass[3] === 0);
  assert.ok(drums[0] === 0 && drums[3] > 0);
});

test('audio driver samples align with features.startSec', () => {
  const show = timeline([clip({ preset: 'flash', driver: 'drums', color: [0, 0, 0, 1] })]);
  const analysis = { features: { kind: 'frequency-band-estimates', startSec: .25, hopSec: .5, drums: [0, 1], bass: [0, 0] } };
  const atFirst = renderTimelineFrame(show, analysis, .25).bars.C2[0][3];
  const between = renderTimelineFrame(show, analysis, .5).bars.C2[0][3];
  const atSecond = renderTimelineFrame(show, analysis, .75).bars.C2[0][3];
  assert.equal(atFirst, 0);
  assert.ok(between > 0 && between < atSecond);
  assert.equal(atSecond, 153);
});

test('all 16 presets render valid bounded RGBW frames without throwing', () => {
  assert.equal(TIMELINE_PRESETS.length, 16);
  for (const preset of TIMELINE_PRESETS) {
    const show = timeline([clip({ preset, color: [1, 0.5, 0.2, 0.8] })]);
    const frame = renderTimelineFrame(show, null, 1.25);
    for (const id of BAR_IDS) {
      assert.equal(frame.bars[id].length, 12);
      for (const px of frame.bars[id]) {
        for (let c = 0; c < 4; c++) {
          assert.ok(px[c] >= 0 && px[c] <= 153, `${preset} channel ${c} out of bounds: ${px[c]}`);
        }
      }
    }
  }
});

test('vocals and other stem drivers modulate output', () => {
  const show = timeline([], { layers: [
    { id: 'voc', enabled: true, blend: 'add', opacity: 1, clips: [clip({ id: 'voc', driver: 'vocals', color: [1, 0, 0, 0] })] },
    { id: 'oth', enabled: true, blend: 'add', opacity: 1, clips: [clip({ id: 'oth', driver: 'other', color: [0, 1, 0, 0] })] }
  ] });
  const analysis = { features: { hopSec: 1, vocals: [1, 0], other: [0, 1] } };
  const t0 = renderTimelineFrame(show, analysis, 0).bars.C2[0];
  const t1 = renderTimelineFrame(show, analysis, 1).bars.C2[0];
  assert.ok(t0[0] > 0 && t0[1] === 0);
  assert.ok(t1[0] === 0 && t1[1] > 0);
});

test('createAutoShow uses sections when available', () => {
  const analysis = {
    durationSec: 120,
    bpm: 128,
    sections: [
      { id: 's1', type: 'intro', startSec: 0, durationSec: 15 },
      { id: 's2', type: 'drop', startSec: 15, durationSec: 60 },
      { id: 's3', type: 'outro', startSec: 75, durationSec: 45 }
    ]
  };
  const show = createAutoShow(analysis);
  assert.ok(show.layers.length >= 4);
  assert.ok(show.layers.some(l => l.clips.some(c => c.preset === 'strobe' || c.preset === 'alternate')));
  assert.ok(validateTimeline(show).valid);
});

test('clip speed and chaseMode validate and reject out-of-range values', () => {
  const validShow = timeline([clip({ speed: 8, chaseMode: 'row' })]);
  assert.ok(validateTimeline(validShow).valid);

  const badSpeed = timeline([clip({ speed: -1 })]);
  assert.equal(validateTimeline(badSpeed).valid, false);

  const zeroSpeed = timeline([clip({ speed: 0 })]);
  assert.equal(validateTimeline(zeroSpeed).valid, false);

  const badMode = timeline([clip({ chaseMode: 'diagonal' })]);
  assert.equal(validateTimeline(badMode).valid, false);
});

test('chase sweeps continuously through the entire row (L1 -> C1 -> R1)', () => {
  // Target row 1 only: L1, C1, R1 (36 pixels total).
  // At speed 1 and 120 BPM (0.5s per beat), 1 sweep across row 1 takes exactly 0.5s.
  const row1Targets = ['L1', 'C1', 'R1'];
  const show = timeline([clip({ preset: 'chase', targets: row1Targets, speed: 1, color: [1, 0, 0, 0] })]);

  // At t = 0.08s: head is in L1 (pixel ~6). L1 is the dominant bar, C1 is 0.
  const fL1 = renderTimelineFrame(show, null, 0.08);
  const maxL1 = Math.max(...fL1.bars.L1.map(p => p[0]));
  const maxC1_early = Math.max(...fL1.bars.C1.map(p => p[0]));
  assert.ok(maxL1 > 100, `L1 should be lit early: ${maxL1}`);
  assert.equal(maxC1_early, 0, 'C1 should be dark while head is in L1');

  // At t = 0.20s: head has traveled to C1 (~pixel 14 out of 36). C1 is at peak.
  const fC1 = renderTimelineFrame(show, null, 0.20);
  const maxC1 = Math.max(...fC1.bars.C1.map(p => p[0]));
  assert.ok(maxC1 > 120, `C1 should be lit midway through row: ${maxC1}`);

  // At t = 0.40s: head has reached R1 (~pixel 29 out of 36). R1 is at peak, L1 is 0.
  const fR1 = renderTimelineFrame(show, null, 0.40);
  const maxR1 = Math.max(...fR1.bars.R1.map(p => p[0]));
  const maxL1_late = Math.max(...fR1.bars.L1.map(p => p[0]));
  assert.ok(maxR1 > 120, `R1 should be lit near end of row: ${maxR1}`);
  assert.equal(maxL1_late, 0, 'L1 should be dark when head is in R1');

  // Unselected rows (L2, C2, etc.) should be completely black (zero).
  for (const id of ['L2', 'C2', 'R2', 'L3', 'C3', 'R3']) {
    for (const px of fC1.bars[id]) assert.deepEqual(px, [0, 0, 0, 0]);
  }
});

test('speed = 8 blitz laser completes full row sweeps 8x faster with razor-sharp contrast', () => {
  const rowTargets = ['L1', 'C1', 'R1'];
  const blitzShow = timeline([clip({ preset: 'chase', targets: rowTargets, speed: 8, color: [0, 1, 0, 0] })]);

  // At 120 BPM and speed 8: 1 full row sweep takes 0.5s / 8 = 0.0625s (62.5ms).
  // At t = 0.010s: head is in L1
  const tL1 = renderTimelineFrame(blitzShow, null, 0.010);
  assert.ok(Math.max(...tL1.bars.L1.map(p => p[1])) > 100);
  assert.equal(Math.max(...tL1.bars.C1.map(p => p[1])), 0);
  assert.equal(Math.max(...tL1.bars.R1.map(p => p[1])), 0);

  // At t = 0.040s: head has already reached C1 within 40ms!
  const tC1 = renderTimelineFrame(blitzShow, null, 0.040);
  assert.ok(Math.max(...tC1.bars.C1.map(p => p[1])) > 120);
  assert.equal(Math.max(...tC1.bars.L1.map(p => p[1])), 0);

  // At t = 0.060s: head has reached R1 within 60ms!
  const tR1 = renderTimelineFrame(blitzShow, null, 0.060);
  assert.ok(Math.max(...tR1.bars.R1.map(p => p[1])) > 100);
  assert.equal(Math.max(...tR1.bars.L1.map(p => p[1])), 0);

  // At t = 0.070s: head has wrapped into the second blitz cycle (back to L1)!
  const tLoop = renderTimelineFrame(blitzShow, null, 0.070);
  assert.ok(Math.max(...tLoop.bars.L1.map(p => p[1])) > 100);
});

test('syncRow mode sweeps all active rows simultaneously', () => {
  const show = timeline([clip({ preset: 'chase', targets: 'all', speed: 1, chaseMode: 'syncRow', color: [1, 1, 0, 0] })]);
  const f = renderTimelineFrame(show, null, 0.05);

  // In syncRow, L1, L2, and L3 all have the same head position and intensity
  const l1Max = Math.max(...f.bars.L1.map(p => p[0]));
  const l2Max = Math.max(...f.bars.L2.map(p => p[0]));
  const l3Max = Math.max(...f.bars.L3.map(p => p[0]));
  assert.ok(l1Max > 80);
  assert.equal(l1Max, l2Max, 'L1 and L2 should be identical in syncRow');
  assert.equal(l2Max, l3Max, 'L2 and L3 should be identical in syncRow');
});

test('columns dynamically adapts to active columns without dead beats when middle is excluded', () => {
  // Exclude middle column C (only L and R active)
  const targets = ['L1', 'L2', 'L3', 'R1', 'R2', 'R3'];
  const show = timeline([clip({ preset: 'columns', targets, color: [1, 0, 0, 0] })]);

  // At 120 BPM: beat 0 is t=0..0.5s, beat 1 is t=0.5..1.0s, beat 2 is t=1.0..1.5s
  // Beat 0: L is lit, R is dim
  const f0 = renderTimelineFrame(show, null, 0.1);
  const maxL0 = Math.max(...f0.bars.L1.map(p => p[0]));
  const maxR0 = Math.max(...f0.bars.R1.map(p => p[0]));
  assert.ok(maxL0 > 100, 'L should be bright on beat 0');
  assert.ok(maxR0 < 30, 'R should be dim on beat 0');

  // Beat 1: R is lit immediately (no dead beat from missing C column!)
  const f1 = renderTimelineFrame(show, null, 0.6);
  const maxL1 = Math.max(...f1.bars.L1.map(p => p[0]));
  const maxR1 = Math.max(...f1.bars.R1.map(p => p[0]));
  assert.ok(maxR1 > 100, 'R should be bright on beat 1');
  assert.ok(maxL1 < 30, 'L should be dim on beat 1');

  // Beat 2: alternates back to L
  const f2 = renderTimelineFrame(show, null, 1.1);
  const maxL2 = Math.max(...f2.bars.L1.map(p => p[0]));
  const maxR2 = Math.max(...f2.bars.R1.map(p => p[0]));
  assert.ok(maxL2 > 100, 'L should be bright again on beat 2');
  assert.ok(maxR2 < 30, 'R should be dim on beat 2');
});

test('columns timing: bar alternates columns every 4 beats (1 takt)', () => {
  const show = timeline([clip({ preset: 'columns', timing: 'bar', targets: 'all', durationSec: 8, color: [0, 1, 0, 0] })], { durationSec: 8 });

  // Bar 1 (beats 0..3: t = 0..2.0s): Column L is active throughout
  const fBeat0 = renderTimelineFrame(show, null, 0.2);
  const fBeat2 = renderTimelineFrame(show, null, 1.2);
  assert.ok(Math.max(...fBeat0.bars.L1.map(p => p[1])) > 100, 'L is bright on beat 0');
  assert.ok(Math.max(...fBeat2.bars.L1.map(p => p[1])) > 100, 'L is still bright on beat 2 in bar 1');
  assert.ok(Math.max(...fBeat2.bars.C1.map(p => p[1])) < 30, 'C is dim in bar 1');

  // Bar 2 (beats 4..7: t = 2.0..4.0s): Column C is active
  const fBeat4 = renderTimelineFrame(show, null, 2.2);
  assert.ok(Math.max(...fBeat4.bars.C1.map(p => p[1])) > 100, 'C becomes bright on bar 2');
  assert.ok(Math.max(...fBeat4.bars.L1.map(p => p[1])) < 30, 'L is dim on bar 2');
});

test('chase direction: rtl sweeps from right to left (R1 -> C1 -> L1)', () => {
  const row1Targets = ['L1', 'C1', 'R1'];
  const show = timeline([clip({ preset: 'chase', direction: 'rtl', targets: row1Targets, speed: 1, color: [0, 0, 1, 0] })]);

  // At t = 0.08s: head starts at R1 moving toward C1. R1 is bright, C1 is ahead and completely dark.
  const fR = renderTimelineFrame(show, null, 0.08);
  assert.ok(Math.max(...fR.bars.R1.map(p => p[2])) > 100, 'R1 should be lit first in RTL');
  assert.equal(Math.max(...fR.bars.C1.map(p => p[2])), 0, 'C1 should be dark ahead of head in RTL');

  // At t = 0.22s: head is at C1
  const fC = renderTimelineFrame(show, null, 0.22);
  assert.ok(Math.max(...fC.bars.C1.map(p => p[2])) > 120, 'C1 should be lit midway in RTL');

  // At t = 0.40s: head arrives at L1, R1 is ahead of head and dark
  const fL = renderTimelineFrame(show, null, 0.40);
  assert.ok(Math.max(...fL.bars.L1.map(p => p[2])) > 120, 'L1 should be lit at end of RTL');
  assert.equal(Math.max(...fL.bars.R1.map(p => p[2])), 0, 'R1 should be dark when head is at L1');
});

test('chase with rub targets plays both sides simultaneously (L and R columns in sync)', () => {
  const rubTargets = ['L1', 'L2', 'L3', 'R1', 'R2', 'R3'];
  const show = timeline([clip({ preset: 'chase', targets: rubTargets, speed: 1, color: [1, 0.5, 0, 0] })]);

  // At early time (t = 0.05s): head is in top row. Both L1 and R1 are lit identically!
  const fEarly = renderTimelineFrame(show, null, 0.05);
  const maxL1 = Math.max(...fEarly.bars.L1.map(p => p[0]));
  const maxR1 = Math.max(...fEarly.bars.R1.map(p => p[0]));
  assert.ok(maxL1 > 100, `L1 should be bright: ${maxL1}`);
  assert.equal(maxL1, maxR1, 'L1 and R1 must have identical intensity (both sides played at once)');
  assert.deepEqual(fEarly.bars.L1, fEarly.bars.R1, 'L1 and R1 pixels must match exactly');
  assert.deepEqual(fEarly.bars.L2, fEarly.bars.R2, 'L2 and R2 pixels must match exactly');
  assert.deepEqual(fEarly.bars.L3, fEarly.bars.R3, 'L3 and R3 pixels must match exactly');

  // Center column must be completely dark
  for (const c of ['C1', 'C2', 'C3']) {
    for (const px of fEarly.bars[c]) assert.deepEqual(px, [0, 0, 0, 0]);
  }

  // At late time (t = 0.40s): head has moved down to row 3. Both L3 and R3 are lit identically!
  const fLate = renderTimelineFrame(show, null, 0.40);
  const maxL3 = Math.max(...fLate.bars.L3.map(p => p[0]));
  const maxR3 = Math.max(...fLate.bars.R3.map(p => p[0]));
  assert.ok(maxL3 > 100, `L3 should be bright: ${maxL3}`);
  assert.equal(maxL3, maxR3, 'L3 and R3 must match');
  assert.deepEqual(fLate.bars.L3, fLate.bars.R3, 'L3 and R3 pixels must match exactly');
});




