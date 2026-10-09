import assert from 'node:assert/strict';

const playwright = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const chromium = playwright.chromium || playwright.default.chromium;
const browser = await chromium.launch({
  headless: true,
  channel: process.env.BROWSER_CHANNEL || 'chromium',
  args: ['--use-gl=angle', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required']
});

const page = await browser.newPage({ viewport: { width: 1600, height: 960 } });
const errors = [];
page.on('response', r => {
  if (r.status() >= 400 && !r.url().includes('favicon.ico')) {
    errors.push(r.status() + ' ' + r.url());
  }
});
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => {
  if (m.type() === 'error' && !m.text().includes('favicon.ico') && !m.text().includes('Failed to load resource')) {
    errors.push(m.text());
  }
});

try {
  await page.goto(process.env.BASE_URL || 'http://127.0.0.1:8787');
  await page.waitForFunction(() => window.studioTest);
  await page.waitForFunction(() => window.studioTest.store.timeline.layers.length > 0, null, { timeout: 15000 });

  // Select tool (key '2') and select all clips with Meta+a
  await page.keyboard.press('2');
  await page.keyboard.press('Meta+a');
  await page.waitForTimeout(200);

  // Verify that the 16 preset chips exist and count is exactly 16
  const chipCount = await page.locator('.ce-props .chip').count();
  assert.equal(chipCount, 16, `Expected exactly 16 effect chips, got ${chipCount}`);
  console.log('✓ 16 preset chips verified');

  // Test 1: Select "Trkač" (chase)
  await page.locator('.ce-props .chip', { hasText: 'Trkač' }).click();
  await page.waitForTimeout(200);

  // Verify .dev-rack exists with CHASE ENGINE
  const devRack = page.locator('.dev-rack');
  assert.equal(await devRack.count(), 1, 'Device rack should be rendered');
  const rackTitle = await devRack.locator('.dev-name').textContent();
  assert.equal(rackTitle, 'Chase Engine', `Expected Chase Engine, got ${rackTitle}`);
  console.log('✓ Chase Engine rack rendered');

  // Check buttons inside Chase Engine rack
  const needleBtn = devRack.locator('.dev-btn', { hasText: 'Igla' });
  assert.equal(await needleBtn.count(), 1, 'Needle button exists');
  await needleBtn.click();
  await page.waitForTimeout(100);

  // Check that clip.params.beam is now 'needle'
  const beamVal = await page.evaluate(() => {
    const ref = window.studioTest.playlist.selection[0];
    const clip = window.studioTest.store.timeline.layers.find(l => l.id === ref.layerId).clips.find(c => c.id === ref.clipId);
    return clip.params?.beam;
  });
  assert.equal(beamVal, 'needle', `Expected beam to be 'needle', got ${beamVal}`);
  assert.equal(await needleBtn.getAttribute('class'), 'dev-btn on', 'Needle button is active .on');
  console.log('✓ Chase Engine beam param set to needle');

  // Toggle ambient glow
  const glowBtn = devRack.locator('.dev-btn', { hasText: 'Ambijent' });
  await glowBtn.click();
  await page.waitForTimeout(100);
  const glowVal = await page.evaluate(() => {
    const ref = window.studioTest.playlist.selection[0];
    const clip = window.studioTest.store.timeline.layers.find(l => l.id === ref.layerId).clips.find(c => c.id === ref.clipId);
    return clip.params?.glow;
  });
  assert.equal(glowVal, 0.15, `Expected glow to be 0.15, got ${glowVal}`);
  console.log('✓ Chase Engine glow param set to 0.15');

  // Take screenshot of Chase Engine
  await page.screenshot({ path: 'chase-device-rack.png' });
  console.log('✓ Screenshot saved: chase-device-rack.png');

  // Test 2: Select "Stroboskop" (strobe)
  await page.locator('.ce-props .chip', { hasText: 'Stroboskop' }).click();
  await page.waitForTimeout(200);
  const strobeTitle = await devRack.locator('.dev-name').textContent();
  assert.equal(strobeTitle, 'Strobo Shutter', `Expected Strobo Shutter, got ${strobeTitle}`);

  // Click 1/16 division
  const divBtn = devRack.locator('.dev-btn', { hasText: '¹/₁₆' });
  await divBtn.click();
  await page.waitForTimeout(100);
  const divVal = await page.evaluate(() => {
    const ref = window.studioTest.playlist.selection[0];
    const clip = window.studioTest.store.timeline.layers.find(l => l.id === ref.layerId).clips.find(c => c.id === ref.clipId);
    return clip.params?.division;
  });
  assert.equal(divVal, 16, `Expected division 16, got ${divVal}`);
  console.log('✓ Strobo Shutter division set to 16');

  // Test 3: Select "Vatra" (fire)
  await page.locator('.ce-props .chip', { hasText: 'Vatra' }).click();
  await page.waitForTimeout(200);
  const fireTitle = await devRack.locator('.dev-name').textContent();
  assert.equal(fireTitle, 'Pyro Flame FX', `Expected Pyro Flame FX, got ${fireTitle}`);

  // Click Buktinja (full height)
  const fullBtn = devRack.locator('.dev-btn', { hasText: 'Buktinja' });
  await fullBtn.click();
  await page.waitForTimeout(100);
  const heightVal = await page.evaluate(() => {
    const ref = window.studioTest.playlist.selection[0];
    const clip = window.studioTest.store.timeline.layers.find(l => l.id === ref.layerId).clips.find(c => c.id === ref.clipId);
    return clip.params?.height;
  });
  assert.equal(heightVal, 'full', `Expected height 'full', got ${heightVal}`);
  console.log('✓ Pyro Flame FX height set to full');

  // Test 4: Select "Val" (wave)
  await page.locator('.ce-props .chip[title="Efekt: Val"]').click();
  await page.waitForTimeout(200);
  const waveTitle = await devRack.locator('.dev-name').textContent();
  assert.equal(waveTitle, 'Wave Harmonics', `Expected Wave Harmonics, got ${waveTitle}`);

  // Click Saw wave
  const sawBtn = devRack.locator('.dev-btn', { hasText: 'Pila' });
  await sawBtn.click();
  await page.waitForTimeout(100);
  const shapeVal = await page.evaluate(() => {
    const ref = window.studioTest.playlist.selection[0];
    const clip = window.studioTest.store.timeline.layers.find(l => l.id === ref.layerId).clips.find(c => c.id === ref.clipId);
    return clip.params?.shape;
  });
  assert.equal(shapeVal, 'saw', `Expected shape 'saw', got ${shapeVal}`);
  console.log('✓ Wave Harmonics shape set to saw');

  // Test 5: Verify undo/redo on params
  await page.keyboard.press('Meta+z');
  await page.waitForTimeout(100);
  const shapeValUndone = await page.evaluate(() => {
    const ref = window.studioTest.playlist.selection[0];
    const clip = window.studioTest.store.timeline.layers.find(l => l.id === ref.layerId).clips.find(c => c.id === ref.clipId);
    return clip.params?.shape;
  });
  assert.notEqual(shapeValUndone, 'saw', 'Undo reverted wave shape');
  console.log('✓ Undo reverted param change successfully');

  await page.screenshot({ path: 'wave-device-rack.png' });
  console.log('✓ Screenshot saved: wave-device-rack.png');

  assert.equal(errors.length, 0, `Page errors encountered: ${errors.join(', ')}`);
  console.log('🎉 ALL DEVICE RACK VERIFICATION TESTS PASSED SUCCESSFULLY!');
} finally {
  await browser.close();
}
