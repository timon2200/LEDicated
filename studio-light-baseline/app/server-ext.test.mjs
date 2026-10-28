import test from 'node:test';
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLightingServer, defaultConfig } from './server.mjs';
import { createDirectedShow } from './gemini-director.mjs';
import { validateTimeline, SHOW_THEMES } from './timeline.mjs';
import { PALETTES as ENGINE_PALETTES } from './engine.mjs';
import { createLive } from './daw-live.mjs';

async function extFixture(t, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'ledicated-ext-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const app = createLightingServer({
    configPath: null,
    libraryRoot: join(dir, 'library'),
    maxAudioBytes: 64 * 1024,
    ...options
  });
  await new Promise(done => app.server.listen(0, '127.0.0.1', done));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  t.after(() => app.close());

  async function post(path, data = {}, headers = {}) {
    const res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(data)
    });
    return { status: res.status, headers: res.headers, data: await res.json() };
  }

  async function get(path, headers = {}) {
    const res = await fetch(`${base}${path}`, { headers });
    return { status: res.status, headers: res.headers, data: await res.json() };
  }

  return { dir, app, base, post, get };
}

test('CORS OPTIONS preflight and GET /api/ext/status work from YouTube origin and match tracks by videoId or title', async t => {
  const { dir, app, base, get } = await extFixture(t);

  // OPTIONS preflight from YouTube origin
  const preflight = await fetch(`${base}/api/ext/sync`, {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://www.youtube.com',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'Content-Type'
    }
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), '*');
  assert.match(preflight.headers.get('access-control-allow-methods') || '', /POST/);
  assert.match(preflight.headers.get('access-control-allow-headers') || '', /Content-Type/i);

  // Initial status before any tracks
  const initial = await get('/api/ext/status?videoId=abc123xyz&title=Test+Song', {
    Origin: 'https://www.youtube.com'
  });
  assert.equal(initial.status, 200);
  assert.equal(initial.headers.get('access-control-allow-origin'), '*');
  assert.equal(initial.data.ok, true);
  assert.equal(initial.data.online, true);
  assert.equal(initial.data.track, null);
  assert.equal(initial.data.mode, 'idle');
  assert.equal(initial.data.theme, 'midnight');
  assert.ok(Array.isArray(initial.data.themes) && initial.data.themes.length >= 8);

  // Import a track with YouTube metadata and save analysis
  const sampleMp3 = join(dir, 'sample.mp3');
  await writeFile(sampleMp3, Buffer.from('ID3-youtube-sample-audio'));
  const track = await app.library.importTrack(sampleMp3, 'Fred again - Turn On The Lights.mp3', {
    videoId: 'yt_vid_99',
    sourceUrl: 'https://www.youtube.com/watch?v=yt_vid_99',
    theme: 'cyber'
  });
  await app.library.saveAnalysis(track.id, {
    durationSec: 64,
    bpm: 132,
    beatOffsetSec: 0,
    sections: [
      { id: 'sec-1', name: 'Uvod', type: 'intro', startSec: 0, endSec: 16, durationSec: 16, energy: 0.4, color: '#3a86ff' },
      { id: 'sec-2', name: 'Drop', type: 'drop', startSec: 16, endSec: 64, durationSec: 48, energy: 0.95, color: '#ff0054' }
    ]
  });

  // Lookup by exact videoId
  const byId = await get('/api/ext/status?videoId=yt_vid_99', { Origin: 'https://www.youtube.com' });
  assert.equal(byId.status, 200);
  assert.equal(byId.data.mode, 'synced');
  assert.equal(byId.data.track.id, track.id);
  assert.equal(byId.data.track.bpm, 132);
  assert.equal(byId.data.track.durationSec, 64);

  // Lookup by normalized title stripping "(Official Video)"
  const byTitle = await get('/api/ext/status?videoId=other_id&title=' + encodeURIComponent('Fred again - Turn On The Lights (Official Video)'));
  assert.equal(byTitle.status, 200);
  assert.equal(byTitle.data.mode, 'synced');
  assert.equal(byTitle.data.track.id, track.id);
});

