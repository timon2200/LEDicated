/** Gemini AI Show Director with deterministic local algorithmic fallback.
 * Uses Gemini 2.5 Flash to refine song macro-structure (Intro, Verse, Build, Drop,
 * Breakdown, Outro) and optional preset/target accents for the 3×3 RGBW stage matrix,
 * while guaranteeing that show generation never fails via createAutoShow fallback.
 */
import { BAR_IDS } from './engine.mjs';
import { SECTION_TYPES, SECTION_NAMES, SECTION_COLORS, detectSections } from './audio-sections.mjs';
import { SHOW_THEMES, TIMELINE_PRESETS, createAutoShow, validateTimeline } from './timeline.mjs';

const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';
const DEFAULT_TIMEOUT_MS = 15000;

const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const number = (v, fallback = 0) => Number.isFinite(Number(v)) ? Number(v) : fallback;

function avgSlice(arr, stepSec, t0, t1, offsetSec = 0) {
  if (!arr || !arr.length || t1 <= t0 || stepSec <= 0) return 0;
  const i0 = Math.max(0, Math.floor((t0 - offsetSec + 1e-9) / stepSec));
  const i1 = Math.min(arr.length - 1, Math.max(i0, Math.ceil((t1 - offsetSec - 1e-9) / stepSec) - 1));
  if (i1 < i0) return 0;
  let sum = 0;
  let count = 0;
  for (let i = i0; i <= i1; i++) {
    sum += Number(arr[i] || 0);
    count++;
  }
  return count ? Math.round((sum / count) * 100) / 100 : 0;
}

/** Build a compact phrase-level energy and 4-stem summary for the Gemini prompt. */
export function buildPhraseSummary(analysis = {}) {
  const durationSec = number(analysis.durationSec ?? analysis.duration, 0);
  if (durationSec <= 0) return [];
  const bpm = clamp(number(analysis.bpm, 120), 40, 240);
  const beatSec = 60 / bpm;
  const barSec = 4 * beatSec;
  const phraseSec = Math.max(barSec * 2, durationSec / 36);
  const beatOffsetSec = number(analysis.beatOffsetSec ?? analysis.beatsSec?.[0], 0);

  const rms = analysis.waveform?.rms || [];
  const binSec = number(analysis.waveform?.binSec, 0.05);
  const drums = analysis.features?.drums || analysis.features?.stems?.drums || [];
  const bass = analysis.features?.bass || analysis.features?.stems?.bass || [];
  const vocals = analysis.features?.vocals || analysis.features?.stems?.vocals || [];
  const other = analysis.features?.other || analysis.features?.stems?.other || [];
  const hopSec = number(analysis.features?.hopSec, 0.05);
  const featureStartSec = number(analysis.features?.startSec, 0);

  const out = [];
  let cursor = 0;
  let idx = 0;
  while (cursor < durationSec - 1e-3 && idx < 48) {
    const nextEdge = idx === 0 && beatOffsetSec > 0
      ? Math.min(durationSec, beatOffsetSec + phraseSec)
      : Math.min(durationSec, cursor + phraseSec);
    const t0 = Math.round(cursor * 100) / 100;
    const t1 = Math.round(nextEdge * 100) / 100;
    if (t1 <= t0) break;
    out.push({
      startSec: t0,
      endSec: t1,
      rms: avgSlice(rms, binSec, t0, t1, 0),
      drums: avgSlice(drums, hopSec, t0, t1, featureStartSec),
      bass: avgSlice(bass, hopSec, t0, t1, featureStartSec),
      vocals: avgSlice(vocals, hopSec, t0, t1, featureStartSec),
      other: avgSlice(other, hopSec, t0, t1, featureStartSec)
    });
    cursor = nextEdge;
    idx++;
  }
  return out;
}

