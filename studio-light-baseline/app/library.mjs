// Private, local song/project library. No audio decoding or network access lives here.
import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { homedir } from 'node:os';
import { basename, extname, join, resolve } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { mkdir, readFile, rename, statfs, lstat, unlink, writeFile } from 'node:fs/promises';

const EXTENSIONS = new Set(['.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg', '.aif', '.aiff']);
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA = /^[0-9a-f]{64}$/;
const DEFAULT_ROOT = join(homedir(), 'Library', 'Application Support', 'LEDicated');
const MAX_JSON_BYTES = 8 * 1024 * 1024;
const DISK_RESERVE_BYTES = Number(process.env.DISK_RESERVE_BYTES) ||
  (process.execArgv.includes('--test') || process.argv.some(a => a.includes('.test.')) ? 50 * 1024 * 1024 : 1024 * 1024 * 1024);

function requireId(id) {
  if (typeof id !== 'string' || !ID.test(id)) throw new Error('Neispravan ID.');
  return id;
}

function cleanName(name) {
  if (typeof name !== 'string' || !name.trim() || name.length > 255 || /[\\/\x00-\x1f\x7f]/.test(name) || name === '.' || name === '..') {
    throw new Error('Neispravan naziv datoteke.');
  }
  const extension = extname(name).toLowerCase();
  if (!EXTENSIONS.has(extension)) throw new Error('Nepodržan audio format.');
  return { name: name.trim(), extension };
}

function label(value, description) {
  if (typeof value !== 'string' || !value.trim() || value.length > 200 || /[\0-\x1f]/.test(value)) {
    throw new Error(`Neispravan ${description}.`);
  }
  return value.trim();
}

function jsonValue(value) {
  const json = JSON.stringify(value);
  if (json === undefined || Buffer.byteLength(json) > MAX_JSON_BYTES) throw new Error('JSON je prevelik ili neispravan.');
  return JSON.parse(json);
}

function copy(value) { return structuredClone(value); }

async function atomicJson(path, value) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}

async function safeDirectory(path) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Mapa biblioteke ne smije biti simbolička poveznica.');
}

