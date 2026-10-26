import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore, addLayer, normalizeTimeline } from './daw-state.mjs';
import { validateTimeline, createAutoShow } from './timeline.mjs';
import { createSessionRecorder } from './live-session-recorder.mjs';
import { DEFAULT_PADS, normalizePad } from './live-performance-state.mjs';

const mockAnalysis = () => ({
  durationSec: 60,
  bpm: 120,
  beatsSec: Array.from({ length: 120 }, (_, i) => 0.25 + i * 0.5),
  features: { hopSec: 0.05, startSec: 0, drums: [], bass: [] }
});

const createTestEnv = (initialPlaying = false) => {
  const analysis = mockAnalysis();
  const timeline = normalizeTimeline(createAutoShow(analysis));
  const store = createStore(timeline);
  let currentTime = 10.0;
  let playing = initialPlaying;
  let bpm = 120;
  const desk = { held: new Set() };
  const recorder = createSessionRecorder({
    store,
    desk,
    getTime: () => currentTime,
    getBpm: () => bpm,
    isPlaying: () => playing,
    hasTrack: () => true
  });
  return {
    store,
    desk,
    recorder,
    setTime: t => { currentTime = t; },
    setPlaying: p => { playing = p; },
    setBpm: b => { bpm = b; },
    getTime: () => currentTime
  };
};

test('live recorder: arming and playback integration', () => {
  const env = createTestEnv(false);
  assert.equal(env.recorder.isArmed, false);
  assert.equal(env.recorder.isRecording, false);

  env.recorder.setArmed(true);
  assert.equal(env.recorder.isArmed, true);
  assert.equal(env.recorder.isRecording, false, 'waits for playback');

  env.setPlaying(true);
  env.recorder.startRecording();
  assert.equal(env.recorder.isRecording, true);

  env.recorder.setArmed(false);
  assert.equal(env.recorder.isArmed, false);
  assert.equal(env.recorder.isRecording, false);
});

test('live recorder: recording a one-shot hit pad creates an effect pill on a dedicated layer', () => {
  const env = createTestEnv(true);
  env.recorder.setArmed(true);
  assert.equal(env.recorder.isRecording, true);

  const padQ = normalizePad(DEFAULT_PADS[0]); // flash, hit
  env.setTime(12.0);
  env.recorder.onPadDown(0, padQ, 12.0);

  // Layer should be created at index 0
  const topLayer = env.store.timeline.layers[0];
  assert(topLayer.name.includes('Live [Q]'));
  assert(topLayer.name.includes('Flash'));
  assert.equal(topLayer.clips.length, 1);

  const clip = topLayer.clips[0];
  assert.equal(clip.preset, 'flash');
  assert.equal(clip.startSec, 12.0);
  assert.equal(clip.recording, true);

  // Time advances, tick updates pill
  env.setTime(12.25);
  env.recorder.tick(12.25);
  assert.equal(clip.durationSec >= 0.25, true);

  // Pad released
  env.recorder.onPadUp(0, 12.3);
  assert.equal(clip.recording, undefined);
  assert.equal(clip.durationSec, 0.25);

  // Stop recording commits to store
  env.recorder.stopRecording();
  assert.equal(validateTimeline(env.store.timeline).valid, true);
  assert.equal(env.store.canUndo, true);
  assert.equal(env.store.undoLabel, 'Snimi izvedbu');
});

test('live recorder: recording a loop pad creates a continuous pill until stopped', () => {
  const env = createTestEnv(true);
  env.recorder.setArmed(true);

  const padW = normalizePad(DEFAULT_PADS[1]); // pulse, loop
  env.setTime(20.0);
  env.recorder.onPadDown(1, padW, 20.0);

  const pulseLayer = env.store.timeline.layers.find(l => l.name.includes('Live [W]'));
  assert(pulseLayer, 'Pulse layer should exist');
  assert.equal(pulseLayer.clips.length, 1);
  const clip = pulseLayer.clips[0];
  assert.equal(clip.preset, 'pulse');
  assert.equal(clip.startSec, 20.0);

  // Advance time by 4 seconds while loop runs
  env.setTime(24.0);
  env.recorder.tick(24.0);
  assert.equal(clip.durationSec, 4.0);

  // Loop pad is stopped / released
  env.recorder.onPadUp(1, 24.5);
  assert.equal(clip.durationSec, 4.5);
  assert.equal(clip.keyframes.length, 2);
  assert.equal(clip.keyframes[0].value, padW.intensity);
  assert.equal(clip.keyframes[1].value, padW.intensity);

  env.recorder.stopRecording();
  assert.equal(validateTimeline(env.store.timeline).valid, true);
});

