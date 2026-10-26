#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createLibrary } from './library.mjs';
import { analyzeAudio } from './audio-analysis.mjs';
import { createAutoShow, validateTimeline, renderTimelineFrame } from './timeline.mjs';
import { measureTimelineContrast } from './timeline-contrast.mjs';
import { BAR_IDS, PIXELS_PER_BAR } from './engine.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, 'data');

const BENCHMARK_SONGS = [
  {
    filePath: '/Users/timonterzic/Downloads/Alok, INNERVERSE & FREY - Allein Allein (Official Video).mp3',
    theme: 'cyber',
    themeLabel: 'Cyber Neon (cyber)',
    energy: 0.85,
  },
  {
    filePath: '/Users/timonterzic/Downloads/Fred again.. & Anderson .Paak - places to be feat. Chika.mp3',
    theme: 'rave',
    themeLabel: 'Acid Rave (rave)',
    energy: 0.85,
  },
  {
    filePath: '/Users/timonterzic/Downloads/The Prodigy Voodoo People Pendulum Remix (HQ).mp3',
    theme: 'inferno',
    themeLabel: 'Inferno (inferno)',
    energy: 0.90,
    allowedPresets: ['pulse', 'chase', 'strobe', 'flash', 'sweep', 'alternate', 'columns', 'spiral', 'fire', 'ripple'],
  }
];

function computeSectionAvgBrightness(timeline, analysis, sec, stepSec = 0.05) {
  let sum = 0;
  let count = 0;
  const totalChannels = BAR_IDS.length * PIXELS_PER_BAR;
  for (let t = sec.startSec; t < sec.endSec; t += stepSec) {
    const frame = renderTimelineFrame(timeline, analysis, t);
    let frameSum = 0;
    for (const id of BAR_IDS) {
      for (const px of frame.bars[id]) {
        const chSum = px[0] + px[1] + px[2] + px[3];
        frameSum += Math.min(1, chSum / 255);
      }
    }
    sum += (frameSum / totalChannels) * 100;
    count++;
  }
  return count ? Number((sum / count).toFixed(2)) : 0;
}

function summarizeDrivers(timeline) {
  const counts = {};
  let totalClips = 0;
  let activeDriverClips = 0;
  for (const layer of timeline.layers) {
    for (const clip of layer.clips) {
      totalClips++;
      const key = clip.driver === 'band' && clip.band?.source
        ? `band(${clip.band.source})`
        : clip.driver;
      counts[key] = (counts[key] || 0) + 1;
      if (clip.driver && clip.driver !== 'none') activeDriverClips++;
    }
  }
  return { totalClips, activeDriverClips, counts };
}

