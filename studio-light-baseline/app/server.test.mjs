import test from 'node:test';
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import http from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLightingServer, defaultConfig, validateConfig, privateIP, encodeDDP, rgbFromRgbw } from './server.mjs';

const pause = ms => new Promise(done => setTimeout(done, ms));
const makeFrames = (pixel = [20, 30, 40, 0]) => ({ bars: Object.fromEntries(defaultConfig().bars.map(bar => [bar.id, Array.from({ length: 12 }, () => [...pixel])])) });
async function fixture(t, options = {}) {
  const app = createLightingServer({ configPath: null, ...options });
  await new Promise(done => app.server.listen(0, '127.0.0.1', done));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  t.after(() => app.close());
  return { app, base, async post(path, data = {}, headers = {}) {
    const response = await fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(data) });
    return { status: response.status, data: await response.json() };
  } };
}

test('configuration rejects public IPs, duplicate bars, changed outputs and invalid lengths', () => {
  for (const bad of ['8.8.8.8', '127.0.0.1', '192.168.1.255', '192.168.1.0', '192.168.01.1', 'hostname', '10.0.0.256']) assert.equal(privateIP(bad), false, bad);
  for (const good of ['10.0.0.1', '172.16.0.1', '172.31.2.4', '192.168.1.2']) assert.equal(privateIP(good), true);
  const duplicate = defaultConfig(); duplicate.bars[1].id = 'L1';
  assert.throws(() => validateConfig(duplicate));
  const wrongNode = defaultConfig(); wrongNode.bars[0].node = 'C3-A';
  assert.throws(() => validateConfig(wrongNode));
  const huge = defaultConfig(); huge.bars[0].pixels = 73;
  assert.throws(() => validateConfig(huge));
  const repeatedHost = defaultConfig(); repeatedHost.nodes[0].host = repeatedHost.nodes[1].host = '192.168.1.5';
  assert.throws(() => validateConfig(repeatedHost));
  const legacy = defaultConfig(); delete legacy.transport;
  assert.equal(validateConfig(legacy).transport, 'rgb');
  assert.equal(defaultConfig().transport, 'rgbw');
  const invalidTransport = defaultConfig(); invalidTransport.transport = 'rgbww';
  assert.throws(() => validateConfig(invalidTransport));
});

test('DDP header, RGB warm-white approximation and hard ceiling are correct', () => {
  assert.deepEqual(rgbFromRgbw([0, 0, 0, 100]), [100, 78, 45]);
  assert.deepEqual(rgbFromRgbw([255, 255, 255, 255]), [153, 153, 153]);
  assert.throws(() => rgbFromRgbw([1, 2, NaN, 4]));
  const packet = encodeDDP([1, 2, 3], 7);
  assert.deepEqual([...packet], [0x41, 7, 0x0b, 1, 0, 0, 0, 0, 0, 3, 1, 2, 3]);
  assert.deepEqual([...encodeDDP([1, 2, 3, 77], 8, 'rgbw')], [0x41, 8, 0x1b, 1, 0, 0, 0, 0, 0, 4, 1, 2, 3, 77]);
});

test('output starts disarmed and rejects missing controllers and cross-origin requests', async t => {
  const { post, base } = await fixture(t);
  assert.equal((await post('/api/frame', makeFrames())).status, 409);
  assert.equal((await post('/api/arm', { armed: true })).status, 409);
  assert.equal((await post('/api/arm', { armed: true }, { Origin: 'https://example.com' })).status, 403);
  const hostStatus = await new Promise(done => {
    const request = http.get(`${base}/api/state`, { headers: { Host: 'attacker.example:8787' } }, response => { response.resume(); done(response.statusCode); });
    request.on('error', done);
  });
  assert.equal(hostStatus, 403);
  assert.equal((await fetch(`${base}/config.json`)).status, 404);
});

test('configuration persists and reloads without arming', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'studio-lighting-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const configPath = join(dir, 'config.json');
  const first = await fixture(t, { configPath });
  const config = defaultConfig(); config.nodes[0].host = '192.168.1.50'; config.bars[0].reverse = true;
  assert.equal((await first.post('/api/config', config)).status, 200);
  assert.deepEqual(JSON.parse(await readFile(configPath, 'utf8')), config);
  const second = await fixture(t, { configPath }); await second.app.load();
  assert.deepEqual(second.app.state().config, config);
  assert.equal(second.app.state().armed, false);
});

