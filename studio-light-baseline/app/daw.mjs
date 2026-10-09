/** LEDicated studio: FL-Studio-style workspace. Wires the playlist, clip editor,
 * mixer, live desk and output together around one undoable timeline store.
 * One deterministic function (renderTimelineFrame) produces the RGBW frame that
 * feeds both the WebGL preview and the WLED/DDP output.
 */
import { BAR_IDS } from './engine.mjs';
import { createAutoShow, renderTimelineFrame, validateTimeline } from './timeline.mjs';
import { createLedPreview } from './led-preview.mjs';
import { installTooltips } from './tooltips.mjs';
import {
  SNAP_MODES, addClip, beatPosition, clamp, clipEnd, copyClips, createStore, deleteClips, duplicateClips, findClip, formatBBT, formatClock, normalizeTimeline,
  pasteClips, refKey, snapStepSec, uid
} from './daw-state.mjs';
import { createKnob, createDragNumber, h, hexToRgb, showMenu, toast, closeMenu } from './daw-ui.mjs';
import { createPlaylist, LANE_HEIGHTS, PRESET_LABELS } from './daw-playlist.mjs';
import { createClipEditor } from './daw-editor.mjs';
import { createDriverEditor } from './daw-driver.mjs';
import { computeSpectrum } from './audio-spectrum.mjs';
import { createMixer } from './daw-mixer.mjs';
import { createStemsEngine } from './daw-stems.mjs';
import { createLive } from './daw-live.mjs';
import { createPerformancePanel } from './daw-performance.mjs';
import { PAD_KEYS } from './live-performance-state.mjs';
import { createOutput } from './daw-output.mjs';
import { createBrowser, libraryApi } from './daw-browser.mjs';
import { detectSections } from './audio-sections.mjs';

const now = () => performance.now() / 1000;
const ICONS = {
  play: '<path d="M4 2.5v11l9-5.5z"/>', pause: '<path d="M4 2.5h3v11H4zM9 2.5h3v11H9z"/>', stop: '<rect x="3.5" y="3.5" width="9" height="9" rx="1"/>',
  loop: '<path d="M3 9V7a3 3 0 0 1 3-3h6M10 1.5 12.5 4 10 6.5M13 7v2a3 3 0 0 1-3 3H4M6 9.5 3.5 12 6 14.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>',
  follow: '<path d="M3 2.5v11M6 8h7M10 5l3 3-3 3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
  undo: '<path d="M6 3 2.5 6.5 6 10M3 6.5h6.5a3.5 3.5 0 0 1 0 7H6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
  redo: '<path d="M10 3l3.5 3.5L10 10M13 6.5H6.5a3.5 3.5 0 0 0 0 7H10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
  save: '<path d="M2.5 2.5h9l2 2v9h-11zM5 2.5v4h6v-4M5 13.5v-4h6v4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>',
  draw: '<path d="M2.5 13.5 3.3 10 11 2.3l2.7 2.7L6 12.7z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>',
  select: '<path d="M3.5 2.5l8.5 5-3.8 1.2L6.8 12z"/>',
  slice: '<path d="M8 1.5v13" stroke="currentColor" stroke-width="1.5" stroke-dasharray="2 2"/><path d="M2.5 4.5 7 8l-4.5 3.5zM13.5 4.5 9 8l4.5 3.5z" fill="currentColor"/>',
  erase: '<path d="M3 10.5 9 4l4 3.3L7.5 14H4.7zM8 14h6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>',
  magnet: '<path d="M3 2.5v5a5 5 0 0 0 10 0v-5h-3v5a2 2 0 0 1-4 0v-5z"/>',
  help: '<circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M6.2 6.2A1.9 1.9 0 1 1 8.6 8c-.5.3-.6.6-.6 1.1M8 11.3v.1" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>'
};
const icon = name => h('span', { class: 'ico', 'aria-hidden': 'true', innerHTML: `<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor">${ICONS[name]}</svg>` });
const emptyTimeline = () => ({ version: 1, durationSec: 60, bpm: 120, beatOffsetSec: 0, blackout: false, layers: [] });
const TOOLS = [['draw', 'Crtaj', '1', 'Povuci u praznoj traci za novi clip. Klik na clip ga pomiče, rubovi mijenjaju duljinu.'], ['select', 'Odaberi', '2', 'Klik odabire, povlačenje okvirom odabire više clipova. ⌥ + povuci duplicira.'], ['slice', 'Podijeli', '3', 'Klikni clip za rez na snap poziciji.'], ['erase', 'Briši', '4', 'Klikni ili povuci preko clipova za brisanje. Desni klik briše uvijek.']];

/* ------------------------------------------------------------------ layout */
const app = h('div', { class: 'app' });
document.body.replaceChildren(app);

const badge = h('span', { id: 'output-status', class: 'badge' }, 'SIMULACIJA');
const bbtEl = h('div', { id: 'bbt', class: 'lcd-main', 'aria-label': 'Takt:beat:tik' }, '1:1:00');
const clockEl = h('div', { id: 'clock', class: 'lcd-sub' }, '0:00.000');
const playBtn = h('button', { type: 'button', id: 'play', class: 'tbtn play', title: 'Reproduciraj / pauziraj (Space)', 'aria-label': 'Reproduciraj', disabled: true }, icon('play'));
const stopBtn = h('button', { type: 'button', id: 'stop', class: 'tbtn', title: 'Stop: vrati na mjesto starta; drugi put na početak', 'aria-label': 'Stop' }, icon('stop'));
const loopBtn = h('button', { type: 'button', id: 'loop', class: 'tbtn', title: 'Loop regije (L). Povuci po donjem pojasu ravnala za regiju.', 'aria-pressed': 'false', 'aria-label': 'Loop' }, icon('loop'));
const followBtn = h('button', { type: 'button', id: 'follow', class: 'tbtn on', title: 'Prati playhead (F)', 'aria-pressed': 'true', 'aria-label': 'Prati playhead' }, icon('follow'));
const undoBtn = h('button', { type: 'button', id: 'undo', class: 'tbtn', title: 'Poništi (⌘Z)', 'aria-label': 'Poništi', disabled: true }, icon('undo'));
const redoBtn = h('button', { type: 'button', id: 'redo', class: 'tbtn', title: 'Ponovi (⇧⌘Z)', 'aria-label': 'Ponovi', disabled: true }, icon('redo'));
const saveBtn = h('button', { type: 'button', id: 'save', class: 'tbtn', title: 'Spremi (⌘S). Sprema se i automatski.', 'aria-label': 'Spremi' }, icon('save'));
const snapSelect = h('select', { id: 'snap', 'aria-label': 'Snap', title: 'Preciznost poravnanja na beat' }, Object.entries(SNAP_MODES).map(([value, label]) => h('option', { value, selected: value === '1' }, label)));
const gridBtn = h('button', { type: 'button', id: 'grid-menu', class: 'txt-btn', title: 'Tempo i mreža pjesme' }, 'Mreža ▾');
const toolButtons = TOOLS.map(([id, label, key, tip]) => h('button', { type: 'button', class: 'tbtn tool', dataset: { tool: id }, title: `${label} (${key}). ${tip}`, 'aria-label': label, 'aria-pressed': 'false' }, icon(id)));
const trackTitle = h('div', { id: 'project-title', class: 'track-title' }, 'Nema odabrane pjesme');
const blackoutBtn = h('button', { type: 'button', id: 'blackout', class: 'blackout', 'aria-pressed': 'false', title: 'Blackout: sve ugasi i isključi izlaz (Esc)' }, 'BLACKOUT ', h('kbd', {}, 'Esc'));
const statusEl = h('span', { id: 'status', role: 'status', 'aria-live': 'polite' }, 'Odaberi ili povuci pjesmu za početak.');
const selectionEl = h('span', { id: 'selection-info' }), saveEl = h('span', { id: 'save-state', class: 'save-ok' }, 'Spremljeno');
const status = message => { statusEl.textContent = message; };

