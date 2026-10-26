/** Audio driver editor: an EQ-style frequency band picker. The user drags a box on
 * the live spectrum (edges = frequency range, bottom = trigger threshold, top =
 * level that gives full effect), sees the driver curve over the whole clip and the
 * resulting strength, and can tune gain, release and gate/follow mode.
 * Everything drawn here uses driverLevel() from timeline.mjs, so the preview is
 * exactly what renderTimelineFrame sends to the LEDs.
 */
import { BAND_PRESETS, DEFAULT_BAND, STEM_BAND_PRESETS, bandLevel, driverLevel } from './timeline.mjs';
import { SPECTRUM_BANDS, SPECTRUM_MAX_HZ, SPECTRUM_MIN_HZ, averageSpectrum, bandHz, bandPosition, rangeLevel, spectrumCell, getSpectrumForSource } from './audio-spectrum.mjs';
import { beatPosition, clamp, clampBand, clipEnd, envelopeAt, findClip, patchClips, timeAtBeat } from './daw-state.mjs';
import { clipUiColor, h } from './daw-ui.mjs';

const FREQ_LABELS = [[50, '50'], [100, '100'], [200, '200'], [500, '500'], [1000, '1k'], [2000, '2k'], [5000, '5k'], [10000, '10k']];
const fmtHz = hz => hz >= 1000 ? `${(hz / 1000).toFixed(hz >= 10000 ? 0 : 1).replace(/\.0$/, '')} kHz` : `${Math.round(hz)} Hz`;