/** Validate and normalize Gemini's returned section list to cover [0, durationSec]. */
export function sanitizeDirectedSections(rawSections, durationSec, bpm = 120) {
  if (!Array.isArray(rawSections) || rawSections.length === 0 || !(durationSec > 0)) {
    throw new Error('Gemini returned empty or invalid sections array.');
  }
  const validItems = [];
  for (const item of rawSections) {
    if (!item || typeof item !== 'object') continue;
    const type = typeof item.type === 'string' ? item.type.toLowerCase().trim() : '';
    if (!SECTION_TYPES.includes(type)) continue;
    const startSec = number(item.startSec, NaN);
    const endSec = number(item.endSec, Number.isFinite(item.durationSec) ? startSec + Number(item.durationSec) : NaN);
    if (!Number.isFinite(startSec) || !Number.isFinite(endSec) || endSec <= startSec) continue;
    validItems.push({
      type,
      startSec: clamp(startSec, 0, durationSec),
      endSec: clamp(endSec, 0, durationSec),
      energy: clamp(number(item.energy, type === 'drop' ? 0.95 : (type === 'build' ? 0.75 : 0.48)), 0.1, 1),
      presetOverride: typeof item.preset === 'string' && TIMELINE_PRESETS.includes(item.preset) ? item.preset : null,
      targetsOverride: item.targets === 'all' || (Array.isArray(item.targets) && item.targets.length && item.targets.every(id => BAR_IDS.includes(id)))
        ? item.targets
        : null
    });
  }
  if (!validItems.length) {
    throw new Error('No valid sections found in Gemini response.');
  }
  validItems.sort((a, b) => a.startSec - b.startSec);

  // Merge adjacent identical types and enforce contiguous [0, durationSec] coverage
  const merged = [];
  for (const item of validItems) {
    const prev = merged.at(-1);
    if (prev && prev.type === item.type && Math.abs(item.startSec - prev.endSec) < 2.0) {
      prev.endSec = Math.max(prev.endSec, item.endSec);
      prev.energy = Math.round(((prev.energy + item.energy) / 2) * 100) / 100;
    } else {
      merged.push({ ...item });
    }
  }

  merged[0].startSec = 0;
  for (let i = 0; i < merged.length - 1; i++) {
    const boundary = Math.round(clamp(merged[i + 1].startSec, merged[i].startSec + 0.5, durationSec - 0.5) * 100) / 100;
    merged[i].endSec = boundary;
    merged[i + 1].startSec = boundary;
  }
  merged.at(-1).endSec = Math.round(durationSec * 100) / 100;

  const filtered = merged.filter(s => s.endSec - s.startSec >= 0.4);
  if (!filtered.length) throw new Error('Refined sections collapsed after boundary normalization.');

  const counts = {};
  return filtered.map((s, i) => {
    counts[s.type] = (counts[s.type] || 0) + 1;
    const count = counts[s.type];
    const totalOfType = filtered.filter(x => x.type === s.type).length;
    const name = totalOfType > 1 && s.type !== 'intro' && s.type !== 'outro'
      ? `${SECTION_NAMES[s.type]} ${count}`
      : SECTION_NAMES[s.type];
    const startSec = i === 0 ? 0 : Math.round(s.startSec * 100) / 100;
    const endSec = i === filtered.length - 1 ? Math.round(durationSec * 100) / 100 : Math.round(s.endSec * 100) / 100;
    return {
      id: `sec-${i + 1}`,
      name,
      type: s.type,
      startSec,
      endSec,
      durationSec: Math.round((endSec - startSec) * 100) / 100,
      energy: s.energy,
      color: SECTION_COLORS[s.type],
      ...(s.presetOverride ? { presetOverride: s.presetOverride } : {}),
      ...(s.targetsOverride ? { targetsOverride: s.targetsOverride } : {})
    };
  });
}

function applyOptionalSectionOverrides(timeline, sections, allowedPresets) {
  if (!timeline || !Array.isArray(timeline.layers) || !Array.isArray(sections)) return;
  const allowedSet = (allowedPresets instanceof Set || Array.isArray(allowedPresets))
    ? new Set([...allowedPresets].filter(p => TIMELINE_PRESETS.includes(p)))
    : null;
  const motionLayer = timeline.layers.find(l => l.id === 'motion');
  if (!motionLayer) return;

  for (const sec of sections) {
    if (!sec.presetOverride && !sec.targetsOverride) continue;
    if (allowedSet && allowedSet.size > 0 && sec.presetOverride && !allowedSet.has(sec.presetOverride)) continue;
    for (const clip of motionLayer.clips) {
      if (clip.startSec >= sec.startSec - 0.05 && clip.startSec + clip.durationSec <= sec.endSec + 0.05) {
        if (sec.presetOverride) clip.preset = sec.presetOverride;
        if (sec.targetsOverride) clip.targets = sec.targetsOverride;
      }
    }
  }
}

