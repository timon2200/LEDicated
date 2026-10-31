/** Modular Show Generator & Pipeline Registry for LEDicated Studio.
 * Enables parameterizing every stage of the MP3 -> Light Show pipeline,
 * switching between built-in or community Git-shared algorithms (.generator.json),
 * and vibecoding custom JavaScript show generators.
 */
import { BAR_IDS, PIXELS_PER_BAR } from './engine.mjs';
import {
  TIMELINE_PRESETS,
  TIMELINE_BLENDS,
  PALETTES,
  SHOW_THEMES,
  ZONES,
  createAutoShow,
  regenerateSectionClips,
  validateTimeline
} from './timeline.mjs';
import {
  SECTION_TYPES,
  SECTION_NAMES,
  SECTION_COLORS,
  DEFAULT_SECTION_DETECTION_OPTIONS,
  detectSections
} from './audio-sections.mjs';

export const GENERATOR_SCHEMA_VERSION = 1;

export const DEFAULT_PIPELINE_CONFIG = Object.freeze({
  generatorId: 'club-5layer-pro',
  theme: 'midnight',
  customColors: null,
  allowedPresets: Object.freeze([...TIMELINE_PRESETS]),
  energy: 0.85,
  nonDropCeiling: 0.55,
  wChannelMode: 'drop-only', // 'drop-only' | 'accents-and-drop' | 'always' | 'never'
  dropMinW: 0.40,
  dropColorBoost: 1.25,
  preDropBlackoutMode: 'auto', // 'auto' | 'fixed' | 'none'
  preDropBlackoutBeats: 1,
  dropBlinder: true,
  dropStrobeDurationSec: 6.32,
  dropStrobeRate: '1/4', // '1/2' | '1/4' | '1/8' | '1/16'
  dropRhythmStyle: 'auto', // 'auto' | 'pulse' | 'alternate-2beat' | 'columns'
  buildSpiralAccel: true,
  buildMaxSpeed: 16,
  globalSpeedMultiplier: 1.0,
  driverGainScale: 1.0,
  sectionDetection: Object.freeze({
    ...DEFAULT_SECTION_DETECTION_OPTIONS
  }),
  kickGate: Object.freeze({
    lowHz: 40,
    highHz: 110,
    threshold: 0.55,
    releaseSec: 0.14,
    mode: 'gate'
  }),
  snareGate: Object.freeze({
    lowHz: 180,
    highHz: 450,
    threshold: 0.60,
    releaseSec: 0.12,
    mode: 'gate'
  }),
  vocalFollow: Object.freeze({
    lowHz: 350,
    highHz: 3400,
    threshold: 0.38,
    releaseSec: 0.15,
    mode: 'follow'
  }),
  zones: Object.freeze({
    washZone: 'wings',
    bassZone: 'bottomRow',
    vocalZone: 'centerCol',
    strobeZone: 'upperCross',
    accentZone: 'corners'
  }),
  layerConfig: Object.freeze({
    'base-wash': Object.freeze({ enabled: true, blend: 'screen', opacity: 0.72 }),
    bass: Object.freeze({ enabled: true, blend: 'add', opacity: 0.82 }),
    synth: Object.freeze({ enabled: true, blend: 'screen', opacity: 0.72 }),
    motion: Object.freeze({ enabled: true, blend: 'add', opacity: 0.82 }),
    drums: Object.freeze({ enabled: true, blend: 'add', opacity: 0.88 })
  }),
  useCustomJsCode: false,
  customJsCode: ''
});

export const DEFAULT_VIBECODE_TEMPLATE = `// Vibecode vlastiti MP3 -> Light Show generator!
// Funkcija prima (analysis, config, api) i vraća timeline objekt.
function generateShow(analysis, config, api) {
  // 1. Možeš pozvati bazni pipeline s prilagođenim opcijama i zatim modificirati klipove:
  const timeline = api.createAutoShow(analysis, {
    ...config,
    customGeneratorFn: null
  });

  // 2. Primjer: U svakom Dropu dodaj dodatni 'spiral' akcent na rubovima (perimeter)
  const sections = analysis.sections || api.detectSections(analysis, config.sectionDetection);
  const accentLayer = timeline.layers.find(l => l.id === 'drums') || timeline.layers[0];

  sections.filter(s => s.type === 'drop').forEach((drop, i) => {
    accentLayer.clips.push(api.makeClip({
      id: \`vibe-drop-spiral-\${i}\`,
      preset: 'spiral',
      color: [0.15, 0.92, 1.0, 0.55],
      driver: 'drums',
      targets: api.ZONES.perimeter,
      startSec: drop.startSec,
      durationSec: Math.min(4, drop.durationSec),
      driverGain: 1.35,
      speed: 6
    }));
  });

  accentLayer.clips.sort((a, b) => a.startSec - b.startSec);
  return timeline;
}`;

