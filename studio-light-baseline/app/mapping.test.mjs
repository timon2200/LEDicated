import test from 'node:test';
import assert from 'node:assert/strict';
import { mapBarPixels, physicalLedPixels } from './mapping.mjs';

test('72 physical diodes render individually while sharing the 12 transmitted RGBW groups', () => {
  const source = Array.from({ length: 12 }, (_, i) => [i, 0, 0, i + 20]);
  const bar = { pixels: 12, physicalLeds: 72, reverse: false };
  const groups = mapBarPixels(source, bar);
  const diodes = physicalLedPixels(source, bar);
  assert.equal(groups.length, 12);
  assert.equal(diodes.length, 72);
  for (let i = 0; i < 72; i++) assert.deepEqual(diodes[i], groups[Math.floor(i / 6)]);
  assert.deepEqual(physicalLedPixels(source, { ...bar, reverse: true })[0], groups[11]);
});

test('resampling and output limits are identical for preview and transport', () => {
  const source = Array.from({ length: 12 }, (_, i) => [i * 20, 0, 0, 200]);
  const bar = { pixels: 5, physicalLeds: 30, reverse: true };
  const groups = mapBarPixels(source, bar);
  const diodes = physicalLedPixels(source, bar);
  assert.deepEqual(groups.map(p => p[0]), [180, 140, 80, 40, 0]);
  assert.equal(diodes.length, 30);
  assert.ok(diodes.every((pixel, i) => pixel.every((channel, index) => channel === groups[Math.floor(i / 6)][index])));
  assert.ok(diodes.every(pixel => pixel.every(value => value <= 255)));
});
