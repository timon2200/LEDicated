import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  TIMELINE_PRESETS,
  createAutoShow,
  validateTimeline,
  renderTimelineFrame,
  regenerateSectionClips,
  sanitizeKeyframes
} from './timeline.mjs';
import {
  createStore,
  normalizeTimeline,
  sanitizeTimelineClips,
  addLayer,
  addClip,
  moveClip,
  resizeClip,
  splitClip,
  duplicateClips,
  deleteClips,
  addKeyframe,
  moveKeyframe,
  moveKeyframes,
  removeKeyframe,
  removeKeyframes,
  setKeyframeEase,
  allRefs,
  findClip
} from './daw-state.mjs';
import { applyTimelineOp } from './daw-remote.mjs';
import { createSessionRecorder } from './live-session-recorder.mjs';
import { DEFAULT_PADS, normalizePad } from './live-performance-state.mjs';
import { createLightingServer } from './server.mjs';

function makeSeededRng(seed = 1337) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function makeRichAnalysis(durationSec = 120, bpm = 128) {
  const beatSec = 60 / bpm;
  const beats = [];
  for (let t = 0; t < durationSec; t += beatSec) beats.push(Number(t.toFixed(4)));
  const fps = 30;
  const frames = Math.ceil(durationSec * fps);
  const mkCurve = fn => Array.from({ length: frames }, (_, i) => Number(fn(i / fps).toFixed(4)));
  return {
    durationSec,
    bpm,
    beatOffsetSec: 0,
    fps,
    beatsSec: beats,
    sections: [
      { id: 'sec-0', label: 'Intro', kind: 'intro', startSec: 0, durationSec: 15, energy: 0.35 },
      { id: 'sec-1', label: 'Build', kind: 'buildup', startSec: 15, durationSec: 15, energy: 0.7 },
      { id: 'sec-2', label: 'Drop 1', kind: 'drop', startSec: 30, durationSec: 30, energy: 0.95 },
      { id: 'sec-3', label: 'Break', kind: 'breakdown', startSec: 60, durationSec: 20, energy: 0.4 },
      { id: 'sec-4', label: 'Drop 2', kind: 'drop', startSec: 80, durationSec: 25, energy: 0.98 },
      { id: 'sec-5', label: 'Outro', kind: 'outro', startSec: 105, durationSec: 15, energy: 0.25 }
    ],
    envelopes: {
      drums: mkCurve(t => 0.5 + 0.5 * Math.sin(t * 6)),
      bass: mkCurve(t => 0.5 + 0.5 * Math.cos(t * 3)),
      vocals: mkCurve(t => 0.4 + 0.4 * Math.sin(t * 2)),
      other: mkCurve(t => 0.5 + 0.3 * Math.cos(t * 4))
    }
  };
}