let dawTaps = [];
const bpmTapBtn = h('button', {
  type: 'button',
  id: 'bpm-tap',
  class: 'mini-tap',
  title: 'TAP: klikni barem 4 puta u ritmu za određivanje tempa pjesme',
  onClick: () => {
    if (!hasTrack()) return status('Odaberi pjesmu prije tapkanja tempa.');
    const t = performance.now() / 1000;
    if (dawTaps.length && t - dawTaps[dawTaps.length - 1] > 2.0) dawTaps = [];
    dawTaps.push(t);
    if (dawTaps.length >= 2) {
      const intervals = [];
      for (let i = 1; i < dawTaps.length; i++) intervals.push(dawTaps[i] - dawTaps[i - 1]);
      const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      const tappedBpm = Math.round(600 / avg) / 10;
      if (tappedBpm >= 40 && tappedBpm <= 240) {
        store.commit('TAP tempo', tr => {
          tr.bpm = tappedBpm;
          tr.gridMode = 'manual';
        });
        bpmNumber.set(tappedBpm);
        status(`TAP tempo: ${tappedBpm} BPM postavljen.`);
      }
    } else {
      status('TAP tempo: tapkaj još barem 2–3 puta...');
    }
  }
}, 'TAP');

const bpmNumber = createDragNumber({ id: 'bpm', label: 'BPM', value: 120, min: 40, max: 240, step: .5, decimals: 1, onChange: v => { if (!hasTrack()) return; store.commit('Tempo', t => { t.bpm = v; t.gridMode = 'manual'; }); updateGridButton(); } });
const masterKnob = createKnob({ label: 'MASTER', value: 35, min: 0, max: 60, step: 1, size: 40, reset: 35, format: v => `${Math.round(v)}%`, title: 'Master svjetlina; ograničeno na 60. Vizualni limit, ne zaštita napajanja.', onInput: v => { live.setBrightness(v); mixer.setMaster(v); } });

const header = h('header', { class: 'topbar' },
  h('div', { class: 'brand' }, h('span', { class: 'mark' }, 'L', h('i', {}, '•')), h('div', {}, h('strong', {}, 'LEDicated'), h('small', {}, 'SHOW STUDIO'))),
  h('div', { class: 'tgroup transport' }, stopBtn, playBtn, loopBtn, followBtn),
  h('div', { class: 'lcd', title: 'Takt:beat:tik i vrijeme' }, bbtEl, clockEl),
  h('div', { class: 'tgroup' }, bpmNumber.element, bpmTapBtn, gridBtn),
  h('div', { class: 'tgroup' }, h('span', { class: 'glabel' }, icon('magnet')), snapSelect),
  h('div', { class: 'tgroup tools', role: 'group', 'aria-label': 'Alati' }, toolButtons),
  h('div', { class: 'tgroup' }, undoBtn, redoBtn, saveBtn),
  trackTitle,
  h('div', { class: 'tgroup right' }, masterKnob.element, badge, h('button', { type: 'button', id: 'out-open', class: 'txt-btn', title: 'Postavke izlaza i kalibracija' }, 'Izlaz'), h('button', { type: 'button', id: 'help-open', class: 'tbtn', title: 'Prečaci tipkovnice (?)', 'aria-label': 'Prečaci' }, icon('help')), blackoutBtn));

header.addEventListener('wheel', event => {
  if (header.scrollWidth > header.clientWidth) {
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    if (delta !== 0) {
      header.scrollLeft += delta;
      event.preventDefault();
    }
  } else if (Math.abs(event.deltaX) > 0) {
    event.preventDefault();
  }
}, { passive: false });

const browserHost = h('aside', { class: 'panel browser', 'aria-label': 'Preglednik' });
const playlistHost = h('section', { class: 'panel playlist-host', 'aria-label': 'Playlist' });
const dockTabs = h('div', { class: 'dock-tabs', role: 'tablist' });
const clipPane = h('div', { class: 'dock-pane clip-pane', role: 'tabpanel' });
const envPane = h('div', { class: 'dock-pane envelope-pane', role: 'tabpanel', hidden: true });
const driverPane = h('div', { class: 'dock-pane driver-pane', role: 'tabpanel', hidden: true });
const mixerPane = h('div', { class: 'dock-pane mixer-pane', role: 'tabpanel', hidden: true });
const livePane = h('div', { class: 'dock-pane live-pane', role: 'tabpanel', hidden: true });
const performancePane = h('div', { class: 'dock-pane performance-pane', role: 'tabpanel', hidden: true });
const outputPane = h('div', { class: 'dock-pane live-pane output-pane', role: 'tabpanel', hidden: true });
const dock = h('section', { class: 'panel dock', 'aria-label': 'Urednik' }, dockTabs, clipPane, envPane, driverPane, mixerPane, livePane, performancePane, outputPane);
const activeNow = h('div', { id: 'active-now', class: 'active-now' });
const stage = h('div', { class: 'stage' },
  h('div', { id: 'bar-grid', class: 'bar-grid', role: 'img', 'aria-label': 'Devet traka u rasporedu tri puta tri' })
);
const stageSection = h('div', { class: 'stage-section' }, stage);

const powerValue = h('span', { class: 'tele-num' }, '8 W');
const powerPct = h('span', { class: 'tele-pct' }, '2% / 400W');
const powerBar = h('div', { class: 'tele-fill power' });
const powerMeter = h('div', { class: 'tele-bar', title: 'Procjena potrošnje WS2814 traka i 5 čvorova' }, powerBar);

const vuR = h('div', { class: 'tele-fill r' });
const vuG = h('div', { class: 'tele-fill g' });
const vuB = h('div', { class: 'tele-fill b' });
const vuW = h('div', { class: 'tele-fill w' });
const meterR = h('div', { class: 'tele-bar mini', title: 'Crveni kanal (R)' }, vuR);
const meterG = h('div', { class: 'tele-bar mini', title: 'Zeleni kanal (G)' }, vuG);
const meterB = h('div', { class: 'tele-bar mini', title: 'Plavi kanal (B)' }, vuB);
const meterW = h('div', { class: 'tele-bar mini', title: 'Topla bijela (W)' }, vuW);

const teleNodes = h('span', { class: 'tele-tag' }, '5 ČVOROVA · 648 LED');
const teleMode = h('span', { class: 'tele-tag mode' }, 'SIMULACIJA');

const telemetrySection = h('div', { class: 'stage-telemetry' },
  h('div', { class: 'tele-row' },
    h('div', { class: 'tele-lbl' }, h('strong', {}, '24V'), powerValue, powerPct),
    powerMeter
  ),
  h('div', { class: 'tele-grid-rgbw' },
    h('div', { class: 'tele-ch' }, h('span', { class: 'ch-lbl' }, 'R'), meterR),
    h('div', { class: 'tele-ch' }, h('span', { class: 'ch-lbl' }, 'G'), meterG),
    h('div', { class: 'tele-ch' }, h('span', { class: 'ch-lbl' }, 'B'), meterB),
    h('div', { class: 'tele-ch' }, h('span', { class: 'ch-lbl' }, 'W'), meterW)
  ),
  h('div', { class: 'tele-foot' }, teleNodes, teleMode)
);

const stagePanel = h('section', { class: 'stage-panel', 'aria-label': 'Svjetlo' },
  stageSection,
  telemetrySection,
  activeNow
);
const splitter = (axis, variable, min, max, dir) => h('div', { class: `splitter ${axis}`, role: 'separator', tabIndex: 0, 'aria-orientation': axis === 'x' ? 'vertical' : 'horizontal', dataset: { variable, min, max, dir } });
const center = h('main', { class: 'center' }, playlistHost, splitter('y', '--dock-h', 36, 680, -1), dock);
const workspace = h('div', { class: 'workspace' }, browserHost, splitter('x', '--browser-w', 0, 460, 1), center, splitter('x', '--stage-w', 0, 620, -1), stagePanel);
const footer = h('footer', { class: 'statusbar' }, statusEl, selectionEl, h('span', { class: 'sb-right' }, saveEl, h('span', { id: 'render-mode' })));
const dropOverlay = h('div', { class: 'drop-overlay' }, h('div', {}, h('b', {}, 'Ispusti glazbu ovdje'), h('span', {}, 'MP3 ili WAV · ostaje na ovom računalu')));
app.append(header, workspace, footer, dropOverlay);
installTooltips();

