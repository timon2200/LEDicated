/** LEDicated studio: FL-Studio-style workspace. Wires the playlist, clip editor,
 * mixer, live desk and output together around one undoable timeline store.
 * One deterministic function (renderTimelineFrame) produces the RGBW frame that
 * feeds both the WebGL preview and the WLED/DDP output.
 */
import { BAR_IDS } from './engine.mjs';
import { createAutoShow, renderTimelineFrame, validateTimeline } from './timeline.mjs';
import { createShowEngine } from './show-engine.mjs';
import { createLedPreview } from './led-preview.mjs';
import { installTooltips } from './tooltips.mjs';
import {
  SNAP_MODES, addClip, beatPosition, timeAtBeat, clamp, clipEnd, copyClips, createStore, deleteClips, duplicateClips, findClip, formatBBT, formatClock, normalizeTimeline,
  pasteClips, refKey, snapStepSec, uid
} from './daw-state.mjs';
import { applyTimelineOp } from './daw-remote.mjs';
import { createKnob, createDragNumber, h, hexToRgb, showMenu, toast, closeMenu } from './daw-ui.mjs';
import { createPlaylist, LANE_HEIGHTS, PRESET_LABELS } from './daw-playlist.mjs';
import { createClipEditor } from './daw-editor.mjs';
import { createDriverEditor } from './daw-driver.mjs';
import { computeSpectrum, getSpectrumForSource } from './audio-spectrum.mjs';
import { createMixer } from './daw-mixer.mjs';
import { createStemsEngine } from './daw-stems.mjs';
import { createLive } from './daw-live.mjs';
import { createPerformancePanel } from './daw-performance.mjs';
import { createSessionRecorder } from './live-session-recorder.mjs';
import { PAD_KEYS } from './live-performance-state.mjs';
import { createOutput } from './daw-output.mjs';
import { createBrowser, libraryApi } from './daw-browser.mjs';
import { detectSections } from './audio-sections.mjs';

