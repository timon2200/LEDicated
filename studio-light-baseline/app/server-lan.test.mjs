import test from 'node:test';
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLightingServer, defaultConfig, isAllowedLanHost, isAllowedLanOrigin } from './server.mjs';
import { createLibrary } from './library.mjs';
import { createAutoShow } from './timeline.mjs';
import { BAR_IDS } from './engine.mjs';

function makeWavBuffer(durationSec = 1.0, sampleRate = 8000) {
  const numSamples = Math.floor(durationSec * sampleRate);
  const dataSize = numSamples * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < numSamples; i++) {
    const sample = Math.round(Math.sin((i / sampleRate) * 440 * Math.PI * 2) * 12000);
    buf.writeInt16LE(sample, 44 + i * 2);
  }
  return buf;
}

const dummyBars = () => Object.fromEntries(BAR_IDS.map(id => [id, Array.from({ length: 12 }, () => [10, 20, 30, 0])]));

test('isAllowedLanHost and isAllowedLanOrigin allow private LAN IPs and .local mDNS but block external hosts', () => {
  assert.equal(isAllowedLanHost('127.0.0.1:8787', 8787), true);
  assert.equal(isAllowedLanHost('localhost:8787', 8787), true);
  assert.equal(isAllowedLanHost('192.168.1.42:8787', 8787), true);
  assert.equal(isAllowedLanHost('10.0.0.15:8787', 8787), true);
  assert.equal(isAllowedLanHost('172.20.10.2:8787', 8787), true);
  assert.equal(isAllowedLanHost('timons-macbook-pro.local:8787', 8787), true);

  assert.equal(isAllowedLanHost('evil.example.com:8787', 8787), false);
  assert.equal(isAllowedLanHost('8.8.8.8:8787', 8787), false);
  assert.equal(isAllowedLanHost('192.168.1.42:9999', 8787), false);

  assert.equal(isAllowedLanOrigin('http://192.168.1.42:8787', 8787), true);
  assert.equal(isAllowedLanOrigin('http://macbook.local:8787', 8787), true);
  assert.equal(isAllowedLanOrigin('https://evil.example.com', 8787), false);
});

