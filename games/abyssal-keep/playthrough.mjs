// End-to-end player: reads the world but acts ONLY through ordinary key events.
// No variable/list writes, project functions, teleports, stat boosts or cheats.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {boot,sense,keys,tap,screenshot,dir,latest} from './harness.mjs';
const {browser,page,errors,failed}=await boot();
const report={file:latest(),started:new Date().toISOString(),inputsOnly:true,events:[],frames:[]};
const start=Date.now();let lastLog=0,lastFloor=0,lastKills=-1,lastState=-1,strafe=1,lastPosition=null,stuck=0,bossShot=0;
const index=(x,y)=>Math.floor(y)*19+Math.floor(x);
const wrap=a=>((a+540)%360)-180;
function routes(map,start){const previous=new Map([[start,-1]]),queue=[start];for(let i=0;i<queue.length;i++)for(const d of[-1,1,-19,19]){const n=queue[i]+d;if(n>=0&&n<361&&!map[n]&&!previous.has(n)){previous.set(n,queue[i]);queue.push(n);}}return previous;}
function pathTo(previous,target){if(!previous.has(target))return null;const p=[target];while(previous.get(p.at(-1))!==-1)p.push(previous.get(p.at(-1)));return p.reverse();}
function clear(map,px,py,x,y){const steps=Math.ceil(Math.hypot(x-px,y-py)*15);for(let i=1;i<=steps;i++){const at=index(px+(x-px)*i/steps,py+(y-py)*i/steps);if(at<0||at>=361||map[at])return false;}return true;}
function canMove(map,x,y){return[-.19,.19].every(dx=>[-.19,.19].every(dy=>!map[index(x+dx,y+dy)]));}
try{
 await tap(page,'Enter');
 while(Date.now()-start<480000){
  const {vars:raw,lists:L}=await sense(page),V=Object.fromEntries(Object.entries(raw).map(([k,x])=>[k,Number(x)]));
  if(V.floor!==lastFloor){lastFloor=V.floor;report.events.push({type:'floor',floor:V.floor,time:Date.now()-start,hp:V.hp});console.log('FLOOR',V.floor,'HP',V.hp);}
  if(V.kills!==lastKills){lastKills=V.kills;console.log('KILLS',V.kills,'LEFT',V.left,'HP',V.hp,'SOUL',V.score);}
  if(V.state!==lastState){lastState=V.state;report.events.push({type:'state',state:V.state,time:Date.now()-start});}
  if(V.state===4){await keys(page,[]);await page.waitForTimeout(250);await screenshot(page,'playthrough-victory');report.outcome='victory';report.final=raw;break;}
  if(V.state===3){await keys(page,[]);await screenshot(page,'playthrough-defeat');report.outcome='defeat';report.final=raw;break;}
  if(V.state===2){
   await keys(page,[]);await screenshot(page,`playthrough-relic-${V.relics+1}`);
   const rank=V.hp<65?[3,5,1,2,4,7,6,8]:[1,5,2,3,7,6,4,8];
   const choices=[V.choice1,V.choice2,V.choice3],choice=choices.map((v,i)=>({i,rank:rank.indexOf(v)})).sort((a,b)=>a.rank-b.rank)[0].i;
   report.events.push({type:'relic',id:choices[choice],floor:V.floor,hp:V.hp});await tap(page,'Digit'+(choice+1));continue;
  }
  if(V.state!==1){await keys(page,[]);await page.waitForTimeout(100);continue;}
  const map=L.map,px=V.px,py=V.py,rad=V.angle*Math.PI/180,dx=Math.cos(rad),dy=Math.sin(rad);
  const prev=routes(map,index(px,py));const live=[];
  for(let i=0;i<9;i++)if(L.ehp[i]>0){const x=L.ex[i],y=L.ey[i],distance=Math.hypot(x-px,y-py),route=pathTo(prev,index(x,y));if(route)live.push({i,x,y,distance,route,visible:clear(map,px,py,x,y),kind:L.kind[i]});}
  const visible=live.filter(e=>e.visible&&e.distance<10).sort((a,b)=>a.distance-b.distance);
  const seenBoss=visible.find(e=>e.kind===3&&e.distance<5&&Math.abs(wrap(Math.atan2(e.y-py,e.x-px)*180/Math.PI-V.angle))<15);
  if(seenBoss&&bossShot<1+V.bossPhase){bossShot=1+V.bossPhase;await screenshot(page,V.bossPhase?'boss-enraged':'boss-battle');}
  let target=visible[0]||live.sort((a,b)=>a.route.length-b.route.length)[0];let point,look,combat=!!visible.length;
  if(target){look=target;point=target.route.length>1?target.route[1]:index(target.x,target.y);}
  if(!combat&&V.hp<85){
   const potions=[];for(let i=0;i<14;i++)if(L.kind[i]===8){const route=pathTo(prev,index(L.ex[i],L.ey[i]));if(route)potions.push({x:L.ex[i],y:L.ey[i],route});}
   potions.sort((a,b)=>a.route.length-b.route.length);if(potions[0]&&(!target||potions[0].route.length<=target.route.length+4)){target=potions[0];point=target.route[1]??index(target.x,target.y);look=target;}
  }
  if(!target){const route=pathTo(prev,index(15.5,15.5));assert.ok(route,'portal must be reachable');target={x:15.5,y:15.5,route};point=route[1]??index(15.5,15.5);look=target;}
  const desired=[];let mx=0,my=0;
  if(combat){
   const angle=Math.atan2(look.y-py,look.x-px)*180/Math.PI,error=wrap(angle-V.angle);
   if(Math.abs(error)>5)desired.push(error>0?'ArrowRight':'ArrowLeft');
   if(Math.abs(error)<12)desired.push('Space');
   if(V.mana>=70&&visible[0].distance<4.35&&(visible.length>=2||visible[0].kind===3||V.hp<70))desired.push('KeyQ');
   if(V.danger||visible[0].distance<1.1){
    if(!canMove(map,px-dy*.55*strafe,py+dx*.55*strafe))strafe*=-1;
    if(canMove(map,px-dy*.4*strafe,py+dx*.4*strafe)){mx=-dy*strafe;my=dx*strafe;}
    else if(canMove(map,px-dx*.4,py-dy*.4)){mx=-dx;my=-dy;}
    if(V.dashCd<=0&&visible[0].distance<1.6)desired.push('ShiftLeft');
   }else if(visible[0].distance>3.1&&Math.abs(error)<20){mx=dx;my=dy;}
  }else{
   let wx=point%19+.5,wy=Math.floor(point/19)+.5;
   const cx=Math.floor(px)+.5,cy=Math.floor(py)+.5;
   if(Math.floor(px)!==Math.floor(wx)&&Math.abs(py-cy)>.2){wx=cx;wy=cy;}
   if(Math.floor(py)!==Math.floor(wy)&&Math.abs(px-cx)>.2){wx=cx;wy=cy;}
   if(target.route.length<=1){wx=target.x;wy=target.y;}
   const dist=Math.hypot(wx-px,wy-py);if(dist>.11){mx=(wx-px)/dist;my=(wy-py)/dist;}
   const angle=Math.atan2(wy-py,wx-px)*180/Math.PI,error=wrap(angle-V.angle);
   if(Math.abs(error)>8)desired.push(error>0?'ArrowRight':'ArrowLeft');
  }
  const fwd=mx*dx+my*dy,side=-mx*dy+my*dx;
  if(fwd>.38)desired.push('KeyW');else if(fwd<-.38)desired.push('KeyS');
  if(side>.38)desired.push('KeyD');else if(side<-.38)desired.push('KeyA');
  if(V.left===0&&Math.abs(px-15.5)<1.2&&Math.abs(py-15.5)<1.2)desired.push('KeyE');
  if(lastPosition&&Math.hypot(px-lastPosition[0],py-lastPosition[1])<.012&&Math.hypot(mx,my)>.1)stuck++;else stuck=0;
  lastPosition=[px,py];if(stuck>12){console.log('STUCK',px.toFixed(2),py.toFixed(2),point,desired);strafe*=-1;stuck=0;}
  report.frames.push({ms:Date.now()-start,floor:V.floor,x:px,y:py,angle:V.angle,hp:V.hp,kills:V.kills,keys:desired});
  if(Date.now()-lastLog>12000){lastLog=Date.now();console.log('PROGRESS',JSON.stringify({sec:Math.round((Date.now()-start)/1000),floor:V.floor,left:V.left,hp:V.hp,x:px.toFixed(2),y:py.toFixed(2),combat,target:target.i}));await screenshot(page,`playthrough-floor-${V.floor}`);}
  await keys(page,desired);await page.waitForTimeout(100);
 }
 report.errors=errors;report.failed=failed;report.finished=new Date().toISOString();
 fs.writeFileSync(path.join(dir,'playthrough.json'),JSON.stringify(report,null,2));
 fs.writeFileSync(path.join(dir,`playthrough-${report.final?.seed||'incomplete'}.json`),JSON.stringify(report,null,2));
 console.log('OUTCOME',report.outcome,'ERRORS',JSON.stringify(errors));assert.equal(report.outcome,'victory','input-only bot must complete all three floors');assert.deepEqual(errors,[]);assert.deepEqual(failed,[]);
}finally{await keys(page,[]).catch(()=>{});await browser.close();}
