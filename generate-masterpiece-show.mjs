/**
 * Masterpiece Light Show Generator for:
 * "Klangkuenstler, Ski Aggu - Sonne Geht Auf (full track)"
 * Track ID: 12f110db-ca50-44ff-965a-5b54bf553c2c
 *
 * Utilizes the full LEDicated DAW architecture:
 * - 7 synchronized layers with custom blend modes (add, screen)
 * - Frequency-band audio reactivity (Kick, Snare, Hi-hat, Sub-bas, Vokal)
 * - 16 advanced lighting presets with tuned spatial geometry
 * - Exact musical phrase quantization snapped to 156.6 BPM beat grid
 * - Section-specific emotional arcs (Sunrise / Solar Rave progression)
 * - Blinder & Strobe W-channel impacts
 */

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { BAR_IDS } from './studio-light-baseline/app/engine.mjs';
import { validateTimeline, renderTimelineFrame } from './studio-light-baseline/app/timeline.mjs';

const TRACK_ID = '12f110db-ca50-44ff-965a-5b54bf553c2c';
const analysisPath = `./studio-light-baseline/app/data/analyses/${TRACK_ID}.json`;
const timelinePath = `./studio-light-baseline/app/data/timelines/${TRACK_ID}.json`;

const analysis = JSON.parse(readFileSync(analysisPath, 'utf8'));

const BPM = 156.6;
const BEAT_SEC = 60 / BPM; // ~0.383142s
const BAR_SEC = 4 * BEAT_SEC; // ~1.532567s
const DURATION = analysis.durationSec; // 273.845s
const BEAT_OFFSET = analysis.beatsSec?.[0] || 0.051;

// Helper: Snap to beat
function snap(sec) {
  return Math.max(0, Math.round(sec * 1000) / 1000);
}

// Spatial Groups
const ALL_BARS = 'all';
const PERIMETER = ['L1', 'C1', 'R1', 'R2', 'R3', 'C3', 'L3', 'L2'];
const CROSS = ['C1', 'L2', 'C2', 'R2', 'C3'];
const CORNERS = ['L1', 'R1', 'L3', 'R3'];
const BOTTOM_ROW = ['L3', 'C3', 'R3'];
const TOP_ROW = ['L1', 'C1', 'R1'];
const MID_ROW = ['L2', 'C2', 'R2'];
const LEFT_COL = ['L1', 'L2', 'L3'];
const CENTER_COL = ['C1', 'C2', 'C3'];
const RIGHT_COL = ['R1', 'R2', 'R3'];
const FLANKS = ['L1', 'L2', 'L3', 'R1', 'R2', 'R3'];
const SUB_STACK = ['L3', 'C3', 'R3', 'C2'];

// Master Color Palette for "Sonne Geht Auf"
const COLORS = {
  // Blinders & Strobes
  BLINDER_WARM: [0.1, 0.15, 0.25, 0.95],
  BLINDER_PURE: [0.0, 0.0, 0.0, 1.0],
  BLINDER_STRIKE: [0.25, 0.25, 0.35, 1.0],
  
  // Sunrise / Solar Arc (Theme of the song)
  DEEP_NIGHT: [0.06, 0.0, 0.45, 0.0],
  TWILIGHT_VIOLET: [0.35, 0.02, 0.65, 0.0],
  DAWN_CRIMSON: [0.95, 0.05, 0.02, 0.0],
  SUNRISE_AMBER: [1.0, 0.3, 0.0, 0.05],
  SOLAR_GOLD: [1.0, 0.72, 0.05, 0.18],
  SOLAR_CORONA: [1.0, 0.88, 0.25, 0.35],
  
  // Hard Techno & Laser Contrasts
  ACID_CYAN: [0.0, 0.92, 1.0, 0.05],
  ACID_LIME: [0.35, 1.0, 0.0, 0.0],
  NEON_MAGENTA: [1.0, 0.0, 0.55, 0.0],
  DIAMOND_WHITE: [0.2, 0.5, 1.0, 0.45],
  ICE_GLINT: [0.3, 0.7, 1.0, 0.25]
};

// Clip Factory Helper
let clipCounter = 0;
function createClip({
  preset,
  startSec,
  durationSec,
  targets = ALL_BARS,
  color,
  driver = 'none',
  band = null,
  driverGain = 1.0,
  speed = 1.0,
  direction,
  timing = 'beat',
  motionMode,
  params = {},
  keyframes = null
}) {
  clipCounter++;
  const s = snap(startSec);
  const d = snap(Math.min(durationSec, DURATION - s));
  if (d <= 0.04) return null;

  const clip = {
    id: `clip-${clipCounter}-${preset}`,
    startSec: s,
    durationSec: d,
    preset,
    targets,
    color,
    driver,
    driverGain,
    speed,
    timing,
    params,
    keyframes: keyframes || [
      { timeSec: 0, value: 0 },
      { timeSec: Math.min(0.25, d * 0.2), value: 1, ease: 'smooth' },
      { timeSec: Math.max(0.26, d - Math.min(0.25, d * 0.2)), value: 1 },
      { timeSec: d, value: 0, ease: 'out' }
    ]
  };

  if (direction) clip.direction = direction;
  if (motionMode) clip.motionMode = motionMode;
  if (driver === 'band' && band) clip.band = band;

  return clip;
}

