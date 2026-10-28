import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLightingServer } from './server.mjs';

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'ledicated-live-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const app = createLightingServer({ libraryRoot: dir, configPath: null });
  await new Promise(done => app.server.listen(0, '127.0.0.1', done));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  t.after(() => app.close());
  return { app, base, dir };
}

test('live endpoints: status, state reporting, frame preview, and command execution', async t => {
  const { app, base, dir } = await fixture(t);

  // 1. Initial status before any browser connects
  const res1 = await fetch(`${base}/api/live/status`);
  assert.equal(res1.status, 200);
  const status1 = await res1.json();
  assert.equal(status1.ok, true);
  assert.equal(status1.browserConnected, false);
  assert.equal(status1.clientCount, 0);

  // 2. Import a dummy track to test timeline ops and frames
  const importRes = await fetch(`${base}/api/library/import?name=test.mp3`, {
    method: 'POST',
    body: Buffer.alloc(1024, 0x11)
  });
  assert.equal(importRes.status, 200);
  const { track } = await importRes.json();
  assert.ok(track.id);

  // Save initial timeline for track
  const initialTl = {
    version: 1, durationSec: 30, bpm: 120, beatOffsetSec: 0, blackout: false, layers: []
  };
  await fetch(`${base}/api/library/timeline`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: track.id, timeline: initialTl })
  });

  // 3. Connect an SSE client to simulate browser connecting to /api/live/stream
  const sseEvents = [];
  const sseReq = http.get(`${base}/api/live/stream`);
  sseReq.on('response', sseRes => {
    assert.equal(sseRes.statusCode, 200);
    assert.equal(sseRes.headers['content-type'], 'text/event-stream');
    sseRes.on('data', chunk => {
      sseEvents.push(chunk.toString());
    });
  });
  t.after(() => sseReq.destroy());

  // Wait a moment for SSE connection to register
  await new Promise(done => setTimeout(done, 80));

  // Check status with connected client
  const res2 = await fetch(`${base}/api/live/status`);
  const status2 = await res2.json();
  assert.equal(status2.browserConnected, true);
  assert.equal(status2.clientCount, 1);

  // 4. Report live state from simulated browser
  const statePost = await fetch(`${base}/api/live/state`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      trackId: track.id,
      timeSec: 4.5,
      isPlaying: true,
      bpm: 120,
      master: 40
    })
  });
  assert.equal(statePost.status, 200);

  // Check status reflects reported live state
  const status3 = await (await fetch(`${base}/api/live/status`)).json();
  assert.equal(status3.liveState.trackId, track.id);
  assert.equal(status3.liveState.isPlaying, true);
  assert.equal(status3.liveState.timeSec, 4.5);

  // 5. Send remote command: add_layer
  const cmd1 = await fetch(`${base}/api/live/command`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'timeline_op',
      op: 'add_layer',
      args: { name: 'Remote Layer', color: '#ff0055' }
    })
  });
  assert.equal(cmd1.status, 200);
  const cmd1Data = await cmd1.json();
  assert.equal(cmd1Data.ok, true);
  assert.equal(cmd1Data.result.layer.name, 'Remote Layer');

  // Verify timeline on disk actually updated!
  const getTl = await (await fetch(`${base}/api/library/track/${track.id}`)).json();
  assert.equal(getTl.timeline.layers.length, 1);
  assert.equal(getTl.timeline.layers[0].name, 'Remote Layer');

  // 6. Send remote command: add_clip
  const cmd2 = await fetch(`${base}/api/live/command`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'timeline_op',
      op: 'add_clip',
      args: {
        layerId: getTl.timeline.layers[0].id,
        preset: 'pulse',
        startSec: 2,
        durationSec: 6,
        targets: 'all',
        color: [1, 0.5, 0, 0]
      }
    })
  });
  assert.equal(cmd2.status, 200);

  // 7. Test /api/live/frame
  const frameRes = await fetch(`${base}/api/live/frame?trackId=${track.id}&time=3`);
  assert.equal(frameRes.status, 200);
  const frameData = await frameRes.json();
  assert.equal(frameData.ok, true);
  assert.ok(frameData.frame.bars);
  assert.equal(Object.keys(frameData.frame.bars).length, 9);
  assert.ok(Number.isFinite(frameData.watts));

  // 8. Test transport command broadcast
  const cmd3 = await fetch(`${base}/api/live/command`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'transport',
      action: 'play'
    })
  });
  assert.equal(cmd3.status, 200);

  // Verify SSE stream received broadcasts
  await new Promise(done => setTimeout(done, 50));
  const fullText = sseEvents.join('');
  assert.ok(fullText.includes('timeline_op'));
  assert.ok(fullText.includes('transport'));
});

