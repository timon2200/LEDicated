/** Portable show & song-bundle serialization for LEDicated.
 * Supports two formats:
 * 1. `.ledshow.json` (lightweight JSON with timeline, sections, beat grid, and track metadata — ideal for Git & chat)
 * 2. `.ledpack` (`LPK1` binary container with manifest + analysis + timeline + raw audio bytes — self-contained song + show)
 */
import { validateTimeline } from './timeline.mjs';

export const PACK_MAGIC = 'LPK1';

export function sanitizeFilename(raw, fallback = 'ledicated-show') {
  if (typeof raw !== 'string' || !raw.trim()) return fallback;
  const cleaned = raw
    .trim()
    .replace(/\.(mp3|wav|m4a|aac|flac|ogg|aif|aiff|ledpack|ledshow|json)$/gi, '')
    .replace(/[\\/:*?"<>|\x00-\x1f\x7f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 90);
  return cleaned || fallback;
}

export function compactAnalysisForShow(analysis) {
  if (!analysis || typeof analysis !== 'object') return null;
  const out = {};
  if (Number.isFinite(analysis.durationSec)) out.durationSec = analysis.durationSec;
  else if (Number.isFinite(analysis.duration)) out.durationSec = analysis.duration;
  if (Number.isFinite(analysis.bpm)) out.bpm = analysis.bpm;
  if (Number.isFinite(analysis.beatOffsetSec)) out.beatOffsetSec = analysis.beatOffsetSec;
  if (Array.isArray(analysis.beatsSec)) out.beatsSec = analysis.beatsSec.slice(0, 4000);
  else if (Array.isArray(analysis.beats)) out.beatsSec = analysis.beats.slice(0, 4000);
  if (Array.isArray(analysis.downbeatsSec)) out.downbeatsSec = analysis.downbeatsSec.slice(0, 1000);
  if (Array.isArray(analysis.sections)) out.sections = structuredClone(analysis.sections);
  return Object.keys(out).length ? out : null;
}

export function extractTrackManifest(track = {}, analysis = null, timeline = null) {
  const durationSec = track.durationSec ?? analysis?.durationSec ?? analysis?.duration ?? timeline?.durationSec ?? 60;
  const bpm = track.bpm ?? analysis?.bpm ?? timeline?.bpm ?? 120;
  return {
    id: typeof track.id === 'string' ? track.id : undefined,
    title: typeof track.title === 'string' && track.title.trim() ? track.title.trim() : 'Nepoznata pjesma',
    originalName: typeof track.originalName === 'string' && track.originalName.trim()
      ? track.originalName.trim()
      : `${sanitizeFilename(track.title || 'song')}${track.extension || '.mp3'}`,
    extension: typeof track.extension === 'string' && track.extension.startsWith('.') ? track.extension.toLowerCase() : '.mp3',
    sha256: typeof track.sha256 === 'string' ? track.sha256 : undefined,
    sizeBytes: Number.isFinite(track.sizeBytes) ? track.sizeBytes : undefined,
    durationSec: Number.isFinite(durationSec) ? durationSec : 60,
    bpm: Number.isFinite(bpm) ? bpm : 120,
    ...(typeof track.videoId === 'string' && track.videoId ? { videoId: track.videoId } : {}),
    ...(typeof track.sourceUrl === 'string' && track.sourceUrl ? { sourceUrl: track.sourceUrl } : {}),
    ...(typeof track.theme === 'string' && track.theme ? { theme: track.theme } : {})
  };
}

export function encodeShowJson({ track = {}, analysis = null, timeline, author = '' } = {}) {
  const check = validateTimeline(timeline);
  if (!check.valid) throw new Error(`Neispravan show za izvoz: ${check.errors[0]}`);
  return {
    format: 'ledicated-show',
    version: 1,
    exportedAt: new Date().toISOString(),
    ...(typeof author === 'string' && author.trim() ? { author: author.trim().slice(0, 80) } : {}),
    track: extractTrackManifest(track, analysis, timeline),
    analysis: compactAnalysisForShow(analysis),
    timeline: structuredClone(timeline)
  };
}

export function decodeShowJson(input) {
  let parsed = input;
  if (Buffer.isBuffer(input) || input instanceof Uint8Array) {
    parsed = JSON.parse(Buffer.from(input).toString('utf8'));
  } else if (typeof input === 'string') {
    parsed = JSON.parse(input);
  }
  if (!parsed || typeof parsed !== 'object') throw new Error('Datoteka showa nije valjan JSON objekt.');
  // Support both wrapped `{ format: 'ledicated-show', timeline, ... }` and raw timeline JSON
  const timeline = parsed.timeline && typeof parsed.timeline === 'object' ? parsed.timeline : (Array.isArray(parsed.layers) ? parsed : null);
  if (!timeline) throw new Error('Datoteka ne sadrži vremensku traku (timeline).');
  const check = validateTimeline(timeline);
  if (!check.valid) throw new Error(`Neispravan show: ${check.errors[0]}`);
  const track = parsed.track && typeof parsed.track === 'object' ? parsed.track : {};
  const analysis = parsed.analysis && typeof parsed.analysis === 'object' ? parsed.analysis : null;
  const author = typeof parsed.author === 'string' ? parsed.author.trim().slice(0, 80) : '';
  return {
    format: 'ledicated-show',
    version: 1,
    author,
    track: extractTrackManifest(track, analysis, timeline),
    analysis,
    timeline
  };
}

export function encodeLedPack({ track = {}, analysis = null, timeline, audioBuffer, author = '' } = {}) {
  const check = validateTimeline(timeline);
  if (!check.valid) throw new Error(`Neispravan show za izvoz paketa: ${check.errors[0]}`);
  if (!audioBuffer || !(audioBuffer instanceof Uint8Array) || audioBuffer.byteLength === 0) {
    throw new Error('Audio zapis je obavezan za .ledpack paket.');
  }
  const manifest = {
    format: 'ledicated-pack',
    version: 1,
    exportedAt: new Date().toISOString(),
    ...(typeof author === 'string' && author.trim() ? { author: author.trim().slice(0, 80) } : {}),
    track: extractTrackManifest(track, analysis, timeline),
    analysis: analysis || null,
    timeline
  };
  const jsonBytes = Buffer.from(JSON.stringify(manifest), 'utf8');
  const header = Buffer.alloc(8);
  header.write(PACK_MAGIC, 0, 4, 'ascii');
  header.writeUInt32BE(jsonBytes.byteLength, 4);
  const audioBytes = Buffer.isBuffer(audioBuffer) ? audioBuffer : Buffer.from(audioBuffer);
  return Buffer.concat([header, jsonBytes, audioBytes]);
}

export function decodeLedPack(buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  if (buf.byteLength < 12 || buf.subarray(0, 4).toString('ascii') !== PACK_MAGIC) {
    throw new Error('Neispravan .ledpack format (nedostaje LPK1 zaglavlje).');
  }
  const jsonLen = buf.readUInt32BE(4);
  if (jsonLen <= 2 || 8 + jsonLen >= buf.byteLength) {
    throw new Error('Oštećen .ledpack paket (neispravna duljina manifesta ili nedostaje audio).');
  }
  const manifest = JSON.parse(buf.subarray(8, 8 + jsonLen).toString('utf8'));
  if (!manifest || typeof manifest !== 'object' || !manifest.timeline) {
    throw new Error('Neispravan manifest u .ledpack paketu.');
  }
  const check = validateTimeline(manifest.timeline);
  if (!check.valid) throw new Error(`Neispravan show u paketu: ${check.errors[0]}`);
  const audioBuffer = buf.subarray(8 + jsonLen);
  if (audioBuffer.byteLength === 0) throw new Error('Audio zapis u .ledpack paketu je prazan.');
  const author = typeof manifest.author === 'string' ? manifest.author.trim().slice(0, 80) : '';
  return {
    format: 'ledicated-pack',
    version: 1,
    author,
    track: extractTrackManifest(manifest.track || {}, manifest.analysis, manifest.timeline),
    analysis: manifest.analysis && typeof manifest.analysis === 'object' ? manifest.analysis : null,
    timeline: manifest.timeline,
    audioBuffer
  };
}

export function detectBundleKind(buffer) {
  if (!buffer || !(buffer instanceof Uint8Array) || buffer.byteLength < 2) return null;
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  if (buf.byteLength >= 12 && buf.subarray(0, 4).toString('ascii') === PACK_MAGIC) return 'pack';
  const head = buf.subarray(0, Math.min(64, buf.byteLength)).toString('utf8').trimStart();
  if (head.startsWith('{')) return 'show';
  return null;
}
