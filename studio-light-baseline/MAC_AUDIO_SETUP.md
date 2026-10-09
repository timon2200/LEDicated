# MacBook music input for the lights

The MacBook is the music source. The first version must respond to anything it plays, including YouTube in a browser, without requiring the song to publish a tempo clock.

## Signal path

```text
Browser / Music app / video player
             │
         macOS audio
             │
       Multi-Output Device
          ├── wired speaker output / USB audio interface ── room speakers
          └── BlackHole 2ch ── LedFx audio input ── 3 × 3 WLED bar grid
```

This captures the clean digital playback signal before room acoustics, crowd noise and speaker reverberation affect it. BlackHole's [official guide](https://github.com/ExistentialAudio/BlackHole/wiki/Getting-Started%3A-Creating-a-Multi-Output-Device) explicitly covers sending the Mac's audio to both a listening device and BlackHole. Apple's [Audio MIDI Setup guide](https://support.apple.com/en-ca/guide/audio-midi-setup/ams7c093f372/mac) documents the Multi-Output Device feature.

## Setup when the hardware is ready

1. Install **BlackHole 2ch** from its [official project](https://github.com/ExistentialAudio/BlackHole). No installation has been performed as part of this plan.
2. In **Audio MIDI Setup**, create a **Multi-Output Device** containing the room's wired speaker/USB audio output and BlackHole 2ch. Set the physical speaker/USB output as primary/clock device; enable drift correction for BlackHole. Match sample rates, typically 48 kHz. [BlackHole setup](https://github.com/ExistentialAudio/BlackHole/wiki/Getting-Started%3A-Creating-a-Multi-Output-Device).
3. Select that Multi-Output Device as macOS sound output. Play a local music file and a YouTube video; confirm sound reaches the speakers.
4. In LedFx, choose **BlackHole 2ch** as audio input. Confirm the input meter responds and all WLED nodes are visible. Add nine bar segments/virtuals using the mapping in `layout.json`. [LedFx WLED configuration](https://docs.ledfx.app/en/latest/configuring.html); [LedFx virtuals](https://docs.ledfx.app/en/latest/howto/virtuals.html).
5. Test against a 120 BPM metronome. Adjust effect sensitivity and any audio-to-light offset while listening at the usual position in the room. Repeat with a few real songs, including quiet intros and dense tracks.
6. Save a calm default scene and a blackout control. If the MacBook sleeps, changes output device or disconnects, the lighting nodes should return to a safe low-brightness WLED fallback.

## Expected behaviour and limits

- **Immediate result:** bars react to the playback's low, mid and high-frequency energy and detected transients. This will work with ordinary browser/video audio routed through the Multi-Output Device.
- **BPM estimation:** can track repetitive dance music but may choose half/double tempo, drift, or mistake the snare for the downbeat. A manual tap/phase correction is part of the planned custom scene controller. Drops/builds should be operator-cued for a deliberate show.
- **Speaker connection:** prefer a wired output or USB audio interface. Bluetooth adds variable audio latency, complicating visual sync. If Bluetooth is used, the system will need a calibrated delay and may need recalibration when the speaker reconnects.
- **Volume:** macOS Multi-Output Devices may not expose normal system volume control; set venue volume on the audio interface, mixer or speakers, and test before an event. [BlackHole notes](https://github.com/ExistentialAudio/BlackHole/wiki/Multi-Output-Device).
- **No microphone needed** for MacBook playback. If music later comes from an external DJ mixer, use a **line-level REC/AUX** feed through a USB audio interface. Never take audio from a speaker-power terminal.

## First software milestone

Use LedFx and WLED to get one bar reacting to YouTube on the MacBook. Then extend to nine bars with grouped virtuals. Only after that baseline is stable, build the custom beat-clock and scene-cue application; it can replace LedFx as the single live sender during a show.
