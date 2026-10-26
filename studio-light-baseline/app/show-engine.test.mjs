import test from 'node:test';
import assert from 'node:assert/strict';
import { createShowEngine, packFrameToBuffer, unpackFrameFromBuffer } from './show-engine.mjs';
import { renderTimelineFrame, pattern } from './timeline.mjs';
import { createPerformance } from './live-performance-state.mjs';
import { defaultConfig } from './server.mjs';
import { routesForNode } from './hardware-topology.mjs';

const sampleTimeline = () => ({
  version: 1,
  durationSec: 10,
  bpm: 120,
  beatOffsetSec: 0,
  blackout: false,
  layers: [
    {
      id: 'layer-1',
      name: 'Base',
      enabled: true,
      blend: 'screen',
      opacity: 1,
      clips: [
        {
          id: 'clip-a',
          preset: 'wash',
          startSec: 0,
          durationSec: 4,
          targets: ['L1', 'L2', 'L3'],
          color: [1, 0, 0, 0],
          driver: 'none',
          keyframes: [{ timeSec: 0, value: 1 }, { timeSec: 4, value: 1 }]
        },
        {
          id: 'clip-b',
          preset: 'pulse',
          startSec: 6,
          durationSec: 4,
          targets: ['R1', 'R2', 'R3'],
          color: [0, 0, 1, 0],
          driver: 'none',
          keyframes: [{ timeSec: 0, value: 1 }, { timeSec: 4, value: 1 }]
        }
      ]
    }
  ]
});

test('packFrameToBuffer and unpackFrameFromBuffer preserve exact RGBW values and apply master scale', () => {
  const tl = sampleTimeline();
  const frame = renderTimelineFrame(tl, null, 1.0);
  const buf = new Uint8Array(432);
  packFrameToBuffer(frame, buf, 0);
  const unpacked = unpackFrameFromBuffer(buf, 0, 1);
  assert.deepEqual(unpacked, frame);

  const half = unpackFrameFromBuffer(buf, 0, 0.5);
  for (let p = 0; p < 12; p++) {
    assert.equal(half.bars.L1[p][0], Math.round(frame.bars.L1[p][0] * 0.5));
  }
});

test('showEngine warmLookahead pre-bakes frames and serves O(1) cache hits identical to renderTimelineFrame', () => {
  const engine = createShowEngine({ fps: 60, lookaheadSec: 3, lookbehindSec: 1 });
  const tl = sampleTimeline();
  engine.sync(tl, null);
  const baked = engine.warmLookahead(0, 200);
  assert.ok(baked > 0);

  const statsBefore = engine.stats();
  assert.equal(statsBefore.cacheHits, 0);

  const cached = engine.getCachedTimelineFrame(1.5);
  const direct = renderTimelineFrame(tl, null, 1.5);
  assert.deepEqual(cached, direct);
  assert.equal(engine.stats().cacheHits, 1);
});

test('showEngine surgical dirty-range invalidation only invalidates edited clip frames', () => {
  const engine = createShowEngine({ fps: 60, lookaheadSec: 10, lookbehindSec: 1 });
  const tl1 = sampleTimeline();
  engine.bakeAll(tl1, null);
  const fullStats = engine.stats();
  assert.equal(fullStats.validFrames, fullStats.totalFrames);
  assert.equal(fullStats.coverage, 1);

  // Edit only clip-b (which spans 6s..10s); clip-a (0s..4s) and gap (4s..6s) should remain valid!
  const tl2 = structuredClone(tl1);
  tl2.layers[0].clips[1].color = [0, 1, 0, 0];
  engine.sync(tl2, null);

  const afterEditStats = engine.stats();
  // 0s..6s (~359 frames) must still be valid in cache, while 6s..10s (~242 frames) were invalidated
  assert.ok(afterEditStats.validFrames >= 350, `Expected >= 350 valid frames preserved, got ${afterEditStats.validFrames}`);
  assert.ok(afterEditStats.validFrames < fullStats.totalFrames, 'Expected edited clip range to be invalidated');

  // Querying inside edited clip-b at t=7.0s computes and caches the updated green color
  const frameAt7 = engine.getCachedTimelineFrame(7.0);
  assert.ok(frameAt7.bars.R1[0][1] > 0, 'Expected green channel on R1 after edit');
  assert.equal(frameAt7.bars.R1[0][2], 0, 'Expected old blue channel cleared on R1 after edit');
});

