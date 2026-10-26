/** Browser panel (left): song library with drag-and-drop import and sets,
 * effect presets (drag into the playlist) and the auto-show generator.
 */
import { SHOW_THEMES, PALETTES, TIMELINE_PRESETS } from './timeline.mjs';
import { clamp, createKnob, h, hexToRgb, rgbToHex, showMenu, toast } from './daw-ui.mjs';
import { PRESET_LABELS } from './daw-playlist.mjs';

export const rgbwToHex = color => rgbToHex(Array.isArray(color) ? color : [1, 1, 1, 0]);

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
  const s = {
    tracks: [],
    sets: [],
    setSelection: [],
    tab: 'songs',
    filter: '',
    activeId: null,
    theme: SHOW_THEMES[0]?.id || 'midnight',
    energy: 0.8,
    customColors: null,
    allowedPresets: new Set(TIMELINE_PRESETS)
  };
  const getThemeById = id => SHOW_THEMES[id] || SHOW_THEMES.find(t => t.id === id) || SHOW_THEMES[0];
  const getCustomColors = () => (Array.isArray(s.customColors) && s.customColors.length === 4) ? s.customColors.map(c => [...c]) : null;
  const getThemeOptions = () => {
    const rawE = Number(s.energy);
    const energy = clamp(Number.isFinite(rawE) ? (rawE > 1 ? rawE / 100 : rawE) : 0.8, 0, 1);
    return {
      palette: s.theme,
      theme: s.theme,
      energy,
      customColors: getCustomColors(),
      allowedPresets: [...s.allowedPresets]
    };
  };
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
  const launcher = createSongLauncher({
    ...ctx,
    importFiles,
    refresh,
    exportTrackPack,
    exportTrackShow,
    shareTrackToGit,
    getTracks: () => s.tracks,
    getSets: () => s.sets,
    getActiveId: () => s.activeId
  });

  async function refresh() {
    const result = await libraryApi('tracks');
    s.tracks = result.tracks;
    s.sets = result.sets;
    renderBody();
    launcher.refresh?.();
    return s.tracks;
  }

  function triggerDownload(url) {
    const a = document.createElement('a');
    a.href = url;
    a.style.display = 'none';
    document.body.append(a);
    a.click();
    setTimeout(() => a.remove(), 500);
  }

  function exportTrackPack(trackId) {
    if (!trackId) return toast('Najprije odaberi pjesmu.', 'error');
    const author = (typeof window !== 'undefined' && window.ledicatedClientName) || '';
    triggerDownload(`/api/library/export-pack/${encodeURIComponent(trackId)}?author=${encodeURIComponent(author)}`);
    toast('Izvoz .ledpack paketa (audio + analiza + show)…', 'ok');
  }

  function exportTrackShow(trackId) {
    if (!trackId) return toast('Najprije odaberi pjesmu.', 'error');
    const author = (typeof window !== 'undefined' && window.ledicatedClientName) || '';
    triggerDownload(`/api/library/export-show/${encodeURIComponent(trackId)}?author=${encodeURIComponent(author)}`);
    toast('Izvoz .ledshow.json datoteke…', 'ok');
  }

  async function shareTrackToGit(trackId, trackTitle = '') {
    if (!trackId) return toast('Najprije odaberi pjesmu.', 'error');
    try {
      const author = (typeof window !== 'undefined' && window.ledicatedClientName) || '';
      const res = await libraryApi('share-to-git', { trackId, author });
      toast(`Spremljeno u shared-shows/${res.filename} (spremno za git commit/push)`, 'ok');
      ctx.status(`Show „${trackTitle || res.filename}” spremljen u shared-shows/${res.filename}`);
      launcher.refresh?.();
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  async function importFiles(files) {
    const author = (typeof window !== 'undefined' && window.ledicatedClientName) || '';
    for (const file of files) {
      const isBundle = /\.(ledpack|json)$/i.test(file.name);
      const isAudio = /\.(mp3|wav|m4a|aac|flac|ogg)$/i.test(file.name);
      if (!isBundle && !isAudio) {
        ctx.status('Podržani su MP3, WAV, M4A, FLAC, .ledpack i .ledshow.json.');
        continue;
      }
      ctx.status(`Uvoz: ${file.name}`);
      try {
        const endpoint = isBundle
          ? `/api/library/import-bundle?name=${encodeURIComponent(file.name)}&trackId=${encodeURIComponent(s.activeId || '')}&author=${encodeURIComponent(author)}`
          : `/api/library/import?name=${encodeURIComponent(file.name)}&author=${encodeURIComponent(author)}`;
        const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file });
        const result = await response.json(); if (!response.ok) throw new Error(result.error);
        await refresh();
        if (result.track?.id) await ctx.selectTrack(result.track.id);
        toast(isBundle ? `Paket „${result.track?.title || file.name}” uvezen!` : `Pjesma „${result.track?.title || file.name}” uvezena!`, 'ok');
      } catch (error) { ctx.status(`Uvoz nije uspio: ${error.message}`); toast(`Uvoz nije uspio: ${error.message}`, 'error'); }
    }
  }

  function trackMenu(track, x, y) {
    showMenu(x, y, [
      { label: 'Otvori u studiju', onClick: () => ctx.selectTrack(track.id) },
      { label: 'Otvori u galeriji (Launcher)…', onClick: () => launcher.open() },
      { separator: true },
      { label: '📦 Izvezi paket pjesma + show (.ledpack)', onClick: () => exportTrackPack(track.id) },
      { label: '✦ Izvezi samo show (.ledshow.json)', onClick: () => exportTrackShow(track.id) },
      { label: '🌐 Spremi show u Git (shared-shows)', onClick: () => shareTrackToGit(track.id, track.title) },
      { separator: true },
      { label: 'Preimenuj…', onClick: async () => { const title = prompt('Novi naziv pjesme', track.title || track.originalName); if (title?.trim()) { try { await libraryApi('track', { id: track.id, patch: { title: title.trim() } }); await refresh(); ctx.onRenamed?.(track.id); } catch (error) { toast(error.message, 'error'); } } } },
      { label: 'Ponovno analiziraj', onClick: () => ctx.reanalyze(track.id) },
      { separator: true },
      { label: 'Ukloni iz biblioteke…', danger: true, onClick: async () => { if (!confirm(`Ukloniti „${track.title || track.originalName}” iz biblioteke? Audio kopija i show se brišu.`)) return; try { await libraryApi('track-delete', { id: track.id }); await refresh(); ctx.onDeleted?.(track.id); } catch (error) { toast(error.message, 'error'); } } }
    ]);
  }

  function renderSongs() {
    const openGalleryBtn = h('button', {
      type: 'button',
      class: 'open-gallery-btn',
      title: 'Otvori proširenu galeriju i launcher pjesama (⌘O)',
      onClick: () => launcher.open()
    },
      h('span', { class: 'og-icon' }, '⊞'),
      h('span', { class: 'og-text' }, 'Galerija & Launcher'),
      h('span', { class: 'og-badge' }, String(s.tracks.length))
    );

    const drop = h('label', { class: 'drop-zone', id: 'drop-zone' }, h('input', { type: 'file', id: 'audio-file', accept: '.mp3,.wav,.m4a,.flac,.ogg,.ledpack,.json,audio/mpeg,audio/wav,application/json', multiple: true, onChange: e => { importFiles([...e.target.files]); e.target.value = ''; } }), h('span', { class: 'drop-icon' }, '＋'), h('strong', {}, 'Dodaj glazbu ili .ledpack'), h('small', {}, 'Povuci MP3/WAV, .ledpack ili .ledshow.json u prozor'));
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
        const { artist, title } = parseTrackTitle(track.title || track.originalName);
        const row = h('div', { class: `track-row${track.id === s.activeId ? ' active' : ''}`, role: 'option', 'aria-selected': String(track.id === s.activeId) }, check,
          h('button', { type: 'button', class: 'track-main', onClick: () => ctx.selectTrack(track.id).catch(error => ctx.status(error.message)) },
            h('b', {}, `${activeSet ? `${index + 1}. ` : ''}${title}`),
            h('small', {}, `${artist ? artist + ' · ' : ''}${(track.sizeBytes / 1048576).toFixed(1)} MB · ${track.hasAnalysis ? 'analizirano' : 'čeka analizu'}${track.hasTimeline ? ' · show' : ''}`)));
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
    body.replaceChildren(openGalleryBtn, drop, search, setSelect, list, sets);
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
    const curTheme = getThemeById(s.theme);
    const energy = createKnob({
      label: 'Energija',
      value: s.energy,
      min: 0,
      max: 1,
      step: .01,
      size: 46,
      onInput: v => { s.energy = v; },
      onChange: v => { s.energy = v; }
    });
    const palette = h('select', { class: 'theme-select', 'aria-label': 'Tema i stil showa' },
      ...SHOW_THEMES.map(th => h('option', { value: th.id, selected: th.id === s.theme, title: th.description }, th.name))
    );
    const themeDesc = h('small', { class: 'theme-desc' }, curTheme.description);

    const SWATCH_ROLES = ['Baza', 'Bas', 'Sint', 'Akcent'];
    const activeCols = s.customColors || curTheme.colors;
    let resetBtn;
    const colorInputs = SWATCH_ROLES.map((role, idx) => {
      const inp = h('input', {
        type: 'color',
        class: 'theme-color-picker',
        value: rgbwToHex(activeCols[idx]),
        'aria-label': `Boja ${role}`,
        title: `${role}: klikni za prilagodbu boje`
      });
      const onColorEdit = () => {
        const baseCols = getThemeById(s.theme).colors;
        s.customColors = colorInputs.map((el, i) => [
          ...hexToRgb(el.value),
          baseCols[i]?.[3] ?? (i === 3 ? 0.55 : 0)
        ]);
        if (resetBtn) resetBtn.disabled = false;
      };
      inp.addEventListener('input', onColorEdit);
      inp.addEventListener('change', onColorEdit);
      return inp;
    });

    resetBtn = h('button', {
      type: 'button',
      class: 'mini-btn theme-reset-btn',
      title: 'Vrati izvorne boje teme',
      'aria-label': 'Vrati izvorne boje teme',
      disabled: !s.customColors,
      onClick: () => {
        s.customColors = null;
        const cols = getThemeById(s.theme).colors;
        colorInputs.forEach((inp, i) => { inp.value = rgbwToHex(cols[i]); });
        resetBtn.disabled = true;
      }
    }, '↺');

    palette.addEventListener('change', () => {
      s.theme = palette.value;
      s.customColors = null;
      const th = getThemeById(s.theme);
      themeDesc.textContent = th.description;
      colorInputs.forEach((inp, i) => { inp.value = rgbwToHex(th.colors[i]); });
      resetBtn.disabled = true;
    });

    const swatchRow = h('div', { class: 'theme-swatches', role: 'group', 'aria-label': 'Paleta boja teme' },
      ...SWATCH_ROLES.map((role, idx) =>
        h('label', { class: 'theme-swatch-item' },
          colorInputs[idx],
          h('span', { class: 'theme-swatch-lbl' }, role)
        )
      ),
      resetBtn
    );

    const fxCountEl = h('span', { class: 'theme-fx-count' }, `${s.allowedPresets.size}/${TIMELINE_PRESETS.length}`);
    const chipButtons = new Map();
    const syncChipsUi = () => {
      for (const [id, btn] of chipButtons.entries()) {
        const on = s.allowedPresets.has(id);
        btn.classList.toggle('on', on);
        btn.setAttribute('aria-pressed', String(on));
      }
      fxCountEl.textContent = `${s.allowedPresets.size}/${TIMELINE_PRESETS.length}`;
    };

    const DROP_PRESETS = ['pulse', 'chase', 'strobe', 'flash', 'alternate', 'columns', 'sweep'];
    const filterRow = h('div', { class: 'theme-fx-filters' },
      h('button', {
        type: 'button',
        class: 'mini-btn',
        title: 'Uključi svih 16 efekata',
        onClick: () => { s.allowedPresets = new Set(TIMELINE_PRESETS); syncChipsUi(); }
      }, 'Svi'),
      h('button', {
        type: 'button',
        class: 'mini-btn',
        title: 'Odaberi preporučene efekte za aktivnu temu',
        onClick: () => {
          const defs = getThemeById(s.theme).defaultPresets || TIMELINE_PRESETS;
          s.allowedPresets = new Set(defs.length ? defs : TIMELINE_PRESETS);
          syncChipsUi();
        }
      }, 'Tema'),
      h('button', {
        type: 'button',
        class: 'mini-btn',
        title: 'Odaberi udarne klupske i drop efekte',
        onClick: () => { s.allowedPresets = new Set(DROP_PRESETS); syncChipsUi(); }
      }, 'Udarni / Drop')
    );

    const fxGrid = h('div', { class: 'theme-fx-grid', role: 'group', 'aria-label': 'Efekti u showu' },
      ...TIMELINE_PRESETS.map(id => {
        const on = s.allowedPresets.has(id);
        const chip = h('button', {
          type: 'button',
          class: `chip theme-fx-chip${on ? ' on' : ''}`,
          'aria-pressed': String(on),
          title: PRESET_INFO[id]?.[1] || PRESET_LABELS[id] || id,
          onClick: () => {
            if (s.allowedPresets.has(id)) {
              if (s.allowedPresets.size <= 1) return; // Never allow 0 chips selected
              s.allowedPresets.delete(id);
            } else {
              s.allowedPresets.add(id);
            }
            syncChipsUi();
          }
        },
          h('span', { class: 'theme-fx-glyph' }, PRESET_INFO[id]?.[0] || '•'),
          h('span', { class: 'theme-fx-name' }, PRESET_LABELS[id] || id)
        );
        chipButtons.set(id, chip);
        return chip;
      })
    );

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
      h('p', { class: 'hint' }, 'Odaberi temu, prilagodi 4 osnovne boje i efekte te generiraj klupski raspored po dionicama (⌘Z za poništavanje).'),
      h('div', { class: 'show-gen' },
        energy.element,
        h('label', { class: 'theme-select-wrap' }, 'Tema i stil showa', palette, themeDesc)
      ),
      swatchRow,
      h('div', { class: 'theme-fx-section' },
        h('div', { class: 'theme-fx-head' },
          h('span', { class: 'show-sec-title' }, 'Efekti u showu'),
          fxCountEl
        ),
        filterRow,
        fxGrid
      ),
      h('button', {
        type: 'button',
        class: 'primary wide',
        onClick: () => {
          s.theme = palette.value;
          const rawE = Number(energy.value);
          s.energy = clamp(Number.isFinite(rawE) ? (rawE > 1 ? rawE / 100 : rawE) : 0.8, 0, 1);
          ctx.generateShow({
            palette: palette.value,
            theme: palette.value,
            energy: s.energy,
            customColors: getCustomColors(),
            allowedPresets: [...s.allowedPresets]
          });
        }
      }, 'Generiraj show s temom'),
      secBox,
      h('small', { class: 'hint' }, '4 izolirana frekvencijska stema: bubnjevi, bas, vokal i ostalo.')
    );
  }

  function renderBody() { if (s.tab === 'songs') renderSongs(); else if (s.tab === 'presets') renderPresets(); else renderShow(); }
  renderTabs(); renderBody();
  return {
    refresh,
    importFiles,
    exportTrackPack,
    exportTrackShow,
    shareTrackToGit,
    setActive(id) { s.activeId = id; if (s.tab === 'songs') renderBody(); },
    get tracks() { return s.tracks; },
    getThemeOptions,
    openLauncher: () => launcher.open(),
    closeLauncher: () => launcher.close(),
    isLauncherOpen: () => launcher.isOpen()
  };
}

