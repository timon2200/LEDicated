import test from 'node:test';
import assert from 'node:assert/strict';
import { zoomAround, panByPixels } from './timeline-viewport.mjs';

test('pinch zoom keeps time below cursor fixed and clamps to song boundaries', () => {
  const next = zoomAround({ durationSec: 300, zoom: 2, startSec: 100, anchorSec: 175, factor: 2 });
  assert.equal(next.zoom, 4);
  assert.equal(next.startSec, 137.5);
  assert.equal(zoomAround({ durationSec: 300, zoom: 1, startSec: 0, anchorSec: 299, factor: .1 }).startSec, 0);
  assert.equal(zoomAround({ durationSec: 300, zoom: 16, startSec: 280, anchorSec: 299, factor: 9 }).zoom, 32);
});

test('two-finger pan moves visible window and never exceeds end of song', () => {
  assert.equal(panByPixels({ durationSec: 300, zoom: 3, startSec: 50, deltaPx: 250, widthPx: 500 }), 100);
  assert.equal(panByPixels({ durationSec: 300, zoom: 3, startSec: 195, deltaPx: 100, widthPx: 500 }), 200);
  assert.equal(panByPixels({ durationSec: 300, zoom: 3, startSec: 3, deltaPx: -100, widthPx: 500 }), 0);
});
