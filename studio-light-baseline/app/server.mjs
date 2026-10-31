import http from 'node:http';
import dgram from 'node:dgram';
import { randomUUID } from 'node:crypto';
import { appendFileSync, createReadStream, existsSync, mkdirSync, readFileSync, watch as fsWatch } from 'node:fs';
import { appendFile, mkdir, mkdtemp, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { hostname as osHostname, networkInterfaces, tmpdir } from 'node:os';
import { basename, dirname, resolve, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile, spawn } from 'node:child_process';
import { createLibrary } from './library.mjs';
import { analyzeAudio } from './audio-analysis.mjs';
import { createAutoShow, validateTimeline, renderTimelineFrame, SHOW_THEMES, PALETTES } from './timeline.mjs';
import { normalizeTimeline, sanitizeTimelineClips } from './daw-state.mjs';
import { createDirectedShow } from './gemini-director.mjs';
import { mapBarPixels } from './mapping.mjs';
import { BAR_IDS, HARDWARE_PROFILES, hardwareProfile, routesForNode } from './hardware-topology.mjs';
import { PIXELS_PER_BAR } from './engine.mjs';
import { discoverWled, normalizeMac } from './wled-discovery.mjs';
import { applyTimelineOp } from './daw-remote.mjs';
import { createPerformance, DEFAULT_PADS, PAD_KEYS } from './live-performance-state.mjs';
import { createLanCoordinator, DEFAULT_LAN_BUS_PORT } from './lan-coordinator.mjs';
import { createCloudSync, computeShowId } from './cloud-sync.mjs';
import {
  sanitizeFilename,
  encodeShowJson,
  decodeShowJson,
  encodeLedPack,
  decodeLedPack,
  detectBundleKind
} from './show-bundle.mjs';
import {
  BUILT_IN_GENERATORS,
  serializeGeneratorSpec,
  validateGeneratorSpec
} from './show-generators.mjs';

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

async function fetchYouTubeOembedMeta(videoId, targetUrl) {
  const watchUrl = videoId
    ? `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`
    : (typeof targetUrl === 'string' && targetUrl.includes('youtube.com/') ? targetUrl : '');
  if (!watchUrl) return null;
  try {
    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(watchUrl)}&format=json`;
    const res = await fetch(oembedUrl, { signal: AbortSignal.timeout(2500) });
    if (!res.ok) return null;
    const data = await res.json();
    const cleanTitle = typeof data?.title === 'string' ? data.title.trim() : '';
    const cleanAuthor = typeof data?.author_name === 'string' ? data.author_name.trim() : '';
    return cleanTitle ? { title: cleanTitle, author: cleanAuthor } : null;
  } catch {
    return null;
  }
}

async function readYtDlpInfoMeta(tempDir, jobId) {
  try {
    const files = await readdir(tempDir);
    const infoFile = files.find(f => f === `${jobId}.info.json`) || files.find(f => f.endsWith('.info.json'));
    if (!infoFile) return null;
    const raw = await readFile(join(tempDir, infoFile), 'utf8');
    const info = JSON.parse(raw);
    const cleanTitle = typeof info?.title === 'string' ? info.title.trim() : '';
    const cleanAuthor = typeof info?.uploader === 'string' ? info.uploader.trim() : (typeof info?.channel === 'string' ? info.channel.trim() : '');
    return cleanTitle ? { title: cleanTitle, author: cleanAuthor } : null;
  } catch {
    return null;
  }
}

function extractYouTubeVideoId(text) {
  if (typeof text !== 'string' || !text) return null;
  const m = /(?:youtube\.com\/watch\?(?:[^&\s]*&)*v=|youtu\.be\/|youtube\.com\/shorts\/)([A-Za-z0-9_-]{11})/.exec(text);
  return m ? m[1] : null;
}

function runExecFile(bin, args, timeoutMs = 6000) {
  return new Promise((res, rej) => {
    execFile(bin, args, {
      timeout: timeoutMs,
      maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env, PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH || ''}` }
    }, (err, stdout, stderr) => {
      if (err) return rej(err);
      res({ stdout, stderr });
    });
  });
}

const artworkInFlight = new Map();

