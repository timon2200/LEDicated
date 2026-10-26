import test from 'node:test';
import assert from 'node:assert/strict';
import { detectSections, SECTION_NAMES, SECTION_COLORS } from './audio-sections.mjs';

test('detectSections returns empty array on empty input', () => {
  assert.deepEqual(detectSections(null), []);
  assert.deepEqual(detectSections({}), []);
  assert.deepEqual(detectSections({ durationSec: 0 }), []);
});

test('detectSections finds structure in synthesized track profile', () => {
  // Simulate a 120s track at 120 BPM:
  // 0-20s: quiet intro (low rms, low bass/drums)
  // 20-60s: energetic drop (high rms, strong bass and drums)
  // 60-80s: quiet breakdown (dips in bass/drums)
  // 80-110s: second drop (high rms)
  // 110-120s: outro (fading)
  const durationSec = 120;
  const binSec = 0.1;
  const numBins = Math.round(durationSec / binSec);
  const rms = new Float32Array(numBins);
  const drums = new Float32Array(numBins);
  const bass = new Float32Array(numBins);

  for (let i = 0; i < numBins; i++) {
    const t = i * binSec;
    if (t < 20) {
      rms[i] = 0.2; drums[i] = 0.1; bass[i] = 0.1;
    } else if (t < 60) {
      rms[i] = 0.85; drums[i] = 0.8; bass[i] = 0.9;
    } else if (t < 80) {
      rms[i] = 0.3; drums[i] = 0.15; bass[i] = 0.1;
    } else if (t < 110) {
      rms[i] = 0.9; drums[i] = 0.85; bass[i] = 0.85;
    } else {
      rms[i] = 0.15; drums[i] = 0.05; bass[i] = 0.05;
    }
  }

  const analysis = {
    durationSec,
    bpm: 120,
    waveform: { rms, binSec },
    features: { drums, bass, hopSec: binSec }
  };

  const sections = detectSections(analysis);
  assert.deepEqual(sections.map(s => s.type), ['intro', 'drop', 'breakdown', 'drop', 'outro']);
  assert.deepEqual(sections.map(s => s.name), ['Uvod', 'Drop 1', 'Breakdown', 'Drop 2', 'Završetak']);
  assert.equal(sections[0].startSec, 0);
  assert.equal(sections[1].startSec, 20);
  assert.equal(sections[2].startSec, 60);
  assert.equal(sections[3].startSec, 80);
  assert.equal(sections[4].startSec, 110);
  assert.equal(sections.at(-1).endSec, 120);
  assert.ok(sections.every(s => s.durationSec > 0));
  assert.ok(sections.every(s => s.color === SECTION_COLORS[s.type]));
});

test('detectSections accurately classifies full EDM club structure with beatOffset', () => {
  // 120 BPM -> beatSec = 0.5s, barSec = 2.0s, 4-bar phrase = 8.0s
  // Non-zero downbeat offset: beatOffset = 0.4s
  // Bars 0..8   (0.0 .. 16.4s): Intro (Uvod)
  // Bars 8..16  (16.4 .. 32.4s): Verse (Strofa)
  // Bars 16..20 (32.4 .. 40.4s): Build 1 (Gradnja 1) - rising drums/energy, held-back bass
  // Bars 20..28 (40.4 .. 56.4s): Drop 1 (Drop 1) - full energy, heavy bass & drums
  // Bars 28..36 (56.4 .. 72.4s): Breakdown - atmospheric pads/vocals, low bass/drums
  // Bars 36..40 (72.4 .. 80.4s): Build 2 (Gradnja 2) - snare roll & rising energy + pre-drop dip
  // Bars 40..48 (80.4 .. 96.4s): Drop 2 (Drop 2) - peak energy, heavy bass & drums
  // Bars 48..52 (96.4 .. 104.4s): Outro (Završetak) - stripped down percussion fade
  const bpm = 120;
  const beatOffset = 0.4;
  const durationSec = 104.4;
  const binSec = 0.05;
  const numBins = Math.round(durationSec / binSec);
  const rms = new Float32Array(numBins);
  const drums = new Float32Array(numBins);
  const bass = new Float32Array(numBins);
  const vocals = new Float32Array(numBins);
  const other = new Float32Array(numBins);

  for (let i = 0; i < numBins; i++) {
    const t = i * binSec;
    if (t < 16.4) {
      // Intro
      rms[i] = 0.30; drums[i] = 0.35; bass[i] = 0.15; vocals[i] = 0.10; other[i] = 0.25;
    } else if (t < 32.4) {
      // Verse (steady mid-energy groove)
      rms[i] = 0.58; drums[i] = 0.55; bass[i] = 0.48; vocals[i] = 0.65; other[i] = 0.45;
    } else if (t < 40.4) {
      // Build 1 (rising ramp)
      const p = (t - 32.4) / 8.0;
      rms[i] = 0.50 + 0.32 * p;
      drums[i] = 0.45 + 0.48 * p;
      bass[i] = 0.20;
      vocals[i] = 0.40;
      other[i] = 0.40 + 0.50 * p;
    } else if (t < 56.4) {
      // Drop 1
      rms[i] = 0.90; drums[i] = 0.92; bass[i] = 0.95; vocals[i] = 0.35; other[i] = 0.85;
    } else if (t < 72.4) {
      // Breakdown
      rms[i] = 0.38; drums[i] = 0.12; bass[i] = 0.10; vocals[i] = 0.80; other[i] = 0.60;
    } else if (t < 80.4) {
      // Build 2 with 1-beat pre-drop silence at the very end
      const p = (t - 72.4) / 8.0;
      if (t >= 79.4) {
        rms[i] = 0.15; drums[i] = 0.10; bass[i] = 0.05; other[i] = 0.20;
      } else {
        rms[i] = 0.45 + 0.40 * p;
        drums[i] = 0.40 + 0.55 * p;
        bass[i] = 0.18;
        other[i] = 0.45 + 0.50 * p;
      }
    } else if (t < 96.4) {
      // Drop 2
      rms[i] = 0.95; drums[i] = 0.95; bass[i] = 0.96; vocals[i] = 0.40; other[i] = 0.90;
    } else {
      // Outro
      const p = (t - 96.4) / 8.0;
      rms[i] = 0.35 * (1 - 0.5 * p);
      drums[i] = 0.30 * (1 - 0.5 * p);
      bass[i] = 0.15;
      other[i] = 0.20;
    }
  }

  const beatsSec = [];
  for (let t = beatOffset; t <= durationSec; t += 0.5) {
    beatsSec.push(Math.round(t * 1000) / 1000);
  }

  const sections = detectSections({
    durationSec,
    bpm,
    beatsSec,
    waveform: { rms, binSec },
    features: { drums, bass, vocals, other, hopSec: binSec }
  });

  assert.deepEqual(
    sections.map(s => s.type),
    ['intro', 'verse', 'build', 'drop', 'breakdown', 'build', 'drop', 'outro']
  );
  assert.deepEqual(
    sections.map(s => s.name),
    ['Uvod', 'Strofa', 'Gradnja 1', 'Drop 1', 'Breakdown', 'Gradnja 2', 'Drop 2', 'Završetak']
  );
  // Check beat-grid alignment (0.4s offset)
  assert.equal(sections[0].startSec, 0);
  assert.equal(sections[1].startSec, 16.4);
  assert.equal(sections[2].startSec, 32.4);
  assert.equal(sections[3].startSec, 40.4);
  assert.equal(sections[4].startSec, 56.4);
  assert.equal(sections[5].startSec, 72.4);
  assert.equal(sections[6].startSec, 80.4);
  assert.equal(sections[7].startSec, 96.4);
  assert.equal(sections[7].endSec, 104.4);
});