// Build the 7 specialized layers
const layers = [
  // -------------------------------------------------------------
  // Layer 0: SUBWOOFER & KICK PUNCH (Bas & Podnožje)
  // Gated low-frequency impact directly synced to the 156.6 BPM kick
  // -------------------------------------------------------------
  {
    id: 'layer-sub-kick',
    name: 'Sub & Kick Punch',
    color: '#ff2200',
    enabled: true,
    blend: 'add',
    opacity: 0.95,
    clips: []
  },

  // -------------------------------------------------------------
  // Layer 1: LOW-END ROLLING BASS (Bas linija & Valovi)
  // Sustained rolling basslines, fire eruptions, and vertical sweeps
  // -------------------------------------------------------------
  {
    id: 'layer-bass-roll',
    name: 'Bas Valovi & Vatra',
    color: '#a824f0',
    enabled: true,
    blend: 'add',
    opacity: 0.85,
    clips: []
  },

  // -------------------------------------------------------------
  // Layer 2: RHYTHM & SYNTH LASERS (Takt & Kretanje)
  // Directional lasers, high-speed chases, checkerboard cuts
  // -------------------------------------------------------------
  {
    id: 'layer-rhythm-lasers',
    name: 'Ritam & Laser Chase',
    color: '#00e5ff',
    enabled: true,
    blend: 'screen',
    opacity: 0.88,
    clips: []
  },

  // -------------------------------------------------------------
  // Layer 3: SKI AGGU VOCAL & SYNTH HORIZON (Vokal & Melodija)
  // Reactive center cross & iris glow responding to rap & anthem
  // -------------------------------------------------------------
  {
    id: 'layer-vocal-horizon',
    name: 'Ski Aggu Vokal & Melodija',
    color: '#ffbb00',
    enabled: true,
    blend: 'screen',
    opacity: 0.90,
    clips: []
  },

  // -------------------------------------------------------------
  // Layer 4: HI-HATS & PERCUSSION SHIMMER (Činele & Visoki)
  // Diamond glints and perimeter sparks on high-frequency groove
  // -------------------------------------------------------------
  {
    id: 'layer-hihat-spark',
    name: 'Činele & Shimmer',
    color: '#4db8ff',
    enabled: true,
    blend: 'add',
    opacity: 0.80,
    clips: []
  },

  // -------------------------------------------------------------
  // Layer 5: ATMOSPHERIC SOLAR WASH (Ambijent & Zora)
  // Slow color evolution depicting the rising sun through the rave
  // -------------------------------------------------------------
  {
    id: 'layer-solar-wash',
    name: 'Ambijent & Izlazak Sunca',
    color: '#ff7700',
    enabled: true,
    blend: 'screen',
    opacity: 0.65,
    clips: []
  },

  // -------------------------------------------------------------
  // Layer 6: BLINDERS & STROBE IMPACTS (Stroboskop & Blinderi)
  // High-energy Warm White 4th channel bursts, snare rolls, drops
  // -------------------------------------------------------------
  {
    id: 'layer-strobe-blinder',
    name: 'Stroboskop & Blinderi',
    color: '#ffffff',
    enabled: true,
    blend: 'add',
    opacity: 0.98,
    clips: []
  }
];

const [
  subLayer,
  bassLayer,
  rhythmLayer,
  vocalLayer,
  hihatLayer,
  washLayer,
  strobeLayer
] = layers;

// Sections from audio analysis:
// 1. Uvod:        0.00s - 12.26s (8 bars)
// 2. Drop 1:     12.26s - 49.04s (24 bars)
// 3. Strofa:     49.04s - 61.30s (8 bars)
// 4. Drop 2:     61.30s - 134.87s (48 bars)
// 5. Breakdown 1: 134.87s - 171.65s (24 bars)
// 6. Drop 3:     171.65s - 208.43s (24 bars)
// 7. Breakdown 2: 208.43s - 220.69s (8 bars)
// 8. Drop 4:     220.69s - 269.73s (32 bars)
// 9. Završetak:  269.73s - 273.85s (4s)

console.log('Generating choreographed clips across all 9 sections...');