export const BUILT_IN_GENERATORS = Object.freeze([
  Object.freeze({
    id: 'club-5layer-pro',
    name: 'Klupski 5-Slojni Pro (Default)',
    author: 'LEDicated Core',
    version: '1.0.0',
    builtin: true,
    description: 'Referentni 5-slojni klupski algoritam: 1-beat drop snap, W-kanalna disciplina (RGB na strofama, puni RGBW na dropu), 1/2 beat pre-drop blackout i gornji križ bez C3.',
    tags: Object.freeze(['club', 'rgbw-contrast', '5-layer', 'baseline']),
    config: Object.freeze({})
  }),
  Object.freeze({
    id: 'festival-mainstage',
    name: 'Festival Mainstage Blinder',
    author: 'LEDicated Core',
    version: '1.0.0',
    builtin: true,
    description: 'Ekstremni festivalski kontrast: niži strop na strofama (44%), 2-beat potpuni blackout prije svakog dropa, 1/8 stroboskop i snažan W-kanalni udar.',
    tags: Object.freeze(['festival', 'high-contrast', 'blinder', 'edm']),
    config: Object.freeze({
      theme: 'inferno',
      energy: 0.95,
      nonDropCeiling: 0.44,
      wChannelMode: 'drop-only',
      dropMinW: 0.62,
      dropColorBoost: 1.45,
      preDropBlackoutMode: 'fixed',
      preDropBlackoutBeats: 2,
      dropBlinder: true,
      dropStrobeDurationSec: 8.0,
      dropStrobeRate: '1/8',
      dropRhythmStyle: 'alternate-2beat',
      buildSpiralAccel: true,
      buildMaxSpeed: 20,
      globalSpeedMultiplier: 1.15,
      driverGainScale: 1.12
    })
  }),
  Object.freeze({
    id: 'hypnotic-techno',
    name: 'Hypnotic Warehouse Techno',
    author: 'LEDicated Core',
    version: '1.0.0',
    builtin: true,
    description: 'Mračni industrijski 4/4 tunel: fokus na vertikalnim stupcima, naizmjeničnim bljeskovima i preciznom kick gateu uz prigušenu atmosferu.',
    tags: Object.freeze(['techno', 'warehouse', 'minimal', 'columns']),
    config: Object.freeze({
      theme: 'cyber',
      energy: 0.82,
      allowedPresets: Object.freeze(['columns', 'chase', 'pulse', 'alternate', 'strobe', 'flash', 'sweep', 'wash']),
      nonDropCeiling: 0.38,
      wChannelMode: 'accents-and-drop',
      dropMinW: 0.32,
      dropColorBoost: 1.20,
      preDropBlackoutMode: 'fixed',
      preDropBlackoutBeats: 1,
      dropBlinder: true,
      dropStrobeDurationSec: 4.5,
      dropStrobeRate: '1/4',
      dropRhythmStyle: 'columns',
      buildSpiralAccel: true,
      buildMaxSpeed: 16,
      kickGate: Object.freeze({ lowHz: 38, highHz: 105, threshold: 0.58, releaseSec: 0.11, mode: 'gate' }),
      layerConfig: Object.freeze({
        'base-wash': Object.freeze({ enabled: true, blend: 'screen', opacity: 0.52 }),
        bass: Object.freeze({ enabled: true, blend: 'add', opacity: 0.90 }),
        synth: Object.freeze({ enabled: true, blend: 'screen', opacity: 0.58 }),
        motion: Object.freeze({ enabled: true, blend: 'add', opacity: 0.92 }),
        drums: Object.freeze({ enabled: true, blend: 'add', opacity: 0.92 })
      })
    })
  }),
  Object.freeze({
    id: 'melodic-euphoria',
    name: 'Melodic & Vocal Euphoria',
    author: 'LEDicated Core',
    version: '1.0.0',
    builtin: true,
    description: 'Prozračni melodični show za progressive, house i vokalne trake: naglašena središnja vokalna kolona (C1-C3), topli valovi na krilima i kraći stroboskop.',
    tags: Object.freeze(['melodic', 'vocal', 'progressive', 'smooth']),
    config: Object.freeze({
      theme: 'sunset',
      energy: 0.78,
      nonDropCeiling: 0.64,
      wChannelMode: 'drop-only',
      dropMinW: 0.35,
      dropColorBoost: 1.18,
      preDropBlackoutMode: 'auto',
      preDropBlackoutBeats: 1,
      dropBlinder: true,
      dropStrobeDurationSec: 3.0,
      dropStrobeRate: '1/4',
      dropRhythmStyle: 'pulse',
      buildSpiralAccel: true,
      buildMaxSpeed: 12,
      globalSpeedMultiplier: 0.9,
      vocalFollow: Object.freeze({ lowHz: 300, highHz: 3600, threshold: 0.32, releaseSec: 0.18, mode: 'follow' }),
      layerConfig: Object.freeze({
        'base-wash': Object.freeze({ enabled: true, blend: 'screen', opacity: 0.82 }),
        bass: Object.freeze({ enabled: true, blend: 'add', opacity: 0.78 }),
        synth: Object.freeze({ enabled: true, blend: 'screen', opacity: 0.88 }),
        motion: Object.freeze({ enabled: true, blend: 'add', opacity: 0.75 }),
        drums: Object.freeze({ enabled: true, blend: 'add', opacity: 0.78 })
      })
    })
  }),
  Object.freeze({
    id: 'kinetic-matrix',
    name: 'Kinetic 3×3 Matrix Geometry',
    author: 'LEDicated Core',
    version: '1.0.0',
    builtin: true,
    description: 'Geometrijska 3×3 koreografija za drum & bass, bass house i elektro: brze spirale, elastični odboji, prstenasti valovi i dijagonalni prijelazi.',
    tags: Object.freeze(['matrix', 'geometric', 'dnb', 'fast']),
    config: Object.freeze({
      theme: 'rave',
      energy: 0.90,
      allowedPresets: Object.freeze(['spiral', 'bounce', 'ripple', 'alternate', 'chase', 'columns', 'sweep', 'strobe', 'flash', 'pulse', 'rain']),
      nonDropCeiling: 0.50,
      wChannelMode: 'drop-only',
      dropMinW: 0.48,
      dropColorBoost: 1.32,
      preDropBlackoutMode: 'auto',
      preDropBlackoutBeats: 2,
      dropBlinder: true,
      dropStrobeDurationSec: 6.0,
      dropStrobeRate: '1/8',
      dropRhythmStyle: 'alternate-2beat',
      buildSpiralAccel: true,
      buildMaxSpeed: 24,
      globalSpeedMultiplier: 1.25,
      zones: Object.freeze({
        washZone: 'perimeter',
        bassZone: 'bottomRow',
        vocalZone: 'cross',
        strobeZone: 'upperCross',
        accentZone: 'corners'
      })
    })
  })
]);

