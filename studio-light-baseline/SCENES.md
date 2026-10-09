# First scene library

These are design cues for nine bars in a 3 × 3 grid. Brightness values are **starting ceilings**, to be adjusted after testing the actual room. With MacBook/YouTube playback, the initial system uses detected audio transients and frequency energy. The later scene controller estimates a quarter-note beat; four estimated beats make a bar in 4/4. A guessed bar boundary may be wrong, so the operator can tap or nudge phase. Blackout is immediate.

| Scene | Look | Timing | Starting brightness |
| --- | --- | --- | ---: |
| Arrival | Warm white, all bars with a very slow swell | Free running, 8–16 bars per breath | 20% |
| Pulse | Low-intensity deep blue/amber base; brief warm-white kick accent in centre column | Kick/onset, gated; one accent per beat max | 35% |
| Columns | L → C → R wave with a soft tail | One column per beat, direction changes every 4 bars | 40% |
| Rows | Back → middle → front chase | One row per beat; reset on downbeat | 40% |
| Diagonal | L1+C2+R3, then R1+C2+L3 | Alternates every 2 beats | 40% |
| Orbit | Perimeter bars chase; centre answers | 8 beats around edge; centre on downbeat | 45% |
| Build | Increasing filled rows; narrow moving line inside each bar | 4, 8 or 16 bars, selected by operator | 50% |
| Drop | One deliberate dark beat, then a restrained full-grid color hit and fast spatial chase | Quantized to selected downbeat; never auto-guess a drop from audio | 55% peak |
| Reset | Short fade to steady low warm white | Any time; immediately available | 15% |
| Blackout | All channels off | Immediate, not quantized | 0% |

## Show-control behaviour

- The operator chooses a scene, palette, brightness and optional build length. Scene changes may queue for the next **estimated** four-beat boundary; Reset and Blackout respond immediately.
- MacBook system audio is the primary input. A tempo estimator supplies BPM and phase when it can; tap BPM and phase nudge correct it. A numeric BPM alone cannot identify the downbeat. If a future playback application exposes Ableton Link or MIDI clock, that becomes the preferred clock. [Ableton synchronization manual](https://www.ableton.com/en/manual/synchronizing-with-link-tempo-follower-and-midi/).
- Audio contributes accents and energy, with threshold, gain, cooldown and smoothing. It does not drive an uncontrolled full-grid flash on every detected transient. LedFx can supply quick audio-reactive looks while more deliberate scenes are developed. [LedFx overview](https://docs.ledfx.app/en/latest/).
- Use a single timebase for all nine bars. Render their pixels in one scene update, then send frames to nodes. Add a user-adjustable delay/advance control for visual alignment with the sound heard in the room.
- Limit sustained white output and avoid rapid repetitive flashes. The actual venue brightness limit is set during commissioning, after checking power and thermal headroom.

## Programming order

1. Test map: identify all bars and show one moving pixel on each.
2. Static palettes and operator blackout.
3. MacBook loopback audio input, onset indicator and a manually adjustable 120 BPM/phase test clock.
4. Rows, Columns, Diagonal and Orbit as deterministic beat-locked scenes.
5. Audio accent layer, Build and manually cued Drop.
6. Show presets and fallback behaviour if network, clock or audio disappears.