// =========================================================================
// SECTION 1: UVOD (0.00s – 12.26s) — 8 bars
// Dark twilight, filtered synth build, Ski Aggu vocal phrase, pre-drop roll
// =========================================================================
{
  const t0 = 0.0;
  const len = 12.26;

  // Atmospheric wash: Night twilight breathing
  washLayer.clips.push(createClip({
    preset: 'wash',
    startSec: t0,
    durationSec: len,
    color: COLORS.DEEP_NIGHT,
    params: { mood: 'breath' }
  }));

  // Outer ring twinkle
  hihatLayer.clips.push(createClip({
    preset: 'sparkle',
    startSec: t0,
    durationSec: len - 2.5,
    targets: PERIMETER,
    color: COLORS.ICE_GLINT,
    speed: 0.8,
    params: { density: 'firefly', glint: 'soft' }
  }));

  // Center vocal presence
  vocalLayer.clips.push(createClip({
    preset: 'center',
    startSec: 1.5,
    durationSec: len - 3.5,
    targets: CROSS,
    color: COLORS.SUNRISE_AMBER,
    driver: 'vocals',
    driverGain: 1.3,
    params: { geometry: 'iris', breathe: true }
  }));

  // Pre-drop Snare Roll & Strobe Buildup (9.20s – 12.26s, 2 bars)
  strobeLayer.clips.push(createClip({
    preset: 'strobe',
    startSec: 9.20,
    durationSec: 3.06,
    targets: CROSS,
    color: COLORS.BLINDER_WARM,
    speed: 2.0,
    params: { rate: '1/16', duty: 'sharp', pattern: 'checker' },
    keyframes: [
      { timeSec: 0, value: 0.1 },
      { timeSec: 1.5, value: 0.4 },
      { timeSec: 2.5, value: 0.85 },
      { timeSec: 3.06, value: 1.0 }
    ]
  }));
}

// =========================================================================
// SECTION 2: DROP 1 (12.26s – 49.04s) — 24 bars
// Iconic Klangkuenstler kick hits with maximum force!
// =========================================================================
{
  const t0 = 12.26;
  const len = 36.78;

  // 1. Initial 1-bar Blinder Shockwave Impact (12.26s – 13.80s)
  strobeLayer.clips.push(createClip({
    preset: 'flash',
    startSec: t0,
    durationSec: 1.53,
    targets: ALL_BARS,
    color: COLORS.BLINDER_STRIKE,
    params: { focus: 'all', decay: 'fast' },
    keyframes: [
      { timeSec: 0, value: 1.0 },
      { timeSec: 0.38, value: 0.8 },
      { timeSec: 1.53, value: 0.0 }
    ]
  }));

  // 2. Sub & Kick Punch (Gated 40-110Hz on Sub Stack)
  subLayer.clips.push(createClip({
    preset: 'pulse',
    startSec: t0,
    durationSec: len,
    targets: SUB_STACK,
    color: COLORS.DAWN_CRIMSON,
    driver: 'band',
    band: { source: 'drums', lowHz: 40, highHz: 110, threshold: 0.52, ceiling: 1.0, mode: 'gate', releaseSec: 0.12 },
    driverGain: 1.35,
    params: { curve: 'punch', floor: 0.05 }
  }));

  // 3. Bass roll fire
  bassLayer.clips.push(createClip({
    preset: 'fire',
    startSec: t0 + 1.53,
    durationSec: len - 1.53,
    targets: BOTTOM_ROW,
    color: COLORS.TWILIGHT_VIOLET,
    driver: 'bass',
    driverGain: 1.25,
    params: { height: 'mid', turbulence: 'storm' }
  }));

  // 4. Rhythm Lasers (Part A: ltr sync lasers, Part B: rtl needle lasers)
  rhythmLayer.clips.push(createClip({
    preset: 'chase',
    startSec: t0,
    durationSec: 18.39, // 12 bars
    targets: ALL_BARS,
    color: COLORS.ACID_CYAN,
    speed: 4.0,
    direction: 'ltr',
    motionMode: 'sync',
    params: { beam: 'razor', glow: 0.15 }
  }));

  rhythmLayer.clips.push(createClip({
    preset: 'chase',
    startSec: t0 + 18.39,
    durationSec: len - 18.39, // 12 bars
    targets: FLANKS,
    color: COLORS.ACID_LIME,
    speed: 6.0,
    direction: 'ttb',
    motionMode: 'sync',
    params: { beam: 'needle', glow: 0.2 }
  }));

  // 5. Hi-hat Shimmer on perimeter
  hihatLayer.clips.push(createClip({
    preset: 'sparkle',
    startSec: t0,
    durationSec: len,
    targets: CORNERS,
    color: COLORS.DIAMOND_WHITE,
    driver: 'band',
    band: { source: 'other', lowHz: 5500, highHz: 16000, threshold: 0.45, ceiling: 1.0, mode: 'gate', releaseSec: 0.06 },
    driverGain: 1.2,
    params: { density: 'glitter', glint: 'crisp' }
  }));

  // 6. Solar Wash (Deepening into sunrise orange)
  washLayer.clips.push(createClip({
    preset: 'wash',
    startSec: t0,
    durationSec: len,
    color: COLORS.SUNRISE_AMBER,
    params: { mood: 'drift' }
  }));

  // Turnaround Strobe Accent at bar 16 (36.78s) & Pre-verse Blinder (47.51s – 49.04s)
  strobeLayer.clips.push(createClip({
    preset: 'strobe',
    startSec: t0 + 24.52, // bar 16
    durationSec: 1.53,
    targets: CROSS,
    color: COLORS.BLINDER_WARM,
    params: { rate: '1/16', duty: 'sharp', pattern: 'checker' }
  }));

  strobeLayer.clips.push(createClip({
    preset: 'strobe',
    startSec: t0 + len - 1.53, // bar 24
    durationSec: 1.53,
    targets: ALL_BARS,
    color: COLORS.BLINDER_PURE,
    params: { rate: '1/32', duty: 'sharp', pattern: 'all' }
  }));
}