test('Live Board adds onto cached timeline animation on targeted bars without overwriting it', () => {
  const engine = createShowEngine({ fps: 60 });
  const tl = sampleTimeline();
  engine.bakeAll(tl, null);

  const desk = createPerformance([
    {
      label: 'Additive L',
      mode: 'hit',
      preset: 'wash',
      targets: ['L1', 'L2', 'L3'],
      color: [0, 1, 0, 0], // pure green live pad on L1..L3 (where timeline has red)
      intensity: 1,
      driver: 'none',
      speed: 1,
      direction: 'ltr',
      timing: 'beat',
      motionMode: 'sync',
      params: { mood: 'still' }
    }
  ]);

  const baseOnly = engine.renderFrame({
    timeline: tl,
    analysis: null,
    songTimeSec: 1.0,
    clockTimeSec: 10.05,
    masterBrightness60: 60
  });

  // Trigger pad 0 at clockTime = 10.0s
  desk.press(0, { songTime: 1.0, clockTime: 10.0, playing: true, bpm: 120 });

  // Render through showEngine while pad 0 is held on L1..L3
  const liveFrame = engine.renderFrame({
    timeline: tl,
    analysis: null,
    songTimeSec: 1.0,
    clockTimeSec: 10.05,
    masterBrightness60: 60,
    performDesk: desk
  });

  // Underlying timeline has RED on L1..L3, and Live Board pad adds GREEN on L1..L3.
  // Both channels must remain active together!
  assert.equal(liveFrame.bars.L1[0][0], baseOnly.bars.L1[0][0], 'Underlying timeline red must be preserved');
  assert.ok(liveFrame.bars.L1[0][0] > 40, 'Underlying timeline red channel must remain active on L1');
  assert.ok(liveFrame.bars.L1[0][1] > 50, 'Live Board green channel must be added on L1');
});

test('e8-columns profile routes O1 to L1-L3, O3 to R1-R3, and O5 to C2-C3 (with empty C1 at tail)', () => {
  const cfg = defaultConfig('e8-columns');
  const routes = routesForNode(cfg, 'E8-1');
  assert.deepEqual(
    routes.map(r => [r.bar, r.port, r.gpio, r.offset]),
    [
      ['L1', 1, 5, 0],
      ['L2', 1, 5, 12],
      ['L3', 1, 5, 24],
      ['R1', 3, 4, 36],
      ['R2', 3, 4, 48],
      ['R3', 3, 4, 60],
      ['C2', 5, 17, 72],
      ['C3', 5, 17, 84],
      ['C1', 5, 17, 96]
    ]
  );
});

test('timeline pattern honours DAW editor parameter key aliases (division, shutter, dir, style, physics)', () => {
  const strobeSlow = pattern('strobe', 0, 0, 0, 0.1, 0.1, 0.5, { params: { division: '1/2', shutter: 'razor' } });
  const strobeFast = pattern('strobe', 0, 0, 0, 0.1, 0.1, 0.5, { params: { division: '1/16', shutter: 'wide' } });
  assert.notEqual(strobeSlow, strobeFast);

  const spiralCw = pattern('spiral', 0, 1, 0, 0.2, 0.2, 0.5, { params: { dir: 'cw' } });
  const spiralCcw = pattern('spiral', 0, 1, 0, 0.2, 0.2, 0.5, { params: { dir: 'ccw' } });
  assert.notEqual(spiralCw, spiralCcw);

  const rippleOut = pattern('ripple', 0, 0, 0, 0.2, 0.2, 0.5, { params: { dir: 'out' } });
  const rippleIn = pattern('ripple', 0, 0, 0, 0.2, 0.2, 0.5, { params: { dir: 'in' } });
  assert.notEqual(rippleOut, rippleIn);

  const rainDrops = pattern('rain', 0, 0, 0, 0.2, 0.2, 0.5, { params: { style: 'drops' } });
  const rainHeavy = pattern('rain', 0, 0, 0, 0.2, 0.2, 0.5, { params: { style: 'heavy' } });
  assert.notEqual(rainDrops, rainHeavy);

  const bounceSine = pattern('bounce', 0, 0, 0, 0.15, 0.15, 0.5, { params: { physics: 'sine' } });
  const bounceElastic = pattern('bounce', 0, 0, 0, 0.15, 0.15, 0.5, { params: { physics: 'elastic' } });
  assert.notEqual(bounceSine, bounceElastic);
});