async function resolveTrackArtwork(track, library, fetcher = fetch) {
  if (!track?.id || typeof library.getArtworkPath !== 'function') return null;
  const artworkPath = await library.getArtworkPath(track.id);
  const existing = await stat(artworkPath).catch(() => null);
  if (existing && existing.size > 200) return artworkPath;

  if (artworkInFlight.has(track.sha256)) {
    return artworkInFlight.get(track.sha256);
  }

  const job = (async () => {
    const audioPath = await library.getAudioPath(track.id).catch(() => null);
    const ffmpegBin = existsSync('/opt/homebrew/bin/ffmpeg') ? '/opt/homebrew/bin/ffmpeg' : 'ffmpeg';
    const ffprobeBin = existsSync('/opt/homebrew/bin/ffprobe') ? '/opt/homebrew/bin/ffprobe' : 'ffprobe';

    // 1. Try extracting embedded cover art from the local audio file via ffmpeg
    if (audioPath) {
      const tempJpg = `${artworkPath}.${randomUUID()}.tmp.jpg`;
      try {
        await runExecFile(ffmpegBin, [
          '-y', '-v', 'error', '-i', audioPath,
          '-an', '-vcodec', 'mjpeg',
          '-vf', "scale='min(640,iw)':-2",
          '-q:v', '3', '-vframes', '1',
          tempJpg
        ], 5000);
        const st = await stat(tempJpg).catch(() => null);
        if (st && st.size > 200) {
          await rename(tempJpg, artworkPath);
          return artworkPath;
        }
      } catch {} finally {
        await rm(tempJpg, { force: true }).catch(() => {});
      }
    }

    // 2. Determine YouTube videoId (from track metadata or embedded ffprobe tags)
    let videoId = track.videoId || extractYouTubeVideoId(track.sourceUrl);
    if (!videoId && audioPath) {
      try {
        const { stdout } = await runExecFile(ffprobeBin, [
          '-v', 'quiet', '-print_format', 'json', '-show_format', audioPath
        ], 4000);
        const info = JSON.parse(stdout);
        const tags = info?.format?.tags || {};
        for (const val of Object.values(tags)) {
          const found = extractYouTubeVideoId(String(val));
          if (found) {
            videoId = found;
            const sourceUrl = `https://www.youtube.com/watch?v=${found}`;
            await library.updateTrack(track.id, { videoId: found, sourceUrl }).catch(() => {});
            break;
          }
        }
      } catch {}
    }

    // 3. Fetch YouTube thumbnail if videoId is available
    if (videoId && typeof fetcher === 'function') {
      const thumbUrls = [
        `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg`,
        `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/mqdefault.jpg`
      ];
      for (const url of thumbUrls) {
        try {
          const res = await fetcher(url, { signal: AbortSignal.timeout(4000) });
          if (res.ok) {
            const buf = Buffer.from(await res.arrayBuffer());
            if (buf.byteLength > 200) {
              const tempJpg = `${artworkPath}.${randomUUID()}.tmp.jpg`;
              await writeFile(tempJpg, buf, { mode: 0o600 });
              await rename(tempJpg, artworkPath);
              return artworkPath;
            }
          }
        } catch {}
      }
    }

    // 4. Fallback: search iTunes cover art by cleaned track title
    const rawTitle = (track.title || track.originalName || '').replace(/\.(mp3|wav|m4a|flac|ogg)$/i, '').replace(/\([^)]*\)|\[[^\]]*\]/g, ' ').trim();
    if (rawTitle.length >= 3 && typeof fetcher === 'function') {
      try {
        const searchUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(rawTitle)}&media=music&entity=song&limit=1`;
        const res = await fetcher(searchUrl, { signal: AbortSignal.timeout(3500) });
        if (res.ok) {
          const data = await res.json();
          const art100 = data?.results?.[0]?.artworkUrl100;
          if (typeof art100 === 'string' && art100.startsWith('https://')) {
            const art600 = art100.replace(/100x100bb\.jpg$/i, '600x600bb.jpg');
            const imgRes = await fetcher(art600, { signal: AbortSignal.timeout(4000) });
            if (imgRes.ok) {
              const buf = Buffer.from(await imgRes.arrayBuffer());
              if (buf.byteLength > 200) {
                const tempJpg = `${artworkPath}.${randomUUID()}.tmp.jpg`;
                await writeFile(tempJpg, buf, { mode: 0o600 });
                await rename(tempJpg, artworkPath);
                return artworkPath;
              }
            }
          }
        }
      } catch {}
    }

    return null;
  })();

  artworkInFlight.set(track.sha256, job);
  try {
    return await job;
  } finally {
    artworkInFlight.delete(track.sha256);
  }
}

function downloadWithYtDlp(url, tempDir, jobId, onProgress) {
  const bin = existsSync('/opt/homebrew/bin/yt-dlp') ? '/opt/homebrew/bin/yt-dlp' : 'yt-dlp';
  const outTemplate = join(tempDir, `${jobId}.%(ext)s`);
  const args = ['-x', '--audio-format', 'mp3', '--audio-quality', '192K', '--no-playlist', '--write-info-json', '--js-runtimes', 'node', '--newline', '-o', outTemplate, url];
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
export const LOG_DIR = resolve(ROOT, '../../logs');
export const LOG_FILE_PATH = join(LOG_DIR, 'ledicated.log');
const MAX_LOG_BYTES = 10 * 1024 * 1024;
const readyLogDirs = new Set();

async function writeDiskLogLine(line, targetPath = LOG_FILE_PATH) {
  try {
    const dir = dirname(targetPath);
    if (!readyLogDirs.has(dir)) {
      await mkdir(dir, { recursive: true, mode: 0o755 });
      readyLogDirs.add(dir);
    }
    try {
      const st = await stat(targetPath);
      if (st.size > MAX_LOG_BYTES) {
        await rename(targetPath, `${targetPath}.1`).catch(() => {});
      }
    } catch {}
    await appendFile(targetPath, `${line}\n`, 'utf8');
  } catch {}
}

export function writeDiskLogLineSync(line, targetPath = LOG_FILE_PATH) {
  try {
    const dir = dirname(targetPath);
    if (!readyLogDirs.has(dir)) {
      mkdirSync(dir, { recursive: true, mode: 0o755 });
      readyLogDirs.add(dir);
    }
    appendFileSync(targetPath, `${line}\n`, 'utf8');
  } catch {}
}

class PayloadTooLargeError extends Error {
  constructor(msg = 'Zahtjev je prevelik.') {
    super(msg);
    this.statusCode = 413;
  }
}

async function readJsonBody(request, maxBytes) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > maxBytes) throw new PayloadTooLargeError('Zahtjev je prevelik.');
    chunks.push(buf);
  }
  const raw = chunks.length ? Buffer.concat(chunks, total).toString('utf8') : '';
  return { raw, bytes: total, data: JSON.parse(raw || '{}') };
}

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
  if (/^169\.254\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
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

/** Parse WLED's compact 294-byte `/win` XML response. */
export function parseWledWinXml(xml) {
  if (typeof xml !== 'string' || !xml.includes('<vs>')) return null;
  const tag = name => {
    const m = new RegExp(`<${name}>([^<]*)</${name}>`).exec(xml);
    return m ? m[1].trim() : null;
  };
  const acStr = tag('ac');
  if (acStr === null) return null;
  const ac = Number(acStr);
  if (!Number.isFinite(ac)) return null;
  const clMatches = [...xml.matchAll(/<cl>(\d+)<\/cl>/g)].map(m => Number(m[1]) || 0);
  const wv = Number(tag('wv')) || 0;
  const rawDs = tag('ds') || 'E8-WiFi Plus';
  const isLive = rawDs.endsWith(' (live)');
  const deviceName = isLive ? rawDs.slice(0, -7) : rawDs;
  return {
    on: ac > 0,
    bri: Math.max(0, Math.min(255, ac)),
    col: [clMatches[0] || 0, clMatches[1] || 0, clMatches[2] || 0, wv],
    deviceName: deviceName || 'E8-WiFi Plus',
    isLive
  };
}

/** Read-only status query. This does not prove that a physical strip is connected. */
export async function probeWled(host, { fetcher = fetch, timeoutMs = 1500, includeBuses = true } = {}) {
  const started = performance.now();
  let response;
  try {
    response = await fetcher(`http://${host}/json/info`, { signal: AbortSignal.timeout(timeoutMs), redirect: 'error' });
  } catch (err) {
    if (fetcher === fetch) {
      const winRes = await fetcher(`http://${host}/win`, { signal: AbortSignal.timeout(timeoutMs), redirect: 'error' });
      if (winRes.ok) {
        const xml = await winRes.text();
        const win = parseWledWinXml(xml);
        if (win) {
          return {
            reachable: true,
            name: win.deviceName.slice(0, 64),
            version: 'WLED',
            arch: 'esp32',
            ledCount: null,
            rgbw: true,
            signal: null,
            fps: null,
            live: win.isLive,
            mac: null,
            buses: null,
            responseMs: Math.round(performance.now() - started)
          };
        }
      }
    }
    throw err;
  }
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

export function rgbwForKelvin(kelvin = 4000) {
  const minK = 2700;
  const maxK = 6500;
  const clamped = Math.max(minK, Math.min(maxK, Number(kelvin) || 4000));
  const t = (clamped - minK) / (maxK - minK);
  let r, g, b, w;
  if (t <= 0.22) {
    const p = t / 0.22;
    r = 255;
    g = 115 + 65 * p;
    b = 18 + 72 * p;
    w = 255;
  } else if (t <= 0.56) {
    const p = (t - 0.22) / 0.34;
    r = 255;
    g = 180 + 75 * p;
    b = 90 + 165 * p;
    w = 255;
  } else {
    const p = (t - 0.56) / 0.44;
    r = 255 - 45 * p;
    g = 255 - 12 * p;
    b = 255;
    w = 255 - 80 * p;
  }
  return [
    Math.max(0, Math.min(255, Math.round(r))),
    Math.max(0, Math.min(255, Math.round(g))),
    Math.max(0, Math.min(255, Math.round(b))),
    Math.max(0, Math.min(255, Math.round(w)))
  ];
}

export function kelvinFromRgbw(col, fallback = 4000) {
  if (!Array.isArray(col) || col.length < 4) return fallback;
  const [r, g, b, w] = col.map(v => Number(v) || 0);
  if (r === 0 && g === 0 && b === 0 && w === 0) return fallback;
  const expected = rgbwForKelvin(fallback);
  if (
    Math.abs(expected[0] - r) <= 6 &&
    Math.abs(expected[1] - g) <= 6 &&
    Math.abs(expected[2] - b) <= 6 &&
    Math.abs(expected[3] - w) <= 6
  ) {
    return fallback;
  }
  const minK = 2700, maxK = 6500;
  if (w < 250 && b >= 245) {
    const p = Math.min(1, Math.max(0, (255 - w) / 80));
    const t = 0.56 + p * 0.44;
    return Math.round((minK + t * (maxK - minK)) / 50) * 50;
  }
  if (b < 90) {
    const p = Math.min(1, Math.max(0, (b - 18) / 72));
    const t = p * 0.22;
    return Math.round((minK + t * (maxK - minK)) / 50) * 50;
  }
  const p = Math.min(1, Math.max(0, (b - 90) / 165));
  const t = 0.22 + p * 0.34;
  return Math.round((minK + t * (maxK - minK)) / 50) * 50;
}

export function computeAmbientWatts({ isOn = false, wledPwrMa = null, isLive = false, bri = 255, col = null } = {}) {
  if (!isOn) return 3.2;
  const baseWatts = 5.5;
  if (Number.isFinite(wledPwrMa) && wledPwrMa > 150) {
    const ratio = Math.max(0, Math.min(1, (wledPwrMa - 150) / 5910));
    return Math.round((baseWatts + ratio * 171) * 10) / 10;
  }
  if (!isLive && Array.isArray(col) && col.length >= 4) {
    const sum = (Number(col[0]) || 0) + (Number(col[1]) || 0) + (Number(col[2]) || 0) + (Number(col[3]) || 0);
    const scale = Math.max(0, Math.min(255, Number(bri) || 0)) / 255;
    const ratio = (sum / 1020) * scale;
    return Math.round((baseWatts + ratio * 171) * 10) / 10;
  }
  return baseWatts;
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

export function createLightingServer({ configPath = resolve(ROOT, 'config.json'), libraryRoot = resolve(ROOT, 'data'), library: customLibrary = null, sharedShowsDir: customSharedShowsDir, generatorsDir = resolve(ROOT, 'generators'), cloudEnabled, initialConfig, allowLoopback = false, udpPort = 4048, watchdogMs = 3500, minFrameMs = 8, stageIdleMs = 20000, lanBusPort = 0, lanMulticastAddr, lanBroadcastAddrs, lanHeartbeatMs = 1500, lanPeerTtlMs = 6000, resolveHost = host => host, probe = probeWled, discovery = discoverWled, maxAudioBytes, ytDownloader = downloadWithYtDlp, peerFetcher = fetch, logFilePath = LOG_FILE_PATH, enableDiskLog: customEnableDiskLog } = {}) {
  const isDefaultDataRoot = libraryRoot === resolve(ROOT, 'data') && !customLibrary && !customSharedShowsDir && !allowLoopback;
  const sharedShowsDir = customSharedShowsDir || (isDefaultDataRoot ? resolve(ROOT, 'shared-shows') : join(libraryRoot, 'shared-shows'));
  const cloudDataDir = isDefaultDataRoot ? libraryRoot : (libraryRoot !== resolve(ROOT, 'data') ? libraryRoot : dirname(sharedShowsDir));
  const effectiveCloudEnabled = cloudEnabled !== undefined ? Boolean(cloudEnabled) : isDefaultDataRoot;
  let config = validateConfig(initialConfig ?? defaultConfig(), allowLoopback);
  let cachedNodeRoutes = new Map(config.nodes.map(node => [node.id, routesForNode(config, node.id)]));
  const updateConfig = next => {
    config = next;
    cachedNodeRoutes = new Map(config.nodes.map(node => [node.id, routesForNode(config, node.id)]));
  };
  const library = customLibrary || createLibrary({ root: libraryRoot, ...(maxAudioBytes ? { maxAudioBytes } : {}) });
  let analysisQueue = Promise.resolve();
  let armed = false;
  let outputMode = 'show'; // 'show' (live DDP from DAW / YouTube) | 'ambient' (static Menu Bar light)
  let reason = 'Pregled bez izlaza';
  let wledShowCarrierAwake = false;
  const ambientStatePath = configPath ? join(dirname(configPath), 'ambient-light.json') : null;
  let ambientLight = {
    on: false,
    brightness: 15,
    kelvin: 4700,
    watts: 3.2,
    connected: false,
    isLive: false,
    updatedAt: 0
  };
  if (ambientStatePath && existsSync(ambientStatePath)) {
    try {
      const saved = JSON.parse(readFileSync(ambientStatePath, 'utf8'));
      if (saved && typeof saved === 'object') {
        if (typeof saved.on === 'boolean') ambientLight.on = saved.on;
        if (Number.isFinite(Number(saved.brightness))) {
          ambientLight.brightness = Math.max(1, Math.min(100, Math.round(Number(saved.brightness))));
        }
        if (Number.isFinite(Number(saved.kelvin))) {
          ambientLight.kelvin = Math.max(2700, Math.min(6500, Math.round(Number(saved.kelvin) / 50) * 50));
        }
        if (Number.isFinite(Number(saved.updatedAt))) {
          ambientLight.updatedAt = Number(saved.updatedAt);
        }
        const rgbw = rgbwForKelvin(ambientLight.kelvin);
        const briByte = Math.max(1, Math.min(255, Math.round((ambientLight.brightness / 100) * 255)));
        ambientLight.watts = computeAmbientWatts({ isOn: ambientLight.on, wledPwrMa: null, isLive: false, bri: briByte, col: rgbw });
      }
    } catch {}
  }
  const persistAmbientLight = () => {
    if (!ambientStatePath) return;
    const payload = {
      on: Boolean(ambientLight.on),
      brightness: ambientLight.brightness,
      kelvin: ambientLight.kelvin,
      updatedAt: ambientLight.updatedAt || Date.now()
    };
    writeFile(ambientStatePath, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 }).catch(() => {});
  };
  const syncSavedAmbientFields = (input = {}) => {
    if (!input || typeof input !== 'object') return false;
    let changed = false;
    if (typeof input.on === 'boolean' && input.on !== ambientLight.on) {
      ambientLight.on = input.on;
      changed = true;
    }
    if (Number.isFinite(Number(input.brightness))) {
      const nextBri = Math.max(1, Math.min(100, Math.round(Number(input.brightness))));
      if (nextBri !== ambientLight.brightness) {
        ambientLight.brightness = nextBri;
        changed = true;
      }
    } else if (Number.isFinite(Number(input.bri))) {
      const nextBri = Math.max(1, Math.min(100, Math.round((Number(input.bri) / 255) * 100)));
      if (nextBri !== ambientLight.brightness) {
        ambientLight.brightness = nextBri;
        changed = true;
      }
    }
    if (Number.isFinite(Number(input.kelvin))) {
      const nextKelvin = Math.max(2700, Math.min(6500, Math.round(Number(input.kelvin) / 50) * 50));
      if (nextKelvin !== ambientLight.kelvin) {
        ambientLight.kelvin = nextKelvin;
        changed = true;
      }
    }
    if (changed) {
      const rgbw = rgbwForKelvin(ambientLight.kelvin);
      const briByte = Math.max(1, Math.min(255, Math.round((ambientLight.brightness / 100) * 255)));
      ambientLight.watts = computeAmbientWatts({ isOn: ambientLight.on, wledPwrMa: null, isLive: false, bri: briByte, col: rgbw });
      ambientLight.updatedAt = Date.now();
      persistAmbientLight();
    }
    return changed;
  };
  let lastFrame = 0;
  let lastClientFrame = -Infinity;
  let lastAcceptedFrame = -Infinity;
  let framesSentSinceArm = 0;
  let sequence = 0;
  let closing = false;
  let discoveryPromise = null;
  let testRunning = false;
  let testAbort = false, stopTest = null, testSettled = null;
  const liveClients = new Set();
  const lanPeers = new Map();
  let stageOwnerId = null;
  let remoteStageOwner = null;
  let claimEpoch = 0;
  let stageLastActiveAt = 0;
  let yieldedToRemote = false;
  let latestLiveState = null;
  const serverPerformDesk = createPerformance(DEFAULT_PADS);
  let hadServerPadsActive = false;
  const recentLogs = [];
  const enableDiskLog = customEnableDiskLog !== undefined ? Boolean(customEnableDiskLog) : Boolean((configPath && !allowLoopback) || logFilePath !== LOG_FILE_PATH);

  const getServerPerfContext = () => {
    const nowMs = Date.now();
    const isPlaying = Boolean(latestLiveState?.isPlaying && (nowMs - (latestLiveState.timestamp || 0) < 15000));
    const elapsedSec = isPlaying ? Math.max(0, (nowMs - (latestLiveState.timestamp || nowMs)) / 1000) : 0;
    const songTime = Math.max(0, (Number(latestLiveState?.timeSec) || 0) + elapsedSec);
    return {
      songTime,
      clockTime: performance.now() / 1000,
      playing: isPlaying,
      bpm: Number(latestLiveState?.bpm) || 120,
      beatOffsetSec: Number(latestLiveState?.beatOffsetSec) || 0,
      beatTimes: null
    };
  };

  const padCustomMeta = Array.from({ length: 12 }, (_, idx) => ({
    key: PAD_KEYS[idx].toUpperCase(),
    name: null
  }));

  const syncServerPadSlot = (idx, raw) => {
    if (idx < 0 || idx >= 12) return;
    if (!raw || typeof raw !== 'object') {
      serverPerformDesk.removePad(idx);
      padCustomMeta[idx].name = null;
      return;
    }
    const patch = { ...raw };
    if (Array.isArray(patch.bars)) {
      patch.targets = patch.bars.length === 9 ? 'all' : patch.bars;
    }
    if (Array.isArray(patch.color) && patch.color.length === 3) {
      patch.color = [patch.color[0], patch.color[1], patch.color[2], Number(patch.white ?? 0)];
    }
    if (typeof patch.name === 'string' && patch.name.trim()) {
      padCustomMeta[idx].name = patch.name.trim();
    }
    serverPerformDesk.setPad(idx, patch);
  };

  const getPadsSnapshot = () => {
    serverPerformDesk.tick(getServerPerfContext());
    const freshDaw = latestLiveState && (Date.now() - (latestLiveState.timestamp || 0) < 4000);
    const activeSet = new Set([
      ...serverPerformDesk.active.keys(),
      ...(freshDaw && Array.isArray(latestLiveState.activePads) ? latestLiveState.activePads : [])
    ]);
    const pendingSet = new Set([
      ...serverPerformDesk.pending.keys(),
      ...(freshDaw && Array.isArray(latestLiveState.pendingPads) ? latestLiveState.pendingPads : [])
    ]);
    const heldSet = new Set([
      ...serverPerformDesk.held.keys(),
      ...(freshDaw && Array.isArray(latestLiveState.heldPads) ? latestLiveState.heldPads : [])
    ]);
    return {
      pads: serverPerformDesk.pads.map((p, idx) => {
        if (!p) return null;
        return {
          ...p,
          key: PAD_KEYS[idx].toUpperCase(),
          name: padCustomMeta[idx]?.name || p.name || `${p.preset.toUpperCase()} ${PAD_KEYS[idx].toUpperCase()}`,
          bars: p.targets === 'all' ? [...BAR_IDS] : (Array.isArray(p.targets) ? [...p.targets] : [...BAR_IDS])
        };
      }),
      activePads: [...activeSet],
      pendingPads: [...pendingSet],
      heldPads: [...heldSet],
      quantize: serverPerformDesk.quantize,
      color: serverPerformDesk.color,
      intensity: serverPerformDesk.intensity
    };
  };

  const applyServerPadCommand = cmd => {
    const ctx = getServerPerfContext();
    serverPerformDesk.tick(ctx);
    if (cmd.action === 'clear' || cmd.action === 'stop_all') {
      serverPerformDesk.clear();
      return 'cleared';
    }
    if (cmd.action === 'release_all') {
      serverPerformDesk.releaseAll();
      return 'released_all';
    }
    if (cmd.action === 'touch_down') {
      return serverPerformDesk.touchDown(cmd.touchId ?? 'default', {
        x: Number(cmd.x),
        y: Number(cmd.y),
        clockTime: ctx.clockTime,
        color: Array.isArray(cmd.color) ? cmd.color : null,
        intensity: Number.isFinite(Number(cmd.intensity)) ? Number(cmd.intensity) : null,
        spread: Number.isFinite(Number(cmd.spread)) ? Number(cmd.spread) : null,
        velocityGain: Number.isFinite(Number(cmd.velocityGain)) ? Number(cmd.velocityGain) : null,
        effect: typeof cmd.effect === 'string' ? cmd.effect : null,
        lockedCols: Array.isArray(cmd.lockedCols) ? cmd.lockedCols : null,
        lockedRows: Array.isArray(cmd.lockedRows) ? cmd.lockedRows : null
      });
    }
    if (cmd.action === 'touch_move') {
      return serverPerformDesk.touchMove(cmd.touchId ?? 'default', {
        x: Number(cmd.x),
        y: Number(cmd.y),
        velocityGain: Number.isFinite(Number(cmd.velocityGain)) ? Number(cmd.velocityGain) : undefined,
        dragDown: Number.isFinite(Number(cmd.dragDown)) ? Number(cmd.dragDown) : undefined,
        clockTime: ctx.clockTime
      });
    }
    if (cmd.action === 'touch_up') {
      return serverPerformDesk.touchUp(cmd.touchId ?? 'default', {
        clockTime: ctx.clockTime,
        cancel: Boolean(cmd.cancel)
      });
    }
    if (cmd.action === 'set_color' && Array.isArray(cmd.color)) {
      serverPerformDesk.setColor(cmd.color);
      return 'color_updated';
    }
    if (cmd.action === 'set_intensity' && Number.isFinite(Number(cmd.intensity))) {
      serverPerformDesk.setIntensity(Number(cmd.intensity));
      return 'intensity_updated';
    }
    if (cmd.action === 'set_spread' && Number.isFinite(Number(cmd.spread))) {
      serverPerformDesk.setSpread(Number(cmd.spread));
      return 'spread_updated';
    }
    if (cmd.action === 'set_locks') {
      serverPerformDesk.setLocks({
        lockedCols: Array.isArray(cmd.lockedCols) ? cmd.lockedCols : undefined,
        lockedRows: Array.isArray(cmd.lockedRows) ? cmd.lockedRows : undefined
      });
      return 'locks_updated';
    }
    if (cmd.action === 'set_effect' && typeof cmd.effect === 'string') {
      serverPerformDesk.setEffect(cmd.effect);
      return 'effect_updated';
    }
    if (cmd.action === 'quantize') {
      const nextQ = cmd.value !== undefined ? Boolean(cmd.value) : !serverPerformDesk.quantize;
      serverPerformDesk.setQuantize(nextQ);
      return nextQ ? 'quantize_on' : 'quantize_off';
    }
    if (cmd.action === 'move' && Number.isInteger(cmd.from) && Number.isInteger(cmd.to)) {
      return serverPerformDesk.movePad(cmd.from, cmd.to) ? 'moved' : 'invalid';
    }
    let idx = -1;
    if (Number.isInteger(cmd.index)) idx = cmd.index;
    else if (typeof cmd.pad === 'number') idx = cmd.pad;
    else if (typeof cmd.pad === 'string') {
      const lower = cmd.pad.toLowerCase();
      idx = PAD_KEYS.indexOf(lower);
      if (idx < 0 && !isNaN(Number(cmd.pad))) idx = Number(cmd.pad);
    } else if (typeof cmd.key === 'string') {
      idx = PAD_KEYS.indexOf(cmd.key.toLowerCase());
    }
    if (idx < 0 || idx >= 12) return 'invalid';
    if (cmd.action === 'press') return serverPerformDesk.press(idx, ctx);
    if (cmd.action === 'release') return serverPerformDesk.release(idx, { clockTime: ctx.clockTime, cancel: Boolean(cmd.cancel) });
    if (cmd.action === 'trigger' || cmd.action === 'hit' || !cmd.action) return serverPerformDesk.trigger(idx, ctx);
    if (cmd.action === 'loop') {
      if (serverPerformDesk.pads[idx] && serverPerformDesk.pads[idx].mode !== 'loop') {
        serverPerformDesk.setPad(idx, { mode: 'loop' });
      }
      return serverPerformDesk.trigger(idx, ctx);
    }
    const patchObj = cmd.effect || cmd.patch || (cmd.pad && typeof cmd.pad === 'object' ? cmd.pad : null);
    if (cmd.action === 'set' && patchObj) {
      syncServerPadSlot(idx, patchObj);
      return 'updated';
    }
    if (cmd.action === 'remove') {
      padCustomMeta[idx].name = null;
      return serverPerformDesk.removePad(idx) ? 'removed' : 'invalid';
    }
    return 'ignored';
  };

  const logEvent = (category, action, details = {}) => {
    const nowIso = new Date().toISOString();
    const entry = { ts: nowIso, category, action, ...details };
    recentLogs.push(entry);
    if (recentLogs.length > 500) recentLogs.shift();
    if (enableDiskLog) {
      const detailStr = Object.keys(details).length ? ` ${JSON.stringify(details)}` : '';
      writeDiskLogLine(`${nowIso} [${category}] ${action}${detailStr}`, logFilePath);
    }
  };

  const broadcastLive = (event, data, { excludeClientId = null } = {}) => {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of liveClients) {
      if (excludeClientId && client.clientId && client.clientId === excludeClientId) continue;
      try { client.write(payload); } catch { liveClients.delete(client); }
    }
  };
  const cloudSync = createCloudSync({
    sharedShowsDir,
    dataDir: cloudDataDir,
    library,
    enabled: effectiveCloudEnabled,
    onRemoteUpdate: ({ changedShows }) => {
      sharedShowsIndexCache = null;
      broadcastLive('command', {
        type: 'cloud_updated',
        shows: changedShows
      });
    }
  });
  cloudSync.init().catch(() => {});
  const cleanPeerIp = req => {
    const raw = String(req?.socket?.remoteAddress || '127.0.0.1');
    return raw.startsWith('::ffff:') ? raw.slice(7) : raw;
  };

  let lanCoordinator = null;

  const computeStageState = (nowMs = Date.now()) => {
    if (remoteStageOwner) {
      return remoteStageOwner.isPlaying ? 'on_air' : (remoteStageOwner.stageState || 'grace');
    }
    if (!stageOwnerId || !lanPeers.has(stageOwnerId)) {
      return 'idle';
    }
    const owner = lanPeers.get(stageOwnerId);
    if (owner.isPlaying || owner.hasActivePads) {
      return 'on_air';
    }
    if (stageIdleMs > 0 && nowMs - stageLastActiveAt >= stageIdleMs) {
      return 'idle';
    }
    return 'grace';
  };

  const getGraceRemainingSec = (nowMs = Date.now()) => {
    if (remoteStageOwner) {
      return Number(remoteStageOwner.graceRemainingSec || 0);
    }
    if (!stageOwnerId || !lanPeers.has(stageOwnerId)) return 0;
    const owner = lanPeers.get(stageOwnerId);
    if (owner.isPlaying || owner.hasActivePads) return Math.ceil(stageIdleMs / 1000);
    const remainingMs = Math.max(0, stageIdleMs - (nowMs - stageLastActiveAt));
    return Math.ceil(remainingMs / 1000);
  };

  const pruneLanPeers = () => {
    const nowMs = Date.now();
    let stageChanged = false;
    for (const [cid, peer] of lanPeers.entries()) {
      const hasSse = peer.sseRes && !peer.sseRes.writableEnded && !peer.sseRes.destroyed;
      if (peer.source === 'youtube' && nowMs - peer.lastSeenAt > 6000 && peer.isPlaying) {
        peer.isPlaying = false;
      }
      if (!hasSse && nowMs - peer.lastSeenAt > 12000) {
        lanPeers.delete(cid);
        if (stageOwnerId === cid) {
          stageOwnerId = null;
          stageChanged = true;
        }
      }
    }

    if (remoteStageOwner && lanCoordinator) {
      const remoteSrv = lanCoordinator.getRemoteServers().find(s => s.serverId === remoteStageOwner.serverId);
      if (!remoteSrv || !remoteSrv.stageOwner || remoteSrv.stageState === 'idle') {
        remoteStageOwner = null;
        stageChanged = true;
      } else {
        remoteStageOwner = {
          ...remoteSrv.stageOwner,
          serverId: remoteSrv.serverId,
          httpUrl: remoteSrv.lanUrls?.[0] || remoteStageOwner.httpUrl || null,
          stageState: remoteSrv.stageState || (remoteSrv.stageOwner.isPlaying ? 'on_air' : 'grace')
        };
      }
    }

    if (stageOwnerId) {
      if (!lanPeers.has(stageOwnerId)) {
        stageOwnerId = null;
        stageChanged = true;
      } else {
        const owner = lanPeers.get(stageOwnerId);
        if (owner.isPlaying || owner.hasActivePads) {
          stageLastActiveAt = nowMs;
        } else if (stageIdleMs > 0 && nowMs - stageLastActiveAt >= stageIdleMs) {
          const expiredId = stageOwnerId;
          stageOwnerId = null;
          claimEpoch = Math.max(nowMs, claimEpoch + 1);
          stageChanged = true;
          lanCoordinator?.broadcastRelease?.({ claimEpoch, clientId: expiredId });
        }
      }
    }
    return stageChanged;
  };

  const rearmAfterYield = () => {
    if (!yieldedToRemote || armed || liveControl.state.blackout || testRunning || outputMode === 'ambient') return;
    const activeNodes = config.nodes.filter(n => n.host);
    if (activeNodes.length) {
      yieldedToRemote = false;
      armed = true;
      framesSentSinceArm = 0;
      reason = activeNodes.length === config.nodes.length ? 'Izlaz uključen' : `Izlaz uključen (${activeNodes.length}/${config.nodes.length} kontrolera)`;
      lastFrame = performance.now();
      lastAcceptedFrame = -Infinity;
      for (const node of activeNodes) wakeWled(node.host);
      logEvent('WLED', 'REARM_AFTER_YIELD', { nodes: activeNodes.map(n => n.host) });
      broadcastLive('command', { type: 'hardware_sync', state: state() });
    }
  };

  const activateShowOutput = ({ forceWake = true, clearBlackout = false, broadcast = true, source = 'system' } = {}) => {
    if (testRunning) return false;
    if (liveControl.state.blackout) {
      if (!clearBlackout) return false;
      liveControl.state.blackout = false;
      liveControl.broadcastCommand({ type: 'blackout', value: false });
    }
    const prevMode = outputMode;
    const wasArmed = armed;
    outputMode = 'show';
    yieldedToRemote = false;
    const activeNodes = config.nodes.filter(n => n.host);
    if (activeNodes.length) {
      armed = true;
      if (!wasArmed) framesSentSinceArm = 0;
      reason = activeNodes.length === config.nodes.length ? 'Izlaz uključen' : `Izlaz uključen (${activeNodes.length}/${config.nodes.length} kontrolera)`;
      lastFrame = performance.now();
      lastAcceptedFrame = -Infinity;
      if (forceWake && (!wasArmed || prevMode !== 'show')) {
        for (const node of activeNodes) wakeWled(node.host);
      }
    }
    if (prevMode !== 'show' || !wasArmed) {
      logEvent('MODE', 'ACTIVATE_SHOW', { source, prevMode, wasArmed, armed, forceWake });
      if (broadcast) {
        broadcastLive('command', { type: 'hardware_sync', state: state() });
      }
    } else if (broadcast && clearBlackout) {
      broadcastLive('command', { type: 'hardware_sync', state: state() });
    }
    return armed;
  };

  const activateAmbientOutput = ({ restorePresetOnE8 = false, broadcast = true, source = 'menubar' } = {}) => {
    const prevMode = outputMode;
    const wasArmed = armed;
    outputMode = 'ambient';
    armed = false;
    framesSentSinceArm = 0;
    yieldedToRemote = false;
    reason = 'Uredska rasvjeta (Menu Bar)';
    if (restorePresetOnE8) {
      for (const node of config.nodes.filter(n => n.host)) {
        restoreAmbientWled(node.host);
      }
    }
    if (prevMode !== 'ambient' || wasArmed || restorePresetOnE8) {
      logEvent('MODE', 'ACTIVATE_AMBIENT', { source, prevMode, wasArmed, restorePresetOnE8 });
    }
    if (broadcast) {
      broadcastLive('command', { type: 'hardware_sync', state: state() });
      broadcastLanPresence({ reason: 'mode_ambient' });
    }
  };

  const claimStageForPeer = (peer, { takeover = false } = {}) => {
    if (!peer) return false;
    const nowMs = Date.now();
    const prevOwner = stageOwnerId;
    const wasRemote = Boolean(remoteStageOwner);
    const wasAmbient = outputMode === 'ambient';
    claimEpoch = Math.max(nowMs, claimEpoch + 1);
    stageOwnerId = peer.clientId;
    remoteStageOwner = null;
    stageLastActiveAt = nowMs;
    peer.lastActiveAt = nowMs;
    peer.releasedWhilePlaying = false;
    if (takeover) {
      activateShowOutput({ forceWake: true, broadcast: true });
    } else {
      rearmAfterYield();
    }
    lanCoordinator?.broadcastClaim?.({ claimEpoch });
    return prevOwner !== peer.clientId || wasRemote || wasAmbient || takeover;
  };

  const releaseStageForPeer = cid => {
    const peer = lanPeers.get(cid);
    if (peer && (peer.isPlaying || peer.hasActivePads)) {
      peer.releasedWhilePlaying = true;
    }
    if (stageOwnerId === cid) {
      stageOwnerId = null;
      claimEpoch = Math.max(Date.now(), claimEpoch + 1);
      lanCoordinator?.broadcastRelease?.({ claimEpoch, clientId: cid });
      return true;
    }
    return false;
  };

  const touchLanPeer = (clientId, patch = {}, req = null) => {
    if (typeof clientId !== 'string' || !clientId.trim()) return null;
    const cid = clientId.trim().slice(0, 64);
    pruneLanPeers();
    const existing = lanPeers.get(cid);
    const nowMs = Date.now();
    const source = patch.source || existing?.source || (cid.startsWith('yt-') ? 'youtube' : 'daw');
    const defaultPrefix = source === 'youtube' ? 'YouTube' : 'DJ';
    const name = typeof patch.name === 'string' && patch.name.trim()
      ? patch.name.trim().slice(0, 48)
      : (existing?.name || `${defaultPrefix}-${cid.slice(-4).toUpperCase()}`);
    const nextIsPlaying = patch.isPlaying !== undefined ? Boolean(patch.isPlaying) : Boolean(existing?.isPlaying);
    const nextHasActivePads = patch.hasActivePads !== undefined ? Boolean(patch.hasActivePads) : Boolean(existing?.hasActivePads);
    const nextTrackId = patch.trackId !== undefined ? patch.trackId : (existing?.trackId || null);

    let releasedWhilePlaying = Boolean(existing?.releasedWhilePlaying);
    if ((patch.isPlaying === false && !nextHasActivePads) || (existing && patch.trackId !== undefined && patch.trackId !== existing.trackId)) {
      releasedWhilePlaying = false;
    }

    const peer = {
      clientId: cid,
      name,
      source,
      ip: req ? cleanPeerIp(req) : (existing?.ip || '127.0.0.1'),
      connectedAt: existing?.connectedAt || nowMs,
      lastSeenAt: nowMs,
      lastActiveAt: (nextIsPlaying || nextHasActivePads) ? nowMs : (existing?.lastActiveAt || 0),
      trackId: nextTrackId,
      trackTitle: patch.trackTitle !== undefined ? patch.trackTitle : (existing?.trackTitle || null),
      videoId: patch.videoId !== undefined ? patch.videoId : (existing?.videoId || null),
      isPlaying: nextIsPlaying,
      hasActivePads: nextHasActivePads,
      timeSec: patch.timeSec !== undefined ? Number(patch.timeSec || 0) : Number(existing?.timeSec || 0),
      durationSec: patch.durationSec !== undefined ? Number(patch.durationSec || 0) : Number(existing?.durationSec || 0),
      bpm: patch.bpm !== undefined ? patch.bpm : (existing?.bpm || null),
      releasedWhilePlaying,
      sseRes: patch.sseRes !== undefined ? patch.sseRes : (existing?.sseRes || null)
    };
    lanPeers.set(cid, peer);

    const activeNow = peer.isPlaying || peer.hasActivePads;
    if (activeNow) {
      if (stageOwnerId === cid && !remoteStageOwner) {
        stageLastActiveAt = nowMs;
      } else if (!peer.releasedWhilePlaying) {
        const currentOwner = stageOwnerId ? lanPeers.get(stageOwnerId) : null;
        const stageIsFree = !stageOwnerId && !remoteStageOwner;
        // Also allow seamless handover between DAW tab and YouTube tab on the exact same computer when the previous tab is paused
        const sameMachinePausedSwitch = Boolean(
          currentOwner &&
          !remoteStageOwner &&
          !currentOwner.isPlaying &&
          !currentOwner.hasActivePads &&
          currentOwner.ip === peer.ip &&
          currentOwner.source !== peer.source
        );
        const hasLocalDawPeer = isCompanionPadSource(peer.source) && [...lanPeers.values()].some(p => p.clientId !== peer.clientId && p.source === 'daw');
        if ((stageIsFree && !hasLocalDawPeer) || sameMachinePausedSwitch) {
          claimStageForPeer(peer, { takeover: false });
        }
      }
    }
    return peer;
  };

  const isCompanionPadSource = src => src === 'ios-pad' || src === 'pad' || src === 'ios';
  const companionDevices = new Map();

  const touchCompanionDevice = (clientId, patch = {}, req = null) => {
    const cid = String(clientId || 'ios-pad').trim().slice(0, 64);
    const prev = companionDevices.get(cid);
    const nowMs = Date.now();
    const latency = Number(patch.latencyMs);
    const entry = {
      clientId: cid,
      name: (typeof patch.name === 'string' && patch.name.trim()) ? patch.name.trim().slice(0, 48) : (prev?.name || 'iPhone Pad'),
      ip: req ? cleanPeerIp(req) : (prev?.ip || '127.0.0.1'),
      latencyMs: Number.isFinite(latency) && latency > 0 ? Math.max(1, Math.round(latency)) : (prev?.latencyMs || 2),
      lastSeenAt: nowMs,
      sseConnected: patch.sseConnected !== undefined ? Boolean(patch.sseConnected) : Boolean(prev?.sseConnected)
    };
    companionDevices.set(cid, entry);
    return entry;
  };

  const getActiveCompanions = (nowMs = Date.now()) => {
    const activeSseIds = new Set();
    for (const res of liveClients) {
      if (res.isCompanionClient && res.clientId) {
        activeSseIds.add(res.clientId);
      }
    }
    const list = [];
    for (const [cid, dev] of companionDevices.entries()) {
      const sseAlive = activeSseIds.has(cid);
      if (!sseAlive && (nowMs - dev.lastSeenAt) > 15000) {
        companionDevices.delete(cid);
        continue;
      }
      list.push({
        clientId: dev.clientId,
        name: dev.name,
        ip: dev.ip,
        latencyMs: dev.latencyMs || 2,
        lastSeenAt: dev.lastSeenAt,
        connected: true
      });
    }
    return list;
  };

  const canClientDriveStage = clientId => {
    pruneLanPeers();
    if (remoteStageOwner) return false;
    if (!clientId) return true;
    const cid = String(clientId).trim();
    const peer = lanPeers.get(cid);
    if (peer?.releasedWhilePlaying) return false;
    if (stageOwnerId) {
      if (stageOwnerId === cid) return true;
      const owner = lanPeers.get(stageOwnerId);
      if (isCompanionPadSource(owner?.source) || isCompanionPadSource(peer?.source)) {
        return true;
      }
      return false;
    }
    return true;
  };

  const formatPeerForStatus = (p, activeOwnerId, isRemote = false, currentStageState = 'idle') => ({
    clientId: p.clientId,
    name: p.name,
    ip: p.ip,
    source: p.source || 'daw',
    isStageOwner: Boolean(activeOwnerId && p.clientId === activeOwnerId),
    stageState: Boolean(activeOwnerId && p.clientId === activeOwnerId) ? currentStageState : 'solo',
    isRemoteServer: Boolean(isRemote),
    remoteUrl: p.remoteUrl || p.httpUrl || null,
    trackId: p.trackId || null,
    trackTitle: p.trackTitle || null,
    videoId: p.videoId || null,
    isPlaying: Boolean(p.isPlaying),
    timeSec: Number(p.timeSec || 0),
    durationSec: Number(p.durationSec || 0),
    bpm: p.bpm || null,
    lastSeenAt: p.lastSeenAt
  });

  const getLanStatus = () => {
    pruneLanPeers();
    const nowMs = Date.now();
    const port = server?.address?.()?.port || 8787;
    const addrInfo = getLanAddresses(port);
    const stageState = computeStageState(nowMs);
    const graceRemainingSec = stageState === 'grace' ? getGraceRemainingSec(nowMs) : 0;
    const localOwner = (stageOwnerId && lanPeers.get(stageOwnerId)) || null;
    const effectiveOwner = remoteStageOwner || localOwner || null;
    const effectiveOwnerId = effectiveOwner ? effectiveOwner.clientId : null;

    const allPeers = [...lanPeers.values()].map(p => formatPeerForStatus(p, effectiveOwnerId, false, stageState));
    if (lanCoordinator) {
      for (const rp of lanCoordinator.getRemotePeers()) {
        if (!allPeers.some(lp => lp.clientId === rp.clientId)) {
          allPeers.push(formatPeerForStatus(rp, effectiveOwnerId, true, stageState));
        }
      }
    }

    const nowPlaying = effectiveOwner ? {
      clientId: effectiveOwner.clientId,
      name: effectiveOwner.name,
      source: effectiveOwner.source || 'daw',
      trackId: effectiveOwner.trackId || null,
      trackTitle: effectiveOwner.trackTitle || null,
      videoId: effectiveOwner.videoId || null,
      isPlaying: Boolean(effectiveOwner.isPlaying),
      timeSec: Number(effectiveOwner.timeSec || 0),
      durationSec: Number(effectiveOwner.durationSec || 0),
      bpm: effectiveOwner.bpm || null,
      stageState,
      graceRemainingSec,
      isRemoteServer: Boolean(remoteStageOwner),
      remoteUrl: remoteStageOwner?.httpUrl || null
    } : null;

    return {
      ok: true,
      serverId: lanCoordinator?.serverId || null,
      ...addrInfo,
      armed: Boolean(armed),
      outputMode,
      ambientOverride: outputMode === 'ambient',
      yieldedToRemote: Boolean(yieldedToRemote),
      blackout: Boolean(liveControl.state.blackout),
      master: liveControl.state.master ?? 100,
      stageState,
      graceRemainingSec,
      stageIdleSec: Math.round(stageIdleMs / 1000),
      stageOwnerId: effectiveOwnerId,
      stageOwnerName: effectiveOwner?.name || null,
      stageOwnerSource: effectiveOwner?.source || null,
      isRemoteStageOwner: Boolean(remoteStageOwner),
      nowPlaying,
      peers: allPeers,
      companions: getActiveCompanions(nowMs)
    };
  };

  const broadcastLanPresence = (extra = {}) => {
    const statusPayload = getLanStatus();
    broadcastLive('command', { type: 'lan_presence', lan: statusPayload, ...statusPayload, ...extra });
    lanCoordinator?.broadcastState?.('state');
  };

  lanCoordinator = createLanCoordinator({
    port: lanBusPort,
    ...(lanMulticastAddr !== undefined ? { multicastAddr: lanMulticastAddr } : {}),
    ...(lanBroadcastAddrs !== undefined ? { broadcastAddrs: lanBroadcastAddrs } : {}),
    heartbeatMs: lanHeartbeatMs,
    peerTtlMs: lanPeerTtlMs,
    getLocalState: () => {
      const port = server?.address?.()?.port || 8787;
      const addrInfo = getLanAddresses(port);
      const nowMs = Date.now();
      const localOwner = (stageOwnerId && lanPeers.get(stageOwnerId)) || null;
      const localStageState = localOwner
        ? ((localOwner.isPlaying || localOwner.hasActivePads) ? 'on_air' : 'grace')
        : 'idle';
      return {
        hostname: addrInfo.hostname,
        port,
        lanUrls: addrInfo.lanUrls,
        claimEpoch,
        stageState: localStageState,
        localStageOwner: localOwner ? {
          clientId: localOwner.clientId,
          name: localOwner.name,
          source: localOwner.source || 'daw',
          httpUrl: addrInfo.lanUrls?.[0] || `http://127.0.0.1:${port}`,
          trackId: localOwner.trackId || null,
          trackTitle: localOwner.trackTitle || null,
          videoId: localOwner.videoId || null,
          isPlaying: Boolean(localOwner.isPlaying),
          timeSec: Number(localOwner.timeSec || 0),
          durationSec: Number(localOwner.durationSec || 0),
          bpm: localOwner.bpm || null,
          graceRemainingSec: localStageState === 'grace' ? getGraceRemainingSec(nowMs) : 0,
          lastActiveAt: stageLastActiveAt
        } : null,
        localPeers: [...lanPeers.values()].map(p => ({
          clientId: p.clientId,
          name: p.name,
          ip: p.ip,
          source: p.source || 'daw',
          trackId: p.trackId || null,
          trackTitle: p.trackTitle || null,
          videoId: p.videoId || null,
          isPlaying: Boolean(p.isPlaying),
          timeSec: Number(p.timeSec || 0),
          durationSec: Number(p.durationSec || 0),
          bpm: p.bpm || null,
          lastSeenAt: p.lastSeenAt
        }))
      };
    },
    onRemoteClaim: ({ serverId: remSrvId, claimEpoch: remEpoch, stageState: remState, stageOwner: remOwner }) => {
      if (!remOwner || remEpoch < claimEpoch) return;
      const changed = !remoteStageOwner || remoteStageOwner.clientId !== remOwner.clientId || Boolean(stageOwnerId);
      claimEpoch = remEpoch;
      stageOwnerId = null;
      remoteStageOwner = {
        ...remOwner,
        serverId: remSrvId,
        stageState: remState || (remOwner.isPlaying ? 'on_air' : 'grace')
      };
      if (armed) {
        // Yield WLED output cleanly without sending blackout zeros so the new owner's frames don't flicker
        armed = false;
        yieldedToRemote = true;
        reason = `Na stageu (LAN): ${remOwner.name || 'Kolega'}`;
        broadcastLive('command', { type: 'hardware_sync', state: state() });
      }
      if (changed) {
        const statusPayload = getLanStatus();
        broadcastLive('command', { type: 'lan_presence', lan: statusPayload, ...statusPayload, reason: 'remote_claim' });
      }
    },
    onRemoteRelease: ({ serverId: remSrvId, claimEpoch: remEpoch }) => {
      if (remoteStageOwner && remoteStageOwner.serverId === remSrvId) {
        if (remEpoch >= claimEpoch) claimEpoch = remEpoch;
        remoteStageOwner = null;
        const statusPayload = getLanStatus();
        broadcastLive('command', { type: 'lan_presence', lan: statusPayload, ...statusPayload, reason: 'remote_release' });
      }
    },
    onRemoteStateChanged: () => {
      pruneLanPeers();
      const statusPayload = getLanStatus();
      broadcastLive('command', { type: 'lan_presence', lan: statusPayload, ...statusPayload });
    }
  });
  if (lanBusPort > 0) {
    lanCoordinator.start().catch(() => {});
  }
  const liveControl = {
    state: { master: 100, blackout: false, trackId: null },
    get clientCount() { return liveClients.size; },
    broadcastCommand(cmd) { broadcastLive('command', cmd); }
  };
  const extJobs = new Map();
  const extState = {
    mode: 'idle',
    activeVideoId: null,
    activeTrackId: null,
    activeShow: null,
    theme: 'midnight',
    useGemini: false,
    lastSyncAt: 0,
    lastSyncPerfMs: 0,
    lastTime: 0,
    playbackRate: 1,
    lastPaused: true,
    dawPlayingLocally: false,
    liveStems: null,
    smoothedStems: null
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
  const disarm = async (message, { sendZeros = true } = {}) => {
    const wasArmed = armed;
    const sentCount = framesSentSinceArm;
    armed = false;
    framesSentSinceArm = 0;
    reason = message;
    if (wasArmed) {
      logEvent('WLED', 'DISARM', { message, sendZeros, framesSentSinceArm: sentCount, outputMode });
    }
    if (wasArmed && sendZeros) await zeros().catch(() => {});
  };
  const wakeWled = host => {
    wledShowCarrierAwake = true;
    if (probe === probeWled && host) {
      logEvent('WLED', 'WAKE_SHOW', { host, lor: 0 });
      fetch(`http://${host}/win&T=1&A=255&R=0&G=0&B=0&W=0&R2=0&G2=0&B2=0&W2=0&FX=0&LO=0`, {
        signal: AbortSignal.timeout(1200)
      }).catch(() => {});
    }
  };
  const buildAmbientWinQuery = ({ lockLor = true, savePreset = false } = {}) => {
    const rgbw = rgbwForKelvin(ambientLight.kelvin);
    const briByte = Math.max(1, Math.min(255, Math.round((ambientLight.brightness / 100) * 255)));
    const isOn = Boolean(ambientLight.on);
    const lor = lockLor ? 2 : 0;
    return `win&T=${isOn ? 1 : 0}&A=${briByte}&R=${rgbw[0]}&G=${rgbw[1]}&B=${rgbw[2]}&W=${rgbw[3]}&R2=0&G2=0&B2=0&W2=0&FX=0&LO=${lor}${savePreset ? '&PS=1' : ''}`;
  };
  const restoreAmbientWled = (host, { lockLor = true, savePreset = false } = {}) => {
    wledShowCarrierAwake = false;
    if (probe === probeWled && host) {
      const query = buildAmbientWinQuery({ lockLor, savePreset });
      logEvent('WLED', 'LOCK_AMBIENT', {
        host,
        lor: lockLor ? 2 : 0,
        on: Boolean(ambientLight.on),
        brightness: ambientLight.brightness,
        kelvin: ambientLight.kelvin
      });
      fetch(`http://${host}/${query}`, {
        signal: AbortSignal.timeout(1200)
      }).catch(() => {});
    }
  };
  const restoreWledAfterShowStop = (reasonTag = 'show_stop', { sendZeros = true } = {}) => {
    if (!wledShowCarrierAwake) return;
    wledShowCarrierAwake = false;
    if (sendZeros && !Boolean(ambientLight.on)) {
      zeros().catch(() => {});
    }
    const activeNodes = config.nodes.filter(n => n.host);
    for (const node of activeNodes) {
      restoreAmbientWled(node.host, { lockLor: false, savePreset: false });
    }
    logEvent('WLED', 'RESTORE_AFTER_SHOW', {
      reason: reasonTag,
      on: Boolean(ambientLight.on),
      brightness: ambientLight.brightness,
      kelvin: ambientLight.kelvin
    });
  };
  const primaryWledHost = () => {
    const e8 = config.nodes.find(n => n.id === 'E8-1' && n.host) || config.nodes.find(n => n.host);
    return e8?.host || '192.168.0.117';
  };
  const queryAmbientLightStatus = async ({ forceProbe = true } = {}) => {
    const host = primaryWledHost();
    if (forceProbe && probe === probeWled && host) {
      try {
        const res = await fetch(`http://${host}/win`, { signal: AbortSignal.timeout(1500) });
        if (res.ok) {
          const xml = await res.text();
          const win = parseWledWinXml(xml);
          if (win) {
            let hasNonZeroColor = true;
            if (Array.isArray(win.col) && win.col.length >= 4) {
              const sum = (Number(win.col[0]) || 0) + (Number(win.col[1]) || 0) + (Number(win.col[2]) || 0) + (Number(win.col[3]) || 0);
              if (sum <= 0) {
                hasNonZeroColor = false;
              }
            }
            const canSyncFromHardware = outputMode === 'ambient' && !armed && !win.isLive && !wledShowCarrierAwake && hasNonZeroColor;
            if (canSyncFromHardware) {
              ambientLight.kelvin = kelvinFromRgbw(win.col, ambientLight.kelvin);
              ambientLight.on = Boolean(win.on);
              if (Number(win.bri) > 0) {
                ambientLight.brightness = Math.max(1, Math.min(100, Math.round((Number(win.bri) / 255) * 100)));
              }
            }
            const rgbw = rgbwForKelvin(ambientLight.kelvin);
            const briByte = Math.max(1, Math.min(255, Math.round((ambientLight.brightness / 100) * 255)));
            const watts = computeAmbientWatts({
              isOn: Boolean(ambientLight.on),
              wledPwrMa: null,
              isLive: false,
              bri: briByte,
              col: rgbw
            });
            ambientLight = {
              ...ambientLight,
              watts,
              connected: true,
              isLive: win.isLive
            };
          }
        }
      } catch {
        ambientLight = { ...ambientLight, connected: false };
      }
    }
    return {
      ok: true,
      ...ambientLight,
      ambientLight,
      outputMode,
      armed,
      host
    };
  };
  const applyAmbientLightState = async (input = {}) => {
    const presetMap = {
      warm: { on: true, kelvin: 2700, brightness: 85 },
      neutral: { on: true, kelvin: 4000, brightness: 100 },
      full: { on: true, kelvin: 4800, brightness: 100 },
      cool: { on: true, kelvin: 6500, brightness: 100 },
      dim: { on: true, kelvin: 3000, brightness: 25 },
      off: { on: false }
    };
    const preset = typeof input.preset === 'string' ? presetMap[input.preset.toLowerCase()] : null;
    const merged = preset ? { ...input, ...preset } : input;

    let nextKelvin = ambientLight.kelvin;
    if (Number.isFinite(Number(merged.kelvin))) {
      nextKelvin = Math.max(2700, Math.min(6500, Math.round(Number(merged.kelvin) / 50) * 50));
    }
    let nextBrightness = ambientLight.brightness;
    if (Number.isFinite(Number(merged.brightness))) {
      nextBrightness = Math.max(1, Math.min(100, Math.round(Number(merged.brightness))));
    } else if (Number.isFinite(Number(merged.bri))) {
      nextBrightness = Math.max(1, Math.min(100, Math.round((Number(merged.bri) / 255) * 100)));
    }
    let nextOn = ambientLight.on;
    if (merged.toggle === true || merged.action === 'toggle') {
      nextOn = !ambientLight.on;
    } else if (merged.action === 'on') {
      nextOn = true;
    } else if (merged.action === 'off') {
      nextOn = false;
    } else if (typeof merged.on === 'boolean') {
      nextOn = merged.on;
    } else if (Number.isFinite(Number(merged.brightness)) || Number.isFinite(Number(merged.bri)) || Number.isFinite(Number(merged.kelvin))) {
      nextOn = true;
    }

    const rgbw = rgbwForKelvin(nextKelvin);
    const briByte = Math.max(1, Math.min(255, Math.round((nextBrightness / 100) * 255)));
    const watts = computeAmbientWatts({ isOn: nextOn, wledPwrMa: null, isLive: false, bri: briByte, col: rgbw });

    wledShowCarrierAwake = false;
    ambientLight = {
      on: nextOn,
      brightness: nextBrightness,
      kelvin: nextKelvin,
      watts,
      connected: true,
      isLive: false,
      updatedAt: Date.now()
    };
    persistAmbientLight();

    const reqSource = String(merged.source || 'light_switch').slice(0, 32);
    activateAmbientOutput({ restorePresetOnE8: false, broadcast: false, source: reqSource });

    const targets = config.nodes.filter(n => n.host).map(n => n.host);
    if (!targets.length) targets.push('192.168.0.117');
    const savePreset = merged.savePreset !== false;
    const winQuery = `win&T=${nextOn ? 1 : 0}&A=${briByte}&R=${rgbw[0]}&G=${rgbw[1]}&B=${rgbw[2]}&W=${rgbw[3]}&R2=0&G2=0&B2=0&W2=0&FX=0&LO=2${savePreset ? '&PS=1' : ''}`;

    if (probe === probeWled) {
      await Promise.all(targets.map(host =>
        fetch(`http://${host}/${winQuery}`, {
          signal: AbortSignal.timeout(1400)
        }).catch(() => {})
      ));
    }

    logEvent('LIGHT', nextOn ? 'LIGHT_ON' : 'LIGHT_OFF', {
      source: reqSource,
      on: nextOn,
      brightness: nextBrightness,
      kelvin: nextKelvin,
      watts
    });

    const currentState = state();
    broadcastLive('command', { type: 'ambient_light_sync', ambientLight, state: currentState });
    broadcastLive('command', { type: 'hardware_sync', state: { ...currentState, ambientOverride: true } });
    broadcastLanPresence({ reason: 'mode_ambient' });

    return {
      ok: true,
      ...ambientLight,
      ambientLight,
      outputMode,
      armed,
      host: primaryWledHost(),
      state: currentState
    };
  };
  let autoConnectPromise = null;
  const autoConnect = ({ allowDiscovery = true, forceTakeover = false } = {}) => {
    if (remoteStageOwner && !forceTakeover) {
      return Promise.resolve({
        ok: false,
        connected: false,
        yieldedToRemote: true,
        error: `Na stageu je ${remoteStageOwner.name || 'kolega na LAN-u'}.`,
        ...state()
      });
    }
    if (outputMode === 'ambient' && !forceTakeover) {
      const e8 = config.nodes.find(n => n.id === 'E8-1') || config.nodes.find(n => n.host);
      return Promise.resolve({
        ok: true,
        connected: Boolean(e8?.host),
        armed: false,
        ambientOverride: true,
        host: e8?.host || null,
        nodeId: e8?.id || null,
        ...state()
      });
    }
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
                } else {
                  try {
                    const other = await probe(node.host, { includeBuses: false });
                    if (other?.reachable && (!node.mac || !other.mac || other.mac === node.mac)) {
                      activeNodes.push(node);
                    }
                  } catch {}
                }
              }
              if (activeNodes.length) {
                if (outputMode === 'ambient' && !forceTakeover) {
                  return { ok: true, connected: true, rebound: false, host: e8Node.host, nodeId: e8Node.id, ...state() };
                }
                armed = true;
                framesSentSinceArm = 0;
                yieldedToRemote = false;
                reason = activeNodes.length === config.nodes.length ? 'Izlaz uključen' : `Izlaz uključen (${activeNodes.length}/${config.nodes.length} kontrolera)`;
                lastFrame = performance.now();
                lastAcceptedFrame = -Infinity;
                logEvent('WLED', 'AUTO_CONNECT_OK', { host: e8Node.host, rebound: false, outputMode });
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
            const activeNodes = config.nodes.filter(n => n.host);
            if (outputMode === 'ambient' && !forceTakeover) {
              return { ok: true, connected: true, rebound: true, host: matched.host, nodeId: e8Node.id, ...state() };
            }
            armed = true;
            framesSentSinceArm = 0;
            yieldedToRemote = false;
            reason = activeNodes.length === config.nodes.length ? 'Izlaz uključen' : `Izlaz uključen (${activeNodes.length}/${config.nodes.length} kontrolera)`;
            lastFrame = performance.now();
            lastAcceptedFrame = -Infinity;
            logEvent('WLED', 'AUTO_CONNECT_REBOUND', { host: matched.host, outputMode });
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
  let lastDispatchedBars = null;
  let lastDispatchedAt = 0;
  let smoothedDdpIntervalMs = 16.6;
  let lastBaseBars = null;
  let lastBaseBarsAt = 0;
  let lastCompanionFramePushAt = 0;
  let lastSyncedDawPadsJson = '';

  const hasActiveCompanionClient = () => {
    for (const c of liveClients) {
      if (c.isCompanionClient) return true;
    }
    return false;
  };

  const unscaleBarsForPreview = (bars, masterPct = 100) => {
    if (!bars || typeof bars !== 'object') return bars;
    const scale = clampVal((Number(masterPct) || 100) / 100, 0, 1);
    if (scale <= 0.005 || scale >= 0.995) return bars;
    const inv = 1 / scale;
    const out = {};
    for (const barId of BAR_IDS) {
      const pxList = bars[barId];
      if (!Array.isArray(pxList)) continue;
      out[barId] = pxList.map(px => [
        Math.min(255, Math.round((Number(px[0]) || 0) * inv)),
        Math.min(255, Math.round((Number(px[1]) || 0) * inv)),
        Math.min(255, Math.round((Number(px[2]) || 0) * inv)),
        Math.min(255, Math.round((Number(px[3]) || 0) * inv))
      ]);
    }
    return out;
  };

  const pushFrameToCompanionClients = (bars, nowPerf = performance.now(), { isPreScaled = false, masterPct = null } = {}) => {
    if (!bars || Object.keys(bars).length !== 9) return;
    if (nowPerf - lastCompanionFramePushAt < 30) return;
    if (!hasActiveCompanionClient()) return;
    lastCompanionFramePushAt = nowPerf;
    const effectiveMaster = masterPct ?? latestLiveState?.master ?? liveControl.state.master ?? 35;
    const previewBars = isPreScaled ? unscaleBarsForPreview(bars, effectiveMaster) : bars;
    const perfCtx = getServerPerfContext();
    const snap = getPadsSnapshot();
    const payload = `event: command\ndata: ${JSON.stringify({
      type: 'frame_sync',
      bars: previewBars,
      unscaled: true,
      activePads: snap.activePads,
      heldPads: snap.heldPads,
      pendingPads: snap.pendingPads,
      quantize: snap.quantize,
      isPlaying: perfCtx.playing,
      timeSec: perfCtx.songTime,
      bpm: perfCtx.bpm,
      master: effectiveMaster,
      blackout: Boolean(liveControl.state.blackout)
    })}\n\n`;
    for (const c of liveClients) {
      if (!c.isCompanionClient) continue;
      try { c.write(payload); } catch { liveClients.delete(c); }
    }
  };

  const sendBarsToWled = async (bars, scale = 1, source = 'internal') => {
    if (!bars || Object.keys(bars).length !== 9) return false;
    const now = performance.now();
    // Always push full-brightness (unscaled) bars to connected iPhone companion clients,
    // even when physical WLED output is disarmed or in ambient mode.
    pushFrameToCompanionClients(bars, now, { isPreScaled: false });
    if (!armed || outputMode === 'ambient' || remoteStageOwner) return false;
    if (now - lastAcceptedFrame < minFrameMs) return false;
    if (lastDispatchedAt > 0) {
      const dt = now - lastDispatchedAt;
      if (dt > 4 && dt < 1000) {
        smoothedDdpIntervalMs = smoothedDdpIntervalMs * 0.8 + dt * 0.2;
      }
    }
    lastDispatchedBars = bars;
    lastDispatchedAt = now;
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
    if (!wledShowCarrierAwake && !liveControl.state.blackout) {
      for (const node of config.nodes.filter(n => n.host)) wakeWled(node.host);
    }
    if (framesSentSinceArm === 0) {
      logEvent('DDP', 'STREAM_FIRST_FRAME', { source, scale: masterScale });
    }
    framesSentSinceArm++;
    lastFrame = now;
    lastAcceptedFrame = now;
    await Promise.all(config.nodes.filter(node => node.host).map(node => send(node.host, values.get(node.id))));
    return true;
  };
  const computeLiveTelemetry = () => {
    const nowPerf = performance.now();
    const isFresh = Boolean(armed && outputMode === 'show' && lastDispatchedBars && (nowPerf - lastDispatchedAt < 1800));
    if (!isFresh) {
      return {
        active: false,
        watts: armed ? 5.5 : (ambientLight?.watts ?? 3.2),
        fps: armed ? 2 : 0
      };
    }
    let totalSum = 0;
    let groupCount = 0;
    for (const barId of BAR_IDS) {
      if (config.profile === 'e8-columns' && barId === 'C1') continue;
      const pxList = lastDispatchedBars[barId];
      if (!Array.isArray(pxList)) continue;
      for (let i = 0; i < pxList.length; i++) {
        const px = pxList[i];
        totalSum += (Number(px[0]) || 0) + (Number(px[1]) || 0) + (Number(px[2]) || 0) + (Number(px[3]) || 0);
        groupCount++;
      }
    }
    const ratio = groupCount > 0 ? Math.max(0, Math.min(1, totalSum / (groupCount * 1020))) : 0;
    const watts = Math.round((5.5 + ratio * 171.0) * 10) / 10;
    const rawFps = smoothedDdpIntervalMs > 0 ? Math.round(1000 / smoothedDdpIntervalMs) : 60;
    const fps = (nowPerf - lastDispatchedAt < 350) ? Math.max(1, Math.min(120, rawFps)) : 4;
    return { active: true, watts, fps };
  };
  const state = () => ({ armed, outputMode, ambientOverride: outputMode === 'ambient', ambientLight, liveTelemetry: computeLiveTelemetry(), yieldedToRemote, reason, config, transport: config.transport === 'rgbw' ? 'DDP RGBW' : 'DDP RGB', ceiling: 255, maxFps: 120, watchdogMs });
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
  const renderHighRateTick = () => {
    if (liveControl.state.blackout || testRunning) return;
    const canSendWled = armed && outputMode !== 'ambient' && !remoteStageOwner;
    const hasCompanion = hasActiveCompanionClient();
    if (!canSendWled && !hasCompanion) return;
    const nowPerf = performance.now();
    if (canSendWled && nowPerf - lastAcceptedFrame < 13) return;
    if (!canSendWled && nowPerf - lastCompanionFramePushAt < 30) return;
    const browserFrameIdleMs = nowPerf - lastClientFrame;
    const nowMs = Date.now();
    const perfCtx = getServerPerfContext();
    serverPerformDesk.tick(perfCtx);
    const hasServerPads = serverPerformDesk.active.size > 0 || serverPerformDesk.touches.size > 0;

    const extActivelyPlaying = Boolean(
      (extState.mode === 'synced' || extState.mode === 'live_stream') &&
      !extState.lastPaused &&
      !extState.dawPlayingLocally &&
      (nowMs - (extState.lastSyncAt || 0) < 1200)
    );
    if (extActivelyPlaying && (liveControl.clientCount === 0 || browserFrameIdleMs > 35)) {
      const elapsedSec = Math.max(0, (nowPerf - (extState.lastSyncPerfMs || nowPerf)) / 1000) * (extState.playbackRate || 1);
      const interpTimeSec = Math.max(0, (Number(extState.lastTime) || 0) + elapsedSec);
      const scale = clampVal((liveControl.state.master ?? 70) / 100, 0, 1);

      if (extState.mode === 'synced') {
        const show = (extState.activeTrackId && serverShowCache.get(extState.activeTrackId)) || extState.activeShow;
        if (show?.timeline) {
          const durationLimit = show.analysis?.durationSec || show.timeline?.durationSec || Infinity;
          const tSec = Math.min(durationLimit, interpTimeSec);
          let rendered = renderTimelineFrame(show.timeline, show.analysis, tSec, null, true);
          if (hasServerPads) {
            rendered = serverPerformDesk.render(rendered, perfCtx.clockTime, perfCtx.bpm, 1, show.analysis, tSec);
          }
          sendBarsToWled(rendered.bars, scale, 'ext_synced').catch(() => {});
          return;
        }
      } else if (extState.mode === 'live_stream' && extState.liveStems) {
        const target = extState.liveStems;
        const cur = extState.smoothedStems ? { ...extState.smoothedStems } : { ...target };
        for (const k of ['bass', 'drums', 'vocals', 'highs', 'other', 'energy', 'rms']) {
          if (Number.isFinite(Number(target[k]))) {
            const tv = Number(target[k]);
            const cv = Number(cur[k]);
            const prev = Number.isFinite(cv) ? cv : tv;
            const alpha = tv >= prev ? 0.6 : 0.25;
            cur[k] = prev + (tv - prev) * alpha;
          }
        }
        extState.smoothedStems = cur;
        let liveFrame = renderLiveStemFrame(cur, interpTimeSec, extState.theme, false);
        if (hasServerPads) {
          liveFrame = serverPerformDesk.render(liveFrame, perfCtx.clockTime, perfCtx.bpm, 1, null, interpTimeSec);
        }
        sendBarsToWled(liveFrame.bars, scale, 'ext_live_stream').catch(() => {});
        return;
      }
    }

    const dawActivelyPlaying = Boolean(
      latestLiveState?.isPlaying &&
      (hasCompanion || (nowMs - (latestLiveState.timestamp || 0) < 15000))
    );
    if (liveClients.size > 0 && dawActivelyPlaying && browserFrameIdleMs > 40 && !fallbackBusy) {
      const trackId = latestLiveState?.trackId || liveControl.state.trackId;
      if (trackId) {
        const cached = serverShowCache.get(trackId);
        if (cached && nowMs - cached.loadedAt < 10000) {
          const elapsedSec = Math.max(0, (nowMs - (latestLiveState.timestamp || nowMs)) / 1000);
          const durationLimit = cached.analysis?.durationSec || cached.timeline?.durationSec || Infinity;
          let tSec = Math.max(0, (Number(latestLiveState?.timeSec) || 0) + elapsedSec);
          if (Number.isFinite(durationLimit) && durationLimit > 1 && tSec >= durationLimit) {
            tSec = tSec % durationLimit;
            if (nowMs - (latestLiveState.timestamp || 0) > 4000) {
              latestLiveState.timeSec = tSec;
              latestLiveState.timestamp = nowMs;
            }
          } else {
            tSec = Math.min(durationLimit, tSec);
          }
          let rendered = renderTimelineFrame(cached.timeline, cached.analysis, tSec, null, true);
          if (hasServerPads) {
            rendered = serverPerformDesk.render(rendered, perfCtx.clockTime, perfCtx.bpm, 1, cached.analysis, tSec);
          }
          const scale = clampVal((latestLiveState?.master ?? liveControl.state.master ?? 70) / 100, 0, 1);
          sendBarsToWled(rendered.bars, scale, 'fallback_timer').catch(() => {});
          return;
        }
        fallbackBusy = true;
        getCachedShow(trackId)
          .then(show => {
            if (!show || (!armed && !hasActiveCompanionClient())) return;
            const elapsedSec = latestLiveState?.isPlaying
              ? Math.max(0, (Date.now() - (latestLiveState.timestamp || Date.now())) / 1000)
              : 0;
            const durationLimit = show.analysis?.durationSec || show.timeline?.durationSec || Infinity;
            const tSec = Math.min(durationLimit, Math.max(0, (Number(latestLiveState?.timeSec) || 0) + elapsedSec));
            let rendered = renderTimelineFrame(show.timeline, show.analysis, tSec, null, true);
            if (serverPerformDesk.active.size > 0 || serverPerformDesk.touches.size > 0) {
              const pCtx = getServerPerfContext();
              rendered = serverPerformDesk.render(rendered, pCtx.clockTime, pCtx.bpm, 1, show.analysis, tSec);
            }
            const scale = clampVal((latestLiveState?.master ?? liveControl.state.master ?? 70) / 100, 0, 1);
            return sendBarsToWled(rendered.bars, scale, 'fallback_timer');
          })
          .catch(() => {})
          .finally(() => { fallbackBusy = false; });
        return;
      }
    }

    if (hasServerPads && browserFrameIdleMs > 35) {
      hadServerPadsActive = true;
      const trackId = latestLiveState?.trackId || liveControl.state.trackId;
      const cached = trackId ? serverShowCache.get(trackId) : null;
      const tSec = Math.max(0, Number(latestLiveState?.timeSec) || 0);
      const baseFrame = cached?.timeline
        ? renderTimelineFrame(cached.timeline, cached.analysis, tSec, null, true)
        : { bars: Object.fromEntries(BAR_IDS.map(barId => [barId, Array.from({ length: PIXELS_PER_BAR }, () => [0, 0, 0, 0])])) };
      const rendered = serverPerformDesk.render(baseFrame, perfCtx.clockTime, perfCtx.bpm, 1, cached?.analysis || null, perfCtx.songTime);
      const scale = clampVal((latestLiveState?.master ?? liveControl.state.master ?? 70) / 100, 0, 1);
      sendBarsToWled(rendered.bars, scale, 'companion_pads').catch(() => {});
      return;
    } else if (hadServerPadsActive && !hasServerPads && browserFrameIdleMs > 35) {
      hadServerPadsActive = false;
      const trackId = latestLiveState?.trackId || liveControl.state.trackId;
      const cached = trackId ? serverShowCache.get(trackId) : null;
      const tSec = Math.max(0, Number(latestLiveState?.timeSec) || 0);
      const clearBars = cached?.timeline
        ? renderTimelineFrame(cached.timeline, cached.analysis, tSec, null, true).bars
        : Object.fromEntries(BAR_IDS.map(barId => [barId, Array.from({ length: PIXELS_PER_BAR }, () => [0, 0, 0, 0])]));
      const scale = clampVal((latestLiveState?.master ?? liveControl.state.master ?? 70) / 100, 0, 1);
      sendBarsToWled(clearBars, scale, 'companion_pads_clear').catch(() => {});
      return;
    }

    // Keep companion preview updated at the current playhead even when paused or scrubbing
    if (hasCompanion && !dawActivelyPlaying && browserFrameIdleMs > 180 && (nowPerf - lastCompanionFramePushAt >= 240) && !fallbackBusy) {
      const trackId = latestLiveState?.trackId || liveControl.state.trackId;
      if (trackId) {
        const cached = serverShowCache.get(trackId);
        const tSec = Math.max(0, Number(latestLiveState?.timeSec) || 0);
        if (cached?.timeline) {
          const rendered = renderTimelineFrame(cached.timeline, cached.analysis, tSec, null, true);
          pushFrameToCompanionClients(rendered.bars, nowPerf, { isPreScaled: false });
        } else {
          fallbackBusy = true;
          getCachedShow(trackId)
            .then(show => {
              if (show?.timeline) {
                const rendered = renderTimelineFrame(show.timeline, show.analysis, tSec, null, true);
                pushFrameToCompanionClients(rendered.bars, performance.now(), { isPreScaled: false });
              }
            })
            .catch(() => {})
            .finally(() => { fallbackBusy = false; });
        }
      }
    }
  };
  const renderTimer = setInterval(renderHighRateTick, 16);
  renderTimer.unref();
  const timer = setInterval(() => {
    if (pruneLanPeers()) {
      broadcastLanPresence({ reason: 'idle_timeout' });
    }
    if (!armed || outputMode === 'ambient' || remoteStageOwner) return;
    const idleMs = performance.now() - lastFrame;
    const hasKnownClient =
      liveClients.size > 0 ||
      lanPeers.size > 0 ||
      Boolean(latestLiveState && Date.now() - (latestLiveState.timestamp || 0) < 30000);
    const effectiveWatchdogMs = hasKnownClient ? Math.max(watchdogMs * 20, 65000) : watchdogMs;
    if (idleMs > effectiveWatchdogMs) {
      const sendZerosOnTimeout = framesSentSinceArm > 0 && config.profile !== 'e8-columns';
      logEvent('WATCHDOG', 'IDLE_TIMEOUT', {
        idleMs: Math.round(idleMs),
        effectiveWatchdogMs,
        framesSentSinceArm,
        sendZeros: sendZerosOnTimeout,
        liveClients: liveClients.size,
        lanPeers: lanPeers.size
      });
      disarm('Prekid veze: izlaz ugašen', { sendZeros: sendZerosOnTimeout })
        .then(() => {
          restoreWledAfterShowStop('watchdog_timeout', { sendZeros: !sendZerosOnTimeout });
          broadcastLive('command', { type: 'hardware_sync', state: state() });
        })
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
          const clientId = parsedUrl.searchParams.get('clientId') || '';
          const clientName = parsedUrl.searchParams.get('clientName') || '';
          if (clientId) {
            touchLanPeer(clientId, { name: clientName || undefined, source: 'youtube' }, request);
          }
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
          const lanStatus = getLanStatus();
          return json(response, 200, {
            ok: true,
            online: true,
            track: matched ? { id: matched.id, name: matched.title, title: matched.title, bpm, durationSec, sharedOnly: Boolean(!track && sharedShow) } : null,
            importJob: importJob || null,
            mode: matched ? 'synced' : (extState.mode || 'idle'),
            master: liveControl.state.master ?? 70,
            blackout: Boolean(liveControl.state.blackout),
            armed: Boolean(armed),
            outputMode,
            ambientOverride: outputMode === 'ambient',
            theme: extState.theme,
            themes: SHOW_THEMES.map(t => ({ id: t.id, name: t.name, description: t.description })),
            isStageOwner: clientId ? canClientDriveStage(clientId) : !remoteStageOwner,
            lan: lanStatus
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
          // If videoId is provided, never match a different videoId via a stale DOM title
          let existing = videoId ? library.findTrackByVideo({ videoId }) : library.findTrackByVideo({ videoId, title });
          if (!existing && !videoId && title) {
            existing = library.findTrackByVideo({ title });
          }
          if (existing && (existing.status === 'ready' || existing.hasAnalysis)) {
            if (videoId && ytDownloader === downloadWithYtDlp) {
              const oembed = await fetchYouTubeOembedMeta(videoId, url);
              if (oembed?.title && oembed.title !== existing.title) {
                existing = await library.updateTrack(existing.id, { title: oembed.title }).catch(() => existing);
                broadcastLive('command', { type: 'library_updated', trackId: existing.id, action: 'rename' });
              }
            }
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
              const oembedPromise = (ytDownloader === downloadWithYtDlp && (videoId || targetUrl.includes('youtube.com/')))
                ? fetchYouTubeOembedMeta(videoId, targetUrl)
                : Promise.resolve(null);
              tempDir = await mkdtemp(join(tmpdir(), 'ledicated-yt-'));
              const finalMp3Path = await ytDownloader(targetUrl, tempDir, jobId, p => {
                job.progress = Math.max(job.progress, Math.min(55, p));
              });
              const infoMeta = await readYtDlpInfoMeta(tempDir, jobId);
              const oembedMeta = infoMeta || (await oembedPromise);
              const resolvedTitle = (infoMeta?.title || oembedMeta?.title || title || videoId || 'YouTube').trim();
              job.title = resolvedTitle;
              job.status = 'analyzing';
              job.progress = 65;
              job.message = 'Analiza stemova, waveforma i dionica…';
              const sharedMatch = await findSharedShow({ videoId, title: resolvedTitle });
              const imported = await library.importTrack(finalMp3Path, `${resolvedTitle}.mp3`, {
                videoId,
                sourceUrl: targetUrl,
                theme
              });
              if (imported.title !== resolvedTitle) {
                await library.updateTrack(imported.id, { title: resolvedTitle, ...(videoId ? { videoId, sourceUrl: targetUrl } : {}) }).catch(() => {});
              }
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
                  title: resolvedTitle,
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
              broadcastLive('command', { type: 'library_updated', trackId: readyTrack.id, action: 'import' });
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
          const { clientId, clientName, videoId, title, currentTime = 0, duration, paused = false, playbackRate = 1, liveMode, forceLiveStream = false, takeover = false, theme, stems } = input;
          const track = library.findTrackByVideo({ videoId, title });
          const sharedShow = (!track && !forceLiveStream) ? await findSharedShow({ videoId, title }) : null;
          const matched = track || sharedShow;

          let prevOwner = stageOwnerId;
          let prevPeerSnap = '';
          let syncedPeer = null;
          if (clientId) {
            const existing = lanPeers.get(String(clientId).trim());
            prevPeerSnap = existing ? `${existing.name}|${existing.trackTitle}|${existing.isPlaying}` : '';
            syncedPeer = touchLanPeer(clientId, {
              name: clientName,
              source: 'youtube',
              trackId: matched?.id || null,
              trackTitle: title || matched?.title || 'YouTube Video',
              videoId: videoId || null,
              isPlaying: Boolean(liveMode !== false && !paused),
              timeSec: Number(currentTime || 0),
              durationSec: Number(duration || matched?.durationSec || 0),
              bpm: matched?.bpm || null
            }, request);
          }

          if (takeover === true && liveMode !== false) {
            if (syncedPeer) {
              claimStageForPeer(syncedPeer, { takeover: true });
            } else {
              activateShowOutput({ forceWake: true, broadcast: true });
            }
            broadcastLanPresence({ reason: 'claim' });
          }

          if (liveMode === false) {
            const cid = clientId ? String(clientId).trim() : '';
            const wasOwner = !cid || stageOwnerId === cid;
            if (cid && stageOwnerId === cid) {
              releaseStageForPeer(cid);
            }
            if (wasOwner) {
              extState.mode = 'idle';
              extState.activeShow = null;
              extState.activeTrackId = null;
              extState.liveStems = null;
              extState.smoothedStems = null;
              extState.lastPaused = true;
              restoreWledAfterShowStop('ext_stop');
              liveControl.broadcastCommand({
                type: 'ext_sync',
                mode: 'idle',
                videoId,
                title,
                paused: true,
                liveMode: false
              });
            }
            if (cid) broadcastLanPresence({ reason: 'ext_stop' });
            return json(response, 200, {
              ok: true,
              mode: 'idle',
              trackId: matched?.id || null,
              importJob: (videoId && extJobs.get(videoId)) || null,
              isStageOwner: cid ? canClientDriveStage(cid) : !remoteStageOwner,
              lan: getLanStatus()
            });
          }

          if (clientId) {
            const updated = lanPeers.get(String(clientId).trim());
            const nextPeerSnap = updated ? `${updated.name}|${updated.trackTitle}|${updated.isPlaying}` : '';
            if (prevOwner !== stageOwnerId || prevPeerSnap !== nextPeerSnap) {
              broadcastLanPresence();
            }
          }

          const isReady = Boolean(((track && (track.status === 'ready' || track.hasAnalysis)) || sharedShow?.timeline) && !forceLiveStream);
          const canDrive = canClientDriveStage(clientId);
          if (!canDrive) {
            return json(response, 200, {
              ok: true,
              skipped: remoteStageOwner ? 'remote_stage_owner' : 'not_stage_owner',
              isStageOwner: false,
              mode: isReady ? 'synced' : 'live_stream',
              trackId: isReady ? matched.id : (matched?.id || null),
              track: matched ? { id: matched.id, name: matched.title, title: matched.title, bpm: matched.bpm, durationSec: matched.durationSec } : null,
              importJob: (videoId && extJobs.get(videoId)) || null,
              lan: getLanStatus()
            });
          }

          extState.lastSyncAt = Date.now();
          extState.lastSyncPerfMs = performance.now();
          if (videoId) extState.activeVideoId = videoId;
          if (typeof theme === 'string' && theme.trim()) extState.theme = theme.trim();
          const cid = clientId ? String(clientId).trim() : '';
          const dawPlayingLocally = Boolean(
            (!cid || stageOwnerId !== cid) &&
            latestLiveState?.isPlaying &&
            (Date.now() - (latestLiveState.timestamp || 0) < 3500)
          );
          extState.dawPlayingLocally = dawPlayingLocally;
          const shouldBroadcast = !dawPlayingLocally && (!paused || !extState.lastPaused || Math.abs(Number(currentTime || 0) - Number(extState.lastTime || 0)) > 0.08);
          if (!paused && outputMode === 'show' && !liveControl.state.blackout && !yieldedToRemote) {
            if (!armed) {
              activateShowOutput({ forceWake: true, broadcast: true, source: 'ext_sync' });
            } else if (extState.lastPaused !== false || !wledShowCarrierAwake) {
              for (const node of config.nodes.filter(n => n.host)) wakeWled(node.host);
            }
          } else if (paused && extState.lastPaused === false && !dawPlayingLocally && serverPerformDesk.active.size === 0 && serverPerformDesk.touches.size === 0) {
            restoreWledAfterShowStop('ext_pause');
          }
          extState.lastPaused = Boolean(paused);
          extState.lastTime = Number(currentTime || 0);
          extState.playbackRate = Number.isFinite(Number(playbackRate)) && Number(playbackRate) > 0 ? Number(playbackRate) : 1;
          if (isReady) {
            extState.mode = 'synced';
            extState.liveStems = null;
            extState.smoothedStems = null;
            if (!dawPlayingLocally && track) liveControl.state.trackId = track.id;
            const show = track ? await getCachedShow(track.id).catch(() => null) : { timeline: sharedShow.timeline, analysis: sharedShow.analysis };
            extState.activeTrackId = track ? track.id : null;
            extState.activeShow = show?.timeline ? show : null;
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
            if (!paused && !dawPlayingLocally && armed && outputMode === 'show' && (liveControl.clientCount === 0 || performance.now() - lastClientFrame > 35) && !liveControl.state.blackout && show?.timeline) {
              const rendered = renderTimelineFrame(show.timeline, show.analysis, Math.max(0, Number(currentTime) || 0), null, true);
              await sendBarsToWled(rendered.bars, (liveControl.state.master ?? 70) / 100, 'ext_synced').catch(() => {});
            }
          } else {
            extState.mode = 'live_stream';
            extState.activeShow = null;
            extState.activeTrackId = null;
            extState.liveStems = stems || null;
            if (!extState.smoothedStems && stems) extState.smoothedStems = { ...stems };
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
            if (!paused && !dawPlayingLocally && armed && outputMode === 'show' && (liveControl.clientCount === 0 || performance.now() - lastClientFrame > 35) && !liveControl.state.blackout) {
              const liveFrame = renderLiveStemFrame(extState.smoothedStems || stems, currentTime, theme || extState.theme, false);
              await sendBarsToWled(liveFrame.bars, (liveControl.state.master ?? 70) / 100, 'ext_live_stream').catch(() => {});
            }
          }
          return json(response, 200, {
            ok: true,
            isStageOwner: true,
            armed: Boolean(armed),
            outputMode,
            ambientOverride: outputMode === 'ambient',
            mode: extState.mode,
            trackId: isReady ? matched.id : (matched?.id || null),
            track: matched ? { id: matched.id, name: matched.title, title: matched.title, bpm: matched.bpm, durationSec: matched.durationSec } : null,
            importJob: (videoId && extJobs.get(videoId)) || null,
            lan: getLanStatus()
          });
        }
        if (pathname === '/api/ext/control') {
          const { clientId, clientName, claimStage, releaseStage, takeover, outputMode: reqOutputMode, master, blackout, armed: reqArmed, theme, allowedPresets, regenerate, useGemini, videoId, title } = input;
          if (clientId) {
            const peer = touchLanPeer(clientId, {
              name: clientName,
              source: 'youtube',
              ...(videoId ? { videoId } : {}),
              ...(title ? { trackTitle: title } : {})
            }, request);
            if ((claimStage === true || takeover === true) && peer) {
              claimStageForPeer(peer, { takeover: true });
              broadcastLanPresence({ reason: 'claim' });
            } else if (releaseStage === true && peer) {
              releaseStageForPeer(peer.clientId);
              pruneLanPeers();
              broadcastLanPresence({ reason: 'release' });
            } else if (clientName) {
              broadcastLanPresence();
            }
          } else if (claimStage === true || takeover === true) {
            activateShowOutput({ forceWake: true, clearBlackout: true, broadcast: true });
            broadcastLanPresence({ reason: 'claim' });
          }
          if (reqOutputMode === 'ambient') {
            activateAmbientOutput({ restorePresetOnE8: true, broadcast: true });
          } else if (reqOutputMode === 'show') {
            activateShowOutput({ forceWake: true, clearBlackout: true, broadcast: true });
            broadcastLanPresence({ reason: 'mode_show' });
          }
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
              liveControl.broadcastCommand({ type: 'hardware_sync', state: state() });
              broadcastLanPresence({ reason: 'disarm' });
            } else {
              activateShowOutput({ forceWake: true, broadcast: true });
              broadcastLanPresence({ reason: 'arm' });
            }
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
              if (extState.activeTrackId === targetTrack.id) {
                extState.activeShow = { timeline: directed.timeline, analysis };
              }
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
            outputMode,
            ambientOverride: outputMode === 'ambient',
            theme: extState.theme,
            isStageOwner: clientId ? canClientDriveStage(clientId) : !remoteStageOwner,
            lan: getLanStatus()
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
        if ((request.method === 'GET' || request.method === 'HEAD') && /^\/api\/library\/artwork\/[a-f0-9-]{36}$/.test(pathname)) {
          const id = pathname.split('/').at(-1);
          const track = await library.getTrack(id).catch(() => null);
          if (!track) return json(response, 404, { error: 'Pjesma ne postoji.' });
          const artPath = await resolveTrackArtwork(track, library, peerFetcher);
          if (!artPath) {
            response.writeHead(404, { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
            return response.end();
          }
          const st = await stat(artPath).catch(() => null);
          if (!st || st.size === 0) {
            response.writeHead(404, { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
            return response.end();
          }
          response.writeHead(200, {
            'Content-Type': 'image/jpeg',
            'Content-Length': st.size,
            'Cache-Control': 'public, max-age=86400',
            'X-Content-Type-Options': 'nosniff'
          });
          if (request.method === 'HEAD') return response.end();
          const stream = createReadStream(artPath);
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
          const forceRefresh = parsedUrl.searchParams.get('refresh') === '1';
          const snapshot = await cloudSync.getCatalogSnapshot({ forceRefresh });
          return json(response, 200, snapshot);
        }
        if (request.method === 'GET' && pathname === '/api/library/versions') {
          const trackId = parsedUrl.searchParams.get('trackId') || '';
          let showId = parsedUrl.searchParams.get('showId') || '';
          if (!showId && trackId) {
            const track = await library.getTrack(trackId).catch(() => null);
            if (track) showId = track.showId || computeShowId(track);
          }
          if (!showId) return json(response, 400, { error: 'Nedostaje showId ili trackId.' });
          const history = await cloudSync.getVersionsForShow(showId);
          return json(response, 200, {
            ok: true,
            showId: history.showId,
            title: history.title,
            latestVersion: history.latestVersion,
            versions: history.versions
          });
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
        if (request.method === 'POST' && /^\/api\/library\/(analyze|timeline|sections|track|set|set-update|set-delete|track-delete|share-to-git|install-shared-show|restore-version)$/.test(pathname)) {
          const { bytes: bodyBytes, data: input } = await readJsonBody(request, 32 * 1024 * 1024);
          if (pathname === '/api/library/share-to-git') {
            const targetId = input.trackId || input.id;
            const track = await library.getTrack(targetId);
            const analysis = await library.getAnalysis(targetId).catch(() => null);
            let timeline = await library.getTimeline(targetId).catch(() => null);
            if (!timeline && analysis) timeline = createAutoShow(analysis);
            if (!timeline) return json(response, 400, { error: 'Pjesma još nema show za dijeljenje.' });
            normalizeTimeline(timeline);
            const author = (typeof input.author === 'string' && input.author.trim()) ? input.author.trim() : (track.author || 'Studio');
            const pub = await cloudSync.publishShowSave({
              track,
              analysis,
              timeline,
              author,
              clientId: input.clientId || '',
              note: input.note || '',
              action: 'share',
              forceNewVersion: Boolean(input.forceNewVersion)
            });
            await library.updateTrack(track.id, {
              author,
              updatedBy: author,
              version: pub.version,
              showId: pub.showId,
              lastSummary: pub.summary
            }).catch(() => {});
            sharedShowsIndexCache = null;
            logEvent('SAVE', 'SHARE_TO_GIT', { trackId: track.id, filename: pub.filename, author, version: pub.version });
            broadcastLive('command', { type: 'library_updated', trackId: track.id, action: 'share_to_git', version: pub.version });
            return json(response, 200, { ok: true, filename: pub.filename, showId: pub.showId, version: pub.version, summary: pub.summary, author });
          }
          if (pathname === '/api/library/restore-version') {
            const targetTrackId = input.trackId || input.id || '';
            const track = targetTrackId ? await library.getTrack(targetTrackId).catch(() => null) : null;
            const showId = input.showId || (track ? (track.showId || computeShowId(track)) : '');
            const targetVer = Number(input.version);
            if (!showId || !Number.isInteger(targetVer) || targetVer < 1) {
              return json(response, 400, { error: 'Neispravan showId ili broj verzije.' });
            }
            const payload = await cloudSync.fetchFullShowPayload(showId, targetVer);
            if (!payload?.timeline) return json(response, 404, { error: `Verzija v${targetVer} nije pronađena.` });
            normalizeTimeline(payload.timeline);
            const author = (typeof input.author === 'string' && input.author.trim()) ? input.author.trim() : 'Studio';
            let matchedTrack = track || library.findTrackByVideo({
              sha256: payload.track?.sha256,
              videoId: payload.track?.videoId,
              title: payload.track?.title
            });
            const existingAnalysis = matchedTrack ? await library.getAnalysis(matchedTrack.id).catch(() => null) : payload.analysis;
            const pub = await cloudSync.publishShowSave({
              track: matchedTrack || payload.track,
              analysis: existingAnalysis || payload.analysis,
              timeline: payload.timeline,
              author,
              clientId: input.clientId || '',
              note: `Vraćena verzija v${targetVer}`,
              action: 'restore',
              forceNewVersion: true
            });
            if (matchedTrack) {
              await library.saveTimeline(matchedTrack.id, payload.timeline, {
                author,
                updatedBy: author,
                version: pub.version,
                showId: pub.showId,
                lastSummary: pub.summary
              });
              serverShowCache.delete(matchedTrack.id);
              matchedTrack = await library.getTrack(matchedTrack.id);
            }
            sharedShowsIndexCache = null;
            logEvent('SAVE', 'RESTORE_VERSION', { showId, restoredFrom: targetVer, newVersion: pub.version, author });
            broadcastLive('command', { type: 'library_updated', trackId: matchedTrack?.id || null, action: 'restore_version', version: pub.version });
            if (matchedTrack) {
              broadcastLive('command', {
                type: 'timeline_op',
                trackId: matchedTrack.id,
                op: 'replace',
                timeline: payload.timeline,
                label: `Vraćena verzija v${targetVer} (→ v${pub.version})`
              });
            }
            return json(response, 200, {
              ok: true,
              track: matchedTrack,
              timeline: payload.timeline,
              version: pub.version,
              restoredFrom: targetVer,
              summary: pub.summary
            });
          }
          if (pathname === '/api/library/install-shared-show') {
            let bundle = null;
            let safeFile = input.filename ? basename(String(input.filename)) : '';
            if (input.showId) {
              bundle = await cloudSync.fetchFullShowPayload(String(input.showId), input.version ?? null);
              if (!safeFile) safeFile = `${sanitizeFilename(bundle.track?.title || input.showId)}.ledshow.json`;
            } else {
              if (!safeFile.endsWith('.ledshow.json')) return json(response, 400, { error: 'Neispravan naziv .ledshow.json datoteke.' });
              const cloudEntry = cloudSync.getByFilename(safeFile);
              if (cloudEntry?.showId) {
                bundle = await cloudSync.fetchFullShowPayload(cloudEntry.showId, input.version ?? null).catch(() => null);
              }
              if (!bundle) {
                const raw = await readFile(join(sharedShowsDir, safeFile), 'utf8');
                const rawObj = JSON.parse(raw);
                const parsed = decodeShowJson(rawObj);
                bundle = {
                  ...parsed,
                  showId: rawObj.showId || computeShowId(parsed.track),
                  version: rawObj.version || 1,
                  summary: rawObj.summary || '',
                  audioUrl: rawObj.audioUrl || null
                };
              }
            }
            let matched = (input.targetTrackId || input.trackId)
              ? await library.getTrack(input.targetTrackId || input.trackId).catch(() => null)
              : null;
            if (!matched) {
              matched = library.findTrackByVideo({
                sha256: bundle.track?.sha256,
                videoId: bundle.track?.videoId,
                title: bundle.track?.title
              });
            }
            // 1. Fast direct HTTP download of exact audio file from Cloud/GitHub Release if available
            if (!matched && input.downloadAudio !== false && bundle.audioUrl) {
              try {
                const audioRes = await peerFetcher(bundle.audioUrl, { signal: AbortSignal.timeout(20000) });
                if (audioRes && audioRes.ok) {
                  const audioBuf = Buffer.from(await audioRes.arrayBuffer());
                  if (audioBuf.byteLength > 1024) {
                    matched = await library.importBuffer(
                      bundle.track?.originalName || `${bundle.track?.title || 'song'}.mp3`,
                      audioBuf,
                      {
                        videoId: bundle.track?.videoId,
                        sourceUrl: bundle.track?.sourceUrl,
                        theme: bundle.track?.theme,
                        author: bundle.author,
                        updatedBy: bundle.author,
                        version: bundle.version || 1,
                        showId: bundle.showId
                      }
                    );
                    const fullAnalysis = await library.analyzeTrack(matched.id);
                    if (bundle.analysis?.sections?.length) {
                      fullAnalysis.sections = bundle.analysis.sections;
                      await library.saveAnalysis(matched.id, fullAnalysis);
                    }
                  }
                }
              } catch {}
            }
            // 2. Fallback to yt-dlp (by sourceUrl, videoId, or ytsearch1:<Title>)
            if (!matched && input.downloadAudio !== false && (bundle.track?.sourceUrl || bundle.track?.videoId || bundle.track?.title)) {
              const targetUrl = bundle.track.sourceUrl ||
                (bundle.track.videoId ? `https://www.youtube.com/watch?v=${bundle.track.videoId}` : `ytsearch1:${bundle.track.title}`);
              let tempDir = null;
              try {
                tempDir = await mkdtemp(join(tmpdir(), 'ledicated-shared-'));
                const mp3Path = await ytDownloader(targetUrl, tempDir, randomUUID());
                matched = await library.importTrack(mp3Path, bundle.track.originalName || `${bundle.track.title}.mp3`, {
                  videoId: bundle.track.videoId,
                  sourceUrl: bundle.track.sourceUrl,
                  theme: bundle.track.theme,
                  author: bundle.author,
                  updatedBy: bundle.author,
                  version: bundle.version || 1,
                  showId: bundle.showId
                });
                const fullAnalysis = await library.analyzeTrack(matched.id);
                if (bundle.analysis?.sections?.length) {
                  fullAnalysis.sections = bundle.analysis.sections;
                  await library.saveAnalysis(matched.id, fullAnalysis);
                }
              } catch {} finally {
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
            if (bundle.analysis?.sections?.length) {
              const existingAnalysis = (await library.getAnalysis(matched.id).catch(() => null)) || bundle.analysis;
              await library.saveAnalysis(matched.id, { ...existingAnalysis, sections: bundle.analysis.sections });
            }
            normalizeTimeline(bundle.timeline);
            await library.saveTimeline(matched.id, bundle.timeline, {
              author: bundle.author || 'Studio',
              updatedBy: bundle.author || 'Studio',
              version: bundle.version || 1,
              showId: bundle.showId || computeShowId(matched),
              lastSummary: bundle.summary || ''
            });
            serverShowCache.delete(matched.id);
            const finalTrack = await library.getTrack(matched.id);
            logEvent('SAVE', 'INSTALL_SHARED_SHOW', { trackId: finalTrack.id, filename: safeFile, version: bundle.version || 1 });
            broadcastLive('command', { type: 'library_updated', trackId: finalTrack.id, action: 'install_shared', version: bundle.version || 1 });
            broadcastLive('command', { type: 'timeline_op', trackId: finalTrack.id, op: 'replace', timeline: bundle.timeline, label: `Show: ${finalTrack.title} (v${bundle.version || 1})` });
            return json(response, 200, { ok: true, track: finalTrack, version: bundle.version || 1 });
          }
          if (pathname === '/api/library/analyze') {
            const runAnalysis = async () => {
              const t0 = performance.now();
              const audioPath = await library.getAudioPath(input.id);
              const analysis = await analyzeAudio(audioPath);
              await library.setAnalysis(input.id, analysis);
              serverShowCache.delete(input.id);
              logEvent('SAVE', 'ANALYZE_COMPLETED', { trackId: input.id, bpm: analysis.bpm, durationSec: analysis.durationSec, durationMs: Math.round(performance.now() - t0) });
              return analysis;
            };
            const job = analysisQueue.then(runAnalysis);
            analysisQueue = job.catch(() => {});
            const analysis = await job;
            return json(response, 200, { analysis });
          }
          if (pathname === '/api/library/timeline') {
            const t0 = performance.now();
            if (input.timeline && typeof input.timeline === 'object') {
              sanitizeTimelineClips(input.timeline);
            }
            const checked = validateTimeline(input.timeline);
            if (!checked.valid) {
              logEvent('VALIDATION_ERROR', 'TIMELINE_SAVE_REJECTED', {
                trackId: input.id || null,
                errors: checked.errors.slice(0, 5),
                clientId: input.clientId || null,
                bytes: bodyBytes
              });
              return json(response, 400, { error: checked.errors[0], errors: checked.errors });
            }
            const track = await library.getTrack(input.id);
            const analysis = await library.getAnalysis(input.id).catch(() => null);
            const author = (typeof input.author === 'string' && input.author.trim()) ? input.author.trim() : (track.updatedBy || track.author || 'Studio');
            const pub = await cloudSync.publishShowSave({
              track,
              analysis,
              timeline: input.timeline,
              author,
              clientId: input.clientId || '',
              note: input.note || '',
              action: 'save',
              forceNewVersion: Boolean(input.forceVersion)
            });
            await library.saveTimeline(input.id, input.timeline, {
              author,
              updatedBy: author,
              version: pub.version,
              showId: pub.showId,
              lastSummary: pub.summary
            });
            serverShowCache.delete(input.id);
            sharedShowsIndexCache = null;
            const layerCount = input.timeline.layers?.length || 0;
            const clipCount = (input.timeline.layers || []).reduce((sum, l) => sum + (l.clips?.length || 0), 0);
            logEvent('SAVE', 'TIMELINE_SAVED', {
              trackId: input.id,
              version: pub.version,
              showId: pub.showId,
              layerCount,
              clipCount,
              bytes: bodyBytes,
              durationMs: Math.round(performance.now() - t0),
              clientId: input.clientId || null,
              author
            });
            broadcastLive('command', {
              type: 'timeline_updated',
              trackId: input.id,
              version: pub.version,
              summary: pub.summary,
              clientId: input.clientId || null,
              author,
              timeline: input.timeline
            }, { excludeClientId: input.clientId || null });
            return json(response, 200, {
              ok: true,
              version: pub.version,
              showId: pub.showId,
              summary: pub.summary,
              updatedBy: author,
              updatedAt: pub.updatedAt
            });
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
            logEvent('SAVE', 'SECTIONS_SAVED', { trackId: input.id, sectionCount: input.sections.length });
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
        if ((pathname === '/api/live/stream' || pathname === '/api/live/events') && request.method === 'GET') {
          response.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            'Connection': 'keep-alive',
            'X-Content-Type-Options': 'nosniff'
          });
          response.write(': connected\n\n');
          const clientId = parsedUrl.searchParams.get('clientId') || '';
          const clientName = parsedUrl.searchParams.get('name') || '';
          const isCompanionClient = /^(ios-|iphone-)/.test(clientId) || parsedUrl.searchParams.get('role') === 'companion' || /Pad/i.test(clientName);
          response.clientId = clientId || null;
          response.isCompanionClient = isCompanionClient;
          liveClients.add(response);
          if (clientId && !isCompanionClient) {
            touchLanPeer(clientId, { name: clientName, sseRes: response }, request);
            broadcastLanPresence();
          } else {
            if (clientId && lanPeers.has(clientId)) {
              lanPeers.delete(clientId);
            }
            if (isCompanionClient) {
              touchCompanionDevice(clientId || 'ios-pad', {
                name: clientName || 'iPhone Pad',
                latencyMs: parsedUrl.searchParams.get('latencyMs'),
                sseConnected: true
              }, request);
              broadcastLanPresence();
            }
            response.write(`event: command\ndata: ${JSON.stringify({ type: 'lan_presence', ...getLanStatus() })}\n\n`);
            const snap = getPadsSnapshot();
            response.write(`event: command\ndata: ${JSON.stringify({ type: 'pads_sync', pads: snap.pads, quantize: snap.quantize, activePads: snap.activePads, heldPads: snap.heldPads })}\n\n`);
          }
          request.on('close', () => {
            liveClients.delete(response);
            if (clientId && lanPeers.has(clientId)) {
              const peer = lanPeers.get(clientId);
              if (peer.sseRes === response) peer.sseRes = null;
              broadcastLanPresence();
            } else if (isCompanionClient) {
              if (clientId && companionDevices.has(clientId)) {
                companionDevices.delete(clientId);
              }
              broadcastLanPresence();
            }
          });
          return;
        }
        if (pathname === '/api/live/state' && request.method === 'GET') {
          return json(response, 200, {
            ok: true,
            ...(latestLiveState || {}),
            color: serverPerformDesk.color,
            intensity: serverPerformDesk.intensity,
            lan: getLanStatus()
          });
        }
        if (pathname === '/api/live/status' && request.method === 'GET') {
          return json(response, 200, {
            ok: true,
            browserConnected: liveClients.size > 0,
            clientCount: liveClients.size,
            liveState: latestLiveState,
            serverState: state(),
            pads: getPadsSnapshot(),
            lan: getLanStatus()
          });
        }
        if (pathname === '/api/live/pads' && request.method === 'GET') {
          return json(response, 200, {
            ok: true,
            ...getPadsSnapshot(),
            liveState: latestLiveState,
            serverState: state(),
            lan: getLanStatus()
          });
        }
        if (pathname === '/api/lan/status' && request.method === 'GET') {
          return json(response, 200, { ok: true, ...getLanStatus() });
        }
        if (pathname === '/api/live/frame' && request.method === 'GET') {
          try {
            const hasExplicitTime = parsedUrl.searchParams.has('time');
            const hasExplicitTrack = parsedUrl.searchParams.has('trackId');
            const perfCtx = getServerPerfContext();
            serverPerformDesk.tick(perfCtx);
            let timeSec = hasExplicitTime ? Number(parsedUrl.searchParams.get('time')) : perfCtx.songTime;
            let trackId = parsedUrl.searchParams.get('trackId') || latestLiveState?.trackId || null;
            let frame = null;

            if (!hasExplicitTime && !hasExplicitTrack && lastDispatchedBars && (performance.now() - lastDispatchedAt < 180)) {
              frame = { bars: lastDispatchedBars };
            } else {
              await library.init();
              if (!trackId) trackId = (await library.list())[0]?.id || null;
              let analysis = null;
              if (trackId) {
                const cached = await getCachedShow(trackId);
                if (cached?.timeline) {
                  analysis = cached.analysis;
                  frame = renderTimelineFrame(cached.timeline, analysis, timeSec, null, true);
                } else {
                  const timeline = await library.getTimeline(trackId);
                  analysis = await library.getAnalysis(trackId).catch(() => null);
                  frame = renderTimelineFrame(timeline, analysis, timeSec);
                }
              } else {
                frame = {
                  bars: Object.fromEntries(BAR_IDS.map(barId => [barId, Array.from({ length: PIXELS_PER_BAR }, () => [0, 0, 0, 0])]))
                };
              }
              if (serverPerformDesk.active.size > 0 || serverPerformDesk.touches.size > 0) {
                frame = serverPerformDesk.render(frame, perfCtx.clockTime, perfCtx.bpm, 1, analysis, perfCtx.songTime);
              }
            }
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
            return json(response, 200, { ok: true, trackId: trackId || null, timeSec, frame, watts, channels, pads: getPadsSnapshot() });
          } catch (err) {
            return json(response, 400, { ok: false, error: err.message });
          }
        }
        if (request.method === 'GET' && pathname === '/api/logs') {
          const limit = Math.max(1, Math.min(2000, Number(parsedUrl.searchParams.get('limit') || parsedUrl.searchParams.get('lines')) || 150));
          const format = parsedUrl.searchParams.get('format') || 'json';
          const categoryFilter = (parsedUrl.searchParams.get('category') || '').trim().toUpperCase();
          const searchFilter = (parsedUrl.searchParams.get('search') || '').trim().toLowerCase();
          const catList = categoryFilter ? categoryFilter.split(',').map(s => s.trim()).filter(Boolean) : [];
          let diskTail = [];
          try {
            const raw = await readFile(logFilePath, 'utf8');
            let lines = raw.trim().split('\n').filter(Boolean);
            if (catList.length) {
              lines = lines.filter(l => catList.some(c => l.toUpperCase().includes(`[${c}]`) || l.toUpperCase().includes(c)));
            }
            if (searchFilter) {
              lines = lines.filter(l => l.toLowerCase().includes(searchFilter));
            }
            diskTail = lines.slice(-limit);
          } catch {}
          if (format === 'text') {
            response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
            return response.end(`${diskTail.join('\n')}\n`);
          }
          let filteredRecent = recentLogs;
          if (catList.length) {
            filteredRecent = filteredRecent.filter(e => catList.some(c => String(e.category || '').toUpperCase().includes(c) || String(e.action || '').toUpperCase().includes(c)));
          }
          if (searchFilter) {
            filteredRecent = filteredRecent.filter(e => JSON.stringify(e).toLowerCase().includes(searchFilter));
          }
          const errorLogs = recentLogs.filter(e => /ERROR|CRASH|FAIL|REJECT/i.test(`${e.category} ${e.action}`)).slice(-50);
          return json(response, 200, {
            ok: true,
            logFile: logFilePath,
            count: filteredRecent.length,
            recent: filteredRecent.slice(-limit),
            errors: errorLogs,
            diskLines: diskTail
          });
        }
        if (request.method === 'GET' && pathname === '/api/state') return json(response, 200, state());
        if (request.method === 'GET' && pathname === '/api/ambient-light') {
          const forceProbe = parsedUrl.searchParams.get('probe') !== '0';
          return json(response, 200, await queryAmbientLightStatus({ forceProbe }));
        }
        if (request.method === 'GET' && pathname === '/api/profiles') return json(response, 200, { profiles: HARDWARE_PROFILES.map(profile => ({ id: profile.id, label: profile.label, description: profile.description, config: defaultConfig(profile.id) })) });
        if (request.method === 'GET' && pathname === '/api/generators') {
          await mkdir(generatorsDir, { recursive: true }).catch(() => {});
          const files = await readdir(generatorsDir).catch(() => []);
          const shared = [];
          for (const file of files) {
            if (!file.endsWith('.generator.json')) continue;
            try {
              const raw = await readFile(join(generatorsDir, file), 'utf8');
              const parsed = JSON.parse(raw);
              const check = validateGeneratorSpec(parsed);
              if (check.valid) {
                shared.push({ ...parsed, filename: file, builtin: false, gitShared: true });
              }
            } catch {}
          }
          return json(response, 200, {
            ok: true,
            builtin: BUILT_IN_GENERATORS,
            shared,
            generatorsDir
          });
        }
        if (request.method !== 'POST') return json(response, 405, { error: 'Metoda nije podržana.' });
        const { data: input } = await readJsonBody(request, 16 * 1024 * 1024);
        if (pathname === '/api/generators/save') {
          await mkdir(generatorsDir, { recursive: true });
          const spec = serializeGeneratorSpec(input.meta || input, input.config || input);
          const check = validateGeneratorSpec(spec);
          if (!check.valid) {
            return json(response, 400, { ok: false, error: check.errors.join(' ') });
          }
          const filename = `${sanitizeFilename(spec.id)}.generator.json`;
          const targetPath = join(generatorsDir, filename);
          await writeFile(targetPath, `${JSON.stringify(spec, null, 2)}\n`, 'utf8');
          logEvent('SAVE', 'GENERATOR_SAVED', { id: spec.id, name: spec.name, filename });
          return json(response, 200, {
            ok: true,
            generator: { ...spec, filename, builtin: false, gitShared: true },
            path: `studio-light-baseline/app/generators/${filename}`
          });
        }
        if (pathname === '/api/generators/delete') {
          const rawId = String(input.id || input.filename || '').replace(/\.generator\.json$/i, '');
          const filename = `${sanitizeFilename(rawId)}.generator.json`;
          const targetPath = join(generatorsDir, filename);
          await rm(targetPath, { force: true });
          return json(response, 200, { ok: true, deleted: filename });
        }
        if (pathname === '/api/live/pads') {
          if (Array.isArray(input.pads)) {
            for (let idx = 0; idx < 12; idx++) {
              syncServerPadSlot(idx, input.pads[idx]);
            }
          }
          if (typeof input.quantize === 'boolean') {
            serverPerformDesk.setQuantize(input.quantize);
          }
          const snap = getPadsSnapshot();
          broadcastLive('command', {
            type: 'pads_sync',
            clientId: input.clientId || null,
            pads: snap.pads,
            quantize: snap.quantize
          });
          return json(response, 200, { ok: true, ...snap });
        }
        if (pathname === '/api/live/state') {
          let prevPeerSnap = '';
          const prevOwner = stageOwnerId;
          if (input.clientId) {
            const existing = lanPeers.get(String(input.clientId));
            prevPeerSnap = existing ? `${existing.name}|${existing.trackId}|${existing.isPlaying}|${existing.hasActivePads}` : '';
            touchLanPeer(input.clientId, {
              name: input.clientName,
              source: input.source || 'daw',
              trackId: input.trackId,
              trackTitle: input.trackTitle,
              isPlaying: input.isPlaying,
              hasActivePads: Array.isArray(input.activePads) && input.activePads.length > 0,
              timeSec: input.timeSec,
              durationSec: input.durationSec,
              bpm: input.bpm
            }, request);
            const updated = lanPeers.get(String(input.clientId));
            const nextPeerSnap = updated ? `${updated.name}|${updated.trackId}|${updated.isPlaying}|${updated.hasActivePads}` : '';
            if (prevPeerSnap !== nextPeerSnap || prevOwner !== stageOwnerId) broadcastLanPresence();
            cloudSync.updatePresence({
              clientId: String(input.clientId),
              name: input.clientName || updated?.name || 'Kolega',
              activeShowId: input.showId || (input.trackTitle ? computeShowId({ title: input.trackTitle }) : ''),
              activeShowTitle: input.trackTitle || '',
              status: input.isPlaying ? 'playing' : 'editing',
              isPlaying: Boolean(input.isPlaying),
              version: Number(input.version) || 1,
              bpm: Number(input.bpm) || 120,
              timeSec: Number(input.timeSec) || 0
            }).catch(() => {});
          }
          const isStageOwner = canClientDriveStage(input.clientId);
          if (isStageOwner) {
            const wasActive = Boolean(latestLiveState?.isPlaying || (Array.isArray(latestLiveState?.activePads) && latestLiveState.activePads.length > 0));
            const nowActive = Boolean(input.isPlaying || (Array.isArray(input.activePads) && input.activePads.length > 0));
            latestLiveState = { ...input, timestamp: Date.now() };
            if (Array.isArray(input.pads)) {
              for (let idx = 0; idx < 12; idx++) {
                syncServerPadSlot(idx, input.pads[idx]);
              }
              const nextPadsJson = JSON.stringify(input.pads);
              if (nextPadsJson !== lastSyncedDawPadsJson) {
                lastSyncedDawPadsJson = nextPadsJson;
                const snap = getPadsSnapshot();
                broadcastLive('command', {
                  type: 'pads_sync',
                  clientId: input.clientId || null,
                  pads: snap.pads,
                  quantize: snap.quantize,
                  activePads: snap.activePads,
                  heldPads: snap.heldPads
                });
              }
            }
            if (typeof input.quantize === 'boolean') {
              serverPerformDesk.setQuantize(input.quantize);
            }
            if (Number.isFinite(input.master)) liveControl.state.master = input.master;
            if (typeof input.blackout === 'boolean') liveControl.state.blackout = input.blackout;
            if (input.trackId) liveControl.state.trackId = input.trackId;
            if (armed && input.armed) lastFrame = performance.now();
            if (input.takeover === true || (!wasActive && nowActive && !liveControl.state.blackout)) {
              activateShowOutput({ forceWake: true, broadcast: true });
              broadcastLanPresence({ reason: 'daw_play' });
            } else if (wasActive && !nowActive && serverPerformDesk.active.size === 0 && serverPerformDesk.touches.size === 0 && !liveControl.state.blackout) {
              restoreWledAfterShowStop('daw_stop');
            }
          }
          const lanStat = getLanStatus();
          return json(response, 200, {
            ok: true,
            isStageOwner,
            ...lanStat
          });
        }
        if (pathname === '/api/lan/claim-stage') {
          const cid = String(input.clientId || '').trim();
          if (!cid) return json(response, 400, { error: 'Nedostaje clientId.' });
          const peer = touchLanPeer(cid, { name: input.name, source: input.source }, request);
          if (input.release === true) {
            releaseStageForPeer(cid);
            pruneLanPeers();
            broadcastLanPresence({ reason: 'release' });
          } else {
            claimStageForPeer(peer, { takeover: true });
            broadcastLanPresence({ reason: 'claim' });
          }
          return json(response, 200, {
            ok: true,
            isStageOwner: canClientDriveStage(cid),
            ...getLanStatus()
          });
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
          if (isCompanionPadSource(input.source) || /^(ios-|iphone-)/.test(String(input.clientId || ''))) {
            touchCompanionDevice(input.clientId || 'ios-pad', {
              name: input.clientName || 'iPhone Pad',
              latencyMs: input.latencyMs
            }, request);
            if (input.type === 'companion_ping') {
              broadcastLanPresence();
              return json(response, 200, { ok: true, serverTime: Date.now() });
            }
          }
          if (input.type === 'ambient_light') {
            const res = await applyAmbientLightState(input);
            return json(response, 200, res);
          }
          if (input.type === 'timeline_op') {
            await library.init();
            const trackId = input.trackId || latestLiveState?.trackId || (await library.list())[0]?.id;
            if (!trackId) return json(response, 404, { error: 'Nema odabrane pjesme za izmjenu vremenske trake.' });
            let timeline;
            let result = null;
            if (input.timeline && !input.op) {
              normalizeTimeline(input.timeline);
              const check = validateTimeline(input.timeline);
              if (!check.valid) {
                logEvent('VALIDATION_ERROR', 'REMOTE_TIMELINE_REPLACE_REJECTED', { trackId, errors: check.errors.slice(0, 5) });
                return json(response, 400, { error: check.errors[0], errors: check.errors });
              }
              timeline = input.timeline;
              result = { ok: true, layerCount: timeline.layers.length, clipCount: timeline.layers.reduce((sum, l) => sum + l.clips.length, 0) };
            } else {
              timeline = await library.getTimeline(trackId);
              const analysis = await library.getAnalysis(trackId).catch(() => null);
              if (!timeline && analysis) timeline = createAutoShow(analysis);
              if (!timeline) return json(response, 404, { error: 'Pjesma još nema vremensku traku.' });
              result = applyTimelineOp(timeline, input.op, input.args, analysis);
              normalizeTimeline(timeline);
              const check = validateTimeline(timeline);
              if (!check.valid) {
                logEvent('VALIDATION_ERROR', 'REMOTE_TIMELINE_OP_REJECTED', { trackId, op: input.op, errors: check.errors.slice(0, 5) });
                return json(response, 400, { error: check.errors[0], errors: check.errors });
              }
            }
            await library.saveTimeline(trackId, timeline);
            serverShowCache.delete(trackId);
            logEvent('SAVE', 'REMOTE_TIMELINE_OP', {
              trackId,
              op: input.op || 'replace',
              layerCount: timeline.layers?.length || 0,
              clipCount: (timeline.layers || []).reduce((sum, l) => sum + (l.clips?.length || 0), 0)
            });
            broadcastLive('command', { type: 'timeline_op', trackId, op: input.op || 'replace', args: input.args, timeline, label: input.label || input.op || 'Učitavanje showa' });
            return json(response, 200, { ok: true, trackId, result, clientCount: liveClients.size });
          }
          if (input.type === 'blackout' && (input.value === true || input.value === undefined)) {
            serverPerformDesk.clear();
            if (testRunning) { testAbort = true; stopTest?.(); await testSettled; }
            await disarm('Blackout');
          }
          if (input.type === 'select_track' || input.type === 'play_show') {
            await library.init();
            const targetTrackId = String(input.trackId || '').trim();
            if (targetTrackId) {
              const track = await library.getTrack(targetTrackId).catch(() => null);
              const show = await getCachedShow(targetTrackId).catch(() => null);
              const wantPlay = Boolean(input.autoPlay || input.type === 'play_show');
              liveControl.state.trackId = targetTrackId;
              latestLiveState = {
                ...(latestLiveState || {}),
                connected: true,
                trackId: targetTrackId,
                trackTitle: track?.title || track?.originalName || latestLiveState?.trackTitle || 'Light Show',
                bpm: track?.bpm || show?.analysis?.bpm || show?.timeline?.bpm || latestLiveState?.bpm || 120,
                durationSec: track?.durationSec || show?.analysis?.durationSec || show?.timeline?.durationSec || latestLiveState?.durationSec || 180,
                timeSec: Number.isFinite(input.timeSec) ? Math.max(0, Number(input.timeSec)) : 0,
                isPlaying: wantPlay,
                timestamp: Date.now()
              };
              if (wantPlay && !liveControl.state.blackout) {
                activateShowOutput({ forceWake: true, clearBlackout: true, broadcast: true, source: 'ios-pad' });
              }
            }
          }
          if (input.type === 'transport' || input.type === 'play' || input.type === 'pause' || input.type === 'stop' || input.type === 'seek') {
            const action = input.type === 'transport' ? input.action : input.type;
            if (latestLiveState) {
              const elapsedSec = latestLiveState.isPlaying
                ? Math.max(0, (Date.now() - (latestLiveState.timestamp || Date.now())) / 1000)
                : 0;
              const currentSec = Math.max(0, (Number(latestLiveState.timeSec) || 0) + elapsedSec);
              if (action === 'play') {
                latestLiveState = { ...latestLiveState, isPlaying: true, timeSec: currentSec, timestamp: Date.now() };
                if (!liveControl.state.blackout) {
                  activateShowOutput({ forceWake: true, clearBlackout: true, broadcast: true, source: 'ios-pad' });
                }
              } else if (action === 'pause') {
                latestLiveState = { ...latestLiveState, isPlaying: false, timeSec: currentSec, timestamp: Date.now() };
                if (serverPerformDesk.active.size === 0 && serverPerformDesk.touches.size === 0 && !liveControl.state.blackout) {
                  restoreWledAfterShowStop('transport_pause');
                }
              } else if (action === 'stop') {
                latestLiveState = { ...latestLiveState, isPlaying: false, timeSec: 0, timestamp: Date.now() };
                if (serverPerformDesk.active.size === 0 && serverPerformDesk.touches.size === 0 && !liveControl.state.blackout) {
                  restoreWledAfterShowStop('transport_stop');
                }
              } else if (action === 'seek' && Number.isFinite(input.timeSec)) {
                latestLiveState = { ...latestLiveState, timeSec: Math.max(0, Number(input.timeSec)), timestamp: Date.now() };
              }
            }
          }
          if (input.type === 'live_pad') {
            const padResult = applyServerPadCommand(input);
            if (input.clientId && lanPeers.has(String(input.clientId).trim())) {
              const existingPeer = lanPeers.get(String(input.clientId).trim());
              if (existingPeer && (existingPeer.source === 'ios-pad' || existingPeer.source === 'pad')) {
                lanPeers.delete(String(input.clientId).trim());
                broadcastLanPresence();
              }
            }
            if ((serverPerformDesk.active.size > 0 || serverPerformDesk.touches.size > 0) && !liveControl.state.blackout) {
              activateShowOutput({ forceWake: true, broadcast: true });
              if (input.action === 'touch_down' || input.action === 'touch_up' || padResult === 'snapped' || padResult === 'strobe') {
                lastAcceptedFrame = -Infinity;
              }
              const perfCtx = getServerPerfContext();
              const hasFreshBase = lastBaseBars && (performance.now() - lastBaseBarsAt < 450);
              const baseFrame = hasFreshBase
                ? { bars: lastBaseBars }
                : { bars: Object.fromEntries(BAR_IDS.map(barId => [barId, Array.from({ length: PIXELS_PER_BAR }, () => [0, 0, 0, 0])])) };
              const rendered = serverPerformDesk.render(baseFrame, perfCtx.clockTime, perfCtx.bpm, 1, null, perfCtx.songTime);
              const scale = clampVal((latestLiveState?.master ?? liveControl.state.master ?? 70) / 100, 0, 1);
              hadServerPadsActive = true;
              sendBarsToWled(rendered.bars, scale, 'companion_pads_instant').catch(() => {});
            } else if (hadServerPadsActive && serverPerformDesk.active.size === 0 && serverPerformDesk.touches.size === 0 && !liveControl.state.blackout) {
              hadServerPadsActive = false;
              lastAcceptedFrame = -Infinity;
              const hasFreshBase = lastBaseBars && (performance.now() - lastBaseBarsAt < 450);
              const clearBars = hasFreshBase
                ? lastBaseBars
                : Object.fromEntries(BAR_IDS.map(barId => [barId, Array.from({ length: PIXELS_PER_BAR }, () => [0, 0, 0, 0])]));
              const scale = clampVal((latestLiveState?.master ?? liveControl.state.master ?? 70) / 100, 0, 1);
              sendBarsToWled(clearBars, scale, 'companion_pads_clear').catch(() => {});
            }
            broadcastLive('command', input);
            return json(response, 200, {
              ok: true,
              command: input.type,
              padResult,
              ...getPadsSnapshot(),
              clientCount: liveClients.size
            });
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
        if (pathname === '/api/logs/event') {
          const rawDetails = (typeof input.details === 'object' && input.details) || (typeof input.data === 'object' && input.data) || {};
          const details = { ...rawDetails };
          if (typeof input.message === 'string' && !details.message) details.message = input.message.slice(0, 500);
          if (typeof input.stack === 'string' && !details.stack) details.stack = input.stack.slice(0, 1000);
          if (typeof input.trackId === 'string' && !details.trackId) details.trackId = input.trackId;
          if (typeof input.level === 'string' && !details.level) details.level = input.level;
          logEvent(
            String(input.category || 'CLIENT').slice(0, 32).toUpperCase(),
            String(input.action || input.event || 'EVENT').slice(0, 64),
            details
          );
          return json(response, 200, { ok: true });
        }
        if (pathname === '/api/auto-connect') {
          const result = await autoConnect({ allowDiscovery: input.allowDiscovery !== false, forceTakeover: Boolean(input.forceTakeover) });
          return json(response, 200, result);
        }
        if (pathname === '/api/ambient-light') {
          const result = await applyAmbientLightState(input);
          return json(response, 200, result);
        }
        if (pathname === '/api/mode') {
          const targetMode = input.mode === 'ambient' ? 'ambient' : 'show';
          const reqSource = String(input.source || 'api_mode').slice(0, 32);
          if (targetMode === 'ambient') {
            syncSavedAmbientFields(input);
            activateAmbientOutput({ restorePresetOnE8: input.restorePreset !== false, broadcast: true, source: reqSource });
          } else {
            if (input.clientId) {
              const peer = touchLanPeer(String(input.clientId).trim(), { name: input.clientName, source: input.source }, request);
              if (peer) claimStageForPeer(peer, { takeover: true });
            }
            activateShowOutput({ forceWake: true, clearBlackout: true, broadcast: true, source: reqSource });
            broadcastLanPresence({ reason: 'mode_show' });
          }
          return json(response, 200, {
            ok: true,
            outputMode,
            ...state(),
            lan: getLanStatus()
          });
        }
        if (pathname === '/api/arm') {
          if (typeof input.armed !== 'boolean') throw new Error('Očekuje se armed true ili false.');
          if (input.armed && testRunning) return json(response, 409, { error: 'Pričekajte kraj kratkog testa.' });
          if (!input.armed) {
            yieldedToRemote = false;
            if (input.preserveAmbient) {
              activateAmbientOutput({ restorePresetOnE8: Boolean(input.restorePreset), broadcast: false, source: 'api_arm_ambient' });
            } else {
              outputMode = 'show';
              await disarm('Izlaz ugašen');
            }
          } else {
            if (outputMode === 'ambient' && !input.userInitiated && !input.takeover) {
              logEvent('WLED', 'ARM_IGNORED_AMBIENT', { clientId: input.clientId || null });
              return json(response, 200, state());
            }
            const activeNodes = config.nodes.filter(node => node.host);
            if (!activeNodes.length) return json(response, 409, { error: `Postavite IP adresu barem jednog kontrolera.` });
            for (const node of activeNodes.filter(item => item.mac)) {
              let actual;
              try { actual = await probe(node.host, { includeBuses: false }); }
              catch { return json(response, 409, { error: `${node.id} nije dostupan. Pokrenite ponovno traženje WLED-a.` }); }
              if (actual.mac && actual.mac !== node.mac) return json(response, 409, { error: `${node.id} na spremljenoj IP adresi više nije isti WLED uređaj. Pokrenite ponovno traženje.` });
              wakeWled(node.host);
            }
            for (const node of activeNodes.filter(item => !item.mac)) {
              wakeWled(node.host);
            }
            outputMode = 'show';
            armed = true;
            framesSentSinceArm = 0;
            yieldedToRemote = false;
            reason = activeNodes.length === config.nodes.length ? 'Izlaz uključen' : `Izlaz uključen (${activeNodes.length}/${config.nodes.length} kontrolera)`;
            lastFrame = performance.now();
            lastAcceptedFrame = -Infinity;
            logEvent('WLED', 'ARM_MANUAL', { nodes: activeNodes.map(n => n.host), userInitiated: Boolean(input.userInitiated) });
          }
          broadcastLive('command', { type: 'hardware_sync', state: { ...state(), ambientOverride: Boolean(!input.armed && input.preserveAmbient) } });
          broadcastLanPresence({ reason: input.armed ? 'arm' : (input.preserveAmbient ? 'mode_ambient' : 'disarm') });
          return json(response, 200, state());
        }
        if (pathname === '/api/blackout') {
          if (testRunning) { testAbort = true; stopTest?.(); await testSettled; }
          logEvent('WLED', 'BLACKOUT_TRIGGERED', {});
          await disarm('Blackout', { sendZeros: true });
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
            if (actual.mac && actual.mac !== node.mac) return json(response, 409, { error: `${node.id} na spremljenoj IP adresi više nije isti WLED uređaj.` });
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
          if (input.clientId) {
            touchLanPeer(input.clientId, { name: input.clientName }, request);
          }
          const perfCtx = getServerPerfContext();
          serverPerformDesk.tick(perfCtx);
          const effectiveMaster = latestLiveState?.master ?? liveControl.state.master ?? 35;
          const hasValidBars = Boolean(input.bars && Object.keys(input.bars).length === 9);
          const unscaledBaseBars = hasValidBars
            ? ((input.previewBars && Object.keys(input.previewBars).length === 9)
                ? input.previewBars
                : unscaleBarsForPreview(input.bars, effectiveMaster))
            : null;
          if (unscaledBaseBars && canClientDriveStage(input.clientId)) {
            lastBaseBars = unscaledBaseBars;
            lastBaseBarsAt = performance.now();
          }
          if (outputMode === 'ambient') {
            if (unscaledBaseBars && canClientDriveStage(input.clientId)) {
              let companionBars = unscaledBaseBars;
              if (serverPerformDesk.active.size > 0 || serverPerformDesk.touches.size > 0) {
                companionBars = serverPerformDesk.render({ bars: unscaledBaseBars }, perfCtx.clockTime, perfCtx.bpm, 1, null, perfCtx.songTime).bars;
              }
              pushFrameToCompanionClients(companionBars, performance.now(), { isPreScaled: false });
            }
            return json(response, 200, {
              ok: true,
              skipped: 'ambient_mode',
              armed: false,
              outputMode: 'ambient',
              ambientOverride: true,
              isStageOwner: false
            });
          }
          if (!canClientDriveStage(input.clientId)) {
            const lanStat = getLanStatus();
            return json(response, 200, {
              ok: true,
              skipped: remoteStageOwner ? 'remote_stage_owner' : 'not_stage_owner',
              isStageOwner: false,
              stageOwnerId: lanStat.stageOwnerId,
              stageOwnerName: lanStat.stageOwnerName,
              stageState: lanStat.stageState
            });
          }
          if (!armed) {
            if (unscaledBaseBars) {
              let companionBars = unscaledBaseBars;
              if (serverPerformDesk.active.size > 0 || serverPerformDesk.touches.size > 0) {
                companionBars = serverPerformDesk.render({ bars: unscaledBaseBars }, perfCtx.clockTime, perfCtx.bpm, 1, null, perfCtx.songTime).bars;
              }
              pushFrameToCompanionClients(companionBars, performance.now(), { isPreScaled: false });
            }
            return json(response, 409, { error: 'Izlaz je ugašen.' });
          }
          if (!hasValidBars) throw new Error('Kadar mora sadržavati svih 9 traka.');
          let effectiveBars = input.bars;
          let companionBars = unscaledBaseBars || input.bars;
          if (serverPerformDesk.active.size > 0 || serverPerformDesk.touches.size > 0) {
            const browserActiveSet = new Set(Array.isArray(latestLiveState?.activePads) ? latestLiveState.activePads : []);
            const needsServerOverlay =
              serverPerformDesk.touches.size > 0 ||
              [...serverPerformDesk.active.keys()].some(k => !browserActiveSet.has(k));
            if (needsServerOverlay) {
              effectiveBars = serverPerformDesk.render({ bars: input.bars }, perfCtx.clockTime, perfCtx.bpm, 1, null, perfCtx.songTime).bars;
              companionBars = serverPerformDesk.render({ bars: companionBars }, perfCtx.clockTime, perfCtx.bpm, 1, null, perfCtx.songTime).bars;
            }
          }
          const values = new Map(config.nodes.map(node => [node.id, []]));
          let hasNonZeroChannel = false;
          for (const node of config.nodes) {
            const routes = cachedNodeRoutes.get(node.id) || routesForNode(config, node.id);
            const nodeValues = values.get(node.id);
            for (const route of routes) {
              const rawPixels = effectiveBars[route.bar];
              if (!Array.isArray(rawPixels) || rawPixels.length !== 12) throw new Error(`Kadar trake ${route.bar} mora imati 12 uzoraka.`);
              const pixels = (config.profile === 'e8-columns' && route.bar === 'C1')
                ? Array.from({ length: 12 }, () => [0, 0, 0, 0])
                : rawPixels;
              const groups = mapBarPixels(pixels, route);
              const encoded = config.transport === 'rgbw' ? groups : groups.map(rgbFromRgbw);
              for (let i = 0; i < encoded.length; i++) {
                const px = encoded[i];
                for (let c = 0; c < px.length; c++) {
                  const v = px[c];
                  if (v > 0) hasNonZeroChannel = true;
                  nodeValues.push(v);
                }
              }
            }
          }
          const cid = input.clientId ? String(input.clientId).trim() : '';
          const peer = cid ? lanPeers.get(cid) : null;
          const peerIdle = (peer ? (!peer.isPlaying && !peer.hasActivePads) : (!latestLiveState?.isPlaying && !(latestLiveState?.activePads?.length))) && serverPerformDesk.active.size === 0 && serverPerformDesk.touches.size === 0;
          if (!hasNonZeroChannel && config.profile === 'e8-columns' && !liveControl.state.blackout) {
            if (peerIdle && cid) {
              lastFrame = performance.now();
              pushFrameToCompanionClients(companionBars, lastFrame, { isPreScaled: false });
              if (wledShowCarrierAwake && framesSentSinceArm > 0) {
                restoreWledAfterShowStop('idle_black_frame');
              }
              return json(response, 200, { ok: true, skipped: 'idle_black_frame', isStageOwner: true, stageOwnerId });
            }
          }
          if (!wledShowCarrierAwake && !liveControl.state.blackout && (hasNonZeroChannel || !peerIdle)) {
            for (const node of config.nodes.filter(n => n.host)) wakeWled(node.host);
          }
          const now = performance.now();
          if (now - lastAcceptedFrame < minFrameMs) return json(response, 429, { error: 'Najviše 120 kadrova u sekundi.' });
          if (framesSentSinceArm === 0) {
            logEvent('DDP', 'STREAM_FIRST_FRAME', { source: 'api_frame', clientId: input.clientId || null, hasNonZeroChannel });
          }
          framesSentSinceArm++;
          lastFrame = now;
          lastClientFrame = now;
          lastAcceptedFrame = now;
          lastDispatchedBars = effectiveBars;
          lastDispatchedAt = now;
          pushFrameToCompanionClients(companionBars, now, { isPreScaled: false });
          await Promise.all(config.nodes.filter(node => node.host).map(node => send(node.host, values.get(node.id))));
          return json(response, 200, { ok: true, isStageOwner: true, stageOwnerId });
        }
        return json(response, 404, { error: 'Nepoznat API.' });
      }
      if (request.method !== 'GET') return json(response, 405, { error: 'Metoda nije podržana.' });
      if (pathname === '/favicon.ico') {
        response.writeHead(204, { 'Cache-Control': 'public, max-age=86400' });
        return response.end();
      }
      const allowed = new Set(['/', '/index.html', '/classic.html', '/pad', '/pad.html', '/pad.css', '/pad.mjs', '/manifest.webmanifest', '/assets/pad-icon.svg', '/daw.css', '/hardware-settings.css', '/hardware-topology.mjs', '/daw.mjs', '/daw-autoshow.mjs', '/daw-state.mjs', '/daw-remote.mjs', '/daw-ui.mjs', '/daw-playlist.mjs', '/daw-editor.mjs', '/daw-mixer.mjs', '/daw-stems.mjs', '/daw-live.mjs', '/daw-performance.mjs', '/live-performance-state.mjs', '/live-session-recorder.mjs', '/daw-output.mjs', '/daw-browser.mjs', '/daw-driver.mjs', '/show-bundle.mjs', '/show-generators.mjs', '/timeline-contrast.mjs', '/audio-spectrum.mjs', '/audio-sections.mjs', '/gemini-director.mjs', '/ui.mjs', '/engine.mjs', '/timeline.mjs', '/show-engine.mjs', '/timeline-viewport.mjs', '/mapping.mjs', '/led-preview.mjs', '/tooltips.mjs', '/project-ui.mjs', '/style.css', '/studio.css', '/assets/stage-background.png']);
      if (!allowed.has(pathname)) return json(response, 404, { error: 'Datoteka ne postoji.' });
      const filename = pathname === '/' ? 'index.html' : (pathname === '/pad' ? 'pad.html' : pathname.slice(1));
      const data = await readFile(resolve(ROOT, filename));
      const mime = { '.html': 'text/html', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' }[extname(filename)];
      response.writeHead(200, { 'Content-Type': mime === 'image/png' ? mime : `${mime}; charset=utf-8`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      response.end(data);
    } catch (error) {
      if (pathname === '/api/frame' && error.code) await disarm('Greška izlaza').catch(() => {});
      const status = error.statusCode || 400;
      logEvent('API_ERROR', `${request.method} ${pathname}`, {
        status,
        error: error.message,
        ...(error.stack ? { stack: String(error.stack).split('\n').slice(0, 4).join(' | ') } : {})
      });
      json(response, status, { error: error.message });
    }
  });
  let devWatcher = null;
  let devReloadDebounce = null;
  try {
    devWatcher = fsWatch(ROOT, { persistent: false }, (_eventType, filename) => {
      if (!filename) return;
      if (/^(pad\.(html|css|mjs)|manifest\.webmanifest|live-performance-state\.mjs)$/.test(filename)) {
        clearTimeout(devReloadDebounce);
        devReloadDebounce = setTimeout(() => {
          broadcastLive('command', {
            type: 'dev_reload',
            file: filename,
            ts: Date.now()
          });
        }, 80);
      }
    });
  } catch {}

  return {
    server,
    state,
    library,
    autoConnect,
    getLanStatus,
    lanCoordinator,
    logEvent,
    async load() {
      if (!configPath) return;
      try { updateConfig(validateConfig(JSON.parse(await readFile(configPath, 'utf8')), allowLoopback)); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    },
    async close() {
      if (closing) return;
      closing = true;
      clearTimeout(devReloadDebounce);
      try { devWatcher?.close?.(); } catch {}
      clearInterval(renderTimer);
      clearInterval(timer);
      cloudSync.stopPolling();
      await lanCoordinator?.close?.().catch(() => {});
      for (const client of liveClients) {
        try { client.end(); } catch {}
      }
      liveClients.clear();
      lanPeers.clear();
      if (testRunning) { testAbort = true; stopTest?.(); await testSettled; }
      await disarm('Poslužitelj ugašen', { sendZeros: config.profile !== 'e8-columns' }).catch(() => {});
      server.closeAllConnections?.();
      await new Promise(done => server.close(done));
      try { udp.close(); } catch (error) { if (error.code !== 'ERR_SOCKET_DGRAM_NOT_RUNNING') throw error; }
    }
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const formatCrash = (kind, err) => {
    const nowIso = new Date().toISOString();
    const message = err?.message || String(err);
    const stack = err?.stack ? String(err.stack).split('\n').slice(0, 8).join(' | ') : '';
    return `${nowIso} [CRASH] ${kind} ${JSON.stringify({ message, stack })}`;
  };
  process.on('uncaughtException', err => {
    console.error('Uncaught exception:', err);
    writeDiskLogLineSync(formatCrash('UNCAUGHT_EXCEPTION', err), LOG_FILE_PATH);
  });
  process.on('unhandledRejection', err => {
    console.error('Unhandled rejection:', err);
    writeDiskLogLineSync(formatCrash('UNHANDLED_REJECTION', err), LOG_FILE_PATH);
  });
  const listenPort = Number(process.env.PORT) || 8787;
  const listenHost = process.env.HOST || (process.argv.includes('--local-only') ? '127.0.0.1' : '0.0.0.0');
  const lanBusPort = process.argv.includes('--local-only') ? 0 : (Number(process.env.LAN_BUS_PORT) || DEFAULT_LAN_BUS_PORT);
  const app = createLightingServer({ lanBusPort });
  await app.load();
  app.server.listen(listenPort, listenHost, () => {
    const url = `http://127.0.0.1:${listenPort}`;
    const lanInfo = getLanAddresses(listenPort);
    const lanHint = lanInfo.lanUrls.length ? ` | LAN: ${lanInfo.lanUrls.join(', ')}` : '';
    app.logEvent('SERVER', 'START', { port: listenPort, host: listenHost, logFile: LOG_FILE_PATH });
    console.log(`LEDicated Studio: ${url}${lanHint} (auto-connect na EO8+…) | Log: ${LOG_FILE_PATH}`);
    app.autoConnect().then(res => {
      if (res?.connected) console.log(`EO8+ automatski povezan (${res.host || 'E8-1'}) · izlaz uključen.`);
    }).catch(() => {});
    if (process.argv.includes('--open') && process.platform === 'darwin') execFile('open', [url], error => { if (error) console.error('Otvorite adresu ručno:', url); });
  });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => app.close().then(() => process.exit(0)));
}
