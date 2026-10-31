/**
 * Cloud Catalog, Version History, Save Tracker & Live Online Presence for LEDicated Studio.
 *
 * Syncs shows, version snapshots (v1, v2, v3...), live editor presence, and activity feed
 * with Firebase Cloud Firestore (`ledicated-studio-vz`) via pure Node.js REST API (zero npm dependencies),
 * while keeping `shared-shows/*.ledshow.json` in Git and `data/versions/` on disk as offline backups.
 */
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { compactAnalysisForShow, decodeShowJson, encodeShowJson, extractTrackManifest, sanitizeFilename } from './show-bundle.mjs';

export const FIREBASE_CONFIG = {
  projectId: process.env.LEDICATED_FIREBASE_PROJECT_ID || 'ledicated-studio-vz',
  appId: '1:597542412485:web:11142046d40f956b7fd0ac',
  storageBucket: 'ledicated-studio-vz.firebasestorage.app',
  apiKey: process.env.LEDICATED_FIREBASE_API_KEY || 'AIzaSyBp3bXnsmiLbI941o9D9ZBUNEFK6uMyDL8',
  authDomain: 'ledicated-studio-vz.firebaseapp.com',
  databaseId: '(default)',
  studioKey: 'ledicated-varazdin-3x3',
  githubReleaseAudioBase: 'https://github.com/timon2200/LEDicated/releases/download/cloud-audio-v1'
};

