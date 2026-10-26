// background.js - Service Worker for YouTube Plus Downloader & LEDicated Studio Bridge

const LOCAL_COMPANION_URL = 'http://127.0.0.1:5000';
const DEFAULT_LEDICATED_SERVER_URL = 'http://127.0.0.1:8787';
let cachedLedicatedServerUrl = DEFAULT_LEDICATED_SERVER_URL;

function normalizeServerUrl(url) {
  let clean = String(url || '').trim().replace(/\/+$/, '');
  if (!clean) return DEFAULT_LEDICATED_SERVER_URL;
  if (!/^https?:\/\//i.test(clean)) clean = `http://${clean}`;
  return clean;
}

async function getLedicatedServerUrl() {
  try {
    const stored = await chrome.storage.local.get(['ledicatedServerUrl']);
    if (stored.ledicatedServerUrl) {
      cachedLedicatedServerUrl = normalizeServerUrl(stored.ledicatedServerUrl);
    }
  } catch (e) {}
  return cachedLedicatedServerUrl;
}

// Check if Local Companion server is active
async function checkCompanionServer() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1200);
    const res = await fetch(`${LOCAL_COMPANION_URL}/health`, { signal: controller.signal });
    clearTimeout(timeout);
    if (res.ok) {
      const data = await res.json();
      return { online: true, data };
    }
  } catch (e) {}
  return { online: false };
}

// Generic helper for LEDicated Studio API calls with timeout
async function requestLedicated(path, options = {}, timeoutMs = 2500) {
  const baseUrl = await getLedicatedServerUrl();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    });
    clearTimeout(timeout);
    const text = await res.text();
    let data = {};
    if (text) {
      try {
        data = JSON.parse(text);
      } catch (parseErr) {
        data = { raw: text };
      }
    }
    if (!res.ok) {
      return {
        ok: false,
        online: true,
        status: res.status,
        error: data.error || data.message || `HTTP ${res.status}`,
        ...data
      };
    }
    return {
      ok: data.ok !== false,
      online: true,
      ...data
    };
  } catch (err) {
    clearTimeout(timeout);
    return {
      ok: false,
      online: false,
      error: err?.name === 'AbortError' ? 'LEDicated server timeout' : (err?.message || 'LEDicated server offline')
    };
  }
}