const now = () => performance.now() / 1000;
const ICONS = {
  play: '<path d="M4 2.5v11l9-5.5z"/>', pause: '<path d="M4 2.5h3v11H4zM9 2.5h3v11H9z"/>', stop: '<rect x="3.5" y="3.5" width="9" height="9" rx="1"/>',
  record: '<circle cx="8" cy="8" r="5.2"/>',
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
const recBtn = h('button', { type: 'button', id: 'rec', class: 'tbtn rec', title: 'Snimaj live izvedbu (⇧R). Bilježi padove i promjene postavki na vremensku traku.', 'aria-label': 'Snimaj izvedbu', 'aria-pressed': 'false', disabled: true }, icon('record'));
const loopBtn = h('button', { type: 'button', id: 'loop', class: 'tbtn', title: 'Loop regije (L). Povuci po donjem pojasu ravnala za regiju.', 'aria-pressed': 'false', 'aria-label': 'Loop' }, icon('loop'));
const followBtn = h('button', { type: 'button', id: 'follow', class: 'tbtn on', title: 'Prati playhead (F)', 'aria-pressed': 'true', 'aria-label': 'Prati playhead' }, icon('follow'));
const undoBtn = h('button', { type: 'button', id: 'undo', class: 'tbtn', title: 'Poništi (⌘Z)', 'aria-label': 'Poništi', disabled: true }, icon('undo'));
const redoBtn = h('button', { type: 'button', id: 'redo', class: 'tbtn', title: 'Ponovi (⇧⌘Z)', 'aria-label': 'Ponovi', disabled: true }, icon('redo'));
const saveBtn = h('button', { type: 'button', id: 'save', class: 'tbtn', title: 'Spremi (⌘S). Sprema se i automatski.', 'aria-label': 'Spremi' }, icon('save'));
const snapSelect = h('select', { id: 'snap', 'aria-label': 'Snap', title: 'Preciznost poravnanja na beat' }, Object.entries(SNAP_MODES).map(([value, label]) => h('option', { value, selected: value === '1' }, label)));
const gridBtn = h('button', { type: 'button', id: 'grid-menu', class: 'txt-btn', title: 'Tempo i mreža pjesme' }, 'Mreža ▾');
const toolButtons = TOOLS.map(([id, label, key, tip]) => h('button', { type: 'button', class: 'tbtn tool', dataset: { tool: id }, title: `${label} (${key}). ${tip}`, 'aria-label': label, 'aria-pressed': 'false' }, icon(id)));
const trackTitleName = h('span', { class: 'tl-name' }, 'Nema odabrane pjesme');
const trackTitleBpm = h('span', { class: 'tl-bpm-badge', hidden: true }, '');
const trackTitle = h('button', {
  type: 'button',
  id: 'project-title',
  class: 'track-launcher-pill',
  title: 'Katalog pjesama i show launcher (⌘O)',
  'aria-label': 'Katalog pjesama',
  onClick: () => browser.openLauncher?.()
},
  h('span', { class: 'tl-icon' }, '🎵'),
  trackTitleName,
  trackTitleBpm,
  h('span', { class: 'tl-chevron' }, '⊞ ▾')
);
function updateTrackTitle(title, bpm = null) {
  trackTitleName.textContent = title || 'Nema odabrane pjesme';
  if (bpm && bpm >= 40) {
    trackTitleBpm.hidden = false;
    trackTitleBpm.textContent = `${Math.round(bpm)} BPM`;
  } else {
    trackTitleBpm.hidden = true;
  }
}
const clientId = (() => {
  try {
    let cid = sessionStorage.getItem('ledicated-client-id');
    if (!cid) {
      cid = `peer-${uid()}-${Math.random().toString(36).slice(2, 6)}`;
      sessionStorage.setItem('ledicated-client-id', cid);
    }
    return cid;
  } catch {
    return `peer-${uid()}`;
  }
})();
let clientName = (() => {
  try {
    return localStorage.getItem('ledicated-user-name') || `DJ-${clientId.slice(-4).toUpperCase()}`;
  } catch {
    return `DJ-${clientId.slice(-4).toUpperCase()}`;
  }
})();
window.ledicatedClientId = clientId;
window.ledicatedClientName = clientName;
window.ledicatedIsStageOwner = true;
window.ledicatedPeerCount = 1;

const lanBtn = h('button', {
  type: 'button',
  id: 'lan-open',
  class: 'txt-btn lan-btn on-air',
  title: 'Uredski LAN, Stage kontrola (ON AIR / SOLO) i dijeljenje showova'
}, '🌐 LAN · ON AIR');
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
const masterKnob = createKnob({ label: 'MASTER', value: 100, min: 0, max: 100, step: 1, size: 40, reset: 100, warnAbove: 85, format: v => `${Math.round(v)}%`, title: 'Master svjetlina (0–100%). Puna snaga na 100%.', onInput: v => { live.setBrightness(v); mixer.setMaster(v); } });

const header = h('header', { class: 'topbar' },
  h('div', { class: 'brand' }, h('span', { class: 'mark' }, 'L', h('i', {}, '•')), h('div', {}, h('strong', {}, 'LEDicated'), h('small', {}, 'SHOW STUDIO'))),
  h('div', { class: 'tgroup transport' }, stopBtn, playBtn, recBtn, loopBtn, followBtn),
  h('div', { class: 'lcd', title: 'Takt:beat:tik i vrijeme' }, bbtEl, clockEl),
  h('div', { class: 'tgroup' }, bpmNumber.element, bpmTapBtn, gridBtn),
  h('div', { class: 'tgroup' }, h('span', { class: 'glabel' }, icon('magnet')), snapSelect),
  h('div', { class: 'tgroup tools', role: 'group', 'aria-label': 'Alati' }, toolButtons),
  h('div', { class: 'tgroup' }, undoBtn, redoBtn, saveBtn),
  trackTitle,
  h('div', { class: 'tgroup right' }, masterKnob.element, badge, lanBtn, h('button', { type: 'button', id: 'out-open', class: 'txt-btn', title: 'Postavke izlaza i kalibracija' }, 'Izlaz'), h('button', { type: 'button', id: 'help-open', class: 'tbtn', title: 'Prečaci tipkovnice (?)', 'aria-label': 'Prečaci' }, icon('help')), blackoutBtn));

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
const powerMeter = h('div', { class: 'tele-bar', title: 'Procjena potrošnje 24 V WS2814 traka i kontrolera' }, powerBar);

const vuR = h('div', { class: 'tele-fill r' });
const vuG = h('div', { class: 'tele-fill g' });
const vuB = h('div', { class: 'tele-fill b' });
const vuW = h('div', { class: 'tele-fill w' });
const meterR = h('div', { class: 'tele-bar mini', title: 'Crveni kanal (R)' }, vuR);
const meterG = h('div', { class: 'tele-bar mini', title: 'Zeleni kanal (G)' }, vuG);
const meterB = h('div', { class: 'tele-bar mini', title: 'Plavi kanal (B)' }, vuB);
const meterW = h('div', { class: 'tele-bar mini', title: 'Topla bijela (W)' }, vuW);

const teleNodes = h('span', { class: 'tele-tag' }, '1 KONTROLER · 648 LED');
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

const stageLiveBanner = h('div', {
  id: 'stage-live-banner',
  class: 'stage-live-banner is-idle',
  role: 'region',
  'aria-label': 'Status stagea i trenutna reprodukcija'
});

const stagePanel = h('section', { class: 'stage-panel', 'aria-label': 'Svjetlo' },
  stageSection,
  stageLiveBanner,
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
const showEngine = createShowEngine({ fps: 60, lookaheadSec: 25, lookbehindSec: 2 });
const s = { track: null, analysis: null, scrubSec: 0, playFrom: 0, loop: null, loopOn: false, follow: true, tool: 'draw', activeLayer: 0, token: 0, dock: 'clip', audioMuted: false, volume: 1, clipboard: null, brush: { preset: 'pulse', driver: 'none', driverGain: 1, targets: 'all' }, frozenSec: null, iso: { clip: false, bypass: false }, spectrumState: 'none', saveTimer: 0, pendingSave: null, lastLevels: 0, lastActive: 0, mixerStale: true };
const tl = () => store.timeline;
const hasTrack = () => Boolean(s.track && s.analysis);
const duration = () => s.analysis?.durationSec || tl().durationSec || audio.duration || 60;
const songTime = () => audio.paused ? s.scrubSec : audio.currentTime;
const snapMode = () => snapSelect.value === 'none' || snapSelect.value === 'bar' ? snapSelect.value : Number(snapSelect.value);

const liveHost = h('div', { class: 'live-grid' }); livePane.append(liveHost);
const live = createLive(liveHost, { now, status });
live.setBrightness(masterKnob.value);
const preview = createLedPreview(stage.querySelector('#bar-grid'), stageSection);
const outputHost = h('div', { class: 'live-grid' }); outputPane.append(outputHost);
const output = createOutput(outputHost, {
  badge,
  status,
  isBlackout: () => live.engine.state.blackout,
  onConfig: config => {
    preview.configure(config);
    if (config) {
      const nodeCount = config.nodes?.length || 1;
      const ledCount = (config.bars || []).reduce((sum, bar) => sum + (bar.physicalLeds || 72), 0) || 648;
      const nodeWord = nodeCount === 1 ? 'KONTROLER' : 'KONTROLERA';
      teleNodes.textContent = `${nodeCount} ${nodeWord} · ${ledCount} LED`;
    }
  }
});
let recorder;
recorder = createSessionRecorder({
  store,
  desk: null,
  getTime: songTime,
  getBpm: () => hasTrack() ? tl().bpm : live.engine.clock.bpm,
  isPlaying: () => !audio.paused && hasTrack(),
  hasTrack,
  onStateChange: ({ armed, recording }) => {
    recBtn.classList.toggle('on', armed);
    recBtn.classList.toggle('rec-active', recording);
    recBtn.setAttribute('aria-pressed', String(armed));
    performDesk?.syncRecState?.({ armed, recording });
  },
  status
});

const performDesk = createPerformancePanel(performancePane, {
  status, songTime, clockTime: now, playing: () => !audio.paused && hasTrack(), hasTrack,
  bpm: () => hasTrack() ? tl().bpm : live.engine.clock.bpm,
  beatOffset: () => hasTrack() ? tl().beatOffsetSec : 0,
  beatTimes: () => hasTrack() && tl().gridMode !== 'manual' ? (s.analysis?.beatsSec || s.analysis?.beats || null) : null,
  analysis: () => s.analysis, duration, trackId: () => s.track?.id || null,
  trackTitle: () => s.track?.title || s.track?.originalName || '',
  seek, commitSeek, setLoop, loop: () => s.loop ? { ...s.loop, on: s.loopOn } : null,
  blackout: () => live.engine.state.blackout,
  recorder,
  toggleRecord: () => recBtn.click(),
  onPadsChange: (pads, quantize) => {
    fetch('/api/live/pads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId, clientName, pads, quantize })
    }).catch(() => {});
  }
});
recorder.desk = performDesk.desk;

recBtn.onclick = () => {
  if (!hasTrack()) return status('Odaberi pjesmu prije snimanja izvedbe.');
  recorder.toggleArmed();
  if (recorder.isArmed && audio.paused) {
    togglePlay();
  }
};

/* --------------------------------------------------------------- playhead */
function syncPlay() {
  const playing = !audio.paused;
  playBtn.replaceChildren(icon(playing ? 'pause' : 'play')); playBtn.classList.toggle('on', playing);
  playBtn.setAttribute('aria-label', playing ? 'Pauziraj' : 'Reproduciraj'); playBtn.disabled = !s.track;
  recBtn.disabled = !s.track;
}
let scrubWasPlaying = false;
let playPending = false;
let audioSeekTimer = null;

function seek(sec, isScrubbing = false) {
  live.clearExternal?.();
  if (recorder?.isRecording) recorder.handleSeek(sec);
  s.scrubSec = clamp(sec || 0, 0, duration());
  if (isScrubbing && !audio.paused) {
    scrubWasPlaying = true;
    audio.pause();
  }
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
  playlist.redraw();
  if (s.dock === 'clip' || s.dock === 'envelope') editor.draw();
  const time = s.scrubSec;
  const text = formatBBT(hasTrack() ? Math.max(0, beatPosition(time, tl(), s.analysis)) : 0) + '|' + formatClock(time);
  if (text !== lastText) {
    lastText = text;
    const [bbt, clock] = text.split('|');
    bbtEl.textContent = bbt;
    clockEl.textContent = clock;
  }
  if (hasTrack()) updateActiveNow(time);
  if (!isScrubbing) playlist.ensureVisible(s.scrubSec);
}

function commitSeek(sec) {
  if (Number.isFinite(sec)) seek(sec, false);
  if (audioSeekTimer) { clearTimeout(audioSeekTimer); audioSeekTimer = null; }
  if (s.track) { try { audio.currentTime = s.scrubSec; } catch {} }
  playlist.redraw();
  if (s.dock === 'clip' || s.dock === 'envelope') editor.draw();
  if (scrubWasPlaying) {
    scrubWasPlaying = false;
    audio.play().catch(() => {});
  }
  syncPlay();
}

async function togglePlay() {
  if (!s.track) return;
  live.clearExternal?.();
  stemsEngine.ensureContext();
  if (audio.paused) {
    if (!lanState.stageOwnerId && !lanState.isRemoteStageOwner) {
      lanState.manuallyReleased = false;
    }
    if ((lanState.outputMode === 'ambient' || output.outputMode === 'ambient') && !live.engine.state.blackout && !lanState.isRemoteStageOwner) {
      claimStage(false).catch(() => {});
    }
    s.playFrom = s.scrubSec; audio.currentTime = s.scrubSec;
    playPending = true;
    try {
      await audio.play();
      if (recorder?.isArmed) recorder.startRecording();
      if (lanState.stageOwnerId && lanState.stageOwnerId !== clientId && lanState.outputMode !== 'ambient') {
        toast(`🎧 Solo Preview — na stageu je ${lanState.stageOwnerName || 'kolega'}. Klikni „⚡ Preuzmi Stage” ako želiš prebaciti zid na sebe.`, 'info');
      }
    } catch (error) { toast(`Reprodukcija nije uspjela: ${error.message}`, 'error'); }
    finally { playPending = false; }
  } else {
    if (recorder?.isRecording) recorder.stopRecording();
    audio.pause();
    s.scrubSec = audio.currentTime;
    playlist.redraw();
  }
  syncPlay();
}
function stop() {
  live.clearExternal?.();
  if (recorder?.isRecording) recorder.stopRecording();
  if (!audio.paused) { audio.pause(); seek(s.playFrom); } else seek(0);
  syncPlay();
}
audio.onplay = audio.onpause = () => { syncPlay(); liveSync?.sendLiveState?.(); };
audio.onended = () => { if (recorder?.isRecording) recorder.stopRecording(); s.scrubSec = 0; syncPlay(); playlist.redraw(); };
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
  getThemeOptions: () => browser?.getThemeOptions?.() || {},
  onSectionsChange: sections => {
    if (s.track?.id && s.analysis) {
      s.analysis.sections = sections;
      libraryApi('sections', { id: s.track.id, sections }).catch(err => toast(err.message, 'error'));
    }
  },
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
const editor = {
  render() { clipEditor.render(); driverEditor.render(); },
  draw() {
    if (!envPane.hidden) clipEditor.draw();
    if (!driverPane.hidden) driverEditor.draw();
  }
};
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
  try {
    await libraryApi('timeline', { id: pending.id, timeline: pending.snapshot, clientId, author: clientName });
    if (!s.pendingSave) setSaveState('Spremljeno', 'ok');
  }
  catch (error) { setSaveState('Nije spremljeno', 'err'); status(error.message); toast(`Spremanje nije uspjelo: ${error.message}`, 'error'); }
}
saveBtn.onclick = () => { flushSave().then(() => toast('Show spremljen.')); };
addEventListener('pagehide', () => { const p = s.pendingSave; if (p) navigator.sendBeacon('/api/library/timeline', new Blob([JSON.stringify({ id: p.id, timeline: p.snapshot, clientId, author: clientName })], { type: 'application/json' })); });

