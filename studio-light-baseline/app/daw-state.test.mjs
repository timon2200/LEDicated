import test from 'node:test';
import assert from 'node:assert/strict';
import { createAutoShow, validateTimeline, renderTimelineFrame } from './timeline.mjs';
import {
  addClip, addKeyframe, addLayer, beatPosition, clipEnd, clipsInRect, copyClips, createStore, deleteClips, duplicateClips, duplicateLayer, envelopeAt,
  findClip, formatBBT, formatClock, gridBeats, moveClip, moveKeyframe, moveKeyframes, normalizeTimeline, pasteClips, patchClips, removeKeyframe, removeKeyframes, resizeClip, snapStepSec,
  snapTime, splitClip, timeAtBeat, toggleTarget, trimKeyframes
} from './daw-state.mjs';

const analysis = () => ({ durationSec: 60, bpm: 120, beatsSec: Array.from({ length: 120 }, (_, i) => 0.25 + i * .5), features: { hopSec: .05, startSec: 0, drums: [], bass: [] } });
const fresh = () => normalizeTimeline(createAutoShow(analysis()));
const blank = () => { const t = fresh(); t.layers = []; addLayer(t, { name: 'A' }); addLayer(t, { name: 'B' }); return t; };

test('auto show is normalised and still valid', () => {
  const t = fresh();
  assert(t.layers.every(l => l.name && /^#/.test(l.color)));
  assert.equal(validateTimeline(t).valid, true);
});

test('envelope and trimming preserve boundary values', () => {
  const keys = [{ timeSec: 0, value: 0 }, { timeSec: 2, value: 1 }, { timeSec: 4, value: 0 }];
  assert.equal(envelopeAt(keys, 1), .5);
  const trimmed = trimKeyframes(keys, 1, 3);
  assert.deepEqual(trimmed.map(k => [k.timeSec, k.value]), [[0, .5], [1, 1], [2, .5]]);
});

test('beat grid: analysis grid, manual grid, bbt and inverse', () => {
  const t = fresh(), a = analysis();
  assert.equal(gridBeats(t, a).length, 120);
  assert.equal(beatPosition(.25, t, a), 0);
  assert.equal(beatPosition(.75, t, a), 1);
  assert.equal(timeAtBeat(8.5, t, a), .25 + 4.25);
  assert(Math.abs(beatPosition(timeAtBeat(7.3, t, a), t, a) - 7.3) < 1e-9);
  assert.equal(formatBBT(0), '1:1:00');
  assert.equal(formatBBT(5.5), '2:2:50');
  assert.equal(formatBBT(-1), '0:4:00');
  t.gridMode = 'manual'; t.bpm = 60; t.beatOffsetSec = 1;
  assert.equal(gridBeats(t, a).length, 0);
  assert.equal(beatPosition(3, t, a), 2);
  assert.equal(formatClock(61.5), '1:01.500');
});

test('snap modes', () => {
  const t = fresh(), a = analysis();
  assert.equal(snapTime(1.1, 'none', t, a), 1.1);
  assert.equal(snapTime(1.1, 1, t, a), 1.25);
  assert.equal(snapTime(1.1, 2, t, a), 1);
  assert.equal(snapTime(3.1, 'bar', t, a), 2.25);
  assert.equal(snapTime(3.9, 'bar', t, a), 4.25);
  assert(Math.abs(snapStepSec('bar', t, a, 1) - 2) < 1e-9);
  assert(Math.abs(snapStepSec(2, t, a, 1) - .25) < 1e-9);
});

test('add, move across layers, resize and split keep a valid timeline', () => {
  const t = blank(), [A, B] = t.layers.map(l => l.id);
  const ref = addClip(t, A, { startSec: 4, durationSec: 4, preset: 'wave' });
  assert.equal(validateTimeline(t).valid, true);
  const moved = moveClip(t, ref, { startSec: 10, layerId: B });
  assert.equal(moved.layerId, B);
  assert.equal(findClip(t, moved).clip.startSec, 10);
  assert.equal(t.layers[0].clips.length, 0);
  assert(resizeClip(t, moved, 'end', 11));
  assert.equal(findClip(t, moved).clip.durationSec, 1);
  assert(resizeClip(t, moved, 'start', 10.4));
  const clip = findClip(t, moved).clip;
  assert(Math.abs(clip.startSec - 10.4) < 1e-9 && Math.abs(clipEnd(clip) - 11) < 1e-9);
  assert.equal(validateTimeline(t).valid, true);
  assert(resizeClip(t, moved, 'start', 9));
  assert(resizeClip(t, moved, 'end', 13));
  assert.equal(validateTimeline(t).valid, true);
  const parts = splitClip(t, moved, 10);
  assert.equal(parts.length, 2);
  assert.equal(t.layers[1].clips.length, 2);
  assert.equal(validateTimeline(t).valid, true);
  assert.equal(splitClip(t, parts[0], 9), null, 'split outside clip is refused');
});

test('minimum length is enforced on resize', () => {
  const t = blank(), ref = addClip(t, t.layers[0].id, { startSec: 1, durationSec: 2 });
  resizeClip(t, ref, 'end', 0);
  assert(findClip(t, ref).clip.durationSec >= .05);
  resizeClip(t, ref, 'start', 99);
  assert(findClip(t, ref).clip.durationSec >= .05);
  assert.equal(validateTimeline(t).valid, true);
});

test('duplicate, copy/paste, delete and rubber band', () => {
  const t = blank(), [A, B] = t.layers.map(l => l.id);
  const r1 = addClip(t, A, { startSec: 1, durationSec: 1 }), r2 = addClip(t, B, { startSec: 3, durationSec: 1 });
  const copies = duplicateClips(t, [r1, r2], 10, 0);
  assert.equal(copies.length, 2);
  assert.equal(findClip(t, copies[0]).clip.startSec, 11);
  const board = copyClips(t, [r1, r2]);
  const pasted = pasteClips(t, board, 20, 0);
  assert.equal(findClip(t, pasted[0]).clip.startSec, 20);
  assert.equal(findClip(t, pasted[1]).clip.startSec, 22);
  assert.equal(findClip(t, pasted[1]).layer.id, B);
  assert.equal(validateTimeline(t).valid, true);
  assert.equal(clipsInRect(t, 0.5, 3.5, 0, 1).length, 2);
  assert.equal(clipsInRect(t, 0.5, 3.5, 0, 0).length, 1);
  assert.equal(deleteClips(t, [r1, r2, ...copies]), 4);
  assert.equal(t.layers[0].clips.length + t.layers[1].clips.length, 2);
});

test('paste clamps layer offsets near the bottom', () => {
  const t = blank(), [A, B] = t.layers.map(l => l.id);
  const board = copyClips(t, [addClip(t, A, { startSec: 0, durationSec: 1 }), addClip(t, B, { startSec: 0, durationSec: 1 })]);
  const pasted = pasteClips(t, board, 5, 1);
  assert.deepEqual(pasted.map(r => r.layerId), [A, B]);
});

test('keyframe edits stay ordered and bounded', () => {
  const t = blank(), ref = addClip(t, t.layers[0].id, { startSec: 0, durationSec: 4 }), clip = findClip(t, ref).clip;
  const i = addKeyframe(clip, 2, .3);
  assert.equal(i, 1);
  assert.equal(addKeyframe(clip, 2.001, .9), -1);
  moveKeyframe(clip, 1, 99, 5);
  assert(clip.keyframes[1].timeSec < 4 && clip.keyframes[1].value === 1);
  assert.equal(removeKeyframe(clip, 1), true);
  assert.equal(removeKeyframe({ keyframes: [{ timeSec: 0, value: 1 }] }, 0), false);
  assert.equal(validateTimeline(t).valid, true);
});

test('multi-keyframe move and delete stay ordered, bounded and preserve relative offsets', () => {
  const t = blank(), ref = addClip(t, t.layers[0].id, { startSec: 0, durationSec: 10 }), clip = findClip(t, ref).clip;
  // setup points at 0, 2, 4, 6, 8, 10
  clip.keyframes = [
    { timeSec: 0, value: 0 },
    { timeSec: 2, value: 0.2 },
    { timeSec: 4, value: 0.5 },
    { timeSec: 6, value: 0.7 },
    { timeSec: 8, value: 0.9 },
    { timeSec: 10, value: 1 }
  ];
  assert.equal(validateTimeline(t).valid, true);

  // Move points 1 and 2 (timeSec 2 and 4) by dt = 1.0, dv = 0.1
  const initial = clip.keyframes.map(k => ({ ...k }));
  moveKeyframes(clip, initial, [1, 2], 1.0, 0.1);
  assert.equal(clip.keyframes[1].timeSec, 3.0);
  assert.equal(clip.keyframes[2].timeSec, 5.0);
  assert.equal(Math.round(clip.keyframes[1].value * 10) / 10, 0.3);
  assert.equal(Math.round(clip.keyframes[2].value * 10) / 10, 0.6);
  // Unselected points unchanged
  assert.equal(clip.keyframes[0].timeSec, 0);
  assert.equal(clip.keyframes[3].timeSec, 6);
  assert.equal(validateTimeline(t).valid, true);

  // Dragging past bounds clamps cleanly without collision
  moveKeyframes(clip, initial, [1, 2], -5.0, -2.0);
  assert(clip.keyframes[1].timeSec > clip.keyframes[0].timeSec);
  assert(clip.keyframes[2].timeSec > clip.keyframes[1].timeSec);
  assert(clip.keyframes[1].value >= 0);
  assert.equal(validateTimeline(t).valid, true);

  // Delete multiple keyframes (points at 1, 2, 3)
  assert.equal(removeKeyframes(clip, [1, 2, 3]), true);
  assert.equal(clip.keyframes.length, 3);
  assert.deepEqual(clip.keyframes.map(k => k.timeSec), [0, 8, 10]);
  assert.equal(validateTimeline(t).valid, true);

  // Deleting all remaining keyframes falls back to flat endpoints
  assert.equal(removeKeyframes(clip, [0, 1, 2]), true);
  assert.equal(clip.keyframes.length, 2);
  assert.equal(clip.keyframes[0].timeSec, 0);
  assert.equal(clip.keyframes[1].timeSec, 10);
  assert.equal(validateTimeline(t).valid, true);
});

test('targets toggle never becomes empty and collapses to all', () => {
  assert.deepEqual(toggleTarget('all', 'C2'), ['L1', 'C1', 'R1', 'L2', 'R2', 'L3', 'C3', 'R3']);
  assert.deepEqual(toggleTarget(['L1'], 'L1'), ['L1']);
  assert.deepEqual(toggleTarget(['L1'], 'C1'), ['L1', 'C1']);
  assert.equal(toggleTarget(['L1', 'C1', 'R1', 'L2', 'C2', 'R2', 'L3', 'C3'], 'R3'), 'all');
});

test('patchClips applies preset, colour, driver, targets, speed, chaseMode, direction, timing and motionMode', () => {
  const t = blank(), ref = addClip(t, t.layers[0].id, { startSec: 0, durationSec: 1 });
  patchClips(t, [ref], { preset: 'chase', color: [2, 0, -1, .5], driver: 'bass', driverGain: 9, targets: ['C1'], speed: 8, chaseMode: 'syncRow', direction: 'rtl', timing: 'bar', motionMode: 'sync' });
  const clip = findClip(t, ref).clip;
  assert.deepEqual([clip.preset, clip.driver, clip.driverGain, clip.targets, clip.speed, clip.chaseMode, clip.direction, clip.timing, clip.motionMode], ['chase', 'bass', 2, ['C1'], 8, 'syncRow', 'rtl', 'bar', 'sync']);
  assert.deepEqual(clip.color, [1, 0, 0, .5]);
  assert.equal(validateTimeline(t).valid, true);
});

test('layer duplicate keeps unique ids', () => {
  const t = fresh();
  const copy = duplicateLayer(t, t.layers[0].id);
  assert.notEqual(copy.id, t.layers[0].id);
  assert.equal(validateTimeline(t).valid, true);
});

test('store: undo/redo, gestures coalesce, invalid commit rolls back', () => {
  const store = createStore(blank());
  const A = store.timeline.layers[0].id;
  let ref;
  store.commit('Dodaj clip', t => { ref = addClip(t, A, { startSec: 1, durationSec: 2 }); });
  assert.equal(store.timeline.layers[0].clips.length, 1);
  store.begin();
  for (const x of [2, 3, 4, 5]) store.update(t => moveClip(t, ref, { startSec: x }));
  assert.equal(store.end('Pomakni'), true);
  assert.equal(findClip(store.timeline, ref).clip.startSec, 5);
  store.undo();
  assert.equal(findClip(store.timeline, ref).clip.startSec, 1, 'whole drag undone in one step');
  store.undo();
  assert.equal(store.timeline.layers[0].clips.length, 0);
  assert.equal(store.canUndo, false);
  store.redo(); store.redo();
  assert.equal(findClip(store.timeline, ref).clip.startSec, 5);
  const result = store.commit('Loše', t => { t.layers[0].opacity = 5; });
  assert(result.error);
  assert.equal(store.timeline.layers[0].opacity, .7);
  store.begin(); store.end('Ništa');
  assert.equal(store.undoLabel, 'Pomakni');
});

test('edited timeline renders deterministic RGBW frames', () => {
  const t = fresh();
  const ref = addClip(t, t.layers[0].id, { startSec: 5, durationSec: 4, preset: 'flash', color: [0, 0, 0, 1], targets: ['C2'] });
  const frame = renderTimelineFrame(t, analysis(), 6, null);
  assert(frame.bars.C2.some(p => p[3] > 0));
  assert.deepEqual(renderTimelineFrame(t, analysis(), 6, null), frame);
  assert(ref);
});
