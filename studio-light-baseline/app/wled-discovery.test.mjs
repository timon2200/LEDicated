import test from 'node:test';
import assert from 'node:assert/strict';
import { discoverWled, normalizeMac, parseBrowse, parseResolve } from './wled-discovery.mjs';

test('Bonjour output parser extracts only WLED service names and local hosts', () => {
  const browse = `Browsing for _wled._tcp.local.\nTimestamp     A/R Flags if Domain Service Type Instance Name\n13:36:15.278  Add 2 10 local. _wled._tcp. Studio E8\n13:36:15.279  Add 2 10 local. _http._tcp. Printer\n13:36:15.280  Add 2 10 local. _wled._tcp. Studio E8\n13:36:15.281  Add 2 10 local. _wled._tcp. R3 Node\n`;
  assert.deepEqual(parseBrowse(browse), ['Studio E8', 'R3 Node']);
  assert.equal(parseResolve('Studio E8 can be reached at wled-abc123.local.:80 (interface 10)'), 'wled-abc123.local');
  assert.equal(parseResolve('Studio E8 can be reached at example.com.:80 (interface 10)'), null);
  assert.equal(normalizeMac('AA:BB:CC:11:22:33'), 'aabbcc112233');
  assert.equal(normalizeMac('not-a-mac'), null);
});

test('discovery verifies private IPv4 WLED endpoints and ignores unverified announcements', async () => {
  const contacted = [];
  const result = await discoverWled({
    browse: async () => ({ names: ['Studio E8', 'Bad Device', 'Internet', 'Studio E8'], error: null }),
    resolve: async name => ({ 'Studio E8': 'e8.local', 'Bad Device': 'bad.local', Internet: 'outside.local' })[name],
    resolveIp: async host => ({ address: ({ 'e8.local': '192.168.1.50', 'bad.local': '192.168.1.51', 'outside.local': '8.8.8.8' })[host] }),
    isAllowedHost: host => host.startsWith('192.168.1.'),
    probe: async host => { contacted.push(host); return host.endsWith('.50')
      ? { reachable: true, version: '0.15.1', name: 'E8', mac: 'AA:BB:CC:11:22:33', ledCount: 96, rgbw: true }
      : { reachable: false }; }
  });
  assert.deepEqual(contacted.sort(), ['192.168.1.50', '192.168.1.51']);
  assert.equal(result.devices.length, 1);
  assert.deepEqual([result.devices[0].host, result.devices[0].mac], ['192.168.1.50', 'aabbcc112233']);
});