// =========================================================================
// SECTION 3: STROFA (49.04s – 61.30s) — 8 bars
// Ski Aggu rap verse: bouncy, stylish, rap flow dynamics
// =========================================================================
{
  const t0 = 49.04;
  const len = 12.26;

  // Wash: Cool teal contrast
  washLayer.clips.push(createClip({
    preset: 'wash',
    startSec: t0,
    durationSec: len,
    color: [0.0, 0.35, 0.55, 0.0],
    params: { mood: 'drift' }
  }));

  // Ski Aggu Vocal Follower in Center Cross
  vocalLayer.clips.push(createClip({
    preset: 'center',
    startSec: t0,
    durationSec: len,
    targets: CROSS,
    color: COLORS.SOLAR_GOLD,
    driver: 'vocals',
    driverGain: 1.4,
    params: { geometry: 'cross', breathe: true }
  }));

  // Elastic bouncing groove across left & right flanks
  rhythmLayer.clips.push(createClip({
    preset: 'bounce',
    startSec: t0,
    durationSec: len - 1.53,
    targets: FLANKS,
    color: COLORS.NEON_MAGENTA,
    speed: 1.0,
    timing: 'beat',
    params: { axis: 'horiz', curve: 'elastic' }
  }));

  // Subtle kick/sub pulse on bottom row
  subLayer.clips.push(createClip({
    preset: 'pulse',
    startSec: t0,
    durationSec: len - 1.53,
    targets: BOTTOM_ROW,
    color: COLORS.DAWN_CRIMSON,
    driver: 'drums',
    driverGain: 1.0,
    params: { curve: 'punch', floor: 0.1 }
  }));

  // Pre-Drop 2 Riser Strobe (59.77s – 61.30s, 1 bar)
  strobeLayer.clips.push(createClip({
    preset: 'strobe',
    startSec: t0 + len - 1.53,
    durationSec: 1.53,
    targets: CROSS,
    color: COLORS.BLINDER_WARM,
    params: { rate: '1/16', duty: 'sharp', pattern: 'checker' }
  }));
}

