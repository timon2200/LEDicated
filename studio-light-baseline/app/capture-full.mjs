const playwright = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const chromium = playwright.chromium || playwright.default.chromium;
const browser = await chromium.launch({
  headless: true,
  channel: process.env.BROWSER_CHANNEL || 'chromium',
  args: ['--use-gl=angle', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required']
});

const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
try {
  await page.goto(process.env.BASE_URL || 'http://127.0.0.1:8787');
  await page.waitForFunction(() => window.studioTest?.store.timeline.layers.length > 0);

  // Click single clip
  await page.keyboard.press('2');
  const clipBox = await page.evaluate(() => {
    const st = window.studioTest;
    const clip = st.store.timeline.layers[0].clips[0];
    const r = st.playlist.clipScreenRect(0, clip);
    return { ...r, id: clip.id };
  });

  const canvas = page.locator('.pl-canvas');
  const cb = await canvas.boundingBox();
  await page.mouse.click(cb.x + clipBox.x + 30, cb.y + clipBox.y + 20);
  await page.waitForTimeout(200);

  // Select Trkač
  await page.locator('.ce-props .chip', { hasText: 'Trkač' }).click();
  await page.waitForTimeout(150);

  await page.screenshot({ path: 'chase-full-view.png' });
  console.log('✓ Full view saved: chase-full-view.png');
} finally {
  await browser.close();
}
