// page-script.js - Injected into MAIN world to access YouTube player data, stream downloads, and non-destructive WebAudio stem analysis

(function() {
  if (window.__yt_plus_injected) return;
  window.__yt_plus_injected = true;

  function extractPlayerData() {
    try {
      let playerResponse = window.ytInitialPlayerResponse;

      const watchFlexy = document.querySelector('ytd-watch-flexy');
      if (!playerResponse && watchFlexy && watchFlexy.playerData) {
        playerResponse = watchFlexy.playerData;
      }

      const moviePlayer = document.getElementById('movie_player');
      let videoData = null;
      if (moviePlayer && typeof moviePlayer.getVideoData === 'function') {
        try { videoData = moviePlayer.getVideoData(); } catch (e) {}
      }

      const urlParams = new URLSearchParams(window.location.search);
      let videoId = urlParams.get('v') || (videoData && videoData.video_id) || (playerResponse?.videoDetails?.videoId) || '';
      if (!videoId && window.location.pathname.startsWith('/shorts/')) {
        videoId = window.location.pathname.split('/shorts/')[1]?.split('?')[0] || '';
      }

      let title = playerResponse?.videoDetails?.title || (videoData && videoData.title);
      if (!title) {
        const titleEl = document.querySelector('h1.ytd-watch-metadata yt-formatted-string, #title h1 yt-formatted-string, h1.title yt-formatted-string');
        title = titleEl ? titleEl.textContent.trim() : document.title.replace(' - YouTube', '').trim();
      }

      const author = playerResponse?.videoDetails?.author || videoData?.author || '';
      const streamingData = playerResponse?.streamingData;
      const formats = [];
      const audioFormats = [];

      if (streamingData) {
        if (streamingData.formats && Array.isArray(streamingData.formats)) {
          for (const fmt of streamingData.formats) {
            formats.push({
              itag: fmt.itag,
              qualityLabel: fmt.qualityLabel || `${fmt.height || ''}p`,
              url: fmt.url || null,
              signatureCipher: fmt.signatureCipher || fmt.cipher || null,
              mimeType: fmt.mimeType
            });
          }
        }
        if (streamingData.adaptiveFormats && Array.isArray(streamingData.adaptiveFormats)) {
          for (const fmt of streamingData.adaptiveFormats) {
            const isAudio = fmt.mimeType && fmt.mimeType.startsWith('audio/');
            if (isAudio) {
              audioFormats.push({
                itag: fmt.itag,
                bitrate: fmt.bitrate,
                audioQuality: fmt.audioQuality || `${Math.round((fmt.bitrate || 128000) / 1000)}kbps`,
                url: fmt.url || null,
                signatureCipher: fmt.signatureCipher || fmt.cipher || null,
                mimeType: fmt.mimeType
              });
            } else if (fmt.mimeType && fmt.mimeType.startsWith('video/')) {
              formats.push({
                itag: fmt.itag,
                qualityLabel: fmt.qualityLabel || `${fmt.height || ''}p`,
                url: fmt.url || null,
                signatureCipher: fmt.signatureCipher || fmt.cipher || null,
                mimeType: fmt.mimeType
              });
            }
          }
        }
      }

      return {
        videoId,
        title: title || 'YouTube_Video',
        author,
        formats,
        audioFormats,
        url: window.location.href
      };
    } catch (err) {
      return {
        videoId: new URLSearchParams(window.location.search).get('v') || '',
        title: document.title.replace(' - YouTube', '').trim() || 'YouTube_Video',
        formats: [],
        audioFormats: [],
        url: window.location.href
      };
    }
  }

  // Handle in-page direct stream downloading
  async function handleInPageDownload(type, quality, title) {
    try {
      const data = extractPlayerData();
      let targetFormat = null;

      if (type === 'mp4') {
        const formats = data.formats || [];
        targetFormat = formats.find(f => f.qualityLabel && f.qualityLabel.includes(quality)) ||
                       formats.find(f => f.url) ||
                       formats[0];
      } else {
        const audioFormats = data.audioFormats || [];
        targetFormat = audioFormats.find(f => f.url && f.mimeType.includes('mp4')) ||
                       audioFormats.find(f => f.url) ||
                       audioFormats[0];
      }

      if (!targetFormat) {
        throw new Error('No stream available for this video.');
      }

      let streamUrl = targetFormat.url;
      if (!streamUrl && targetFormat.signatureCipher) {
        const params = new URLSearchParams(targetFormat.signatureCipher);
        const rawUrl = params.get('url');
        const s = params.get('s');
        const sp = params.get('sp') || 'sig';
        if (rawUrl) {
          streamUrl = s ? `${rawUrl}&${sp}=${encodeURIComponent(s)}` : rawUrl;
        }
      }

      if (!streamUrl) {
        throw new Error('Could not parse stream link.');
      }

      const cleanTitle = (title || data.title || 'YouTube_Video').replace(/[<>:"/\\|?*]/g, '').trim();
      const ext = type === 'mp3' ? 'mp3' : 'mp4';
      const filename = `${cleanTitle}.${ext}`;

      const resp = await fetch(streamUrl, { mode: 'cors' });
      if (!resp.ok) {
        throw new Error(`Media fetch returned HTTP ${resp.status}`);
      }
      const blob = await resp.blob();
      const blobUrl = URL.createObjectURL(blob);

      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();

      setTimeout(() => {
        a.remove();
        URL.revokeObjectURL(blobUrl);
      }, 4000);

      return { success: true, filename };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  // --- Non-Destructive MAIN-World Audio Stem Extractor (Backup Bridge for content.js) ---
  const mainAudioTap = {
    audioCtx: null,
    analyser: null,
    sourceNode: null,
    attachedVideo: null,
    freqData: null,
    prevFreqData: null,
    prevSubKick: 0,
    drumsHistory: [],
    rolling2sWindow: [],
    lastBeatAtMs: 0
  };

  function clamp01(val) {
    if (!Number.isFinite(val)) return 0;
    return Math.max(0, Math.min(1, val));
  }

  function ensureMainAudioTap(video) {
    if (!video) return false;
    try {
      const captureFn = video.captureStream || video.mozCaptureStream;
      if (typeof captureFn !== 'function') return false;

      if (!mainAudioTap.audioCtx) {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) return false;
        mainAudioTap.audioCtx = new AudioContextClass();
      }

      if (mainAudioTap.audioCtx.state === 'suspended') {
        mainAudioTap.audioCtx.resume().catch(() => {});
      }

      if (mainAudioTap.attachedVideo !== video || !mainAudioTap.analyser) {
        if (mainAudioTap.sourceNode) {
          try { mainAudioTap.sourceNode.disconnect(); } catch (e) {}
          mainAudioTap.sourceNode = null;
        }
        const stream = captureFn.call(video);
        if (!stream || stream.getAudioTracks().length === 0) {
          return false;
        }
        const analyser = mainAudioTap.audioCtx.createAnalyser();
        analyser.fftSize = 1024;
        analyser.smoothingTimeConstant = 0.35;

        const source = mainAudioTap.audioCtx.createMediaStreamSource(stream);
        source.connect(analyser);

        mainAudioTap.sourceNode = source;
        mainAudioTap.analyser = analyser;
        mainAudioTap.attachedVideo = video;
        mainAudioTap.freqData = new Uint8Array(analyser.frequencyBinCount);
        mainAudioTap.prevFreqData = new Float32Array(analyser.frequencyBinCount);
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  function sampleMainWorldStems() {
    const video = document.querySelector('video.html5-main-video') || document.querySelector('video');
    if (!video) return null;
    if (video.paused || video.ended) {
      return {
        bass: 0,
        drums: 0,
        vocals: 0,
        other: 0,
        rms: 0,
        isBeat: false,
        isDrop: false
      };
    }

    if (!ensureMainAudioTap(video) || !mainAudioTap.analyser) {
      return null;
    }

    const analyser = mainAudioTap.analyser;
    const freqData = mainAudioTap.freqData;
    const prevFreq = mainAudioTap.prevFreqData;
    analyser.getByteFrequencyData(freqData);

    const sampleRate = mainAudioTap.audioCtx.sampleRate || 48000;
    const fftSize = analyser.fftSize || 1024;
    const binHz = sampleRate / fftSize;
    const nBins = freqData.length;

    const bandAvg = (minHz, maxHz) => {
      const s = Math.max(1, Math.floor(minHz / binHz));
      const e = Math.min(nBins - 1, Math.ceil(maxHz / binHz));
      if (e < s) return 0;
      let sum = 0;
      for (let i = s; i <= e; i++) {
        sum += freqData[i] / 255;
      }
      return sum / (e - s + 1);
    };

    const bassRaw = bandAvg(40, 180);
    const subKick = bandAvg(50, 130);
    const vocalsRaw = bandAvg(280, 3400);
    const otherRaw = bandAvg(3400, 8000);

    // Transient flux in 60-4500 Hz
    const fluxStart = Math.max(1, Math.floor(60 / binHz));
    const fluxEnd = Math.min(nBins - 1, Math.ceil(4500 / binHz));
    let fluxSum = 0;
    for (let i = fluxStart; i <= fluxEnd; i++) {
      const cur = freqData[i] / 255;
      const diff = cur - prevFreq[i];
      if (diff > 0) fluxSum += diff;
    }
    const fluxCount = Math.max(1, fluxEnd - fluxStart + 1);
    const fluxNorm = (fluxSum / fluxCount) * 3.4;

    // Overall RMS and update prevFreq
    let sqSum = 0;
    for (let i = 1; i < nBins; i++) {
      const norm = freqData[i] / 255;
      sqSum += norm * norm;
      prevFreq[i] = norm;
    }
    const rms = clamp01(Math.sqrt(sqSum / Math.max(1, nBins - 1)) * 1.35);

    const subKickPunch = Math.max(0, subKick - mainAudioTap.prevSubKick * 0.85) * 1.9 + subKick * 0.35;
    mainAudioTap.prevSubKick = subKick;

    const bass = clamp01(bassRaw * 1.18);
    const drums = clamp01(fluxNorm * 0.65 + subKickPunch * 0.55);
    const vocals = clamp01(vocalsRaw * 1.25);
    const other = clamp01(otherRaw * 1.45);

    const now = performance.now();
    mainAudioTap.drumsHistory.push(drums);
    if (mainAudioTap.drumsHistory.length > 24) {
      mainAudioTap.drumsHistory.shift();
    }
    const rollingDrumsAvg = mainAudioTap.drumsHistory.reduce((a, b) => a + b, 0) / mainAudioTap.drumsHistory.length;
    const isBeat = drums > Math.max(0.14, rollingDrumsAvg * 1.35) && (now - mainAudioTap.lastBeatAtMs > 200);
    if (isBeat) {
      mainAudioTap.lastBeatAtMs = now;
    }

    mainAudioTap.rolling2sWindow.push({ t: now, rms, bass });
    while (mainAudioTap.rolling2sWindow.length > 0 && now - mainAudioTap.rolling2sWindow[0].t > 2000) {
      mainAudioTap.rolling2sWindow.shift();
    }
    let avg2sRms = 0;
    let avg2sBass = 0;
    if (mainAudioTap.rolling2sWindow.length > 0) {
      for (const item of mainAudioTap.rolling2sWindow) {
        avg2sRms += item.rms;
        avg2sBass += item.bass;
      }
      avg2sRms /= mainAudioTap.rolling2sWindow.length;
      avg2sBass /= mainAudioTap.rolling2sWindow.length;
    }
    const isDrop = avg2sRms > 0.68 && avg2sBass > 0.68;

    return {
      bass: Number(bass.toFixed(3)),
      drums: Number(drums.toFixed(3)),
      vocals: Number(vocals.toFixed(3)),
      other: Number(other.toFixed(3)),
      rms: Number(rms.toFixed(3)),
      isBeat,
      isDrop
    };
  }

  // Listen for requests from content script
  window.addEventListener('YT_PLUS_GET_PLAYER_DATA', function() {
    window.dispatchEvent(new CustomEvent('YT_PLUS_PLAYER_DATA_RESPONSE', {
      detail: extractPlayerData()
    }));
  });

  window.addEventListener('YT_PLUS_SAMPLE_STEMS', function() {
    const stems = sampleMainWorldStems();
    window.dispatchEvent(new CustomEvent('YT_PLUS_STEMS_RESPONSE', {
      detail: stems
    }));
  });

  window.addEventListener('YT_PLUS_INPAGE_DOWNLOAD', async function(e) {
    const { type, quality, title } = e.detail || {};
    const result = await handleInPageDownload(type, quality, title);
    window.dispatchEvent(new CustomEvent('YT_PLUS_INPAGE_DOWNLOAD_RESPONSE', {
      detail: result
    }));
  });

  window.addEventListener('yt-navigate-finish', function() {
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('YT_PLUS_PLAYER_DATA_RESPONSE', {
        detail: extractPlayerData()
      }));
    }, 300);
  });
})();
