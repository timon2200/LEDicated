import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { detectSections } from './audio-sections.mjs';

const execFileAsync = promisify(execFile);
const SAMPLE_RATE = 11025;
const FFT_SIZE = 2048;
const HOP_SIZE = 512;
const HOP_SEC = HOP_SIZE / SAMPLE_RATE;
const WINDOW = Float64Array.from({ length: FFT_SIZE }, (_, n) =>
  0.5 - 0.5 * Math.cos(2 * Math.PI * n / (FFT_SIZE - 1)));

function fft(real, imag) {
  const size = real.length;
  for (let i = 1, j = 0; i < size; i++) {
    let bit = size >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const r = real[i]; real[i] = real[j]; real[j] = r;
      const im = imag[i]; imag[i] = imag[j]; imag[j] = im;
    }
  }
  for (let width = 2; width <= size; width <<= 1) {
    const angle = -2 * Math.PI / width;
    const wr = Math.cos(angle);
    const wi = Math.sin(angle);
    for (let start = 0; start < size; start += width) {
      let cr = 1; let ci = 0;
      for (let k = 0; k < width / 2; k++) {
        const a = start + k; const b = a + width / 2;
        const tr = cr * real[b] - ci * imag[b];
        const ti = cr * imag[b] + ci * real[b];
        real[b] = real[a] - tr; imag[b] = imag[a] - ti;
        real[a] += tr; imag[a] += ti;
        const nextR = cr * wr - ci * wi;
        ci = cr * wi + ci * wr; cr = nextR;
      }
    }
  }
}

function percentile(values, fraction) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) * fraction)];
}

function normalize(values) {
  const scale = percentile(values, 0.98);
  if (scale <= 1e-9) return values.map(() => 0);
  return values.map(value => Math.round(Math.min(1, value / scale) * 1000) / 1000);
}

function estimateBeats(drums, durationSec) {
  if (drums.length < 32 || !drums.some(value => value >= 0.08)) return { bpm: null, beatsSec: [] };
  const onset = drums.map((value, i) => Math.max(0, value - (drums[i - 1] || 0)));
  const minLag = Math.round(60 / (185 * HOP_SEC));
  const maxLag = Math.round(60 / (70 * HOP_SEC));
  let best = { lag: 0, score: 0 };
  const lagScores = new Map();
  for (let lag = minLag; lag <= maxLag; lag++) {
    let score = 0;
    for (let i = lag; i < onset.length; i++) score += onset[i] * onset[i - lag];
    lagScores.set(lag, score);
    if (score > best.score) best = { lag, score };
  }
  if (!best.lag || best.score < 0.01) return { bpm: null, beatsSec: [] };

  // A strong half-period is common in dance music: use its full-rate pulse.
  let beatLag = best.lag;
  const halfLag = best.lag / 2;
  if (halfLag >= minLag && Math.max(
    lagScores.get(Math.floor(halfLag)) || 0,
    lagScores.get(Math.ceil(halfLag)) || 0,
  ) >= best.score * 0.8) beatLag = halfLag;

  // Continuous comb-filter resonance search with fine 0.05 BPM resolution around beatLag
  const interp = (arr, idx) => {
    const i = Math.floor(idx);
    const f = idx - i;
    if (i < 0 || i >= arr.length - 1) return 0;
    return arr[i] * (1 - f) + arr[i + 1] * f;
  };

  const coarseBpm = 60 / (beatLag * HOP_SEC);
  const minBpm = Math.max(68, coarseBpm - 8);
  const maxBpm = Math.min(190, coarseBpm + 8);
  let bestBpm = coarseBpm;
  let maxResonance = -1;
  const maxI = Math.min(onset.length, 5000);

  for (let bpm = minBpm; bpm <= maxBpm + 1e-5; bpm += 0.05) {
    const period = 60 / bpm;
    const l1 = period / HOP_SEC;
    const l2 = 2 * l1;
    const l3 = 3 * l1;
    const l4 = 4 * l1;
    let score = 0;
    for (let i = Math.ceil(l4); i < maxI; i++) {
      if (onset[i] < 0.01) continue;
      const o1 = interp(onset, i - l1);
      const o2 = interp(onset, i - l2);
      const o3 = interp(onset, i - l3);
      const o4 = interp(onset, i - l4);
      score += onset[i] * (o1 + 0.8 * o2 + 0.6 * o3 + 0.4 * o4);
    }
    if (score > maxResonance) {
      maxResonance = score;
      bestBpm = bpm;
    }
  }

  // Clean rounding: snap to whole integer if within 0.08 BPM, otherwise round to 1 decimal place
  let finalBpm = Math.round(bestBpm * 10) / 10;
  if (Math.abs(finalBpm - Math.round(finalBpm)) < 0.08) finalBpm = Math.round(finalBpm);
  const period = 60 / finalBpm;

  // High-resolution phase search (120 steps across one beat period)
  let bestPhase = 0;
  let bestPhaseScore = -1;
  const phaseSteps = 120;
  const sigma = 0.030;
  for (let s = 0; s < phaseSteps; s++) {
    const phase = (s * period) / phaseSteps;
    let score = 0;
    for (let i = 0; i < onset.length; i++) {
      if (onset[i] < 0.02) continue;
      const t = i * HOP_SEC;
      const distance = Math.abs((((t - phase + period / 2) % period) + period) % period - period / 2);
      if (distance < sigma * 2.5) {
        score += onset[i] * Math.exp(-(distance * distance) / (2 * sigma * sigma));
      }
    }
    if (score > bestPhaseScore) {
      bestPhaseScore = score;
      bestPhase = phase;
    }
  }

  let firstBeat = bestPhase;
  while (firstBeat >= period) firstBeat -= period;
  if (firstBeat < 0.025) firstBeat = 0;

  const beatsSec = [];
  for (let t = firstBeat; t <= durationSec + 1e-6; t += period) {
    beatsSec.push(Math.round(t * 1000) / 1000);
  }
  return { bpm: finalBpm, beatsSec };
}

