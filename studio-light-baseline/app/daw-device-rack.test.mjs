import test from 'node:test';
import assert from 'node:assert/strict';
import { TIMELINE_PRESETS, createAutoShow, pattern } from './timeline.mjs';
import { DEVICE_INFO, BAR_PATTERNS } from './daw-editor.mjs';
import { createStore, patchClips } from './daw-state.mjs';

test('all 16 timeline presets have dedicated device info', () => {
  for (const preset of TIMELINE_PRESETS) {
    const dev = DEVICE_INFO[preset];
    assert(dev, `Preset ${preset} must have DEVICE_INFO entry`);
    assert(typeof dev.name === 'string' && dev.name.length > 0, `${preset} has valid name`);
    assert(typeof dev.tag === 'string' && dev.tag.length > 0, `${preset} has valid tag`);
    assert(typeof dev.desc === 'string' && dev.desc.length > 0, `${preset} has valid description`);
    assert(Array.isArray(dev.params) && dev.params.length > 0, `${preset} has params array`);

    for (const p of dev.params) {
      assert(typeof p.key === 'string' && p.key.length > 0, `${preset} param has key`);
      assert(typeof p.title === 'string' && p.title.length > 0, `${preset} param has title`);
      assert(p.default !== undefined, `${preset} param has default value`);
      assert(Array.isArray(p.options) && p.options.length >= 2, `${preset} param has at least 2 options`);
      for (const [optVal, optLabel, optTip] of p.options) {
        assert(optVal !== undefined, `${preset}.${p.key} option has value`);
        assert(typeof optLabel === 'string' && optLabel.length > 0, `${preset}.${p.key} option has label`);
        assert(typeof optTip === 'string' && optTip.length > 0, `${preset}.${p.key} option has tooltip`);
      }
    }
  }
});

test('pattern renders with each preset custom params without NaN or throwing', () => {
  for (const preset of TIMELINE_PRESETS) {
    const dev = DEVICE_INFO[preset];
    for (const p of dev.params) {
      for (const [optVal] of p.options) {
        const clip = {
          preset,
          speed: 1,
          timing: 'beat',
          direction: 'ltr',
          motionMode: 'serial',
          targets: 'all',
          params: { [p.key]: optVal }
        };
        for (let r = 0; r < 3; r++) {
          for (let c = 0; c < 3; c++) {
            const v = pattern(preset, r, c, 5, 1.25, 0.5, 0.5, clip);
            assert(typeof v === 'number' && Number.isFinite(v), `${preset} with ${p.key}=${optVal} produced finite number`);
            assert(v >= 0 && v <= 1, `${preset} with ${p.key}=${optVal} produced value between 0 and 1, got ${v}`);
          }
        }
      }
    }
  }
});

test('patchClips merges params into clip without wiping existing params', () => {
  const analysis = { durationSec: 60, bpm: 120, beatsSec: [0, 0.5, 1.0], features: { drums: [], bass: [] } };
  const store = createStore(createAutoShow(analysis));
  const timeline = store.timeline;
  const clip = timeline.layers[0].clips[0];
  const ref = { layerId: timeline.layers[0].id, clipId: clip.id };

  patchClips(timeline, [ref], { params: { beam: 'razor' } });
  assert.equal(clip.params?.beam, 'razor');

  patchClips(timeline, [ref], { params: { glow: 0.15 } });
  assert.equal(clip.params?.beam, 'razor', 'Previous param retained');
  assert.equal(clip.params?.glow, 0.15, 'New param merged');
});

test('BAR_PATTERNS matches exact 2x3 layout and Rub definition', () => {
  assert.equal(BAR_PATTERNS.length, 6, 'Must have exactly 6 patterns');
  const labels = BAR_PATTERNS.map(([name]) => name);
  assert.deepEqual(labels, ['Lijevo', 'Centar', 'Desno', 'Rub', 'Svi', 'Križ']);

  const map = Object.fromEntries(BAR_PATTERNS.map(([name, , fn]) => [name, fn()]));
  assert.deepEqual(map['Lijevo'], ['L1', 'L2', 'L3']);
  assert.deepEqual(map['Centar'], ['C1', 'C2', 'C3']);
  assert.deepEqual(map['Desno'], ['R1', 'R2', 'R3']);
  assert.deepEqual(map['Rub'], ['L1', 'L2', 'L3', 'R1', 'R2', 'R3']);
  assert(!map['Rub'].includes('C1') && !map['Rub'].includes('C2') && !map['Rub'].includes('C3'), 'Rub must not include center column');
  assert.deepEqual(map['Svi'], ['L1', 'C1', 'R1', 'L2', 'C2', 'R2', 'L3', 'C3', 'R3']);
  assert.deepEqual(map['Križ'], ['C1', 'L2', 'C2', 'R2', 'C3']);
});
