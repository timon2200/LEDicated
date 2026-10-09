/** Automatic track section and structure detection.
 * Analyzes audio energy (RMS), percussion (drums), low-end (bass) and spectral content
 * across musical phrases (quantized to 8 or 16 bars) to discover the macro structure of
 * a song: Intro, Verse, Build, Drop / Chorus, Breakdown, Outro.
 * Pure and deterministic.
 */

export const SECTION_TYPES = Object.freeze(['intro', 'verse', 'build', 'drop', 'breakdown', 'outro']);

export const SECTION_NAMES = Object.freeze({
  intro: 'Uvod',
  verse: 'Strofa',
  build: 'Gradnja',
  drop: 'Drop',
  breakdown: 'Breakdown',
  outro: 'Završetak'
});

export const SECTION_COLORS = Object.freeze({
  intro: '#3a86ff',
  verse: '#00b4d8',
  build: '#ffb703',
  drop: '#ff0054',
  breakdown: '#9d4edd',
  outro: '#48cae4'
});

/** Detect structural sections in an analyzed audio track. */
export function detectSections(analysis) {
  if (!analysis) return [];
  const durationSec = Number(analysis.durationSec || analysis.duration || 0);
  if (durationSec <= 0) return [];
  const bpm = Math.max(40, Math.min(240, Number(analysis.bpm || 120)));
  const barSec = (4 * 60) / bpm;
  // 8-bar musical phrase
  const phraseBars = durationSec > 180 ? 8 : 4;
  const phraseSec = phraseBars * barSec;
  const numPhrases = Math.ceil(durationSec / phraseSec);

  const rms = analysis.waveform?.rms || [];
  const binSec = Number(analysis.waveform?.binSec || 0.05);
  const drums = analysis.features?.drums || [];
  const bass = analysis.features?.bass || [];
  const hop = Number(analysis.features?.hopSec || 0.05);

  const phrases = [];
  for (let i = 0; i < numPhrases; i++) {
    const t0 = i * phraseSec;
    const t1 = Math.min(durationSec, (i + 1) * phraseSec);
    if (t1 - t0 < barSec * 0.5) continue;

    // RMS avg and trend
    const i0 = Math.max(0, Math.floor(t0 / binSec));
    const i1 = Math.min(rms.length - 1, Math.floor(t1 / binSec));
    let rSum = 0, rCount = 0;
    for (let k = i0; k <= i1; k++) { rSum += rms[k] || 0; rCount++; }
    const rAvg = rCount ? rSum / rCount : 0;

    const mid = Math.floor((i0 + i1) / 2);
    let rFirst = 0, cFirst = 0, rLast = 0, cLast = 0;
    for (let k = i0; k <= mid; k++) { rFirst += rms[k] || 0; cFirst++; }
    for (let k = mid + 1; k <= i1; k++) { rLast += rms[k] || 0; cLast++; }
    const rStart = cFirst ? rFirst / cFirst : 0;
    const rEnd = cLast ? rLast / cLast : 0;

    // Drums & Bass avg
    const d0 = Math.max(0, Math.floor(t0 / hop));
    const d1 = Math.min(drums.length - 1, Math.floor(t1 / hop));
    let dSum = 0, bSum = 0, fCount = 0;
    for (let k = d0; k <= d1; k++) {
      dSum += drums[k] || 0;
      bSum += bass[k] || 0;
      fCount++;
    }
    const dAvg = fCount ? dSum / fCount : 0;
    const bAvg = fCount ? bSum / fCount : 0;

    phrases.push({ t0, t1, rAvg, rStart, rEnd, dAvg, bAvg });
  }

  if (!phrases.length) return [];

  const allRms = phrases.map(p => p.rAvg);
  const maxRms = Math.max(...allRms, 0.01);

  // Classify each phrase
  const raw = phrases.map((p, idx) => {
    let type = 'verse';
    const isFirst = idx === 0;
    const isLast = idx === phrases.length - 1;
    const relRms = p.rAvg / maxRms;

    if (isFirst && relRms < 0.65) {
      type = 'intro';
    } else if (isLast && relRms < 0.7) {
      type = 'outro';
    } else if (p.bAvg < 0.28 && p.dAvg < 0.35 && relRms < 0.75) {
      type = 'breakdown';
    } else if (p.rEnd > p.rStart * 1.25 && relRms < 0.85 && p.dAvg > 0.2) {
      type = 'build';
    } else if (relRms >= 0.82 && p.bAvg > 0.35) {
      type = 'drop';
    } else if (relRms >= 0.65) {
      type = 'verse';
    } else {
      type = idx < phrases.length / 2 ? 'verse' : 'breakdown';
    }
    return { ...p, type };
  });

  // Merge adjacent phrases with identical type
  const merged = [];
  let cur = null;
  for (const p of raw) {
    if (!cur) {
      cur = { type: p.type, startSec: p.t0, endSec: p.t1, rAvg: p.rAvg, dAvg: p.dAvg, bAvg: p.bAvg };
    } else if (cur.type === p.type) {
      cur.endSec = p.t1;
      cur.rAvg = (cur.rAvg + p.rAvg) / 2;
      cur.dAvg = (cur.dAvg + p.dAvg) / 2;
      cur.bAvg = (cur.bAvg + p.bAvg) / 2;
    } else {
      merged.push(cur);
      cur = { type: p.type, startSec: p.t0, endSec: p.t1, rAvg: p.rAvg, dAvg: p.dAvg, bAvg: p.bAvg };
    }
  }
  if (cur) merged.push(cur);

  // Assign indexed names (Drop 1, Drop 2, etc.)
  const counts = {};
  return merged.map((s, i) => {
    counts[s.type] = (counts[s.type] || 0) + 1;
    const count = counts[s.type];
    const totalOfType = merged.filter(x => x.type === s.type).length;
    const name = totalOfType > 1 && s.type !== 'intro' && s.type !== 'outro'
      ? `${SECTION_NAMES[s.type]} ${count}`
      : SECTION_NAMES[s.type];
    return {
      id: `sec-${i + 1}`,
      name,
      type: s.type,
      startSec: Math.round(s.startSec * 100) / 100,
      endSec: Math.round(s.endSec * 100) / 100,
      durationSec: Math.round((s.endSec - s.startSec) * 100) / 100,
      energy: Math.round((s.rAvg / maxRms) * 100) / 100,
      color: SECTION_COLORS[s.type]
    };
  });
}