test('detectSections handles compressed club masters and 1-bar pre-drop fakeout snapping', () => {
  // Compressed track where RMS is kept high (0.58..0.88) and Drop 1 has a 1-bar fakeout at 32..34s
  const bpm = 120; // barSec = 2.0s, 4-bar = 8.0s
  const durationSec = 96;
  const binSec = 0.05;
  const numBins = Math.round(durationSec / binSec);
  const rms = new Float32Array(numBins);
  const drums = new Float32Array(numBins);
  const bass = new Float32Array(numBins);
  const other = new Float32Array(numBins);

  for (let i = 0; i < numBins; i++) {
    const t = i * binSec;
    if (t < 8) {
      // Intro (compressed synths, low sub-bass)
      rms[i] = 0.60; drums[i] = 0.35; bass[i] = 0.20; other[i] = 0.60;
    } else if (t < 24) {
      // Verse (compressed vocal + mid groove)
      rms[i] = 0.70; drums[i] = 0.55; bass[i] = 0.48; other[i] = 0.65;
    } else if (t < 32) {
      // Build (rising snare/other, bass cut)
      const p = (t - 24) / 8;
      rms[i] = 0.66 + 0.16 * p;
      drums[i] = 0.50 + 0.42 * p;
      bass[i] = 0.22;
      other[i] = 0.60 + 0.35 * p;
    } else if (t < 34) {
      // 1-bar fakeout silence/fill inside the 32..40 block before Drop slams in at 34s!
      rms[i] = 0.25; drums[i] = 0.20; bass[i] = 0.10; other[i] = 0.30;
    } else if (t < 56) {
      // Drop (34..56s)
      rms[i] = 0.88; drums[i] = 0.92; bass[i] = 0.94; other[i] = 0.85;
    } else if (t < 72) {
      // Breakdown
      rms[i] = 0.62; drums[i] = 0.20; bass[i] = 0.18; other[i] = 0.70;
    } else if (t < 73) {
      // 2-beat (1.0s) sub-bar fakeout at start of Drop 2 before kick/bass slam in at 73s
      rms[i] = 0.30; drums[i] = 0.25; bass[i] = 0.10; other[i] = 0.40;
    } else if (t < 88) {
      // Drop 2
      rms[i] = 0.90; drums[i] = 0.94; bass[i] = 0.95; other[i] = 0.88;
    } else {
      // Outro
      rms[i] = 0.55; drums[i] = 0.30; bass[i] = 0.20; other[i] = 0.40;
    }
  }

  const sections = detectSections({
    durationSec,
    bpm,
    waveform: { rms, binSec },
    features: { drums, bass, other, hopSec: binSec }
  });

  const drops = sections.filter(s => s.type === 'drop');
  assert.equal(drops.length, 2, 'Should detect both drops');
  assert.equal(drops[0].startSec, 34, 'Drop 1 startSec should snap to 34s after 1-bar fakeout');
  assert.equal(drops[1].startSec, 73, 'Drop 2 startSec should snap to 73s after 2-beat fakeout');
  assert.ok(sections.some(s => s.type === 'verse'), 'Should detect Verse in compressed master');
  assert.ok(sections.some(s => s.type === 'build'), 'Should detect Build before Drop 1');
  assert.ok(sections.some(s => s.type === 'breakdown'), 'Should detect Breakdown');
  assert.equal(sections[0].type, 'intro');
  assert.equal(sections.at(-1).type, 'outro');
});
