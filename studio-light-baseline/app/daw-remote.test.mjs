import test from 'node:test';
import assert from 'node:assert/strict';
import { applyTimelineOp, normalizeColor, resolveClipRef } from './daw-remote.mjs';
import { validateTimeline } from './timeline.mjs';

function baseTimeline() {
  return {
    version: 1,
    durationSec: 60,
    bpm: 120,
    beatOffsetSec: 0,
    blackout: false,
    layers: []
  };
}

test('normalizeColor handles hex strings, 4-arrays, and fallbacks', () => {
  assert.deepEqual(normalizeColor('#ff0000'), [1, 0, 0, 0]);
  assert.deepEqual(normalizeColor('#00ff00ff'), [0, 1, 0, 1]);
  assert.deepEqual(normalizeColor([0.5, 0.2, 0.8, 0.1]), [0.5, 0.2, 0.8, 0.1]);
  assert.deepEqual(normalizeColor('invalid'), [1, 1, 1, 0]);
});

test('applyTimelineOp: adds layers, clips, keyframes, splits and modifies', () => {
  const tl = baseTimeline();

  // 1. add_layer
  const { layer } = applyTimelineOp(tl, 'add_layer', { name: 'Main Beats', color: '#3aa0ff', blend: 'screen', opacity: 0.8 });
  assert.equal(tl.layers.length, 1);
  assert.equal(layer.name, 'Main Beats');

  // 2. add_clip
  const { clip } = applyTimelineOp(tl, 'add_clip', {
    layerId: layer.id,
    preset: 'pulse',
    startSec: 4,
    durationSec: 8,
    targets: ['L1', 'C1', 'R1'],
    color: '#ffaa00',
    speed: 2
  });
  assert.equal(layer.clips.length, 1);
  assert.equal(clip.preset, 'pulse');
  assert.deepEqual(clip.targets, ['L1', 'C1', 'R1']);
  assert.equal(clip.durationSec, 8);

  // 3. resolveClipRef by clipId
  const ref = resolveClipRef(tl, clip.id);
  assert.deepEqual(ref, { layerId: layer.id, clipId: clip.id });

  // 4. patch_clips
  applyTimelineOp(tl, 'patch_clips', { clipId: clip.id, patch: { speed: 4, driver: 'drums' } });
  assert.equal(clip.speed, 4);
  assert.equal(clip.driver, 'drums');

  // 5. add_keyframe
  const kfRes = applyTimelineOp(tl, 'add_keyframe', { clipId: clip.id, timeSec: 4, value: 0.5, ease: 'smooth' });
  assert.equal(kfRes.ok, true);
  assert.equal(clip.keyframes.length, 3);

  // 6. split_clip
  const splitRes = applyTimelineOp(tl, 'split_clip', { clipId: clip.id, atSec: 8 });
  assert.equal(splitRes.ok, true);
  assert.equal(layer.clips.length, 2);

  // 7. move_clip
  const secondClipId = layer.clips[1].id;
  applyTimelineOp(tl, 'move_clip', { clipId: secondClipId, startSec: 10 });
  assert.equal(layer.clips[1].startSec, 10);

  // 8. duplicate_clips
  const dupRes = applyTimelineOp(tl, 'duplicate_clips', { clipIds: [secondClipId], offsetSec: 5 });
  assert.equal(dupRes.ok, true);
  assert.equal(layer.clips.length, 3);

  // 9. delete_clips
  applyTimelineOp(tl, 'delete_clips', { clipId: secondClipId });
  assert.equal(layer.clips.length, 2);

  // 10. validate result
  const check = validateTimeline(tl);
  assert.equal(check.valid, true);
});
