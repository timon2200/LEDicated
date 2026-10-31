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

test('Clip editor layout places effect device rack below Tajmiranje and omits Položaj u pjesmi and Izvođenje animacije', async () => {
  const { readFile } = await import('node:fs/promises');
  const editorSrc = await readFile(new URL('./daw-editor.mjs', import.meta.url), 'utf8');
  const dawSrc = await readFile(new URL('./daw.mjs', import.meta.url), 'utf8');

  assert(
    editorSrc.includes("const sideControls = h('div', { class: 'bp-side-controls' }, timingGroup, effectDeviceRack(clip));"),
    'effectDeviceRack must be placed directly below timingGroup inside bp-side-controls'
  );
  assert(
    !editorSrc.includes('ce-timing-card'),
    'Položaj u pjesmi card (ce-timing-card) must be removed from render()'
  );
  assert(
    !editorSrc.includes("'Izvođenje animacije'"),
    'Izvođenje animacije toggle group must be removed from barPicker'
  );
  const docksMatch = dawSrc.match(/const DOCKS = \[([\s\S]*?)\];/);
  assert(docksMatch, 'DOCKS array must exist in daw.mjs');
  const docksBody = docksMatch[1];
  assert(!docksBody.includes("'mixer'"), 'Mixer tab must be removed from DOCKS');
  assert(!docksBody.includes("'live'"), 'Audio uživo tab must be removed from DOCKS');
  assert(!docksBody.includes("'output'"), 'Izlaz tab must be removed from DOCKS');
  assert(docksBody.includes("'clip'") && docksBody.includes("'envelope'") && docksBody.includes("'driver'") && docksBody.includes("'autoshow'") && docksBody.includes("'perform'"), 'Remaining tabs must be preserved');
});

test('sweep, rain, wave, chase, and columns support reverse direction (e.g. bottom-to-top btt/reverse)', () => {
  const beatSec = 0.5; // cycle for sweep is beatSec * 2 = 1.0s

  // 1. Vertical sweep normal (top-to-bottom) vs reverse (bottom-to-top)
  const sweepDown = { preset: 'sweep', direction: 'ttb', params: { style: 'vert', dir: 'normal' } };
  const sweepUpParam = { preset: 'sweep', direction: 'ttb', params: { style: 'vert', dir: 'reverse' } };
  const sweepUpCompass = { preset: 'sweep', direction: 'btt', params: {} };

  // At t = 0.1s (early in cycle): normal sweep is near top (row 0), reverse sweep is near bottom (row 2)
  const downEarlyTop = pattern('sweep', 0, 1, 2, 0.1, 0.1, beatSec, sweepDown);
  const downEarlyBot = pattern('sweep', 2, 1, 9, 0.1, 0.1, beatSec, sweepDown);
  assert(downEarlyTop > downEarlyBot, 'Normal vertical sweep starts at top row');

  const upParamEarlyTop = pattern('sweep', 0, 1, 2, 0.1, 0.1, beatSec, sweepUpParam);
  const upParamEarlyBot = pattern('sweep', 2, 1, 9, 0.1, 0.1, beatSec, sweepUpParam);
  assert(upParamEarlyBot > upParamEarlyTop, 'Reverse vertical sweep (params.dir=reverse) starts at bottom row');

  const upCompassEarlyTop = pattern('sweep', 0, 1, 2, 0.1, 0.1, beatSec, sweepUpCompass);
  const upCompassEarlyBot = pattern('sweep', 2, 1, 9, 0.1, 0.1, beatSec, sweepUpCompass);
  assert(upCompassEarlyBot > upCompassEarlyTop, 'Reverse vertical sweep (direction=btt) starts at bottom row');

  // At t = 0.9s (late in cycle): reverse sweep reaches top row (row 0)
  const upParamLateTop = pattern('sweep', 0, 1, 2, 0.9, 0.9, beatSec, sweepUpParam);
  const upParamLateBot = pattern('sweep', 2, 1, 9, 0.9, 0.9, beatSec, sweepUpParam);
  assert(upParamLateTop > upParamLateBot, 'Reverse vertical sweep reaches top row at end of cycle');

  // 2. Rain normal (down) vs reverse (up)
  const rainDown = { preset: 'rain', params: { dir: 'down', spread: 'sync' } };
  const rainUp = { preset: 'rain', params: { dir: 'up', spread: 'sync' } };
  const rDownTop = pattern('rain', 0, 1, 0, 0.05, 0.05, beatSec, rainDown);
  const rUpTop = pattern('rain', 0, 1, 0, 0.05, 0.05, beatSec, rainUp);
  assert.notEqual(rDownTop, rUpTop, 'Rain up and down produce distinct vertical phase progression');
});