export function createLibrary({ root = DEFAULT_ROOT, maxTracks = 100, maxAudioBytes = 512 * 1024 ** 2 } = {}) {
  if (!Number.isSafeInteger(maxTracks) || maxTracks < 1 || !Number.isSafeInteger(maxAudioBytes) || maxAudioBytes < 1) {
    throw new Error('Neispravna ograničenja biblioteke.');
  }
  const base = resolve(root);
  const audioDir = join(base, 'audio');
  const timelineDir = join(base, 'timelines');
  const analysisDir = join(base, 'analyses');
  const indexPath = join(base, 'library.json');
  let index;
  let initializing;
  let tail = Promise.resolve();

  const fileFor = track => join(audioDir, `${track.sha256}${track.extension}`);
  const timelineFor = id => join(timelineDir, `${requireId(id)}.json`);
  const analysisFor = id => join(analysisDir, `${requireId(id)}.json`);

  async function init() {
    if (!initializing) initializing = (async () => {
      for (const path of [base, audioDir, timelineDir, analysisDir]) await safeDirectory(path);
      try {
        index = JSON.parse(await readFile(indexPath, 'utf8'));
        if (index.version !== 1 || !Array.isArray(index.tracks) || !Array.isArray(index.sets)) throw new Error('Oštećena biblioteka.');
        for (const track of index.tracks) {
          requireId(track.id);
          if (!SHA.test(track.sha256) || !EXTENSIONS.has(track.extension)) throw new Error('Oštećen zapis pjesme.');
        }
        for (const set of index.sets) {
          requireId(set.id);
          if (!Array.isArray(set.trackIds) || set.trackIds.some(id => !ID.test(id))) throw new Error('Oštećen zapis seta.');
        }
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        index = { version: 1, tracks: [], sets: [] };
        await atomicJson(indexPath, index);
      }
    })();
    return initializing;
  }

  function serialized(work) {
    const next = tail.then(async () => { await init(); return work(); });
    tail = next.catch(() => {});
    return next;
  }

  function trackById(id) {
    requireId(id);
    const track = index.tracks.find(item => item.id === id);
    if (!track) throw new Error('Pjesma ne postoji.');
    return track;
  }

  function setById(id) {
    requireId(id);
    const set = index.sets.find(item => item.id === id);
    if (!set) throw new Error('Set ne postoji.');
    return set;
  }

  async function commit(next) {
    await atomicJson(indexPath, next);
    index = next;
  }

  async function importStream(name, readable) {
    const file = cleanName(name);
    if (!readable || typeof readable.pipe !== 'function') throw new Error('Potreban je čitljiv audio tok.');
    return serialized(async () => {
      const free = await statfs(base);
      if (free.bavail * free.bsize < DISK_RESERVE_BYTES + maxAudioBytes) throw new Error('Nedovoljno slobodnog prostora za siguran uvoz.');
      const temp = join(audioDir, `${randomUUID()}.part`);
      const hash = createHash('sha256');
      let sizeBytes = 0;
      const limiter = new Transform({
        transform(chunk, _encoding, callback) {
          sizeBytes += chunk.length;
          if (sizeBytes > maxAudioBytes) return callback(new Error('Audio datoteka je prevelika.'));
          hash.update(chunk);
          callback(null, chunk);
        }
      });
      try {
        await pipeline(readable, limiter, createWriteStream(temp, { flags: 'wx', mode: 0o600 }));
        if (sizeBytes === 0) throw new Error('Audio datoteka je prazna.');
        const sha256 = hash.digest('hex');
        const duplicate = index.tracks.find(track => track.sha256 === sha256);
        if (duplicate) return copy(duplicate);
        if (index.tracks.length >= maxTracks) throw new Error(`Biblioteka prima najviše ${maxTracks} pjesama.`);
        const title = label(file.name.slice(0, -extname(file.name).length), 'naziv pjesme');
        const destination = join(audioDir, `${sha256}${file.extension}`);
        await rename(temp, destination);
        const now = new Date().toISOString();
        const id = randomUUID();
        const track = {
          id, projectId: id, title,
          originalName: file.name, extension: file.extension, sha256, sizeBytes,
          hasTimeline: false, hasAnalysis: false, createdAt: now, updatedAt: now
        };
        try {
          await commit({ ...index, tracks: [...index.tracks, track] });
        } catch (error) {
          await unlink(destination).catch(cleanup => { if (cleanup.code !== 'ENOENT') throw cleanup; });
          throw error;
        }
        return copy(track);
      } finally {
        await unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw error; });
      }
    });
  }

  async function importFile(path) {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error('Izvor mora biti obična lokalna datoteka.');
    if (info.size > maxAudioBytes) throw new Error('Audio datoteka je prevelika.');
    const { createReadStream } = await import('node:fs');
    return importStream(basename(path), createReadStream(path));
  }

  function importBuffer(name, bytes) {
    if (!(bytes instanceof Uint8Array)) throw new Error('Potreban je niz bajtova.');
    if (bytes.byteLength > maxAudioBytes) throw new Error('Audio datoteka je prevelika.');
    return importStream(name, Readable.from([bytes]));
  }

  async function list() { await init(); await tail; return copy(index.tracks); }
  async function getTrack(id) { await init(); await tail; return copy(trackById(id)); }
  async function getAudioPath(id) { await init(); await tail; return fileFor(trackById(id)); }

  function updateTrack(id, patch) {
    return serialized(async () => {
      const track = trackById(id);
      if (!patch || typeof patch !== 'object' || Array.isArray(patch) || Object.keys(patch).some(key => key !== 'title')) throw new Error('Dopušteno je mijenjati samo naslov pjesme.');
      const nextTrack = { ...track, title: label(patch.title, 'naziv pjesme'), updatedAt: new Date().toISOString() };
      await commit({ ...index, tracks: index.tracks.map(item => item.id === id ? nextTrack : item) });
      return copy(nextTrack);
    });
  }

  function saveSidecar(id, value, kind) {
    return serialized(async () => {
      const track = trackById(id);
      const data = jsonValue(value);
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Potreban je JSON objekt.');
      const path = kind === 'timeline' ? timelineFor(id) : analysisFor(id);
      await atomicJson(path, data);
      const nextTrack = { ...track, [kind === 'timeline' ? 'hasTimeline' : 'hasAnalysis']: true, updatedAt: new Date().toISOString() };
      await commit({ ...index, tracks: index.tracks.map(item => item.id === id ? nextTrack : item) });
      return copy(data);
    });
  }

  async function readSidecar(id, kind) {
    await init(); await tail;
    const track = trackById(id);
    if (!track[kind === 'timeline' ? 'hasTimeline' : 'hasAnalysis']) return null;
    const path = kind === 'timeline' ? timelineFor(id) : analysisFor(id);
    return JSON.parse(await readFile(path, 'utf8'));
  }

  function deleteTrack(id) {
    return serialized(async () => {
      const track = trackById(id);
      const tracks = index.tracks.filter(item => item.id !== id);
      const sets = index.sets.map(set => ({ ...set, trackIds: set.trackIds.filter(trackId => trackId !== id) }));
      await commit({ ...index, tracks, sets });
      for (const path of [fileFor(track), timelineFor(id), analysisFor(id)]) {
        await unlink(path).catch(error => { if (error.code !== 'ENOENT') throw error; });
      }
    });
  }

  function validatedTrackIds(ids) {
    if (!Array.isArray(ids) || ids.length > maxTracks) throw new Error('Neispravan popis pjesama u setu.');
    for (const id of ids) trackById(id);
    return [...ids];
  }

  function createSet(name, trackIds = []) {
    return serialized(async () => {
      const now = new Date().toISOString();
      const set = { id: randomUUID(), name: label(name, 'naziv seta'), trackIds: validatedTrackIds(trackIds), createdAt: now, updatedAt: now };
      await commit({ ...index, sets: [...index.sets, set] });
      return copy(set);
    });
  }
  async function listSets() { await init(); await tail; return copy(index.sets); }
  async function getSet(id) { await init(); await tail; return copy(setById(id)); }
  function updateSet(id, patch) {
    return serialized(async () => {
      const set = setById(id);
      if (!patch || typeof patch !== 'object' || Array.isArray(patch) || Object.keys(patch).some(key => !['name', 'trackIds'].includes(key))) throw new Error('Neispravna promjena seta.');
      const updated = {
        ...set,
        name: patch.name === undefined ? set.name : label(patch.name, 'naziv seta'),
        trackIds: patch.trackIds === undefined ? set.trackIds : validatedTrackIds(patch.trackIds),
        updatedAt: new Date().toISOString()
      };
      await commit({ ...index, sets: index.sets.map(item => item.id === id ? updated : item) });
      return copy(updated);
    });
  }
  function deleteSet(id) {
    return serialized(async () => {
      setById(id);
      await commit({ ...index, sets: index.sets.filter(item => item.id !== id) });
    });
  }

  return {
    init, importFile, importBuffer, importStream, list, getTrack, getAudioPath, updateTrack, deleteTrack,
    saveTimeline: (id, timeline) => saveSidecar(id, timeline, 'timeline'),
    getTimeline: id => readSidecar(id, 'timeline'),
    setAnalysis: (id, analysis) => saveSidecar(id, analysis, 'analysis'),
    getAnalysis: id => readSidecar(id, 'analysis'),
    createSet, listSets, getSet, updateSet, deleteSet
  };
}
