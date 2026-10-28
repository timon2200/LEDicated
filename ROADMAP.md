# LEDicated — Project Roadmap & GitHub Issue Tracker

This document tracks the architecture, completed milestones, and open engineering tasks for the **LEDicated 3×3 RGBW Studio & Live Ecosystem** ([`timon2200/LEDicated`](https://github.com/timon2200/LEDicated/issues)).

---

## 1. Completed Milestones (Done ✅)

### Core DAW, 60+ Hz WLED Engine & Audio Pipeline
- [x] **3×3 Matrix Show Engine & 16 Presets** ([`timeline.mjs`](studio-light-baseline/app/timeline.mjs), [`show-engine.mjs`](studio-light-baseline/app/show-engine.mjs)) — Deterministic RGBW frame renderer with pre-baked lookahead cache, surgical dirty-range invalidation, and additive Live Board compositing (`Q/W/E/R`, `A/S/D/F`).
- [x] **60+ Hz Autonomous Server DDP Clock** ([`server.mjs`](studio-light-baseline/app/server.mjs), [`daw-output.mjs`](studio-light-baseline/app/daw-output.mjs), [`daw.mjs`](studio-light-baseline/app/daw.mjs)) — High-rate `16 ms` (`62.5 Hz`) server render & interpolation loop for YouTube `ext_synced`, YouTube `ext_live_stream`, and background DAW `fallback_timer`, plus unblocked `1/65 s` browser `requestAnimationFrame` streaming.
- [x] **86.13 Hz STFT Audio Analysis & EDM Section Detection** ([`audio-analysis.mjs`](studio-light-baseline/app/audio-analysis.mjs), [`audio-sections.mjs`](studio-light-baseline/app/audio-sections.mjs)) — `11.61 ms` hop resolution (`FFT_SIZE = 1024, HOP_SIZE = 128`) for `drums`, `bass`, `vocals`, and `other` envelopes, comb-filter BPM/phase tracking, and phrase-aligned section classification (`Intro`, `Verse`, `Build`, `Drop`, `Breakdown`, `Outro`).
- [x] **E8-WiFi Plus & ESP32-C3 Hardware Profiles** ([`hardware-topology.mjs`](studio-light-baseline/app/hardware-topology.mjs), [`wled-discovery.mjs`](studio-light-baseline/app/wled-discovery.mjs)) — Supports `e8-columns` (8 bars on `O1`/`O3`/`O5`), `e8-c3` (8 bars on E8 + 1 bar on C3), and `c3-five` (5× ESP32-C3), with Mac Bonjour `_wled._tcp` discovery and MAC identity verification.

### Multi-User Office LAN Hub & Git Show Sharing
- [x] **Unified LAN Stage Lock & 1-Click Takeover** ([`server.mjs`](studio-light-baseline/app/server.mjs), [`lan-coordinator.mjs`](studio-light-baseline/app/lan-coordinator.mjs)) — Automatic stage claim on idle, polite Solo preview protection while a colleague is ON AIR, 20-second pause grace timer, and UDP multi-laptop WLED arbitration.
- [x] **`.ledpack` & `.ledshow.json` Bundles + Git `shared-shows/`** ([`show-bundle.mjs`](studio-light-baseline/app/show-bundle.mjs), [`shared-shows/`](studio-light-baseline/app/shared-shows)) — Binary `.ledpack` (audio + analysis + timeline) and Git-friendly `.ledshow.json` with 22+ pre-built shows and peer-to-peer LAN push/pull.

### Companion Apps (YouTube Chrome Extension, macOS Menu Bar, iOS/Web Pad)
- [x] **YouTube Chrome Extension Bridge** ([`chrome-extension/`](chrome-extension)) — 40 Hz WebAudio 4-stem extraction, automatic matching against local DB and Git `shared-shows/`, 1-click `yt-dlp` background import, and Gemini 2.5 Flash AI Show Director ([`gemini-director.mjs`](studio-light-baseline/app/gemini-director.mjs)).
- [x] **Native macOS Menu Bar Controller (`LEDicatedBar.app`)** ([`macos-menubar/LEDicatedMenuBar.swift`](macos-menubar/LEDicatedMenuBar.swift)) — Instant 2700K–6500K office lighting slider, `lor: 2` ambient lock vs. `lor: 0` live DDP show handover, 24 V Watt/Wh lifetime telemetry, and throttled HTTP polling during 60 Hz DDP shows.
- [x] **Native iOS (`LEDicatedPad`) & Web PWA (`/pad`) Live Controller** ([`ios-companion/`](ios-companion), [`pad.mjs`](studio-light-baseline/app/pad.mjs)) — Multi-touch 8-pad performance grid, 3×3 bar target matrix, haptics, and real-time SSE state sync.

---

## 2. Open Milestones & GitHub Issues (To Do 🎯)

### Milestone 1: GitHub Auto-Sync & Automated CI
| Issue | Task | Key Files | Status |
| :---: | :--- | :--- | :---: |
| [#1](https://github.com/timon2200/LEDicated/issues/1) | **In-App GitHub Auto-Sync (`pull` / `push` `shared-shows/` & track remote updates)**<br>Add `/api/git/status` and `/api/git/sync` so new `.ledshow.json` shows and repo updates can be pulled/pushed with 1 click inside the DAW without opening Terminal. | [`server.mjs`](studio-light-baseline/app/server.mjs), [`daw-ui.mjs`](studio-light-baseline/app/daw-ui.mjs), [`daw-browser.mjs`](studio-light-baseline/app/daw-browser.mjs) | Open |
| [#2](https://github.com/timon2200/LEDicated/issues/2) | **GitHub Actions CI Pipeline for 207+ Unit & Integration Tests**<br>Run `npm run build && npm test` (with `ffmpeg`) and validate all `shared-shows/*.ledshow.json` files automatically on every push/PR to `main`. | `.github/workflows/ci.yml`, [`server-ext.test.mjs`](studio-light-baseline/app/server-ext.test.mjs) | Open |

### Milestone 2: Full 9-Bar 3×3 Hardware & Calibration
| Issue | Task | Key Files | Status |
| :---: | :--- | :--- | :---: |
| [#3](https://github.com/timon2200/LEDicated/issues/3) | **Wire & Activate 9th Physical LED Bar (`C1` Top-Center) for Full 3×3 Matrix**<br>Connect physical bar `C1` (12 addressable groups / 72 LEDs), update E8 `O5` bus length to 36 groups, verify per-bar direction (`reverse`), and enable `C1` output. | [`hardware-topology.mjs`](studio-light-baseline/app/hardware-topology.mjs), [`server.mjs`](studio-light-baseline/app/server.mjs), [`E8_WIFI_PLUS_V1_01.md`](studio-light-baseline/E8_WIFI_PLUS_V1_01.md) | Open |
| [#4](https://github.com/timon2200/LEDicated/issues/4) | **Per-Device Bluetooth / AirPlay Audio-to-Light Latency Presets**<br>Save named audio output offset presets (*MacBook 0 ms*, *AUX +15 ms*, *Bluetooth +160 ms*, *AirPlay +220 ms*) and apply across both DAW and server-side YouTube sync. | [`daw-output.mjs`](studio-light-baseline/app/daw-output.mjs), [`server.mjs`](studio-light-baseline/app/server.mjs) | Open |
| [#5](https://github.com/timon2200/LEDicated/issues/5) | **Physical 60 Hz WLED FPS, Power & Thermal Verification on E8-WiFi Plus**<br>Verify sustained 55–62 Hz DDP in WLED `/json/info` (`leds.fps`) on `192.168.0.117` and validate 24 V PSU load / voltage drop during peak Drop strobes. | [`E8_WIFI_PLUS_V1_01.md`](studio-light-baseline/E8_WIFI_PLUS_V1_01.md), [`LEDicatedMenuBar.swift`](macos-menubar/LEDicatedMenuBar.swift) | Open |

### Milestone 3: Studio Pro & Companion Ecosystem
| Issue | Task | Key Files | Status |
| :---: | :--- | :--- | :---: |
| [#6](https://github.com/timon2200/LEDicated/issues/6) | **Optional Offline AI 4-Stem Separation (HTDemucs / ONNX) in Audio Pipeline**<br>Support optional Apple Silicon Metal/MPS `demucs` stem separation for true isolated `drums`/`bass`/`vocals`/`other` audio & 86.13 Hz envelopes, with automatic fallback to fast STFT. | [`audio-analysis.mjs`](studio-light-baseline/app/audio-analysis.mjs), [`daw-stems.mjs`](studio-light-baseline/app/daw-stems.mjs) | Open |
| [#7](https://github.com/timon2200/LEDicated/issues/7) | **iOS & iPadOS `LEDicatedPad` Bonjour Auto-Discovery & Live Stage Header**<br>Auto-discover `Timons-MacBook-Pro.local:8787` on office Wi-Fi without manual IP entry and show live song section progress on the pad header. | [`StudioClient.swift`](ios-companion/LEDicatedPad/StudioClient.swift), [`ContentView.swift`](ios-companion/LEDicatedPad/ContentView.swift) | Open |
| [#8](https://github.com/timon2200/LEDicated/issues/8) | **Chrome Extension YouTube Playlist Pre-Import & Live FPS Telemetry**<br>Pre-import and analyze the next upcoming YouTube playlist/mix track ~30s before the current song ends, and display live DDP Hz inside the YouTube popover. | [`chrome-extension/content.js`](chrome-extension/content.js), [`server.mjs`](studio-light-baseline/app/server.mjs) | Open |

---

## 3. Useful Commands for Tracking & Managing Updates

```bash
# View all open tasks on GitHub from Terminal
gh issue list --repo timon2200/LEDicated

# View tasks grouped by milestone
gh issue list --repo timon2200/LEDicated --milestone "M1: GitHub Auto-Sync & Automated CI"
gh issue list --repo timon2200/LEDicated --milestone "M2: Full 9-Bar 3x3 Hardware & Calibration"
gh issue list --repo timon2200/LEDicated --milestone "M3: Studio Pro & Companion Ecosystem"

# Run full build & 207-test verification suite locally
cd studio-light-baseline/app && npm run build && npm test
```
