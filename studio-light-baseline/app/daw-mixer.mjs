/** Mixer dock: audio stem strips (Bubnjevi, Bas, Vokal, Ostalo, Audio Master)
 * plus light layer strips (opacity, live meter, mute/solo, blend) and master light limit.
 */
import { TIMELINE_BLENDS } from './timeline.mjs';
import { createFader, h } from './daw-ui.mjs';
import { STEM_IDS, STEM_METADATA } from './daw-stems.mjs';

export function createMixer(host, ctx) {
  const { store } = ctx;
  let faders = new Map();
  let stemFaders = new Map();
  let master = null;
  let audioMasterFader = null;

  function render() {
    host.replaceChildren();
    faders = new Map();
    stemFaders = new Map();

    const container = h('div', { class: 'mixer-pane' });

    // 1. Audio Stems section
    const stemState = ctx.stems?.getState?.() || { solo: new Set(), muted: new Set(), volumes: {} };
    const stemStrips = h('div', { class: 'mx-strips mx-audio-section' });

    for (const stemId of STEM_IDS) {
      const meta = STEM_METADATA[stemId];
      const isSolo = stemState.solo?.has(stemId);
      const isMuted = stemState.muted?.has(stemId);
      const vol = stemState.volumes?.[stemId] ?? 1;

      const fader = createFader({
        label: `Glasnoća ${meta.label}`,
        value: vol,
        max: 1.5,
        format: v => `${Math.round(v * 100)}%`,
        onInput: v => {
          ctx.stems?.setVolume(stemId, v);
        }
      });
      stemFaders.set(stemId, fader);

      stemStrips.append(h('div', { class: `mx-strip stem${isMuted ? ' muted' : ''}${isSolo ? ' solo' : ''}`, style: { '--layer': meta.color } },
        h('div', { class: 'mx-color' }),
        h('button', {
          type: 'button',
          class: 'mx-name',
          title: `Solo ${meta.label}`,
          onClick: e => {
            ctx.stems?.toggleSolo(stemId, e.shiftKey);
            render();
            ctx.playlist?.renderHeads?.();
          }
        }, meta.label.toUpperCase()),
        fader.element,
        h('div', { class: 'mx-buttons' },
          h('button', {
            type: 'button',
            class: isMuted ? 'mini on' : 'mini',
            'aria-pressed': String(isMuted),
            title: `Mute ${meta.label} u audio miksu`,
            onPointerDown: e => e.stopPropagation(),
            onClick: e => {
              e.stopPropagation();
              ctx.stems?.toggleMute(stemId);
              render();
              ctx.playlist?.renderHeads?.();
            }
          }, 'M'),
          h('button', {
            type: 'button',
            class: isSolo ? 'mini solo on' : 'mini solo',
            'aria-pressed': String(isSolo),
            title: `Solo ${meta.label} (Shift za više)`,
            onPointerDown: e => e.stopPropagation(),
            onClick: e => {
              e.stopPropagation();
              ctx.stems?.toggleSolo(stemId, e.shiftKey);
              render();
              ctx.playlist?.renderHeads?.();
            }
          }, 'S')
        ),
        h('small', { class: 'mx-note', title: meta.desc }, meta.short)
      ));
    }

    // Audio Master Strip
    const audioMuted = ctx.playlist?.isAudioMuted?.() ?? false;
    const audioVol = ctx.playlist?.getVolume?.() ?? 1;
    audioMasterFader = createFader({
      label: 'Glasnoća audio reprodukcije',
      value: audioVol,
      max: 1,
      format: v => `${Math.round(v * 100)}%`,
      onInput: v => {
        ctx.playlist?.setVolume?.(v);
      }
    });

    stemStrips.append(h('div', { class: `mx-strip master audio-master${audioMuted ? ' muted' : ''}`, style: { '--layer': '#4cc3ff' } },
      h('div', { class: 'mx-color' }),
      h('span', { class: 'mx-name static' }, 'AUDIO'),
      audioMasterFader.element,
      h('div', { class: 'mx-buttons' },
        h('button', {
          type: 'button',
          class: audioMuted ? 'mini on' : 'mini',
          'aria-pressed': String(audioMuted),
          title: 'Utišaj sav audio (svjetlo nastavlja)',
          onClick: () => {
            ctx.playlist?.toggleAudioMute?.();
            render();
            ctx.playlist?.renderHeads?.();
          }
        }, 'M')
      ),
      h('small', { class: 'mx-note' }, 'Glavni audio izlaz')
    ));

    // 2. Divider
    const divider = h('div', { class: 'mx-divider' });

    // 3. Lighting layers section
    const lightStrips = h('div', { class: 'mx-strips mx-light-section' });
    store.timeline.layers.forEach((layer, index) => {
      const fader = createFader({
        label: `Prozirnost ${layer.name}`,
        value: layer.opacity,
        onInput: v => store.update(t => { t.layers.find(l => l.id === layer.id).opacity = Math.round(v * 100) / 100; }),
        onChange: () => { store.end('Prozirnost sloja'); ctx.onStructure?.(); }
      });
      fader.element.addEventListener('pointerdown', () => store.begin(), { capture: true });
      fader.element.addEventListener('keydown', () => store.begin(), { capture: true });
      faders.set(layer.id, fader);
      const solo = ctx.playlist.solo.has(layer.id);
      lightStrips.append(h('div', { class: `mx-strip${layer.enabled ? '' : ' muted'}${index === ctx.getActiveLayerIndex() ? ' active' : ''}`, style: { '--layer': layer.color || '#3aa0ff' } },
        h('div', { class: 'mx-color' }),
        h('button', { type: 'button', class: 'mx-name', title: 'Odaberi sloj', onClick: () => { ctx.setActiveLayer(index); } }, layer.name || layer.id),
        fader.element,
        h('div', { class: 'mx-buttons' },
          h('button', { type: 'button', class: layer.enabled ? 'mini' : 'mini on', 'aria-pressed': String(!layer.enabled), title: 'Mute', onPointerDown: e => e.stopPropagation(), onClick: e => { e.stopPropagation(); store.commit('Mute sloja', t => { const l = t.layers.find(x => x.id === layer.id); l.enabled = !l.enabled; }); } }, 'M'),
          h('button', { type: 'button', class: solo ? 'mini solo on' : 'mini solo', 'aria-pressed': String(solo), title: 'Solo (Shift za više slojeva)', onPointerDown: e => e.stopPropagation(), onClick: e => { e.stopPropagation(); const set = ctx.playlist.solo; if (solo) set.delete(layer.id); else { if (!e.shiftKey) set.clear(); set.add(layer.id); } ctx.playlist.renderHeads(); ctx.onSolo?.(); render(); } }, 'S')),
        h('select', { class: 'mini-select', 'aria-label': `Blend ${layer.name}`, onChange: e => store.commit('Blend', t => { t.layers.find(l => l.id === layer.id).blend = e.target.value; }) }, TIMELINE_BLENDS.map(b => h('option', { value: b, selected: layer.blend === b }, b)))));
    });

    master = createFader({ label: 'Master svjetlina (ograničeno na 60)', value: ctx.getBrightness(), max: 60, format: v => `${Math.round(v)}%`, onInput: v => ctx.setBrightness(v) });
    const masterStrip = h('div', { class: 'mx-strip master light-master' },
      h('div', { class: 'mx-color' }),
      h('span', { class: 'mx-name static' }, 'SVJETLO'),
      master.element,
      h('small', { class: 'mx-note' }, 'Maks. 60%')
    );

    lightStrips.append(masterStrip);

    container.append(stemStrips, divider, lightStrips);
    host.append(container);
  }

  return {
    render,
    levels(map, masterLevel, stemLevels) {
      for (const [id, fader] of faders) fader.level(map[id] ?? 0);
      master?.level(masterLevel);
      if (stemLevels) {
        for (const [id, fader] of stemFaders) fader.level(stemLevels[id] ?? 0);
        audioMasterFader?.level(stemLevels.master ?? 0);
      }
    },
    setMaster(v) { master?.set(v); },
    setOpacity(id, v) { faders.get(id)?.set(v); },
    setAudioVolume(v) { audioMasterFader?.set(v); }
  };
}
