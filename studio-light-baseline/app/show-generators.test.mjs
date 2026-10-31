import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_PIPELINE_CONFIG,
  DEFAULT_VIBECODE_TEMPLATE,
  BUILT_IN_GENERATORS,
  mergePipelineConfig,
  resolveGeneratorConfig,
  runShowPipeline,
  executeCustomGeneratorCode,
  serializeGeneratorSpec,
  validateGeneratorSpec,
  buildVibecodePrompt
} from './show-generators.mjs';
import {
  validateTimeline,
  adjustClipsForSectionBoundary,
  regenerateSectionClips
} from './timeline.mjs';
import { detectSections } from './audio-sections.mjs';
import { createLightingServer } from './server.mjs';

function makeMockTrackAnalysis() {
  const durationSec = 96;
  const bpm = 128;
  const binSec = 0.05;
  const hopSec = 0.05;
  const n = Math.floor(durationSec / binSec);
  const rms = new Array(n).fill(0.25);
  const drums = new Array(n).fill(0.22);
  const bass = new Array(n).fill(0.20);
  const vocals = new Array(n).fill(0.18);
  const other = new Array(n).fill(0.20);

  for (let i = 0; i < n; i++) {
    const t = i * binSec;
    if (t < 15) {
      rms[i] = 0.22;
      drums[i] = 0.18;
      bass[i] = 0.15;
    } else if (t < 30) {
      const p = (t - 15) / 15;
      rms[i] = 0.35 + p * 0.42;
      drums[i] = 0.35 + p * 0.50;
      bass[i] = 0.25 + p * 0.20;
      other[i] = 0.30 + p * 0.45;
    } else if (t < 60) {
      rms[i] = 0.90;
      drums[i] = 0.88;
      bass[i] = 0.92;
      other[i] = 0.78;
    } else if (t < 78) {
      rms[i] = 0.30;
      drums[i] = 0.15;
      bass[i] = 0.16;
      vocals[i] = 0.72;
    } else {
      rms[i] = 0.20;
      drums[i] = 0.15;
      bass[i] = 0.12;
    }
  }

  return {
    durationSec,
    bpm,
    beatOffsetSec: 0,
    beatsSec: Array.from({ length: Math.floor(durationSec / (60 / bpm)) }, (_, k) => k * (60 / bpm)),
    waveform: { rms, binSec },
    features: { drums, bass, vocals, other, hopSec, startSec: 0 }
  };
}

test('all 5 built-in show generators produce valid 5-layer timelines', () => {
  const analysis = makeMockTrackAnalysis();
  assert.equal(BUILT_IN_GENERATORS.length, 5);

  for (const gen of BUILT_IN_GENERATORS) {
    const { timeline, sections, config } = runShowPipeline(analysis, {
      generatorId: gen.id,
      recomputeSections: true
    });
    assert.ok(sections.length >= 2, `generator ${gen.id} should detect sections`);
    const check = validateTimeline(timeline);
    assert.equal(check.valid, true, `generator ${gen.id} timeline invalid: ${check.errors.join('; ')}`);
    assert.equal(timeline.layers.length, 5);
    assert.equal(config.generatorId, gen.id);
  }
});

