# Chrome Web Store Listing & Metadata: YouTube Plus Downloader

## Listing Metadata

- **Name**: YouTube Plus Downloader
- **Short Name**: YouTube Plus
- **Version**: 1.0.0
- **Summary / Short Description**: Download high-quality MP3 audio and MP4 video directly within YouTube's native Share dialog.
- **Detailed Description**:
  Enhance your YouTube viewing experience with YouTube Plus Downloader. Seamlessly integrated into YouTube's native interface, this extension lets you download videos and audio without intrusive redirects or external popups.

  Features:
  - **Native Share Dialog Integration**: Adds a clean download section right inside the YouTube Share modal.
  - **Video Downloads (MP4)**: Choose between 1080p (Full HD), 720p (HD), 480p, 360p, or Best Available.
  - **Audio Downloads (MP3)**: Select your preferred bitrate from 320 kbps (High Quality), 256 kbps, 192 kbps, or 128 kbps.
  - **Direct to Downloads**: Automatically names files cleanly based on video title and saves directly to your computer's Downloads folder.
  - **Dark & Light Mode Support**: Automatically adapts to YouTube's current color theme.
  - **Customizable**: Set your preferred default qualities in the extension popup.

- **Category**: Productivity / Media
- **Primary Language**: English

---

## Permissions Justifications

| Permission | Justification |
|---|---|
| `downloads` | Required to initiate the download of selected MP4 video and MP3 audio files and save them directly to the user's Downloads folder. |
| `storage` | Used to save the user's preferred default video and audio qualities, UI preferences, and recent download history locally on device. |
| `activeTab` | Used to inspect the current YouTube video page URL and title when opening the extension popup or triggering actions. |
| `*://*.youtube.com/*` | Required to inject the content script and download UI into the YouTube website and Share modal. |
| `https://*/*` | Required for background communication with stream processing APIs (e.g. Cobalt/Invidious) to fetch direct media URLs. |

---

## Privacy & Data Practices

- **Data Collection**: No personal data, browsing history, user identifiers, or analytics are collected, tracked, or transmitted to any external tracking services.
- **Local Storage**: Preferences and download history remain entirely on the user's local machine via `chrome.storage.local`.
- **Media Processing**: Video URLs are sent solely to resolve direct stream endpoints for user-requested downloads.

---

## How to Load in Chrome (Developer Mode)

1. Open Google Chrome and navigate to `chrome://extensions`.
2. Enable **Developer mode** using the toggle switch in the top right corner.
3. Click **Load unpacked**.
4. Select the project folder: `/Users/timonterzic/Documents/Projekti/youtube-plus`.
5. Open any video on [YouTube](https://www.youtube.com), click **Share**, and you will see the native **Download to Device** section.
