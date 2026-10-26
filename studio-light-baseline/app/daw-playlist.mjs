/** Playlist: FL-Studio-style arrangement view. Ruler with loop strip, audio
 * waveform row, analysis row and one lane per light layer. Canvas rendering,
 * DOM track headers, tools (draw / select / slice / erase), multi-select,
 * snap, resize, alt-drag duplicate, drag-drop of effect presets.
 */
import {
  MIN_CLIP_SEC, addClip, addKeyframe, addLayer, beatPosition, clamp, clipEnd, clipsInRect, deleteClips, duplicateClips, duplicateLayer, easeValue, envelopeAt, findClip, moveClip, moveKeyframe, moveLayer, refKey,
  removeKeyframe, removeLayer, resizeClip, setKeyframeEase, snapTime, splitClip, timeAtBeat
} from './daw-state.mjs';
import { TIMELINE_BLENDS, driverLevel, regenerateSectionClips } from './timeline.mjs';
import { SECTION_TYPES, SECTION_NAMES, SECTION_COLORS } from './audio-sections.mjs';
import { clipUiColor, h, hexToRgb, showMenu } from './daw-ui.mjs';

export function relabelSections(sections) {
  if (!Array.isArray(sections)) return [];
  const counts = {};
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i];
    const type = SECTION_TYPES.includes(s.type) ? s.type : 'verse';
    s.type = type;
    counts[type] = (counts[type] || 0) + 1;
    const count = counts[type];
    const totalOfType = sections.filter(x => x.type === type).length;
    s.name = totalOfType > 1 && type !== 'intro' && type !== 'outro'
      ? `${SECTION_NAMES[type]} ${count}`
      : SECTION_NAMES[type];
    s.color = SECTION_COLORS[type] || s.color || '#3a86ff';
    s.id = `sec-${i + 1}`;
    s.startSec = Math.round(Number(s.startSec || 0) * 100) / 100;
    s.endSec = Math.round(Number(s.endSec || 0) * 100) / 100;
    s.durationSec = Math.round(Math.max(0.05, s.endSec - s.startSec) * 100) / 100;
  }
  return sections;
}

const RULER_BARS = 18, RULER_LOOP = 14, RULER_SECTIONS = 18;
const RULER_H = RULER_BARS + RULER_LOOP + RULER_SECTIONS;
const AUDIO_H = 76, ANALYSIS_H = 44, EDGE = 7;
export const LANE_HEIGHTS = { S: 46, M: 64, L: 92 };
export const PRESET_LABELS = {
  wash: 'Wash', pulse: 'Puls', columns: 'Stupci', chase: 'Trkač', flash: 'Flash', wave: 'Val',
  strobe: 'Stroboskop', sparkle: 'Iskre', spiral: 'Spirala', ripple: 'Valići', rain: 'Kiša',
  bounce: 'Odskok', fire: 'Vatra', alternate: 'Izmjena', center: 'Središte', sweep: 'Zamah'
};
const DRIVER_LABELS = { none: '', drums: 'BUBNJEVI', bass: 'BAS', vocals: 'VOKAL', other: 'OSTALO', band: 'POJAS' };
const STEM_ITEMS = [
  { id: 'drums', short: 'Bubnj', label: 'Bubnjevi', color: '#ff9a3a' },
  { id: 'bass', short: 'Bas', label: 'Bas', color: '#b25cff' },
  { id: 'vocals', short: 'Vok', label: 'Vokal', color: '#37d4ff' },
  { id: 'other', short: 'Ost', label: 'Ostalo', color: '#59ff9b' }
];