test('chase physical 58 cm gap compensation prevents instant teleport between L1 and L2', () => {
  const makeColTimeline = gapMode => ({
    version: 1,
    durationSec: 4,
    bpm: 60, // 1.0s per beat
    beatOffsetSec: 0,
    blackout: false,
    layers: [{
      id: 'l1',
      enabled: true,
      blend: 'replace',
      opacity: 1,
      clips: [{
        id: 'c1',
        preset: 'chase',
        startSec: 0,
        durationSec: 4,
        targets: ['L1', 'L2', 'L3'],
        color: [1, 0, 0, 0],
        driver: 'none',
        speed: 1,
        params: { gap: gapMode, beam: 'razor' },
        keyframes: [{ timeSec: 0, value: 1 }, { timeSec: 4, value: 1 }]
      }]
    }]
  });

  const physicalTl = makeColTimeline('physical');
  const noGapTl = makeColTimeline('none');

  // At t = 0.27s (27% through the 1.0s beat):
  // - In physical mode (pathLen = 51.08 px): head is at ~13.8 px, right in the middle of the 58 cm gap (12..17.8) between L1 and L2!
  //   So L1 tail is draining out the bottom (pixel 11 > 0), while L2 top (pixel 0 at 17.8) is still 4.0 pixels ahead and completely dark (0)!
  // - In no-gap mode (pathLen = 36 px): head is at ~9.7 px or at t = 0.34s head is already well inside L2!
  const fPhysGap = renderTimelineFrame(physicalTl, null, 0.27);
  assert.ok(fPhysGap.bars.L1[11][0] > 30, 'L1 bottom pixel should still have trailing tail while beam crosses 58 cm gap');
  assert.equal(fPhysGap.bars.L2[0][0], 0, 'L2 top pixel must still be dark while beam is halfway across the 58 cm gap');

  // Once the beam finishes crossing the 58 cm gap (at t = 0.36s, head ~18.4 px), L2 top pixels light up smoothly!
  const fPhysArrive = renderTimelineFrame(physicalTl, null, 0.36);
  assert.ok(fPhysArrive.bars.L2[0][0] > 100, 'L2 top pixel lights up once beam finishes traversing the 58 cm physical gap');

  // Compare with gap: 'none' at t = 0.34s: L2 is already lit much earlier because it skipped the 58 cm space
  const fNoGap = renderTimelineFrame(noGapTl, null, 0.34);
  assert.ok(fNoGap.bars.L2[0][0] > 120);
});

test('live board rapid multi-triggering of chase stacks multiple runners additively without restarting earlier runners', () => {
  const perf = createPerformance();
  // Pad 1 is 'Trkač' (chase), configure it on L1-L3 with a 1-second traversal (bpm=60, speed=1)
  perf.setPad(1, {
    preset: 'chase',
    mode: 'hit',
    targets: ['L1', 'L2', 'L3'],
    color: [0, 0.85, 1, 0],
    speed: 1,
    params: { dir: 'fwd', beam: 'razor', gap: 'physical' }
  });

  // 1st press at t = 10.00s
  perf.press(1, { clockTime: 10.0, bpm: 60 });
  perf.release(1, { clockTime: 10.05 });

  // 2nd rapid press at t = 10.35s (while 1st runner is entering L2)
  perf.press(1, { clockTime: 10.35, bpm: 60 });
  perf.release(1, { clockTime: 10.40 });

  // 3rd rapid press at t = 10.70s (while 1st runner is on L3 and 2nd runner is on L2)
  perf.press(1, { clockTime: 10.70, bpm: 60 });
  perf.release(1, { clockTime: 10.75 });

  // At t = 10.75s (bpm=60 -> 1s beat):
  // - 1st runner (age 0.75s) is down on L3
  // - 2nd runner (age 0.40s) is in the middle on L2
  // - 3rd runner (age 0.05s) just launched at the top of L1
  // All three bars L1, L2, and L3 must have an active runner simultaneously!
  const darkBase = renderTimelineFrame({ version: 1, durationSec: 4, bpm: 60, beatOffsetSec: 0, blackout: true, layers: [] }, null, 0);
  const frame = perf.render(darkBase, 10.75, 60, 1, null, 0);
  assert.ok(frame, 'Performance render should return active frame');

  const maxL1 = Math.max(...frame.bars.L1.map(px => px[2]));
  const maxL2 = Math.max(...frame.bars.L2.map(px => px[2]));
  const maxL3 = Math.max(...frame.bars.L3.map(px => px[2]));

  assert.ok(maxL1 > 120, `Expected 3rd runner on L1 to be bright, got ${maxL1}`);
  assert.ok(maxL2 > 120, `Expected 2nd runner on L2 to still be bright (not reset!), got ${maxL2}`);
  assert.ok(maxL3 > 120, `Expected 1st runner on L3 to still be bright (not reset!), got ${maxL3}`);
});


