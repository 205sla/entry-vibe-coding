// Actual native sound blocks must produce output, including after .ent export.
const {test,expect}=require('@playwright/test');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const zlib=require('node:zlib');
const {forEachTarEntry}=require('../server.js');
const fixture=path.join(__dirname,'../games/audio-check/audio-check_003.ent');
const audioHashes=file=>{
 const hashes=[];
 forEachTarEntry(zlib.gunzipSync(fs.readFileSync(file)),entry=>{
  if(/\/sound\/.*\.(wav|mp3)$/.test(entry.name))hashes.push(crypto.createHash('sha256').update(entry.data).digest('hex'));
 });
 return hashes.sort();
};

test('WAV and MP3 native blocks emit audio; mute is silent; export preserves both sounds',async({page},testInfo)=>{
 const {exerciseAudioFixture,assertAudioFixture}=await import('../tools/lib/audio-harness.mjs');
 const errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/editor.html');
 await expect(page.locator('#status')).toHaveText('준비됨');
 async function open(file){
  await page.locator('#open-ent').setInputFiles(file);
  await expect(page.locator('#status')).toContainText('불러오기 완료');
  await page.waitForFunction(()=>{
   const sounds=Entry.container.objects_.flatMap(o=>o.sounds||[]);
   return sounds.length===2&&sounds.every(s=>window.createjs.Sound.activePlugin._audioSources[s.path]?.getChannelData);
  });
 }
 await open(fixture);
 const first=await exerciseAudioFixture(page);
 assertAudioFixture(first);
 const download=page.waitForEvent('download');
 await page.evaluate(()=>window.exportEnt());
 const saved=testInfo.outputPath('audio-round-trip.ent');
 await (await download).saveAs(saved);
 expect(audioHashes(saved)).toEqual(audioHashes(fixture));
 expect(audioHashes(saved)).toHaveLength(2);
 await open(saved);
 const roundTrip=await exerciseAudioFixture(page);
 assertAudioFixture(roundTrip);
 expect(errors).toEqual([]);
 await testInfo.attach('audio-output',{body:JSON.stringify({first,roundTrip},null,2),contentType:'application/json'});
});

for(const [file,symbol,wrongVersion] of [
 ['soundjs-0.6.0.min.js','SoundJS','1.0.0'],
 ['preloadjs-0.6.0.min.js','PreloadJS','0.4.1'],
]){
 test(`editor rejects misleading ${symbol} filename before initializing`,async({page})=>{
  await page.route('**/vendor/'+file,async route=>{
   const response=await route.fetch();
   await route.fulfill({response,body:(await response.text())+`\nwindow.createjs.${symbol}.version='${wrongVersion}';`});
  });
  await page.goto('/editor.html');
  await expect(page.locator('#status')).toContainText('소리 라이브러리 버전 오류');
  await expect(page.locator('#status')).toContainText('setup-audio.mjs');
  const boot=await page.evaluate(async()=>{
   try{await window.__myentryReady;return {rejected:false};}
   catch(e){return {rejected:true,message:e.message,engine:!!window.Entry?.engine};}
  });
  expect(boot.rejected).toBe(true);
  expect(boot.engine).toBe(false);
  expect(boot.message).toContain(wrongVersion);
 });
}
