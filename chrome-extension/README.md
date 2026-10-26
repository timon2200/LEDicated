# YouTube Plus Downloader

A Chrome Extension + macOS Local Companion App that provides seamless **4K, 1080p, and 320kbps MP3** downloads directly inside YouTube's native **Share Modal** and watch page into your `~/Downloads` folder.

---

## What's Included

1. **Chrome Extension (Manifest V3)**
   - Minimal native YouTube-style download chips in the Share Modal:
     - `[ 📹 MP4 | 1080p ▾ ]` with qualities: `4K (2160p)`, `1440p (2K)`, `1080p (Full HD)`, `720p (HD)`, `480p`, `360p`
     - `[ 🎵 MP3 | 320k ▾ ]` with bitrates: `320 kbps (High Quality)`, `256 kbps`, `192 kbps`, `128 kbps`
   - Real-time download percentage progress.
   - 1-click **Open Downloads Folder** link on completion.

2. **Local Companion Daemon (Autostart on macOS)**
   - Powered by local `yt-dlp` and `ffmpeg`.
   - Autostarts on Mac login via macOS LaunchAgent (`com.youtubeplus.companion.plist`).
   - Zero external server dependencies, zero rate limits, zero ads.

3. **macOS App (`YouTube Plus.app`)**
   - Installed to `/Applications/YouTube Plus.app`.
   - Offers quick status check, server restart, and 1-click access to Downloads folder.

---

## Quick Setup

### Step 1: Install Local Companion (Autostart on Mac)
In your terminal, run:
```bash
cd /Users/timonterzic/Documents/Projekti/youtube-plus
./install.sh
```
*This configures the background LaunchAgent (runs automatically on login) and creates `/Applications/YouTube Plus.app`.*

### Step 2: Load Extension in Chrome
1. Open Chrome and go to `chrome://extensions`.
2. Turn **Developer mode** ON (top right).
3. Click **Load unpacked** and choose `/Users/timonterzic/Documents/Projekti/youtube-plus`.

### Step 3: Enjoy 1-Click Downloads!
1. Open any video on [YouTube](https://www.youtube.com).
2. Click **Share** below the video.
3. Select your quality and click **MP4** or **MP3** — it downloads at full speed straight into your `~/Downloads` folder!

---

## Managing the Companion
- **Check Status / Open Downloads:** Click the **YouTube Plus** extension icon in Chrome or open `/Applications/YouTube Plus.app`.
- **Uninstall Autostart:** Run `./uninstall.sh`.