let timelineVersion = 1;
store.subscribe(kind => {
  timelineVersion++;
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
  updateTrackTitle(s.track.title || s.track.originalName || 'Pjesma', s.analysis?.bpm || tl()?.bpm); browser.setActive(id); syncPlay(); setSaveState('Spremljeno', 'ok');
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
    updateTrackTitle(s.track.title || s.track.originalName || 'Pjesma', s.analysis?.bpm || tl()?.bpm);
    status(`Analiza gotova · ${Math.round(s.analysis.bpm)} BPM. Show je editabilan.`);
  } catch (error) { status(`Analiza nije uspjela: ${error.message}`); toast(`Analiza nije uspjela: ${error.message}`, 'error'); }
}
function generateShow(opts = {}) {
  if (!hasTrack()) return status('Najprije odaberi analiziranu pjesmu.');
  const result = store.commit('Auto show', t => { const fresh = normalizeTimeline(createAutoShow(s.analysis, opts)); t.layers = fresh.layers; });
  if (result.error) return status(result.error);
  s.activeLayer = 0; playlist.setSelection([]); status('Auto show s temom je generiran. Poništi s ⌘Z ako ti se više sviđao prethodni.');
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
  onDeleted: id => { if (s.track?.id === id) { s.track = null; s.analysis = null; audio.pause(); audio.removeAttribute('src'); store.replace(emptyTimeline()); updateTrackTitle('Nema odabrane pjesme'); playlist.renderHeads(); editor.render(); syncPlay(); playlist.redraw(); } },
  onRenamed: id => { if (s.track?.id === id) browser.refresh().then(tracks => { const t = tracks.find(x => x.id === id); if (t) { s.track = { ...s.track, ...t }; updateTrackTitle(t.title, s.analysis?.bpm || tl()?.bpm); playlist.renderHeads(); } }); }
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
  if (spectrumCache.has(id)) {
    const cached = spectrumCache.get(id);
    analysis.spectrum = cached.spectrum;
    if (cached.stemSpectrums) analysis.stemSpectrums = cached.stemSpectrums;
    s.spectrumState = 'ready';
    editor.render();
    return;
  }
  s.spectrumState = 'loading'; s.spectrumProgress = 0;
  try {
    const response = await fetch(`/api/library/audio/${id}`); if (!response.ok) throw new Error(`audio ${response.status}`);
    const Ctor = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const decoded = await new Ctor(1, 1, 44100).decodeAudioData(await response.arrayBuffer());
    if (s.track?.id !== id) return;
    const mono = new Float32Array(decoded.length), channels = decoded.numberOfChannels;
    for (let c = 0; c < channels; c++) { const data = decoded.getChannelData(c); for (let i = 0; i < mono.length; i++) mono[i] += data[i] / channels; }
    s.analysis.pcmMono = mono; s.analysis.pcmSampleRate = decoded.sampleRate; playlist.redraw();
    const spectrum = await computeSpectrum(mono, decoded.sampleRate, { onProgress: p => { s.spectrumProgress = p; if (performance.now() - spectrumDraw > 250) { spectrumDraw = performance.now(); if (!driverPane.hidden) driverEditor.draw(); } } });
    if (s.track?.id !== id) return;
    // Pre-build stem spectrums across macrotask turns BEFORE exposing analysis.spectrum so render frames never stall
    const tempAnalysis = { ...s.analysis, spectrum, stemSpectrums: {} };
    for (const stemKey of ['drums', 'bass', 'vocals', 'other']) {
      await new Promise(r => setTimeout(r, 0));
      if (s.track?.id !== id) return;
      getSpectrumForSource(tempAnalysis, stemKey);
    }
    if (spectrumCache.size >= 2) {
      const oldestKey = spectrumCache.keys().next().value;
      if (oldestKey !== undefined) spectrumCache.delete(oldestKey);
    }
    spectrumCache.set(id, { spectrum, stemSpectrums: tempAnalysis.stemSpectrums });
    s.analysis.stemSpectrums = tempAnalysis.stemSpectrums;
    s.analysis.spectrum = spectrum;
    s.spectrumState = 'ready';
    editor.render();
    playlist.redraw();
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
document.getElementById('out-open').onclick = () => output.openSettings();
const performOpen = h('button', { type: 'button', id: 'perform-open', class: 'txt-btn', title: 'Otvori izvedbeni board (tipka P)', onClick: () => switchDock('perform') }, 'LIVE BOARD');
const mobileDialog = h('dialog', { id: 'mobile-companion-dialog', class: 'help lan-modal', closedby: 'any', 'aria-label': 'iPhone Live Pad Companion' });
document.body.append(mobileDialog);
if (!('closedBy' in HTMLDialogElement.prototype)) {
  mobileDialog.addEventListener('click', event => {
    if (event.target !== mobileDialog) return;
    const rect = mobileDialog.getBoundingClientRect();
    const isDialogContent = rect.top <= event.clientY && event.clientY <= rect.top + rect.height && rect.left <= event.clientX && event.clientX <= rect.left + rect.width;
    if (!isDialogContent) mobileDialog.close();
  });
}
async function openMobileCompanionModal() {
  try {
    const res = await fetch('/api/lan/status').then(r => r.json());
    if (res.ok) applyLanPresence(res);
  } catch {}
  const baseLan = (lanState.lanUrls || []).find(u => !u.includes('.local')) || lanState.lanUrls?.[0] || window.location.origin;
  const padUrl = `${baseLan.replace(/\/$/, '')}/pad`;
  const localMdnsUrl = (lanState.lanUrls || []).find(u => u.includes('.local'));
  const mdnsPadUrl = localMdnsUrl ? `${localMdnsUrl.replace(/\/$/, '')}/pad` : null;
  const mobilePeers = (lanState.peers || []).filter(p => p.source === 'pad' || p.source === 'ios');

  mobileDialog.replaceChildren(
    h('div', { class: 'pane-title' },
      h('b', {}, '📱 IPHONE LIVE PAD · COMPANION APP'),
      h('button', { type: 'button', onClick: () => mobileDialog.close() }, 'Zatvori')
    ),
    h('div', { class: 'lan-modal-body', style: { display: 'grid', gap: '14px', padding: '14px 16px' } },
      h('div', { style: { background: 'rgba(16, 22, 34, 0.85)', border: '1px solid rgba(76, 195, 255, 0.28)', borderRadius: '12px', padding: '14px' } },
        h('div', { style: { fontSize: '11px', letterSpacing: '0.08em', color: '#4cc3ff', fontWeight: '700', marginBottom: '6px' } }, '1 · INSTANT WI-FI / HOME SCREEN APP (BEZ KABLA)'),
        h('p', { style: { margin: '0 0 10px', fontSize: '13px', color: '#c8d6e8', lineHeight: '1.45' } },
          'Otvori Safari na iPhoneu (na istoj Wi-Fi mreži) i upiši donju adresu. Za puni zaslon bez Safari traka dodirni Dijeli (Share) → „Add to Home Screen”.'
        ),
        h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' } },
          h('code', { style: { flex: '1', padding: '9px 12px', background: '#07090e', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '8px', fontSize: '14px', color: '#00ffa3', fontWeight: '700', userSelect: 'all' } }, padUrl),
          h('button', {
            type: 'button',
            class: 'txt-btn',
            onClick: () => {
              navigator.clipboard?.writeText(padUrl);
              toast('Adresa za iPhone kopirana u međuspremnik.');
            }
          }, 'Kopiraj URL'),
          h('a', {
            href: '/pad',
            target: '_blank',
            rel: 'noopener',
            class: 'txt-btn',
            style: { textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }
          }, 'Otvori Preview ↗')
        ),
        mdnsPadUrl ? h('small', { style: { display: 'block', marginTop: '6px', color: '#8499b2' } }, `Bonjour / mDNS alternativa: ${mdnsPadUrl}`) : null
      ),
      h('div', { style: { background: 'rgba(16, 22, 34, 0.85)', border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: '12px', padding: '14px' } },
        h('div', { style: { fontSize: '11px', letterSpacing: '0.08em', color: '#ffb34d', fontWeight: '700', marginBottom: '6px' } }, '2 · NATIVE IOS SWIFTUI APP (XCODE + COREHAPTICS)'),
        h('p', { style: { margin: '0 0 8px', fontSize: '13px', color: '#c8d6e8', lineHeight: '1.45' } },
          'Izvorni Swift 6 / SwiftUI projekt s CoreHaptics vibracijama, multi-touch 12-pad pločom i 60 FPS 3×3 pregledom spreman je u mapi:'
        ),
        h('code', { style: { display: 'block', padding: '8px 10px', background: '#07090e', borderRadius: '8px', fontSize: '12px', color: '#e6eef8', userSelect: 'all' } }, 'ios-companion/LEDicatedPad.xcodeproj'),
        h('small', { style: { display: 'block', marginTop: '6px', color: '#8499b2', lineHeight: '1.4' } },
          'Spoji iPhone USB-C kablom → u Xcodeu odaberi svoj Apple ID pod Signing & Capabilities (Team) → odaberi svoj iPhone na vrhu i pritisni ⌘R (Run).'
        )
      ),
      h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12px', color: '#8499b2' } },
        h('span', {}, mobilePeers.length
          ? `🟢 Spojeni mobilni uređaji (${mobilePeers.length}): ${mobilePeers.map(p => p.name).join(', ')}`
          : '⚪ Čekam spajanje iPhonea na istoj Wi-Fi mreži…'),
        h('span', {}, 'Sinkronizacija: SSE + <3ms LAN')
      )
    )
  );
  if (!mobileDialog.open) mobileDialog.showModal();
}
const mobileOpen = h('button', { type: 'button', id: 'mobile-open', class: 'txt-btn', title: 'Poveži iPhone Live Pad Companion aplikaciju', onClick: openMobileCompanionModal }, '📱 iPhone Pad');
document.getElementById('out-open').before(performOpen, mobileOpen);
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
let wasArmedBeforeBlackout = false;
async function blackout() {
  const active = !live.engine.state.blackout; live.setBlackout(active);
  if (active) {
    if (recorder?.isRecording) recorder.stopRecording();
    performDesk.clear();
  }
  blackoutBtn.setAttribute('aria-pressed', String(active)); blackoutBtn.classList.toggle('on', active);
  if (active) {
    wasArmedBeforeBlackout = output.armed;
    output.disarm();
    await output.blackout();
    status('Blackout aktivan.');
  } else {
    if (wasArmedBeforeBlackout) {
      wasArmedBeforeBlackout = false;
      await output.setArmed(true).catch(e => toast(e.message, 'error'));
    }
    status('Blackout otpušten.');
  }
  output.render();
}
blackoutBtn.onclick = blackout;