test('UDP integration accepts immediate first frame, maps five nodes, resamples/reverses, limits frames and blackouts', async t => {
  const receiver = dgram.createSocket('udp4');
  const packets = [];
  receiver.on('message', packet => packets.push(packet));
  await new Promise(done => receiver.bind(0, '0.0.0.0', done));
  t.after(() => receiver.close());
  const config = defaultConfig(); config.nodes.forEach((node, i) => { node.host = `127.0.0.${i + 1}`; });
  config.transport = 'rgb';
  config.bars[0].pixels = 6; config.bars[0].reverse = true;
  const { post } = await fixture(t, { initialConfig: config, allowLoopback: true, udpPort: receiver.address().port, resolveHost: () => '127.0.0.1' });
  assert.equal((await post('/api/arm', { armed: true })).status, 200);
  assert.equal((await post('/api/config', config)).status, 409);
  const frame = makeFrames([255, 255, 255, 255]);
  frame.bars.L1 = Array.from({ length: 12 }, (_, i) => [i * 10, 0, 0, 0]);
  assert.equal((await post('/api/frame', frame)).status, 200);
  assert.equal((await post('/api/frame', frame)).status, 429);
  await pause(20);
  assert.equal(packets.length, 5);
  assert.deepEqual(packets.map(p => p.readUInt16BE(8)).sort((a, b) => a - b), [36, 54, 72, 72, 72]);
  const leftPacket = packets.find(p => p.readUInt16BE(8) === 54);
  assert.deepEqual([...leftPacket.subarray(10, 28)], [100, 0, 0, 80, 0, 0, 60, 0, 0, 40, 0, 0, 20, 0, 0, 0, 0, 0]);
  for (const p of packets) assert.ok([...p.subarray(10)].every(value => value <= 153));
  for (const p of packets) assert.equal(p[2], 0x0b);
  assert.equal((await post('/api/blackout')).data.armed, false);
  await pause(20);
  assert.equal(packets.length, 10);
  for (const p of packets.slice(5)) assert.ok(p.subarray(10).every(value => value === 0));
  assert.equal((await post('/api/frame', frame)).status, 409);
});

test('watchdog sends zeros and disarms after frame stream stops', async t => {
  const receiver = dgram.createSocket('udp4');
  const packets = []; receiver.on('message', packet => packets.push(packet));
  await new Promise(done => receiver.bind(0, '0.0.0.0', done));
  t.after(() => receiver.close());
  const config = defaultConfig(); config.nodes.forEach((node, i) => { node.host = `127.0.0.${i + 1}`; });
  const { app, post, base } = await fixture(t, { initialConfig: config, allowLoopback: true, udpPort: receiver.address().port, watchdogMs: 120, resolveHost: () => '127.0.0.1' });
  await post('/api/arm', { armed: true }); await pause(40);
  await post('/api/frame', makeFrames());
  await pause(80); await fetch(`${base}/api/state`);
  await pause(100);
  assert.equal(app.state().armed, false);
  assert.equal(packets.length, 10);
  assert.ok(packets.slice(5).every(packet => packet.subarray(10).every(value => value === 0)));
});

test('RGBW UDP preserves independent white channel, correct lengths and blackout mode', async t => {
  const receiver = dgram.createSocket('udp4');
  const packets = []; receiver.on('message', packet => packets.push(packet));
  await new Promise(done => receiver.bind(0, '127.0.0.1', done));
  t.after(() => receiver.close());
  const config = defaultConfig(); config.nodes.forEach((node, i) => { node.host = `127.0.0.${i + 1}`; });
  const { post, app } = await fixture(t, { initialConfig: config, allowLoopback: true, udpPort: receiver.address().port, resolveHost: () => '127.0.0.1' });
  assert.equal(app.state().transport, 'DDP RGBW');
  await post('/api/arm', { armed: true });
  const frame = makeFrames([0, 0, 0, 120]);
  frame.bars.C1[0] = [255, 255, 255, 255];
  assert.equal((await post('/api/frame', frame)).status, 200);
  await pause(20);
  assert.equal(packets.length, 5);
  assert.deepEqual(packets.map(packet => packet.readUInt16BE(8)).sort((a, b) => a - b), [48, 96, 96, 96, 96]);
  for (const packet of packets) {
    assert.equal(packet[2], 0x1b);
    assert.equal(packet.length, packet.readUInt16BE(8) + 10);
    for (let i = 14; i < packet.length; i += 4) assert.deepEqual([...packet.subarray(i, i + 4)], [0, 0, 0, 120]);
  }
  const clamped = packets.find(packet => packet[10] === 153);
  assert.deepEqual([...clamped.subarray(10, 14)], [153, 153, 153, 153]);
  assert.equal((await post('/api/blackout')).status, 200);
  await pause(20);
  assert.equal(packets.length, 10);
  for (const packet of packets.slice(5)) {
    assert.equal(packet[2], 0x1b);
    assert.ok(packet.subarray(10).every(value => value === 0));
  }
});
