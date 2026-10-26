import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTrackTitle, fmtDuration, drawCardBanner, createSongLauncher } from './daw-browser.mjs';

test('parseTrackTitle parses artist and title correctly', () => {
  const t1 = parseTrackTitle('Klangkuenstler, Ski Aggu - Sonne Geht Auf (full track)');
  assert.equal(t1.artist, 'Klangkuenstler, Ski Aggu');
  assert.equal(t1.title, 'Sonne Geht Auf (full track)');

  const t2 = parseTrackTitle('Sounds');
  assert.equal(t2.artist, '');
  assert.equal(t2.title, 'Sounds');

  const t3 = parseTrackTitle('Artist - Track - Remix');
  assert.equal(t3.artist, 'Artist');
  assert.equal(t3.title, 'Track - Remix');

  const t4 = parseTrackTitle('');
  assert.equal(t4.title, 'Nepoznato');
});

test('fmtDuration formats duration in minutes and seconds', () => {
  assert.equal(fmtDuration(0), '0:00');
  assert.equal(fmtDuration(45), '0:45');
  assert.equal(fmtDuration(75), '1:15');
  assert.equal(fmtDuration(273.85), '4:33');
  assert.equal(fmtDuration(-10), '0:00');
  assert.equal(fmtDuration(null), '0:00');
});

test('drawCardBanner renders onto a canvas mock without error', () => {
  const operations = [];
  const fakeCanvas = {
    width: 300,
    height: 100,
    getContext: () => ({
      clearRect: (...args) => operations.push(['clearRect', args]),
      createLinearGradient: () => ({
        addColorStop: (...args) => operations.push(['addColorStop', args])
      }),
      fillRect: (...args) => operations.push(['fillRect', args]),
      beginPath: () => operations.push(['beginPath']),
      moveTo: () => operations.push(['moveTo']),
      lineTo: () => operations.push(['lineTo']),
      stroke: () => operations.push(['stroke'])
    })
  };

  const track = { title: 'Klangkuenstler, Ski Aggu - Sonne Geht Auf (full track)' };
  const analysis = { bpm: 156.6, energy: 0.9, envelopes: { energy: [0.2, 0.8, 0.95, 0.5] } };

  assert.doesNotThrow(() => {
    drawCardBanner(fakeCanvas, track, analysis, false);
    drawCardBanner(fakeCanvas, track, analysis, true);
  });
  assert(operations.length > 10, 'Canvas operations performed');
});