function toggleSidePanel(variable, defaultVal) {
  const cur = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(variable));
  if (cur > 40) {
    localStorage.setItem(`ledicated-saved-${variable}`, `${cur}px`);
    document.documentElement.style.setProperty(variable, '0px');
  } else {
    const saved = localStorage.getItem(`ledicated-saved-${variable}`) || `${defaultVal}px`;
    document.documentElement.style.setProperty(variable, saved);
  }
}

function toggleDock() {
  const cur = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dock-h'));
  if (cur > 50) {
    localStorage.setItem('ledicated-saved---dock-h', `${cur}px`);
    document.documentElement.style.setProperty('--dock-h', '36px');
    dockMinBtn.textContent = '▴';
    dockMinBtn.title = 'Proširi urednik';
  } else {
    const saved = localStorage.getItem('ledicated-saved---dock-h') || '320px';
    document.documentElement.style.setProperty('--dock-h', saved);
    dockMinBtn.textContent = '▾';
    dockMinBtn.title = 'Minimiziraj urednik';
  }
}

/* splitters with persisted sizes */
for (const variable of ['--browser-w', '--stage-w', '--dock-h']) { const saved = localStorage.getItem(`ledicated${variable}`); if (saved) document.documentElement.style.setProperty(variable, saved); }
for (const bar of document.querySelectorAll('.splitter')) {
  const { variable, min, max, dir } = bar.dataset, axis = bar.classList.contains('x') ? 'clientX' : 'clientY';
  bar.title = 'Povuci za veličinu · Dvoklik za sakrivanje / proširenje';
  const currentSize = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(variable));
  let start = 0, startSize = 0;
  const set = size => { const value = `${clamp(size, Number(min), Number(max))}px`; document.documentElement.style.setProperty(variable, value); localStorage.setItem(`ledicated${variable}`, value); };
  bar.addEventListener('pointerdown', event => { start = event[axis]; startSize = currentSize(); bar.setPointerCapture(event.pointerId); bar.classList.add('active'); });
  bar.addEventListener('pointermove', event => { if (bar.hasPointerCapture(event.pointerId)) set(startSize + (event[axis] - start) * Number(dir)); });
  const stop = event => { if (bar.hasPointerCapture(event.pointerId)) bar.releasePointerCapture(event.pointerId); bar.classList.remove('active'); };
  bar.addEventListener('pointerup', stop); bar.addEventListener('pointercancel', stop);
  bar.addEventListener('keydown', event => { const d = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[event.key]; if (d) { event.preventDefault(); set(currentSize() + d * 16 * Number(dir)); } });
  bar.addEventListener('dblclick', () => {
    if (variable === '--browser-w') toggleSidePanel('--browser-w', 260);
    else if (variable === '--stage-w') toggleSidePanel('--stage-w', 390);
    else if (variable === '--dock-h') toggleDock();
  });
}

/* ------------------------------------------------------------------- state */
const audio = new Audio(); audio.preload = 'auto';
const stemsEngine = createStemsEngine(audio);
const store = createStore(emptyTimeline());
const s = { track: null, analysis: null, scrubSec: 0, playFrom: 0, loop: null, loopOn: false, follow: true, tool: 'draw', activeLayer: 0, token: 0, dock: 'clip', audioMuted: false, volume: 1, clipboard: null, brush: { preset: 'pulse', driver: 'none', driverGain: 1, targets: 'all' }, frozenSec: null, iso: { clip: false, bypass: false }, spectrumState: 'none', saveTimer: 0, pendingSave: null, lastLevels: 0, lastActive: 0, mixerStale: true };
const tl = () => store.timeline;
const hasTrack = () => Boolean(s.track && s.analysis);
const duration = () => s.analysis?.durationSec || tl().durationSec || audio.duration || 60;
const songTime = () => audio.paused ? s.scrubSec : audio.currentTime;
const snapMode = () => snapSelect.value === 'none' || snapSelect.value === 'bar' ? snapSelect.value : Number(snapSelect.value);

const liveHost = h('div', { class: 'live-grid' }); livePane.append(liveHost);
const live = createLive(liveHost, { now, status });
const preview = createLedPreview(stage.querySelector('#bar-grid'), stageSection);
const outputHost = h('div', { class: 'live-grid' }); outputPane.append(outputHost);
const output = createOutput(outputHost, { badge, status, isBlackout: () => live.engine.state.blackout, onConfig: config => preview.configure(config) });
live.setBrightness(35);
const performDesk = createPerformancePanel(performancePane, {
  status, songTime, clockTime: now, playing: () => !audio.paused && hasTrack(), hasTrack,
  bpm: () => hasTrack() ? tl().bpm : live.engine.clock.bpm,
  beatOffset: () => hasTrack() ? tl().beatOffsetSec : 0,
  beatTimes: () => hasTrack() && tl().gridMode !== 'manual' ? (s.analysis?.beatsSec || s.analysis?.beats || null) : null,
  analysis: () => s.analysis, duration, trackId: () => s.track?.id || null,
  trackTitle: () => s.track?.title || s.track?.originalName || '',
  seek, commitSeek, setLoop, loop: () => s.loop ? { ...s.loop, on: s.loopOn } : null,
  blackout: () => live.engine.state.blackout
});

/* --------------------------------------------------------------- playhead */
function syncPlay() {
  const playing = !audio.paused;
  playBtn.replaceChildren(icon(playing ? 'pause' : 'play')); playBtn.classList.toggle('on', playing);
  playBtn.setAttribute('aria-label', playing ? 'Pauziraj' : 'Reproduciraj'); playBtn.disabled = !s.track;
}
let scrubWasPlaying = false;
let audioSeekTimer = null;

function seek(sec, isScrubbing = false) {
  s.scrubSec = clamp(sec || 0, 0, duration());
  if (isScrubbing && !audio.paused) {
    scrubWasPlaying = true;
    audio.pause();
  }
  playlist.redraw();
  if (s.dock === 'clip') editor.draw();
  const time = songTime();
  const text = formatBBT(hasTrack() ? Math.max(0, beatPosition(time, tl(), s.analysis)) : 0) + '|' + formatClock(time);
  if (text !== lastText) {
    lastText = text;
    const [bbt, clock] = text.split('|');
    bbtEl.textContent = bbt;
    clockEl.textContent = clock;
  }
  if (hasTrack()) updateActiveNow(time);
  if (s.track) {
    if (isScrubbing) {
      if (!audioSeekTimer) {
        audioSeekTimer = setTimeout(() => {
          audioSeekTimer = null;
          try { audio.currentTime = s.scrubSec; } catch {}
        }, 40);
      }
    } else {
      if (audioSeekTimer) { clearTimeout(audioSeekTimer); audioSeekTimer = null; }
      try { audio.currentTime = s.scrubSec; } catch {}
    }
  }
  playlist.ensureVisible(s.scrubSec);
}

function commitSeek() {
  if (audioSeekTimer) { clearTimeout(audioSeekTimer); audioSeekTimer = null; }
  if (s.track) { try { audio.currentTime = s.scrubSec; } catch {} }
  playlist.redraw();
  if (s.dock === 'clip') editor.draw();
  if (scrubWasPlaying) {
    scrubWasPlaying = false;
    audio.play().catch(() => {});
  }
  syncPlay();
}

async function togglePlay() {
  if (!s.track) return;
  stemsEngine.ensureContext();
  if (audio.paused) {
    s.playFrom = s.scrubSec; audio.currentTime = s.scrubSec;
    try { await audio.play(); } catch (error) { toast(`Reprodukcija nije uspjela: ${error.message}`, 'error'); }
  } else {
    audio.pause();
    s.scrubSec = audio.currentTime;
    playlist.redraw();
  }
  syncPlay();
}
function stop() {
  if (!audio.paused) { audio.pause(); seek(s.playFrom); } else seek(0);
  syncPlay();
}
audio.onplay = audio.onpause = syncPlay;
audio.onended = () => { s.scrubSec = 0; syncPlay(); playlist.redraw(); };
audio.onloadedmetadata = () => { if (audio.paused) audio.currentTime = s.scrubSec; playlist.redraw(); };
playBtn.onclick = togglePlay; stopBtn.onclick = stop;