test('live recorder: changing settings while effect is active splits the pill and creates a new pill', () => {
  const env = createTestEnv(true);
  env.recorder.setArmed(true);

  const padChase = normalizePad(DEFAULT_PADS[2]); // chase, loop
  env.setTime(30.0);
  env.recorder.onPadDown(2, padChase, 30.0);

  const chaseLayer = env.store.timeline.layers.find(l => l.name.includes('Live [E]'));
  assert(chaseLayer);
  assert.equal(chaseLayer.clips.length, 1);
  const firstClip = chaseLayer.clips[0];
  assert.equal(firstClip.speed, 1);

  // After 2 seconds, user turns SPEED dial to 2.5x in inspector
  env.setTime(32.0);
  const updatedPad = normalizePad({ ...padChase, speed: 2.5, color: [0, 1, 0, 0] });
  env.recorder.onPadChange(2, updatedPad, 32.0);

  // First clip should be closed at 32.0 (duration 2.0s)
  assert.equal(firstClip.durationSec, 2.0);
  assert.equal(firstClip.speed, 1);
  assert.equal(firstClip.recording, undefined);

  // A second clip should now exist starting at 32.0 with the new speed and color!
  assert.equal(chaseLayer.clips.length, 2);
  const secondClip = chaseLayer.clips[1];
  assert.equal(secondClip.startSec, 32.0);
  assert.equal(secondClip.speed, 2.5);
  assert.deepEqual(secondClip.color, [0, 1, 0, 0]);
  assert.equal(secondClip.recording, true);

  // User finishes loop at 35.0
  env.setTime(35.0);
  env.recorder.onPadUp(2, 35.0);
  assert.equal(secondClip.durationSec, 3.0);
  assert.equal(secondClip.recording, undefined);

  env.recorder.stopRecording();
  assert.equal(validateTimeline(env.store.timeline).valid, true);
});

test('live recorder: changing preset while effect is active creates a new layer for the new preset', () => {
  const env = createTestEnv(true);
  env.recorder.setArmed(true);

  const padQ = normalizePad(DEFAULT_PADS[0]); // flash
  env.setTime(10.0);
  env.recorder.onPadDown(0, padQ, 10.0);

  const flashLayer = env.store.timeline.layers.find(l => l.name.includes('Live [Q] · Flash'));
  assert(flashLayer);
  assert.equal(flashLayer.clips.length, 1);

  // While active, user changes preset to chase!
  env.setTime(11.5);
  const newPresetPad = normalizePad({ ...padQ, preset: 'chase', speed: 2 });
  env.recorder.onPadChange(0, newPresetPad, 11.5);

  // First clip finalized
  assert.equal(flashLayer.clips[0].durationSec, 1.5);

  // New layer for Chase is created automatically
  const chaseLayer = env.store.timeline.layers.find(l => l.name.includes('Live [Q] · Trkač'));
  assert(chaseLayer);
  assert.notEqual(flashLayer.id, chaseLayer.id);
  assert.equal(chaseLayer.clips.length, 1);
  assert.equal(chaseLayer.clips[0].preset, 'chase');
  assert.equal(chaseLayer.clips[0].startSec, 11.5);

  env.setTime(13.0);
  env.recorder.onPadUp(0, 13.0);
  env.recorder.stopRecording();

  assert.equal(validateTimeline(env.store.timeline).valid, true);
});

test('live recorder: undo and redo restores exact timeline state', () => {
  const env = createTestEnv(true);
  const initialLayerCount = env.store.timeline.layers.length;
  const initialClipsCount = env.store.timeline.layers.reduce((sum, l) => sum + l.clips.length, 0);

  env.recorder.setArmed(true);
  env.setTime(5.0);
  env.recorder.onPadDown(0, normalizePad(DEFAULT_PADS[0]), 5.0);
  env.setTime(6.0);
  env.recorder.onPadUp(0, 6.0);
  env.recorder.stopRecording();

  // New layer and clip exist
  assert(env.store.timeline.layers.length > initialLayerCount);
  assert(env.store.timeline.layers.reduce((sum, l) => sum + l.clips.length, 0) > initialClipsCount);

  // Undo
  assert.equal(env.store.undo(), true);
  assert.equal(env.store.timeline.layers.length, initialLayerCount);
  assert.equal(env.store.timeline.layers.reduce((sum, l) => sum + l.clips.length, 0), initialClipsCount);

  // Redo
  assert.equal(env.store.redo(), true);
  assert(env.store.timeline.layers.length > initialLayerCount);
});

test('live recorder: polyphonic recording handles multiple simultaneous pads', () => {
  const env = createTestEnv(true);
  env.recorder.setArmed(true);

  // User presses Pad Q (flash) and Pad W (pulse) at the same time
  env.setTime(15.0);
  env.recorder.onPadDown(0, normalizePad(DEFAULT_PADS[0]), 15.0);
  env.recorder.onPadDown(1, normalizePad(DEFAULT_PADS[1]), 15.0);

  assert.equal(env.recorder.activePillsCount, 2);

  // Pad Q released at 15.5
  env.setTime(15.5);
  env.recorder.onPadUp(0, 15.5);
  assert.equal(env.recorder.activePillsCount, 1);

  // Pad W released at 18.0
  env.setTime(18.0);
  env.recorder.onPadUp(1, 18.0);
  assert.equal(env.recorder.activePillsCount, 0);

  env.recorder.stopRecording();
  assert.equal(validateTimeline(env.store.timeline).valid, true);
});
