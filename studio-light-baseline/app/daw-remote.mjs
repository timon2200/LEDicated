/** Unified timeline operation dispatcher for LEDicated.
 * Used by server.mjs, mcp-tools.mjs, and daw.mjs to guarantee identical
 * behavior between UI user interactions, server-side edits, and MCP agent commands.
 */
import { BAR_IDS } from './engine.mjs';
import {
  addLayer, removeLayer, duplicateLayer, addClip, moveClip, resizeClip,
  splitClip, deleteClips, duplicateClips, patchClips, findClip,
  addKeyframe, removeKeyframe, setKeyframeEase, clamp, uid
} from './daw-state.mjs';
import { createAutoShow, validateTimeline, TIMELINE_PRESETS, TIMELINE_BLENDS, DEFAULT_BAND } from './timeline.mjs';

export function normalizeColor(color) {
  if (typeof color === 'string') {
    const raw = color.trim().replace(/^#/, '');
    if (raw.length === 3) {
      const [r, g, b] = raw.split('').map(c => parseInt(c + c, 16) / 255);
      return [r, g, b, 0];
    }
    if (raw.length === 6) {
      const r = parseInt(raw.slice(0, 2), 16) / 255;
      const g = parseInt(raw.slice(2, 4), 16) / 255;
      const b = parseInt(raw.slice(4, 6), 16) / 255;
      return [r, g, b, 0];
    }
    if (raw.length === 8) {
      const r = parseInt(raw.slice(0, 2), 16) / 255;
      const g = parseInt(raw.slice(2, 4), 16) / 255;
      const b = parseInt(raw.slice(4, 6), 16) / 255;
      const w = parseInt(raw.slice(6, 8), 16) / 255;
      return [r, g, b, w];
    }
    return [1, 1, 1, 0];
  }
  if (Array.isArray(color)) {
    const r = clamp(Number.isFinite(color[0]) ? color[0] : 1, 0, 1);
    const g = clamp(Number.isFinite(color[1]) ? color[1] : 1, 0, 1);
    const b = clamp(Number.isFinite(color[2]) ? color[2] : 1, 0, 1);
    const w = clamp(Number.isFinite(color[3]) ? color[3] : 0, 0, 1);
    return [r, g, b, w];
  }
  return [1, 1, 1, 0];
}

export function resolveClipRef(timeline, item) {
  if (!item || !timeline || !Array.isArray(timeline.layers)) return null;
  if (typeof item === 'object' && item.layerId && item.clipId) {
    const hit = findClip(timeline, item);
    return hit ? { layerId: item.layerId, clipId: item.clipId } : null;
  }
  const clipId = typeof item === 'string' ? item : item.clipId || item.id;
  if (!clipId) return null;
  for (const layer of timeline.layers) {
    const clip = layer.clips?.find(c => c.id === clipId);
    if (clip) return { layerId: layer.id, clipId };
  }
  return null;
}

export function applyTimelineOp(timeline, op, args = {}, analysis = null) {
  if (!timeline || typeof timeline !== 'object') throw new Error('Timeline must be an object');
  if (!Array.isArray(timeline.layers)) timeline.layers = [];

  switch (op) {
    case 'add_layer': {
      const layer = addLayer(timeline, {
        name: args.name,
        color: args.color,
        blend: TIMELINE_BLENDS.includes(args.blend) ? args.blend : 'screen',
        opacity: Number.isFinite(args.opacity) ? clamp(args.opacity, 0, 1) : 0.7,
        index: args.index
      });
      return { ok: true, layer };
    }

    case 'remove_layer': {
      const index = removeLayer(timeline, args.layerId);
      if (index < 0) throw new Error(`Layer ${args.layerId} not found`);
      return { ok: true, removedIndex: index };
    }

    case 'duplicate_layer': {
      const copy = duplicateLayer(timeline, args.layerId);
      if (!copy) throw new Error(`Layer ${args.layerId} not found`);
      return { ok: true, layer: copy };
    }

    case 'update_layer': {
      const layer = timeline.layers.find(l => l.id === args.layerId);
      if (!layer) throw new Error(`Layer ${args.layerId} not found`);
      if (typeof args.name === 'string') layer.name = args.name.slice(0, 60);
      if (typeof args.color === 'string') layer.color = args.color;
      if (TIMELINE_BLENDS.includes(args.blend)) layer.blend = args.blend;
      if (Number.isFinite(args.opacity)) layer.opacity = clamp(args.opacity, 0, 1);
      if (typeof args.enabled === 'boolean') layer.enabled = args.enabled;
      return { ok: true, layer };
    }

    case 'add_clip': {
      let layerId = args.layerId;
      if (!layerId) {
        if (!timeline.layers.length) addLayer(timeline, { name: 'Glavni sloj' });
        layerId = timeline.layers[0].id;
      }
      const spec = { ...(args.spec || args) };
      if (spec.color) spec.color = normalizeColor(spec.color);
      if (spec.preset && !TIMELINE_PRESETS.includes(spec.preset)) {
        throw new Error(`Nepoznat preset: ${spec.preset}. Dostupni: ${TIMELINE_PRESETS.join(', ')}`);
      }
      const ref = addClip(timeline, layerId, spec);
      const hit = findClip(timeline, ref);
      return { ok: true, ref, clip: hit?.clip };
    }

    case 'patch_clips': {
      const rawRefs = Array.isArray(args.refs) ? args.refs : Array.isArray(args.clipIds) ? args.clipIds : args.clipId ? [args.clipId] : [];
      const resolved = rawRefs.map(r => resolveClipRef(timeline, r)).filter(Boolean);
      if (!resolved.length) throw new Error('Niti jedan clip nije pronađen za izmjenu.');
      const patch = { ...(args.patch || {}) };
      if (patch.color) patch.color = normalizeColor(patch.color);
      patchClips(timeline, resolved, patch);
      return { ok: true, patchedCount: resolved.length };
    }

    case 'delete_clips': {
      const rawRefs = Array.isArray(args.refs) ? args.refs : Array.isArray(args.clipIds) ? args.clipIds : args.clipId ? [args.clipId] : [];
      const resolved = rawRefs.map(r => resolveClipRef(timeline, r)).filter(Boolean);
      const count = deleteClips(timeline, resolved);
      return { ok: true, deletedCount: count };
    }

    case 'move_clip': {
      const ref = resolveClipRef(timeline, args);
      if (!ref) throw new Error(`Clip ${args.clipId || args.id} not found`);
      const updatedRef = moveClip(timeline, ref, { startSec: args.startSec, layerId: args.targetLayerId });
      return { ok: true, ref: updatedRef };
    }

    case 'resize_clip': {
      const ref = resolveClipRef(timeline, args);
      if (!ref) throw new Error(`Clip ${args.clipId || args.id} not found`);
      const ok = resizeClip(timeline, ref, args.edge || 'end', args.newTimeSec, args.limitSec);
      return { ok, ref };
    }

    case 'split_clip': {
      const ref = resolveClipRef(timeline, args);
      if (!ref) throw new Error(`Clip ${args.clipId || args.id} not found`);
      const result = splitClip(timeline, ref, args.atSec);
      if (!result) throw new Error('Rez nije moguć: točka reza je izvan clipa ili prekratka.');
      return { ok: true, refs: result };
    }

    case 'duplicate_clips': {
      const rawRefs = Array.isArray(args.refs) ? args.refs : Array.isArray(args.clipIds) ? args.clipIds : args.clipId ? [args.clipId] : [];
      const resolved = rawRefs.map(r => resolveClipRef(timeline, r)).filter(Boolean);
      if (!resolved.length) throw new Error('Niti jedan clip nije pronađen za dupliciranje.');
      const created = duplicateClips(timeline, resolved, args.offsetSec || 1, args.layerOffset || 0);
      return { ok: true, created };
    }

    case 'add_keyframe': {
      const ref = resolveClipRef(timeline, args);
      if (!ref) throw new Error(`Clip ${args.clipId || args.id} not found`);
      const hit = findClip(timeline, ref);
      const index = addKeyframe(hit.clip, args.timeSec, args.value ?? 1);
      if (index >= 0 && args.ease) setKeyframeEase(hit.clip, index, args.ease);
      return { ok: index >= 0, keyframeIndex: index, keyframes: hit.clip.keyframes };
    }

    case 'remove_keyframe': {
      const ref = resolveClipRef(timeline, args);
      if (!ref) throw new Error(`Clip ${args.clipId || args.id} not found`);
      const hit = findClip(timeline, ref);
      const ok = removeKeyframe(hit.clip, args.keyframeIndex);
      return { ok, keyframes: hit.clip.keyframes };
    }

    case 'patch_keyframes': {
      const ref = resolveClipRef(timeline, args);
      if (!ref) throw new Error(`Clip ${args.clipId || args.id} not found`);
      const hit = findClip(timeline, ref);
      if (!Array.isArray(args.keyframes) || !args.keyframes.length) {
        throw new Error('Keyframes mora biti niz točaka { timeSec, value, ease? }');
      }
      const sanitized = args.keyframes.map(k => ({
        timeSec: clamp(Number.isFinite(k.timeSec) ? k.timeSec : 0, 0, hit.clip.durationSec),
        value: clamp(Number.isFinite(k.value) ? k.value : 1, 0, 1),
        ...(k.ease ? { ease: k.ease } : {})
      })).sort((a, b) => a.timeSec - b.timeSec);
      if (sanitized[0].timeSec > 0) sanitized.unshift({ timeSec: 0, value: sanitized[0].value });
      if (sanitized.at(-1).timeSec < hit.clip.durationSec) sanitized.push({ timeSec: hit.clip.durationSec, value: sanitized.at(-1).value });
      hit.clip.keyframes = sanitized;
      return { ok: true, keyframes: hit.clip.keyframes };
    }

    case 'create_auto_show': {
      if (!analysis) throw new Error('Audio analiza je potrebna za generiranje auto showa.');
      const auto = createAutoShow(analysis, args);
      timeline.layers = auto.layers;
      if (auto.bpm && timeline.gridMode !== 'manual') timeline.bpm = auto.bpm;
      if (auto.beatOffsetSec !== undefined) timeline.beatOffsetSec = auto.beatOffsetSec;
      return { ok: true, layerCount: timeline.layers.length, clipCount: timeline.layers.reduce((sum, l) => sum + l.clips.length, 0) };
    }

    case 'replace_timeline': {
      const source = args.timeline || args;
      if (!source || !Array.isArray(source.layers)) throw new Error('Timeline must contain layers');
      timeline.layers = source.layers;
      if (source.bpm && timeline.gridMode !== 'manual') timeline.bpm = source.bpm;
      if (source.beatOffsetSec !== undefined) timeline.beatOffsetSec = source.beatOffsetSec;
      if (source.durationSec) timeline.durationSec = source.durationSec;
      return { ok: true, layerCount: timeline.layers.length, clipCount: timeline.layers.reduce((sum, l) => sum + l.clips.length, 0) };
    }

    case 'clear_timeline': {
      timeline.layers = [];
      return { ok: true };
    }

    default:
      throw new Error(`Nepoznata operacija vremenske trake: ${op}`);
  }
}
