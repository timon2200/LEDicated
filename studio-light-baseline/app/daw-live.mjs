/** Live dock: scene pads, palette, audio input (BlackHole etc.), tempo tools.
 * Port of the classic live desk onto the shared engine. Live scenes are the
 * output whenever no analysed song is loaded; the song timeline otherwise wins.
 */
import { LightingEngine, OnsetTempoEstimator, BAR_IDS, SCENES, PALETTES, rgbwToRgb } from './engine.mjs';
import { createDragNumber, createKnob, h, toast } from './daw-ui.mjs';

const DESCRIPTIONS = {
  ambient: 'Topla svjetlost i mirno disanje.', pulse: 'Bas daje naglasak cijeloj prostoriji.', columns: 'Svjetlo prolazi slijeva nadesno.', rows: 'Od stražnjeg prema prednjem dijelu.',
  runner: 'L1 → L2 → L3, zatim srednji i desni stupac.', mirror: 'Vanjski stupci odgovaraju jedan drugome.', wave: 'Jedan val kroz cijelu prostoriju.', build: 'Postupno podizanje energije kroz četiri takta.'
};

export function createLive(host, { now, status }) {
  const engine = new LightingEngine(), estimator = new OnsetTempoEstimator();
  engine.setState({ scene: 'wave', palette: 'midnight', brightness: 1.0, energy: .55, reactive: true, bpm: 120 }, now());
  const s = {
    demo: true, stream: null, context: null, analyser: null, samples: null, spectrum: null, queued: null, pendingBeat: null, autoShow: false, cueAnchor: 0, cueBeats: 32,
    freeze: false, frozenFrame: null, frozenBrightness: .35, freezeBeat: 0, offset: 0, onsetLast: 0, avg: 0, previousLevel: 0, tempoLocked: false, autoTempo: false, level: 0,
    extUntil: 0, extStems: null, extDropActive: false, extPrevScene: null
  };
  const THEME_TO_PALETTE = {
    midnight: 'midnight', club: 'midnight',
    cyber: 'magenta', royal: 'magenta', magenta: 'magenta',
    sunset: 'ember', inferno: 'ember', ember: 'ember',
    ice: 'ice', rave: 'ice',
    mono: 'warm', warm: 'warm'
  };

  /* ------------------------------------------------------------- scenes */
  const pads = new Map();
  const padGrid = h('div', { class: 'pads', role: 'group', 'aria-label': 'Scene' });
  Object.entries(SCENES).forEach(([id, title], index) => {
    const pad = h('button', { type: 'button', class: 'pad', title: `${DESCRIPTIONS[id]} Klik priprema scenu; GO je pokreće na sljedećem beatu.`, onClick: () => { s.queued = id; s.pendingBeat = null; refresh(); } }, h('em', {}, String(index + 1).padStart(2, '0')), h('span', {}, title));
    pads.set(id, pad); padGrid.append(pad);
  });
  const go = h('button', { type: 'button', class: 'go', disabled: true, onClick: () => { if (s.queued) { s.pendingBeat = Math.floor(engine.clock.beats(now())) + 1; status('Promjena scene na sljedećem beatu.'); refresh(); } } }, 'GO');
  const sceneLine = h('div', { class: 'live-line' });
  const cueSelect = h('select', { 'aria-label': 'Automatska promjena scene', onChange: () => { s.cueBeats = Number(cueSelect.value); } }, [[16, '4 takta'], [32, '8 taktova'], [64, '16 taktova']].map(([v, l]) => h('option', { value: v, selected: v === 32 }, l)));
  const autoBtn = h('button', { type: 'button', 'aria-pressed': 'false', title: 'Automatski mijenja scene prema ručnom početku takta', onClick: () => { s.autoShow = !s.autoShow; s.cueAnchor = engine.clock.beats(now()); autoBtn.setAttribute('aria-pressed', String(s.autoShow)); autoBtn.classList.toggle('on', s.autoShow); } }, 'Auto slijed');
  const palette = h('select', { 'aria-label': 'Paleta', onChange: () => { engine.setState({ palette: palette.value }, now()); swatches(); } }, Object.entries(PALETTES).map(([id, p]) => h('option', { value: id, selected: id === 'midnight' }, p.name)));
  const swatchBox = h('div', { class: 'live-swatches', 'aria-hidden': 'true' });
  const speed = h('select', { 'aria-label': 'Kretanje', onChange: () => engine.setState({ speed: Number(speed.value) }, now()) }, [[.5, '½×'], [1, '1×'], [2, '2×'], [4, '4×']].map(([v, l]) => h('option', { value: v, selected: v === 1 }, l)));
  const energy = createKnob({ label: 'Energija', value: .55, min: 0, max: 1, step: .01, onInput: v => engine.setState({ energy: v }, now()) });
  const reactive = h('input', { type: 'checkbox', checked: true, onChange: () => engine.setState({ reactive: reactive.checked }, now()) });
  function swatches() {
    swatchBox.replaceChildren();
    const active = PALETTES[palette.value] || PALETTES[engine.state.palette] || PALETTES.midnight;
    for (const color of active.colors) { const [r, g, b] = rgbwToRgb(color.map(c => c * 255)); swatchBox.append(h('i', { style: { background: `rgb(${r},${g},${b})` } })); }
  }
  function refresh() {
    for (const [id, pad] of pads) { pad.classList.toggle('selected', id === engine.state.scene); pad.classList.toggle('queued', id === s.queued); pad.setAttribute('aria-pressed', String(id === engine.state.scene)); }
    go.disabled = !s.queued; go.classList.toggle('armed', s.pendingBeat !== null);
    sceneLine.textContent = `Aktivno: ${SCENES[engine.state.scene]}${s.queued ? ` · sljedeće: ${SCENES[s.queued]}` : ''}`;
  }
  function commitScene(scene) { engine.setState({ scene }, now()); s.queued = null; s.pendingBeat = null; s.cueAnchor = engine.clock.beats(now()); refresh(); }

  /* -------------------------------------------------------------- audio */
  const device = h('select', { 'aria-label': 'Audio ulaz' }, h('option', { value: '' }, 'Odaberi audio ulaz'));
  const audioStatus = h('small', { class: 'live-status' }, 'Demo ritam · nema audio snimanja');
  const meter = h('div', { class: 'live-meter' }, h('i'));
  const connect = h('button', { type: 'button', onClick: toggleAudio }, 'Spoji audio');
  const demoBtn = h('button', { type: 'button', class: 'on', 'aria-pressed': 'true', onClick: async () => { s.demo = !s.demo; if (s.demo) { await stopAudio(); audioStatus.textContent = 'Demo ritam · nema audio snimanja'; } else audioStatus.textContent = 'Nema audio ulaza · ručni tempo'; demoBtn.setAttribute('aria-pressed', String(s.demo)); demoBtn.classList.toggle('on', s.demo); } }, 'Demo');
  async function devices() {
    const list = await navigator.mediaDevices.enumerateDevices(), selected = device.value;
    device.replaceChildren(h('option', { value: '' }, 'Odaberi audio ulaz'), ...list.filter(d => d.kind === 'audioinput').map((d, i) => h('option', { value: d.deviceId }, d.label || `Audio ulaz ${i + 1}`)));
    device.value = selected;
  }
  async function stopAudio() {
    s.stream?.getTracks().forEach(t => t.stop()); s.stream = null; s.analyser = null;
    if (s.context) { await s.context.close(); s.context = null; }
    engine.setState({ audioLevel: 0 }, now());
  }
  async function toggleAudio() {
    if (s.stream) { await stopAudio(); connect.textContent = 'Spoji audio'; audioStatus.textContent = 'Audio zaustavljen'; return; }
    try {
      const id = device.value;
      s.stream = await navigator.mediaDevices.getUserMedia({ audio: { ...(id ? { deviceId: { exact: id } } : {}), echoCancellation: false, noiseSuppression: false, autoGainControl: false }, video: false });
      s.context = new AudioContext(); await s.context.resume();
      s.analyser = s.context.createAnalyser(); s.analyser.fftSize = 2048; s.analyser.smoothingTimeConstant = .45;
      s.context.createMediaStreamSource(s.stream).connect(s.analyser);
      s.samples = new Float32Array(s.analyser.fftSize); s.spectrum = new Uint8Array(s.analyser.frequencyBinCount);
      s.demo = false; s.tempoLocked = false; estimator.onsets = []; estimator.bpm = null; estimator.confidence = 0;
      demoBtn.setAttribute('aria-pressed', 'false'); demoBtn.classList.remove('on'); connect.textContent = 'Zaustavi audio';
      await devices(); const track = s.stream.getAudioTracks()[0]; device.value = track.getSettings().deviceId || id; audioStatus.textContent = `Ulaz: ${track.label}`;
      track.onended = () => { stopAudio(); connect.textContent = 'Spoji audio'; audioStatus.textContent = 'Audio veza prekinuta · ručni tempo'; };
    } catch (error) { await stopAudio(); toast(`Audio nije spojen: ${error.message}`, 'error'); }
  }

  /* -------------------------------------------------------------- tempo */
  const bpm = createDragNumber({ label: 'BPM', value: 120, min: 40, max: 240, step: .5, decimals: 1, onChange: v => { setBpm(v); autoTempo.checked = false; s.autoTempo = false; } });
  function setBpm(value) { value = Math.min(240, Math.max(40, Number(value) || 120)); engine.setState({ bpm: value }, now()); bpm.set(Math.round(value * 10) / 10); }
  const autoTempo = h('input', { type: 'checkbox', onChange: () => { s.autoTempo = autoTempo.checked; s.tempoLocked = false; } });
  const tempoStatus = h('small', { class: 'live-status' }, 'Ručno · TAP barem četiri puta');
  const manual = fn => () => { autoTempo.checked = false; s.autoTempo = false; s.tempoLocked = false; fn(); };
  const tap = h('button', { type: 'button', onClick: manual(() => { const result = engine.clock.tap(now()); setBpm(typeof result === 'number' ? result : result?.bpm || engine.clock.bpm); }) }, 'TAP');
  const offsetInput = h('input', { type: 'number', min: -1000, max: 1000, step: 10, value: 0, 'aria-label': 'Pomak ritma u ms', onChange: () => { s.offset = Math.max(-1000, Math.min(1000, Number(offsetInput.value) || 0)) / 1000; } });
  const freezeBtn = h('button', { type: 'button', 'aria-pressed': 'false', onClick: () => toggleFreeze() }, 'Zamrzni');
  function toggleFreeze() {
    s.freeze = !s.freeze;
    if (s.freeze) { s.frozenFrame = engine.frame(now() + s.offset); s.frozenBrightness = engine.state.brightness; s.freezeBeat = engine.clock.beats(now()); }
    else engine.clock.nudge(s.freezeBeat - engine.clock.beats(now()));
    freezeBtn.setAttribute('aria-pressed', String(s.freeze)); freezeBtn.classList.toggle('on', s.freeze); freezeBtn.textContent = s.freeze ? 'Nastavi' : 'Zamrzni';
  }

  host.append(
    h('div', { class: 'live-col' }, h('div', { class: 'dock-title' }, 'SCENE · PERFORMANCE'), padGrid, h('div', { class: 'live-go' }, go, sceneLine), h('div', { class: 'live-row' }, autoBtn, cueSelect)),
    h('div', { class: 'live-col' }, h('div', { class: 'dock-title' }, 'IZGLED'), h('label', {}, 'Paleta', palette), swatchBox, h('label', {}, 'Kretanje', speed), h('div', { class: 'live-row' }, energy.element, h('label', { class: 'check' }, reactive, ' Naglasak iz glazbe')), freezeBtn),
    h('div', { class: 'live-col' }, h('div', { class: 'dock-title' }, 'AUDIO ULAZ'), device, h('div', { class: 'live-row' }, connect, demoBtn), meter, audioStatus,
      h('small', { class: 'live-hint' }, 'Za YouTube/Spotify koristi BlackHole kao ulaz. Audio se obrađuje u pregledniku i ne napušta računalo.')),
    h('div', { class: 'live-col' }, h('div', { class: 'dock-title' }, 'TEMPO'), h('div', { class: 'live-row' }, bpm.element, tap),
      h('label', { class: 'check' }, autoTempo, ' Auto tempo (procjena)'),
      h('div', { class: 'live-row' }, h('button', { type: 'button', onClick: manual(() => setBpm(engine.clock.bpm / 2)) }, '½'), h('button', { type: 'button', onClick: manual(() => setBpm(engine.clock.bpm * 2)) }, '2×'),
        h('button', { type: 'button', onClick: () => engine.clock.nudge(-.125) }, '−⅛'), h('button', { type: 'button', onClick: () => engine.clock.nudge(.125) }, '+⅛'),
        h('button', { type: 'button', title: 'Trenutni trenutak postaje početak takta', onClick: () => { engine.clock.nudge(-engine.clock.beats(now())); s.cueAnchor = 0; status('Početak takta postavljen ručno.'); } }, 'Prvi beat')),
      h('label', {}, 'Pomak ritma (ms)', offsetInput), tempoStatus));
  swatches(); refresh(); devices().catch(() => {});

  /* ------------------------------------------------------------- runtime */
  function sample(t) {
    let level = 0, bass = 0;
    if (t < s.extUntil && s.extStems) {
      const st = s.extStems;
      bass = Math.min(1, Math.max(0, Number(st.bass) || 0));
      const drums = Math.min(1, Math.max(0, Number(st.drums) || 0));
      const vocals = Math.min(1, Math.max(0, Number(st.vocals) || 0));
      const rms = Math.min(1, Math.max(0, Number(st.rms) || (bass * 0.45 + drums * 0.35 + vocals * 0.2)));
      level = Math.min(1, Math.max(rms, bass * 0.85, drums * 0.9));
      if (st.isBeat && t - s.onsetLast > .18) {
        s.onsetLast = t;
        estimator.addOnset(t, level);
      }
      if (st.isDrop && !s.extDropActive) {
        s.extDropActive = true;
        s.extPrevScene = engine.state.scene;
        engine.setState({ scene: 'pulse', energy: 0.95, speed: 2 }, t);
        refresh();
      } else if (!st.isDrop && s.extDropActive) {
        s.extDropActive = false;
        engine.setState({ scene: s.extPrevScene || 'wave', energy: 0.65, speed: 1 }, t);
        refresh();
      }
      audioStatus.textContent = `YouTube Live Stream · 4 stema${st.isDrop ? ' · DROP!' : ''}`;
    } else if (s.analyser) {
      s.analyser.getFloatTimeDomainData(s.samples);
      level = Math.min(1, Math.sqrt(s.samples.reduce((sum, x) => sum + x * x, 0) / s.samples.length) * 5);
      s.analyser.getByteFrequencyData(s.spectrum);
      const lo = Math.floor(40 / s.context.sampleRate * s.analyser.fftSize), hi = Math.max(lo + 1, Math.floor(180 / s.context.sampleRate * s.analyser.fftSize));
      for (let i = lo; i <= hi; i++) bass += s.spectrum[i] / 255; bass /= hi - lo + 1;
      s.avg = s.avg * .97 + level * .03;
      if (level > Math.max(.08, s.avg * 1.35) && level > s.previousLevel * 1.15 && t - s.onsetLast > .22) { s.onsetLast = t; estimator.addOnset(t, level); }
      s.previousLevel = level;
    } else if (s.demo) { const phase = ((engine.clock.beats(t) % 1) + 1) % 1; level = Math.exp(-phase * 7); bass = level; }
    s.level = level; engine.setState({ audioLevel: bass }, t);
    meter.firstChild.style.width = `${level * 100}%`;
    if (s.autoTempo) {
      const estimate = estimator.get(t);
      if (!s.demo && estimate.status === 'tracking' && estimate.confidence >= .65) {
        setBpm(estimate.bpm);
        if (!s.tempoLocked) { const at = engine.clock.beats(s.onsetLast); engine.clock.nudge(Math.round(at) - at); s.tempoLocked = true; }
      }
      tempoStatus.textContent = s.demo ? 'Demo · ručni tempo' : `${({ waiting: 'Čekam signal', listening: 'Slušam', hold: 'HOLD', tracking: 'Pratim ritam', uncertain: 'Nesigurno' })[estimate.status]} · sigurnost ${Math.round(estimate.confidence * 100)}%`;
    } else tempoStatus.textContent = 'Ručno · TAP barem četiri puta';
  }
  function tick(t) {
    sample(t);
    const beat = engine.clock.beats(t);
    if (!s.freeze && s.pendingBeat !== null && beat >= s.pendingBeat) commitScene(s.queued);
    if (!s.freeze && s.autoShow && beat - s.cueAnchor >= s.cueBeats) { const keys = Object.keys(SCENES); commitScene(keys[(keys.indexOf(engine.state.scene) + 1) % keys.length]); }
    return beat;
  }
  function frame(t) {
    if (engine.state.blackout) return engine.frame(t);
    if (!s.freeze) return engine.frame(t + s.offset);
    const gain = s.frozenBrightness > 0 ? engine.state.brightness / s.frozenBrightness : 0, ceiling = Math.round(engine.state.brightness * 255);
    return { ...s.frozenFrame, bars: Object.fromEntries(BAR_IDS.map(id => [id, s.frozenFrame.bars[id].map(p => p.map(c => Math.min(ceiling, Math.round(c * gain))))])) };
  }

  return {
    engine, tick, frame, refresh, toggleFreeze,
    get frozen() { return s.freeze; }, get level() { return s.level; },
    isExternalActive(t = now()) { return t < s.extUntil; },
    clearExternal() {
      s.extUntil = 0;
      s.extStems = null;
      if (s.extDropActive) {
        s.extDropActive = false;
        engine.setState({ scene: s.extPrevScene || 'wave', energy: 0.65, speed: 1 }, now());
        refresh();
      }
    },
    setPalette(themeId) {
      const candidate = THEME_TO_PALETTE[themeId] || themeId;
      const mapped = Object.hasOwn(PALETTES, candidate) ? candidate : 'midnight';
      if (palette.value === mapped && engine.state.palette === mapped) return;
      palette.value = mapped;
      engine.setState({ palette: mapped }, now());
      swatches();
    },
    pushExternalStems(stems, themeId, t = now()) {
      s.extStems = stems || {};
      s.extUntil = t + 1.8;
      s.autoTempo = true;
      autoTempo.checked = true;
      if (themeId) this.setPalette(themeId);
    },
    tap: () => tap.click(),
    setBrightness(value) { engine.setState({ brightness: value / 100 }, now()); },
    setBlackout(active) { engine.setState({ blackout: active }, now()); },
    stopAudio
  };
}
