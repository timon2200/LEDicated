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
  loadSettings();
});
