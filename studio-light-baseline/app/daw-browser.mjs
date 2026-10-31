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
    activeSetId: '',
    setName: '',
    setsOpen: null,
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

  async function exportTrackPack(trackId) {
    if (!trackId) return toast('Najprije odaberi pjesmu.', 'error');
    await ctx.flushSave?.();
    const author = (typeof window !== 'undefined' && window.ledicatedClientName) || '';
    triggerDownload(`/api/library/export-pack/${encodeURIComponent(trackId)}?author=${encodeURIComponent(author)}`);
    toast('Izvoz .ledpack paketa (audio + analiza + show)…', 'ok');
  }

  async function exportTrackShow(trackId) {
    if (!trackId) return toast('Najprije odaberi pjesmu.', 'error');
    await ctx.flushSave?.();
    const author = (typeof window !== 'undefined' && window.ledicatedClientName) || '';
    triggerDownload(`/api/library/export-show/${encodeURIComponent(trackId)}?author=${encodeURIComponent(author)}`);
    toast('Izvoz .ledshow.json datoteke…', 'ok');
  }

  async function shareTrackToGit(trackId, trackTitle = '', note = '') {
    if (!trackId) return toast('Najprije odaberi pjesmu.', 'error');
    try {
      await ctx.flushSave?.();
      const author = (typeof window !== 'undefined' && window.ledicatedClientName) || '';
      const clientId = (typeof window !== 'undefined' && window.ledicatedClientId) || '';
      const res = await libraryApi('share-to-git', { trackId, author, clientId, note, forceNewVersion: Boolean(note) });
      const verBadge = res.version ? ` · v${res.version}` : '';
      toast(`☁️ Sinkronizirano u Cloud i shared-shows/${res.filename}${verBadge}`, 'ok');
      ctx.status(`Show „${trackTitle || res.filename}” objavljen u Cloud (${res.filename}${verBadge})`);
      await refresh();
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
      { label: `🕒 Povijest verzija i vraćanje (v${track.version || 1})…`, onClick: () => launcher.openVersionHistory?.(track) },
      { separator: true },
      { label: '📦 Izvezi paket pjesma + show (.ledpack)', onClick: () => exportTrackPack(track.id) },
      { label: '✦ Izvezi samo show (.ledshow.json)', onClick: () => exportTrackShow(track.id) },
      { label: '☁️ Objavi show u Cloud + Git (shared-shows)', onClick: () => shareTrackToGit(track.id, track.title) },
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
      h('span', { class: 'og-text' }, 'Galerija & Cloud Katalog'),
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
        const thumbWrap = h('span', { class: 'track-row-thumb-wrap' }, createTrackThumb(track, 'track-row-thumb'));
        const verStr = track.hasTimeline ? ` · v${track.version || 1}` : '';
        const authorStr = (track.updatedBy || track.author) ? ` · ${track.updatedBy || track.author}` : '';
        const row = h('div', { class: `track-row${track.id === s.activeId ? ' active' : ''}`, role: 'option', 'aria-selected': String(track.id === s.activeId) }, check, thumbWrap,
          h('button', { type: 'button', class: 'track-main', onClick: () => ctx.selectTrack(track.id).catch(error => ctx.status(error.message)) },
            h('b', {}, `${activeSet ? `${index + 1}. ` : ''}${title}`),
            h('small', {}, `${artist ? artist + ' · ' : ''}${(track.sizeBytes / 1048576).toFixed(1)} MB · ${track.hasAnalysis ? 'analizirano' : 'čeka analizu'}${verStr}${authorStr}`)));
        row.addEventListener('contextmenu', e => { e.preventDefault(); trackMenu(track, e.clientX, e.clientY); });
        return row;
      }));
      if (!list.children.length) list.append(h('div', { class: 'empty small' }, s.tracks.length ? 'Nema rezultata.' : 'Biblioteka je prazna. Povuci pjesmu u prozor.'));
    };
    const setName = h('input', { placeholder: 'Naziv seta', 'aria-label': 'Naziv seta', value: s.setName, onInput: () => { s.setName = setName.value; } });
    if (s.activeSetId && !s.sets.some(item => item.id === s.activeSetId)) {
      s.activeSetId = '';
    }
    const setSelect = h('select', { 'aria-label': 'Spremljeni set', onChange: () => { s.activeSetId = setSelect.value; const set = s.sets.find(i => i.id === setSelect.value); s.setSelection = set ? [...set.trackIds] : []; s.setName = set?.name || ''; setName.value = s.setName; renderList(); } }, h('option', { value: '', selected: !s.activeSetId }, 'Sve pjesme'), ...s.sets.map(set => h('option', { value: set.id, selected: set.id === s.activeSetId }, set.name)));
    setSelect.value = s.activeSetId;
    const run = async (fn, ok) => { try { await fn(); await refresh(); ctx.status(ok); } catch (error) { ctx.status(error.message); toast(error.message, 'error'); } };
    const sets = h('details', { class: 'sets' }, h('summary', {}, 'Setovi'), setName, h('div', { class: 'row' },
      h('button', { type: 'button', onClick: () => { const name = setName.value.trim(); if (!name) return ctx.status('Upiši naziv seta.'); if (!s.setSelection.length) return ctx.status('Označi pjesme kvačicama za novi set.'); run(async () => { const res = await libraryApi('set', { name, trackIds: s.setSelection }); if (res?.set?.id) { s.activeSetId = res.set.id; s.setName = res.set.name || name; } }, 'Set spremljen.'); } }, 'Spremi novi'),
      h('button', { type: 'button', onClick: () => { if (!setSelect.value) return ctx.status('Odaberi set za ažuriranje.'); run(async () => { const nextName = setName.value.trim(); await libraryApi('set-update', { id: setSelect.value, patch: { name: nextName, trackIds: s.setSelection } }); s.setName = nextName; }, 'Set ažuriran.'); } }, 'Ažuriraj'),
      h('button', { type: 'button', class: 'danger', onClick: () => { if (!setSelect.value) return ctx.status('Odaberi set za uklanjanje.'); const id = setSelect.value; run(async () => { await libraryApi('set-delete', { id }); s.setSelection = []; s.activeSetId = ''; s.setName = ''; }, 'Set uklonjen.'); } }, 'Ukloni')));
    sets.open = s.setsOpen !== null ? s.setsOpen : Boolean(s.sets.length);
    sets.addEventListener('toggle', () => { s.setsOpen = sets.open; });
    const prevScrollTop = body.scrollTop || 0;
    body.replaceChildren(openGalleryBtn, drop, search, setSelect, list, sets);
    renderList();
    if (setSelect.value === '' && s.sets.length === 0) setSelect.hidden = true;
    if (prevScrollTop > 0) body.scrollTop = prevScrollTop;
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
            ...(s.pipelineConfig || {}),
            palette: palette.value,
            theme: palette.value,
            energy: s.energy,
            customColors: getCustomColors(),
            allowedPresets: [...s.allowedPresets]
          });
        }
      }, 'Generiraj show s temom'),
      ...(typeof ctx.openAutoShowStudio === 'function' ? [
        h('button', {
          type: 'button',
          class: 'ghost wide',
          onClick: () => ctx.openAutoShowStudio()
        }, '✦ Otvori Auto Show & Pipeline Studio')
      ] : []),
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
    openVersionHistory: item => launcher.openVersionHistory?.(item),
    setActive(id) { s.activeId = id; if (s.tab === 'songs') renderBody(); },
    get tracks() { return s.tracks; },
    getThemeOptions,
    openLauncher: tab => launcher.open(tab),
    closeLauncher: () => launcher.close(),
    isLauncherOpen: () => launcher.isOpen()
  };
}