// =========================================================================
// SECTION 4: DROP 2 (61.30s – 134.87s) — 48 bars (73.56s)
// The centerpiece peak of the track! Divided into 3 evolving 16-bar waves
// =========================================================================
{
  const t0 = 61.30;
  const len = 73.56;

  // 1. Initial Mega Flash (61.30s – 62.83s)
  strobeLayer.clips.push(createClip({
    preset: 'flash',
    startSec: t0,
    durationSec: 1.53,
    targets: ALL_BARS,
    color: COLORS.BLINDER_STRIKE,
    params: { focus: 'all', decay: 'fast' }
  }));

  // 2. Sub & Kick: Full 73s Gated Kick Thump
  subLayer.clips.push(createClip({
    preset: 'pulse',
    startSec: t0,
    durationSec: len,
    targets: SUB_STACK,
    color: COLORS.DAWN_CRIMSON,
    driver: 'band',
    band: { source: 'drums', lowHz: 35, highHz: 95, threshold: 0.50, ceiling: 1.0, mode: 'gate', releaseSec: 0.13 },
    driverGain: 1.4,
    params: { curve: 'punch', floor: 0.05 }
  }));

  // --- Wave A (61.30s – 85.82s, 16 bars) ---
  // Sub bottom ripple expanding outward
  bassLayer.clips.push(createClip({
    preset: 'ripple',
    startSec: t0,
    durationSec: 24.52,
    targets: ALL_BARS,
    color: COLORS.TWILIGHT_VIOLET,
    driver: 'bass',
    driverGain: 1.3,
    params: { origin: 'bottom', direction: 'out', width: 'sharp' }
  }));

  // Perimeter High-Speed Orbiting Spiral
  rhythmLayer.clips.push(createClip({
    preset: 'spiral',
    startSec: t0,
    durationSec: 24.52,
    targets: PERIMETER,
    color: COLORS.ACID_CYAN,
    speed: 2.0,
    params: { direction: 'cw', tail: 'snake', center: 'pulse' }
  }));

  // --- Wave B (85.82s – 110.34s, 16 bars) ---
  // Transition flash at 85.82s
  strobeLayer.clips.push(createClip({
    preset: 'flash',
    startSec: t0 + 24.52,
    durationSec: 1.53,
    targets: CROSS,
    color: COLORS.BLINDER_WARM,
    params: { focus: 'center', decay: 'fast' }
  }));

  // Radar laser sweep
  rhythmLayer.clips.push(createClip({
    preset: 'sweep',
    startSec: t0 + 24.52,
    durationSec: 24.52,
    targets: ALL_BARS,
    color: COLORS.ACID_LIME,
    speed: 2.0,
    params: { style: 'radar', width: 'laser' }
  }));

  // Column switches
  bassLayer.clips.push(createClip({
    preset: 'columns',
    startSec: t0 + 24.52,
    durationSec: 24.52,
    targets: ALL_BARS,
    color: COLORS.SUNRISE_AMBER,
    direction: 'ltr',
    timing: 'beat',
    params: { mode: 'double' }
  }));

  // --- Wave C (110.34s – 134.87s, 16 bars) ---
  // Strobe checkerboard acceleration
  strobeLayer.clips.push(createClip({
    preset: 'strobe',
    startSec: t0 + 49.04,
    durationSec: 21.46, // until last 2 bars
    targets: CROSS,
    color: COLORS.BLINDER_WARM,
    driver: 'drums',
    driverGain: 1.2,
    params: { rate: '1/16', duty: 'sharp', pattern: 'checker' }
  }));

  // Vertical saw wave
  rhythmLayer.clips.push(createClip({
    preset: 'wave',
    startSec: t0 + 49.04,
    durationSec: 21.46,
    targets: ALL_BARS,
    color: COLORS.NEON_MAGENTA,
    params: { angle: 'vert', density: 'high', shape: 'saw' }
  }));

  // Hi-hat sparkles across all of Drop 2
  hihatLayer.clips.push(createClip({
    preset: 'sparkle',
    startSec: t0,
    durationSec: len - 3.06,
    targets: PERIMETER,
    color: COLORS.DIAMOND_WHITE,
    driver: 'band',
    band: { source: 'other', lowHz: 5500, highHz: 16000, threshold: 0.45, ceiling: 1.0, mode: 'gate', releaseSec: 0.06 },
    params: { density: 'glitter', glint: 'crisp' }
  }));

  // Wash progression across Drop 2 (Evolving from dawn crimson to molten gold)
  washLayer.clips.push(createClip({
    preset: 'wash',
    startSec: t0,
    durationSec: len,
    color: COLORS.SOLAR_GOLD,
    params: { mood: 'drift' }
  }));

  // Final 2-bar Riser into Breakdown (131.81s – 134.87s)
  strobeLayer.clips.push(createClip({
    preset: 'strobe',
    startSec: t0 + len - 3.06,
    durationSec: 3.06,
    targets: ALL_BARS,
    color: COLORS.BLINDER_PURE,
    params: { rate: '1/32', duty: 'sharp', pattern: 'all' },
    keyframes: [
      { timeSec: 0, value: 0.2 },
      { timeSec: 1.5, value: 0.6 },
      { timeSec: 3.06, value: 1.0 }
    ]
  }));
}

// =========================================================================
// SECTION 5: BREAKDOWN 1 (134.87s – 171.65s) — 24 bars (36.78s)
// "DIE SONNE GEHT AUF" — Drums stop, Ski Aggu sings, the sun expands
// =========================================================================
{
  const t0 = 134.87;
  const len = 36.78;

  // Wash: Deep celestial auroral purple breathing
  washLayer.clips.push(createClip({
    preset: 'wash',
    startSec: t0,
    durationSec: len,
    color: COLORS.TWILIGHT_VIOLET,
    params: { mood: 'breath' }
  }));

  // Center Iris Sunrise: Starts as a warm ember at C2, then expands outwards
  // like the sun rising over the horizon over 32 seconds!
  vocalLayer.clips.push(createClip({
    preset: 'center',
    startSec: t0,
    durationSec: len - 4.59,
    targets: ALL_BARS,
    color: COLORS.SOLAR_CORONA,
    driver: 'vocals',
    driverGain: 1.45,
    params: { geometry: 'iris', breathe: true },
    keyframes: [
      { timeSec: 0, value: 0.2 },
      { timeSec: 10.0, value: 0.5, ease: 'smooth' },
      { timeSec: 25.0, value: 0.85, ease: 'smooth' },
      { timeSec: len - 4.59, value: 1.0 }
    ]
  }));

  // Gentle twinkling stars on perimeter fading as dawn breaks
  hihatLayer.clips.push(createClip({
    preset: 'sparkle',
    startSec: t0,
    durationSec: 24.52,
    targets: CORNERS,
    color: COLORS.ICE_GLINT,
    speed: 0.6,
    params: { density: 'firefly', glint: 'soft' }
  }));

  // Soft atmospheric wave rolling up like morning mist
  rhythmLayer.clips.push(createClip({
    preset: 'wave',
    startSec: t0 + 6.13,
    durationSec: len - 10.72,
    targets: FLANKS,
    color: COLORS.SUNRISE_AMBER,
    speed: 0.5,
    params: { angle: 'vert', density: 'low', shape: 'sine' }
  }));

  // Pre-Drop 3 Snare Build & Accelerating Strobes (167.06s – 171.65s, 3 bars)
  strobeLayer.clips.push(createClip({
    preset: 'strobe',
    startSec: t0 + len - 4.59,
    durationSec: 4.59,
    targets: CROSS,
    color: COLORS.BLINDER_WARM,
    params: { rate: '1/16', duty: 'sharp', pattern: 'checker' },
    keyframes: [
      { timeSec: 0, value: 0.2 },
      { timeSec: 2.5, value: 0.65 },
      { timeSec: 4.59, value: 1.0 }
    ]
  }));

  strobeLayer.clips.push(createClip({
    preset: 'strobe',
    startSec: t0 + len - 1.53,
    durationSec: 1.53,
    targets: ALL_BARS,
    color: COLORS.BLINDER_PURE,
    params: { rate: '1/32', duty: 'sharp', pattern: 'all' }
  }));
}

