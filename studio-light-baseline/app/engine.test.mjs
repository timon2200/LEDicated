import test from 'node:test';
import assert from 'node:assert/strict';
import { BAR_IDS, PIXELS_PER_BAR, SCENES, PALETTES, LightingEngine, BeatClock, OnsetTempoEstimator, rgbwToRgb } from './engine.mjs';

const pixels = frame => Object.values(frame.bars).flat();
const lit = frame => pixels(frame).some(pixel => pixel.some(c => c > 0));

test('all scenes and palettes produce finite capped RGBW bytes with consistent topology', () => {
  for (const scene of Object.keys(SCENES)) for (const palette of Object.keys(PALETTES)) {
    const engine = new LightingEngine({ state: { scene, palette, brightness: 99, energy: 1 } });
    for (const time of [0, .25, .99, 3, 8.1, 25]) {
      const frame = engine.frame(time);
      assert.deepEqual(Object.keys(frame.bars), BAR_IDS);
      for (const bar of Object.values(frame.bars)) {
        assert.equal(bar.length, PIXELS_PER_BAR);
        for (const pixel of bar) { assert.equal(pixel.length, 4); assert.ok(pixel.every(v => Number.isInteger(v) && v >= 0 && v <= 255)); }
      }
      assert.ok(frame.beatPhase >= 0 && frame.beatPhase < 1);
    }
  }
});

test('deterministic renderer produces identical frames in independent instances', () => {
  const a = new LightingEngine({ state: { scene: 'runner', palette: 'ember' } });
  const b = new LightingEngine({ state: { scene: 'runner', palette: 'ember' } });
  assert.deepEqual(a.frame(14.72), b.frame(14.72));
  assert.notDeepEqual(a.frame(14.72), a.frame(15.25));
});

test('column and row scenes select spatial groups on consecutive beats', () => {
  const engine = new LightingEngine({ state: { scene: 'columns', brightness: .6, palette: 'ember' } });
  const max = (frame, id) => Math.max(...frame.bars[id].flat());
  assert.ok(max(engine.frame(0), 'L1') > max(engine.frame(0), 'C1') * 5);
  assert.ok(max(engine.frame(.5), 'C2') > max(engine.frame(.5), 'L2') * 5);
  engine.setState({ scene: 'rows' }, 1);
  assert.ok(max(engine.frame(3.1), 'L1') > max(engine.frame(3.1), 'L2') * 5);
});

test('runner travels every pixel top to bottom through L1 L2 L3 then centre and right', () => {
  const path = ['L1', 'L2', 'L3', 'C1', 'C2', 'C3', 'R1', 'R2', 'R3'];
  const engine = new LightingEngine({state:{scene:'runner',palette:'warm',brightness:.6,energy:0,bpm:120}});
  const length = path.length * PIXELS_PER_BAR;
  for(let position=0;position<length;position++){
    // One loop is four beats = two seconds at 120 BPM. Slightly past the
    // boundary avoids floating-point rounding putting the head one pixel behind.
    const frame=engine.frame((position+.01)/length*2);
    const ranked=BAR_IDS.flatMap(id=>frame.bars[id].map((pixel,p)=>({id,p,level:Math.max(...pixel)}))).sort((a,b)=>b.level-a.level);
    assert.equal(ranked[0].id,path[Math.floor(position/PIXELS_PER_BAR)],`bar at path position ${position}`);
    assert.equal(ranked[0].p,position%PIXELS_PER_BAR,`pixel at path position ${position}`);
  }
  assert.deepEqual(engine.frame(0).bars,engine.frame(8).bars,'complete loops return to the start');
});

test('master zero and blackout stop every channel including white immediately during fade', () => {
  const engine = new LightingEngine({ state: { palette: 'warm', scene: 'ambient' } });
  assert.ok(lit(engine.frame(0)));
  engine.setState({ scene: 'pulse' }, 1);
  engine.setState({ blackout: true }, 1.1);
  assert.equal(lit(engine.frame(1.1)), false);
  assert.equal(lit(engine.frame(500)), false);
  assert.equal(engine.transition, null);
  engine.setState({ blackout: false, brightness: 0 }, 501);
  assert.equal(lit(engine.frame(501)), false);
  engine.setState({ brightness: .3 }, 502);
  assert.ok(lit(engine.frame(502)));
});

test('blackout toggle turns output completely off and lights it up again', () => {
  const engine = new LightingEngine({ state: { palette: 'warm', scene: 'ambient', brightness: .4 } });
  assert.ok(lit(engine.frame(0)), 'initial frame must be lit');
  // First toggle: blackout active
  engine.setState({ blackout: true }, 1);
  assert.equal(lit(engine.frame(1)), false, 'blackout frame must be completely dark');
  // Second toggle: blackout released
  engine.setState({ blackout: false }, 2);
  assert.ok(lit(engine.frame(2)), 'lights must light up again after blackout release');
});

test('palette change starts exactly at outgoing frame and crossfades RGBW to target', () => {
  const engine = new LightingEngine({ state: { scene: 'ambient', palette: 'warm' } });
  const before = engine.frame(1).bars;
  engine.setState({ palette: 'midnight' }, 1);
  assert.deepEqual(engine.frame(1).bars, before);
  const mid = engine.frame(1.3).bars.L1[0];
  assert.ok(mid[3] > 0 && mid[2] > 0);
  const reference = new LightingEngine({ state: { scene: 'ambient', palette: 'midnight' } });
  assert.deepEqual(engine.frame(1.7).bars, reference.frame(1.7).bars);
});