/* -------------------------------------------------------------- helpers */
export function fmtRelativeTime(isoString) {
  if (!isoString) return '';
  const ts = new Date(isoString).getTime();
  if (!Number.isFinite(ts) || ts <= 0) return '';
  const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diffSec < 45) return 'upravo sada';
  const mins = Math.floor(diffSec / 60);
  if (mins < 60) return `prije ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `prije ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `prije ${days} d`;
  return new Date(ts).toLocaleDateString('hr-HR');
}

export function parseTrackTitle(rawTitle) {
  if (!rawTitle) return { artist: '', title: 'Nepoznato' };
  const parts = rawTitle.split(/\s+[-–—]\s+/);
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

export function extractYouTubeId(text) {
  if (typeof text !== 'string' || !text) return null;
  const m = /(?:youtube\.com\/watch\?(?:[^&\s]*&)*v=|youtu\.be\/|youtube\.com\/shorts\/)([A-Za-z0-9_-]{11})/.exec(text);
  return m ? m[1] : null;
}

export function getTrackThumbnailUrls(track) {
  if (!track || typeof track !== 'object') return [];
  const urls = [];
  const videoId = track.videoId || extractYouTubeId(track.sourceUrl);
  if (track.id) {
    urls.push(`/api/library/artwork/${encodeURIComponent(track.id)}`);
  }
  if (videoId) {
    urls.push(`https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg`);
  }
  return urls;
}

export function createTrackThumb(track, className = 'sc-thumb-img', onStatus = null) {
  const urls = getTrackThumbnailUrls(track);
  if (!urls.length) return null;
  let idx = 0;
  const img = h('img', {
    class: className,
    src: urls[0],
    alt: '',
    loading: 'lazy',
    decoding: 'async',
    referrerPolicy: 'no-referrer'
  });
  img.addEventListener('load', () => {
    img.classList.add('is-loaded');
    onStatus?.(true);
  });
  img.addEventListener('error', () => {
    idx += 1;
    if (idx < urls.length) {
      img.src = urls[idx];
    } else {
      img.classList.add('is-broken');
      onStatus?.(false);
    }
  });
  return img;
}

export function drawCardBanner(canvas, track, analysis, isAuditioning = false, hasThumb = false) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const bpm = analysis?.bpm || 120;

  if (!hasThumb) {
    // Background gradient based on tempo and energy when no thumbnail is loaded
    const grad = ctx.createLinearGradient(0, 0, w, h);
    if (bpm >= 145) {
      grad.addColorStop(0, '#10061e');
      grad.addColorStop(0.5, '#2c0838');
      grad.addColorStop(1, '#051426');
    } else if (bpm >= 120) {
      grad.addColorStop(0, '#061326');
      grad.addColorStop(0.6, '#131e38');
      grad.addColorStop(1, '#1b0e2b');
    } else {
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
  }

  // Audio energy / waveform profile
  const env = analysis?.envelopes?.energy || analysis?.envelopes?.drums;
  const waveGrad = ctx.createLinearGradient(0, h * (hasThumb ? 0.55 : 0.15), 0, h);
  if (bpm >= 145) {
    waveGrad.addColorStop(0, hasThumb ? 'rgba(255, 42, 133, 0.92)' : '#ff007f');
    waveGrad.addColorStop(0.6, hasThumb ? 'rgba(176, 38, 255, 0.72)' : '#b026ff');
    waveGrad.addColorStop(1, 'rgba(0, 245, 212, 0.22)');
  } else {
    waveGrad.addColorStop(0, hasThumb ? 'rgba(76, 195, 255, 0.92)' : '#38bdf8');
    waveGrad.addColorStop(0.7, hasThumb ? 'rgba(99, 102, 241, 0.72)' : '#6366f1');
    waveGrad.addColorStop(1, 'rgba(245, 165, 36, 0.18)');
  }
  ctx.fillStyle = waveGrad;

  const barCount = 48;
  const barWidth = w / barCount;
  const maxBarRatio = hasThumb ? 0.34 : 0.65;
  const baselineRatio = hasThumb ? 0.96 : 0.88;
  for (let i = 0; i < barCount; i++) {
    let val = 0.2;
    if (env && env.length) {
      const idx = Math.floor((i / barCount) * env.length);
      val = Math.max(0.12, Math.min(1, env[idx]));
    } else {
      val = 0.2 + 0.3 * Math.abs(Math.sin(i * 0.45 + (track.title?.length || 5)));
    }
    const barH = val * (h * maxBarRatio);
    const x = i * barWidth + 1.5;
    const y = h * baselineRatio - barH;
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

  const versionDialog = h('dialog', {
    id: 'version-history-dialog',
    class: 'version-history-modal',
    closedby: 'any',
    'aria-labelledby': 'vh-modal-title'
  });
  if (typeof HTMLDialogElement !== 'undefined' && !('closedBy' in HTMLDialogElement.prototype)) {
    const isOutside = (e, dlg) => {
      const r = dlg.getBoundingClientRect();
      return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
    };
    let pressedOutside = false;
    versionDialog.addEventListener('pointerdown', e => { pressedOutside = isOutside(e, versionDialog); });
    versionDialog.addEventListener('pointerup', e => { if (pressedOutside && isOutside(e, versionDialog)) versionDialog.close(); });
  }

  const auditionAudio = typeof Audio === 'function'
    ? new Audio()
    : { preload: 'none', paused: true, currentTime: 0, duration: 0, pause() {}, load() {}, play: async () => {}, addEventListener() {}, removeAttribute() {} };
  auditionAudio.preload = 'none';

  const state = {
    open: false,
    catalogTab: 'local', // 'local' | 'cloud'
    tracks: [],
    sets: [],
    sharedShows: [],
    presence: [],
    activity: [],
    cloudConnected: false,
    projectId: 'ledicated-studio-vz',
    installingShowFile: null,
    syncingAll: false,
    details: new Map(), // trackId -> { track, analysis, timeline }
    query: '',
    filter: 'all', // 'all' | 'ready' | 'updates' | 'high_bpm' | 'mid_bpm' | 'shared_git' | set:<id>
    cloudFilter: 'cloud_all', // 'cloud_all' | 'cloud_missing' | 'cloud_updates' | 'cloud_installed'
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

  function findCloudShowForTrack(track) {
    if (!track) return null;
    return state.sharedShows.find(sh =>
      (track.showId && sh.showId === track.showId) ||
      (track.videoId && sh.videoId === track.videoId) ||
      (track.sha256 && sh.sha256 === track.sha256) ||
      (track.title && sh.title && track.title.trim().toLowerCase() === sh.title.trim().toLowerCase())
    ) || null;
  }

  function findLocalTrackForCloudShow(sh) {
    if (!sh) return null;
    return state.tracks.find(t =>
      (sh.showId && t.showId === sh.showId) ||
      (sh.videoId && t.videoId === sh.videoId) ||
      (sh.sha256 && t.sha256 === sh.sha256) ||
      (sh.title && t.title && t.title.trim().toLowerCase() === sh.title.trim().toLowerCase())
    ) || null;
  }

  function findLiveEditors(trackOrShow) {
    if (!trackOrShow || !state.presence.length) return [];
    const myId = typeof window !== 'undefined' ? window.ledicatedClientId : '';
    const titleLower = (trackOrShow.title || trackOrShow.originalName || '').trim().toLowerCase();
    return state.presence.filter(p => {
      if (p.clientId && p.clientId === myId) return false;
      if (trackOrShow.showId && p.showId === trackOrShow.showId) return true;
      if (trackOrShow.id && p.trackId === trackOrShow.id) return true;
      if (titleLower && (p.trackTitle || '').trim().toLowerCase() === titleLower) return true;
      return false;
    });
  }

  async function loadData(forceCloudRefresh = false) {
    try {
      const [res, sharedRes] = await Promise.all([
        libraryApi('tracks'),
        libraryApi(forceCloudRefresh ? 'shared-shows?refresh=1' : 'shared-shows').catch(() => ({ shows: [], presence: [], activity: [] }))
      ]);
      state.tracks = res.tracks || [];
      state.sets = res.sets || [];
      state.sharedShows = sharedRes.shows || [];
      state.presence = sharedRes.presence || [];
      state.activity = sharedRes.activity || [];
      state.cloudConnected = Boolean(sharedRes.cloudConnected);
      if (sharedRes.projectId) state.projectId = sharedRes.projectId;
      const activeId = ctx.getActiveId?.();
      const activeAnalysis = ctx.getAnalysis?.();
      if (activeId && activeAnalysis) {
        state.details.set(activeId, { analysis: activeAnalysis });
      }
    } catch (err) {
      toast(`Greška pri učitavanju kataloga: ${err.message}`, 'error');
    }
  }

  function hasCloudUpdate(track) {
    const cloud = findCloudShowForTrack(track);
    if (!cloud) return false;
    const localVer = Number(track.version) || 1;
    const cloudVer = Number(cloud.version) || 1;
    return cloudVer > localVer;
  }

  function filterAndSortTracks() {
    let list = [...state.tracks];
    const q = state.query.trim().toLowerCase();
    if (q) {
      list = list.filter(t => {
        const d = state.details.get(t.id);
        const bpmVal = t.bpm || d?.analysis?.bpm;
        const bpm = bpmVal ? String(Math.round(bpmVal)) : '';
        const title = (t.title || t.originalName || '').toLowerCase();
        const author = (t.updatedBy || t.author || '').toLowerCase();
        return title.includes(q) || bpm.includes(q) || author.includes(q);
      });
    }

    if (state.filter === 'ready') {
      list = list.filter(t => t.hasTimeline && t.hasAnalysis);
    } else if (state.filter === 'updates') {
      list = list.filter(t => hasCloudUpdate(t));
    } else if (state.filter === 'high_bpm') {
      list = list.filter(t => {
        const bpm = t.bpm || state.details.get(t.id)?.analysis?.bpm || 0;
        return bpm >= 140;
      });
    } else if (state.filter === 'mid_bpm') {
      list = list.filter(t => {
        const bpm = t.bpm || state.details.get(t.id)?.analysis?.bpm || 0;
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
      list.sort((a, b) => (b.bpm || state.details.get(b.id)?.analysis?.bpm || 0) - (a.bpm || state.details.get(a.id)?.analysis?.bpm || 0));
    } else if (state.sortBy === 'bpm_asc') {
      list.sort((a, b) => (a.bpm || state.details.get(a.id)?.analysis?.bpm || 0) - (b.bpm || state.details.get(b.id)?.analysis?.bpm || 0));
    } else if (state.sortBy === 'duration') {
      list.sort((a, b) => (b.durationSec || state.details.get(b.id)?.analysis?.durationSec || 0) - (a.durationSec || state.details.get(a.id)?.analysis?.durationSec || 0));
    } else { // 'recent'
      list.sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0));
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

  async function installOrSyncShow(sh, localMatch = null, version = null) {
    const key = sh.showId || sh.filename;
    state.installingShowFile = key;
    renderContent();
    try {
      ctx.status(`Preuzimanje i sinkronizacija: ${sh.title}${version ? ` (v${version})` : ''}…`);
      const res = await libraryApi('install-shared-show', {
        filename: sh.filename,
        showId: sh.showId,
        trackId: localMatch?.id,
        version
      });
      await ctx.refresh?.();
      await loadData();
      state.installingShowFile = null;
      toast(`☁️ Show „${sh.title}” (v${res.version || sh.version || 1}) spreman u studiju!`, 'ok');
      if (res.track?.id) await selectAndLoad(res.track.id);
    } catch (err) {
      state.installingShowFile = null;
      renderContent();
      toast(err.message, 'error');
    }
  }

  async function openVersionHistory(target) {
    if (!target) return;
    if (!document.body.contains(versionDialog)) document.body.append(versionDialog);
    const localTrack = target.id ? target : findLocalTrackForCloudShow(target);
    const cloudShow = target.showId && !target.id ? target : findCloudShowForTrack(target);
    const showId = target.showId || localTrack?.showId || cloudShow?.showId || '';
    const trackId = localTrack?.id || '';
    const title = target.title || localTrack?.title || cloudShow?.title || 'Show';

    versionDialog.replaceChildren(
      h('div', { class: 'vh-header' },
        h('div', {},
          h('h2', { id: 'vh-modal-title' }, `🕒 Povijest verzija · ${title}`),
          h('small', { class: 'vh-subtitle' }, 'Učitavam verzije iz Firebase oblaka i lokalne povijesti…')
        ),
        h('button', { type: 'button', class: 'launcher-close-btn', onClick: () => versionDialog.close() }, '✕')
      ),
      h('div', { class: 'vh-body' },
        h('div', { class: 'vh-empty' }, '⏳ Dohvaćanje povijesti verzija…')
      )
    );
    if (!versionDialog.open) versionDialog.showModal();

    let versions = [];
    let resolvedShowId = showId;
    try {
      const qs = new URLSearchParams();
      if (showId) qs.set('showId', showId);
      if (trackId) qs.set('trackId', trackId);
      const res = await libraryApi(`versions?${qs.toString()}`);
      versions = res.versions || [];
      if (res.showId) resolvedShowId = res.showId;
    } catch (err) {
      toast(err.message, 'error');
    }

    const noteInput = h('input', {
      type: 'text',
      class: 'vh-note-input',
      placeholder: 'Opcionalna bilješka uz novu verziju (npr. „Jači strobe na dropu 1:15”)…',
      autofocus: true
    });

    const saveNewVerBtn = localTrack
      ? h('button', {
          type: 'button',
          class: 'sc-btn-primary vh-save-btn',
          onClick: async () => {
            saveNewVerBtn.disabled = true;
            saveNewVerBtn.textContent = '⏳ Objavljujem…';
            try {
              await ctx.shareTrackToGit?.(localTrack.id, localTrack.title, noteInput.value.trim() || 'Ručno spremljena verzija');
              await loadData(true);
              render();
              await openVersionHistory(state.tracks.find(t => t.id === localTrack.id) || localTrack);
            } finally {
              saveNewVerBtn.disabled = false;
              saveNewVerBtn.textContent = '☁️ Spremi novu verziju';
            }
          }
        }, '☁️ Spremi novu verziju')
      : null;

    const saveBox = localTrack
      ? h('div', { class: 'vh-save-box' },
          noteInput,
          saveNewVerBtn
        )
      : null;

    const currentVer = localTrack?.version || cloudShow?.version || versions[0]?.version || 1;
    const versionRows = versions.length
      ? versions.map((v, idx) => {
          const isCurrent = Number(v.version) === Number(currentVer) && idx === 0;
          const dateStr = v.createdAt ? new Date(v.createdAt).toLocaleString('hr-HR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
          const relStr = fmtRelativeTime(v.createdAt);
          const restoreBtn = h('button', {
            type: 'button',
            class: isCurrent ? 'sc-btn-secondary vh-restore-btn' : 'sc-btn-primary vh-restore-btn',
            onClick: async () => {
              restoreBtn.disabled = true;
              restoreBtn.textContent = '⏳ Vraćam…';
              try {
                const author = (typeof window !== 'undefined' && window.ledicatedClientName) || 'Studio';
                const clientId = (typeof window !== 'undefined' && window.ledicatedClientId) || '';
                if (localTrack) {
                  const res = await libraryApi('restore-version', {
                    showId: resolvedShowId,
                    version: v.version,
                    trackId: localTrack.id,
                    author,
                    clientId
                  });
                  await ctx.refresh?.();
                  await loadData(true);
                  render();
                  toast(`↺ Vraćena verzija v${v.version} (spremljeno kao v${res.version})!`, 'ok');
                  versionDialog.close();
                  if (res.track?.id) await selectAndLoad(res.track.id);
                } else if (cloudShow) {
                  versionDialog.close();
                  await installOrSyncShow(cloudShow, null, v.version);
                }
              } catch (err) {
                restoreBtn.disabled = false;
                restoreBtn.textContent = '↺ Vrati ovu verziju';
                toast(err.message, 'error');
              }
            }
          }, localTrack
            ? (isCurrent ? '↺ Ponovno učitaj v' + v.version : `↺ Vrati na v${v.version}`)
            : `📥 Preuzmi v${v.version}`);

          return h('div', { class: `vh-item${isCurrent ? ' is-latest' : ''}` },
            h('div', { class: 'vh-item-left' },
              h('div', { class: 'vh-ver-row' },
                h('span', { class: `vh-ver-badge${isCurrent ? ' current' : ''}` }, `v${v.version}`),
                isCurrent ? h('span', { class: 'vh-latest-tag' }, 'ZADNJA VERZIJA') : null,
                h('strong', { class: 'vh-author' }, `👤 ${v.author || 'Studio'}`),
                h('span', { class: 'vh-time', title: dateStr }, `${relStr ? `${relStr} · ` : ''}${dateStr}`)
              ),
              h('div', { class: 'vh-summary' }, v.summary || 'Spremljen show'),
              h('div', { class: 'vh-meta-tags' },
                h('span', { class: 'sc-tag' }, `✦ ${v.clipCount ?? 0} clipova`),
                h('span', { class: 'sc-tag' }, `📄 ${v.layerCount ?? 3} slojeva`),
                v.action === 'restore' ? h('span', { class: 'sc-tag tag-restore' }, '↺ Vraćena verzija') : null
              )
            ),
            h('div', { class: 'vh-item-right' }, restoreBtn)
          );
        })
      : [
          h('div', { class: 'vh-empty' },
            'Za ovu pjesmu još nema zabilježenih verzija u oblaku. Klikni „☁️ Spremi novu verziju” iznad kako bi stvorio v1.'
          )
        ];

    versionDialog.replaceChildren(
      h('div', { class: 'vh-header' },
        h('div', {},
          h('h2', { id: 'vh-modal-title' }, `🕒 Povijest verzija · ${title}`),
          h('small', { class: 'vh-subtitle' },
            `Show ID: ${resolvedShowId || 'lokalni'} · Trenutno: v${currentVer} · Svako spremanje čuva sigurnosnu točku u Firebase oblaku i shared-shows/`
          )
        ),
        h('button', { type: 'button', class: 'launcher-close-btn', onClick: () => versionDialog.close() }, '✕')
      ),
      saveBox,
      h('div', { class: 'vh-body' }, ...versionRows)
    );
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
    const cloudCount = state.sharedShows.length;
    const updatesCount = state.tracks.filter(t => hasCloudUpdate(t)).length;
    const activePeersCount = state.presence.length;
    const currentAuthor = (typeof window !== 'undefined' && window.ledicatedClientName) || 'Studio';

    const titleGroup = h('div', { class: 'launcher-title-group' },
      h('div', { class: 'launcher-icon-mark' }, '⊞'),
      h('div', {},
        h('h2', {}, 'KATALOG PJESAMA & SHOW LAUNCHER'),
        h('p', { class: 'launcher-subtitle' }, 'Zajednička biblioteka, verzije showova (Firebase Cloud + Git) i brzi pregled za 3×3 matricu')
      )
    );

    // Top-level tabs: Local Library vs. Cloud Catalog
    const mainTabs = h('div', { class: 'launcher-main-tabs', role: 'tablist', 'aria-label': 'Izvor kataloga' },
      h('button', {
        type: 'button',
        role: 'tab',
        'aria-selected': String(state.catalogTab === 'local'),
        class: `lmt-tab${state.catalogTab === 'local' ? ' on' : ''}`,
        onClick: () => {
          state.catalogTab = 'local';
          if (state.filter === 'shared_git') state.filter = 'all';
          render();
        }
      },
        h('span', { class: 'lmt-icon' }, '💾'),
        h('span', {}, 'Moja biblioteka (Preuzeto)'),
        h('span', { class: 'lmt-badge' }, String(totalCount)),
        updatesCount > 0 ? h('span', { class: 'lmt-badge update', title: 'Dostupne nove verzije u oblaku' }, `🔄 ${updatesCount}`) : null
      ),
      h('button', {
        type: 'button',
        role: 'tab',
        'aria-selected': String(state.catalogTab === 'cloud'),
        class: `lmt-tab cloud${state.catalogTab === 'cloud' ? ' on' : ''}`,
        onClick: () => {
          state.catalogTab = 'cloud';
          render();
        }
      },
        h('span', { class: 'lmt-icon' }, '☁️'),
        h('span', {}, 'Cloud Katalog & Aktivnost'),
        h('span', { class: 'lmt-badge' }, String(cloudCount)),
        activePeersCount > 0 ? h('span', { class: 'lmt-badge live', title: 'Aktivni prijatelji u studiju' }, `🟢 ${activePeersCount}`) : null
      )
    );

    const authorBtn = h('button', {
      type: 'button',
      class: 'launcher-author-chip',
      title: 'Klikni za promjenu svog potpisa (imena autora na novim verzijama)',
      onClick: () => {
        const next = prompt('Tvoje ime / nadimak (potpisuje se uz svako spremanje i verziju u oblaku):', currentAuthor);
        if (next && next.trim()) {
          const clean = next.trim().slice(0, 40);
          if (typeof window !== 'undefined') window.ledicatedClientName = clean;
          try { localStorage.setItem('ledicated-user-name', clean); } catch {}
          fetch('/api/lan/profile', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clientId: window.ledicatedClientId || '', name: clean })
          }).catch(() => {});
          toast(`Potpis postavljen na: ${clean}`, 'ok');
          renderHeader();
        }
      }
    }, `👤 ${currentAuthor} ✎`);

    const refreshCloudBtn = h('button', {
      type: 'button',
      class: 'launcher-refresh-btn',
      title: 'Osvježi Cloud katalog i aktivnost iz Firebasea',
      onClick: async () => {
        refreshCloudBtn.classList.add('spinning');
        await loadData(true);
        refreshCloudBtn.classList.remove('spinning');
        render();
        toast('☁️ Cloud katalog osvježen.', 'ok');
      }
    }, '↻');

    const headerRight = h('div', { class: 'launcher-header-right' },
      mainTabs,
      authorBtn,
      refreshCloudBtn,
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
      placeholder: state.catalogTab === 'cloud'
        ? 'Pretraži Cloud showove po nazivu, autoru, BPM-u... (Esc za izlaz)'
        : 'Pretraži preuzete pjesme po nazivu, izvođaču, autoru, BPM-u... (Esc za izlaz)',
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

    if (state.catalogTab === 'cloud') {
      const totalCloud = state.sharedShows.length;
      const missingCount = state.sharedShows.filter(sh => !findLocalTrackForCloudShow(sh)).length;
      const updatesCount = state.sharedShows.filter(sh => {
        const lt = findLocalTrackForCloudShow(sh);
        return lt && (Number(sh.version) || 1) > (Number(lt.version) || 1);
      }).length;
      const installedCount = totalCloud - missingCount;

      const cloudPills = [
        { id: 'cloud_all', label: '☁️ Svi u oblaku', count: totalCloud },
        { id: 'cloud_missing', label: '📥 Nije preuzeto', count: missingCount },
        { id: 'cloud_updates', label: '🔄 Nova verzija', count: updatesCount },
        { id: 'cloud_installed', label: '✓ Preuzeto lokalno', count: installedCount }
      ];

      const pillsWrap = h('div', { class: 'launcher-filter-pills' },
        ...cloudPills.map(p => h('button', {
          type: 'button',
          class: `launcher-pill${state.cloudFilter === p.id ? ' on' : ''}`,
          onClick: () => {
            state.cloudFilter = p.id;
            renderToolbar();
            renderContent();
          }
        }, h('span', {}, p.label), h('span', { class: 'pill-count' }, String(p.count))))
      );

      const syncAllBtn = (missingCount > 0 || updatesCount > 0)
        ? h('button', {
            type: 'button',
            class: 'add-song-btn cloud-sync-all-btn',
            disabled: state.syncingAll,
            title: 'Preuzmi i sinkroniziraj sve nove showove iz oblaka',
            onClick: async () => {
              state.syncingAll = true;
              renderToolbar();
              try {
                const toSync = state.sharedShows.filter(sh => {
                  const lt = findLocalTrackForCloudShow(sh);
                  return !lt || (Number(sh.version) || 1) > (Number(lt.version) || 1);
                });
                let done = 0;
                for (const sh of toSync) {
                  done++;
                  ctx.status(`Sinkronizacija (${done}/${toSync.length}): ${sh.title}…`);
                  const lt = findLocalTrackForCloudShow(sh);
                  await libraryApi('install-shared-show', {
                    filename: sh.filename,
                    showId: sh.showId,
                    trackId: lt?.id
                  }).catch(() => {});
                }
                await ctx.refresh?.();
                await loadData(true);
                toast(`☁️ Sinkronizirano ${done} showova iz oblaka!`, 'ok');
              } finally {
                state.syncingAll = false;
                render();
              }
            }
          }, state.syncingAll ? '⏳ Sinkroniziram sve…' : `☁️ Preuzmi / Ažuriraj sve (${missingCount + updatesCount})`)
        : null;

      const cloudStatusBadge = h('span', { class: `cloud-conn-badge${state.cloudConnected ? ' online' : ''}` },
        state.cloudConnected ? `🟢 Firebase Cloud (${state.projectId})` : '📁 Git shared-shows (Offline mod)'
      );

      const controlsRight = h('div', { class: 'launcher-controls-right' }, cloudStatusBadge, syncAllBtn);
      const filtersRow = h('div', { class: 'launcher-filters-row' }, pillsWrap, controlsRight);
      toolbar.replaceChildren(searchRow, filtersRow);
      return;
    }

    // Local Library Filters row
    const total = state.tracks.length;
    const readyCount = state.tracks.filter(t => t.hasTimeline && t.hasAnalysis).length;
    const updatesCount = state.tracks.filter(t => hasCloudUpdate(t)).length;
    const highBpmCount = state.tracks.filter(t => (t.bpm || state.details.get(t.id)?.analysis?.bpm || 0) >= 140).length;
    const midBpmCount = state.tracks.filter(t => {
      const b = t.bpm || state.details.get(t.id)?.analysis?.bpm || 0;
      return b >= 100 && b < 140;
    }).length;

    const pills = [
      { id: 'all', label: 'Sve preuzete', count: total },
      { id: 'ready', label: 'Spremne za show', count: readyCount },
      ...(updatesCount > 0 ? [{ id: 'updates', label: '🔄 Nova verzija u oblaku', count: updatesCount }] : []),
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
      h('option', { value: 'recent', selected: state.sortBy === 'recent' }, 'Sortiraj: Zadnje mijenjano'),
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

  function openTrackContextMenu(track, triggerBtn) {
    const r = triggerBtn.getBoundingClientRect();
    const ver = track.version || 1;
    showMenu(r.left, r.bottom + 6, [
      { label: 'Otvori u studiju', onClick: () => selectAndLoad(track.id) },
      { label: `🕒 Povijest verzija i vraćanje (v${ver})…`, onClick: () => openVersionHistory(track) },
      { separator: true },
      { label: '☁️ Objavi novu verziju u Cloud + Git (shared-shows)', onClick: async () => {
        const note = prompt('Kratki opis izmjene za ovu verziju (opcionalno):', '');
        if (note === null) return;
        await ctx.shareTrackToGit?.(track.id, track.title, note.trim());
        await loadData(true);
        render();
      }},
      { label: '📦 Izvezi paket pjesma + show (.ledpack)', onClick: () => ctx.exportTrackPack?.(track.id) },
      { label: '✦ Izvezi samo show (.ledshow.json)', onClick: () => ctx.exportTrackShow?.(track.id) },
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
    ], r);
  }

  function renderCloudRadar() {
    const peers = state.presence || [];
    const activities = (state.activity || []).slice(0, 6);

    const presenceCards = peers.length
      ? peers.map(p => {
          const isMe = typeof window !== 'undefined' && p.clientId === window.ledicatedClientId;
          const timeStr = p.timeSec > 0 ? ` · ${fmtDuration(p.timeSec)}` : '';
          const verStr = p.version ? ` · v${p.version}` : '';
          return h('div', { class: `radar-peer-chip${p.isPlaying ? ' playing' : ''}` },
            h('span', { class: 'radar-dot' }, p.isPlaying ? '🟢' : '🟡'),
            h('div', { class: 'radar-peer-text' },
              h('strong', {}, `${p.name || 'Studio'}${isMe ? ' (Ti)' : ''}`),
              h('small', {}, p.trackTitle ? `${p.isPlaying ? '▶ ' : '✎ '}${p.trackTitle}${timeStr}${verStr}` : 'Pregledava katalog')
            )
          );
        })
      : [h('small', { class: 'radar-empty' }, 'Trenutno samo ti radiš u studiju. Kad prijatelji pokrenu npm start, vidjet ćeš ih ovdje uživo.')];

    const activityRows = activities.length
      ? activities.map(act => {
          const rel = fmtRelativeTime(act.createdAt);
          const cloudMatch = state.sharedShows.find(s => s.showId === act.showId || s.title === act.title);
          const localMatch = findLocalTrackForCloudShow(cloudMatch || { showId: act.showId, title: act.title });
          return h('div', { class: 'radar-activity-row' },
            h('span', { class: 'vh-ver-badge' }, `v${act.version || 1}`),
            h('strong', { class: 'radar-act-author' }, `👤 ${act.author || 'Studio'}`),
            h('span', { class: 'radar-act-title', title: act.title }, act.title || act.showId),
            h('span', { class: 'radar-act-summary', title: act.summary }, act.summary || 'Spremljen show'),
            h('span', { class: 'radar-act-time' }, rel),
            h('button', {
              type: 'button',
              class: 'mini-btn radar-act-btn',
              onClick: () => openVersionHistory(localMatch || cloudMatch || { showId: act.showId, title: act.title, version: act.version })
            }, '🕒 Verzije')
          );
        })
      : [h('small', { class: 'radar-empty' }, 'Još nema zabilježenih izmjena.')];

    return h('div', { class: 'cloud-radar-panel' },
      h('div', { class: 'radar-col presence-col' },
        h('div', { class: 'radar-col-title' }, '🟢 TKO TRENUTNO RADI U STUDIJU (UŽIVO)'),
        h('div', { class: 'radar-peers-wrap' }, ...presenceCards)
      ),
      h('div', { class: 'radar-col activity-col' },
        h('div', { class: 'radar-col-title' }, '🕒 ZADNJE SPREMLJENE VERZIJE & IZMJENE'),
        h('div', { class: 'radar-activity-list' }, ...activityRows)
      )
    );
  }

  function renderSharedCloudShows() {
    const q = state.query.trim().toLowerCase();
    let filtered = state.sharedShows.filter(sh =>
      !q ||
      (sh.title || '').toLowerCase().includes(q) ||
      (sh.author || '').toLowerCase().includes(q) ||
      (sh.updatedBy || '').toLowerCase().includes(q)
    );

    if (state.cloudFilter === 'cloud_missing') {
      filtered = filtered.filter(sh => !findLocalTrackForCloudShow(sh));
    } else if (state.cloudFilter === 'cloud_updates') {
      filtered = filtered.filter(sh => {
        const lt = findLocalTrackForCloudShow(sh);
        return lt && (Number(sh.version) || 1) > (Number(lt.version) || 1);
      });
    } else if (state.cloudFilter === 'cloud_installed') {
      filtered = filtered.filter(sh => Boolean(findLocalTrackForCloudShow(sh)));
    }

    const radar = renderCloudRadar();

    if (!filtered.length) {
      content.replaceChildren(
        radar,
        h('div', { class: 'launcher-empty' },
          h('div', { class: 'launcher-empty-icon' }, '☁️'),
          h('h3', {}, 'Nema showova za odabrani filter u Cloud katalogu'),
          h('p', {}, 'Svako spremanje (⌘S) u studiju automatski šalje novu verziju showa u Firebase Cloud i shared-shows/.')
        )
      );
      return;
    }

    const grid = h('div', { class: 'launcher-grid' });
    for (const sh of filtered) {
      const localMatch = findLocalTrackForCloudShow(sh);
      const isInstalling = state.installingShowFile === (sh.showId || sh.filename);
      const cloudVer = Number(sh.version) || 1;
      const localVer = localMatch ? (Number(localMatch.version) || 1) : 0;
      const hasNewer = localMatch && cloudVer > localVer;
      const liveEditors = findLiveEditors(sh);
      const { artist, title } = parseTrackTitle(sh.title || sh.filename);
      const card = h('div', { class: `song-card${localMatch ? ' active' : ''}${hasNewer ? ' has-update' : ''}` });

      const thumbSource = localMatch || { videoId: sh.videoId || sh.track?.videoId, sourceUrl: sh.sourceUrl || sh.track?.sourceUrl };
      const canvas = h('canvas', { class: 'sc-canvas', width: 320, height: 142 });
      const banner = h('div', { class: 'sc-banner' });
      const thumbImg = createTrackThumb(thumbSource, 'sc-thumb-img', ok => {
        banner.classList.toggle('has-thumb', ok);
        drawCardBanner(canvas, { title: sh.title }, { bpm: sh.bpm || 128 }, false, ok);
      });
      if (thumbImg) banner.classList.add('has-thumb');
      requestAnimationFrame(() => drawCardBanner(canvas, { title: sh.title }, { bpm: sh.bpm || 128 }, false, Boolean(thumbImg)));

      const vignette = h('div', { class: 'sc-banner-vignette' });
      const pillsLeft = h('div', { class: 'sc-pills-left' },
        h('span', { class: 'sc-pill pill-ver' }, `☁️ v${cloudVer}`),
        hasNewer
          ? h('span', { class: 'sc-pill pill-update' }, `🔄 NOVA VERZIJA (lokalno v${localVer})`)
          : localMatch
            ? h('span', { class: 'sc-pill pill-active' }, '✓ PREUZETO')
            : h('span', { class: 'sc-pill pill-show' }, `✦ ${sh.clipCount || 0} CLIPOVA`),
        liveEditors.length
          ? h('span', { class: 'sc-pill pill-live-edit' }, `🟢 ${liveEditors[0].name} uređuje`)
          : null
      );
      const pillsRight = h('div', { class: 'sc-pills-right' },
        sh.bpm ? h('span', { class: 'sc-pill pill-bpm' }, `⚡ ${Number(sh.bpm).toFixed(1)} BPM`) : null,
        sh.durationSec ? h('span', { class: 'sc-pill pill-dur' }, `⏱ ${fmtDuration(sh.durationSec)}`) : null
      );
      banner.append(thumbImg, vignette, canvas, pillsLeft, pillsRight);

      const lastAuthor = sh.updatedBy || sh.author || 'Studio';
      const relTime = fmtRelativeTime(sh.updatedAt);
      const displayArtist = artist || lastAuthor;
      const artistEl = h('div', { class: 'sc-artist', title: displayArtist }, displayArtist);
      const titleEl = h('div', { class: 'sc-title', title }, title);
      const summaryEl = sh.lastSummary
        ? h('div', { class: 'sc-summary-line', title: sh.lastSummary }, `📝 ${sh.lastSummary}`)
        : null;
      const tags = h('div', { class: 'sc-tags' },
        h('span', { class: 'sc-tag tag-author' }, `👤 ${lastAuthor}${relTime ? ` · ${relTime}` : ''}`),
        h('span', { class: 'sc-tag' }, `✦ ${sh.clipCount || 0} clipova · ${sh.layerCount || 3} sloja`),
        sh.audioUrl ? h('span', { class: 'sc-tag tag-cloud-audio' }, '⚡ Izravni Cloud MP3') : ((sh.videoId || sh.track?.videoId) ? h('span', { class: 'sc-tag tag-yt' }, '▶ YouTube') : null)
      );
      const body = h('div', { class: 'sc-body' }, artistEl, titleEl, summaryEl, tags);

      const primaryBtn = h('button', {
        type: 'button',
        class: `sc-btn-primary${hasNewer ? ' btn-update' : ''}`,
        disabled: isInstalling,
        onClick: () => installOrSyncShow(sh, localMatch)
      }, isInstalling
        ? '⏳ Preuzimanje…'
        : hasNewer
          ? `🔄 Ažuriraj na v${cloudVer}`
          : localMatch
            ? '✦ Sinkroniziraj i otvori'
            : `📥 Preuzmi pjesmu + show (v${cloudVer})`);

      const versionsBtn = h('button', {
        type: 'button',
        class: 'sc-btn-secondary',
        title: 'Pogledaj sve verzije, tko je što mijenjao i vrati bilo koju verziju',
        onClick: () => openVersionHistory(sh)
      }, `🕒 v${cloudVer}`);

      const footer = h('div', { class: 'sc-footer' }, primaryBtn, versionsBtn);
      card.append(banner, body, footer);
      grid.append(card);
    }
    content.replaceChildren(radar, grid);
  }

  function renderContent() {
    if (state.catalogTab === 'cloud' || state.filter === 'shared_git') {
      renderSharedCloudShows();
      return;
    }
    const list = filterAndSortTracks();
    if (!list.length) {
      content.replaceChildren(
        h('div', { class: 'launcher-empty' },
          h('div', { class: 'launcher-empty-icon' }, '🔍'),
          h('h3', {}, state.tracks.length ? 'Nema pronađenih pjesama' : 'Tvoja lokalna biblioteka je prazna'),
          h('p', {}, state.tracks.length
            ? 'Pokušaj prilagoditi filtere ili upit za pretragu, ili prebaci na karticu „☁️ Cloud Katalog & Aktivnost”.'
            : 'Klikni na karticu „☁️ Cloud Katalog & Aktivnost” na vrhu kako bi u 1 kliku preuzeo pjesme i showove iz zajedničkog oblaka!')
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
      const analysis = details?.analysis || (track.bpm || track.durationSec ? { bpm: track.bpm, durationSec: track.durationSec } : null);
      const bpm = track.bpm || analysis?.bpm;
      const durationSec = track.durationSec || analysis?.durationSec || 0;
      const sections = analysis?.sections || [];
      const isActive = track.id === activeId;
      const isAuditioning = state.auditionTrackId === track.id && state.auditionPlaying;
      const cloudShow = findCloudShowForTrack(track);
      const localVer = Number(track.version) || 1;
      const cloudVer = Number(cloudShow?.version) || localVer;
      const hasNewer = Boolean(cloudShow && cloudVer > localVer);
      const liveEditors = findLiveEditors(track);
      const { artist, title } = parseTrackTitle(track.title || track.originalName);

      // Card element
      const card = h('div', { class: `song-card${isActive ? ' active' : ''}${isAuditioning ? ' auditioning' : ''}${hasNewer ? ' has-update' : ''}` });

      // Banner with real Track Artwork + Vignette + Waveform Canvas
      const canvas = h('canvas', { class: 'sc-canvas', width: 320, height: 142 });
      const banner = h('div', { class: 'sc-banner' });
      const thumbImg = createTrackThumb(track, 'sc-thumb-img', ok => {
        banner.classList.toggle('has-thumb', ok);
        drawCardBanner(canvas, track, analysis, isAuditioning, ok);
      });
      if (thumbImg) banner.classList.add('has-thumb');
      requestAnimationFrame(() => drawCardBanner(canvas, track, analysis, isAuditioning, Boolean(thumbImg)));

      const vignette = h('div', { class: 'sc-banner-vignette' });

      // Overlaid Badges
      const pillsLeft = h('div', { class: 'sc-pills-left' });
      if (isActive) pillsLeft.append(h('span', { class: 'sc-pill pill-active' }, '● AKTIVNA'));
      if (track.hasTimeline) pillsLeft.append(h('span', { class: 'sc-pill pill-ver' }, `✦ SHOW · v${localVer}`));
      if (hasNewer) pillsLeft.append(h('span', { class: 'sc-pill pill-update' }, `🔄 OBLAK v${cloudVer}`));
      if (liveEditors.length) pillsLeft.append(h('span', { class: 'sc-pill pill-live-edit' }, `🟢 ${liveEditors[0].name} uređuje`));

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

      banner.append(thumbImg, vignette, canvas, pillsLeft, pillsRight, playOverlay);

      // Card Body
      const lastAuthor = track.updatedBy || track.author || cloudShow?.updatedBy || cloudShow?.author || '';
      const relTime = fmtRelativeTime(track.updatedAt || cloudShow?.updatedAt);
      const displayArtist = artist || lastAuthor || (track.videoId ? 'YouTube Studio' : 'Lokalna zbirka');
      const artistEl = h('div', { class: 'sc-artist', title: displayArtist }, displayArtist);
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
        sectionsBar.append(h('div', { class: 'sc-sec-seg', style: { width: '100%', background: 'linear-gradient(90deg, rgba(56,189,248,0.45), rgba(168,85,247,0.45), rgba(245,165,36,0.45))' } }));
      }

      // Tags
      const tags = h('div', { class: 'sc-tags' },
        lastAuthor ? h('span', { class: 'sc-tag tag-author' }, `👤 ${lastAuthor}${relTime ? ` · ${relTime}` : ''}`) : null,
        h('span', { class: 'sc-tag' }, '🥁 4 stema'),
        track.videoId ? h('span', { class: 'sc-tag tag-yt' }, '▶ YT') : null,
        h('span', { class: 'sc-tag' }, `${(track.sizeBytes / 1048576).toFixed(1)} MB`)
      );

      const body = h('div', { class: 'sc-body' }, artistEl, titleEl, sectionsBar, tags);

      // Card Footer
      const loadBtn = hasNewer
        ? h('button', {
            type: 'button',
            class: 'sc-btn-primary btn-update',
            title: `Preuzmi noviju verziju v${cloudVer} iz oblaka`,
            onClick: () => installOrSyncShow(cloudShow, track)
          }, `🔄 Ažuriraj na v${cloudVer}`)
        : h('button', {
            type: 'button',
            class: 'sc-btn-primary',
            onClick: () => selectAndLoad(track.id)
          }, isActive ? '✓ Aktivna u studiju' : '▶ Učitaj show');

      const verBtn = h('button', {
        type: 'button',
        class: 'sc-btn-secondary',
        title: 'Povijest verzija i vraćanje na prethodno stanje',
        onClick: () => openVersionHistory(track)
      }, `🕒 v${localVer}`);

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
        'aria-haspopup': 'menu',
        onClick: e => {
          e.stopPropagation();
          openTrackContextMenu(track, menuBtn);
        }
      }, '•••');

      const footer = h('div', { class: 'sc-footer' }, loadBtn, verBtn, auditionBtn, menuBtn);

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
      const bpm = track.bpm || analysis?.bpm;
      const durationSec = track.durationSec || analysis?.durationSec || 0;
      const sections = analysis?.sections || [];
      const isActive = track.id === activeId;
      const isAuditioning = state.auditionTrackId === track.id && state.auditionPlaying;
      const localVer = Number(track.version) || 1;
      const lastAuthor = track.updatedBy || track.author || '';
      const relTime = fmtRelativeTime(track.updatedAt);
      const { artist, title } = parseTrackTitle(track.title || track.originalName);

      const secBar = h('div', { class: 'tbl-sec-bar' });
      if (sections.length && durationSec > 0) {
        for (const sec of sections) {
          const w = Math.max(1, (sec.durationSec / durationSec) * 100);
          secBar.append(h('div', { style: { width: `${w}%`, background: sec.color || '#3a86ff', height: '100%' } }));
        }
      } else {
        secBar.append(h('div', { style: { width: '100%', background: 'linear-gradient(90deg, rgba(56,189,248,0.45), rgba(168,85,247,0.45))', height: '100%' } }));
      }

      const tblThumbWrap = h('div', { class: 'tbl-thumb-wrap' },
        createTrackThumb(track, 'tbl-thumb-img'),
        h('span', { class: 'tbl-thumb-fallback' }, '♫')
      );
      const displayArtist = artist || lastAuthor || '';
      const tblMenuBtn = h('button', {
        type: 'button',
        class: 'sc-btn-menu tbl-menu-btn',
        title: 'Opcije pjesme i dijeljenje',
        'aria-haspopup': 'menu',
        onClick: e => {
          e.stopPropagation();
          openTrackContextMenu(track, tblMenuBtn);
        }
      }, '•••');

      const tr = h('tr', {
        class: `${isActive ? 'active' : ''}`,
        onDblClick: () => selectAndLoad(track.id)
      },
        h('td', {}, String(idx + 1)),
        h('td', {}, isActive ? h('span', { class: 'sc-pill pill-active' }, 'AKTIVNA') : (track.hasTimeline ? h('span', { class: 'sc-pill pill-ver' }, `v${localVer}`) : '·')),
        h('td', { class: 'tbl-title-cell' },
          h('div', { class: 'tbl-title-inner' },
            tblThumbWrap,
            h('div', { class: 'tbl-title-text' },
              h('b', {}, title),
              displayArtist ? h('small', {}, `${displayArtist}${relTime ? ` · ${relTime}` : ''}`) : null
            )
          )
        ),
        h('td', {}, bpm ? `${bpm.toFixed(1)} BPM` : '—'),
        h('td', {}, fmtDuration(durationSec)),
        h('td', {}, secBar),
        h('td', {}, `${(track.sizeBytes / 1048576).toFixed(1)} MB`),
        h('td', { class: 'tbl-actions-cell' },
          h('button', { type: 'button', class: 'sc-btn-secondary', style: { height: '28px', padding: '0 8px' }, title: 'Povijest verzija', onClick: () => openVersionHistory(track) }, `🕒 v${localVer}`),
          h('button', { type: 'button', class: 'sc-btn-secondary', style: { height: '28px', padding: '0 9px' }, onClick: () => toggleAudition(track.id) }, isAuditioning ? '⏸' : '♫'),
          h('button', { type: 'button', class: 'sc-btn-primary', style: { height: '28px', padding: '0 12px', flex: 'none' }, onClick: () => selectAndLoad(track.id) }, isActive ? 'Otvoreno' : 'Učitaj'),
          tblMenuBtn
        )
      );
      return tr;
    });

    const table = h('table', { class: 'launcher-table' },
      h('thead', {},
        h('tr', {},
          h('th', {}, '#'),
          h('th', {}, 'Verzija'),
          h('th', {}, 'Naziv i zadnja izmjena'),
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

    const disc = h('div', { class: 'audition-disc' },
      createTrackThumb(track, 'audition-thumb-img'),
      h('span', { class: 'audition-disc-icon' }, '♫')
    );
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

  async function open(initialTab = null) {
    state.open = true;
    if (initialTab === 'cloud' || initialTab === 'local') {
      state.catalogTab = initialTab;
    }
    if (!document.body.contains(dialog)) document.body.append(dialog);
    if (!dialog.open) dialog.showModal();
    await loadData();
    if (!initialTab && state.tracks.length === 0 && state.sharedShows.length > 0) {
      state.catalogTab = 'cloud';
    }
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
    openVersionHistory,
    isOpen: () => state.open,
    refresh: async () => {
      if (!state.open) return;
      await loadData();
      render();
    }
  };
}