function setLoop(region) {
  s.loop = region ? { start: clamp(region.start, 0, duration()), end: clamp(region.end, 0, duration()) } : null;
  s.loopOn = Boolean(s.loop); syncLoop(); playlist.redraw();
}
function syncLoop() { loopBtn.setAttribute('aria-pressed', String(s.loopOn)); loopBtn.classList.toggle('on', s.loopOn); }
loopBtn.onclick = () => {
  if (s.loop) { s.loopOn = !s.loopOn; syncLoop(); playlist.redraw(); return; }
  const hits = playlist.selection.map(ref => findClip(tl(), ref)).filter(Boolean);
  if (hits.length) setLoop({ start: Math.min(...hits.map(x => x.clip.startSec)), end: Math.max(...hits.map(x => clipEnd(x.clip))) });
  else status('Povuci po donjem pojasu ravnala za loop regiju ili odaberi clipove.');
};
followBtn.onclick = () => { s.follow = !s.follow; followBtn.classList.toggle('on', s.follow); followBtn.setAttribute('aria-pressed', String(s.follow)); };

/* ------------------------------------------------------------------ tools */
function setTool(id) { s.tool = id; for (const b of toolButtons) { const on = b.dataset.tool === id; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); } status(TOOLS.find(t => t[0] === id)[3]); }
toolButtons.forEach(b => { b.onclick = () => setTool(b.dataset.tool); });

/* --------------------------------------------------------------- playlist */
const newClipSpec = layer => ({ preset: s.brush.preset, driver: s.brush.driver, driverGain: s.brush.driverGain, ...(s.brush.driver === 'band' && s.brush.band ? { band: { ...s.brush.band } } : {}), targets: s.brush.targets === 'all' ? 'all' : [...s.brush.targets], color: [...hexToRgb(layer.color || '#3aa0ff'), 0] });
const playlist = createPlaylist(playlistHost, {
  store, stems: stemsEngine, getAnalysis: () => s.analysis, duration, getTime: songTime, seek: (sec, isScrubbing) => seek(sec, isScrubbing), commitSeek: () => commitSeek(), getSnap: snapMode, getTool: () => s.tool,
  isPlaying: () => !audio.paused, hasTrack, getTrackTitle: () => s.track?.title || s.track?.originalName || 'Nema pjesme',
  isAudioMuted: () => audio.muted, toggleAudioMute: () => { audio.muted = !audio.muted; }, getVolume: () => audio.volume, setVolume: v => { audio.volume = clamp(v, 0, 1); },
  getActiveLayerIndex: () => s.activeLayer, setActiveLayer: index => { if (s.activeLayer !== index) { s.activeLayer = index; playlist.updateActiveHead?.(index); playlist.redraw(); if (s.dock === 'mixer') mixer.render(); } },
  status, newClipSpec, getLoop: () => s.loop, setLoop, isLoopOn: () => s.loopOn,
  onSelect: refs => { editor.render(); selectionInfo(refs); const hit = refs[0] && findClip(tl(), refs[0]); if (hit) s.brush = { preset: hit.clip.preset, driver: hit.clip.driver, driverGain: hit.clip.driverGain, band: hit.clip.band ? { ...hit.clip.band } : null, targets: hit.clip.targets === 'all' ? 'all' : [...hit.clip.targets] }; },
  onStructure: () => structureChanged(), openEditor: () => switchDock('clip'), onSolo: () => { playlist.redraw(); if (s.dock === 'mixer') mixer.render(); }
});
function selectionInfo(refs = playlist.selection) {
  const hits = refs.map(ref => findClip(tl(), ref)).filter(Boolean);
  selectionEl.textContent = hits.length ? `${hits.length} ${hits.length === 1 ? 'clip' : 'clipa'} · ${formatClock(Math.min(...hits.map(x => x.clip.startSec)))} – ${formatClock(Math.max(...hits.map(x => clipEnd(x.clip))))}` : '';
}
const clipEditor = createClipEditor(clipPane, {
  envHost: envPane, store, getSelection: () => playlist.selection, select: refs => playlist.setSelection(refs), getAnalysis: () => s.analysis, getTime: songTime, getSnap: snapMode, duration, status,
  seek,
  loopClip: clip => {
    const start = clip.startSec, end = clipEnd(clip);
    setLoop({ start, end });
    seek(start);
    if (audio.paused && s.track) audio.play().catch(() => {});
    syncPlay();
  },
  openDriver: () => switchDock('driver')
});
const driverEditor = createDriverEditor(driverPane, {
  store, stems: stemsEngine, getSelection: () => playlist.selection, getAnalysis: () => s.analysis, getTime: songTime, duration, status,
  spectrumStatus: () => s.spectrumState === 'error' ? 'Spektar nije dostupan: audio se nije dekodirao.' : s.spectrumState === 'none' ? 'Odaberi pjesmu.' : `Računam spektar pjesme… ${Math.round((s.spectrumProgress || 0) * 100)}%`
});
const editor = { render() { clipEditor.render(); driverEditor.render(); }, draw() { clipEditor.draw(); driverEditor.draw(); } };
const mixer = createMixer(mixerPane, { store, playlist, stems: stemsEngine, getActiveLayerIndex: () => s.activeLayer, setActiveLayer: index => { s.activeLayer = index; playlist.updateActiveHead?.(index); playlist.redraw(); mixer.render(); }, getBrightness: () => masterKnob.value, setBrightness: v => { masterKnob.set(v); live.setBrightness(v); }, onStructure: () => playlist.renderHeads(), onSolo: () => { playlist.renderHeads(); playlist.redraw(); } });

function structureChanged() { s.mixerStale = true; if (s.dock === 'mixer') { mixer.render(); s.mixerStale = false; } }
function updateHistoryButtons() {
  undoBtn.disabled = !store.canUndo; redoBtn.disabled = !store.canRedo;
  undoBtn.title = store.canUndo ? `Poništi: ${store.undoLabel} (⌘Z)` : 'Poništi (⌘Z)'; redoBtn.title = store.canRedo ? `Ponovi: ${store.redoLabel} (⇧⌘Z)` : 'Ponovi (⇧⌘Z)';
}
function updateGridButton() { gridBtn.textContent = `Mreža · ${tl().gridMode === 'manual' ? 'ručna' : 'analiza'} ▾`; if (hasTrack()) bpmNumber.set(tl().bpm); }

/* ------------------------------------------------------------------- save */
function setSaveState(text, kind) { saveEl.textContent = text; saveEl.className = `save-${kind}`; }
function scheduleSave() {
  if (!hasTrack()) return;
  s.pendingSave = { id: s.track.id, snapshot: structuredClone(tl()) }; setSaveState('Sprema se…', 'busy');
  clearTimeout(s.saveTimer); s.saveTimer = setTimeout(flushSave, 400);
}
async function flushSave() {
  const pending = s.pendingSave; if (!pending) return;
  s.pendingSave = null; clearTimeout(s.saveTimer);
  const check = validateTimeline(pending.snapshot);
  if (!check.valid) { setSaveState('Nije spremljeno', 'err'); status(`Show nije valjan: ${check.errors[0]}`); return; }
  try { await libraryApi('timeline', { id: pending.id, timeline: pending.snapshot }); if (!s.pendingSave) setSaveState('Spremljeno', 'ok'); }
  catch (error) { setSaveState('Nije spremljeno', 'err'); status(error.message); toast(`Spremanje nije uspjelo: ${error.message}`, 'error'); }
}
saveBtn.onclick = () => { flushSave().then(() => toast('Show spremljen.')); };
addEventListener('pagehide', () => { const p = s.pendingSave; if (p) navigator.sendBeacon('/api/library/timeline', new Blob([JSON.stringify({ id: p.id, timeline: p.snapshot })], { type: 'application/json' })); });