test('Stress test 1: 600 randomized timeline & keyframe operations never violate validateTimeline or crash renderTimelineFrame', () => {
  const rng = makeSeededRng(20261028);
  const analysis = makeRichAnalysis(120, 128);
  const initial = normalizeTimeline(createAutoShow(analysis));
  const store = createStore(initial);

  assert.equal(validateTimeline(store.timeline).valid, true);

  const easeModes = ['linear', 'smooth', 'in', 'out', 'step'];
  const CLIP_DRIVERS = ['none', 'drums', 'bass', 'vocals', 'other', 'band'];

  for (let step = 0; step < 600; step++) {
    const tl = store.timeline;
    const refs = allRefs(tl);
    const opRoll = rng();

    store.begin();

    if (opRoll < 0.12 || refs.length === 0) {
      // Add clip with various edge-case durations & keyframes
      const layer = tl.layers[Math.floor(rng() * tl.layers.length)] || addLayer(tl);
      const startSec = rng() * (tl.durationSec - 0.1);
      const durationSec = 0.05 + rng() * 12;
      const preset = TIMELINE_PRESETS[Math.floor(rng() * TIMELINE_PRESETS.length)];
      const driver = CLIP_DRIVERS[Math.floor(rng() * CLIP_DRIVERS.length)];
      const rawKeys = rng() < 0.5
        ? [
            { timeSec: 0, value: rng() },
            { timeSec: durationSec * 0.5, value: rng() },
            { timeSec: durationSec * 0.5, value: rng() }, // intentional duplicate timeSec!
            { timeSec: durationSec + 5, value: rng() } // intentional out-of-range timeSec!
          ]
        : undefined;
      addClip(tl, layer.id, {
        startSec,
        durationSec,
        preset,
        driver,
        keyframes: rawKeys
      });
      store.end(`Add clip ${step}`);
    } else if (opRoll < 0.28) {
      // Resize clip on start or end edge with extreme deltas, multiple frames in single drag
      const ref = refs[Math.floor(rng() * refs.length)];
      const hit = findClip(tl, ref);
      if (hit) {
        const edge = rng() < 0.5 ? 'start' : 'end';
        // Simulate multi-frame mouse drag on the same clip without re-Snapshotting
        for (let dragFrame = 0; dragFrame < 4; dragFrame++) {
          const targetTime = (rng() - 0.15) * (tl.durationSec + 10);
          resizeClip(tl, hit.clip, edge, targetTime, { snap: rng() < 0.5, division: 1 });
        }
      }
      store.end(`Resize clip ${step}`);
    } else if (opRoll < 0.38) {
      // Move clip across layers and time boundaries
      const ref = refs[Math.floor(rng() * refs.length)];
      const targetLayer = tl.layers[Math.floor(rng() * tl.layers.length)];
      moveClip(tl, ref, {
        startSec: (rng() - 0.2) * (tl.durationSec + 20),
        layerId: targetLayer.id,
        snap: rng() < 0.5
      });
      store.end(`Move clip ${step}`);
    } else if (opRoll < 0.48) {
      // Split clip at extreme or close-to-edge points
      const ref = refs[Math.floor(rng() * refs.length)];
      const hit = findClip(tl, ref);
      if (hit) {
        const splitAt = hit.clip.startSec + rng() * hit.clip.durationSec;
        splitClip(tl, ref, splitAt);
      }
      store.end(`Split clip ${step}`);
    } else if (opRoll < 0.62) {
      // Add and move single keyframe (including closely spaced neighbors < 0.005s)
      const ref = refs[Math.floor(rng() * refs.length)];
      const hit = findClip(tl, ref);
      if (hit) {
        const ease = easeModes[Math.floor(rng() * easeModes.length)];
        // Add two very close keyframes to test neighbor collision
        const tBase = rng() * hit.clip.durationSec;
        addKeyframe(hit.clip, tBase, rng(), ease);
        addKeyframe(hit.clip, tBase + 0.002, rng(), ease);
        if (hit.clip.keyframes.length > 0) {
          const idx = Math.floor(rng() * hit.clip.keyframes.length);
          moveKeyframe(hit.clip, idx, (rng() - 0.2) * (hit.clip.durationSec + 2), rng() * 1.4 - 0.2);
          if (idx < hit.clip.keyframes.length) {
            setKeyframeEase(hit.clip, idx, easeModes[Math.floor(rng() * easeModes.length)]);
          }
        }
      }
      store.end(`Keyframe op ${step}`);
    } else if (opRoll < 0.74) {
      // Multi-keyframe move (moveKeyframes)
      const ref = refs[Math.floor(rng() * refs.length)];
      const hit = findClip(tl, ref);
      if (hit && hit.clip.keyframes.length >= 2) {
        const initialKeys = hit.clip.keyframes.map(k => ({ ...k }));
        const indices = [];
        for (let i = 0; i < initialKeys.length; i++) {
          if (rng() < 0.6) indices.push(i);
        }
        if (indices.length > 0) {
          moveKeyframes(hit.clip, initialKeys, indices, (rng() - 0.5) * hit.clip.durationSec, (rng() - 0.5) * 2);
        }
      }
      store.end(`Multi keyframe move ${step}`);
    } else if (opRoll < 0.82) {
      // Remove keyframe(s)
      const ref = refs[Math.floor(rng() * refs.length)];
      const hit = findClip(tl, ref);
      if (hit && hit.clip.keyframes.length > 0) {
        if (rng() < 0.5) {
          removeKeyframe(hit.clip, Math.floor(rng() * hit.clip.keyframes.length));
        } else {
          removeKeyframes(hit.clip, [0, Math.floor(rng() * hit.clip.keyframes.length)]);
        }
      }
      store.end(`Remove keyframe ${step}`);
    } else if (opRoll < 0.90) {
      // Section regeneration with ultra-short and normal sections
      const secIdx = Math.floor(rng() * analysis.sections.length);
      const customAnalysis = rng() < 0.35
        ? {
            ...analysis,
            sections: analysis.sections.map((s, idx) =>
              idx === secIdx ? { ...s, durationSec: 0.1 + rng() * 0.5 } : s
            )
          }
        : analysis;
      regenerateSectionClips(tl, customAnalysis, secIdx, { energy: 0.2 + rng() * 0.8 });
      store.end(`Regenerate section ${step}`);
    } else if (opRoll < 0.96) {
      // Remote MCP / CLI timeline operations (including aliases and patch_keyframes)
      const ref = refs[Math.floor(rng() * refs.length)];
      const hit = findClip(tl, ref);
      if (hit) {
        applyTimelineOp(tl, 'patch_keyframes', {
          clipId: hit.clip.id,
          keyframes: [
            { timeSec: 0, value: 0.2 },
            { timeSec: hit.clip.durationSec * 0.4, value: 0.9, ease: 'smooth' },
            { timeSec: hit.clip.durationSec * 0.4, value: 0.5 }, // duplicate timestamp
            { timeSec: hit.clip.durationSec, value: 0 }
          ]
        });
        applyTimelineOp(tl, 'patch_clips', {
          clipIds: [hit.clip.id],
          patch: { direction: 'center_out', motionMode: 'parallel' }
        });
      }
      store.end(`Remote op ${step}`);
    } else {
      // Duplicate or delete or undo/redo
      if (rng() < 0.4 && refs.length > 4) {
        deleteClips(tl, [refs[0]]);
        store.end(`Delete clip ${step}`);
      } else if (rng() < 0.7 && refs.length < 120) {
        duplicateClips(tl, [refs[Math.floor(rng() * refs.length)]], 0.5);
        store.end(`Duplicate clip ${step}`);
      } else {
        store.discardGesture();
        if (store.canUndo && rng() < 0.5) store.undo();
        else if (store.canRedo) store.redo();
      }
    }

    const check = validateTimeline(store.timeline);
    assert.equal(
      check.valid,
      true,
      `Timeline became invalid at step ${step}: ${check.errors.join('; ')}`
    );

    if (step % 25 === 0) {
      const sampleTime = rng() * store.timeline.durationSec;
      const frame = renderTimelineFrame(store.timeline, analysis, sampleTime);
      assert.ok(frame && frame.bars && Array.isArray(frame.bars.L1));
    }
  }
});

