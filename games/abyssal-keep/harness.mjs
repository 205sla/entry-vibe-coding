import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from '@playwright/test';
import {loadFixture} from '../../tools/lib/editor-harness.mjs';
import {runFresh,useGameTimeWaits} from '../../tools/lib/verify-harness.mjs';
export const dir=path.dirname(fileURLToPath(import.meta.url));
export const latest=()=>fs.readdirSync(dir).filter(x=>/^abyssal-keep_\d+\.ent$/.test(x)).sort().at(-1);
export async function boot(){
 const browser=await chromium.launch(fs.existsSync(chromium.executablePath())?{}:{channel:'chrome'});
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],failed=[];
 // The local editor has no favicon; this unrelated browser probe is satisfied.
 await page.route('**/favicon.ico',r=>r.fulfill({status:204,body:''}));
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 page.on('response',r=>{if(r.status()>=400)failed.push({url:r.url(),status:r.status()});});
 await page.goto((process.env.BASE_URL||'http://localhost:3000')+'/editor.html');
 await page.waitForFunction(()=>window.__myentryReady);await page.evaluate(()=>window.__myentryReady);
 await loadFixture(page,path.join(dir,latest()));await runFresh(page);
 await page.waitForFunction(()=>Number(Entry.variableContainer.variables_.find(v=>v.name_==='frames').getValue())>4);
 // The game moves by its own dt (project timer delta, clamped to .001–.12), so waits
 // count that: on CI the timer refreshes late and wall time outruns game time.
 await useGameTimeWaits(page,{step:'dt'});
 return {browser,page,errors,failed};
}
export const sense=page=>page.evaluate(()=>({
 vars:Object.fromEntries(Entry.variableContainer.variables_.map(x=>[x.name_,x.getValue()])),
 lists:Object.fromEntries(Entry.variableContainer.lists_.map(x=>[x.name_,x.array_.map(i=>Number(i.data))])),
}));
export const setVars=(page,values)=>page.evaluate(values=>{for(const [id,value]of Object.entries(values))Entry.variableContainer.variables_.find(v=>v.name_===id).setValue(value);},values);
export const setLists=(page,values)=>page.evaluate(values=>{for(const [id,list]of Object.entries(values)){const l=Entry.variableContainer.lists_.find(l=>l.name_===id);list.forEach((data,i)=>l.array_[i].data=data);}},values);
export async function keys(page,pressed){await page.evaluate(pressed=>{
 const before=window.__testKeys||[];for(const key of before)if(!pressed.includes(key))document.dispatchEvent(new KeyboardEvent('keyup',{code:key,key}));
 for(const key of pressed)if(!before.includes(key))document.dispatchEvent(new KeyboardEvent('keydown',{code:key,key}));window.__testKeys=pressed;
},pressed);}
export async function tap(page,key,ms=100){await keys(page,[key]);await page.waitForTimeout(ms);await keys(page,[]);await page.waitForTimeout(80);}
export async function screenshot(page,name){const data=await page.evaluate(()=>document.querySelector('#entryCanvas').toDataURL('image/png'));fs.writeFileSync(path.join(dir,name+'.png'),Buffer.from(data.split(',')[1],'base64'));}