store.subscribe(kind => {
  if (kind === 'transient') { playlist.redraw(); editor.draw(); return; }
  playlist.pruneSelection(); playlist.renderHeads(); editor.render(); structureChanged(); updateHistoryButtons(); updateGridButton(); selectionInfo(); playlist.redraw();
  if (kind === 'change') scheduleSave();
});
undoBtn.onclick = () => { if (store.undo()) status(`Poništeno: ${store.redoLabel}`); };
redoBtn.onclick = () => { if (store.redo()) status(`Ponovljeno: ${store.undoLabel}`); };

/* ------------------------------------------------------------ track loading */
async function selectTrack(id) {
  const token = ++s.token;
  await flushSave(); audio.pause(); syncPlay();
  const result = await libraryApi(`track/${id}`);
  if (token !== s.token) return;
  s.track = result.track; s.analysis = result.analysis; s.loop = null; s.loopOn = false; s.scrubSec = 0; s.frozenSec = null; syncLoop();
  if (s.analysis) {
    if (!s.analysis.stems && s.analysis.features) {
      s.analysis.stems = {
        drums: s.analysis.features.drums || [],
        bass: s.analysis.features.bass || [],
        vocals: s.analysis.features.vocals || [],
        other: s.analysis.features.other || []
      };
    }
    if (!s.analysis.sections) {
      s.analysis.sections = detectSections(s.analysis);
    }
  }
  audio.src = `/api/library/audio/${id}`; audio.load();
  let timeline = result.timeline;
  if (s.analysis) {
    if (timeline && !validateTimeline(timeline).valid) { toast('Spremljeni show nije valjan; stvoren je novi.', 'error'); timeline = null; }
    if (!timeline) { timeline = createAutoShow(s.analysis); await libraryApi('timeline', { id, timeline }); }
    store.replace(normalizeTimeline(timeline));
  } else store.replace(emptyTimeline());
  s.activeLayer = 0; playlist.setSelection([], false); playlist.fit(); playlist.renderHeads(); editor.render(); mixer.render(); updateHistoryButtons(); updateGridButton(); selectionInfo();
  trackTitle.textContent = s.track.title || s.track.originalName || 'Pjesma'; browser.setActive(id); syncPlay(); setSaveState('Spremljeno', 'ok');
  const initialTime = parseFloat(new URLSearchParams(window.location.search).get('t') || window.location.hash.slice(1));
  if (!isNaN(initialTime) && initialTime > 0) seek(initialTime);
  status(s.analysis ? `Analizirano · ${Math.round(s.analysis.bpm || 0)} BPM · ${s.analysis.sections?.length || 0} dionica · 4 stema.` : 'Pjesma čeka lokalnu analizu.');
  ensureSpectrum();
  if (!s.analysis) await analyze(id);
}
async function analyze(id) {
  status('Lokalna analiza traje. Nema slanja u cloud.');
  try {
    const result = await libraryApi('analyze', { id });
    if (s.track?.id !== id) return;
    s.analysis = result.analysis; ensureSpectrum(); const timeline = normalizeTimeline(createAutoShow(s.analysis));
    await libraryApi('timeline', { id, timeline }); store.replace(timeline);
    playlist.fit(); playlist.renderHeads(); editor.render(); mixer.render(); updateGridButton(); browser.refresh();
    status(`Analiza gotova · ${Math.round(s.analysis.bpm)} BPM. Show je editabilan.`);
  } catch (error) { status(`Analiza nije uspjela: ${error.message}`); toast(`Analiza nije uspjela: ${error.message}`, 'error'); }
}
function generateShow({ energy, palette }) {
  if (!hasTrack()) return status('Najprije odaberi analiziranu pjesmu.');
  const result = store.commit('Auto show', t => { const fresh = normalizeTimeline(createAutoShow(s.analysis, { energy, palette })); t.layers = fresh.layers; });
  if (result.error) return status(result.error);
  s.activeLayer = 0; playlist.setSelection([]); status('Auto show je generiran. Poništi s ⌘Z ako ti se više sviđao prethodni.');
}
function addPreset(preset) {
  if (!hasTrack()) return status('Najprije odaberi pjesmu.');
  const layer = tl().layers[s.activeLayer]; if (!layer) return status('Dodaj sloj.');
  const start = Math.min(songTime(), duration() - .1), length = Math.min(snapStepSec('bar', tl(), s.analysis, start), duration() - start);
  let ref; const result = store.commit('Novi clip', t => { ref = addClip(t, layer.id, { ...newClipSpec(layer), preset, startSec: start, durationSec: Math.max(.05, length) }); });
  if (result.error) return status(result.error);
  playlist.setSelection([ref]); status(`Clip „${PRESET_LABELS[preset]}” dodan na ${formatClock(start)}.`);
}
const browser = createBrowser(browserHost, {
  status, selectTrack, generateShow, addPreset, getAnalysis: () => s.analysis, setLoop, seek,
  onPresetClick: preset => s.dock === 'perform' && performDesk.assignPreset(preset),
  onPresetDrop: (preset, index) => s.dock === 'perform' && performDesk.assignPreset(preset, index),
  isPerforming: () => s.dock === 'perform',
  onToggleCollapse: () => toggleSidePanel('--browser-w', 260),
  reanalyze: async id => { if (s.track?.id !== id) await selectTrack(id); await analyze(id); },
  onDeleted: id => { if (s.track?.id === id) { s.track = null; s.analysis = null; audio.pause(); audio.removeAttribute('src'); store.replace(emptyTimeline()); trackTitle.textContent = 'Nema odabrane pjesme'; playlist.renderHeads(); editor.render(); syncPlay(); playlist.redraw(); } },
  onRenamed: id => { if (s.track?.id === id) browser.refresh().then(tracks => { const t = tracks.find(x => x.id === id); if (t) { s.track = { ...s.track, ...t }; trackTitle.textContent = t.title; playlist.renderHeads(); } }); }
});

/* -------------------------------------------------------------- tempo/grid */
gridBtn.onclick = () => {
  const r = gridBtn.getBoundingClientRect(), manual = () => Boolean(hasTrack());
  const retime = (label, mutate) => { if (hasTrack()) { const result = store.commit(label, t => { mutate(t); t.gridMode = 'manual'; }); if (result.error) status(result.error); } };
  showMenu(r.left, r.bottom + 4, [
    { label: 'Postavi Beat 1 na playhead (sinkronizacija)', disabled: !manual(), onClick: () => retime('Beat 1', t => { t.beatOffsetSec = songTime(); }) },
    { label: 'Nudge mrežu −10 ms (ranije)', disabled: !manual(), onClick: () => retime('Nudge −10ms', t => { t.beatOffsetSec = Math.max(0, (t.beatOffsetSec || 0) - 0.01); }) },
    { label: 'Nudge mrežu +10 ms (kasnije)', disabled: !manual(), onClick: () => retime('Nudge +10ms', t => { t.beatOffsetSec = (t.beatOffsetSec || 0) + 0.01; }) },
    { label: 'Nudge mrežu −⅛ beata', disabled: !manual(), onClick: () => retime('Nudge −⅛', t => { t.beatOffsetSec = Math.max(0, (t.beatOffsetSec || 0) - (60 / t.bpm) * 0.125); }) },
    { label: 'Nudge mrežu +⅛ beata', disabled: !manual(), onClick: () => retime('Nudge +⅛', t => { t.beatOffsetSec = (t.beatOffsetSec || 0) + (60 / t.bpm) * 0.125; }) },
    { separator: true },
    { label: 'Tempo ½', disabled: !manual(), onClick: () => retime('Tempo ½', t => { t.bpm = clamp(t.bpm / 2, 40, 240); }) },
    { label: 'Tempo 2×', disabled: !manual(), onClick: () => retime('Tempo 2×', t => { t.bpm = clamp(t.bpm * 2, 40, 240); }) },
    { separator: true },
    { label: 'Vrati mrežu iz analize', disabled: !hasTrack() || tl().gridMode !== 'manual', onClick: () => store.commit('Mreža iz analize', t => { t.gridMode = 'analysis'; t.bpm = clamp(s.analysis.bpm || t.bpm, 40, 240); t.beatOffsetSec = s.analysis.beatsSec?.[0] ?? t.beatOffsetSec; }) }
  ]);
};

