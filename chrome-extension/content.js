// content.js - YouTube Plus Downloader & LEDicated Live Light Show Studio Integration

(function() {
  let currentVideoData = {
    videoId: '',
    title: ''
  };

  let userSettings = {
    defaultVideoQuality: '1080',
    defaultAudioQuality: '320',
    showQuickButton: true,
    ledicatedTheme: 'midnight',
    ledicatedUseGemini: true,
    ledicatedMaster: 70,
    ledicatedAutoImport: true,
    ledicatedServerUrl: 'http://127.0.0.1:8787',
    ledicatedClientId: '',
    ledicatedUserName: ''
  };

  // LEDicated runtime state
  const ledicatedState = {
    online: false,
    liveMode: false,
    popoverOpen: false,
    mode: 'idle', // 'idle' | 'live_stream' | 'timeline'
    track: null,
    importJob: null,
    master: 70,
    blackout: false,
    armed: false,
    theme: 'midnight',
    useGemini: true,
    isStageOwner: true,
    lan: null,
    lastVideoId: '',
    autoImportedVideoIds: new Set(),
    syncTimer: null,
    statusTimer: null,
    syncInFlight: false,
    lastStems: {
      bass: 0,
      drums: 0,
      vocals: 0,
      other: 0,
      rms: 0,
      isBeat: false,
      isDrop: false
    }
  };

  // Non-destructive WebAudio stem extractor state
  const audioTap = {
    audioCtx: null,
    analyser: null,
    sourceNode: null,
    attachedVideo: null,
    attachedStream: null,
    freqData: null,
    prevFreqData: null,
    prevSubKick: 0,
    drumsHistory: [],
    rolling2sWindow: [],
    lastBeatAtMs: 0,
    mainWorldStems: null
  };

  const SVG_VIDEO = `<svg viewBox="0 0 24 24"><path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4zM15 16H5V8h10v8z"/></svg>`;
  const SVG_AUDIO = `<svg viewBox="0 0 24 24"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>`;
  const SVG_CHECK = `<svg viewBox="0 0 24 24" style="width:13px;height:13px;fill:#2ea043;"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>`;
  const SVG_LIGHTSHOW = `<svg viewBox="0 0 24 24"><path d="M9 21c0 .55.45 1 1 1h4c.55 0 1-.45 1-1v-1H9v1zm3-19C8.14 2 5 5.14 5 9c0 2.38 1.19 4.47 3 5.74V17c0 .55.45 1 1 1h6c.55 0 1-.45 1-1v-2.26c1.81-1.27 3-3.36 3-5.74 0-3.86-3.14-7-7-7zm2.85 11.1l-.85.6V16h-4v-2.3l-.85-.6A4.997 4.997 0 017 9c0-2.76 2.24-5 5-5s5 2.24 5 5c0 1.63-.8 3.16-2.15 4.1z"/></svg>`;
  const SVG_SPARKLES = `<svg viewBox="0 0 24 24"><path d="M19 9l1.25-2.75L23 5l-2.75-1.25L19 1l-1.25 2.75L15 5l2.75 1.25L19 9zm-7.5.5L9 4 6.5 9.5 1 12l5.5 2.5L9 20l2.5-5.5L17 12l-5.5-2.5zM19 15l-1.25 2.75L15 19l2.75 1.25L19 23l1.25-2.75L23 19l-2.75-1.25L19 15z"/></svg>`;

  const LEDICATED_THEMES = [
    { id: 'midnight', label: 'Klupska ponoć (Midnight)' },
    { id: 'cyber', label: 'Cyber Neon' },
    { id: 'sunset', label: 'Topli zalazak (Sunset)' },
    { id: 'rave', label: 'Acid Rave' },
    { id: 'inferno', label: 'Inferno' },
    { id: 'ice', label: 'Arktički kristal (Ice)' },
    { id: 'royal', label: 'Kraljevski baršun (Royal)' },
    { id: 'mono', label: 'Čisti stroboskop (Mono)' }
  ];

  function sendRuntimeMessage(message) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(message, (res) => {
          if (chrome.runtime.lastError) {
            resolve({ ok: false, online: false, error: chrome.runtime.lastError.message });
            return;
          }
          resolve(res || { ok: false, online: false });
        });
      } catch (err) {
        resolve({ ok: false, online: false, error: err.message });
      }
    });
  }

  function getVideoId() {
    const urlParams = new URLSearchParams(window.location.search);
    let id = urlParams.get('v');
    if (!id && window.location.pathname.startsWith('/shorts/')) {
      id = window.location.pathname.split('/shorts/')[1]?.split('?')[0];
    }
    return id || currentVideoData.videoId || '';
  }

  function getVideoTitle() {
    const titleEl = document.querySelector('h1.ytd-watch-metadata yt-formatted-string, #title h1 yt-formatted-string, h1.title yt-formatted-string');
    if (titleEl && titleEl.textContent.trim()) {
      return titleEl.textContent.trim();
    }
    if (currentVideoData.title && currentVideoData.title !== 'YouTube_Video') {
      return currentVideoData.title;
    }
    return document.title.replace(' - YouTube', '').trim() || 'YouTube_Video';
  }

  function getCleanWatchUrl() {
    const videoId = getVideoId();
    return videoId ? `https://www.youtube.com/watch?v=${videoId}` : window.location.href;
  }

  function getMainVideoElement() {
    return document.querySelector('video.html5-main-video') || document.querySelector('video');
  }

  function injectPageScript() {
    requestPlayerData();
  }

  function requestPlayerData() {
    window.dispatchEvent(new CustomEvent('YT_PLUS_GET_PLAYER_DATA'));
  }

  window.addEventListener('YT_PLUS_PLAYER_DATA_RESPONSE', function(e) {
    if (e.detail) currentVideoData = e.detail;
  });

  window.addEventListener('YT_PLUS_STEMS_RESPONSE', function(e) {
    if (e.detail) audioTap.mainWorldStems = e.detail;
  });

  async function loadSettings() {
    const res = await sendRuntimeMessage({ action: 'GET_SETTINGS' });
    if (res && res.success && res.settings) {
      userSettings = { ...userSettings, ...res.settings };
      ledicatedState.theme = userSettings.ledicatedTheme || 'midnight';
      ledicatedState.useGemini = userSettings.ledicatedUseGemini !== false;
      ledicatedState.master = typeof userSettings.ledicatedMaster === 'number' ? userSettings.ledicatedMaster : 70;

      const vSel = document.getElementById('yt-plus-v-quality');
      const aSel = document.getElementById('yt-plus-a-quality');
      if (vSel && userSettings.defaultVideoQuality) vSel.value = userSettings.defaultVideoQuality;
      if (aSel && userSettings.defaultAudioQuality) aSel.value = userSettings.defaultAudioQuality;
      updateLedicatedUI();
    }
  }

  // =========================================================================
  // NON-DESTRUCTIVE REAL-TIME YOUTUBE 4-STEM AUDIO EXTRACTOR
  // Uses video.captureStream() -> createMediaStreamSource -> AnalyserNode
  // Never calls createMediaElementSource(video), so YouTube audio is NEVER muted
  // =========================================================================

  function clamp01(v) {
    if (!Number.isFinite(v)) return 0;
    return Math.max(0, Math.min(1, v));
  }

  function ensureAudioTap(video) {
    if (!video) return false;
    try {
      const captureFn = video.captureStream || video.mozCaptureStream;
      if (typeof captureFn !== 'function') return false;

      if (!audioTap.audioCtx) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return false;
        audioTap.audioCtx = new AudioCtx();
      }

      if (audioTap.audioCtx.state === 'suspended') {
        audioTap.audioCtx.resume().catch(() => {});
      }

      const streamTracks = audioTap.attachedStream ? audioTap.attachedStream.getAudioTracks() : [];
      const hasLiveTrack = streamTracks.some((t) => t.readyState === 'live');

      if (audioTap.attachedVideo !== video || !audioTap.analyser || !hasLiveTrack) {
        if (audioTap.sourceNode) {
          try { audioTap.sourceNode.disconnect(); } catch (e) {}
          audioTap.sourceNode = null;
        }

        const stream = captureFn.call(video);
        if (!stream || stream.getAudioTracks().length === 0) {
          return false;
        }

        const analyser = audioTap.audioCtx.createAnalyser();
        analyser.fftSize = 1024;
        analyser.smoothingTimeConstant = 0.35;

        const source = audioTap.audioCtx.createMediaStreamSource(stream);
        source.connect(analyser);

        audioTap.sourceNode = source;
        audioTap.analyser = analyser;
        audioTap.attachedVideo = video;
        audioTap.attachedStream = stream;
        audioTap.freqData = new Uint8Array(analyser.frequencyBinCount);
        audioTap.prevFreqData = new Float32Array(analyser.frequencyBinCount);
      }

      return true;
    } catch (err) {
      return false;
    }
  }

  function extractRealTimeStems(video) {
    if (!video) return null;

    if (video.paused || video.ended) {
      const silent = {
        bass: 0,
        drums: 0,
        vocals: 0,
        other: 0,
        rms: 0,
        isBeat: false,
        isDrop: false
      };
      ledicatedState.lastStems = silent;
      return silent;
    }

    const tapReady = ensureAudioTap(video);
    if (!tapReady || !audioTap.analyser) {
      // Try MAIN world page-script bridge fallback
      window.dispatchEvent(new CustomEvent('YT_PLUS_SAMPLE_STEMS'));
      if (audioTap.mainWorldStems) {
        ledicatedState.lastStems = audioTap.mainWorldStems;
        return audioTap.mainWorldStems;
      }
      return null;
    }

    try {
      const analyser = audioTap.analyser;
      const freqData = audioTap.freqData;
      const prevFreq = audioTap.prevFreqData;
      analyser.getByteFrequencyData(freqData);

      const sampleRate = audioTap.audioCtx.sampleRate || 48000;
      const fftSize = analyser.fftSize || 1024;
      const binHz = sampleRate / fftSize;
      const nBins = freqData.length;

      const bandEnergy = (minHz, maxHz) => {
        const startBin = Math.max(1, Math.floor(minHz / binHz));
        const endBin = Math.min(nBins - 1, Math.ceil(maxHz / binHz));
        if (endBin < startBin) return 0;
        let sum = 0;
        for (let i = startBin; i <= endBin; i++) {
          sum += freqData[i] / 255;
        }
        return sum / (endBin - startBin + 1);
      };

      // Frequency-band energies:
      // bass: 40-180 Hz
      // vocals: 280-3400 Hz
      // other: 3400-8000 Hz
      const bassRaw = bandEnergy(40, 180);
      const subKick = bandEnergy(50, 130);
      const vocalsRaw = bandEnergy(280, 3400);
      const otherRaw = bandEnergy(3400, 8000);

      // drums: transient flux in 60-4500 Hz (positive rise over previous frame) + sub-kick punch
      const fluxStart = Math.max(1, Math.floor(60 / binHz));
      const fluxEnd = Math.min(nBins - 1, Math.ceil(4500 / binHz));
      let fluxSum = 0;
      for (let i = fluxStart; i <= fluxEnd; i++) {
        const cur = freqData[i] / 255;
        const delta = cur - prevFreq[i];
        if (delta > 0) {
          fluxSum += delta;
        }
      }
      const fluxBins = Math.max(1, fluxEnd - fluxStart + 1);
      const fluxNorm = (fluxSum / fluxBins) * 3.4;

      // Overall RMS level + save current frame into prevFreq
      let sqSum = 0;
      for (let i = 1; i < nBins; i++) {
        const norm = freqData[i] / 255;
        sqSum += norm * norm;
        prevFreq[i] = norm;
      }
      const rms = clamp01(Math.sqrt(sqSum / Math.max(1, nBins - 1)) * 1.35);

      // Sub-kick punch component
      const subKickPunch = Math.max(0, subKick - audioTap.prevSubKick * 0.85) * 1.9 + subKick * 0.35;
      audioTap.prevSubKick = subKick;

      const bass = clamp01(bassRaw * 1.18);
      const drums = clamp01(fluxNorm * 0.65 + subKickPunch * 0.55);
      const vocals = clamp01(vocalsRaw * 1.25);
      const other = clamp01(otherRaw * 1.45);

      // If all bins are zero while playing, check MAIN world bridge
      if (rms === 0 && bass === 0 && drums === 0) {
        window.dispatchEvent(new CustomEvent('YT_PLUS_SAMPLE_STEMS'));
        if (audioTap.mainWorldStems && audioTap.mainWorldStems.rms > 0) {
          ledicatedState.lastStems = audioTap.mainWorldStems;
          return audioTap.mainWorldStems;
        }
      }

      const now = performance.now();

      // Beat detection: drums transient exceeds rolling average * 1.35 with >200ms cooldown
      audioTap.drumsHistory.push(drums);
      if (audioTap.drumsHistory.length > 24) {
        audioTap.drumsHistory.shift();
      }
      const rollingDrumsAvg =
        audioTap.drumsHistory.reduce((acc, v) => acc + v, 0) / audioTap.drumsHistory.length;
      const isBeat =
        drums > Math.max(0.14, rollingDrumsAvg * 1.35) &&
        now - audioTap.lastBeatAtMs > 200;
      if (isBeat) {
        audioTap.lastBeatAtMs = now;
      }

      // Drop detection: rolling 2s rms and bass both exceed 0.68
      audioTap.rolling2sWindow.push({ t: now, rms, bass });
      while (audioTap.rolling2sWindow.length > 0 && now - audioTap.rolling2sWindow[0].t > 2000) {
        audioTap.rolling2sWindow.shift();
      }
      let avg2sRms = 0;
      let avg2sBass = 0;
      if (audioTap.rolling2sWindow.length > 0) {
        for (const frame of audioTap.rolling2sWindow) {
          avg2sRms += frame.rms;
          avg2sBass += frame.bass;
        }
        avg2sRms /= audioTap.rolling2sWindow.length;
        avg2sBass /= audioTap.rolling2sWindow.length;
      }
      const isDrop = avg2sRms > 0.68 && avg2sBass > 0.68;

      const stems = {
        bass: Number(bass.toFixed(3)),
        drums: Number(drums.toFixed(3)),
        vocals: Number(vocals.toFixed(3)),
        other: Number(other.toFixed(3)),
        rms: Number(rms.toFixed(3)),
        isBeat,
        isDrop
      };

      ledicatedState.lastStems = stems;
      return stems;
    } catch (err) {
      return null;
    }
  }

  // =========================================================================
  // LEDICATED SYNC, IMPORT & CONTROL ENGINE
  // =========================================================================

  async function refreshLedicatedStatus() {
    const videoId = getVideoId();
    const title = getVideoTitle();
    const res = await sendRuntimeMessage({
      action: 'LEDICATED_STATUS',
      data: { videoId, title }
    });

    if (res && res.online) {
      ledicatedState.online = true;
      if (res.track !== undefined) ledicatedState.track = res.track;
      if (res.importJob !== undefined) ledicatedState.importJob = res.importJob;
      if (typeof res.master === 'number') ledicatedState.master = res.master;
      if (typeof res.blackout === 'boolean') ledicatedState.blackout = res.blackout;
      if (typeof res.armed === 'boolean') ledicatedState.armed = res.armed;
      if (res.theme) ledicatedState.theme = res.theme;
      if (res.mode) ledicatedState.mode = res.mode;
      if (typeof res.isStageOwner === 'boolean') ledicatedState.isStageOwner = res.isStageOwner;
      if (res.lan) ledicatedState.lan = res.lan;
    } else {
      ledicatedState.online = false;
    }

    updateLedicatedUI();
    return res;
  }

  async function triggerSongImport({ autoTriggered = false } = {}) {
    requestPlayerData();
    const videoId = getVideoId();
    const title = getVideoTitle();
    const url = getCleanWatchUrl();

    if (!videoId && !url.includes('youtube.com/')) {
      return;
    }

    if (autoTriggered && videoId) {
      ledicatedState.autoImportedVideoIds.add(videoId);
    }

    // Turn ON Live Show mode if not already on so lights dance immediately while importing!
    if (!ledicatedState.liveMode) {
      await setLiveShowMode(true, { skipAutoImport: true });
    }

    ledicatedState.importJob = {
      status: 'downloading',
      stage: 'downloading',
      progress: 8,
      message: 'Preuzimanje…'
    };
    updateLedicatedUI();

    const res = await sendRuntimeMessage({
      action: 'LEDICATED_IMPORT',
      data: {
        url,
        videoId,
        title,
        theme: ledicatedState.theme,
        useGemini: ledicatedState.useGemini
      }
    });

    if (res && res.ok) {
      ledicatedState.online = true;
      if (res.track) {
        ledicatedState.track = res.track;
      }
      if (res.alreadyExists && res.track) {
        ledicatedState.importJob = {
          status: 'completed',
          stage: 'ready',
          progress: 100,
          message: '✓ Show spreman i sinkroniziran!'
        };
      } else if (res.importJob || res.jobId || res.status) {
        ledicatedState.importJob = res.importJob || {
          jobId: res.jobId,
          status: res.status || 'downloading',
          stage: res.stage || res.status || 'downloading',
          progress: res.progress || 15
        };
      }
    } else {
      ledicatedState.importJob = {
        status: 'error',
        stage: 'error',
        progress: 0,
        error: res?.error || 'Uvoz nije uspio — Uživo stream ostaje aktivan'
      };
    }

    updateLedicatedUI();
  }

  async function sendSyncTick() {
    if (!ledicatedState.liveMode || ledicatedState.syncInFlight) return;

    const video = getMainVideoElement();
    const videoId = getVideoId();
    const title = getVideoTitle();
    const url = getCleanWatchUrl();

    // Detect YouTube SPA video change while Live Mode is active
    if (videoId && videoId !== ledicatedState.lastVideoId) {
      ledicatedState.lastVideoId = videoId;
      ledicatedState.track = null;
      ledicatedState.importJob = null;
      refreshLedicatedStatus().then((statusRes) => {
        if (
          ledicatedState.liveMode &&
          userSettings.ledicatedAutoImport &&
          statusRes &&
          statusRes.online &&
          !statusRes.track &&
          !statusRes.importJob &&
          !ledicatedState.autoImportedVideoIds.has(videoId)
        ) {
          triggerSongImport({ autoTriggered: true });
        }
      });
    }

    const currentTime = video ? Number(video.currentTime || 0) : 0;
    const duration = video && Number.isFinite(video.duration) ? Number(video.duration) : 0;
    const paused = video ? Boolean(video.paused || video.ended) : true;
    const playbackRate = video ? Number(video.playbackRate || 1) : 1;
    const stems = extractRealTimeStems(video);

    updateStemMetersUI(stems);

    if (
      paused &&
      ledicatedState.lastSentPaused === true &&
      Math.abs(currentTime - (ledicatedState.lastSentTime || 0)) < 0.08 &&
      videoId === ledicatedState.lastSentVideoId
    ) {
      return;
    }
    ledicatedState.lastSentPaused = paused;
    ledicatedState.lastSentTime = currentTime;
    ledicatedState.lastSentVideoId = videoId;

    ledicatedState.syncInFlight = true;
    try {
      const res = await sendRuntimeMessage({
        action: 'LEDICATED_SYNC',
        data: {
          videoId,
          title,
          url,
          currentTime,
          duration,
          paused,
          playbackRate,
          liveMode: true,
          theme: ledicatedState.theme,
          stems
        }
      });

      if (res && res.online) {
        const prevTrack = ledicatedState.track;
        const prevOwner = ledicatedState.isStageOwner;
        ledicatedState.online = true;
        if (res.mode) ledicatedState.mode = res.mode;
        if (res.track !== undefined) ledicatedState.track = res.track;
        if (res.importJob !== undefined) ledicatedState.importJob = res.importJob;
        if (typeof res.armed === 'boolean') ledicatedState.armed = res.armed;
        if (typeof res.blackout === 'boolean') ledicatedState.blackout = res.blackout;
        if (typeof res.isStageOwner === 'boolean') ledicatedState.isStageOwner = res.isStageOwner;
        if (res.lan) ledicatedState.lan = res.lan;

        if ((!prevTrack && ledicatedState.track) || prevOwner !== ledicatedState.isStageOwner || ledicatedState.popoverOpen) {
          updateLedicatedUI();
        }
      } else {
        ledicatedState.online = false;
      }
    } finally {
      ledicatedState.syncInFlight = false;
    }
  }

  async function setLiveShowMode(enable, { skipAutoImport = false } = {}) {
    ledicatedState.liveMode = Boolean(enable);

    if (ledicatedState.syncTimer) {
      clearInterval(ledicatedState.syncTimer);
      ledicatedState.syncTimer = null;
    }
    if (ledicatedState.statusTimer) {
      clearInterval(ledicatedState.statusTimer);
      ledicatedState.statusTimer = null;
    }

    if (ledicatedState.liveMode) {
      const video = getMainVideoElement();
      if (video) ensureAudioTap(video);
      ledicatedState.lastVideoId = getVideoId();

      // Start 20 Hz (50ms) real-time sync loop immediately
      sendSyncTick();
      ledicatedState.syncTimer = setInterval(sendSyncTick, 50);

      // Poll status every 1.5s to track background stem split / show creation
      ledicatedState.statusTimer = setInterval(refreshLedicatedStatus, 1500);

      const statusRes = await refreshLedicatedStatus();
      const videoId = getVideoId();
      if (
        !skipAutoImport &&
        userSettings.ledicatedAutoImport &&
        statusRes &&
        statusRes.online &&
        !statusRes.track &&
        !statusRes.importJob &&
        videoId &&
        !ledicatedState.autoImportedVideoIds.has(videoId)
      ) {
        triggerSongImport({ autoTriggered: true });
      }
    } else {
      // Notify server that live mode ended
      const video = getMainVideoElement();
      await sendRuntimeMessage({
        action: 'LEDICATED_SYNC',
        data: {
          videoId: getVideoId(),
          title: getVideoTitle(),
          url: getCleanWatchUrl(),
          currentTime: video ? Number(video.currentTime || 0) : 0,
          duration: video && Number.isFinite(video.duration) ? Number(video.duration) : 0,
          paused: true,
          playbackRate: 1,
          liveMode: false,
          theme: ledicatedState.theme,
          stems: null
        }
      });
      ledicatedState.lastStems = {
        bass: 0,
        drums: 0,
        vocals: 0,
        other: 0,
        rms: 0,
        isBeat: false,
        isDrop: false
      };
      updateStemMetersUI(ledicatedState.lastStems);
    }

    updateLedicatedUI();
  }

  let masterControlTimeout = null;
  function sendControlUpdate(controlPayload, immediate = false) {
    const exec = async () => {
      const res = await sendRuntimeMessage({
        action: 'LEDICATED_CONTROL',
        data: {
          ...controlPayload,
          videoId: getVideoId(),
          title: getVideoTitle()
        }
      });
      if (res && res.online) {
        ledicatedState.online = true;
        if (typeof res.master === 'number') ledicatedState.master = res.master;
        if (typeof res.blackout === 'boolean') ledicatedState.blackout = res.blackout;
        if (typeof res.armed === 'boolean') ledicatedState.armed = res.armed;
        if (res.theme) ledicatedState.theme = res.theme;
        if (res.track) ledicatedState.track = res.track;
        if (typeof res.isStageOwner === 'boolean') ledicatedState.isStageOwner = res.isStageOwner;
        if (res.lan) ledicatedState.lan = res.lan;
        updateLedicatedUI();
      }
    };

    if (immediate) {
      if (masterControlTimeout) clearTimeout(masterControlTimeout);
      exec();
    } else {
      if (masterControlTimeout) clearTimeout(masterControlTimeout);
      masterControlTimeout = setTimeout(exec, 65);
    }
  }

  // =========================================================================
  // SHARE MODAL DOWNLOAD + LIGHT SHOW BAR
  // =========================================================================

  function createDownloadBar() {
    const bar = document.createElement('div');
    bar.className = 'yt-plus-bar';
    bar.id = 'yt-plus-share-section';

    bar.innerHTML = `
      <!-- Video MP4 Chip -->
      <div class="yt-plus-group">
        <button class="yt-plus-btn" id="yt-plus-btn-video" type="button" title="Download MP4 Video">
          ${SVG_VIDEO}
          <span>MP4</span>
        </button>
        <div class="yt-plus-divider"></div>
        <select class="yt-plus-select" id="yt-plus-v-quality" title="Select Video Quality">
          <option value="2160">4K (2160p)</option>
          <option value="1440">1440p (2K)</option>
          <option value="1080" selected>1080p</option>
          <option value="720">720p</option>
          <option value="480">480p</option>
          <option value="360">360p</option>
        </select>
      </div>

      <!-- Audio MP3 Chip -->
      <div class="yt-plus-group">
        <button class="yt-plus-btn" id="yt-plus-btn-audio" type="button" title="Download MP3 Audio">
          ${SVG_AUDIO}
          <span>MP3</span>
        </button>
        <div class="yt-plus-divider"></div>
        <select class="yt-plus-select" id="yt-plus-a-quality" title="Select Audio Quality">
          <option value="320" selected>320 kbps</option>
          <option value="256">256 kbps</option>
          <option value="192">192 kbps</option>
          <option value="128">128 kbps</option>
        </select>
      </div>

      <!-- LEDicated Light Show Chip -->
      <div class="yt-plus-group yt-plus-ledicated-chip">
        <button class="yt-plus-btn" id="yt-plus-share-ledicated-btn" type="button" title="Pokreni LEDicated Light Show i dodaj pjesmu u bazu">
          ${SVG_LIGHTSHOW}
          <span id="yt-plus-share-ledicated-label">Light Show</span>
        </button>
      </div>

      <!-- Minimal Status Message -->
      <div class="yt-plus-status" id="yt-plus-status" style="display: none;"></div>
    `;

    const vBtn = bar.querySelector('#yt-plus-btn-video');
    const aBtn = bar.querySelector('#yt-plus-btn-audio');
    const vQuality = bar.querySelector('#yt-plus-v-quality');
    const aQuality = bar.querySelector('#yt-plus-a-quality');
    const ledBtn = bar.querySelector('#yt-plus-share-ledicated-btn');

    if (userSettings.defaultVideoQuality) vQuality.value = userSettings.defaultVideoQuality;
    if (userSettings.defaultAudioQuality) aQuality.value = userSettings.defaultAudioQuality;

    vBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      startDownloadProcess('mp4', vQuality.value, vBtn);
    });

    aBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      startDownloadProcess('mp3', aQuality.value, aBtn);
    });

    ledBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const statusEl = document.getElementById('yt-plus-status');
      if (statusEl) {
        statusEl.style.display = 'inline-flex';
        statusEl.className = 'yt-plus-status is-success';
        statusEl.textContent = 'LEDicated Light Show aktivan — sinkronizacija i izrada showa…';
      }
      await setLiveShowMode(true, { skipAutoImport: true });
      await triggerSongImport({ autoTriggered: false });
      openLedicatedPopover();
    });

    return bar;
  }

  // Poll download progress from companion server
  function pollJobProgress(jobId, btnElement, origHtml, type) {
    const statusEl = document.getElementById('yt-plus-status');
    const pollInterval = setInterval(() => {
      chrome.runtime.sendMessage({ action: 'GET_JOB_STATUS', jobId }, (res) => {
        if (!res || !res.success || !res.job) {
          clearInterval(pollInterval);
          btnElement.disabled = false;
          btnElement.innerHTML = origHtml;
          return;
        }

        const job = res.job;
        if (statusEl) {
          if (job.status === 'downloading') {
            const pct = job.progress > 0 ? `${Math.round(job.progress)}%` : 'Processing...';
            statusEl.textContent = `${type.toUpperCase()}: ${pct}`;
          } else if (job.status === 'finished') {
            clearInterval(pollInterval);
            btnElement.disabled = false;
            btnElement.innerHTML = origHtml;
            statusEl.className = 'yt-plus-status is-success';
            statusEl.innerHTML = `${SVG_CHECK} Saved to Downloads! <a href="#" id="yt-plus-open-folder" style="color:#3ea6ff;margin-left:6px;text-decoration:underline;">Open Folder</a>`;

            const openFolderBtn = document.getElementById('yt-plus-open-folder');
            if (openFolderBtn) {
              openFolderBtn.addEventListener('click', (ev) => {
                ev.preventDefault();
                chrome.runtime.sendMessage({ action: 'OPEN_DOWNLOADS' });
              });
            }
          } else if (job.status === 'error') {
            clearInterval(pollInterval);
            btnElement.disabled = false;
            btnElement.innerHTML = origHtml;
            statusEl.className = 'yt-plus-status is-error';
            statusEl.textContent = job.error || 'Download failed';
          }
        }
      });
    }, 800);
  }

  // Handle Download trigger
  async function startDownloadProcess(type, quality, btnElement) {
    requestPlayerData();
    const statusEl = document.getElementById('yt-plus-status');
    const origHtml = btnElement.innerHTML;

    btnElement.disabled = true;
    btnElement.innerHTML = `<span class="yt-plus-spinner"></span> <span>${type.toUpperCase()}</span>`;

    if (statusEl) {
      statusEl.style.display = 'inline-flex';
      statusEl.className = 'yt-plus-status';
      statusEl.textContent = `Starting ${type.toUpperCase()} (${quality}${type === 'mp4' ? 'p' : 'k'})...`;
    }

    const videoId = getVideoId();
    const title = getVideoTitle();
    const cleanUrl = getCleanWatchUrl();

    chrome.runtime.sendMessage({
      action: 'START_DOWNLOAD',
      data: {
        videoUrl: cleanUrl,
        videoId,
        title,
        type,
        quality
      }
    }, (res) => {
      if (res && res.success && res.jobId) {
        pollJobProgress(res.jobId, btnElement, origHtml, type);
      } else {
        btnElement.disabled = false;
        btnElement.innerHTML = origHtml;
        if (statusEl) {
          statusEl.className = 'yt-plus-status is-error';
          statusEl.textContent = res?.error || 'Companion server offline';
        }
      }
    });
  }

  // Inject into Share Modal
  function injectIntoShareModal() {
    if (document.getElementById('yt-plus-share-section')) return;

    const copyLinkAnchor = document.querySelector(
      'yt-copy-link-renderer, ytd-copy-link-renderer, #share-url-container, #link-and-checkbox-container, #share-url, ytd-share-panel-url-renderer'
    );

    if (copyLinkAnchor && copyLinkAnchor.parentNode) {
      const bar = createDownloadBar();
      copyLinkAnchor.parentNode.insertBefore(bar, copyLinkAnchor);
      return;
    }

    const targets = document.querySelector('#targets, #target-buttons, #share-targets');
    if (targets && targets.parentNode) {
      const bar = createDownloadBar();
      targets.parentNode.insertBefore(bar, targets.nextSibling);
    }
  }

  // =========================================================================
  // WATCH BAR BUTTON (#yt-ledicated-btn) & POPOVER PANEL (#yt-ledicated-popover)
  // =========================================================================

  function ensureLedicatedPopover() {
    let popover = document.getElementById('yt-ledicated-popover');
    if (popover) return popover;

    popover = document.createElement('div');
    popover.id = 'yt-ledicated-popover';
    popover.className = 'yt-ledicated-popover';
    popover.setAttribute('role', 'dialog');
    popover.setAttribute('aria-label', 'LEDicated Studio Kontrole');

    const themeOptionsHtml = LEDICATED_THEMES.map(
      (t) => `<option value="${t.id}">${t.label}</option>`
    ).join('');

    popover.innerHTML = `
      <div class="yt-led-header">
        <div class="yt-led-brand">
          <span class="yt-led-matrix-icon" aria-hidden="true">
            <span></span><span></span><span></span>
            <span></span><span></span><span></span>
            <span></span><span></span><span></span>
          </span>
          <div class="yt-led-brand-titles">
            <span class="yt-led-title">LEDicated Studio</span>
            <span class="yt-led-subtitle" id="yt-ledicated-track-label">YouTube Live Bridge</span>
          </div>
        </div>
        <span class="yt-led-conn-badge is-offline" id="yt-ledicated-conn-badge">Offline</span>
      </div>

      <!-- LAN Stage Ownership & Now Playing Banner -->
      <div class="yt-led-stage-card is-owner" id="yt-ledicated-stage-card">
        <div class="yt-led-stage-top">
          <span class="yt-led-stage-badge" id="yt-ledicated-stage-badge">🟢 TI SI NA STAGEU</span>
          <button type="button" class="yt-led-stage-btn" id="yt-ledicated-stage-btn">Prepusti</button>
        </div>
        <div class="yt-led-stage-now" id="yt-ledicated-stage-now">Stage je spreman za YouTube Light Show</div>
      </div>

      <!-- Primary Live Show / Sync Toggle -->
      <div class="yt-led-primary-row">
        <div class="yt-led-primary-info">
          <span class="yt-led-primary-title">Uživo svjetlo / Sync</span>
          <span class="yt-led-primary-desc" id="yt-ledicated-mode-sub">Instant 20 Hz audio-reaktivni stream + sinkronizacija</span>
        </div>
        <label class="yt-led-switch" title="Uključi ili isključi Light Show">
          <input type="checkbox" id="yt-ledicated-live-toggle">
          <span class="yt-led-switch-slider"></span>
        </label>
      </div>

      <!-- Real-time 4-Stem Audio Telemetry Meter -->
      <div class="yt-led-meters" id="yt-ledicated-meters">
        <div class="yt-led-meter-col">
          <div class="yt-led-meter-bar"><div class="yt-led-meter-fill is-bass" id="yt-led-m-bass"></div></div>
          <span>BASS</span>
        </div>
        <div class="yt-led-meter-col">
          <div class="yt-led-meter-bar"><div class="yt-led-meter-fill is-drums" id="yt-led-m-drums"></div></div>
          <span>DRUMS</span>
        </div>
        <div class="yt-led-meter-col">
          <div class="yt-led-meter-bar"><div class="yt-led-meter-fill is-vocals" id="yt-led-m-vocals"></div></div>
          <span>VOCAL</span>
        </div>
        <div class="yt-led-meter-col">
          <div class="yt-led-meter-bar"><div class="yt-led-meter-fill is-other" id="yt-led-m-other"></div></div>
          <span>SYNTH</span>
        </div>
        <div class="yt-led-meter-badges">
          <span class="yt-led-pill" id="yt-led-pill-beat">BEAT</span>
          <span class="yt-led-pill" id="yt-led-pill-drop">DROP</span>
        </div>
      </div>

      <!-- Add Song to Database & Generate Show -->
      <div class="yt-led-import-section">
        <button type="button" class="yt-led-import-btn" id="yt-ledicated-import-btn">
          ${SVG_SPARKLES}
          <span id="yt-ledicated-import-btn-text">Dodaj pjesmu i kreiraj Show</span>
        </button>

        <div class="yt-led-job-box" id="yt-ledicated-job-box" style="display: none;">
          <div class="yt-led-job-top">
            <span class="yt-led-job-status" id="yt-ledicated-job-status">Preuzimanje…</span>
            <span class="yt-led-job-pct" id="yt-ledicated-job-pct"></span>
          </div>
          <div class="yt-led-job-track">
            <div class="yt-led-job-fill" id="yt-ledicated-job-bar" style="width: 0%;"></div>
          </div>
        </div>
      </div>

      <!-- Gemini AI Show Director Checkbox -->
      <label class="yt-led-checkbox-row" for="yt-ledicated-gemini-checkbox">
        <input type="checkbox" id="yt-ledicated-gemini-checkbox" checked>
        <div class="yt-led-checkbox-text">
          <span class="yt-led-checkbox-title">Gemini AI Show Director</span>
          <span class="yt-led-checkbox-sub">AI režija dionica + lokalni algoritamski fallback</span>
        </div>
      </label>

      <!-- Theme / Palette Selector -->
      <div class="yt-led-control-group">
        <label class="yt-led-label" for="yt-ledicated-theme-select">Tema</label>
        <select class="yt-led-select" id="yt-ledicated-theme-select">
          ${themeOptionsHtml}
        </select>
      </div>

      <!-- DJ Name & Server URL (Local or Office LAN IP) -->
      <div class="yt-led-control-group yt-led-grid-2">
        <div>
          <label class="yt-led-label" for="yt-ledicated-user-name">Tvoje ime (LAN)</label>
          <input type="text" class="yt-led-select" id="yt-ledicated-user-name" value="" placeholder="npr. Timon" spellcheck="false">
        </div>
        <div>
          <label class="yt-led-label" for="yt-ledicated-server-url">LEDicated Server</label>
          <input type="text" class="yt-led-select" id="yt-ledicated-server-url" value="http://127.0.0.1:8787" placeholder="http://127.0.0.1:8787" spellcheck="false">
        </div>
      </div>

      <!-- Master Brightness Slider (0-100%) -->
      <div class="yt-led-control-group">
        <div class="yt-led-slider-header">
          <label class="yt-led-label" for="yt-ledicated-master-slider">Master svjetlina</label>
          <span class="yt-led-slider-val" id="yt-ledicated-master-val">70%</span>
        </div>
        <input type="range" class="yt-led-range" id="yt-ledicated-master-slider" min="0" max="100" value="70">
        <div class="yt-led-power-warn" id="yt-ledicated-power-warn" style="display: none;">
          ⚠ Visoka snaga (&gt;70%) — pazi na opterećenje 24V napajanja
        </div>
      </div>

      <!-- Quick Actions Row -->
      <div class="yt-led-actions-row">
        <button type="button" class="yt-led-action-btn" id="yt-ledicated-arm-btn" title="Arm / Disarm fizički WLED DDP izlaz">
          <span class="yt-led-action-dot" id="yt-ledicated-arm-dot"></span>
          <span id="yt-ledicated-arm-label">WLED Izlaz</span>
        </button>
        <button type="button" class="yt-led-action-btn is-danger" id="yt-ledicated-blackout-btn" title="Hitno gašenje svih barova (Blackout)">
          BLACKOUT
        </button>
        <a href="http://127.0.0.1:8787" target="_blank" rel="noopener noreferrer" class="yt-led-action-link" id="yt-ledicated-open-studio">
          Otvori Studio ↗
        </a>
      </div>
    `;

    document.body.appendChild(popover);

    // Prevent clicks inside popover from closing it
    popover.addEventListener('click', (e) => {
      e.stopPropagation();
    });

    // Event Listeners
    const stageBtn = popover.querySelector('#yt-ledicated-stage-btn');
    if (stageBtn) {
      stageBtn.addEventListener('click', () => {
        const lan = ledicatedState.lan;
        const myId = userSettings.ledicatedClientId;
        const iHoldStage = Boolean(lan && lan.stageOwnerId && myId && lan.stageOwnerId === myId && !lan.isRemoteStageOwner);
        if (iHoldStage) {
          sendControlUpdate({ releaseStage: true }, true);
        } else {
          sendControlUpdate({ claimStage: true }, true);
        }
      });
    }

    const userNameInput = popover.querySelector('#yt-ledicated-user-name');
    if (userNameInput) {
      userNameInput.value = userSettings.ledicatedUserName || '';
      const saveUserName = async () => {
        const nextName = userNameInput.value.trim().slice(0, 40);
        const res = await sendRuntimeMessage({
          action: 'SAVE_SETTINGS',
          settings: { ledicatedUserName: nextName }
        });
        if (res?.settings?.ledicatedUserName !== undefined) {
          userSettings.ledicatedUserName = res.settings.ledicatedUserName;
        }
        sendControlUpdate({ clientName: userSettings.ledicatedUserName }, true);
      };
      userNameInput.addEventListener('change', saveUserName);
      userNameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          saveUserName();
          userNameInput.blur();
        }
      });
    }

    const liveToggle = popover.querySelector('#yt-ledicated-live-toggle');
    liveToggle.addEventListener('change', () => {
      setLiveShowMode(liveToggle.checked);
    });

    const importBtn = popover.querySelector('#yt-ledicated-import-btn');
    importBtn.addEventListener('click', () => {
      triggerSongImport({ autoTriggered: false });
    });

    const geminiCheckbox = popover.querySelector('#yt-ledicated-gemini-checkbox');
    geminiCheckbox.addEventListener('change', () => {
      ledicatedState.useGemini = geminiCheckbox.checked;
      userSettings.ledicatedUseGemini = geminiCheckbox.checked;
      sendRuntimeMessage({
        action: 'SAVE_SETTINGS',
        settings: { ledicatedUseGemini: geminiCheckbox.checked }
      });
    });

    const themeSelect = popover.querySelector('#yt-ledicated-theme-select');
    themeSelect.addEventListener('change', () => {
      const newTheme = themeSelect.value;
      ledicatedState.theme = newTheme;
      userSettings.ledicatedTheme = newTheme;
      sendRuntimeMessage({
        action: 'SAVE_SETTINGS',
        settings: { ledicatedTheme: newTheme }
      });
      sendControlUpdate(
        {
          theme: newTheme,
          regenerate: true,
          useGemini: ledicatedState.useGemini
        },
        true
      );
    });

    const serverUrlInput = popover.querySelector('#yt-ledicated-server-url');
    if (serverUrlInput) {
      serverUrlInput.value = userSettings.ledicatedServerUrl || 'http://127.0.0.1:8787';
      const saveUrl = async () => {
        const res = await sendRuntimeMessage({
          action: 'SAVE_SETTINGS',
          settings: { ledicatedServerUrl: serverUrlInput.value.trim() || 'http://127.0.0.1:8787' }
        });
        if (res?.settings?.ledicatedServerUrl) {
          userSettings.ledicatedServerUrl = res.settings.ledicatedServerUrl;
          serverUrlInput.value = res.settings.ledicatedServerUrl;
        }
        updateLedicatedUI();
        refreshLedicatedStatus();
      };
      serverUrlInput.addEventListener('change', saveUrl);
      serverUrlInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          saveUrl();
          serverUrlInput.blur();
        }
      });
    }

    const masterSlider = popover.querySelector('#yt-ledicated-master-slider');
    masterSlider.addEventListener('input', () => {
      const val = Number(masterSlider.value);
      ledicatedState.master = val;
      updateMasterSliderUI(val);
      sendControlUpdate({ master: val }, false);
    });
    masterSlider.addEventListener('change', () => {
      const val = Number(masterSlider.value);
      ledicatedState.master = val;
      userSettings.ledicatedMaster = val;
      sendRuntimeMessage({
        action: 'SAVE_SETTINGS',
        settings: { ledicatedMaster: val }
      });
      sendControlUpdate({ master: val }, true);
    });

    const armBtn = popover.querySelector('#yt-ledicated-arm-btn');
    armBtn.addEventListener('click', () => {
      const nextArmed = !ledicatedState.armed;
      ledicatedState.armed = nextArmed;
      updateLedicatedUI();
      sendControlUpdate({ armed: nextArmed }, true);
    });

    const blackoutBtn = popover.querySelector('#yt-ledicated-blackout-btn');
    blackoutBtn.addEventListener('click', () => {
      const nextBlackout = !ledicatedState.blackout;
      ledicatedState.blackout = nextBlackout;
      updateLedicatedUI();
      sendControlUpdate({ blackout: nextBlackout }, true);
    });

    updateLedicatedUI();
    return popover;
  }

  function positionLedicatedPopover() {
    const popover = document.getElementById('yt-ledicated-popover');
    const btn = document.getElementById('yt-ledicated-btn');
    if (!popover || !btn || !ledicatedState.popoverOpen) return;

    const rect = btn.getBoundingClientRect();
    const popWidth = 330;
    let left = rect.left + window.scrollX;
    const maxLeft = window.scrollX + document.documentElement.clientWidth - popWidth - 16;
    if (left > maxLeft) left = Math.max(12, maxLeft);

    const top = rect.bottom + window.scrollY + 8;
    popover.style.top = `${top}px`;
    popover.style.left = `${left}px`;
  }

  function openLedicatedPopover() {
    const popover = ensureLedicatedPopover();
    ledicatedState.popoverOpen = true;
    popover.classList.add('is-open');
    positionLedicatedPopover();
    refreshLedicatedStatus();
  }

  function closeLedicatedPopover() {
    const popover = document.getElementById('yt-ledicated-popover');
    ledicatedState.popoverOpen = false;
    if (popover) {
      popover.classList.remove('is-open');
    }
  }

  function toggleLedicatedPopover() {
    if (ledicatedState.popoverOpen) {
      closeLedicatedPopover();
    } else {
      openLedicatedPopover();
    }
  }

  function updateMasterSliderUI(val) {
    const masterValEl = document.getElementById('yt-ledicated-master-val');
    const warnEl = document.getElementById('yt-ledicated-power-warn');
    const sliderEl = document.getElementById('yt-ledicated-master-slider');
    if (masterValEl) {
      masterValEl.textContent = `${Math.round(val)}%`;
      masterValEl.classList.toggle('is-high', val > 70);
    }
    if (warnEl) {
      warnEl.style.display = val > 70 ? 'block' : 'none';
    }
    if (sliderEl && Number(sliderEl.value) !== Math.round(val)) {
      sliderEl.value = String(Math.round(val));
    }
  }

  function updateStemMetersUI(stems) {
    if (!ledicatedState.popoverOpen) return;
    const s = stems || ledicatedState.lastStems;
    if (!s) return;

    const bassEl = document.getElementById('yt-led-m-bass');
    const drumsEl = document.getElementById('yt-led-m-drums');
    const vocalsEl = document.getElementById('yt-led-m-vocals');
    const otherEl = document.getElementById('yt-led-m-other');
    const beatPill = document.getElementById('yt-led-pill-beat');
    const dropPill = document.getElementById('yt-led-pill-drop');

    if (bassEl) bassEl.style.height = `${Math.round((s.bass || 0) * 100)}%`;
    if (drumsEl) drumsEl.style.height = `${Math.round((s.drums || 0) * 100)}%`;
    if (vocalsEl) vocalsEl.style.height = `${Math.round((s.vocals || 0) * 100)}%`;
    if (otherEl) otherEl.style.height = `${Math.round((s.other || 0) * 100)}%`;
    if (beatPill) beatPill.classList.toggle('is-active', Boolean(s.isBeat));
    if (dropPill) dropPill.classList.toggle('is-active', Boolean(s.isDrop));
  }

  function formatJobStatusText(job) {
    if (!job) return '';
    if (job.error) return job.error;
    const st = String(job.stage || job.status || '').toLowerCase();
    if (st.includes('download') || st === 'queued' || st === 'starting') {
      return 'Preuzimanje…';
    }
    if (st.includes('stem') || st.includes('split') || st.includes('analy')) {
      return 'Analiza stemova i dionica…';
    }
    if (st.includes('gen') || st.includes('show') || st.includes('gemini') || st.includes('director')) {
      return 'Generiranje showa…';
    }
    if (st.includes('done') || st.includes('ready') || st.includes('complete') || st.includes('finish')) {
      return '✓ Show spreman i sinkroniziran!';
    }
    return job.message || 'Obrada u tijeku…';
  }

  function updateLedicatedUI() {
    const lan = ledicatedState.lan;
    const myId = userSettings.ledicatedClientId;
    const iHoldStage = Boolean(lan && lan.stageOwnerId && myId && lan.stageOwnerId === myId && !lan.isRemoteStageOwner);
    const stageIsFree = !lan || (!lan.stageOwnerId && !lan.isRemoteStageOwner);
    const canDrive = ledicatedState.isStageOwner !== false;

    const isSyncedWithDb = Boolean(
      ledicatedState.liveMode &&
      ledicatedState.online &&
      (ledicatedState.track || ledicatedState.mode === 'timeline' || ledicatedState.mode === 'synced')
    );
    const isLiveStreaming = Boolean(ledicatedState.liveMode && !isSyncedWithDb);

    // 1. Watch Bar Button (#yt-ledicated-btn)
    const watchBtn = document.getElementById('yt-ledicated-btn');
    if (watchBtn) {
      watchBtn.classList.toggle('is-streaming', isLiveStreaming && canDrive);
      watchBtn.classList.toggle('is-synced', isSyncedWithDb && canDrive);
      watchBtn.classList.toggle('is-solo', Boolean(ledicatedState.liveMode && !canDrive));
      const labelEl = watchBtn.querySelector('.yt-ledicated-btn-label');
      if (labelEl) {
        if (ledicatedState.liveMode && !canDrive) {
          const ownerName = lan?.stageOwnerName || 'Kolega';
          labelEl.textContent = `Solo (${ownerName})`;
        } else if (isSyncedWithDb) {
          labelEl.textContent = 'Sync · ON';
        } else if (isLiveStreaming) {
          labelEl.textContent = 'Light Show · ON';
        } else {
          labelEl.textContent = 'Light Show';
        }
      }
    }

    // 2. Share Modal Chip
    const shareLabel = document.getElementById('yt-plus-share-ledicated-label');
    if (shareLabel) {
      shareLabel.textContent = ledicatedState.liveMode ? 'Light Show · ON' : 'Light Show';
    }

    // 3. Popover Controls
    const popover = document.getElementById('yt-ledicated-popover');
    if (!popover) return;

    const stageCard = document.getElementById('yt-ledicated-stage-card');
    const stageBadge = document.getElementById('yt-ledicated-stage-badge');
    const stageBtn = document.getElementById('yt-ledicated-stage-btn');
    const stageNow = document.getElementById('yt-ledicated-stage-now');
    if (stageCard && stageBadge && stageBtn && stageNow) {
      const np = lan?.nowPlaying;
      stageCard.className = 'yt-led-stage-card';
      if (!ledicatedState.online) {
        stageCard.classList.add('is-idle');
        stageBadge.textContent = '⚪ SERVER OFFLINE';
        stageBtn.style.display = 'none';
        stageNow.textContent = 'Pokreni LEDicated Studio ili provjeri IP adresu servera.';
      } else if (iHoldStage) {
        stageCard.classList.add(lan?.stageState === 'grace' ? 'is-grace' : 'is-owner');
        stageBadge.textContent = lan?.stageState === 'grace'
          ? `🟡 PAUZA (${lan.graceRemainingSec || 20}s)`
          : '🟢 TI SI NA STAGEU (ON AIR)';
        stageBtn.style.display = 'inline-flex';
        stageBtn.textContent = 'Prepusti';
        stageBtn.className = 'yt-led-stage-btn is-release';
        stageNow.textContent = `Na 3×3 zidu: ${getVideoTitle() || 'YouTube'}`;
      } else if (stageIsFree && canDrive) {
        stageCard.classList.add('is-idle');
        stageBadge.textContent = '⚪ STAGE SLOBODAN';
        stageBtn.style.display = 'inline-flex';
        stageBtn.textContent = '⚡ Preuzmi Stage';
        stageBtn.className = 'yt-led-stage-btn is-claim';
        stageNow.textContent = 'Uključi Uživo svjetlo za automatsko preuzimanje zida.';
      } else {
        stageCard.classList.add('is-solo');
        const ownerName = lan?.stageOwnerName || np?.ownerName || 'Kolega';
        stageBadge.textContent = lan?.stageState === 'grace'
          ? `🎧 SOLO · 🟡 ${ownerName} (${lan.graceRemainingSec || 20}s)`
          : `🎧 SOLO · 🟢 Na stageu: ${ownerName}`;
        stageBtn.style.display = 'inline-flex';
        stageBtn.textContent = '⚡ Preuzmi Stage';
        stageBtn.className = 'yt-led-stage-btn is-claim';
        const srcTag = np?.source === 'youtube' ? 'YouTube' : 'DAW';
        stageNow.textContent = np?.trackTitle
          ? `${np.isPlaying ? '▶' : '⏸'} ${np.trackTitle} (${srcTag})`
          : `Zid trenutno drži ${ownerName}. Klikni Preuzmi Stage za prebacivanje na sebe.`;
      }
    }

    const userNameInput = document.getElementById('yt-ledicated-user-name');
    if (userNameInput && document.activeElement !== userNameInput && userSettings.ledicatedUserName) {
      userNameInput.value = userSettings.ledicatedUserName;
    }

    const connBadge = document.getElementById('yt-ledicated-conn-badge');
    if (connBadge) {
      connBadge.className = 'yt-led-conn-badge';
      if (!ledicatedState.online) {
        connBadge.classList.add('is-offline');
        connBadge.textContent = 'Offline';
      } else if (isSyncedWithDb) {
        connBadge.classList.add('is-synced');
        connBadge.textContent = 'Sinkronizirano s bazom';
      } else if (ledicatedState.liveMode) {
        connBadge.classList.add('is-streaming');
        connBadge.textContent = 'Uživo stream';
      } else {
        connBadge.classList.add('is-online');
        connBadge.textContent = 'Spojeno';
      }
    }

    const trackLabel = document.getElementById('yt-ledicated-track-label');
    if (trackLabel) {
      if (ledicatedState.track && ledicatedState.track.name) {
        const bpmTxt = ledicatedState.track.bpm ? ` · ${Math.round(ledicatedState.track.bpm)} BPM` : '';
        trackLabel.textContent = `U bazi: ${ledicatedState.track.name}${bpmTxt}`;
      } else {
        trackLabel.textContent = getVideoTitle() || 'YouTube Live Bridge';
      }
    }

    const modeSub = document.getElementById('yt-ledicated-mode-sub');
    if (modeSub) {
      if (isSyncedWithDb) {
        modeSub.textContent = 'Timeline Show Sync aktivan (pjesma u LEDicated bazi)';
      } else if (isLiveStreaming) {
        modeSub.textContent = 'Uživo 4-stem stream aktivan (fallback dok se show sprema)';
      } else {
        modeSub.textContent = 'Instant 20 Hz audio-reaktivni stream + sinkronizacija';
      }
    }

    const liveToggle = document.getElementById('yt-ledicated-live-toggle');
    if (liveToggle) {
      liveToggle.checked = Boolean(ledicatedState.liveMode);
    }

    const importBtnText = document.getElementById('yt-ledicated-import-btn-text');
    if (importBtnText) {
      if (ledicatedState.track) {
        importBtnText.textContent = '✓ U bazi · Regeneriraj Show';
      } else {
        importBtnText.textContent = 'Dodaj pjesmu i kreiraj Show';
      }
    }

    // Import Job Progress
    const jobBox = document.getElementById('yt-ledicated-job-box');
    const jobStatus = document.getElementById('yt-ledicated-job-status');
    const jobPct = document.getElementById('yt-ledicated-job-pct');
    const jobBar = document.getElementById('yt-ledicated-job-bar');

    if (jobBox && jobStatus && jobBar) {
      const job = ledicatedState.importJob;
      if (job && (job.status || job.stage || job.error)) {
        jobBox.style.display = 'block';
        jobStatus.textContent = formatJobStatusText(job);
        const isDone =
          Boolean(ledicatedState.track) ||
          ['completed', 'ready', 'done', 'finished'].includes(String(job.status || job.stage).toLowerCase());
        const isErr = Boolean(job.error) || String(job.status).toLowerCase() === 'error';
        jobBox.classList.toggle('is-done', isDone);
        jobBox.classList.toggle('is-error', isErr);

        const pct = isDone ? 100 : Math.max(10, Math.min(99, Number(job.progress) || 35));
        jobBar.style.width = `${isErr ? 100 : pct}%`;
        if (jobPct) {
          jobPct.textContent = isErr ? '' : `${Math.round(pct)}%`;
        }
      } else if (ledicatedState.track) {
        jobBox.style.display = 'block';
        jobBox.className = 'yt-led-job-box is-done';
        jobStatus.textContent = '✓ Show spreman i sinkroniziran!';
        jobBar.style.width = '100%';
        if (jobPct) jobPct.textContent = '100%';
      } else {
        jobBox.style.display = 'none';
      }
    }

    const geminiCheckbox = document.getElementById('yt-ledicated-gemini-checkbox');
    if (geminiCheckbox) {
      geminiCheckbox.checked = Boolean(ledicatedState.useGemini);
    }

    const themeSelect = document.getElementById('yt-ledicated-theme-select');
    if (themeSelect && ledicatedState.theme) {
      themeSelect.value = ledicatedState.theme;
    }

    const serverUrlInput = document.getElementById('yt-ledicated-server-url');
    if (serverUrlInput && document.activeElement !== serverUrlInput && userSettings.ledicatedServerUrl) {
      serverUrlInput.value = userSettings.ledicatedServerUrl;
    }

    const openStudioLink = document.getElementById('yt-ledicated-open-studio');
    if (openStudioLink && userSettings.ledicatedServerUrl) {
      openStudioLink.href = userSettings.ledicatedServerUrl;
    }

    updateMasterSliderUI(ledicatedState.master);

    const armBtn = document.getElementById('yt-ledicated-arm-btn');
    const armLabel = document.getElementById('yt-ledicated-arm-label');
    if (armBtn) {
      armBtn.classList.toggle('is-armed', Boolean(ledicatedState.armed));
    }
    if (armLabel) {
      armLabel.textContent = ledicatedState.armed ? 'WLED Izlaz: ON' : 'WLED Izlaz';
    }

    const blackoutBtn = document.getElementById('yt-ledicated-blackout-btn');
    if (blackoutBtn) {
      blackoutBtn.classList.toggle('is-active', Boolean(ledicatedState.blackout));
      blackoutBtn.textContent = ledicatedState.blackout ? 'BLACKOUT · AKTIVAN' : 'BLACKOUT';
    }
  }

  // Quick Action Buttons on Watch Page (#yt-plus-quick-button & #yt-ledicated-btn)
  function injectQuickButton() {
    const actionMenu = document.querySelector(
      'ytd-watch-metadata #top-level-buttons-computed, #top-level-buttons-computed'
    );
    if (!actionMenu) return;

    // 1. Existing YouTube Plus Download button
    if (userSettings.showQuickButton && !document.getElementById('yt-plus-quick-button')) {
      const btn = document.createElement('button');
      btn.id = 'yt-plus-quick-button';
      btn.className = 'yt-plus-quick-action-btn';
      btn.type = 'button';
      btn.title = 'Download Video / Audio';
      btn.innerHTML = `
        <svg viewBox="0 0 24 24"><path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM17 13l-5 5-5-5h3V9h4v4h3z"/></svg>
        <span>Download</span>
      `;

      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const shareBtn = Array.from(actionMenu.querySelectorAll('button, yt-button-shape')).find((b) => {
          const t = b.textContent?.toLowerCase() || '';
          const l = b.getAttribute('aria-label')?.toLowerCase() || '';
          return t.includes('share') || l.includes('share') || t.includes('podijeli') || l.includes('podijeli');
        });
        if (shareBtn) {
          shareBtn.click();
        } else {
          startDownloadProcess('mp4', userSettings.defaultVideoQuality || '1080', btn);
        }
      });

      actionMenu.appendChild(btn);
    }

    // 2. LEDicated Light Show button (#yt-ledicated-btn) right next to #yt-plus-quick-button
    if (!document.getElementById('yt-ledicated-btn')) {
      const ledBtn = document.createElement('button');
      ledBtn.id = 'yt-ledicated-btn';
      ledBtn.className = 'yt-plus-quick-action-btn yt-ledicated-btn';
      ledBtn.type = 'button';
      ledBtn.title = 'LEDicated Studio — Uživo Light Show & Sinkronizacija';
      ledBtn.innerHTML = `
        <span class="yt-ledicated-dot"></span>
        ${SVG_LIGHTSHOW}
        <span class="yt-ledicated-btn-label">Light Show</span>
      `;

      ledBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        ensureLedicatedPopover();
        toggleLedicatedPopover();
      });

      const quickBtn = document.getElementById('yt-plus-quick-button');
      if (quickBtn && quickBtn.parentNode === actionMenu) {
        quickBtn.insertAdjacentElement('afterend', ledBtn);
      } else {
        actionMenu.appendChild(ledBtn);
      }

      ensureLedicatedPopover();
      updateLedicatedUI();
    }
  }

  // MutationObserver
  let timer = null;
  const observer = new MutationObserver(() => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      injectIntoShareModal();
      injectQuickButton();
    }, 100);
  });

  observer.observe(document.body || document.documentElement, {
    childList: true,
    subtree: true
  });

  document.addEventListener('click', (e) => {
    // Close popover when clicking outside
    if (ledicatedState.popoverOpen) {
      const pop = document.getElementById('yt-ledicated-popover');
      const btn = document.getElementById('yt-ledicated-btn');
      if (pop && !pop.contains(e.target) && (!btn || !btn.contains(e.target))) {
        closeLedicatedPopover();
      }
    }

    const t = e.target.closest('button, yt-button-shape, ytd-button-renderer');
    if (!t) return;
    const txt = t.textContent?.toLowerCase() || '';
    const lbl = t.getAttribute('aria-label')?.toLowerCase() || '';
    if (txt.includes('share') || lbl.includes('share') || txt.includes('podijeli') || lbl.includes('podijeli')) {
      setTimeout(injectIntoShareModal, 50);
      setTimeout(injectIntoShareModal, 250);
    }
  }, true);

  window.addEventListener('resize', positionLedicatedPopover);
  window.addEventListener('scroll', positionLedicatedPopover, { passive: true });

  window.addEventListener('yt-navigate-finish', () => {
    requestPlayerData();
    setTimeout(() => {
      injectQuickButton();
      injectIntoShareModal();
      refreshLedicatedStatus();
    }, 300);
  });

  injectPageScript();
  loadSettings();
})();
