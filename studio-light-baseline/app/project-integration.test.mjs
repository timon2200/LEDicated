import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLightingServer } from './server.mjs';
import { createAutoShow, renderTimelineFrame } from './timeline.mjs';

function wav() {
  const frames = 16000, buffer = Buffer.alloc(44 + frames * 2);
  buffer.write('RIFF', 0); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(16000, 24); buffer.writeUInt32LE(32000, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36); buffer.writeUInt32LE(frames * 2, 40);
  for (let i = 0; i < frames; i++) buffer.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 80 * i / 16000) * 6000), 44 + i * 2);
  return buffer;
}

test('local HTTP import, analysis, timeline save, scrub frame and audio reload', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ledicated-http-'));
  const app = createLightingServer({ configPath: null, libraryRoot: root, maxAudioBytes: 10 * 1024 * 1024 });
  t.after(async () => { await app.close(); await rm(root, { recursive: true, force: true }); });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const post = async (path, data) => {
    const response = await fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    return { status: response.status, body: await response.json() };
  };
  const audio = wav();
  const importedResponse = await fetch(`${base}/api/library/import?name=sample.wav`, { method: 'POST', body: audio });
  assert.equal(importedResponse.status, 200);
  const { track } = await importedResponse.json();
  assert.match(track.id, /^[0-9a-f-]{36}$/);
  const list = await (await fetch(`${base}/api/library/tracks`)).json();
  assert.equal(list.tracks.length, 1);
  const analyzed = await post('/api/library/analyze', { id: track.id });
  assert.equal(analyzed.status, 200);
  assert.ok(analyzed.body.analysis.durationSec > .9);
  const timeline = createAutoShow(analyzed.body.analysis);
  assert.equal((await post('/api/library/timeline', { id: track.id, timeline })).status, 200);
  assert.equal((await post('/api/library/timeline', { id: track.id, timeline: {} })).status, 400);
  const reloaded = await (await fetch(`${base}/api/library/track/${track.id}`)).json();
  assert.deepEqual(reloaded.timeline, timeline);
  assert.deepEqual(reloaded.analysis, analyzed.body.analysis);
  assert.deepEqual(renderTimelineFrame(reloaded.timeline, reloaded.analysis, .5), renderTimelineFrame(timeline, analyzed.body.analysis, .5));
  const audioUrl = `${base}/api/library/audio/${track.id}`;
  const fullAudio = await fetch(audioUrl);
  assert.equal(fullAudio.status, 200);
  assert.equal(fullAudio.headers.get('accept-ranges'), 'bytes');
  assert.deepEqual(Buffer.from(await fullAudio.arrayBuffer()), audio);
  const middle = await fetch(audioUrl, { headers: { Range: 'bytes=100-199' } });
  assert.equal(middle.status, 206);
  assert.equal(middle.headers.get('content-range'), `bytes 100-199/${audio.length}`);
  assert.deepEqual(Buffer.from(await middle.arrayBuffer()), audio.subarray(100, 200));
  const suffix = await fetch(audioUrl, { headers: { Range: 'bytes=-64' } });
  assert.equal(suffix.status, 206);
  assert.deepEqual(Buffer.from(await suffix.arrayBuffer()), audio.subarray(-64));
  const invalid = await fetch(audioUrl, { headers: { Range: `bytes=${audio.length}-` } });
  assert.equal(invalid.status, 416);
  assert.equal(invalid.headers.get('content-range'), `bytes */${audio.length}`);
  const head = await fetch(audioUrl, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(Number(head.headers.get('content-length')), audio.length);
  assert.equal(app.state().armed, false);
});