/* ------------------------------------------------------------ isolation bar */
const isoClipBtn = h('button', { type: 'button', class: 'iso-btn', title: 'Svijetli samo odabrani clip (ignorira mute/solo slojeva i druge clipove). Radi i na stvarnom izlazu.', onClick: () => { s.iso.clip = !s.iso.clip; if (s.iso.clip && !playlist.selection.length) status('Odaberi clip pa će svijetliti samo on.'); syncIso(); } }, 'Solo clip');
const isoBypassBtn = h('button', { type: 'button', class: 'iso-btn', title: 'Privremeno isključi audio driver pa vidiš sam efekt i envelope', onClick: () => { s.iso.bypass = !s.iso.bypass; syncIso(); } }, 'Bez drivera');
const isoLoopBtn = h('button', { type: 'button', class: 'iso-btn', title: 'Vrti petlju točno preko odabranog clipa dok namještaš', onClick: () => {
  const hit = playlist.selection[0] && findClip(tl(), playlist.selection[0]); if (!hit) { status('Odaberi clip za petlju.'); return; }
  const start = hit.clip.startSec, end = clipEnd(hit.clip);
  if (s.loopOn && s.loop && Math.abs(s.loop.start - start) < .01 && Math.abs(s.loop.end - end) < .01) setLoop(null);
  else { setLoop({ start, end }); seek(start); if (audio.paused && s.track) audio.play().catch(() => {}); syncPlay(); }
} }, 'Petlja clip');
const isoBar = h('div', { class: 'iso-bar', role: 'group', 'aria-label': 'Izolacija za namještanje' }, h('span', { class: 'iso-label' }, 'Izoliraj'), isoClipBtn, isoBypassBtn, isoLoopBtn);
function syncIso() {
  for (const [btn, on] of [[isoClipBtn, s.iso.clip], [isoBypassBtn, s.iso.bypass]]) { btn.classList.toggle('on', on); btn.setAttribute('aria-pressed', String(on)); }
  isoBar.classList.toggle('active', s.iso.clip || s.iso.bypass);
}

/* -------------------------------------------------------------- spectrum */
const spectrumCache = new Map();
let spectrumDraw = 0;
async function ensureSpectrum() {
  const id = s.track?.id, analysis = s.analysis; if (!id || !analysis || analysis.spectrum) return;
  if (spectrumCache.has(id)) { analysis.spectrum = spectrumCache.get(id); s.spectrumState = 'ready'; editor.render(); return; }
  s.spectrumState = 'loading'; s.spectrumProgress = 0;
  try {
    const response = await fetch(`/api/library/audio/${id}`); if (!response.ok) throw new Error(`audio ${response.status}`);
    const Ctor = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const decoded = await new Ctor(1, 1, 44100).decodeAudioData(await response.arrayBuffer());
    if (s.track?.id !== id) return;
    const mono = new Float32Array(decoded.length), channels = decoded.numberOfChannels;
    for (let c = 0; c < channels; c++) { const data = decoded.getChannelData(c); for (let i = 0; i < mono.length; i++) mono[i] += data[i] / channels; }
    const spectrum = await computeSpectrum(mono, decoded.sampleRate, { onProgress: p => { s.spectrumProgress = p; if (performance.now() - spectrumDraw > 250) { spectrumDraw = performance.now(); driverEditor.draw(); } } });
    spectrumCache.set(id, spectrum);
    if (s.track?.id !== id) return;
    s.analysis.spectrum = spectrum; s.spectrumState = 'ready'; editor.render(); playlist.redraw();
  } catch (error) { console.error(error); s.spectrumState = 'error'; editor.render(); }
}

/* ----------------------------------------------------------------- docks */
const dockMinBtn = h('button', {
  type: 'button',
  id: 'dock-min-btn',
  class: 'dock-min-btn',
  title: 'Minimiziraj / proširi urednik (dostupno i dvoklikom na razdjelnik)',
  onClick: () => toggleDock()
}, '▾');

const DOCKS = [['clip', 'Clip', clipPane], ['envelope', 'Envelope', envPane], ['driver', 'Audio driver (EQ)', driverPane], ['mixer', 'Mixer', mixerPane], ['perform', 'Live board', performancePane], ['live', 'Audio uživo', livePane], ['output', 'Izlaz', outputPane]];
function switchDock(id) {
  if (id === 'perform' && s.dock !== 'perform') {
    s.performPrevDock = getComputedStyle(document.documentElement).getPropertyValue('--dock-h').trim();
    document.documentElement.style.setProperty('--dock-h', localStorage.getItem('ledicated-perform-dock-h') || `${Math.min(560, Math.max(330, innerHeight - 230))}px`);
  } else if (s.dock === 'perform' && id !== 'perform' && s.performPrevDock) {
    localStorage.setItem('ledicated-perform-dock-h', getComputedStyle(document.documentElement).getPropertyValue('--dock-h').trim());
    document.documentElement.style.setProperty('--dock-h', s.performPrevDock);
    localStorage.setItem('ledicated--dock-h', s.performPrevDock);
    s.performPrevDock = null;
  }
  s.dock = id;
  app.classList.toggle('performing', id === 'perform');
  const curH = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dock-h'));
  if (curH <= 50) {
    const saved = localStorage.getItem('ledicated-saved---dock-h') || '320px';
    document.documentElement.style.setProperty('--dock-h', saved);
    dockMinBtn.textContent = '▾';
    dockMinBtn.title = 'Minimiziraj urednik';
  }
  for (const [key, , pane] of DOCKS) pane.hidden = key !== id;
  dockTabs.replaceChildren(
    ...DOCKS.map(([key, label]) => h('button', {
      type: 'button',
      role: 'tab',
      id: `tab-${key}`,
      'aria-selected': String(key === id),
      class: key === id ? 'on' : '',
      onClick: () => switchDock(key)
    }, label)),
    isoBar,
    dockMinBtn
  );
  if (id === 'mixer') { mixer.render(); s.mixerStale = false; }
  if (id === 'clip' || id === 'driver' || id === 'envelope') editor.render();
}
document.getElementById('out-open').onclick = () => switchDock('output');
const performOpen = h('button', { type: 'button', id: 'perform-open', class: 'txt-btn', title: 'Otvori izvedbeni board (tipka P)', onClick: () => switchDock('perform') }, 'LIVE BOARD');
document.getElementById('out-open').before(performOpen);
switchDock('clip'); setTool('draw'); updateHistoryButtons(); updateGridButton();

/* ------------------------------------------------------------ edit actions */
const refsNow = () => playlist.selection;
function deleteSelection() { const refs = refsNow(); if (!refs.length) return; store.commit('Obriši clipove', t => deleteClips(t, refs)); playlist.setSelection([]); }
function copySelection() { s.clipboard = copyClips(tl(), refsNow()); if (s.clipboard) status(`Kopirano: ${s.clipboard.items.length}`); }
function pasteSelection() {
  if (!s.clipboard) return status('Međuspremnik je prazan.');
  let created; const result = store.commit('Zalijepi', t => { created = pasteClips(t, s.clipboard, s.scrubSec, s.activeLayer); });
  if (!result.error) playlist.setSelection(created);
}
function duplicateSelection() {
  const hits = refsNow().map(ref => findClip(tl(), ref)).filter(Boolean); if (!hits.length) return;
  const length = Math.max(...hits.map(x => clipEnd(x.clip))) - Math.min(...hits.map(x => x.clip.startSec));
  let created; const result = store.commit('Dupliciraj', t => { created = duplicateClips(t, refsNow(), length, 0); });
  if (!result.error) playlist.setSelection(created);
}
function nudgeSelection(direction) {
  const hits = refsNow().map(ref => findClip(tl(), ref)).filter(Boolean); if (!hits.length) return false;
  const step = snapStepSec(snapMode(), tl(), s.analysis, Math.min(...hits.map(x => x.clip.startSec)));
  const refs = refsNow(); store.commit('Pomakni clipove', t => { const lowest = Math.min(...refs.map(r => findClip(t, r).clip.startSec)); const delta = Math.max(-lowest, direction * step); for (const r of refs) findClip(t, r).clip.startSec += delta; });
  return true;
}

