/** Browser panel (left): song library with drag-and-drop import and sets,
 * effect presets (drag into the playlist) and the auto-show generator.
 */
import { TIMELINE_PRESETS } from './timeline.mjs';
import { createKnob, h, showMenu, toast } from './daw-ui.mjs';
import { PRESET_LABELS } from './daw-playlist.mjs';

export const libraryApi = async (path, value) => {
  const response = await fetch(`/api/library/${path}`, value === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Radnja nije uspjela.');
  return result;
};

const PRESET_INFO = {
  wash: ['≋', 'Mirna pozadina koja diše preko svih barova.'],
  pulse: ['◉', 'Svi barovi pulsiraju na beat.'],
  columns: ['▥', 'Stupac po stupac, na svakom beatu.'],
  chase: ['➤', 'Svjetlo trči kroz svih devet barova.'],
  flash: ['✦', 'Jaki naglasak, jači u sredini.'],
  wave: ['∿', 'Val kroz cijelu prostoriju.'],
  strobe: ['⚡', 'Brzi oštri bljeskovi za dropove i vrhunce.'],
  sparkle: ['✧', 'Svjetlucave iskre preko barova na višim tonovima.'],
  spiral: ['◎', 'Kružna rotacija svjetla po vanjskim barovima.'],
  ripple: ['≈', 'Valići koji se šire iz središta prema van.'],
  rain: ['⤓', 'Kišne kapi svjetla koje padaju odozgo prema dolje.'],
  bounce: ['⇅', 'Vertikalni odskok svjetla gore-dolje.'],
  fire: ['🔥', 'Organski plameni uzorak s dinamičnim titranjem.'],
  alternate: ['⇋', 'Izmjenično titranje parnih i neparnih barova.'],
  center: ['⊕', 'Fokusirana eksplozija svjetla iz centra C2.'],
  sweep: ['◫', 'Horizontalni radarski zamašaj slijeva nadesno.']
};

export function createBrowser(host, ctx) {
  const s = { tracks: [], sets: [], setSelection: [], tab: 'songs', filter: '', activeId: null };
  let presetGesture = null, suppressPresetClickUntil = 0;
  const clearPresetGesture = () => {
    if (!presetGesture) return;
    presetGesture.ghost?.remove();
    presetGesture.target?.classList.remove('drop');
    presetGesture.tile.draggable = true;
    presetGesture = null;
  };
  document.addEventListener('pointermove', e => {
    const drag = presetGesture;
    if (!drag || e.pointerId !== drag.pointerId) return;
    if (!drag.ghost && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 8) return;
    if (!drag.ghost) {
      drag.ghost = drag.tile.cloneNode(true);
      drag.ghost.classList.add('preset-ghost');
      drag.ghost.style.width = `${drag.tile.getBoundingClientRect().width}px`;
      document.body.append(drag.ghost);
    }
    drag.ghost.style.left = `${e.clientX + 12}px`;
    drag.ghost.style.top = `${e.clientY + 12}px`;
    drag.target?.classList.remove('drop');
    drag.target = document.elementFromPoint(e.clientX, e.clientY)?.closest('.pf-cell') || null;
    drag.target?.classList.add('drop');
  });
  document.addEventListener('pointerup', e => {
    const drag = presetGesture;
    if (!drag || e.pointerId !== drag.pointerId) return;
    const index = drag.ghost ? Number(drag.target?.dataset.index) : NaN;
    if (Number.isInteger(index) && index >= 0 && index < 12) {
      ctx.onPresetDrop?.(drag.preset, index);
      suppressPresetClickUntil = performance.now() + 350;
    }
    clearPresetGesture();
  });
  document.addEventListener('pointercancel', clearPresetGesture);
  const tabs = h('div', { class: 'tabs', role: 'tablist' });
  const body = h('div', { class: 'br-body' });
  host.append(tabs, body);
  const TABS = [['songs', 'Pjesme'], ['presets', 'Efekti'], ['show', 'Auto show']];

  function renderTabs() {
    const tabBtns = TABS.map(([id, label]) => h('button', { type: 'button', role: 'tab', 'aria-selected': String(s.tab === id), class: s.tab === id ? 'on' : '', onClick: () => { s.tab = id; renderTabs(); renderBody(); } }, label));
    if (ctx.onToggleCollapse) {
      tabBtns.push(h('button', { type: 'button', class: 'panel-collapse-btn', style: { marginLeft: 'auto', alignSelf: 'center', marginBottom: '3px' }, title: 'Sakrij / prikaži katalog (za više mjesta na timelineu)', onClick: () => ctx.onToggleCollapse() }, '◀'));
    }
    tabs.replaceChildren(...tabBtns);
  }

  /* -------------------------------------------------------------- songs */
  async function refresh() { const result = await libraryApi('tracks'); s.tracks = result.tracks; s.sets = result.sets; renderBody(); return s.tracks; }

  async function importFiles(files) {
    for (const file of files) {
      if (!/\.(mp3|wav)$/i.test(file.name)) { ctx.status('Podržani su MP3 i WAV.'); continue; }
      ctx.status(`Uvoz: ${file.name}`);
      try {
        const response = await fetch(`/api/library/import?name=${encodeURIComponent(file.name)}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file });
        const result = await response.json(); if (!response.ok) throw new Error(result.error);
        await refresh(); await ctx.selectTrack(result.track.id);
      } catch (error) { ctx.status(`Uvoz nije uspio: ${error.message}`); toast(`Uvoz nije uspio: ${error.message}`, 'error'); }
    }
  }

  function trackMenu(track, x, y) {
    showMenu(x, y, [
      { label: 'Otvori', onClick: () => ctx.selectTrack(track.id) },
      { label: 'Preimenuj…', onClick: async () => { const title = prompt('Novi naziv pjesme', track.title || track.originalName); if (title?.trim()) { try { await libraryApi('track', { id: track.id, patch: { title: title.trim() } }); await refresh(); ctx.onRenamed?.(track.id); } catch (error) { toast(error.message, 'error'); } } } },
      { label: 'Ponovno analiziraj', onClick: () => ctx.reanalyze(track.id) },
      { separator: true },
      { label: 'Ukloni iz biblioteke…', danger: true, onClick: async () => { if (!confirm(`Ukloniti „${track.title || track.originalName}” iz biblioteke? Audio kopija i show se brišu.`)) return; try { await libraryApi('track-delete', { id: track.id }); await refresh(); ctx.onDeleted?.(track.id); } catch (error) { toast(error.message, 'error'); } } }
    ]);
  }

  function renderSongs() {
    const drop = h('label', { class: 'drop-zone', id: 'drop-zone' }, h('input', { type: 'file', id: 'audio-file', accept: '.mp3,.wav,audio/mpeg,audio/wav', multiple: true, onChange: e => { importFiles([...e.target.files]); e.target.value = ''; } }), h('span', { class: 'drop-icon' }, '＋'), h('strong', {}, 'Dodaj glazbu'), h('small', {}, 'Povuci MP3/WAV ovdje ili bilo gdje u prozor'));
    for (const name of ['dragenter', 'dragover']) drop.addEventListener(name, e => { e.preventDefault(); drop.classList.add('dragging'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('dragging'));
    drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('dragging'); importFiles([...e.dataTransfer.files]); });
    const search = h('input', { type: 'search', placeholder: 'Traži pjesmu…', value: s.filter, 'aria-label': 'Traži pjesmu', onInput: e => { s.filter = e.target.value; renderList(); } });
    const list = h('div', { class: 'track-list', role: 'listbox', 'aria-label': 'Pjesme' });
    const renderList = () => {
      const needle = s.filter.trim().toLowerCase(), activeSet = s.sets.find(set => set.id === setSelect.value);
      const ordered = activeSet ? activeSet.trackIds.map(id => s.tracks.find(t => t.id === id)).filter(Boolean) : s.tracks;
      list.replaceChildren(...ordered.filter(t => !needle || (t.title || t.originalName || '').toLowerCase().includes(needle)).map((track, index) => {
        const check = h('input', { type: 'checkbox', checked: s.setSelection.includes(track.id), title: 'Uključi u set', 'aria-label': `Uključi ${track.title} u set`, onChange: () => { s.setSelection = check.checked ? [...s.setSelection, track.id] : s.setSelection.filter(id => id !== track.id); } });
        const row = h('div', { class: `track-row${track.id === s.activeId ? ' active' : ''}`, role: 'option', 'aria-selected': String(track.id === s.activeId) }, check,
          h('button', { type: 'button', class: 'track-main', onClick: () => ctx.selectTrack(track.id).catch(error => ctx.status(error.message)) },
            h('b', {}, `${activeSet ? `${index + 1}. ` : ''}${track.title || track.originalName || track.id}`),
            h('small', {}, `${(track.sizeBytes / 1048576).toFixed(1)} MB · ${track.hasAnalysis ? 'analizirano' : 'čeka analizu'}${track.hasTimeline ? ' · show' : ''}`)));
        row.addEventListener('contextmenu', e => { e.preventDefault(); trackMenu(track, e.clientX, e.clientY); });
        return row;
      }));
      if (!list.children.length) list.append(h('div', { class: 'empty small' }, s.tracks.length ? 'Nema rezultata.' : 'Biblioteka je prazna. Povuci pjesmu u prozor.'));
    };
    const setName = h('input', { placeholder: 'Naziv seta', 'aria-label': 'Naziv seta' });
    const setSelect = h('select', { 'aria-label': 'Spremljeni set', onChange: () => { const set = s.sets.find(i => i.id === setSelect.value); s.setSelection = set ? [...set.trackIds] : []; setName.value = set?.name || ''; renderList(); } }, h('option', { value: '' }, 'Sve pjesme'), ...s.sets.map(set => h('option', { value: set.id }, set.name)));
    const run = async (fn, ok) => { try { await fn(); await refresh(); ctx.status(ok); } catch (error) { ctx.status(error.message); toast(error.message, 'error'); } };
    const sets = h('details', { class: 'sets' }, h('summary', {}, 'Setovi'), setName, h('div', { class: 'row' },
      h('button', { type: 'button', onClick: () => { const name = setName.value.trim(); if (!name) return ctx.status('Upiši naziv seta.'); if (!s.setSelection.length) return ctx.status('Označi pjesme kvačicama za novi set.'); run(() => libraryApi('set', { name, trackIds: s.setSelection }), 'Set spremljen.'); } }, 'Spremi novi'),
      h('button', { type: 'button', onClick: () => { if (!setSelect.value) return ctx.status('Odaberi set za ažuriranje.'); run(() => libraryApi('set-update', { id: setSelect.value, patch: { name: setName.value.trim(), trackIds: s.setSelection } }), 'Set ažuriran.'); } }, 'Ažuriraj'),
      h('button', { type: 'button', class: 'danger', onClick: () => { if (!setSelect.value) return ctx.status('Odaberi set za uklanjanje.'); const id = setSelect.value; run(async () => { await libraryApi('set-delete', { id }); s.setSelection = []; }, 'Set uklonjen.'); } }, 'Ukloni')));
    sets.open = Boolean(s.sets.length);
    body.replaceChildren(drop, search, setSelect, list, sets);
    renderList();
    if (setSelect.value === '' && s.sets.length === 0) setSelect.hidden = true;
  }

  /* ------------------------------------------------------------ presets */
  function renderPresets() {
    body.replaceChildren(h('p', { class: 'hint' }, 'Povuci efekt u playlistu ili na live pad. U Live boardu klikni efekt za odabrani pad.'),
      h('div', { class: 'preset-grid' }, TIMELINE_PRESETS.map(preset => {
        const tile = h('div', { class: 'preset', draggable: true, tabIndex: 0, role: 'button', 'aria-label': `Efekt ${PRESET_LABELS[preset]}`, title: PRESET_INFO[preset][1] }, h('span', { class: 'glyph' }, PRESET_INFO[preset][0]), h('b', {}, PRESET_LABELS[preset]), h('small', {}, PRESET_INFO[preset][1]));
        tile.addEventListener('dragstart', e => { if (ctx.isPerforming?.()) { e.preventDefault(); return; } e.dataTransfer.setData('application/x-ledicated-preset', preset); e.dataTransfer.effectAllowed = 'copy'; tile.classList.add('dragging'); });
        tile.addEventListener('pointerdown', e => { if (!ctx.isPerforming?.() || e.button !== 0) return; tile.draggable = false; presetGesture = { pointerId: e.pointerId, tile, preset, x: e.clientX, y: e.clientY, ghost: null, target: null }; });
        tile.addEventListener('dragend', () => tile.classList.remove('dragging'));
        tile.addEventListener('click', () => { if (performance.now() >= suppressPresetClickUntil) ctx.onPresetClick?.(preset); });
        tile.addEventListener('dblclick', () => { if (!ctx.onPresetClick?.(preset)) ctx.addPreset(preset); });
        tile.addEventListener('keydown', e => { if (e.key === 'Enter') { if (!ctx.onPresetClick?.(preset)) ctx.addPreset(preset); } });
        return tile;
      })));
  }

  /* --------------------------------------------------------- auto show */
  function renderShow() {
    const energy = createKnob({ label: 'Energija', value: .8, min: 0, max: 1, step: .01, size: 46 });
    const palette = h('select', { 'aria-label': 'Paleta auto showa' }, h('option', { value: 'club' }, 'Klub'), h('option', { value: 'ember' }, 'Žar'), h('option', { value: 'ice' }, 'Led'));
    const an = ctx.getAnalysis?.();
    const secBox = h('div', { class: 'show-sections' });
    if (an?.sections?.length) {
      secBox.append(
        h('label', { class: 'show-sec-title' }, `Detektirane dionice (${an.sections.length})`),
        h('div', { class: 'sec-list' }, an.sections.map(sec =>
          h('div', { class: 'sec-row', style: { '--sec-color': sec.color } },
            h('span', { class: 'sec-badge' }, sec.name),
            h('span', { class: 'sec-time' }, `${sec.startSec.toFixed(1)}s – ${sec.endSec.toFixed(1)}s`),
            h('button', { type: 'button', class: 'mini-btn', title: `Postavi loop na dionicu ${sec.name}`, onClick: () => { ctx.setLoop?.({ start: sec.startSec, end: sec.endSec }); ctx.seek?.(sec.startSec); } }, 'Loop'))))
      );
    }
    body.replaceChildren(
      h('p', { class: 'hint' }, 'Iz analize pjesme i detektiranih dionica (intro, build, drop, breakdown, outro) stvara klupski raspored slojeva sa stem driverima. Rezultat je potpuno editabilan (⌘Z).'),
      h('div', { class: 'show-gen' }, energy.element, h('label', {}, 'Paleta', palette)),
      h('button', { type: 'button', class: 'primary wide', onClick: () => ctx.generateShow({ energy: energy.value, palette: palette.value }) }, 'Generiraj auto show'),
      secBox,
      h('small', { class: 'hint' }, '4 izolirana frekvencijska stema: bubnjevi, bas, vokal i ostalo.')
    );
  }

  function renderBody() { if (s.tab === 'songs') renderSongs(); else if (s.tab === 'presets') renderPresets(); else renderShow(); }
  renderTabs(); renderBody();
  return { refresh, importFiles, setActive(id) { s.activeId = id; if (s.tab === 'songs') renderBody(); }, get tracks() { return s.tracks; } };
}
