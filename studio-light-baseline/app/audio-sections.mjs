/** Automatic track section and structure detection.
 * Analyzes audio energy (RMS), percussion (drums), low-end (bass) and spectral content
 * across beat-aligned musical phrases (4-bar base grid with 1-bar/1-beat boundary snapping)
 * to discover the macro structure of a song: Intro, Verse, Build, Drop, Breakdown, Outro.
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

function percentile(values, q) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] * (1 - (pos - lo)) + sorted[hi] * (pos - lo);
}

function avgRange(arr, stepSec, t0, t1, offsetSec = 0) {
  if (!arr || !arr.length || t1 <= t0 || stepSec <= 0) return 0;
  const i0 = Math.max(0, Math.floor((t0 - offsetSec + 1e-9) / stepSec));
  const i1 = Math.min(arr.length - 1, Math.max(i0, Math.ceil((t1 - offsetSec - 1e-9) / stepSec) - 1));
  if (i1 < i0) return 0;
  let sum = 0;
  let count = 0;
  for (let i = i0; i <= i1; i++) {
    sum += Number(arr[i] || 0);
    count++;
  }
  return count ? sum / count : 0;
}

/** Detect structural sections in an analyzed audio track. */
export function detectSections(analysis) {
  if (!analysis) return [];
  const durationSec = Number(analysis.durationSec || analysis.duration || 0);
  if (!Number.isFinite(durationSec) || durationSec <= 0) return [];

  const bpm = Math.max(40, Math.min(240, Number(analysis.bpm || 120)));
  const beatSec = 60 / bpm;
  const barSec = 4 * beatSec;

  const rawBeatOffset = Number(analysis.beatsSec?.[0] || 0);
  const beatOffset = Number.isFinite(rawBeatOffset) && rawBeatOffset > 0
    ? (rawBeatOffset < barSec ? rawBeatOffset : rawBeatOffset % barSec)
    : 0;

  const rms = analysis.waveform?.rms || [];
  const binSec = Number(analysis.waveform?.binSec || 0.05);
  const drums = analysis.features?.drums || analysis.features?.stems?.drums || [];
  const bass = analysis.features?.bass || analysis.features?.stems?.bass || [];
  const vocals = analysis.features?.vocals || analysis.features?.stems?.vocals || [];
  const other = analysis.features?.other || analysis.features?.stems?.other || [];
  const hop = Number(analysis.features?.hopSec || 0.05);
  const featureStartSec = Number(analysis.features?.startSec || 0);

  // Build 1-bar frames anchored to beatOffset (with bar 0 starting at 0.0s)
  const bars = [];
  let cursor = 0;
  let barIdx = 0;
  while (cursor < durationSec - 1e-6) {
    const nextGrid = beatOffset + (barIdx + 1) * barSec;
    let t1 = Math.min(durationSec, nextGrid);
    if (durationSec - t1 < barSec * 0.45) t1 = durationSec;
    const t0 = cursor;
    const evalT0 = barIdx === 0 && beatOffset > 0 && t1 - beatOffset >= beatSec * 2 ? beatOffset : t0;
    const rAvg = avgRange(rms, binSec, evalT0, t1, 0);
    const dAvg = avgRange(drums, hop, evalT0, t1, featureStartSec);
    const bAvg = avgRange(bass, hop, evalT0, t1, featureStartSec);
    const vAvg = avgRange(vocals, hop, evalT0, t1, featureStartSec);
    const oAvg = avgRange(other, hop, evalT0, t1, featureStartSec);
    bars.push({ t0, t1, evalT0, rAvg, dAvg, bAvg, vAvg, oAvg });
    cursor = t1;
    barIdx++;
  }

  if (!bars.length) return [];

  const barRefRms = Math.max(percentile(bars.map(b => b.rAvg), 0.95), 0.01);
  const barRefBass = Math.max(percentile(bars.map(b => b.bAvg), 0.95), 0.20);
  const barJump = i => {
    if (i <= 0 || i >= bars.length) return 0;
    return Math.abs(bars[i].rAvg - bars[i - 1].rAvg) / barRefRms +
      0.8 * Math.abs(bars[i].bAvg - bars[i - 1].bAvg) / barRefBass;
  };

  // Group bars into 4-bar phrases (or 2-bar for short tracks < 90s),
  // snapping to 1-bar boundaries when a sharp step discontinuity occurs inside a block.
  const unitBars = durationSec < 90 ? 2 : 4;
  const phraseGroups = [];
  let curGroup = [];
  for (let i = 0; i < bars.length; i++) {
    if (curGroup.length > 0 && curGroup.length < unitBars && bars.length - i >= 2) {
      const curR = curGroup.reduce((s, b) => s + b.rAvg, 0) / curGroup.length;
      const curB = curGroup.reduce((s, b) => s + b.bAvg, 0) / curGroup.length;
      const lookahead = bars.slice(i, Math.min(bars.length, i + 2));
      const nextR = lookahead.reduce((s, b) => s + b.rAvg, 0) / lookahead.length;
      const nextB = lookahead.reduce((s, b) => s + b.bAvg, 0) / lookahead.length;
      const rStep = Math.abs(nextR - curR) / barRefRms;
      const bStep = Math.abs(nextB - curB) / barRefBass;
      const jNow = barJump(i);
      const jPrev = barJump(i - 1);
      const jNext = barJump(i + 1);
      const isSharpStep = (rStep > 0.24 || bStep > 0.30) && jNow > 1.65 * Math.max(jPrev, jNext, 0.08);
      if (isSharpStep) {
        phraseGroups.push(curGroup);
        curGroup = [];
      }
    }
    curGroup.push(bars[i]);
    if (curGroup.length >= unitBars) {
      phraseGroups.push(curGroup);
      curGroup = [];
    }
  }
  if (curGroup.length > 0) {
    if (phraseGroups.length > 0 && curGroup.length === 1 &&
        barJump(bars.length - 1) < 0.30) {
      phraseGroups.at(-1).push(...curGroup);
    } else {
      phraseGroups.push(curGroup);
    }
  }

  // Compute rich multi-stem and trend features per phrase
  const phrases = phraseGroups.map((group, idx) => {
    const t0 = group[0].t0;
    const evalT0 = group[0].evalT0;
    const t1 = group.at(-1).t1;
    const mid = (evalT0 + t1) / 2;

    const rAvg = avgRange(rms, binSec, evalT0, t1, 0);
    const dAvg = avgRange(drums, hop, evalT0, t1, featureStartSec);
    const bAvg = avgRange(bass, hop, evalT0, t1, featureStartSec);
    const vAvg = avgRange(vocals, hop, evalT0, t1, featureStartSec);
    const oAvg = avgRange(other, hop, evalT0, t1, featureStartSec);

    const rStart = avgRange(rms, binSec, evalT0, mid, 0);
    const rDecayEnd = avgRange(rms, binSec, mid, t1, 0);
    // Exclude final 1.5 beats when measuring rising build ramp in case of pre-drop silence
    const preDropCut = Math.max(mid + beatSec, t1 - 1.5 * beatSec);
    const rEnd = Math.max(rDecayEnd, avgRange(rms, binSec, mid, preDropCut, 0));

    const dStart = avgRange(drums, hop, evalT0, mid, featureStartSec);
    const dEnd = Math.max(
      avgRange(drums, hop, mid, t1, featureStartSec),
      avgRange(drums, hop, mid, preDropCut, featureStartSec)
    );
    const oStart = avgRange(other, hop, evalT0, mid, featureStartSec);
    const oEnd = Math.max(
      avgRange(other, hop, mid, t1, featureStartSec),
      avgRange(other, hop, mid, preDropCut, featureStartSec)
    );

    const dipWindowStart = Math.max(evalT0 + beatSec, t1 - 2 * beatSec);
    const dipRms = avgRange(rms, binSec, dipWindowStart, t1, 0);
    const dipBass = avgRange(bass, hop, dipWindowStart, t1, featureStartSec);
    const preDip = (t1 - evalT0 >= 2 * barSec) &&
      ((dipRms < rEnd * 0.68 && rEnd > 0.15) || (dipBass < bAvg * 0.45 && dEnd > dStart * 1.05));

    return {
      idx,
      t0,
      t1,
      rAvg,
      rStart,
      rEnd,
      rDecayEnd,
      rTrend: rEnd - rStart,
      dAvg,
      dStart,
      dEnd,
      dTrend: dEnd - dStart,
      bAvg,
      vAvg,
      oAvg,
      oStart,
      oEnd,
      preDip
    };
  });

  if (!phrases.length) return [];

  const refRms = Math.max(percentile(phrases.map(p => p.rAvg), 0.95), 0.01);
  const refBass = Math.max(percentile(phrases.map(p => p.bAvg), 0.95), 0.20);
  const refDrums = Math.max(percentile(phrases.map(p => p.dAvg), 0.95), 0.20);
  const refVocals = Math.max(percentile(phrases.map(p => p.vAvg), 0.95), 0.15);
  const refOther = Math.max(percentile(phrases.map(p => p.oAvg), 0.95), 0.15);

  for (const p of phrases) {
    p.relRms = p.rAvg / refRms;
    p.bRel = p.bAvg / refBass;
    p.dRel = p.dAvg / refDrums;
    p.vRel = p.vAvg / refVocals;
    p.oRel = p.oAvg / refOther;
    p.relCombined = 0.45 * p.relRms + 0.30 * p.bRel + 0.25 * p.dRel;
  }

  const minCombined = Math.min(...phrases.map(p => p.relCombined));
  const maxCombined = Math.max(...phrases.map(p => p.relCombined), 0.01);
  const combinedSpan = Math.max(0.08, maxCombined - minCombined);
  for (const p of phrases) {
    p.dynCombined = (p.relCombined - minCombined) / combinedSpan;
  }

  // Pass 1: Initial phrase classification
  for (let idx = 0; idx < phrases.length; idx++) {
    const p = phrases[idx];
    const prev = phrases[idx - 1] || null;
    const next = phrases[idx + 1] || null;
    const next2 = phrases[idx + 2] || null;

    const isIntroPos = idx === 0 ||
      (prev && prev.type === 'intro' && p.t1 <= Math.min(durationSec * 0.25, 36) &&
        Math.abs(p.relCombined - prev.relCombined) < 0.12);
    const isOutroPos = idx === phrases.length - 1 ||
      (idx === phrases.length - 2 && phrases.length >= 6 && p.t0 >= durationSec * 0.78 &&
        (phrases.at(-1).relCombined < 0.75 || phrases.at(-1).bRel < 0.60));

    const hasRisingTension =
      p.rEnd > p.rStart * 1.12 ||
      p.dEnd > p.dStart * 1.14 ||
      (p.oEnd > p.oStart * 1.16 && p.dRel >= 0.28) ||
      (p.preDip && (p.rEnd > p.rStart * 1.04 || p.dEnd > p.dStart * 1.04));

    const isHighDrop =
      p.relRms >= 0.76 &&
      p.bRel >= 0.55 &&
      p.dRel >= 0.50 &&
      p.relCombined >= 0.74 &&
      p.dynCombined >= 0.62;

    const isSurgeDrop = prev &&
      (p.rAvg >= prev.rAvg * 1.25 || p.relCombined >= prev.relCombined * 1.25) &&
      (p.bAvg >= prev.bAvg * 1.35 || p.dAvg >= prev.dAvg * 1.35) &&
      p.bRel >= 0.55 &&
      p.dRel >= 0.50 &&
      p.relRms >= 0.72;

    const targetAfterBuild = (next && (next.t1 - next.t0 <= barSec * 1.5) && next2) ? next2 : next;

    if (isIntroPos && !isHighDrop && (p.relCombined < 0.78 || p.bRel < 0.65 || p.relRms < 0.75) &&
        !(idx >= 1 && hasRisingTension)) {
      p.type = 'intro';
    } else if (isOutroPos && !isHighDrop &&
        (p.relCombined < 0.75 || p.bRel < 0.60 || p.relRms < 0.75 || p.rDecayEnd < p.rStart * 0.82)) {
      p.type = 'outro';
    } else if (hasRisingTension && (p.bRel < 0.76 || p.relCombined < 0.88) &&
        (!targetAfterBuild || targetAfterBuild.relCombined >= p.relCombined * 0.90 || targetAfterBuild.bRel >= p.bRel * 1.15)) {
      p.type = 'build';
    } else if (isHighDrop || isSurgeDrop) {
      p.type = 'drop';
    } else if (p.bRel < 0.45 || p.dRel < 0.45 || (p.relRms < 0.54 && p.relCombined < 0.52)) {
      p.type = 'breakdown';
    } else {
      p.type = 'verse';
    }
  }

  // Pass 2: Context-aware refinement (pre-drop builds, fakeouts, post-build drops, post-drop breakdowns)
  let seenDrop = false;
  let seenVerseOrDrop = false;
  for (let idx = 0; idx < phrases.length; idx++) {
    const p = phrases[idx];
    const prev = phrases[idx - 1] || null;
    const next = phrases[idx + 1] || null;

    // A short 1-bar fakeout/dip immediately between a build and a drop belongs to the build
    if (prev && prev.type === 'build' && next && (next.type === 'drop' || next.bRel >= 0.65) &&
        (p.t1 - p.t0 <= barSec * 1.5)) {
      p.type = 'build';
    }

    // If previous phrase was a build and this phrase surges with strong bass & drums, it's a drop
    if (prev && prev.type === 'build' && p.type !== 'drop' && p.type !== 'build' && p.type !== 'outro') {
      if (p.bRel >= 0.55 && p.dRel >= 0.50 &&
          (p.bRel >= prev.bRel * 1.20 || p.relCombined >= prev.relCombined * 1.10 || p.relRms >= 0.74)) {
        p.type = 'drop';
      }
    }

    // If next phrase is a drop, check if current phrase is a build-up leading into it
    if (next && next.type === 'drop' && p.type !== 'drop' && p.type !== 'intro' && p.type !== 'outro') {
      const risesInternally =
        p.rEnd > p.rStart * 1.06 ||
        p.dEnd > p.dStart * 1.06 ||
        p.oEnd > p.oStart * 1.08 ||
        p.preDip;
      const risesFromPrev = prev && prev.type !== 'drop' && (
        p.rAvg > prev.rAvg * 1.12 ||
        p.dAvg > prev.dAvg * 1.15 ||
        p.oAvg > prev.oAvg * 1.15
      );
      if (risesInternally || risesFromPrev) {
        p.type = 'build';
      }
    }

    if (p.type === 'drop') {
      seenDrop = true;
      seenVerseOrDrop = true;
    } else if (p.type === 'verse') {
      if (seenDrop && (p.bRel < 0.52 || p.dRel < 0.48 || p.relCombined < 0.66 || p.dynCombined < 0.45)) {
        p.type = 'breakdown';
      } else if (seenVerseOrDrop && (p.relRms < 0.68 && p.relCombined < 0.62 && (p.bRel < 0.48 || p.dRel < 0.48))) {
        p.type = 'breakdown';
      } else {
        seenVerseOrDrop = true;
      }
    }
  }

  // Second pass check for pre-drop build in case a post-build drop was promoted above
  for (let idx = 0; idx < phrases.length - 1; idx++) {
    const p = phrases[idx];
    const prev = phrases[idx - 1] || null;
    const next = phrases[idx + 1];
    const next2 = phrases[idx + 2] || null;
    const leadsToDrop = next.type === 'drop' ||
      (next.type === 'build' && (next.t1 - next.t0 <= barSec * 1.5) && next2 && next2.type === 'drop');
    if (leadsToDrop && (p.type === 'verse' || p.type === 'breakdown')) {
      const risesInternally =
        p.rEnd > p.rStart * 1.06 ||
        p.dEnd > p.dStart * 1.06 ||
        p.oEnd > p.oStart * 1.08 ||
        p.preDip;
      const risesFromPrev = prev && prev.type !== 'drop' && (
        p.rAvg > prev.rAvg * 1.12 ||
        p.dAvg > prev.dAvg * 1.15 ||
        p.oAvg > prev.oAvg * 1.15
      );
      if (risesInternally || risesFromPrev) {
        p.type = 'build';
      }
    }
  }

  // Pass 3: Macro-structure consolidation (absorb intra-drop turnarounds, demote orphan builds,
  // ensure pre-Drop-1 melodic grooves are Verse rather than Breakdown, and clean Outro tails)
  const maxIntraDropTurnaroundSec = Math.max(barSec * 2.25, 4.5);
  for (let idx = 1; idx < phrases.length - 1; idx++) {
    const p = phrases[idx];
    if (p.type !== 'drop' && phrases[idx - 1].type === 'drop' && phrases[idx + 1].type === 'drop') {
      const dur = p.t1 - p.t0;
      if ((dur <= maxIntraDropTurnaroundSec && p.relRms >= 0.25) ||
          (dur <= Math.max(4 * barSec, 7.0) && p.relRms >= 0.75 && p.bRel >= 0.45)) {
        p.type = 'drop';
      }
    }
  }

  const maxBuildDurationSec = Math.max(4 * barSec, 15);
  for (let idx = 0; idx < phrases.length; idx++) {
    const p = phrases[idx];
    if (p.type !== 'build') continue;
    let j = idx + 1;
    while (j < phrases.length && phrases[j].type === 'build') j++;
    const leadsToDrop = j < phrases.length && phrases[j].type === 'drop';
    const dropStartSec = leadsToDrop ? phrases[j].t0 : Infinity;
    if (!leadsToDrop || (dropStartSec - p.t0) > maxBuildDurationSec) {
      const afterDrop = phrases.slice(0, idx).some(x => x.type === 'drop');
      const hasFutureDrop = phrases.slice(idx + 1).some(x => x.type === 'drop');
      if (!afterDrop) {
        if ((idx === 0 || phrases[idx - 1].type === 'intro') &&
            p.t1 <= Math.min(durationSec * 0.18, 22) && p.relCombined < 0.45) {
          p.type = 'intro';
        } else {
          p.type = 'verse';
        }
      } else if (!hasFutureDrop && p.t0 >= durationSec * 0.80 && p.bRel < 0.45) {
        p.type = 'outro';
      } else {
        p.type = 'breakdown';
      }
    }
  }

  const firstDropIdx = phrases.findIndex(p => p.type === 'drop');
  if (firstDropIdx > 0) {
    for (let idx = 0; idx < firstDropIdx; idx++) {
      const p = phrases[idx];
      if (p.type === 'breakdown') {
        if (idx > 0 && phrases[idx - 1].type === 'intro' &&
            p.t1 <= Math.min(durationSec * 0.12, 16) && p.relCombined < 0.28) {
          p.type = 'intro';
        } else {
          p.type = 'verse';
        }
      }
    }
  }

  const lastDropIdx = phrases.findLastIndex(p => p.type === 'drop');
  for (let idx = 0; idx < phrases.length; idx++) {
    const p = phrases[idx];
    if (firstDropIdx >= 0 && idx > firstDropIdx && idx < lastDropIdx) {
      if (p.type === 'verse' && p.bRel < 0.68) {
        const prevType = phrases[idx - 1]?.type;
        const nextType = phrases[idx + 1]?.type;
        if (prevType === 'breakdown' || nextType === 'breakdown' || nextType === 'build') {
          p.type = 'breakdown';
        }
      }
    } else if (lastDropIdx >= 0 && idx > lastDropIdx) {
      if (p.type === 'verse' && p.bRel < 0.68) {
        p.type = 'breakdown';
      }
      if (p.t0 >= durationSec * 0.85 && p.bRel < 0.48 && p.relCombined < 0.60) {
        p.type = 'outro';
      }
    }
  }

  // Merge adjacent phrases with identical type
  const rawMerged = [];
  let cur = null;
  for (const p of phrases) {
    if (!cur) {
      cur = {
        type: p.type,
        startSec: p.t0,
        endSec: p.t1,
        rAvg: p.rAvg,
        dAvg: p.dAvg,
        bAvg: p.bAvg,
        weight: p.t1 - p.t0
      };
    } else if (cur.type === p.type) {
      const w = p.t1 - p.t0;
      const totalW = cur.weight + w;
      cur.endSec = p.t1;
      cur.rAvg = (cur.rAvg * cur.weight + p.rAvg * w) / totalW;
      cur.dAvg = (cur.dAvg * cur.weight + p.dAvg * w) / totalW;
      cur.bAvg = (cur.bAvg * cur.weight + p.bAvg * w) / totalW;
      cur.weight = totalW;
    } else {
      rawMerged.push(cur);
      cur = {
        type: p.type,
        startSec: p.t0,
        endSec: p.t1,
        rAvg: p.rAvg,
        dAvg: p.dAvg,
        bAvg: p.bAvg,
        weight: p.t1 - p.t0
      };
    }
  }
  if (cur) rawMerged.push(cur);

  // Consolidate short 1-phrase breakdown+build micro-pairs between drops and short breakdown tails before outro
  if (rawMerged.length >= 2 && rawMerged.at(-1).type === 'outro' && rawMerged.at(-2).type === 'breakdown') {
    const penult = rawMerged.at(-2);
    if ((penult.endSec - penult.startSec) <= Math.max(4 * barSec, 7.5)) {
      penult.type = 'outro';
    }
  }
  for (let m = 1; m < rawMerged.length - 1; m++) {
    const sec = rawMerged[m];
    const nextSec = rawMerged[m + 1];
    if (sec.type === 'breakdown' && nextSec && nextSec.type === 'build' && rawMerged[m - 1].type === 'drop') {
      const bDur = sec.endSec - sec.startSec;
      const gDur = nextSec.endSec - nextSec.startSec;
      const singlePhraseMax = 4 * barSec + 0.25;
      if (((bDur <= Math.max(2.2 * barSec, 6.25) || gDur <= Math.max(2.2 * barSec, 6.0)) &&
           (bDur + gDur) <= Math.max(6.2 * barSec, 17.5)) ||
          (bDur <= singlePhraseMax && gDur <= singlePhraseMax && nextSec.rAvg <= sec.rAvg * 1.16)) {
        sec.type = bDur <= gDur && nextSec.rAvg > sec.rAvg * 1.12 ? 'build' : (nextSec.rAvg > sec.rAvg * 1.16 ? 'build' : 'breakdown');
        nextSec.type = sec.type;
      }
    }
  }

  const merged = [];
  for (const s of rawMerged) {
    const prev = merged.at(-1);
    if (prev && prev.type === s.type) {
      const totalW = prev.weight + s.weight;
      prev.endSec = s.endSec;
      prev.rAvg = (prev.rAvg * prev.weight + s.rAvg * s.weight) / totalW;
      prev.dAvg = (prev.dAvg * prev.weight + s.dAvg * s.weight) / totalW;
      prev.bAvg = (prev.bAvg * prev.weight + s.bAvg * s.weight) / totalW;
      prev.weight = totalW;
    } else {
      merged.push(s);
    }
  }

  // Refine drop start boundaries at 1-beat resolution (e.g. after 1-2 bar fakeout/silence or sub-bar entry)
  for (let m = 1; m < merged.length; m++) {
    const sec = merged[m];
    const prev = merged[m - 1];
    if (sec.type !== 'drop') continue;

    // Check if the drop actually slammed in 1..3 beats before sec.startSec (inside the last bar of prev)
    const maxBackBeats = Math.min(3, Math.floor((prev.endSec - prev.startSec - beatSec + 1e-6) / beatSec));
    let snappedBack = false;
    if (maxBackBeats >= 1) {
      let backSteps = 0;
      for (let k = 1; k <= maxBackBeats; k++) {
        const bt0 = sec.startSec - k * beatSec;
        const bt1 = bt0 + beatSec;
        const bRms = avgRange(rms, binSec, bt0, bt1, 0);
        const bBass = avgRange(bass, hop, bt0, bt1, featureStartSec);
        if (bBass >= sec.bAvg * 0.75 && bRms >= sec.rAvg * 0.82) {
          backSteps = k;
        } else {
          break;
        }
      }
      if (backSteps > 0) {
        const newBoundary = sec.startSec - backSteps * beatSec;
        prev.endSec = newBoundary;
        sec.startSec = newBoundary;
        snappedBack = true;
      }
    }

    const maxScanBeats = Math.min(8, Math.floor((sec.endSec - sec.startSec - barSec) / beatSec));
    if (!snappedBack && maxScanBeats >= 1) {
      const firstBeatRms = avgRange(rms, binSec, sec.startSec, sec.startSec + beatSec, 0);
      const firstBeatBass = avgRange(bass, hop, sec.startSec, sec.startSec + beatSec, featureStartSec);
      if (firstBeatBass < sec.bAvg * 0.50 && firstBeatRms < sec.rAvg * 0.75) {
        for (let k = 1; k <= maxScanBeats; k++) {
          const bt0 = sec.startSec + k * beatSec;
          const bt1 = bt0 + beatSec;
          const bRms = avgRange(rms, binSec, bt0, bt1, 0);
          const bBass = avgRange(bass, hop, bt0, bt1, featureStartSec);
          if (bBass >= sec.bAvg * 0.55 || bRms >= sec.rAvg * 0.78) {
            prev.endSec = bt0;
            sec.startSec = bt0;
            break;
          }
        }
      }
    }

    // Ensure a pre-drop build that got shortened by beat-snapping has at least 2 bars of ramp when preceded by a long breakdown
    if (prev.type === 'build' && m >= 2 && (prev.endSec - prev.startSec) < 2 * barSec) {
      const beforePrev = merged[m - 2];
      const desiredBuildSec = Math.min(4 * barSec, Math.floor((beforePrev.endSec - beforePrev.startSec) * 0.35 / barSec) * barSec);
      if (beforePrev.type === 'breakdown' && desiredBuildSec >= 2 * barSec) {
        const shift = desiredBuildSec - (prev.endSec - prev.startSec);
        if (shift > 0 && (beforePrev.endSec - beforePrev.startSec - shift) >= 4 * barSec) {
          beforePrev.endSec -= shift;
          prev.startSec -= shift;
        }
      }
    }
  }

  // Assign indexed Croatian names (Drop 1, Drop 2, Gradnja 1, etc.)
  const maxRms = Math.max(...merged.map(s => s.rAvg), 0.01);
  const counts = {};
  return merged.map((s, i) => {
    counts[s.type] = (counts[s.type] || 0) + 1;
    const count = counts[s.type];
    const totalOfType = merged.filter(x => x.type === s.type).length;
    const name = totalOfType > 1 && s.type !== 'intro' && s.type !== 'outro'
      ? `${SECTION_NAMES[s.type]} ${count}`
      : SECTION_NAMES[s.type];
    const startSec = i === 0 ? 0 : Math.round(s.startSec * 100) / 100;
    const endSec = i === merged.length - 1
      ? Math.round(durationSec * 100) / 100
      : Math.round(s.endSec * 100) / 100;
    return {
      id: `sec-${i + 1}`,
      name,
      type: s.type,
      startSec,
      endSec,
      durationSec: Math.round((endSec - startSec) * 100) / 100,
      energy: Math.round(Math.min(1, s.rAvg / maxRms) * 100) / 100,
      color: SECTION_COLORS[s.type]
    };
  });
}
