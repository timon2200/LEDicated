import test from 'node:test';
import assert from 'node:assert/strict';
import { computeSpectrum, bandPosition, bandHz, rangeLevel, SPECTRUM_BANDS } from './audio-spectrum.mjs';
import { bandLevel, validateTimeline, createAutoShow, renderTimelineFrame, DEFAULT_BAND } from './timeline.mjs';

const SR = 44100;
function tone(freq, seconds, from = 0, to = seconds) {
  const out = new Float32Array(Math.floor(seconds * SR));
  for (let i = Math.floor(from * SR); i < Math.floor(to * SR); i++) out[i] = Math.sin(2 * Math.PI * freq * i / SR) * 0.8;
  return out;
}

test('band position and frequency are inverse', () => {
  for (const hz of [30, 100, 1000, 12000]) assert.ok(Math.abs(bandHz(bandPosition(hz)) - hz) < 0.01 * hz);
  assert.equal(Math.round(bandPosition(25)), 0);
  assert.ok(Math.abs(bandPosition(18000) - SPECTRUM_BANDS) < 1e-6);
});

test('spectrum locates a tone in its own frequency range only', async () => {
  const sp = await computeSpectrum(tone(100, 2), SR, { yieldEvery: 0 });
  const frame = Math.floor(sp.frames / 2);
  assert.ok(rangeLevel(sp, frame, 80, 130) > 0.9);
  assert.ok(rangeLevel(sp, frame, 4000, 12000) < 0.2);
});

test('spectrum is deterministic', async () => {
  const a = await computeSpectrum(tone(440, 1), SR, { yieldEvery: 0 }), b = await computeSpectrum(tone(440, 1), SR, { yieldEvery: 0 });
  assert.deepEqual(a.data, b.data);
});

test('band driver follows a burst, honours threshold and releases', async () => {
  const sp = await computeSpectrum(tone(80, 4, 1, 2), SR, { yieldEvery: 0 });
  const analysis = { spectrum: sp };
  const band = { ...DEFAULT_BAND, lowHz: 50, highHz: 120, threshold: 0.4, ceiling: 1, mode: 'follow', releaseSec: 0 };
  assert.ok(bandLevel(analysis, band, 1.5) > 0.9);
  assert.ok(bandLevel(analysis, band, 0.5) < 0.05);
  assert.ok(bandLevel(analysis, band, 3) < 0.05);
  assert.equal(bandLevel(analysis, { ...band, lowHz: 3000, highHz: 9000 }, 1.5), 0);
  const gate = { ...band, mode: 'gate', releaseSec: 0.5 };
  assert.ok(bandLevel(analysis, gate, 1.5) > 0.99);
  const tail = bandLevel(analysis, gate, 2.2);
  assert.ok(tail > 0.2 && tail < 0.9, `release tail ${tail}`);
  assert.ok(bandLevel(analysis, gate, 3.5) < 0.05);
  assert.equal(bandLevel({}, band, 1), 0);
});

test('band clips validate and render through the shared frame function', async () => {
  const sp = await computeSpectrum(tone(80, 4, 1, 2), SR, { yieldEvery: 0 });
  const analysis = { durationSec: 4, bpm: 120, beatsSec: [0, .5, 1], spectrum: sp, features: { hopSec: .05, drums: [], bass: [] } };
  const timeline = createAutoShow(analysis);
  const clip = timeline.layers[0].clips[0];
  Object.assign(clip, { driver: 'band', band: { ...DEFAULT_BAND, lowHz: 50, highHz: 120, releaseSec: 0 }, driverGain: 1, preset: 'flash', color: [1, 0, 0, 0], startSec: 0, durationSec: 4, targets: 'all' });
  clip.keyframes = [{ timeSec: 0, value: 1 }, { timeSec: 4, value: 1 }];
  assert.ok(validateTimeline(timeline).valid, validateTimeline(timeline).errors.join());
  const sum = frame => Object.values(frame.bars).flat().reduce((t, p) => t + p[0], 0);
  const loud = sum(renderTimelineFrame({ ...timeline, layers: [{ ...timeline.layers[0], opacity: 1, blend: 'add' }] }, analysis, 1.5));
  const quiet = sum(renderTimelineFrame({ ...timeline, layers: [{ ...timeline.layers[0], opacity: 1, blend: 'add' }] }, analysis, 3));
  assert.ok(loud > 0 && quiet === 0, `${loud} ${quiet}`);
  clip.band.lowHz = 500; clip.band.highHz = 100;
  assert.equal(validateTimeline(timeline).valid, false);
  delete clip.band;
  assert.equal(validateTimeline(timeline).valid, false);
});