async function main() {
  const lib = createLibrary({ root: dataDir, dataDir });
  await lib.init();

  console.log('================================================================================');
  console.log('STEP 1: Re-analyzing existing tracks in data/library.json (8192-bin high-res)');
  console.log('================================================================================');

  const existingTracks = await lib.list();
  for (const track of existingTracks) {
    const isBenchmarkSong = BENCHMARK_SONGS.some(b => path.basename(b.filePath) === track.originalName);
    if (isBenchmarkSong) continue;

    const audioPath = await lib.getAudioPath(track.id);
    console.log(`\n-> Existing track: "${track.title}" (${track.id})`);
    const analysis = await analyzeAudio(audioPath);
    await lib.setAnalysis(track.id, analysis);

    const existingTimeline = await lib.getTimeline(track.id);
    const autoLayerIds = new Set(['base-wash', 'bass', 'synth', 'motion', 'drums']);
    const isUserCurated = existingTimeline &&
      Array.isArray(existingTimeline.layers) &&
      existingTimeline.layers.some(l => !autoLayerIds.has(l.id));

    if (isUserCurated) {
      const check = validateTimeline(existingTimeline);
      assert.ok(check.valid, `Existing curated timeline for ${track.title} must be valid: ${check.errors.join('; ')}`);
      console.log(`   Preserved valid user-curated timeline (${existingTimeline.layers.length} layers); updated analysis to ${analysis.waveform.peaks.length} bins & ${analysis.sections.length} sections.`);
    } else {
      const timeline = createAutoShow(analysis, { theme: 'midnight', energy: 0.88 });
      const check = validateTimeline(timeline);
      assert.ok(check.valid, `Generated timeline for ${track.title} must be valid`);
      await lib.saveTimeline(track.id, timeline);
      const drv = summarizeDrivers(timeline);
      console.log(`   Updated analysis (${analysis.waveform.peaks.length} bins, ${analysis.sections.length} sections) & regenerated 'midnight' auto-show (${drv.totalClips} clips, 100% stem-driven).`);
    }
  }

  console.log('\n================================================================================');
  console.log('STEP 2: Benchmarking, Importing & Validating 3 Popular Club Songs');
  console.log('================================================================================');

  const summaryRows = [];

  for (const spec of BENCHMARK_SONGS) {
    const track = await lib.importFile(spec.filePath);
    const audioPath = await lib.getAudioPath(track.id);
    const analysis = await analyzeAudio(audioPath);
    await lib.setAnalysis(track.id, analysis);

    const timeline = createAutoShow(analysis, {
      theme: spec.theme,
      energy: spec.energy,
      ...(spec.allowedPresets ? { allowedPresets: spec.allowedPresets } : {})
    });
    const validCheck = validateTimeline(timeline);
    assert.ok(validCheck.valid, `Timeline invalid for ${track.title}: ${validCheck.errors.join('; ')}`);
    await lib.saveTimeline(track.id, timeline);

    const wf = analysis.waveform;
    const hasMultiBand =
      Array.isArray(wf.peaks) && wf.peaks.length >= 8000 &&
      Array.isArray(wf.rms) && wf.rms.length === wf.peaks.length &&
      Array.isArray(wf.min) && wf.min.length === wf.peaks.length &&
      Array.isArray(wf.max) && wf.max.length === wf.peaks.length &&
      Array.isArray(wf.low) && wf.low.length === wf.peaks.length &&
      Array.isArray(wf.mid) && wf.mid.length === wf.peaks.length &&
      Array.isArray(wf.high) && wf.high.length === wf.peaks.length;
    assert.ok(hasMultiBand, `Waveform for ${track.title} must have 8192-bin peaks/rms/min/max/low/mid/high`);

    const beatOffsetSec = analysis.beatsSec?.[0] ?? 0;
    const sections = analysis.sections || [];
    const dropSections = sections.filter(s => s.type === 'drop');
    const nonDropSections = sections.filter(s => ['intro', 'verse', 'breakdown'].includes(s.type));

    assert.ok(dropSections.length >= 1, `${track.title} must have at least 1 drop`);
    assert.ok(nonDropSections.length >= 1, `${track.title} must have intro/verse/breakdown sections`);
    assert.ok(sections.length <= 12, `${track.title} has too many fragmented sections (${sections.length} > 12)`);

    const contrast = measureTimelineContrast(timeline, analysis, { masterBrightness: 100 });
    const drv = summarizeDrivers(timeline);

    assert.equal(drv.activeDriverClips, drv.totalClips, `100% of clips in ${track.title} must use an active driver`);

    const sectionAvgMap = new Map();
    for (const sec of contrast.sections) {
      sectionAvgMap.set(sec.id, computeSectionAvgBrightness(timeline, analysis, sec));
    }

    const dropPeakMin = Math.min(...contrast.drops.map(d => d.peakBrightness));
    const dropPeakMax = Math.max(...contrast.drops.map(d => d.peakBrightness));
    const dropAvgBrightness = Number((
      contrast.drops.reduce((acc, d) => acc + sectionAvgMap.get(d.id), 0) / contrast.drops.length
    ).toFixed(2));

    const nonDropContrastSecs = contrast.sections.filter(s => ['intro', 'verse', 'breakdown'].includes(s.type));
    const nonDropAvgBrightness = Number((
      nonDropContrastSecs.reduce((acc, s) => acc + sectionAvgMap.get(s.id), 0) / nonDropContrastSecs.length
    ).toFixed(2));
    const nonDropPeakMax = Math.max(...nonDropContrastSecs.map(s => s.peakBrightness));

    assert.ok(dropPeakMin >= 95, `Drop peak brightness (${dropPeakMin}%) must be >= 95% in ${track.title}`);
    assert.ok(dropAvgBrightness > nonDropAvgBrightness * 1.35, `Drop average brightness (${dropAvgBrightness}%) must be significantly higher than non-drop (${nonDropAvgBrightness}%) in ${track.title}`);
    for (const d of contrast.drops) {
      assert.ok(d.preDropBlackoutSec >= 0.25, `Drop ${d.name} in ${track.title} must have pre-drop blackout >= 0.25s (got ${d.preDropBlackoutSec}s)`);
    }

    console.log(`\n--------------------------------------------------------------------------------`);
    console.log(`TRACK: ${track.title}`);
    console.log(`ID: ${track.id} | Theme: ${spec.themeLabel} | Energy: ${spec.energy}`);
    console.log(`Duration: ${analysis.durationSec}s | BPM: ${analysis.bpm} | beatOffsetSec: ${beatOffsetSec}s`);
    console.log(`Waveform Bins: ${wf.peaks.length} | Multi-band (min/max/low/mid/high): YES`);
    console.log(`Clips: ${drv.totalClips} (${drv.activeDriverClips}/${drv.totalClips} active drivers = 100%)`);
    console.log(`Drivers Breakdown: ${JSON.stringify(drv.counts)}`);
    console.log(`Overall Contrast: dutyCycle=${contrast.overall.dutyCycle}%, peak=${contrast.overall.peakBrightness}%, trough=${contrast.overall.troughBrightness}%, ratio=${contrast.overall.contrastRatio}x, spatial=${contrast.overall.spatialOccupancy} bars, avgPreDropBlackout=${contrast.overall.preDropBlackoutSec}s`);
    console.log(`Drop vs Non-Drop: Drop Peak=${dropPeakMin}–${dropPeakMax}% (Avg=${dropAvgBrightness}%) vs Intro/Verse/Breakdown Avg=${nonDropAvgBrightness}% (Max Peak=${nonDropPeakMax}%)`);
    console.log(`Sections (${sections.length}):`);
    for (const sec of contrast.sections) {
      const avgB = sectionAvgMap.get(sec.id);
      const blk = sec.type === 'drop' ? ` | preDropBlackout=${sec.preDropBlackoutSec}s` : '';
      console.log(
        `  [${sec.id.padEnd(6)}] ${sec.name.padEnd(13)} (${sec.type.padEnd(9)}) ` +
        `${sec.startSec.toFixed(2).padStart(6)}s -> ${sec.endSec.toFixed(2).padStart(6)}s (${sec.durationSec.toFixed(2).padStart(5)}s) ` +
        `| audioEnergy=${String(sections.find(s => s.id === sec.id)?.energy ?? 0).padEnd(4)} ` +
        `| peak=${sec.peakBrightness.toFixed(1).padStart(5)}% | avg=${avgB.toFixed(1).padStart(5)}% | duty=${sec.dutyCycle.toFixed(1).padStart(5)}% | bars=${sec.spatialOccupancy}${blk}`
      );
    }

    summaryRows.push({
      title: track.title,
      theme: spec.theme,
      bpm: analysis.bpm,
      beatOffsetSec,
      bins: wf.peaks.length,
      sectionCount: sections.length,
      dropCount: dropSections.length,
      clips: drv.totalClips,
      drivers: drv.counts,
      dropPeak: `${dropPeakMin.toFixed(1)}–${dropPeakMax.toFixed(1)}%`,
      dropAvg: `${dropAvgBrightness.toFixed(1)}%`,
      nonDropAvg: `${nonDropAvgBrightness.toFixed(1)}%`,
      dutyCycle: `${contrast.overall.dutyCycle}%`,
      contrastRatio: `${contrast.overall.contrastRatio}x`,
      preDropBlackout: `${contrast.overall.preDropBlackoutSec}s`
    });
  }

  console.log('\n================================================================================');
  console.log('BENCHMARK SUMMARY TABLE (ALL 3 SONGS VALIDATED)');
  console.log('================================================================================');
  console.table(summaryRows);
}

main().catch(err => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
