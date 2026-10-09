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
  assert.ok(sections.length >= 3, `Expected at least 3 sections, got ${sections.length}`);
  assert.equal(sections[0].type, 'intro');
  assert.ok(sections.some(s => s.type === 'drop'), 'Contains drop');
  assert.ok(sections.every(s => s.durationSec > 0));
  assert.ok(sections.every(s => s.color.startsWith('#')));
  assert.ok(sections.every(s => typeof s.name === 'string' && s.name.length > 0));
  assert.equal(sections[0].startSec, 0);
  assert.equal(sections.at(-1).endSec, 120);
});
