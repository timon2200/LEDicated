/** One resampling path for WLED logical groups and the per-diode preview. */
export const SOURCE_SAMPLES = 12;
const cap = value => Math.max(0, Math.min(255, value));

export function mapBarPixels(source, { pixels, reverse = false }) {
  if (!Array.isArray(source) || source.length !== SOURCE_SAMPLES || !Number.isInteger(pixels) || pixels < 1 || pixels > 72 || typeof reverse !== 'boolean') throw new TypeError('Neispravan RGBW kadar ili mapiranje bara.');
  const samples = source.map(pixel => {
    if (!Array.isArray(pixel) || pixel.length !== 4 || pixel.some(value => !Number.isInteger(value) || value < 0 || value > 255)) throw new TypeError('RGBW uzorak mora imati četiri bajta.');
    return pixel.map(cap);
  });
  const groups = Array.from({ length: pixels }, (_, i) => [...samples[Math.min(SOURCE_SAMPLES - 1, Math.floor(i * SOURCE_SAMPLES / pixels))]]);
  return reverse ? groups.reverse() : groups;
}

/** Physical diodes can share one addressable group. They must then have the same frame color. */
export function physicalLedPixels(source, bar) {
  const groups = mapBarPixels(source, bar);
  const count = bar.physicalLeds ?? bar.pixels * 6;
  if (!Number.isInteger(count) || count < bar.pixels || count > 600) throw new TypeError('Neispravan broj fizičkih LED dioda.');
  return Array.from({ length: count }, (_, i) => groups[Math.min(groups.length - 1, Math.floor(i * groups.length / count))]);
}