/* -------------------------------------------------------------- helpers */
export function parseTrackTitle(rawTitle) {
  if (!rawTitle) return { artist: '', title: 'Nepoznato' };
  const parts = rawTitle.split(' - ');
  if (parts.length >= 2) {
    return { artist: parts[0].trim(), title: parts.slice(1).join(' - ').trim() };
  }
  return { artist: '', title: rawTitle.trim() };
}

export function fmtDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function drawCardBanner(canvas, track, analysis, isAuditioning = false) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const bpm = analysis?.bpm || 120;

  // Background gradient based on tempo and energy
  const grad = ctx.createLinearGradient(0, 0, w, h);
  if (bpm >= 145) {
    // Hard Techno / Club Banger (e.g. Klangkuenstler)
    grad.addColorStop(0, '#10061e');
    grad.addColorStop(0.5, '#2c0838');
    grad.addColorStop(1, '#051426');
  } else if (bpm >= 120) {
    // House / Club Groove
    grad.addColorStop(0, '#061326');
    grad.addColorStop(0.6, '#131e38');
    grad.addColorStop(1, '#1b0e2b');
  } else {
    // Chill / Melodic
    grad.addColorStop(0, '#04171a');
    grad.addColorStop(0.5, '#0a2328');
    grad.addColorStop(1, '#0f172a');
  }
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // Subtle studio grid lines in background
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
  ctx.lineWidth = 1;
  for (let x = 16; x < w; x += 20) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
  }

  // Audio energy / waveform profile
  const env = analysis?.envelopes?.energy || analysis?.envelopes?.drums;
  const waveGrad = ctx.createLinearGradient(0, h * 0.15, 0, h);
  if (bpm >= 145) {
    waveGrad.addColorStop(0, '#ff007f');
    waveGrad.addColorStop(0.6, '#b026ff');
    waveGrad.addColorStop(1, 'rgba(0, 245, 212, 0.25)');
  } else {
    waveGrad.addColorStop(0, '#38bdf8');
    waveGrad.addColorStop(0.7, '#6366f1');
    waveGrad.addColorStop(1, 'rgba(245, 165, 36, 0.15)');
  }
  ctx.fillStyle = waveGrad;

  const barCount = 44;
  const barWidth = w / barCount;
  for (let i = 0; i < barCount; i++) {
    let val = 0.2;
    if (env && env.length) {
      const idx = Math.floor((i / barCount) * env.length);
      val = Math.max(0.12, Math.min(1, env[idx]));
    } else {
      val = 0.2 + 0.3 * Math.abs(Math.sin(i * 0.45 + (track.title?.length || 5)));
    }
    const barH = val * (h * 0.65);
    const x = i * barWidth + 1.5;
    const y = h * 0.88 - barH;
    ctx.fillRect(x, y, Math.max(1, barWidth - 2.5), barH);
  }

  // If auditioning: draw illuminated glow bar at bottom
  if (isAuditioning) {
    ctx.fillStyle = '#4cd37b';
    ctx.shadowColor = '#4cd37b';
    ctx.shadowBlur = 8;
    ctx.fillRect(0, h - 3, w, 3);
    ctx.shadowBlur = 0;
  }
}

