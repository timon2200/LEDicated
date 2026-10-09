import test from 'node:test';
import assert from 'node:assert/strict';
import { createStemsEngine, STEM_IDS, STEM_METADATA } from './daw-stems.mjs';

test('stems metadata contains all 4 stems with colors and labels', () => {
  assert.deepEqual(STEM_IDS, ['drums', 'bass', 'vocals', 'other']);
  for (const id of STEM_IDS) {
    const meta = STEM_METADATA[id];
    assert.ok(meta, `metadata exists for ${id}`);
    assert.equal(meta.id, id);
    assert.ok(typeof meta.label === 'string' && meta.label.length > 0);
    assert.ok(typeof meta.color === 'string' && meta.color.startsWith('#'));
  }
});

test('stems engine maintains solo, mute, volume and clean mix state', () => {
  const engine = createStemsEngine(null);
  let notifyCount = 0;
  const unsubscribe = engine.subscribe(() => { notifyCount++; });

  const initial = engine.getState();
  assert.equal(initial.isCleanMix, true);
  assert.equal(initial.solo.size, 0);
  assert.equal(initial.muted.size, 0);
  assert.equal(initial.volumes.drums, 1);

  // Solo drums
  engine.toggleSolo('drums');
  assert.equal(notifyCount, 1);
  let state = engine.getState();
  assert.equal(state.isCleanMix, false);
  assert.ok(state.solo.has('drums'));
  assert.equal(state.solo.size, 1);

  // Shift-solo bass
  engine.toggleSolo('bass', true);
  state = engine.getState();
  assert.ok(state.solo.has('drums'));
  assert.ok(state.solo.has('bass'));
  assert.equal(state.solo.size, 2);

  // Toggle drums off
  engine.toggleSolo('drums');
  state = engine.getState();
  assert.ok(!state.solo.has('drums'));
  assert.ok(state.solo.has('bass'));

  // Reset all
  engine.resetAll();
  state = engine.getState();
  assert.equal(state.isCleanMix, true);
  assert.equal(state.solo.size, 0);

  // Mute vocals
  engine.toggleMute('vocals');
  state = engine.getState();
  assert.equal(state.isCleanMix, false);
  assert.ok(state.muted.has('vocals'));

  // Set volume
  engine.setVolume('bass', 0.75);
  state = engine.getState();
  assert.equal(state.volumes.bass, 0.75);

  // Audition EQ band
  engine.setAuditionBand(60, 250);
  state = engine.getState();
  assert.deepEqual(state.auditionBand, { lowHz: 60, highHz: 250 });
  assert.equal(state.isCleanMix, false);

  engine.setAuditionBand(null);
  state = engine.getState();
  assert.equal(state.auditionBand, null);

  unsubscribe();
  const prevCount = notifyCount;
  engine.toggleSolo('other');
  assert.equal(notifyCount, prevCount);
});
