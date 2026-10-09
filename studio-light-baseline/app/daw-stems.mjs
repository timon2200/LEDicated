/**
 * Audio stems real-time DSP & routing using Web Audio API.
 * Provides 4-band stem isolation (Bubnjevi, Bas, Vokal, Ostalo) + EQ band audition
 * connected to the HTML <audio> element.
 *
 * When all stems are unmuted and no stem is soloed, routes audio through a bit-perfect
 * dry bypass for 100% transparent audio fidelity.
 * When any stem is soloed or muted, seamlessly activates the 4-band DSP crossover filter bank.
 */

export const STEM_IDS = Object.freeze(['drums', 'bass', 'vocals', 'other']);

export const STEM_METADATA = Object.freeze({
  drums: { id: 'drums', label: 'Bubnjevi', short: 'Bubnj', color: '#ff9a3a', desc: 'Ritam, kick i snare attack (60–4500 Hz)' },
  bass: { id: 'bass', label: 'Bas', short: 'Bas', color: '#b25cff', desc: 'Sub-bas i bas linija (< 200 Hz)' },
  vocals: { id: 'vocals', label: 'Vokal', short: 'Vok', color: '#37d4ff', desc: 'Vokalni pojas i melodija (300–3400 Hz)' },
  other: { id: 'other', label: 'Ostalo', short: 'Ost', color: '#59ff9b', desc: 'Hi-hat, činele, sintesajzer i atmosfera (> 3500 Hz)' }
});

