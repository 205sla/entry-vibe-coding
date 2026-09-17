import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {chromium} from '@playwright/test';
import {loadFixture} from '../../tools/lib/editor-harness.mjs';
import {exerciseAudioFixture,assertAudioFixture} from '../../tools/lib/audio-harness.mjs';
const dir=path.dirname(fileURLToPath(import.meta.url));
const args=process.argv.slice(2),out=args.find(a=>a.startsWith('--out='))?.slice(6)||path.join(dir,'verification.json');
const file=path.join(dir,'audio-check_003.ent');
const report={date:new Date().toISOString(),file:path.basename(file),sha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),pageErrors:[]};
const browser=await chromium.launch(fs.existsSync(chromium.executablePath())?{}:{channel:'chrome'});
try{
 const page=await browser.newPage({viewport:{width:1280,height:900}});
 page.on('pageerror',e=>report.pageErrors.push(e.message));
 await page.goto((process.env.BASE_URL||'http://localhost:3000')+'/editor.html');
 await page.waitForFunction(()=>window.__myentryReady);await page.evaluate(()=>window.__myentryReady);
 await loadFixture(page,file,{loadSettleMs:2500});
 report.audio=await exerciseAudioFixture(page);
 await page.evaluate(()=>Entry.engine.toggleRun());
 await page.waitForTimeout(200);
 await page.locator('#entryCanvas').screenshot({path:path.join(dir,'audio-check.png')});
 await page.evaluate(()=>Entry.engine.toggleStop());
 assertAudioFixture(report.audio);
 if(report.pageErrors.length)throw new Error(report.pageErrors.join('\n'));
 report.passed=true;
}catch(e){report.error=e.message;report.passed=false;process.exitCode=1;}finally{
 await browser.close();fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({passed:report.passed,error:report.error,versions:report.audio?.initial,cases:report.audio?.cases.map(c=>({phase:c.phase,signal:c.signal,call:c.runtime.calls.at(-1)}))},null,2));
}
