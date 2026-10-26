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
  const paired = defaultConfig('e8-c3'); paired.nodes[0].host = '192.168.1.50'; paired.nodes[0].mac = 'AA:BB:CC:11:22:33';
  assert.equal(validateConfig(paired).nodes[0].mac, 'aabbcc112233');
  paired.nodes[1].mac = 'aabbcc112233';
  assert.throws(() => validateConfig(paired), /dvije uloge/);
});

test('DDP header, RGB warm-white approximation and hard ceiling are correct', () => {
  assert.deepEqual(rgbFromRgbw([0, 0, 0, 100]), [100, 78, 45]);
  assert.deepEqual(rgbFromRgbw([255, 255, 255, 255]), [255, 255, 255]);
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

test('serves required frontend static files and blocks unlisted files', async t => {
  const { base } = await fixture(t);
  const required = [
    '/', '/index.html', '/classic.html', '/daw.css', '/hardware-settings.css',
    '/hardware-topology.mjs', '/daw.mjs', '/daw-state.mjs', '/daw-ui.mjs',
    '/daw-playlist.mjs', '/daw-editor.mjs', '/daw-mixer.mjs', '/daw-stems.mjs',
    '/daw-live.mjs', '/daw-performance.mjs', '/live-performance-state.mjs',
    '/live-session-recorder.mjs', '/daw-output.mjs', '/daw-browser.mjs',
    '/daw-driver.mjs', '/audio-spectrum.mjs', '/audio-sections.mjs',
    '/ui.mjs', '/engine.mjs', '/timeline.mjs', '/show-engine.mjs', '/timeline-viewport.mjs',
    '/mapping.mjs', '/led-preview.mjs', '/tooltips.mjs', '/project-ui.mjs',
    '/style.css', '/studio.css', '/assets/stage-background.png'
  ];
  for (const path of required) {
    const res = await fetch(`${base}${path}`);
    assert.equal(res.status, 200, `Expected 200 for ${path}`);
  }
  const blocked = await fetch(`${base}/config.json`);
  assert.equal(blocked.status, 404);
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

test('E8 diagnostics query only saved controller IPs and compare WLED group count', async t => {
  const config = defaultConfig('e8-c3'); config.nodes[0].host = '127.0.0.2';
  const contacted = [];
  const { post, base } = await fixture(t, { initialConfig: config, allowLoopback: true, probe: async host => {
    contacted.push(host);
    return { reachable: true, name: 'Studio E8', version: '0.15.1', ledCount: 96, rgbw: true, signal: 78, live: false,
      buses: [5, 12, 4, 27, 17, 26, 33, 25].map((pin, index) => ({ pin, start: index * 12, length: 12 })) };
  } });
  const profiles = await (await fetch(`${base}/api/profiles`)).json();
  assert.deepEqual(profiles.profiles.map(profile => profile.id), ['c3-five', 'e8-c3', 'e8-columns']);
  assert.equal((await post('/api/probe', { nodeId: 'unknown', host: '8.8.8.8' })).status, 404);
  assert.equal((await post('/api/probe', { nodeId: 'C3-R3' })).status, 409);
  const result = await post('/api/probe', { nodeId: 'E8-1', host: '8.8.8.8' });
  assert.equal(result.status, 200);
  assert.deepEqual(contacted, ['127.0.0.2']);
  assert.equal(result.data.expectedPixels, 96);
  assert.equal(result.data.countMatches, true);
  assert.equal(result.data.busesMatch, true);
  assert.equal(result.data.reachable, true);
});

test('WLED bus mismatch is reported independently of total group count', async t => {
  const config = defaultConfig('e8-c3'); config.nodes[0].host = '127.0.0.2';
  const { post } = await fixture(t, { initialConfig: config, allowLoopback: true, probe: async () => ({
    reachable: true, ledCount: 96, rgbw: true,
    buses: [5, 12, 4, 27, 17, 26, 33, 25].map((pin, index) => ({ pin: index === 0 ? 19 : pin, start: index * 12, length: 12 }))
  }) });
  const result = await post('/api/probe', { nodeId: 'E8-1' });
  assert.equal(result.data.countMatches, true);
  assert.equal(result.data.busesMatch, false);
});

test('Bonjour discovery rebinds a paired device after DHCP changes its IP, without arming output', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'studio-discovery-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const config = defaultConfig('e8-c3');
  config.nodes[0].host = '192.168.1.50'; config.nodes[0].mac = 'aabbcc112233';
  const { post, app } = await fixture(t, { initialConfig: config, configPath: join(dir, 'config.json'), discovery: async () => ({
    devices: [{ host: '192.168.1.77', mac: 'aabbcc112233', name: 'Studio E8', version: '0.15.1' }], error: null
  }) });
  const result = await post('/api/discover');
  assert.equal(result.status, 200);
  assert.equal(result.data.rebound, true);
  assert.equal(result.data.config.nodes[0].host, '192.168.1.77');
  assert.equal(app.state().armed, false);
  assert.equal(JSON.parse(await readFile(join(dir, 'config.json'), 'utf8')).nodes[0].host, '192.168.1.77');
});

test('ambiguous DHCP rebind keeps saved routing and still reports discovered devices', async t => {
  const config = defaultConfig('e8-c3');
  config.nodes[0].host = '192.168.1.50'; config.nodes[0].mac = 'aabbcc112233';
  config.nodes[1].host = '192.168.1.77';
  const { post, app } = await fixture(t, { initialConfig: config, discovery: async () => ({
    devices: [{ host: '192.168.1.77', mac: 'aabbcc112233', name: 'Studio E8', version: '0.15.1' }], error: null
  }) });
  const result = await post('/api/discover');
  assert.equal(result.status, 200);
  assert.equal(result.data.rebound, false);
  assert.equal(result.data.devices.length, 1);
  assert.match(result.data.rebindError, /drugu IP/);
  assert.equal(app.state().config.nodes[0].host, '192.168.1.50');
});

test('partial E8 setup can test one bar with a short dim pulse and return to black', async t => {
  const receiver = dgram.createSocket('udp4');
  const packets = []; receiver.on('message', packet => packets.push(packet));
  await new Promise(done => receiver.bind(0, '127.0.0.1', done));
  t.after(() => receiver.close());
  const config = defaultConfig('e8-c3'); config.nodes[0].host = '127.0.0.2';
  const { post, app } = await fixture(t, { initialConfig: config, allowLoopback: true, udpPort: receiver.address().port, resolveHost: () => '127.0.0.1' });
  assert.equal((await post('/api/test-bar', { barId: 'R3', confirm: true })).status, 409);
  assert.equal((await post('/api/test-bar', { barId: 'C1' })).status, 400);
  assert.equal((await post('/api/test-bar', { barId: 'C1', confirm: true })).status, 200);
  await pause(20);
  assert.equal(packets.length, 3);
  assert.ok(packets[0].subarray(10).every(value => value === 0));
  assert.ok(packets[2].subarray(10).every(value => value === 0));
  const lit = [...packets[1].subarray(10)].map((value, index) => value ? [index, value] : null).filter(Boolean);
  assert.deepEqual(lit, Array.from({ length: 12 }, (_, index) => [(12 + index) * 4, 20]));
  assert.equal(app.state().armed, false);
});

test('paired identity blocks output when an IP now belongs to a different WLED', async t => {
  const config = defaultConfig('e8-c3');
  config.nodes[0].host = '127.0.0.2'; config.nodes[0].mac = 'aabbcc112233';
  config.nodes[1].host = '127.0.0.3';
  const { post } = await fixture(t, { initialConfig: config, allowLoopback: true, probe: async () => ({
    reachable: true, mac: 'aabbcc445566', ledCount: 96, rgbw: true, buses: null
  }) });
  assert.equal((await post('/api/probe', { nodeId: 'E8-1' })).data.identityMatches, false);
  assert.equal((await post('/api/arm', { armed: true })).status, 409);
  assert.equal((await post('/api/test-bar', { barId: 'L1', confirm: true })).status, 409);
});

test('BLACKOUT interrupts a running single-bar test and sends darkness', async t => {
  const receiver = dgram.createSocket('udp4');
  const packets = []; receiver.on('message', packet => packets.push(packet));
  await new Promise(done => receiver.bind(0, '127.0.0.1', done));
  t.after(() => receiver.close());
  const config = defaultConfig('e8-c3'); config.nodes[0].host = '127.0.0.2';
  const { post } = await fixture(t, { initialConfig: config, allowLoopback: true, udpPort: receiver.address().port, resolveHost: () => '127.0.0.1' });
  const pulse = post('/api/test-bar', { barId: 'L1', confirm: true });
  for (let tries = 0; packets.length < 2 && tries < 20; tries++) await pause(10);
  assert.equal(packets.length, 2);
  assert.equal((await post('/api/blackout')).status, 200);
  assert.equal((await pulse).data.interrupted, true);
  await pause(10);
  assert.ok(packets.at(-1).subarray(10).every(value => value === 0));
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
  for (const p of packets) assert.ok([...p.subarray(10)].every(value => value <= 255));
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
  const clamped = packets.find(packet => packet[10] === 255);
  assert.deepEqual([...clamped.subarray(10, 14)], [255, 255, 255, 255]);
  assert.equal((await post('/api/blackout')).status, 200);
  await pause(20);
  assert.equal(packets.length, 10);
  for (const packet of packets.slice(5)) {
    assert.equal(packet[2], 0x1b);
    assert.ok(packet.subarray(10).every(value => value === 0));
  }
});

test('partial E8 setup can arm live output and stream DDP frames to E8-1 before C3-R3 is connected', async t => {
  const receiver = dgram.createSocket('udp4');
  const packets = []; receiver.on('message', packet => packets.push(packet));
  await new Promise(done => receiver.bind(0, '127.0.0.1', done));
  t.after(() => receiver.close());
  const config = defaultConfig('e8-c3');
  config.nodes[0].host = '127.0.0.2'; // E8-1 configured, C3-R3 empty
  const { post, app } = await fixture(t, { initialConfig: config, allowLoopback: true, udpPort: receiver.address().port, resolveHost: () => '127.0.0.1' });
  const armedRes = await post('/api/arm', { armed: true });
  assert.equal(armedRes.status, 200);
  assert.equal(app.state().armed, true);
  assert.match(app.state().reason, /1\/2 kontrolera/);
  const frame = makeFrames([10, 20, 30, 40]);
  assert.equal((await post('/api/frame', frame)).status, 200);
  await pause(20);
  assert.equal(packets.length, 1);
  assert.equal(packets[0].readUInt16BE(8), 8 * 12 * 4);
  assert.deepEqual([...packets[0].subarray(10, 14)], [10, 20, 30, 40]);
  assert.equal((await post('/api/blackout')).status, 200);
  await pause(20);
  assert.equal(packets.length, 2);
  assert.ok(packets[1].subarray(10).every(value => value === 0));
});

test('auto-connect immediately arms E8-1 on saved IP and falls back to Bonjour discovery when IP changes', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'studio-autoconnect-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const configPath = join(dir, 'config.json');

  // 1. Fast path: saved E8-1 IP responds immediately
  const config = defaultConfig('e8-columns');
  config.nodes[0].host = '192.168.0.117';
  config.nodes[0].mac = 'd0ef767a14f8';
  let reachableHost = '192.168.0.117';
  const { post, app } = await fixture(t, {
    initialConfig: config,
    configPath,
    probe: async host => {
      if (host === reachableHost) return { reachable: true, mac: 'd0ef767a14f8', name: 'EO8+', version: '0.15.1', arch: 'esp32', rgbw: true };
      throw new Error('offline');
    },
    discovery: async () => ({
      devices: reachableHost ? [{ host: reachableHost, mac: 'd0ef767a14f8', name: 'EO8+', version: '0.15.1', arch: 'esp32' }] : [],
      error: null
    })
  });

  const fastRes = await post('/api/auto-connect', { allowDiscovery: false });
  assert.equal(fastRes.status, 200);
  assert.equal(fastRes.data.ok, true);
  assert.equal(fastRes.data.connected, true);
  assert.equal(fastRes.data.rebound, false);
  assert.equal(fastRes.data.armed, true);
  assert.equal(app.state().armed, true);

  // 2. Disarm, change EO8+ IP via DHCP, and verify auto-connect discovers and arms new IP
  await post('/api/blackout', {});
  assert.equal(app.state().armed, false);
  reachableHost = '192.168.0.145';

  const discRes = await post('/api/auto-connect', { allowDiscovery: true });
  assert.equal(discRes.status, 200);
  assert.equal(discRes.data.ok, true);
  assert.equal(discRes.data.connected, true);
  assert.equal(discRes.data.rebound, true);
  assert.equal(discRes.data.host, '192.168.0.145');
  assert.equal(app.state().armed, true);
  assert.equal(app.state().config.nodes[0].host, '192.168.0.145');

  // 3. When EO8+ is offline, returns HTTP 200 with connected: false
  await post('/api/blackout', {});
  reachableHost = null;
  const offlineRes = await post('/api/auto-connect', { allowDiscovery: true });
  assert.equal(offlineRes.status, 200);
  assert.equal(offlineRes.data.ok, false);
  assert.equal(offlineRes.data.connected, false);
  assert.equal(offlineRes.data.armed, false);
});