export function createDriverEditor(host, ctx) {
  const { store } = ctx;
  const s = { drag: null, hover: null, curveKey: '', curve: null, avgKey: '', avg: null, lastDraw: -1 };
  const ctl = h('div', { class: 'drv-ctl' });
  const specCanvas = h('canvas', { class: 'drv-spec', tabIndex: 0, 'aria-label': 'Spektar: povuci po praznom za novi raspon, povuci rubove za frekvenciju, donji rub za prag' });
  const curveCanvas = h('canvas', { class: 'drv-curve', 'aria-label': 'Driver kroz vrijeme clipa' });
  const specTitle = h('span', { class: 'ce-title' }, 'SPEKTAR');
  const specHead = h('div', { class: 'drv-head' }, specTitle, h('small', { class: 'drv-hint' }, 'Povuci po praznom za raspon · rubovi = frekvencija · donja linija = prag · gornja = puna jačina'));
  const curveHead = h('div', { class: 'drv-head' }, h('span', { class: 'ce-title' }, 'DRIVER KROZ CLIP'), h('small', { class: 'drv-legend' }, h('i', { class: 'lg raw' }), 'razina pojasa ', h('i', { class: 'lg out' }), 'driver ', h('i', { class: 'lg res' }), 'rezultat (envelope × driver)'));
  host.append(ctl, h('div', { class: 'drv-pane' }, specHead, specCanvas), h('div', { class: 'drv-pane' }, curveHead, curveCanvas));

  const refs = () => ctx.getSelection().filter(ref => findClip(store.timeline, ref));
  const primary = () => { const ref = refs()[0]; return ref ? findClip(store.timeline, ref) : null; };
  const apply = (label, patch) => { const list = refs(); if (list.length) store.commit(label, t => patchClips(t, list, patch)); };

  const activeSource = () => {
    const hit = primary();
    if (!hit) return 'master';
    if (hit.clip.driver === 'band') return hit.clip.band?.source || 'master';
    if (['drums', 'bass', 'vocals', 'other'].includes(hit.clip.driver)) return hit.clip.driver;
    return 'master';
  };
  const spectrum = () => getSpectrumForSource(ctx.getAnalysis(), activeSource());
  const inputs = {}; let meterEl = null, meterVal = null;

  /* ------------------------------------------------------------ controls */
  const field = (key, label, unit, min, max, step, read, write) => {
    const input = h('input', { type: 'number', min, max, step, 'aria-label': label });
    input.addEventListener('change', () => { const v = Number(input.value); if (Number.isFinite(v)) write(v); });
    inputs[key] = { input, read };
    return h('label', { class: 'num' }, `${label}`, h('span', { class: 'unit' }, input, unit));
  };
  const refreshInputs = () => {
    const hit = primary(); if (!hit?.clip.band) return;
    for (const { input, read } of Object.values(inputs)) if (document.activeElement !== input) input.value = read(hit.clip);
  };
  const bandPatch = patch => {
    const curSrc = activeSource();
    apply('Frekvencijski driver', { band: { source: curSrc, ...patch } });
    if (ctx.stems?.getState?.()?.auditionBand) {
      const b = primary()?.clip?.band;
      if (b) ctx.stems.setAuditionBand(b.lowHz, b.highHz, b.source || curSrc);
    }
  };

  function render() {
    ctl.replaceChildren(); for (const k of Object.keys(inputs)) delete inputs[k];
    const hit = primary();
    if (!hit) {
      ctl.append(h('div', { class: 'empty' }, h('b', {}, 'Nema odabranog clipa'), h('p', {}, 'Odaberi clip u playlistu pa ovdje namjesti što ga pokreće u glazbi.')));
      specTitle.textContent = 'SPEKTAR';
      draw();
      return;
    }
    const clip = hit.clip;
    const isNone = clip.driver === 'none';
    const curSrc = activeSource();
    const band = clip.band || { ...DEFAULT_BAND, source: curSrc };

    const SOURCE_LABELS = {
      master: 'Cijeli miks (EQ)',
      drums: 'Bubnjevi (stem)',
      bass: 'Bas (stem)',
      vocals: 'Vokal (stem)',
      other: 'Ostalo (stem)'
    };
    const curLabel = SOURCE_LABELS[curSrc] || curSrc;
    specTitle.textContent = `SPEKTAR · ${curLabel.toUpperCase()}`;

    const modes = [
      ['none', 'Bez drivera', 'Clip svijetli stalno, bez modulacije audijem'],
      ['master', 'Cijeli miks', 'EQ frekvencijski pojas cijele pjesme (master mix)'],
      ['drums', 'Bubnjevi (stem)', 'EQ frekvencijski pojas izoliranih bubnjeva (kick, snare...)'],
      ['bass', 'Bas (stem)', 'EQ frekvencijski pojas izoliranog basa'],
      ['vocals', 'Vokal (stem)', 'EQ frekvencijski pojas izoliranog vokala'],
      ['other', 'Ostalo (stem)', 'EQ frekvencijski pojas ostalih instrumenata i činela']
    ];

    const selectSource = (target) => {
      if (target === 'none') {
        apply('Audio driver', { driver: 'none' });
        return;
      }
      const existingBand = clip.band || DEFAULT_BAND;
      let nextBand = { ...existingBand, source: target };
      if (existingBand.source !== target) {
        const presets = STEM_BAND_PRESETS[target] || BAND_PRESETS;
        const topPreset = presets[0]?.[1];
        if (topPreset) nextBand = { ...nextBand, ...topPreset, source: target };
      }
      apply('Audio driver', { driver: 'band', band: nextBand });
      if (ctx.stems?.getState?.()?.auditionBand) {
        ctx.stems.setAuditionBand(nextBand.lowHz, nextBand.highHz, target);
      }
    };

    ctl.append(
      h('div', { class: 'ce-section' },
        h('label', {}, 'Što pokreće clip (izvor zvuka)'),
        h('div', { class: 'seg two-col drv-modes' }, modes.map(([v, l, tip]) => {
          const isActive = (v === 'none' && isNone) || (!isNone && curSrc === v);
          return h('button', {
            type: 'button',
            class: `${isActive ? 'on' : ''} drv-btn-${v}`,
            'aria-pressed': String(isActive),
            title: tip,
            onClick: () => selectSource(v)
          }, l);
        }))
      )
    );

    if (isNone) {
      ctl.append(h('p', { class: 'drv-note' }, 'Clip svijetli stalno i prati samo svoj envelope. Odaberi Cijeli miks ili stem da ga pokreće odabrani frekvencijski pojas s pragom i okidačem.'));
      draw();
      return;
    }

    const gain = h('input', { type: 'range', min: 0, max: 200, value: Math.round(clip.driverGain * 100), 'aria-label': 'Jačina drivera', title: 'Koliko jako driver pojačava efekt. 100% = točno kako je namješteno.' });
    gain.addEventListener('pointerdown', () => store.begin());
    gain.addEventListener('input', () => store.update(t => patchClips(t, refs(), { driverGain: Number(gain.value) / 100 })));
    gain.addEventListener('change', () => store.end('Jačina drivera'));
    meterVal = h('i', {}); meterEl = h('div', { class: 'drv-meter', title: 'Trenutna jačina drivera' }, meterVal);
    ctl.append(h('div', { class: 'ce-section' }, h('label', {}, 'Jačina drivera'), h('div', { class: 'color-row' }, gain, h('span', { class: 'gain-val' }, `${Math.round(clip.driverGain * 100)}%`)), meterEl));

    // Audition and Solo buttons
    const auditionState = ctx.stems?.getState?.()?.auditionBand;
    const isBandAudition = Boolean(auditionState && (!auditionState.source || auditionState.source === curSrc));
    const listenBandBtn = h('button', {
      type: 'button',
      class: `mini-btn band-audition${isBandAudition ? ' on' : ''}`,
      title: isBandAudition ? 'Isključi slušanje frekvencijskog pojasa' : `Poslušaj točno ovaj frekvencijski pojas (${curLabel}) u zvučnicima`,
      onClick: () => {
        if (isBandAudition) ctx.stems?.setAuditionBand(null);
        else ctx.stems?.setAuditionBand(band.lowHz, band.highHz, curSrc);
        render();
      }
    }, isBandAudition ? 'Isključi slušanje pojasa' : `Poslušaj EQ pojas (${fmtHz(band.lowHz)} – ${fmtHz(band.highHz)})`);

    let stemSoloBtn = null;
    if (curSrc !== 'master') {
      const isSolo = ctx.stems?.getState?.()?.solo.has(curSrc);
      stemSoloBtn = h('button', {
        type: 'button',
        class: `mini-btn stem-audition${isSolo ? ' on' : ''}`,
        title: isSolo ? 'Vrati normalan miks' : `Poslušaj cijeli izolirani stem ${curLabel} bez EQ filtriranja`,
        onClick: () => {
          ctx.stems?.toggleSolo(curSrc);
          render();
          ctx.playlist?.renderHeads?.();
        }
      }, isSolo ? `Solo: ${curLabel}` : `Poslušaj cijeli stem`);
    }

    // Presets tailored to source
    const presets = STEM_BAND_PRESETS[curSrc] || BAND_PRESETS;
    ctl.append(h('div', { class: 'ce-section' },
      h('label', {}, `Brzi odabir (${curLabel})`),
      h('div', { class: 'chips c3' }, presets.map(([name, preset]) =>
        h('button', {
          type: 'button',
          class: 'chip',
          title: `${fmtHz(preset.lowHz)} – ${fmtHz(preset.highHz)} · ${preset.mode === 'gate' ? 'okidač' : 'prati'}`,
          onClick: () => bandPatch({ ...preset, source: curSrc })
        }, name)
      ))
    ));

    // Mode: follow or gate
    ctl.append(h('div', { class: 'ce-section' },
      h('label', {}, 'Način'),
      h('div', { class: 'seg' }, [['follow', 'Prati razinu'], ['gate', 'Okidač']].map(([v, l]) =>
        h('button', {
          type: 'button',
          class: band.mode === v ? 'on' : '',
          'aria-pressed': String(band.mode === v),
          title: v === 'gate' ? 'Iznad praga driver skoči na 100%, ispod pada (ispuštanje)' : 'Driver prati glasnoću pojasa između praga i vrha',
          onClick: () => bandPatch({ mode: v, source: curSrc })
        }, l)
      ))
    ));

    // Fields
    ctl.append(h('div', { class: 'ce-section fields' },
      field('lo', 'Od', 'Hz', SPECTRUM_MIN_HZ, SPECTRUM_MAX_HZ, 1, c => Math.round(c.band?.lowHz ?? DEFAULT_BAND.lowHz), v => bandPatch({ lowHz: v, source: curSrc })),
      field('hi', 'Do', 'Hz', SPECTRUM_MIN_HZ, SPECTRUM_MAX_HZ, 1, c => Math.round(c.band?.highHz ?? DEFAULT_BAND.highHz), v => bandPatch({ highHz: v, source: curSrc })),
      field('mid', 'Središte', 'Hz', SPECTRUM_MIN_HZ, SPECTRUM_MAX_HZ, 1, c => { const b = c.band || DEFAULT_BAND; return Math.round(Math.sqrt(b.lowHz * b.highHz)); }, v => { const b = primary().clip.band || DEFAULT_BAND, half = Math.sqrt(b.highHz / b.lowHz); bandPatch({ lowHz: v / half, highHz: v * half, source: curSrc }); }),
      field('oct', 'Širina', 'okt', 0.1, 9, 0.1, c => { const b = c.band || DEFAULT_BAND; return Math.log2(b.highHz / b.lowHz).toFixed(1); }, v => { const b = primary().clip.band || DEFAULT_BAND, mid = Math.sqrt(b.lowHz * b.highHz), half = Math.pow(2, v / 2); bandPatch({ lowHz: mid / half, highHz: mid * half, source: curSrc }); }),
      field('th', 'Prag', '%', 0, 98, 1, c => Math.round((c.band?.threshold ?? DEFAULT_BAND.threshold) * 100), v => bandPatch({ threshold: v / 100, source: curSrc })),
      field('ce', 'Puna jačina', '%', 2, 100, 1, c => Math.round((c.band?.ceiling ?? DEFAULT_BAND.ceiling) * 100), v => bandPatch({ ceiling: v / 100, source: curSrc })),
      field('rel', 'Ispuštanje', 'ms', 0, 2000, 10, c => Math.round((c.band?.releaseSec ?? DEFAULT_BAND.releaseSec) * 1000), v => bandPatch({ releaseSec: v / 1000, source: curSrc }))
    ));

    // Actions
    const actions = [listenBandBtn];
    if (stemSoloBtn) actions.push(stemSoloBtn);
    actions.push(
      h('button', { type: 'button', class: 'mini-btn', title: 'Namjesti prag i vrh prema stvarnoj glasnoći ovog pojasa u clipu', onClick: autoLevels }, 'Auto prag'),
      h('button', { type: 'button', class: 'mini-btn', title: 'Vrati zadani pojas', onClick: () => {
        const def = (STEM_BAND_PRESETS[curSrc] || BAND_PRESETS)[0]?.[1] || DEFAULT_BAND;
        bandPatch({ ...def, source: curSrc });
      } }, 'Reset')
    );
    ctl.append(h('div', { class: 'ce-actions' }, actions));

    if (!spectrum()) ctl.append(h('p', { class: 'drv-note' }, ctx.spectrumStatus?.() || 'Spektar se računa…'));
    refreshInputs(); draw();
  }

  function autoLevels() {
    const hit = primary(), sp = spectrum(); if (!hit || !sp || !hit.clip.band) return;
    const { clip } = hit, levels = [];
    const f0 = Math.max(0, Math.floor((clip.startSec - sp.startSec) / sp.hopSec)), f1 = Math.min(sp.frames - 1, Math.ceil((clipEnd(clip) - sp.startSec) / sp.hopSec));
    for (let f = f0; f <= f1; f++) levels.push(rangeLevel(sp, f, clip.band.lowHz, clip.band.highHz));
    if (levels.length < 8) return;
    levels.sort((a, b) => a - b);
    const q = p => levels[Math.min(levels.length - 1, Math.floor(levels.length * p))];
    const th = clamp(q(clip.band.mode === 'gate' ? 0.8 : 0.5), 0, 0.95), ce = clamp(Math.max(q(0.98), th + 0.06), th + 0.02, 1);
    bandPatch({ threshold: th, ceiling: ce });
  }

  /* ------------------------------------------------------------- spectrum */
  const pad = { l: 30, r: 10, t: 14, b: 20 };
  const size = canvas => ({ w: canvas.clientWidth, h: canvas.clientHeight });
  const fx = (hz, w) => pad.l + bandPosition(hz) / SPECTRUM_BANDS * (w - pad.l - pad.r);
  const hzAt = (x, w) => clamp(bandHz(clamp((x - pad.l) / (w - pad.l - pad.r), 0, 1) * SPECTRUM_BANDS), SPECTRUM_MIN_HZ, SPECTRUM_MAX_HZ);
  const ly = (v, hh) => pad.t + (1 - v) * (hh - pad.t - pad.b);
  const levelAt = (y, hh) => clamp(1 - (y - pad.t) / (hh - pad.t - pad.b), 0, 1);
  const prep = canvas => {
    const { w, h: hh } = size(canvas), dpr = devicePixelRatio || 1;
    if (!w || !hh) return null;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(hh * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(hh * dpr); }
    const g = canvas.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.fillStyle = '#0b1017'; g.fillRect(0, 0, w, hh); g.font = '10px ui-monospace, Menlo, monospace'; g.textBaseline = 'middle';
    return { g, w, hh };
  };

  function drawSpectrum() {
    const c = prep(specCanvas); if (!c) return;
    const { g, w, hh } = c, hit = primary(), sp = spectrum();
    for (const v of [0, .25, .5, .75, 1]) { const y = Math.round(ly(v, hh)); g.fillStyle = v === 0 ? '#ffffff30' : '#ffffff0e'; g.fillRect(pad.l, y, w - pad.l - pad.r, 1); g.fillStyle = '#6b7a8a'; g.textAlign = 'right'; g.fillText(`${Math.round(v * 100)}`, pad.l - 5, y); }
    g.textAlign = 'center';
    for (const [hz, label] of FREQ_LABELS) { const x = Math.round(fx(hz, w)); g.fillStyle = '#ffffff10'; g.fillRect(x, pad.t, 1, hh - pad.t - pad.b); g.fillStyle = '#6b7a8a'; g.fillText(label, x, hh - 8); }
    g.textAlign = 'left';
    if (!sp) { g.fillStyle = '#8fa0b3'; g.fillText(ctx.spectrumStatus?.() || 'Spektar se računa…', pad.l + 12, hh / 2); return; }
    const cellW = (w - pad.l - pad.r) / SPECTRUM_BANDS;
    const curSrc = activeSource();
    if (hit) {
      const key = `${hit.clip.id}:${hit.clip.startSec}:${hit.clip.durationSec}:${curSrc}`;
      if (s.avgKey !== key || s.avg?.sp !== sp) { s.avgKey = key; s.avg = { sp, data: averageSpectrum(sp, hit.clip.startSec, clipEnd(hit.clip)) }; }
      g.beginPath(); g.moveTo(pad.l, ly(0, hh));
      for (let b = 0; b < SPECTRUM_BANDS; b++) g.lineTo(pad.l + (b + .5) * cellW, ly(s.avg.data[b], hh));
      g.lineTo(w - pad.r, ly(0, hh)); g.closePath(); g.fillStyle = '#5d7a9a38'; g.fill(); g.strokeStyle = '#6f8fb35a'; g.lineWidth = 1; g.stroke();
    }
    const time = ctx.getTime(), frame = Math.round((time - sp.startSec) / sp.hopSec);
    const band = hit?.clip.driver !== 'none' ? hit?.clip.band : null;
    const stemColors = {
      drums: { fill: '#ff9a3a30', stroke: '#ffaa4d' },
      bass: { fill: '#b25cff30', stroke: '#c985ff' },
      vocals: { fill: '#37d4ff30', stroke: '#6fe4ff' },
      other: { fill: '#59ff9b30', stroke: '#7dffb3' },
      master: { fill: '#ffd78a30', stroke: '#ffe09e' }
    };
    const strokeColor = stemColors[curSrc]?.stroke || '#6fe4ff';
    const fillColor = stemColors[curSrc]?.fill || '#37d4ff30';

    g.beginPath(); g.moveTo(pad.l, ly(0, hh));
    for (let b = 0; b < SPECTRUM_BANDS; b++) g.lineTo(pad.l + (b + .5) * cellW, ly(spectrumCell(sp, frame, b), hh));
    g.lineTo(w - pad.r, ly(0, hh)); g.closePath(); g.fillStyle = fillColor; g.fill(); g.strokeStyle = strokeColor; g.lineWidth = 1.5; g.stroke();
    if (!band) { if (hit) { g.fillStyle = '#ffd78acc'; g.font = '12px system-ui'; g.fillText('Povuci po spektru da odabereš frekvencijski pojas', pad.l + 14, pad.t + 14); } return; }
    const x0 = fx(band.lowHz, w), x1 = fx(band.highHz, w), yT = ly(band.threshold, hh), yC = ly(band.ceiling, hh);
    g.fillStyle = '#ffb23a1c'; g.fillRect(x0, yC, x1 - x0, yT - yC);
    g.fillStyle = '#00000044'; g.fillRect(x0, yT, x1 - x0, ly(0, hh) - yT);
    const live = rangeLevel(sp, frame, band.lowHz, band.highHz);
    if (live > band.threshold) { g.fillStyle = '#ff9a3a55'; g.fillRect(x0, ly(Math.min(live, band.ceiling), hh), x1 - x0, yT - ly(Math.min(live, band.ceiling), hh)); }
    g.strokeStyle = '#ffb23a'; g.lineWidth = 1.5; g.strokeRect(x0 + .5, yC + .5, x1 - x0, yT - yC);
    g.lineWidth = 3; g.beginPath(); g.moveTo(x0, yT); g.lineTo(x1, yT); g.stroke();
    g.setLineDash([5, 4]); g.lineWidth = 1.5; g.beginPath(); g.moveTo(x0, yC); g.lineTo(x1, yC); g.stroke(); g.setLineDash([]);
    const grip = (x, y) => { g.fillStyle = s.drag || s.hover ? '#fff' : '#ffd78a'; g.beginPath(); g.roundRect(x - 4, y - 11, 8, 22, 3); g.fill(); };
    const mid = (yT + yC) / 2; grip(x0, clamp(mid, pad.t + 12, hh - pad.b - 12)); grip(x1, clamp(mid, pad.t + 12, hh - pad.b - 12));
    g.fillStyle = '#ffb23a'; for (const y of [yT, yC]) { g.beginPath(); g.arc((x0 + x1) / 2, y, 5, 0, 7); g.fill(); }
    g.fillStyle = '#ffd78a'; g.font = '11px ui-monospace, Menlo, monospace';
    const labelY = clamp(yC - 9, 10, hh - pad.b - 8);
    g.textAlign = 'center'; g.fillText(`${fmtHz(band.lowHz)} – ${fmtHz(band.highHz)}`, clamp((x0 + x1) / 2, 70, w - 70), labelY);
    g.textAlign = 'left'; g.fillText(`prag ${Math.round(band.threshold * 100)}%`, clamp(x1 + 6, pad.l, w - 70), clamp(yT, 10, hh - pad.b - 6));
    if (band.ceiling < 0.97) g.fillText(`vrh ${Math.round(band.ceiling * 100)}%`, clamp(x1 + 6, pad.l, w - 70), clamp(yC - 1, 10, hh - pad.b - 6));
  }

  /* --------------------------------------------------------- pointer: EQ */
  const where = event => { const r = specCanvas.getBoundingClientRect(); return { x: event.clientX - r.left, y: event.clientY - r.top }; };
  function hitTest(x, y, band) {
    const { w, h: hh } = size(specCanvas), x0 = fx(band.lowHz, w), x1 = fx(band.highHz, w), yT = ly(band.threshold, hh), yC = ly(band.ceiling, hh);
    const inX = x >= x0 - 7 && x <= x1 + 7, inY = y >= yC - 8 && y <= yT + 8;
    if (inX && Math.abs(y - yT) <= 7) return 'th';
    if (inX && Math.abs(y - yC) <= 7) return 'ce';
    if (inY && Math.abs(x - x0) <= 7) return 'lo';
    if (inY && Math.abs(x - x1) <= 7) return 'hi';
    if (x > x0 && x < x1 && y > yC && y < yT) return 'body';
    return null;
  }
  const CURSORS = { th: 'ns-resize', ce: 'ns-resize', lo: 'ew-resize', hi: 'ew-resize', body: 'grab' };
  specCanvas.addEventListener('pointerdown', event => {
    const hit = primary(); if (!hit || !spectrum() || event.button !== 0) return;
    const { x, y } = where(event), { w, h: hh } = size(specCanvas);
    let mode = hit.clip.driver !== 'none' && hit.clip.band ? hitTest(x, y, hit.clip.band) : null;
    store.begin();
    if (!mode) {
      // Drag on empty space creates a fresh range; its height sets the threshold.
      const f = hzAt(x, w), th = clamp(levelAt(y, hh), 0.02, 0.9);
      const curSrc = activeSource();
      store.update(t => patchClips(t, refs(), {
        driver: 'band',
        band: {
          ...(findClip(t, refs()[0]).clip.band ?? DEFAULT_BAND),
          source: curSrc,
          lowHz: f / 1.1,
          highHz: f * 1.1,
          threshold: th,
          ceiling: Math.max(th + .1, findClip(t, refs()[0]).clip.band?.ceiling ?? 1)
        }
      }));
      mode = 'new';
    }
    const band = findClip(store.timeline, refs()[0]).clip.band;
    s.drag = { mode, pointerId: event.pointerId, startX: x, anchor: hzAt(x, w), start: { ...band }, fine: event.shiftKey };
    specCanvas.setPointerCapture(event.pointerId); specCanvas.style.cursor = mode === 'body' ? 'grabbing' : CURSORS[mode] || 'ew-resize'; draw();
  });
  specCanvas.addEventListener('pointermove', event => {
    const hit = primary(); if (!hit) return;
    const { x, y } = where(event), { w, h: hh } = size(specCanvas);
    if (!s.drag) {
      const mode = hit.clip.driver !== 'none' && hit.clip.band && spectrum() ? hitTest(x, y, hit.clip.band) : null;
      specCanvas.style.cursor = mode ? CURSORS[mode] : 'crosshair';
      if (mode !== s.hover) { s.hover = mode; draw(); }
      return;
    }
    const d = s.drag, f = hzAt(x, w), level = levelAt(y, hh), b0 = d.start, ratio = f / d.anchor, snap = v => event.shiftKey ? v : Math.round(v * 100) / 100;
    let patch;
    if (d.mode === 'new') patch = { lowHz: Math.min(d.anchor, f), highHz: Math.max(d.anchor, f, d.anchor * 1.05) };
    else if (d.mode === 'lo') patch = { lowHz: Math.min(f, b0.highHz / 1.05) };
    else if (d.mode === 'hi') patch = { highHz: Math.max(f, b0.lowHz * 1.05) };
    else if (d.mode === 'body') { const r = clamp(ratio, SPECTRUM_MIN_HZ / b0.lowHz, SPECTRUM_MAX_HZ / b0.highHz); patch = { lowHz: b0.lowHz * r, highHz: b0.highHz * r }; }
    else if (d.mode === 'th') patch = { threshold: snap(Math.min(level, b0.ceiling - .02)) };
    else patch = { ceiling: snap(Math.max(level, b0.threshold + .02)) };
    store.update(t => patchClips(t, refs(), { band: patch }));
    refreshInputs(); draw();
  });
  const release = event => { if (!s.drag) return; s.drag = null; if (specCanvas.hasPointerCapture(event.pointerId)) specCanvas.releasePointerCapture(event.pointerId); store.end('Frekvencijski pojas'); };
  specCanvas.addEventListener('pointerup', release); specCanvas.addEventListener('pointercancel', release);
  specCanvas.addEventListener('pointerleave', () => { if (!s.drag && s.hover) { s.hover = null; draw(); } });
  specCanvas.addEventListener('dblclick', () => {
    const hit = primary();
    if (hit?.clip.driver !== 'none') {
      const curSrc = activeSource();
      const def = (STEM_BAND_PRESETS[curSrc] || BAND_PRESETS)[0]?.[1] || DEFAULT_BAND;
      bandPatch({ ...def, source: curSrc });
    }
  });

  /* ---------------------------------------------------------------- curve */
  function drawCurve() {
    const c = prep(curveCanvas); if (!c) return;
    const { g, w, hh } = c, hit = primary(), sp = spectrum(), a = ctx.getAnalysis();
    const cx = (t, clip) => pad.l + t / clip.durationSec * (w - pad.l - pad.r);
    for (const v of [0, .5, 1]) { const y = Math.round(ly(v, hh)); g.fillStyle = v === 0 ? '#ffffff30' : '#ffffff10'; g.fillRect(pad.l, y, w - pad.l - pad.r, 1); g.fillStyle = '#6b7a8a'; g.textAlign = 'right'; g.fillText(`${Math.round(v * 100)}`, pad.l - 5, y); }
    g.textAlign = 'left';
    if (!hit || hit.clip.driver === 'none') { g.fillStyle = '#566474'; g.font = '12px system-ui'; g.fillText(hit ? 'Bez drivera: clip prati samo envelope.' : 'Odaberi clip.', pad.l + 12, hh / 2); return; }
    if (!sp && hit.clip.driver !== 'none') { g.fillStyle = '#8fa0b3'; g.fillText(ctx.spectrumStatus?.() || 'Spektar se računa…', pad.l + 12, hh / 2); return; }
    const clip = hit.clip, t = store.timeline, width = Math.max(10, Math.floor(w - pad.l - pad.r));
    const curSrc = activeSource();
    const key = `${clip.id}|${clip.startSec}|${clip.durationSec}|${clip.driver}|${JSON.stringify(clip.band)}|${clip.driverGain}|${JSON.stringify(clip.keyframes)}|${width}|${sp ? sp.frames : 0}|${curSrc}`;
    if (key !== s.curveKey) {
      const raw = new Float32Array(width), out = new Float32Array(width), res = new Float32Array(width);
      for (let i = 0; i < width; i++) {
        const time = clip.startSec + (i + .5) / width * clip.durationSec, driver = clamp(driverLevel(a, clip, time) * clip.driverGain, 0, 1);
        raw[i] = clip.band && sp ? rangeLevel(sp, Math.round((time - sp.startSec) / sp.hopSec), clip.band.lowHz, clip.band.highHz) : driverLevel(a, clip, time);
        out[i] = driver; res[i] = driver * envelopeAt(clip.keyframes, time - clip.startSec);
      }
      s.curveKey = key; s.curve = { raw, out, res };
    }
    const { raw, out, res } = s.curve;
    const p0 = Math.floor(beatPosition(clip.startSec, t, a)), p1 = Math.ceil(beatPosition(clipEnd(clip), t, a));
    if (p1 - p0 <= 200) for (let p = p0; p <= p1; p++) { const local = timeAtBeat(p, t, a) - clip.startSec; if (local < 0 || local > clip.durationSec) continue; const bar = ((p % 4) + 4) % 4 === 0; g.fillStyle = bar ? '#ffffff22' : '#ffffff0c'; g.fillRect(Math.round(cx(local, clip)), pad.t, 1, hh - pad.t - pad.b); }
    const area = (arr, fill) => { g.beginPath(); g.moveTo(pad.l, ly(0, hh)); for (let i = 0; i < arr.length; i++) g.lineTo(pad.l + i + .5, ly(arr[i], hh)); g.lineTo(pad.l + arr.length, ly(0, hh)); g.closePath(); g.fillStyle = fill; g.fill(); };
    if (clip.driver !== 'none' && clip.band) {
      area(raw, '#6f8fb33a');
      for (const [v, dash] of [[clip.band.threshold, []], [clip.band.ceiling, [5, 4]]]) { g.strokeStyle = '#ffb23a'; g.lineWidth = dash.length ? 1 : 2; g.setLineDash(dash); g.beginPath(); g.moveTo(pad.l, ly(v, hh)); g.lineTo(w - pad.r, ly(v, hh)); g.stroke(); g.setLineDash([]); }
    }
    area(out, '#ff9a3a66');
    const [r, gg, b] = clipUiColor(clip.color); g.strokeStyle = `rgb(${r},${gg},${b})`; g.lineWidth = 1.6; g.beginPath();
    for (let i = 0; i < res.length; i++) { const y = ly(res[i], hh); i ? g.lineTo(pad.l + i + .5, y) : g.moveTo(pad.l, y); } g.stroke();
    const now = ctx.getTime() - clip.startSec;
    if (now >= 0 && now <= clip.durationSec) { g.fillStyle = '#ffd36b'; g.fillRect(Math.round(cx(now, clip)), pad.t, 1.5, hh - pad.t - pad.b); }
    g.fillStyle = '#6b7a8a'; g.fillText(`${clip.durationSec.toFixed(1)} s`, w - 52, 8);
  }

  function draw() { drawSpectrum(); drawCurve(); }
  function tick() {
    const hit = primary();
    if (hit && meterVal) { const v = hit.clip.driver === 'none' ? 0 : clamp(driverLevel(ctx.getAnalysis(), hit.clip, ctx.getTime()) * hit.clip.driverGain, 0, 1); meterVal.style.width = `${Math.round(v * 100)}%`; }
    const time = ctx.getTime(); if (time === s.lastDraw && !s.drag) return; s.lastDraw = time; drawSpectrum(); drawCurve();
  }
  new ResizeObserver(draw).observe(specCanvas); new ResizeObserver(draw).observe(curveCanvas);
  render();
  return { render, draw, tick };
}