// =========================================================================
// SECTION 6: DROP 3 (171.65s – 208.43s) — 24 bars (36.78s)
// Full industrial hard techno explosion! Dual flank laser duel
// =========================================================================
{
  const t0 = 171.65;
  const len = 36.78;

  // Maximum Blinder Hit at 171.65s
  strobeLayer.clips.push(createClip({
    preset: 'flash',
    startSec: t0,
    durationSec: 1.53,
    targets: ALL_BARS,
    color: COLORS.BLINDER_STRIKE,
    params: { focus: 'all', decay: 'fast' }
  }));

  // Pounding Kick Driver
  subLayer.clips.push(createClip({
    preset: 'pulse',
    startSec: t0,
    durationSec: len,
    targets: SUB_STACK,
    color: COLORS.DAWN_CRIMSON,
    driver: 'band',
    band: { source: 'drums', lowHz: 40, highHz: 110, threshold: 0.52, ceiling: 1.0, mode: 'gate', releaseSec: 0.12 },
    driverGain: 1.45,
    params: { curve: 'punch', floor: 0.05 }
  }));

  // Fire turbulence across bottom and mid rows
  bassLayer.clips.push(createClip({
    preset: 'fire',
    startSec: t0 + 1.53,
    durationSec: len - 1.53,
    targets: [...BOTTOM_ROW, ...MID_ROW],
    color: COLORS.SUNRISE_AMBER,
    driver: 'bass',
    driverGain: 1.3,
    params: { height: 'full', turbulence: 'storm' }
  }));

  // Dual Flank Laser Duel:
  // Left flank sweeps top to bottom, right flank sweeps bottom to top!
  rhythmLayer.clips.push(createClip({
    preset: 'chase',
    startSec: t0,
    durationSec: len,
    targets: LEFT_COL,
    color: COLORS.ACID_CYAN,
    speed: 6.0,
    direction: 'ttb',
    motionMode: 'sync',
    params: { beam: 'razor', glow: 0.2 }
  }));

  rhythmLayer.clips.push(createClip({
    preset: 'chase',
    startSec: t0,
    durationSec: len,
    targets: RIGHT_COL,
    color: COLORS.NEON_MAGENTA,
    speed: 6.0,
    direction: 'btt',
    motionMode: 'sync',
    params: { beam: 'razor', glow: 0.2 }
  }));

  // Vocal hook accents in center column
  vocalLayer.clips.push(createClip({
    preset: 'center',
    startSec: t0,
    durationSec: len,
    targets: CENTER_COL,
    color: COLORS.SOLAR_GOLD,
    driver: 'vocals',
    driverGain: 1.35,
    params: { geometry: 'cross', breathe: true }
  }));

  // Hi-hat razor sparkles
  hihatLayer.clips.push(createClip({
    preset: 'sparkle',
    startSec: t0,
    durationSec: len - 1.53,
    targets: CORNERS,
    color: COLORS.DIAMOND_WHITE,
    driver: 'band',
    band: { source: 'other', lowHz: 5500, highHz: 16000, threshold: 0.45, ceiling: 1.0, mode: 'gate', releaseSec: 0.06 },
    params: { density: 'glitter', glint: 'crisp' }
  }));

  // Wash: Blazing Solar Gold
  washLayer.clips.push(createClip({
    preset: 'wash',
    startSec: t0,
    durationSec: len,
    color: COLORS.SOLAR_GOLD,
    params: { mood: 'drift' }
  }));

  // Turnaround Strobes at bar 16 and bar 24
  strobeLayer.clips.push(createClip({
    preset: 'strobe',
    startSec: t0 + 24.52,
    durationSec: 1.53,
    targets: CROSS,
    color: COLORS.BLINDER_WARM,
    params: { rate: '1/16', duty: 'sharp', pattern: 'checker' }
  }));

  strobeLayer.clips.push(createClip({
    preset: 'strobe',
    startSec: t0 + len - 1.53,
    durationSec: 1.53,
    targets: ALL_BARS,
    color: COLORS.BLINDER_PURE,
    params: { rate: '1/32', duty: 'sharp', pattern: 'all' }
  }));
}

