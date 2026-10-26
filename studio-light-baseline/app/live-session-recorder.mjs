/** Live session recorder: captures live pad performances into timeline layers and
 * effect pills in real time. Parameter tweaks while an effect is active split the pill,
 * creating customizable clips on the timeline (editable like MIDI).
 */
import { uid, MIN_CLIP_SEC } from './daw-state.mjs';
import { PRESET_LABELS } from './daw-playlist.mjs';
import { PAD_KEYS, hitDuration } from './live-performance-state.mjs';

const rgbHex = color => '#' + (color || [0.2, 0.6, 1, 0]).slice(0, 3).map(v => Math.round(Math.max(0, Math.min(1, v || 0)) * 255).toString(16).padStart(2, '0')).join('');

export function createSessionRecorder({
  store,
  desk,
  getTime,
  getBpm = () => 120,
  isPlaying = () => false,
  hasTrack = () => true,
  onStateChange = () => {},
  status = () => {}
}) {
  let armed = false;
  let recording = false;
  // Map: padIndex -> { layerId, clipId, clip, startSec, lastChangeSec, padSnapshot, mode }
  const activePills = new Map();
  // Map: padIndex -> { songAt, pad } for quantized cues
  const queuedCues = new Map();
  let recordedClipsCount = 0;
  const createdLayerIds = new Set();

  function isArmed() {
    return armed;
  }

  function isActivelyRecording() {
    return recording;
  }

  function setArmed(value) {
    const next = Boolean(value);
    if (armed === next) return;
    armed = next;
    if (armed) {
      if (isPlaying() && hasTrack()) {
        startRecording();
      } else {
        status('Snimanje izvedbe uključeno (Armed). Pokreni reprodukciju (Space) za početak bilježenja.');
      }
    } else {
      if (recording) {
        stopRecording();
      }
      status('Snimanje izvedbe isključeno.');
    }
    onStateChange({ armed, recording });
  }

  function toggleArmed() {
    setArmed(!armed);
    return armed;
  }

  function startRecording() {
    if (!armed || !hasTrack() || recording) return;
    recording = true;
    store.begin();
    activePills.clear();
    queuedCues.clear();
    recordedClipsCount = 0;
    createdLayerIds.clear();
    status('● SNIMA SE IZVEDBA · Koristi tipke QWER / ASDF / ZXCV i mijenjaj efekte.');
    onStateChange({ armed, recording });
  }

  function findOrCreateLayer(timeline, padIndex, pad, startSec, minDuration = 0.2) {
    const key = (PAD_KEYS[padIndex] || String(padIndex + 1)).toUpperCase();
    const presetLabel = PRESET_LABELS[pad.preset] || pad.preset;
    const baseName = `Live [${key}] · ${presetLabel}`;

    const candidates = timeline.layers.filter(l => l.name === baseName || l.name.startsWith(baseName + ' '));

    for (const layer of candidates) {
      const overlaps = layer.clips.some(c => {
        const cEnd = c.startSec + c.durationSec;
        return Math.max(c.startSec, startSec) < Math.min(cEnd, startSec + minDuration);
      });
      if (!overlaps) {
        return layer;
      }
    }

    const suffix = candidates.length === 0 ? '' : ` ${candidates.length + 1}`;
    const name = `${baseName}${suffix}`;
    const hex = rgbHex(pad.color);

    const newLayer = {
      id: uid('layer'),
      name,
      color: hex,
      enabled: true,
      blend: 'add',
      opacity: 1,
      clips: []
    };

    timeline.layers.unshift(newLayer);
    createdLayerIds.add(newLayer.id);
    return newLayer;
  }

  function createPillClip(pad, startSec, durationSec) {
    const dur = Math.max(MIN_CLIP_SEC, durationSec);
    const start = Math.max(0, startSec);
    const intensity = Number.isFinite(pad.intensity) ? pad.intensity : 0.8;
    return {
      id: uid('clip'),
      preset: pad.preset,
      startSec: start,
      durationSec: dur,
      targets: pad.targets === 'all' ? 'all' : [...pad.targets],
      color: [...pad.color],
      speed: pad.speed ?? 1,
      direction: pad.direction ?? 'ltr',
      timing: pad.timing ?? 'beat',
      motionMode: pad.motionMode ?? 'serial',
      driver: pad.mode === 'loop' ? (pad.driver ?? 'none') : 'none',
      driverGain: pad.driverGain ?? 1,
      band: (pad.driver === 'band' && pad.band) ? { ...pad.band } : undefined,
      params: pad.params ? { ...pad.params } : {},
      keyframes: [
        { timeSec: 0, value: intensity },
        { timeSec: dur, value: intensity }
      ],
      recording: true
    };
  }

  function startPill(index, pad, timeSec) {
    const time = Math.max(0, timeSec);
    const bpm = getBpm();
    const expectedDur = pad.mode === 'hit' ? hitDuration(pad, bpm) : 0.2;

    store.update(timeline => {
      const layer = findOrCreateLayer(timeline, index, pad, time, expectedDur);
      const clip = createPillClip(pad, time, expectedDur);
      layer.clips.push(clip);
      recordedClipsCount++;

      activePills.set(index, {
        layerId: layer.id,
        clipId: clip.id,
        clip,
        startSec: time,
        lastChangeSec: time,
        padSnapshot: structuredClone(pad),
        mode: pad.mode
      });
    });
  }

  function onPadDown(index, pad, songTime = getTime(), { isQueued = false, queueTime = null } = {}) {
    if (!recording) return;
    const time = Math.max(0, songTime);

    // If cue is quantized, queue until cue fires
    if (isQueued && queueTime !== null) {
      queuedCues.set(index, { songAt: queueTime, pad: structuredClone(pad) });
      return;
    }

    // Finalize previous pill for this pad if still active
    if (activePills.has(index)) {
      finalizePill(index, time);
    }

    startPill(index, pad, time);
  }

  function onPadUp(index, songTime = getTime()) {
    if (!recording) return;
    const time = Math.max(0, songTime);
    queuedCues.delete(index);
    if (!activePills.has(index)) return;
    finalizePill(index, time);
  }

  function onPadChange(index, newPad, songTime = getTime()) {
    if (!recording) return;
    const time = Math.max(0, songTime);
    if (!activePills.has(index)) return;

    const active = activePills.get(index);
    const elapsed = time - active.startSec;

    const presetChanged = newPad.preset !== active.padSnapshot.preset;
    const targetsChanged = JSON.stringify(newPad.targets) !== JSON.stringify(active.padSnapshot.targets);
    const modeChanged = newPad.mode !== active.padSnapshot.mode;

    // If sufficient time has passed (at least MIN_CLIP_SEC) or major setting changed:
    // Split current pill into a new pill with the new settings!
    if (elapsed >= MIN_CLIP_SEC && (presetChanged || targetsChanged || modeChanged || (time - active.lastChangeSec >= 0.1))) {
      finalizePill(index, time);
      startPill(index, newPad, time);
    } else {
      // Small adjustment within short window: update active clip in place
      store.update(() => {
        active.clip.preset = newPad.preset;
        active.clip.color = [...newPad.color];
        active.clip.speed = newPad.speed ?? 1;
        active.clip.targets = newPad.targets === 'all' ? 'all' : [...newPad.targets];
        active.clip.direction = newPad.direction ?? 'ltr';
        active.clip.timing = newPad.timing ?? 'beat';
        active.clip.motionMode = newPad.motionMode ?? 'serial';
        active.clip.params = newPad.params ? { ...newPad.params } : {};
        active.clip.driver = newPad.mode === 'loop' ? (newPad.driver ?? 'none') : 'none';
        active.clip.driverGain = newPad.driverGain ?? 1;
        if (newPad.driver === 'band' && newPad.band) active.clip.band = { ...newPad.band };
        active.clip.keyframes.forEach(k => { k.value = newPad.intensity ?? 0.8; });
        active.padSnapshot = structuredClone(newPad);
      });
    }
  }

  function finalizePill(index, timeSec) {
    const active = activePills.get(index);
    if (!active) return;
    activePills.delete(index);

    store.update(() => {
      const dur = Math.max(MIN_CLIP_SEC, timeSec - active.startSec);
      active.clip.durationSec = dur;
      const intensity = Number.isFinite(active.padSnapshot.intensity) ? active.padSnapshot.intensity : 0.8;
      active.clip.keyframes = [
        { timeSec: 0, value: intensity },
        { timeSec: dur, value: intensity }
      ];
      delete active.clip.recording;
    });
  }

  function tick(songTime = getTime()) {
    if (!recording) return;
    const time = Math.max(0, songTime);
    const bpm = getBpm();

    // Check queued cues that became active
    for (const [index, cue] of queuedCues) {
      if (time >= cue.songAt - 0.02) {
        queuedCues.delete(index);
        startPill(index, cue.pad, cue.songAt);
      }
    }

    if (!activePills.size) return;

    store.update(() => {
      for (const [index, active] of activePills) {
        if (active.mode === 'hit') {
          const cycle = hitDuration(active.padSnapshot, bpm);
          const elapsed = time - active.startSec;
          if (elapsed >= cycle) {
            // One hit cycle complete: finalize it!
            active.clip.durationSec = cycle;
            const intensity = Number.isFinite(active.padSnapshot.intensity) ? active.padSnapshot.intensity : 0.8;
            active.clip.keyframes = [
              { timeSec: 0, value: intensity },
              { timeSec: cycle, value: intensity }
            ];
            delete active.clip.recording;

            // If still held, start the next cycle
            if (desk?.held?.has(index)) {
              const nextStart = active.startSec + cycle;
              const layer = store.timeline.layers.find(l => l.id === active.layerId) || findOrCreateLayer(store.timeline, index, active.padSnapshot, nextStart, cycle);
              const nextClip = createPillClip(active.padSnapshot, nextStart, cycle);
              layer.clips.push(nextClip);
              recordedClipsCount++;
              activePills.set(index, {
                layerId: layer.id,
                clipId: nextClip.id,
                clip: nextClip,
                startSec: nextStart,
                lastChangeSec: nextStart,
                padSnapshot: active.padSnapshot,
                mode: active.mode
              });
            } else {
              activePills.delete(index);
            }
          } else {
            active.clip.durationSec = Math.max(MIN_CLIP_SEC, elapsed);
            const intensity = Number.isFinite(active.padSnapshot.intensity) ? active.padSnapshot.intensity : 0.8;
            active.clip.keyframes[1] = { timeSec: active.clip.durationSec, value: intensity };
          }
        } else {
          // Loop mode: extends continuously while active
          const elapsed = Math.max(MIN_CLIP_SEC, time - active.startSec);
          active.clip.durationSec = elapsed;
          const intensity = Number.isFinite(active.padSnapshot.intensity) ? active.padSnapshot.intensity : 0.8;
          active.clip.keyframes[1] = { timeSec: elapsed, value: intensity };
        }
      }
    });
  }

  function handleSeek(newTime) {
    if (!recording) return;
    for (const [index, active] of activePills) {
      finalizePill(index, active.startSec + active.clip.durationSec);
    }
    activePills.clear();
    queuedCues.clear();
  }

  function handleLoopWrap(loopStart, loopEnd) {
    if (!recording) return;
    for (const [index, active] of activePills) {
      finalizePill(index, loopEnd);
      // Restart on loopStart
      startPill(index, active.padSnapshot, loopStart);
    }
  }

  function stopRecording() {
    if (!recording) return;
    const time = getTime();
    for (const index of [...activePills.keys()]) {
      finalizePill(index, time);
    }
    activePills.clear();
    queuedCues.clear();
    recording = false;

    if (recordedClipsCount > 0) {
      // Clean up any stray recording flags across layers
      store.update(timeline => {
        for (const layer of timeline.layers) {
          for (const clip of layer.clips) delete clip.recording;
        }
      });
      const committed = store.end('Snimi izvedbu');
      if (committed) {
        status(`Snimka spremljena: ${recordedClipsCount} ${recordedClipsCount === 1 ? 'clip' : 'clipova'}. Poništi s ⌘Z.`);
      } else {
        status('Greška pri spremanju snimke.');
      }
    } else {
      store.cancel();
      status('Snimanje završeno (nema novih clipova).');
    }
    onStateChange({ armed, recording });
  }

  return {
    get isArmed() { return armed; },
    get isRecording() { return recording; },
    get activePillsCount() { return activePills.size; },
    get recordedClipsCount() { return recordedClipsCount; },
    setArmed,
    toggleArmed,
    startRecording,
    stopRecording,
    onPadDown,
    onPadUp,
    onPadChange,
    tick,
    handleSeek,
    handleLoopWrap,
    isClipRecording: clipId => {
      for (const [, active] of activePills) {
        if (active.clipId === clipId) return true;
      }
      return false;
    }
  };
}
