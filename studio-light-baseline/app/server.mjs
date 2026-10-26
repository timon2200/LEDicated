import http from 'node:http';
import dgram from 'node:dgram';
import { randomUUID } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { hostname as osHostname, networkInterfaces, tmpdir } from 'node:os';
import { basename, dirname, resolve, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile, spawn } from 'node:child_process';
import { createLibrary } from './library.mjs';
import { analyzeAudio } from './audio-analysis.mjs';
import { createAutoShow, validateTimeline, renderTimelineFrame, SHOW_THEMES, PALETTES } from './timeline.mjs';
import { createDirectedShow } from './gemini-director.mjs';
import { mapBarPixels } from './mapping.mjs';
import { BAR_IDS, HARDWARE_PROFILES, hardwareProfile, routesForNode } from './hardware-topology.mjs';
import { discoverWled, normalizeMac } from './wled-discovery.mjs';
import { applyTimelineOp } from './daw-remote.mjs';
import {
  sanitizeFilename,
  encodeShowJson,
  decodeShowJson,
  encodeLedPack,
  decodeLedPack,
  detectBundleKind
} from './show-bundle.mjs';

const clampVal = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));

function renderLiveStemFrame(stems = {}, timeSec = 0, themeId = 'midnight', paused = false) {
  const palette = PALETTES[themeId] || PALETTES.midnight;
  const bass = paused ? 0 : clampVal(Number(stems?.bass || 0), 0, 1);
  const drums = paused ? 0 : clampVal(Number(stems?.drums || 0), 0, 1);
  const vocals = paused ? 0 : clampVal(Number(stems?.vocals || 0), 0, 1);
  const highs = paused ? 0 : clampVal(Number(stems?.highs ?? stems?.other ?? 0), 0, 1);
  const t = Number.isFinite(Number(timeSec)) ? Number(timeSec) : 0;

  const bars = {};
  for (const [idx, barId] of BAR_IDS.entries()) {
    const row = Math.floor(idx / 3);
    const col = idx % 3;
    const isBottom = row === 2;
    const isCenter = col === 1;
    const pxList = [];
    for (let p = 0; p < 12; p++) {
      const y = (p + 0.5) / 12;
      const wave = 0.5 + 0.5 * Math.sin(t * 4.2 + col * 1.1 + y * Math.PI);
      const baseAmt = (paused ? 0.08 : 0.14) * wave;
      const bassAmt = isBottom ? bass * (0.75 + 0.25 * (1 - y)) : bass * 0.25;
      const vocalAmt = isCenter ? vocals * (0.65 + 0.35 * Math.sin(t * 3 + y * Math.PI)) : vocals * 0.18;
      const drumAmt = drums > 0.55 ? (drums - 0.3) * 1.1 : drums * 0.45;
      const highAmt = !isCenter ? highs * (0.5 + 0.5 * Math.cos(t * 6 - p * 0.6)) : highs * 0.2;

      const c0 = palette[0], c1 = palette[1], c2 = palette[2], c3 = palette[3];
      const r = clampVal(c0[0] * (baseAmt + highAmt) + c1[0] * bassAmt + c2[0] * vocalAmt + c3[0] * drumAmt, 0, 1);
      const g = clampVal(c0[1] * (baseAmt + highAmt) + c1[1] * bassAmt + c2[1] * vocalAmt + c3[1] * drumAmt, 0, 1);
      const b = clampVal(c0[2] * (baseAmt + highAmt) + c1[2] * bassAmt + c2[2] * vocalAmt + c3[2] * drumAmt, 0, 1);
      const w = clampVal((drums > 0.72 && bass > 0.65 ? (drums - 0.5) * 0.75 : 0) + c3[3] * drumAmt * 0.5, 0, 1);
      pxList.push([Math.round(r * 255), Math.round(g * 255), Math.round(b * 255), Math.round(w * 255)]);
    }
    bars[barId] = pxList;
  }
  return { bars };
}