/* ---------------------------------------------------------------- shortcuts */
const help = h('dialog', { id: 'gesture-help', class: 'help' },
  h('div', { class: 'pane-title' }, h('b', {}, 'PREČACI I GESTE'), h('button', { type: 'button', id: 'close-help', onClick: () => help.close() }, 'Zatvori')),
  h('dl', {}, [
    ['Space', 'Reproduciraj / pauziraj'], ['Home / End', 'Početak / kraj pjesme'], ['← / →', 'Pomakni odabrane clipove za snap korak (bez odabira: kadar playheada); ⇧ = 1 s'], ['1 · 2 · 3 · 4', 'Alati: Crtaj, Odaberi, Podijeli, Briši'],
    ['⌘Z · ⇧⌘Z', 'Poništi / ponovi'], ['⌘C · ⌘X · ⌘V', 'Kopiraj / izreži / zalijepi na playhead'], ['⌘D', 'Dupliciraj odabrano iza sebe'], ['⌘A', 'Odaberi sve clipove'], ['⌫ / Delete', 'Obriši odabrano'], ['⌘S', 'Spremi odmah'],
    ['L · F', 'Loop uključi/isključi · Prati playhead'], ['⇧R', 'Snimaj live izvedbu (toggle recording)'], ['P', 'Otvori Live board'], ['Q W E R / A S D F / Z X C V', 'Kratko: udar ili uključi/isključi petlju. Drži: efekt traje do otpuštanja. Radi u svim panelima.'], ['+ / − / 0', 'Zoom · prikaži cijelu pjesmu'], ['Esc', 'Blackout uključi / isključi'],
    ['Pinch / ⌘ + kotačić', 'Zoom oko pokazivača'], ['Dva prsta lijevo/desno', 'Pomak playlista'], ['⌥ + povuci clip', 'Dupliciraj dok pomičeš'], ['Desni klik na clip', 'Obriši clip'], ['Dvaput klik na clip', 'Otvori u uredniku'], ['Envelope: dvaput klik', 'Nova točka (keyframe)'], ['Envelope: desni klik ili ⌥ + klik', 'Obriši točku'], ['⇧ dok povlačiš točku', 'Fino pomicanje bez snapa']
  ].flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])));
document.body.append(help);
document.getElementById('help-open').onclick = () => help.showModal();

/* ------------------------------------------- LAN & Dijeljenje (Uredski Hub) */
const lanState = {
  stageOwnerId: null,
  stageOwnerName: null,
  stageOwnerSource: null,
  stageState: 'idle',
  outputMode: 'show',
  graceRemainingSec: 0,
  graceUpdatedAt: 0,
  isRemoteStageOwner: false,
  nowPlaying: null,
  manuallyReleased: false,
  peers: [],
  remoteServers: [],
  lanUrls: [],
  hostname: '',
  peerUrl: (() => {
    try { return localStorage.getItem('ledicated-peer-url') || ''; } catch { return ''; }
  })(),
  remoteTracks: [],
  remoteStatus: null,
  syncBusy: false
};

const formatMinSec = sec => {
  const sVal = Math.max(0, Math.floor(Number(sec) || 0));
  const m = Math.floor(sVal / 60);
  const r = sVal % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
};

const sourceLabel = src => src === 'youtube' ? '🎬 YouTube' : src === 'daw' ? '🎹 DAW' : '💻 LAN';

const lanDialog = h('dialog', { id: 'lan-dialog', class: 'help lan-modal', 'aria-label': 'LAN & Dijeljenje' });
document.body.append(lanDialog);
lanDialog.addEventListener('click', e => { if (e.target === lanDialog) lanDialog.close(); });

function getLiveGraceRemaining() {
  if (lanState.stageState !== 'grace' || !lanState.graceRemainingSec) return 0;
  const elapsed = Math.floor((Date.now() - (lanState.graceUpdatedAt || Date.now())) / 1000);
  return Math.max(0, lanState.graceRemainingSec - elapsed);
}

function renderStageLiveBanner() {
  const isAmbient = lanState.outputMode === 'ambient' || output.outputMode === 'ambient';
  const isMyStage = !isAmbient && lanState.stageOwnerId === clientId && !lanState.isRemoteStageOwner;
  const isFree = !isAmbient && !lanState.stageOwnerId && !lanState.isRemoteStageOwner;
  const graceSec = getLiveGraceRemaining();
  const np = lanState.nowPlaying;

  stageLiveBanner.className = `stage-live-banner ${
    isAmbient
      ? 'is-solo'
      : isMyStage
        ? (lanState.stageState === 'grace' ? 'is-grace' : 'is-owner')
        : isFree
          ? (lanState.manuallyReleased ? 'is-solo' : 'is-idle')
          : 'is-solo'
  }`;

  let statusText = '⚪ STAGE SLOBODAN';
  if (isAmbient) {
    statusText = '💡 MENU BAR (UREDSKA RASVJETA)';
  } else if (isMyStage) {
    statusText = lanState.stageState === 'grace'
      ? `🟡 PAUZA · ${graceSec}s (Ti)`
      : `🟢 ON AIR · ${clientName} (Ti)`;
  } else if (isFree) {
    statusText = lanState.manuallyReleased
      ? '🎧 SOLO PREVIEW · Stage slobodan'
      : '⚪ STAGE SLOBODAN · Play preuzima';
  } else {
    const ownerName = lanState.stageOwnerName || np?.ownerName || 'Kolega';
    statusText = lanState.stageState === 'grace'
      ? `🎧 SOLO · 🟡 ${ownerName} (pauza ${graceSec}s)`
      : `🎧 SOLO · 🟢 ${ownerName}`;
  }

  const activeSource = isMyStage ? 'daw' : (np?.source || lanState.stageOwnerSource || 'daw');
  const srcChip = isAmbient
    ? h('span', { class: 'slb-source-chip src-daw' }, '💡 Uredsko svjetlo')
    : (!isFree || isMyStage)
      ? h('span', { class: `slb-source-chip src-${activeSource}` }, sourceLabel(activeSource))
      : null;

  const actionBtn = isAmbient
    ? h('button', {
        type: 'button',
        class: 'slb-btn claim',
        title: 'Preuzmi kontrolu nad 3×3 LED zidom i pusti Light Show',
        onClick: () => claimStage(false)
      }, '⚡ Preuzmi kontrolu (Light Show)')
    : isMyStage
      ? h('button', {
          type: 'button',
          class: 'slb-btn release',
          title: 'Prepusti Stage i prebaci se u Solo Preview mod',
          onClick: () => claimStage(true)
        }, 'Prepusti Stage')
      : (!isFree || lanState.manuallyReleased)
        ? h('button', {
            type: 'button',
            class: 'slb-btn claim',
            title: 'Preuzmi kontrolu nad fizičkim 3×3 LED barovima',
            onClick: () => claimStage(false)
          }, '⚡ Preuzmi Stage')
        : h('button', {
            type: 'button',
            class: 'slb-btn lock',
            title: 'Preuzmi kontrolu i pusti izlaz na 3×3 LED zid',
            onClick: () => claimStage(false)
          }, '⚡ Preuzmi izlaz');

  const trackTitleText = isAmbient
    ? (s.track?.title ? `Spremno u Studiju: ${s.track.title} (Klikni Preuzmi kontrolu za Light Show)` : 'Na zidu je trenutno statično uredsko svjetlo iz Menu Bara')
    : isMyStage
      ? (s.track?.title || s.track?.originalName || 'Uživo iz DAW-a')
      : (np?.trackTitle || (isFree ? (s.track?.title ? `Spremno: ${s.track.title}` : 'Nema aktivne reprodukcije') : 'Uživo izlaz'));

  const curSec = isMyStage ? songTime() : Number(np?.timeSec || 0);
  const durSec = isMyStage ? duration() : Number(np?.durationSec || 0);
  const timeCode = (!isFree || isMyStage) && (curSec > 0 || durSec > 0)
    ? `${formatMinSec(curSec)}${durSec > 0 ? ` / ${formatMinSec(durSec)}` : ''}`
    : '';
  const pct = durSec > 0 ? Math.min(100, Math.max(0, Math.round((curSec / durSec) * 100))) : 0;

  const openSameTrackBtn = (!isMyStage && np?.trackId && !String(np.trackId).startsWith('shared:') && np.trackId !== s.track?.id && !lanState.isRemoteStageOwner)
    ? h('button', {
        type: 'button',
        class: 'slb-open-track',
        title: 'Otvori ovu pjesmu u svom timelineu',
        onClick: () => selectTrack(np.trackId)
      }, '🎵 Otvori')
    : null;

  stageLiveBanner.replaceChildren(
    h('div', { class: 'slb-top' },
      h('div', { class: 'slb-badges' },
        h('span', { class: 'slb-status' }, statusText),
        srcChip
      ),
      h('div', { class: 'slb-actions' },
        openSameTrackBtn,
        actionBtn
      )
    ),
    h('div', { class: 'slb-bottom' },
      h('span', { class: 'slb-track', title: trackTitleText },
        (!isFree && (isMyStage ? !audio.paused : np?.isPlaying)) ? '▶ ' : (!isFree ? '⏸ ' : ''),
        trackTitleText
      ),
      timeCode ? h('span', { class: 'slb-time' }, timeCode) : null
    ),
    (!isFree && durSec > 0)
      ? h('div', { class: 'slb-progress' }, h('div', { class: 'slb-progress-fill', style: { width: `${pct}%` } }))
      : null
  );
}