/** Deep-merge a partial pipeline config onto DEFAULT_PIPELINE_CONFIG. */
export function mergePipelineConfig(base = DEFAULT_PIPELINE_CONFIG, override = {}) {
  const src = base || DEFAULT_PIPELINE_CONFIG;
  const ov = override || {};

  const mergedLayerConfig = {};
  for (const layerId of Object.keys(DEFAULT_PIPELINE_CONFIG.layerConfig)) {
    mergedLayerConfig[layerId] = {
      ...DEFAULT_PIPELINE_CONFIG.layerConfig[layerId],
      ...(src.layerConfig?.[layerId] || {}),
      ...(ov.layerConfig?.[layerId] || {})
    };
  }

  return {
    ...DEFAULT_PIPELINE_CONFIG,
    ...src,
    ...ov,
    allowedPresets: Array.isArray(ov.allowedPresets)
      ? [...ov.allowedPresets]
      : (Array.isArray(src.allowedPresets) ? [...src.allowedPresets] : [...TIMELINE_PRESETS]),
    customColors: Array.isArray(ov.customColors)
      ? ov.customColors.map(c => Array.isArray(c) ? [...c] : c)
      : (Array.isArray(src.customColors) ? src.customColors.map(c => Array.isArray(c) ? [...c] : c) : null),
    sectionDetection: {
      ...DEFAULT_PIPELINE_CONFIG.sectionDetection,
      ...(src.sectionDetection || {}),
      ...(ov.sectionDetection || {})
    },
    kickGate: {
      ...DEFAULT_PIPELINE_CONFIG.kickGate,
      ...(src.kickGate || {}),
      ...(ov.kickGate || {})
    },
    snareGate: {
      ...DEFAULT_PIPELINE_CONFIG.snareGate,
      ...(src.snareGate || {}),
      ...(ov.snareGate || {})
    },
    vocalFollow: {
      ...DEFAULT_PIPELINE_CONFIG.vocalFollow,
      ...(src.vocalFollow || {}),
      ...(ov.vocalFollow || {})
    },
    zones: {
      ...DEFAULT_PIPELINE_CONFIG.zones,
      ...(src.zones || {}),
      ...(ov.zones || {})
    },
    layerConfig: mergedLayerConfig
  };
}

