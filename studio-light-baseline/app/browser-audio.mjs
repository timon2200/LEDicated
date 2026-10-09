// Synthetic PCM fixture goes through browser capture + FFT/RMS/onset + tempo/UI.
// This does not test BlackHole/macOS device routing or real songs.
import assert from 'node:assert/strict';
import {writeFile,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const rate=48000,seconds=24,length=rate*seconds;
const wav=Buffer.alloc(44+length*2);wav.write('RIFF',0);wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(rate,24);wav.writeUInt32LE(rate*2,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(length*2,40);
for(let i=0;i<length;i++){const t=i/rate,phase=t%.5;const envelope=phase<.07?Math.exp(-phase*42):0;wav.writeInt16LE(Math.round(Math.sin(t*2*Math.PI*100)*envelope*25000),44+i*2);}
const fixture=join(tmpdir(),`studio-light-click-${process.pid}.wav`);await writeFile(fixture,wav);
const browser=await chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL||'chrome',args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream',`--use-file-for-fake-audio-capture=${fixture}`]});
try{
  const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:8787');await page.waitForFunction(()=>window.studioTest);
  await page.locator('#bpm').fill('90');await page.locator('#bpm').dispatchEvent('change');
  await page.locator('#auto-tempo').check();await page.locator('#audio-start').click();
  await page.waitForFunction(()=>document.getElementById('audio-start').textContent==='Zaustavi audio');
  await page.waitForFunction(()=>document.getElementById('tempo-status').textContent.includes('Pratim ritam'),{},{timeout:16000});
  const bpm=await page.evaluate(()=>window.studioTest.engine.clock.bpm);
  assert(Math.abs(bpm-120)<8,`expected synthetic120 BPM, got${bpm}`);
  assert.equal(await page.locator('#demo').getAttribute('aria-pressed'),'false');
  await page.locator('#audio-start').click();assert.match(await page.locator('#audio-status').textContent(),/zaustavljen/);
  assert.deepEqual(errors,[]);
  console.log(`Audio pipeline PASS: synthetic120 BPM PCM → capture → FFT/RMS/onsets → ${bpm.toFixed(1)} BPM; start/stop; no runtime errors.`);
}finally{await browser.close();await unlink(fixture);}