/**
 * Analyze one local MP3/WAV without writing decoded audio to disk.
 * drums and bass are frequency-band estimates, not isolated AI stems.
 */
export async function analyzeAudio(input, options = {}) {
  if (typeof input !== 'string' || !path.isAbsolute(input) || !/\.(mp3|wav)$/i.test(input)) {
    throw new TypeError('Audio input must be an absolute .mp3 or .wav path');
  }
  const info = await stat(input);
  if (!info.isFile()) throw new TypeError('Audio input must be a file');
  const maxWaveformBins = options.maxWaveformBins ?? 2048;
  if (!Number.isInteger(maxWaveformBins) || maxWaveformBins < 16 || maxWaveformBins > 8192) {
    throw new RangeError('maxWaveformBins must be an integer from 16 to 8192');
  }
  const { stdout } = await execFileAsync('ffprobe', [
    '-v', 'error', '-select_streams', 'a:0', '-show_entries', 'format=duration',
    '-of', 'json', input,
  ], { timeout: 15000, maxBuffer: 1024 * 1024 });
  const probedDuration = Number(JSON.parse(stdout).format?.duration);
  if (!Number.isFinite(probedDuration) || probedDuration <= 0) {
    throw new Error('Audio duration is unavailable');
  }
  const samplesPerBin = Math.max(256, Math.ceil(probedDuration * SAMPLE_RATE / maxWaveformBins));
  const waveformPeak = [];
  const waveformSumSquares = [];
  const waveformCount = [];
  const ring = new Float64Array(FFT_SIZE);
  const real = new Float64Array(FFT_SIZE);
  const imag = new Float64Array(FFT_SIZE);
  const previousMagnitude = new Float64Array(FFT_SIZE / 2);
  const bassEnergy = [];
  const drumTransient = [];
  const vocalEnergy = [];
  const otherEnergy = [];
  const bassLo = Math.ceil(40 * FFT_SIZE / SAMPLE_RATE);
  const bassHi = Math.floor(200 * FFT_SIZE / SAMPLE_RATE);
  const drumLo = Math.ceil(180 * FFT_SIZE / SAMPLE_RATE);
  const drumHi = Math.floor(5000 * FFT_SIZE / SAMPLE_RATE);
  const vocalLo = Math.ceil(250 * FFT_SIZE / SAMPLE_RATE);
  const vocalHi = Math.floor(3500 * FFT_SIZE / SAMPLE_RATE);
  const otherLo = Math.ceil(3500 * FFT_SIZE / SAMPLE_RATE);
  const otherHi = Math.min(FFT_SIZE / 2 - 1, Math.floor(5500 * FFT_SIZE / SAMPLE_RATE));
  let samples = 0;

  function analyzeFrame() {
    for (let i = 0; i < FFT_SIZE; i++) {
      real[i] = ring[(samples + i) % FFT_SIZE] * WINDOW[i];
      imag[i] = 0;
    }
    fft(real, imag);
    let bass = 0; let flux = 0; let bassFlux = 0;
    let vocal = 0; let other = 0;
    for (let k = bassLo; k <= drumHi; k++) {
      const magnitude = Math.hypot(real[k], imag[k]);
      const rise = Math.max(0, magnitude - previousMagnitude[k]);
      if (k <= bassHi) { bass += magnitude * magnitude; bassFlux += rise; }
      if (k >= drumLo) flux += rise;
      if (k >= vocalLo && k <= vocalHi) vocal += magnitude * magnitude;
      previousMagnitude[k] = magnitude;
    }
    for (let k = otherLo; k <= otherHi; k++) {
      const magnitude = Math.hypot(real[k], imag[k]);
      other += magnitude * magnitude;
    }
    bassEnergy.push(Math.sqrt(bass));
    drumTransient.push(flux + bassFlux * 1.5);
    vocalEnergy.push(Math.sqrt(vocal));
    otherEnergy.push(Math.sqrt(other));
  }

  const decoder = spawn('ffmpeg', [
    '-nostdin', '-hide_banner', '-loglevel', 'error', '-i', input, '-map', '0:a:0',
    '-vn', '-ac', '1', '-ar', String(SAMPLE_RATE), '-f', 's16le', 'pipe:1',
  ], { stdio: ['ignore', 'pipe', 'pipe'], signal: options.signal });
  let stderr = '';
  decoder.stderr.setEncoding('utf8');
  decoder.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-4096); });
  const finished = new Promise(resolve => {
    let processError = null;
    decoder.on('error', error => { processError = error; });
    decoder.on('close', code => resolve({ code, processError }));
  });
  let pendingByte = null;
  try {
    for await (const chunk of decoder.stdout) {
      let offset = 0;
      if (pendingByte !== null) {
        const signed = (pendingByte | chunk[0] << 8) << 16 >> 16;
        processSample(signed / 32768);
        pendingByte = null;
        offset = 1;
      }
      for (; offset + 1 < chunk.length; offset += 2) processSample(chunk.readInt16LE(offset) / 32768);
      if (offset < chunk.length) pendingByte = chunk[offset];
    }
    const { code, processError } = await finished;
    if (processError) throw processError;
    if (code !== 0) throw new Error(`ffmpeg decode failed (${code}): ${stderr.trim()}`);
  } catch (error) {
    decoder.kill();
    await finished;
    throw error;
  }
  if (!samples) throw new Error('Audio contains no decoded samples');
  const durationSec = Math.round(samples / SAMPLE_RATE * 1000) / 1000;
  const peaks = waveformPeak.map(value => Math.round(value * 1000) / 1000);
  const rms = waveformSumSquares.map((sum, i) =>
    Math.round(Math.sqrt(sum / waveformCount[i]) * 1000) / 1000);
  const drums = normalize(drumTransient);
  const bass = normalize(bassEnergy);
  const vocals = normalize(vocalEnergy);
  const other = normalize(otherEnergy);
  const result = {
    durationSec,
    ...estimateBeats(drums, durationSec),
    waveform: { binSec: samplesPerBin / SAMPLE_RATE, peaks, rms },
    features: {
      kind: 'frequency-band-estimates',
      startSec: FFT_SIZE / (2 * SAMPLE_RATE),
      hopSec: HOP_SEC,
      drums,
      bass,
      vocals,
      other,
      stems: { drums, bass, vocals, other },
    },
  };
  result.sections = detectSections(result);
  return result;

  function processSample(value) {
    const bin = Math.floor(samples / samplesPerBin);
    waveformPeak[bin] = Math.max(waveformPeak[bin] || 0, Math.abs(value));
    waveformSumSquares[bin] = (waveformSumSquares[bin] || 0) + value * value;
    waveformCount[bin] = (waveformCount[bin] || 0) + 1;
    ring[samples % FFT_SIZE] = value;
    samples++;
    if (samples >= FFT_SIZE && (samples - FFT_SIZE) % HOP_SIZE === 0) analyzeFrame();
  }
}