// Download via Local Companion (yt-dlp + ffmpeg)
async function downloadViaCompanion(url, type, quality, title) {
  const payload = {
    url,
    type,
    quality,
    title
  };

  const res = await fetch(`${LOCAL_COMPANION_URL}/download`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Companion error: ${errText}`);
  }

  return await res.json();
}

// Handle Messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.action) {
    return false;
  }

  if (message.action === 'CHECK_COMPANION') {
    (async () => {
      const status = await checkCompanionServer();
      sendResponse(status);
    })();
    return true;
  }

  if (message.action === 'START_DOWNLOAD') {
    (async () => {
      const { videoUrl, type, quality, title } = message.data || {};
      const companion = await checkCompanionServer();

      if (companion.online) {
        try {
          const result = await downloadViaCompanion(videoUrl, type, quality, title);
          sendResponse({
            success: true,
            via: 'companion',
            jobId: result.jobId,
            message: result.message
          });
          return;
        } catch (err) {
          console.warn('[YouTube Plus] Companion download error:', err.message);
        }
      }

      // Fallback
      sendResponse({
        success: false,
        error: 'Companion offline. Please run the YouTube Plus app or companion server.'
      });
    })();
    return true;
  }

  if (message.action === 'GET_JOB_STATUS') {
    (async () => {
      try {
        const res = await fetch(`${LOCAL_COMPANION_URL}/job/${message.jobId}`);
        const data = await res.json();
        sendResponse(data);
      } catch (e) {
        sendResponse({ success: false, error: e.message });
      }
    })();
    return true;
  }

  if (message.action === 'OPEN_DOWNLOADS') {
    (async () => {
      try {
        const res = await fetch(`${LOCAL_COMPANION_URL}/open-downloads`, { method: 'POST' });
        const data = await res.json();
        sendResponse(data);
      } catch (e) {
        sendResponse({ success: false, error: e.message });
      }
    })();
    return true;
  }

  if (message.action === 'GET_SETTINGS') {
    (async () => {
      const settings = await chrome.storage.local.get([
        'defaultVideoQuality',
        'defaultAudioQuality',
        'showQuickButton',
        'ledicatedTheme',
        'ledicatedUseGemini',
        'ledicatedMaster',
        'ledicatedAutoImport',
        'ledicatedServerUrl'
      ]);
      const normalizedUrl = normalizeServerUrl(settings.ledicatedServerUrl);
      cachedLedicatedServerUrl = normalizedUrl;
      sendResponse({
        success: true,
        settings: {
          defaultVideoQuality: settings.defaultVideoQuality || '1080',
          defaultAudioQuality: settings.defaultAudioQuality || '320',
          showQuickButton: settings.showQuickButton !== false,
          ledicatedTheme: settings.ledicatedTheme || 'midnight',
          ledicatedUseGemini: settings.ledicatedUseGemini !== false,
          ledicatedMaster: typeof settings.ledicatedMaster === 'number' ? settings.ledicatedMaster : 70,
          ledicatedAutoImport: settings.ledicatedAutoImport !== false,
          ledicatedServerUrl: normalizedUrl
        }
      });
    })();
    return true;
  }

  if (message.action === 'SAVE_SETTINGS') {
    (async () => {
      const nextSettings = { ...(message.settings || {}) };
      if (nextSettings.ledicatedServerUrl !== undefined) {
        nextSettings.ledicatedServerUrl = normalizeServerUrl(nextSettings.ledicatedServerUrl);
        cachedLedicatedServerUrl = nextSettings.ledicatedServerUrl;
      }
      await chrome.storage.local.set(nextSettings);
      sendResponse({ success: true, settings: nextSettings });
    })();
    return true;
  }

  // --- LEDicated Studio Bridge Handlers ---

  if (message.action === 'LEDICATED_STATUS') {
    (async () => {
      const payload = message.data || message;
      const videoId = payload.videoId || '';
      const title = payload.title || '';
      const qs = `videoId=${encodeURIComponent(videoId)}&title=${encodeURIComponent(title)}`;
      const result = await requestLedicated(`/api/ext/status?${qs}`, { method: 'GET' }, 2000);
      sendResponse(result);
    })();
    return true;
  }

  if (message.action === 'LEDICATED_IMPORT') {
    (async () => {
      const payload = message.data || message;
      const body = {
        url: payload.url || '',
        videoId: payload.videoId || '',
        title: payload.title || '',
        theme: payload.theme || 'midnight',
        useGemini: payload.useGemini !== false
      };
      const result = await requestLedicated(
        '/api/ext/import',
        {
          method: 'POST',
          body: JSON.stringify(body)
        },
        15000
      );
      sendResponse(result);
    })();
    return true;
  }

  if (message.action === 'LEDICATED_SYNC') {
    (async () => {
      const payload = message.data || message;
      const body = {
        videoId: payload.videoId || '',
        title: payload.title || '',
        url: payload.url || '',
        currentTime: Number(payload.currentTime) || 0,
        duration: Number(payload.duration) || 0,
        paused: Boolean(payload.paused),
        playbackRate: Number(payload.playbackRate) || 1,
        liveMode: payload.liveMode !== false,
        theme: payload.theme || 'midnight',
        stems: payload.stems || null
      };
      const result = await requestLedicated(
        '/api/ext/sync',
        {
          method: 'POST',
          body: JSON.stringify(body)
        },
        1200
      );
      sendResponse(result);
    })();
    return true;
  }

  if (message.action === 'LEDICATED_CONTROL') {
    (async () => {
      const payload = message.data || message;
      const body = {};
      if (payload.master !== undefined) body.master = Number(payload.master);
      if (payload.blackout !== undefined) body.blackout = Boolean(payload.blackout);
      if (payload.armed !== undefined) body.armed = Boolean(payload.armed);
      if (payload.theme !== undefined) body.theme = payload.theme;
      if (payload.regenerate !== undefined) body.regenerate = Boolean(payload.regenerate);
      if (payload.useGemini !== undefined) body.useGemini = Boolean(payload.useGemini);
      if (payload.videoId !== undefined) body.videoId = payload.videoId;
      if (payload.title !== undefined) body.title = payload.title;

      const result = await requestLedicated(
        '/api/ext/control',
        {
          method: 'POST',
          body: JSON.stringify(body)
        },
        10000
      );
      sendResponse(result);
    })();
    return true;
  }

  return false;
});
