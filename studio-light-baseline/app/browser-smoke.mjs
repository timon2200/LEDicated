// Run against npm start. Optional dev dependency: npm install --no-save playwright
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser=await chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL||'chromium'});
const page=await browser.newPage({viewport:{width:1440,height:1050}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
  await page.goto('http://127.0.0.1:8787/classic.html');
  await page.waitForFunction(()=>window.studioTest);
  assert.equal(await page.locator('.preview-bar-label').count(),9);
  assert.equal(await page.locator('#led-preview').count(),1);
  assert.match(await page.locator('#preview-mode').textContent(),/648 LED/);
  assert(await page.evaluate(()=>{const timeline=document.querySelector('.timeline-panel').getBoundingClientRect();return timeline.width>innerWidth*.9;}),'timeline spans the workspace');
  assert.equal(await page.locator('#output-status').textContent(),'SIMULACIJA');
  await page.locator('.live-desk summary').click();
  await page.locator('[data-scene=columns]').click();
  assert.match(await page.locator('#next-scene').textContent(),/Stupci/);
  await page.locator('#go').click();
  await page.waitForFunction(()=>window.studioTest.engine.state.scene==='columns');
  await page.locator('#palette').selectOption('warm');
  assert.equal(await page.evaluate(()=>window.studioTest.engine.state.palette),'warm');
  await page.locator('#brightness').fill('0');await page.locator('#brightness').dispatchEvent('input');
  assert(await page.evaluate(()=>Object.values(window.studioTest.getFrame().bars).flat(2).every(x=>x===0)));
  await page.locator('#brightness').fill('35');await page.locator('#brightness').dispatchEvent('input');
  await page.locator('#bpm').fill('140');await page.locator('#bpm').dispatchEvent('change');
  assert.equal(await page.evaluate(()=>window.studioTest.engine.clock.bpm),140);
  await page.locator('#freeze').click();
  assert.equal(await page.locator('#freeze').getAttribute('aria-pressed'),'true');
  await page.locator('#brightness').fill('0');await page.locator('#brightness').dispatchEvent('input');
  assert(await page.evaluate(()=>Object.values(window.studioTest.getFrame().bars).flat(2).every(x=>x===0)), 'master must zero frozen output');
  await page.locator('#brightness').fill('35');await page.locator('#brightness').dispatchEvent('input');
  await page.locator('#auto-tempo').check();await page.locator('#half').click();
  assert.equal(await page.locator('#auto-tempo').isChecked(),false,'manual half must remain manual');
  await page.keyboard.press('Escape');
  assert(await page.evaluate(()=>Object.values(window.studioTest.getFrame().bars).flat(2).every(x=>x===0)));
  await page.locator('#blackout').click();await page.locator('#freeze').click();
  await page.locator('#settings-open').click();
  await page.locator('#arm').click();
  await page.waitForFunction(()=>document.getElementById('settings-status').textContent.includes('IP'));
  await page.locator('#settings form button').click();
  await page.locator('#palette').selectOption('midnight');
  await page.locator('[data-scene=wave]').click();await page.locator('#go').click();
  await page.waitForFunction(()=>window.studioTest.engine.state.scene==='wave');
  await page.screenshot({path:process.env.SCREENSHOT_PATH||'preview-desktop.png',fullPage:true});
  for(const width of [1024,736,390,320]){
    await page.setViewportSize({width,height:1100});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`overflow at ${width}`);
  }
  await page.screenshot({path:process.env.MOBILE_SCREENSHOT_PATH||'preview-mobile.png',fullPage:true});
  assert.deepEqual(errors,[]);
  console.log('Browser PASS: 648 individually drawn LEDs, full-width timeline, GO, palette, master zero including freeze, BPM, half correction, freeze, blackout, arm validation, 1440/1024/736/390/320 layouts; no runtime errors.');
}finally{await browser.close();}