test('POST /api/ext/sync handles live_stream 4-stem fallback (including headless WLED UDP output) and synced database mode', async t => {
  const receiver = dgram.createSocket('udp4');
  const packets = [];
  receiver.on('message', packet => packets.push(packet));
  await new Promise(done => receiver.bind(0, '127.0.0.1', done));
  t.after(() => receiver.close());

  const config = defaultConfig('e8-c3');
  config.nodes[0].host = '127.0.0.2';

  const { dir, app, post } = await extFixture(t, {
    initialConfig: config,
    allowLoopback: true,
    udpPort: receiver.address().port,
    resolveHost: () => '127.0.0.1'
  });

  // Arm output so headless live_stream renders directly to WLED
  const armRes = await post('/api/arm', { armed: true });
  assert.equal(armRes.status, 200);

  // Case B: Track not in DB yet -> live_stream fallback mode with 4 stems
  const liveSync = await post('/api/ext/sync', {
    videoId: 'unknown_vid_1',
    title: 'Unknown Club Track',
    currentTime: 12.4,
    duration: 180,
    paused: false,
    playbackRate: 1,
    theme: 'cyber',
    stems: { bass: 0.85, drums: 0.9, vocals: 0.5, highs: 0.7, energy: 0.82 }
  }, { Origin: 'https://www.youtube.com' });

  assert.equal(liveSync.status, 200);
  assert.equal(liveSync.data.ok, true);
  assert.equal(liveSync.data.mode, 'live_stream');
  assert.equal(liveSync.data.trackId, null);

  await new Promise(done => setTimeout(done, 180));
  assert.ok(packets.length >= 8, `Expected server high-rate 60Hz loop to send >=8 DDP frames in 180ms, got ${packets.length}`);
  assert.ok(packets[0].subarray(10).some(v => v > 0), 'Expected non-zero RGBW channels in live stem frame');

  // Now add track to library and verify Case A: synced database mode
  const audioFile = join(dir, 'synced-song.mp3');
  await writeFile(audioFile, Buffer.from('ID3-synced-song-bytes'));
  const track = await app.library.importTrack(audioFile, 'Synced Club Anthem.mp3', {
    videoId: 'known_vid_2'
  });
  const analysis = {
    durationSec: 48,
    bpm: 128,
    beatOffsetSec: 0,
    sections: [
      { id: 'sec-1', name: 'Gradnja', type: 'build', startSec: 0, endSec: 16, durationSec: 16, energy: 0.65, color: '#ffb703' },
      { id: 'sec-2', name: 'Drop', type: 'drop', startSec: 16, endSec: 48, durationSec: 32, energy: 0.95, color: '#ff0054' }
    ]
  };
  await app.library.saveAnalysis(track.id, analysis);
  const directed = await createDirectedShow(analysis, { theme: 'rave' });
  await app.library.saveTimeline(track.id, directed.timeline);

  const dbSync = await post('/api/ext/sync', {
    videoId: 'known_vid_2',
    title: 'Synced Club Anthem (Official Audio)',
    currentTime: 20.0,
    duration: 48,
    paused: false,
    playbackRate: 1
  }, { Origin: 'https://www.youtube.com' });

  assert.equal(dbSync.status, 200);
  assert.equal(dbSync.data.ok, true);
  assert.equal(dbSync.data.mode, 'synced');
  assert.equal(dbSync.data.trackId, track.id);

  // Existing ready track on /api/ext/import returns alreadyExists: true immediately
  const importExisting = await post('/api/ext/import', {
    videoId: 'known_vid_2',
    title: 'Synced Club Anthem'
  }, { Origin: 'https://www.youtube.com' });
  assert.equal(importExisting.status, 200);
  assert.equal(importExisting.data.ok, true);
  assert.equal(importExisting.data.alreadyExists, true);
  assert.equal(importExisting.data.status, 'ready');
  assert.equal(importExisting.data.track.id, track.id);
});

test('POST /api/ext/control updates master (0..100), theme, blackout, and regenerates track show', async t => {
  const { dir, app, post } = await extFixture(t);

  const audioFile = join(dir, 'regen.mp3');
  await writeFile(audioFile, Buffer.from('ID3-regen-audio-bytes'));
  const track = await app.library.importTrack(audioFile, 'Regen Track.mp3', { videoId: 'regen_vid' });
  await app.library.saveAnalysis(track.id, {
    durationSec: 40,
    bpm: 126,
    beatOffsetSec: 0,
    sections: [
      { id: 'sec-1', name: 'Uvod', type: 'intro', startSec: 0, endSec: 16, durationSec: 16, energy: 0.4, color: '#3a86ff' },
      { id: 'sec-2', name: 'Drop', type: 'drop', startSec: 16, endSec: 40, durationSec: 24, energy: 0.92, color: '#ff0054' }
    ]
  });

  const ctrl = await post('/api/ext/control', {
    master: 88,
    blackout: false,
    theme: 'inferno',
    allowedPresets: ['pulse', 'chase', 'flash'],
    regenerate: true,
    useGemini: false,
    videoId: 'regen_vid'
  }, { Origin: 'https://www.youtube.com' });

  assert.equal(ctrl.status, 200);
  assert.equal(ctrl.data.ok, true);
  assert.equal(ctrl.data.master, 88);
  assert.equal(ctrl.data.blackout, false);
  assert.equal(ctrl.data.theme, 'inferno');

  const savedTimeline = await app.library.getTimeline(track.id);
  assert.ok(savedTimeline, 'Expected regenerated timeline to be saved');
  assert.equal(validateTimeline(savedTimeline).valid, true);
  for (const layer of savedTimeline.layers) {
    for (const clip of layer.clips) {
      assert.ok(['pulse', 'chase', 'flash'].includes(clip.preset), `Unexpected preset ${clip.preset}`);
    }
  }
});

