import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {boot,sense,keys,tap,setVars,setLists,screenshot,dir,latest} from './harness.mjs';
const require=createRequire(import.meta.url);
const {extractTarFile,forEachTarEntry}=require('../../lib/tar-portable.js');
const registry=require('../../tools/block-registry.json').blocks;
const report={file:latest(),checks:[],metrics:{},started:new Date().toISOString()};
function ok(condition,label){assert.ok(condition,label);report.checks.push(label);console.log('PASS',label);}
const bytes=fs.readFileSync(path.join(dir,latest())),tar=zlib.gunzipSync(bytes);
const project=JSON.parse(extractTarFile(tar,'temp/project.json').toString());
const entries=new Set();forEachTarEntry(tar,e=>entries.add(e.name));
let blocks=0;const types=new Set();
function walk(x){if(!x||typeof x!=='object')return;if(x.type){blocks++;types.add(x.type);}for(const value of Object.values(x))if(value&&typeof value==='object'){if(Array.isArray(value))value.forEach(walk);else walk(value);}}
project.objects.forEach(o=>walk(JSON.parse(o.script)));project.functions.forEach(f=>walk(JSON.parse(f.content)));
ok([...types].every(t=>registry[t]||/^(func_|stringParam_)/.test(t)),'archive contains only registered Entry blocks and declared functions');
ok(!project.externalModules.length&&!project.externalModulesLite.length,'game requires no external runtime modules');
const media=project.objects.flatMap(o=>[...o.sprite.pictures,...o.sprite.sounds]);
ok(media.every(p=>p.fileurl.startsWith('temp/')&&entries.has(p.fileurl)),'every image and sound is embedded in the .ent');
report.archive={sha256:crypto.createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length,objects:project.objects.length,functions:project.functions.length,blocks,types:types.size,media:media.length};

