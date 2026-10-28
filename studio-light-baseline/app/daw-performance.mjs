/** Compact live board. The song arrangement above is the visual timeline;
 * this pane focuses on cues, movable pads, and one set of controls. */
import { h, toast, segmentIntersectsRect } from './daw-ui.mjs';
import { PRESET_LABELS } from './daw-playlist.mjs';
import { SECTION_COLORS, SECTION_NAMES } from './audio-sections.mjs';
import { BAR_IDS } from './engine.mjs';
import { DEFAULT_PADS, LIVE_PARAM_OPTIONS, PAD_KEYS, createPerformance, nextBeat } from './live-performance-state.mjs';

const STORAGE = 'ledicated.perform.pads.v1';
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const fmt = seconds => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
const rgbHex = color => '#' + color.slice(0, 3).map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
const parseHex = value => [1, 3, 5].map(i => parseInt(value.slice(i, i + 2), 16) / 255);
const rgbToHsv = ([r, g, b]) => {
  const hi = Math.max(r, g, b), lo = Math.min(r, g, b), delta = hi - lo;
  let hue = 0;
  if (delta) hue = hi === r ? ((g - b) / delta) % 6 : hi === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return { h: (hue * 60 + 360) % 360, s: hi ? delta / hi : 0, v: hi };
};
const hsvToRgb = (h, s, v) => {
  const chroma = v * s, segment = (((h % 360) + 360) % 360) / 60;
  const x = chroma * (1 - Math.abs(segment % 2 - 1));
  const [r, g, b] = segment < 1 ? [chroma, x, 0] : segment < 2 ? [x, chroma, 0] : segment < 3 ? [0, chroma, x] : segment < 4 ? [0, x, chroma] : segment < 5 ? [x, 0, chroma] : [chroma, 0, x];
  return [r + v - chroma, g + v - chroma, b + v - chroma];
};
const COLOR_SWATCHES = ['#ffffff', '#ffb34d', '#ff603b', '#ff3668', '#c15cff', '#5f77ff', '#2cc8ff', '#37e7ce', '#76e079', '#d6ee5a'];
const targetOptions = [
  ['all', 'Svih 9 barova'], ['center', 'Centar C2'], ['cross', 'Križ'], ['edges', 'Rub (I I)'],
  ['left', 'Lijevi stupac'], ['right', 'Desni stupac']
];
const targetIds = { center: ['C2'], cross: ['C1', 'L2', 'C2', 'R2', 'C3'], edges: ['L1', 'L2', 'L3', 'R1', 'R2', 'R3'], left: ['L1', 'L2', 'L3'], right: ['R1', 'R2', 'R3'] };
const GLYPHS = { wash: '≈', pulse: '●', columns: '▥', chase: '➤', flash: '✦', wave: '∿', strobe: '⚡', sparkle: '✧', spiral: '↻', ripple: '≈', rain: '↓', bounce: '↕', fire: '♨', alternate: '⇋', center: '⊕', sweep: '◫' };
const EFFECT_GUIDES = {
  wash: ['Atmosfera', 'Mirna baza; karakter određuje koliko prostor diše.'],
  pulse: ['Beat puls', 'Svaki udar ima krivulju i svjetlosnu bazu.'],
  columns: ['Koraci po redovima ili stupcima', 'Odaberi smjer, broj aktivnih i ponašanje ugašenih barova.'],
  chase: ['Putanja zrake', 'Jedna zraka ili više sinkronih putanja; udar može završiti puni prolaz.'],
  flash: ['Svjetlosni akcent', 'Žarište, raspad i trajanje određuju oblik jednog udarca.'],
  wave: ['Prostorni val', 'Oblik, smjer i gustoća mijenjaju kretanje kroz prostor.'],
  strobe: ['Ritmički bljeskovi', 'Učestalost, duljina bljeska i raspored po barovima.'],
  sparkle: ['Iskre', 'Gustoća i mekoća pojedinačnih bljeskova.'],
  spiral: ['Kružna putanja', 'Smjer, rep i centar; ugašene barove može preskočiti.'],
  ripple: ['Širenje', 'Početna točka, smjer i širina vala.'],
  rain: ['Svjetlosna kiša', 'Vrsta kapi i sinkronizacija stupaca.'],
  bounce: ['Odskok', 'Os i krivulja mijenjaju gibanje.'],
  fire: ['Plamen', 'Visina i nemir svjetla.'],
  alternate: ['Izmjena grupa', 'Uzorak i oštrina prijelaza.'],
  center: ['Središnji naglasak', 'Oblik oko C2 i disanje svjetla.'],
  sweep: ['Prelet', 'Smjer i širina prolaza.']
};
const targetName = value => value === 'all' ? 'all' : Object.keys(targetIds).find(k => JSON.stringify(targetIds[k]) === JSON.stringify(value)) || 'all';
const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export function createPerformancePanel(host, ctx) {
  let saved;
  try { saved = JSON.parse(localStorage.getItem(STORAGE) || 'null'); } catch { saved = null; }
  if (Array.isArray(saved) && saved[3]?.preset === 'strobe' && saved[3].intensity === .55) {
    saved[3] = { ...saved[3], color: [1, 1, 1, 1], intensity: 1, params: { ...saved[3].params, rate: '1/8', duty: 'sharp' } };
  }
  const desk = createPerformance(Array.isArray(saved) ? saved : DEFAULT_PADS);
  let selected = 0, lastPaint = 0, lastPads = '', lastTrack = null, effectPickerOpen = false;
  const save = (fromRemote = false) => {
    try { localStorage.setItem(STORAGE, JSON.stringify(desk.pads)); } catch { toast('Postavke padova nije moguće spremiti.', 'error'); }
    if (!fromRemote) ctx.onPadsChange?.(desk.pads, desk.quantize);
  };
  const title = h('strong', { class: 'pf-track' }, 'Odaberi pjesmu');
  const section = h('span', { class: 'pf-section' }, 'Dionice čekaju analizu');
  const next = h('span', { class: 'pf-next' }, 'Sljedeća dionica');
  const beatText = h('strong', { class: 'pf-beat-text' }, 'BEAT —');
  const beatFill = h('i', { class: 'pf-beat-fill' });
  const loopState = h('span', { class: 'pf-loop-state' }, 'Bez petlje');
  const feedback = h('div', { class: 'pf-feedback', role: 'status', 'aria-live': 'polite' }, 'Kratko = okini / uključi. Drži = svira do otpuštanja. ⠿ premješta pad.');
  const pads = h('div', { class: 'pf-pads', role: 'group', 'aria-label': 'Mreža izvedbenih padova' });
  const inspector = h('div', { class: 'pf-inspector' });
  function setQuantize(value, { fromRemote = false } = {}) {
    desk.setQuantize(Boolean(value));
    quant.classList.toggle('on', desk.quantize);
    quant.setAttribute('aria-pressed', String(desk.quantize));
    quant.textContent = desk.quantize ? '● Beat sync' : '○ Odmah';
    if (!fromRemote) ctx.onPadsChange?.(desk.pads, desk.quantize);
  }
  const quant = h('button', { type: 'button', class: 'pf-quant', title: 'Pad počinje na idućem beatu tijekom reprodukcije', 'aria-pressed': 'false', onClick: () => {
    setQuantize(!desk.quantize);
  } }, '○ Odmah');
  const stopAll = h('button', { type: 'button', class: 'pf-stop', title: 'Ugasi izvedbene efekte; spremljeni show ostaje', onClick: () => { desk.clear(); paintPads(); feedback.textContent = 'Svi izvedbeni efekti ugašeni.'; ctx.status('Izvedbeni efekti ugašeni.'); } }, 'Stop FX');
  const recSessionBtn = h('button', {
    type: 'button',
    class: 'pf-rec',
    title: 'Snimaj live izvedbu na vremensku traku (⇧R)',
    'aria-pressed': 'false',
    onClick: () => ctx.toggleRecord?.()
  }, '● REC');
  const cue = h('div', { class: 'pf-cue' },
    h('div', { class: 'pf-cue-song' }, h('span', { class: 'pf-eyebrow' }, 'SADA SVIRA'), title), section,
    h('div', { class: 'pf-beat' }, beatText, h('div', { class: 'pf-beat-track' }, beatFill)), next,
    h('div', { class: 'pf-loop-actions' },
      h('button', { type: 'button', onClick: () => loopBars(4) }, '4 takta'),
      h('button', { type: 'button', onClick: () => loopBars(8) }, '8 taktova'),
      h('button', { type: 'button', onClick: () => { const hit = currentSection(); if (hit) { ctx.setLoop({ start: hit.startSec, end: hit.endSec }); loopState.textContent = `Petlja: ${SECTION_NAMES[hit.type] || hit.type}`; } else ctx.status('Nema detektirane dionice.'); } }, 'Dionica'),
      h('button', { type: 'button', onClick: () => { ctx.setLoop(null); loopState.textContent = 'Bez petlje'; } }, 'Bez petlje')),
    loopState);
  const board = h('div', { class: 'pf-board' },
    h('div', { class: 'pf-board-head' }, h('div', {}, h('b', {}, 'LIVE BOARD'), h('small', {}, '12 mjesta · QWER / ASDF / ZXCV')), h('div', { class: 'pf-board-tools' }, quant, recSessionBtn, stopAll)),
    pads, feedback);
  const split = h('div', { class: 'pf-split', role: 'separator', tabIndex: 0, 'aria-label': 'Širina Live Boarda', 'aria-orientation': 'vertical', title: 'Povuci za širinu · dvoklik vraća početnu veličinu' });
  const root = h('div', { class: 'pf-root' }, cue, board, split, inspector);
  host.append(root);
  const savedWidth = Number(localStorage.getItem('ledicated.perform.inspectorWidth'));
  if (savedWidth >= 20 && savedWidth <= 48) root.style.setProperty('--pf-inspector-w', `${savedWidth}%`);
  const setWidth = px => {
    const total = root.getBoundingClientRect().width;
    const pct = clamp(px / total * 100, 20, 48);
    root.style.setProperty('--pf-inspector-w', `${pct}%`);
    localStorage.setItem('ledicated.perform.inspectorWidth', String(pct));
  };
  let startX = 0, startW = 0;
  split.addEventListener('pointerdown', e => { startX = e.clientX; startW = inspector.getBoundingClientRect().width; split.setPointerCapture(e.pointerId); split.classList.add('active'); });
  split.addEventListener('pointermove', e => { if (split.hasPointerCapture(e.pointerId)) setWidth(startW - (e.clientX - startX)); });
  const endSplit = e => { if (split.hasPointerCapture(e.pointerId)) split.releasePointerCapture(e.pointerId); split.classList.remove('active'); };
  split.addEventListener('pointerup', endSplit); split.addEventListener('pointercancel', endSplit);
  split.addEventListener('keydown', e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); setWidth(inspector.getBoundingClientRect().width + (e.key === 'ArrowLeft' ? 16 : -16)); } });
  split.addEventListener('dblclick', () => { root.style.removeProperty('--pf-inspector-w'); localStorage.removeItem('ledicated.perform.inspectorWidth'); });

  function currentSection() { const t = ctx.songTime(); return ctx.analysis()?.sections?.find(s => t >= s.startSec && t < s.endSec); }
  function loopBars(bars) {
    if (!ctx.hasTrack()) return ctx.status('Odaberi pjesmu za petlju.');
    const beat = 60 / ctx.bpm(), length = beat * 4 * bars;
    const start = Math.floor((ctx.songTime() - (ctx.beatOffset() || 0)) / (beat * 4)) * beat * 4 + (ctx.beatOffset() || 0);
    ctx.setLoop({ start: clamp(start, 0, ctx.duration()), end: clamp(start + length, 0, ctx.duration()) });
    loopState.textContent = `Petlja: ${bars} takta`;
  }
  function padMessage(result, index) {
    const label = PRESET_LABELS[desk.pads[index]?.preset] || PAD_KEYS[index].toUpperCase();
    const message = ({ queued: `${label} čeka idući beat`, started: `${label} svira`, stopped: `${label} ugašen`, latched: `${label} ostaje uključen`, cancelled: `${label} otkazan`, invalid: `Polje ${PAD_KEYS[index].toUpperCase()} je prazno. Odaberi efekt.` })[result];
    if (message) { feedback.textContent = message; ctx.status(message); }
  }
  function trigger(index, { select = false } = {}) {
    if (ctx.blackout()) { feedback.textContent = 'Blackout je aktivan. Otpusti ga za svjetlo.'; return; }
    if (select) { selected = index; effectPickerOpen = false; }
    const result = desk.trigger(index, { songTime: ctx.songTime(), clockTime: ctx.clockTime(), playing: ctx.playing(), bpm: ctx.bpm(), beatOffsetSec: ctx.beatOffset(), beatTimes: ctx.beatTimes() });
    if (result === 'started') {
      if (desk.pads[index]) ctx.recorder?.onPadDown(index, desk.pads[index], ctx.songTime());
    } else if (result === 'queued') {
      const cueTime = nextBeat(ctx.songTime(), ctx.bpm(), ctx.beatOffset(), ctx.beatTimes());
      if (desk.pads[index]) ctx.recorder?.onPadDown(index, desk.pads[index], ctx.songTime(), { isQueued: true, queueTime });
    } else if (result === 'stopped' || result === 'cancelled') {
      ctx.recorder?.onPadUp(index, ctx.songTime());
    }
    padMessage(result, index); paintPads(); if (select) renderInspector();
  }
  const performanceContext = () => ({ songTime: ctx.songTime(), clockTime: ctx.clockTime(), playing: ctx.playing(), bpm: ctx.bpm(), beatOffsetSec: ctx.beatOffset(), beatTimes: ctx.beatTimes() });
  function selectCard(index) {
    selected = index; effectPickerOpen = false;
    [...pads.children].forEach((cell, i) => cell.classList.toggle('selected', i === index));
    renderInspector();
  }
  function openEmptyCard(index) {
    selected = index; effectPickerOpen = true;
    [...pads.children].forEach((cell, i) => cell.classList.toggle('selected', i === index));
    renderInspector();
  }
  function press(index, { select = false } = {}) {
    if (ctx.blackout()) { feedback.textContent = 'Blackout je aktivan. Otpusti ga za svjetlo.'; return; }
    if (select) selectCard(index);
    const result = desk.press(index, performanceContext());
    if (result !== 'held' && result !== 'invalid' && desk.pads[index]) {
      ctx.recorder?.onPadDown(index, desk.pads[index], ctx.songTime());
    }
    padMessage(result, index); syncPadStates();
  }
  function release(index, { cancel = false } = {}) {
    const result = desk.release(index, { clockTime: ctx.clockTime(), cancel });
    if (result !== 'ignored') {
      ctx.recorder?.onPadUp(index, ctx.songTime());
    }
    padMessage(result, index); syncPadStates();
  }
  function releaseAll() {
    desk.releaseAll();
    for (let i = 0; i < desk.pads.length; i++) ctx.recorder?.onPadUp(i, ctx.songTime());
    syncPadStates();
  }
  function assignPreset(preset, index = selected) {
    if (!PRESET_LABELS[preset]) return false;
    selected = index; effectPickerOpen = false;
    desk.setPad(index, { preset, params: {} });
    ctx.recorder?.onPadChange(index, desk.pads[index], ctx.songTime());
    save(); paintPads(); renderInspector();
    feedback.textContent = `${PRESET_LABELS[preset]} dodan na ${PAD_KEYS[index].toUpperCase()}.`;
    return true;
  }
  function movePad(from, to) {
    const fromRect = pads.children[from]?.getBoundingClientRect();
    const toRect = pads.children[to]?.getBoundingClientRect();
    const occupied = Boolean(desk.pads[to]);
    if (!desk.movePad(from, to)) return false;
    selected = to; effectPickerOpen = false; save(); paintPads(); renderInspector();
    if (fromRect && toRect && !reducedMotion()) {
      const glide = (cell, x, y) => cell?.animate([
        { transform: `translate(${x}px, ${y}px) scale(1.04)`, opacity: .72, filter: 'brightness(1.35)' },
        { transform: 'translate(0,0) scale(1)', opacity: 1, filter: 'brightness(1)' }
      ], { duration: 340, easing: 'cubic-bezier(.18,.9,.25,1)' });
      glide(pads.children[to], fromRect.left - toRect.left, fromRect.top - toRect.top);
      if (occupied) glide(pads.children[from], toRect.left - fromRect.left, toRect.top - fromRect.top);
      else pads.children[from]?.animate([{ opacity: 0, transform: 'scale(.7)' }, { opacity: 1, transform: 'scale(1)' }], { duration: 260, easing: 'ease-out' });
    }
    pads.children[to]?.querySelector('.pf-move')?.focus({ preventScroll: true });
    feedback.textContent = from === to ? '' : desk.pads[from] ? `Padovi ${PAD_KEYS[from].toUpperCase()} i ${PAD_KEYS[to].toUpperCase()} zamijenjeni.` : `Efekt premješten na ${PAD_KEYS[to].toUpperCase()}.`;
    return true;
  }
  function installHandle(handle, cell, index) {
    let gesture = null;
    const cleanup = () => {
      gesture?.ghost?.remove(); gesture?.target?.classList.remove('drop');
      if (gesture && handle.hasPointerCapture(gesture.pointerId)) handle.releasePointerCapture(gesture.pointerId);
      gesture = null;
    };
    handle.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      e.preventDefault(); e.stopPropagation();
      const r = cell.getBoundingClientRect();
      gesture = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, offsetX: e.clientX - r.left, offsetY: e.clientY - r.top, width: r.width, height: r.height, ghost: null, target: null };
      handle.setPointerCapture(e.pointerId);
    });
    handle.addEventListener('pointermove', e => {
      if (!gesture || e.pointerId !== gesture.pointerId) return;
      if (!gesture.ghost && Math.hypot(e.clientX - gesture.x, e.clientY - gesture.y) < 5) return;
      if (!gesture.ghost) {
        gesture.ghost = cell.cloneNode(true);
        gesture.ghost.classList.add('pf-ghost');
        gesture.ghost.style.width = `${gesture.width}px`; gesture.ghost.style.height = `${gesture.height}px`;
        document.body.append(gesture.ghost); cell.classList.add('pf-drag-origin');
      }
      gesture.ghost.style.left = `${e.clientX - gesture.offsetX}px`;
      gesture.ghost.style.top = `${e.clientY - gesture.offsetY}px`;
      gesture.target?.classList.remove('drop');
      gesture.target = document.elementFromPoint(e.clientX, e.clientY)?.closest('.pf-cell') || null;
      if (gesture.target === cell) gesture.target = null;
      gesture.target?.classList.add('drop');
    });
    handle.addEventListener('pointerup', e => {
      if (!gesture || e.pointerId !== gesture.pointerId) return;
      const destination = gesture.ghost ? Number(gesture.target?.dataset.index) : NaN;
      const moved = Number.isInteger(destination) && destination >= 0 && destination < desk.pads.length && destination !== index;
      cleanup(); cell.classList.remove('pf-drag-origin');
      if (moved) movePad(index, destination);
      else { selected = index; paintPads(); renderInspector(); }
    });
    handle.addEventListener('pointercancel', () => { cleanup(); cell.classList.remove('pf-drag-origin'); });
    handle.addEventListener('click', e => e.stopPropagation());
    handle.addEventListener('keydown', e => {
      const offset = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -4, ArrowDown: 4 }[e.key];
      if (!offset) return;
      e.preventDefault(); e.stopPropagation(); movePad(index, index + offset);
    });
  }
  function paintPads() {
    const before = [...pads.children].map(cell => ({ active: cell.classList.contains('active'), queued: cell.classList.contains('queued'), label: cell.getAttribute('aria-label'), targets: cell.dataset.targets }));
    pads.replaceChildren(...desk.pads.map((pad, index) => {
      const state = desk.pending.has(index) ? 'queued' : desk.active.has(index) ? 'active' : '';
      const cell = h('div', { class: `pf-cell pf-pad ${pad ? `${pad.mode} ` : 'empty '}${state}${desk.held.has(index) ? ' held' : ''}${selected === index ? ' selected' : ''}`,
        role: 'button', tabIndex: 0, dataset: { index, targets: pad ? (pad.targets === 'all' ? 'all' : pad.targets.join(',')) : 'empty' }, style: { '--pad-color': pad ? rgbHex(pad.color) : '#52728e' },
        'aria-label': pad ? `${PAD_KEYS[index].toUpperCase()} ${PRESET_LABELS[pad.preset]} ${pad.mode === 'hit' ? 'udar' : 'petlja'}${desk.held.has(index) ? ' pritisnut' : ''}` : `${PAD_KEYS[index].toUpperCase()} prazno polje`,
        'aria-pressed': String(desk.active.has(index)),
        onPointerDown: e => { if (e.button !== 0 || e.target.closest('.pf-move')) return; e.preventDefault();
          if (!pad) return openEmptyCard(index);
          cell.setPointerCapture(e.pointerId); cell.focus({ preventScroll: true }); press(index, { select: true }); },
        onPointerUp: e => { if (!pad || !cell.hasPointerCapture(e.pointerId)) return; release(index); cell.releasePointerCapture(e.pointerId); },
        onPointerCancel: e => { if (pad && cell.hasPointerCapture(e.pointerId)) release(index, { cancel: true }); },
        onClick: e => { if (e.detail === 0) pad ? trigger(index, { select: true }) : openEmptyCard(index); },
        onKeyDown: e => { if (e.target !== cell || (e.key !== 'Enter' && e.key !== ' ') || e.repeat) return;
          e.preventDefault(); e.stopPropagation(); pad ? press(index, { select: true }) : openEmptyCard(index); },
        onKeyUp: e => { if (e.target !== cell || (e.key !== 'Enter' && e.key !== ' ')) return;
          e.preventDefault(); e.stopPropagation(); if (pad) release(index); },
        onDragOver: e => { if (e.dataTransfer.types.includes('application/x-ledicated-preset')) { e.preventDefault(); cell.classList.add('drop'); } },
        onDragLeave: () => cell.classList.remove('drop'),
        onDrop: e => { e.preventDefault(); cell.classList.remove('drop'); assignPreset(e.dataTransfer.getData('application/x-ledicated-preset'), index); }
      },
      h('span', { class: 'pf-pad-top' }, h('kbd', {}, PAD_KEYS[index].toUpperCase()), h('span', { class: `pf-pad-state ${pad?.mode || ''}`, title: pad ? (desk.held.has(index) ? 'Drži · prestaje pri otpuštanju' : state === 'queued' ? 'Čeka beat' : state === 'active' ? 'Aktivan efekt' : pad.mode === 'hit' ? 'Udar · svira jednom' : 'Petlja · klik pali/gasi') : 'Slobodno mjesto', 'aria-label': pad ? (pad.mode === 'hit' ? 'Udar' : 'Petlja') : 'Slobodno' }, pad ? (desk.held.has(index) ? '●' : state === 'queued' ? '◌' : state === 'active' ? (pad.mode === 'loop' ? '↻ ON' : '✦ ON') : pad.mode === 'hit' ? '✦' : '↻') : '·')),
      h('span', { class: 'pf-pad-glyph', 'aria-hidden': 'true' }, pad ? GLYPHS[pad.preset] || '✦' : '+'),
      h('span', { class: 'pf-pad-bottom' }, h('strong', {}, pad ? PRESET_LABELS[pad.preset] || pad.preset : 'Prazno'),
        pad ? h('span', { class: 'pf-pad-zone', 'aria-hidden': 'true', title: 'Odabrani barovi' }, ...BAR_IDS.map(id => h('i', { class: pad.targets === 'all' || pad.targets.includes(id) ? 'on' : '' }))) : null),
      h('span', { class: 'pf-pad-meter' }, h('i', { style: { width: `${(pad?.intensity || 0) * 100}%` } })));
      if (pad) {
        const handle = h('button', { type: 'button', class: 'pf-move', title: `Povuci cijeli pad ${PAD_KEYS[index].toUpperCase()} · strelice pomiču po mreži`, 'aria-label': `Premjesti pad ${PAD_KEYS[index].toUpperCase()}` }, '⠿');
        cell.append(handle); installHandle(handle, cell, index);
      }
      return cell;
    }));
    if (!reducedMotion()) [...pads.children].forEach((cell, i) => {
      const nowActive = cell.classList.contains('active'), nowQueued = cell.classList.contains('queued');
      if (before[i] && ((nowActive && !before[i].active) || (nowQueued && !before[i].queued))) cell.animate([
        { transform: 'scale(.88)', filter: 'brightness(2)' }, { transform: 'scale(1.04)', filter: 'brightness(1.45)' }, { transform: 'scale(1)', filter: 'brightness(1)' }
      ], { duration: 300, easing: 'ease-out' });
      else if (before[i] && before[i].label !== cell.getAttribute('aria-label')) cell.animate([
        { opacity: .45, transform: 'scale(.86)' }, { opacity: 1, transform: 'scale(1)' }
      ], { duration: 230, easing: 'cubic-bezier(.18,.9,.25,1)' });
      else if (before[i] && before[i].targets !== cell.dataset.targets) cell.animate([
        { filter: 'brightness(1.8)' }, { filter: 'brightness(1)' }
      ], { duration: 280, easing: 'ease-out' });
    });
  }
  function syncPadStates() {
    [...pads.children].forEach((cell, index) => {
      const pad = desk.pads[index], active = desk.active.has(index), queued = desk.pending.has(index), pressed = desk.held.has(index);
      const newlyPressed = pressed && !cell.classList.contains('held');
      const newlyActive = active && !cell.classList.contains('active');
      cell.classList.toggle('active', active); cell.classList.toggle('queued', queued); cell.classList.toggle('held', pressed);
      cell.classList.toggle('loop', pad?.mode === 'loop'); cell.classList.toggle('hit', pad?.mode === 'hit');
      cell.setAttribute('aria-pressed', String(active));
      if (pad) {
        cell.setAttribute('aria-label', `${PAD_KEYS[index].toUpperCase()} ${PRESET_LABELS[pad.preset]} ${pad.mode === 'hit' ? 'udar' : 'petlja'}${pressed ? ' pritisnut' : ''}`);
        const badge = cell.querySelector('.pf-pad-state');
        badge.textContent = pressed ? '●' : queued ? '◌' : active ? (pad.mode === 'loop' ? '↻ ON' : '✦ ON') : pad.mode === 'hit' ? '✦' : '↻';
        badge.title = pressed ? 'Drži · prestaje pri otpuštanju' : queued ? 'Čeka beat' : active ? 'Aktivan efekt' : pad.mode === 'hit' ? 'Udar · svira jednom' : 'Petlja · klik pali/gasi';
      }
      if ((newlyPressed || newlyActive) && !reducedMotion()) cell.animate([
        { filter: 'brightness(1.8)' }, { filter: 'brightness(1)' }
      ], { duration: 240, easing: 'ease-out' });
    });
  }
  let lastRenderedSelected = selected;
  function renderInspector({ keepScroll = undefined } = {}) {
    const preserve = keepScroll !== undefined ? keepScroll : (lastRenderedSelected === selected);
    const savedScroll = preserve ? inspector.scrollTop : 0;
    lastRenderedSelected = selected;
    const pad = desk.pads[selected];
    const effectPalette = (current, onPick) => h('div', { class: 'pf-effect-palette', role: 'group', 'aria-label': 'Odabir efekta' },
      ...Object.entries(PRESET_LABELS).map(([key, name]) => h('button', {
        type: 'button', class: key === current ? 'on' : '', 'aria-pressed': String(key === current),
        onClick: () => { effectPickerOpen = false; onPick(key); }
      }, h('span', { 'aria-hidden': 'true' }, GLYPHS[key] || '✦'), h('strong', {}, name))));
    const header = h('div', { class: 'pf-inspector-head' },
      h('div', {}, h('span', { class: 'pf-eyebrow' }, 'LIVE EFFECT EDITOR'), h('b', {}, `PAD ${PAD_KEYS[selected].toUpperCase()}`)),
      h('span', { class: 'pf-inspector-live' }, pad ? '● ODMAH' : 'SLOBODNO'));
    if (!pad) {
      inspector.replaceChildren(header,
        h('div', { class: 'pf-empty-editor' }, h('span', {}, '+'), h('strong', {}, 'Prazno mjesto'), h('p', {}, 'Povuci efekt iz kataloga ili dodirni jedan ispod.')),
        effectPalette(null, value => assignPreset(value)));
      if (preserve) inspector.scrollTop = savedScroll;
      return;
    }
    const edit = patch => {
      desk.setPad(selected, patch);
      ctx.recorder?.onPadChange(selected, desk.pads[selected], ctx.songTime());
      save();
      paintPads();
    };
    const commit = patch => { edit(patch); renderInspector(); };
    const choice = (label, value, values, onChange, aria = label) => {
      const buttons = values.map(([key, name]) => h('button', {
        type: 'button', class: key === value ? 'on' : '', 'aria-pressed': String(key === value),
        onClick: () => {
          onChange(key);
          buttons.forEach((button, index) => {
            const active = values[index][0] === key;
            button.classList.toggle('on', active);
            button.setAttribute('aria-pressed', String(active));
          });
        }
      }, name));
      return h('div', { class: 'pf-field' }, h('span', {}, label),
        h('div', { class: 'pf-options', role: 'group', 'aria-label': aria }, ...buttons));
    };
    const range = (label, value, min, max, step, format, onInput, aria = label) => {
      const output = h('output', {}, format(value));
      return h('label', { class: 'pf-field' }, h('span', {}, label), h('div', { class: 'pf-range' },
        h('input', { type: 'range', min, max, step, value, 'aria-label': aria, onInput: e => { const v = Number(e.target.value); onInput(v); output.textContent = format(v); } }), output));
    };
    const dial = (label, value, min, max, step, format, onInput, accent = '#ffc272') => {
      const output = h('output', {}, format(value));
      const face = h('div', { class: 'pf-dial', role: 'slider', tabIndex: 0, 'aria-label': label,
        'aria-valuemin': String(min), 'aria-valuemax': String(max), 'aria-valuenow': String(value), 'aria-valuetext': format(value),
        title: 'Povuci gore/dolje ili koristi strelice' }, h('i', {}), h('span', {}));
      face.style.setProperty('--dial-accent', accent);
      const apply = raw => {
        const next = clamp(Math.round(raw / step) * step, min, max);
        const fraction = (next - min) / (max - min);
        face.style.setProperty('--dial-angle', `${-135 + fraction * 270}deg`);
        face.style.setProperty('--dial-fill', `${fraction * 75}%`);
        face.setAttribute('aria-valuenow', String(next)); face.setAttribute('aria-valuetext', format(next));
        output.textContent = format(next); onInput(next);
      };
      const initial = (value - min) / (max - min);
      face.style.setProperty('--dial-angle', `${-135 + initial * 270}deg`);
      face.style.setProperty('--dial-fill', `${initial * 75}%`);
      let gesture = null;
      face.addEventListener('pointerdown', event => {
        if (event.button !== 0) return;
        event.preventDefault(); face.focus(); face.setPointerCapture(event.pointerId);
        gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, value: Number(face.getAttribute('aria-valuenow')) };
      });
      face.addEventListener('pointermove', event => {
        if (!gesture || event.pointerId !== gesture.id) return;
        apply(gesture.value + (gesture.y - event.clientY + event.clientX - gesture.x) * (max - min) / 170);
      });
      const end = event => { if (gesture && event.pointerId === gesture.id) { gesture = null; if (face.hasPointerCapture(event.pointerId)) face.releasePointerCapture(event.pointerId); } };
      face.addEventListener('pointerup', end); face.addEventListener('pointercancel', end);
      face.addEventListener('keydown', event => {
        const delta = { ArrowUp: step, ArrowRight: step, ArrowDown: -step, ArrowLeft: -step, PageUp: step * 10, PageDown: -step * 10 }[event.key];
        if (delta === undefined && event.key !== 'Home' && event.key !== 'End') return;
        event.preventDefault(); event.stopPropagation();
        apply(event.key === 'Home' ? min : event.key === 'End' ? max : Number(face.getAttribute('aria-valuenow')) + delta);
      });
      return h('div', { class: 'pf-dial-field' }, h('span', {}, label), face, output);
    };
    let currentTargets = pad.targets === 'all' ? [...BAR_IDS] : [...pad.targets];
    let targetSet = new Set(currentTargets);
    const countLabel = h('small', {}, `${currentTargets.length}/9 uključeno`);

    const targetPresets = [
      ['Lijevo', ['L1', 'L2', 'L3']], ['Centar', ['C1', 'C2', 'C3']], ['Desno', ['R1', 'R2', 'R3']],
      ['Rub', ['L1', 'L2', 'L3', 'R1', 'R2', 'R3']], ['Svi', BAR_IDS], ['Križ', ['C1', 'L2', 'C2', 'R2', 'C3']]
    ];

    let targetButtons = [];
    let presetButtons = [];

    const setTargets = values => {
      currentTargets = [...values]; targetSet = new Set(values);
      edit({ targets: values.length === 9 ? 'all' : values });
      countLabel.textContent = `${values.length}/9 uključeno`;
      targetButtons.forEach((button, index) => {
        const id = BAR_IDS[index];
        const on = targetSet.has(id);
        button.classList.toggle('on', on); button.setAttribute('aria-pressed', String(on));
        button.title = `${id} · klikni ili povuci za ${on ? 'isključivanje' : 'uključivanje'} (Option za solo)`;
      });
      presetButtons.forEach((button, index) => {
        const preset = targetPresets[index][1];
        const on = preset.length === values.length && preset.every(id => targetSet.has(id));
        button.classList.toggle('on', on); button.setAttribute('aria-pressed', String(on));
      });
    };

    const toggleTarget = id => {
      const next = targetSet.has(id) ? currentTargets.filter(x => x !== id) : BAR_IDS.filter(x => targetSet.has(x) || x === id);
      if (!next.length) { feedback.textContent = 'Barem jedan bar mora ostati uključen.'; return; }
      setTargets(next);
    };

    let isDragging = false;
    let dragMode = null; // 'add' | 'remove' | 'solo'
    let touchedIds = new Set();
    let lastPoint = null;
    let suppressClick = false;
    let suppressTimer = 0;
    let cachedCells = [];

    const applyCell = id => {
      if (dragMode === 'solo') {
        setTargets(BAR_IDS.filter(b => touchedIds.has(b)));
      } else if (dragMode === 'add') {
        if (!targetSet.has(id)) {
          setTargets(BAR_IDS.filter(b => targetSet.has(b) || b === id));
        }
      } else if (dragMode === 'remove') {
        if (targetSet.has(id)) {
          const next = currentTargets.filter(b => b !== id);
          if (next.length) {
            setTargets(next);
          } else {
            feedback.textContent = 'Barem jedan bar mora ostati uključen.';
          }
        }
      }
    };

    const updateDragAtPoint = (x, y) => {
      if (!isDragging) return;
      const p1 = lastPoint || { x, y };
      const p2 = { x, y };
      lastPoint = p2;

      for (const cell of cachedCells) {
        if (touchedIds.has(cell.id)) continue;
        if (cell.rect && segmentIntersectsRect(p1.x, p1.y, p2.x, p2.y, cell.rect)) {
          touchedIds.add(cell.id);
          applyCell(cell.id);
        }
      }
      const hit = (typeof document !== 'undefined' && document.elementFromPoint)
        ? document.elementFromPoint(x, y)?.closest?.('.pf-target')
        : null;
      const hitId = hit?.dataset?.barId;
      if (hitId && !touchedIds.has(hitId)) {
        touchedIds.add(hitId);
        applyCell(hitId);
      }
    };

    const onPointerMove = e => {
      if (!isDragging) return;
      updateDragAtPoint(e.clientX, e.clientY);
    };

    const onPointerUp = e => {
      if (!isDragging) return;
      isDragging = false;
      targetGrid.classList.remove('dragging');
      try {
        if (e.pointerId !== undefined && targetGrid.hasPointerCapture && targetGrid.hasPointerCapture(e.pointerId)) {
          targetGrid.releasePointerCapture(e.pointerId);
        }
      } catch {}
      if (typeof window !== 'undefined') {
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        window.removeEventListener('pointercancel', onPointerUp);
      }
      clearTimeout(suppressTimer);
      suppressTimer = setTimeout(() => { suppressClick = false; }, 80);
    };

    const onPointerDown = e => {
      if (e.button !== 0) return;
      const targetBtn = e.target?.closest?.('.pf-target');
      const startId = targetBtn?.dataset?.barId || null;

      isDragging = true;
      suppressClick = true;
      clearTimeout(suppressTimer);
      targetGrid.classList.add('dragging');
      try {
        if (e.pointerId !== undefined && targetGrid.setPointerCapture) {
          targetGrid.setPointerCapture(e.pointerId);
        }
      } catch {}

      cachedCells = targetButtons.map(btn => ({
        id: btn.dataset.barId,
        btn,
        rect: btn.getBoundingClientRect ? btn.getBoundingClientRect() : null
      }));

      lastPoint = { x: e.clientX, y: e.clientY };
      touchedIds = new Set();

      if (e.altKey) {
        dragMode = 'solo';
        if (startId) {
          touchedIds.add(startId);
          setTargets([startId]);
        }
      } else if (e.shiftKey) {
        dragMode = 'add';
        if (startId) {
          touchedIds.add(startId);
          if (!targetSet.has(startId)) {
            setTargets(BAR_IDS.filter(id => targetSet.has(id) || id === startId));
          }
        }
      } else if (startId) {
        touchedIds.add(startId);
        if (targetSet.has(startId)) {
          dragMode = 'remove';
          const next = currentTargets.filter(id => id !== startId);
          if (next.length) {
            setTargets(next);
          } else {
            feedback.textContent = 'Barem jedan bar mora ostati uključen.';
          }
        } else {
          dragMode = 'add';
          setTargets(BAR_IDS.filter(id => targetSet.has(id) || id === startId));
        }
      } else {
        dragMode = 'add';
      }

      if (typeof window !== 'undefined') {
        window.addEventListener('pointermove', onPointerMove);
        window.addEventListener('pointerup', onPointerUp);
        window.addEventListener('pointercancel', onPointerUp);
      }
    };

    targetButtons = BAR_IDS.map(id => {
      const on = targetSet.has(id);
      const btn = h('button', {
        type: 'button',
        class: `pf-target ${on ? 'on' : ''}`,
        'aria-label': `Bar ${id}`,
        'aria-pressed': String(on),
        dataset: { barId: id },
        title: `${id} · klikni ili povuci za ${on ? 'isključivanje' : 'uključivanje'} (Option za solo)`,
        onClick: () => {
          if (suppressClick) return;
          toggleTarget(id);
        }
      }, h('i', {}), h('span', {}, id));
      btn.addEventListener('pointerenter', () => {
        if (!isDragging) return;
        if (!touchedIds.has(id)) {
          touchedIds.add(id);
          applyCell(id);
        }
      });
      return btn;
    });

    const targetGrid = h('div', { class: 'pf-target-grid', role: 'group', 'aria-label': 'Odabir LED barova' }, ...targetButtons);
    targetGrid.addEventListener('pointerdown', onPointerDown);

    presetButtons = targetPresets.map(([name, values]) => h('button', {
      type: 'button',
      class: values.length === currentTargets.length && values.every(id => targetSet.has(id)) ? 'on' : '',
      'aria-pressed': String(values.length === currentTargets.length && values.every(id => targetSet.has(id))),
      onClick: () => setTargets(values)
    }, name));

    const targetPanel = h('section', { class: 'pf-editor-section pf-target-section' },
      h('div', { class: 'pf-section-title' }, h('b', {}, 'BAROVI · 3 × 3'), countLabel),
      targetGrid,
      h('div', { class: 'pf-target-presets' }, ...presetButtons),
      h('p', { class: 'pf-section-note' }, 'Svaki pad ima svoju zonu · povuci mišem za odabir reda ili stupca.'));
    const preset = h('div', { class: 'pf-preset-picker' },
      h('button', { type: 'button', class: 'pf-preset-open', 'aria-expanded': String(effectPickerOpen),
        onClick: () => { effectPickerOpen = !effectPickerOpen; renderInspector(); } },
      h('span', { 'aria-hidden': 'true' }, GLYPHS[pad.preset] || '✦'),
      h('strong', {}, PRESET_LABELS[pad.preset]),
      h('small', {}, effectPickerOpen ? 'Zatvori izbor ↑' : 'Promijeni efekt ↓')),
      effectPickerOpen ? effectPalette(pad.preset, value => commit({ preset: value, params: {} })) : null);
    const mode = h('section', { class: 'pf-mode-section' },
      h('div', { class: 'pf-section-title' }, h('b', {}, 'NAČIN SVIRANJA'), h('small', {}, 'Prvo odaberi ponašanje')),
      h('div', { class: 'pf-mode-toggle', role: 'group', 'aria-label': 'Način pada' },
        h('button', { type: 'button', class: pad.mode === 'hit' ? 'on hit' : 'hit', 'aria-pressed': String(pad.mode === 'hit'), onClick: () => commit({ mode: 'hit' }) }, h('span', { class: 'pf-mode-icon' }, '✦'), h('span', {}, h('strong', {}, 'UDAR'), h('small', {}, 'Kratko: jednom · drži: vrti'))),
        h('button', { type: 'button', class: pad.mode === 'loop' ? 'on loop' : 'loop', 'aria-pressed': String(pad.mode === 'loop'), onClick: () => commit({ mode: 'loop' }) }, h('span', { class: 'pf-mode-icon' }, '↻'), h('span', {}, h('strong', {}, 'PETLJA'), h('small', {}, 'Kratko: pali/gasi · drži: trenutno')))));
    const effectControls = (LIVE_PARAM_OPTIONS[pad.preset] || []).map(([key, label, options]) => choice(label, pad.params[key], options,
      value => edit({ params: { ...desk.pads[selected].params, [key]: value } }), `${label} pada`));
    if (pad.preset === 'columns' || pad.preset === 'chase') {
      effectControls.unshift(choice('Smjer putanje', pad.direction,
        [['ltr', 'Lijevo → desno'], ['rtl', 'Desno → lijevo'], ['ttb', 'Gore → dolje'], ['btt', 'Dolje → gore']],
        value => edit({ direction: value }), 'Smjer pada'));
    }
    if (pad.preset === 'chase') effectControls.splice(1, 0, choice('Kretanje', pad.motionMode,
      [['serial', 'Jedan bar za drugim'], ['sync', 'Više redova / stupaca zajedno']],
      value => edit({ motionMode: value }), 'Kretanje trkača'));
    if (['pulse', 'columns', 'chase', 'flash', 'alternate'].includes(pad.preset)) effectControls.push(choice('Ritmički korak', pad.timing,
      [['half', 'Pola beata'], ['beat', 'Beat'], ['bar', 'Takt'], ['2bar', '2 takta'], ['4bar', '4 takta']],
      value => edit({ timing: value }), 'Korak pada'));
    if (pad.preset === 'pulse') effectControls.push(range('Donja razina', Math.round(pad.params.floor * 100), 0, 80, 1, v => `${v}%`,
      v => edit({ params: { ...desk.pads[selected].params, floor: v / 100 } }), 'Donja razina pulsa'));
    if (pad.preset === 'chase') effectControls.push(range('Pozadinski sjaj', Math.round(pad.params.glow * 100), 0, 100, 1, v => `${v}%`,
      v => edit({ params: { ...desk.pads[selected].params, glow: v / 100 } }), 'Sjaj trkača'));
    const [effectHeading, effectDescription] = EFFECT_GUIDES[pad.preset] || ['Oblik', 'Prilagodi svjetlosni uzorak.'];
    const effectPanel = h('section', { class: 'pf-editor-section pf-effect-section' },
      h('div', { class: 'pf-effect-hero' }, h('span', { class: 'pf-effect-icon' }, GLYPHS[pad.preset] || '✦'),
        h('div', {}, h('strong', {}, effectHeading), h('p', {}, effectDescription))),
      preset, h('div', { class: 'pf-effect-params' }, ...effectControls));
    const intensity = dial('JAČINA', Math.round(pad.intensity * 100), 0, 100, 1, v => `${v}%`, v => edit({ intensity: v / 100 }));
    const speed = dial('BRZINA', Math.round(pad.speed * 100), 25, 400, 1, v => `${(v / 100).toFixed(2)}×`, v => edit({ speed: v / 100 }), '#70d7ed');
    const white = dial('BIJELI W', Math.round(pad.color[3] * 100), 0, 100, 1, v => `${v}%`,
      v => edit({ color: [...desk.pads[selected].color.slice(0, 3), v / 100] }), '#fff1c7');
    const hsv = rgbToHsv(pad.color);
    const colorPreview = h('div', { class: 'pf-color-preview', 'aria-hidden': 'true' }, h('i', {}));
    const colorCode = h('code', {}, rgbHex(pad.color).toUpperCase());
    colorPreview.style.setProperty('--rgb-color', rgbHex(pad.color));
    const swatches = COLOR_SWATCHES.map(hex => {
      const button = h('button', { type: 'button', 'aria-label': `Boja ${hex.toUpperCase()}`, 'aria-pressed': String(rgbHex(pad.color) === hex),
        class: rgbHex(pad.color) === hex ? 'on' : '', onClick: () => {
          edit({ color: [...parseHex(hex), desk.pads[selected].color[3]] }); renderInspector();
        } }, h('i', {}));
      button.style.setProperty('--swatch', hex);
      return button;
    });
    const refreshColor = () => {
      const hex = rgbHex(desk.pads[selected].color);
      colorPreview.style.setProperty('--rgb-color', hex); colorCode.textContent = hex.toUpperCase();
      swatches.forEach((button, index) => { const on = COLOR_SWATCHES[index] === hex; button.classList.toggle('on', on); button.setAttribute('aria-pressed', String(on)); });
    };
    const setHsv = patch => {
      const current = rgbToHsv(desk.pads[selected].color);
      const next = { ...current, ...patch };
      edit({ color: [...hsvToRgb(next.h, next.s, next.v), desk.pads[selected].color[3]] }); refreshColor();
      for (const [control, value] of [[saturation, next.s], [brightness, next.v]]) {
        control.querySelector('input').value = String(Math.round(value * 100));
        control.querySelector('output').textContent = `${Math.round(value * 100)}%`;
      }
    };
    const hue = dial('NIJANSA', Math.round(hsv.h), 0, 359, 1, v => `${v}°`,
      v => setHsv({ h: v, s: Math.max(rgbToHsv(desk.pads[selected].color).s, .55), v: Math.max(rgbToHsv(desk.pads[selected].color).v, .7) }), '#ef6ea8');
    hue.classList.add('pf-hue-dial');
    const saturation = range('Zasićenost', Math.round(hsv.s * 100), 0, 100, 1, v => `${v}%`, v => setHsv({ s: v / 100 }));
    const brightness = range('Svjetlina boje', Math.round(hsv.v * 100), 0, 100, 1, v => `${v}%`, v => setHsv({ v: v / 100 }));
    const lightPanel = h('section', { class: 'pf-light-section pf-analog-console' },
      h('div', { class: 'pf-analog-header' },
        h('div', { class: 'pf-analog-title-box' },
          h('span', { class: 'pf-analog-tag' }, 'ANALOG MASTER'),
          h('b', { class: 'pf-analog-title' }, 'SVJETLO')
        ),
        h('small', { class: 'pf-analog-hint' }, 'Uživo se čuje i vidi svaki pomak')
      ),
      h('div', { class: 'pf-dials' }, intensity, speed, white),
      h('div', { class: 'pf-color-rack' },
        h('div', { class: 'pf-color-header' }, colorPreview, h('div', { class: 'pf-color-meta' }, h('strong', {}, 'BOJA'), colorCode)),
        h('div', { class: 'pf-swatches', role: 'group', 'aria-label': 'Brze boje' }, ...swatches),
        h('div', { class: 'pf-color-tune' }, hue, h('div', { class: 'pf-color-sliders' }, saturation, brightness))));
    let playbackPanel;
    if (pad.mode === 'hit') {
      const travel = pad.preset === 'chase' || pad.preset === 'spiral';
      playbackPanel = h('section', { class: 'pf-editor-section pf-playback-section' },
        h('div', { class: 'pf-section-title' }, h('b', {}, 'JEDAN UDAR'), h('small', {}, 'Pokrene se ispočetka')),
        travel ? choice('Duljina puta', pad.hitTravel,
          [['full', 'Cijeli prolaz'], ['half', 'Pola prolaza'], ['quarter', 'Četvrtina prolaza']], value => edit({ hitTravel: value }), 'Duljina puta pri udaru')
          : range('Trajanje', Math.round(pad.hitBeats * 8), 1, 32, 1, v => `${(v / 8).toFixed(v % 8 ? 3 : 0)} beat`,
            v => edit({ hitBeats: v / 8 }), 'Trajanje udarca'));
    } else {
      const drivers = [['none', 'Bez audio drivera'], ['drums', 'Bubnjevi'], ['bass', 'Bas'], ['vocals', 'Vokal'], ['other', 'Ostalo'], ['band', 'Frekvencijski pojas']];
      const controls = [choice('Audio driver', pad.driver, drivers, value => commit({ driver: value }), 'Audio driver petlje')];
      if (pad.driver !== 'none') controls.push(range('Osjetljivost', Math.round(pad.driverGain * 100), 0, 300, 1, v => `${(v / 100).toFixed(2)}×`,
        v => edit({ driverGain: v / 100 }), 'Osjetljivost drivera'));
      if (pad.driver === 'band') {
        const bandNumber = (label, key, min, max, step) => h('label', { class: 'pf-field' }, h('span', {}, label),
          h('input', { type: 'number', min, max, step, value: pad.band[key], 'aria-label': label,
            onChange: e => commit({ band: { ...desk.pads[selected].band, [key]: Number(e.target.value) } }) }));
        controls.push(h('div', { class: 'pf-band-grid' },
          bandNumber('Od Hz', 'lowHz', 25, 17999, 1), bandNumber('Do Hz', 'highHz', 26, 18000, 1),
          bandNumber('Prag', 'threshold', 0, .99, .01), bandNumber('Puni odziv', 'ceiling', .01, 1, .01),
          bandNumber('Otpuštanje · s', 'releaseSec', 0, 2, .01),
          choice('Praćenje', pad.band.mode, [['follow', 'Prati razinu'], ['gate', 'Uključi na pragu']],
            value => commit({ band: { ...desk.pads[selected].band, mode: value } }))));
      }
      playbackPanel = h('section', { class: 'pf-editor-section pf-playback-section' },
        h('div', { class: 'pf-section-title' }, h('b', {}, 'PETLJA I AUDIO'), h('small', {}, 'Radi dok je pad uključen')),
        ...controls, h('p', { class: 'pf-section-note' }, pad.driver === 'none' ? 'Petlja svira po tempu i brzini iznad.' : 'Driver prati lokalnu analizu pjesme; na pauzi zadržava trenutačnu razinu.'));
    }
    const duplicate = h('button', { type: 'button', class: 'pf-duplicate', onClick: () => {
      const empty = desk.pads.findIndex(item => item === null);
      if (empty < 0) { feedback.textContent = 'Nema slobodnog mjesta za kopiju.'; return; }
      const copy = structuredClone(desk.pads[selected]);
      desk.setPad(empty, copy); selected = empty; effectPickerOpen = false; save(); paintPads(); renderInspector();
      feedback.textContent = `Kopija je na ${PAD_KEYS[empty].toUpperCase()}. Odaberi druge barove za drugu zonu.`;
    } }, '＋ Dupliciraj u prazno');
    const remove = h('button', { type: 'button', class: 'pf-remove', onClick: () => {
      desk.removePad(selected); effectPickerOpen = false; save(); paintPads(); renderInspector(); feedback.textContent = `Polje ${PAD_KEYS[selected].toUpperCase()} je prazno.`;
    } }, 'Isprazni polje');
    inspector.replaceChildren(header, lightPanel, mode, targetPanel, effectPanel, playbackPanel,
      h('div', { class: 'pf-editor-actions' }, duplicate, remove),
      h('p', { class: 'pf-tip' }, 'Esc = blackout · pregled i WLED izlaz koriste isti RGBW kadar.'));
    if (preserve) inspector.scrollTop = savedScroll;
  }
  function tick(clockTime) {
    desk.tick({ songTime: ctx.songTime(), clockTime, playing: ctx.playing(), bpm: ctx.bpm() });
    if (ctx.trackId() !== lastTrack) { lastTrack = ctx.trackId(); desk.clear(); }
    if (clockTime - lastPaint < .05) return;
    lastPaint = clockTime;
    const signature = `${selected}|${[...desk.active.keys()].join(',')}|${[...desk.pending.keys()].join(',')}|${[...desk.held.keys()].join(',')}`;
    if (signature !== lastPads) { lastPads = signature; syncPadStates(); }
    title.textContent = ctx.trackTitle() || 'Odaberi pjesmu';
    const hit = currentSection(); section.textContent = hit ? `${SECTION_NAMES[hit.type] || hit.type} · ${fmt(Math.max(0, hit.endSec - ctx.songTime()))} do kraja` : 'Dionice čekaju analizu';
    section.style.setProperty('--section-color', hit ? SECTION_COLORS[hit.type] || '#4cc3ff' : '#536678');
    const upcoming = ctx.analysis()?.sections?.find(s => s.startSec > ctx.songTime() + .1);
    const wanted = upcoming?.type === 'drop' ? ['flash', 'strobe', 'center'] : upcoming?.type === 'build' ? ['pulse', 'chase'] : upcoming?.type === 'breakdown' ? ['wash', 'wave'] : [];
    const suggestion = desk.pads.findIndex(p => p && wanted.includes(p.preset));
    next.textContent = upcoming ? `Sljedeće: ${SECTION_NAMES[upcoming.type] || upcoming.type} za ${fmt(Math.ceil(upcoming.startSec - ctx.songTime()))}${suggestion >= 0 ? ` · probaj ${PAD_KEYS[suggestion].toUpperCase()}` : ''}` : 'Kraj pjesme · pripremi završetak';
    let beat = (ctx.songTime() - ctx.beatOffset()) * ctx.bpm() / 60, phase = ((beat % 1) + 1) % 1;
    const grid = ctx.beatTimes();
    if (Array.isArray(grid) && grid.length > 1) {
      const index = grid.findIndex(item => (typeof item === 'number' ? item : item?.timeSec) > ctx.songTime());
      if (index > 0) {
        const prev = typeof grid[index - 1] === 'number' ? grid[index - 1] : grid[index - 1].timeSec;
        const following = typeof grid[index] === 'number' ? grid[index] : grid[index].timeSec;
        beat = index - 1; phase = clamp((ctx.songTime() - prev) / Math.max(.01, following - prev), 0, 1);
      }
    }
    beatText.textContent = `BEAT ${(Math.floor(beat) % 4 + 4) % 4 + 1}/4`;
    beatFill.style.width = `${phase * 100}%`;
  }
  function syncRecState({ armed, recording } = {}) {
    const isRec = recording ?? ctx.recorder?.isRecording;
    const isArm = armed ?? ctx.recorder?.isArmed;
    recSessionBtn.classList.toggle('on', Boolean(isArm || isRec));
    recSessionBtn.classList.toggle('recording', Boolean(isRec));
    recSessionBtn.setAttribute('aria-pressed', String(Boolean(isArm || isRec)));
    recSessionBtn.textContent = isRec ? '● SNIMA SE' : isArm ? '● REC SPREMAN' : '● REC';
  }
  function setPadConfig(index, patch, { fromRemote = false } = {}) {
    if (!desk.setPad(index, patch)) return false;
    ctx.recorder?.onPadChange(index, desk.pads[index], ctx.songTime());
    save(fromRemote);
    paintPads();
    if (selected === index) renderInspector({ keepScroll: true });
    return true;
  }
  function removePadConfig(index, { fromRemote = false } = {}) {
    if (!desk.removePad(index)) return false;
    save(fromRemote);
    paintPads();
    if (selected === index) renderInspector();
    return true;
  }
  function movePadConfig(from, to, { fromRemote = false } = {}) {
    if (!desk.movePad(from, to)) return false;
    save(fromRemote);
    paintPads();
    renderInspector({ keepScroll: true });
    return true;
  }
  function syncRemotePads(remotePads, remoteQuantize) {
    if (Array.isArray(remotePads) && remotePads.length === 12) {
      for (let i = 0; i < 12; i++) {
        if (remotePads[i] === null) desk.removePad(i);
        else desk.setPad(i, remotePads[i]);
      }
      save(true);
    }
    if (typeof remoteQuantize === 'boolean') {
      setQuantize(remoteQuantize, { fromRemote: true });
    }
    paintPads();
    renderInspector({ keepScroll: true });
  }
  paintPads(); renderInspector();
  return {
    desk, tick, trigger, press, release, releaseAll, assignPreset, syncRecState,
    setPadConfig, removePadConfig, movePadConfig, setQuantize, syncRemotePads,
    clear: () => { desk.clear(); syncPadStates(); feedback.textContent = 'Izvedbeni efekti ugašeni.'; },
    render: (base, clockTime, bpm, scale, analysis, songTime) => desk.render(base, clockTime, bpm, scale, analysis, songTime)
  };
}