function updateLanBadge() {
  const isMyStage = lanState.stageOwnerId === clientId && !lanState.isRemoteStageOwner;
  const isFree = !lanState.stageOwnerId && !lanState.isRemoteStageOwner;
  const canDrive = isMyStage || (isFree && !lanState.manuallyReleased);
  window.ledicatedIsStageOwner = canDrive;
  window.ledicatedRemoteStageOwner = Boolean(lanState.isRemoteStageOwner);
  const peerCount = Math.max(1, lanState.peers.length || 1);
  window.ledicatedPeerCount = peerCount;
  const countLabel = peerCount > 1 ? ` · ${peerCount}` : '';
  const graceSec = getLiveGraceRemaining();

  lanBtn.classList.remove('on-air', 'solo-mode', 'grace-mode');
  if (isMyStage) {
    if (lanState.stageState === 'grace') {
      lanBtn.textContent = `🌐 LAN${countLabel} · PAUZA (${graceSec}s)`;
      lanBtn.classList.add('grace-mode');
      lanBtn.title = `Pauzirano — Stage se drži za tebe još ${graceSec} s prije automatskog otpuštanja.`;
    } else {
      lanBtn.textContent = `🌐 LAN${countLabel} · ON AIR`;
      lanBtn.classList.add('on-air');
      lanBtn.title = `Ti si NA STAGEU (ON AIR)${peerCount > 1 ? ` · ${peerCount} povezanih uređaja na LAN-u` : ''}`;
    }
  } else if (isFree) {
    if (lanState.manuallyReleased) {
      lanBtn.textContent = `🌐 LAN${countLabel} · SOLO`;
      lanBtn.classList.add('solo-mode');
      lanBtn.title = 'Ti si u Solo Preview modu. Stage je trenutno slobodan.';
    } else {
      lanBtn.textContent = `🌐 LAN${countLabel} · SLOBODAN`;
      lanBtn.classList.add('on-air');
      lanBtn.title = 'Stage je slobodan — pritisni Play za automatsko preuzimanje izlaza.';
    }
  } else {
    const ownerName = lanState.stageOwnerName || 'Kolega';
    lanBtn.textContent = `🌐 LAN${countLabel} · SOLO (${ownerName})`;
    lanBtn.classList.add('solo-mode');
    lanBtn.title = `Na stageu je ${ownerName}. Ti si u Solo Preview modu (klikni za preuzimanje stagea).`;
  }
  renderStageLiveBanner();
}

async function claimStage(release = false) {
  try {
    lanState.manuallyReleased = Boolean(release);
    const res = await fetch('/api/lan/claim-stage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId, name: clientName, source: 'daw', release })
    }).then(r => r.json());
    if (res.ok) {
      if (!release) {
        lanState.outputMode = 'show';
        output.syncServerState?.({ armed: Boolean(res.armed ?? true), outputMode: 'show', ambientOverride: false });
      }
      applyLanPresence(res);
      if (!release) {
        output.send(currentOutputFrame, now());
      }
      toast(release ? 'Stage prepušten — sada si u Solo Preview modu.' : '🟢 Preuzeo si kontrolu (ON AIR)! Light Show ide na 3×3 barove.', 'ok');
    }
  } catch (err) {
    toast(err.message, 'error');
  }
}

function applyLanPresence(data) {
  if (!data) return;
  if (Array.isArray(data.peers)) lanState.peers = data.peers;
  if (Array.isArray(data.remoteServers)) lanState.remoteServers = data.remoteServers;
  if ('stageOwnerId' in data) lanState.stageOwnerId = data.stageOwnerId;
  if ('stageOwnerName' in data) lanState.stageOwnerName = data.stageOwnerName;
  if ('stageOwnerSource' in data) lanState.stageOwnerSource = data.stageOwnerSource;
  if ('stageState' in data) lanState.stageState = data.stageState || 'idle';
  if ('outputMode' in data) lanState.outputMode = data.outputMode || 'show';
  if (typeof data.armed === 'boolean' || data.outputMode) {
    output.syncServerState?.({
      armed: data.armed,
      outputMode: data.outputMode,
      ambientOverride: data.ambientOverride
    });
  }
  if ('graceRemainingSec' in data) {
    lanState.graceRemainingSec = Number(data.graceRemainingSec) || 0;
    lanState.graceUpdatedAt = Date.now();
  }
  if ('isRemoteStageOwner' in data) lanState.isRemoteStageOwner = Boolean(data.isRemoteStageOwner);
  if ('nowPlaying' in data) lanState.nowPlaying = data.nowPlaying || null;
  if (lanState.stageOwnerId === clientId && !lanState.isRemoteStageOwner && lanState.outputMode !== 'ambient') {
    lanState.manuallyReleased = false;
  }
  if (Array.isArray(data.lanUrls)) lanState.lanUrls = data.lanUrls;
  if (data.hostname) lanState.hostname = data.hostname;
  updateLanBadge();
  if (lanDialog.open && document.activeElement?.tagName !== 'INPUT') {
    renderLanDialog();
  }
}

setInterval(() => {
  if (lanState.stageState === 'grace') {
    const rem = getLiveGraceRemaining();
    updateLanBadge();
    if (rem <= 0) {
      fetch('/api/lan/status').then(r => r.json()).then(res => { if (res.ok) applyLanPresence(res); }).catch(() => {});
    }
  } else if (!audio.paused && lanState.stageOwnerId === clientId) {
    renderStageLiveBanner();
  }
}, 1000);

