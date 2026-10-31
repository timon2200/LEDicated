/** Auto Show & Pipeline Generator Studio Panel (Bottom Dock).
 * Exposes every parameter of the MP3 -> Light Show pipeline:
 * - Modular Generator selection (5 Built-in + Git-shared .generator.json in generators/)
 * - Theme, 4x RGBW palette + W-channel sliders, and 16 effect filters
 * - Section Detection (detectSections thresholds, phrase bars, 1-beat drop snap) & per-section regeneration
 * - Dramaturgy & Contrast (nonDropCeiling, W-channel mode, dropMinW, dropColorBoost, Pre-Drop Blackout, Beat-1 Blinder, Drop Strobe, Build Spiral)
 * - Frequency Gates (Kick, Snare, Vocal Follow), 3x3 Spatial Zone mapping, 5-Layer mixer overrides, and live Audit Telemetry
 * - Vibecode JS Editor + 1-click AI Vibecode Prompt & Git sharing
 */
import { el, clamp } from './daw-ui.mjs';
import {
  TIMELINE_PRESETS,
  TIMELINE_BLENDS,
  SHOW_THEMES,
  PALETTES,
  ZONES,
  regenerateSectionClips
} from './timeline.mjs';
import {
  SECTION_TYPES,
  SECTION_NAMES,
  SECTION_COLORS,
  detectSections
} from './audio-sections.mjs';
import {
  measureTimelineContrast,
  measurePreDropBlackout
} from './timeline-contrast.mjs';
import {
  DEFAULT_PIPELINE_CONFIG,
  DEFAULT_VIBECODE_TEMPLATE,
  BUILT_IN_GENERATORS,
  mergePipelineConfig,
  resolveGeneratorConfig,
  runShowPipeline,
  serializeGeneratorSpec,
  validateGeneratorSpec,
  buildVibecodePrompt
} from './show-generators.mjs';

const PRESET_LABELS = Object.freeze({
  wash: 'Wash',
  pulse: 'Pulse',
  columns: 'Columns',
  chase: 'Chase',
  flash: 'Flash',
  wave: 'Wave',
  strobe: 'Strobe',
  sparkle: 'Sparkle',
  spiral: 'Spiral',
  ripple: 'Ripple',
  rain: 'Rain',
  bounce: 'Bounce',
  fire: 'Fire',
  alternate: 'Alternate',
  center: 'Center',
  sweep: 'Sweep'
});

const COLOR_ROLE_LABELS = Object.freeze([
  'Baza / Wash',
  'Sub / Bas',
  'Sint / Vokal',
  'Akcent / Udar'
]);

const ZONE_OPTIONS = Object.freeze([
  ['wings', 'Krila (L1-L3, R1-R3)'],
  ['bottomRow', 'Donji red (L3, C3, R3)'],
  ['centerCol', 'Srednji stupac (C1-C3)'],
  ['upperCross', 'Gornji križ bez C3 (C1, L2, C2, R2)'],
  ['cross', 'Puni križ (C1, L2, C2, R2, C3)'],
  ['crossNoCenter', 'Vanjski križ (C1, L2, R2, C3)'],
  ['perimeter', 'Rub / Perimeter (8 barova)'],
  ['corners', 'Kutevi (L1, R1, L3, R3)'],
  ['topRow', 'Gornji red (L1, C1, R1)'],
  ['midRow', 'Srednji red (L2, C2, R2)'],
  ['leftCol', 'Lijevi stupac (L1-L3)'],
  ['rightCol', 'Desni stupac (R1-R3)'],
  ['center', 'Samo centar (C2)'],
  ['all', 'Svi barovi (3×3 sve)']
]);

const LAYER_META = Object.freeze([
  { id: 'base-wash', label: '1. Atmosfera i baza', color: '#3aa0ff' },
  { id: 'bass', label: '2. Sub i bas', color: '#b25cff' },
  { id: 'synth', label: '3. Sint i vokal', color: '#00d2ff' },
  { id: 'motion', label: '4. Ritam i kretanje', color: '#ffb23a' },
  { id: 'drums', label: '5. Akcenti i stroboskop', color: '#ff5c8a' }
]);

function rgbToHex(color = [0.2, 0.6, 1, 0]) {
  const [r = 0, g = 0, b = 0] = color;
  const h = v => Math.round(clamp(v, 0, 1) * 255).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

function hexToRgbw(hex, w = 0) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return [0.2, 0.6, 1, clamp(Number(w) || 0, 0, 1)];
  const n = parseInt(m[1], 16);
  return [
    ((n >> 16) & 255) / 255,
    ((n >> 8) & 255) / 255,
    (n & 255) / 255,
    clamp(Number(w) || 0, 0, 1)
  ];
}

