// Run against npm start. Optional dev dependency: npm install --no-save playwright
// PLAYWRIGHT_MODULE=/path/to/node_modules/playwright BROWSER_CHANNEL=chrome node daw-smoke.mjs
import assert from 'node:assert/strict';
const playwright = await import(process.env.PLAYWRIGHT_MODULE || 'playwright'); const chromium = playwright.chromium || playwright.default.chromium;
const browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || 'chromium', args: ['--use-gl=angle', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 960 } });
const errors = []; page.on('response', r => { if (r.status() >= 400) errors.push(r.status() + ' ' + r.url()); }); page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
const shot = process.env.SHOTS || '.';
try {
  await page.goto(process.env.BASE_URL || 'http://127.0.0.1:8787');
  await page.waitForFunction(() => window.studioTest);
  await page.waitForFunction(() => window.studioTest.store.timeline.layers.length > 0, null, { timeout: 15000 });
  assert.equal(await page.locator('.preview-bar-label').count(), 9);
  assert.equal(await page.locator('#output-status').textContent(), 'SIMULACIJA');
  assert((await page.locator('.pl-head-layer').count()) >= 4, 'layer headers');
  await page.screenshot({ path: `${shot}/daw-1-initial.png` });

  // draw a clip with the draw tool on a fresh empty layer
  await page.locator('.add-layer').click();
  await page.waitForTimeout(100);
  const before = await page.evaluate(() => window.studioTest.store.timeline.layers.reduce((n, l) => n + l.clips.length, 0));
  const canvas = page.locator('.pl-canvas'); const box = await canvas.boundingBox();
  const pos = await page.evaluate(() => { const p = window.studioTest.playlist, t = window.studioTest.store.timeline, li = t.layers.length - 1; const v = p.view; return { y: 76 + 44 + li * 64 + 32, x: 200, v, li }; });
  await page.mouse.move(box.x + pos.x, box.y + pos.y); await page.mouse.down(); await page.mouse.move(box.x + pos.x + 120, box.y + pos.y, { steps: 6 }); await page.mouse.up();
  const after = await page.evaluate(() => window.studioTest.store.timeline.layers.reduce((n, l) => n + l.clips.length, 0));
  assert.equal(after, before + 1, 'draw tool created a clip');
  assert.equal(await page.locator('#undo').isDisabled(), false);
  await page.keyboard.press('Meta+z');
  assert.equal(await page.evaluate(() => window.studioTest.store.timeline.layers.reduce((n, l) => n + l.clips.length, 0)), before, 'undo removed it');
  await page.keyboard.press('Meta+Shift+z');
  assert.equal(await page.evaluate(() => window.studioTest.store.timeline.layers.reduce((n, l) => n + l.clips.length, 0)), before + 1, 'redo restored it');

  // select tool, click clip -> editor shows chips
  await page.keyboard.press('2');
  await page.keyboard.press('Meta+a');
  assert((await page.locator('.ce-props .chip').count()) === 16, 'effect chips visible for selection');
  await page.locator('.ce-props .chip', { hasText: 'Flash' }).click();
  assert(await page.evaluate(() => window.studioTest.store.timeline.layers.flatMap(l => l.clips).every(c => c.preset === 'flash')), 'preset applied to all selected');
  await page.keyboard.press('Meta+z');

  // --- clip gestures on the fresh layer (select tool) ---
  await page.keyboard.press('Escape').catch(() => {}); // would blackout; undone below
  if (await page.evaluate(() => window.studioTest.engine.state.blackout)) await page.locator('#blackout').click();
  await page.keyboard.press('2');
  const locate = () => page.evaluate(() => {
    const st = window.studioTest, t = st.store.timeline, li = t.layers.length - 1, clip = t.layers[li].clips.at(-1), r = st.playlist.clipScreenRect(li, clip);
    return { li, id: clip.id, x: r.x, y: r.y, w: r.w, h: r.h, start: clip.startSec, dur: clip.durationSec, count: t.layers[li].clips.length };
  });
  const cb = await canvas.boundingBox();
  let c = await locate();
  await page.mouse.click(cb.x + c.x + c.w / 2, cb.y + c.y + c.h / 2);
  await page.mouse.move(cb.x + c.x + c.w / 2, cb.y + c.y + c.h / 2); await page.mouse.down(); await page.mouse.move(cb.x + c.x + c.w / 2 + 160, cb.y + c.y + c.h / 2 - 66, { steps: 8 }); await page.mouse.up();
  let c2 = await page.evaluate(id => {
    const t = window.studioTest.store.timeline;
    for (const [i, l] of t.layers.entries()) {
      const k = l.clips.find(clip => clip.id === id);
      if (k) return { li: i, start: k.startSec };
    }
    return null;
  }, c.id);
  assert(c2 && c2.start > c.start, 'clip moved right');
  assert.equal(c2.li, c.li - 1, 'clip moved up one lane');
  // resize end edge
  const r = await page.evaluate(id => {
    const st = window.studioTest, t = st.store.timeline;
    for (const [i, l] of t.layers.entries()) {
      const clip = l.clips.find(k => k.id === id);
      if (clip) return { ...st.playlist.clipScreenRect(i, clip), dur: clip.durationSec, li: i };
    }
    return null;
  }, c.id);
  await page.mouse.move(cb.x + r.x + r.w - 2, cb.y + r.y + r.h / 2); await page.mouse.down(); await page.mouse.move(cb.x + r.x + r.w + 90, cb.y + r.y + r.h / 2, { steps: 6 }); await page.mouse.up();
  const dur2 = await page.evaluate(li => window.studioTest.store.timeline.layers[li].clips.at(-1).durationSec, r.li);
  assert(dur2 > r.dur, 'clip lengthened by edge drag');
  // slice
  const nBeforeSlice = await page.evaluate(li => window.studioTest.store.timeline.layers[li].clips.length, r.li);
  await page.keyboard.press('3');
  const rr = await page.evaluate(li => { const st = window.studioTest, clip = st.store.timeline.layers[li].clips.at(-1); return st.playlist.clipScreenRect(li, clip); }, r.li);
  await page.mouse.click(cb.x + rr.x + rr.w / 2, cb.y + rr.y + rr.h / 2);
  assert.equal(await page.evaluate(li => window.studioTest.store.timeline.layers[li].clips.length, r.li), nBeforeSlice + 1, 'slice split the clip');
  // erase
  await page.keyboard.press('4');
  const rr2 = await page.evaluate(li => { const st = window.studioTest, clip = st.store.timeline.layers[li].clips.at(-1); return st.playlist.clipScreenRect(li, clip); }, r.li);
  await page.mouse.click(cb.x + rr2.x + rr2.w / 2, cb.y + rr2.y + rr2.h / 2);
  assert.equal(await page.evaluate(li => window.studioTest.store.timeline.layers[li].clips.length, r.li), nBeforeSlice, 'erase removed one part');
  await page.keyboard.press('Meta+z');
  await page.keyboard.press('2');

  // preset drag & drop from browser onto the lane
  await page.locator('.tabs button', { hasText: 'Efekti' }).click();
  const laneY = await page.evaluate(() => 76 + 44 + 64 * 1 + 32);
  const dropBefore = await page.evaluate(() => window.studioTest.store.timeline.layers[1].clips.length);
  await page.dragAndDrop('.preset >> nth=3', '.pl-canvas', { targetPosition: { x: 420, y: laneY } });
  assert.equal(await page.evaluate(() => window.studioTest.store.timeline.layers[1].clips.length), dropBefore + 1, 'preset drop created a clip');
  await page.locator('.tabs button', { hasText: 'Pjesme' }).click();

  // envelope editing: double click adds a keyframe
  const clipInfo = await page.evaluate(() => { const ref = window.studioTest.playlist.selection[0]; const t = window.studioTest.store.timeline; return { n: t.layers.find(l => l.id === ref.layerId).clips.find(k => k.id === ref.clipId).keyframes.length }; });
  await page.locator('#tab-envelope').click(); await page.waitForTimeout(250);
  const eb = await page.locator('.ce-canvas').boundingBox();
  await page.mouse.dblclick(eb.x + eb.width / 2, eb.y + eb.height * .35);
  const nAfter = await page.evaluate(() => { const ref = window.studioTest.playlist.selection[0]; const t = window.studioTest.store.timeline; return t.layers.find(l => l.id === ref.layerId).clips.find(k => k.id === ref.clipId).keyframes.length; });
  assert.equal(nAfter, clipInfo.n + 1, 'double click added keyframe');

  // loop strip and zoom
  const rb = await page.locator('.pl-ruler').boundingBox();
  await page.mouse.move(rb.x + 100, rb.y + 28); await page.mouse.down(); await page.mouse.move(rb.x + 300, rb.y + 28, { steps: 5 }); await page.mouse.up();
  assert(await page.evaluate(() => window.studioTest.state.loop && window.studioTest.state.loopOn), 'loop region set');
  const pps0 = await page.evaluate(() => window.studioTest.playlist.view.pps);
  const cbNow = await page.locator('.pl-canvas').boundingBox();
  await page.mouse.move(cbNow.x + 400, cbNow.y + 30); await page.keyboard.down('Meta'); await page.mouse.wheel(0, -300); await page.keyboard.up('Meta');
  await page.waitForTimeout(100);
  assert((await page.evaluate(() => window.studioTest.playlist.view.pps)) > pps0, 'cmd+wheel zoom');
  await page.keyboard.press('0');

  // autosave reached the server
  await page.waitForTimeout(900);
  const saved = await page.evaluate(async () => { const id = window.studioTest.state.track.id; const r = await fetch(`/api/library/track/${id}`); return (await r.json()).timeline.layers.length; });
  assert.equal(saved, await page.evaluate(() => window.studioTest.store.timeline.layers.length), 'autosave persisted layers');
  await page.screenshot({ path: `${shot}/daw-4-edit.png` });

  // audio driver: EQ band editor, bar picker, isolation
  await page.locator('#tab-clip').click();
  await page.locator('.bp-cell').first().click();
  const targets = await page.evaluate(() => { const r = window.studioTest.playlist.selection[0]; return window.studioTest.store.timeline.layers.find(l => l.id === r.layerId).clips.find(c => c.id === r.clipId).targets; });
  assert(targets === 'all' || targets.length < 9, 'bar picker toggles a bar');
  await page.locator('#tab-driver').click();
  await page.waitForFunction(() => window.studioTest.state.analysis?.spectrum, null, { timeout: 40000 });
  await page.locator('.drv-ctl button', { hasText: 'Frekvencija (EQ)' }).click();
  const sbox = await page.locator('.drv-spec').boundingBox();
  await page.mouse.move(sbox.x + 80, sbox.y + sbox.height * .5); await page.mouse.down(); await page.mouse.move(sbox.x + 200, sbox.y + sbox.height * .5, { steps: 6 }); await page.mouse.up();
  const band = await page.evaluate(() => { const r = window.studioTest.playlist.selection[0]; return window.studioTest.store.timeline.layers.find(l => l.id === r.layerId).clips.find(c => c.id === r.clipId); });
  assert.equal(band.driver, 'band'); assert(band.band.lowHz < band.band.highHz && band.band.threshold > 0, 'EQ drag set a band');
  await page.locator('.drv-ctl button', { hasText: 'Kick' }).click();
  assert.equal(await page.evaluate(() => { const r = window.studioTest.playlist.selection[0]; return window.studioTest.store.timeline.layers.find(l => l.id === r.layerId).clips.find(c => c.id === r.clipId).band.mode; }), 'gate');
  await page.locator('.iso-btn', { hasText: 'Solo clip' }).click(); await page.locator('.iso-btn', { hasText: 'Bez drivera' }).click();
  await page.screenshot({ path: `${shot}/daw-driver.png` });
  await page.locator('.iso-btn', { hasText: 'Solo clip' }).click(); await page.locator('.iso-btn', { hasText: 'Bez drivera' }).click();
  await page.locator('#tab-clip').click();

  // frame equality between preview source and studioTest frame
  const frame = await page.evaluate(() => window.studioTest.getFrame());
  assert.equal(Object.keys(frame.bars).length, 9);

  // mixer and live docks render
  await page.locator('#tab-mixer').click(); assert((await page.locator('.mx-strip').count()) >= 5);
  await page.screenshot({ path: `${shot}/daw-2-mixer.png` });
  await page.locator('#tab-live').click(); assert((await page.locator('.pad').count()) === 8);
  await page.locator('#tab-output').click();
  await page.locator('#tab-clip').click();
  await page.keyboard.press('Space'); await page.waitForTimeout(900);
  const t1 = await page.evaluate(() => window.studioTest.state.scrubSec + 0);
  assert(await page.evaluate(() => !document.querySelector('#play').disabled), 'play enabled');
  await page.keyboard.press('Space');
  await page.screenshot({ path: `${shot}/daw-3-final.png` });
  assert.deepEqual(errors, []);
  console.log('DAW smoke OK');
} finally { await browser.close(); }