/* -------------------------------------------------------- song launcher */
export function createSongLauncher(ctx) {
  const dialog = h('dialog', {
    id: 'song-launcher-dialog',
    class: 'song-launcher-modal',
    'aria-label': 'Katalog pjesama i show launcher'
  });

  const auditionAudio = typeof Audio === 'function'
    ? new Audio()
    : { preload: 'none', paused: true, currentTime: 0, duration: 0, pause() {}, load() {}, play: async () => {}, addEventListener() {}, removeAttribute() {} };
  auditionAudio.preload = 'none';

  const state = {
    open: false,
    tracks: [],
    sets: [],
    sharedShows: [],
    installingShowFile: null,
    details: new Map(), // trackId -> { track, analysis, timeline }
    query: '',
    filter: 'all', // 'all' | 'ready' | 'high_bpm' | 'mid_bpm' | 'shared_git' | set:<id>
    sortBy: 'recent', // 'recent' | 'name' | 'bpm_desc' | 'bpm_asc' | 'duration'
    viewMode: (typeof localStorage !== 'undefined' && localStorage.getItem('ledicated-launcher-view')) || 'grid',
    auditionTrackId: null,
    auditionPlaying: false,
    auditionTime: 0,
    auditionDuration: 0,
    focusedIndex: 0
  };

  // Close when clicking outside on backdrop
  dialog.addEventListener('click', event => {
    if (event.target === dialog) close();
  });

  // Handle cancel event (Esc)
  dialog.addEventListener('cancel', () => {
    state.open = false;
    stopAudition();
  });

  async function loadData() {
    try {
      const [res, sharedRes] = await Promise.all([
        libraryApi('tracks'),
        libraryApi('shared-shows').catch(() => ({ shows: [] }))
      ]);
      state.tracks = res.tracks || [];
      state.sets = res.sets || [];
      state.sharedShows = sharedRes.shows || [];
      // Concurrently fetch analysis details for tracks with analysis
      await Promise.all(state.tracks.map(async t => {
        if (t.hasAnalysis && !state.details.has(t.id)) {
          try {
            const d = await fetch(`/api/library/track/${t.id}`).then(r => r.json());
            state.details.set(t.id, d);
          } catch {}
        }
      }));
    } catch (err) {
      toast(`Greška pri učitavanju kataloga: ${err.message}`, 'error');
    }
  }

  function filterAndSortTracks() {
    let list = [...state.tracks];
    const q = state.query.trim().toLowerCase();
    if (q) {
      list = list.filter(t => {
        const d = state.details.get(t.id);
        const bpm = d?.analysis?.bpm ? String(Math.round(d.analysis.bpm)) : '';
        const title = (t.title || t.originalName || '').toLowerCase();
        return title.includes(q) || bpm.includes(q);
      });
    }

    if (state.filter === 'ready') {
      list = list.filter(t => t.hasTimeline && t.hasAnalysis);
    } else if (state.filter === 'high_bpm') {
      list = list.filter(t => {
        const bpm = state.details.get(t.id)?.analysis?.bpm || 0;
        return bpm >= 140;
      });
    } else if (state.filter === 'mid_bpm') {
      list = list.filter(t => {
        const bpm = state.details.get(t.id)?.analysis?.bpm || 0;
        return bpm >= 100 && bpm < 140;
      });
    } else if (state.filter.startsWith('set:')) {
      const setId = state.filter.slice(4);
      const s = state.sets.find(item => item.id === setId);
      if (s) list = list.filter(t => s.trackIds.includes(t.id));
    }

    if (state.sortBy === 'name') {
      list.sort((a, b) => (a.title || a.originalName || '').localeCompare(b.title || b.originalName || ''));
    } else if (state.sortBy === 'bpm_desc') {
      list.sort((a, b) => (state.details.get(b.id)?.analysis?.bpm || 0) - (state.details.get(a.id)?.analysis?.bpm || 0));
    } else if (state.sortBy === 'bpm_asc') {
      list.sort((a, b) => (state.details.get(a.id)?.analysis?.bpm || 0) - (state.details.get(b.id)?.analysis?.bpm || 0));
    } else if (state.sortBy === 'duration') {
      list.sort((a, b) => (state.details.get(b.id)?.analysis?.durationSec || 0) - (state.details.get(a.id)?.analysis?.durationSec || 0));
    } else { // 'recent'
      list.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    }
    return list;
  }

  function toggleAudition(trackId) {
    if (state.auditionTrackId === trackId && state.auditionPlaying) {
      auditionAudio.pause();
      state.auditionPlaying = false;
    } else {
      if (state.auditionTrackId !== trackId) {
        auditionAudio.src = `/api/library/audio/${trackId}`;
        state.auditionTrackId = trackId;
      }
      auditionAudio.play().catch(e => console.error(e));
      state.auditionPlaying = true;
    }
    renderAuditionBar();
    renderContent();
  }

  function stopAudition() {
    auditionAudio.pause();
    auditionAudio.removeAttribute('src');
    state.auditionPlaying = false;
    state.auditionTrackId = null;
    renderAuditionBar();
    renderContent();
  }

  auditionAudio.ontimeupdate = () => {
    state.auditionTime = auditionAudio.currentTime;
    state.auditionDuration = auditionAudio.duration || 0;
    updateAuditionProgress();
  };

  auditionAudio.onended = () => {
    state.auditionPlaying = false;
    renderAuditionBar();
    renderContent();
  };

  async function selectAndLoad(trackId) {
    stopAudition();
    close();
    try {
      await ctx.selectTrack(trackId);
    } catch (err) {
      ctx.status(`Greška: ${err.message}`);
      toast(err.message, 'error');
    }
  }

  function updateAuditionProgress() {
    const timeLabel = dialog.querySelector('.audition-time');
    const scrubber = dialog.querySelector('.audition-scrubber');
    if (timeLabel) timeLabel.textContent = `${fmtDuration(state.auditionTime)} / ${fmtDuration(state.auditionDuration)}`;
    if (scrubber && !scrubber.matches(':active')) {
      const pct = state.auditionDuration > 0 ? (state.auditionTime / state.auditionDuration) * 100 : 0;
      scrubber.value = String(pct);
    }
  }

  const container = h('div', { class: 'launcher-container' });
  const header = h('div', { class: 'launcher-header' });
  const toolbar = h('div', { class: 'launcher-toolbar' });
  const content = h('div', { class: 'launcher-content' });
  const auditionBar = h('div', { class: 'launcher-audition-bar', hidden: true });
  const dropOverlay = h('div', { class: 'launcher-drop-zone' },
    h('span', {}, '＋'),
    h('strong', {}, 'Ispusti audio datoteku ovdje'),
    h('small', {}, 'MP3 ili WAV · automatski uvoz i analiza')
  );

  container.append(header, toolbar, content, auditionBar, dropOverlay);
  dialog.append(container);

  // Drag and drop into launcher
  let launcherDragDepth = 0;
  dialog.addEventListener('dragenter', e => {
    e.preventDefault();
    launcherDragDepth++;
    dropOverlay.classList.add('dragging');
  });
  dialog.addEventListener('dragleave', e => {
    e.preventDefault();
    launcherDragDepth = Math.max(0, launcherDragDepth - 1);
    if (!launcherDragDepth) dropOverlay.classList.remove('dragging');
  });
  dialog.addEventListener('dragover', e => e.preventDefault());
  dialog.addEventListener('drop', async e => {
    e.preventDefault();
    launcherDragDepth = 0;
    dropOverlay.classList.remove('dragging');
    const files = [...e.dataTransfer.files];
    if (files.length) {
      await ctx.importFiles(files);
      await loadData();
      render();
    }
  });

  function renderHeader() {
    const totalCount = state.tracks.length;
    const titleGroup = h('div', { class: 'launcher-title-group' },
      h('div', { class: 'launcher-icon-mark' }, '⊞'),
      h('div', {},
        h('h2', {}, 'KATALOG PJESAMA & SHOW LAUNCHER'),
        h('p', { class: 'launcher-subtitle' }, 'Odabir pjesme, analiza stemova, auto-show i brzi pregled za 3×3 matricu')
      )
    );
    const headerRight = h('div', { class: 'launcher-header-right' },
      h('span', { class: 'launcher-stats-chip' }, `${totalCount} ${totalCount === 1 ? 'pjesma' : 'pjesme'} · Apple M3 Max DSP`),
      h('button', {
        type: 'button',
        class: 'launcher-close-btn',
        title: 'Zatvori katalog (Esc)',
        onClick: () => close()
      }, '✕')
    );
    header.replaceChildren(titleGroup, headerRight);
  }

  function renderToolbar() {
    // Search row
    const searchInput = h('input', {
      type: 'search',
      class: 'launcher-search-input',
      placeholder: 'Pretraži po nazivu, izvođaču, tempu (BPM)... (Esc za izlaz)',
      value: state.query,
      onInput: e => {
        state.query = e.target.value;
        clearBtn.hidden = !state.query;
        renderContent();
      }
    });
    const clearBtn = h('button', {
      type: 'button',
      class: 'search-clear-btn',
      title: 'Očisti pretragu',
      hidden: !state.query,
      onClick: () => {
        state.query = '';
        searchInput.value = '';
        clearBtn.hidden = true;
        renderContent();
        searchInput.focus();
      }
    }, '✕');
    const searchBox = h('div', { class: 'launcher-search-box' },
      h('span', { class: 'search-icon' }, '🔍'),
      searchInput,
      clearBtn,
      h('kbd', {}, 'Esc')
    );
    const searchRow = h('div', { class: 'launcher-search-row' }, searchBox);

    // Filters row
    const total = state.tracks.length;
    const readyCount = state.tracks.filter(t => t.hasTimeline && t.hasAnalysis).length;
    const highBpmCount = state.tracks.filter(t => (state.details.get(t.id)?.analysis?.bpm || 0) >= 140).length;
    const midBpmCount = state.tracks.filter(t => {
      const b = state.details.get(t.id)?.analysis?.bpm || 0;
      return b >= 100 && b < 140;
    }).length;

    const pills = [
      { id: 'all', label: 'Sve pjesme', count: total },
      { id: 'ready', label: 'Spremne za show', count: readyCount },
      { id: 'shared_git', label: '🌐 Dijeljeni showovi (Git)', count: state.sharedShows.length },
      { id: 'high_bpm', label: 'Visoki BPM (>140)', count: highBpmCount },
      { id: 'mid_bpm', label: 'Umjereni BPM', count: midBpmCount }
    ];
    for (const s of state.sets) {
      pills.push({ id: `set:${s.id}`, label: `Set: ${s.name}`, count: s.trackIds.length });
    }

    const pillsWrap = h('div', { class: 'launcher-filter-pills' },
      ...pills.map(p => h('button', {
        type: 'button',
        class: `launcher-pill${state.filter === p.id ? ' on' : ''}`,
        onClick: () => {
          state.filter = p.id;
          renderToolbar();
          renderContent();
        }
      }, h('span', {}, p.label), h('span', { class: 'pill-count' }, String(p.count))))
    );

    // Controls right
    const sortSelect = h('select', {
      class: 'launcher-sort-select',
      'aria-label': 'Sortiraj po',
      onChange: e => {
        state.sortBy = e.target.value;
        renderContent();
      }
    },
      h('option', { value: 'recent', selected: state.sortBy === 'recent' }, 'Sortiraj: Najnovije dodano'),
      h('option', { value: 'name', selected: state.sortBy === 'name' }, 'Sortiraj: Naziv (A–Z)'),
      h('option', { value: 'bpm_desc', selected: state.sortBy === 'bpm_desc' }, 'Sortiraj: BPM (najbrži prvo)'),
      h('option', { value: 'bpm_asc', selected: state.sortBy === 'bpm_asc' }, 'Sortiraj: BPM (najsporiji prvo)'),
      h('option', { value: 'duration', selected: state.sortBy === 'duration' }, 'Sortiraj: Trajanje')
    );

    const viewGridBtn = h('button', {
      type: 'button',
      class: `vm-btn${state.viewMode === 'grid' ? ' on' : ''}`,
      title: 'Prikaz kartica',
      onClick: () => {
        state.viewMode = 'grid';
        if (typeof localStorage !== 'undefined') localStorage.setItem('ledicated-launcher-view', 'grid');
        renderToolbar();
        renderContent();
      }
    }, '⊞ Galerija');

    const viewTableBtn = h('button', {
      type: 'button',
      class: `vm-btn${state.viewMode === 'table' ? ' on' : ''}`,
      title: 'Tablični popis',
      onClick: () => {
        state.viewMode = 'table';
        if (typeof localStorage !== 'undefined') localStorage.setItem('ledicated-launcher-view', 'table');
        renderToolbar();
        renderContent();
      }
    }, '☰ Popis');

    const viewModeToggle = h('div', { class: 'view-mode-toggle' }, viewGridBtn, viewTableBtn);

    const fileInput = h('input', {
      type: 'file',
      accept: '.mp3,.wav,.m4a,.flac,.ogg,.ledpack,.json,audio/mpeg,audio/wav,application/json',
      multiple: true,
      style: { display: 'none' },
      onChange: async e => {
        if (e.target.files.length) {
          await ctx.importFiles([...e.target.files]);
          e.target.value = '';
          await loadData();
          render();
        }
      }
    });
    const addSongBtn = h('button', {
      type: 'button',
      class: 'add-song-btn',
      title: 'Uvezi MP3/WAV, .ledpack paket ili .ledshow.json show',
      onClick: () => fileInput.click()
    }, '＋ Dodaj glazbu / .ledpack', fileInput);

    const controlsRight = h('div', { class: 'launcher-controls-right' }, sortSelect, viewModeToggle, addSongBtn);
    const filtersRow = h('div', { class: 'launcher-filters-row' }, pillsWrap, controlsRight);

    toolbar.replaceChildren(searchRow, filtersRow);
  }

  function renderSharedGitShows() {
    const q = state.query.trim().toLowerCase();
    const filtered = state.sharedShows.filter(sh => !q || (sh.title || '').toLowerCase().includes(q) || (sh.author || '').toLowerCase().includes(q));
    if (!filtered.length) {
      content.replaceChildren(
        h('div', { class: 'launcher-empty' },
          h('div', { class: 'launcher-empty-icon' }, '🌐'),
          h('h3', {}, 'Nema dijeljenih Git showova'),
          h('p', {}, 'Spremi show na bilo kojoj pjesmi putem „••• → 🌐 Spremi show u Git (shared-shows)” kako bi ga prijatelji dobili nakon git pull-a.')
        )
      );
      return;
    }

    const grid = h('div', { class: 'launcher-grid' });
    for (const sh of filtered) {
      const localMatch = state.tracks.find(t =>
        (sh.videoId && t.videoId === sh.videoId) ||
        (sh.sha256 && t.sha256 === sh.sha256) ||
        (sh.title && (t.title || '').toLowerCase() === sh.title.toLowerCase())
      );
      const isInstalling = state.installingShowFile === sh.filename;
      const { artist, title } = parseTrackTitle(sh.title || sh.filename);
      const card = h('div', { class: `song-card${localMatch ? ' active' : ''}` });

      const canvas = h('canvas', { class: 'sc-canvas', width: 310, height: 102 });
      requestAnimationFrame(() => drawCardBanner(canvas, { title: sh.title }, { bpm: sh.bpm || 128 }, false));

      const pillsLeft = h('div', { class: 'sc-pills-left' },
        h('span', { class: 'sc-pill pill-show' }, `✦ ${sh.clipCount || 0} KLIPOVA`),
        localMatch ? h('span', { class: 'sc-pill pill-active' }, '✓ U BIBLIOTECI') : null
      );
      const pillsRight = h('div', { class: 'sc-pills-right' },
        sh.bpm ? h('span', { class: 'sc-pill pill-bpm' }, `⚡ ${Number(sh.bpm).toFixed(1)} BPM`) : null,
        sh.durationSec ? h('span', { class: 'sc-pill pill-dur' }, `⏱ ${fmtDuration(sh.durationSec)}`) : null
      );
      const banner = h('div', { class: 'sc-banner' }, canvas, pillsLeft, pillsRight);

      const artistEl = artist ? h('div', { class: 'sc-artist', title: artist }, artist) : null;
      const titleEl = h('div', { class: 'sc-title', title }, title);
      const tags = h('div', { class: 'sc-tags' },
        h('span', { class: 'sc-tag' }, `📄 ${sh.layerCount || 3} slojeva`),
        sh.author ? h('span', { class: 'sc-tag' }, `👤 ${sh.author}`) : null,
        sh.videoId ? h('span', { class: 'sc-tag' }, '▶ YouTube auto-audio') : h('span', { class: 'sc-tag' }, 'Lokalni MP3/WAV')
      );
      const body = h('div', { class: 'sc-body' }, artistEl, titleEl, tags);

      const installBtn = h('button', {
        type: 'button',
        class: 'sc-btn-primary',
        disabled: isInstalling,
        onClick: async () => {
          state.installingShowFile = sh.filename;
          renderContent();
          try {
            ctx.status(`Instalacija dijeljenog showa: ${sh.title}…`);
            const res = await libraryApi('install-shared-show', { filename: sh.filename, trackId: localMatch?.id });
            await ctx.refresh?.();
            await loadData();
            state.installingShowFile = null;
            toast(`Show „${sh.title}” spreman u studiju!`, 'ok');
            if (res.track?.id) await selectAndLoad(res.track.id);
          } catch (err) {
            state.installingShowFile = null;
            renderContent();
            toast(err.message, 'error');
          }
        }
      }, isInstalling
        ? '⏳ Preuzimanje…'
        : localMatch
          ? '✦ Učitaj / Sinkroniziraj show'
          : sh.videoId
            ? '📥 Preuzmi pjesmu + show'
            : '✦ Primijeni na aktivnu pjesmu');

      const footer = h('div', { class: 'sc-footer' }, installBtn);
      card.append(banner, body, footer);
      grid.append(card);
    }
    content.replaceChildren(grid);
  }

  function renderContent() {
    if (state.filter === 'shared_git') {
      renderSharedGitShows();
      return;
    }
    const list = filterAndSortTracks();
    if (!list.length) {
      content.replaceChildren(
        h('div', { class: 'launcher-empty' },
          h('div', { class: 'launcher-empty-icon' }, '🔍'),
          h('h3', {}, state.tracks.length ? 'Nema pronađenih pjesama' : 'Biblioteka je prazna'),
          h('p', {}, state.tracks.length ? 'Pokušaj prilagoditi filtere ili upit za pretragu, ili otvori tab „🌐 Dijeljeni showovi (Git)”.' : 'Povuci MP3, WAV ili .ledpack datoteke ovdje, ili klikni na „🌐 Dijeljeni showovi (Git)” iznad.')
        )
      );
      return;
    }

    if (state.viewMode === 'table') {
      renderTable(list);
    } else {
      renderGrid(list);
    }
  }

  function renderGrid(list) {
    const grid = h('div', { class: 'launcher-grid' });
    const activeId = ctx.getActiveId?.();

    for (const track of list) {
      const details = state.details.get(track.id);
      const analysis = details?.analysis;
      const bpm = analysis?.bpm;
      const durationSec = analysis?.durationSec || 0;
      const sections = analysis?.sections || [];
      const isActive = track.id === activeId;
      const isAuditioning = state.auditionTrackId === track.id && state.auditionPlaying;
      const { artist, title } = parseTrackTitle(track.title || track.originalName);

      // Card element
      const card = h('div', { class: `song-card${isActive ? ' active' : ''}${isAuditioning ? ' auditioning' : ''}` });

      // Banner Canvas
      const canvas = h('canvas', { class: 'sc-canvas', width: 310, height: 102 });
      requestAnimationFrame(() => drawCardBanner(canvas, track, analysis, isAuditioning));

      // Overlaid Badges
      const pillsLeft = h('div', { class: 'sc-pills-left' });
      if (isActive) pillsLeft.append(h('span', { class: 'sc-pill pill-active' }, '● AKTIVNA'));
      if (track.hasTimeline) pillsLeft.append(h('span', { class: 'sc-pill pill-show' }, '✦ SHOW'));

      const pillsRight = h('div', { class: 'sc-pills-right' });
      if (bpm) pillsRight.append(h('span', { class: 'sc-pill pill-bpm' }, `⚡ ${bpm.toFixed(1)} BPM`));
      if (durationSec) pillsRight.append(h('span', { class: 'sc-pill pill-dur' }, `⏱ ${fmtDuration(durationSec)}`));

      const playOverlay = h('button', {
        type: 'button',
        class: 'sc-play-overlay',
        title: isAuditioning ? 'Zaustavi preslušavanje' : 'Poslušaj isječak pjesme',
        onClick: e => {
          e.stopPropagation();
          toggleAudition(track.id);
        }
      }, isAuditioning ? '⏸' : '▶');

      const banner = h('div', { class: 'sc-banner' }, canvas, pillsLeft, pillsRight, playOverlay);

      // Card Body
      const artistEl = artist ? h('div', { class: 'sc-artist', title: artist }, artist) : null;
      const titleEl = h('div', { class: 'sc-title', title }, title);

      // Section Miniature Bar
      const sectionsBar = h('div', { class: 'sc-sections-bar', title: 'Struktura pjesme i dionice' });
      if (sections.length && durationSec > 0) {
        for (const sec of sections) {
          const widthPct = Math.max(1, (sec.durationSec / durationSec) * 100);
          const color = sec.color || '#3a86ff';
          sectionsBar.append(h('div', {
            class: 'sc-sec-seg',
            style: { width: `${widthPct}%`, background: color },
            title: `${sec.name}: ${sec.startSec.toFixed(1)}s – ${sec.endSec.toFixed(1)}s (${Math.round((sec.energy || 0.5) * 100)}% energija)`
          }));
        }
      } else {
        sectionsBar.append(h('div', { class: 'sc-sec-seg', style: { width: '100%', background: 'rgba(255,255,255,0.08)' } }));
      }

      // Tags
      const tags = h('div', { class: 'sc-tags' },
        h('span', { class: 'sc-tag' }, '🥁 4 stema'),
        h('span', { class: 'sc-tag' }, sections.length ? `${sections.length} dionica` : 'Cijeli show'),
        track.author ? h('span', { class: 'sc-tag' }, `👤 ${track.author}`) : null,
        h('span', { class: 'sc-tag' }, `${(track.sizeBytes / 1048576).toFixed(1)} MB`)
      );

      const body = h('div', { class: 'sc-body' }, artistEl, titleEl, sectionsBar, tags);

      // Card Footer
      const loadBtn = h('button', {
        type: 'button',
        class: 'sc-btn-primary',
        onClick: () => selectAndLoad(track.id)
      }, isActive ? '✓ Aktivna u studiju' : '▶ Učitaj show');

      const auditionBtn = h('button', {
        type: 'button',
        class: 'sc-btn-secondary',
        title: 'Preslušaj audio bez prekidanja trenutnog showa',
        onClick: () => toggleAudition(track.id)
      }, isAuditioning ? '⏸' : '♫');

      const menuBtn = h('button', {
        type: 'button',
        class: 'sc-btn-menu',
        title: 'Opcije pjesme i dijeljenje',
        onClick: e => {
          e.stopPropagation();
          const r = menuBtn.getBoundingClientRect();
          showMenu(r.left, r.bottom + 4, [
            { label: 'Otvori u studiju', onClick: () => selectAndLoad(track.id) },
            { separator: true },
            { label: '📦 Izvezi paket pjesma + show (.ledpack)', onClick: () => ctx.exportTrackPack?.(track.id) },
            { label: '✦ Izvezi samo show (.ledshow.json)', onClick: () => ctx.exportTrackShow?.(track.id) },
            { label: '🌐 Spremi show u Git (shared-shows)', onClick: async () => {
              await ctx.shareTrackToGit?.(track.id, track.title);
              await loadData();
              render();
            }},
            { separator: true },
            { label: 'Preimenuj…', onClick: async () => {
              const newTitle = prompt('Novi naziv pjesme', track.title || track.originalName);
              if (newTitle?.trim()) {
                try {
                  await libraryApi('track', { id: track.id, patch: { title: newTitle.trim() } });
                  await loadData();
                  render();
                  ctx.onRenamed?.(track.id);
                } catch (err) { toast(err.message, 'error'); }
              }
            }},
            { label: 'Ponovno analiziraj stemove', onClick: async () => {
              await ctx.reanalyze?.(track.id);
              await loadData();
              render();
            }},
            { separator: true },
            { label: 'Ukloni iz biblioteke…', danger: true, onClick: async () => {
              if (!confirm(`Ukloniti „${track.title || track.originalName}”? Audio kopija i timeline se brišu.`)) return;
              try {
                if (state.auditionTrackId === track.id) stopAudition();
                await libraryApi('track-delete', { id: track.id });
                state.details.delete(track.id);
                await loadData();
                render();
                ctx.onDeleted?.(track.id);
              } catch (err) { toast(err.message, 'error'); }
            }}
          ]);
        }
      }, '•••');

      const footer = h('div', { class: 'sc-footer' }, loadBtn, auditionBtn, menuBtn);

      card.append(banner, body, footer);
      grid.append(card);
    }
    content.replaceChildren(grid);
  }

  function renderTable(list) {
    const activeId = ctx.getActiveId?.();
    const rows = list.map((track, idx) => {
      const details = state.details.get(track.id);
      const analysis = details?.analysis;
      const bpm = analysis?.bpm;
      const durationSec = analysis?.durationSec || 0;
      const sections = analysis?.sections || [];
      const isActive = track.id === activeId;
      const isAuditioning = state.auditionTrackId === track.id && state.auditionPlaying;
      const { artist, title } = parseTrackTitle(track.title || track.originalName);

      const secBar = h('div', { class: 'tbl-sec-bar' });
      if (sections.length && durationSec > 0) {
        for (const sec of sections) {
          const w = Math.max(1, (sec.durationSec / durationSec) * 100);
          secBar.append(h('div', { style: { width: `${w}%`, background: sec.color || '#3a86ff', height: '100%' } }));
        }
      }

      const tr = h('tr', {
        class: `${isActive ? 'active' : ''}`,
        onDblClick: () => selectAndLoad(track.id)
      },
        h('td', {}, String(idx + 1)),
        h('td', {}, isActive ? h('span', { class: 'sc-pill pill-active' }, 'AKTIVNA') : (track.hasTimeline ? '✦' : '·')),
        h('td', { class: 'tbl-title-cell' }, h('b', {}, title), artist ? h('small', {}, artist) : null),
        h('td', {}, bpm ? `${bpm.toFixed(1)} BPM` : '—'),
        h('td', {}, fmtDuration(durationSec)),
        h('td', {}, secBar),
        h('td', {}, `${(track.sizeBytes / 1048576).toFixed(1)} MB`),
        h('td', {},
          h('button', { type: 'button', class: 'sc-btn-secondary', style: { height: '26px', padding: '0 8px', marginRight: '6px' }, onClick: () => toggleAudition(track.id) }, isAuditioning ? '⏸' : '♫'),
          h('button', { type: 'button', class: 'sc-btn-primary', style: { height: '26px', padding: '0 10px' }, onClick: () => selectAndLoad(track.id) }, isActive ? 'Otvoreno' : 'Učitaj')
        )
      );
      return tr;
    });

    const table = h('table', { class: 'launcher-table' },
      h('thead', {},
        h('tr', {},
          h('th', {}, '#'),
          h('th', {}, 'Status'),
          h('th', {}, 'Naziv i izvođač'),
          h('th', {}, 'BPM'),
          h('th', {}, 'Trajanje'),
          h('th', {}, 'Struktura'),
          h('th', {}, 'Veličina'),
          h('th', {}, 'Akcije')
        )
      ),
      h('tbody', {}, ...rows)
    );

    const wrap = h('div', { class: 'launcher-table-wrap' }, table);
    content.replaceChildren(wrap);
  }

  function renderAuditionBar() {
    if (!state.auditionTrackId) {
      auditionBar.hidden = true;
      return;
    }
    auditionBar.hidden = false;
    const track = state.tracks.find(t => t.id === state.auditionTrackId);
    if (!track) {
      auditionBar.hidden = true;
      return;
    }
    const { artist, title } = parseTrackTitle(track.title || track.originalName);

    const disc = h('div', { class: 'audition-disc' }, '♫');
    const meta = h('div', { class: 'audition-meta' },
      h('span', { class: 'audition-title', title }, title),
      h('span', { class: 'audition-artist', title: artist || 'LEDicated' }, artist || 'Lokalna zbirka')
    );

    const playBtn = h('button', {
      type: 'button',
      class: 'audition-play-btn',
      title: state.auditionPlaying ? 'Pauziraj preslušavanje' : 'Pokreni preslušavanje',
      onClick: () => {
        if (state.auditionPlaying) {
          auditionAudio.pause();
          state.auditionPlaying = false;
        } else {
          auditionAudio.play().catch(e => console.error(e));
          state.auditionPlaying = true;
        }
        renderAuditionBar();
        renderContent();
      }
    }, state.auditionPlaying ? '⏸' : '▶');

    const timeLabel = h('span', { class: 'audition-time' }, `${fmtDuration(state.auditionTime)} / ${fmtDuration(state.auditionDuration)}`);

    const pct = state.auditionDuration > 0 ? (state.auditionTime / state.auditionDuration) * 100 : 0;
    const scrubber = h('input', {
      type: 'range',
      class: 'audition-scrubber',
      min: '0',
      max: '100',
      step: '0.1',
      value: String(pct),
      onInput: e => {
        if (state.auditionDuration > 0) {
          const t = (Number(e.target.value) / 100) * state.auditionDuration;
          auditionAudio.currentTime = t;
          state.auditionTime = t;
          timeLabel.textContent = `${fmtDuration(state.auditionTime)} / ${fmtDuration(state.auditionDuration)}`;
        }
      }
    });

    const loadBtn = h('button', {
      type: 'button',
      class: 'audition-load-btn',
      title: 'Učitaj ovu pjesmu u studio i zatvori launcher',
      onClick: () => selectAndLoad(track.id)
    }, '↵ Učitaj u studio');

    const closeBtn = h('button', {
      type: 'button',
      class: 'audition-close-btn',
      title: 'Zatvori preslušavanje',
      onClick: () => stopAudition()
    }, '✕');

    auditionBar.className = `launcher-audition-bar${state.auditionPlaying ? ' playing' : ''}`;
    auditionBar.replaceChildren(disc, meta, playBtn, timeLabel, scrubber, loadBtn, closeBtn);
  }

  function render() {
    renderHeader();
    renderToolbar();
    renderContent();
    renderAuditionBar();
  }

  async function open() {
    state.open = true;
    if (!document.body.contains(dialog)) document.body.append(dialog);
    if (!dialog.open) dialog.showModal();
    await loadData();
    render();
    const searchInput = dialog.querySelector('.launcher-search-input');
    if (searchInput) searchInput.focus();
  }

  function close() {
    state.open = false;
    stopAudition();
    if (dialog.open) dialog.close();
  }

  return {
    open,
    close,
    isOpen: () => state.open,
    refresh: async () => {
      await loadData();
      if (state.open) render();
    }
  };
}
