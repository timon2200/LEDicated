# LEDicatedPad (Native iOS Companion) — Agent Architecture & Module Contracts

This directory contains the native iOS 17+ SwiftUI/UIKit companion controller (`LEDicatedPad`) for LEDicated Studio.

To allow multiple AI agents to work in parallel without merge collisions or Swift typechecker bottlenecks, the codebase is strictly partitioned into single-responsibility modules (< 300 lines per file).

---

## 1. Quick Verification Commands for Agents

- **Fast Typecheck (~1.5s, no iPhone required):**
  ```bash
  ./ios-companion/deploy-to-iphone.sh --check
  ```
- **Compile Release Binary Only (no code-signing / device install):**
  ```bash
  ./ios-companion/deploy-to-iphone.sh --build-only
  ```
- **Full Build, Sign & Wireless Deploy to iPhone:**
  ```bash
  ./ios-companion/deploy-to-iphone.sh
  ```

> **Note on Xcode Project (`project.pbxproj`):**  
> `LEDicatedPad.xcodeproj` uses Xcode 16 `PBXFileSystemSynchronizedRootGroup` pointing at `LEDicatedPad/`. Any new `.swift` file or subdirectory placed inside `LEDicatedPad/` is automatically included by both Xcode and `deploy-to-iphone.sh`. **Never manually edit `project.pbxproj` when adding or moving Swift files.**

---

## 2. Directory Map & Agent Ownership Boundaries

When orchestrating multiple agents, assign each subagent to **disjoint files/folders** from the map below:

```text
ios-companion/LEDicatedPad/
├── App/
│   ├── LEDicatedPadApp.swift          # @main entry point
│   └── AppConfiguration.swift         # Constants, UserDefaults keys, default LAN hosts, timing constants
├── Models/
│   ├── GridTopology.swift             # BarID (3×3), ZonePreset, RGBWPixel, StageTelemetryStats
│   ├── PadModels.swift                # PadMode, EffectPreset (16), AudioDriver, PadParams, PadConfig
│   ├── PadConfig+Serialization.swift  # 1:1 JSON dictionary mapping (fromServerDictionary / toServerDictionary)
│   ├── LibraryModels.swift            # LibraryTrack, TrackSection
│   └── NetworkModels.swift            # DiscoveredStudioServer, ActivePadRun, HeldPadRun
├── Engine/                            # Pure / non-UI synthesis & tactile engines
│   ├── PatternShaders.swift           # Core pattern shaders (1:1 port from timeline.mjs)
│   ├── PatternShaders+Motion.swift    # Spatial/motion shaders (wave, ripple, rain, spiral, fire, columns, bounce)
│   ├── BarSynthesizer.swift           # Pure 60 FPS 3×3 RGBW frame compositor (remote SSE + 0ms local touch)
│   └── HapticsEngine.swift            # CoreHaptics + UIImpactFeedbackGenerator singleton
├── State/                             # @MainActor @Observable state & domain extensions
│   ├── StageFrameStore.swift          # High-frequency (30–60 Hz) store for LED bar frames & playhead timecode
│   ├── StudioClient.swift             # Root @Observable facade & shared properties
│   ├── StudioClient+Pads.swift        # Hit/Loop/Hold/Latch/Quantize state machine & pad slot sync
│   ├── StudioClient+Transport.swift   # Play/pause/seek, show launcher, master brightness, blackout
│   ├── StudioClient+Network.swift     # HTTP polling, server selection, command dispatch
│   ├── StudioClient+SSE.swift         # Live SSE stream consumer & payload parsers
│   └── NetworkDiscoveryService.swift  # Async LAN subnet probing & BSD getifaddrs Wi-Fi IP resolution
├── DesignSystem/                      # Reusable tactile UI components & theme tokens
│   ├── GlassTouchFader.swift          # Glassmorphic horizontal drag fader
│   ├── ZoneMiniGridIcon.swift         # 3×3 mini LED bar indicator icon
│   └── StudioTheme.swift              # Background gradients, color swatches, HudIconButton
└── Features/                          # Modular SwiftUI feature views
    ├── Workspace/
    │   ├── ContentView.swift          # Root orientation router (Landscape vs Portrait) + sheet hosts
    │   ├── LandscapeHudBar.swift      # Slim top HUD bar for Landscape 4×3 pad mode
    │   ├── PortraitHeaderBars.swift   # PortraitTopStatusBar + PortraitMacroStrip
    │   └── BottomExpressionDock.swift # Portrait 3-fader dock + quick pad bar
    ├── PadSurface/
    │   ├── MultiTouchPadGrid.swift    # 4×3 / 3×4 grid layout + UIKit MultiTouchPadUIView responder
    │   ├── PadCardView.swift          # Individual neon pad card with 3×3 zone matrix
    │   └── XYMorphSurfaceView.swift   # 2D XY morph pad + 12-pad quick switcher
    ├── StagePreview/
    │   ├── StagePreviewView.swift     # Portrait 3×3 RGBW bar canvas, beat LEDs, telemetry & zone painter
    │   └── MiniStageMatrixView.swift  # Compact 3×3 live matrix preview for HUD & sheets
    ├── Inspector/
    │   ├── PadInspectorSheet.swift    # Modal sheet to edit a pad's mode, faders & target bars
    │   └── PadInspectorPresetsAndColors.swift # Preset grid, dual color swatches & reset actions
    └── StudioMenu/
        ├── StudioSettingsSheet.swift  # Segmented navigation container (Light Show | Pozornica | Mreža)
        ├── NowPlayingShowCard.swift   # Active light show hero card, playhead scrubber & section jump pills
        ├── LibraryLauncherTab.swift   # Searchable Light Show database launcher
        ├── StageControlTab.swift      # Master brightness fader/presets, transport & emergency blackout
        └── NetworkDiagnosticsTab.swift# Connection status hero, LAN auto-discovery & manual IP entry
```

---

## 3. Architectural Guardrails for Agents

1. **Keep High-Frequency 30–60 Hz State in `StageFrameStore`:**
   - SSE `frame_sync` events arrive 30 times per second and update `remoteFrameBars` and `timeSec`.
   - Those properties live on `StageFrameStore` (`client.frameStore`) so that only `StagePreviewView`, `MiniStageMatrixView`, and `LibraryLauncherTab`'s playhead scrubber observe high-frequency frame updates.
   - In `StudioClient+Network.swift`, always guard low-frequency properties (`if isPlaying != playing { isPlaying = playing }`) before mutating them on `frame_sync` so `@Observable` does not invalidate `MultiTouchPadGrid` or sheets on every frame.
2. **Avoid Complex Inline Expressions in SwiftUI `body`:**
   - The Swift typechecker slows down exponentially when ternary expressions and closures are deeply nested inside `HStack`/`VStack` builders.
   - Break subviews into small computed properties or helper methods with explicit types (`let active: Bool = ...`).
3. **Keep Files Under 300 Lines:**
   - If a feature grows beyond ~300 lines, split sub-cards or sub-tabs into a sibling file in the same `Features/<FeatureName>/` folder.
4. **Always Run `--check` Before Finishing:**
   - Every agent modifying Swift code must run `./ios-companion/deploy-to-iphone.sh --check` and confirm zero errors and warnings before reporting completion.