function renderLanDialog() {
  const isMyStage = lanState.stageOwnerId === clientId && !lanState.isRemoteStageOwner;
  const isFree = !lanState.stageOwnerId && !lanState.isRemoteStageOwner;
  const graceSec = getLiveGraceRemaining();
  const nameInput = h('input', {
    type: 'text',
    class: 'lan-input',
    value: clientName,
    placeholder: 'Tvoje ime / nadimak (npr. Timon, Luka...)',
    onChange: async e => {
      const next = e.target.value.trim().slice(0, 40) || `DJ-${clientId.slice(-4).toUpperCase()}`;
      clientName = next;
      window.ledicatedClientName = next;
      try { localStorage.setItem('ledicated-user-name', next); } catch {}
      try {
        const res = await fetch('/api/lan/profile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clientId, name: clientName })
        }).then(r => r.json());
        if (res.ok) applyLanPresence(res);
      } catch {}
    }
  });

  const stageBanner = h('div', { class: `lan-stage-card ${isMyStage ? 'is-owner' : 'is-solo'}` },
    h('div', { class: 'lan-stage-info' },
      h('strong', {}, isMyStage
        ? (lanState.stageState === 'grace' ? `🟡 PAUZA NA STAGEU · Automatsko otpuštanje za ${graceSec}s` : '🟢 TI SI NA STAGEU (ON AIR)')
        : isFree
          ? '⚪ STAGE JE SLOBODAN (Pritisni Play ili Preuzmi Stage)'
          : `🎧 SOLO PREVIEW MOD · Na stageu je: ${lanState.stageOwnerName || 'Kolega'}`),
      h('small', {}, isMyStage
        ? 'Tvoj timeline, auto-show i live padovi šalju DDP okvire na fizički 3×3 LED zid u uredu. Kad pauziraš, stage se automatski oslobađa nakon 20 sekundi.'
        : 'Slobodno uređuj showove i slušaj pjesme u svom pregledniku bez prekidanja tuđeg izlaza na zidu!')
    ),
    isMyStage
      ? h('button', { type: 'button', class: 'txt-btn', onClick: () => claimStage(true) }, 'Prepusti Stage')
      : h('button', { type: 'button', class: 'primary', onClick: () => claimStage(false) }, '⚡ Preuzmi Stage (ON AIR)')
  );

  const peersList = h('div', { class: 'lan-peers-list' },
    ...(lanState.peers.length ? lanState.peers : [{ clientId, name: clientName, source: 'daw', isStageOwner: isMyStage, trackId: s.track?.id, trackTitle: s.track?.title, isPlaying: !audio.paused }]).map(p => {
      const isMe = p.clientId === clientId && !p.isRemoteServer;
      const badgeLabel = p.isStageOwner
        ? (p.stageState === 'grace' ? `🟡 PAUZA` : '🟢 ON AIR')
        : '🎧 SOLO';
      const timeStr = p.timeSec > 0 ? ` (${formatMinSec(p.timeSec)}${p.durationSec > 0 ? ` / ${formatMinSec(p.durationSec)}` : ''})` : '';
      return h('div', { class: `lan-peer-row${p.isStageOwner ? ' owner' : ''}` },
        h('span', { class: `lan-peer-dot ${p.isStageOwner ? 'on-air' : 'solo'}` }, badgeLabel),
        h('span', { class: `slb-source-chip src-${p.source || 'daw'}` }, sourceLabel(p.source || 'daw')),
        h('b', {}, `${p.name || p.clientId}${isMe ? ' (Ti)' : ''}`),
        h('small', { class: 'lan-peer-track' }, p.trackTitle ? `${p.isPlaying ? '▶ ' : '⏸ '}${p.trackTitle}${timeStr}` : 'Nema odabrane pjesme'),
        (!isMe && p.trackId && !String(p.trackId).startsWith('shared:') && p.trackId !== s.track?.id && !p.isRemoteServer)
          ? h('button', { type: 'button', class: 'mini-btn', onClick: () => { lanDialog.close(); selectTrack(p.trackId); } }, 'Otvori istu pjesmu')
          : null
      );
    })
  );

  const lanUrlsRow = h('div', { class: 'lan-urls-box' },
    h('small', {}, 'Adresa ovog servera na uredskom Wi-Fi / LAN-u (prijatelji mogu otvoriti u svom pregledniku ili upisati dolje):'),
    h('div', { class: 'lan-url-chips' },
      ...(lanState.lanUrls.length ? lanState.lanUrls : [window.location.origin]).map(url =>
        h('button', {
          type: 'button',
          class: 'lan-url-chip',
          title: 'Klikni za kopiranje LAN adrese',
          onClick: () => {
            navigator.clipboard?.writeText(url);
            toast(`Kopirano: ${url}`, 'ok');
          }
        }, `📋 ${url}`)
      )
    )
  );

  const bundleInput = h('input', {
    type: 'file',
    accept: '.ledpack,.json,.mp3,.wav',
    multiple: true,
    style: { display: 'none' },
    onChange: async e => {
      if (e.target.files.length) {
        await browser.importFiles([...e.target.files]);
        e.target.value = '';
        renderLanDialog();
      }
    }
  });

  const shareButtons = h('div', { class: 'lan-actions-row' },
    h('button', {
      type: 'button',
      class: 'primary',
      disabled: !hasTrack(),
      onClick: () => browser.exportTrackPack?.(s.track?.id)
    }, '📦 Izvezi .ledpack (Pjesma + Show)'),
    h('button', {
      type: 'button',
      class: 'txt-btn',
      disabled: !hasTrack(),
      onClick: () => browser.exportTrackShow?.(s.track?.id)
    }, '✦ Izvezi .ledshow.json'),
    h('button', {
      type: 'button',
      class: 'txt-btn',
      disabled: !hasTrack(),
      onClick: () => browser.shareTrackToGit?.(s.track?.id, s.track?.title)
    }, '🌐 Spremi u Git (shared-shows)'),
    h('button', {
      type: 'button',
      class: 'txt-btn',
      onClick: () => bundleInput.click()
    }, '📂 Uvezi .ledpack / .ledshow.json', bundleInput)
  );

  const peerUrlInput = h('input', {
    type: 'url',
    class: 'lan-input',
    placeholder: 'http://192.168.1.50:8787 (LAN IP uredskog Maca ili kolege)',
    value: lanState.peerUrl,
    onInput: e => {
      lanState.peerUrl = e.target.value.trim();
      try { localStorage.setItem('ledicated-peer-url', lanState.peerUrl); } catch {}
    }
  });

  const pushBtn = h('button', {
    type: 'button',
    class: 'primary',
    disabled: !hasTrack() || lanState.syncBusy,
    onClick: async () => {
      if (!lanState.peerUrl) return toast('Upiši LAN adresu uredskog servera (npr. http://192.168.1.50:8787).', 'error');
      lanState.syncBusy = true;
      renderLanDialog();
      try {
        status(`Slanje paketa „${s.track.title}” na ${lanState.peerUrl}…`);
        const res = await fetch('/api/lan/push-pack', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ peerUrl: lanState.peerUrl, trackId: s.track.id, author: clientName })
        }).then(r => r.json());
        if (!res.ok) throw new Error(res.error || 'Slanje nije uspjelo.');
        toast(`🚀 Pjesma i show „${s.track.title}” poslani na ${lanState.peerUrl}!`, 'ok');
        status(`Uspješno poslano na ${lanState.peerUrl}.`);
      } catch (err) {
        toast(err.message, 'error');
      } finally {
        lanState.syncBusy = false;
        renderLanDialog();
      }
    }
  }, lanState.syncBusy ? '⏳ Slanje…' : '🚀 Pošalji aktivnu pjesmu + show na uredski LAN');

  const fetchPeerBtn = h('button', {
    type: 'button',
    class: 'txt-btn',
    disabled: lanState.syncBusy,
    onClick: async () => {
      if (!lanState.peerUrl) return toast('Upiši LAN adresu uredskog servera (npr. http://192.168.1.50:8787).', 'error');
      lanState.syncBusy = true;
      renderLanDialog();
      try {
        const res = await fetch('/api/lan/peer-tracks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ peerUrl: lanState.peerUrl })
        }).then(r => r.json());
        if (!res.ok) throw new Error(res.error || 'Povezivanje nije uspjelo.');
        lanState.remoteTracks = res.tracks || [];
        lanState.remoteStatus = res.peerStatus || null;
        toast(`Pronađeno ${lanState.remoteTracks.length} pjesama na ${lanState.peerUrl}`, 'ok');
      } catch (err) {
        toast(err.message, 'error');
      } finally {
        lanState.syncBusy = false;
        renderLanDialog();
      }
    }
  }, '📥 Dohvati katalog s drugog LAN uređaja');

  const remoteTracksBox = lanState.remoteTracks.length
    ? h('div', { class: 'lan-remote-tracks' },
        ...lanState.remoteTracks.map(rt =>
          h('div', { class: 'lan-peer-row' },
            h('b', {}, rt.title || rt.originalName),
            h('small', {}, `${(rt.sizeBytes / 1048576).toFixed(1)} MB${rt.author ? ` · 👤 ${rt.author}` : ''}`),
            h('button', {
              type: 'button',
              class: 'mini-btn',
              disabled: lanState.syncBusy,
              onClick: async () => {
                lanState.syncBusy = true;
                renderLanDialog();
                try {
                  const res = await fetch('/api/lan/pull-pack', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ peerUrl: lanState.peerUrl, trackId: rt.id })
                  }).then(r => r.json());
                  if (!res.ok) throw new Error(res.error || 'Preuzimanje nije uspjelo.');
                  await browser.refresh();
                  toast(`📥 Preuzeta pjesma + show: ${res.track.title}`, 'ok');
                  if (res.track?.id) await selectTrack(res.track.id);
                } catch (err) {
                  toast(err.message, 'error');
                } finally {
                  lanState.syncBusy = false;
                  renderLanDialog();
                }
              }
            }, '📥 Povuci u moj studio')
          )
        )
      )
    : null;

  lanDialog.replaceChildren(
    h('div', { class: 'pane-title' },
      h('b', {}, '🌐 UREDSKI LAN, STAGE KONTROLA & DIJELJENJE SHOWOVA'),
      h('button', { type: 'button', onClick: () => lanDialog.close() }, 'Zatvori')
    ),
    h('div', { class: 'lan-modal-body' },
      h('div', { class: 'lan-section' },
        h('label', { class: 'lan-label' }, 'Tvoje ime u studiju (vide ga ostali na LAN-u i potpisuje se u showove):'),
        nameInput,
        stageBanner
      ),
      h('div', { class: 'lan-section' },
        h('label', { class: 'lan-label' }, `Povezani uređaji u ovom studiju (${Math.max(1, lanState.peers.length)}):`),
        peersList,
        lanUrlsRow
      ),
      h('div', { class: 'lan-section' },
        h('label', { class: 'lan-label' }, 'Dijeljenje aktivne pjesme i showa (Slack / Discord / WhatsApp / GitHub):'),
        h('small', { class: 'hint' }, '• .ledpack sadrži MP3/WAV + analizu stemova + cijeli show u jednoj datoteci.\n• .ledshow.json i Git shared-shows/ čuvaju lagani show u repozitoriju za git pull.'),
        shareButtons
      ),
      h('div', { class: 'lan-section' },
        h('label', { class: 'lan-label' }, 'Izravna LAN razmjena između dva laptopa (kad dođeš u ured s vlastitim klonom):'),
        peerUrlInput,
        h('div', { class: 'lan-actions-row' }, pushBtn, fetchPeerBtn),
        remoteTracksBox
      )
    )
  );
}

updateLanBadge();
lanBtn.onclick = async () => {
  try {
    const res = await fetch('/api/lan/status').then(r => r.json());
    if (res.ok) applyLanPresence(res);
  } catch {}
  renderLanDialog();
  if (!lanDialog.open) lanDialog.showModal();
};