export function createStemsEngine(audioElement) {
  let ctx = null;
  let sourceNode = null;
  let masterGain = null;
  let dryGain = null;

  const stemNodes = {
    drums: { filters: [], gain: null, analyser: null },
    bass: { filters: [], gain: null, analyser: null },
    vocals: { filters: [], gain: null, analyser: null },
    other: { filters: [], gain: null, analyser: null }
  };

  const auditionNodes = {
    filter: null,
    gain: null,
    analyser: null
  };

  const masterAnalyser = null;
  const subscribers = new Set();

  const state = {
    solo: new Set(),
    muted: new Set(),
    volumes: { drums: 1, bass: 1, vocals: 1, other: 1 },
    auditionBand: null, // { lowHz, highHz } or null
    masterVolume: 1
  };

  const buffer = new Float32Array(256);

  function notify() {
    for (const sub of subscribers) {
      try { sub(state); } catch (e) { console.error('Stems subscriber error', e); }
    }
  }

  function ensureContext() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      return true;
    }
    if (typeof window === 'undefined') return false;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass || !audioElement) return false;

    try {
      ctx = new AudioContextClass();
      sourceNode = ctx.createMediaElementSource(audioElement);
      masterGain = ctx.createGain();
      masterGain.gain.value = state.masterVolume;
      masterGain.connect(ctx.destination);

      // 1. Dry bypass (direct)
      dryGain = ctx.createGain();
      dryGain.gain.value = 1;
      sourceNode.connect(dryGain);
      dryGain.connect(masterGain);

      // 2. Bass stem (< 200 Hz 4th-order lowpass)
      const bassLp1 = ctx.createBiquadFilter();
      bassLp1.type = 'lowpass';
      bassLp1.frequency.value = 200;
      bassLp1.Q.value = 0.707;

      const bassLp2 = ctx.createBiquadFilter();
      bassLp2.type = 'lowpass';
      bassLp2.frequency.value = 200;
      bassLp2.Q.value = 0.707;

      const bassGain = ctx.createGain();
      bassGain.gain.value = 0;
      const bassAn = ctx.createAnalyser();
      bassAn.fftSize = 256;
      bassAn.smoothingTimeConstant = 0.5;

      sourceNode.connect(bassLp1);
      bassLp1.connect(bassLp2);
      bassLp2.connect(bassGain);
      bassGain.connect(bassAn);
      bassGain.connect(masterGain);

      stemNodes.bass = { filters: [bassLp1, bassLp2], gain: bassGain, analyser: bassAn };

      // 3. Drums stem (Punch & rhythm transient band 70 - 4500 Hz)
      const drumHp = ctx.createBiquadFilter();
      drumHp.type = 'highpass';
      drumHp.frequency.value = 70;

      const drumPunch = ctx.createBiquadFilter();
      drumPunch.type = 'peaking';
      drumPunch.frequency.value = 110;
      drumPunch.gain.value = 3;
      drumPunch.Q.value = 1.0;

      const drumSnap = ctx.createBiquadFilter();
      drumSnap.type = 'peaking';
      drumSnap.frequency.value = 2500;
      drumSnap.gain.value = 2.5;
      drumSnap.Q.value = 1.2;

      const drumLp = ctx.createBiquadFilter();
      drumLp.type = 'lowpass';
      drumLp.frequency.value = 4800;

      const drumsGain = ctx.createGain();
      drumsGain.gain.value = 0;
      const drumsAn = ctx.createAnalyser();
      drumsAn.fftSize = 256;
      drumsAn.smoothingTimeConstant = 0.5;

      sourceNode.connect(drumHp);
      drumHp.connect(drumPunch);
      drumPunch.connect(drumSnap);
      drumSnap.connect(drumLp);
      drumLp.connect(drumsGain);
      drumsGain.connect(drumsAn);
      drumsGain.connect(masterGain);

      stemNodes.drums = { filters: [drumHp, drumPunch, drumSnap, drumLp], gain: drumsGain, analyser: drumsAn };

      // 4. Vocals stem (Vocal presence / speech band 300 - 3400 Hz)
      const vocalBp = ctx.createBiquadFilter();
      vocalBp.type = 'bandpass';
      vocalBp.frequency.value = 1200;
      vocalBp.Q.value = 0.85;

      const vocalLead = ctx.createBiquadFilter();
      vocalLead.type = 'peaking';
      vocalLead.frequency.value = 2000;
      vocalLead.gain.value = 3;
      vocalLead.Q.value = 1.2;

      const vocalsGain = ctx.createGain();
      vocalsGain.gain.value = 0;
      const vocalsAn = ctx.createAnalyser();
      vocalsAn.fftSize = 256;
      vocalsAn.smoothingTimeConstant = 0.5;

      sourceNode.connect(vocalBp);
      vocalBp.connect(vocalLead);
      vocalLead.connect(vocalsGain);
      vocalsGain.connect(vocalsAn);
      vocalsGain.connect(masterGain);

      stemNodes.vocals = { filters: [vocalBp, vocalLead], gain: vocalsGain, analyser: vocalsAn };

      // 5. Other stem (High-frequency air & atmosphere > 3500 Hz)
      const otherHp1 = ctx.createBiquadFilter();
      otherHp1.type = 'highpass';
      otherHp1.frequency.value = 3500;
      otherHp1.Q.value = 0.707;

      const otherHp2 = ctx.createBiquadFilter();
      otherHp2.type = 'highpass';
      otherHp2.frequency.value = 3500;
      otherHp2.Q.value = 0.707;

      const otherGain = ctx.createGain();
      otherGain.gain.value = 0;
      const otherAn = ctx.createAnalyser();
      otherAn.fftSize = 256;
      otherAn.smoothingTimeConstant = 0.5;

      sourceNode.connect(otherHp1);
      otherHp1.connect(otherHp2);
      otherHp2.connect(otherGain);
      otherGain.connect(otherAn);
      otherGain.connect(masterGain);

      stemNodes.other = { filters: [otherHp1, otherHp2], gain: otherGain, analyser: otherAn };

      // 6. Custom EQ Audition band
      const auditionBp = ctx.createBiquadFilter();
      auditionBp.type = 'bandpass';
      auditionBp.frequency.value = 1000;
      auditionBp.Q.value = 1;

      const auditionGain = ctx.createGain();
      auditionGain.gain.value = 0;
      const auditionAn = ctx.createAnalyser();
      auditionAn.fftSize = 256;
      auditionAn.smoothingTimeConstant = 0.5;

      sourceNode.connect(auditionBp);
      auditionBp.connect(auditionGain);
      auditionGain.connect(auditionAn);
      auditionGain.connect(masterGain);

      auditionNodes.filter = auditionBp;
      auditionNodes.gain = auditionGain;
      auditionNodes.analyser = auditionAn;

      applyGains();
      return true;
    } catch (err) {
      console.warn('Web Audio stems initialization failed', err);
      return false;
    }
  }

  function applyGains() {
    if (!ctx) return;
    const now = ctx.currentTime;
    const isAuditioning = Boolean(state.auditionBand);
    const hasSolo = state.solo.size > 0;
    const hasMute = state.muted.size > 0;
    const anyStemActive = hasSolo || hasMute;

    if (isAuditioning) {
      dryGain.gain.setValueAtTime(0, now);
      for (const id of STEM_IDS) {
        if (stemNodes[id]?.gain) stemNodes[id].gain.gain.setValueAtTime(0, now);
      }
      if (auditionNodes.gain) auditionNodes.gain.gain.setValueAtTime(1, now);
      return;
    }

    if (auditionNodes.gain) auditionNodes.gain.gain.setValueAtTime(0, now);

    if (!anyStemActive) {
      // Bit-perfect transparent dry bypass
      dryGain.gain.setValueAtTime(1, now);
      for (const id of STEM_IDS) {
        if (stemNodes[id]?.gain) stemNodes[id].gain.gain.setValueAtTime(0, now);
      }
      return;
    }

    // Stem isolation active
    dryGain.gain.setValueAtTime(0, now);
    for (const id of STEM_IDS) {
      const node = stemNodes[id];
      if (!node?.gain) continue;
      let targetGain = 0;
      if (hasSolo) {
        targetGain = state.solo.has(id) ? (state.volumes[id] ?? 1) * 1.5 : 0;
      } else {
        targetGain = state.muted.has(id) ? 0 : (state.volumes[id] ?? 1);
      }
      node.gain.gain.setValueAtTime(targetGain, now);
    }
  }

  function computeRms(analyser) {
    if (!analyser) return 0;
    analyser.getFloatTimeDomainData(buffer);
    let sum = 0;
    for (let i = 0; i < buffer.length; i++) sum += buffer[i] * buffer[i];
    return Math.min(1, Math.sqrt(sum / buffer.length) * 3);
  }

  return {
    ensureContext,
    toggleSolo(stemId, isShiftMulti = false) {
      ensureContext();
      if (state.auditionBand) state.auditionBand = null;
      if (state.solo.has(stemId)) {
        state.solo.delete(stemId);
      } else {
        if (!isShiftMulti) state.solo.clear();
        state.solo.add(stemId);
      }
      applyGains();
      notify();
    },
    toggleMute(stemId) {
      ensureContext();
      if (state.auditionBand) state.auditionBand = null;
      if (state.muted.has(stemId)) state.muted.delete(stemId);
      else state.muted.add(stemId);
      applyGains();
      notify();
    },
    setVolume(stemId, val) {
      state.volumes[stemId] = Math.max(0, Math.min(2, Number(val) || 0));
      applyGains();
      notify();
    },
    resetAll() {
      state.solo.clear();
      state.muted.clear();
      state.auditionBand = null;
      applyGains();
      notify();
    },
    setAuditionBand(lowHz, highHz) {
      ensureContext();
      if (!lowHz && !highHz) {
        state.auditionBand = null;
      } else {
        const lo = Math.max(20, Math.min(20000, Number(lowHz) || 20));
        const hi = Math.max(lo + 10, Math.min(20000, Number(highHz) || 20000));
        state.auditionBand = { lowHz: lo, highHz: hi };
        if (auditionNodes.filter && ctx) {
          const center = Math.sqrt(lo * hi);
          const bandwidth = hi - lo;
          const q = Math.max(0.2, center / bandwidth);
          auditionNodes.filter.frequency.setValueAtTime(center, ctx.currentTime);
          auditionNodes.filter.Q.setValueAtTime(q, ctx.currentTime);
        }
      }
      applyGains();
      notify();
    },
    getStemLevels() {
      if (!ctx) return { drums: 0, bass: 0, vocals: 0, other: 0, master: 0 };
      return {
        drums: computeRms(stemNodes.drums.analyser),
        bass: computeRms(stemNodes.bass.analyser),
        vocals: computeRms(stemNodes.vocals.analyser),
        other: computeRms(stemNodes.other.analyser),
        master: computeRms(masterAnalyser)
      };
    },
    getState() {
      return {
        solo: new Set(state.solo),
        muted: new Set(state.muted),
        volumes: { ...state.volumes },
        auditionBand: state.auditionBand ? { ...state.auditionBand } : null,
        isCleanMix: state.solo.size === 0 && state.muted.size === 0 && !state.auditionBand
      };
    },
    subscribe(callback) {
      subscribers.add(callback);
      return () => subscribers.delete(callback);
    }
  };
}
