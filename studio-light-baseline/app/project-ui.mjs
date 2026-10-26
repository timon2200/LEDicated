import { BAR_IDS } from './engine.mjs';
import { createAutoShow, renderTimelineFrame, snapTimeToBeat, TIMELINE_PRESETS, TIMELINE_BLENDS, validateTimeline } from './timeline.mjs';
import { zoomAround, panByPixels } from './timeline-viewport.mjs';

const $ = id => document.getElementById(id);
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const fmt = seconds => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}.${String(Math.floor(seconds % 1 * 10))}`;
const api = async (path, value) => {
  const response = await fetch(`/api/library/${path}`, value === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Radnja nije uspjela.');
  return result;
};

export function initProjectUI() {
  const section = document.createElement('section');
  section.className = 'project-workbench';
  section.innerHTML = `<div class="workspace-heading"><div><span class="eyebrow">SHOW EDITOR / LOKALNO</span><h1>Stvori show za svoju glazbu.</h1><p>Od pjesme do svjetla u jednom radnom prostoru.</p></div><div class="workspace-heading-actions"><span class="workspace-save-state">● Sprema se lokalno</span><button id="workspace-help" type="button">Prečaci i geste</button></div></div>
  <div class="project-layout"><div class="project-library"><div class="pane-heading"><span>BIBLIOTEKA</span><span>≤ 100 PJESAMA</span></div><label id="drop-zone" class="drop-zone"><input id="audio-file" type="file" accept=".mp3,.wav,audio/mpeg,audio/wav" multiple><span class="drop-icon">＋</span><strong>Dodaj glazbu</strong><small>Povuci MP3/WAV ili klikni</small></label><div id="project-status" role="status">Odaberi pjesmu za početak.</div><div id="track-list" class="track-list"></div><div class="set-create"><input id="set-name" placeholder="Naziv seta" aria-label="Naziv seta"><button id="set-save">Spremi set</button></div><select id="set-select" aria-label="Spremljeni set"><option value="">Sve pjesme</option></select><div class="set-actions"><button id="set-update">Ažuriraj set</button><button id="set-delete">Ukloni set</button></div></div>
  <div class="project-editor"><div class="project-transport"><strong id="project-title">Nema odabrane pjesme</strong><button id="project-play" disabled>▶ Reproduciraj</button><label>Vrijeme <input id="project-time" type="number" min="0" step="0.01" value="0"></label><span id="project-time-label">0:00.0</span></div>
  <div class="timeline-panel"><div class="pane-heading"><span>ARRANGEMENT · CIJELA ŠIRINA</span><span id="timeline-range">CIJELA PJESMA</span></div><div class="project-controls timeline-tools"><label><input id="beat-snap" type="checkbox" checked> Snap</label><label>Podjela <select id="snap-division"><option value="1">Beat</option><option value="2">½</option><option value="4">¼</option><option value="8">⅛</option></select></label><div class="zoom-control"><span>ZOOM</span><button id="zoom-out" type="button" aria-label="Umanji timeline">−</button><input id="timeline-zoom" type="range" min="1" max="32" step="0.01" value="1" aria-label="Zoom timelinea"><button id="zoom-in" type="button" aria-label="Povećaj timeline">+</button><output id="zoom-value" for="timeline-zoom">1×</output></div><button id="zoom-fit" type="button" title="Prikaži cijelu pjesmu">Fit</button><label class="pan-control">Pomak <input id="timeline-pan" type="range" min="0" max="0" step="0.01" value="0"></label></div><canvas id="song-timeline" height="220" tabindex="0" aria-label="Waveform i slojevi showa"></canvas><div class="timeline-hint">Dva prsta lijevo/desno: pomak · pinch: zoom oko pokazivača · povuci po waveformu: playhead · povuci clip: premjesti · ⌥ + povuci: pomak</div></div>
  <div class="project-controls show-tools"><label>Energija <input id="auto-energy" type="range" min="0" max="100" value="80"></label><label>Paleta <select id="auto-palette"><option value="club">Klub</option><option value="ember">Žar</option><option value="ice">Led</option></select></label><button id="generate-show" class="primary-action">Generiraj auto show</button><button id="add-layer">+ Sloj</button><button id="add-clip">+ Clip</button></div>
  <div class="project-controls calibration-tools"><label>Bluetooth pomak (ms; − kasnije svjetlo) <input id="project-offset" type="number" min="-2000" max="2000" step="10" value="0"></label><button id="calibrate">Kalibracijski klik + bljesak</button></div>
  <div class="editor-columns"><div><h3>Slojevi</h3><div id="layer-list"></div></div><div><h3>Clip i keyframeovi</h3><div id="clip-inspector">Odaberi clip na timelineu.</div></div></div></div></div>`;
  const main = document.querySelector('main');
  main.before(section);
  const liveDesk = document.createElement('details');
  liveDesk.className = 'live-desk';
  liveDesk.innerHTML = '<summary><span>LIVE DESK</span><strong>Scene, audio ulaz i ručni tempo</strong><small>Otvori za upravljanje uživo</small></summary>';
  section.after(liveDesk);
  liveDesk.append(main);
  const preview = document.createElement('div');
  preview.className = 'preview-panel';
  preview.innerHTML = '<div class="pane-heading"><span>STAGE PREVIEW</span><span>3 × 3 · FINALNI RGBW FRAME</span></div>';
  section.querySelector('.project-editor').prepend(preview);
  preview.append(main.querySelector('.stage-section'));
  const [layersPanel, inspectorPanel] = section.querySelector('.editor-columns').children;
  layersPanel.classList.add('layers-panel');
  inspectorPanel.classList.add('inspector-panel');
  section.querySelector('.project-library').append(layersPanel);
  section.querySelector('.project-layout').append(inspectorPanel);
  section.querySelector('.editor-columns').remove();
  const header = document.querySelector('header');
  header.insertBefore(section.querySelector('.project-transport'), header.querySelector('.top-actions'));
  header.querySelector('.top-actions').append(section.querySelector('#workspace-help'));
  section.querySelector('.workspace-heading').remove();
  inspectorPanel.insertBefore(section.querySelector('.show-tools'), inspectorPanel.querySelector('#clip-inspector'));
  inspectorPanel.append(section.querySelector('.calibration-tools'));
  section.append(section.querySelector('.timeline-panel'));
  const help = document.createElement('dialog');
  help.id = 'gesture-help';
  help.innerHTML = `<div class="pane-heading"><span>PREČACI I GESTE</span><button id="close-help" type="button">Zatvori</button></div><h2>Brže kroz pjesmu.</h2><dl><dt>Dva prsta lijevo/desno</dt><dd>Pomak timelinea</dd><dt>Pinch na timelineu</dt><dd>Zoom oko pokazivača</dd><dt>⌥ + povuci</dt><dd>Pomak timelinea</dd><dt>Space</dt><dd>Reproduciraj / pauziraj</dd><dt>← / →</dt><dd>Korak od jednog kadra (1/30 s)</dd><dt>Shift + ← / →</dt><dd>Korak od jedne sekunde</dd><dt>Esc</dt><dd>Blackout</dd></dl>`;
  document.body.append(help);
  $('workspace-help').onclick = () => help.showModal();
  $('close-help').onclick = () => help.close();

  const audio = new Audio();
  audio.preload = 'auto';
  let tracks = [], sets = [], track = null, analysis = null, timeline = null, selectedLayer = 0, selectedClip = 0, setSelection = [];
  let scrubSec = 0, offsetSec = 0, dragging = null, frozenSec = null, calibrateFrom = 0, calibrateUntil = 0, viewportStart = 0, selectionToken = 0;
  const pendingSaves = new Map();
  const status = message => { $('project-status').textContent = message; };
  const duration = () => analysis?.durationSec || timeline?.durationSec || audio.duration || 1;
  const songTime = () => audio.paused ? scrubSec : audio.currentTime;
  const beatSnap = seconds => $('beat-snap').checked && timeline ? snapTimeToBeat(clamp(seconds, 0, duration()), timeline.bpm, timeline.beatOffsetSec, Number($('snap-division').value), analysis?.beatsSec) : clamp(seconds, 0, duration());
  const currentClip = () => timeline?.layers[selectedLayer]?.clips[selectedClip];
  const displayTime = () => { $('project-time').value = songTime().toFixed(2); $('project-time-label').textContent = fmt(songTime()); };
  const persist = async (id, snapshot) => {
    const checked = validateTimeline(snapshot);
    if (!checked.valid) return status(`Clip nije valjan: ${checked.errors[0]}`);
    try { await api('timeline', { id, timeline: snapshot }); if (track?.id === id) status('Projekt spremljen lokalno.'); }
    catch (error) { status(error.message); }
  };
  const flushSave = async id => {
    const pending = pendingSaves.get(id); if (!pending) return;
    clearTimeout(pending.timer); pendingSaves.delete(id);
    await persist(id, pending.snapshot);
  };
  const save = () => {
    if (!track || !timeline) return;
    const id = track.id, snapshot = structuredClone(timeline);
    clearTimeout(pendingSaves.get(id)?.timer);
    const timer = setTimeout(() => flushSave(id), 300);
    pendingSaves.set(id, { timer, snapshot });
  };
  const showTracks = () => {
    $('track-list').replaceChildren();
    const selectedSet = $('set-select').value;
    for (const item of tracks) {
      const row = document.createElement('div'); row.className = 'track-row';
      const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = setSelection.includes(item.id); checkbox.title = 'Uključi u set'; checkbox.onchange = () => { setSelection = checkbox.checked ? [...setSelection, item.id] : setSelection.filter(id => id !== item.id); };
      const button = document.createElement('button');
      button.textContent = item.title || item.originalName || item.id;
      button.className = item.id === track?.id ? 'active' : '';
      button.onclick = () => selectTrack(item.id).catch(error => status(error.message));
      row.append(checkbox, button); $('track-list').append(row);
    }
    $('set-select').replaceChildren(new Option('Sve pjesme', ''), ...sets.map(item => new Option(item.name, item.id)));
    $('set-select').value = selectedSet;
  };
  const refresh = async () => { const result = await api('tracks'); tracks = result.tracks; sets = result.sets; showTracks(); };
  async function selectTrack(id) {
    const token = ++selectionToken;
    if (track) await flushSave(track.id);
    audio.pause();
    const result = await api(`track/${id}`);
    if (token !== selectionToken) return;
    track = result.track; analysis = result.analysis; timeline = result.timeline;
    if (analysis && !timeline) { timeline = createAutoShow(analysis); await api('timeline', { id, timeline }); }
    audio.src = `/api/library/audio/${id}`;
    audio.load(); scrubSec = analysis ? Math.min(1, analysis.durationSec / 2) : 0; viewportStart = 0; selectedLayer = 0; selectedClip = 0;
    audio.onloadedmetadata = () => { if (audio.paused) audio.currentTime = scrubSec; };
    $('project-title').textContent = track.title || track.originalName || 'Pjesma'; $('project-play').disabled = false;
    $('project-play').textContent = '▶ Reproduciraj';
    showTracks(); renderLayers(); renderInspector(); drawTimeline(); displayTime();
    status(analysis ? `Analizirano · ${Math.round(analysis.bpm || 0)} BPM · bubnjevi i bas su frekvencijske procjene.` : 'Pjesma čeka lokalnu analizu.');
    if (!analysis) await analyzeSelected();
  }
  async function analyzeSelected() {
    if (!track) return;
    status('Lokalna analiza traje. Nema slanja u cloud.');
    const id = track.id;
    try {
      const result = await api('analyze', { id });
      if (track?.id !== id) return;
      analysis = result.analysis; timeline = createAutoShow(analysis); await api('timeline', { id, timeline });
      renderLayers(); renderInspector(); drawTimeline();
      status(`Analiza gotova · ${Math.round(analysis.bpm)} BPM. Show je editabilan.`);
    } catch (error) { status(`Analiza nije uspjela: ${error.message}`); }
  }
  async function importFiles(files) {
    for (const file of files) {
      if (!/\.(mp3|wav)$/i.test(file.name)) { status('Podržani su MP3 i WAV.'); continue; }
      status(`Uvoz: ${file.name}`);
      try {
        const response = await fetch(`/api/library/import?name=${encodeURIComponent(file.name)}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file });
        const result = await response.json(); if (!response.ok) throw new Error(result.error);
        await refresh(); await selectTrack(result.track.id);
      } catch (error) { status(`Uvoz nije uspio: ${error.message}`); }
    }
  }
  $('audio-file').onchange = event => importFiles([...event.target.files]);
  for (const event of ['dragenter', 'dragover']) $('drop-zone').addEventListener(event, e => { e.preventDefault(); $('drop-zone').classList.add('dragging'); });
  $('drop-zone').addEventListener('dragleave', () => $('drop-zone').classList.remove('dragging'));
  $('drop-zone').addEventListener('drop', e => { e.preventDefault(); $('drop-zone').classList.remove('dragging'); importFiles([...e.dataTransfer.files]); });
  $('set-save').onclick = async () => { const name = $('set-name').value.trim(); if (!name) return status('Upiši naziv seta.'); if (!setSelection.length) return status('Označi pjesme kvačicama za novi set.'); try { await api('set', { name, trackIds: setSelection }); await refresh(); status('Set spremljen.'); } catch (error) { status(error.message); } };
  $('set-select').onchange = () => { const set = sets.find(item => item.id === $('set-select').value); setSelection = set ? [...set.trackIds] : []; $('set-name').value = set?.name || ''; showTracks(); };
  $('set-update').onclick = async () => { const id = $('set-select').value; if (!id) return status('Odaberi set za ažuriranje.'); try { await api('set-update', { id, patch: { name: $('set-name').value.trim(), trackIds: setSelection } }); await refresh(); status('Set ažuriran.'); } catch (error) { status(error.message); } };
  $('set-delete').onclick = async () => { const id = $('set-select').value; if (!id) return status('Odaberi set za uklanjanje.'); try { await api('set-delete', { id }); $('set-select').value = ''; setSelection = []; await refresh(); status('Set uklonjen.'); } catch (error) { status(error.message); } };
  $('project-play').onclick = async () => { if (!track) return; if (audio.paused) { audio.currentTime = scrubSec; await audio.play(); $('project-play').textContent = 'Ⅱ Pauza'; } else { audio.pause(); scrubSec = audio.currentTime; $('project-play').textContent = '▶ Reproduciraj'; } };
  audio.onended = () => { scrubSec = 0; $('project-play').textContent = '▶ Reproduciraj'; };
  audio.ontimeupdate = () => { displayTime(); drawTimeline(); };
  $('project-time').onchange = () => seek(Number($('project-time').value));
  function seek(time) { scrubSec = clamp(time || 0, 0, duration()); audio.currentTime = scrubSec; const visible = duration() / Number($('timeline-zoom').value); if (scrubSec < viewportStart || scrubSec > viewportStart + visible) viewportStart = clamp(scrubSec - visible / 2, 0, Math.max(0, duration() - visible)); displayTime(); drawTimeline(); }
  $('project-offset').onchange = () => { offsetSec = clamp(Number($('project-offset').value) || 0, -2000, 2000) / 1000; localStorage.setItem('ledicated-bluetooth-offset-ms', String(Math.round(offsetSec * 1000))); };
  $('project-offset').value = localStorage.getItem('ledicated-bluetooth-offset-ms') || '0'; $('project-offset').onchange();
  $('calibrate').onclick = async () => {
    const audioContext = new AudioContext();
    const oscillator = audioContext.createOscillator(), gain = audioContext.createGain();
    const clickAt = audioContext.currentTime + 2.1;
    oscillator.frequency.value = 880; gain.gain.setValueAtTime(.18, clickAt); gain.gain.exponentialRampToValueAtTime(.001, clickAt + .08);
    oscillator.connect(gain).connect(audioContext.destination); oscillator.start(clickAt); oscillator.stop(clickAt + .08);
    oscillator.onended = () => audioContext.close();
    calibrateFrom = performance.now() + 2100 - offsetSec * 1000; calibrateUntil = calibrateFrom + 120;
    status('Klik i bljesak stižu za oko 2 s. Negativan pomak odgađa svjetlo; usporedi ih na zvučniku i traci.');
  };
  $('generate-show').onclick = () => { if (!analysis) return status('Najprije analiziraj pjesmu.'); timeline = createAutoShow(analysis, { energy: Number($('auto-energy').value) / 100, palette: $('auto-palette').value }); selectedLayer = selectedClip = 0; renderLayers(); renderInspector(); drawTimeline(); save(); };
  $('add-layer').onclick = () => { if (!timeline) return; timeline.layers.push({ id: `layer-${Date.now()}`, enabled: true, blend: 'screen', opacity: .7, clips: [] }); selectedLayer = timeline.layers.length - 1; selectedClip = 0; renderLayers(); renderInspector(); drawTimeline(); save(); };
  $('add-clip').onclick = () => { if (!timeline) return; const layer = timeline.layers[selectedLayer]; if (!layer) return; const startSec = beatSnap(songTime()), durationSec = Math.min(4 * 60 / timeline.bpm, Math.max(.1, duration() - startSec)); layer.clips.push({ id: `clip-${Date.now()}`, startSec, durationSec, preset: 'pulse', targets: 'all', color: [.6, .05, .8, 0], driver: 'none', driverGain: 1, keyframes: [{ timeSec: 0, value: 1 }, { timeSec: durationSec, value: 1 }] }); selectedClip = layer.clips.length - 1; renderLayers(); renderInspector(); drawTimeline(); save(); };
  function renderLayers() {
    $('layer-list').replaceChildren();
    if (!timeline) return;
    timeline.layers.forEach((layer, index) => {
      const row = document.createElement('div'); row.className = 'layer-row';
      const choose = document.createElement('button'); choose.textContent = `${layer.id} (${layer.clips.length})`; choose.className = selectedLayer === index ? 'active' : ''; choose.onclick = () => { selectedLayer = index; selectedClip = 0; renderLayers(); renderInspector(); drawTimeline(); };
      const enabled = document.createElement('input'); enabled.type = 'checkbox'; enabled.checked = layer.enabled; enabled.title = 'Sloj uključen'; enabled.onchange = () => { layer.enabled = enabled.checked; save(); };
      const blend = document.createElement('select'); for (const value of TIMELINE_BLENDS) blend.add(new Option(value, value)); blend.value = layer.blend; blend.title = 'Kako se boje ovog sloja spajaju sa slojevima ispod njega'; blend.onchange = () => { layer.blend = blend.value; save(); };
      const opacity = document.createElement('input'); opacity.type = 'range'; opacity.min = 0; opacity.max = 100; opacity.value = Math.round(layer.opacity * 100); opacity.title = 'Prozirnost sloja'; opacity.oninput = () => { layer.opacity = Number(opacity.value) / 100; save(); };
      row.append(choose, enabled, blend, opacity); $('layer-list').append(row);
    });
  }
  function renderInspector() {
    const host = $('clip-inspector'); host.replaceChildren(); const clip = currentClip(); if (!clip) { host.textContent = 'Odaberi clip ili dodaj novi.'; return; }
    const fieldTips = { 'Početak (s)': 'Vrijeme početka clipa u pjesmi. Snap ga može poravnati na beat.', 'Trajanje (s)': 'Koliko dugo clip traje nakon svojeg početka.', Efekt: 'Odaberi način kretanja i ritam svjetla unutar clipa.', 'Audio driver': 'Bubnjevi ili bas mogu pojačavati efekt prema lokalnoj analizi pjesme.', 'Jačina drivera': 'Množitelj utjecaja odabranog audio drivera.', Bar: 'Odredi barove na koje se clip primjenjuje.', Boja: 'RGB boja clipa; bijeli emiter uređuje se zasebno.', 'Bijeli kanal': 'Neovisna jačina toplog W emitera u RGBW kadru.' };
    const field = (label, node) => { const wrap = document.createElement('label'); wrap.textContent = label; node.title = fieldTips[label] || label; wrap.append(node); host.append(wrap); return node; };
    const numeric = (label, value, min, max, step, change) => { const input = document.createElement('input'); input.type = 'number'; input.min = min; input.max = max; input.step = step; input.value = value; input.onchange = () => change(Number(input.value)); return field(label, input); };
    const select = (label, values, value, change) => { const input = document.createElement('select'); values.forEach(v => input.add(new Option(v, v))); input.value = value; input.onchange = () => change(input.value); return field(label, input); };
    const commit = () => { drawTimeline(); save(); };
    numeric('Početak (s)', clip.startSec.toFixed(2), 0, duration(), .01, value => { clip.startSec = beatSnap(value); commit(); });
    numeric('Trajanje (s)', clip.durationSec.toFixed(2), .1, duration(), .01, value => { clip.durationSec = clamp(value, .1, duration()); clip.keyframes = clip.keyframes.filter(k => k.timeSec <= clip.durationSec); if (!clip.keyframes.length) clip.keyframes = [{ timeSec: 0, value: 1 }]; commit(); renderInspector(); });
    select('Efekt', TIMELINE_PRESETS, clip.preset, value => { clip.preset = value; commit(); });
    select('Audio driver', ['none', 'drums', 'bass'], clip.driver, value => { clip.driver = value; commit(); });
    numeric('Jačina drivera', clip.driverGain, 0, 2, .1, value => { clip.driverGain = clamp(value, 0, 2); commit(); });
    select('Bar', ['all', ...BAR_IDS], clip.targets === 'all' ? 'all' : clip.targets[0], value => { clip.targets = value === 'all' ? 'all' : [value]; commit(); });
    const color = document.createElement('input'); color.type = 'color'; color.value = '#' + clip.color.slice(0, 3).map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join(''); color.oninput = () => { clip.color = [0, 2, 4].map(i => parseInt(color.value.slice(i + 1, i + 3), 16) / 255).concat(clip.color[3]); commit(); }; field('Boja', color);
    numeric('Bijeli kanal', clip.color[3], 0, 1, .05, value => { clip.color[3] = clamp(value, 0, 1); commit(); });
    const keys = document.createElement('div'); keys.className = 'keyframe-list'; host.append(keys);
    clip.keyframes.forEach((key, index) => { const row = document.createElement('div'); row.textContent = `K${index + 1} `; const t = document.createElement('input'); t.type = 'number'; t.step = '.01'; t.min = 0; t.max = clip.durationSec; t.value = key.timeSec; t.title = 'Vrijeme keyframea'; t.onchange = () => { key.timeSec = clamp(Number(t.value), 0, clip.durationSec); clip.keyframes.sort((a, b) => a.timeSec - b.timeSec); renderInspector(); commit(); }; const v = document.createElement('input'); v.type = 'range'; v.min = 0; v.max = 100; v.value = Math.round(key.value * 100); v.title = 'Vrijednost keyframea'; v.oninput = () => { key.value = Number(v.value) / 100; commit(); }; const remove = document.createElement('button'); remove.textContent = '×'; remove.title = 'Ukloni keyframe'; remove.onclick = () => { if (clip.keyframes.length <= 1) return; clip.keyframes.splice(index, 1); renderInspector(); commit(); }; row.append(t, v, remove); keys.append(row); });
    const add = document.createElement('button'); add.textContent = '+ Keyframe'; add.onclick = () => { const times = clip.keyframes.map(k => k.timeSec).sort((a, b) => a - b); let candidate = clip.durationSec / 2; if (times.some(t => Math.abs(t - candidate) < .001)) candidate = (times[0] + times.at(-1)) / 2; if (times.some(t => Math.abs(t - candidate) < .001)) return status('Nema mjesta za dodatni keyframe.'); clip.keyframes.push({ timeSec: candidate, value: .5 }); clip.keyframes.sort((a, b) => a.timeSec - b.timeSec); renderInspector(); commit(); }; host.append(add);
    const remove = document.createElement('button'); remove.textContent = 'Ukloni clip'; remove.onclick = () => { timeline.layers[selectedLayer].clips.splice(selectedClip, 1); selectedClip = 0; renderLayers(); renderInspector(); drawTimeline(); save(); }; host.append(remove);
  }
  const canvas = $('song-timeline');
  function drawTimeline() {
    const width = canvas.clientWidth || 600, height = Math.max(190, 94 + (timeline?.layers.length || 0) * 24), dpr = devicePixelRatio || 1;
    if (canvas.style.height !== `${height}px`) canvas.style.height = `${height}px`;
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) { canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr); }
    const ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.fillStyle = '#0b121b'; ctx.fillRect(0, 0, width, height);
    if (!analysis) { ctx.fillStyle = '#9da9bd'; ctx.fillText('Waveform će se prikazati nakon analize.', 20, 30); return; }
    const zoom = Number($('timeline-zoom').value), visible = duration() / zoom, start = clamp(viewportStart, 0, Math.max(0, duration() - visible)); viewportStart = start; canvas.dataset.zoom = String(zoom); $('zoom-value').textContent = `${zoom < 10 ? zoom.toFixed(1) : zoom.toFixed(0)}×`; $('timeline-pan').max = String(Math.max(0, duration() - visible)); $('timeline-pan').value = String(start);
    const xAt = t => (t - start) / visible * width; const tAt = x => start + x / width * visible; canvas.dataset.start = start; canvas.dataset.visible = visible;
    $('timeline-range').textContent = `${fmt(start)} — ${fmt(Math.min(duration(), start + visible))}`;
    ctx.fillStyle = '#15212c'; ctx.fillRect(0, 0, width, 15);
    const tickStep = visible > 180 ? 30 : visible > 60 ? 10 : visible > 15 ? 5 : 1;
    ctx.font = '9px ui-monospace, SFMono-Regular, monospace';
    for (let t = Math.ceil(start / tickStep) * tickStep; t <= start + visible; t += tickStep) { const x = xAt(t); ctx.strokeStyle = '#3b5062'; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 15); ctx.stroke(); ctx.fillStyle = '#a6b9c9'; ctx.fillText(fmt(t), x + 3, 10); }
    const peaks = analysis.waveform?.peaks || [];
    ctx.fillStyle = '#0b1f2a'; ctx.fillRect(0, 16, width, 50);
    ctx.strokeStyle = '#49c8e9'; ctx.lineWidth = 1; ctx.beginPath(); peaks.forEach((peak, index) => { const time = index * (analysis.waveform.binSec || duration() / peaks.length); const x = xAt(time); if (x < 0 || x > width) return; const level = Array.isArray(peak) ? Math.max(...peak.map(Math.abs)) : Math.abs(peak); const amp = clamp(level, 0, 1) * 22; ctx.moveTo(x, 41 - amp); ctx.lineTo(x, 41 + amp); }); ctx.stroke();
    ctx.strokeStyle = '#2d4654'; ctx.lineWidth = 1; for (const beat of (analysis.beatsSec || [])) { const x = xAt(beat); if (x >= 0 && x <= width) { ctx.beginPath(); ctx.moveTo(x, 66); ctx.lineTo(x, height - 17); ctx.stroke(); } }
    timeline?.layers.forEach((layer, li) => { const y = 67 + li * 24; if (y > height - 10) return; ctx.fillStyle = li % 2 ? '#111b27' : '#14202c'; ctx.fillRect(0, y, width, 23); layer.clips.forEach((clip, ci) => { const x = xAt(clip.startSec), w = clip.durationSec / visible * width; if (x + w < 0 || x > width) return; const [r, g, b] = clip.color.map(c => Math.round(c * 255)); ctx.fillStyle = `rgba(${r},${g},${b},${li === selectedLayer && ci === selectedClip ? .82 : .55})`; ctx.fillRect(x, y + 2, Math.max(2, w), 19); if (li === selectedLayer && ci === selectedClip) { ctx.strokeStyle = '#f1c480'; ctx.strokeRect(x + .5, y + 2.5, Math.max(1, w - 1), 18); } ctx.fillStyle = '#f5f7fa'; ctx.font = '10px sans-serif'; ctx.fillText(clip.preset, x + 5, y + 15, Math.max(0, w - 10)); }); ctx.fillStyle = '#09111dcc'; ctx.fillRect(0, y, 74, 23); ctx.fillStyle = '#b5c8d7'; ctx.font = '10px sans-serif'; ctx.fillText(layer.id.slice(0, 11), 6, y + 15, 66); });
    const playX = xAt(songTime()); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(playX, 0); ctx.lineTo(playX, height); ctx.stroke();
    ctx.fillStyle = '#c9d6e8'; ctx.font = '11px sans-serif'; ctx.fillText(fmt(start), 5, height - 5); ctx.fillText(fmt(start + visible), width - 48, height - 5);
    canvas._timeAt = tAt;
  }
  const setZoom = (factor, anchorSec = songTime()) => { const next = zoomAround({ durationSec: duration(), zoom: Number($('timeline-zoom').value), startSec: viewportStart, anchorSec, factor }); $('timeline-zoom').value = String(next.zoom); viewportStart = next.startSec; drawTimeline(); };
  $('timeline-zoom').oninput = () => { const oldZoom = Number(canvas.dataset.zoom || 1); const newZoom = Number($('timeline-zoom').value); const anchorSec = clamp(songTime(), viewportStart, viewportStart + duration() / oldZoom); const next = zoomAround({ durationSec: duration(), zoom: oldZoom, startSec: viewportStart, anchorSec, factor: newZoom / oldZoom }); viewportStart = next.startSec; drawTimeline(); };
  $('timeline-pan').oninput = () => { viewportStart = Number($('timeline-pan').value); drawTimeline(); };
  $('zoom-fit').onclick = () => { $('timeline-zoom').value = '1'; viewportStart = 0; drawTimeline(); };
  $('zoom-in').onclick = () => setZoom(1.25);
  $('zoom-out').onclick = () => setZoom(1 / 1.25);
  canvas.addEventListener('wheel', e => {
    if (!timeline) return;
    const width = canvas.getBoundingClientRect ? canvas.getBoundingClientRect().width : 800;
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : { left: 0 };
      const x = e.clientX - (rect.left || 0);
      const anchorSec = canvas._timeAt(clamp(x, 0, width));
      const next = zoomAround({ durationSec: duration(), zoom: Number($('timeline-zoom').value), startSec: viewportStart, anchorSec, factor: Math.exp(-e.deltaY * .01) });
      $('timeline-zoom').value = String(next.zoom); viewportStart = next.startSec; drawTimeline();
    } else {
      const isShift = e.shiftKey;
      const absX = Math.abs(e.deltaX || 0);
      const absY = Math.abs(e.deltaY || 0);
      if (isShift || (absX > 0 && absX >= absY)) {
        e.preventDefault();
        const delta = isShift && !e.deltaX ? e.deltaY : e.deltaX;
        viewportStart = panByPixels({ durationSec: duration(), zoom: Number($('timeline-zoom').value), startSec: viewportStart, deltaPx: delta, widthPx: width });
        drawTimeline();
      }
    }
  }, { passive: false });
  let spacePan = false;
  canvas.addEventListener('pointerdown', e => { if (!timeline) return; const rect = canvas.getBoundingClientRect(), x = e.clientX - rect.left, y = e.clientY - rect.top; if (e.altKey || e.button === 1 || spacePan) { dragging = { mode: 'pan', x, start: viewportStart }; canvas.setPointerCapture(e.pointerId); canvas.classList.add('panning'); return; } const time = canvas._timeAt(x); const layerIndex = Math.floor((y - 67) / 24); const layer = timeline.layers[layerIndex]; const clipIndex = layer?.clips.findIndex(clip => time >= clip.startSec && time <= clip.startSec + clip.durationSec) ?? -1; if (layer && clipIndex >= 0) { selectedLayer = layerIndex; selectedClip = clipIndex; dragging = { mode: 'clip', x, start: layer.clips[clipIndex].startSec }; canvas.setPointerCapture(e.pointerId); renderLayers(); renderInspector(); } else { dragging = { mode: 'scrub' }; canvas.setPointerCapture(e.pointerId); seek(beatSnap(time)); } drawTimeline(); });
  canvas.addEventListener('pointermove', e => { if (!dragging || !timeline) return; const rect = canvas.getBoundingClientRect(); if (dragging.mode === 'pan') { viewportStart = panByPixels({ durationSec: duration(), zoom: Number($('timeline-zoom').value), startSec: dragging.start, deltaPx: dragging.x - (e.clientX - rect.left), widthPx: rect.width }); drawTimeline(); return; } if (dragging.mode === 'scrub') { seek(beatSnap(canvas._timeAt(clamp(e.clientX - rect.left, 0, rect.width)))); return; } const dt = (e.clientX - rect.left - dragging.x) / rect.width * Number(canvas.dataset.visible); const clip = currentClip(); if (clip) { clip.startSec = beatSnap(dragging.start + dt); drawTimeline(); } });
  canvas.addEventListener('pointerup', () => { if (dragging) { const movedClip = dragging.mode === 'clip'; dragging = null; canvas.classList.remove('panning'); if (movedClip) { renderInspector(); save(); } } });
  canvas.addEventListener('pointercancel', () => { dragging = null; canvas.classList.remove('panning'); });
  document.addEventListener('keydown', e => {
    if (e.code === 'Space' && !/^(INPUT|SELECT|TEXTAREA)$/.test(e.target?.tagName || '') && !document.querySelector('dialog[open]')) {
      e.preventDefault();
      if (e.target === canvas && e.altKey) spacePan = true;
      else if (track) $('project-play').click();
    }
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target?.tagName || '') || document.querySelector('dialog[open]')) return;
    if (track && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { e.preventDefault(); seek(songTime() + (e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 1 : 1 / 30)); }
    if (track && (e.key === '+' || e.key === '=' || e.key === '-')) { e.preventDefault(); const factor = e.key === '-' ? 1 / 1.25 : 1.25; const next = zoomAround({ durationSec: duration(), zoom: Number($('timeline-zoom').value), startSec: viewportStart, anchorSec: songTime(), factor }); $('timeline-zoom').value = String(next.zoom); viewportStart = next.startSec; drawTimeline(); }
    if (track && e.metaKey && e.key.toLowerCase() === 's') { e.preventDefault(); flushSave(track.id); }
  });
  document.addEventListener('keyup', e => { if (e.code === 'Space') spacePan = false; });
  window.addEventListener('resize', drawTimeline);
  refresh().then(() => { if (tracks.length) selectTrack(tracks[0].id).catch(error => status(error.message)); }).catch(error => status(error.message));
  requestAnimationFrame(function paint() { if (track && !audio.paused) { displayTime(); drawTimeline(); } requestAnimationFrame(paint); });

  return {
    frame(base, blackout = false, freeze = false) {
      if (!timeline || !analysis || !track || blackout) return base;
      if (freeze) { if (frozenSec === null) frozenSec = songTime(); } else frozenSec = null;
      const time = clamp((frozenSec ?? songTime()) + offsetSec, 0, duration());
      if (performance.now() >= calibrateFrom && performance.now() < calibrateUntil) {
        const white = Math.round(100 * clamp(Number($('brightness').value) / 100, 0, 1));
        return { bars: Object.fromEntries(BAR_IDS.map(id => [id, Array.from({ length: 12 }, () => [0, 0, 0, white])])) };
      }
      const black = { bars: Object.fromEntries(BAR_IDS.map(id => [id, Array.from({ length: 12 }, () => [0, 0, 0, 0])])) };
      const rendered = renderTimelineFrame(timeline, analysis, time, black);
      const master = clamp(Number($('brightness').value) / 100, 0, 1);
      for (const id of BAR_IDS) for (const pixel of rendered.bars[id]) for (let channel = 0; channel < 4; channel++) pixel[channel] = Math.round(pixel[channel] * master);
      return rendered;
    },
    get active() { return Boolean(track && timeline && analysis); }
  };
}
