import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { analyzeAudio } from './audio-analysis.mjs';

const SAMPLE_RATE = 11025;

function wav(seconds, sample) {
  const count = Math.round(seconds * SAMPLE_RATE);
  const data = Buffer.alloc(44 + count * 2);
  data.write('RIFF', 0);
  data.writeUInt32LE(data.length - 8, 4);
  data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20);
  data.writeUInt16LE(1, 22);
  data.writeUInt32LE(SAMPLE_RATE, 24);
  data.writeUInt32LE(SAMPLE_RATE * 2, 28);
  data.writeUInt16LE(2, 32);
  data.writeUInt16LE(16, 34);
  data.write('data', 36);
  data.writeUInt32LE(count * 2, 40);
  for (let i = 0; i < count; i++) {
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, sample(i / SAMPLE_RATE, i))) * 32767), 44 + i * 2);
  }
  return data;
}

async function withAudio(sample, seconds, check) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ledicated-audio-test-'));
  const filename = path.join(dir, 'test.wav');
  try {
    await writeFile(filename, wav(seconds, sample));
    await check(filename);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('local analysis finds 120 BPM pulses and keeps bounded waveform/features', async () => {
  await withAudio((t, i) => {
    const phase = i % Math.round(SAMPLE_RATE / 2);
    const click = phase < 110 ? 0.7 * Math.exp(-phase / 27) * (i % 2 ? 1 : -1) : 0;
    return click + 0.12 * Math.sin(2 * Math.PI * 80 * t);
  }, 8, async filename => {
    const result = await analyzeAudio(filename, { maxWaveformBins: 128 });
    assert.ok(Math.abs(result.durationSec - 8) < 0.01);
    assert.ok(Math.abs(result.bpm - 120) < 8, `BPM ${result.bpm}`);
    assert.ok(result.beatsSec.length >= 14);
    assert.ok(result.waveform.peaks.length <= 129);
    const nBins = result.waveform.peaks.length;
    assert.equal(nBins, result.waveform.rms.length);
    assert.equal(nBins, result.waveform.min.length);
    assert.equal(nBins, result.waveform.max.length);
    assert.equal(nBins, result.waveform.low.length);
    assert.equal(nBins, result.waveform.mid.length);
    assert.equal(nBins, result.waveform.high.length);
    assert.ok(result.waveform.min.some(v => v < 0));
    assert.ok(result.waveform.max.some(v => v > 0));
    assert.ok(result.waveform.low.every(v => v >= 0 && v <= 1));
    assert.ok(result.waveform.mid.every(v => v >= 0 && v <= 1));
    assert.ok(result.waveform.high.every(v => v >= 0 && v <= 1));
    assert.equal(result.features.kind, 'frequency-band-estimates');
    assert.ok(result.features.hopSec < 0.015, `Expected high-res feature hopSec < 0.015s (~86 Hz), got ${result.features.hopSec}`);
    assert.equal(result.features.drums.length, result.features.bass.length);
    assert.equal(result.features.vocals.length, result.features.drums.length);
    assert.equal(result.features.other.length, result.features.drums.length);
    assert.ok(result.features.stems.drums && result.features.stems.vocals);
    assert.ok(Array.isArray(result.sections));
    assert.ok(result.features.drums.some(value => value > 0.8));
    assert.ok(result.features.bass.some(value => value > 0.8));
    assert.ok(result.features.drums.every(value => value >= 0 && value <= 1));
  });
});

test('high-resolution waveform extraction uses 64-sample min bin size and supports >2048 bins by default', async () => {
  await withAudio((t) => {
    return 0.4 * Math.sin(2 * Math.PI * 90 * t) + 0.25 * Math.sin(2 * Math.PI * 1200 * t) + 0.15 * Math.sin(2 * Math.PI * 3800 * t);
  }, 16, async filename => {
    const result = await analyzeAudio(filename);
    // 16s * 11025 / 64 = 2756.25 -> >2048 high-res bins with default maxWaveformBins=8192
    assert.ok(result.waveform.peaks.length > 2048, `Expected >2048 bins, got ${result.waveform.peaks.length}`);
    assert.ok(result.waveform.peaks.length <= 8192);
    assert.ok(result.waveform.binSec < 0.01, `Expected binSec < 0.01s, got ${result.waveform.binSec}`);
    assert.ok(result.waveform.low.some(v => v > 0.5));
    assert.ok(result.waveform.mid.some(v => v > 0.5));
    assert.ok(result.waveform.high.some(v => v > 0.5));

    // Also allow maxWaveformBins up to 32768
    const hiRes = await analyzeAudio(filename, { maxWaveformBins: 32768 });
    assert.equal(hiRes.waveform.peaks.length, result.waveform.peaks.length);
    await assert.rejects(analyzeAudio(filename, { maxWaveformBins: 40000 }), RangeError);
  });
});

test('silence has no fabricated beat and zero-valued features', async () => {
  await withAudio(() => 0, 2, async filename => {
    const result = await analyzeAudio(filename);
    assert.equal(result.bpm, null);
    assert.deepEqual(result.beatsSec, []);
    assert.ok(result.waveform.peaks.every(value => value === 0));
    assert.ok(result.waveform.low.every(value => value === 0));
    assert.ok(result.waveform.mid.every(value => value === 0));
    assert.ok(result.waveform.high.every(value => value === 0));
    assert.ok(result.features.drums.every(value => value === 0));
    assert.ok(result.features.bass.every(value => value === 0));
  });
});

test('rejects non-absolute and unsupported paths', async () => {
  await assert.rejects(analyzeAudio('song.mp3'), TypeError);
  await assert.rejects(analyzeAudio('/tmp/song.txt'), TypeError);
});
