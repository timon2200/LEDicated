import test from 'node:test';
import assert from 'node:assert/strict';
import { BAR_IDS, PIXELS_PER_BAR } from './engine.mjs';
import { createPerformance, nextBeat, PAD_KEYS } from './live-performance-state.mjs';
import { pattern } from './timeline.mjs';

const blank = () => ({ bars: Object.fromEntries(BAR_IDS.map(id => [id, Array.from({ length: PIXELS_PER_BAR }, () => [0, 0, 0, 0])])) });
const lit = frame => Object.values(frame.bars).flat().some(pixel => pixel.some(v => v > 0));

test('twelve keyboard slots, repaired local preferences and beat cue', () => {
  const desk = createPerformance([{ preset: 'bad', intensity: 2, color: [-1, 2, 0, 0] }]);
  assert.equal(PAD_KEYS.length, 12);
  assert.equal(desk.pads.slice(8).every(pad => pad === null), true);
  assert.equal(desk.pads[0].preset, 'flash');
  assert.equal(desk.pads[0].intensity, 1);
  assert.deepEqual(desk.pads[0].color, [0, 1, 0, 0]);
  assert.equal(nextBeat(1.2, 120, 0, [0, .49, 1.01, 1.52]), 1.52);
  desk.setQuantize(true);
  assert.equal(desk.trigger(1, { songTime: 1.2, clockTime: 10, playing: true, bpm: 120, beatTimes: [0, .49, 1.01, 1.52] }), 'queued');
  assert.equal(desk.active.size, 0);
  desk.tick({ songTime: 1.5, clockTime: 10.3, playing: true, bpm: 120 });
  assert.equal(desk.active.size, 1);
  assert.equal(desk.trigger(1, { clockTime: 10.4 }), 'stopped');
  desk.trigger(2, { songTime: 2.2, clockTime: 11, playing: true, bpm: 120 });
  desk.tick({ songTime: 2.2, clockTime: 11.1, playing: false, bpm: 120 });
  assert.equal(desk.pending.size, 0, 'pause cancels an unlaunched cue');
});

test('moving to an empty slot and swapping occupied slots preserves live playback', () => {
  const desk = createPerformance();
  desk.trigger(0, { clockTime: 3 });
  assert.equal(desk.movePad(0, 8), true);
  assert.equal(desk.pads[0], null);
  assert.equal(desk.pads[8].preset, 'flash');
  assert.equal(desk.active.has(8), true);
  assert.equal(desk.active.has(0), false);
  assert.equal(desk.movePad(8, 1), true);
  assert.equal(desk.pads[1].preset, 'flash');
  assert.equal(desk.pads[8].preset, 'pulse');
  assert.equal(desk.active.has(1), true);
  assert.equal(desk.movePad(8, 8), false);
  assert.equal(desk.removePad(1), true);
  assert.equal(desk.active.size, 0);
  assert.equal(desk.trigger(1, { clockTime: 4 }), 'invalid');
  assert.equal(desk.setPad(1, { preset: 'wave' }), true);
  assert.equal(desk.pads[1].preset, 'wave');
});

test('live RGBW overlay uses the shared renderer and never mutates the base', () => {
  const desk = createPerformance();
  desk.setPad(6, { preset: 'center', color: [0, 0, 0, 1], intensity: 1, targets: ['C2'] });
  const base = blank(), untouched = structuredClone(base);
  desk.trigger(6, { clockTime: 100 });
  const a = desk.render(base, 100.1, 120);
  const b = desk.render(base, 100.1, 120);
  assert.deepEqual(a, b);
  assert.deepEqual(base, untouched);
  assert(lit(a));
  assert(a.bars.C2.some(pixel => pixel[3] > 0));
  assert(a.bars.L1.every(pixel => pixel.every(channel => channel === 0)));
  for (const pixels of Object.values(a.bars)) for (const pixel of pixels) for (const channel of pixel) assert(channel >= 0 && channel <= 255);
  desk.clear();
  assert.equal(desk.render(base, 100.2), base);
});

test('hit fades and expires; loop stops on second press', () => {
  const desk = createPerformance();
  assert.equal(desk.trigger(0, { clockTime: 4, bpm: 120 }), 'started');
  assert(lit(desk.render(blank(), 4.02, 120)));
  desk.tick({ clockTime: 4.3 });
  assert.equal(desk.active.size, 0);
  assert.equal(desk.trigger(2, { clockTime: 5 }), 'started');
  assert.equal(desk.trigger(2, { clockTime: 5.1 }), 'stopped');
});