/** Resolve a generator definition by id from built-in and custom Git generators. */
export function getGeneratorById(generatorId, customGenerators = []) {
  const all = [...BUILT_IN_GENERATORS, ...(Array.isArray(customGenerators) ? customGenerators : [])];
  return all.find(g => g && g.id === generatorId) || BUILT_IN_GENERATORS[0];
}

/** Build the effective pipeline config when selecting a generator + user overrides. */
export function resolveGeneratorConfig(generatorId, userOverrides = {}, customGenerators = []) {
  const gen = getGeneratorById(generatorId, customGenerators);
  const baseWithGen = mergePipelineConfig(DEFAULT_PIPELINE_CONFIG, {
    ...(gen?.config || {}),
    generatorId: gen.id,
    ...(gen?.customJsCode ? { customJsCode: gen.customJsCode, useCustomJsCode: true } : {})
  });
  return mergePipelineConfig(baseWithGen, userOverrides);
}

/** Create the helper API passed as the 3rd argument to vibecoded JS generators. */
export function createVibecodeApi() {
  return Object.freeze({
    BAR_IDS,
    PIXELS_PER_BAR,
    ZONES,
    TIMELINE_PRESETS,
    TIMELINE_BLENDS,
    PALETTES,
    SHOW_THEMES,
    SECTION_TYPES,
    SECTION_NAMES,
    SECTION_COLORS,
    detectSections,
    createAutoShow,
    regenerateSectionClips,
    validateTimeline,
    makeClip(spec = {}) {
      const startSec = Math.max(0, Number(spec.startSec || 0));
      const durationSec = Math.max(0.05, Number(spec.durationSec || 4));
      const defaultKeys = [
        { timeSec: 0, value: 0 },
        { timeSec: Math.min(0.35, durationSec * 0.2), value: 1 },
        { timeSec: Math.max(0.01, durationSec - Math.min(0.35, durationSec * 0.2)), value: 1 },
        { timeSec: durationSec, value: 0 }
      ];
      return {
        id: String(spec.id || `clip-${Math.random().toString(36).slice(2, 8)}`),
        startSec,
        durationSec,
        preset: TIMELINE_PRESETS.includes(spec.preset) ? spec.preset : 'pulse',
        targets: spec.targets || 'all',
        color: Array.isArray(spec.color) ? spec.color.slice(0, 4) : [0.1, 0.7, 1, 0],
        driver: spec.driver || 'drums',
        driverGain: Number.isFinite(Number(spec.driverGain)) ? Number(spec.driverGain) : 1,
        speed: Number.isFinite(Number(spec.speed)) ? Number(spec.speed) : 1,
        timing: spec.timing || 'beat',
        ...(spec.params ? { params: spec.params } : {}),
        ...(spec.band ? { band: spec.band } : {}),
        keyframes: Array.isArray(spec.keyframes) && spec.keyframes.length >= 2 ? spec.keyframes : defaultKeys
      };
    },
    makeLayer(spec = {}) {
      return {
        id: String(spec.id || 'custom-layer'),
        name: String(spec.name || 'Custom sloj'),
        color: String(spec.color || '#3aa0ff'),
        enabled: spec.enabled !== false,
        blend: TIMELINE_BLENDS.includes(spec.blend) ? spec.blend : 'add',
        opacity: Number.isFinite(Number(spec.opacity)) ? Math.max(0, Math.min(1, Number(spec.opacity))) : 0.8,
        clips: Array.isArray(spec.clips) ? spec.clips : []
      };
    }
  });
}