export async function createDirectedShow(analysis = {}, options = {}) {
  const baseSections = (Array.isArray(analysis?.sections) && analysis.sections.length > 0)
    ? analysis.sections
    : detectSections(analysis);
  const analysisWithSections = { ...analysis, sections: baseSections };

  const themeKey = options.theme ?? options.palette ?? 'midnight';
  const themeObj = SHOW_THEMES[themeKey] || SHOW_THEMES.midnight;
  const showOptions = {
    ...options,
    theme: themeObj.id,
    palette: options.palette ?? themeObj.id
  };

  // Always compute the rock-solid local algorithmic show first as baseline/fallback
  const fallbackTimeline = createAutoShow(analysisWithSections, showOptions);

  const apiKey = options.apiKey !== undefined ? options.apiKey : process.env.GEMINI_API_KEY;
  if (!options.useGemini || !apiKey) {
    return {
      timeline: fallbackTimeline,
      sections: baseSections,
      director: 'algorithmic'
    };
  }

  const fetcher = options.fetcher || fetch;
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const durationSec = number(analysis.durationSec ?? analysis.duration, fallbackTimeline.durationSec);
    const bpm = number(analysis.bpm, fallbackTimeline.bpm);
    const beatOffsetSec = number(analysis.beatOffsetSec, fallbackTimeline.beatOffsetSec);
    const allowedPresets = (options.allowedPresets instanceof Set || Array.isArray(options.allowedPresets))
      ? [...options.allowedPresets].filter(p => TIMELINE_PRESETS.includes(p))
      : [...themeObj.defaultPresets];

    const summaryPayload = {
      title: options.title || 'Unknown Track',
      durationSec: Math.round(durationSec * 100) / 100,
      bpm: Math.round(bpm * 100) / 100,
      beatOffsetSec: Math.round(beatOffsetSec * 1000) / 1000,
      theme: {
        id: themeObj.id,
        name: themeObj.name,
        description: themeObj.description
      },
      allowedPresets,
      topology: {
        matrix: [['L1', 'C1', 'R1'], ['L2', 'C2', 'R2'], ['L3', 'C3', 'R3']],
        pixelsPerBar: 12,
        channels: 'RGBW'
      },
      currentSections: baseSections.map(s => ({
        type: s.type,
        startSec: s.startSec,
        endSec: s.endSec,
        energy: s.energy
      })),
      phraseProfile: buildPhraseSummary(analysisWithSections)
    };

    const promptText = [
      'You are the AI Lighting Show Director for LEDicated, a 3x3 RGBW LED bar studio rig (L1 C1 R1 / L2 C2 R2 / L3 C3 R3).',
      'Given the song audio analysis summary below, return a JSON object with refined bar-snapped `sections` covering [0, durationSec] that maximize stem reactivity, pre-drop build tension, and drop contrast.',
      'Each section in `sections` must have:',
      '- `type`: one of "intro", "verse", "build", "drop", "breakdown", "outro"',
      '- `startSec`: number (seconds)',
      '- `endSec`: number (seconds)',
      '- `energy`: number 0..1',
      '- optional `preset`: one of allowedPresets for the section rhythm/motion override',
      '- optional `targets`: "all" or array of bar IDs from ["L1","C1","R1","L2","C2","R2","L3","C3","R3"]',
      '',
      JSON.stringify(summaryPayload)
    ].join('\n');

    const response = await fetcher(`${GEMINI_ENDPOINT}?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: promptText }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.2
        }
      })
    });

    if (!response.ok) {
      throw new Error(`Gemini HTTP ${response.status}`);
    }

    const result = await response.json();
    const rawText = result?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof rawText !== 'string' || !rawText.trim()) {
      throw new Error('Gemini response missing JSON text.');
    }

    const parsed = JSON.parse(rawText);
    const candidateSections = Array.isArray(parsed) ? parsed : parsed?.sections;
    const refinedWithOverrides = sanitizeDirectedSections(candidateSections, durationSec, bpm);
    const refinedSections = refinedWithOverrides.map(({ presetOverride, targetsOverride, ...cleanSec }) => cleanSec);

    const directedTimeline = createAutoShow({ ...analysis, sections: refinedSections }, showOptions);
    applyOptionalSectionOverrides(directedTimeline, refinedWithOverrides, allowedPresets);

    const check = validateTimeline(directedTimeline);
    if (!check.valid) {
      throw new Error(`Directed timeline validation failed: ${check.errors.join('; ')}`);
    }

    return {
      timeline: directedTimeline,
      sections: refinedSections,
      director: 'gemini-2.5-flash'
    };
  } catch (error) {
    console.warn('[gemini-director] Falling back to local algorithmic show:', error?.message || error);
    return {
      timeline: fallbackTimeline,
      sections: baseSections,
      director: 'algorithmic-fallback'
    };
  } finally {
    clearTimeout(timer);
  }
}