test('lowering master during a fade immediately scales outgoing and incoming frames', () => {
  const engine = new LightingEngine({ state: { scene: 'columns', palette: 'ember', brightness: .6 } });
  assert.ok(Math.max(...pixels(engine.frame(0)).flat()) > 100);
  engine.setState({ palette: 'ice' }, 0);
  engine.setState({ brightness: .1 }, .05);
  for (const now of [.05, .1, .3, .59, .61]) assert.ok(Math.max(...pixels(engine.frame(now)).flat()) <= 26);
  // Repeated scene changes during the first fade capture the already scaled result.
  engine.setState({ palette: 'warm' }, .62);
  engine.setState({ scene: 'pulse', brightness: .05 }, .7);
  for (const now of [.7, .8, 1.2]) assert.ok(Math.max(...pixels(engine.frame(now)).flat()) <= 13);
});

test('reactivity changes intensity without topology changes or runaway values', () => {
  const engine = new LightingEngine({ state: { scene: 'ambient', reactive: true, audioLevel: 0 } });
  const quiet = pixels(engine.frame(1)).flat().reduce((a, b) => a + b, 0);
  engine.setState({ audioLevel: 1 }, 1);
  const loud = pixels(engine.frame(1)).flat().reduce((a, b) => a + b, 0);
  assert.ok(loud > quiet * 4);
  engine.setState({ audioLevel: Infinity, scene: 'unrecognized', brightness: NaN }, 1);
  assert.equal(engine.state.scene, 'ambient');
  assert.equal(engine.state.audioLevel, 1);
});

test('RGB approximation consistently maps warm white and clamps combined channels', () => {
  assert.deepEqual(rgbwToRgb([0, 0, 0, 100]), [100, 78, 45]);
  assert.deepEqual(rgbwToRgb([255, 255, 255, 255]), [255, 255, 255]);
  assert.deepEqual(rgbwToRgb([NaN, -4, Infinity, 0]), [0, 0, 0]);
});

test('manual tempo clock maintains phase through bpm changes and supports phase nudge', () => {
  const clock = new BeatClock(120);
  assert.equal(clock.beats(.75), 1.5);
  clock.setBpm(90, .75);
  assert.equal(clock.beats(.75), 1.5);
  assert.equal(clock.beats(1.75), 3);
  clock.nudge(.25);
  assert.equal(clock.beats(1.75), 3.25);
});

for (const bpm of [90, 120, 140]) {
  test(`manual tap converges to ${bpm} BPM and resets beat phase`, () => {
    const clock = new BeatClock();
    for (let i = 0; i < 8; i++) clock.tap(10 + i * 60 / bpm);
    assert.ok(Math.abs(clock.bpm - bpm) < .001);
    assert.ok(Math.abs(clock.beats(10 + 7 * 60 / bpm) - Math.round(clock.beats(10 + 7 * 60 / bpm))) < .001);
  });
  test(`periodic synthetic onsets track ${bpm} BPM with confidence`, () => {
    const estimator = new OnsetTempoEstimator();
    for (let i = 0; i < 14; i++) estimator.addOnset(i * 60 / bpm);
    const result = estimator.get(13 * 60 / bpm);
    assert.ok(Math.abs(result.bpm - bpm) < .001);
    assert.ok(result.confidence > .9);
    assert.equal(result.status, 'tracking');
  });
}

test('silence never creates tempo; a previous estimate holds then expires', () => {
  const estimator = new OnsetTempoEstimator();
  assert.deepEqual(estimator.get(10), { bpm: null, confidence: 0, status: 'waiting' });
  estimator.addOnset(0, .01);
  assert.equal(estimator.get(1).bpm, null);
  for (let i = 0; i < 12; i++) estimator.addOnset(i * .5);
  assert.equal(estimator.get(9).status, 'hold');
  assert.equal(estimator.get(25).bpm, null);
  assert.equal(estimator.addOnset(26).bpm, null);
  assert.equal(estimator.get(26).status, 'listening');
});

test('audio updates preserve tapped tempo, and master zero cancels a live transition', () => {
  const engine = new LightingEngine();
  engine.clock.tap(0); engine.clock.tap(60 / 90);
  engine.setState({ audioLevel: .5 }, 1);
  assert.ok(Math.abs(engine.clock.bpm - 90) < .001);
  engine.setState({ palette: 'warm' }, 2);
  engine.setState({ brightness: 0 }, 2.1);
  assert.equal(lit(engine.frame(2.1)), false);
});

test('onset jitter tolerates normal timing noise while irregular onsets report uncertainty', () => {
  const estimator = new OnsetTempoEstimator();
  for (let i = 0; i < 14; i++) estimator.addOnset(i * .5 + (i % 2 ? .006 : 0));
  assert.ok(Math.abs(estimator.get(6.6).bpm - 120) < 2);
  assert.ok(estimator.get(6.6).confidence > .8);
  const irregular = new OnsetTempoEstimator();
  let now = 0;
  for (const gap of [.26, 1.3, .41, .91, .28, 1.22, .57, .31, 1.4, .85]) { now += gap; irregular.addOnset(now); }
  assert.notEqual(irregular.get(now).status, 'tracking');
});