/** Execute user-supplied vibecoded JS generator code deterministically. */
export function executeCustomGeneratorCode(code, analysis, config = {}) {
  const source = String(code || '').trim();
  if (!source) {
    throw new Error('Custom JS kod generatora je prazan.');
  }
  const api = createVibecodeApi();
  const factory = new Function(
    'analysis',
    'config',
    'api',
    `"use strict";
${source}
if (typeof generateShow === 'function') {
  return generateShow(analysis, config, api);
}
throw new Error('Definiraj funkciju generateShow(analysis, config, api) koja vraća timeline.');`
  );
  const timeline = factory(analysis, config, api);
  const check = validateTimeline(timeline);
  if (!check.valid) {
    throw new Error(`Vibecode generator vratio je neispravan timeline: ${check.errors.join('; ')}`);
  }
  return timeline;
}

/** Execute the full MP3 -> Light Show pipeline with section detection + generator config. */
export function runShowPipeline(analysis, userConfig = {}, customGenerators = []) {
  if (!analysis || typeof analysis !== 'object') {
    throw new TypeError('analysis object is required');
  }
  const generatorId = userConfig.generatorId || DEFAULT_PIPELINE_CONFIG.generatorId;
  const config = resolveGeneratorConfig(generatorId, userConfig, customGenerators);

  const shouldRedetect = Boolean(userConfig.recomputeSections) || !Array.isArray(analysis.sections) || analysis.sections.length === 0;
  const sections = shouldRedetect
    ? detectSections(analysis, config.sectionDetection)
    : analysis.sections;

  const analysisWithSections = {
    ...analysis,
    sections
  };

  let fullTimeline;
  if (config.useCustomJsCode && String(config.customJsCode || '').trim()) {
    fullTimeline = executeCustomGeneratorCode(config.customJsCode, analysisWithSections, config);
  } else {
    fullTimeline = createAutoShow(analysisWithSections, {
      ...config,
      recomputeSections: false,
      theme: config.theme,
      palette: config.theme,
      customColors: config.customColors,
      allowedPresets: config.allowedPresets,
      energy: config.energy
    });
  }

  let timeline = fullTimeline;
  const targetIndices = Array.isArray(userConfig.targetSectionIndices)
    ? userConfig.targetSectionIndices.filter(i => Number.isInteger(i) && i >= 0 && i < sections.length)
    : [];

  if (targetIndices.length > 0 && userConfig.existingTimeline && Array.isArray(userConfig.existingTimeline.layers)) {
    const baseClone = structuredClone(userConfig.existingTimeline);
    timeline = regenerateSectionClips(baseClone, analysisWithSections, targetIndices, {
      ...config,
      generatedTimeline: fullTimeline
    });
  }

  return {
    timeline,
    sections,
    config,
    targetedSectionIndices: targetIndices
  };
}

/** Serialize a generator specification (.generator.json) for Git sharing or file export. */
export function serializeGeneratorSpec(meta = {}, config = {}) {
  const rawId = String(meta.id || meta.name || 'custom-generator')
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'custom-generator';
  const merged = mergePipelineConfig(DEFAULT_PIPELINE_CONFIG, config);
  const { customJsCode, useCustomJsCode, ...cleanConfig } = merged;
  return {
    schemaVersion: GENERATOR_SCHEMA_VERSION,
    id: rawId,
    name: String(meta.name || 'Custom Generator').trim(),
    author: String(meta.author || 'LEDicated User').trim(),
    version: String(meta.version || '1.0.0').trim(),
    description: String(meta.description || 'Prilagođeni MP3 -> Light Show algoritam.').trim(),
    tags: Array.isArray(meta.tags) ? meta.tags.map(String) : ['custom', 'vibecode'],
    createdAt: meta.createdAt || new Date().toISOString(),
    config: cleanConfig,
    ...(useCustomJsCode && String(customJsCode || '').trim()
      ? { useCustomJsCode: true, customJsCode: String(customJsCode) }
      : {})
  };
}

