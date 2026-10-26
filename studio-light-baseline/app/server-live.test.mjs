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
