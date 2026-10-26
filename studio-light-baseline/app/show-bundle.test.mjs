import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PACK_MAGIC,
  sanitizeFilename,
  compactAnalysisForShow,
  encodeShowJson,
  decodeShowJson,
  encodeLedPack,
  decodeLedPack,
  detectBundleKind
} from './show-bundle.mjs';

const sampleTimeline = () => ({
  version: 1,
  durationSec: 45,
  bpm: 128,
  beatOffsetSec: 0.1,
  blackout: false,
  layers: [
    {
      id: 'layer-1',
      name: 'Glavni sloj',
      enabled: true,
      blend: 'screen',
      opacity: 0.85,
      clips: [
        {
          id: 'clip-1',
          preset: 'pulse',
          startSec: 0,
          durationSec: 16,
          targets: 'all',
          color: [0.2, 0.6, 1, 0],
          driver: 'drums',
          driverGain: 1,
          keyframes: [
            { timeSec: 0, value: 1 },
            { timeSec: 16, value: 1 }
          ]
        }
      ]
    }
  ]
});

const sampleAnalysis = () => ({
  durationSec: 45,
  bpm: 128,
  beatOffsetSec: 0.1,
  beatsSec: [0.1, 0.568, 1.037],
  sections: [
    { id: 's1', name: 'Drop', type: 'drop', startSec: 0, endSec: 45, durationSec: 45, energy: 0.9, color: '#ff0054' }
  ],
  waveform: [0.1, 0.5, 0.9],
  features: { drums: [0.2, 0.8, 0.4] }
});

test('sanitizeFilename strips extensions and unsafe characters', () => {
  assert.equal(sanitizeFilename('Fred again.. - places to be.mp3'), 'Fred again.. - places to be');
  assert.equal(sanitizeFilename('Song: "Drop" / Test?.ledpack'), 'Song Drop Test');
  assert.equal(sanitizeFilename('   '), 'ledicated-show');
});

test('encodeShowJson and decodeShowJson roundtrip show and compact analysis', () => {
  const track = {
    id: '638fd61e-1f6d-47da-9216-abdf396dcb38',
    title: 'Club Banger',
    originalName: 'Club Banger.mp3',
    extension: '.mp3',
    sha256: 'a'.repeat(64),
    videoId: 'abc123xyz',
    sourceUrl: 'https://www.youtube.com/watch?v=abc123xyz',
    theme: 'cyber'
  };
  const encoded = encodeShowJson({
    track,
    analysis: sampleAnalysis(),
    timeline: sampleTimeline(),
    author: 'Timon'
  });
  assert.equal(encoded.format, 'ledicated-show');
  assert.equal(encoded.author, 'Timon');
  assert.equal(encoded.track.title, 'Club Banger');
  assert.equal(encoded.track.videoId, 'abc123xyz');
  assert.equal(encoded.analysis.features, undefined, 'Compact show analysis omits heavy raw features');
  assert.equal(encoded.analysis.sections.length, 1);

  const buf = Buffer.from(JSON.stringify(encoded), 'utf8');
  assert.equal(detectBundleKind(buf), 'show');

  const decoded = decodeShowJson(buf);
  assert.equal(decoded.format, 'ledicated-show');
  assert.equal(decoded.author, 'Timon');
  assert.equal(decoded.track.sha256, 'a'.repeat(64));
  assert.equal(decoded.timeline.layers.length, 1);
  assert.equal(decoded.timeline.layers[0].clips[0].preset, 'pulse');
});

test('encodeLedPack and decodeLedPack roundtrip binary LPK1 package with audio, analysis, and timeline', () => {
  const audioBytes = Buffer.from('ID3-simulated-mp3-audio-payload-0123456789');
  const track = {
    title: 'Office Anthem',
    originalName: 'Office Anthem.mp3',
    extension: '.mp3',
    sha256: 'b'.repeat(64)
  };
  const pack = encodeLedPack({
    track,
    analysis: sampleAnalysis(),
    timeline: sampleTimeline(),
    audioBuffer: audioBytes,
    author: 'Marko'
  });

  assert.equal(pack.subarray(0, 4).toString('ascii'), PACK_MAGIC);
  assert.equal(detectBundleKind(pack), 'pack');

  const decoded = decodeLedPack(pack);
  assert.equal(decoded.format, 'ledicated-pack');
  assert.equal(decoded.author, 'Marko');
  assert.equal(decoded.track.title, 'Office Anthem');
  assert.deepEqual(decoded.audioBuffer, audioBytes);
  assert.deepEqual(decoded.analysis.features.drums, [0.2, 0.8, 0.4]);
  assert.equal(decoded.timeline.layers.length, 1);
});

test('decodeLedPack and decodeShowJson reject malformed payloads and invalid timelines', () => {
  assert.throws(() => decodeLedPack(Buffer.from('NOT_A_PACK')), /LPK1/);
  assert.throws(() => decodeShowJson('{"layers": "bad"}'), /Neispravan|vremensku traku/);
  assert.equal(detectBundleKind(Buffer.from([0x00, 0x01, 0x02])), null);
});