test('POST /api/library/sections saves edited sections and updates track status', async t => {
  const { app, post } = await extFixture(t);

  const track = await app.library.importBuffer('sections-test.mp3', Buffer.from('ID3-sections-audio'));
  await app.library.saveAnalysis(track.id, {
    durationSec: 60,
    bpm: 124,
    beatOffsetSec: 0,
    sections: [
      { id: 'sec-1', name: 'Uvod', type: 'intro', startSec: 0, endSec: 30, durationSec: 30, energy: 0.4, color: '#3a86ff' },
      { id: 'sec-2', name: 'Strofa', type: 'verse', startSec: 30, endSec: 60, durationSec: 30, energy: 0.6, color: '#00b4d8' }
    ]
  });

  const updatedSections = [
    { id: 'sec-1', name: 'Uvod', type: 'intro', startSec: 0, endSec: 15, durationSec: 15, energy: 0.4, color: '#3a86ff' },
    { id: 'sec-2', name: 'Gradnja', type: 'build', startSec: 15, endSec: 30, durationSec: 15, energy: 0.75, color: '#ffb703' },
    { id: 'sec-3', name: 'Drop', type: 'drop', startSec: 30, endSec: 60, durationSec: 30, energy: 0.95, color: '#ff0054' }
  ];

  const res = await post('/api/library/sections', {
    id: track.id,
    sections: updatedSections
  });
  assert.equal(res.status, 200);
  assert.equal(res.data.ok, true);
  assert.equal(res.data.sections.length, 3);
  assert.equal(res.data.sections[2].type, 'drop');

  const storedAnalysis = await app.library.getAnalysis(track.id);
  assert.deepEqual(storedAnalysis.sections, updatedSections);
  const storedTrack = await app.library.getTrack(track.id);
  assert.equal(storedTrack.status, 'ready');
  assert.equal(storedTrack.durationSec, 60);
  assert.equal(storedTrack.bpm, 124);
});

test('createDirectedShow generates algorithmic show, refines sections with Gemini 2.5 Flash, and falls back safely on API failure', async () => {
  const sampleAnalysis = {
    durationSec: 48,
    bpm: 128,
    beatOffsetSec: 0,
    sections: [
      { id: 'sec-1', name: 'Uvod', type: 'intro', startSec: 0, endSec: 16, durationSec: 16, energy: 0.4, color: '#3a86ff' },
      { id: 'sec-2', name: 'Strofa', type: 'verse', startSec: 16, endSec: 48, durationSec: 32, energy: 0.6, color: '#00b4d8' }
    ]
  };

  // 1. Algorithmic mode (useGemini: false or no API key)
  const localShow = await createDirectedShow(sampleAnalysis, {
    title: 'Local Test',
    theme: 'midnight',
    useGemini: false
  });
  assert.equal(localShow.director, 'algorithmic');
  assert.equal(validateTimeline(localShow.timeline).valid, true);
  assert.equal(localShow.sections.length, 2);

  // 2. Gemini 2.5 Flash mode with mocked valid response
  const geminiShow = await createDirectedShow(sampleAnalysis, {
    title: 'Gemini Directed Test',
    theme: 'cyber',
    useGemini: true,
    apiKey: 'test-gemini-key',
    fetcher: async () => ({
      ok: true,
      status: 200,
      async json() {
        return {
          candidates: [{
            content: {
              parts: [{
                text: JSON.stringify({
                  sections: [
                    { type: 'intro', startSec: 0, endSec: 8, energy: 0.35 },
                    { type: 'build', startSec: 8, endSec: 16, energy: 0.78 },
                    { type: 'drop', startSec: 16, endSec: 40, energy: 0.96, preset: 'chase', targets: 'all' },
                    { type: 'outro', startSec: 40, endSec: 48, energy: 0.3 }
                  ]
                })
              }]
            }
          }]
        };
      }
    })
  });
  assert.equal(geminiShow.director, 'gemini-2.5-flash');
  assert.equal(validateTimeline(geminiShow.timeline).valid, true);
  assert.equal(geminiShow.sections.length, 4);
  assert.equal(geminiShow.sections[2].type, 'drop');

  // 3. Gemini API failure / invalid key -> clean fallback to local algorithmic show
  const fallbackShow = await createDirectedShow(sampleAnalysis, {
    title: 'Fallback Test',
    theme: 'rave',
    useGemini: true,
    apiKey: 'invalid-api-key',
    fetcher: async () => ({
      ok: false,
      status: 403,
      async json() { return { error: 'Invalid API key' }; }
    })
  });
  assert.equal(fallbackShow.director, 'algorithmic-fallback');
  assert.equal(validateTimeline(fallbackShow.timeline).valid, true);
  assert.equal(fallbackShow.sections.length, 2);
});

