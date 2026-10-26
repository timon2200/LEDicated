import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLightingServer } from './server.mjs';
import { TOOLS_MANIFEST, createMcpClient, handleToolCall } from './mcp-tools.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));

test('TOOLS_MANIFEST contains all required LEDicated tools with valid schemas', () => {
  assert.ok(TOOLS_MANIFEST.length >= 25);
  for (const tool of TOOLS_MANIFEST) {
    assert.ok(tool.name.startsWith('ledicated_'));
    assert.ok(tool.description.length > 10);
    assert.equal(tool.inputSchema.type, 'object');
    assert.ok(tool.inputSchema.properties);
  }
  const toolNames = new Set(TOOLS_MANIFEST.map(t => t.name));
  assert.ok(toolNames.has('ledicated_get_status'));
  assert.ok(toolNames.has('ledicated_list_tracks'));
  assert.ok(toolNames.has('ledicated_add_layer'));
  assert.ok(toolNames.has('ledicated_add_clip'));
  assert.ok(toolNames.has('ledicated_patch_clips'));
  assert.ok(toolNames.has('ledicated_transport_control'));
  assert.ok(toolNames.has('ledicated_live_pad_trigger'));
  assert.ok(toolNames.has('ledicated_set_master'));
  assert.ok(toolNames.has('ledicated_blackout'));
  assert.ok(toolNames.has('ledicated_get_preview_frame'));
  assert.ok(toolNames.has('ledicated_get_hardware_config'));
});

test('MCP client and handleToolCall interact with live server correctly', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'ledicated-mcp-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const app = createLightingServer({ libraryRoot: dir, configPath: null });
  await new Promise(done => app.server.listen(0, '127.0.0.1', done));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  t.after(() => app.close());

  const client = createMcpClient({ baseUrl: base });

  // 1. get_status
  const statusRes = await handleToolCall('ledicated_get_status', {}, client);
  assert.equal(statusRes.isError, false);
  const statusData = JSON.parse(statusRes.content[0].text);
  assert.equal(statusData.online, true);
  assert.equal(statusData.controls.master, 35);

  // 2. Import dummy track
  const importRes = await fetch(`${base}/api/library/import?name=song.mp3`, {
    method: 'POST',
    body: Buffer.alloc(512, 0x22)
  });
  const { track } = await importRes.json();
  await fetch(`${base}/api/library/timeline`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: track.id,
      timeline: { version: 1, durationSec: 40, bpm: 128, beatOffsetSec: 0, blackout: false, layers: [] }
    })
  });

  // 3. list_tracks
  const listRes = await handleToolCall('ledicated_list_tracks', {}, client);
  assert.equal(listRes.isError, false);
  const listData = JSON.parse(listRes.content[0].text);
  assert.equal(listData.tracks.length, 1);
  assert.equal(listData.tracks[0].id, track.id);

  // 4. add_layer
  const addLayerRes = await handleToolCall('ledicated_add_layer', {
    name: 'Drop Strobe',
    color: '#3aa0ff',
    trackId: track.id
  }, client);
  assert.equal(addLayerRes.isError, false);
  const layerData = JSON.parse(addLayerRes.content[0].text);
  assert.equal(layerData.result.layer.name, 'Drop Strobe');

  // 5. add_clip
  const addClipRes = await handleToolCall('ledicated_add_clip', {
    layerId: layerData.result.layer.id,
    preset: 'strobe',
    startSec: 4,
    durationSec: 8,
    targets: 'all',
    color: '#ffffff',
    speed: 4,
    trackId: track.id
  }, client);
  assert.equal(addClipRes.isError, false);
  const clipData = JSON.parse(addClipRes.content[0].text);
  assert.equal(clipData.result.clip.preset, 'strobe');

  // 6. patch_clips
  const patchRes = await handleToolCall('ledicated_patch_clips', {
    clipId: clipData.result.clip.id,
    patch: { speed: 8, color: '#ffff00' },
    trackId: track.id
  }, client);
  assert.equal(patchRes.isError, false);

  // 7. transport_control
  const transRes = await handleToolCall('ledicated_transport_control', {
    action: 'seek',
    timeSec: 6.5
  }, client);
  assert.equal(transRes.isError, false);

  // 8. live_pad_trigger
  const padRes = await handleToolCall('ledicated_live_pad_trigger', {
    pad: 'Q',
    action: 'hit'
  }, client);
  assert.equal(padRes.isError, false);

  // 9. set_master
  const masterRes = await handleToolCall('ledicated_set_master', { value: 50 }, client);
  assert.equal(masterRes.isError, false);

  // 10. blackout
  const blackoutRes = await handleToolCall('ledicated_blackout', { active: true }, client);
  assert.equal(blackoutRes.isError, false);

  // 11. get_preview_frame
  const frameRes = await handleToolCall('ledicated_get_preview_frame', { timeSec: 5, trackId: track.id }, client);
  assert.equal(frameRes.isError, false);
  const frameData = JSON.parse(frameRes.content[0].text);
  assert.ok(frameData.frame?.bars);
});

test('MCP stdio protocol: handles initialize, tools/list, and tools/call over stdin/stdout', async t => {
  const serverPath = resolve(ROOT, 'mcp-server.mjs');
  const child = spawn(process.execPath, [serverPath], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, LEDICATED_URL: 'http://127.0.0.1:8787' }
  });
  t.after(() => child.kill());

  let responseBuffer = '';
  const responses = [];

  child.stdout.on('data', chunk => {
    responseBuffer += chunk.toString();
    const lines = responseBuffer.split('\n');
    responseBuffer = lines.pop(); // keep last incomplete line
    for (const line of lines) {
      if (line.trim()) {
        try { responses.push(JSON.parse(line)); } catch {}
      }
    }
  });

  const sendJson = obj => {
    child.stdin.write(JSON.stringify(obj) + '\n');
  };

  const waitResponse = async (id, timeoutMs = 2000) => {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const hit = responses.find(r => r.id === id);
      if (hit) return hit;
      await new Promise(done => setTimeout(done, 20));
    }
    throw new Error(`Timeout waiting for response to request id ${id}`);
  };

  // 1. Send initialize
  sendJson({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
  const initRes = await waitResponse(1);
  assert.equal(initRes.result.serverInfo.name, 'ledicated');
  assert.ok(initRes.result.capabilities.tools);

  // 2. Send tools/list
  sendJson({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
  const listRes = await waitResponse(2);
  assert.ok(Array.isArray(listRes.result.tools));
  assert.ok(listRes.result.tools.some(t => t.name === 'ledicated_get_status'));

  // 3. Send tools/call for ledicated_get_status
  sendJson({
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: { name: 'ledicated_get_status', arguments: {} }
  });
  const callRes = await waitResponse(3);
  assert.equal(callRes.result.isError, false);
  assert.ok(callRes.result.content[0].text);
});
