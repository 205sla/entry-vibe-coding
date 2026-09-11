// Optional integration check against an installed official Entry desktop app.
// Usage: node tools/verify-audio-offline.mjs --entry-exe="C:/Entry/Entry.exe"
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {_electron} from '@playwright/test';
import {exerciseAudioFixture,assertAudioFixture} from './lib/audio-harness.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const exe=process.argv.find(a=>a.startsWith('--entry-exe='))?.slice(12)||process.env.ENTRY_EXE;
if(!exe||!fs.existsSync(exe))throw new Error('Pass --entry-exe=<installed Entry executable>');
const file=path.join(root,'games/audio-check/audio-check_003.ent');
const output=path.join(root,'games/audio-check/verification-offline.json');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'entry-audio-check-'));
const profile=path.join(temp,'userData'),appData=path.join(temp,'appData');
fs.mkdirSync(profile);fs.mkdirSync(appData);
const hash=()=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const report={date:new Date().toISOString(),file:path.basename(file),sha256:hash(),environment:'official Entry desktop; fresh isolated profile',pageErrors:[]};
let app;
try{
 const env={...process.env,APPDATA:appData};delete env.ELECTRON_RUN_AS_NODE;
 // Launch without a project. Verify paths before invoking the app's importer.
 app=await _electron.launch({executablePath:exe,args:[`--user-data-dir=${profile}`],env,timeout:30000});
 report.app=await app.evaluate(({app,BrowserWindow},expected)=>{
  if(app.getPath('userData').toLowerCase()!==expected.profile.toLowerCase())throw new Error('Refusing import: userData was not isolated');
  app.setPath('appData',expected.appData);
  if(app.getPath('appData').toLowerCase()!==expected.appData.toLowerCase())throw new Error('Refusing import: appData was not isolated');
  for(const w of BrowserWindow.getAllWindows())w.hide();
  app.on('browser-window-created',(_,w)=>w.on('show',()=>w.hide()));
  return {version:app.getVersion(),isolatedUserData:true,isolatedAppData:true};
 },{profile,appData});
 let page;
 for(let i=0;i<100&&!page;i++){
  page=app.windows().find(p=>p.url().endsWith('/src/main/views/main.html'));
  if(!page)await new Promise(resolve=>setTimeout(resolve,100));
 }
 if(!page)throw new Error('Official Entry main editor window was not found');
 page.on('pageerror',e=>report.pageErrors.push(e.message));
 await page.waitForFunction(()=>window.Entry&&(Entry.engine||document.querySelector('.workspaceModeSelectCloseBtn')),null,{timeout:25000});
 if(await page.locator('.workspaceModeSelectCloseBtn').count())await page.locator('.workspaceModeSelectCloseBtn').click({force:true});
 await page.waitForFunction(()=>window.Entry?.engine&&window.ipcInvoke,null,{timeout:25000});
 await page.evaluate(async file=>{
  const project=await window.ipcInvoke('loadProject',file);
  Entry.clearProject();await Entry.loadProject(project);
 },file);
 await page.waitForTimeout(2500);
 report.audio=await exerciseAudioFixture(page);
 assertAudioFixture(report.audio);
 if(report.pageErrors.length)throw new Error(report.pageErrors.join('\n'));
 report.passed=true;
}catch(e){report.error=e.message;report.passed=false;process.exitCode=1;}finally{
 if(app)await app.close().catch(()=>{});
 report.sourceUnchanged=hash()===report.sha256;
 // Keep diagnostics without persisting the user's home or random temp path.
 const json=JSON.stringify(report,null,2).replaceAll(temp.replaceAll('\\','/'),'<isolated-profile>').replaceAll(temp.replaceAll('\\','\\\\'),'<isolated-profile>');
 fs.writeFileSync(output,json+'\n');
 console.log(JSON.stringify({passed:report.passed,error:report.error,app:report.app,cases:report.audio?.cases.map(c=>({phase:c.phase,signal:c.signal,state:c.runtime.calls.at(-1)?.state}))},null,2));
}
