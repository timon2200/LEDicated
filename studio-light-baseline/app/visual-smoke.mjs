// Optional Playwright test for the conversation visualization's standalone wrap.
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL||'chrome'});
try{
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('file://'+process.env.VISUAL_PREVIEW_PATH);
 const frame=page.frameLocator('iframe');
 await frame.locator('.sl-bar').first().waitFor();
 assert.equal(await frame.locator('.sl-bar').count(),9);
 await frame.locator('[data-scene=columns]').click();
 assert.equal(await frame.locator('.sl-title').textContent(),'Stupci');
 await frame.locator('.sl-step').click();assert.match(await frame.locator('.sl-phase').textContent(),/2/);
 await frame.locator('.sl-palette').selectOption('warm');
 await frame.locator('.sl-blackout').click();
 assert.equal(await frame.locator('.sl-blackout').getAttribute('aria-pressed'),'true');
 assert(await frame.locator('.sl-bar i').evaluateAll(el=>el.every(e=>e.style.background==='rgb(0, 0, 0)')));
 for(const width of [1024,736,390,320]){await page.setViewportSize({width,height:1200});await page.waitForTimeout(30);assert(await frame.locator('body').evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'visual overflow '+width);}
 assert.deepEqual(errors,[]);
 console.log('Inline visualization PASS: scene/palette, beat step, blackout, responsive layouts and no runtime errors.');
}finally{await browser.close();}