function fmtSec(sec) {
  const s = Math.max(0, Number(sec) || 0);
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${String(r).padStart(2, '0')}`;
}

export function createAutoShowPanel(host, ctx) {
  const sharedOptions = ctx.getShowOptions ? ctx.getShowOptions() : {};
  let config = mergePipelineConfig(DEFAULT_PIPELINE_CONFIG, {
    theme: sharedOptions.theme || DEFAULT_PIPELINE_CONFIG.theme,
    customColors: sharedOptions.customColors || null,
    allowedPresets: sharedOptions.allowedPresets ? [...sharedOptions.allowedPresets] : [...TIMELINE_PRESETS]
  });

  let sharedGenerators = [];
  let autoRegenerate = false;
  let vibecodeOpen = false;
  let gitModalOpen = false;
  let detectDetailsOpen = false;
  let lastSecAnchor = null;
  let regenTimer = null;

  const getSelectedSections = () => {
    const raw = ctx.getSelectedSections ? ctx.getSelectedSections() : [];
    return Array.isArray(raw) ? raw : [];
  };

  const setSelectedSections = indices => {
    ctx.setSelectedSections?.(indices);
    render();
  };

  const syncToSharedOptions = () => {
    const target = ctx.getShowOptions ? ctx.getShowOptions() : null;
    if (!target) return;
    target.theme = config.theme;
    target.customColors = Array.isArray(config.customColors)
      ? config.customColors.map(c => [...c])
      : (PALETTES[config.theme] || PALETTES.midnight).map(c => [...c]);
    target.allowedPresets = new Set(config.allowedPresets);
    target.pipelineConfig = config;
  };

  const getActiveColors = () => {
    if (Array.isArray(config.customColors) && config.customColors.length === 4) {
      return config.customColors;
    }
    const base = PALETTES[config.theme] || PALETTES.midnight;
    return base.map(c => [...c]);
  };

  const fetchSharedGenerators = async () => {
    if (typeof fetch !== 'function') return;
    try {
      const res = await fetch('/api/generators');
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data?.shared)) {
        sharedGenerators = data.shared;
        render();
      }
    } catch {}
  };

  const triggerRegenerate = (recomputeSections = false, label = 'Auto Show Studio regeneracija', forceFullShow = false) => {
    const analysis = ctx.getAnalysis ? ctx.getAnalysis() : null;
    if (!analysis) {
      ctx.onStatus?.('Nema učitane audio analize za generiranje showa.', true);
      return;
    }
    try {
      syncToSharedOptions();
      const selSecs = (!recomputeSections && !forceFullShow) ? getSelectedSections() : [];
      const existingTimeline = ctx.getTimeline ? ctx.getTimeline() : null;
      const isPartial = selSecs.length > 0 && existingTimeline;
      const result = runShowPipeline(
        analysis,
        {
          ...config,
          recomputeSections,
          targetSectionIndices: isPartial ? selSecs : [],
          existingTimeline: isPartial ? existingTimeline : null
        },
        sharedGenerators
      );
      const effectiveLabel = isPartial
        ? `${label} (${selSecs.length} ${selSecs.length === 1 ? 'označena dionica' : 'označene dionice'})`
        : label;
      ctx.applyGeneratedPipeline?.({
        timeline: result.timeline,
        sections: result.sections,
        config: result.config,
        label: effectiveLabel,
        saveSections: recomputeSections
      });
      render();
    } catch (err) {
      ctx.onStatus?.(`Greška pri generiranju: ${err?.message || err}`, true);
    }
  };

  const scheduleAutoRegen = (recomputeSections = false) => {
    syncToSharedOptions();
    if (!autoRegenerate) return;
    if (regenTimer) clearTimeout(regenTimer);
    regenTimer = setTimeout(() => {
      triggerRegenerate(recomputeSections, 'Live Auto-Show promjena parametra');
    }, 140);
  };

  const computeAuditMetrics = () => {
    const timeline = ctx.getTimeline ? ctx.getTimeline() : null;
    const analysis = ctx.getAnalysis ? ctx.getAnalysis() : null;
    if (!timeline || !analysis) return null;
    try {
      const contrast = measureTimelineContrast(timeline, analysis, { stepSec: 0.25 });
      const blackout = measurePreDropBlackout(timeline, analysis);
      const totalClips = (timeline.layers || []).reduce((s, l) => s + (l.clips?.length || 0), 0);
      return { contrast, blackout, totalClips };
    } catch {
      return null;
    }
  };

  const makeRangeRow = (labelText, valueText, inputAttrs, onInput) => {
    const valSpan = el('span', { class: 'as-param-val' }, valueText);
    const input = el('input', {
      type: 'range',
      class: 'as-range',
      ...inputAttrs,
      oninput: e => {
        const v = Number(e.target.value);
        onInput(v, valSpan);
      }
    });
    return el('label', { class: 'as-param-row' },
      el('div', { class: 'as-param-head' },
        el('span', { class: 'as-param-lbl' }, labelText),
        valSpan
      ),
      input
    );
  };

  const render = () => {
    host.replaceChildren();
    const analysis = ctx.getAnalysis ? ctx.getAnalysis() : null;
    const timeline = ctx.getTimeline ? ctx.getTimeline() : null;
    const track = ctx.getTrack ? ctx.getTrack() : null;
    const allGenerators = [...BUILT_IN_GENERATORS, ...sharedGenerators];
    const currentGen = allGenerators.find(g => g.id === config.generatorId) || BUILT_IN_GENERATORS[0];
    const activeColors = getActiveColors();
    const audit = computeAuditMetrics();

    // ─── TOP ACTION & GENERATOR BAR ───
    const genSelect = el('select', {
      id: 'autoshow-generator-select',
      class: 'as-select as-gen-select',
      onchange: e => {
        const nextId = e.target.value;
        config = resolveGeneratorConfig(nextId, {}, sharedGenerators);
        syncToSharedOptions();
        render();
        if (autoRegenerate) triggerRegenerate(false, `Algoritam: ${nextId}`);
      }
    },
      el('optgroup', { label: 'Ugrađeni algoritmi (Built-in)' },
        ...BUILT_IN_GENERATORS.map(g =>
          el('option', { value: g.id, ...(g.id === config.generatorId ? { selected: true } : {}) }, `★ ${g.name}`)
        )
      ),
      ...(sharedGenerators.length
        ? [el('optgroup', { label: 'Git dijeljeni algoritmi (generators/)' },
            ...sharedGenerators.map(g =>
              el('option', { value: g.id, ...(g.id === config.generatorId ? { selected: true } : {}) }, `🌐 ${g.name} (${g.author || 'Git'})`)
            )
          )]
        : [])
    );

    const importFileInput = el('input', {
      type: 'file',
      accept: '.json,.generator.json',
      hidden: true,
      onchange: async e => {
        const file = e.target.files?.[0];
        if (!file) return;
        try {
          const text = await file.text();
          const parsed = JSON.parse(text);
          const check = validateGeneratorSpec(parsed);
          if (!check.valid) throw new Error(check.errors.join(' '));
          config = mergePipelineConfig(DEFAULT_PIPELINE_CONFIG, {
            ...(parsed.config || {}),
            generatorId: parsed.id,
            ...(parsed.customJsCode ? { customJsCode: parsed.customJsCode, useCustomJsCode: Boolean(parsed.useCustomJsCode) } : {})
          });
          if (!sharedGenerators.some(g => g.id === parsed.id) && !BUILT_IN_GENERATORS.some(g => g.id === parsed.id)) {
            sharedGenerators.push({ ...parsed, builtin: false });
          }
          syncToSharedOptions();
          ctx.onStatus?.(`Uvezen generator „${parsed.name}”.`);
          render();
          if (autoRegenerate) triggerRegenerate(false, `Uvezen generator: ${parsed.name}`);
        } catch (err) {
          ctx.onStatus?.(`Neuspješan uvoz .generator.json: ${err?.message || err}`, true);
        }
      }
    });

    const selectedSections = getSelectedSections();

    const topBar = el('div', { class: 'as-studio-topbar' },
      el('div', { class: 'as-topbar-left' },
        el('span', { class: 'as-badge-title' }, '✦ AUTO SHOW & PIPELINE STUDIO'),
        genSelect,
        el('span', { class: 'as-gen-desc', title: currentGen.description }, currentGen.description)
      ),
      el('div', { class: 'as-topbar-actions' },
        el('label', { class: 'as-live-toggle', title: 'Automatski regeneriraj show (ili označene dionice) pri svakoj promjeni klizača' },
          el('input', {
            type: 'checkbox',
            checked: autoRegenerate,
            onchange: e => { autoRegenerate = e.target.checked; }
          }),
          'Live regeneracija'
        ),
        el('button', {
          type: 'button',
          id: 'autoshow-regenerate-btn',
          class: 'primary as-regen-btn',
          disabled: !analysis,
          title: selectedSections.length
            ? `Regeneriraj samo označene dionice (${selectedSections.length}) prema trenutnim postavkama`
            : 'Regeneriraj cijeli show prema trenutno fine-tuneanim dionicama',
          onclick: () => triggerRegenerate(false, `Auto Show (${currentGen.name})`, false)
        }, selectedSections.length
          ? `⚡ Regeneriraj označene dionice (${selectedSections.length})`
          : '⚡ Regeneriraj show (prema dionicama)'),
        ...(selectedSections.length
          ? [
              el('button', {
                type: 'button',
                id: 'autoshow-regenerate-full-btn',
                class: 'ghost',
                disabled: !analysis,
                title: 'Regeneriraj cijeli show prema fine-tuneanim dionicama (neovisno o selekciji)',
                onclick: () => triggerRegenerate(false, `Auto Show cijeli (${currentGen.name})`, true)
              }, '⚡ Cijeli show'),
              el('button', {
                type: 'button',
                id: 'autoshow-clear-sel-btn',
                class: 'ghost',
                title: 'Odznači sve dionice',
                onclick: () => setSelectedSections([])
              }, `✕ Odznači (${selectedSections.length})`)
            ]
          : []),
        el('button', {
          type: 'button',
          id: 'autoshow-vibecode-toggle',
          class: `ghost ${vibecodeOpen ? 'active' : ''}`,
          onclick: () => { vibecodeOpen = !vibecodeOpen; render(); }
        }, vibecodeOpen ? '💻 Zatvori Vibecode JS' : '💻 Vibecode JS & AI Prompt'),
        el('button', {
          type: 'button',
          id: 'autoshow-save-git-btn',
          class: 'ghost',
          title: 'Spremi ovaj algoritam u studio-light-baseline/app/generators/ za dijeljenje preko GitHuba',
          onclick: () => { gitModalOpen = !gitModalOpen; render(); }
        }, '🌐 Spremi u Git (generators/)'),
        el('button', {
          type: 'button',
          class: 'ghost',
          title: 'Preuzmi .generator.json datoteku',
          onclick: () => {
            const spec = serializeGeneratorSpec({
              id: `${config.generatorId}-custom`,
              name: `${currentGen.name} (Custom)`,
              author: 'Timon / LEDicated',
              description: currentGen.description
            }, config);
            const blob = new Blob([`${JSON.stringify(spec, null, 2)}\n`], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = el('a', { href: url, download: `${spec.id}.generator.json` });
            a.click();
            URL.revokeObjectURL(url);
          }
        }, '⬇ Izvezi .json'),
        el('button', {
          type: 'button',
          class: 'ghost',
          title: 'Uvezi .generator.json datoteku',
          onclick: () => importFileInput.click()
        }, '⬆ Uvezi .json'),
        el('button', {
          type: 'button',
          class: 'ghost',
          title: 'Vrati sve postavke na tvorničke vrijednosti odabranog algoritma (čuva fine-tuneane dionice)',
          onclick: () => {
            config = resolveGeneratorConfig(config.generatorId, {}, sharedGenerators);
            syncToSharedOptions();
            render();
            if (autoRegenerate) triggerRegenerate(false, 'Reset parametara pipelinea');
          }
        }, '↺ Reset'),
        importFileInput
      )
    );

    // ─── OPTIONAL GIT SAVE DRAWER ───
    let gitDrawer = null;
    if (gitModalOpen) {
      const nameInput = el('input', {
        type: 'text',
        class: 'as-text-input',
        placeholder: 'Naziv algoritma (npr. Moj Klupski Matrix)',
        value: currentGen.builtin ? `${currentGen.name} Custom` : currentGen.name
      });
      const idInput = el('input', {
        type: 'text',
        class: 'as-text-input',
        placeholder: 'id-algoritma (npr. moj-klupski-matrix)',
        value: currentGen.builtin ? `${config.generatorId}-v2` : config.generatorId
      });
      const authorInput = el('input', {
        type: 'text',
        class: 'as-text-input',
        placeholder: 'Autor / GitHub handle',
        value: currentGen.author || 'LEDicated Studio'
      });
      const descInput = el('input', {
        type: 'text',
        class: 'as-text-input',
        placeholder: 'Kratki opis algoritma i stila...',
        value: currentGen.description || ''
      });

      gitDrawer = el('div', { class: 'as-git-drawer' },
        el('div', { class: 'as-git-drawer-head' },
          el('strong', {}, '🌐 Spremi algoritam u Git mapu (studio-light-baseline/app/generators/)'),
          el('span', { class: 'muted' }, 'Datoteka .generator.json se sprema na disk i odmah je spremna za git commit / push i dijeljenje.')
        ),
        el('div', { class: 'as-git-form-grid' },
          el('label', {}, 'Naziv algoritma', nameInput),
          el('label', {}, 'ID datoteke (.generator.json)', idInput),
          el('label', {}, 'Autor', authorInput),
          el('label', {}, 'Opis', descInput)
        ),
        el('div', { class: 'as-git-drawer-actions' },
          el('button', {
            type: 'button',
            class: 'primary',
            onclick: async () => {
              try {
                const spec = serializeGeneratorSpec({
                  id: idInput.value,
                  name: nameInput.value,
                  author: authorInput.value,
                  description: descInput.value
                }, config);
                const res = await fetch('/api/generators/save', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ meta: spec, config })
                });
                const data = await res.json();
                if (!res.ok || !data?.ok) throw new Error(data?.error || 'Spremanje nije uspjelo');
                config.generatorId = data.generator.id;
                gitModalOpen = false;
                await fetchSharedGenerators();
                ctx.onStatus?.(`Algoritam spremljen u ${data.path} — spreman za GitHub dijeljenje!`);
                render();
              } catch (err) {
                ctx.onStatus?.(`Greška pri spremanju generatora: ${err?.message || err}`, true);
              }
            }
          }, '💾 Spremi .generator.json u generators/'),
          el('button', {
            type: 'button',
            class: 'ghost',
            onclick: () => { gitModalOpen = false; render(); }
          }, 'Odustani')
        )
      );
    }

    // ─── OPTIONAL VIBECODE JS EDITOR DRAWER ───
    let vibecodeDrawer = null;
    if (vibecodeOpen) {
      const codeArea = el('textarea', {
        id: 'autoshow-vibecode-textarea',
        class: 'as-vibecode-textarea',
        rows: 10,
        spellcheck: 'false',
        value: config.customJsCode || DEFAULT_VIBECODE_TEMPLATE,
        oninput: e => {
          config.customJsCode = e.target.value;
        }
      });

      vibecodeDrawer = el('div', { class: 'as-vibecode-drawer' },
        el('div', { class: 'as-vibecode-head' },
          el('div', {},
            el('strong', {}, '💻 Vibecode JS Pipeline Editor '),
            el('span', { class: 'muted' }, 'Napiši vlastitu funkciju generateShow(analysis, config, api) ili kopiraj prompt u Claude / Cursor / ChatGPT.')
          ),
          el('div', { class: 'as-vibecode-actions' },
            el('label', { class: 'as-live-toggle' },
              el('input', {
                type: 'checkbox',
                checked: Boolean(config.useCustomJsCode),
                onchange: e => {
                  config.useCustomJsCode = e.target.checked;
                  if (config.useCustomJsCode && !config.customJsCode) {
                    config.customJsCode = DEFAULT_VIBECODE_TEMPLATE;
                  }
                  render();
                }
              }),
              'Koristi ovaj JS kod pri generiranju'
            ),
            el('button', {
              type: 'button',
              class: 'ghost',
              onclick: async () => {
                const promptText = buildVibecodePrompt(config);
                try {
                  await navigator.clipboard.writeText(promptText);
                  ctx.onStatus?.('📋 AI Vibecode Prompt kopiran u međuspremnik!');
                } catch {
                  ctx.onStatus?.('Prompt generiran.');
                }
              }
            }, '📋 Kopiraj AI Vibecode Prompt'),
            el('button', {
              type: 'button',
              class: 'primary',
              disabled: !analysis,
              onclick: () => {
                config.useCustomJsCode = true;
                config.customJsCode = codeArea.value;
                triggerRegenerate(false, 'Vibecode Custom JS Show');
              }
            }, '▶ Izvrši JS Generator na pjesmi')
          )
        ),
        codeArea
      );
    }

    // ─── CARD 1: TEMA, 4× RGBW PALETA (S W KANALOM) & 16 EFEKATA ───
    const themeSelect = el('select', {
      id: 'autoshow-theme-select',
      class: 'as-select',
      onchange: e => {
        config.theme = e.target.value;
        config.customColors = (PALETTES[config.theme] || PALETTES.midnight).map(c => [...c]);
        scheduleAutoRegen(false);
        render();
      }
    }, ...SHOW_THEMES.map(t =>
      el('option', { value: t.id, ...(t.id === config.theme ? { selected: true } : {}) }, `${t.name} — ${t.description}`)
    ));

    const colorRows = activeColors.map((col, idx) => {
      const hex = rgbToHex(col);
      const wVal = clamp(Number(col[3] || 0), 0, 1);
      const wSpan = el('span', { class: 'as-w-val' }, `W ${Math.round(wVal * 100)}%`);
      return el('div', { class: 'as-color-role-row' },
        el('span', { class: 'as-color-role-lbl' }, COLOR_ROLE_LABELS[idx] || `Boja ${idx + 1}`),
        el('input', {
          type: 'color',
          class: 'as-color-picker',
          value: hex,
          oninput: e => {
            const nextColors = getActiveColors();
            nextColors[idx] = hexToRgbw(e.target.value, nextColors[idx][3] || 0);
            config.customColors = nextColors;
            scheduleAutoRegen(false);
          }
        }),
        el('input', {
          type: 'range',
          class: 'as-range as-w-range',
          min: 0,
          max: 1,
          step: 0.02,
          value: wVal,
          title: 'Udio tople bijele (W) diode u ovoj boji palete',
          oninput: e => {
            const nextW = Number(e.target.value);
            wSpan.textContent = `W ${Math.round(nextW * 100)}%`;
            const nextColors = getActiveColors();
            nextColors[idx] = [nextColors[idx][0], nextColors[idx][1], nextColors[idx][2], nextW];
            config.customColors = nextColors;
            scheduleAutoRegen(false);
          }
        }),
        wSpan
      );
    });

    const presetSet = new Set(config.allowedPresets);
    const presetChips = TIMELINE_PRESETS.map(preset => {
      const isSelected = presetSet.has(preset);
      return el('button', {
        type: 'button',
        class: `as-preset-chip ${isSelected ? 'active' : ''}`,
        onclick: () => {
          if (presetSet.has(preset) && presetSet.size > 1) {
            presetSet.delete(preset);
          } else {
            presetSet.add(preset);
          }
          config.allowedPresets = [...presetSet];
          scheduleAutoRegen(false);
          render();
        }
      }, PRESET_LABELS[preset] || preset);
    });

    const cardPalette = el('section', { class: 'as-card' },
      el('header', { class: 'as-card-head' },
        el('strong', {}, '2. Tema, RGBW Paleta i 16 Efekata'),
        el('span', { class: 'muted' }, `${config.allowedPresets.length}/16 aktivnih`)
      ),
      el('label', { class: 'as-field-lbl' }, 'Vizualna tema palete', themeSelect),
      el('div', { class: 'as-color-roles-list' }, ...colorRows),
      el('div', { class: 'as-preset-filter-bar' },
        el('span', { class: 'muted' }, 'Dopušteni efekti:'),
        el('div', { class: 'as-mini-btns' },
          el('button', {
            type: 'button',
            class: 'ghost small',
            onclick: () => {
              config.allowedPresets = [...TIMELINE_PRESETS];
              scheduleAutoRegen(false);
              render();
            }
          }, 'Svi (16)'),
          el('button', {
            type: 'button',
            class: 'ghost small',
            onclick: () => {
              const t = SHOW_THEMES.find(x => x.id === config.theme);
              config.allowedPresets = t?.defaultPresets ? [...t.defaultPresets] : [...TIMELINE_PRESETS];
              scheduleAutoRegen(false);
              render();
            }
          }, 'Po temi'),
          el('button', {
            type: 'button',
            class: 'ghost small',
            onclick: () => {
              config.allowedPresets = TIMELINE_PRESETS.filter(p => p !== 'strobe' && p !== 'flash');
              scheduleAutoRegen(false);
              render();
            }
          }, 'Bez stroboskopa')
        )
      ),
      el('div', { class: 'as-preset-grid' }, ...presetChips)
    );

    // ─── CARD 1: STRUKTURA & FINE-TUNING DIONICA (detectSections + Selekcija) ───
    const sd = config.sectionDetection;
    const sections = analysis?.sections || [];

    const phraseSelect = el('select', {
      class: 'as-select',
      onchange: e => {
        const val = e.target.value;
        config.sectionDetection.phraseBars = val === 'auto' ? 'auto' : Number(val);
      }
    },
      el('option', { value: 'auto', ...(sd.phraseBars === 'auto' ? { selected: true } : {}) }, 'Auto (4 takta / 2 za kratke)'),
      el('option', { value: '2', ...(Number(sd.phraseBars) === 2 ? { selected: true } : {}) }, '2 takta (brze promjene)'),
      el('option', { value: '4', ...(Number(sd.phraseBars) === 4 ? { selected: true } : {}) }, '4 takta (standardna fraza)'),
      el('option', { value: '8', ...(Number(sd.phraseBars) === 8 ? { selected: true } : {}) }, '8 taktova (duge makro-dionice)')
    );

    const handleSectionRowClick = (idx, event) => {
      if (event.target.closest('select, button')) return;
      const isToggle = event.metaKey || event.ctrlKey;
      const isRange = event.shiftKey;
      const cur = getSelectedSections();
      if (isRange && lastSecAnchor != null) {
        const lo = Math.min(lastSecAnchor, idx);
        const hi = Math.max(lastSecAnchor, idx);
        const range = [];
        for (let k = lo; k <= hi; k += 1) range.push(k);
        setSelectedSections(isToggle ? [...cur, ...range] : range);
      } else if (isToggle) {
        if (cur.includes(idx)) {
          setSelectedSections(cur.filter(i => i !== idx));
        } else {
          setSelectedSections([...cur, idx]);
        }
        lastSecAnchor = idx;
      } else {
        if (cur.length === 1 && cur[0] === idx) {
          setSelectedSections([]);
          lastSecAnchor = null;
        } else {
          setSelectedSections([idx]);
          lastSecAnchor = idx;
        }
      }
    };

    const sectionRows = sections.map((sec, idx) => {
      const isSelected = selectedSections.includes(idx);
      return el('div', {
        class: `as-sec-item ${isSelected ? 'selected' : ''}`,
        style: `border-left: 3px solid ${SECTION_COLORS[sec.type] || '#3a86ff'}`,
        title: 'Klik = označi dionicu za ciljanu regeneraciju · Shift+Klik = raspon · Cmd/Ctrl+Klik = više dionica',
        onclick: e => handleSectionRowClick(idx, e)
      },
        el('span', { class: 'as-sec-sel-dot' }, isSelected ? '✓' : `${idx + 1}.`),
        el('span', { class: 'as-sec-time' }, `${fmtSec(sec.startSec)}–${fmtSec(sec.endSec ?? (sec.startSec + sec.durationSec))}`),
        el('select', {
          class: 'as-sec-type-select',
          onchange: e => {
            const newType = e.target.value;
            const nextSecs = sections.map((s, i) => i === idx ? {
              ...s,
              type: newType,
              name: SECTION_NAMES[newType] || s.name,
              color: SECTION_COLORS[newType] || s.color
            } : s);
            ctx.onUpdateSections?.(nextSecs);
            ctx.onRegenerateSection?.(idx, newType, config);
            render();
          }
        }, ...SECTION_TYPES.map(t =>
          el('option', { value: t, ...(t === sec.type ? { selected: true } : {}) }, SECTION_NAMES[t] || t)
        )),
        el('button', {
          type: 'button',
          class: 'ghost small',
          title: 'Loopaj ovu dionicu',
          onclick: () => ctx.onLoopSection?.(sec)
        }, 'Loop'),
        el('button', {
          type: 'button',
          class: 'ghost small',
          title: 'Regeneriraj samo ovu dionicu s trenutnim postavkama pipelinea',
          onclick: () => {
            ctx.onRegenerateSection?.(idx, sec.type, config);
            render();
          }
        }, '↻')
      );
    });

    const detectDetails = el('details', {
      class: 'as-detect-details',
      ...(detectDetailsOpen ? { open: true } : {}),
      ontoggle: e => { detectDetailsOpen = e.target.open; }
    },
      el('summary', { class: 'as-detect-summary' }, '⚙ Postavke automatske detekcije iz audia (detectSections)'),
      el('div', { class: 'as-detect-body' },
        el('label', { class: 'as-field-lbl' }, 'Osnovna jedinica fraze', phraseSelect),
        makeRangeRow(
          'Prag RMS energije za Drop',
          `${Math.round(sd.dropRmsThreshold * 100)}%`,
          { min: 0.45, max: 0.92, step: 0.01, value: sd.dropRmsThreshold },
          (v, span) => {
            config.sectionDetection.dropRmsThreshold = v;
            span.textContent = `${Math.round(v * 100)}%`;
          }
        ),
        makeRangeRow(
          'Prag sub-basa za Drop',
          `${Math.round(sd.dropBassThreshold * 100)}%`,
          { min: 0.30, max: 0.85, step: 0.01, value: sd.dropBassThreshold },
          (v, span) => {
            config.sectionDetection.dropBassThreshold = v;
            span.textContent = `${Math.round(v * 100)}%`;
          }
        ),
        makeRangeRow(
          'Osjetljivost rasta Gradnje (Build)',
          `×${sd.buildRampThreshold.toFixed(2)}`,
          { min: 1.02, max: 1.35, step: 0.01, value: sd.buildRampThreshold },
          (v, span) => {
            config.sectionDetection.buildRampThreshold = v;
            span.textContent = `×${v.toFixed(2)}`;
          }
        ),
        makeRangeRow(
          'Prag spuštanja za Breakdown',
          `${Math.round(sd.breakdownThreshold * 100)}%`,
          { min: 0.20, max: 0.70, step: 0.01, value: sd.breakdownThreshold },
          (v, span) => {
            config.sectionDetection.breakdownThreshold = v;
            span.textContent = `${Math.round(v * 100)}%`;
          }
        ),
        el('div', { class: 'as-inline-checks' },
          el('label', { class: 'as-check-lbl' },
            el('input', {
              type: 'checkbox',
              checked: sd.snapDropToBeat !== false,
              onchange: e => {
                config.sectionDetection.snapDropToBeat = e.target.checked;
              }
            }),
            '1-Beat Drop Snap (nakon fakeouta)'
          )
        ),
        el('div', { class: 'as-detect-actions' },
          el('button', {
            type: 'button',
            id: 'autoshow-redetect-only-btn',
            class: 'ghost small',
            disabled: !analysis,
            title: 'Prebriši ručne promjene dionica i ponovno detektiraj iz audia',
            onclick: () => {
              if (!analysis) return;
              const nextSecs = detectSections(analysis, config.sectionDetection);
              setSelectedSections([]);
              ctx.onUpdateSections?.(nextSecs);
              if (autoRegenerate) triggerRegenerate(false, 'Ponovna detekcija dionica', true);
              else render();
            }
          }, '↻ Ponovno detektiraj dionice iz audia'),
          el('button', {
            type: 'button',
            id: 'autoshow-redetect-regen-btn',
            class: 'ghost small',
            disabled: !analysis,
            title: 'Ponovno detektiraj dionice iz audia i odmah regeneriraj cijeli show',
            onclick: () => {
              setSelectedSections([]);
              triggerRegenerate(true, 'Redetekcija dionica + Auto Show', true);
            }
          }, '↻ Redetektiraj + Regeneriraj sve')
        )
      )
    );

    const cardSections = el('section', { class: 'as-card' },
      el('header', { class: 'as-card-head' },
        el('strong', {}, '1. Struktura i Fine-Tuning Dionica'),
        el('span', { class: 'muted' }, selectedSections.length ? `${selectedSections.length} označeno` : `${sections.length} dionica`)
      ),
      el('div', { class: 'as-sel-banner' },
        selectedSections.length
          ? el('div', { class: 'as-sel-active-row' },
              el('span', {}, `✓ Označeno za regeneraciju: ${selectedSections.map(i => sections[i]?.name || `#${i + 1}`).join(', ')}`),
              el('button', {
                type: 'button',
                class: 'ghost small',
                onclick: () => setSelectedSections([])
              }, 'Sve dionice')
            )
          : el('span', { class: 'muted' }, 'Povuci granicu u gornjem timelineu (klipovi prate pomak). Klikni / Shift+Klik / Cmd+Klik na dionicu za ciljanu regeneraciju.')
      ),
      el('div', { class: 'as-sec-list-wrap' },
        sections.length
          ? el('div', { class: 'as-sec-list' }, ...sectionRows)
          : el('p', { class: 'muted' }, 'Odaberi pjesmu za prikaz i uređivanje dionica.')
      ),
      detectDetails
    );

    // ─── CARD 3: DRAMATURGIJA, KONTRAST & W-KANAL (createAutoShow) ───
    const wModeSelect = el('select', {
      class: 'as-select',
      onchange: e => {
        config.wChannelMode = e.target.value;
        scheduleAutoRegen(false);
      }
    },
      el('option', { value: 'drop-only', ...(config.wChannelMode === 'drop-only' ? { selected: true } : {}) }, 'Samo u Dropu (RGB na strofama, max kontrast)'),
      el('option', { value: 'accents-and-drop', ...(config.wChannelMode === 'accents-and-drop' ? { selected: true } : {}) }, 'Drop + Akcenti prijelaza'),
      el('option', { value: 'always', ...(config.wChannelMode === 'always' ? { selected: true } : {}) }, 'Uvijek uključen W kanal'),
      el('option', { value: 'never', ...(config.wChannelMode === 'never' ? { selected: true } : {}) }, 'Nikad (čisti RGB bez tople bijele)')
    );

    const blackoutModeSelect = el('select', {
      class: 'as-select',
      onchange: e => {
        config.preDropBlackoutMode = e.target.value;
        scheduleAutoRegen(false);
        render();
      }
    },
      el('option', { value: 'auto', ...(config.preDropBlackoutMode === 'auto' ? { selected: true } : {}) }, 'Auto progresivni (Drop 1 = 1 beat, Drop 2+ = 2 beata)'),
      el('option', { value: 'fixed', ...(config.preDropBlackoutMode === 'fixed' ? { selected: true } : {}) }, 'Fiksni broj beatova prije svakog dropa'),
      el('option', { value: 'none', ...(config.preDropBlackoutMode === 'none' ? { selected: true } : {}) }, 'Bez pre-drop blackouta (0 beatova)')
    );

    const dropRhythmSelect = el('select', {
      class: 'as-select',
      onchange: e => {
        config.dropRhythmStyle = e.target.value;
        scheduleAutoRegen(false);
      }
    },
      el('option', { value: 'auto', ...(config.dropRhythmStyle === 'auto' ? { selected: true } : {}) }, 'Auto (Drop 1 Pulse, Drop 2+ 2-Beat Alternate/Columns)'),
      el('option', { value: 'pulse', ...(config.dropRhythmStyle === 'pulse' ? { selected: true } : {}) }, 'Svi dropovi: Full-Rig Kick Pulse'),
      el('option', { value: 'alternate-2beat', ...(config.dropRhythmStyle === 'alternate-2beat' ? { selected: true } : {}) }, 'Svi dropovi: 2-Beat Alternate ↔ Columns'),
      el('option', { value: 'columns', ...(config.dropRhythmStyle === 'columns' ? { selected: true } : {}) }, 'Svi dropovi: Vertikalni Columns')
    );

    const strobeRateSelect = el('select', {
      class: 'as-select',
      onchange: e => {
        config.dropStrobeRate = e.target.value;
        scheduleAutoRegen(false);
      }
    },
      el('option', { value: '1/2', ...(config.dropStrobeRate === '1/2' ? { selected: true } : {}) }, '1/2 (sporiji stroboskop)'),
      el('option', { value: '1/4', ...(config.dropStrobeRate === '1/4' ? { selected: true } : {}) }, '1/4 (klupski standard)'),
      el('option', { value: '1/8', ...(config.dropStrobeRate === '1/8' ? { selected: true } : {}) }, '1/8 (brzi festivalski)'),
      el('option', { value: '1/16', ...(config.dropStrobeRate === '1/16' ? { selected: true } : {}) }, '1/16 (hiper stroboskop)')
    );

    const cardDramaturgy = el('section', { class: 'as-card' },
      el('header', { class: 'as-card-head' },
        el('strong', {}, '3. Dramaturgija, Kontrast i W-Kanal'),
        el('span', { class: 'muted' }, 'Drop vs. Strofa')
      ),
      makeRangeRow(
        'Strop svjetline izvan Dropa (Intro/Strofa/Brk)',
        `${Math.round(config.nonDropCeiling * 100)}%`,
        { min: 0.20, max: 0.90, step: 0.01, value: config.nonDropCeiling },
        (v, span) => {
          config.nonDropCeiling = v;
          span.textContent = `${Math.round(v * 100)}%`;
          scheduleAutoRegen(false);
        }
      ),
      el('label', { class: 'as-field-lbl' }, 'Disciplina bijelog (W) kanala', wModeSelect),
      makeRangeRow(
        'Minimalni W kanal u Dropu (Drop Min W)',
        `${Math.round(config.dropMinW * 100)}%`,
        { min: 0, max: 1, step: 0.02, value: config.dropMinW },
        (v, span) => {
          config.dropMinW = v;
          span.textContent = `${Math.round(v * 100)}%`;
          scheduleAutoRegen(false);
        }
      ),
      makeRangeRow(
        'Pojačanje boje u Dropu (Drop Boost)',
        `×${config.dropColorBoost.toFixed(2)}`,
        { min: 0.80, max: 2.0, step: 0.05, value: config.dropColorBoost },
        (v, span) => {
          config.dropColorBoost = v;
          span.textContent = `×${v.toFixed(2)}`;
          scheduleAutoRegen(false);
        }
      ),
      el('label', { class: 'as-field-lbl' }, 'Pre-Drop Blackout (tišina prije Dropa)', blackoutModeSelect),
      ...(config.preDropBlackoutMode === 'fixed'
        ? [makeRangeRow(
            'Trajanje fiksnog Pre-Drop Blackouta',
            `${config.preDropBlackoutBeats} beat`,
            { min: 0.5, max: 4, step: 0.5, value: config.preDropBlackoutBeats },
            (v, span) => {
              config.preDropBlackoutBeats = v;
              span.textContent = `${v} beat`;
              scheduleAutoRegen(false);
            }
          )]
        : []),
      el('label', { class: 'as-field-lbl' }, 'Ritam glavnog Dropa', dropRhythmSelect),
      makeRangeRow(
        'Trajanje uvodnog Drop stroboskopa',
        `${config.dropStrobeDurationSec.toFixed(1)} s`,
        { min: 0, max: 16, step: 0.2, value: config.dropStrobeDurationSec },
        (v, span) => {
          config.dropStrobeDurationSec = v;
          span.textContent = `${v.toFixed(1)} s`;
          scheduleAutoRegen(false);
        }
      ),
      el('label', { class: 'as-field-lbl' }, 'Brzina Drop stroboskopa', strobeRateSelect),
      makeRangeRow(
        'Maksimalna brzina Build kulminacije',
        `×${config.buildMaxSpeed}`,
        { min: 2, max: 32, step: 2, value: config.buildMaxSpeed },
        (v, span) => {
          config.buildMaxSpeed = v;
          span.textContent = `×${v}`;
          scheduleAutoRegen(false);
        }
      ),
      makeRangeRow(
        'Globalni množitelj brzine animacija',
        `×${config.globalSpeedMultiplier.toFixed(2)}`,
        { min: 0.5, max: 2.5, step: 0.05, value: config.globalSpeedMultiplier },
        (v, span) => {
          config.globalSpeedMultiplier = v;
          span.textContent = `×${v.toFixed(2)}`;
          scheduleAutoRegen(false);
        }
      ),
      el('div', { class: 'as-inline-checks' },
        el('label', { class: 'as-check-lbl' },
          el('input', {
            type: 'checkbox',
            checked: config.dropBlinder !== false,
            onchange: e => {
              config.dropBlinder = e.target.checked;
              scheduleAutoRegen(false);
            }
          }),
          'Beat-1 White Blinder (60ms)'
        ),
        el('label', { class: 'as-check-lbl' },
          el('input', {
            type: 'checkbox',
            checked: config.buildSpiralAccel !== false,
            onchange: e => {
              config.buildSpiralAccel = e.target.checked;
              scheduleAutoRegen(false);
            }
          }),
          '4-stupanjska Build spirala (2→4→8→16)'
        )
      )
    );

    // ─── CARD 4: AUDIO GATEOVI, 3×3 ZONE, 5 SLOJEVA & AUDIT TELEMETRIJA ───
    const makeZoneSelect = (zoneKey, labelText) => el('label', { class: 'as-zone-row' },
      el('span', { class: 'as-zone-lbl' }, labelText),
      el('select', {
        class: 'as-select as-zone-select',
        onchange: e => {
          config.zones[zoneKey] = e.target.value;
          scheduleAutoRegen(false);
        }
      }, ...ZONE_OPTIONS.map(([val, lbl]) =>
        el('option', { value: val, ...(config.zones[zoneKey] === val ? { selected: true } : {}) }, lbl)
      ))
    );

    const layerRows = LAYER_META.map(meta => {
      const lc = config.layerConfig[meta.id] || { enabled: true, blend: 'add', opacity: 0.8 };
      const opSpan = el('span', { class: 'as-layer-op-val' }, `${Math.round(lc.opacity * 100)}%`);
      return el('div', { class: 'as-layer-cfg-row' },
        el('label', { class: 'as-layer-chk' },
          el('input', {
            type: 'checkbox',
            checked: lc.enabled !== false,
            onchange: e => {
              config.layerConfig[meta.id] = { ...lc, enabled: e.target.checked };
              scheduleAutoRegen(false);
            }
          }),
          el('span', { style: `color:${meta.color};font-weight:600` }, meta.label)
        ),
        el('select', {
          class: 'as-select as-blend-select',
          onchange: e => {
            config.layerConfig[meta.id] = { ...lc, blend: e.target.value };
            scheduleAutoRegen(false);
          }
        }, ...TIMELINE_BLENDS.map(b =>
          el('option', { value: b, ...(lc.blend === b ? { selected: true } : {}) }, b)
        )),
        el('input', {
          type: 'range',
          class: 'as-range as-layer-range',
          min: 0.1,
          max: 1,
          step: 0.02,
          value: lc.opacity,
          oninput: e => {
            const v = Number(e.target.value);
            opSpan.textContent = `${Math.round(v * 100)}%`;
            config.layerConfig[meta.id] = { ...config.layerConfig[meta.id], opacity: v };
            scheduleAutoRegen(false);
          }
        }),
        opSpan
      );
    });

    const auditBox = audit
      ? el('div', { class: 'as-audit-box' },
          el('div', { class: 'as-audit-metric' },
            el('span', { class: 'muted' }, 'Drop / Strofa kontrast'),
            el('strong', {}, `×${(audit.contrast.dropToVerseRatio || 1).toFixed(2)}`)
          ),
          el('div', { class: 'as-audit-metric' },
            el('span', { class: 'muted' }, 'Duty Cycle (prosjek)'),
            el('strong', {}, `${Math.round((audit.contrast.overallMeanDuty || 0) * 100)}%`)
          ),
          el('div', { class: 'as-audit-metric' },
            el('span', { class: 'muted' }, 'Drop vs Ostalo barovi'),
            el('strong', {}, `${(audit.contrast.dropMeanActiveBars || 0).toFixed(1)} vs ${(audit.contrast.nonDropMeanActiveBars || 0).toFixed(1)} / 9`)
          ),
          el('div', { class: 'as-audit-metric' },
            el('span', { class: 'muted' }, 'Ukupno klipova'),
            el('strong', {}, `${audit.totalClips}`)
          )
        )
      : el('div', { class: 'as-audit-box muted' }, 'Učitaj pjesmu za live izračun kontrasta i duty cyclea.');

    const cardGatesAndZones = el('section', { class: 'as-card' },
      el('header', { class: 'as-card-head' },
        el('strong', {}, '4. Audio Gateovi, 3×3 Zone, 5 Slojeva & Audit'),
        el('span', { class: 'muted' }, track ? track.title : 'Nema pjesme')
      ),
      makeRangeRow(
        `Kick Gate prag (${config.kickGate.lowHz}–${config.kickGate.highHz} Hz)`,
        `${Math.round(config.kickGate.threshold * 100)}%`,
        { min: 0.20, max: 0.88, step: 0.01, value: config.kickGate.threshold },
        (v, span) => {
          config.kickGate.threshold = v;
          span.textContent = `${Math.round(v * 100)}%`;
          scheduleAutoRegen(false);
        }
      ),
      makeRangeRow(
        `Snare Gate prag (${config.snareGate.lowHz}–${config.snareGate.highHz} Hz)`,
        `${Math.round(config.snareGate.threshold * 100)}%`,
        { min: 0.20, max: 0.88, step: 0.01, value: config.snareGate.threshold },
        (v, span) => {
          config.snareGate.threshold = v;
          span.textContent = `${Math.round(v * 100)}%`;
          scheduleAutoRegen(false);
        }
      ),
      makeRangeRow(
        `Vocal Follow prag (${config.vocalFollow.lowHz}–${config.vocalFollow.highHz} Hz)`,
        `${Math.round(config.vocalFollow.threshold * 100)}%`,
        { min: 0.15, max: 0.80, step: 0.01, value: config.vocalFollow.threshold },
        (v, span) => {
          config.vocalFollow.threshold = v;
          span.textContent = `${Math.round(v * 100)}%`;
          scheduleAutoRegen(false);
        }
      ),
      makeRangeRow(
        'Osjetljivost audio drivera (Driver Gain)',
        `×${config.driverGainScale.toFixed(2)}`,
        { min: 0.50, max: 1.80, step: 0.05, value: config.driverGainScale },
        (v, span) => {
          config.driverGainScale = v;
          span.textContent = `×${v.toFixed(2)}`;
          scheduleAutoRegen(false);
        }
      ),
      el('div', { class: 'as-zones-block' },
        el('div', { class: 'as-subhead' }, 'Prostorno mapiranje 3×3 matrice'),
        makeZoneSelect('washZone', 'Wash / Krila:'),
        makeZoneSelect('bassZone', 'Sub-Bas zona:'),
        makeZoneSelect('vocalZone', 'Vokal / Sint:'),
        makeZoneSelect('strobeZone', 'Drop Strobe:'),
        makeZoneSelect('accentZone', 'Snare Akcenti:')
      ),
      el('div', { class: 'as-layers-block' },
        el('div', { class: 'as-subhead' }, '5 Slojeva (Blend & Opacity)'),
        ...layerRows
      ),
      auditBox
    );

    const grid = el('div', { class: 'as-studio-grid' },
      cardSections,
      cardPalette,
      cardDramaturgy,
      cardGatesAndZones
    );

    host.append(
      topBar,
      ...(gitDrawer ? [gitDrawer] : []),
      ...(vibecodeDrawer ? [vibecodeDrawer] : []),
      grid
    );
  };

  fetchSharedGenerators();
  render();

  return {
    render,
    getConfig: () => config,
    setConfig: next => {
      config = mergePipelineConfig(config, next);
      syncToSharedOptions();
      render();
    },
    refreshGenerators: fetchSharedGenerators
  };
}