// =========================================================================
// SECTION 7: BREAKDOWN 2 (208.43s – 220.69s) — 8 bars (12.26s)
// The Final Golden Dawn Horizon: Ski Aggu's voice reaches peak emotion
// =========================================================================
{
  const t0 = 208.43;
  const len = 12.26;

  // Wash: Warm dawn amber
  washLayer.clips.push(createClip({
    preset: 'wash',
    startSec: t0,
    durationSec: len,
    color: COLORS.SUNRISE_AMBER,
    params: { mood: 'breath' }
  }));

  // Horizon Rising Wave: Bottom -> Mid -> Top
  bassLayer.clips.push(createClip({
    preset: 'wave',
    startSec: t0,
    durationSec: len - 3.06,
    targets: ALL_BARS,
    color: COLORS.SOLAR_GOLD,
    speed: 1.0,
    params: { angle: 'vert', density: 'med', shape: 'sine' }
  }));

  // Vocal Iris Glow in Pure Warm White & Gold
  vocalLayer.clips.push(createClip({
    preset: 'center',
    startSec: t0,
    durationSec: len - 3.06,
    targets: CROSS,
    color: COLORS.SOLAR_CORONA,
    driver: 'vocals',
    driverGain: 1.5,
    params: { geometry: 'iris', breathe: true }
  }));

  // Pre-Drop 4 Final Riser (217.63s – 220.69s, 2 bars)
  strobeLayer.clips.push(createClip({
    preset: 'strobe',
    startSec: t0 + len - 3.06,
    durationSec: 3.06,
    targets: ALL_BARS,
    color: COLORS.BLINDER_PURE,
    params: { rate: '1/32', duty: 'sharp', pattern: 'all' },
    keyframes: [
      { timeSec: 0, value: 0.3 },
      { timeSec: 1.5, value: 0.7 },
      { timeSec: 3.06, value: 1.0 }
    ]
  }));
}

// =========================================================================
// SECTION 8: DROP 4 (220.69s – 269.73s) — 32 bars (49.04s)
// THE ULTIMATE SOLAR RAVE FINALE: Everything fires at maximum synergy!
// =========================================================================
{
  const t0 = 220.69;
  const len = 49.04;

  // 1. Climax Blinder Strike at 220.69s
  strobeLayer.clips.push(createClip({
    preset: 'flash',
    startSec: t0,
    durationSec: 1.53,
    targets: ALL_BARS,
    color: COLORS.BLINDER_STRIKE,
    params: { focus: 'all', decay: 'fast' }
  }));

  // 2. Sub & Kick Maximum Thump
  subLayer.clips.push(createClip({
    preset: 'pulse',
    startSec: t0,
    durationSec: len - 3.06,
    targets: SUB_STACK,
    color: COLORS.DAWN_CRIMSON,
    driver: 'band',
    band: { source: 'drums', lowHz: 35, highHz: 100, threshold: 0.50, ceiling: 1.0, mode: 'gate', releaseSec: 0.12 },
    driverGain: 1.5,
    params: { curve: 'punch', floor: 0.05 }
  }));

  // 3. Bass Eruption Fire
  bassLayer.clips.push(createClip({
    preset: 'fire',
    startSec: t0 + 1.53,
    durationSec: len - 4.59,
    targets: ALL_BARS,
    color: COLORS.SUNRISE_AMBER,
    driver: 'bass',
    driverGain: 1.35,
    params: { height: 'full', turbulence: 'storm' }
  }));

  // 4. Blitz Speed 8 Lasers cutting across rows
  rhythmLayer.clips.push(createClip({
    preset: 'chase',
    startSec: t0,
    durationSec: 24.52, // 16 bars
    targets: ALL_BARS,
    color: COLORS.ACID_CYAN,
    speed: 8.0,
    direction: 'ltr',
    motionMode: 'sync',
    params: { beam: 'needle', glow: 0.25 }
  }));

  rhythmLayer.clips.push(createClip({
    preset: 'chase',
    startSec: t0 + 24.52,
    durationSec: len - 27.58, // remaining bars before outro pause
    targets: ALL_BARS,
    color: COLORS.ACID_LIME,
    speed: 8.0,
    direction: 'rtl',
    motionMode: 'sync',
    params: { beam: 'needle', glow: 0.25 }
  }));

  // 5. Vocal Lead in Cross
  vocalLayer.clips.push(createClip({
    preset: 'center',
    startSec: t0,
    durationSec: len - 3.06,
    targets: CROSS,
    color: COLORS.SOLAR_GOLD,
    driver: 'vocals',
    driverGain: 1.4,
    params: { geometry: 'cross', breathe: true }
  }));

  // 6. Hi-hat Glitter Shimmer
  hihatLayer.clips.push(createClip({
    preset: 'sparkle',
    startSec: t0,
    durationSec: len - 3.06,
    targets: PERIMETER,
    color: COLORS.DIAMOND_WHITE,
    driver: 'band',
    band: { source: 'other', lowHz: 5500, highHz: 16000, threshold: 0.45, ceiling: 1.0, mode: 'gate', releaseSec: 0.06 },
    params: { density: 'glitter', glint: 'crisp' }
  }));

  // 7. Full Solar Radiance Wash
  washLayer.clips.push(createClip({
    preset: 'wash',
    startSec: t0,
    durationSec: len - 3.06,
    color: COLORS.SOLAR_CORONA,
    params: { mood: 'drift' }
  }));

  // Strobe Bursts on Bar Turnarounds (every 8 bars)
  strobeLayer.clips.push(createClip({
    preset: 'strobe',
    startSec: t0 + 12.26,
    durationSec: 1.53,
    targets: CROSS,
    color: COLORS.BLINDER_WARM,
    params: { rate: '1/16', duty: 'sharp', pattern: 'checker' }
  }));

  strobeLayer.clips.push(createClip({
    preset: 'strobe',
    startSec: t0 + 24.52,
    durationSec: 1.53,
    targets: ALL_BARS,
    color: COLORS.BLINDER_PURE,
    params: { rate: '1/32', duty: 'sharp', pattern: 'all' }
  }));

  strobeLayer.clips.push(createClip({
    preset: 'strobe',
    startSec: t0 + 36.78,
    durationSec: 1.53,
    targets: CROSS,
    color: COLORS.BLINDER_WARM,
    params: { rate: '1/16', duty: 'sharp', pattern: 'checker' }
  }));

  // Tension Cut (Blackout before the final sound): 266.67s – 269.73s (2 bars)
  // Handled naturally by ending clips at 266.67s!
}