test('createLive pushExternalStems and setPalette map all SHOW_THEMES to valid engine PALETTES without throwing on strict HTML select', async () => {
  class StrictMockElement {
    constructor(tag) {
      this.tagName = String(tag).toUpperCase();
      this.children = [];
      this.style = { setProperty() {} };
      this.dataset = {};
      this.listeners = {};
      this._attrs = new Map();
      this._value = '';
    }
    get firstChild() { return this.children[0] || { style: {} }; }
    get classList() {
      return { add() {}, remove() {}, toggle() {}, contains() { return false; } };
    }
    setAttribute(k, v) {
      this._attrs.set(k, String(v));
      if (k === 'selected' && v !== 'false' && this.parentSelect) {
        this.parentSelect._value = this._value;
      }
    }
    getAttribute(k) { return this._attrs.get(k); }
    addEventListener(type, fn) { this.listeners[type] = fn; }
    append(...nodes) {
      for (const n of nodes) {
        if (n && typeof n === 'object') {
          if (this.tagName === 'SELECT') {
            n.parentSelect = this;
            if (n.selected || this._value === '') this._value = n.value ?? '';
          }
          this.children.push(n);
        }
      }
    }
    replaceChildren(...nodes) {
      this.children = [];
      this.append(...nodes);
    }
    get value() { return this._value; }
    set value(v) {
      const str = String(v ?? '');
      if (this.tagName === 'SELECT' && this.children.length > 0) {
        // Real browser <select> sets value to '' if no <option> matches
        const hasOption = this.children.some(opt => String(opt.value) === str);
        this._value = hasOption ? str : '';
      } else {
        this._value = str;
      }
    }
  }

  const prevDoc = globalThis.document;
  const prevNav = globalThis.navigator;
  globalThis.document = {
    createElement: tag => new StrictMockElement(tag),
    createElementNS: (_ns, tag) => new StrictMockElement(tag)
  };
  Object.defineProperty(globalThis, 'navigator', {
    value: { mediaDevices: { enumerateDevices: async () => [] } },
    configurable: true,
    writable: true
  });

  try {
    const host = new StrictMockElement('div');
    let t = 10;
    const live = createLive(host, { now: () => t, status: () => {} });

    for (const theme of SHOW_THEMES) {
      t += 0.1;
      assert.doesNotThrow(() => {
        live.pushExternalStems(
          { bass: 0.8, drums: 0.7, vocals: 0.4, other: 0.5, rms: 0.65, isBeat: true, isDrop: false },
          theme.id,
          t
        );
      }, `pushExternalStems should not throw for theme "${theme.id}"`);
      assert.ok(Object.hasOwn(ENGINE_PALETTES, live.engine.state.palette), `Engine palette "${live.engine.state.palette}" must exist in ENGINE_PALETTES`);
      live.tick(t);
      const frame = live.frame(t);
      assert.ok(frame?.bars?.C2?.length === 12);
    }

    // Unknown theme string should also safely fall back to 'midnight'
    assert.doesNotThrow(() => {
      live.setPalette('nonexistent_theme_xyz');
    });
    assert.equal(live.engine.state.palette, 'midnight');
  } finally {
    globalThis.document = prevDoc;
    if (prevNav !== undefined) {
      Object.defineProperty(globalThis, 'navigator', { value: prevNav, configurable: true, writable: true });
    }
  }
});