test('loop pad latches on a tap and stops on a held release', () => {
  const desk = createPerformance();
  assert.equal(desk.press(1, { clockTime: 1 }), 'started');
  assert(desk.held.has(1));
  assert.equal(desk.release(1, { clockTime: 1.1 }), 'latched');
  assert(desk.active.has(1), 'short tap keeps the loop running');
  assert.equal(desk.press(1, { clockTime: 2 }), 'held');
  assert.equal(desk.release(1, { clockTime: 2.08 }), 'stopped');
  assert(!desk.active.has(1), 'second short tap toggles off');
  desk.press(1, { clockTime: 3 });
  assert.equal(desk.release(1, { clockTime: 3.4 }), 'stopped');
  assert(!desk.active.has(1), 'held loop ends on release');
});

test('held hit repeats its complete animation and stops on release', () => {
  const desk = createPerformance();
  desk.press(0, { clockTime: 4, bpm: 120 });
  assert.equal(desk.active.get(0).until, 4.25);
  desk.tick({ clockTime: 4.3, bpm: 120 });
  assert(desk.active.has(0));
  assert.equal(desk.active.get(0).start, 4.25);
  assert(lit(desk.render(blank(), 4.3, 120)));
  assert.equal(desk.release(0, { clockTime: 4.4 }), 'stopped');
  assert(!desk.active.has(0));
  desk.press(0, { clockTime: 5, bpm: 120 });
  assert.equal(desk.release(0, { clockTime: 5.08 }), 'one-shot');
  desk.tick({ clockTime: 5.1, bpm: 120 });
  assert(desk.active.has(0), 'short hit completes after key release');
  desk.tick({ clockTime: 5.26, bpm: 120 });
  assert(!desk.active.has(0));
});

test('held quantized cue cancels on long release and focus loss clears held pads', () => {
  const desk = createPerformance();
  desk.setQuantize(true);
  desk.press(1, { songTime: 1.2, clockTime: 10, playing: true, bpm: 120 });
  assert(desk.pending.has(1));
  assert.equal(desk.release(1, { clockTime: 10.1 }), 'latched');
  assert(desk.pending.has(1));
  desk.press(2, { songTime: 1.2, clockTime: 11, playing: true, bpm: 120 });
  assert.equal(desk.release(2, { clockTime: 11.4 }), 'stopped');
  assert(!desk.pending.has(2));
  desk.setQuantize(false);
  desk.press(1, { clockTime: 12 });
  desk.press(2, { clockTime: 12 });
  desk.releaseAll();
  assert.equal(desk.held.size, 0);
  assert.equal(desk.active.size, 0);
});

test('reordering a held pad still releases the original physical key', () => {
  const desk = createPerformance();
  desk.press(1, { clockTime: 1 });
  assert(desk.movePad(1, 8));
  assert(desk.held.has(8));
  assert.equal(desk.release(1, { clockTime: 1.4 }), 'stopped');
  assert.equal(desk.held.size, 0);
  assert.equal(desk.active.size, 0);
});

test('effect-specific controls change the final frame and reject unknown options', () => {
  const desk = createPerformance();
  desk.setPad(0, { params: { focus: 'edges', decay: 'slow' } });
  desk.trigger(0, { clockTime: 20 });
  const edges = desk.render(blank(), 20.02, 120);
  desk.setPad(0, { params: { focus: 'all', decay: 'slow' } });
  const all = desk.render(blank(), 20.02, 120);
  assert(all.bars.C2[0][3] > edges.bars.C2[0][3]);
  desk.setPad(0, { params: { focus: 'invalid', extra: 'ignored' } });
  assert.deepEqual(desk.pads[0].params, { focus: 'center', decay: 'fast' });
});

test('duplicated flashes keep independent 3×3 bar selections', () => {
  const desk = createPerformance();
  desk.setPad(0, { targets: ['L1', 'L2', 'L3'] });
  desk.setPad(8, { ...structuredClone(desk.pads[0]), targets: ['R1', 'R2', 'R3'] });
  desk.trigger(0, { clockTime: 10, bpm: 120 });
  const left = desk.render(blank(), 10.02, 120);
  assert(left.bars.L1.some(pixel => pixel.some(channel => channel > 0)));
  assert(left.bars.R1.every(pixel => pixel.every(channel => channel === 0)));
  desk.trigger(8, { clockTime: 10, bpm: 120 });
  const both = desk.render(blank(), 10.02, 120);
  assert(both.bars.R1.some(pixel => pixel.some(channel => channel > 0)));
  assert(both.bars.C2.every(pixel => pixel.every(channel => channel === 0)));
});

test('chase hit covers a chosen portion of the path at the selected speed', () => {
  const desk = createPerformance();
  desk.setPad(2, { mode: 'hit', hitTravel: 'full', speed: 2, timing: 'beat', targets: ['L1', 'C1', 'R1'] });
  desk.trigger(2, { clockTime: 10, bpm: 120 });
  assert.equal(desk.active.get(2).until, 10.25);
  desk.tick({ clockTime: 10.24 });
  assert(desk.active.has(2));
  desk.tick({ clockTime: 10.26 });
  assert(!desk.active.has(2));
  desk.setPad(2, { hitTravel: 'half' });
  desk.trigger(2, { clockTime: 11, bpm: 120 });
  assert.equal(desk.active.get(2).until, 11.125);
});