test('Stress test 2: Live Session Recorder survives concurrent UI clicks, clip edits, and store clones without losing recorded clips or corrupting undo history', () => {
  const analysis = makeRichAnalysis(60, 124);
  const store = createStore(normalizeTimeline(createAutoShow(analysis)));
  let currentTime = 4.0;
  let playing = true;
  const desk = { held: new Set() };

  const recorder = createSessionRecorder({
    store,
    desk,
    getTime: () => currentTime,
    getBpm: () => 124,
    isPlaying: () => playing,
    hasTrack: () => true
  });

  recorder.setArmed(true);
  assert.equal(recorder.isRecording, true);

  // Trigger a loop pad (pad 1, W) and a hit pad (pad 0, Q)
  const hitPad = normalizePad(DEFAULT_PADS[0]);
  const loopPad = normalizePad(DEFAULT_PADS[1]);

  recorder.onPadDown(1, loopPad, 4.0);
  currentTime = 4.5;
  recorder.tick(currentTime);

  // Simulate user clicking around in the DAW editor while recording (begin + discardGesture)
  store.begin();
  store.discardGesture();

  // Simulate user dragging a clip while live recording is active!
  store.begin();
  const existingRef = allRefs(store.timeline).find(r => !r.layerId.startsWith('layer-live-'));
  moveClip(store.timeline, existingRef, { startSec: 2.0, snap: false });
  store.end('Pomakni efekt tijekom snimanja');

  // Tick recorder after store state was mutated/cloned
  currentTime = 6.2;
  recorder.tick(currentTime);

  // Trigger a one-shot hit pad
  recorder.onPadDown(0, hitPad, 6.2);
  currentTime = 6.6;
  recorder.tick(currentTime);
  recorder.onPadUp(0, 6.6);

  // Advance loop pad and release
  currentTime = 7.5;
  recorder.tick(currentTime);
  recorder.onPadUp(1, 7.5);

  // Stop recording and commit
  recorder.stopRecording();
  assert.equal(recorder.isRecording, false);

  // Verify no transient `recording: true` flag remains on any clip
  for (const layer of store.timeline.layers) {
    for (const clip of layer.clips) {
      assert.equal(clip.recording, undefined, 'recording flag must be stripped after stopRecording');
    }
  }

  // Verify timeline is 100% valid
  const checked = validateTimeline(store.timeline);
  assert.equal(checked.valid, true, `Recorded timeline invalid: ${checked.errors.join('; ')}`);

  // Verify recorded layers exist and have clips
  const liveLayers = store.timeline.layers.filter(l => l.name?.startsWith('Live ['));
  assert.ok(liveLayers.length >= 2, 'Both loop and hit pad layers must be recorded');

  // Verify Undo cleanly reverts the recording session without throwing
  assert.equal(store.canUndo, true);
  store.undo();
  assert.equal(validateTimeline(store.timeline).valid, true);
  store.redo();
  assert.equal(validateTimeline(store.timeline).valid, true);
});

