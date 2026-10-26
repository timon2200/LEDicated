import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultConfig, probeWled, validateConfig } from './server.mjs';
import { routesForNode, routesWithOffsets } from './hardware-topology.mjs';

test('E8 plus C3 profile maps eight E8 ports and a separate ninth bar', () => {
  const config = defaultConfig('e8-c3');
  assert.deepEqual(config.nodes.map(node => node.id), ['E8-1', 'C3-R3']);
  const routes = routesWithOffsets(config);
  assert.deepEqual(routes.slice(0, 8).map(route => [route.bar, route.port, route.gpio, route.offset]), [
    ['L1', 1, 5, 0], ['C1', 2, 12, 12], ['R1', 3, 4, 24], ['L2', 4, 27, 36],
    ['C2', 5, 17, 48], ['R2', 6, 26, 60], ['L3', 7, 33, 72], ['C3', 8, 25, 84]
  ]);
  assert.deepEqual(routes[8], { bar: 'R3', node: 'C3-R3', port: 1, gpio: null, pixels: 12, physicalLeds: 72, reverse: false, offset: 0 });
  config.bars[0].pixels = 7;
  assert.equal(routesWithOffsets(config)[1].offset, 7);
  assert.equal(routesForNode(config, 'C3-R3')[0].offset, 0);
});

test('profile validation preserves legacy C3 config and rejects invented ports or oversized E8 packets', () => {
  const legacy = defaultConfig(); delete legacy.profile;
  assert.equal(validateConfig(legacy).profile, 'c3-five');
  const config = defaultConfig('e8-c3');
  config.bars.find(bar => bar.id === 'R3').node = 'E8-1';
  assert.throws(() => validateConfig(config), /raspored/);
  config.bars.find(bar => bar.id === 'R3').node = 'C3-R3';
  for (const bar of config.bars.slice(0, 8)) bar.pixels = 45;
  assert.throws(() => validateConfig(config), /1400/);
  config.bars[0].pixels = 34;
  assert.equal(validateConfig(config).profile, 'e8-c3');
});

test('WLED probe extracts only connection and output diagnostics', async () => {
  const requested = [];
  const result = await probeWled('192.168.1.50', { fetcher: async (url, options) => {
    requested.push([url, options.redirect]);
    return { ok: true, json: async () => url.endsWith('/json/cfg')
      ? { hw: { led: { ins: [{ pin: [5], start: 0, len: 12 }, { pin: [12], start: 12, len: 12 }] } }, nw: { secret: 'not returned' } }
      : { name: 'Studio E8', ver: '0.15.1', arch: 'esp32', mac: 'AA:BB:CC:11:22:33', leds: { count: 96, lc: 3, fps: 25 }, wifi: { signal: 82 }, live: true, secret: 'not returned' } };
  } });
  assert.deepEqual(requested, [['http://192.168.1.50/json/info', 'error'], ['http://192.168.1.50/json/cfg', 'error']]);
  assert.equal(result.ledCount, 96);
  assert.equal(result.rgbw, true);
  assert.equal(result.signal, 82);
  assert.equal(result.live, true);
  assert.equal(result.mac, 'aabbcc112233');
  assert.deepEqual(result.buses, [{ pin: 5, start: 0, length: 12 }, { pin: 12, start: 12, length: 12 }]);
  assert.equal('secret' in result, false);
  const noCfg = await probeWled('192.168.1.50', { fetcher: async url => {
    if (url.endsWith('/json/cfg')) throw new Error('cfg unavailable');
    return { ok: true, json: async () => ({ leds: { count: 12 } }) };
  } });
  assert.equal(noCfg.buses, null);
  const onlyInfo = [];
  await probeWled('192.168.1.50', { includeBuses: false, fetcher: async url => {
    onlyInfo.push(url);
    return { ok: true, json: async () => ({ leds: { count: 12 } }) };
  } });
  assert.deepEqual(onlyInfo, ['http://192.168.1.50/json/info']);
  await assert.rejects(probeWled('192.168.1.50', { fetcher: async () => ({ ok: true, json: async () => ({}) }) }), /WLED/);
});