test('pipeline parameters control W-channel, non-drop ceiling, strobe, zones, and layers', () => {
  const analysis = makeMockTrackAnalysis();
  const { timeline } = runShowPipeline(analysis, {
    generatorId: 'club-5layer-pro',
    recomputeSections: true,
    nonDropCeiling: 0.35,
    wChannelMode: 'never',
    preDropBlackoutMode: 'fixed',
    preDropBlackoutBeats: 2,
    dropBlinder: false,
    dropStrobeDurationSec: 0,
    dropRhythmStyle: 'columns',
    buildSpiralAccel: false,
    zones: {
      washZone: 'topRow',
      bassZone: 'bottomRow',
      vocalZone: 'center',
      strobeZone: 'upperCross',
      accentZone: 'corners'
    },
    layerConfig: {
      'base-wash': { enabled: true, blend: 'max', opacity: 0.5 }
    }
  });

  const check = validateTimeline(timeline);
  assert.equal(check.valid, true);

  const washLayer = timeline.layers.find(l => l.id === 'base-wash');
  assert.equal(washLayer.blend, 'max');
  assert.equal(washLayer.opacity, 0.5);

  // With wChannelMode: 'never', no clip should have W > 0
  for (const layer of timeline.layers) {
    for (const clip of layer.clips) {
      assert.equal(clip.color[3], 0, `clip ${clip.id} should have W=0 when wChannelMode='never'`);
    }
  }

  // With dropBlinder: false and dropStrobeDurationSec: 0, no acc-drop-hit or acc-drop-str clips
  const drumLayer = timeline.layers.find(l => l.id === 'drums');
  assert.equal(drumLayer.clips.some(c => c.id.startsWith('acc-drop-hit-')), false);
  assert.equal(drumLayer.clips.some(c => c.id.startsWith('acc-drop-str-')), false);

  // With dropRhythmStyle: 'columns', drop rhythm uses rhy-drop-col-*
  const motionLayer = timeline.layers.find(l => l.id === 'motion');
  assert.equal(motionLayer.clips.some(c => c.id.startsWith('rhy-drop-col-')), true);
});

test('detectSections honors custom phraseBars and drop thresholds', () => {
  const analysis = makeMockTrackAnalysis();
  const defaultSections = detectSections(analysis);
  const strictSections = detectSections(analysis, {
    phraseBars: 2,
    dropRmsThreshold: 0.95,
    dropBassThreshold: 0.94,
    snapDropToBeat: false
  });
  assert.ok(defaultSections.length >= 2);
  assert.ok(strictSections.length >= 2);
});

test('executeCustomGeneratorCode runs vibecoded JS generator with DEFAULT_VIBECODE_TEMPLATE', () => {
  const analysis = makeMockTrackAnalysis();
  analysis.sections = detectSections(analysis);

  const timeline = executeCustomGeneratorCode(
    DEFAULT_VIBECODE_TEMPLATE,
    analysis,
    DEFAULT_PIPELINE_CONFIG
  );
  const check = validateTimeline(timeline);
  assert.equal(check.valid, true);
  const drumLayer = timeline.layers.find(l => l.id === 'drums');
  assert.equal(drumLayer.clips.some(c => c.id.startsWith('vibe-drop-spiral-')), true);
});

test('serializeGeneratorSpec, validateGeneratorSpec, and buildVibecodePrompt work cleanly', () => {
  const spec = serializeGeneratorSpec({
    id: 'My Custom Vibe!',
    name: 'My Custom Vibe',
    author: 'Timon',
    description: 'Testni algoritam'
  }, {
    ...DEFAULT_PIPELINE_CONFIG,
    theme: 'cyber',
    useCustomJsCode: true,
    customJsCode: DEFAULT_VIBECODE_TEMPLATE
  });

  assert.equal(spec.id, 'my-custom-vibe');
  assert.equal(spec.useCustomJsCode, true);
  const validation = validateGeneratorSpec(spec);
  assert.equal(validation.valid, true);

  const prompt = buildVibecodePrompt(DEFAULT_PIPELINE_CONFIG);
  assert.ok(prompt.includes('generateShow(analysis, config, api)'));
  assert.ok(prompt.includes('upperCross'));
});