test('Stress test 3: Server & Library heavy concurrent saves, >10MB analysis sidecars, keyframe auto-repair on save, and structured crash/error log system', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ledicated-saving-stress-'));
  const srv = createLightingServer({ configPath: null, libraryRoot: join(dir, 'library'), logFilePath: join(dir, 'logs', 'ledicated.log') });
  await new Promise(resolve => srv.server.listen(0, '127.0.0.1', resolve));

  try {
    const base = `http://127.0.0.1:${srv.server.address().port}`;

    // 1. Import a track
    const wavHeader = Buffer.alloc(44 + 4000);
    wavHeader.write('RIFF', 0);
    wavHeader.writeUInt32LE(36 + 4000, 4);
    wavHeader.write('WAVEfmt ', 8);
    wavHeader.writeUInt32LE(16, 16);
    wavHeader.writeUInt16LE(1, 20);
    wavHeader.writeUInt16LE(1, 22);
    wavHeader.writeUInt32LE(44100, 24);
    wavHeader.writeUInt32LE(88200, 28);
    wavHeader.writeUInt16LE(2, 32);
    wavHeader.writeUInt16LE(16, 34);
    wavHeader.write('data', 36);
    wavHeader.writeUInt32LE(4000, 40);

    const impRes = await fetch(`${base}/api/library/import?name=StressTrack.wav`, {
      method: 'POST',
      body: wavHeader
    });
    assert.equal(impRes.status, 200);
    const { track } = await impRes.json();
    assert.ok(track.id);

    // 2. Test > 10 MB analysis sidecar save (previously crashed with >8MB limit)
    const hugeFloatArray = Array.from({ length: 650_000 }, (_, i) => Number(((i % 100) / 100).toFixed(4)));
    const largeAnalysis = {
      durationSec: 180,
      bpm: 130,
      beatOffsetSec: 0,
      fps: 50,
      beatsSec: [0, 0.4615, 0.923, 1.3846],
      sections: [
        { id: 'sec-0', label: 'Intro', kind: 'intro', startSec: 0, durationSec: 60, energy: 0.4 },
        { id: 'sec-1', label: 'Drop', kind: 'drop', startSec: 60, durationSec: 120, energy: 0.95 }
      ],
      envelopes: {
        drums: hugeFloatArray,
        bass: hugeFloatArray
      }
    };
    await srv.library.setAnalysis(track.id, largeAnalysis);

    // Update sections via HTTP POST /api/library/sections on the > 10 MB analysis file
    const secRes = await fetch(`${base}/api/library/sections`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: track.id,
        sections: [
          { id: 'sec-0', label: 'Intro Edit', kind: 'intro', startSec: 0, durationSec: 45, energy: 0.45 },
          { id: 'sec-1', label: 'Main Drop', kind: 'drop', startSec: 45, durationSec: 135, energy: 0.99 }
        ]
      })
    });
    assert.equal(secRes.status, 200);

    // 3. Test 60 rapid concurrent + sequential timeline saves with colliding keyframes & recording flags
    const baseTimeline = createAutoShow(makeRichAnalysis(180, 130));
    const concurrentPromises = [];
    for (let i = 0; i < 40; i++) {
      const copy = structuredClone(baseTimeline);
      copy.bpm = 120 + (i % 20);
      // Inject transient recording flag and colliding keyframe timestamps that previously caused HTTP 400
      copy.layers[0].clips[0].recording = true;
      copy.layers[0].clips[0].keyframes = [
        { timeSec: 0, value: 0 },
        { timeSec: 0.5, value: 0.8 },
        { timeSec: 0.5, value: 1.0 }, // duplicate timestamp!
        { timeSec: copy.layers[0].clips[0].durationSec + 2, value: 0 } // out of bounds timestamp!
      ];
      concurrentPromises.push(
        fetch(`${base}/api/library/timeline`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: track.id, clientId: 'stress-client', timeline: copy })
        }).then(async r => {
          assert.equal(r.status, 200, `Concurrent save ${i} failed with status ${r.status}`);
          return r.json();
        })
      );
    }
    await Promise.all(concurrentPromises);

    // Verify final saved timeline on disk is valid JSON and passes validateTimeline
    const reloadRes = await fetch(`${base}/api/library/track/${track.id}`);
    assert.equal(reloadRes.status, 200);
    const reloaded = await reloadRes.json();
    assert.equal(validateTimeline(reloaded.timeline).valid, true);
    assert.equal(reloaded.timeline.layers[0].clips[0].recording, undefined);

    // 4. Test invalid timeline rejection is logged under VALIDATION_ERROR
    const badRes = await fetch(`${base}/api/library/timeline`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: track.id, timeline: { version: 1, durationSec: -10, bpm: 120, layers: [] } })
    });
    assert.equal(badRes.status, 400);

    // 5. Test client crash reporting endpoint POST /api/logs/event
    const crashRes = await fetch(`${base}/api/logs/event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        category: 'CLIENT_CRASH',
        event: 'WINDOW_ERROR',
        data: { message: 'Simulated test error', trackId: track.id }
      })
    });
    assert.equal(crashRes.status, 200);

    // 6. Query GET /api/logs with filters and verify disk log files exist
    const logsRes = await fetch(`${base}/api/logs?category=VALIDATION_ERROR,CLIENT_CRASH&limit=50`);
    assert.equal(logsRes.status, 200);
    const logsData = await logsRes.json();
    assert.equal(logsData.ok, true);
    assert.ok(logsData.logFile.endsWith('ledicated.log'));
    assert.ok(logsData.recent.some(e => e.category === 'VALIDATION_ERROR' && e.action === 'TIMELINE_SAVE_REJECTED'));
    assert.ok(logsData.recent.some(e => e.category === 'CLIENT_CRASH' && e.action === 'WINDOW_ERROR'));
    assert.ok(logsData.errors.length >= 2);

    // Verify the physical log file on disk contains the JSONL entries
    let diskLogRaw = '';
    for (let attempt = 0; attempt < 20; attempt++) {
      diskLogRaw = await readFile(logsData.logFile, 'utf8').catch(() => '');
      if (diskLogRaw.includes('WINDOW_ERROR')) break;
      await new Promise(r => setTimeout(r, 15));
    }
    const diskLines = diskLogRaw
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(l => {
        const idx = l.indexOf('{');
        return idx >= 0 ? JSON.parse(l.slice(idx)) : {};
      });
    assert.ok(diskLines.some(l => l.trackId === track.id));
    assert.ok(diskLogRaw.includes('TIMELINE_SAVED'));
    assert.ok(diskLogRaw.includes('TIMELINE_SAVE_REJECTED'));
    assert.ok(diskLogRaw.includes('WINDOW_ERROR'));

    // Verify no leftover .tmp files exist in the library directory
    const allFiles = await readdir(join(dir, 'library'), { recursive: true });
    const tmpFiles = allFiles.filter(f => f.includes('.tmp-'));
    assert.equal(tmpFiles.length, 0, `Leftover tmp files found: ${tmpFiles.join(', ')}`);
  } finally {
    await srv.close();
    await rm(dir, { recursive: true, force: true });
  }
});