const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.projectId}/databases/${FIREBASE_CONFIG.databaseId}/documents`;

/** Generate a stable, URL-safe showId for Firestore & version history files. */
export function computeShowId(track = {}) {
  const title = String(track.title || track.originalName || '').trim();
  const baseSlug = sanitizeFilename(title || 'show')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'show';
  const hashSource = (track.videoId && String(track.videoId).trim()) ||
    (track.sha256 && String(track.sha256).trim().slice(0, 12)) ||
    baseSlug;
  const shortHash = createHash('sha1').update(String(hashSource).toLowerCase()).digest('hex').slice(0, 8);
  return `${baseSlug}-${shortHash}`;
}

/** Convert a plain JS value into a Firestore REST API Value object. */
export function toFirestoreValue(val) {
  if (val === null || val === undefined) return { nullValue: null };
  if (typeof val === 'boolean') return { booleanValue: val };
  if (typeof val === 'number') {
    if (!Number.isFinite(val)) return { integerValue: '0' };
    if (Number.isInteger(val)) return { integerValue: String(val) };
    return { doubleValue: val };
  }
  if (typeof val === 'string') return { stringValue: val };
  if (Array.isArray(val)) {
    return { arrayValue: { values: val.map(toFirestoreValue) } };
  }
  if (typeof val === 'object') {
    const fields = {};
    for (const [k, v] of Object.entries(val)) {
      if (v !== undefined) fields[k] = toFirestoreValue(v);
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(val) };
}

/** Convert a plain JS object into Firestore REST API `fields` map. */
export function toFirestoreFields(obj) {
  const fields = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (v !== undefined) fields[k] = toFirestoreValue(v);
  }
  return fields;
}

/** Convert a Firestore REST API Value object back to a plain JS value. */
export function fromFirestoreValue(v) {
  if (!v || typeof v !== 'object') return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('booleanValue' in v) return Boolean(v.booleanValue);
  if ('nullValue' in v) return null;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return (v.arrayValue?.values || []).map(fromFirestoreValue);
  if ('mapValue' in v) return fromFirestoreDoc({ fields: v.mapValue?.fields || {} });
  return null;
}

/** Convert a Firestore REST API Document into a plain JS object. */
export function fromFirestoreDoc(doc) {
  if (!doc || !doc.fields) return null;
  const out = {};
  for (const [k, v] of Object.entries(doc.fields)) {
    out[k] = fromFirestoreValue(v);
  }
  if (typeof doc.name === 'string') {
    out._docId = doc.name.split('/').pop();
  }
  return out;
}

/** Compute a human-readable Croatian summary of changes between two timelines. */
export function summarizeTimelineDiff(prevTimeline, nextTimeline, customNote = '') {
  const nextLayers = Array.isArray(nextTimeline?.layers) ? nextTimeline.layers : [];
  const nextClips = nextLayers.reduce((sum, l) => sum + (Array.isArray(l.clips) ? l.clips.length : 0), 0);

  if (customNote && typeof customNote === 'string' && customNote.trim()) {
    return `${customNote.trim()} (${nextLayers.length} slojeva · ${nextClips} clipova)`;
  }
  if (!prevTimeline || !Array.isArray(prevTimeline.layers)) {
    return `Početni show · ${nextLayers.length} slojeva · ${nextClips} clipova`;
  }

  const prevLayers = prevTimeline.layers;
  const prevClipsMap = new Map();
  for (const layer of prevLayers) {
    for (const clip of (layer.clips || [])) {
      if (clip?.id) prevClipsMap.set(clip.id, { layerName: layer.name || layer.id, clip });
    }
  }

  const nextClipsMap = new Map();
  let added = 0;
  let modified = 0;
  const touchedPresets = new Set();

  for (const layer of nextLayers) {
    for (const clip of (layer.clips || [])) {
      if (!clip?.id) continue;
      nextClipsMap.set(clip.id, { layerName: layer.name || layer.id, clip });
      const prev = prevClipsMap.get(clip.id);
      if (!prev) {
        added++;
        if (clip.preset) touchedPresets.add(clip.preset);
      } else if (JSON.stringify(prev.clip) !== JSON.stringify(clip)) {
        modified++;
        if (clip.preset) touchedPresets.add(clip.preset);
      }
    }
  }

  let removed = 0;
  for (const id of prevClipsMap.keys()) {
    if (!nextClipsMap.has(id)) removed++;
  }

  const parts = [];
  if (added > 0) parts.push(`+${added} ${added === 1 ? 'novi clip' : 'nova clipa'}`);
  if (modified > 0) parts.push(`izmijenjeno ${modified}`);
  if (removed > 0) parts.push(`−${removed} ${removed === 1 ? 'obrisan' : 'obrisana'}`);
  if (nextLayers.length !== prevLayers.length) {
    const diffL = nextLayers.length - prevLayers.length;
    parts.push(diffL > 0 ? `+${diffL} sloj` : `${diffL} sloj`);
  }

  if (!parts.length) {
    if (Math.abs((nextTimeline.bpm || 0) - (prevTimeline.bpm || 0)) > 0.05) {
      parts.push(`BPM ${ Number(nextTimeline.bpm || 120).toFixed(1) }`);
    } else {
      parts.push('Ažurirane postavke');
    }
  }
  const fxSuffix = touchedPresets.size > 0 ? ` [${[...touchedPresets].slice(0, 3).join(', ')}]` : '';
  return `${parts.join(', ')}${fxSuffix} · ukupno ${nextClips} clipova`;
}

/** Fast structural hash of a timeline so identical consecutive saves don't spam duplicate versions. */
export function hashTimeline(timeline) {
  if (!timeline || typeof timeline !== 'object') return '';
  return createHash('sha1').update(JSON.stringify({
    bpm: timeline.bpm,
    beatOffsetSec: timeline.beatOffsetSec,
    gridMode: timeline.gridMode,
    layers: timeline.layers
  })).digest('hex');
}

async function atomicWriteJson(filePath, data) {
  const tmp = `${filePath}.${randomUUID()}.tmp`;
  try {
    await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    await rename(tmp, filePath);
  } finally {
    await unlink(tmp).catch(() => {});
  }
}

export function createCloudSync({
  sharedShowsDir,
  dataDir,
  library,
  enabled = process.env.LEDICATED_CLOUD_DISABLED !== '1' && !process.execArgv.includes('--test'),
  fetcher = globalThis.fetch,
  onRemoteUpdate = null
} = {}) {
  const versionsDir = join(dataDir || join(sharedShowsDir, '..', 'data'), 'versions');
  const cloudCachePath = join(versionsDir, '_cloud_index.json');

  // In-memory state synced with disk & Firestore
  const showsById = new Map();       // showId -> cloud show metadata (without huge timeline object in memory list)
  const presenceByClient = new Map(); // clientId -> presence entry
  let activityFeed = [];             // latest 40 activity items
  let cloudOnline = false;
  let lastSyncAt = null;
  let lastError = null;
  let pollTimer = null;
  let initPromise = null;

  async function firestoreRequest(path, { method = 'GET', body = null, timeoutMs = 6500 } = {}) {
    if (!enabled || typeof fetcher !== 'function') return null;
    const sep = path.includes('?') ? '&' : '?';
    const url = `${FIRESTORE_BASE}${path}${sep}key=${encodeURIComponent(FIREBASE_CONFIG.apiKey)}`;
    const headers = { 'Accept': 'application/json' };
    let payload;
    if (body !== null) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const response = await fetcher(url, {
      method,
      headers,
      body: payload,
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`Firestore HTTP ${response.status}: ${errText.slice(0, 200)}`);
    }
    return response.json();
  }

  async function readLocalVersionFile(showId) {
    try {
      const raw = await readFile(join(versionsDir, `${showId}.json`), 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.versions)) return parsed;
    } catch {}
    return { showId, versions: [] };
  }

  async function writeLocalVersionFile(showId, record) {
    await mkdir(versionsDir, { recursive: true, mode: 0o755 });
    await atomicWriteJson(join(versionsDir, `${showId}.json`), record);
  }

  async function persistCloudIndexCache() {
    try {
      await mkdir(versionsDir, { recursive: true, mode: 0o755 });
      await atomicWriteJson(cloudCachePath, {
        updatedAt: new Date().toISOString(),
        shows: [...showsById.values()],
        activity: activityFeed.slice(0, 40)
      });
    } catch {}
  }

  /** Scan `shared-shows/*.ledshow.json` on disk so offline Git shows are always part of the catalog. */
  async function loadGitSharedShows() {
    await mkdir(sharedShowsDir, { recursive: true, mode: 0o755 }).catch(() => {});
    const files = (await readdir(sharedShowsDir).catch(() => [])).filter(f => f.endsWith('.ledshow.json')).sort();
    for (const filename of files) {
      try {
        const raw = await readFile(join(sharedShowsDir, filename), 'utf8');
        const rawObj = JSON.parse(raw);
        const parsed = decodeShowJson(rawObj);
        const showId = rawObj.showId || computeShowId({
          ...parsed.track,
          title: parsed.track?.title || filename.replace(/\.ledshow\.json$/i, '')
        });
        const clipCount = (parsed.timeline?.layers || []).reduce((sum, l) => sum + (l.clips?.length || 0), 0);
        const layerCount = parsed.timeline?.layers?.length || 0;
        const explicitVersion = Number.isInteger(rawObj.version) && rawObj.version >= 1 ? rawObj.version : 0;
        const version = explicitVersion || 1;
        const existing = showsById.get(showId);
        if (!existing || (version > (existing.version || 0))) {
          const sha256 = parsed.track?.sha256 || null;
          showsById.set(showId, {
            showId,
            filename,
            title: parsed.track?.title || filename.replace(/\.ledshow\.json$/i, ''),
            author: parsed.author || rawObj.updatedBy || 'Studio',
            updatedBy: rawObj.updatedBy || parsed.author || 'Studio',
            version,
            explicitVersion,
            updatedAt: rawObj.updatedAt || rawObj.exportedAt || new Date().toISOString(),
            createdAt: rawObj.createdAt || rawObj.exportedAt || new Date().toISOString(),
            bpm: parsed.track?.bpm || parsed.timeline?.bpm || 120,
            durationSec: parsed.track?.durationSec || parsed.timeline?.durationSec || 60,
            layerCount,
            clipCount,
            sectionCount: parsed.analysis?.sections?.length || 0,
            videoId: parsed.track?.videoId || null,
            sourceUrl: parsed.track?.sourceUrl || null,
            sha256,
            audioUrl: rawObj.audioUrl || (sha256 ? `${FIREBASE_CONFIG.githubReleaseAudioBase}/${sha256}${parsed.track?.extension || '.mp3'}` : null),
            summary: rawObj.summary || `Git show · ${layerCount} slojeva · ${clipCount} clipova`,
            timelineHash: hashTimeline(parsed.timeline),
            source: existing?.source === 'cloud' ? 'cloud+git' : 'git',
            track: parsed.track
          });
        }
      } catch {}
    }
  }

  async function init() {
    if (!initPromise) {
      initPromise = (async () => {
        await mkdir(versionsDir, { recursive: true, mode: 0o755 }).catch(() => {});
        try {
          const cached = JSON.parse(await readFile(cloudCachePath, 'utf8'));
          if (Array.isArray(cached?.shows)) {
            for (const s of cached.shows) {
              if (s?.showId) showsById.set(s.showId, s);
            }
          }
          if (Array.isArray(cached?.activity)) {
            activityFeed = cached.activity;
          }
        } catch {}
        await loadGitSharedShows();
        if (enabled) {
          await pullFromFirestore().catch(() => {});
          startPolling();
        }
      })();
    }
    return initPromise;
  }

  /** Pull latest catalog, online presence, and activity feed from Firestore. */
  async function pullFromFirestore() {
    if (!enabled) return false;
    try {
      const [showsRes, presenceRes, activityRes] = await Promise.all([
        firestoreRequest('/shows?pageSize=100'),
        firestoreRequest('/presence?pageSize=50').catch(() => null),
        firestoreRequest('/activity?pageSize=50').catch(() => null)
      ]);

      cloudOnline = true;
      lastSyncAt = new Date().toISOString();
      lastError = null;

      let changedShows = [];
      if (Array.isArray(showsRes?.documents)) {
        for (const rawDoc of showsRes.documents) {
          const doc = fromFirestoreDoc(rawDoc);
          if (!doc || !doc.title) continue;
          const showId = doc.showId || doc._docId;
          let trackMeta = {};
          if (typeof doc.trackJson === 'string' && doc.trackJson) {
            try { trackMeta = JSON.parse(doc.trackJson); } catch {}
          }
          const prev = showsById.get(showId);
          const cloudVer = Number(doc.version) || 1;
          const sha256 = doc.sha256 || trackMeta.sha256 || prev?.sha256 || null;
          const ext = trackMeta.extension || prev?.track?.extension || '.mp3';
          const entry = {
            showId,
            filename: doc.filename || prev?.filename || `${sanitizeFilename(doc.title)}.ledshow.json`,
            title: doc.title,
            author: doc.author || doc.updatedBy || 'Studio',
            updatedBy: doc.updatedBy || doc.author || 'Studio',
            version: cloudVer,
            updatedAt: doc.updatedAt || new Date().toISOString(),
            createdAt: doc.createdAt || doc.updatedAt || new Date().toISOString(),
            bpm: Number(doc.bpm) || trackMeta.bpm || prev?.bpm || 120,
            durationSec: Number(doc.durationSec) || trackMeta.durationSec || prev?.durationSec || 60,
            layerCount: Number(doc.layerCount) || prev?.layerCount || 0,
            clipCount: Number(doc.clipCount) || prev?.clipCount || 0,
            sectionCount: Number(doc.sectionCount) || prev?.sectionCount || 0,
            videoId: doc.videoId || trackMeta.videoId || prev?.videoId || null,
            sourceUrl: doc.sourceUrl || trackMeta.sourceUrl || prev?.sourceUrl || null,
            sha256,
            audioUrl: doc.audioUrl || prev?.audioUrl || (sha256 ? `${FIREBASE_CONFIG.githubReleaseAudioBase}/${sha256}${ext}` : null),
            summary: doc.summary || prev?.summary || '',
            timelineHash: doc.timelineHash || prev?.timelineHash || '',
            source: 'cloud',
            track: {
              ...prev?.track,
              ...trackMeta,
              title: doc.title,
              sha256,
              videoId: doc.videoId || trackMeta.videoId || prev?.videoId || undefined,
              sourceUrl: doc.sourceUrl || trackMeta.sourceUrl || prev?.sourceUrl || undefined,
              bpm: Number(doc.bpm) || trackMeta.bpm || 120,
              durationSec: Number(doc.durationSec) || trackMeta.durationSec || 60
            }
          };

          if (!prev || prev.version < cloudVer || prev.timelineHash !== entry.timelineHash) {
            changedShows.push({ showId, entry, timelineJson: doc.timelineJson, analysisJson: doc.analysisJson });
          }
          showsById.set(showId, entry);
        }
      }

      // Sync any newer cloud shows down to `shared-shows/` on disk so local Git backup stays fresh
      for (const item of changedShows) {
        if (item.timelineJson) {
          try {
            const timeline = JSON.parse(item.timelineJson);
            const analysis = item.analysisJson ? JSON.parse(item.analysisJson) : null;
            const showObj = {
              ...encodeShowJson({
                track: item.entry.track,
                analysis,
                timeline,
                author: item.entry.updatedBy || item.entry.author
              }),
              showId: item.showId,
              version: item.entry.version,
              updatedBy: item.entry.updatedBy || item.entry.author,
              updatedAt: item.entry.updatedAt,
              summary: item.entry.summary,
              audioUrl: item.entry.audioUrl
            };
            await mkdir(sharedShowsDir, { recursive: true, mode: 0o755 });
            await atomicWriteJson(join(sharedShowsDir, item.entry.filename), showObj);
          } catch {}
        }
      }

      if (Array.isArray(presenceRes?.documents)) {
        const nowMs = Date.now();
        presenceByClient.clear();
        for (const rawDoc of presenceRes.documents) {
          const p = fromFirestoreDoc(rawDoc);
          if (!p || !p.name) continue;
          const cid = p.clientId || p._docId;
          const ageMs = nowMs - (Number(p.updatedAtMs) || Date.parse(p.updatedAt || '') || 0);
          // Keep peers seen in the last 10 minutes
          if (ageMs < 10 * 60 * 1000) {
            presenceByClient.set(cid, {
              clientId: cid,
              name: p.name,
              activeShowId: p.activeShowId || null,
              activeShowTitle: p.activeShowTitle || null,
              status: p.status || 'online',
              isPlaying: Boolean(p.isPlaying),
              version: Number(p.version) || null,
              bpm: Number(p.bpm) || null,
              timeSec: Number(p.timeSec) || 0,
              updatedAt: p.updatedAt || new Date().toISOString(),
              updatedAtMs: Number(p.updatedAtMs) || nowMs,
              online: ageMs < 90 * 1000
            });
          }
        }
      }

      if (Array.isArray(activityRes?.documents)) {
        const items = activityRes.documents
          .map(fromFirestoreDoc)
          .filter(Boolean)
          .sort((a, b) => (Number(b.createdAtMs) || Date.parse(b.createdAt || '') || 0) - (Number(a.createdAtMs) || Date.parse(a.createdAt || '') || 0))
          .slice(0, 40);
        if (items.length) activityFeed = items;
      }

      await persistCloudIndexCache();
      if (changedShows.length > 0 && typeof onRemoteUpdate === 'function') {
        onRemoteUpdate({ changedShows: changedShows.map(c => c.entry) });
      }
      return true;
    } catch (err) {
      cloudOnline = false;
      lastError = err.message;
      return false;
    }
  }

  function startPolling() {
    if (pollTimer || !enabled) return;
    pollTimer = setInterval(() => {
      pullFromFirestore().catch(() => {});
    }, 10000);
    pollTimer.unref?.();
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  /**
   * Record a save / modification of a track's show:
   * 1. Computes version number (`v1`, `v2`, `v3`...) and diff summary
   * 2. Appends to local `data/versions/<showId>.json`
   * 3. Writes `shared-shows/<Title>.ledshow.json` (Git offline backup)
   * 4. Pushes `/shows/{showId}`, `/shows/{showId}/versions/v{N}`, and `/activity/{id}` to Firestore
   */
  async function publishShowSave({
    track,
    analysis = null,
    timeline,
    author = 'Studio',
    clientId = '',
    note = '',
    action = 'save',
    forceNewVersion = false,
    awaitCloud = false
  } = {}) {
    await init();
    if (!track || !timeline) throw new Error('Nedostaje pjesma ili timeline za spremanje verzije.');

    const cleanAuthor = (typeof author === 'string' && author.trim()) ? author.trim().slice(0, 80) : (track.author || 'Studio');
    const showId = computeShowId(track);
    const newHash = hashTimeline(timeline);
    const localHistory = await readLocalVersionFile(showId);
    const existingShow = showsById.get(showId);
    const latestLocalVer = localHistory.versions[0] || null;

    // If the timeline is byte-for-byte identical to the latest saved version and not forced, return current version without creating a duplicate snapshot
    if (!forceNewVersion && latestLocalVer && latestLocalVer.timelineHash === newHash) {
      return {
        ok: true,
        skippedDuplicate: true,
        showId,
        version: latestLocalVer.version,
        summary: latestLocalVer.summary,
        updatedBy: latestLocalVer.author,
        updatedAt: latestLocalVer.createdAt
      };
    }

    const prevTimeline = latestLocalVer?.timeline || null;
    const baseVersion = Math.max(
      existingShow?.explicitVersion ?? existingShow?.version ?? 0,
      latestLocalVer?.version || 0
    );
    const nextVersion = baseVersion + 1;
    const nowIso = new Date().toISOString();
    const nowMs = Date.now();
    const summary = summarizeTimelineDiff(prevTimeline, timeline, note);
    const compactAn = compactAnalysisForShow(analysis);
    const trackManifest = extractTrackManifest(track, analysis, timeline);
    const clipCount = (timeline.layers || []).reduce((sum, l) => sum + (l.clips?.length || 0), 0);
    const layerCount = timeline.layers?.length || 0;
    const filename = existingShow?.filename || `${sanitizeFilename(track.title || track.originalName)}.ledshow.json`;
    const sha256 = track.sha256 || existingShow?.sha256 || null;
    const ext = track.extension || '.mp3';
    const audioUrl = existingShow?.audioUrl || (sha256 ? `${FIREBASE_CONFIG.githubReleaseAudioBase}/${sha256}${ext}` : null);

    const versionEntry = {
      version: nextVersion,
      versionId: `v${nextVersion}`,
      showId,
      title: trackManifest.title,
      author: cleanAuthor,
      updatedBy: cleanAuthor,
      note: note ? String(note).slice(0, 500) : '',
      summary,
      clipCount,
      layerCount,
      bpm: Number(trackManifest.bpm) || 120,
      durationSec: Number(trackManifest.durationSec) || 60,
      createdAt: nowIso,
      createdAtMs: nowMs,
      timelineHash: newHash,
      timeline,
      analysis: compactAn
    };

    // Keep up to 50 local versions per song
    const nextVersionsList = [
      versionEntry,
      ...localHistory.versions.filter(v => v.version !== nextVersion)
    ].slice(0, 50);
    await writeLocalVersionFile(showId, {
      showId,
      title: trackManifest.title,
      latestVersion: nextVersion,
      updatedAt: nowIso,
      versions: nextVersionsList
    });

    // Write Git offline backup (`shared-shows/<Title>.ledshow.json`)
    const gitShowObj = {
      ...encodeShowJson({ track: trackManifest, analysis: compactAn, timeline, author: cleanAuthor }),
      showId,
      version: nextVersion,
      updatedBy: cleanAuthor,
      updatedAt: nowIso,
      summary,
      ...(audioUrl ? { audioUrl } : {})
    };
    await mkdir(sharedShowsDir, { recursive: true, mode: 0o755 });
    await atomicWriteJson(join(sharedShowsDir, filename), gitShowObj);

    const catalogEntry = {
      showId,
      filename,
      title: trackManifest.title,
      author: cleanAuthor,
      updatedBy: cleanAuthor,
      version: nextVersion,
      explicitVersion: nextVersion,
      updatedAt: nowIso,
      createdAt: existingShow?.createdAt || nowIso,
      bpm: Number(trackManifest.bpm) || 120,
      durationSec: Number(trackManifest.durationSec) || 60,
      layerCount,
      clipCount,
      sectionCount: compactAn?.sections?.length || 0,
      videoId: trackManifest.videoId || null,
      sourceUrl: trackManifest.sourceUrl || null,
      sha256,
      audioUrl,
      summary,
      timelineHash: newHash,
      source: enabled ? 'cloud' : 'git',
      track: trackManifest
    };
    showsById.set(showId, catalogEntry);

    const activityEvent = {
      id: `${nowMs}-${randomUUID().slice(0, 8)}`,
      action,
      actorName: cleanAuthor,
      showId,
      title: trackManifest.title,
      version: nextVersion,
      clipCount,
      layerCount,
      message: `${cleanAuthor} spremio v${nextVersion} · ${summary}`,
      createdAt: nowIso,
      createdAtMs: nowMs
    };
    activityFeed = [activityEvent, ...activityFeed].slice(0, 40);
    await persistCloudIndexCache();

    // Sync to Firebase Cloud Firestore asynchronously (or await with fast timeout)
    const timelineJson = JSON.stringify(timeline);
    const analysisJson = compactAn ? JSON.stringify(compactAn) : '';
    const trackJson = JSON.stringify(trackManifest);

    if (enabled && timelineJson.length <= 890000) {
      const firestoreShowDoc = {
        fields: toFirestoreFields({
          studioKey: FIREBASE_CONFIG.studioKey,
          showId,
          filename,
          title: trackManifest.title.slice(0, 200),
          author: cleanAuthor.slice(0, 120),
          updatedBy: cleanAuthor.slice(0, 120),
          version: nextVersion,
          bpm: Number(trackManifest.bpm) || 120,
          durationSec: Number(trackManifest.durationSec) || 60,
          layerCount,
          clipCount,
          sectionCount: compactAn?.sections?.length || 0,
          videoId: trackManifest.videoId || '',
          sourceUrl: trackManifest.sourceUrl || '',
          sha256: sha256 || '',
          audioUrl: audioUrl || '',
          summary: summary.slice(0, 1900),
          note: String(note || '').slice(0, 900),
          timelineHash: newHash,
          trackJson,
          analysisJson: analysisJson.length <= 450000 ? analysisJson : '',
          timelineJson,
          createdAt: catalogEntry.createdAt,
          updatedAt: nowIso,
          updatedAtMs: nowMs
        })
      };

      const firestoreVersionDoc = {
        fields: toFirestoreFields({
          studioKey: FIREBASE_CONFIG.studioKey,
          showId,
          version: nextVersion,
          title: trackManifest.title.slice(0, 200),
          author: cleanAuthor.slice(0, 120),
          updatedBy: cleanAuthor.slice(0, 120),
          note: String(note || '').slice(0, 900),
          summary: summary.slice(0, 1900),
          clipCount,
          layerCount,
          bpm: Number(trackManifest.bpm) || 120,
          durationSec: Number(trackManifest.durationSec) || 60,
          timelineHash: newHash,
          analysisJson: analysisJson.length <= 350000 ? analysisJson : '',
          timelineJson,
          createdAt: nowIso,
          createdAtMs: nowMs
        })
      };

      const firestoreActivityDoc = {
        fields: toFirestoreFields({
          studioKey: FIREBASE_CONFIG.studioKey,
          id: activityEvent.id,
          action: action.slice(0, 90),
          actorName: cleanAuthor.slice(0, 95),
          showId: showId.slice(0, 190),
          title: trackManifest.title.slice(0, 200),
          version: nextVersion,
          clipCount,
          layerCount,
          message: activityEvent.message.slice(0, 950),
          createdAt: nowIso,
          createdAtMs: nowMs
        })
      };

      const cloudWritePromise = Promise.all([
        firestoreRequest(`/shows/${encodeURIComponent(showId)}`, { method: 'PATCH', body: firestoreShowDoc }),
        firestoreRequest(`/shows/${encodeURIComponent(showId)}/versions/v${nextVersion}`, { method: 'PATCH', body: firestoreVersionDoc }),
        firestoreRequest(`/activity/${encodeURIComponent(activityEvent.id)}`, { method: 'PATCH', body: firestoreActivityDoc }),
        clientId ? updatePresence({
          clientId,
          name: cleanAuthor,
          activeShowId: showId,
          activeShowTitle: trackManifest.title,
          version: nextVersion,
          status: 'editing'
        }) : Promise.resolve()
      ]).then(() => {
        cloudOnline = true;
        lastSyncAt = new Date().toISOString();
      }).catch(err => {
        lastError = err.message;
      });

      if (awaitCloud) {
        await cloudWritePromise;
      }
    }

    return {
      ok: true,
      showId,
      filename,
      version: nextVersion,
      summary,
      updatedBy: cleanAuthor,
      updatedAt: nowIso
    };
  }

  /** Update live online presence in Firestore so friends see who is working on what song right now. */
  let lastPresencePushByClient = new Map();
  async function updatePresence({
    clientId,
    name = 'Studio',
    activeShowId = '',
    activeShowTitle = '',
    status = 'online',
    isPlaying = false,
    version = 1,
    bpm = 120,
    timeSec = 0,
    force = false
  } = {}) {
    if (!clientId) return;
    const cleanId = String(clientId).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
    if (!cleanId) return;
    const cleanName = (typeof name === 'string' && name.trim()) ? name.trim().slice(0, 90) : 'Kolega';
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();

    const prevPush = lastPresencePushByClient.get(cleanId);
    const sig = `${cleanName}|${activeShowId}|${activeShowTitle}|${status}|${Boolean(isPlaying)}|${version}`;
    if (!force && prevPush && prevPush.sig === sig && (nowMs - prevPush.atMs < 25000)) {
      return;
    }
    lastPresencePushByClient.set(cleanId, { sig, atMs: nowMs });

    const entry = {
      clientId: cleanId,
      name: cleanName,
      activeShowId: activeShowId || null,
      activeShowTitle: activeShowTitle || null,
      status,
      isPlaying: Boolean(isPlaying),
      version: Number(version) || 1,
      bpm: Number(bpm) || 120,
      timeSec: Number(timeSec) || 0,
      updatedAt: nowIso,
      updatedAtMs: nowMs,
      online: true
    };
    presenceByClient.set(cleanId, entry);

    if (enabled) {
      const doc = {
        fields: toFirestoreFields({
          studioKey: FIREBASE_CONFIG.studioKey,
          clientId: cleanId,
          name: cleanName,
          activeShowId: String(activeShowId || '').slice(0, 190),
          activeShowTitle: String(activeShowTitle || '').slice(0, 190),
          status: String(status || 'online').slice(0, 90),
          isPlaying: Boolean(isPlaying),
          version: Number.isInteger(version) && version >= 1 ? version : 1,
          bpm: Number(bpm) || 120,
          timeSec: Math.round(Number(timeSec) || 0),
          updatedAt: nowIso,
          updatedAtMs: nowMs
        })
      };
      await firestoreRequest(`/presence/${encodeURIComponent(cleanId)}`, { method: 'PATCH', body: doc }).catch(() => {});
    }
  }

  /** Fetch full version history (`v1, v2, v3...`) for a show (merges Firestore + local disk). */
  async function getVersionsForShow(showIdOrTrack) {
    await init();
    const showId = typeof showIdOrTrack === 'string' ? showIdOrTrack : computeShowId(showIdOrTrack);
    const local = await readLocalVersionFile(showId);
    const byVer = new Map();
    for (const v of local.versions) {
      byVer.set(v.version, v);
    }

    if (enabled) {
      try {
        const res = await firestoreRequest(`/shows/${encodeURIComponent(showId)}/versions?pageSize=50`);
        if (Array.isArray(res?.documents)) {
          for (const rawDoc of res.documents) {
            const d = fromFirestoreDoc(rawDoc);
            if (!d || !d.version) continue;
            const verNum = Number(d.version);
            if (!byVer.has(verNum)) {
              let timeline = null;
              let analysis = null;
              try { if (d.timelineJson) timeline = JSON.parse(d.timelineJson); } catch {}
              try { if (d.analysisJson) analysis = JSON.parse(d.analysisJson); } catch {}
              byVer.set(verNum, {
                version: verNum,
                versionId: `v${verNum}`,
                showId,
                title: d.title || '',
                author: d.author || d.updatedBy || 'Studio',
                updatedBy: d.updatedBy || d.author || 'Studio',
                note: d.note || '',
                summary: d.summary || '',
                clipCount: Number(d.clipCount) || 0,
                layerCount: Number(d.layerCount) || 0,
                bpm: Number(d.bpm) || 120,
                durationSec: Number(d.durationSec) || 60,
                createdAt: d.createdAt || new Date().toISOString(),
                createdAtMs: Number(d.createdAtMs) || Date.parse(d.createdAt || '') || 0,
                timelineHash: d.timelineHash || '',
                timeline,
                analysis
              });
            }
          }
        }
      } catch {}
    }

    // If no versions recorded yet, synthesize v1 from shared-shows/ or Firestore show doc
    if (byVer.size === 0) {
      const showMeta = showsById.get(showId);
      if (showMeta) {
        const full = await fetchFullShowPayload(showId).catch(() => null);
        if (full?.timeline) {
          byVer.set(showMeta.version || 1, {
            version: showMeta.version || 1,
            versionId: `v${showMeta.version || 1}`,
            showId,
            title: showMeta.title,
            author: showMeta.author || 'Studio',
            updatedBy: showMeta.updatedBy || showMeta.author || 'Studio',
            note: '',
            summary: showMeta.summary || 'Početna verzija',
            clipCount: showMeta.clipCount || 0,
            layerCount: showMeta.layerCount || 0,
            bpm: showMeta.bpm || 120,
            durationSec: showMeta.durationSec || 60,
            createdAt: showMeta.updatedAt || new Date().toISOString(),
            createdAtMs: Date.parse(showMeta.updatedAt || '') || Date.now(),
            timeline: full.timeline,
            analysis: full.analysis || null
          });
        }
      }
    }

    const sorted = [...byVer.values()].sort((a, b) => b.version - a.version);
    return {
      showId,
      title: showsById.get(showId)?.title || local.title || showId,
      latestVersion: sorted[0]?.version || 1,
      versions: sorted.map(v => ({
        version: v.version,
        versionId: `v${v.version}`,
        showId,
        title: v.title,
        author: v.author || v.updatedBy || 'Studio',
        updatedBy: v.updatedBy || v.author || 'Studio',
        note: v.note || '',
        summary: v.summary || '',
        clipCount: v.clipCount || (v.timeline?.layers || []).reduce((s, l) => s + (l.clips?.length || 0), 0),
        layerCount: v.layerCount || v.timeline?.layers?.length || 0,
        bpm: v.bpm || 120,
        durationSec: v.durationSec || 60,
        createdAt: v.createdAt
      })),
      _rawVersions: sorted
    };
  }

  /** Retrieve the full `{ track, analysis, timeline, version, author }` for a showId (and optional specific version). */
  async function fetchFullShowPayload(showId, targetVersion = null) {
    await init();
    if (targetVersion !== null && Number.isFinite(Number(targetVersion))) {
      const verNum = Number(targetVersion);
      const history = await getVersionsForShow(showId);
      const match = history._rawVersions.find(v => v.version === verNum);
      if (match && match.timeline) {
        const meta = showsById.get(showId);
        return {
          showId,
          version: match.version,
          author: match.author,
          summary: match.summary,
          track: meta?.track || { title: match.title, bpm: match.bpm, durationSec: match.durationSec },
          analysis: match.analysis || null,
          timeline: match.timeline,
          audioUrl: meta?.audioUrl || null
        };
      }
    }

    // Try local `shared-shows/` file first if its version matches the latest known version
    const meta = showsById.get(showId);
    if (meta?.filename) {
      try {
        const raw = await readFile(join(sharedShowsDir, meta.filename), 'utf8');
        const rawObj = JSON.parse(raw);
        const decoded = decodeShowJson(rawObj);
        if (!enabled || (rawObj.version && rawObj.version >= (meta.version || 1))) {
          return {
            showId,
            version: rawObj.version || meta.version || 1,
            author: rawObj.updatedBy || decoded.author || meta.author || 'Studio',
            summary: rawObj.summary || meta.summary || '',
            track: decoded.track,
            analysis: decoded.analysis,
            timeline: decoded.timeline,
            audioUrl: rawObj.audioUrl || meta.audioUrl || null
          };
        }
      } catch {}
    }

    // Pull directly from Firestore `/shows/{showId}`
    if (enabled) {
      const rawDoc = await firestoreRequest(`/shows/${encodeURIComponent(showId)}`);
      const doc = fromFirestoreDoc(rawDoc);
      if (doc && doc.timelineJson) {
        const timeline = JSON.parse(doc.timelineJson);
        const analysis = doc.analysisJson ? JSON.parse(doc.analysisJson) : null;
        const track = doc.trackJson ? JSON.parse(doc.trackJson) : (meta?.track || { title: doc.title });
        return {
          showId,
          version: Number(doc.version) || 1,
          author: doc.updatedBy || doc.author || 'Studio',
          summary: doc.summary || '',
          track,
          analysis,
          timeline,
          audioUrl: doc.audioUrl || meta?.audioUrl || null
        };
      }
    }

    throw new Error(`Show „${showId}” nije pronađen u oblaku ni u shared-shows.`);
  }

  /** Get current catalog, presence, and activity snapshot for the UI. */
  async function getCatalogSnapshot({ forceRefresh = false } = {}) {
    await init();
    if (forceRefresh && enabled) {
      await pullFromFirestore().catch(() => {});
    }
    await loadGitSharedShows();
    const localTracks = library ? await library.list().catch(() => []) : [];

    const shows = [...showsById.values()]
      .map(sh => {
        const matchedLocal = library?.findTrackByVideo?.({
          sha256: sh.sha256,
          videoId: sh.videoId,
          title: sh.title
        }) || localTracks.find(t => computeShowId(t) === sh.showId) || null;
        const localVersion = matchedLocal?.version || (matchedLocal ? 1 : null);
        const activeEditors = [...presenceByClient.values()].filter(
          p => p.online && (p.activeShowId === sh.showId || (p.activeShowTitle && p.activeShowTitle.toLowerCase() === (sh.title || '').toLowerCase()))
        );
        return {
          ...sh,
          installedTrackId: matchedLocal?.id || null,
          localVersion,
          hasUpdate: Boolean(matchedLocal && localVersion && sh.version > localVersion),
          activeEditors
        };
      })
      .sort((a, b) => Date.parse(b.updatedAt || '') - Date.parse(a.updatedAt || ''));

    const peers = [...presenceByClient.values()].sort((a, b) => (b.updatedAtMs || 0) - (a.updatedAtMs || 0));

    return {
      ok: true,
      cloudOnline,
      projectId: FIREBASE_CONFIG.projectId,
      lastSyncAt,
      lastError,
      shows,
      sharedShows: shows,
      peers,
      activity: activityFeed.slice(0, 35)
    };
  }

  return {
    init,
    computeShowId,
    pullFromFirestore,
    publishShowSave,
    updatePresence,
    getVersionsForShow,
    fetchFullShowPayload,
    getCatalogSnapshot,
    stopPolling,
    getByFilename: filename => [...showsById.values()].find(s => s.filename === filename) || null,
    getByShowId: showId => showsById.get(showId) || null
  };
}