test('/api/generators lists, saves, and deletes Git-shared .generator.json files', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'ledicated-gen-test-'));
  const srv = createLightingServer({
    configPath: join(tmp, 'config.json'),
    libraryRoot: join(tmp, 'data'),
    sharedShowsDir: join(tmp, 'shared-shows'),
    generatorsDir: join(tmp, 'generators'),
    allowLoopback: true,
    cloudEnabled: false,
    enableDiskLog: false
  });
  await new Promise(done => srv.server.listen(0, '127.0.0.1', done));
  const port = srv.server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const listRes1 = await fetch(`${baseUrl}/api/generators`);
    assert.equal(listRes1.status, 200);
    const listData1 = await listRes1.json();
    assert.equal(listData1.ok, true);
    assert.equal(listData1.builtin.length, 5);
    assert.equal(listData1.shared.length, 0);

    const saveRes = await fetch(`${baseUrl}/api/generators/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        meta: {
          id: 'test-git-vibe',
          name: 'Test Git Vibe',
          author: 'Tester',
          description: 'Git test'
        },
        config: {
          theme: 'rave',
          nonDropCeiling: 0.42
        }
      })
    });
    assert.equal(saveRes.status, 200);
    const saveData = await saveRes.json();
    assert.equal(saveData.ok, true);
    assert.equal(saveData.generator.id, 'test-git-vibe');

    const listRes2 = await fetch(`${baseUrl}/api/generators`);
    const listData2 = await listRes2.json();
    assert.equal(listData2.shared.length, 1);
    assert.equal(listData2.shared[0].name, 'Test Git Vibe');

    const delRes = await fetch(`${baseUrl}/api/generators/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'test-git-vibe' })
    });
    assert.equal(delRes.status, 200);

    const listRes3 = await fetch(`${baseUrl}/api/generators`);
    const listData3 = await listRes3.json();
    assert.equal(listData3.shared.length, 0);
  } finally {
    await srv.close();
    await rm(tmp, { recursive: true, force: true });
  }
});

test('fine-tuned sections are preserved across regenerations and boundary drag adjusts aligned clips', () => {
  const analysis = makeMockTrackAnalysis();
  // Explicitly define fine-tuned sections (Intro -> Build -> Drop -> Outro)
  const fineTunedSections = [
    { id: 'sec-1', type: 'intro', name: 'Intro', color: '#3a86ff', startSec: 0, endSec: 16, durationSec: 16 },
    { id: 'sec-2', type: 'build', name: 'Gradnja', color: '#ffbe0b', startSec: 16, endSec: 32, durationSec: 16 },
    { id: 'sec-3', type: 'drop', name: 'Drop', color: '#ff006e', startSec: 32, endSec: 64, durationSec: 32 },
    { id: 'sec-4', type: 'outro', name: 'Outro', color: '#fb5607', startSec: 64, endSec: 96, durationSec: 32 }
  ];
  analysis.sections = structuredClone(fineTunedSections);

  // 1. Regenerate with recomputeSections: false (default after fine-tuning)
  const { timeline, sections } = runShowPipeline(analysis, {
    generatorId: 'club-5layer-pro',
    theme: 'cyber',
    recomputeSections: false
  });
  assert.deepEqual(
    sections.map(s => [s.type, s.startSec, s.endSec]),
    fineTunedSections.map(s => [s.type, s.startSec, s.endSec]),
    'Fine-tuned sections must remain untouched when regenerating show'
  );

  // 2. Drag the boundary between Build (sec-2) and Drop (sec-3) from 32s to 28s
  const prevSec = sections[1]; // Build
  const curSec = sections[2];  // Drop
  const oldBoundary = 32;
  const newBoundary = 28;
  prevSec.endSec = newBoundary;
  prevSec.durationSec = newBoundary - prevSec.startSec;
  curSec.startSec = newBoundary;
  curSec.durationSec = curSec.endSec - newBoundary;

  adjustClipsForSectionBoundary(timeline, prevSec, curSec, oldBoundary, newBoundary);

  const checkAfterShrink = validateTimeline(timeline);
  assert.equal(checkAfterShrink.valid, true, `Timeline valid after moving boundary 32->28: ${checkAfterShrink.errors.join('; ')}`);

  // Verify Drop base wash and Beat-1 blinder moved to newBoundary (28s)
  const washLayer = timeline.layers.find(l => l.id === 'base-wash');
  const dropWash = washLayer.clips.find(c => c.id === 'wash-drop-rip-2');
  assert.ok(dropWash, 'Drop wash clip should exist');
  assert.equal(dropWash.startSec, 28, 'Drop wash startSec should move from 32s to 28s');
  assert.equal(dropWash.durationSec, 36, 'Drop wash durationSec should stretch from 32s to 36s (28..64)');

  const drumLayer = timeline.layers.find(l => l.id === 'drums');
  const dropBlinder = drumLayer.clips.find(c => c.id === 'acc-drop-hit-2');
  assert.ok(dropBlinder, 'Drop Beat-1 blinder should exist');
  assert.equal(dropBlinder.startSec, 28, 'Drop Beat-1 blinder should move to new Drop start (28s)');

  // Verify Build clips were trimmed/anchored to end at or before 28s (minus pre-drop blackout)
  for (const layer of timeline.layers) {
    for (const c of layer.clips) {
      if (c.id.includes('-bld-') && c.id.endsWith('-1')) {
        assert.ok(c.startSec + c.durationSec <= 28.05, `Build clip ${c.id} should not exceed new boundary 28s`);
      }
    }
  }
});