/* ---------------------------------------------------------------- blackout */
async function blackout() {
  const active = !live.engine.state.blackout; live.setBlackout(active);
  if (active) performDesk.clear();
  blackoutBtn.setAttribute('aria-pressed', String(active)); blackoutBtn.classList.toggle('on', active);
  if (active) { output.disarm(); await output.blackout(); toast('Blackout · izlaz je isključen. Za nastavak ponovno uključi izlaz.', 'error'); status('Blackout aktivan.'); }
  else status('Blackout otpušten.');
}
blackoutBtn.onclick = blackout;

/* ---------------------------------------------------------------- shortcuts */
const help = h('dialog', { id: 'gesture-help', class: 'help' },
  h('div', { class: 'pane-title' }, h('b', {}, 'PREČACI I GESTE'), h('button', { type: 'button', id: 'close-help', onClick: () => help.close() }, 'Zatvori')),
  h('dl', {}, [
    ['Space', 'Reproduciraj / pauziraj'], ['Home / End', 'Početak / kraj pjesme'], ['← / →', 'Pomakni odabrane clipove za snap korak (bez odabira: kadar playheada); ⇧ = 1 s'], ['1 · 2 · 3 · 4', 'Alati: Crtaj, Odaberi, Podijeli, Briši'],
    ['⌘Z · ⇧⌘Z', 'Poništi / ponovi'], ['⌘C · ⌘X · ⌘V', 'Kopiraj / izreži / zalijepi na playhead'], ['⌘D', 'Dupliciraj odabrano iza sebe'], ['⌘A', 'Odaberi sve clipove'], ['⌫ / Delete', 'Obriši odabrano'], ['⌘S', 'Spremi odmah'],
    ['L · F', 'Loop uključi/isključi · Prati playhead'], ['P', 'Otvori Live board'], ['Q W E R / A S D F / Z X C V', 'Kratko: udar ili uključi/isključi petlju. Drži: efekt traje do otpuštanja. Radi u svim panelima.'], ['+ / − / 0', 'Zoom · prikaži cijelu pjesmu'], ['Esc', 'Blackout'],
    ['Pinch / ⌘ + kotačić', 'Zoom oko pokazivača'], ['Dva prsta lijevo/desno', 'Pomak playlista'], ['⌥ + povuci clip', 'Dupliciraj dok pomičeš'], ['Desni klik na clip', 'Obriši clip'], ['Dvaput klik na clip', 'Otvori u uredniku'], ['Envelope: dvaput klik', 'Nova točka (keyframe)'], ['Envelope: desni klik ili ⌥ + klik', 'Obriši točku'], ['⇧ dok povlačiš točku', 'Fino pomicanje bez snapa']
  ].flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])));
document.body.append(help);
document.getElementById('help-open').onclick = () => help.showModal();

const typing = el => /^(INPUT|SELECT|TEXTAREA)$/.test(el?.tagName || '') && !(el.type === 'checkbox' || el.type === 'button' || el.type === 'range');
// Performance keys are global: the lighting instrument keeps playing while
// any dock, slider, color picker or editable field has focus.
document.addEventListener('keydown', event => {
  if (event.repeat || event.isComposing || event.metaKey || event.ctrlKey || event.altKey) return;
  const index = PAD_KEYS.indexOf(event.key.toLowerCase());
  if (index < 0) return;
  performDesk.press(index, { select: false });
  if (!typing(event.target) && !event.target?.isContentEditable) event.preventDefault();
}, true);
document.addEventListener('keyup', event => {
  const index = PAD_KEYS.indexOf(event.key.toLowerCase());
  if (index >= 0) performDesk.release(index);
}, true);
window.addEventListener('blur', () => performDesk.releaseAll());
document.addEventListener('visibilitychange', () => { if (document.hidden) performDesk.releaseAll(); });
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') { if (document.querySelector('dialog[open]') || event.defaultPrevented) return; closeMenu(); if (!live.engine.state.blackout) blackout(); return; }
  if (typing(event.target) || document.querySelector('dialog[open]')) return;
  const mod = event.metaKey || event.ctrlKey, key = event.key.toLowerCase();
  if (event.code === 'Space') { event.preventDefault(); togglePlay(); return; }
  if (mod && key === 'z') { event.preventDefault(); event.shiftKey ? redoBtn.click() : undoBtn.click(); return; }
  if (mod && key === 'y') { event.preventDefault(); redoBtn.click(); return; }
  if (mod && key === 's') { event.preventDefault(); saveBtn.click(); return; }
  if (mod && key === 'a') { event.preventDefault(); playlist.selectAll(); return; }
  if (mod && key === 'c') { event.preventDefault(); copySelection(); return; }
  if (mod && key === 'x') { event.preventDefault(); copySelection(); deleteSelection(); return; }
  if (mod && key === 'v') { event.preventDefault(); pasteSelection(); return; }
  if (mod && key === 'd') { event.preventDefault(); duplicateSelection(); return; }
  if (mod || event.altKey) return;
  if (PAD_KEYS.includes(key)) return;
  if (key === 'p') { switchDock('perform'); return; }
  if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); deleteSelection(); return; }
  if (['1', '2', '3', '4'].includes(event.key)) { setTool(TOOLS[Number(event.key) - 1][0]); return; }
  if (key === 'l') { loopBtn.click(); return; }
  if (key === 'f') { followBtn.click(); return; }
  if (event.key === '?') { help.showModal(); return; }
  if (event.key === 'Home') { event.preventDefault(); seek(0); return; }
  if (event.key === 'End') { event.preventDefault(); seek(duration()); return; }
  if (event.key === '+' || event.key === '=') { playlist.zoomAround(1.3, songTime()); return; }
  if (event.key === '-') { playlist.zoomAround(1 / 1.3, songTime()); return; }
  if (event.key === '0') { playlist.fit(); return; }
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    event.preventDefault(); const direction = event.key === 'ArrowRight' ? 1 : -1;
    if (!event.shiftKey && nudgeSelection(direction)) return;
    seek(songTime() + direction * (event.shiftKey ? 1 : 1 / 30));
  }
});

/* ----------------------------------------------------- global file dropping */
let dragDepth = 0;
const hasFiles = event => [...(event.dataTransfer?.types || [])].includes('Files');
addEventListener('dragenter', event => { if (hasFiles(event)) { dragDepth++; dropOverlay.classList.add('show'); } });
addEventListener('dragleave', event => { if (hasFiles(event)) { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) dropOverlay.classList.remove('show'); } });
addEventListener('dragover', event => { if (hasFiles(event)) event.preventDefault(); });
addEventListener('drop', event => { if (!hasFiles(event)) return; event.preventDefault(); dragDepth = 0; dropOverlay.classList.remove('show'); browser.importFiles([...event.dataTransfer.files]); });

