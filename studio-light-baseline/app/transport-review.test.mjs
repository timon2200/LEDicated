import test from 'node:test';
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import { createLightingServer, defaultConfig } from './server.mjs';

const ids = ['L1', 'C1', 'R1', 'L2', 'C2', 'R2', 'L3', 'C3', 'R3'];
const hosts = ['127.0.0.1', '127.0.0.2', '127.0.0.3', '127.0.0.4', '127.0.0.5'];

async function fixture(t, config) {
  const packets = [];
  const resolvedHosts = [];
  const receiver = dgram.createSocket('udp4');
  await new Promise(done => receiver.bind(0, '127.0.0.1', done));
  const udpPort = receiver.address().port;
  receiver.on('message', packet => packets.push(packet));
  const app = createLightingServer({ configPath: null, initialConfig: config, allowLoopback: true, udpPort, watchdogMs: 2000,
    resolveHost: host => { resolvedHosts.push(host); return '127.0.0.1'; } });
  await new Promise(done => app.server.listen(0, '127.0.0.1', done));
  t.after(async () => { await app.close(); receiver.close(); });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const post = async (path, data) => {
    const response = await fetch(`${base}${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data)
    });
    return { status: response.status, body: await response.json() };
  };
  const waitForCount = async count => {
    const deadline = Date.now() + 1000;
    while (packets.length < count && Date.now() < deadline) {
      await new Promise(done => setTimeout(done, 5));
    }
    assert.equal(packets.length, count);
  };
  return { app, packets, resolvedHosts, post, waitForCount };
}

test('RGBW DDP sends each bar to its assigned node, in output order, with independent W', async t => {
  const config = defaultConfig();
  config.nodes.forEach((node, i) => { node.host = hosts[i]; });
  const lengths = { L1: 3, C1: 4, R1: 5, L2: 6, C2: 7, R2: 8, L3: 9, C3: 10, R3: 12 };
  config.bars.forEach(bar => { bar.pixels = lengths[bar.id]; });
  config.bars.find(bar => bar.id === 'C1').reverse = true;
  const frame = { bars: Object.fromEntries(ids.map((id, i) => [id,
    Array.from({ length: 12 }, (_, sample) => [i + 1, sample + 1, 200, 100 + i])
  ])) };
  const { packets, resolvedHosts, post, waitForCount } = await fixture(t, config);
  assert.equal((await post('/api/arm', { armed: true })).status, 200);
  assert.equal((await post('/api/frame', frame)).status, 200);
  await waitForCount(5);
  assert.deepEqual(resolvedHosts, hosts);

  const expected = [
    ['C1', 'C2'], ['L1', 'L2'], ['R1', 'R2'], ['L3', 'C3'], ['R3']
  ];
  for (let node = 0; node < 5; node++) {
    const packet = packets[node];
    const bars = expected[node];
    assert.equal(packet[0], 0x41);
    assert.equal(packet[2], 0x1b);
    assert.equal(packet[3], 1);
    assert.equal(packet.readUInt32BE(4), 0);
    assert.equal(packet.readUInt16BE(8), bars.reduce((sum, id) => sum + lengths[id] * 4, 0));
    assert.equal(packet.length, packet.readUInt16BE(8) + 10);
    let offset = 10;
    for (const id of bars) {
      const marker = ids.indexOf(id) + 1;
      const firstSample = id === 'C1' ? 10 : 1;
      assert.deepEqual([...packet.subarray(offset, offset + 4)], [marker, firstSample, 200, 99 + marker]);
      offset += lengths[id] * 4;
    }
  }
  const reversed = packets[0];
  assert.deepEqual([...reversed.subarray(10, 26)], [2, 10, 200, 101, 2, 7, 200, 101, 2, 4, 200, 101, 2, 1, 200, 101]);
});

test('malformed RGBW frame is rejected before UDP output and does not consume the frame slot', async t => {
  const config = defaultConfig();
  config.nodes.forEach((node, i) => { node.host = hosts[i]; });
  const frame = { bars: Object.fromEntries(ids.map(id => [id, Array.from({ length: 12 }, () => [0, 0, 0, 100])])) };
  const { packets, post, waitForCount } = await fixture(t, config);
  assert.equal((await post('/api/arm', { armed: true })).status, 200);
  for (const pixel of [[1, 2, 3], [1, 2, 3, -1], [1, 2, 3, 256], [1, 2, 3, 1.5], [1, 2, 3, null]]) {
    frame.bars.R3[11] = pixel;
    assert.equal((await post('/api/frame', frame)).status, 400);
  }
  assert.equal(packets.length, 0);
  frame.bars.R3[11] = [0, 0, 0, 100];
  assert.equal((await post('/api/frame', frame)).status, 200);
  await waitForCount(5);
  assert.ok(packets.every(packet => packet.subarray(10).every((value, i) => i % 4 === 3 ? value === 100 : value === 0)));
  assert.equal((await post('/api/blackout', {})).status, 200);
  await waitForCount(10);
  assert.ok(packets.slice(5).every(packet => packet.subarray(10).every(value => value === 0)));
});

test('E8 plus C3 sends eight bars in physical port order and blackouts both destinations', async t => {
  const config = defaultConfig('e8-c3');
  config.nodes[0].host = hosts[0]; config.nodes[1].host = hosts[1];
  config.bars.find(bar => bar.id === 'L1').pixels = 3;
  config.bars.find(bar => bar.id === 'C1').pixels = 4;
  const frame = { bars: Object.fromEntries(ids.map((id, i) => [id, Array.from({ length: 12 }, () => [i + 1, 0, 0, 50 + i])])) };
  const { packets, resolvedHosts, post, waitForCount } = await fixture(t, config);
  assert.equal((await post('/api/arm', { armed: true })).status, 200);
  assert.equal((await post('/api/frame', frame)).status, 200);
  await waitForCount(2);
  assert.deepEqual(resolvedHosts, hosts.slice(0, 2));
  assert.equal(packets[0].readUInt16BE(8), (3 + 4 + 6 * 12) * 4);
  assert.equal(packets[1].readUInt16BE(8), 12 * 4);
  let offset = 10;
  for (const [index, length] of [3, 4, 12, 12, 12, 12, 12, 12].entries()) {
    assert.deepEqual([...packets[0].subarray(offset, offset + 4)], [index + 1, 0, 0, 50 + index]);
    offset += length * 4;
  }
  assert.deepEqual([...packets[1].subarray(10, 14)], [9, 0, 0, 58]);
  assert.equal((await post('/api/blackout', {})).status, 200);
  await waitForCount(4);
  assert.ok(packets.slice(2).every(packet => packet.subarray(10).every(value => value === 0)));
});
