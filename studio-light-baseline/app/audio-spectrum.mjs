/** Log-frequency spectrogram used by the frequency-band audio driver.
 * Pure and deterministic: the same samples always give the same bytes. It runs in
 * the browser on the decoded track (the server analysis only stores drums/bass).
 * Values are 0–255 and mean "level relative to the loudest part of the song",
 * with a gentle +3 dB/octave tilt so treble is not drowned by bass.
 */
export const SPECTRUM_BANDS = 96;
export const SPECTRUM_MIN_HZ = 25;
export const SPECTRUM_MAX_HZ = 18000;
const FFT_SIZE = 2048;
const HOP = 1024;
const RANGE_DB = 60;

const LOG_RATIO = Math.log(SPECTRUM_MAX_HZ / SPECTRUM_MIN_HZ);
/** Fractional band position (0…BANDS) of a frequency. */
export const bandPosition = hz => Math.log(Math.max(1, hz) / SPECTRUM_MIN_HZ) / LOG_RATIO * SPECTRUM_BANDS;
/** Lower edge in Hz of band index i (use i = BANDS for the top edge). */
export const bandHz = i => SPECTRUM_MIN_HZ * Math.exp(i / SPECTRUM_BANDS * LOG_RATIO);
export const clampHz = hz => Math.max(SPECTRUM_MIN_HZ, Math.min(SPECTRUM_MAX_HZ, hz));

function fft(real, imag) {
  const size = real.length;
  for (let i = 1, j = 0; i < size; i++) {
    let bit = size >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { const r = real[i]; real[i] = real[j]; real[j] = r; const m = imag[i]; imag[i] = imag[j]; imag[j] = m; }
  }
  for (let width = 2; width <= size; width <<= 1) {
    const angle = -2 * Math.PI / width, wr = Math.cos(angle), wi = Math.sin(angle);
    for (let start = 0; start < size; start += width) {
      let cr = 1, ci = 0;
      for (let k = 0; k < width / 2; k++) {
        const a = start + k, b = a + width / 2;
        const tr = cr * real[b] - ci * imag[b], ti = cr * imag[b] + ci * real[b];
        real[b] = real[a] - tr; imag[b] = imag[a] - ti; real[a] += tr; imag[a] += ti;
        const next = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = next;
      }
    }
  }
}

const WINDOW = Float64Array.from({ length: FFT_SIZE }, (_, n) => 0.5 - 0.5 * Math.cos(2 * Math.PI * n / (FFT_SIZE - 1)));

/** Compute the spectrogram. `onProgress`/`yieldEvery` let the browser stay responsive. */
export async function computeSpectrum(samples, sampleRate, { yieldEvery = 400, onProgress } = {}) {
  if (!(samples?.length > 0) || !(sampleRate > 0)) throw new TypeError('samples and sampleRate are required');
  const frames = Math.max(1, Math.floor((samples.length - FFT_SIZE) / HOP) + 1);
  const raw = new Float32Array(frames * SPECTRUM_BANDS);
  const real = new Float64Array(FFT_SIZE), imag = new Float64Array(FFT_SIZE);
  const binHz = sampleRate / FFT_SIZE, bins = FFT_SIZE / 2;
  const first = new Int32Array(SPECTRUM_BANDS), last = new Int32Array(SPECTRUM_BANDS);
  for (let b = 0; b < SPECTRUM_BANDS; b++) {
    first[b] = Math.min(bins - 1, Math.max(1, Math.floor(bandHz(b) / binHz)));
    last[b] = Math.min(bins - 1, Math.max(first[b], Math.ceil(bandHz(b + 1) / binHz) - 1));
  }
  const tilt = Float64Array.from({ length: SPECTRUM_BANDS }, (_, b) => Math.sqrt(Math.sqrt(bandHz(b) * bandHz(b + 1)) / 1000)); // +3 dB per octave
  let globalMax = 1e-12;
  for (let f = 0; f < frames; f++) {
    const offset = f * HOP;
    for (let n = 0; n < FFT_SIZE; n++) { real[n] = (samples[offset + n] ?? 0) * WINDOW[n]; imag[n] = 0; }
    fft(real, imag);
    for (let b = 0; b < SPECTRUM_BANDS; b++) {
      let peak = 0;
      for (let k = first[b]; k <= last[b]; k++) peak = Math.max(peak, real[k] * real[k] + imag[k] * imag[k]);
      const mag = Math.sqrt(peak) / FFT_SIZE * tilt[b];
      raw[f * SPECTRUM_BANDS + b] = mag; if (mag > globalMax) globalMax = mag;
    }
    if (yieldEvery && f % yieldEvery === 0) { onProgress?.(f / frames); await new Promise(resolve => setTimeout(resolve, 0)); }
  }
  // Reference = 99.5th percentile of loudness so one stray click does not flatten the map.
  const sample = []; const stride = Math.max(1, Math.floor(raw.length / 20000));
  for (let i = 0; i < raw.length; i += stride) sample.push(raw[i]);
  sample.sort((a, b) => a - b);
  const ref = Math.max(sample[Math.floor(sample.length * 0.995)] || globalMax, 1e-9);
  const data = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    const db = 20 * Math.log10(Math.max(raw[i], 1e-12) / ref);
    data[i] = Math.round(Math.max(0, Math.min(1, (db + RANGE_DB) / RANGE_DB)) * 255);
  }
  onProgress?.(1);
  return { bands: SPECTRUM_BANDS, minHz: SPECTRUM_MIN_HZ, maxHz: SPECTRUM_MAX_HZ, hopSec: HOP / sampleRate, startSec: FFT_SIZE / 2 / sampleRate, frames, data };
}

/** Level (0–1) of one band in one frame, clamped to the available frames. */
export const spectrumCell = (spectrum, frame, band) => spectrum.data[Math.max(0, Math.min(spectrum.frames - 1, frame)) * spectrum.bands + band] / 255;

/** Peak level inside [lowHz, highHz] for one frame. */
export function rangeLevel(spectrum, frame, lowHz, highHz) {
  const a = Math.max(0, Math.min(spectrum.bands - 1, Math.floor(bandPosition(lowHz)))), b = Math.max(a, Math.min(spectrum.bands - 1, Math.ceil(bandPosition(highHz)) - 1));
  let peak = 0;
  for (let k = a; k <= b; k++) peak = Math.max(peak, spectrumCell(spectrum, frame, k));
  return peak;
}

/** Mean spectrum between two times, for the "what is in this clip" backdrop. */
export function averageSpectrum(spectrum, t0, t1) {
  const out = new Float32Array(spectrum.bands);
  const f0 = Math.max(0, Math.floor((t0 - spectrum.startSec) / spectrum.hopSec)), f1 = Math.min(spectrum.frames - 1, Math.max(f0, Math.ceil((t1 - spectrum.startSec) / spectrum.hopSec)));
  const step = Math.max(1, Math.floor((f1 - f0) / 400));
  let n = 0;
  for (let f = f0; f <= f1; f += step, n++) for (let b = 0; b < spectrum.bands; b++) out[b] += spectrumCell(spectrum, f, b);
  if (n) for (let b = 0; b < spectrum.bands; b++) out[b] /= n;
  return out;
}