test('mobile companion pad: serves /pad assets and synchronizes 12-pad live board state', async t => {
  const { base } = await fixture(t);

  // 1. Verify /pad HTML, CSS, JS, and PWA manifest are served
  const htmlRes = await fetch(`${base}/pad`);
  assert.equal(htmlRes.status, 200);
  const htmlText = await htmlRes.text();
  assert.ok(htmlText.includes('LEDicated Pad'));
  assert.ok(htmlText.includes('closedby="any"'));

  const cssRes = await fetch(`${base}/pad.css`);
  assert.equal(cssRes.status, 200);
  const cssText = await cssRes.text();
  assert.ok(cssText.includes('100dvh'));

  const jsRes = await fetch(`${base}/pad.mjs`);
  assert.equal(jsRes.status, 200);

  const manifestRes = await fetch(`${base}/manifest.webmanifest`);
  assert.equal(manifestRes.status, 200);
  const manifestData = await manifestRes.json();
  assert.equal(manifestData.display, 'standalone');

  // 2. Fetch initial 12-pad deck from /api/live/pads
  const padsRes1 = await fetch(`${base}/api/live/pads`);
  assert.equal(padsRes1.status, 200);
  const padsData1 = await padsRes1.json();
  assert.equal(padsData1.ok, true);
  assert.equal(padsData1.pads.length, 12);
  assert.equal(padsData1.pads[0].key, 'Q');

  // 3. Press pad 0 (Q) from iPhone companion and verify activePads + frame output
  const pressRes = await fetch(`${base}/api/live/command`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientId: 'iphone-test-1',
      type: 'live_pad',
      action: 'press',
      index: 0
    })
  });
  assert.equal(pressRes.status, 200);
  const pressData = await pressRes.json();
  assert.equal(pressData.ok, true);
  assert.ok(pressData.activePads.includes(0));
  assert.ok(pressData.heldPads.includes(0));

  // Verify standalone /api/live/frame renders non-zero RGBW pixels even without a loaded song
  const frameRes = await fetch(`${base}/api/live/frame`);
  assert.equal(frameRes.status, 200);
  const frameData = await frameRes.json();
  assert.equal(frameData.ok, true);
  assert.ok(frameData.watts > 8);

  // 4. Customize pad 1 (W) color & target bars from companion
  const customPad = {
    ...padsData1.pads[1],
    name: 'iPhone Cyber Drop',
    bars: ['L1', 'C1', 'R1'],
    color: [0, 1, 0.8]
  };
  const setRes = await fetch(`${base}/api/live/command`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientId: 'iphone-test-1',
      type: 'live_pad',
      action: 'set',
      index: 1,
      pad: customPad
    })
  });
  assert.equal(setRes.status, 200);
  const setData = await setRes.json();
  assert.equal(setData.pads[1].name, 'iPhone Cyber Drop');
  assert.deepEqual(setData.pads[1].bars, ['L1', 'C1', 'R1']);

  // 5. Release pad 0 and toggle quantize
  const relRes = await fetch(`${base}/api/live/command`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientId: 'iphone-test-1',
      type: 'live_pad',
      action: 'release',
      index: 0,
      cancel: true
    })
  });
  assert.equal(relRes.status, 200);
  const relData = await relRes.json();
  assert.ok(!relData.heldPads.includes(0));
  assert.ok(!relData.activePads.includes(0));

  const quantRes = await fetch(`${base}/api/live/command`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientId: 'iphone-test-1',
      type: 'live_pad',
      action: 'quantize',
      value: true
    })
  });
  const quantData = await quantRes.json();
  assert.equal(quantData.quantize, true);
});