test('multi-user LAN presence, stage owner lock, and 1-click stage takeover prevent UDP frame collisions', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ledicated-lan-test-'));
  const receiver = dgram.createSocket('udp4');
  const sentPackets = [];
  receiver.on('message', pkt => sentPackets.push(pkt));
  await new Promise(done => receiver.bind(0, '127.0.0.1', done));

  const initialConfig = defaultConfig('e8-c3');
  initialConfig.nodes[0].host = '127.0.0.2';

  const app = createLightingServer({
    allowLoopback: true,
    initialConfig,
    udpPort: receiver.address().port,
    resolveHost: () => '127.0.0.1',
    configPath: join(dir, 'config.json'),
    sharedShowsDir: join(dir, 'shared-shows'),
    library: createLibrary({ root: join(dir, 'data') }),
    probe: async host => ({ reachable: true, host, mac: 'aabbccddeeff', name: 'E8-1', ledCount: 576 })
  });

  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const port = app.server.address().port;
  const base = `http://127.0.0.1:${port}`;

  try {
    const armRes = await fetch(`${base}/api/arm`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ armed: true }) }).then(r => r.json());
    assert.equal(armRes.armed, true);

    // User A connects first -> automatically becomes stage owner
    const stateA = await fetch(`${base}/api/live/state`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Origin': `http://192.168.1.25:${port}` },
      body: JSON.stringify({ clientId: 'peer-alice', clientName: 'Alice', isPlaying: true })
    }).then(r => r.json());
    assert.equal(stateA.ok, true);
    assert.equal(stateA.stageOwnerId, 'peer-alice');
    assert.equal(stateA.isStageOwner, true);

    // User B connects second -> in solo preview mode
    const stateB = await fetch(`${base}/api/live/state`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Origin': `http://192.168.1.26:${port}` },
      body: JSON.stringify({ clientId: 'peer-bob', clientName: 'Bob', isPlaying: false })
    }).then(r => r.json());
    assert.equal(stateB.ok, true);
    assert.equal(stateB.stageOwnerId, 'peer-alice');
    assert.equal(stateB.isStageOwner, false);

    // User B sends /api/frame -> skipped without sending UDP packets
    const frameB1 = await fetch(`${base}/api/frame`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: 'peer-bob', clientName: 'Bob', bars: dummyBars() })
    }).then(r => r.json());
    assert.equal(frameB1.ok, true);
    assert.equal(frameB1.skipped, 'not_stage_owner');
    await new Promise(r => setTimeout(r, 15));
    assert.equal(sentPackets.length, 0);

    // User A sends /api/frame -> accepted and sent to WLED UDP
    const frameA1 = await fetch(`${base}/api/frame`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: 'peer-alice', clientName: 'Alice', bars: dummyBars() })
    }).then(r => r.json());
    assert.equal(frameA1.ok, true);
    assert.equal(frameA1.skipped, undefined);
    await new Promise(r => setTimeout(r, 15));
    assert.equal(sentPackets.length, 1);

    // User B claims the stage (1-click takeover)
    const claimB = await fetch(`${base}/api/lan/claim-stage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: 'peer-bob', name: 'Bob' })
    }).then(r => r.json());
    assert.equal(claimB.stageOwnerId, 'peer-bob');
    assert.equal(claimB.stageOwnerName, 'Bob');

    // Now User A's frames are skipped, and User B's frames go through!
    const frameA2 = await fetch(`${base}/api/frame`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: 'peer-alice', clientName: 'Alice', bars: dummyBars() })
    }).then(r => r.json());
    assert.equal(frameA2.skipped, 'not_stage_owner');
    await new Promise(r => setTimeout(r, 15));
    assert.equal(sentPackets.length, 1);

    const frameB2 = await fetch(`${base}/api/frame`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: 'peer-bob', clientName: 'Bob', bars: dummyBars() })
    }).then(r => r.json());
    assert.equal(frameB2.ok, true);
    assert.equal(frameB2.skipped, undefined);
    await new Promise(r => setTimeout(r, 15));
    assert.equal(sentPackets.length, 2);
  } finally {
    await app.close();
    receiver.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('export/import .ledpack & .ledshow.json, Git shared-shows, and peer-to-peer LAN push/pull', async () => {
  const dirA = await mkdtemp(join(tmpdir(), 'ledicated-peerA-'));
  const dirB = await mkdtemp(join(tmpdir(), 'ledicated-peerB-'));

  const appA = createLightingServer({
    allowLoopback: true,
    configPath: join(dirA, 'config.json'),
    sharedShowsDir: join(dirA, 'shared-shows'),
    library: createLibrary({ root: join(dirA, 'data') })
  });
  const appB = createLightingServer({
    allowLoopback: true,
    configPath: join(dirB, 'config.json'),
    sharedShowsDir: join(dirB, 'shared-shows'),
    library: createLibrary({ root: join(dirB, 'data') })
  });

  await new Promise(resolve => appA.server.listen(0, '127.0.0.1', resolve));
  await new Promise(resolve => appB.server.listen(0, '127.0.0.1', resolve));
  const baseA = `http://127.0.0.1:${appA.server.address().port}`;
  const baseB = `http://127.0.0.1:${appB.server.address().port}`;

  try {
    // 1. Import a WAV song into Peer A and customize its timeline
    const wav = makeWavBuffer(4.0);
    const impRes = await fetch(`${baseA}/api/library/import?name=FriendBanger.wav&author=Marko`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: wav
    }).then(r => r.json());
    assert.ok(impRes.track?.id);
    const trackIdA = impRes.track.id;

    // Customize timeline on Peer A using createAutoShow
    const customTimeline = createAutoShow({ durationSec: 4.0, bpm: 145 });
    customTimeline.layers[0].name = 'Marko Drop';
    const saveRes = await fetch(`${baseA}/api/library/timeline`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: trackIdA, timeline: customTimeline, author: 'Marko' })
    }).then(r => r.json());
    assert.equal(saveRes.ok, true);

    // 2. Share show to Git (shared-shows/) on Peer A and verify listing
    const gitRes = await fetch(`${baseA}/api/library/share-to-git`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trackId: trackIdA, author: 'Marko' })
    }).then(r => r.json());
    assert.equal(gitRes.ok, true);
    assert.ok(gitRes.filename.endsWith('.ledshow.json'));

    const sharedList = await fetch(`${baseA}/api/library/shared-shows`).then(r => r.json());
    assert.equal(sharedList.shows.length, 1);
    assert.equal(sharedList.shows[0].author, 'Marko');
    assert.ok(sharedList.shows[0].clipCount > 0);

    // 3. Push full .ledpack from Peer A directly to Office Server Peer B over LAN API!
    const pushRes = await fetch(`${baseA}/api/lan/push-pack`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ peerUrl: baseB, trackId: trackIdA, author: 'Marko' })
    }).then(r => r.json());
    assert.equal(pushRes.ok, true);
    assert.ok(pushRes.remoteTrack?.id);

    // Verify Peer B now has the track, audio, analysis, and Marko's custom timeline!
    const bTracks = await fetch(`${baseB}/api/library/tracks`).then(r => r.json());
    assert.equal(bTracks.tracks.length, 1);
    assert.equal(bTracks.tracks[0].title, 'FriendBanger');
    const bDetail = await fetch(`${baseB}/api/library/track/${bTracks.tracks[0].id}`).then(r => r.json());
    assert.equal(bDetail.timeline.bpm, 145);
    assert.equal(bDetail.timeline.layers[0].name, 'Marko Drop');

    // 4. Test pull-pack: delete from A, then pull back from B
    await fetch(`${baseA}/api/library/track-delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: trackIdA })
    });
    const aAfterDel = await fetch(`${baseA}/api/library/tracks`).then(r => r.json());
    assert.equal(aAfterDel.tracks.length, 0);

    const pullRes = await fetch(`${baseA}/api/lan/pull-pack`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ peerUrl: baseB, trackId: bTracks.tracks[0].id })
    }).then(r => r.json());
    assert.equal(pullRes.ok, true);
    assert.equal(pullRes.track.title, 'FriendBanger');
  } finally {
    await appA.close();
    await appB.close();
    await rm(dirA, { recursive: true, force: true });
    await rm(dirB, { recursive: true, force: true });
  }
});