test('dark panels can be skipped or counted by spatial effects', () => {
  const clip = { targets: ['L1', 'R1'], direction: 'ltr', timing: 'beat', speed: 1, params: { beam: 'needle', pathMode: 'skip' } };
  for (const [preset, time] of [['chase', .27], ['columns', .61], ['spiral', .07]]) {
    const skip = pattern(preset, 0, 2, 0, time, time, .5, clip, 'R1');
    const keep = pattern(preset, 0, 2, 0, time, time, .5, { ...clip, params: { ...clip.params, pathMode: 'keep' } }, 'R1');
    assert.notEqual(skip, keep, `${preset} should honour its path mode`);
  }
});

test('loop audio driver follows song analysis while animation uses live clock', () => {
  const desk = createPerformance();
  desk.setPad(1, { driver: 'bass', driverGain: 1, preset: 'wash' });
  desk.trigger(1, { clockTime: 100 });
  const analysis = { features: { bass: [0, 1], hopSec: 1, startSec: 0 } };
  const quiet = desk.render(blank(), 100.1, 120, 1, analysis, 0);
  const loud = desk.render(blank(), 100.1, 120, 1, analysis, 1);
  assert(!lit(quiet));
  assert(lit(loud));
  desk.setPad(1, { mode: 'hit' });
  assert.equal(desk.active.size, 0, 'switching mode ends the previous loop');
});

test('rub targets only illuminate outer columns (I I) and leave center dark', () => {
  const desk = createPerformance();
  desk.setPad(0, { targets: ['L1', 'L2', 'L3', 'R1', 'R2', 'R3'] });
  desk.trigger(0, { clockTime: 10, bpm: 120 });
  const frame = desk.render(blank(), 10.02, 120);
  assert(frame.bars.L1.some(p => p.some(c => c > 0)));
  assert(frame.bars.R1.some(p => p.some(c => c > 0)));
  assert(frame.bars.C1.every(p => p.every(c => c === 0)));
  assert(frame.bars.C2.every(p => p.every(c => c === 0)));
  assert(frame.bars.C3.every(p => p.every(c => c === 0)));
});

test('chase hit with rub targets plays both sides simultaneously on trigger', () => {
  const desk = createPerformance();
  desk.setPad(2, { preset: 'chase', mode: 'hit', intensity: 1, targets: ['L1', 'L2', 'L3', 'R1', 'R2', 'R3'], speed: 1, color: [1, 0, 0, 0] });
  desk.trigger(2, { clockTime: 10, bpm: 120 });
  const frame = desk.render(blank(), 10.05, 120);
  const l1Max = Math.max(...frame.bars.L1.map(p => p[0]));
  const r1Max = Math.max(...frame.bars.R1.map(p => p[0]));
  assert.ok(l1Max > 100, 'L1 should be lit during hit');
  assert.equal(l1Max, r1Max, 'L1 and R1 must be lit simultaneously at the same level');
  assert.deepEqual(frame.bars.L1, frame.bars.R1, 'L1 and R1 must be identical');
  assert.equal(frame.bars.C1.some(p => p.some(c => c > 0)), false, 'Center remains dark');
});

test('live board pads add onto the current playing timeline animation without overwriting it', () => {
  const desk = createPerformance();
  const base = blank();
  for (const id of BAR_IDS) {
    base.bars[id] = Array.from({ length: PIXELS_PER_BAR }, () => [80, 40, 20, 10]);
  }
  // Trigger a flash pad on all bars (adds warm light) and a strobe pad on all bars
  desk.trigger(0, { clockTime: 10, bpm: 120 });
  desk.trigger(3, { clockTime: 10, bpm: 120 });
  const frameOn = desk.render(base, 10.01, 120);
  const frameStrobeOffPhase = desk.render(base, 10.18, 120);

  for (const id of BAR_IDS) {
    for (let p = 0; p < PIXELS_PER_BAR; p++) {
      for (let c = 0; c < 4; c++) {
        assert.ok(frameOn.bars[id][p][c] >= base.bars[id][p][c], `Bar ${id} px ${p} ch ${c} must not be lower than base timeline during flash/strobe`);
        assert.ok(frameStrobeOffPhase.bars[id][p][c] >= base.bars[id][p][c], `Bar ${id} px ${p} ch ${c} must preserve base timeline even during strobe off-phase`);
      }
    }
  }
  assert.ok(frameOn.bars.C2[0][0] > base.bars.C2[0][0], 'Live board adds brightness on top of base timeline');
});