/* --------------------------------------------------------------- frame loop */
const effectiveTimeline = () => {
  const solo = playlist.solo, sel = playlist.selection, isoClip = s.iso.clip && sel.length > 0;
  if (!solo.size && !isoClip && !s.iso.bypass) return tl();
  const keys = new Set(sel.map(refKey));
  return {
    ...tl(), layers: tl().layers.map(layer => {
      const clips = (isoClip ? layer.clips.filter(c => keys.has(`${layer.id}/${c.id}`)) : layer.clips).map(c => s.iso.bypass ? { ...c, driver: 'none' } : c);
      const enabled = isoClip ? clips.length > 0 : layer.enabled && (!solo.size || solo.has(layer.id));
      return { ...layer, enabled, clips };
    })
  };
};
function timelineFrame(t = now()) {
  if (live.frozen) { if (s.frozenSec === null) s.frozenSec = songTime(); } else s.frozenSec = null;
  const time = clamp((s.frozenSec ?? songTime()) + output.offsetSec, 0, duration());
  const calibration = output.calibrationFrame(masterKnob.value); if (calibration) return calibration;
  const base = renderTimelineFrame(effectiveTimeline(), s.analysis, time, null), master = clamp(masterKnob.value / 60, 0, 1);
  const rendered = performDesk.render(base, t, tl().bpm, 1, s.analysis, time);
  for (const id of BAR_IDS) for (const pixel of rendered.bars[id]) for (let c = 0; c < 4; c++) pixel[c] = Math.round(pixel[c] * master);
  return rendered;
}
const frameLevel = frame => { let sum = 0, n = 0; for (const id of BAR_IDS) for (const p of frame.bars[id]) { sum += Math.max(...p); n++; } return n ? Math.sqrt(sum / n / 153) : 0; };
function updateMeters(time) {
  const levels = {}, solo = playlist.solo;
  for (const layer of tl().layers) levels[layer.id] = !layer.enabled || (solo.size && !solo.has(layer.id)) ? 0 : frameLevel(renderTimelineFrame({ ...tl(), layers: [{ ...layer, enabled: true }] }, s.analysis, time, null));
  mixer.levels(levels, hasTrack() ? frameLevel(renderTimelineFrame(effectiveTimeline(), s.analysis, time, null)) * clamp(masterKnob.value / 60, 0, 1) : live.level, stemsEngine.getStemLevels());
}
function updateTelemetry(frame) {
  if (!frame?.bars) return;
  let sumR = 0, sumG = 0, sumB = 0, sumW = 0, totalPixels = 0;
  for (const id of BAR_IDS) {
    const list = frame.bars[id];
    if (!list) continue;
    for (const [r, g, b, w] of list) {
      sumR += r; sumG += g; sumB += b; sumW += w;
      totalPixels++;
    }
  }
  if (!totalPixels) return;
  const maxPossible = totalPixels * 153;
  const pctR = Math.min(100, Math.round((sumR / maxPossible) * 100));
  const pctG = Math.min(100, Math.round((sumG / maxPossible) * 100));
  const pctB = Math.min(100, Math.round((sumB / maxPossible) * 100));
  const pctW = Math.min(100, Math.round((sumW / maxPossible) * 100));

  vuR.style.width = `${pctR}%`;
  vuG.style.width = `${pctG}%`;
  vuB.style.width = `${pctB}%`;
  vuW.style.width = `${pctW}%`;

  const avgLevel = (sumR + sumG + sumB + sumW) / (maxPossible * 4);
  const watts = Math.round(8 + avgLevel * 192);
  const wattsPct = Math.min(100, Math.round((watts / 400) * 100));

  powerValue.textContent = `${watts} W`;
  powerPct.textContent = `${wattsPct}% / 400W`;
  powerBar.style.width = `${wattsPct}%`;

  const isLive = badge.classList.contains('live');
  teleMode.textContent = isLive ? 'DDP UKLJUČEN' : 'SIMULACIJA';
  teleMode.classList.toggle('live', isLive);
}

function updateActiveNow(time) {
  const cards = [];
  for (const [index] of performDesk.desk.active) {
    const pad = performDesk.desk.pads[index];
    if (!pad) continue;
    cards.push(h('div', { class: 'active-layer-card', style: { '--layer': '#f5a524' } },
      h('span', { class: 'alc-dot' }), h('span', { class: 'alc-name' }, `LIVE ${'QWERASDFZXCV'[index]}`),
      h('span', { class: 'alc-preset' }, PRESET_LABELS[pad.preset] || pad.preset),
      h('span', { class: 'alc-targets' }, pad.targets === 'all' ? 'Svi barovi' : pad.targets.join(' '))));
  }
  for (const layer of tl().layers) {
    if (!layer.enabled) continue;
    for (const clip of layer.clips) {
      if (time >= clip.startSec && time < clipEnd(clip)) {
        const targetText = clip.targets === 'all' ? 'Svi barovi (9)' : (Array.isArray(clip.targets) ? clip.targets.join(' ') : 'Odabrano');
        cards.push(h('div', { class: 'active-layer-card', style: { '--layer': layer.color || '#3aa0ff' } },
          h('span', { class: 'alc-dot' }),
          h('span', { class: 'alc-name' }, layer.name || layer.id),
          h('span', { class: 'alc-preset' }, PRESET_LABELS[clip.preset] || clip.preset),
          h('span', { class: 'alc-targets' }, targetText)
        ));
      }
    }
  }
  if (cards.length) {
    activeNow.replaceChildren(...cards);
  } else {
    activeNow.replaceChildren(h('div', { class: 'active-empty' },
      hasTrack() ? 'Nema aktivnih clipova na ovoj poziciji playheada.' : 'Uživo scena upravlja svjetlom dok nije odabrana pjesma.'
    ));
  }
}

let lastText = '', lastPerformSignal = '';
function tick() {
  const t = now(); live.tick(t);
  if (s.loopOn && s.loop && !audio.paused && audio.currentTime >= s.loop.end) audio.currentTime = s.loop.start;
  performDesk.tick(t);
  const performSignal = `${performDesk.desk.active.size}|${performDesk.desk.pending.size}`;
  if (performSignal !== lastPerformSignal) {
    lastPerformSignal = performSignal;
    const activeCount = performDesk.desk.active.size, queuedCount = performDesk.desk.pending.size;
    performOpen.textContent = activeCount ? `LIVE BOARD · ${activeCount}` : queuedCount ? `LIVE BOARD · ${queuedCount} ČEKA` : 'LIVE BOARD';
    performOpen.classList.toggle('on-air', activeCount > 0);
    performOpen.classList.toggle('waiting', queuedCount > 0 && !activeCount);
    performOpen.setAttribute('aria-label', activeCount ? `Live board, ${activeCount} aktivnih efekata` : queuedCount ? `Live board, ${queuedCount} efekata čeka beat` : 'Live board');
  }
  const blackoutOn = live.engine.state.blackout;
  const frame = blackoutOn ? live.frame(t) : hasTrack() ? timelineFrame(t) : performDesk.render(live.frame(t), t, live.engine.clock.bpm, clamp(masterKnob.value / 60, 0, 1), null, 0);
  if (output.config) preview.render(frame, output.config);
  output.send(frame, t);
  const time = songTime(), text = formatBBT(hasTrack() ? Math.max(0, beatPosition(time, tl(), s.analysis)) : 0) + '|' + formatClock(time);
  if (text !== lastText) { lastText = text; const [bbt, clock] = text.split('|'); bbtEl.textContent = bbt; clockEl.textContent = clock; }
  if (s.follow && !audio.paused) playlist.ensureVisible(time, true);
  if (s.dock === 'clip' && !audio.paused) editor.draw();
  if (s.dock === 'driver') driverEditor.tick();
  if (t - s.lastLevels > .066) {
    s.lastLevels = t;
    if (s.dock === 'mixer') updateMeters(time);
    updateTelemetry(frame);
  }
  if (t - s.lastActive > .15) { s.lastActive = t; if (hasTrack()) updateActiveNow(time); else if (!activeNow.firstChild || activeNow.dataset.mode !== 'live') { activeNow.dataset.mode = 'live'; updateActiveNow(time); } }
  requestAnimationFrame(tick);
}

await output.init();
document.getElementById('render-mode').textContent = `${preview.mode === 'webgl2' ? 'WEBGL2' : 'CANVAS 2D'}`;
browser.refresh().then(tracks => { if (tracks.length) return selectTrack(tracks[0].id); }).catch(error => status(error.message));
requestAnimationFrame(tick);
// Exposed for deterministic browser smoke tests, not a second render path.
window.studioTest = { engine: live.engine, store, playlist, performance: performDesk, getFrame: () => (live.engine.state.blackout ? live.frame(now()) : hasTrack() ? timelineFrame() : performDesk.render(live.frame(now()), now(), live.engine.clock.bpm, clamp(masterKnob.value / 60, 0, 1), null, 0)), getConfig: () => output.config, state: s, seek, commitSeek, setTool };