const typing = el => /^(INPUT|SELECT|TEXTAREA)$/.test(el?.tagName || '') && !(el.type === 'checkbox' || el.type === 'button' || el.type === 'range');
// Performance keys are global: the lighting instrument keeps playing while
// any dock, slider, color picker or editable field has focus.
document.addEventListener('keydown', event => {
  if (event.repeat || event.isComposing || event.metaKey || event.ctrlKey || event.altKey) return;
  if (document.querySelector('dialog[open]')) return;
  if (event.shiftKey && event.key.toLowerCase() === 'r') {
    event.preventDefault();
    recBtn.click();
    return;
  }
  if (event.shiftKey) return;
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
  if (event.key === 'Escape') {
    if (event.repeat || document.querySelector('dialog[open]') || event.defaultPrevented) return;
    closeMenu();
    blackout();
    return;
  }
  if (typing(event.target) || document.querySelector('dialog[open]')) return;
  const mod = event.metaKey || event.ctrlKey, key = event.key.toLowerCase();
  if (mod && (key === 'o' || key === 'k')) { event.preventDefault(); browser.openLauncher?.(); return; }
  if (event.code === 'Space') { event.preventDefault(); togglePlay(); return; }
  if (event.shiftKey && key === 'r') { event.preventDefault(); recBtn.click(); return; }
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
let cachedEffTl = null;
let cachedEffKey = '';
let effVersionCounter = 1;
const effectiveTimeline = () => {
  const solo = playlist.solo, sel = playlist.selection, isoClip = s.iso.clip && sel.length > 0;
  const recActive = Boolean(recorder?.isRecording);
  const key = `${timelineVersion}|${solo.size ? [...solo].join(',') : ''}|${isoClip ? sel.map(refKey).join(',') : ''}|${s.iso.bypass ? 1 : 0}|${recActive ? 1 : 0}`;
  if (cachedEffTl && cachedEffKey === key && !recActive) return cachedEffTl;
  const baseTl = tl();
  const hasRecClips = recActive && baseTl.layers.some(l => l.clips.some(c => c.recording));
  const filteredTimeline = hasRecClips ? {
    ...baseTl,
    layers: baseTl.layers.map(layer => ({
      ...layer,
      clips: layer.clips.filter(c => !c.recording)
    }))
  } : baseTl;
  let result;
  if (!solo.size && !isoClip && !s.iso.bypass) {
    result = { ...filteredTimeline, _v: ++effVersionCounter };
  } else {
    const keys = new Set(sel.map(refKey));
    result = {
      ...filteredTimeline,
      _v: ++effVersionCounter,
      layers: filteredTimeline.layers.map(layer => {
        const clips = (isoClip ? layer.clips.filter(c => keys.has(`${layer.id}/${c.id}`)) : layer.clips).map(c => s.iso.bypass ? { ...c, driver: 'none' } : c);
        const enabled = isoClip ? clips.length > 0 : layer.enabled && (!solo.size || solo.has(layer.id));
        return { ...layer, enabled, clips };
      })
    };
  }
  cachedEffKey = key;
  cachedEffTl = result;
  return result;
};
function timelineFrame(t = now(), timeOverrideSec = null) {
  if (live.frozen) { if (s.frozenSec === null) s.frozenSec = songTime(); } else s.frozenSec = null;
  const baseTime = timeOverrideSec !== null ? timeOverrideSec : ((s.frozenSec ?? songTime()) + output.offsetSec);
  const time = clamp(baseTime, 0, duration());
  const calibration = output.calibrationFrame(masterKnob.value); if (calibration) return calibration;
  const effTl = effectiveTimeline();
  return showEngine.renderFrame({
    timeline: effTl,
    analysis: s.analysis,
    songTimeSec: time,
    clockTimeSec: t,
    masterBrightness: masterKnob.value,
    performDesk
  });
}
const frameLevel = frame => { let sum = 0, n = 0; for (const id of BAR_IDS) for (const p of frame.bars[id]) { sum += Math.max(...p); n++; } return n ? Math.sqrt(sum / n / 255) : 0; };
function updateMeters(time) {
  const levels = {}, solo = playlist.solo;
  for (const layer of tl().layers) levels[layer.id] = !layer.enabled || (solo.size && !solo.has(layer.id)) ? 0 : frameLevel(renderTimelineFrame({ ...tl(), layers: [{ ...layer, enabled: true }] }, s.analysis, time, null, true));
  mixer.levels(levels, hasTrack() ? frameLevel(renderTimelineFrame(effectiveTimeline(), s.analysis, time, null, true)) * clamp(masterKnob.value / 100, 0, 1) : live.level, stemsEngine.getStemLevels());
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
  const maxPossible = totalPixels * 255;
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

let lastActiveSig = '';
function updateActiveNow(time) {
  let sig = hasTrack() ? 'T:' : 'L:';
  for (const [index] of performDesk.desk.active) {
    const pad = performDesk.desk.pads[index];
    if (pad) sig += `P${index}:${pad.preset};`;
  }
  for (const layer of tl().layers) {
    if (!layer.enabled) continue;
    for (const clip of layer.clips) {
      if (time >= clip.startSec && time < clipEnd(clip)) {
        sig += `C${layer.id}/${clip.id}:${clip.preset};`;
      }
    }
  }
  if (sig === lastActiveSig && activeNow.firstChild) return;
  lastActiveSig = sig;
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

let lastText = '', lastPerformSignal = '', lastTickTime = 0;
const extSyncAnchor = { songSec: 0, wallSec: 0, rate: 1, activeUntil: 0 };
function currentOutputFrame(t = now()) {
  const blackoutOn = live.engine.state.blackout;
  if (blackoutOn) return live.frame(t);
  if (live.isExternalActive?.(t)) return performDesk.render(live.frame(t), t, live.engine.clock.bpm, clamp(masterKnob.value / 100, 0, 1), null, 0);
  return hasTrack() ? timelineFrame(t) : performDesk.render(live.frame(t), t, live.engine.clock.bpm, clamp(masterKnob.value / 100, 0, 1), null, 0);
}
function currentPreviewFrame(t = now()) {
  if (output.offsetSec === 0) return currentOutputFrame(t);
  const blackoutOn = live.engine.state.blackout;
  if (blackoutOn) return live.frame(t);
  if (live.isExternalActive?.(t)) return performDesk.render(live.frame(t), t, live.engine.clock.bpm, clamp(masterKnob.value / 100, 0, 1), null, 0);
  const previewSec = s.frozenSec ?? songTime();
  return hasTrack() ? timelineFrame(t, previewSec) : performDesk.render(live.frame(t), t, live.engine.clock.bpm, clamp(masterKnob.value / 100, 0, 1), null, 0);
}
setInterval(() => {
  if (!output.armed) return;
  const t = now();
  // Stream when document is hidden OR when macOS occludes the window and pauses requestAnimationFrame
  if (!document.hidden && (t - lastTickTime) < 0.028) return;
  if (audio.paused && !playPending && !scrubWasPlaying && extSyncAnchor.activeUntil > t && hasTrack()) {
    s.scrubSec = clamp(extSyncAnchor.songSec + Math.max(0, t - extSyncAnchor.wallSec) * extSyncAnchor.rate, 0, duration());
  }
  const isActivelyPlaying = !audio.paused || performDesk.desk.active.size > 0 || Boolean(live.isExternalActive?.(t)) || extSyncAnchor.activeUntil > t;
  if (!isActivelyPlaying) return;
  performDesk.tick(t);
  output.send(currentOutputFrame, t);
}, 16);
function tick() {
  const t = now();
  lastTickTime = t;
  live.tick(t);
  const extSyncedPlaying = audio.paused && !playPending && !scrubWasPlaying && extSyncAnchor.activeUntil > t && hasTrack();
  if (extSyncedPlaying) {
    s.scrubSec = clamp(extSyncAnchor.songSec + Math.max(0, t - extSyncAnchor.wallSec) * extSyncAnchor.rate, 0, duration());
    playlist.redraw();
  }
  if (s.loopOn && s.loop && !audio.paused && audio.currentTime >= s.loop.end) {
    if (recorder?.isRecording) recorder.handleLoopWrap(s.loop.start, s.loop.end);
    audio.currentTime = s.loop.start;
  }
  performDesk.tick(t);
  recorder?.tick(songTime());
  if (hasTrack() && !live.engine.state.blackout) {
    const effTl = effectiveTimeline();
    showEngine.sync(effTl, s.analysis);
    showEngine.warmLookahead(clamp((s.frozenSec ?? songTime()) + output.offsetSec, 0, duration()), (audio.paused && !extSyncedPlaying) ? 24 : 8, 2.5);
  }
  const performSignal = `${performDesk.desk.active.size}|${performDesk.desk.pending.size}`;
  if (performSignal !== lastPerformSignal) {
    lastPerformSignal = performSignal;
    const activeCount = performDesk.desk.active.size, queuedCount = performDesk.desk.pending.size;
    performOpen.textContent = activeCount ? `LIVE BOARD · ${activeCount}` : queuedCount ? `LIVE BOARD · ${queuedCount} ČEKA` : 'LIVE BOARD';
    performOpen.classList.toggle('on-air', activeCount > 0);
    performOpen.classList.toggle('waiting', queuedCount > 0 && !activeCount);
    performOpen.setAttribute('aria-label', activeCount ? `Live board, ${activeCount} aktivnih efekata` : queuedCount ? `Live board, ${queuedCount} efekata čeka beat` : 'Live board');
  }
  const frame = currentPreviewFrame(t);
  if (output.config) preview.render(frame, output.config);
  output.send(output.offsetSec === 0 ? frame : currentOutputFrame, t);
  const time = songTime(), text = formatBBT(hasTrack() ? Math.max(0, beatPosition(time, tl(), s.analysis)) : 0) + '|' + formatClock(time);
  if (text !== lastText) { lastText = text; const [bbt, clock] = text.split('|'); bbtEl.textContent = bbt; clockEl.textContent = clock; }
  if (s.follow && (!audio.paused || extSyncedPlaying)) playlist.ensureVisible(time, true);
  if (s.dock === 'envelope' && !audio.paused) clipEditor.draw();
  if (s.dock === 'driver') driverEditor.tick();
  if (t - s.lastLevels > .08) {
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
function initLiveSync() {
  let liveStateInFlight = false;
  function sendLiveState() {
    if (liveStateInFlight) return;
    const time = songTime();
    const payload = {
      connected: true,
      clientId,
      clientName,
      trackId: s.track?.id || null,
      trackTitle: s.track?.title || s.track?.originalName || null,
      timeSec: time,
      durationSec: duration(),
      isPlaying: !audio.paused,
      isRecording: recorder?.isRecording || false,
      loop: s.loop ? { ...s.loop, on: s.loopOn } : null,
      bpm: hasTrack() ? tl().bpm : live.engine.clock.bpm,
      gridMode: tl().gridMode || 'auto',
      master: masterKnob.value,
      blackout: live.engine.state.blackout,
      armed: output.armed,
      activePads: [...performDesk.desk.active.keys()],
      pendingPads: [...performDesk.desk.pending.keys()],
      heldPads: [...performDesk.desk.held.keys()],
      quantize: performDesk.desk.quantize,
      pads: performDesk.desk.pads,
      sections: s.analysis?.sections || null,
      activeClipsCount: tl().layers.reduce((acc, l) => acc + l.clips.filter(c => time >= c.startSec && time < clipEnd(c)).length, 0),
      layerCount: tl().layers.length,
      clipCount: tl().layers.reduce((acc, l) => acc + l.clips.length, 0)
    };
    liveStateInFlight = true;
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 1500);
    fetch('/api/live/state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal
    })
      .then(async res => {
        const data = await res.json().catch(() => null);
        if (data && data.ok) {
          applyLanPresence(data);
        }
      })
      .catch(() => {})
      .finally(() => {
        clearTimeout(tid);
        liveStateInFlight = false;
      });
  }

  function handleCommand(cmd) {
    if (!cmd || typeof cmd !== 'object') return;
    if (cmd.type === 'lan_presence') {
      applyLanPresence(cmd);
      return;
    }
    if (cmd.type === 'library_updated') {
      browser.refresh().catch(() => {});
      return;
    }
    if (cmd.type === 'timeline_updated') {
      if (cmd.trackId && cmd.trackId === s.track?.id && cmd.clientId !== clientId && cmd.timeline) {
        store.replace(normalizeTimeline(cmd.timeline));
        playlist.renderHeads();
        playlist.redraw();
        editor.render();
        status(`Show uživo ažuriran od: ${cmd.author || 'LAN kolega'}`);
      }
      return;
    }
    if (cmd.type === 'transport') {
      if (cmd.action === 'play') { if (audio.paused) togglePlay(); }
      else if (cmd.action === 'pause') { if (!audio.paused) togglePlay(); }
      else if (cmd.action === 'stop') { stop(); }
      else if (cmd.action === 'seek') {
        const targetSec = Number.isFinite(cmd.timeSec) ? cmd.timeSec : (Number.isFinite(cmd.beat) ? timeAtBeat(cmd.beat, tl(), s.analysis) : 0);
        commitSeek(targetSec);
      }
      else if (cmd.action === 'loop') {
        if (Number.isFinite(cmd.startSec) && Number.isFinite(cmd.endSec)) setLoop({ start: cmd.startSec, end: cmd.endSec });
        if (typeof cmd.enabled === 'boolean') { s.loopOn = cmd.enabled; syncLoop(); playlist.redraw(); }
      }
      else if (cmd.action === 'record') {
        if (cmd.armed !== undefined) { if (recorder.isArmed !== cmd.armed) recBtn.click(); }
        else recBtn.click();
      }
      sendLiveState();
    }
    else if (cmd.type === 'select_track') {
      if (cmd.trackId && cmd.trackId !== s.track?.id) selectTrack(cmd.trackId);
    }
    else if (cmd.type === 'timeline_op') {
      if (cmd.timeline) {
        store.replace(cmd.timeline);
        playlist.renderHeads();
        playlist.redraw();
        editor.render();
      } else if (cmd.op) {
        store.commit(cmd.label || cmd.op, tr => {
          applyTimelineOp(tr, cmd.op, cmd.args, s.analysis);
        });
        playlist.renderHeads();
        playlist.redraw();
        editor.render();
      }
      sendLiveState();
    }
    else if (cmd.type === 'pads_sync') {
      if (cmd.clientId && cmd.clientId === clientId) return;
      performDesk.syncRemotePads?.(cmd.pads, cmd.quantize);
      sendLiveState();
    }
    else if (cmd.type === 'live_pad') {
      if (cmd.action === 'clear' || cmd.action === 'stop_all') {
        performDesk.clear();
        sendLiveState();
        return;
      }
      if (cmd.action === 'release_all') {
        performDesk.releaseAll();
        sendLiveState();
        return;
      }
      if (cmd.action === 'quantize') {
        const nextQ = cmd.value !== undefined ? Boolean(cmd.value) : !performDesk.desk.quantize;
        performDesk.setQuantize?.(nextQ, { fromRemote: true });
        sendLiveState();
        return;
      }
      if (cmd.action === 'move' && Number.isInteger(cmd.from) && Number.isInteger(cmd.to)) {
        performDesk.movePadConfig?.(cmd.from, cmd.to, { fromRemote: true });
        sendLiveState();
        return;
      }
      let idx = -1;
      if (typeof cmd.pad === 'number') idx = cmd.pad;
      else if (typeof cmd.pad === 'string') {
        const lower = cmd.pad.toLowerCase();
        idx = PAD_KEYS.indexOf(lower);
        if (idx < 0 && !isNaN(Number(cmd.pad))) idx = Number(cmd.pad);
      }
      if (idx >= 0 && idx < 12) {
        if (cmd.action === 'press') {
          performDesk.press(idx, { select: false });
        } else if (cmd.action === 'release') {
          performDesk.release(idx, { cancel: Boolean(cmd.cancel) });
        } else if (cmd.action === 'trigger' || cmd.action === 'hit' || !cmd.action) {
          performDesk.trigger(idx, { select: false });
        } else if (cmd.action === 'loop') {
          if (performDesk.desk.pads[idx] && performDesk.desk.pads[idx].mode !== 'loop') {
            performDesk.setPadConfig?.(idx, { mode: 'loop' }, { fromRemote: true });
          }
          performDesk.trigger(idx, { select: false });
        } else if (cmd.action === 'set' && (cmd.effect || cmd.patch)) {
          performDesk.setPadConfig?.(idx, cmd.effect || cmd.patch, { fromRemote: true });
        } else if (cmd.action === 'remove') {
          performDesk.removePadConfig?.(idx, { fromRemote: true });
        }
      }
      sendLiveState();
    }
    else if (cmd.type === 'master') {
      if (Number.isFinite(cmd.value)) {
        masterKnob.set(cmd.value);
        live.setBrightness(cmd.value);
        mixer.setMaster(cmd.value);
      }
      sendLiveState();
    }
    else if (cmd.type === 'blackout') {
      if (cmd.value !== undefined) {
        if (live.engine.state.blackout !== Boolean(cmd.value)) blackoutBtn.click();
      } else blackoutBtn.click();
      sendLiveState();
    }
    else if (cmd.type === 'tempo') {
      if (Number.isFinite(cmd.bpm)) {
        store.commit('Tempo', tr => { tr.bpm = cmd.bpm; tr.gridMode = cmd.gridMode || 'manual'; });
        bpmNumber.set(cmd.bpm);
        updateGridButton();
      }
      sendLiveState();
    }
    else if (cmd.type === 'tap_tempo') {
      bpmTapBtn.click();
      sendLiveState();
    }
    else if (cmd.type === 'hardware_sync') {
      output.syncServerState?.(cmd.state);
      sendLiveState();
    }
    else if (cmd.type === 'ext_sync') {
      if (cmd.mode === 'idle' || cmd.liveMode === false || cmd.paused) {
        extSyncAnchor.activeUntil = 0;
        live.clearExternal?.();
        return;
      }
      if (!audio.paused || playPending || scrubWasPlaying) return;
      if (cmd.mode === 'synced') {
        live.clearExternal?.();
        const tNow = now();
        if (Number.isFinite(cmd.currentTime)) {
          extSyncAnchor.songSec = Number(cmd.currentTime);
          extSyncAnchor.wallSec = tNow;
          extSyncAnchor.rate = Number.isFinite(Number(cmd.playbackRate)) && Number(cmd.playbackRate) > 0 ? Number(cmd.playbackRate) : 1;
          extSyncAnchor.activeUntil = tNow + 1.2;
        }
        if (cmd.trackId && s.track?.id !== cmd.trackId) {
          browser.refresh().then(() => selectTrack(cmd.trackId)).catch(() => {});
        } else if (hasTrack() && Number.isFinite(cmd.currentTime)) {
          s.scrubSec = clamp(cmd.currentTime, 0, duration());
          playlist.redraw();
          if (s.follow) playlist.ensureVisible(s.scrubSec, true);
        }
      } else if (cmd.mode === 'live_stream') {
        extSyncAnchor.activeUntil = 0;
        live.pushExternalStems?.(cmd.stems, cmd.theme, now());
      }
    }
    else if (cmd.type === 'ext_theme') {
      if (cmd.theme) live.setPalette?.(cmd.theme);
      if (cmd.regenerate && hasTrack()) {
        generateShow({ palette: cmd.theme, theme: cmd.theme, allowedPresets: cmd.allowedPresets });
      }
      sendLiveState();
    }
  }

  let source = null;
  let reconnectTimer = 0;
  function connect() {
    if (typeof EventSource === 'undefined') return;
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = 0; }
    if (source) { try { source.close(); } catch {} source = null; }
    try {
      const es = new EventSource(`/api/live/stream?clientId=${encodeURIComponent(clientId)}&name=${encodeURIComponent(clientName)}`);
      source = es;
      es.addEventListener('command', e => {
        try { handleCommand(JSON.parse(e.data)); } catch (err) { console.error('SSE command error', err); }
      });
      es.onerror = () => {
        if (source === es) {
          try { es.close(); } catch {}
          source = null;
        }
        if (!reconnectTimer) reconnectTimer = setTimeout(connect, 3000);
      };
    } catch {}
  }
  connect();
  addEventListener('pagehide', () => {
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = 0; }
    if (source) { try { source.close(); } catch {} source = null; }
  });

  let lastReport = 0;
  setInterval(() => {
    const t = performance.now();
    const interval = (!audio.paused || performDesk.desk.active.size > 0) ? 300 : 2000;
    if (t - lastReport > interval) {
      lastReport = t;
      sendLiveState();
    }
  }, 250);

  return { handleCommand, sendLiveState };
}

const liveSync = initLiveSync();

// Exposed for deterministic browser smoke tests and remote control.
window.studioTest = { engine: live.engine, showEngine, store, playlist, performance: performDesk, getFrame: () => (live.engine.state.blackout ? live.frame(now()) : hasTrack() ? timelineFrame() : performDesk.render(live.frame(now()), now(), live.engine.clock.bpm, clamp(masterKnob.value / 100, 0, 1), null, 0)), getConfig: () => output.config, state: s, seek, commitSeek, setTool };
window.studioRemote = { executeCommand: liveSync.handleCommand, sendLiveState: liveSync.sendLiveState };