function downloadWithYtDlp(url, tempDir, jobId, onProgress) {
  const bin = existsSync('/opt/homebrew/bin/yt-dlp') ? '/opt/homebrew/bin/yt-dlp' : 'yt-dlp';
  const outTemplate = join(tempDir, `${jobId}.%(ext)s`);
  const args = ['-x', '--audio-format', 'mp3', '--audio-quality', '192K', '--no-playlist', '--newline', '-o', outTemplate, url];
  return new Promise((resolveDownload, rejectDownload) => {
    const child = spawn(bin, args, {
      env: { ...process.env, PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH || ''}` },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stderrTail = '';
    const parseProgress = chunk => {
      const text = chunk.toString('utf8');
      const matches = text.matchAll(/(\d+(?:\.\d+)?)%/g);
      for (const m of matches) {
        const pct = Number(m[1]);
        if (Number.isFinite(pct) && onProgress) {
          onProgress(Math.round(10 + clampVal(pct / 100, 0, 1) * 45));
        }
      }
    };
    child.stdout.on('data', parseProgress);
    child.stderr.on('data', chunk => {
      parseProgress(chunk);
      stderrTail = (stderrTail + chunk.toString('utf8')).slice(-600);
    });
    child.on('error', err => rejectDownload(err));
    child.on('close', async code => {
      if (code !== 0) {
        return rejectDownload(new Error(stderrTail.trim() || `yt-dlp završio s kodom ${code}`));
      }
      try {
        const files = await readdir(tempDir);
        const mp3 = files.find(f => f.endsWith('.mp3')) || files.find(f => f.startsWith(jobId));
        if (!mp3) return rejectDownload(new Error('Preuzeta MP3 datoteka nije pronađena.'));
        resolveDownload(join(tempDir, mp3));
      } catch (err) {
        rejectDownload(err);
      }
    });
  });
}

const ROOT = dirname(fileURLToPath(import.meta.url));
export const defaultConfig = (profileId = 'c3-five') => {
  const profile = hardwareProfile(profileId);
  if (!profile) throw new Error('Nepoznat raspored kontrolera.');
  return {
    profile: profile.id,
    transport: 'rgbw',
    nodes: profile.nodes.map(id => ({ id, host: '' })),
    bars: BAR_IDS.map(id => ({ id, node: profile.routes.find(route => route.bar === id).node, pixels: 12, physicalLeds: 72, reverse: false }))
  };
};

export function privateIP(host, allowLoopback = false) {
  if (typeof host !== 'string' || !/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return false;
  const parts = host.split('.').map(Number);
  if (parts.some((part, i) => part > 255 || String(part) !== host.split('.')[i])) return false;
  const [a, b, , d] = parts;
  if (d === 0 || d === 255) return false;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (allowLoopback && a === 127);
}

export function isAllowedLanHost(hostHeader, port) {
  if (typeof hostHeader !== 'string' || !hostHeader) return false;
  const expectedSuffix = `:${port}`;
  if (!hostHeader.endsWith(expectedSuffix)) return false;
  const hostname = hostHeader.slice(0, -expectedSuffix.length).toLowerCase();
  if (!hostname) return false;
  if (hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]') return true;
  if (privateIP(hostname, true)) return true;
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)*\.local$/.test(hostname)) return true;
  return false;
}

export function isAllowedLanOrigin(originHeader, port) {
  if (!originHeader) return true;
  if (typeof originHeader !== 'string' || !originHeader.startsWith('http://')) return false;
  return isAllowedLanHost(originHeader.slice('http://'.length), port);
}

export function getLanAddresses(port = 8787) {
  const ips = [];
  const nets = networkInterfaces() || {};
  for (const list of Object.values(nets)) {
    for (const iface of list || []) {
      if (!iface || iface.internal) continue;
      const family = iface.family === 4 || iface.family === 'IPv4';
      if (family && privateIP(iface.address, false) && !ips.includes(iface.address)) {
        ips.push(iface.address);
      }
    }
  }
  const rawHost = (osHostname() || 'macbook').replace(/\.local$/i, '').replace(/[^a-zA-Z0-9-]/g, '-');
  const mdnsHost = `${rawHost}.local`;
  const lanUrls = [
    ...ips.map(ip => `http://${ip}:${port}`),
    `http://${mdnsHost}:${port}`
  ];
  return { hostname: mdnsHost, port, ips, lanUrls };
}

export function validatePeerUrl(rawUrl, allowLoopback = true) {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) throw new Error('Unesite LAN adresu drugog računala (npr. http://192.168.0.105:8787).');
  const normalized = /^https?:\/\//i.test(rawUrl.trim()) ? rawUrl.trim() : `http://${rawUrl.trim()}`;
  let parsed;
  try { parsed = new URL(normalized); } catch { throw new Error('Neispravan format LAN adrese.'); }
  if (parsed.protocol !== 'http:') throw new Error('LAN povezivanje podržava isključivo lokalni http:// protokol.');
  const host = parsed.hostname.toLowerCase();
  const port = Number(parsed.port || 8787);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Neispravan port.');
  const isLocal = allowLoopback && (host === '127.0.0.1' || host === 'localhost');
  const isLan = privateIP(host, allowLoopback) || /^[a-z0-9-]+(\.[a-z0-9-]+)*\.local$/.test(host);
  if (!isLocal && !isLan) throw new Error('Dopuštene su samo lokalne LAN IP adrese (192.168.x.x, 10.x.x.x, .local).');
  return `http://${host}:${port}`;
}

export function validateConfig(input, allowLoopback = false) {
  const profile = hardwareProfile(input?.profile ?? 'c3-five');
  if (!profile) throw new Error('Nepoznat raspored kontrolera.');
  if (!input || !Array.isArray(input.nodes) || input.nodes.length !== profile.nodes.length || !Array.isArray(input.bars) || input.bars.length !== 9) throw new Error('Broj kontrolera i devet barova moraju odgovarati odabranom rasporedu.');
  const transport = input.transport ?? 'rgb'; // preserve existing RGB-only installations
  if (!['rgb', 'rgbw'].includes(transport)) throw new Error('Transport mora biti rgb ili rgbw.');
  const nodes = profile.nodes.map(id => {
    const matches = input.nodes.filter(node => node?.id === id);
    if (matches.length !== 1) throw new Error('Oznake kontrolera moraju odgovarati odabranom rasporedu.');
    const { host } = matches[0];
    if (host !== '' && !privateIP(host, allowLoopback)) throw new Error('Unesite privatnu IPv4 adresu kontrolera.');
    const mac = matches[0].mac === undefined ? null : normalizeMac(matches[0].mac);
    if (matches[0].mac !== undefined && !mac) throw new Error('Neispravan identitet WLED kontrolera.');
    return { id, host, ...(mac ? { mac } : {}) };
  });
  const configured = nodes.filter(node => node.host).map(node => node.host);
  if (new Set(configured).size !== configured.length) throw new Error('Svaki kontroler mora imati drugu IP adresu.');
  const paired = nodes.filter(node => node.mac).map(node => node.mac);
  if (new Set(paired).size !== paired.length) throw new Error('Jedan WLED uređaj ne može imati dvije uloge.');
  const bars = BAR_IDS.map(id => {
    const node = profile.routes.find(route => route.bar === id).node;
    const matches = input.bars.filter(bar => bar?.id === id);
    if (matches.length !== 1) throw new Error('Oznake svih 9 traka moraju biti jedinstvene.');
    const bar = matches[0];
    const physicalLeds = bar.physicalLeds ?? bar.pixels * 6;
    if (bar.node !== node || !Number.isInteger(bar.pixels) || bar.pixels < 1 || bar.pixels > 72 || !Number.isInteger(physicalLeds) || physicalLeds < bar.pixels || physicalLeds > 600 || typeof bar.reverse !== 'boolean') throw new Error('Provjerite raspored, broj grupa (1–72), fizičkih LED dioda i smjer trake.');
    return { id, node, pixels: bar.pixels, physicalLeds, reverse: bar.reverse };
  });
  const config = { profile: profile.id, transport, nodes, bars };
  for (const node of nodes) {
    const bytes = routesForNode(config, node.id).reduce((sum, route) => sum + route.pixels * (transport === 'rgbw' ? 4 : 3), 0);
    if (bytes > 1400) throw new Error(`Previše grupa na ${node.id} za jedan pouzdan DDP paket (najviše 1400 bajtova).`);
  }
  return config;
}

/** Read-only status query. This does not prove that a physical strip is connected. */
export async function probeWled(host, { fetcher = fetch, timeoutMs = 1500, includeBuses = true } = {}) {
  const started = performance.now();
  const response = await fetcher(`http://${host}/json/info`, { signal: AbortSignal.timeout(timeoutMs), redirect: 'error' });
  if (!response.ok) throw new Error(`WLED HTTP ${response.status}`);
  const info = await response.json();
  if (!info || typeof info !== 'object' || !info.leds || typeof info.leds !== 'object') throw new Error('Uređaj nije vratio WLED /json/info.');
  const leds = info.leds;
  // cfg.json structure is not a stable WLED API. Only expose these bus fields,
  // and keep the basic /json/info result usable when /json/cfg is unavailable.
  let buses = null;
  if (includeBuses) try {
    const cfgResponse = await fetcher(`http://${host}/json/cfg`, { signal: AbortSignal.timeout(timeoutMs), redirect: 'error' });
    if (cfgResponse.ok) {
      const cfg = await cfgResponse.json();
      if (Array.isArray(cfg?.hw?.led?.ins)) buses = cfg.hw.led.ins.slice(0, 17).map(bus => ({
        pin: Number.isInteger(bus?.pin?.[0]) ? bus.pin[0] : null,
        start: Number.isInteger(bus?.start) ? bus.start : null,
        length: Number.isInteger(bus?.len) ? bus.len : null
      }));
    }
  } catch { /* Firmware may not expose this optional configuration route. */ }
  return {
    reachable: true,
    name: typeof info.name === 'string' ? info.name.slice(0, 64) : '',
    version: typeof info.ver === 'string' ? info.ver.slice(0, 40) : '',
    arch: typeof info.arch === 'string' ? info.arch.slice(0, 40) : '',
    ledCount: Number.isInteger(leds.count) ? leds.count : null,
    rgbw: Number.isInteger(leds.lc) ? Boolean(leds.lc & 2) : typeof leds.rgbw === 'boolean' ? leds.rgbw : null,
    signal: Number.isFinite(info.wifi?.signal) ? info.wifi.signal : null,
    fps: Number.isFinite(leds.fps) ? leds.fps : null,
    live: info.live === true,
    mac: normalizeMac(info.mac),
    buses,
    responseMs: Math.round(performance.now() - started)
  };
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
  return [Math.min(255, r + w), Math.min(255, Math.round(g + w * 0.78)), Math.min(255, Math.round(b + w * 0.45))];
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

export function createLightingServer({ configPath = resolve(ROOT, 'config.json'), libraryRoot = resolve(ROOT, 'data'), library: customLibrary = null, sharedShowsDir = resolve(ROOT, 'shared-shows'), initialConfig, allowLoopback = false, udpPort = 4048, watchdogMs = 3500, minFrameMs = 8, resolveHost = host => host, probe = probeWled, discovery = discoverWled, maxAudioBytes, ytDownloader = downloadWithYtDlp, peerFetcher = fetch } = {}) {
  let config = validateConfig(initialConfig ?? defaultConfig(), allowLoopback);
  let cachedNodeRoutes = new Map(config.nodes.map(node => [node.id, routesForNode(config, node.id)]));
  const updateConfig = next => {
    config = next;
    cachedNodeRoutes = new Map(config.nodes.map(node => [node.id, routesForNode(config, node.id)]));
  };
  const library = customLibrary || createLibrary({ root: libraryRoot, ...(maxAudioBytes ? { maxAudioBytes } : {}) });
  let analysisRunning = false;
  let armed = false;
  let reason = 'Pregled bez izlaza';
  let lastFrame = 0;
  let lastAcceptedFrame = -Infinity;
  let sequence = 0;
  let closing = false;
  let discoveryPromise = null;
  let testRunning = false;
  let testAbort = false, stopTest = null, testSettled = null;
  const liveClients = new Set();
  const lanPeers = new Map();
  let stageOwnerId = null;
  let latestLiveState = null;
  const broadcastLive = (event, data) => {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of liveClients) {
      try { client.write(payload); } catch { liveClients.delete(client); }
    }
  };
  const cleanPeerIp = req => {
    const raw = String(req?.socket?.remoteAddress || '127.0.0.1');
    return raw.startsWith('::ffff:') ? raw.slice(7) : raw;
  };
  const pruneLanPeers = () => {
    const nowMs = Date.now();
    for (const [cid, peer] of lanPeers.entries()) {
      const hasSse = peer.sseRes && !peer.sseRes.writableEnded && !peer.sseRes.destroyed;
      if (!hasSse && nowMs - peer.lastSeenAt > 12000) {
        lanPeers.delete(cid);
      }
    }
    if (stageOwnerId && !lanPeers.has(stageOwnerId)) {
      const nextPlaying = [...lanPeers.values()].find(p => p.isPlaying) || [...lanPeers.values()][0] || null;
      stageOwnerId = nextPlaying ? nextPlaying.clientId : null;
    }
  };
  const touchLanPeer = (clientId, patch = {}, req = null) => {
    if (typeof clientId !== 'string' || !clientId.trim()) return null;
    const cid = clientId.trim().slice(0, 64);
    pruneLanPeers();
    const existing = lanPeers.get(cid);
    const nowMs = Date.now();
    const name = typeof patch.name === 'string' && patch.name.trim()
      ? patch.name.trim().slice(0, 48)
      : (existing?.name || `Gost ${lanPeers.size + 1}`);
    const peer = {
      clientId: cid,
      name,
      ip: req ? cleanPeerIp(req) : (existing?.ip || '127.0.0.1'),
      connectedAt: existing?.connectedAt || nowMs,
      lastSeenAt: nowMs,
      trackId: patch.trackId !== undefined ? patch.trackId : (existing?.trackId || null),
      trackTitle: patch.trackTitle !== undefined ? patch.trackTitle : (existing?.trackTitle || null),
      isPlaying: patch.isPlaying !== undefined ? Boolean(patch.isPlaying) : Boolean(existing?.isPlaying),
      timeSec: patch.timeSec !== undefined ? Number(patch.timeSec || 0) : Number(existing?.timeSec || 0),
      bpm: patch.bpm !== undefined ? patch.bpm : (existing?.bpm || null),
      sseRes: patch.sseRes !== undefined ? patch.sseRes : (existing?.sseRes || null)
    };
    lanPeers.set(cid, peer);
    if (!stageOwnerId) stageOwnerId = cid;
    return peer;
  };
  const getLanStatus = () => {
    pruneLanPeers();
    const port = server?.address?.()?.port || 8787;
    const addrInfo = getLanAddresses(port);
    return {
      ok: true,
      ...addrInfo,
      armed: Boolean(armed),
      blackout: Boolean(liveControl.state.blackout),
      master: liveControl.state.master ?? 70,
      stageOwnerId,
      stageOwnerName: (stageOwnerId && lanPeers.get(stageOwnerId)?.name) || null,
      peers: [...lanPeers.values()].map(p => ({
        clientId: p.clientId,
        name: p.name,
        ip: p.ip,
        isStageOwner: p.clientId === stageOwnerId,
        trackId: p.trackId || null,
        trackTitle: p.trackTitle || null,
        isPlaying: Boolean(p.isPlaying),
        timeSec: Number(p.timeSec || 0),
        bpm: p.bpm || null,
        lastSeenAt: p.lastSeenAt
      }))
    };
  };
  const broadcastLanPresence = (extra = {}) => {
    broadcastLive('command', { type: 'lan_presence', lan: getLanStatus(), ...extra });
  };
  const liveControl = {
    state: { master: 70, blackout: false, trackId: null },
    get clientCount() { return liveClients.size; },
    broadcastCommand(cmd) { broadcastLive('command', cmd); }
  };
  const extJobs = new Map();
  const extState = {
    mode: 'idle',
    activeVideoId: null,
    theme: 'midnight',
    useGemini: false,
    lastSyncAt: 0,
    liveStems: null
  };
  const udp = dgram.createSocket('udp4');
  udp.on('error', () => {}); // Prevent unhandled UDP socket error events from crashing Node process
  const TRANSIENT_UDP_ERRORS = new Set(['EHOSTDOWN', 'EHOSTUNREACH', 'ENETUNREACH', 'ENOBUFS', 'EAGAIN']);
  const send = (host, values) => new Promise((resolveSend, reject) => {
    udp.send(encodeDDP(values, (++sequence % 15) + 1, config.transport), udpPort, resolveHost(host), err => {
      if (err && !TRANSIENT_UDP_ERRORS.has(err.code)) return reject(err);
      resolveSend();
    });
  });
  const zeros = () => Promise.all(config.nodes.filter(node => node.host).map(node => {
    const routes = cachedNodeRoutes.get(node.id) || routesForNode(config, node.id);
    const length = routes.reduce((sum, route) => sum + route.pixels * (config.transport === 'rgbw' ? 4 : 3), 0);
    return send(node.host, Array(length).fill(0));
  }));
  const disarm = async message => {
    const wasArmed = armed;
    armed = false;
    reason = message;
    if (wasArmed) await zeros().catch(() => {});
  };
  const wakeWled = host => {
    if (probe === probeWled && host) {
      fetch(`http://${host}/json/state`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ on: true, bri: 255, transition: 0, seg: [{ id: 0, col: [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], fx: 0 }] }),
        signal: AbortSignal.timeout(800)
      }).catch(() => {});
    }
  };
  let autoConnectPromise = null;
  const autoConnect = ({ allowDiscovery = true } = {}) => {
    if (armed) {
      const e8 = config.nodes.find(n => n.id === 'E8-1') || config.nodes.find(n => n.host);
      return Promise.resolve({ ok: true, connected: true, alreadyArmed: true, host: e8?.host || null, nodeId: e8?.id || null, ...state() });
    }
    if (testRunning || liveControl.state.blackout) {
      return Promise.resolve({ ok: false, connected: false, error: liveControl.state.blackout ? 'Blackout je aktivan.' : 'Pričekajte kraj kratkog testa.', ...state() });
    }
    if (autoConnectPromise) return autoConnectPromise;
    autoConnectPromise = (async () => {
      try {
        if (!config.nodes.some(n => n.id === 'E8-1') && !config.nodes.some(n => n.host)) {
          const fallback = defaultConfig('e8-columns');
          if (!allowLoopback) {
            fallback.nodes[0].host = '192.168.0.117';
            fallback.nodes[0].mac = 'd0ef767a14f8';
          }
          const validated = validateConfig(fallback, allowLoopback);
          updateConfig(validated);
          if (configPath) await writeFile(configPath, `${JSON.stringify(validated, null, 2)}\n`, { mode: 0o600 }).catch(() => {});
        }
        const e8Node = config.nodes.find(n => n.id === 'E8-1') || config.nodes[0];
        if (e8Node?.host) {
          try {
            const actual = await probe(e8Node.host, { includeBuses: false });
            if (actual?.reachable && (!e8Node.mac || !actual.mac || actual.mac === e8Node.mac)) {
              if (!e8Node.mac && actual.mac) {
                const withMac = validateConfig({
                  ...config,
                  nodes: config.nodes.map(n => n.id === e8Node.id ? { ...n, mac: actual.mac } : n)
                }, allowLoopback);
                updateConfig(withMac);
                if (configPath) await writeFile(configPath, `${JSON.stringify(withMac, null, 2)}\n`, { mode: 0o600 }).catch(() => {});
              }
              const activeNodes = [];
              for (const node of config.nodes.filter(n => n.host)) {
                if (node.id === e8Node.id) {
                  activeNodes.push(node);
                  wakeWled(node.host);
                } else {
                  try {
                    const other = await probe(node.host, { includeBuses: false });
                    if (other?.reachable && (!node.mac || !other.mac || other.mac === node.mac)) {
                      activeNodes.push(node);
                      wakeWled(node.host);
                    }
                  } catch {}
                }
              }
              if (activeNodes.length) {
                armed = true;
                reason = activeNodes.length === config.nodes.length ? 'Izlaz uključen' : `Izlaz uključen (${activeNodes.length}/${config.nodes.length} kontrolera)`;
                lastFrame = performance.now();
                lastAcceptedFrame = -Infinity;
                broadcastLive('command', { type: 'hardware_sync', state: state() });
                return { ok: true, connected: true, rebound: false, host: e8Node.host, nodeId: e8Node.id, ...state() };
              }
            }
          } catch {}
        }
        if (!allowDiscovery) {
          return { ok: false, connected: false, error: 'EO8+ nije odgovorio na spremljenoj IP adresi.', ...state() };
        }
        if (!discoveryPromise) {
          discoveryPromise = discovery({
            probe: host => probe(host, { includeBuses: false }),
            isAllowedHost: host => privateIP(host, allowLoopback)
          }).finally(() => { discoveryPromise = null; });
        }
        const found = await discoveryPromise;
        const validDevices = (found.devices || []).filter(d => d?.host && privateIP(d.host, allowLoopback));
        const targetMac = e8Node?.mac || 'd0ef767a14f8';
        const matched =
          validDevices.find(d => normalizeMac(d.mac) && normalizeMac(d.mac) === targetMac) ||
          validDevices.find(d => /e8|eo8/i.test(`${d.name || ''} ${d.service || ''}`)) ||
          (!e8Node?.mac && (validDevices.find(d => /esp32/i.test(d.arch || '')) || (validDevices.length === 1 ? validDevices[0] : null)));
        if (matched) {
          const usedHosts = new Set(config.nodes.filter(n => n.id !== e8Node.id && n.host).map(n => n.host));
          if (!usedHosts.has(matched.host)) {
            const mac = normalizeMac(matched.mac) || e8Node?.mac || null;
            const next = validateConfig({
              ...config,
              nodes: config.nodes.map(n => n.id === e8Node.id ? { id: n.id, host: matched.host, ...(mac ? { mac } : {}) } : n)
            }, allowLoopback);
            updateConfig(next);
            if (configPath) await writeFile(configPath, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 }).catch(() => {});
            wakeWled(matched.host);
            const activeNodes = config.nodes.filter(n => n.host);
            armed = true;
            reason = activeNodes.length === config.nodes.length ? 'Izlaz uključen' : `Izlaz uključen (${activeNodes.length}/${config.nodes.length} kontrolera)`;
            lastFrame = performance.now();
            lastAcceptedFrame = -Infinity;
            broadcastLive('command', { type: 'hardware_sync', state: state() });
            return { ok: true, connected: true, rebound: true, host: matched.host, nodeId: e8Node.id, ...state() };
          }
        }
        return { ok: false, connected: false, error: 'EO8+ nije pronađen na mreži.', ...state() };
      } finally {
        autoConnectPromise = null;
      }
    })();
    return autoConnectPromise;
  };
  const sendBarsToWled = async (bars, scale = 1) => {
    if (!armed || !bars || Object.keys(bars).length !== 9) return false;
    const now = performance.now();
    if (now - lastAcceptedFrame < minFrameMs) return false;
    const values = new Map(config.nodes.map(node => [node.id, []]));
    const masterScale = clampVal(scale, 0, 1);
    for (const node of config.nodes) {
      const routes = cachedNodeRoutes.get(node.id) || routesForNode(config, node.id);
      const nodeValues = values.get(node.id);
      for (const route of routes) {
        const rawPixels = bars[route.bar];
        if (!Array.isArray(rawPixels) || rawPixels.length !== 12) throw new Error(`Kadar trake ${route.bar} mora imati 12 uzoraka.`);
        const isAbsentC1 = config.profile === 'e8-columns' && route.bar === 'C1';
        const pixels = isAbsentC1
          ? Array.from({ length: 12 }, () => [0, 0, 0, 0])
          : masterScale === 1
            ? rawPixels
            : rawPixels.map(px => px.map(v => Math.round(clampVal(v * masterScale, 0, 255))));
        const groups = mapBarPixels(pixels, route);
        const encoded = config.transport === 'rgbw' ? groups : groups.map(rgbFromRgbw);
        for (let i = 0; i < encoded.length; i++) {
          const px = encoded[i];
          for (let c = 0; c < px.length; c++) nodeValues.push(px[c]);
        }
      }
    }
    lastFrame = now;
    lastAcceptedFrame = now;
    await Promise.all(config.nodes.filter(node => node.host).map(node => send(node.host, values.get(node.id))));
    return true;
  };
  const state = () => ({ armed, reason, config, transport: config.transport === 'rgbw' ? 'DDP RGBW' : 'DDP RGB', ceiling: 255, maxFps: 120, watchdogMs });
  const json = (response, status, data) => {
    if (response.headersSent || response.destroyed || response.writableEnded) return;
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    response.end(JSON.stringify(data));
  };
  const serverShowCache = new Map();
  let sharedShowsIndexCache = null;
  let sharedShowsIndexAt = 0;
  const findSharedShow = async ({ videoId, title } = {}) => {
    const vid = String(videoId || '').trim();
    const normTitle = String(title || '').trim().toLowerCase();
    if (!vid && !normTitle) return null;
    const nowMs = Date.now();
    if (!sharedShowsIndexCache || nowMs - sharedShowsIndexAt > 5000) {
      const files = (await readdir(sharedShowsDir).catch(() => [])).filter(f => f.endsWith('.ledshow.json'));
      const entries = [];
      for (const filename of files) {
        try {
          const raw = await readFile(join(sharedShowsDir, filename), 'utf8');
          const parsed = decodeShowJson(raw);
          entries.push({
            id: `shared:${filename}`,
            filename,
            title: parsed.track?.title || filename.replace(/\.ledshow\.json$/i, ''),
            videoId: parsed.track?.videoId || null,
            bpm: parsed.track?.bpm || parsed.timeline?.bpm || 120,
            durationSec: parsed.track?.durationSec || parsed.timeline?.durationSec || 60,
            analysis: parsed.analysis,
            timeline: parsed.timeline
          });
        } catch {}
      }
      sharedShowsIndexCache = entries;
      sharedShowsIndexAt = nowMs;
    }
    return sharedShowsIndexCache.find(s =>
      (vid && s.videoId && s.videoId === vid) ||
      (normTitle && s.title && s.title.toLowerCase() === normTitle)
    ) || null;
  };
  const getCachedShow = async trackId => {
    if (!trackId) return null;
    const nowMs = Date.now();
    const cached = serverShowCache.get(trackId);
    if (cached && nowMs - cached.loadedAt < 10000) return cached;
    await library.init();
    const timeline = await library.getTimeline(trackId).catch(() => null);
    if (!timeline) return null;
    const analysis = await library.getAnalysis(trackId).catch(() => null);
    const entry = { timeline, analysis, loadedAt: nowMs };
    if (serverShowCache.size >= 4) {
      const firstKey = serverShowCache.keys().next().value;
      if (firstKey !== undefined) serverShowCache.delete(firstKey);
    }
    serverShowCache.set(trackId, entry);
    return entry;
  };
  let fallbackBusy = false;
  const timer = setInterval(() => {
    if (!armed) return;
    const idleMs = performance.now() - lastFrame;
    if (liveClients.size > 0 && !liveControl.state.blackout && idleMs > 80 && !fallbackBusy) {
      const trackId = latestLiveState?.trackId || liveControl.state.trackId;
      if (trackId) {
        fallbackBusy = true;
        getCachedShow(trackId)
          .then(show => {
            if (!show || !armed) return;
            const elapsedSec = latestLiveState?.isPlaying
              ? Math.max(0, (Date.now() - (latestLiveState.timestamp || Date.now())) / 1000)
              : 0;
            const durationLimit = show.analysis?.durationSec || show.timeline?.durationSec || Infinity;
            const tSec = Math.min(durationLimit, Math.max(0, (Number(latestLiveState?.timeSec) || 0) + elapsedSec));
            const rendered = renderTimelineFrame(show.timeline, show.analysis, tSec, null, true);
            const scale = clampVal(( latestLiveState?.master ?? liveControl.state.master ?? 70 ) / 100, 0, 1);
            return sendBarsToWled(rendered.bars, scale);
          })
          .catch(() => {})
          .finally(() => { fallbackBusy = false; });
        return;
      }
    }
    const effectiveWatchdogMs = liveClients.size > 0 ? Math.max(watchdogMs * 20, 65000) : watchdogMs;
    if (idleMs > effectiveWatchdogMs) {
      disarm('Prekid veze: izlaz ugašen')
        .then(() => broadcastLive('command', { type: 'hardware_sync', state: state() }))
        .catch(() => {});
    }
  }, Math.min(50, watchdogMs / 2));
  timer.unref();
  const server = http.createServer(async (request, response) => {
    const parsedUrl = new URL(request.url, 'http://localhost');
    const pathname = parsedUrl.pathname;
    const isExtApi = pathname === '/api/ext' || pathname.startsWith('/api/ext/');
    if (isExtApi) {
      response.setHeader('Access-Control-Allow-Origin', '*');
      response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      if (request.method === 'OPTIONS') {
        response.writeHead(204);
        return response.end();
      }
    }
    const port = server.address()?.port;
    if (!isAllowedLanHost(request.headers.host, port) || (!isExtApi && !isAllowedLanOrigin(request.headers.origin, port))) {
      return json(response, 403, { error: 'Samo lokalno ili LAN sučelje može upravljati izlazom.' });
    }
    try {
      if (isExtApi) {
        await library.init();
        if (request.method === 'GET' && pathname === '/api/ext/status') {
          const videoId = parsedUrl.searchParams.get('videoId') || '';
          const title = parsedUrl.searchParams.get('title') || '';
          const track = library.findTrackByVideo({ videoId, title });
          const sharedShow = !track ? await findSharedShow({ videoId, title }) : null;
          const matched = track || sharedShow;
          let bpm = matched?.bpm ?? null;
          let durationSec = matched?.durationSec ?? null;
          if (track && (!bpm || !durationSec) && track.hasAnalysis) {
            const analysis = await library.getAnalysis(track.id).catch(() => null);
            if (analysis) {
              bpm = bpm ?? analysis.bpm ?? null;
              durationSec = durationSec ?? analysis.durationSec ?? analysis.duration ?? null;
            }
          }
          const importJob = (videoId && extJobs.get(videoId)) || (title && extJobs.get(title)) || null;
          return json(response, 200, {
            ok: true,
            online: true,
            track: matched ? { id: matched.id, name: matched.title, title: matched.title, bpm, durationSec, sharedOnly: Boolean(!track && sharedShow) } : null,
            importJob: importJob || null,
            mode: matched ? 'synced' : (extState.mode || 'idle'),
            master: liveControl.state.master ?? 70,
            blackout: Boolean(liveControl.state.blackout),
            armed: Boolean(armed),
            theme: extState.theme,
            themes: SHOW_THEMES.map(t => ({ id: t.id, name: t.name, description: t.description }))
          });
        }
        if (request.method !== 'POST') return json(response, 405, { error: 'Metoda nije podržana.' });
        let extBody = '';
        for await (const chunk of request) {
          extBody += chunk;
          if (Buffer.byteLength(extBody) > 512 * 1024) return json(response, 413, { error: 'Zahtjev je prevelik.' });
        }
        const input = JSON.parse(extBody || '{}');
        if (pathname === '/api/ext/import') {
          const { url, videoId, title, theme = 'midnight', allowedPresets, useGemini = false } = input;
          const existing = library.findTrackByVideo({ videoId, title });
          if (existing && (existing.status === 'ready' || existing.hasAnalysis)) {
            liveControl.state.trackId = existing.id;
            liveControl.broadcastCommand({ type: 'select_track', trackId: existing.id });
            return json(response, 200, { ok: true, alreadyExists: true, status: 'ready', track: { ...existing, name: existing.title } });
          }
          const key = videoId || title || randomUUID();
          const runningJob = extJobs.get(key);
          if (runningJob && ['downloading', 'analyzing', 'generating_show'].includes(runningJob.status)) {
            return json(response, 200, { ok: true, jobId: runningJob.jobId, status: runningJob.status, alreadyExists: false });
          }
          const jobId = randomUUID();
          const job = {
            jobId,
            videoId: videoId || null,
            title: title || videoId || 'YouTube Audio',
            status: 'downloading',
            progress: 10,
            message: 'Preuzimanje audio zapisa (yt-dlp)…',
            error: null
          };
          extJobs.set(key, job);
          if (videoId && key !== videoId) extJobs.set(videoId, job);

          (async () => {
            let tempDir = null;
            try {
              const targetUrl = url || (videoId ? `https://www.youtube.com/watch?v=${videoId}` : '');
              if (!targetUrl) throw new Error('Nedostaje YouTube URL ili videoId.');
              tempDir = await mkdtemp(join(tmpdir(), 'ledicated-yt-'));
              const finalMp3Path = await ytDownloader(targetUrl, tempDir, jobId, p => {
                job.progress = Math.max(job.progress, Math.min(55, p));
              });
              job.status = 'analyzing';
              job.progress = 65;
              job.message = 'Analiza stemova, waveforma i dionica…';
              const sharedMatch = await findSharedShow({ videoId, title });
              const imported = await library.importTrack(finalMp3Path, `${title || videoId || 'YouTube'}.mp3`, {
                videoId,
                sourceUrl: targetUrl,
                theme
              });
              const analysis = await library.analyzeTrack(imported.id);
              job.status = 'generating_show';
              job.progress = 85;
              job.message = sharedMatch?.timeline ? 'Učitavanje dijeljenog Git showa…' : 'Kreiranje svjetlosnog showa…';
              if (sharedMatch?.timeline) {
                if (Array.isArray(sharedMatch.analysis?.sections) && sharedMatch.analysis.sections.length) {
                  analysis.sections = sharedMatch.analysis.sections;
                  await library.saveAnalysis(imported.id, analysis);
                }
                await library.saveTimeline(imported.id, sharedMatch.timeline);
              } else {
                const directed = await createDirectedShow(analysis, {
                  title: imported.title,
                  theme,
                  palette: theme,
                  allowedPresets,
                  useGemini
                });
                if (Array.isArray(directed.sections) && directed.sections.length) {
                  analysis.sections = directed.sections;
                  await library.saveAnalysis(imported.id, analysis);
                }
                await library.saveTimeline(imported.id, directed.timeline);
              }
              serverShowCache.delete(imported.id);
              const readyTrack = await library.getTrack(imported.id);
              liveControl.state.trackId = readyTrack.id;
              liveControl.broadcastCommand({ type: 'select_track', trackId: readyTrack.id });
              job.status = 'ready';
              job.progress = 100;
              job.trackId = readyTrack.id;
              job.track = { ...readyTrack, name: readyTrack.title };
              job.message = '✓ Show spreman i sinkroniziran!';
            } catch (err) {
              job.status = 'error';
              job.error = err?.message || String(err);
              job.message = `Greška: ${job.error}`;
            } finally {
              if (tempDir) await rm(tempDir, { recursive: true, force: true }).catch(() => {});
            }
          })();

          return json(response, 200, { ok: true, jobId, status: 'downloading', alreadyExists: false });
        }
        if (pathname === '/api/ext/sync') {
          const { videoId, title, currentTime = 0, duration, paused = false, playbackRate = 1, liveMode, forceLiveStream = false, theme, stems } = input;
          extState.lastSyncAt = Date.now();
          if (videoId) extState.activeVideoId = videoId;
          if (typeof theme === 'string' && theme.trim()) extState.theme = theme.trim();
          const track = library.findTrackByVideo({ videoId, title });
          const sharedShow = (!track && !forceLiveStream) ? await findSharedShow({ videoId, title }) : null;
          const matched = track || sharedShow;
          if (liveMode === false) {
            extState.mode = 'idle';
            extState.liveStems = null;
            extState.lastPaused = true;
            liveControl.broadcastCommand({
              type: 'ext_sync',
              mode: 'idle',
              videoId,
              title,
              paused: true,
              liveMode: false
            });
            return json(response, 200, {
              ok: true,
              mode: 'idle',
              trackId: matched?.id || null,
              importJob: (videoId && extJobs.get(videoId)) || null
            });
          }
          const isReady = Boolean(((track && (track.status === 'ready' || track.hasAnalysis)) || sharedShow?.timeline) && !forceLiveStream);
          const dawPlayingLocally = Boolean(latestLiveState?.isPlaying && (Date.now() - (latestLiveState.timestamp || 0) < 3500));
          const shouldBroadcast = !dawPlayingLocally && (!paused || !extState.lastPaused || Math.abs(Number(currentTime || 0) - Number(extState.lastTime || 0)) > 0.08);
          extState.lastPaused = Boolean(paused);
          extState.lastTime = Number(currentTime || 0);
          if (isReady) {
            extState.mode = 'synced';
            if (!dawPlayingLocally && track) liveControl.state.trackId = track.id;
            if (shouldBroadcast) {
              liveControl.broadcastCommand({
                type: 'ext_sync',
                mode: 'synced',
                trackId: matched.id,
                currentTime,
                duration,
                paused,
                playbackRate
              });
            }
            if (!dawPlayingLocally && armed && (liveControl.clientCount === 0 || performance.now() - lastFrame > 80) && !liveControl.state.blackout) {
              const show = track ? await getCachedShow(track.id).catch(() => null) : { timeline: sharedShow.timeline, analysis: sharedShow.analysis };
              if (show?.timeline) {
                const rendered = renderTimelineFrame(show.timeline, show.analysis, Math.max(0, Number(currentTime) || 0), null, true);
                await sendBarsToWled(rendered.bars, paused ? 0 : (liveControl.state.master ?? 70) / 100).catch(() => {});
              }
            }
          } else {
            extState.mode = 'live_stream';
            extState.liveStems = stems || null;
            if (shouldBroadcast) {
              liveControl.broadcastCommand({
                type: 'ext_sync',
                mode: 'live_stream',
                videoId,
                title,
                currentTime,
                paused,
                theme: theme || extState.theme,
                stems
              });
            }
            if (!dawPlayingLocally && armed && (liveControl.clientCount === 0 || performance.now() - lastFrame > 80) && !liveControl.state.blackout) {
              const liveFrame = renderLiveStemFrame(stems, currentTime, theme || extState.theme, Boolean(paused));
              await sendBarsToWled(liveFrame.bars, (liveControl.state.master ?? 70) / 100).catch(() => {});
            }
          }
          return json(response, 200, {
            ok: true,
            mode: extState.mode,
            trackId: isReady ? matched.id : (matched?.id || null),
            track: matched ? { id: matched.id, name: matched.title, title: matched.title, bpm: matched.bpm, durationSec: matched.durationSec } : null,
            importJob: (videoId && extJobs.get(videoId)) || null
          });
        }
        if (pathname === '/api/ext/control') {
          const { master, blackout, armed: reqArmed, theme, allowedPresets, regenerate, useGemini, videoId, title } = input;
          if (Number.isFinite(master)) {
            const val = clampVal(Number(master), 0, 100);
            liveControl.state.master = val;
            liveControl.broadcastCommand({ type: 'master', value: val });
          }
          if (typeof blackout === 'boolean') {
            liveControl.state.blackout = blackout;
            if (blackout) {
              if (testRunning) { testAbort = true; stopTest?.(); await testSettled; }
              await disarm('Blackout');
            }
            liveControl.broadcastCommand({ type: 'blackout', value: blackout });
            liveControl.broadcastCommand({ type: 'hardware_sync', state: state() });
          }
          if (typeof reqArmed === 'boolean') {
            if (!reqArmed) {
              await disarm('Izlaz ugašen');
            } else {
              const activeNodes = config.nodes.filter(node => node.host);
              if (activeNodes.length) {
                armed = true;
                reason = activeNodes.length === config.nodes.length ? 'Izlaz uključen' : `Izlaz uključen (${activeNodes.length}/${config.nodes.length} kontrolera)`;
                lastFrame = performance.now();
                lastAcceptedFrame = -Infinity;
              }
            }
            liveControl.broadcastCommand({ type: 'hardware_sync', state: state() });
          }
          if (typeof theme === 'string' && theme.trim()) {
            extState.theme = theme.trim();
            liveControl.broadcastCommand({ type: 'ext_theme', theme: extState.theme, allowedPresets });
          }
          if (typeof useGemini === 'boolean') {
            extState.useGemini = useGemini;
          }
          if (regenerate) {
            let targetTrack = library.findTrackByVideo({ videoId, title });
            if (!targetTrack && liveControl.state.trackId) {
              targetTrack = await library.getTrack(liveControl.state.trackId).catch(() => null);
            }
            if (!targetTrack) {
              const allTracks = await library.list();
              targetTrack = allTracks[0] || null;
            }
            if (targetTrack) {
              const analysis = (await library.getAnalysis(targetTrack.id).catch(() => null)) || {
                durationSec: targetTrack.durationSec || 60,
                bpm: targetTrack.bpm || 120
              };
              const targetTheme = (typeof theme === 'string' && theme.trim()) ? theme.trim() : extState.theme;
              const directed = await createDirectedShow(analysis, {
                title: targetTrack.title,
                theme: targetTheme,
                palette: targetTheme,
                allowedPresets,
                useGemini: Boolean(useGemini ?? extState.useGemini)
              });
              if (Array.isArray(directed.sections) && directed.sections.length) {
                analysis.sections = directed.sections;
                await library.saveAnalysis(targetTrack.id, analysis);
              }
              await library.saveTimeline(targetTrack.id, directed.timeline);
              serverShowCache.delete(targetTrack.id);
              liveControl.broadcastCommand({
                type: 'timeline_op',
                trackId: targetTrack.id,
                op: 'replace',
                timeline: directed.timeline,
                label: `Tema: ${targetTheme}`
              });
            }
          }
          return json(response, 200, {
            ok: true,
            master: liveControl.state.master,
            blackout: Boolean(liveControl.state.blackout),
            armed: Boolean(armed),
            theme: extState.theme
          });
        }
        return json(response, 404, { error: 'Nepoznat API ekstenzije.' });
      }
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
        if (request.method === 'GET' && /^\/api\/library\/export-show\/[a-f0-9-]{36}$/.test(pathname)) {
          const id = pathname.split('/').at(-1);
          const track = await library.getTrack(id);
          const analysis = await library.getAnalysis(id).catch(() => null);
          let timeline = await library.getTimeline(id).catch(() => null);
          if (!timeline && analysis) timeline = createAutoShow(analysis);
          if (!timeline) return json(response, 404, { error: 'Pjesma još nema izgrađen show.' });
          const author = parsedUrl.searchParams.get('author') || track.author || '';
          const showObj = encodeShowJson({ track, analysis, timeline, author });
          const safeName = `${sanitizeFilename(track.title || track.originalName)}.ledshow.json`;
          const payload = `${JSON.stringify(showObj, null, 2)}\n`;
          response.writeHead(200, {
            'Content-Type': 'application/json; charset=utf-8',
            'Content-Disposition': `attachment; filename="${encodeURIComponent(safeName)}"`,
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff'
          });
          return response.end(payload);
        }
        if (request.method === 'GET' && /^\/api\/library\/export-pack\/[a-f0-9-]{36}$/.test(pathname)) {
          const id = pathname.split('/').at(-1);
          const track = await library.getTrack(id);
          const analysis = await library.getAnalysis(id).catch(() => null);
          let timeline = await library.getTimeline(id).catch(() => null);
          if (!timeline && analysis) timeline = createAutoShow(analysis);
          if (!timeline) timeline = { version: 1, durationSec: track.durationSec || 60, bpm: track.bpm || 120, beatOffsetSec: 0, blackout: false, layers: [] };
          const audioBuffer = await readFile(await library.getAudioPath(id));
          const author = parsedUrl.searchParams.get('author') || track.author || '';
          const packBuf = encodeLedPack({ track, analysis, timeline, audioBuffer, author });
          const safeName = `${sanitizeFilename(track.title || track.originalName)}.ledpack`;
          response.writeHead(200, {
            'Content-Type': 'application/octet-stream',
            'Content-Length': packBuf.byteLength,
            'Content-Disposition': `attachment; filename="${encodeURIComponent(safeName)}"`,
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff'
          });
          return response.end(packBuf);
        }
        if (request.method === 'GET' && pathname === '/api/library/shared-shows') {
          await mkdir(sharedShowsDir, { recursive: true, mode: 0o755 }).catch(() => {});
          const files = (await readdir(sharedShowsDir).catch(() => [])).filter(f => f.endsWith('.ledshow.json')).sort();
          const sharedShows = [];
          for (const filename of files) {
            try {
              const raw = await readFile(join(sharedShowsDir, filename), 'utf8');
              const parsed = decodeShowJson(raw);
              const matched = library.findTrackByVideo({
                sha256: parsed.track?.sha256,
                videoId: parsed.track?.videoId,
                title: parsed.track?.title
              });
              const clipCount = (parsed.timeline?.layers || []).reduce((sum, l) => sum + (l.clips?.length || 0), 0);
              sharedShows.push({
                filename,
                title: parsed.track?.title || filename.replace(/\.ledshow\.json$/i, ''),
                videoId: parsed.track?.videoId || null,
                sha256: parsed.track?.sha256 || null,
                bpm: parsed.track?.bpm || parsed.timeline?.bpm || 120,
                durationSec: parsed.track?.durationSec || parsed.timeline?.durationSec || 0,
                author: parsed.author || 'Studio',
                exportedAt: raw ? (JSON.parse(raw).exportedAt || null) : null,
                track: parsed.track,
                layerCount: parsed.timeline?.layers?.length || 0,
                clipCount,
                sectionCount: parsed.analysis?.sections?.length || 0,
                installedTrackId: matched?.id || null
              });
            } catch {}
          }
          return json(response, 200, { ok: true, shows: sharedShows, sharedShows });
        }
        if (request.method === 'POST' && pathname === '/api/library/import') {
          const filename = parsedUrl.searchParams.get('name') || '';
          const author = parsedUrl.searchParams.get('author') || '';
          const chunks = []; let size = 0;
          for await (const chunk of request) { size += chunk.length; if (size > 120 * 1024 * 1024) return json(response, 413, { error: 'Audio datoteka je prevelika (120 MB).' }); chunks.push(chunk); }
          const track = await library.importBuffer(filename, Buffer.concat(chunks), author ? { author } : {});
          broadcastLive('command', { type: 'library_updated', trackId: track.id, action: 'import' });
          return json(response, 200, { track });
        }
        if (request.method === 'POST' && pathname === '/api/library/import-bundle') {
          const authorParam = parsedUrl.searchParams.get('author') || '';
          const targetTrackId = parsedUrl.searchParams.get('targetTrackId') || '';
          const chunks = []; let size = 0;
          for await (const chunk of request) {
            size += chunk.length;
            if (size > 130 * 1024 * 1024) return json(response, 413, { error: 'Paket je prevelik (najviše 130 MB).' });
            chunks.push(chunk);
          }
          const rawBuf = Buffer.concat(chunks);
          const kind = detectBundleKind(rawBuf);
          if (kind === 'pack') {
            const bundle = decodeLedPack(rawBuf);
            const effectiveAuthor = authorParam || bundle.author || '';
            const imported = await library.importBuffer(bundle.track.originalName, bundle.audioBuffer, {
              videoId: bundle.track.videoId,
              sourceUrl: bundle.track.sourceUrl,
              theme: bundle.track.theme,
              ...(effectiveAuthor ? { author: effectiveAuthor } : {})
            });
            if (bundle.track.title && bundle.track.title !== imported.title) {
              await library.updateTrack(imported.id, {
                title: bundle.track.title,
                ...(effectiveAuthor ? { author: effectiveAuthor } : {})
              }).catch(() => {});
            } else if (effectiveAuthor && effectiveAuthor !== imported.author) {
              await library.updateTrack(imported.id, { author: effectiveAuthor }).catch(() => {});
            }
            if (bundle.analysis) {
              await library.saveAnalysis(imported.id, bundle.analysis);
            }
            await library.saveTimeline(imported.id, bundle.timeline);
            serverShowCache.delete(imported.id);
            const finalTrack = await library.getTrack(imported.id);
            broadcastLive('command', { type: 'library_updated', trackId: finalTrack.id, action: 'import_pack' });
            broadcastLive('command', { type: 'timeline_op', trackId: finalTrack.id, op: 'replace', timeline: bundle.timeline, label: 'Uvezen .ledpack paket' });
            return json(response, 200, { ok: true, kind: 'pack', track: finalTrack });
          }
          if (kind === 'show') {
            const bundle = decodeShowJson(rawBuf);
            const effectiveAuthor = authorParam || bundle.author || '';
            let matched = null;
            if (targetTrackId) {
              matched = await library.getTrack(targetTrackId).catch(() => null);
            }
            if (!matched) {
              matched = library.findTrackByVideo({
                sha256: bundle.track?.sha256,
                videoId: bundle.track?.videoId,
                title: bundle.track?.title
              });
            }
            if (!matched) {
              return json(response, 404, {
                error: `Audio zapis za „${bundle.track?.title || 'ovaj show'}” nije pronađen u lokalnoj biblioteci. Uvezi MP3/WAV ili koristi .ledpack paket s uključenim audiom.`,
                missingAudio: true,
                showManifest: bundle.track
              });
            }
            if (effectiveAuthor) {
              await library.updateTrack(matched.id, { author: effectiveAuthor }).catch(() => {});
            }
            if (bundle.analysis?.sections?.length) {
              const existingAnalysis = (await library.getAnalysis(matched.id).catch(() => null)) || bundle.analysis;
              await library.saveAnalysis(matched.id, { ...existingAnalysis, sections: bundle.analysis.sections });
            }
            await library.saveTimeline(matched.id, bundle.timeline);
            serverShowCache.delete(matched.id);
            const finalTrack = await library.getTrack(matched.id);
            broadcastLive('command', { type: 'library_updated', trackId: finalTrack.id, action: 'import_show' });
            broadcastLive('command', { type: 'timeline_op', trackId: finalTrack.id, op: 'replace', timeline: bundle.timeline, label: 'Uvezen .ledshow.json' });
            return json(response, 200, { ok: true, kind: 'show', track: finalTrack });
          }
          return json(response, 400, { error: 'Nepoznat format paketa (podržani su .ledpack i .ledshow.json).' });
        }
        if (request.method === 'POST' && /^\/api\/library\/(analyze|timeline|sections|track|set|set-update|set-delete|track-delete|share-to-git|install-shared-show)$/.test(pathname)) {
          let body = '';
          for await (const chunk of request) { body += chunk; if (Buffer.byteLength(body) > 5 * 1024 * 1024) return json(response, 413, { error: 'Zahtjev je prevelik.' }); }
          const input = JSON.parse(body || '{}');
          if (pathname === '/api/library/share-to-git') {
            const targetId = input.trackId || input.id;
            const track = await library.getTrack(targetId);
            const analysis = await library.getAnalysis(targetId).catch(() => null);
            let timeline = await library.getTimeline(targetId).catch(() => null);
            if (!timeline && analysis) timeline = createAutoShow(analysis);
            if (!timeline) return json(response, 400, { error: 'Pjesma još nema show za dijeljenje.' });
            const author = (typeof input.author === 'string' && input.author.trim()) ? input.author.trim() : (track.author || 'Studio');
            if (author && author !== track.author) await library.updateTrack(track.id, { author }).catch(() => {});
            const showObj = encodeShowJson({ track, analysis, timeline, author });
            await mkdir(sharedShowsDir, { recursive: true, mode: 0o755 });
            const filename = `${sanitizeFilename(track.title || track.originalName)}.ledshow.json`;
            await writeFile(join(sharedShowsDir, filename), `${JSON.stringify(showObj, null, 2)}\n`, 'utf8');
            sharedShowsIndexCache = null;
            broadcastLive('command', { type: 'library_updated', trackId: track.id, action: 'share_to_git' });
            return json(response, 200, { ok: true, filename, author });
          }
          if (pathname === '/api/library/install-shared-show') {
            const safeFile = basename(String(input.filename || ''));
            if (!safeFile.endsWith('.ledshow.json')) return json(response, 400, { error: 'Neispravan naziv .ledshow.json datoteke.' });
            const raw = await readFile(join(sharedShowsDir, safeFile), 'utf8');
            const bundle = decodeShowJson(raw);
            let matched = input.targetTrackId ? await library.getTrack(input.targetTrackId).catch(() => null) : null;
            if (!matched) {
              matched = library.findTrackByVideo({
                sha256: bundle.track?.sha256,
                videoId: bundle.track?.videoId,
                title: bundle.track?.title
              });
            }
            if (!matched && input.downloadAudio !== false && (bundle.track?.sourceUrl || bundle.track?.videoId)) {
              const targetUrl = bundle.track.sourceUrl || `https://www.youtube.com/watch?v=${bundle.track.videoId}`;
              let tempDir = null;
              try {
                tempDir = await mkdtemp(join(tmpdir(), 'ledicated-shared-'));
                const mp3Path = await ytDownloader(targetUrl, tempDir, randomUUID());
                matched = await library.importTrack(mp3Path, bundle.track.originalName || `${bundle.track.title}.mp3`, {
                  videoId: bundle.track.videoId,
                  sourceUrl: targetUrl,
                  theme: bundle.track.theme,
                  author: bundle.author
                });
                const fullAnalysis = await library.analyzeTrack(matched.id);
                if (bundle.analysis?.sections?.length) {
                  fullAnalysis.sections = bundle.analysis.sections;
                  await library.saveAnalysis(matched.id, fullAnalysis);
                }
              } finally {
                if (tempDir) await rm(tempDir, { recursive: true, force: true }).catch(() => {});
              }
            }
            if (!matched) {
              return json(response, 404, {
                error: `Audio za „${bundle.track?.title || safeFile}” još nije u lokalnoj biblioteci. Povuci MP3/WAV datoteku ili odaberi postojeću pjesmu.`,
                missingAudio: true,
                showManifest: bundle.track
              });
            }
            if (bundle.author) await library.updateTrack(matched.id, { author: bundle.author }).catch(() => {});
            if (bundle.analysis?.sections?.length) {
              const existingAnalysis = (await library.getAnalysis(matched.id).catch(() => null)) || bundle.analysis;
              await library.saveAnalysis(matched.id, { ...existingAnalysis, sections: bundle.analysis.sections });
            }
            await library.saveTimeline(matched.id, bundle.timeline);
            serverShowCache.delete(matched.id);
            const finalTrack = await library.getTrack(matched.id);
            broadcastLive('command', { type: 'library_updated', trackId: finalTrack.id, action: 'install_shared' });
            broadcastLive('command', { type: 'timeline_op', trackId: finalTrack.id, op: 'replace', timeline: bundle.timeline, label: `Show: ${finalTrack.title}` });
            return json(response, 200, { ok: true, track: finalTrack });
          }
          if (pathname === '/api/library/analyze') {
            if (analysisRunning) return json(response, 409, { error: 'Analiza druge pjesme već traje.' });
            analysisRunning = true;
            try { const analysis = await analyzeAudio(await library.getAudioPath(input.id)); await library.setAnalysis(input.id, analysis); serverShowCache.delete(input.id); return json(response, 200, { analysis }); }
            finally { analysisRunning = false; }
          }
          if (pathname === '/api/library/timeline') {
            const checked = validateTimeline(input.timeline);
            if (!checked.valid) return json(response, 400, { error: checked.errors[0] });
            await library.saveTimeline(input.id, input.timeline);
            serverShowCache.delete(input.id);
            broadcastLive('command', {
              type: 'timeline_updated',
              trackId: input.id,
              clientId: input.clientId || null,
              author: input.author || null,
              timeline: input.timeline
            });
            return json(response, 200, { ok: true });
          }
          if (pathname === '/api/library/sections') {
            if (!Array.isArray(input.sections)) return json(response, 400, { error: 'Dionice moraju biti polje.' });
            const track = await library.getTrack(input.id);
            const existingAnalysis = (await library.getAnalysis(input.id)) || {
              durationSec: track.durationSec || 60,
              bpm: track.bpm || 120
            };
            const updatedAnalysis = { ...existingAnalysis, sections: input.sections };
            await library.saveAnalysis(input.id, updatedAnalysis);
            serverShowCache.delete(input.id);
            return json(response, 200, { ok: true, sections: input.sections });
          }
          if (pathname === '/api/library/track') {
            const track = await library.updateTrack(input.id, input.patch);
            broadcastLive('command', { type: 'library_updated', trackId: track.id, action: 'rename' });
            return json(response, 200, { track });
          }
          if (pathname === '/api/library/set') return json(response, 200, { set: await library.createSet(input.name, input.trackIds) });
          if (pathname === '/api/library/set-update') return json(response, 200, { set: await library.updateSet(input.id, input.patch) });
          if (pathname === '/api/library/set-delete') { await library.deleteSet(input.id); return json(response, 200, { ok: true }); }
          if (pathname === '/api/library/track-delete') {
            await library.deleteTrack(input.id);
            broadcastLive('command', { type: 'library_updated', trackId: input.id, action: 'delete' });
            return json(response, 200, { ok: true });
          }
        }
        return json(response, 404, { error: 'Nepoznat API biblioteke.' });
      }
      if (pathname.startsWith('/api/')) {
        if (pathname === '/api/live/stream' && request.method === 'GET') {
          response.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            'Connection': 'keep-alive',
            'X-Content-Type-Options': 'nosniff'
          });
          response.write(': connected\n\n');
          liveClients.add(response);
          const clientId = parsedUrl.searchParams.get('clientId') || '';
          const clientName = parsedUrl.searchParams.get('name') || '';
          if (clientId) {
            touchLanPeer(clientId, { name: clientName, sseRes: response }, request);
            broadcastLanPresence();
          } else {
            response.write(`event: command\ndata: ${JSON.stringify({ type: 'lan_presence', ...getLanStatus() })}\n\n`);
          }
          request.on('close', () => {
            liveClients.delete(response);
            if (clientId && lanPeers.has(clientId)) {
              const peer = lanPeers.get(clientId);
              if (peer.sseRes === response) peer.sseRes = null;
              broadcastLanPresence();
            }
          });
          return;
        }
        if (pathname === '/api/live/status' && request.method === 'GET') {
          return json(response, 200, {
            ok: true,
            browserConnected: liveClients.size > 0,
            clientCount: liveClients.size,
            liveState: latestLiveState,
            serverState: state(),
            lan: getLanStatus()
          });
        }
        if (pathname === '/api/lan/status' && request.method === 'GET') {
          return json(response, 200, { ok: true, ...getLanStatus() });
        }
        if (pathname === '/api/live/frame' && request.method === 'GET') {
          await library.init();
          const trackId = parsedUrl.searchParams.get('trackId') || latestLiveState?.trackId || (await library.list())[0]?.id;
          if (!trackId) return json(response, 200, { ok: false, error: 'Nema dostupnih pjesama.' });
          try {
            const timeline = await library.getTimeline(trackId);
            const analysis = await library.getAnalysis(trackId).catch(() => null);
            const timeSec = parsedUrl.searchParams.has('time') ? Number(parsedUrl.searchParams.get('time')) : (latestLiveState?.timeSec || 0);
            const frame = renderTimelineFrame(timeline, analysis, timeSec);
            let sumR = 0, sumG = 0, sumB = 0, sumW = 0, count = 0;
            for (const barId of BAR_IDS) {
              const pxList = frame.bars[barId] || [];
              for (const [r, g, b, w] of pxList) {
                sumR += r; sumG += g; sumB += b; sumW += w;
                count++;
              }
            }
            const maxPossible = Math.max(1, count * 255);
            const channels = {
              r: Math.min(100, Math.round((sumR / maxPossible) * 100)),
              g: Math.min(100, Math.round((sumG / maxPossible) * 100)),
              b: Math.min(100, Math.round((sumB / maxPossible) * 100)),
              w: Math.min(100, Math.round((sumW / maxPossible) * 100))
            };
            const avg = (sumR + sumG + sumB + sumW) / (maxPossible * 4);
            const watts = Math.round(8 + avg * 192);
            return json(response, 200, { ok: true, trackId, timeSec, frame, watts, channels });
          } catch (err) {
            return json(response, 400, { ok: false, error: err.message });
          }
        }
        if (request.method === 'GET' && pathname === '/api/state') return json(response, 200, state());
        if (request.method === 'GET' && pathname === '/api/profiles') return json(response, 200, { profiles: HARDWARE_PROFILES.map(profile => ({ id: profile.id, label: profile.label, description: profile.description, config: defaultConfig(profile.id) })) });
        if (request.method !== 'POST') return json(response, 405, { error: 'Metoda nije podržana.' });
        let body = '';
        for await (const chunk of request) {
          body += chunk;
          if (Buffer.byteLength(body) > 250000) return json(response, 413, { error: 'Zahtjev je prevelik.' });
        }
        const input = JSON.parse(body || '{}');
        if (pathname === '/api/live/state') {
          let prevPeerSnap = '';
          if (input.clientId) {
            const existing = lanPeers.get(String(input.clientId));
            prevPeerSnap = existing ? `${existing.name}|${existing.trackId}|${existing.isPlaying}` : '';
            touchLanPeer(input.clientId, {
              name: input.clientName,
              trackId: input.trackId,
              trackTitle: input.trackTitle,
              isPlaying: input.isPlaying,
              timeSec: input.timeSec,
              bpm: input.bpm
            }, request);
            const updated = lanPeers.get(String(input.clientId));
            const nextPeerSnap = updated ? `${updated.name}|${updated.trackId}|${updated.isPlaying}` : '';
            if (prevPeerSnap !== nextPeerSnap) broadcastLanPresence();
          }
          const isStageOwner = !input.clientId || !stageOwnerId || stageOwnerId === String(input.clientId);
          if (isStageOwner) {
            latestLiveState = { ...input, timestamp: Date.now() };
            if (Number.isFinite(input.master)) liveControl.state.master = input.master;
            if (typeof input.blackout === 'boolean') liveControl.state.blackout = input.blackout;
            if (input.trackId) liveControl.state.trackId = input.trackId;
            if (armed && input.armed) lastFrame = performance.now();
          }
          const ownerPeer = stageOwnerId ? lanPeers.get(stageOwnerId) : null;
          return json(response, 200, {
            ok: true,
            stageOwnerId,
            stageOwnerName: ownerPeer?.name || null,
            isStageOwner
          });
        }
        if (pathname === '/api/lan/claim-stage') {
          const cid = String(input.clientId || '').trim();
          if (!cid) return json(response, 400, { error: 'Nedostaje clientId.' });
          touchLanPeer(cid, { name: input.name }, request);
          if (input.release === true) {
            if (stageOwnerId === cid) stageOwnerId = null;
            pruneLanPeers();
          } else {
            stageOwnerId = cid;
          }
          broadcastLanPresence();
          return json(response, 200, { ok: true, ...getLanStatus() });
        }
        if (pathname === '/api/lan/profile') {
          const cid = String(input.clientId || '').trim();
          if (!cid) return json(response, 400, { error: 'Nedostaje clientId.' });
          touchLanPeer(cid, { name: input.name }, request);
          broadcastLanPresence();
          return json(response, 200, { ok: true, ...getLanStatus() });
        }
        if (pathname === '/api/lan/peer-tracks') {
          const peerBase = validatePeerUrl(input.peerUrl, allowLoopback);
          const [tracksRes, statusRes] = await Promise.all([
            peerFetcher(`${peerBase}/api/library/tracks`, { signal: AbortSignal.timeout(4000) }),
            peerFetcher(`${peerBase}/api/lan/status`, { signal: AbortSignal.timeout(4000) }).catch(() => null)
          ]);
          if (!tracksRes.ok) throw new Error(`Peer server vratio HTTP ${tracksRes.status}.`);
          const tracksData = await tracksRes.json();
          const statusData = statusRes && statusRes.ok ? await statusRes.json().catch(() => null) : null;
          return json(response, 200, {
            ok: true,
            peerUrl: peerBase,
            tracks: tracksData.tracks || [],
            peerStatus: statusData
          });
        }
        if (pathname === '/api/lan/push-pack') {
          const peerBase = validatePeerUrl(input.peerUrl, allowLoopback);
          await library.init();
          const track = await library.getTrack(input.trackId);
          const [timeline, analysis, audioPath] = await Promise.all([
            library.getTimeline(track.id),
            library.getAnalysis(track.id).catch(() => null),
            library.getAudioPath(track.id)
          ]);
          const audioBuffer = await readFile(audioPath);
          const packBuffer = encodeLedPack({
            track: { ...track, author: input.author || track.author || '' },
            timeline,
            analysis,
            audioBuffer,
            author: input.author || track.author || ''
          });
          const query = new URLSearchParams({
            name: `${sanitizeFilename(track.title)}.ledpack`,
            author: input.author || track.author || ''
          });
          const uploadRes = await peerFetcher(`${peerBase}/api/library/import-bundle?${query.toString()}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/octet-stream' },
            body: packBuffer,
            signal: AbortSignal.timeout(30000)
          });
          const uploadData = await uploadRes.json().catch(() => ({}));
          if (!uploadRes.ok) throw new Error(uploadData.error || `Slanje nije uspjelo (HTTP ${uploadRes.status}).`);
          return json(response, 200, { ok: true, peerUrl: peerBase, remoteTrack: uploadData.track, kind: uploadData.kind });
        }
        if (pathname === '/api/lan/pull-pack') {
          const peerBase = validatePeerUrl(input.peerUrl, allowLoopback);
          const trackId = String(input.trackId || '').trim();
          if (!trackId) return json(response, 400, { error: 'Nedostaje trackId.' });
          const packRes = await peerFetcher(`${peerBase}/api/library/export-pack/${encodeURIComponent(trackId)}`, {
            signal: AbortSignal.timeout(30000)
          });
          if (!packRes.ok) {
            const errData = await packRes.json().catch(() => ({}));
            throw new Error(errData.error || `Preuzimanje s peer servera nije uspjelo (HTTP ${packRes.status}).`);
          }
          const arrayBuf = await packRes.arrayBuffer();
          const decoded = decodeLedPack(Buffer.from(arrayBuf));
          await library.init();
          const audioName = `${sanitizeFilename(decoded.track.title || decoded.track.originalName || 'SharedTrack')}${decoded.track.extension || '.mp3'}`;
          const track = await library.importBuffer(audioName, decoded.audioBuffer, {
            title: decoded.track.title,
            author: decoded.author || decoded.track.author || '',
            source: 'ledpack',
            videoId: decoded.track.videoId || null,
            sourceUrl: decoded.track.sourceUrl || null,
            durationSec: decoded.track.durationSec || decoded.timeline?.durationSec,
            bpm: decoded.track.bpm || decoded.timeline?.bpm
          });
          if (decoded.analysis) {
            const existingAnalysis = await library.getAnalysis(track.id).catch(() => null);
            await library.saveAnalysis(track.id, existingAnalysis ? { ...existingAnalysis, sections: decoded.analysis.sections || existingAnalysis.sections } : decoded.analysis);
          }
          await library.saveTimeline(track.id, decoded.timeline);
          serverShowCache.delete(track.id);
          const finalTrack = await library.getTrack(track.id);
          broadcastLive('command', { type: 'library_updated', trackId: finalTrack.id, action: 'pull-pack' });
          return json(response, 200, { ok: true, track: finalTrack });
        }
        if (pathname === '/api/live/command') {
          if (input.type === 'timeline_op') {
            await library.init();
            const trackId = input.trackId || latestLiveState?.trackId || (await library.list())[0]?.id;
            if (!trackId) return json(response, 404, { error: 'Nema odabrane pjesme za izmjenu vremenske trake.' });
            let timeline;
            let result = null;
            if (input.timeline && !input.op) {
              const check = validateTimeline(input.timeline);
              if (!check.valid) return json(response, 400, { error: check.errors[0] });
              timeline = input.timeline;
              result = { ok: true, layerCount: timeline.layers.length, clipCount: timeline.layers.reduce((sum, l) => sum + l.clips.length, 0) };
            } else {
              timeline = await library.getTimeline(trackId);
              const analysis = await library.getAnalysis(trackId).catch(() => null);
              result = applyTimelineOp(timeline, input.op, input.args, analysis);
              const check = validateTimeline(timeline);
              if (!check.valid) return json(response, 400, { error: check.errors[0] });
            }
            await library.saveTimeline(trackId, timeline);
            serverShowCache.delete(trackId);
            broadcastLive('command', { type: 'timeline_op', trackId, op: input.op || 'replace', args: input.args, timeline, label: input.label || input.op || 'Učitavanje showa' });
            return json(response, 200, { ok: true, trackId, result, clientCount: liveClients.size });
          }
          if (input.type === 'blackout' && (input.value === true || input.value === undefined)) {
            if (testRunning) { testAbort = true; stopTest?.(); await testSettled; }
            await disarm('Blackout');
          }
          broadcastLive('command', input);
          return json(response, 200, { ok: true, command: input.type, clientCount: liveClients.size });
        }
        if (pathname === '/api/discover') {
          if (armed) return json(response, 409, { error: 'Ugasite izlaz prije traženja kontrolera.' });
          if (!discoveryPromise) discoveryPromise = discovery({ probe: host => probe(host, { includeBuses: false }), isAllowedHost: host => privateIP(host, allowLoopback) }).finally(() => { discoveryPromise = null; });
          const found = await discoveryPromise;
          const devicesByMac = new Map();
          for (const device of found.devices || []) if (normalizeMac(device.mac) && privateIP(device.host, allowLoopback)) {
            devicesByMac.set(device.mac, [...(devicesByMac.get(device.mac) || []), device]);
          }
          let next = config;
          for (const node of config.nodes) {
            const matches = devicesByMac.get(node.mac) || [];
            if (matches.length === 1 && node.host !== matches[0].host) {
              next = { ...next, nodes: next.nodes.map(item => item.id === node.id ? { ...item, host: matches[0].host } : item) };
            }
          }
          let rebound = false, rebindError = null;
          if (next !== config) try {
            next = validateConfig(next, allowLoopback);
            if (configPath) await writeFile(configPath, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
            updateConfig(next); rebound = true;
          } catch (error) { rebindError = error.message; }
          return json(response, 200, { ...found, config, rebound, rebindError });
        }
        if (pathname === '/api/probe') {
          const node = config.nodes.find(item => item.id === input.nodeId);
          if (!node) return json(response, 404, { error: 'Nepoznat kontroler.' });
          if (!node.host) return json(response, 409, { error: 'Najprije spremite IP adresu kontrolera.' });
          const routes = cachedNodeRoutes.get(node.id) || routesForNode(config, node.id);
          const expectedPixels = routes.reduce((sum, route) => sum + route.pixels, 0);
          const c1Route = config.profile === 'e8-columns' ? routes.find(route => route.bar === 'C1') : null;
          const altExpectedPixels = c1Route ? expectedPixels - c1Route.pixels : expectedPixels;
          try {
            const result = await probe(node.host);
            const expectedBuses = [];
            for (const route of routes) {
              const last = expectedBuses.at(-1);
              if (last && last.port === route.port) last.length += route.pixels;
              else expectedBuses.push({ port: route.port, gpio: route.gpio, start: route.offset, length: route.pixels });
            }
            const busesMatch = !Array.isArray(result.buses) ? null : result.buses.length === expectedBuses.length && expectedBuses.every((expected, index) => {
              const bus = result.buses[index];
              const validLen = bus.length === expected.length || (c1Route && expected.port === c1Route.port && bus.length === expected.length - c1Route.pixels);
              return bus.start === expected.start && validLen && (expected.gpio === null || bus.pin === expected.gpio);
            });
            return json(response, 200, { ...result, nodeId: node.id, expectedPixels, countMatches: result.ledCount === null ? null : (result.ledCount === expectedPixels || result.ledCount === altExpectedPixels),
              identityMatches: node.mac ? result.mac === node.mac : null, busesMatch });
          } catch (error) { return json(response, 200, { reachable: false, nodeId: node.id, expectedPixels, error: error.message }); }
        }
        if (pathname === '/api/config') {
          if (armed || testRunning) return json(response, 409, { error: 'Ugasite izlaz ili dovršite kratki test prije izmjene postavki.' });
          const next = validateConfig(input, allowLoopback);
          if (configPath) await writeFile(configPath, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
          updateConfig(next);
          broadcastLive('command', { type: 'hardware_sync', state: state() });
          return json(response, 200, state());
        }
        if (pathname === '/api/auto-connect') {
          const result = await autoConnect({ allowDiscovery: input.allowDiscovery !== false });
          return json(response, 200, result);
        }
        if (pathname === '/api/arm') {
          if (typeof input.armed !== 'boolean') throw new Error('Očekuje se armed true ili false.');
          if (input.armed && testRunning) return json(response, 409, { error: 'Pričekajte kraj kratkog testa.' });
          if (!input.armed) await disarm('Izlaz ugašen');
          else {
            const activeNodes = config.nodes.filter(node => node.host);
            if (!activeNodes.length) return json(response, 409, { error: `Postavite IP adresu barem jednog kontrolera.` });
            for (const node of activeNodes.filter(item => item.mac)) {
              let actual;
              try { actual = await probe(node.host, { includeBuses: false }); }
              catch { return json(response, 409, { error: `${node.id} nije dostupan. Pokrenite ponovno traženje WLED-a.` }); }
              if (actual.mac !== node.mac) return json(response, 409, { error: `${node.id} na spremljenoj IP adresi više nije isti WLED uređaj. Pokrenite ponovno traženje.` });
              if (probe === probeWled) {
                fetch(`http://${node.host}/json/state`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ on: true, bri: 255, transition: 0, seg: [{ id: 0, col: [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], fx: 0 }] }),
                  signal: AbortSignal.timeout(800)
                }).catch(() => {});
              }
            }
            armed = true;
            reason = activeNodes.length === config.nodes.length ? 'Izlaz uključen' : `Izlaz uključen (${activeNodes.length}/${config.nodes.length} kontrolera)`;
            lastFrame = performance.now();
            lastAcceptedFrame = -Infinity;
          }
          broadcastLive('command', { type: 'hardware_sync', state: state() });
          return json(response, 200, state());
        }
        if (pathname === '/api/blackout') {
          if (testRunning) { testAbort = true; stopTest?.(); await testSettled; }
          await disarm('Blackout');
          broadcastLive('command', { type: 'hardware_sync', state: state() });
          return json(response, 200, state());
        }
        if (pathname === '/api/test-bar') {
          if (armed || testRunning) return json(response, 409, { error: 'Test izlaza je dostupan samo kad je glavni izlaz ugašen.' });
          if (input.confirm !== true) return json(response, 400, { error: 'Potvrdite pokretanje kratkog testa.' });
          const bar = config.bars.find(item => item.id === input.barId);
          if (!bar) return json(response, 404, { error: 'Nepoznat LED bar.' });
          const node = config.nodes.find(item => item.id === bar.node);
          if (!node?.host) return json(response, 409, { error: `Kontroler za ${bar.id} još nije povezan.` });
          if (node.mac) {
            let actual;
            try { actual = await probe(node.host, { includeBuses: false }); }
            catch { return json(response, 409, { error: `${node.id} ne odgovara na spremljenoj IP adresi.` }); }
            if (actual.mac !== node.mac) return json(response, 409, { error: `${node.id} na spremljenoj IP adresi više nije isti WLED uređaj.` });
          }
          const routes = cachedNodeRoutes.get(node.id) || routesForNode(config, node.id);
          const channels = config.transport === 'rgbw' ? 4 : 3;
          const length = routes.reduce((sum, route) => sum + route.pixels * channels, 0);
          const dark = Array(length).fill(0), pulse = [...dark];
          const route = routes.find(item => item.bar === bar.id);
          for (let pixel = route.offset; pixel < route.offset + route.pixels; pixel++) pulse[pixel * channels] = 20;
          let settle;
          testSettled = new Promise(done => { settle = done; });
          testRunning = true; testAbort = false;
          let interrupted = false;
          try {
            await send(node.host, dark);
            if (!testAbort) await send(node.host, pulse);
            if (!testAbort) await new Promise(done => {
              const timer = setTimeout(done, 350);
              stopTest = () => { clearTimeout(timer); done(); };
            });
          } finally {
            interrupted = testAbort;
            try { await send(node.host, dark); }
            finally { testRunning = false; testAbort = false; stopTest = null; settle(); testSettled = null; }
          }
          return json(response, 200, { ok: !interrupted, interrupted, barId: bar.id });
        }
        if (pathname === '/api/frame') {
          if (!armed) return json(response, 409, { error: 'Izlaz je ugašen.' });
          if (input.clientId) {
            touchLanPeer(input.clientId, { name: input.clientName }, request);
            if (stageOwnerId && stageOwnerId !== String(input.clientId) && lanPeers.has(stageOwnerId)) {
              const ownerPeer = lanPeers.get(stageOwnerId);
              return json(response, 200, {
                ok: true,
                skipped: 'not_stage_owner',
                stageOwnerId,
                stageOwnerName: ownerPeer?.name || null
              });
            }
          }
          if (!input.bars || Object.keys(input.bars).length !== 9) throw new Error('Kadar mora sadržavati svih 9 traka.');
          const values = new Map(config.nodes.map(node => [node.id, []]));
          for (const node of config.nodes) {
            const routes = cachedNodeRoutes.get(node.id) || routesForNode(config, node.id);
            const nodeValues = values.get(node.id);
            for (const route of routes) {
              const rawPixels = input.bars[route.bar];
              if (!Array.isArray(rawPixels) || rawPixels.length !== 12) throw new Error(`Kadar trake ${route.bar} mora imati 12 uzoraka.`);
              const pixels = (config.profile === 'e8-columns' && route.bar === 'C1')
                ? Array.from({ length: 12 }, () => [0, 0, 0, 0])
                : rawPixels;
              const groups = mapBarPixels(pixels, route);
              const encoded = config.transport === 'rgbw' ? groups : groups.map(rgbFromRgbw);
              for (let i = 0; i < encoded.length; i++) {
                const px = encoded[i];
                for (let c = 0; c < px.length; c++) nodeValues.push(px[c]);
              }
            }
          }
          const now = performance.now();
          if (now - lastAcceptedFrame < minFrameMs) return json(response, 429, { error: 'Najviše 120 kadrova u sekundi.' });
          lastFrame = now;
          lastAcceptedFrame = now;
          await Promise.all(config.nodes.filter(node => node.host).map(node => send(node.host, values.get(node.id))));
          return json(response, 200, { ok: true, stageOwnerId });
        }
        return json(response, 404, { error: 'Nepoznat API.' });
      }
      if (request.method !== 'GET') return json(response, 405, { error: 'Metoda nije podržana.' });
      if (pathname === '/favicon.ico') {
        response.writeHead(204, { 'Cache-Control': 'public, max-age=86400' });
        return response.end();
      }
      const allowed = new Set(['/', '/index.html', '/classic.html', '/daw.css', '/hardware-settings.css', '/hardware-topology.mjs', '/daw.mjs', '/daw-state.mjs', '/daw-remote.mjs', '/daw-ui.mjs', '/daw-playlist.mjs', '/daw-editor.mjs', '/daw-mixer.mjs', '/daw-stems.mjs', '/daw-live.mjs', '/daw-performance.mjs', '/live-performance-state.mjs', '/live-session-recorder.mjs', '/daw-output.mjs', '/daw-browser.mjs', '/daw-driver.mjs', '/show-bundle.mjs', '/audio-spectrum.mjs', '/audio-sections.mjs', '/gemini-director.mjs', '/ui.mjs', '/engine.mjs', '/timeline.mjs', '/show-engine.mjs', '/timeline-viewport.mjs', '/mapping.mjs', '/led-preview.mjs', '/tooltips.mjs', '/project-ui.mjs', '/style.css', '/studio.css', '/assets/stage-background.png']);
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
    library,
    autoConnect,
    getLanStatus,
    async load() {
      if (!configPath) return;
      try { updateConfig(validateConfig(JSON.parse(await readFile(configPath, 'utf8')), allowLoopback)); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    },
    async close() {
      if (closing) return;
      closing = true;
      clearInterval(timer);
      for (const client of liveClients) {
        try { client.end(); } catch {}
      }
      liveClients.clear();
      lanPeers.clear();
      if (testRunning) { testAbort = true; stopTest?.(); await testSettled; }
      await disarm('Poslužitelj ugašen').catch(() => {});
      await new Promise(done => server.close(done));
      try { udp.close(); } catch (error) { if (error.code !== 'ERR_SOCKET_DGRAM_NOT_RUNNING') throw error; }
    }
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.on('uncaughtException', err => console.error('Uncaught exception:', err));
  process.on('unhandledRejection', err => console.error('Unhandled rejection:', err));
  const listenPort = Number(process.env.PORT) || 8787;
  const listenHost = process.env.HOST || (process.argv.includes('--local-only') ? '127.0.0.1' : '0.0.0.0');
  const app = createLightingServer();
  await app.load();
  app.server.listen(listenPort, listenHost, () => {
    const url = `http://127.0.0.1:${listenPort}`;
    const lanInfo = getLanAddresses(listenPort);
    const lanHint = lanInfo.lanUrls.length ? ` | LAN: ${lanInfo.lanUrls.join(', ')}` : '';
    console.log(`LEDicated Studio: ${url}${lanHint} (auto-connect na EO8+…)`);
    app.autoConnect().then(res => {
      if (res?.connected) console.log(`EO8+ automatski povezan (${res.host || 'E8-1'}) · izlaz uključen.`);
    }).catch(() => {});
    if (process.argv.includes('--open') && process.platform === 'darwin') execFile('open', [url], error => { if (error) console.error('Otvorite adresu ručno:', url); });
  });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => app.close().then(() => process.exit(0)));
}