export function createPlaylist(host, ctx) {
  const { store } = ctx;
  const state = { pps: 20, scrollSec: 0, laneSize: 'M', expandedLayerId: null, selectedKeyframe: null, selection: [], hover: null, marquee: null, ghost: null, gesture: null, dirty: true, peaks: null, peaksFor: null, solo: new Set(), spaceDown: false, shiftDown: false };
  if (ctx.stems?.subscribe) {
    ctx.stems.subscribe(() => {
      renderHeads();
    });
  }

  /* ---------------------------------------------------------------- DOM */
  const corner = h('div', { class: 'pl-corner' });
  const ruler = h('canvas', { class: 'pl-ruler', 'aria-label': 'Ravnalo, takt i loop' });
  const topRow = h('div', { class: 'pl-top' }, corner, ruler);
  const heads = h('div', { class: 'pl-heads' });
  const canvas = h('canvas', { class: 'pl-canvas', tabIndex: 0, 'aria-label': 'Playlist: waveform i slojevi svjetla' });
  const scroller = h('div', { class: 'pl-scroll' }, heads, h('div', { class: 'pl-stage' }, canvas));
  const overviewCorner = h('div', { class: 'pl-corner pl-overview-corner' }, h('span', {}, 'PREGLED'));
  const overview = h('canvas', { class: 'pl-overview', 'aria-label': 'Pregled cijele pjesme; povuci za pomak' });
  const bottomRow = h('div', { class: 'pl-bottom' }, overviewCorner, overview);
  const root = h('div', { class: 'pl' }, topRow, scroller, bottomRow);
  host.append(root);

  const tl = () => store.timeline;
  const analysis = () => ctx.getAnalysis();
  const duration = () => ctx.duration();
  const stageWidth = () => canvas.clientWidth || 800;
  const visibleSec = () => stageWidth() / state.pps;
  const xAt = t => (t - state.scrollSec) * state.pps;
  const tAt = x => state.scrollSec + x / state.pps;
  const laneH = () => LANE_HEIGHTS[state.laneSize];
  const EXPANDED_LANE_H = 180;
  const isLayerExpanded = layerId => state.expandedLayerId === layerId;
  const layerHeight = index => {
    const l = tl().layers[index];
    return (l && isLayerExpanded(l.id)) ? EXPANDED_LANE_H : laneH();
  };
  const rowTop = { audio: 0, analysis: AUDIO_H };
  const layersTop = () => AUDIO_H + ANALYSIS_H;
  const layerTop = targetIndex => {
    let y = layersTop();
    for (let i = 0; i < targetIndex; i++) y += layerHeight(i);
    return y;
  };
  const bodyHeight = () => {
    let h = layersTop();
    const count = tl().layers.length;
    if (count === 0) return h + laneH() + 40;
    for (let i = 0; i < count; i++) h += layerHeight(i);
    return h + laneH() + 20;
  };
  const laneAt = (y, allowNew = false) => {
    if (y < layersTop()) return -1;
    let curr = layersTop();
    const count = tl().layers.length;
    for (let i = 0; i < count; i++) {
      const lh = layerHeight(i);
      if (y >= curr && y < curr + lh) return i;
      curr += lh;
    }
    if (allowNew) return count;
    return count > 0 ? count - 1 : -1;
  };
  const snapMode = () => ctx.getSnap();
  const snap = t => snapTime(clamp(t, 0, duration()), snapMode(), tl(), analysis());
  const requestDraw = () => { state.dirty = true; };
  const fitPps = () => stageWidth() / Math.max(1, duration());

  function toggleExpandLayer(layerId) {
    state.expandedLayerId = state.expandedLayerId === layerId ? null : layerId;
    renderHeads();
    requestDraw();
  }

  function applyEaseToSelection(easeMode) {
    if (state.selectedKeyframe) {
      const { ref, index } = state.selectedKeyframe;
      store.commit(easeMode === 'ease' ? 'Ease Ease' : 'Linearno', tlm => {
        const c = findClip(tlm, ref)?.clip;
        if (c) setKeyframeEase(c, index, easeMode);
      });
      requestDraw();
      return;
    }
    if (state.selection.length) {
      store.commit(easeMode === 'ease' ? 'Ease Ease' : 'Linearno', tlm => {
        for (const ref of state.selection) {
          const c = findClip(tlm, ref)?.clip;
          if (c) {
            for (let i = 0; i < c.keyframes.length; i++) {
              setKeyframeEase(c, i, easeMode);
            }
          }
        }
      });
      requestDraw();
    }
  }

  let lastSbW = -1;
  function syncScrollbarGutter() {
    if (scroller.offsetWidth === undefined || scroller.clientWidth === undefined) return;
    const sbW = Math.max(0, scroller.offsetWidth - scroller.clientWidth);
    if (sbW !== lastSbW) {
      topRow.style.paddingRight = `${sbW}px`;
      bottomRow.style.paddingRight = `${sbW}px`;
      root.style.setProperty?.('--pl-sb-w', `${sbW}px`);
      lastSbW = sbW;
    }
  }

  function clampView() {
    syncScrollbarGutter();
    state.pps = clamp(state.pps, fitPps(), 800);
    state.scrollSec = clamp(state.scrollSec, 0, Math.max(0, duration() - visibleSec()));
  }
  function zoomAround(factor, anchorSec, anchorX) {
    const before = anchorSec ?? tAt(stageWidth() / 2), x = anchorX ?? stageWidth() / 2;
    state.pps *= factor; state.pps = clamp(state.pps, fitPps(), 800);
    state.scrollSec = before - x / state.pps; clampView(); requestDraw(); ctx.onView?.();
  }
  function fit() { state.pps = fitPps(); state.scrollSec = 0; clampView(); requestDraw(); ctx.onView?.(); }
  function centerOn(sec) { state.scrollSec = sec - visibleSec() / 2; clampView(); requestDraw(); }
  function ensureVisible(sec, follow = false) {
    const v = visibleSec();
    if (follow) { if (sec > state.scrollSec + v * .82 || sec < state.scrollSec) { state.scrollSec = sec - v * .12; clampView(); requestDraw(); } }
    else if (sec < state.scrollSec || sec > state.scrollSec + v) centerOn(sec);
  }

  /* -------------------------------------------------------- selection */
  const isSelected = ref => state.selection.some(s => s.layerId === ref.layerId && s.clipId === ref.clipId);
  function setSelection(refs, notify = true) { state.selection = refs.filter(ref => findClip(tl(), ref)); requestDraw(); if (notify) ctx.onSelect?.([...state.selection]); }
  const pruneSelection = () => { const kept = state.selection.filter(ref => findClip(tl(), ref)); if (kept.length !== state.selection.length) { state.selection = kept; ctx.onSelect?.([...kept]); } };

  /* ------------------------------------------------------------ headers */
  function updateActiveHead(activeIndex = ctx.getActiveLayerIndex()) {
    heads.querySelectorAll('.pl-head-layer').forEach((el, i) => {
      el.classList.toggle('active', i === activeIndex);
    });
  }

  function renderHeads() {
    heads.replaceChildren();
    heads.style.height = `${bodyHeight()}px`;
    heads.append(
      h('div', { class: 'pl-head pl-head-audio', style: { height: `${AUDIO_H}px` } },
        h('div', { class: 'head-title' }, h('b', {}, 'AUDIO'), h('span', { title: ctx.getTrackTitle() }, ctx.getTrackTitle())),
        h('div', { class: 'head-row' }, h('button', { type: 'button', class: ctx.isAudioMuted() ? 'mini on' : 'mini', title: 'Utišaj audio (svjetlo nastavlja)', onClick: () => { ctx.toggleAudioMute(); renderHeads(); } }, 'M'),
          h('input', { type: 'range', min: 0, max: 100, value: Math.round(ctx.getVolume() * 100), class: 'mini-range', 'aria-label': 'Glasnoća', title: 'Glasnoća reprodukcije', onInput: e => ctx.setVolume(Number(e.target.value) / 100) }))),
      (() => {
        const st = ctx.stems?.getState?.() || { solo: new Set(), muted: new Set() };
        const hasStemFilter = (st.solo?.size > 0) || (st.muted?.size > 0);
        const descText = st.solo?.size
          ? `SOLO (${Array.from(st.solo).map(id => STEM_ITEMS.find(s => s.id === id)?.short).join('+')})`
          : st.muted?.size
            ? `UTIŠANO (${st.muted.size})`
            : '4 POJASA';

        return h('div', { class: 'pl-head pl-head-analysis', style: { height: `${ANALYSIS_H}px` } },
          h('div', { class: 'head-title' },
            h('b', {}, 'STEMOVI'),
            h('span', { class: 'stem-title-desc' }, descText),
            hasStemFilter
              ? h('button', {
                  type: 'button',
                  class: 'stem-reset-btn',
                  title: 'Vrati na cijeli audio miks (isključi solo i mute)',
                  onPointerDown: e => e.stopPropagation(),
                  onClick: e => { e.stopPropagation(); ctx.stems?.resetAll(); renderHeads(); ctx.onSolo?.(); }
                }, 'Miks')
              : null
          ),
          h('div', { class: 'head-sub stems' },
            ...STEM_ITEMS.map(({ id, short, label, color }) => {
              const isSolo = st.solo?.has(id);
              const isMuted = st.muted?.has(id);
              return h('div', { class: `stem-ctl${isSolo ? ' solo' : ''}${isMuted ? ' muted' : ''}`, style: { '--stem-c': color } },
                h('span', { class: 'dot', style: { background: color } }),
                h('span', { class: 'stem-name', title: `${label} (audio stem)` }, short),
                h('button', {
                  type: 'button',
                  class: `mini-stem solo${isSolo ? ' on' : ''}`,
                  title: `Solo ${label} (čuj samo ovaj stem)`,
                  'aria-pressed': String(isSolo),
                  onPointerDown: e => e.stopPropagation(),
                  onClick: e => {
                    e.stopPropagation();
                    ctx.stems?.toggleSolo(id, e.shiftKey);
                    renderHeads();
                    ctx.onSolo?.();
                  }
                }, 'S'),
                h('button', {
                  type: 'button',
                  class: `mini-stem mute${isMuted ? ' on' : ''}`,
                  title: `Utišaj ${label} u audio miksu`,
                  'aria-pressed': String(isMuted),
                  onPointerDown: e => e.stopPropagation(),
                  onClick: e => {
                    e.stopPropagation();
                    ctx.stems?.toggleMute(id);
                    renderHeads();
                    ctx.onSolo?.();
                  }
                }, 'M')
              );
            })
          )
        );
      })()
    );
    tl().layers.forEach((layer, index) => {
      const expanded = isLayerExpanded(layer.id);
      const row = h('div', { class: `pl-head pl-head-layer${index === ctx.getActiveLayerIndex() ? ' active' : ''}${layer.enabled ? '' : ' muted'}${expanded ? ' expanded' : ''}`, style: { height: `${layerHeight(index)}px`, '--layer': layer.color || '#3aa0ff' }, dataset: { layer: layer.id } });
      const expandBtn = h('button', {
        type: 'button',
        class: `layer-expand-btn${expanded ? ' on' : ''}`,
        title: expanded ? 'Skupi traku' : 'Proširi traku za uređivanje keyframeova i drivera',
        'aria-label': `Proširi traku ${layer.name}`,
        onPointerDown: e => e.stopPropagation(),
        onClick: e => {
          e.stopPropagation();
          toggleExpandLayer(layer.id);
        }
      }, expanded ? '▾' : '▸');
      const name = h('span', { class: 'layer-name', title: 'Dvaput klikni za preimenovanje' }, layer.name || layer.id);
      name.addEventListener('pointerdown', e => e.stopPropagation());
      name.addEventListener('click', e => e.stopPropagation());
      name.addEventListener('dblclick', e => {
        e.stopPropagation();
        const input = h('input', { class: 'layer-name-edit', value: layer.name || layer.id, 'aria-label': 'Naziv sloja' });
        const finish = save => {
          if (save && input.value.trim()) {
            store.commit('Preimenuj sloj', t => {
              const l = t.layers.find(x => x.id === layer.id);
              if (l) l.name = input.value.trim().slice(0, 40);
            });
          }
          renderHeads();
          ctx.onStructure?.();
        };
        input.addEventListener('keydown', ev => {
          if (ev.key === 'Enter') finish(true);
          if (ev.key === 'Escape') finish(false);
          ev.stopPropagation();
        });
        input.addEventListener('blur', () => finish(true));
        name.replaceWith(input);
        input.focus();
        input.select();
      });
      const solo = state.solo.has(layer.id);
      const blend = h('select', { class: 'mini-select', 'aria-label': `Blend ${layer.name}`, title: 'Kako se sloj miješa sa slojevima ispod', onPointerDown: e => e.stopPropagation(), onChange: e => { store.commit('Blend', t => { t.layers.find(l => l.id === layer.id).blend = e.target.value; }); } }, TIMELINE_BLENDS.map(b => h('option', { value: b, selected: layer.blend === b }, b)));
      const opacity = h('input', { type: 'range', min: 0, max: 100, value: Math.round(layer.opacity * 100), class: 'mini-range', 'aria-label': `Prozirnost ${layer.name}`, title: 'Prozirnost sloja' });
      opacity.addEventListener('pointerdown', e => { e.stopPropagation(); store.begin(); });
      opacity.addEventListener('input', () => store.update(t => { t.layers.find(l => l.id === layer.id).opacity = Number(opacity.value) / 100; }));
      opacity.addEventListener('change', () => { store.end('Prozirnost sloja'); ctx.onStructure?.(); });

      let expandedPanel = null;
      if (expanded) {
        const curTime = ctx.getTime();
        const activeClip = layer.clips.find(c => curTime >= c.startSec && curTime <= clipEnd(c)) || layer.clips[0];
        const drvName = activeClip?.driver && activeClip.driver !== 'none'
          ? `${DRIVER_LABELS[activeClip.driver] || activeClip.driver} ${(activeClip.driverGain ?? 1).toFixed(1)}×`
          : 'BEZ DRIVERA';

        const easeEaseBtn = h('button', {
          type: 'button', class: 'mini-btn ease-btn', title: 'Ease Ease (glatka S-krivulja)',
          onPointerDown: e => e.stopPropagation(),
          onClick: e => { e.stopPropagation(); applyEaseToSelection('ease'); }
        }, 'Ease Ease');
        const linearBtn = h('button', {
          type: 'button', class: 'mini-btn ease-btn', title: 'Linearno (ravne linije)',
          onPointerDown: e => e.stopPropagation(),
          onClick: e => { e.stopPropagation(); applyEaseToSelection('linear'); }
        }, 'Linear');

        expandedPanel = h('div', { class: 'head-expanded-panel' },
          h('div', { class: 'head-ease-row' },
            h('span', { class: 'head-mini-label' }, 'Keyframes:'),
            easeEaseBtn, linearBtn
          ),
          h('div', { class: 'head-drv-badge', title: 'Driver aktivnog clipa u traci' },
            h('span', { class: 'drv-dot' }),
            h('span', {}, drvName)
          )
        );
      }

      row.append(
        h('div', { class: 'head-top' }, expandBtn, name,
          h('button', { type: 'button', class: layer.enabled ? 'mini' : 'mini on', title: 'Utišaj sloj (mute)', 'aria-pressed': String(!layer.enabled), onPointerDown: e => e.stopPropagation(), onClick: e => { e.stopPropagation(); store.commit('Mute sloja', t => { const l = t.layers.find(x => x.id === layer.id); l.enabled = !l.enabled; }); renderHeads(); } }, 'M'),
          h('button', { type: 'button', class: solo ? 'mini solo on' : 'mini solo', title: 'Solo: čuj samo ovaj sloj', 'aria-pressed': String(solo), onPointerDown: e => e.stopPropagation(), onClick: e => { e.stopPropagation(); if (solo) state.solo.delete(layer.id); else if (e.shiftKey) state.solo.add(layer.id); else { state.solo.clear(); state.solo.add(layer.id); } renderHeads(); ctx.onSolo?.(); requestDraw(); } }, 'S'),
          h('button', { type: 'button', class: 'mini', title: 'Više opcija', 'aria-label': `Opcije sloja ${layer.name}`, onPointerDown: e => e.stopPropagation(), onClick: e => { e.stopPropagation(); layerMenu(layer, e.clientX, e.clientY); } }, '⋯')),
        h('div', { class: 'head-row' }, blend, opacity));
      if (expandedPanel) row.append(expandedPanel);

      row.addEventListener('pointerdown', e => {
        if (e.target.closest('button, input, select, .layer-name-edit, .layer-name')) return;
        ctx.setActiveLayer(index);
      });
      row.addEventListener('click', e => {
        if (e.target.closest('button, input, select, .layer-name-edit, .layer-name')) return;
        toggleExpandLayer(layer.id);
      });
      row.addEventListener('contextmenu', e => { e.preventDefault(); layerMenu(layer, e.clientX, e.clientY); });
      heads.append(row);
    });
    heads.append(h('button', { type: 'button', class: 'add-layer', onClick: () => addLayerAction() }, '+ Novi sloj'));
  }

  function addLayerAction() {
    let created;
    const out = store.commit('Novi sloj', t => { created = addLayer(t); });
    if (out.error) return ctx.status(out.error);
    ctx.setActiveLayer(tl().layers.findIndex(l => l.id === created.id)); renderHeads(); ctx.onStructure?.(); requestDraw();
  }
  function layerMenu(layer, x, y) {
    const index = tl().layers.findIndex(l => l.id === layer.id);
    const color = h('input', { type: 'color', value: layer.color || '#3aa0ff', 'aria-label': 'Boja sloja' });
    color.addEventListener('change', () => { store.commit('Boja sloja', t => { t.layers.find(l => l.id === layer.id).color = color.value; }); renderHeads(); ctx.onStructure?.(); });
    showMenu(x, y, [
      { label: 'Boja sloja', input: color },
      { separator: true },
      { label: 'Dupliciraj sloj', onClick: () => { store.commit('Dupliciraj sloj', t => duplicateLayer(t, layer.id)); renderHeads(); ctx.onStructure?.(); } },
      { label: 'Pomakni gore', disabled: index <= 0, onClick: () => { store.commit('Pomakni sloj', t => moveLayer(t, index, index - 1)); renderHeads(); ctx.onStructure?.(); } },
      { label: 'Pomakni dolje', disabled: index >= tl().layers.length - 1, onClick: () => { store.commit('Pomakni sloj', t => moveLayer(t, index, index + 1)); renderHeads(); ctx.onStructure?.(); } },
      { separator: true },
      { label: 'Obriši sloj', danger: true, disabled: tl().layers.length <= 1, onClick: () => { store.commit('Obriši sloj', t => removeLayer(t, layer.id)); state.solo.delete(layer.id); pruneSelection(); ctx.setActiveLayer(Math.min(index, tl().layers.length - 1)); renderHeads(); ctx.onStructure?.(); } }
    ]);
  }

  /* -------------------------------------------------------- hit testing */
  function clipRect(layerIndex, clip) {
    return { x: xAt(clip.startSec), y: layerTop(layerIndex) + 4, w: Math.max(3, clip.durationSec * state.pps), h: layerHeight(layerIndex) - 8 };
  }
  function hitTest(x, y) {
    if (y < AUDIO_H) return { type: 'audio' };
    if (y < layersTop()) return { type: 'analysis' };
    const layerIndex = laneAt(y), layer = tl().layers[layerIndex];
    if (!layer) return { type: 'void', layerIndex };
    const expanded = isLayerExpanded(layer.id);
    for (let i = layer.clips.length - 1; i >= 0; i--) {
      const clip = layer.clips[i], r = clipRect(layerIndex, clip);
      if (x >= r.x - 2 && x <= r.x + r.w + 2 && y >= r.y && y <= r.y + r.h) {
        const headH = expanded ? 20 : Math.min(15, r.h * 0.3);
        const edge = Math.min(EDGE, r.w / 3);
        if (expanded) {
          const autoY = r.y + headH, autoH = r.h - headH - 2;
          for (let ki = 0; ki < clip.keyframes.length; ki++) {
            const k = clip.keyframes[ki];
            const kx = r.x + (k.timeSec / clip.durationSec) * r.w;
            const ky = autoY + autoH * (1 - k.value);
            if (Math.hypot(x - kx, y - ky) <= 8) {
              return { type: 'keyframe', ref: { layerId: layer.id, clipId: clip.id }, clip, layerIndex, keyframeIndex: ki, keyframe: k };
            }
          }
          if (y <= r.y + headH) {
            return { type: 'clip', ref: { layerId: layer.id, clipId: clip.id }, clip, layerIndex, zone: x <= r.x + edge ? 'start' : x >= r.x + r.w - edge ? 'end' : 'body' };
          }
          return { type: 'automation', ref: { layerId: layer.id, clipId: clip.id }, clip, layerIndex };
        } else {
          return { type: 'clip', ref: { layerId: layer.id, clipId: clip.id }, clip, layerIndex, zone: x <= r.x + edge ? 'start' : x >= r.x + r.w - edge ? 'end' : 'body' };
        }
      }
    }
    const px = Math.round(xAt(ctx.getTime()));
    if (Math.abs(x - px) <= 6) return { type: 'playhead', layerIndex, layer };
    return { type: 'lane', layerIndex, layer };
  }

  /* -------------------------------------------------------- new clips */
  function createClipAt(layerIndex, startSec, lengthSec, extra = {}) {
    const layer = tl().layers[layerIndex]; if (!layer) return null;
    const spec = { ...ctx.newClipSpec(layer), ...extra, startSec, durationSec: lengthSec };
    let ref;
    const out = store.commit('Novi clip', t => { ref = addClip(t, layer.id, spec); });
    if (out.error) { ctx.status(out.error); return null; }
    return ref;
  }
  const barLength = at => { const pos = Math.round(beatPosition(at, tl(), analysis())); return Math.max(MIN_CLIP_SEC, timeAtBeat(pos + 4, tl(), analysis()) - timeAtBeat(pos, tl(), analysis())); };

  /* ------------------------------------------------------------ gestures */
  const localPoint = event => { const r = canvas.getBoundingClientRect(); return { x: event.clientX - r.left, y: event.clientY - r.top }; };

  // PointerEvent.detail is always 0, so double clicks are detected by timing.
  let lastDown = { t: 0, x: 0, y: 0 };
  const isDouble = event => {
    const double = performance.now() - lastDown.t < 350 && Math.hypot(event.clientX - lastDown.x, event.clientY - lastDown.y) < 6;
    lastDown = double ? { t: 0, x: 0, y: 0 } : { t: performance.now(), x: event.clientX, y: event.clientY };
    return double;
  };
  canvas.addEventListener('contextmenu', event => event.preventDefault());
  canvas.addEventListener('pointerdown', event => {
    canvas.focus({ preventScroll: true });
    const dbl = event.button === 0 && isDouble(event);
    const { x, y } = localPoint(event), t = tAt(x);
    let hit = hitTest(x, y);
    if (event.button === 1 || state.spaceDown || (event.altKey && hit.type !== 'clip' && hit.type !== 'keyframe' && hit.type !== 'automation')) { state.gesture = { mode: 'pan', x: event.clientX, scroll: state.scrollSec }; canvas.setPointerCapture(event.pointerId); canvas.classList.add('panning'); return; }
    if (event.button === 2) {
      if (hit.type === 'keyframe') {
        const { ref, keyframeIndex, clip } = hit;
        showMenu(event.clientX, event.clientY, [
          { label: 'Ease Ease (glatko)', onClick: () => { store.commit('Ease Ease', tlm => { const c = findClip(tlm, ref)?.clip; if (c) setKeyframeEase(c, keyframeIndex, 'ease'); }); requestDraw(); } },
          { label: 'Ease In (usporavanje)', onClick: () => { store.commit('Ease In', tlm => { const c = findClip(tlm, ref)?.clip; if (c) setKeyframeEase(c, keyframeIndex, 'in'); }); requestDraw(); } },
          { label: 'Ease Out (ubrzavanje)', onClick: () => { store.commit('Ease Out', tlm => { const c = findClip(tlm, ref)?.clip; if (c) setKeyframeEase(c, keyframeIndex, 'out'); }); requestDraw(); } },
          { label: 'Linearno (ravno)', onClick: () => { store.commit('Linearno', tlm => { const c = findClip(tlm, ref)?.clip; if (c) setKeyframeEase(c, keyframeIndex, 'linear'); }); requestDraw(); } },
          { separator: true },
          { label: 'Obriši točku', danger: true, disabled: clip.keyframes.length <= 2, onClick: () => { store.commit('Obriši točku', tlm => { const c = findClip(tlm, ref)?.clip; if (c) removeKeyframe(c, keyframeIndex); }); state.selectedKeyframe = null; requestDraw(); } }
        ]);
        return;
      }
      if (hit.type === 'clip' || hit.type === 'automation') {
        const targetRef = hit.ref;
        store.commit('Obriši clip', tl => deleteClips(tl, isSelected(targetRef) ? state.selection : [targetRef]));
        pruneSelection();
        requestDraw();
        ctx.onStructure?.();
      }
      return;
    }
    if (event.button !== 0 || !tl().layers.length) return;
    if (hit.type === 'audio' || hit.type === 'analysis' || hit.type === 'playhead') {
      state.gesture = { mode: 'scrub', startX: x, moved: false };
      canvas.setPointerCapture(event.pointerId);
      const curT = tAt(clamp(x, 0, stageWidth()));
      ctx.seek(curT, true);
      requestDraw();
      return;
    }
    const tool = ctx.getTool();
    if (hit.type === 'keyframe') {
      ctx.setActiveLayer(hit.layerIndex);
      setSelection([hit.ref]);
      state.selectedKeyframe = { ref: hit.ref, index: hit.keyframeIndex };
      store.begin();
      const r = clipRect(hit.layerIndex, hit.clip), headH = 20, autoH = r.h - headH - 2;
      state.gesture = {
        mode: 'drag-keyframe',
        ref: hit.ref,
        clip: hit.clip,
        layerIndex: hit.layerIndex,
        index: hit.keyframeIndex,
        x0: x,
        y0: y,
        t0: hit.keyframe.timeSec,
        v0: hit.keyframe.value,
        autoH,
        moved: false
      };
      canvas.setPointerCapture(event.pointerId);
      requestDraw();
      return;
    }
    if (hit.type === 'automation') {
      ctx.setActiveLayer(hit.layerIndex);
      setSelection([hit.ref]);
      if (dbl) {
        const r = clipRect(hit.layerIndex, hit.clip), headH = 20, autoH = r.h - headH - 2;
        const localT = clamp(t - hit.clip.startSec, 0, hit.clip.durationSec);
        const snappedT = clamp(snapTime(hit.clip.startSec + localT, snapMode(), tl(), analysis()) - hit.clip.startSec, 0, hit.clip.durationSec);
        const val = clamp(1 - (y - (r.y + headH)) / Math.max(1, autoH), 0, 1);
        let addedIdx = -1;
        store.commit('Dodaj točku', tlm => {
          const c = findClip(tlm, hit.ref)?.clip;
          if (c) addedIdx = addKeyframe(c, snappedT, val, 'ease');
        });
        if (addedIdx >= 0) state.selectedKeyframe = { ref: hit.ref, index: addedIdx };
        requestDraw();
        return;
      }
      state.selectedKeyframe = null;
      requestDraw();
      return;
    }
    if (hit.type === 'clip') {
      ctx.setActiveLayer(hit.layerIndex);
      if (tool === 'slice') {
        let parts;
        const at = snap(t), out = store.commit('Podijeli clip', tlm => { parts = splitClip(tlm, hit.ref, at); });
        if (out.error || !parts) ctx.status('Podjela mora biti unutar clipa, barem 50 ms od ruba.'); else setSelection(parts);
        ctx.onStructure?.(); requestDraw(); return;
      }
      if (tool === 'erase') { store.begin(); state.gesture = { mode: 'erase' }; canvas.setPointerCapture(event.pointerId); store.update(tlm => deleteClips(tlm, [hit.ref])); pruneSelection(); requestDraw(); return; }
      if (event.metaKey || event.ctrlKey) {
        setSelection(isSelected(hit.ref) ? state.selection.filter(s => refKey(s) !== refKey(hit.ref)) : [...state.selection, hit.ref]); return;
      }
      if (event.shiftKey && !isSelected(hit.ref)) {
        setSelection([...state.selection, hit.ref]);
      } else if (!event.shiftKey && !isSelected(hit.ref)) {
        setSelection([hit.ref]);
      } else {
        ctx.onSelect?.([...state.selection]);
      }
      const collapse = (!event.shiftKey && state.selection.length > 1 && isSelected(hit.ref)) ? hit.ref : null;
      store.begin();
      const sources = state.selection.map(ref => ({ ...findClip(tl(), ref), ref }));
      const items = sources.map(s => ({ ref: s.ref, startSec: s.clip.startSec, endSec: clipEnd(s.clip), layerIndex: s.layerIndex }));
      const anchor = items.find(i => i.ref.clipId === hit.ref.clipId) ?? items[0];
      const isShift = Boolean(event.shiftKey || state.shiftDown);
      state.gesture = {
        mode: hit.zone === 'body' ? 'move' : hit.zone,
        x0: x,
        y0: y,
        items,
        anchor,
        collapse,
        dup: event.altKey && hit.zone === 'body',
        moved: false,
        label: hit.zone === 'body' ? (event.altKey ? 'Dupliciraj clip' : 'Pomakni clip') : 'Promijeni duljinu',
        baseLayerCount: tl().layers.length,
        createdLayerId: null,
        lastRenderedCount: tl().layers.length,
        shiftLock: isShift,
        dl: 0
      };
      canvas.setPointerCapture(event.pointerId); return;
    }
    // empty lane or void
    const layerIndex = hit.type === 'lane' ? hit.layerIndex : -1;
    if (layerIndex >= 0) ctx.setActiveLayer(layerIndex);
    if (tool === 'draw' && layerIndex >= 0 && !dbl) {
      const start = snap(t); store.begin();
      let ref; store.update(tlm => { ref = addClip(tlm, tl().layers[layerIndex].id, { ...ctx.newClipSpec(tl().layers[layerIndex]), startSec: start, durationSec: Math.min(barLength(start), Math.max(MIN_CLIP_SEC, duration() - start)) }); });
      setSelection([ref]); state.gesture = { mode: 'draw', ref, start, x0: x, moved: false }; canvas.setPointerCapture(event.pointerId); requestDraw(); return;
    }
    if (dbl && layerIndex >= 0) {
      const start = snap(t), ref = createClipAt(layerIndex, start, Math.min(barLength(start), Math.max(MIN_CLIP_SEC, duration() - start)));
      if (ref) { setSelection([ref]); ctx.onStructure?.(); }
      return;
    }
    const base = event.shiftKey ? [...state.selection] : [];
    if (!event.shiftKey) setSelection([]);
    state.gesture = { mode: 'marquee', x0: x, y0: y, t0: t, base }; canvas.setPointerCapture(event.pointerId);
  });

  canvas.addEventListener('pointermove', event => {
    const { x, y } = localPoint(event), g = state.gesture;
    if (!g) {
      const hit = hitTest(x, y), tool = ctx.getTool();
      state.hover = { x, y, hit };
      const px = Math.round(xAt(ctx.getTime()));
      const nearPlayhead = Math.abs(x - px) <= 6 && hit.type !== 'clip';
      canvas.style.cursor = nearPlayhead ? 'col-resize' : hit.type === 'keyframe' ? 'move' : hit.type === 'automation' ? 'crosshair' : hit.type === 'clip' ? (tool === 'slice' ? 'crosshair' : tool === 'erase' ? 'not-allowed' : hit.zone === 'body' ? 'grab' : 'ew-resize') : hit.type === 'lane' ? (tool === 'draw' ? 'crosshair' : 'default') : hit.type === 'void' ? 'default' : 'col-resize';
      canvas.title = nearPlayhead ? 'Playhead: povuci za glatki scrub' : hit.type === 'keyframe' ? 'Keyframe: povuci za pomak · desni klik za ease/brisanje' : hit.type === 'automation' ? 'Dvaput klikni za dodavanje točke' : (hit.type === 'audio' || hit.type === 'analysis') ? 'Waveform: klikni ili povuci za scrub' : '';
      state.ghost = (tool === 'slice' && hit.type === 'clip') || (tool === 'draw' && hit.type === 'lane' && !nearPlayhead) ? { t: snap(tAt(x)), layerIndex: hit.layerIndex, tool } : null;
      requestDraw(); return;
    }
    if (g.mode === 'pan') { state.scrollSec = g.scroll - (event.clientX - g.x) / state.pps; clampView(); requestDraw(); ctx.onView?.(); return; }
    if (g.mode === 'drag-keyframe') {
      if (Math.abs(x - g.x0) > 2 || Math.abs(y - g.y0) > 2) g.moved = true;
      const dt = (x - g.x0) / state.pps;
      const dv = -(y - g.y0) / Math.max(1, g.autoH);
      const rawT = clamp(g.t0 + dt, 0, g.clip.durationSec);
      const targetT = event.shiftKey ? rawT : clamp(snapTime(g.clip.startSec + rawT, snapMode(), tl(), analysis()) - g.clip.startSec, 0, g.clip.durationSec);
      const targetV = clamp(g.v0 + dv, 0, 1);
      store.update(tlm => {
        const c = findClip(tlm, g.ref)?.clip;
        if (c) g.index = moveKeyframe(c, g.index, targetT, targetV);
      });
      state.selectedKeyframe = { ref: g.ref, index: g.index };
      requestDraw();
      return;
    }
    if (g.mode === 'scrub') {
      if (Math.abs(x - g.startX) > 2) g.moved = true;
      if (x > stageWidth() - 25) {
        state.scrollSec = clamp(state.scrollSec + visibleSec() * 0.03, 0, Math.max(0, duration() - visibleSec()));
        clampView();
      } else if (x < 25) {
        state.scrollSec = clamp(state.scrollSec - visibleSec() * 0.03, 0, Math.max(0, duration() - visibleSec()));
        clampView();
      }
      const t = g.moved && !event.shiftKey ? tAt(clamp(x, 0, stageWidth())) : snap(tAt(clamp(x, 0, stageWidth())));
      ctx.seek(clamp(t, 0, duration()), true);
      requestDraw();
      return;
    }
    if (g.mode === 'erase') { const hit = hitTest(x, y); if (hit.type === 'clip') { store.update(tlm => deleteClips(tlm, [hit.ref])); pruneSelection(); requestDraw(); } return; }
    if (g.mode === 'marquee') {
      state.marquee = { x0: g.x0, y0: g.y0, x1: x, y1: y };
      const refs = clipsInRect(tl(), g.t0, tAt(x), Math.max(0, laneAt(g.y0)), Math.max(0, laneAt(y)));
      const merged = [...g.base]; for (const ref of refs) if (!merged.some(m => refKey(m) === refKey(ref))) merged.push(ref);
      state.selection = merged; requestDraw(); return;
    }
    if (g.mode === 'draw') {
      const end = snap(tAt(x)); if (Math.abs(x - g.x0) > 4) g.moved = true;
      if (g.moved) store.update(tlm => {
        const hit = findClip(tlm, g.ref); if (!hit) return;
        const a = Math.min(g.start, end), b = Math.max(g.start, end), length = Math.max(MIN_CLIP_SEC, Math.min(b, duration()) - a);
        hit.clip.startSec = a; hit.clip.durationSec = length; hit.clip.keyframes = [{ timeSec: 0, value: 1 }, { timeSec: length, value: 1 }];
      });
      requestDraw(); return;
    }
  function applyMove(x, y, clientY, isShift) {
    const g = state.gesture;
    if (!g || g.mode !== 'move') return;
    if (Math.abs(x - g.x0) > 2 || Math.abs(y - g.y0) > 2) g.moved = true;
    if (!g.moved) return;

    if (g.dup) {
      g.dup = false; const index = Math.max(0, g.items.findIndex(i => i.ref.clipId === g.anchor.ref.clipId));
      let dup; store.update(tlm => { dup = duplicateClips(tlm, g.items.map(i => i.ref), 0, 0); });
      g.items = dup.map(ref => { const hit = findClip(tl(), ref); return { ref, startSec: hit.clip.startSec, endSec: clipEnd(hit.clip), layerIndex: hit.layerIndex }; });
      g.anchor = g.items[index]; setSelection(dup, false);
      g.baseLayerCount = tl().layers.length;
      g.lastRenderedCount = tl().layers.length;
    }

    const scrollRect = scroller.getBoundingClientRect?.();
    if (scrollRect && clientY !== undefined) {
      if (clientY > scrollRect.bottom - 30) scroller.scrollTop += 10;
      else if (clientY < scrollRect.top + 30) scroller.scrollTop -= 10;
    }
    const dxSec = (x - g.x0) / state.pps;
    const wanted = snap(g.anchor.startSec + dxSec), minStart = Math.min(...g.items.map(i => i.startSec));
    const delta = isShift ? 0 : Math.max(-minStart, wanted - g.anchor.startSec);
    const baseCount = g.baseLayerCount;
    const targetAnchorLane = Math.min(baseCount, laneAt(y, true));
    const rawDl = targetAnchorLane - g.anchor.layerIndex;
    const minLayer = Math.min(...g.items.map(i => i.layerIndex));
    const maxLayer = Math.max(...g.items.map(i => i.layerIndex));
    const maxDl = baseCount - maxLayer;
    const minDl = -minLayer;
    const dl = clamp(rawDl, minDl, maxDl);
    g.dl = dl;
    g.shiftLock = Boolean(isShift);
    const needsNewLayer = (maxLayer + dl) >= baseCount;

    store.update(tlm => {
      if (needsNewLayer && !g.createdLayerId) {
        const newLayer = addLayer(tlm);
        g.createdLayerId = newLayer.id;
      } else if (!needsNewLayer && g.createdLayerId) {
        for (const item of g.items) {
          const targetIdx = clamp(item.layerIndex + dl, 0, baseCount - 1);
          moveClip(tlm, item.ref, { layerId: tlm.layers[targetIdx].id });
        }
        const idx = tlm.layers.findIndex(l => l.id === g.createdLayerId);
        if (idx >= 0) tlm.layers.splice(idx, 1);
        g.createdLayerId = null;
      }

      for (const item of g.items) {
        const targetIndex = item.layerIndex + dl;
        const targetLayer = tlm.layers[targetIndex];
        if (targetLayer) {
          const next = moveClip(tlm, item.ref, { startSec: item.startSec + delta, layerId: targetLayer.id });
          if (next) item.ref = next;
        }
      }
    });

    if (tl().layers.length !== g.lastRenderedCount) {
      g.lastRenderedCount = tl().layers.length;
      if (g.createdLayerId) {
        const newIdx = tl().layers.findIndex(l => l.id === g.createdLayerId);
        if (newIdx >= 0) ctx.setActiveLayer(newIdx);
      }
      renderHeads();
    }

    state.selection = g.items.map(i => i.ref);
    ctx.onSelect?.([...state.selection]);
    requestDraw();
  }

    if (g.mode === 'move') {
      const isShift = Boolean(event.shiftKey || state.shiftDown);
      g.lastMoveArgs = [x, y, event.clientY];
      applyMove(x, y, event.clientY, isShift);
      return;
    }
    const dxSec = (x - g.x0) / state.pps;
    if (Math.abs(x - g.x0) > 2 || Math.abs(y - g.y0) > 2) g.moved = true;
    if (!g.moved) return;
    if (g.mode === 'end') {
      const wanted = snap(g.anchor.endSec + dxSec), delta = wanted - g.anchor.endSec;
      store.update(tlm => { for (const item of g.items) resizeClip(tlm, item.ref, 'end', item.endSec + delta, duration()); });
      requestDraw(); return;
    }
    if (g.mode === 'start') {
      const wanted = snap(g.anchor.startSec + dxSec), delta = wanted - g.anchor.startSec;
      store.update(tlm => { for (const item of g.items) resizeClip(tlm, item.ref, 'start', item.startSec + delta); });
      requestDraw();
    }
  });

  const finishGesture = event => {
    const g = state.gesture; if (!g) return;
    state.gesture = null; state.marquee = null; canvas.classList.remove('panning');
    if (canvas.hasPointerCapture?.(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    if (g.mode === 'drag-keyframe') {
      store.end('Pomakni točku');
      requestDraw();
      return;
    }
    if (g.mode === 'scrub') {
      if (!g.moved && ctx.getSnap() !== 'none' && !event.altKey) {
        ctx.seek(snap(tAt(g.startX)), false);
      }
      ctx.commitSeek?.();
      requestDraw();
      return;
    }
    if (g.mode === 'marquee') { ctx.onSelect?.([...state.selection]); requestDraw(); return; }
    if (g.mode === 'draw') { store.end('Novi clip'); ctx.onStructure?.(); ctx.onSelect?.([...state.selection]); requestDraw(); return; }
    if (['move', 'start', 'end'].includes(g.mode)) {
      const openedNewTrack = Boolean(g.createdLayerId && tl().layers.some(l => l.id === g.createdLayerId));
      const label = openedNewTrack ? 'Novi sloj i premjesti clip' : g.label;
      store.end(label);
      if (!g.moved && g.collapse) setSelection([g.collapse]);
      if (openedNewTrack) {
        const newIdx = tl().layers.findIndex(l => l.id === g.createdLayerId);
        if (newIdx >= 0) ctx.setActiveLayer(newIdx);
        renderHeads();
        ctx.status('Novi sloj otvoren i clip postavljen.');
      }
      ctx.onStructure?.(); requestDraw(); return;
    }
    if (g.mode === 'erase') { store.end('Obriši clipove'); ctx.onStructure?.(); requestDraw(); }
  };
  canvas.addEventListener('pointerup', finishGesture);
  canvas.addEventListener('pointercancel', event => { if (state.gesture?.mode && ['move', 'start', 'end', 'draw', 'erase', 'drag-keyframe'].includes(state.gesture.mode)) store.cancel(); finishGesture(event); });
  canvas.addEventListener('pointerleave', () => { if (!state.gesture) { state.hover = null; state.ghost = null; requestDraw(); } });
  canvas.addEventListener('dblclick', event => { const { x, y } = localPoint(event), hit = hitTest(x, y); if (hit.type === 'clip' && ctx.getTool() !== 'slice') ctx.openEditor?.(); });

  const onPlaylistWheel = event => {
    if (event._playlistHandled) return;
    event._playlistHandled = true;
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      const { x } = localPoint(event);
      const zoomX = clamp(x, 0, stageWidth());
      zoomAround(Math.exp(-event.deltaY * (event.ctrlKey ? .012 : .004)), tAt(zoomX), zoomX);
      return;
    }
    const isShift = event.shiftKey;
    const absX = Math.abs(event.deltaX || 0);
    const absY = Math.abs(event.deltaY || 0);
    if (isShift || (absX > 0 && absX >= absY)) {
      event.preventDefault();
      const delta = isShift && !event.deltaX ? event.deltaY : event.deltaX;
      state.scrollSec += delta / state.pps;
      clampView();
      requestDraw();
      ctx.onView?.();
    }
  };
  canvas.addEventListener('wheel', onPlaylistWheel, { passive: false });
  scroller.addEventListener('wheel', onPlaylistWheel, { passive: false });

  /* drag & drop of effect presets */
  const presetFrom = event => event.dataTransfer?.getData('application/x-ledicated-preset') || (event.dataTransfer?.types?.includes('application/x-ledicated-preset') ? '1' : '');
  canvas.addEventListener('dragover', event => {
    if (!presetFrom(event)) return;
    event.preventDefault(); event.dataTransfer.dropEffect = 'copy';
    const { x, y } = localPoint(event); state.ghost = { t: snap(tAt(x)), layerIndex: laneAt(y, true), tool: 'draw' }; requestDraw();
  });
  canvas.addEventListener('dragleave', () => { state.ghost = null; requestDraw(); });
  canvas.addEventListener('drop', event => {
    const preset = event.dataTransfer.getData('application/x-ledicated-preset'); if (!preset) return;
    event.preventDefault(); state.ghost = null;
    const { x, y } = localPoint(event), layerIndex = laneAt(y, true), start = snap(tAt(x));
    if (layerIndex >= tl().layers.length) {
      let created;
      const out = store.commit('Novi sloj', t => { created = addLayer(t); });
      if (out.error) return ctx.status(out.error);
      const newIdx = tl().layers.findIndex(l => l.id === created.id);
      if (newIdx >= 0) ctx.setActiveLayer(newIdx);
      renderHeads(); ctx.onStructure?.();
      const ref = createClipAt(newIdx, start, Math.min(barLength(start), Math.max(MIN_CLIP_SEC, duration() - start)), { preset });
      if (ref) { setSelection([ref]); ctx.onStructure?.(); ctx.status(`Novi sloj otvoren i clip „${PRESET_LABELS[preset] || preset}” dodan.`); }
    } else {
      const ref = createClipAt(clamp(layerIndex, 0, tl().layers.length - 1), start, Math.min(barLength(start), Math.max(MIN_CLIP_SEC, duration() - start)), { preset });
      if (ref) { setSelection([ref]); ctx.onStructure?.(); ctx.status(`Clip „${PRESET_LABELS[preset] || preset}” dodan.`); }
    }
  });

  /* ruler */
  let rulerGesture = null;
  let hoverSectionBoundary = null;

  function findSectionBoundary(x, sections) {
    if (!Array.isArray(sections) || sections.length < 2) return -1;
    let bestIdx = -1;
    let bestDist = 7;
    for (let i = 1; i < sections.length; i++) {
      const dist = Math.abs(x - xAt(sections[i].startSec));
      if (dist <= 6 && dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
      }
    }
    return bestIdx;
  }

  function findSectionIndexAt(t, sections) {
    if (!Array.isArray(sections) || !sections.length) return -1;
    for (let i = 0; i < sections.length; i++) {
      const s = sections[i];
      if (t >= s.startSec && (t < s.endSec || (i === sections.length - 1 && t <= s.endSec + 1e-3))) {
        return i;
      }
    }
    return -1;
  }

  function setSectionType(idx, type, { regenerate = true } = {}) {
    const a = analysis();
    if (!a?.sections?.[idx] || !SECTION_TYPES.includes(type)) return false;
    const sec = a.sections[idx];
    sec.type = type;
    sec.color = SECTION_COLORS[type];
    relabelSections(a.sections);
    if (regenerate) {
      const themeOpts = ctx.getThemeOptions?.() || {};
      store.commit(`Dionica: ${SECTION_NAMES[type]}`, tlm => {
        regenerateSectionClips(tlm, a, idx, { ...themeOpts, sectionType: type });
      });
      ctx.status?.(`Dionica promijenjena u „${sec.name}” i svjetlo regenerirano.`);
    } else {
      ctx.status?.(`Oznaka dionice promijenjena u „${sec.name}”.`);
    }
    ctx.onSectionsChange?.(a.sections, { regenerateSectionIndex: regenerate ? idx : null });
    requestDraw();
    return true;
  }

  function regenerateSingleSection(idx) {
    const a = analysis();
    if (!a?.sections?.[idx]) return false;
    const sec = a.sections[idx];
    const themeOpts = ctx.getThemeOptions?.() || {};
    store.commit(`Regeneriraj: ${sec.name}`, tlm => {
      regenerateSectionClips(tlm, a, idx, { ...themeOpts, sectionType: sec.type });
    });
    ctx.onSectionsChange?.(a.sections, { regenerateSectionIndex: idx });
    ctx.status?.(`Svjetlo regenerirano za dionicu „${sec.name}”.`);
    requestDraw();
    return true;
  }

  function splitSectionAt(idx, clickTimeSec) {
    const a = analysis();
    if (!a?.sections?.[idx]) return false;
    const sec = a.sections[idx];
    const bpm = clamp(Number(tl()?.bpm || a?.bpm || 120), 40, 240);
    const barSec = (60 / bpm) * 4;
    if (sec.endSec - sec.startSec < 0.5) {
      ctx.status?.('Dionica je prekratka za podjelu.');
      return false;
    }
    let splitT = snapTime(clamp(clickTimeSec, 0, duration()), 'bar', tl(), a);
    const minMargin = Math.min(barSec, (sec.endSec - sec.startSec) * 0.35);
    if (splitT <= sec.startSec + minMargin * 0.5 || splitT >= sec.endSec - minMargin * 0.5) {
      splitT = snapTime((sec.startSec + sec.endSec) / 2, 'bar', tl(), a);
    }
    splitT = clamp(splitT, sec.startSec + Math.min(0.25, (sec.endSec - sec.startSec) * 0.25), sec.endSec - Math.min(0.25, (sec.endSec - sec.startSec) * 0.25));
    splitT = Math.round(splitT * 100) / 100;
    const first = { ...sec, endSec: splitT, durationSec: Math.round((splitT - sec.startSec) * 100) / 100 };
    const second = { ...sec, id: `sec-split-${idx + 1}`, startSec: splitT, endSec: sec.endSec, durationSec: Math.round((sec.endSec - splitT) * 100) / 100 };
    a.sections.splice(idx, 1, first, second);
    relabelSections(a.sections);
    ctx.onSectionsChange?.(a.sections, { regenerateSectionIndex: null });
    ctx.status?.(`Dionica podijeljena na ${splitT.toFixed(1)}s.`);
    requestDraw();
    return true;
  }

  function mergeSectionWithNext(idx) {
    const a = analysis();
    if (!a?.sections?.[idx] || idx >= a.sections.length - 1) return false;
    const sec = a.sections[idx];
    const next = a.sections[idx + 1];
    sec.endSec = next.endSec;
    sec.durationSec = Math.round((sec.endSec - sec.startSec) * 100) / 100;
    a.sections.splice(idx + 1, 1);
    relabelSections(a.sections);
    ctx.onSectionsChange?.(a.sections, { regenerateSectionIndex: null });
    ctx.status?.(`Dionica „${sec.name}” spojena sa sljedećom.`);
    requestDraw();
    return true;
  }

  function openSectionMenu(clientX, clientY, idx, clickTimeSec) {
    const a = analysis();
    const sec = a?.sections?.[idx];
    if (!sec) return;
    const typeItems = SECTION_TYPES.map(type => ({
      label: `${sec.type === type ? '✓ ' : ''}${SECTION_NAMES[type]} (promijeni i regeneriraj dionicu)`,
      onClick: () => setSectionType(idx, type, { regenerate: true })
    }));
    showMenu(clientX, clientY, [
      ...typeItems,
      { separator: true },
      {
        label: 'Samo promijeni oznaku u…',
        onClick: () => {
          showMenu(clientX, clientY, SECTION_TYPES.map(type => ({
            label: `${sec.type === type ? '✓ ' : ''}Oznaka: ${SECTION_NAMES[type]} (bez promjene clipova)`,
            onClick: () => setSectionType(idx, type, { regenerate: false })
          })));
        }
      },
      {
        label: `Regeneriraj svjetlo za ovu dionicu (${sec.name})`,
        onClick: () => regenerateSingleSection(idx)
      },
      {
        label: 'Podijeli dionicu ovdje (na taktu)',
        disabled: (sec.endSec - sec.startSec) < 0.5,
        onClick: () => splitSectionAt(idx, clickTimeSec)
      },
      {
        label: 'Spoji sa sljedećom dionicom',
        disabled: idx >= a.sections.length - 1,
        onClick: () => mergeSectionWithNext(idx)
      },
      { separator: true },
      { label: `Loop „${sec.name}” (${sec.durationSec.toFixed(1)}s)`, onClick: () => { ctx.setLoop?.({ start: sec.startSec, end: sec.endSec }); ctx.seek(sec.startSec, true); } },
      { label: `Skoči na početak (${sec.startSec.toFixed(1)}s)`, onClick: () => ctx.seek(sec.startSec, true) },
      { label: 'Odaberi clipove u dionici', onClick: () => {
        const hits = clipsInRect(tl(), sec.startSec, sec.endSec, 0, tl().layers.length - 1);
        setSelection(hits);
      }},
      { label: 'Dodaj clip kroz dionicu (aktivni sloj)', onClick: () => {
        const li = ctx.getActiveLayerIndex();
        const ref = createClipAt(li, sec.startSec, sec.durationSec);
        if (ref) setSelection([ref]);
      }}
    ]);
  }

  ruler.addEventListener('pointerdown', event => {
    if (event.button === 2) return;
    const r = ruler.getBoundingClientRect(), x = event.clientX - r.left, y = event.clientY - r.top;
    ruler.setPointerCapture(event.pointerId);
    const px = Math.round(xAt(ctx.getTime()));
    const nearPlayhead = Math.abs(x - px) <= 8;
    if (y >= RULER_BARS + RULER_LOOP && !nearPlayhead) {
      const a = analysis();
      const bIdx = findSectionBoundary(x, a?.sections);
      if (bIdx >= 1) {
        rulerGesture = { mode: 'section-drag', index: bIdx, startX: x, moved: false };
        requestDraw();
        return;
      }
      const t = tAt(x);
      const secIdx = findSectionIndexAt(t, a?.sections);
      const hitSec = secIdx >= 0 ? a.sections[secIdx] : null;
      if (hitSec) {
        ctx.seek(hitSec.startSec, false);
        ctx.setLoop?.({ start: hitSec.startSec, end: hitSec.endSec });
        ctx.status?.(`Dionica „${hitSec.name}” (${hitSec.startSec.toFixed(1)}s – ${hitSec.endSec.toFixed(1)}s) odabrana za loop.`);
        requestDraw();
      }
      return;
    }
    if (nearPlayhead || y < RULER_BARS) {
      rulerGesture = { mode: 'seek', startX: x, moved: false };
      const t = tAt(clamp(x, 0, stageWidth()));
      ctx.seek(t, true);
      requestDraw();
      return;
    }
    const loop = ctx.getLoop(), a = loop ? xAt(loop.start) : -99, b = loop ? xAt(loop.end) : -99;
    if (loop && Math.abs(x - a) < 6) rulerGesture = { mode: 'loop-start' };
    else if (loop && Math.abs(x - b) < 6) rulerGesture = { mode: 'loop-end' };
    else if (loop && x > a && x < b) rulerGesture = { mode: 'loop-move', t0: tAt(x), start: loop.start, end: loop.end };
    else rulerGesture = { mode: 'loop-new', t0: snap(tAt(x)), moved: false };
  });
  ruler.addEventListener('pointermove', event => {
    const r = ruler.getBoundingClientRect(), x = event.clientX - r.left, y = event.clientY - r.top, g = rulerGesture;
    const px = Math.round(xAt(ctx.getTime()));
    const nearPlayhead = Math.abs(x - px) <= 8;
    if (!g) {
      if (y >= RULER_BARS + RULER_LOOP && !nearPlayhead) {
        const a = analysis();
        const bIdx = findSectionBoundary(x, a?.sections);
        if (bIdx !== hoverSectionBoundary) {
          hoverSectionBoundary = bIdx >= 1 ? bIdx : null;
          requestDraw();
        }
        if (bIdx >= 1) {
          ruler.style.cursor = 'ew-resize';
          const prevS = a.sections[bIdx - 1], curS = a.sections[bIdx];
          ruler.title = `Granica dionica: ${prevS.name} | ${curS.name} (${curS.startSec.toFixed(1)}s) · Povuci za pomak po taktu`;
        } else {
          ruler.style.cursor = 'pointer';
          const t = tAt(x);
          const secIdx = findSectionIndexAt(t, a?.sections);
          const hitSec = secIdx >= 0 ? a.sections[secIdx] : null;
          ruler.title = hitSec
            ? `Dionica: ${hitSec.name} (${hitSec.startSec.toFixed(1)}s – ${hitSec.endSec.toFixed(1)}s) · Klikni za loop, desni klik ili dvoklik za vrstu i opcije`
            : 'Dionice pjesme';
        }
      } else {
        if (hoverSectionBoundary !== null) {
          hoverSectionBoundary = null;
          requestDraw();
        }
        if (nearPlayhead || y < RULER_BARS) {
          ruler.style.cursor = 'col-resize';
          ruler.title = 'Playhead: povuci za glatki scrub · klikni za skok na beat';
        } else {
          ruler.style.cursor = 'ew-resize';
          ruler.title = 'Loop pojas: povuci za petlju';
        }
      }
      return;
    }
    if (g.mode === 'section-drag') {
      const a = analysis();
      const idx = g.index;
      const prevSec = a?.sections?.[idx - 1], curSec = a?.sections?.[idx];
      if (!prevSec || !curSec) return;
      const bpm = clamp(Number(tl()?.bpm || a?.bpm || 120), 40, 240);
      const barSec = (60 / bpm) * 4;
      const span = curSec.endSec - prevSec.startSec;
      const margin = Math.min(barSec, span * 0.45);
      const minT = prevSec.startSec + margin;
      const maxT = curSec.endSec - margin;
      const snapped = snapTime(clamp(tAt(x), 0, duration()), 'bar', tl(), a);
      const nextT = Math.round(clamp(snapped, minT, maxT) * 100) / 100;
      if (Math.abs(nextT - curSec.startSec) > 1e-4) {
        g.moved = true;
        prevSec.endSec = nextT;
        prevSec.durationSec = Math.round((prevSec.endSec - prevSec.startSec) * 100) / 100;
        curSec.startSec = nextT;
        curSec.durationSec = Math.round((curSec.endSec - curSec.startSec) * 100) / 100;
        ctx.status?.(`Granica ${prevSec.name} | ${curSec.name}: ${nextT.toFixed(2)}s`);
        requestDraw();
        drawRuler(stageWidth(), ctx.getTime());
      }
      return;
    }
    if (g.mode === 'seek') {
      if (Math.abs(x - g.startX) > 2) g.moved = true;
      if (x > stageWidth() - 25) {
        state.scrollSec = clamp(state.scrollSec + visibleSec() * 0.03, 0, Math.max(0, duration() - visibleSec()));
        clampView();
      } else if (x < 25) {
        state.scrollSec = clamp(state.scrollSec - visibleSec() * 0.03, 0, Math.max(0, duration() - visibleSec()));
        clampView();
      }
      const t = g.moved && !event.shiftKey ? tAt(clamp(x, 0, stageWidth())) : snap(tAt(clamp(x, 0, stageWidth())));
      ctx.seek(clamp(t, 0, duration()), true);
      requestDraw();
      return;
    }
    const t = snap(tAt(clamp(x, 0, stageWidth())));
    if (g.mode === 'loop-new') { g.moved = g.moved || Math.abs(t - g.t0) > .02; if (g.moved) ctx.setLoop({ start: Math.min(t, g.t0), end: Math.max(t, g.t0) }); }
    else if (g.mode === 'loop-start') ctx.setLoop({ start: Math.min(t, ctx.getLoop().end - .1), end: ctx.getLoop().end });
    else if (g.mode === 'loop-end') ctx.setLoop({ start: ctx.getLoop().start, end: Math.max(t, ctx.getLoop().start + .1) });
    else if (g.mode === 'loop-move') { const len = g.end - g.start, s = clamp(snap(g.start + tAt(x) - g.t0), 0, duration() - len); ctx.setLoop({ start: s, end: s + len }); }
  });
  const rulerUp = event => {
    if (rulerGesture?.mode === 'section-drag') {
      const a = analysis();
      if (a?.sections) {
        relabelSections(a.sections);
        ctx.onSectionsChange?.(a.sections, { regenerateSectionIndex: null });
      }
      requestDraw();
    }
    if (rulerGesture?.mode === 'seek') {
      if (!rulerGesture.moved && ctx.getSnap() !== 'none' && !event.altKey) {
        ctx.seek(snap(tAt(rulerGesture.startX)), false);
      }
      ctx.commitSeek?.();
      requestDraw();
    }
    if (rulerGesture?.mode === 'loop-new' && !rulerGesture.moved) ctx.setLoop(null);
    rulerGesture = null;
    if (ruler.hasPointerCapture?.(event.pointerId)) ruler.releasePointerCapture(event.pointerId);
  };
  ruler.addEventListener('pointerup', rulerUp); ruler.addEventListener('pointercancel', rulerUp);
  ruler.addEventListener('pointerleave', () => {
    if (hoverSectionBoundary !== null && !rulerGesture) {
      hoverSectionBoundary = null;
      requestDraw();
    }
  });
  ruler.addEventListener('dblclick', event => {
    const r = ruler.getBoundingClientRect(), x = event.clientX - r.left, y = event.clientY - r.top;
    if (y >= RULER_BARS + RULER_LOOP) {
      event.preventDefault();
      const t = tAt(x), a = analysis();
      const idx = findSectionIndexAt(t, a?.sections);
      if (idx >= 0) openSectionMenu(event.clientX, event.clientY, idx, t);
      return;
    }
    ctx.setLoop(null);
  });
  ruler.addEventListener('contextmenu', event => {
    const r = ruler.getBoundingClientRect(), x = event.clientX - r.left, y = event.clientY - r.top;
    if (y >= RULER_BARS + RULER_LOOP) {
      event.preventDefault();
      const t = tAt(x), a = analysis();
      const idx = findSectionIndexAt(t, a?.sections);
      if (idx >= 0) openSectionMenu(event.clientX, event.clientY, idx, t);
    }
  });
  ruler.addEventListener('wheel', event => {
    event.preventDefault();
    if (event.ctrlKey || event.metaKey) {
      const r = ruler.getBoundingClientRect ? ruler.getBoundingClientRect() : { left: 0 };
      const x = event.clientX - (r.left || 0);
      zoomAround(Math.exp(-event.deltaY * .01), tAt(x), x);
    } else {
      const delta = event.shiftKey && !event.deltaX ? event.deltaY : (event.deltaX || event.deltaY);
      state.scrollSec += delta / state.pps;
      clampView();
      requestDraw();
      ctx.onView?.();
    }
  }, { passive: false });

  /* overview */
  let ovGesture = null;
  const ovMove = event => {
    const r = overview.getBoundingClientRect(), d = duration();
    const t = clamp((event.clientX - r.left) / r.width * d, 0, d);
    if (event.shiftKey || (event.buttons === 1 && Math.abs(event.clientX - r.left - (ctx.getTime() / d * r.width)) < 12)) {
      ctx.seek(t, true);
    } else {
      state.scrollSec = t - visibleSec() / 2;
      clampView();
    }
    requestDraw();
    ctx.onView?.();
  };
  overview.addEventListener('pointerdown', event => { ovGesture = true; overview.setPointerCapture(event.pointerId); ovMove(event); });
  overview.addEventListener('pointermove', event => { if (ovGesture) ovMove(event); });
  overview.addEventListener('pointerup', () => {
    ovGesture = null;
    ctx.commitSeek?.();
    requestDraw();
  });
  overview.addEventListener('wheel', event => {
    event.preventDefault();
    if (event.ctrlKey || event.metaKey) {
      zoomAround(Math.exp(-event.deltaY * .01));
    } else {
      const delta = event.shiftKey && !event.deltaX ? event.deltaY : (event.deltaX || event.deltaY);
      state.scrollSec += delta / state.pps;
      clampView();
      requestDraw();
      ctx.onView?.();
    }
  }, { passive: false });

  /* --------------------------------------------------------------- draw */
  function computePeaks() {
    const a = analysis();
    const pcmMono = a?.pcmMono || null;
    if (state.peaksFor === a && state.peaks?.pcmMono === pcmMono) return state.peaks;
    state.peaksFor = a; state.peaks = null;
    const peaks = a?.waveform?.peaks; if (!peaks?.length) return null;
    const len = peaks.length;
    const abs = new Float32Array(len);
    const min = new Float32Array(len);
    const max = new Float32Array(len);
    const rawMin = a.waveform.min;
    const rawMax = a.waveform.max;
    const hasMin = (Array.isArray(rawMin) || ArrayBuffer.isView(rawMin)) && rawMin.length > 0;
    const hasMax = (Array.isArray(rawMax) || ArrayBuffer.isView(rawMax)) && rawMax.length > 0;
    for (let i = 0; i < len; i++) {
      const p = peaks[i];
      if (Array.isArray(p)) {
        const lo = Number(p[0]) || 0, hi = Number(p[1]) || 0;
        const m = Math.max(Math.abs(lo), Math.abs(hi));
        abs[i] = m;
        min[i] = hasMin && rawMin[i] !== undefined ? Number(rawMin[i]) : (lo <= 0 ? lo : -m);
        max[i] = hasMax && rawMax[i] !== undefined ? Number(rawMax[i]) : (hi >= 0 ? hi : m);
      } else {
        const v = Math.abs(Number(p) || 0);
        abs[i] = v;
        min[i] = hasMin && rawMin[i] !== undefined ? Number(rawMin[i]) : -v;
        max[i] = hasMax && rawMax[i] !== undefined ? Number(rawMax[i]) : v;
      }
    }
    const toFloat = arr => ((Array.isArray(arr) || ArrayBuffer.isView(arr)) && arr.length
      ? Float32Array.from(arr, v => Math.abs(Number(v) || 0))
      : null);
    state.peaks = {
      abs,
      min,
      max,
      rms: toFloat(a.waveform.rms),
      low: toFloat(a.waveform.low),
      mid: toFloat(a.waveform.mid),
      high: toFloat(a.waveform.high),
      binSec: a.waveform.binSec || duration() / len,
      pcmMono,
      pcmSampleRate: Number(a.pcmSampleRate) || 44100
    };
    return state.peaks;
  }
  const sizeCanvas = (c, width, height) => {
    const dpr = devicePixelRatio || 1;
    if (c.width !== Math.round(width * dpr) || c.height !== Math.round(height * dpr)) { c.width = Math.round(width * dpr); c.height = Math.round(height * dpr); }
    const g = c.getContext('2d'); g.setTransform?.(dpr, 0, 0, dpr, 0, 0); return g;
  };

  function gridLines(width) {
    const t = tl(), a = analysis(), v0 = state.scrollSec, v1 = v0 + width / state.pps;
    const p0 = Math.floor(beatPosition(v0, t, a)) - 1, p1 = Math.ceil(beatPosition(v1, t, a)) + 1;
    const beatPx = Math.max(1e-6, (timeAtBeat(p0 + 2, t, a) - timeAtBeat(p0 + 1, t, a)) * state.pps);
    const barEvery = [1, 2, 4, 8, 16, 32, 64].find(n => beatPx * 4 * n >= 52) || 128;
    const lines = [];
    const first = Math.floor(p0 / 4) * 4;
    for (let p = first; p <= p1; p++) {
      const isBar = ((p % 4) + 4) % 4 === 0, barIndex = Math.floor(p / 4);
      if (isBar) { if (((barIndex % barEvery) + barEvery) % barEvery === 0) lines.push({ x: xAt(timeAtBeat(p, t, a)), kind: 'bar', label: barIndex + 1 }); else if (beatPx >= 5 && barEvery <= 2) lines.push({ x: xAt(timeAtBeat(p, t, a)), kind: 'beat' }); }
      else if (beatPx >= 14 && barEvery === 1) lines.push({ x: xAt(timeAtBeat(p, t, a)), kind: 'beat' });
      if (beatPx >= 70 && barEvery === 1) for (let s = 1; s < 4; s++) lines.push({ x: xAt(timeAtBeat(p + s / 4, t, a)), kind: 'sub' });
    }
    return lines;
  }

  function drawRuler(width, nowSec = ctx.getTime()) {
    const g = sizeCanvas(ruler, width, RULER_H);
    g.fillStyle = '#10151d'; g.fillRect(0, 0, width, RULER_BARS);
    g.fillStyle = '#0b0f15'; g.fillRect(0, RULER_BARS, width, RULER_LOOP);
    const secY = RULER_BARS + RULER_LOOP;
    g.fillStyle = '#080c12'; g.fillRect(0, secY, width, RULER_SECTIONS);
    g.font = '600 10px ui-monospace, SFMono-Regular, Menlo, monospace'; g.textBaseline = 'middle';
    for (const line of gridLines(width)) {
      if (line.kind === 'bar') { g.fillStyle = '#4a5a6c'; g.fillRect(Math.round(line.x), 2, 1, RULER_BARS - 2); g.fillStyle = '#b8c6d4'; g.fillText(String(line.label), line.x + 4, 8); }
      else if (line.kind === 'beat') { g.fillStyle = '#34414f'; g.fillRect(Math.round(line.x), RULER_BARS - 6, 1, 6); }
      else { g.fillStyle = '#26303b'; g.fillRect(Math.round(line.x), RULER_BARS - 3, 1, 3); }
    }
    const loop = ctx.getLoop();
    if (loop) {
      const a = xAt(loop.start), b = xAt(loop.end);
      g.fillStyle = ctx.isLoopOn() ? '#f5a524cc' : '#5c6773aa'; g.fillRect(a, RULER_BARS + 1, Math.max(2, b - a), RULER_LOOP - 2);
      g.fillStyle = '#ffffffcc'; g.fillRect(a, RULER_BARS, 2, RULER_LOOP); g.fillRect(b - 2, RULER_BARS, 2, RULER_LOOP);
    } else { g.fillStyle = '#44505c'; g.font = '9px system-ui'; g.fillText('povuci za loop', 6, RULER_BARS + RULER_LOOP / 2 + .5); }

    // macro sections
    g.fillStyle = '#05080c'; g.fillRect(0, secY - 1, width, 1);
    const a = analysis();
    if (a?.sections?.length) {
      g.font = '700 9px system-ui, -apple-system, sans-serif';
      a.sections.forEach((s, idx) => {
        const x0 = xAt(s.startSec), x1 = xAt(s.endSec);
        if (x1 < 0 || x0 > width) return;
        const drawX0 = Math.max(0, x0), drawX1 = Math.min(width, x1), w = drawX1 - drawX0;
        if (w < 2) return;
        g.fillStyle = `${s.color}38`;
        g.fillRect(drawX0, secY, w, RULER_SECTIONS - 1);
        g.fillStyle = s.color;
        g.fillRect(drawX0, secY, w, 2);
        if (x0 >= 0 && idx >= 1) {
          const isActiveDiv = hoverSectionBoundary === idx || (rulerGesture?.mode === 'section-drag' && rulerGesture.index === idx);
          g.fillStyle = isActiveDiv ? '#ffd36b' : `${s.color}cc`;
          g.fillRect(Math.round(x0) - (isActiveDiv ? 1 : 0), secY, isActiveDiv ? 2 : 1, RULER_SECTIONS);
          if (w > 14 || isActiveDiv) {
            g.fillStyle = isActiveDiv ? '#ffd36b' : '#ffffff88';
            const hx = Math.round(x0);
            g.fillRect(hx - 1, secY + 5, 2, 2);
            g.fillRect(hx - 1, secY + 9, 2, 2);
            g.fillRect(hx - 1, secY + 13, 2, 2);
          }
        }
        if (w > 20) {
          g.save();
          g.beginPath();
          g.rect?.(drawX0 + 4, secY, Math.max(0, w - 8), RULER_SECTIONS);
          g.clip?.();
          g.fillStyle = '#e4edf7';
          const label = w > 72 ? `${s.name.toUpperCase()} · ${s.durationSec.toFixed(0)}s ▾` : s.name.toUpperCase();
          g.fillText(label, drawX0 + 5, secY + RULER_SECTIONS / 2 + .5);
          g.restore();
        }
      });
    } else {
      g.fillStyle = '#3a4654'; g.font = '9px system-ui';
      g.fillText(ctx.hasTrack() ? 'analiza dionica…' : 'dionice pjesme', 6, secY + RULER_SECTIONS / 2 + .5);
    }

    g.fillStyle = '#05080c'; g.fillRect(0, RULER_H - 1, width, 1);
    const px = Math.round(xAt(nowSec));
    if (px >= -10 && px <= width + 10) {
      const isScrub = state.gesture?.mode === 'scrub' || rulerGesture?.mode === 'seek';
      if (isScrub) {
        g.fillStyle = 'rgba(255, 211, 107, 0.3)';
        g.beginPath();
        g.moveTo(px - 9, 0); g.lineTo(px + 9, 0); g.lineTo(px, 14);
        g.closePath?.();
        g.fill();
        g.fillRect(px - 3.5, 0, 7, RULER_H);
      }
      g.fillStyle = '#ffd36b';
      g.beginPath();
      g.moveTo(px - 6, 0);
      g.lineTo(px + 6, 0);
      g.lineTo(px, 11);
      g.closePath?.();
      g.fill();
      g.fillRect(px - .5, 0, 1.5, RULER_H);
    }
  }

  function catmullRom(p0, p1, p2, p3, t) {
    const t2 = t * t, t3 = t2 * t;
    return 0.5 * (
      (2 * p1) +
      (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t3
    );
  }

  function sampleCubic(arr, fIdx) {
    if (!arr || !arr.length) return 0;
    const len = arr.length;
    const i1 = clamp(Math.floor(fIdx), 0, len - 1);
    const t = clamp(fIdx - i1, 0, 1);
    const i0 = Math.max(0, i1 - 1);
    const i2 = Math.min(len - 1, i1 + 1);
    const i3 = Math.min(len - 1, i1 + 2);
    return catmullRom(arr[i0], arr[i1], arr[i2], arr[i3], t);
  }

  function spectralRgba(lowVal, midVal, highVal, alpha = 0.75) {
    const l = Math.max(0, lowVal), m = Math.max(0, midVal), h = Math.max(0, highVal);
    const sum = l + m + h;
    if (sum <= 1e-5) return `rgba(56, 189, 248, ${alpha})`;
    const wl = l / sum, wm = m / sum, wh = h / sum;
    // Bass: warm magenta/electric blue (#a855f7 / #3b82f6 -> ~[145, 92, 246])
    // Mid: vibrant cyan/teal (#06b6d4 / #38bdf8 -> ~[20, 186, 232])
    // High: crisp ice-white/aqua (#bae6fd / #e0f2fe -> ~[205, 236, 254])
    const r = Math.round(clamp(wl * 152 + wm * 18 + wh * 208, 0, 255));
    const gg = Math.round(clamp(wl * 88 + wm * 186 + wh * 238, 0, 255));
    const b = Math.round(clamp(wl * 246 + wm * 232 + wh * 254, 0, 255));
    return `rgba(${r}, ${gg}, ${b}, ${alpha})`;
  }

  function drawWave(g, width, y, height) {
    const peaks = computePeaks();
    g.fillStyle = '#0c1118'; g.fillRect(0, y, width, height);
    const mid = y + height / 2, amp = height / 2 - 4;
    if (!peaks) {
      g.fillStyle = '#5b6978'; g.font = '12px system-ui';
      g.fillText(ctx.hasTrack() ? 'Analiza waveforma traje…' : 'Povuci MP3/WAV u prozor ili u biblioteku', 16, mid + 4);
      return;
    }
    const { abs, min, max, rms, low, mid: midBand, high, binSec, pcmMono, pcmSampleRate } = peaks;
    const perPx = 1 / state.pps / binSec;
    const hasSpectral = Boolean(low && midBand && high && low.length && midBand.length && high.length);
    let fallbackFill = 'rgba(56, 189, 248, 0.75)';
    if (!hasSpectral && g.createLinearGradient) {
      const grad = g.createLinearGradient(0, y, 0, y + height);
      grad.addColorStop(0, 'rgba(89, 212, 255, 0.78)');
      grad.addColorStop(0.5, 'rgba(42, 143, 208, 0.75)');
      grad.addColorStop(1, 'rgba(89, 212, 255, 0.78)');
      fallbackFill = grad;
    }

    const wInt = Math.max(0, Math.floor(width));
    const topY = new Float32Array(wInt);
    const botY = new Float32Array(wInt);
    const rmsVals = new Float32Array(wInt);
    let validCount = 0;

    for (let x = 0; x < wInt; x++) {
      const t0 = state.scrollSec + x / state.pps;
      const t1 = state.scrollSec + (x + 1) / state.pps;
      const fIdx = t0 / binSec;
      if (fIdx >= abs.length) break;

      let minVal = 0, maxVal = 0, rVal = 0;
      let lVal = 0, mVal = 0, hVal = 0;

      if (perPx < 1.2) {
        if (pcmMono && pcmMono.length && pcmSampleRate > 0) {
          const s0 = clamp(Math.floor(t0 * pcmSampleRate), 0, pcmMono.length - 1);
          const s1 = clamp(Math.floor(t1 * pcmSampleRate), s0, pcmMono.length - 1);
          if (s1 > s0 + 1) {
            let lo = 1, hi = -1, sumSq = 0, count = 0;
            const span = s1 - s0;
            const step = span > 64 ? Math.max(1, span >> 5) : 1;
            for (let s = s0; s <= s1; s += step) {
              const v = pcmMono[s];
              if (v < lo) lo = v;
              if (v > hi) hi = v;
              sumSq += v * v;
              count++;
            }
            minVal = Math.min(0, lo);
            maxVal = Math.max(0, hi);
            rVal = Math.sqrt(sumSq / Math.max(1, count));
          } else {
            const v = sampleCubic(pcmMono, t0 * pcmSampleRate);
            const env = Math.abs(sampleCubic(abs, fIdx));
            minVal = Math.min(-env * 0.35, v);
            maxVal = Math.max(env * 0.35, v);
            rVal = rms ? Math.max(0, sampleCubic(rms, fIdx)) : Math.abs(v) * 0.7;
          }
        } else {
          minVal = Math.min(0, sampleCubic(min, fIdx));
          maxVal = Math.max(0, sampleCubic(max, fIdx));
          rVal = rms ? Math.max(0, sampleCubic(rms, fIdx)) : 0;
        }
        if (hasSpectral) {
          lVal = Math.max(0, sampleCubic(low, fIdx));
          mVal = Math.max(0, sampleCubic(midBand, fIdx));
          hVal = Math.max(0, sampleCubic(high, fIdx));
        }
      } else {
        const i0 = Math.max(0, Math.floor(fIdx));
        const i1 = Math.min(abs.length - 1, Math.max(i0, Math.floor(fIdx + perPx)));
        let lo = 0, hi = 0, rm = 0;
        for (let i = i0; i <= i1; i++) {
          if (min[i] < lo) lo = min[i];
          if (max[i] > hi) hi = max[i];
          if (rms && i < rms.length && rms[i] > rm) rm = rms[i];
          if (hasSpectral) {
            if (i < low.length && low[i] > lVal) lVal = low[i];
            if (i < midBand.length && midBand[i] > mVal) mVal = midBand[i];
            if (i < high.length && high[i] > hVal) hVal = high[i];
          }
        }
        minVal = lo;
        maxVal = hi;
        rVal = rm;
      }

      const y1 = mid + clamp(minVal, -1, 1) * amp;
      const y2 = mid + clamp(maxVal, -1, 1) * amp;
      let yTop = Math.min(y1, y2, mid - 0.5);
      let yBot = Math.max(y1, y2, mid + 0.5);
      topY[x] = yTop;
      botY[x] = yBot;
      rmsVals[x] = clamp(rVal, 0, 1);
      validCount = x + 1;

      g.fillStyle = hasSpectral ? spectralRgba(lVal, mVal, hVal, 0.75) : fallbackFill;
      g.fillRect(x, yTop, 1, Math.max(1, yBot - yTop));
    }

    if (rms || pcmMono) {
      g.fillStyle = '#e0f7ffcc';
      for (let x = 0; x < validCount; x++) {
        const rAmp = rmsVals[x] * amp;
        if (rAmp > 0.45) {
          const ry0 = Math.max(topY[x], mid - rAmp);
          const ry1 = Math.min(botY[x], mid + rAmp);
          if (ry1 > ry0) g.fillRect(x, ry0, 1, ry1 - ry0);
        }
      }
    }

    if (validCount > 1) {
      g.save();
      g.strokeStyle = hasSpectral ? 'rgba(186, 230, 253, 0.88)' : 'rgba(89, 212, 255, 0.88)';
      g.lineWidth = 1;
      g.beginPath();
      for (let x = 0; x < validCount; x++) {
        if (x === 0) g.moveTo(x, topY[x]);
        else g.lineTo(x, topY[x]);
      }
      for (let x = 0; x < validCount; x++) {
        if (x === 0) g.moveTo(x, botY[x]);
        else g.lineTo(x, botY[x]);
      }
      g.stroke();
      g.restore();
    }

    g.fillStyle = '#ffffff14'; g.fillRect(0, mid, width, 1);
  }

  function drawFeature(g, width, y, height, samples, color, features) {
    g.fillStyle = color;
    const hop = features.hopSec || .05, start = features.startSec || 0;
    for (let x = 0; x < width; x++) {
      const i0 = Math.max(0, Math.floor((state.scrollSec + x / state.pps - start) / hop)), i1 = Math.min(samples.length - 1, Math.max(i0, Math.floor(i0 + 1 / state.pps / hop)));
      if (i0 >= samples.length) break;
      let m = 0; for (let i = i0; i <= i1; i++) if (samples[i] > m) m = samples[i];
      const a = clamp(m, 0, 1) * (height - 2); if (a > .3) g.fillRect(x, y + height - a, 1, a);
    }
  }

  const clipCurveCache = new WeakMap();
  function getClipCurves(clip, a, steps) {
    const n = Math.max(2, steps);
    const ks = clip.keyframes || [];
    let kfHash = ks.length;
    for (let i = 0; i < ks.length; i++) {
      const k = ks[i];
      kfHash = (kfHash * 31 + Math.round(k.timeSec * 1000) + Math.round(k.value * 1000) + (k.ease ? k.ease.charCodeAt(0) : 0)) | 0;
    }
    const b = clip.band;
    const bandHash = b
      ? `${b.source || 'm'}:${b.lowHz}:${b.highHz}:${b.threshold}:${b.ceiling}:${b.mode}:${b.releaseSec}`
      : '';
    const hasSp = Boolean(a?.spectrum);
    const hasFt = Boolean(a?.features);
    const key = `${n}|${clip.startSec.toFixed(3)}|${clip.durationSec.toFixed(3)}|${clip.driver}|${clip.driverGain ?? 1}|${kfHash}|${bandHash}|${hasSp ? 1 : 0}|${hasFt ? 1 : 0}`;
    const cached = clipCurveCache.get(clip);
    if (cached && cached.key === key && cached.analysis === a) return cached;

    const env = new Float32Array(n);
    const drv = new Float32Array(n);
    const strength = new Float32Array(n);
    const hasDriver = Boolean(clip.driver && clip.driver !== 'none');
    const gain = clip.driverGain ?? 1;
    const span = Math.max(1, n - 1);
    for (let i = 0; i < n; i++) {
      const localT = (i / span) * clip.durationSec;
      const t = clip.startSec + localT;
      const e = envelopeAt(ks, localT);
      const d = hasDriver ? clamp(driverLevel(a, clip, t) * gain) : 1;
      env[i] = e;
      drv[i] = d;
      strength[i] = clamp(e * d);
    }
    const entry = { key, analysis: a, env, drv, strength, n };
    clipCurveCache.set(clip, entry);
    return entry;
  }

  function drawClip(g, layer, layerIndex, clip, curTime = ctx.getTime()) {
    const r = clipRect(layerIndex, clip); if (r.x + r.w < -2 || r.x > canvas.clientWidth + 2) return;
    const rgb = clipUiColor(clip.color), css = a => `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`;
    const selected = isSelected({ layerId: layer.id, clipId: clip.id });
    const dim = layer.enabled ? 1 : .38, solo = state.solo.size && !state.solo.has(layer.id) ? .38 : 1, alpha = dim * solo;
    const expanded = isLayerExpanded(layer.id);
    const radius = 4;
    const a = analysis();

    g.save();
    g.globalAlpha = alpha;

    // In closed pill mode: calculate live LED driving glow without expensive Gaussian shadowBlur
    if (!expanded) {
      const inLiveWindow = curTime >= clip.startSec && curTime <= clip.startSec + clip.durationSec;
      if (layer.enabled && inLiveWindow) {
        const localNow = curTime - clip.startSec;
        const envNow = envelopeAt(clip.keyframes, localNow);
        const drvNow = clip.driver === 'none' ? 1 : Math.min(1, driverLevel(a, clip, curTime) * (clip.driverGain ?? 1));
        const liveStrength = clamp(layer.opacity * envNow * drvNow);
        if (liveStrength > 0.02) {
          g.save();
          g.beginPath();
          g.roundRect(r.x - 1, r.y - 1, r.w + 2, r.h + 2, radius + 2);
          g.strokeStyle = css(0.28 * liveStrength);
          g.lineWidth = 5;
          g.stroke();

          g.beginPath();
          g.roundRect(r.x, r.y, r.w, r.h, radius);
          g.strokeStyle = css(0.85 * liveStrength);
          g.lineWidth = 1.5;
          g.stroke();

          const curPx = xAt(curTime);
          if (curPx >= r.x && curPx <= r.x + r.w && g.createRadialGradient) {
            const pulse = g.createRadialGradient(curPx, r.y + r.h / 2, 2, curPx, r.y + r.h / 2, Math.max(25, r.w * 0.35));
            pulse.addColorStop(0, `rgba(255, 255, 255, ${0.32 * liveStrength})`);
            pulse.addColorStop(0.5, css(0.2 * liveStrength));
            pulse.addColorStop(1, 'rgba(0,0,0,0)');
            g.fillStyle = pulse;
            g.beginPath();
            g.roundRect(r.x, r.y, r.w, r.h, radius);
            g.fill();
          }
          g.restore();
        }
      }
    }

    const headH = expanded ? 20 : Math.min(15, r.h * .3);
    g.beginPath(); g.roundRect(r.x, r.y, r.w, r.h, radius);
    g.fillStyle = expanded ? 'rgba(12, 17, 25, 0.94)' : css(.2);
    g.fill();

    g.save(); g.clip();

    const stepPx = Math.max(2, Math.min(4, Math.floor(r.w / 90)));
    const sampleCount = Math.max(2, Math.min(240, Math.ceil(r.w / stepPx) + 1));
    const curves = getClipCurves(clip, a, sampleCount);

    if (expanded) {
      // EXPANDED MODE: full automation workspace
      const autoY = r.y + headH, autoH = r.h - headH - 2;

      // Value grid lines (0%, 25%, 50%, 75%, 100%)
      const gridLevels = [
        { v: 1.0, y: autoY + 2 },
        { v: 0.75, y: autoY + autoH * 0.25 },
        { v: 0.5, y: autoY + autoH * 0.5 },
        { v: 0.25, y: autoY + autoH * 0.75 },
        { v: 0.0, y: autoY + autoH - 1 }
      ];
      g.strokeStyle = '#ffffff10';
      g.lineWidth = 1;
      for (const line of gridLevels) {
        g.beginPath();
        g.moveTo(r.x, line.y);
        g.lineTo(r.x + r.w, line.y);
        g.stroke();
      }
      if (r.w > 70) {
        g.fillStyle = '#ffffff35';
        g.font = '8px ui-monospace,Menlo,monospace';
        g.textBaseline = 'bottom';
        g.fillText('100%', r.x + 4, autoY + 11);
        g.textBaseline = 'middle';
        g.fillText('50%', r.x + 4, autoY + autoH * 0.5);
        g.textBaseline = 'top';
        g.fillText('0%', r.x + 4, autoY + autoH - 10);
      }

      // 1. Audio Driver Overlay beneath envelope
      if (clip.driver && clip.driver !== 'none') {
        const drvSrc = clip.driver === 'band' ? (clip.band?.source || 'master') : clip.driver;
        const drvColors = {
          drums: 'rgba(255, 154, 58, 0.42)',
          bass: 'rgba(178, 92, 255, 0.42)',
          vocals: 'rgba(55, 212, 255, 0.42)',
          other: 'rgba(89, 255, 155, 0.42)',
          master: 'rgba(255, 215, 138, 0.38)',
          band: 'rgba(47, 213, 199, 0.42)'
        };
        const drvColor = drvColors[drvSrc] || drvColors.master;
        g.fillStyle = drvColor;
        const barW = Math.max(1, r.w / Math.max(1, curves.n - 1));
        for (let i = 0; i < curves.n; i++) {
          const drvVal = curves.drv[i];
          if (drvVal > 0.01) {
            const px = (i / Math.max(1, curves.n - 1)) * r.w;
            const barH = drvVal * (autoH - 4);
            g.fillRect(r.x + px, autoY + autoH - barH, Math.ceil(barW), barH);
          }
        }
      }

      // 2. Eased Envelope Curve & Filled area
      const ks = clip.keyframes;
      g.beginPath();
      g.moveTo(r.x, autoY + autoH);
      for (let i = 0; i < curves.n; i++) {
        const px = (i / Math.max(1, curves.n - 1)) * r.w;
        const cy = autoY + autoH * (1 - curves.env[i]);
        g.lineTo(r.x + px, cy);
      }
      g.lineTo(r.x + r.w, autoY + autoH);
      g.closePath();
      g.fillStyle = css(.32);
      g.fill();

      // Stroke envelope curve
      g.beginPath();
      for (let i = 0; i < curves.n; i++) {
        const px = (i / Math.max(1, curves.n - 1)) * r.w;
        const cy = autoY + autoH * (1 - curves.env[i]);
        if (i === 0) g.moveTo(r.x, cy);
        else g.lineTo(r.x + px, cy);
      }
      g.strokeStyle = css(.95);
      g.lineWidth = 2;
      g.stroke();

      // 3. Keyframe Markers & Ease Indicators
      for (let ki = 0; ki < ks.length; ki++) {
        const k = ks[ki];
        const kx = r.x + (k.timeSec / clip.durationSec) * r.w;
        const ky = autoY + autoH * (1 - k.value);
        const isSel = state.selectedKeyframe?.index === ki && refKey(state.selectedKeyframe.ref) === refKey({ layerId: layer.id, clipId: clip.id });
        const isEased = k.ease && k.ease !== 'linear';

        if (isSel) {
          g.beginPath();
          g.arc(kx, ky, 7, 0, Math.PI * 2);
          g.fillStyle = 'rgba(255, 255, 255, 0.35)';
          g.fill();
          g.strokeStyle = '#ffd78a';
          g.lineWidth = 1.8;
          g.stroke();
        }

        if (isEased) {
          g.fillStyle = isSel ? '#fff' : '#ffd78a';
          g.beginPath();
          g.moveTo(kx - 4.5, ky - 4.5);
          g.lineTo(kx + 4.5, ky - 4.5);
          g.lineTo(kx, ky);
          g.lineTo(kx + 4.5, ky + 4.5);
          g.lineTo(kx - 4.5, ky + 4.5);
          g.lineTo(kx, ky);
          g.closePath();
          g.fill();
          g.strokeStyle = '#10161f';
          g.lineWidth = 1;
          g.stroke();
        } else {
          g.fillStyle = isSel ? '#fff' : css(1);
          g.beginPath();
          g.moveTo(kx, ky - 4.5);
          g.lineTo(kx + 4.5, ky);
          g.lineTo(kx, ky + 4.5);
          g.lineTo(kx - 4.5, ky);
          g.closePath();
          g.fill();
          g.strokeStyle = '#10161f';
          g.lineWidth = 1;
          g.stroke();
        }
      }

      // Clip Top Header Bar
      g.fillStyle = css(selected ? 1 : .88);
      g.fillRect(r.x, r.y, r.w, headH);

    } else {
      // CLOSED / COMPACT PILL MODE: high-detail output strength graph
      const bodyY = r.y + headH, bodyH = r.h - headH - 2;
      const ks = clip.keyframes;
      const hasDriver = clip.driver && clip.driver !== 'none';

      // High-detail output strength fill: S(t) = envelopeAt(t) * driverLevel(t)
      g.beginPath();
      g.moveTo(r.x, bodyY + bodyH);
      for (let i = 0; i < curves.n; i++) {
        const px = (i / Math.max(1, curves.n - 1)) * r.w;
        const sy = bodyY + bodyH * (1 - curves.strength[i]);
        g.lineTo(r.x + px, sy);
      }
      g.lineTo(r.x + r.w, bodyY + bodyH);
      g.closePath();
      if (g.createLinearGradient) {
        const grad = g.createLinearGradient(r.x, bodyY, r.x, bodyY + bodyH);
        grad.addColorStop(0, css(.55));
        grad.addColorStop(1, css(.22));
        g.fillStyle = grad;
      } else {
        g.fillStyle = css(.38);
      }
      g.fill();

      // Output strength contour line
      g.beginPath();
      for (let i = 0; i < curves.n; i++) {
        const px = (i / Math.max(1, curves.n - 1)) * r.w;
        const sy = bodyY + bodyH * (1 - curves.strength[i]);
        if (i === 0) g.moveTo(r.x, sy);
        else g.lineTo(r.x + px, sy);
      }
      g.strokeStyle = css(.95);
      g.lineWidth = 1.4;
      g.stroke();

      // Faint ceiling envelope line if driver is modulating
      if (hasDriver) {
        g.beginPath();
        for (let i = 0; i < curves.n; i++) {
          const px = (i / Math.max(1, curves.n - 1)) * r.w;
          const ey = bodyY + bodyH * (1 - curves.env[i]);
          if (i === 0) g.moveTo(r.x, ey);
          else g.lineTo(r.x + px, ey);
        }
        g.strokeStyle = css(.35);
        g.setLineDash([2, 2]);
        g.lineWidth = 1;
        g.stroke();
        g.setLineDash([]);
      }

      // Small keyframe dots if space permits
      if (r.w > 60 && r.h >= 45) {
        g.fillStyle = css(1);
        for (const k of ks) {
          const kx = r.x + (k.timeSec / clip.durationSec) * r.w;
          const ky = bodyY + bodyH * (1 - k.value);
          g.beginPath();
          g.arc(kx, ky, 2.2, 0, 7);
          g.fill();
        }
      }

      // Clip Top Header Bar
      g.fillStyle = css(selected ? 1 : .88);
      g.fillRect(r.x, r.y, r.w, headH);
    }

    g.restore(); // restore clip

    // Header label text
    const light = (rgb[0] * .299 + rgb[1] * .587 + rgb[2] * .114) > 150;
    g.fillStyle = light ? '#111' : '#fff';
    g.font = '700 9.5px system-ui';
    g.textBaseline = 'middle';
    const speedTag = (clip.speed && Math.abs(clip.speed - 1) > 0.05) ? ` · ${clip.speed}×` : '';
    const drvSrc = clip.driver === 'band' ? (clip.band?.source || 'master') : clip.driver;
    const drvTag = clip.driver && clip.driver !== 'none'
      ? ` · ${clip.driver === 'band' ? (drvSrc !== 'master' ? `${DRIVER_LABELS[drvSrc] || drvSrc} EQ` : 'EQ') : (DRIVER_LABELS[clip.driver] || clip.driver)}`
      : '';
    const label = `${PRESET_LABELS[clip.preset] || clip.preset}${speedTag}${drvTag}${clip.targets !== 'all' ? ` · ${clip.targets.length}/9` : ''}`;
    if (r.w > 26) {
      g.save();
      g.beginPath();
      g.rect(r.x + 3, r.y, Math.max(0, r.w - 6), headH);
      g.clip();
      g.fillText(label, r.x + 5, r.y + headH / 2 + .5);
      g.restore();
    }

    // Border and selection handles
    g.beginPath();
    g.roundRect(r.x + .5, r.y + .5, r.w - 1, r.h - 1, radius);
    g.lineWidth = selected ? 2 : (clip.recording ? 1.8 : 1);
    g.strokeStyle = selected ? '#fff' : (clip.recording ? '#ff4d4d' : css(.55));
    g.stroke();
    if (clip.recording) {
      const pulse = 0.4 + 0.6 * Math.sin(performance.now() * 0.009);
      g.fillStyle = `rgba(255, 60, 60, ${pulse})`;
      g.beginPath();
      g.arc(r.x + 7, r.y + headH / 2, 3, 0, Math.PI * 2);
      g.fill();
    }
    if (selected && r.w > 18) {
      g.fillStyle = '#ffffffcc';
      g.fillRect(r.x + 1, r.y + r.h / 2 - 8, 3, 16);
      g.fillRect(r.x + r.w - 4, r.y + r.h / 2 - 8, 3, 16);
    }
    g.restore();
  }

  function drawShiftMoveGuide(g, width, height, t) {
    const gest = state.gesture;
    if (!gest?.items?.length) return;
    const lineTop = layersTop();
    const lineBottom = Math.max(height, layerTop(t.layers.length) + (gest.createdLayerId ? 0 : laneH()));

    // 1. Origin footprints for clips that moved to a different track
    for (const item of gest.items) {
      const originLane = item.layerIndex;
      const currentLane = item.layerIndex + (gest.dl ?? 0);
      if (originLane !== currentLane && originLane >= 0 && originLane < t.layers.length) {
        const ox = Math.round(xAt(item.startSec));
        const ow = Math.round((item.endSec - item.startSec) * state.pps);
        const oy = layerTop(originLane) + 2;
        const oh = layerHeight(originLane) - 4;
        if (ox + ow >= 0 && ox <= width) {
          g.save();
          g.fillStyle = 'rgba(56, 189, 248, 0.08)';
          g.strokeStyle = 'rgba(56, 189, 248, 0.6)';
          g.lineWidth = 1.5;
          g.setLineDash([4, 3]);
          g.beginPath();
          g.roundRect(ox + 0.5, oy + 0.5, Math.max(3, ow - 1), oh - 1, 4);
          g.fill();
          g.stroke();
          if (ow > 50) {
            g.fillStyle = 'rgba(56, 189, 248, 0.7)';
            g.font = '600 9px ui-monospace, Menlo, sans-serif';
            g.textBaseline = 'middle';
            g.fillText('Izvorna pozicija', ox + 6, oy + oh / 2);
          }
          g.restore();
        }
      }
    }

    // 2. Vertical guide lines at unique startSec and endSec
    const starts = [...new Set(gest.items.map(i => i.startSec))];
    const ends = [...new Set(gest.items.map(i => i.endSec))];

    for (const sxSec of starts) {
      const sx = Math.round(xAt(sxSec));
      if (sx < -10 || sx > width + 10) continue;
      g.save();
      // Glow
      g.fillStyle = 'rgba(56, 189, 248, 0.16)';
      g.fillRect(sx - 2, lineTop, 5, lineBottom - lineTop);

      // Main vertical snap guide line
      g.strokeStyle = '#38bdf8';
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(sx + 0.5, lineTop);
      g.lineTo(sx + 0.5, lineBottom);
      g.stroke();

      // Top notch / downward arrow
      g.fillStyle = '#38bdf8';
      g.beginPath();
      g.moveTo(sx - 4.5, lineTop);
      g.lineTo(sx + 5.5, lineTop);
      g.lineTo(sx + 0.5, lineTop + 6);
      g.closePath();
      g.fill();

      // Bottom notch / upward arrow
      g.beginPath();
      g.moveTo(sx - 4.5, lineBottom);
      g.lineTo(sx + 5.5, lineBottom);
      g.lineTo(sx + 0.5, lineBottom - 6);
      g.closePath();
      g.fill();
      g.restore();
    }

    for (const exSec of ends) {
      const ex = Math.round(xAt(exSec));
      if (ex < -10 || ex > width + 10) continue;
      g.save();
      g.fillStyle = 'rgba(56, 189, 248, 0.08)';
      g.fillRect(ex - 1.5, lineTop, 3, lineBottom - lineTop);

      g.strokeStyle = 'rgba(56, 189, 248, 0.7)';
      g.lineWidth = 1;
      g.setLineDash([3, 3]);
      g.beginPath();
      g.moveTo(ex + 0.5, lineTop);
      g.lineTo(ex + 0.5, lineBottom);
      g.stroke();
      g.restore();
    }

    // 3. Floating alignment badge
    const mainStart = gest.anchor?.startSec ?? gest.items[0]?.startSec;
    if (mainStart !== undefined) {
      const mx = Math.round(xAt(mainStart));
      if (mx >= -10 && mx <= width + 10) {
        g.save();
        const badgeText = '⇧ VERTIKALNO ZAKLJUČANO';
        g.font = '700 9px ui-monospace, Menlo, sans-serif';
        const textW = g.measureText(badgeText).width;
        const pad = 7;
        const bw = textW + pad * 2;
        const bh = 18;
        const bx = clamp(mx - bw / 2, 8, width - bw - 8);
        const by = lineTop + 5;
        g.fillStyle = '#081524f0';
        g.strokeStyle = '#38bdf8';
        g.lineWidth = 1;
        g.beginPath();
        g.roundRect(bx, by, bw, bh, 3);
        g.fill();
        g.stroke();

        g.fillStyle = '#38bdf8';
        g.textBaseline = 'middle';
        g.fillText(badgeText, bx + pad, by + bh / 2 + 0.5);
        g.restore();
      }
    }
  }

  function draw() {
    const height = bodyHeight(), t = tl(), a = analysis(), nowSec = ctx.getTime();
    stageHeightSync(height);
    syncScrollbarGutter();
    const width = stageWidth();
    const g = sizeCanvas(canvas, width, height);
    g.fillStyle = '#0d1219'; g.fillRect(0, 0, width, height);
    // lane backgrounds
    t.layers.forEach((layer, i) => {
      const lh = layerHeight(i);
      g.fillStyle = i === ctx.getActiveLayerIndex() ? '#151d29' : i % 2 ? '#10161f' : '#121923';
      g.fillRect(0, layerTop(i), width, lh);
      g.fillStyle = '#05080c';
      g.fillRect(0, layerTop(i) + lh - 1, width, 1);
    });

    // Prospective new track drop guide when moving clips or dragging presets
    const isMovingClip = state.gesture?.mode === 'move';
    const isDragPreset = Boolean(state.ghost && state.ghost.tool === 'draw' && state.ghost.layerIndex >= t.layers.length);
    const baseCount = state.gesture?.baseLayerCount ?? t.layers.length;
    if ((isMovingClip && !state.gesture?.createdLayerId) || isDragPreset) {
      const prospectiveY = layerTop(baseCount);
      const prospectiveH = laneH();
      g.save();
      g.strokeStyle = 'rgba(255, 211, 107, 0.35)';
      g.setLineDash([5, 4]);
      g.strokeRect(8.5, prospectiveY + 4.5, width - 17, prospectiveH - 9);
      g.setLineDash([]);
      g.fillStyle = 'rgba(255, 211, 107, 0.03)';
      g.fillRect(9, prospectiveY + 5, width - 18, prospectiveH - 10);
      g.fillStyle = 'rgba(255, 211, 107, 0.45)';
      g.font = '600 11px ui-monospace, Menlo, sans-serif';
      g.textBaseline = 'middle';
      g.fillText('+ NOVA TRAKA (povuci ovdje)', 22, prospectiveY + prospectiveH / 2);
      g.restore();
    }
    if (isMovingClip && state.gesture?.createdLayerId) {
      const newLayerIndex = t.layers.findIndex(l => l.id === state.gesture.createdLayerId);
      if (newLayerIndex >= 0) {
        const ny = layerTop(newLayerIndex);
        const nh = layerHeight(newLayerIndex);
        g.save();
        g.fillStyle = 'rgba(255, 211, 107, 0.16)';
        g.font = '600 10px ui-monospace, Menlo, sans-serif';
        g.textBaseline = 'middle';
        g.fillText('+ NOVA TRAKA', 16, ny + nh / 2);
        g.restore();
      }
    }
    drawWave(g, width, 0, AUDIO_H);
    g.fillStyle = '#0a0e14'; g.fillRect(0, AUDIO_H, width, ANALYSIS_H);
    if (a?.features) {
      const stems = [
        { data: a.stems?.drums || a.features.drums, color: '#ff9a3acc' },
        { data: a.stems?.bass || a.features.bass, color: '#b25cffcc' },
        { data: a.stems?.vocals || a.features.vocals, color: '#37d4ffcc' },
        { data: a.stems?.other || a.features.other, color: '#59ff9bcc' }
      ];
      const hEach = Math.floor((ANALYSIS_H - 3) / 4);
      stems.forEach((stem, idx) => {
        if (stem.data) {
          const sy = AUDIO_H + idx * (hEach + 1);
          drawFeature(g, width, sy, hEach, stem.data, stem.color, a.features);
          if (idx < 3) { g.fillStyle = '#ffffff0a'; g.fillRect(0, sy + hEach, width, 1); }
        }
      });
    }
    g.fillStyle = '#05080c'; g.fillRect(0, AUDIO_H - 1, width, 1); g.fillRect(0, layersTop() - 1, width, 1);
    // grid
    for (const line of gridLines(width)) {
      g.fillStyle = line.kind === 'bar' ? '#ffffff20' : line.kind === 'beat' ? '#ffffff0d' : '#ffffff06';
      g.fillRect(Math.round(line.x), 0, 1, height);
    }
    // beyond song end
    const endX = xAt(duration());
    if (endX < width) { g.fillStyle = '#00000088'; g.fillRect(Math.max(0, endX), 0, width, height); g.fillStyle = '#f5a52477'; g.fillRect(endX, 0, 1, height); }
    // loop
    const loop = ctx.getLoop();
    if (loop) { g.fillStyle = ctx.isLoopOn() ? '#f5a52418' : '#8a97a418'; g.fillRect(xAt(loop.start), 0, xAt(loop.end) - xAt(loop.start), height); }
    t.layers.forEach((layer, i) => layer.clips.forEach(clip => drawClip(g, layer, i, clip, nowSec)));
    if (state.gesture?.mode === 'move' && state.gesture?.shiftLock && state.gesture?.moved) {
      drawShiftMoveGuide(g, width, height, t);
    }
    // ghost
    if (state.ghost && state.ghost.layerIndex >= 0) {
      const gx = xAt(state.ghost.t);
      const isNew = state.ghost.layerIndex >= t.layers.length;
      const glh = isNew ? laneH() : layerHeight(state.ghost.layerIndex);
      const gy = isNew ? layerTop(t.layers.length) : layerTop(state.ghost.layerIndex);
      if (state.ghost.tool === 'slice') {
        g.strokeStyle = '#ffd36b'; g.setLineDash([4, 3]); g.beginPath(); g.moveTo(gx + .5, gy); g.lineTo(gx + .5, gy + glh); g.stroke(); g.setLineDash([]);
      } else {
        g.fillStyle = '#ffffff22'; g.fillRect(gx, gy + 4, Math.max(4, barLength(state.ghost.t) * state.pps), glh - 8); g.fillStyle = '#ffd36b'; g.fillRect(gx, gy + 4, 2, glh - 8);
      }
    }
    if (state.marquee) { const m = state.marquee; g.fillStyle = '#7cc4ff22'; g.strokeStyle = '#7cc4ff'; g.lineWidth = 1; g.fillRect(Math.min(m.x0, m.x1), Math.min(m.y0, m.y1), Math.abs(m.x1 - m.x0), Math.abs(m.y1 - m.y0)); g.strokeRect(Math.min(m.x0, m.x1) + .5, Math.min(m.y0, m.y1) + .5, Math.abs(m.x1 - m.x0), Math.abs(m.y1 - m.y0)); }
    const px = Math.round(xAt(nowSec));
    if (px >= -10 && px <= width + 10) {
      const isScrub = state.gesture?.mode === 'scrub' || rulerGesture?.mode === 'seek';
      g.fillStyle = isScrub ? 'rgba(255, 211, 107, 0.28)' : 'rgba(255, 211, 107, 0.12)';
      g.fillRect(px - 3.5, 0, 7, height);
      g.fillStyle = '#ffd36b';
      g.fillRect(px - 0.5, 0, 1.5, height);
    }
    drawRuler(width, nowSec); drawOverview(width, nowSec);
  }

  let lastHeight = 0;
  function stageHeightSync(height) { if (height !== lastHeight) { canvas.style.height = `${height}px`; heads.style.height = `${height}px`; lastHeight = height; } }

  function drawOverview(stageW, nowSec = ctx.getTime()) {
    const width = stageW || overview.clientWidth || 600, height = 30, g = sizeCanvas(overview, width, height), peaks = computePeaks(), d = duration(), a = analysis();
    g.fillStyle = '#0a0e14'; g.fillRect(0, 0, width, height);
    if (a?.sections?.length) {
      for (const s of a.sections) {
        g.fillStyle = `${s.color}66`;
        g.fillRect(s.startSec / d * width, 0, Math.max(1, s.durationSec / d * width), 3);
      }
    }
    if (peaks) { g.fillStyle = '#2c6f95'; for (let x = 0; x < width; x++) { const i0 = Math.floor(x / width * peaks.abs.length), i1 = Math.max(i0, Math.floor((x + 1) / width * peaks.abs.length) - 1); let m = 0; for (let i = i0; i <= i1; i++) m = Math.max(m, peaks.abs[i]); const a = m * (height / 2 - 2); g.fillRect(x, height / 2 - a, 1, Math.max(1, a * 2)); } }
    tl().layers.forEach((layer, li) => layer.clips.forEach(clip => { const [r, gg, b] = clipUiColor(clip.color); g.fillStyle = `rgba(${r},${gg},${b},.75)`; g.fillRect(clip.startSec / d * width, 4 + (li % 6) * 4, Math.max(1, clip.durationSec / d * width), 3); }));
    const vx = state.scrollSec / d * width, vw = visibleSec() / d * width;
    g.fillStyle = '#ffffff18'; g.fillRect(vx, 0, vw, height); g.strokeStyle = '#ffffffaa'; g.strokeRect(vx + .5, .5, Math.max(2, vw) - 1, height - 1);
    const ox = Math.round(nowSec / d * width);
    g.fillStyle = '#ffd36b'; g.fillRect(ox - 0.5, 0, 1.5, height);
  }

  /* -------------------------------------------------------------- loop */
  let lastSize = '', lastPlayDrawMs = 0;
  function frame() {
    syncScrollbarGutter();
    const size = `${stageWidth()}x${root.clientHeight}x${lastSbW}`;
    if (size !== lastSize) { lastSize = size; clampView(); state.dirty = true; }
    const nowMs = performance.now();
    const isScrubbing = state.gesture?.mode === 'scrub' || rulerGesture?.mode === 'seek';
    if (state.dirty || isScrubbing || (ctx.isPlaying() && (nowMs - lastPlayDrawMs >= 22))) {
      state.dirty = false;
      lastPlayDrawMs = nowMs;
      draw();
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  new ResizeObserver(() => { state.dirty = true; }).observe(canvas);

  addEventListener('keydown', event => {
    if (event.key === 'Shift') {
      state.shiftDown = true;
      if (state.gesture?.mode === 'move') {
        state.gesture.shiftLock = true;
        if (state.gesture.lastMoveArgs) {
          applyMove(...state.gesture.lastMoveArgs, true);
        } else {
          requestDraw();
        }
      }
    }
    if (event.code === 'Space' && event.target === canvas && event.altKey) state.spaceDown = true;
    if (event.key === 'Escape' && state.gesture?.mode && ['move', 'start', 'end', 'draw', 'erase', 'drag-keyframe'].includes(state.gesture.mode)) {
      event.preventDefault();
      event.stopPropagation();
      store.cancel();
      state.gesture = null;
      state.marquee = null;
      canvas.classList.remove('panning');
      renderHeads();
      requestDraw();
    }
  });
  addEventListener('keyup', event => {
    if (event.key === 'Shift') {
      state.shiftDown = false;
      if (state.gesture?.mode === 'move') {
        state.gesture.shiftLock = false;
        if (state.gesture.lastMoveArgs) {
          applyMove(...state.gesture.lastMoveArgs, false);
        } else {
          requestDraw();
        }
      }
    }
    if (event.code === 'Space') state.spaceDown = false;
  });
  addEventListener('blur', () => {
    state.shiftDown = false;
    state.spaceDown = false;
  });

  renderHeads(); clampView();
  return {
    redraw: requestDraw, draw, computePeaks, renderHeads, updateActiveHead, fit, zoomAround, centerOn, ensureVisible, setSelection, pruneSelection,
    toggleExpandLayer, get expandedLayerId() { return state.expandedLayerId; },
    get selection() { return [...state.selection]; }, get solo() { return state.solo; },
    setLaneSize(size) { state.laneSize = size; renderHeads(); requestDraw(); },
    get laneSize() { return state.laneSize; },
    get view() { return { pps: state.pps, scrollSec: state.scrollSec, visibleSec: visibleSec() }; },
    hit: (x, y) => hitTest(x, y), canvas, ruler, addLayerAction,
    setSectionType, splitSectionAt, mergeSectionWithNext, regenerateSingleSection,
    clipScreenRect: (layerIndex, clip) => clipRect(layerIndex, clip),
    selectAll() { setSelection(tl().layers.flatMap(l => l.clips.map(c => ({ layerId: l.id, clipId: c.id })))); },
    clearSolo() { state.solo.clear(); renderHeads(); requestDraw(); }
  };
}