/** Validate a loaded/imported .generator.json specification. */
export function validateGeneratorSpec(spec) {
  const errors = [];
  if (!spec || typeof spec !== 'object') {
    return { valid: false, errors: ['Specifikacija mora biti JSON objekt.'] };
  }
  if (!spec.id || typeof spec.id !== 'string') {
    errors.push('Nedostaje polje "id" (string).');
  }
  if (!spec.name || typeof spec.name !== 'string') {
    errors.push('Nedostaje polje "name" (string).');
  }
  if (spec.config !== undefined && (typeof spec.config !== 'object' || spec.config === null)) {
    errors.push('Polje "config" mora biti objekt.');
  }
  if (spec.customJsCode !== undefined && typeof spec.customJsCode !== 'string') {
    errors.push('Polje "customJsCode" mora biti string.');
  }
  return { valid: errors.length === 0, errors };
}

/** Generate a comprehensive Vibecoding prompt that users can paste into any AI coding assistant. */
export function buildVibecodePrompt(config = DEFAULT_PIPELINE_CONFIG) {
  return `# LEDicated Vibecode Generator Prompt (MP3 -> 3×3 RGBW Light Show)

Napiši JavaScript funkciju \`generateShow(analysis, config, api)\` za LEDicated Studio koja pretvara audio analizu u 5-slojni RGBW light show timeline.

## Hardver i 3×3 matrica
- 9 vertikalnih LED barova u 3×3 mreži:
  - Gornji red: \`L1\`, \`C1\`, \`R1\`
  - Srednji red: \`L2\`, \`C2\`, \`R2\`
  - Donji red: \`L3\`, \`C3\`, \`R3\`
- Boje su normalizirani RGBW nizovi \`[r, g, b, w]\` od \`0\` do \`1\` (gdje je \`w\` topla bijela dioda).
- Dostupne zone u \`api.ZONES\`: \`all\`, \`wings\`, \`centerCol\`, \`leftCol\`, \`rightCol\`, \`cross\`, \`upperCross\` (nikad \`C3\` za stroboskop), \`crossNoCenter\`, \`bottomRow\`, \`topRow\`, \`midRow\`, \`perimeter\`, \`corners\`, \`center\`.
- Dostupni preseti (16): ${TIMELINE_PRESETS.map(p => `\`${p}\``).join(', ')}.
- Dostupni audio driveri: \`none\`, \`drums\`, \`bass\`, \`vocals\`, \`other\`, \`band\`.

## Ulazni podaci
- \`analysis\`: \`{ durationSec, bpm, beatOffsetSec, beatsSec, sections, waveform: { rms, binSec }, features: { drums, bass, vocals, other, hopSec } }\`
- \`analysis.sections\`: niz objekata \`{ id, name, type: 'intro'|'verse'|'build'|'drop'|'breakdown'|'outro', startSec, endSec, durationSec, energy }\`
- \`config\`: trenutne postavke pipelinea (\`theme: "${config.theme}"\`, \`nonDropCeiling: ${config.nonDropCeiling}\`, \`dropMinW: ${config.dropMinW}\`, \`preDropBlackoutBeats: ${config.preDropBlackoutBeats}\`).
- \`api\`: sadrži \`api.createAutoShow(analysis, opts)\`, \`api.detectSections(analysis, opts)\`, \`api.makeClip({...})\`, \`api.makeLayer({...})\`, \`api.ZONES\`, \`api.PALETTES\`.

## Pravila dizajna rasvjete
1. Strofe, uvod i breakdown drži u čistom RGB-u (\`W = 0\`) sa stropom svjetline oko \`${config.nonDropCeiling}\`.
2. Prije svakog Dropa ostavi \`1–2\` beata potpunog mraka (pre-drop blackout).
3. Na Dropu uključi puni RGBW udar (\`W >= ${config.dropMinW}\`), Beat-1 blinder i stroboskop samo na \`api.ZONES.upperCross\`.
4. Vrati valjan \`timeline\` objekt (ili nadogradi \`const timeline = api.createAutoShow(analysis, config)\`).`;
}