function flood(map,start){const seen=new Set([start]),queue=[start];for(let q=0;q<queue.length;q++)for(const d of[-1,1,-19,19]){const n=queue[q]+d;if(n>=0&&n<361&&!map[n]&&!seen.has(n)){seen.add(n);queue.push(n);}}return seen;}
const open=()=>Array.from({length:361},(_,i)=>i%19===0||i%19===18||i<19||i>=342?1:0);
const {browser,page,errors,failed}=await boot();
const num=async id=>Number((await sense(page)).vars[id]);
const wait=ms=>page.waitForTimeout(ms);
async function mouseAt(sx,sy){const box=await page.locator('#entryCanvas').boundingBox();await page.mouse.move(box.x+(sx+240)/480*box.width,box.y+(135-sy)/270*box.height);}
async function fixture({map=open(),vars={},enemies=[],items=[]}={}){
 await keys(page,[]);await setVars(page,{state:5});
 const data=Object.fromEntries(['ex','ey','ehp','emax','kind','cool','wind','aimx','aimy','flash','ez','sx','drawn'].map(n=>[n,Array(14).fill(0)]));
 for(const [index,e]of enemies.entries()){
  const j=(e.slot??index+1)-1;data.ex[j]=e.x;data.ey[j]=e.y;data.ehp[j]=e.hp??100;data.emax[j]=data.ehp[j];data.kind[j]=e.kind??1;data.cool[j]=e.cool??100;data.wind[j]=e.wind??0;data.aimx[j]=e.aimx??3.5;data.aimy[j]=e.aimy??3.5;
 }
 for(const [index,e]of items.entries()){const j=9+index;data.ex[j]=e.x;data.ey[j]=e.y;data.kind[j]=e.kind;}
 await setLists(page,{...data,map,nav:Array(361).fill(999),work:Array(361).fill(999)});
 await setVars(page,{px:3.5,py:3.5,angle:0,vx:1,vy:0,floor:1,hp:110,maxhp:110,damage:22,crit:0,armor:0,leech:0,moveSpeed:2.35,shotDelay:.32,mana:100,novaPower:65,shootCd:0,invuln:100,hurt:0,pulse:0,dashTime:0,dashCd:0,dashPeriod:1.8,kills:0,score:0,nextRelic:99,relics:0,left:enemies.length,navActive:0,navCell:-1,wallFloor:-1,...vars,state:vars.state??1});
 await wait(130);
}
try{
 ok(await num('state')===0,'native start event opens the title');await screenshot(page,'title');
 await tap(page,'Enter');ok(await num('state')===1,'Enter starts a run');
 await keys(page,['Space']);await wait(950);await keys(page,[]);
 ok(await num('kills')>=1,'actual fire key defeats the opening enemy');
 await tap(page,'KeyP');const paused=await sense(page);await keys(page,['KeyW','Space','ArrowRight']);await wait(350);await keys(page,[]);const pausedAfter=await sense(page);
 ok(+pausedAfter.vars.state===5&&pausedAfter.vars.px===paused.vars.px&&pausedAfter.vars.angle===paused.vars.angle&&pausedAfter.vars.elapsed===paused.vars.elapsed,'pause freezes movement, combat and the run clock');await tap(page,'KeyP');
 await fixture();let a=await sense(page);await keys(page,['KeyW']);await wait(500);await keys(page,[]);let b=await sense(page);
 ok(+b.vars.px>+a.vars.px+.6&&Math.abs(+b.vars.py-+a.vars.py)<.02,'W moves forward in camera space');
 await fixture();a=await sense(page);await keys(page,['KeyD']);await wait(400);await keys(page,[]);b=await sense(page);
 ok(+b.vars.py>+a.vars.py+.45&&Math.abs(+b.vars.px-+a.vars.px)<.02,'D strafes perpendicular to the camera');
 await fixture({vars:{px:1.3,angle:180,vx:-1}});await keys(page,['KeyW','ShiftLeft']);await wait(700);await keys(page,[]);
 ok(await num('px')>=1.179&&await num('px')<1.32,'dash substeps cannot tunnel through the outer wall');
 await fixture();await tap(page,'ShiftLeft');ok(await num('dashCd')>1&&await num('px')>3.7,'dash advances the player and starts its cooldown');

 const wall=open();for(let y=1;y<18;y++)wall[y*19+6]=y===9?0:1;
 await fixture({map:wall,enemies:[{x:8.5,y:3.5,hp:100}]});await keys(page,['Space']);await wait(650);await keys(page,[]);b=await sense(page);
 ok(b.lists.ehp[0]===100,'hitscan cannot damage a target behind a wall');
 await fixture({enemies:[{x:4.5,y:3.5,hp:36}]});await mouseAt(0,5);await page.mouse.down();await wait(700);await page.mouse.up();
 ok(await num('kills')===1,'real canvas mouse input fires and defeats a visible target');
 await fixture({map:wall,vars:{state:0,py:8.5},enemies:[{x:7.5,y:9,hp:100}]});await wait(250);
 const partial=await page.evaluate(()=>Entry.container.getAllObjects().find(o=>o.id==='monsters').entity.stamps.length);
 ok(partial>0&&partial<16,'depth buffer clips only the hidden slices of a partially occluded enemy');
 await fixture({map:wall,vars:{state:0},enemies:[{x:8.5,y:3.5,hp:100}]});await wait(200);
 ok(await page.evaluate(()=>Entry.container.getAllObjects().find(o=>o.id==='monsters').entity.stamps.length)===0,'fully occluded enemies draw no visible slices');
 await fixture({map:wall,enemies:[{x:8.5,y:3.5,hp:100}]});await wait(2000);b=await sense(page);
 ok(b.lists.nav[3*19+8]<999&&b.lists.ey[0]>3.8&&wall[Math.floor(b.lists.ey[0])*19+Math.floor(b.lists.ex[0])]===0,'native breadth-first navigation routes enemies toward the gap around a wall');

 await fixture({map:wall,enemies:[{x:4.5,y:3.5,hp:70},{x:7.5,y:3.5,hp:70}]});await tap(page,'KeyQ');b=await sense(page);
 ok(b.lists.ehp[0]===5&&b.lists.ehp[1]===70,'nova damages nearby visible targets but does not cross walls');
 ok(+b.vars.mana>=30&&+b.vars.mana<40,'nova spends 70 mana and mana regenerates');
 await fixture({vars:{hp:50},items:[{x:3.55,y:3.5,kind:8}]});ok(await num('hp')===74,'walking over a potion restores 24 health');
 await fixture({vars:{invuln:0,armor:3},enemies:[{x:3.96,y:3.5,wind:.05}]});await wait(100);
 ok(await num('hp')===102,'armor reduces melee damage from 11 to 8');await wait(220);ok(await num('hp')===102,'post-hit invulnerability prevents repeated immediate damage');
 await fixture({vars:{invuln:0},enemies:[{x:5.5,y:3.5,kind:2,wind:.65}]});await keys(page,['KeyD']);await wait(700);await keys(page,[]);
 ok(await num('hp')===110,'moving away from a caster telegraph evades its attack');
 await fixture({vars:{invuln:0,hp:1},enemies:[{x:3.96,y:3.5,wind:.05}]});await wait(120);
 ok(await num('state')===3&&await num('hp')===0,'lethal damage enters the defeat state');await screenshot(page,'defeat');
 await tap(page,'KeyR');ok(await num('state')===1&&await num('hp')===110&&await num('floor')===1,'R restarts after defeat and resets run statistics');

 await fixture({vars:{nextRelic:3},enemies:[{x:4.2,y:3.5,hp:1},{x:4.2,y:4,hp:1},{x:4.2,y:3,hp:1}]});await tap(page,'KeyQ');b=await sense(page);
 ok(+b.vars.state===2&&+b.vars.kills===3,'three real kills trigger a relic choice');
 const choices=[b.vars.choice1,b.vars.choice2,b.vars.choice3].map(Number);ok(new Set(choices).size===3&&choices.every(n=>n>=1&&n<=8),'relic offers contain three distinct valid upgrades');await screenshot(page,'relics');
 const beforeChoice=b.vars;await tap(page,'Digit1');b=await sense(page);const changed=['damage','shotDelay','maxhp','armor','leech','crit','novaPower','moveSpeed'][choices[0]-1];
 ok(+b.vars.state===1&&+b.vars.relics===1&&b.vars[changed]!==beforeChoice[changed],'choice key applies the selected upgrade and resumes play');
 await fixture({vars:{state:2,choice1:3,choice2:1,choice3:5}});await mouseAt(0,-5);await page.mouse.down();await page.mouse.up();await wait(220);
 ok(await num('state')===1&&await num('relics')===1&&await num('damage')===31,'real canvas click selects the middle relic card');
 await fixture({vars:{floor:1,px:15.5,py:15.5,left:0}});await tap(page,'KeyE');
 ok(await num('floor')===2&&await num('left')===8&&await num('state')===2,'unlocked portal generates the second floor and offers a relic');
 await tap(page,'Digit2');await wait(200);await screenshot(page,'second-floor');
 await fixture({vars:{floor:3,left:1,bossPhase:0,bossSummons:0},enemies:[{slot:9,x:4.5,y:3.5,kind:3,hp:190}]});await keys(page,['Space']);await wait(200);await keys(page,[]);b=await sense(page);
 ok(+b.vars.bossPhase===1&&+b.vars.bossSummons===2&&+b.vars.left===3,'boss enrages at half health and summons two guardians into free slots');
 await fixture({vars:{floor:3,left:1},enemies:[{slot:9,x:4.5,y:3.5,kind:3,hp:1}]});await keys(page,['Space']);await wait(250);await keys(page,[]);
 ok(await num('state')===4&&await num('score')>=2800,'defeating the final boss awards the crown and victory score');await screenshot(page,'victory');

 const hashes=new Set();
 for(let i=0;i<12;i++){
  await setVars(page,{state:5});await tap(page,'KeyR');const sample=await sense(page),map=sample.lists.map;
  const reached=flood(map,Math.floor(+sample.vars.py)*19+Math.floor(+sample.vars.px));
  assert.equal(reached.size,map.filter(n=>n===0).length,`generated map ${i} must be connected`);
  for(let j=0;j<9;j++)if(sample.lists.ehp[j]>0)assert.ok(reached.has(Math.floor(sample.lists.ey[j])*19+Math.floor(sample.lists.ex[j])),`enemy ${j} reachable`);
  assert.ok(reached.has(15*19+15),'portal reachable');
  for(let j=0;j<19;j++)assert.ok(map[j]&&map[342+j]&&map[j*19]&&map[j*19+18],'closed map border');
  hashes.add(map.join(''));
 }
 ok(hashes.size>=10,'twelve native generations have connected rooms, reachable enemies and distinct layouts');
 const modes=[];for(let i=0;i<3;i++){modes.push(await num('cols'));await tap(page,'KeyF');}ok(modes.join(',')==='60,80,40','F cycles standard, detailed and fast rendering modes');
 await tap(page,'KeyM');ok(await num('minimap')===0,'M toggles the minimap');await tap(page,'KeyM');
 await tap(page,'KeyN');ok(await num('muted')===1,'N mutes sound');await tap(page,'KeyN');
 // Profile a controlled active rotation; record measurements, do not promise
 // this machine's speed on other computers or the official production engine.
 await fixture();a=await sense(page);await keys(page,['ArrowRight']);const start=Date.now();await wait(3000);await keys(page,[]);b=await sense(page);
 report.metrics.rotationFps=(+b.vars.frames-+a.vars.frames)/((Date.now()-start)/1000);
 ok(report.metrics.rotationFps>10,'continuous rotation continues rendering without stalls');
 const nonfinite=Object.entries(b.vars).filter(([k,x])=>typeof x==='number'&&!Number.isFinite(x));ok(nonfinite.length===0,'runtime numeric state remains finite');
 ok(errors.length===0,'no uncaught exceptions or console errors');ok(failed.length===0,'no failed asset requests');
 report.finished=new Date().toISOString();report.metrics.layouts=hashes.size;report.errors=errors;report.failedRequests=failed;
 fs.writeFileSync(path.join(dir,'verification.json'),JSON.stringify(report,null,2));console.log('RESULT',JSON.stringify({checks:report.checks.length,...report.metrics,archive:report.archive}));
}catch(error){await screenshot(page,'verification-failure');fs.writeFileSync(path.join(dir,'failure.json'),JSON.stringify(await sense(page),null,2));console.log('FAIL_STATE',JSON.stringify((await sense(page)).vars));throw error;}
finally{await browser.close();}