test('targeted single & multi-section regeneration updates only selected sections', () => {
  const analysis = makeMockTrackAnalysis();
  analysis.sections = [
    { id: 'sec-1', type: 'intro', name: 'Intro', color: '#3a86ff', startSec: 0, endSec: 16, durationSec: 16 },
    { id: 'sec-2', type: 'build', name: 'Gradnja', color: '#ffbe0b', startSec: 16, endSec: 32, durationSec: 16 },
    { id: 'sec-3', type: 'drop', name: 'Drop', color: '#ff006e', startSec: 32, endSec: 64, durationSec: 32 },
    { id: 'sec-4', type: 'outro', name: 'Outro', color: '#fb5607', startSec: 64, endSec: 96, durationSec: 32 }
  ];

  const initial = runShowPipeline(analysis, {
    generatorId: 'club-5layer-pro',
    theme: 'midnight',
    recomputeSections: false
  });
  const baseTimeline = initial.timeline;

  // Add a custom sentinel clip inside Intro (0..16s) and Build (16..32s) that should NOT be touched when regenerating only Drop (index 2) and Outro (index 3)
  baseTimeline.layers[0].clips.push({
    id: 'custom-intro-sentinel',
    startSec: 2,
    durationSec: 4,
    preset: 'sparkle',
    targets: 'all',
    driver: 'none',
    driverGain: 1,
    speed: 1,
    color: [0.1, 0.9, 0.2, 0],
    keyframes: [{ timeSec: 0, value: 1 }, { timeSec: 4, value: 1 }]
  });
  baseTimeline.layers[0].clips.push({
    id: 'custom-build-sentinel',
    startSec: 18,
    durationSec: 4,
    preset: 'wave',
    targets: 'all',
    driver: 'none',
    driverGain: 1,
    speed: 1,
    color: [0.9, 0.5, 0.1, 0],
    keyframes: [{ timeSec: 0, value: 1 }, { timeSec: 4, value: 1 }]
  });
  // Also add a sentinel inside Drop (32..64s) that SHOULD be replaced when Drop is selected
  baseTimeline.layers[0].clips.push({
    id: 'custom-drop-to-replace',
    startSec: 40,
    durationSec: 4,
    preset: 'wash',
    targets: 'all',
    driver: 'none',
    driverGain: 1,
    speed: 1,
    color: [1, 0, 0, 0],
    keyframes: [{ timeSec: 0, value: 1 }, { timeSec: 4, value: 1 }]
  });

  // Regenerate ONLY sections [2, 3] (Drop + Outro) with a new theme ('rave')
  const regenResult = runShowPipeline(analysis, {
    generatorId: 'festival-blinder',
    theme: 'rave',
    recomputeSections: false,
    targetSectionIndices: [2, 3],
    existingTimeline: baseTimeline
  });

  const updated = regenResult.timeline;
  const check = validateTimeline(updated);
  assert.equal(check.valid, true);

  // Intro and Build sentinels must still be present!
  const l0Ids = updated.layers[0].clips.map(c => c.id);
  assert.equal(l0Ids.includes('custom-intro-sentinel'), true, 'Unselected Intro section clip must be preserved');
  assert.equal(l0Ids.includes('custom-build-sentinel'), true, 'Unselected Build section clip must be preserved');
  assert.equal(l0Ids.includes('custom-drop-to-replace'), false, 'Selected Drop section old clip must be replaced');
});
