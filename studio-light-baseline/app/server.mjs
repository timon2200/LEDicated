import http from 'node:http';
import dgram from 'node:dgram';
import { createReadStream } from 'node:fs';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { createLibrary } from './library.mjs';
import { analyzeAudio } from './audio-analysis.mjs';
import { validateTimeline } from './timeline.mjs';
import { mapBarPixels } from './mapping.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const IDS = ['L1', 'C1', 'R1', 'L2', 'C2', 'R2', 'L3', 'C3', 'R3'];
const ASSIGNMENTS = ['C3-B', 'C3-A', 'C3-C', 'C3-B', 'C3-A', 'C3-C', 'C3-D', 'C3-D', 'C3-E'];
export const defaultConfig = () => ({
  transport: 'rgbw',
  nodes: ['A', 'B', 'C', 'D', 'E'].map(letter => ({ id: `C3-${letter}`, host: '' })),
  bars: IDS.map((id, index) => ({ id, node: ASSIGNMENTS[index], pixels: 12, physicalLeds: 72, reverse: false }))
});

export function privateIP(host, allowLoopback = false) {
  if (typeof host !== 'string' || !/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return false;
  const parts = host.split('.').map(Number);
  if (parts.some((part, i) => part > 255 || String(part) !== host.split('.')[i])) return false;
  const [a, b, , d] = parts;
  if (d === 0 || d === 255) return false;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (allowLoopback && a === 127);
}

export function validateConfig(input, allowLoopback = false) {
  const defaults = defaultConfig();
  if (!input || !Array.isArray(input.nodes) || input.nodes.length !== 5 || !Array.isArray(input.bars) || input.bars.length !== 9) throw new Error('Potrebno je 5 kontrolera i svih 9 traka.');
  const transport = input.transport ?? 'rgb'; // preserve existing RGB-only installations
  if (!['rgb', 'rgbw'].includes(transport)) throw new Error('Transport mora biti rgb ili rgbw.');
  const nodes = defaults.nodes.map(({ id }) => {
    const matches = input.nodes.filter(node => node?.id === id);
    if (matches.length !== 1) throw new Error('Kontroleri moraju imati jedinstvene oznake C3-A do C3-E.');
    const { host } = matches[0];
    if (host !== '' && !privateIP(host, allowLoopback)) throw new Error('Unesite privatnu IPv4 adresu kontrolera.');
    return { id, host };
  });
  const configured = nodes.filter(node => node.host).map(node => node.host);
  if (new Set(configured).size !== configured.length) throw new Error('Svaki kontroler mora imati drugu IP adresu.');
  const bars = defaults.bars.map(({ id, node }) => {
    const matches = input.bars.filter(bar => bar?.id === id);
    if (matches.length !== 1) throw new Error('Oznake svih 9 traka moraju biti jedinstvene.');
    const bar = matches[0];
    const physicalLeds = bar.physicalLeds ?? bar.pixels * 6;
    if (bar.node !== node || !Number.isInteger(bar.pixels) || bar.pixels < 1 || bar.pixels > 72 || !Number.isInteger(physicalLeds) || physicalLeds < bar.pixels || physicalLeds > 600 || typeof bar.reverse !== 'boolean') throw new Error('Provjerite raspored, broj grupa (1–72), fizičkih LED dioda i smjer trake.');
    return { id, node, pixels: bar.pixels, physicalLeds, reverse: bar.reverse };
  });
  return { transport, nodes, bars };
}

function validatedPixel(pixel) {
  if (!Array.isArray(pixel) || pixel.length !== 4 || pixel.some(v => !Number.isInteger(v) || v < 0 || v > 255)) throw new Error('Svaki piksel treba 4 cijela RGBW broja od 0 do 255.');
  return pixel;
}

export function rgbFromRgbw(pixel) {
  validatedPixel(pixel);
  const [r, g, b, w] = pixel;
  // RGB transport baseline: approximate warm white with RGB. The physical W
  // emitter is controlled only by WLED's configured auto-white conversion.
  return [Math.min(153, r + w), Math.min(153, Math.round(g + w * 0.78)), Math.min(153, Math.round(b + w * 0.45))];
}

export function encodeDDP(channels, sequence = 1, transport = 'rgb') {
  const payload = Buffer.from(channels);
  const packet = Buffer.alloc(10 + payload.length);
  packet[0] = 0x41; // DDP v1, PUSH
  packet[1] = sequence & 0x0f;
  // WLED source: ESPAsyncE131.h RGB24=0x0B, RGBW32=0x1B.
  // Stable v0.14.4 / v0.15.1 e131.cpp explicitly consumes a fourth W byte.
  packet[2] = transport === 'rgbw' ? 0x1b : 0x0b;
  packet[3] = 1; // display destination
  packet.writeUInt32BE(0, 4);
  packet.writeUInt16BE(payload.length, 8);
  payload.copy(packet, 10);
  return packet;
}

export function createLightingServer({ configPath = resolve(ROOT, 'config.json'), libraryRoot = resolve(ROOT, 'data'), initialConfig, allowLoopback = false, udpPort = 4048, watchdogMs = 1200, minFrameMs = 1000 / 30, resolveHost = host => host, maxAudioBytes } = {}) {
  let config = validateConfig(initialConfig ?? defaultConfig(), allowLoopback);
  const library = createLibrary({ root: libraryRoot, ...(maxAudioBytes ? { maxAudioBytes } : {}) });
  let analysisRunning = false;
  let armed = false;
  let reason = 'Pregled bez izlaza';
  let lastFrame = 0;
  let lastAcceptedFrame = -Infinity;
  let sequence = 0;
  let closing = false;
  const udp = dgram.createSocket('udp4');
  const send = (host, values) => new Promise((resolveSend, reject) => {
    udp.send(encodeDDP(values, (++sequence % 15) + 1, config.transport), udpPort, resolveHost(host), err => err ? reject(err) : resolveSend());
  });
  const zeros = () => Promise.all(config.nodes.filter(node => node.host).map(node => {
    const length = config.bars.filter(bar => bar.node === node.id).reduce((sum, bar) => sum + bar.pixels * (config.transport === 'rgbw' ? 4 : 3), 0);
    return send(node.host, Array(length).fill(0));
  }));
  const disarm = async message => {
    const wasArmed = armed;
    armed = false;
    reason = message;
    if (wasArmed) await zeros();
  };
  const state = () => ({ armed, reason, config, transport: config.transport === 'rgbw' ? 'DDP RGBW' : 'DDP RGB', ceiling: 153, maxFps: 30, watchdogMs });
  const json = (response, status, data) => {
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    response.end(JSON.stringify(data));
  };
  const timer = setInterval(() => {
    if (armed && performance.now() - lastFrame > watchdogMs) disarm('Prekid veze: izlaz ugašen').catch(() => {});
  }, Math.min(100, watchdogMs / 2));
  timer.unref();
  const server = http.createServer(async (request, response) => {
    const port = server.address()?.port;
    const allowedHosts = [`127.0.0.1:${port}`, `localhost:${port}`];
    if (!allowedHosts.includes(request.headers.host) || (request.headers.origin && !allowedHosts.some(host => request.headers.origin === `http://${host}`))) return json(response, 403, { error: 'Samo lokalno sučelje može upravljati izlazom.' });
    const parsedUrl = new URL(request.url, 'http://localhost');
    const pathname = parsedUrl.pathname;
    try {
      if (pathname.startsWith('/api/library/')) {
        await library.init();
        if (request.method === 'GET' && pathname === '/api/library/tracks') return json(response, 200, { tracks: await library.list(), sets: await library.listSets() });
        if ((request.method === 'GET' || request.method === 'HEAD') && /^\/api\/library\/audio\/[a-f0-9-]{36}$/.test(pathname)) {
          const id = pathname.split('/').at(-1);
          const audioPath = await library.getAudioPath(id);
          const { size } = await stat(audioPath);
          const range = request.headers.range;
          let start = 0, end = size - 1;
          if (range !== undefined) {
            const match = typeof range === 'string' && /^bytes=(\d*)-(\d*)$/.exec(range.trim());
            if (!match || (!match[1] && !match[2])) {
              response.writeHead(416, { 'Content-Range': `bytes */${size}`, 'Accept-Ranges': 'bytes' });
              return response.end();
            }
            if (match[1]) {
              start = Number(match[1]);
              end = match[2] ? Number(match[2]) : size - 1;
            } else {
              const suffix = Number(match[2]);
              start = Math.max(0, size - suffix);
            }
            if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || end < start || (match[1] === '' && Number(match[2]) === 0)) {
              response.writeHead(416, { 'Content-Range': `bytes */${size}`, 'Accept-Ranges': 'bytes' });
              return response.end();
            }
            end = Math.min(end, size - 1);
          }
          const headers = { 'Content-Type': extname(audioPath).toLowerCase() === '.wav' ? 'audio/wav' : 'audio/mpeg', 'Content-Length': Math.max(0, end - start + 1), 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
          if (range !== undefined) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
          response.writeHead(range === undefined ? 200 : 206, headers);
          if (request.method === 'HEAD' || size === 0) return response.end();
          const stream = createReadStream(audioPath, { start, end });
          stream.on('error', error => response.destroy(error));
          response.on('close', () => { if (!response.writableFinished) stream.destroy(); });
          stream.pipe(response);
          return;
        }
        if (request.method === 'GET' && /^\/api\/library\/track\/[a-f0-9-]{36}$/.test(pathname)) {
          const id = pathname.split('/').at(-1);
          return json(response, 200, { track: await library.getTrack(id), analysis: await library.getAnalysis(id), timeline: await library.getTimeline(id) });
        }
        if (request.method === 'POST' && pathname === '/api/library/import') {
          const filename = parsedUrl.searchParams.get('name') || '';
          const chunks = []; let size = 0;
          for await (const chunk of request) { size += chunk.length; if (size > 120 * 1024 * 1024) return json(response, 413, { error: 'Audio datoteka je prevelika (120 MB).' }); chunks.push(chunk); }
          const track = await library.importBuffer(filename, Buffer.concat(chunks));
          return json(response, 200, { track });
        }
        if (request.method === 'POST' && /^\/api\/library\/(analyze|timeline|track|set|set-update|set-delete|track-delete)$/.test(pathname)) {
          let body = '';
          for await (const chunk of request) { body += chunk; if (Buffer.byteLength(body) > 5 * 1024 * 1024) return json(response, 413, { error: 'Zahtjev je prevelik.' }); }
          const input = JSON.parse(body || '{}');
          if (pathname === '/api/library/analyze') {
            if (analysisRunning) return json(response, 409, { error: 'Analiza druge pjesme već traje.' });
            analysisRunning = true;
            try { const analysis = await analyzeAudio(await library.getAudioPath(input.id)); await library.setAnalysis(input.id, analysis); return json(response, 200, { analysis }); }
            finally { analysisRunning = false; }
          }
          if (pathname === '/api/library/timeline') {
            const checked = validateTimeline(input.timeline);
            if (!checked.valid) return json(response, 400, { error: checked.errors[0] });
            await library.saveTimeline(input.id, input.timeline); return json(response, 200, { ok: true });
          }
          if (pathname === '/api/library/track') return json(response, 200, { track: await library.updateTrack(input.id, input.patch) });
          if (pathname === '/api/library/set') return json(response, 200, { set: await library.createSet(input.name, input.trackIds) });
          if (pathname === '/api/library/set-update') return json(response, 200, { set: await library.updateSet(input.id, input.patch) });
          if (pathname === '/api/library/set-delete') { await library.deleteSet(input.id); return json(response, 200, { ok: true }); }
          if (pathname === '/api/library/track-delete') { await library.deleteTrack(input.id); return json(response, 200, { ok: true }); }
        }
        return json(response, 404, { error: 'Nepoznat API biblioteke.' });
      }
      if (pathname.startsWith('/api/')) {
        if (request.method === 'GET' && pathname === '/api/state') return json(response, 200, state());
        if (request.method !== 'POST') return json(response, 405, { error: 'Metoda nije podržana.' });
        let body = '';
        for await (const chunk of request) {
          body += chunk;
          if (Buffer.byteLength(body) > 80000) return json(response, 413, { error: 'Zahtjev je prevelik.' });
        }
        const input = JSON.parse(body || '{}');
        if (pathname === '/api/config') {
          if (armed) return json(response, 409, { error: 'Ugasite izlaz prije izmjene postavki.' });
          const next = validateConfig(input, allowLoopback);
          if (configPath) await writeFile(configPath, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
          config = next;
          return json(response, 200, state());
        }
        if (pathname === '/api/arm') {
          if (typeof input.armed !== 'boolean') throw new Error('Očekuje se armed true ili false.');
          if (!input.armed) await disarm('Izlaz ugašen');
          else {
            if (config.nodes.some(node => !node.host)) return json(response, 409, { error: 'Postavite IP adrese svih 5 kontrolera.' });
            armed = true;
            reason = 'Izlaz uključen';
            lastFrame = performance.now();
            lastAcceptedFrame = -Infinity;
          }
          return json(response, 200, state());
        }
        if (pathname === '/api/blackout') {
          await disarm('Blackout');
          return json(response, 200, state());
        }
        if (pathname === '/api/frame') {
          if (!armed) return json(response, 409, { error: 'Izlaz je ugašen.' });
          if (!input.bars || Object.keys(input.bars).length !== 9) throw new Error('Kadar mora sadržavati svih 9 traka.');
          const values = new Map(config.nodes.map(node => [node.id, []]));
          for (const bar of config.bars) {
            const pixels = input.bars[bar.id];
            if (!Array.isArray(pixels) || pixels.length !== 12) throw new Error(`Kadar trake ${bar.id} mora imati 12 uzoraka.`);
            const groups = mapBarPixels(pixels, bar);
            const encoded = config.transport === 'rgbw' ? groups : groups.map(rgbFromRgbw);
            values.get(bar.node).push(...encoded.flat());
          }
          const now = performance.now();
          if (now - lastAcceptedFrame < minFrameMs) return json(response, 429, { error: 'Najviše 30 kadrova u sekundi.' });
          lastFrame = now;
          lastAcceptedFrame = now;
          await Promise.all(config.nodes.map(node => send(node.host, values.get(node.id))));
          return json(response, 200, { ok: true });
        }
        return json(response, 404, { error: 'Nepoznat API.' });
      }
      if (request.method !== 'GET') return json(response, 405, { error: 'Metoda nije podržana.' });
      const allowed = new Set(['/', '/index.html', '/classic.html', '/daw.css', '/daw.mjs', '/daw-state.mjs', '/daw-ui.mjs', '/daw-playlist.mjs', '/daw-editor.mjs', '/daw-mixer.mjs', '/daw-stems.mjs', '/daw-live.mjs', '/daw-performance.mjs', '/live-performance-state.mjs', '/daw-output.mjs', '/daw-browser.mjs', '/daw-driver.mjs', '/audio-spectrum.mjs', '/audio-sections.mjs', '/ui.mjs', '/engine.mjs', '/timeline.mjs', '/timeline-viewport.mjs', '/mapping.mjs', '/led-preview.mjs', '/tooltips.mjs', '/project-ui.mjs', '/style.css', '/studio.css', '/assets/stage-background.png']);
      if (!allowed.has(pathname)) return json(response, 404, { error: 'Datoteka ne postoji.' });
      const filename = pathname === '/' ? 'index.html' : pathname.slice(1);
      const data = await readFile(resolve(ROOT, filename));
      const mime = { '.html': 'text/html', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png' }[extname(filename)];
      response.writeHead(200, { 'Content-Type': mime === 'image/png' ? mime : `${mime}; charset=utf-8`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      response.end(data);
    } catch (error) {
      if (pathname === '/api/frame' && error.code) await disarm('Greška izlaza').catch(() => {});
      json(response, 400, { error: error.message });
    }
  });
  return {
    server,
    state,
    async load() {
      if (!configPath) return;
      try { config = validateConfig(JSON.parse(await readFile(configPath, 'utf8')), allowLoopback); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    },
    async close() {
      if (closing) return;
      closing = true;
      clearInterval(timer);
      await disarm('Poslužitelj ugašen').catch(() => {});
      await new Promise(done => server.close(done));
      try { udp.close(); } catch (error) { if (error.code !== 'ERR_SOCKET_DGRAM_NOT_RUNNING') throw error; }
    }
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = createLightingServer();
  await app.load();
  app.server.listen(8787, '127.0.0.1', () => {
    const url = 'http://127.0.0.1:8787';
    console.log(`Studio Lighting: ${url} (izlaz ugašen)`);
    if (process.argv.includes('--open') && process.platform === 'darwin') execFile('open', [url], error => { if (error) console.error('Otvorite adresu ručno:', url); });
  });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => app.close().then(() => process.exit(0)));
}