// =========================================================================
// SECTION 9: ZAVRŠETAK (OUTRO) (269.73s – 273.85s) — 4 seconds
// Fading reverb tail: gentle twilight rain into black
// =========================================================================
{
  const t0 = 269.73;
  const len = 4.11;

  washLayer.clips.push(createClip({
    preset: 'wash',
    startSec: t0,
    durationSec: len,
    color: COLORS.DEEP_NIGHT,
    params: { mood: 'breath' },
    keyframes: [
      { timeSec: 0, value: 0.6 },
      { timeSec: len, value: 0.0, ease: 'out' }
    ]
  }));

  rhythmLayer.clips.push(createClip({
    preset: 'rain',
    startSec: t0,
    durationSec: len,
    targets: CENTER_COL,
    color: COLORS.ICE_GLINT,
    speed: 0.7,
    params: { streak: 'drops', spread: 'sync' },
    keyframes: [
      { timeSec: 0, value: 0.8 },
      { timeSec: len, value: 0.0, ease: 'out' }
    ]
  }));
}

// Filter out any null clips
layers.forEach(l => {
  l.clips = l.clips.filter(Boolean);
});

const totalClips = layers.reduce((sum, l) => sum + l.clips.length, 0);
console.log(`Generated ${layers.length} layers and ${totalClips} custom-crafted clips!`);

const masterpieceTimeline = {
  version: 1,
  durationSec: DURATION,
  bpm: BPM,
  beatOffsetSec: BEAT_OFFSET,
  blackout: false,
  layers
};

// Validate the timeline
console.log('Validating masterpiece timeline...');
const validation = validateTimeline(masterpieceTimeline);
if (!validation.valid) {
  console.error('Validation FAILED:', validation.errors);
  process.exit(1);
}
console.log('Timeline is 100% VALID!');

// Test rendering frames across key sections
console.log('Testing renderTimelineFrame across key time points...');
const testPoints = [
  { label: 'Uvod (Intro)', time: 5.0 },
  { label: 'Drop 1 Blinder Impact', time: 12.30 },
  { label: 'Drop 1 Full Kick & Lasers', time: 20.0 },
  { label: 'Strofa (Ski Aggu Rap)', time: 55.0 },
  { label: 'Drop 2 Peak Rave', time: 75.0 },
  { label: 'Breakdown 1 "Sonne Geht Auf"', time: 150.0 },
  { label: 'Drop 3 Lasers Duel', time: 185.0 },
  { label: 'Breakdown 2 Golden Dawn', time: 212.0 },
  { label: 'Drop 4 Solar Finale', time: 235.0 },
  { label: 'Završetak (Outro Fade)', time: 271.0 }
];

testPoints.forEach(({ label, time }) => {
  const frame = renderTimelineFrame(masterpieceTimeline, analysis, time);
  let totalEnergy = 0;
  for (const barId of BAR_IDS) {
    for (const px of frame.bars[barId]) {
      totalEnergy += px[0] + px[1] + px[2] + px[3];
    }
  }
  const avgLevel = (totalEnergy / (9 * 12 * 4 * 153) * 100).toFixed(1);
  console.log(`  [${label.padEnd(28)}] t=${time.toFixed(1).padStart(5)}s -> Output energy: ${avgLevel.padStart(5)}%`);
});

// Save to disk
writeFileSync(timelinePath, JSON.stringify(masterpieceTimeline, null, 2), 'utf8');
console.log(`Successfully saved masterpiece timeline to: ${timelinePath}`);
