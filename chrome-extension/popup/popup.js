// popup.js - Popup logic with Companion connection checking

document.addEventListener('DOMContentLoaded', async () => {
  const statusIndicator = document.getElementById('server-status-indicator');
  const statusLabel = document.getElementById('server-status-text');
  const companionDetails = document.getElementById('companion-details');
  const openDownloadsBtn = document.getElementById('open-downloads-btn');
  const settingsForm = document.getElementById('settings-form');
  const videoQualitySelect = document.getElementById('defaultVideoQuality');
  const audioQualitySelect = document.getElementById('defaultAudioQuality');
  const showQuickButtonToggle = document.getElementById('showQuickButton');
  const saveFeedback = document.getElementById('save-feedback');
  const ledTitleEl = document.getElementById('ledicated-popup-title');
  const ledSubEl = document.getElementById('ledicated-popup-sub');
  const ledTakeoverBtn = document.getElementById('ledicated-takeover-btn');

  let currentOutputMode = 'show';

  function refreshLedicatedPopup() {
    chrome.runtime.sendMessage({ action: 'LEDICATED_STATUS', data: {} }, (res) => {
      if (!ledTitleEl || !ledSubEl || !ledTakeoverBtn) return;
      if (!res || !res.online) {
        ledTitleEl.textContent = '⚪ LEDicated Studio (Offline)';
        ledSubEl.textContent = 'Pokreni LEDicated Studio server';
        ledTakeoverBtn.disabled = true;
        return;
      }
      ledTakeoverBtn.disabled = false;
      const isAmbient = res.outputMode === 'ambient' || res.lan?.outputMode === 'ambient' || !res.armed;
      currentOutputMode = isAmbient ? 'ambient' : 'show';
      if (isAmbient) {
        ledTitleEl.textContent = '💡 Menu Bar (Uredska rasvjeta)';
        ledSubEl.textContent = 'Statično svjetlo drži 3×3 LED zid';
        ledTakeoverBtn.textContent = '⚡ Preuzmi za Show';
      } else {
        const npTitle = res.lan?.nowPlaying?.trackTitle || res.track?.title || 'Uživo DDP izlaz';
        ledTitleEl.textContent = '🟢 Light Show na zidu';
        ledSubEl.textContent = npTitle;
        ledTakeoverBtn.textContent = '💡 Vrati uredsko svjetlo';
      }
    });
  }

  if (ledTakeoverBtn) {
    ledTakeoverBtn.addEventListener('click', () => {
      const wantShow = currentOutputMode === 'ambient';
      chrome.runtime.sendMessage(
        {
          action: 'LEDICATED_CONTROL',
          data: wantShow
            ? { claimStage: true, takeover: true, armed: true, outputMode: 'show' }
            : { outputMode: 'ambient', armed: false }
        },
        () => {
          refreshLedicatedPopup();
        }
      );
    });
  }

  // Check Companion Server
  function checkCompanion() {
    chrome.runtime.sendMessage({ action: 'CHECK_COMPANION' }, (res) => {
      if (res && res.online) {
        statusIndicator.className = 'status-indicator online';
        statusLabel.textContent = 'Active';
        companionDetails.textContent = `yt-dlp + ffmpeg connected (${res.data?.downloads_dir || '~/Downloads'})`;
      } else {
        statusIndicator.className = 'status-indicator';
        statusLabel.textContent = 'Offline';
        companionDetails.textContent = 'Companion offline. Launch YouTube Plus.app';
      }
    });
  }

  // Open Downloads Folder
  openDownloadsBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'OPEN_DOWNLOADS' });
  });

  // Load Settings
  function loadSettings() {
    chrome.runtime.sendMessage({ action: 'GET_SETTINGS' }, (res) => {
      if (res && res.success && res.settings) {
        const s = res.settings;
        videoQualitySelect.value = s.defaultVideoQuality || '1080';
        audioQualitySelect.value = s.defaultAudioQuality || '320';
        showQuickButtonToggle.checked = s.showQuickButton !== false;
      }
    });
  }

  // Save Settings
  settingsForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const settings = {
      defaultVideoQuality: videoQualitySelect.value,
      defaultAudioQuality: audioQualitySelect.value,
      showQuickButton: showQuickButtonToggle.checked
    };

    chrome.runtime.sendMessage({ action: 'SAVE_SETTINGS', settings }, (res) => {
      if (res && res.success) {
        saveFeedback.style.display = 'block';
        setTimeout(() => {
          saveFeedback.style.display = 'none';
        }, 2000);
      }
    });
  });

  // Initialize
  checkCompanion();
  refreshLedicatedPopup();
  loadSettings();
});
