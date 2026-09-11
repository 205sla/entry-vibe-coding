// Build-time DSL -> ordinary Entry blocks. The .ent runs without this JS file.
import {
 when,repeat,if_,cmp,and_,or_,not_,calc,mod,quotient,rand,txt,combine,
 getVar as v,setVar as s,changeVar as inc,valueAt as at,setListAt as put,
 fn,call,obj,scene,isPressed,locateXY,changeShape,eraseAll,stamp,show,hide,
 resetSize,setSize,stretch,writeText,startDraw,stopDraw,setThickness,setColor,timer,
} from '../../tools/lib/spec-dsl.mjs';
import * as art from './assets.mjs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url));
export const SIZE=19, ENEMIES=9, ENTITIES=14, WALL_PICTURES=288;
const add=(a,b)=>calc(a,'+',b),sub=(a,b)=>calc(a,'-',b),mul=(a,b)=>calc(a,'*',b),div=(a,b)=>calc(a,'/',b);
const eq=(a,b)=>cmp(a,'==',b),gt=(a,b)=>cmp(a,'>',b),lt=(a,b)=>cmp(a,'<',b),ge=(a,b)=>cmp(a,'>=',b),le=(a,b)=>cmp(a,'<=',b);
const op=(a,f)=>({type:'calc_operation',params:[null,a,null,f]});
const abs=a=>op(a,'abs'),sqrt=a=>op(a,'root'),sin=a=>op(a,'sin'),cos=a=>op(a,'cos'),floor=a=>op(a,'floor');
const min=(a,b)=>div(sub(add(a,b),abs(sub(a,b))),2),max=(a,b)=>div(add(add(a,b),abs(sub(a,b))),2);
const both=(...x)=>x.reduce((a,b)=>and_(a,b));
const either=(...x)=>x.reduce((a,b)=>or_(a,b));
const sum=(...x)=>x.reduce((a,b)=>add(a,b));
const join=(...x)=>x.reduce((a,b)=>combine(a,b));
const run=(id,...args)=>s('sink',call(id,...args));
const vf=(id,p,b,locals=[],label=id)=>fn.value(id,p,b,()=>0,locals,{label});
const idxy=(x,y)=>add(add(mul(floor(y),SIZE),floor(x)),1);
const tile=(x,y)=>call('tile',x,y);
const rng=(a,b)=>call('random',a,b);
const colorExpr=x=>({type:'set_color',params:[x,null]});
const sound=name=>if_(eq(v('muted'),0),[{type:'sound_something_with_block',params:[txt(name),null]}]);
const line=(x1,y1,x2,y2,color,width=1)=>[stopDraw(),setColor(color),setThickness(width),locateXY(x1,y1),startDraw(),locateXY(x2,y2),stopDraw()];
const fields=['map','nav','work','queue'];
const entityFields=['ex','ey','ehp','emax','kind','cool','wind','aimx','aimy','flash','ez','sx','drawn'];
const variables=[
 'state','floor','hp','maxhp','damage','shotDelay','armor','leech','crit','moveSpeed','novaPower',
 'mana','score','best','kills','left','nextRelic','choice1','choice2','choice3','relics',
 'px','py','angle','vx','vy','dt','lastTime','now','elapsed','frames','sink','rng','seed',
 'shootCd','recoil','invuln','hurt','pulse','dashCd','dashTime','dashPeriod','danger','alert','alertTime',
 'moveX','moveY','fwd','strafe','moving','bob','target','near','shotX','shotY','hitmarker',
 'cols','strip','minimap','muted','navActive','navCell','navHead','navTail',
 'rx','ry','mx','my','ddx','ddy','stepx','stepy','sideX','sideY','side','distance','hitcell',
 'rayU','height','shade','wallTex','drawDepth','drawSide','sortId','sortDepth','mapStamp',
 'wallX','wallY','wallAngle','wallFloor','wallCols','spriteFrame',
 'bossPhase','bossSummons',
 'prevEnter','prevP','prevR','prevM','prevN','prevF','prevQ','prevShift','prev1','prev2','prev3',
 'healthShown','manaShown','objectiveShown','scoreShown','statusShown','choiceShown1','choiceShown2','choiceShown3','overlayShown','bossShown',
].map(id=>({id,name:id,value:String(({state:0,floor:1,hp:110,maxhp:110,cols:60,strip:8,minimap:1,rng:712367}[id])??0),visible:false}));
// Entry resolves globals with a linear lookup. Put the DDA hot path first.
const hot=['mx','my','sideX','sideY','ddx','ddy','stepx','stepy','distance','hitcell','px','py','rx','ry','vx','vy','side','drawDepth','height','shade','wallTex','rayU','cols','strip','sink','state','frames','dt','sortId','sortDepth'];
variables.sort((a,b)=>(hot.includes(a.id)?hot.indexOf(a.id):1000)-(hot.includes(b.id)?hot.indexOf(b.id):1000));
const lists=[
 ...fields.map(id=>({id,name:id,array:Array(SIZE*SIZE).fill(id==='map'?1:999),visible:false})),
 ...entityFields.map(id=>({id,name:id,array:Array(ENTITIES).fill(0),visible:false})),
 {id:'depth',name:'depth',array:Array(80).fill(50),visible:false},
 {id:'relicNames',name:'유물 이름',array:['파열의 인장','속사의 서약','거인의 심장','흑철 피부','흡혈의 계약','예언자의 눈','폭풍의 핵','유령 걸음'],visible:false},
 {id:'relicDesc',name:'유물 효과',array:['탄환 피해 +9','발사 간격 18% 감소','최대 체력 +30 / 40 회복','받는 피해 -3','명중할 때 체력 +4','치명타 확률 +15%','충격파 피해 +30 / 마력 충전','이동 속도 증가 / 회피 가속'],visible:false},
 {id:'roomOrder',name:'배치할 방',array:[0,1,3,4,2,8,6,5,7],visible:false},
 {id:'floorNames',name:'층 이름',array:['잊힌 감옥','황금의 납골당','왕관의 심장'],visible:false},
];
const functions=[
 fn.value('random',['rmin','rmax'],(a,b)=>[s('rng',mod(add(mul(v('rng'),1664525),1013904223),4294967296))],(a,b)=>add(a,mod(v('rng'),add(sub(b,a),1))),[],{label:'원정 난수'}),
 fn.value('tile',['tx','ty'],(x,y,L)=>[
  L.set('out',1),if_(both(ge(x,0),lt(x,SIZE),ge(y,0),lt(y,SIZE)),[L.set('out',at('map',idxy(x,y)))]),
 ],(x,y,L)=>L.get('out'),['out'],{label:'경계를 확인하고 벽 읽기'}),
 vf('maprow',['row'],y=>[
  ...Array.from({length:SIZE},(_,x)=>put('map',idxy(x,y),1)),
  if_(both(gt(y,0),lt(y,18),cmp(mod(y,6),'!=',0)),[
   ...Array.from({length:SIZE},(_,x)=>x>0&&x<18&&x%6!==0?put('map',idxy(x,y),0):null).filter(Boolean),
  ]),if_(lt(y,18),[run('maprow',add(y,1))]),
 ],[],'방 아홉 개의 바닥 만들기'),
 vf('buildmap',[],(L)=>[
  run('maprow',0),
  ...[3,9,15].flatMap(y=>[6,12].map(x=>put('map',idxy(x,add(y,rng(-1,1))),0))),
  ...[6,12].flatMap(y=>[
   put('map',idxy(add(3,mul(6,rng(0,2))),y),0),
   ...[3,9,15].map(x=>if_(lt(rng(0,9),6),[put('map',idxy(add(x,rng(-1,1)),y),0)])),
  ]),
  ...[1,2,3,4,5,6,7].map(room=>if_(eq(rng(0,1),1),[
   put('map',idxy(add(room%3*6+3,rng(0,1)),add(Math.floor(room/3)*6+3,rng(0,1))),1),
   put('map',idxy(room%3*6+3,Math.floor(room/3)*6+3),0),
  ])),
  s('navCell',-1),s('navActive',0),
 ],[],'연결된 무작위 통로와 기둥'),
 vf('navreset',['nr'],y=>[
  ...Array.from({length:SIZE},(_,x)=>put('work',idxy(x,y),999)),
  if_(lt(y,18),[run('navreset',add(y,1))]),
 ],[],'길찾기 작업 버퍼 초기화'),
 vf('navcopy',['nc'],y=>[
  ...Array.from({length:SIZE},(_,x)=>put('nav',idxy(x,y),at('work',idxy(x,y)))),
  if_(lt(y,18),[run('navcopy',add(y,1))]),
 ],[],'완료한 길찾기 필드 교체'),
 vf('navpop',[],L=>[
  if_(le(v('navHead'),v('navTail')),[
   L.set('cell',at('queue',v('navHead'))),inc('navHead',1),L.set('cost',add(at('work',L.get('cell')),1)),
   ...[-1,1,-SIZE,SIZE].map(off=>{
    const n=add(L.get('cell'),off);return if_(both(ge(n,1),le(n,361)),[
     if_(both(eq(at('map',n),0),eq(at('work',n),999)),[
      put('work',n,L.get('cost')),inc('navTail',1),put('queue',v('navTail'),n),
     ]),
    ]);
   }),
  ]),
 ],['cell','cost'],'너비 우선 경로 탐색'),
 vf('navigation',[],()=>[
  if_(eq(v('navActive'),0),[
   if_(cmp(v('navCell'),'!=',idxy(v('px'),v('py'))),[
    run('navreset',0),s('navCell',idxy(v('px'),v('py'))),put('queue',1,v('navCell')),put('work',v('navCell'),0),
    s('navHead',1),s('navTail',1),s('navActive',1),
   ]),
  ],[
   ...Array.from({length:20},()=>run('navpop')),
   if_(gt(v('navHead'),v('navTail')),[run('navcopy',0),s('navActive',0)]),
  ]),
 ],[],'매 프레임 스무 칸 길찾기'),
 vf('spawn',['ei'],(i,L)=>[
  if_(le(i,ENTITIES),[
   ...entityFields.map(id=>put(id,i,0)),
   if_(le(i,v('left')),[
    L.set('room',at('roomOrder',i)),L.set('x',add(3.5,mul(mod(L.get('room'),3),6))),L.set('y',add(3.5,mul(quotient(L.get('room'),3),6))),
    if_(eq(i,1),[L.set('x',4.9),L.set('y',3.5)]),
    put('ex',i,L.get('x')),put('ey',i,L.get('y')),put('map',idxy(L.get('x'),L.get('y')),0),
    put('kind',i,1),if_(eq(mod(i,3),0),[put('kind',i,2)]),
    put('ehp',i,add(26,mul(v('floor'),10))),
    if_(both(eq(v('floor'),3),eq(i,9)),[
     put('kind',i,3),put('ehp',i,360),put('ex',i,15.5),put('ey',i,15.5),
    ]),put('emax',i,at('ehp',i)),put('cool',i,add(1.4,mul(i,.16))),
   ]),
   if_(both(ge(i,10),le(i,13)),[
    L.set('room',mul(sub(i,9),2)),put('ex',i,add(2.5,mul(mod(L.get('room'),3),6))),
    put('ey',i,add(3.5,mul(quotient(L.get('room'),3),6))),put('kind',i,add(8,mod(i,2))),
    put('map',idxy(at('ex',i),at('ey',i)),0),
   ]),
   if_(eq(i,14),[put('ex',i,15.5),put('ey',i,15.5),put('kind',i,7)]),
   run('spawn',add(i,1)),
  ]),
 ],['room','x','y'],'적과 회복약과 균열 배치'),
 vf('newfloor',[],()=>[
  s('left',6),if_(eq(v('floor'),2),[s('left',8)]),if_(eq(v('floor'),3),[s('left',9)]),
  run('buildmap'),run('spawn',1),s('px',2.5),s('py',3.5),s('angle',0),s('vx',1),s('vy',0),s('wallFloor',-1),
  s('invuln',1.8),s('mana',100),s('shootCd',0),s('hurt',0),s('dashTime',0),s('dashCd',0),
  s('bossPhase',0),s('bossSummons',0),
  s('alert',1),s('alertTime',3),s('lastTime',timer.value()),
 ],[],'다음 층으로 하강'),
 vf('newgame',[],()=>[
  s('seed',rand(100000,999999)),s('rng',v('seed')),s('floor',1),s('hp',110),s('maxhp',110),
  s('damage',22),s('shotDelay',.32),s('armor',0),s('leech',0),s('crit',10),s('moveSpeed',2.35),s('novaPower',65),
  s('score',0),s('kills',0),s('nextRelic',3),s('relics',0),s('elapsed',0),s('dashPeriod',1.8),s('pulse',0),
  run('newfloor'),s('state',1),
 ],[],'새 원정 시작'),
 // DDA's scalar t is perpendicular camera depth for camera-plane rays, and a
 // fraction of the segment for enemy line-of-sight rays. Zero axes are guarded.
 vf('ddastep',['stepcount'],n=>[
  if_(lt(v('sideX'),v('sideY')),[
   s('distance',v('sideX')),inc('sideX',v('ddx')),inc('mx',v('stepx')),s('side',0),
  ],[
   s('distance',v('sideY')),inc('sideY',v('ddy')),inc('my',v('stepy')),s('side',1),
  // The map has an unbroken solid border and the player stays inside it.
  // DDA therefore always hits a valid border cell before it can leave the list.
  ]),s('hitcell',at('map',add(add(mul(v('my'),SIZE),v('mx')),1))),
  if_(both(eq(v('hitcell'),0),lt(n,38)),[run('ddastep',add(n,1))]),
 ],[],'광선을 다음 격자 경계까지 진행'),
 fn.value('cast',['cdx','cdy'],(dx,dy)=>[
  s('rx',dx),s('ry',dy),if_(lt(abs(v('rx')),.000001),[s('rx',.000001)]),if_(lt(abs(v('ry')),.000001),[s('ry',.000001)]),
  s('mx',floor(v('px'))),s('my',floor(v('py'))),s('ddx',abs(div(1,v('rx')))),s('ddy',abs(div(1,v('ry')))),
  if_(lt(v('rx'),0),[s('stepx',-1),s('sideX',mul(sub(v('px'),v('mx')),v('ddx')))],[s('stepx',1),s('sideX',mul(sub(add(v('mx'),1),v('px')),v('ddx')))]),
  if_(lt(v('ry'),0),[s('stepy',-1),s('sideY',mul(sub(v('py'),v('my')),v('ddy')))],[s('stepy',1),s('sideY',mul(sub(add(v('my'),1),v('py')),v('ddy')))]),
  run('ddastep',0),s('distance',max(.02,v('distance'))),
 ],()=>v('distance'),[],{label:'DDA 벽 거리와 시야 판정'}),
 vf('offer',[],()=>[
  s('choice1',rng(1,8)),s('choice2',add(mod(add(sub(v('choice1'),1),rng(1,7)),8),1)),s('choice3',rng(1,8)),
  ...Array.from({length:3},()=>if_(either(eq(v('choice3'),v('choice1')),eq(v('choice3'),v('choice2'))),[s('choice3',add(mod(v('choice3'),8),1))])),
  s('state',2),sound('relic'),
 ],[],'서로 다른 유물 세 개 제시'),
 vf('choose',['chosen'],c=>[
  if_(eq(v('state'),2),[
   if_(eq(c,1),[inc('damage',9)]),if_(eq(c,2),[s('shotDelay',max(.11,mul(v('shotDelay'),.82)))]),
   if_(eq(c,3),[inc('maxhp',30),s('hp',min(v('maxhp'),add(v('hp'),40)))]),if_(eq(c,4),[inc('armor',3)]),
   if_(eq(c,5),[inc('leech',4)]),if_(eq(c,6),[s('crit',min(70,add(v('crit'),15)))]),
   if_(eq(c,7),[inc('novaPower',30),s('mana',100)]),if_(eq(c,8),[inc('moveSpeed',.25),s('dashPeriod',mul(v('dashPeriod'),.85))]),
   inc('relics',1),s('state',1),s('invuln',1),sound('relic'),
  ]),
 ],[],'선택한 유물 효과 누적'),
 vf('damageenemy',['victim','amount'],(i,amount,L)=>[
  if_(gt(at('ehp',i),0),[
   put('ehp',i,sub(at('ehp',i),amount)),put('flash',i,.13),s('hitmarker',.16),
   s('hp',min(v('maxhp'),add(v('hp'),v('leech')))),
   if_(both(eq(at('kind',i),3),eq(v('bossPhase'),0),le(at('ehp',i),180),gt(at('ehp',i),0)),[
    s('bossPhase',1),s('pulse',.3),sound('nova'),
    ...Array.from({length:8},(_,j)=>j+1).map(j=>if_(both(le(at('ehp',j),0),lt(v('bossSummons'),2)),[
     put('ex',j,add(14.5,mul(v('bossSummons'),2))),put('ey',j,15.5),put('kind',j,1),put('ehp',j,50),put('emax',j,50),put('wind',j,0),put('cool',j,1.5),
     inc('bossSummons',1),inc('left',1),
    ])),
   ]),
   if_(le(at('ehp',i),0),[
    put('ehp',i,0),inc('left',-1),inc('kills',1),inc('score',mul(v('floor'),100)),
    if_(eq(at('kind',i),3),[
     s('state',4),inc('score',2500),sound('victory'),
    ],[
     put('kind',i,rng(8,9)),put('wind',i,0),sound('kill'),
     if_(ge(v('kills'),v('nextRelic')),[inc('nextRelic',4),run('offer')]),
     if_(eq(v('left'),0),[s('alert',2),s('alertTime',4),sound('relic')]),
    ]),
   ]),
  ]),
 ],[],'피격 처치 드롭과 유물 보상'),
 vf('takehit',['incoming'],a=>[
  if_(both(eq(v('state'),1),le(v('invuln'),0)),[
   inc('hp',mul(-1,max(2,sub(a,v('armor'))))),s('hurt',.4),s('invuln',.55),sound('hurt'),
   if_(le(v('hp'),0),[s('hp',0),s('state',3)]),
  ]),
 ],[],'방어력 무적 시간과 사망'),
 vf('aim',['ai'],(i,L)=>[
  if_(le(i,ENEMIES),[
   if_(gt(at('ehp',i),0),[
    L.set('dx',sub(at('ex',i),v('px'))),L.set('dy',sub(at('ey',i),v('py'))),
    L.set('z',add(mul(L.get('dx'),v('vx')),mul(L.get('dy'),v('vy')))),
    L.set('side',abs(sub(mul(L.get('dy'),v('vx')),mul(L.get('dx'),v('vy'))))),
    if_(both(gt(L.get('z'),.05),lt(L.get('z'),v('near')),lt(L.get('side'),add(.26,mul(L.get('z'),.055)))),[
     if_(ge(call('cast',L.get('dx'),L.get('dy')),.98),[s('target',i),s('near',L.get('z'))]),
    ]),
   ]),run('aim',add(i,1)),
  ]),
 ],['dx','dy','z','side'],'조준점에 가장 가까운 적 선택'),
 vf('fire',[],L=>[
  s('shootCd',v('shotDelay')),s('recoil',.16),s('target',0),s('near',30),sound('shot'),run('aim',1),
  if_(gt(v('target'),0),[
   L.set('power',v('damage')),if_(le(rng(1,100),v('crit')),[L.set('power',mul(v('damage'),2)),inc('score',10)]),
   run('damageenemy',v('target'),L.get('power')),
  ]),
 ],['power'],'벽을 통과하지 않는 룬 탄환'),
 vf('novahit',['ni'],(i,L)=>[
  if_(le(i,ENEMIES),[
   if_(gt(at('ehp',i),0),[
    L.set('dx',sub(at('ex',i),v('px'))),L.set('dy',sub(at('ey',i),v('py'))),
    if_(lt(add(mul(L.get('dx'),L.get('dx')),mul(L.get('dy'),L.get('dy'))),20.25),[
     if_(ge(call('cast',L.get('dx'),L.get('dy')),.98),[run('damageenemy',i,v('novaPower'))]),
    ]),
   ]),run('novahit',add(i,1)),
  ]),
 ],['dx','dy'],'보이는 적에게 충격파 피해'),
 vf('enemy',['updatei'],(i,L)=>[
  if_(le(i,ENTITIES),[
   put('flash',i,max(0,sub(at('flash',i),v('dt')))),
   L.set('dx',sub(at('ex',i),v('px'))),L.set('dy',sub(at('ey',i),v('py'))),
   L.set('dist',sqrt(add(mul(L.get('dx'),L.get('dx')),mul(L.get('dy'),L.get('dy'))))),
   if_(gt(at('ehp',i),0),[
    L.set('los',0),if_(lt(L.get('dist'),9),[if_(ge(call('cast',L.get('dx'),L.get('dy')),.98),[L.set('los',1)])]),
    put('cool',i,sub(at('cool',i),v('dt'))),
    if_(gt(at('wind',i),0),[
     put('wind',i,sub(at('wind',i),v('dt'))),s('danger',1),
     if_(le(at('wind',i),0),[
      if_(eq(at('kind',i),1),[
       if_(both(lt(L.get('dist'),1.12),eq(L.get('los'),1)),[run('takehit',add(9,mul(v('floor'),2)))]),
      ],[
       if_(both(lt(abs(sub(v('px'),at('aimx',i))),.7),lt(abs(sub(v('py'),at('aimy',i))),.7),eq(L.get('los'),1)),[
        run('takehit',add(12,mul(at('kind',i),3))),
       ]),
      ]),put('cool',i,1.35),if_(eq(at('kind',i),3),[put('cool',i,sub(1.2,mul(v('bossPhase'),.5)))]),
     ]),
    ],[
     if_(both(le(at('cool',i),0),eq(L.get('los'),1)),[
      if_(either(both(eq(at('kind',i),1),lt(L.get('dist'),.85)),both(gt(at('kind',i),1),lt(L.get('dist'),7))),[
       put('wind',i,.65),if_(eq(at('kind',i),3),[put('wind',i,sub(1,mul(v('bossPhase'),.4)))]),put('aimx',i,v('px')),put('aimy',i,v('py')),
      ]),
     ]),
     if_(gt(L.get('dist'),.62),[
      L.set('tx',v('px')),L.set('ty',v('py')),
      if_(eq(L.get('los'),0),[
       L.set('cell',idxy(at('ex',i),at('ey',i))),L.set('best',at('nav',L.get('cell'))),L.set('dest',L.get('cell')),
       ...[-1,1,-SIZE,SIZE].map(off=>{
        const n=add(L.get('cell'),off);return if_(both(ge(n,1),le(n,361)),[
         if_(both(eq(at('map',n),0),lt(at('nav',n),L.get('best'))),[L.set('best',at('nav',n)),L.set('dest',n)]),
        ]);
       }),
       L.set('tx',add(mod(sub(L.get('dest'),1),SIZE),.5)),L.set('ty',add(quotient(sub(L.get('dest'),1),SIZE),.5)),
      ]),
      L.set('sx',sub(L.get('tx'),at('ex',i))),L.set('sy',sub(L.get('ty'),at('ey',i))),
      L.set('len',max(.05,sqrt(add(mul(L.get('sx'),L.get('sx')),mul(L.get('sy'),L.get('sy')))))),
      L.set('speed',mul(v('dt'),add(.7,mul(v('floor'),.08)))),
      if_(gt(at('kind',i),1),[L.set('speed',mul(L.get('speed'),.65))]),
      if_(both(gt(at('kind',i),1),eq(L.get('los'),1),lt(L.get('dist'),3)),[L.set('speed',0)]),
      L.set('sx',mul(div(L.get('sx'),L.get('len')),min(L.get('len'),L.get('speed')))),L.set('sy',mul(div(L.get('sy'),L.get('len')),min(L.get('len'),L.get('speed')))),
      L.set('nx',add(at('ex',i),L.get('sx'))),L.set('ny',add(at('ey',i),L.get('sy'))),
      if_(both(eq(tile(add(L.get('nx'),.18),at('ey',i)),0),eq(tile(sub(L.get('nx'),.18),at('ey',i)),0)),[put('ex',i,L.get('nx'))]),
      if_(both(eq(tile(at('ex',i),add(L.get('ny'),.18)),0),eq(tile(at('ex',i),sub(L.get('ny'),.18)),0)),[put('ey',i,L.get('ny'))]),
     ]),
    ]),
   ],[
    if_(both(ge(at('kind',i),8),lt(L.get('dist'),.65)),[
     if_(eq(at('kind',i),8),[s('hp',min(v('maxhp'),add(v('hp'),24)))],[s('mana',min(100,add(v('mana'),25))),inc('score',40)]),
     put('kind',i,0),sound('pickup'),
    ]),
   ]),run('enemy',add(i,1)),
  ]),
 ],['dx','dy','dist','los','tx','ty','cell','best','dest','sx','sy','len','speed','nx','ny'],'적의 길찾기 추적 공격 예고와 드롭 수집'),
 vf('moveplayer',[],L=>[
  s('fwd',0),s('strafe',0),
  if_(either(isPressed(87),isPressed(38)),[inc('fwd',1)]),if_(either(isPressed(83),isPressed(40)),[inc('fwd',-1)]),
  if_(isPressed(65),[inc('strafe',-1)]),if_(isPressed(68),[inc('strafe',1)]),
  s('moving',either(cmp(v('fwd'),'!=',0),cmp(v('strafe'),'!=',0))),
  L.set('spd',mul(v('dt'),v('moveSpeed'))),if_(both(cmp(v('fwd'),'!=',0),cmp(v('strafe'),'!=',0)),[L.set('spd',mul(L.get('spd'),.7071))]),
  if_(gt(v('dashTime'),0),[L.set('spd',mul(L.get('spd'),3.1)),if_(both(eq(v('fwd'),0),eq(v('strafe'),0)),[s('fwd',1)])]),
  s('moveX',mul(sub(mul(v('fwd'),v('vx')),mul(v('strafe'),v('vy'))),L.get('spd'))),
  s('moveY',mul(add(mul(v('fwd'),v('vy')),mul(v('strafe'),v('vx'))),L.get('spd'))),
  // Four collision substeps keep even a dash inside the 0.18-radius cylinder.
  ...Array.from({length:4},()=>[
   L.set('nx',add(v('px'),div(v('moveX'),4))),
   if_(both(...[[-.18,-.18],[-.18,.18],[.18,-.18],[.18,.18]].map(([x,y])=>eq(tile(add(L.get('nx'),x),add(v('py'),y)),0))),[s('px',L.get('nx'))]),
   L.set('ny',add(v('py'),div(v('moveY'),4))),
   if_(both(...[[-.18,-.18],[-.18,.18],[.18,-.18],[.18,.18]].map(([x,y])=>eq(tile(add(v('px'),x),add(L.get('ny'),y)),0))),[s('py',L.get('ny'))]),
  ]).flat(),
 ],['spd','nx','ny'],'벽 미끄러짐과 대각선 속도 보정'),
];

functions.push(
 vf('floorline',['fx1','fy1','fx2','fy2'],(x1,y1,x2,y2,L)=>[
  L.set('a',add(mul(sub(x1,v('px')),v('vx')),mul(sub(y1,v('py')),v('vy')))),
  L.set('b',add(mul(sub(x2,v('px')),v('vx')),mul(sub(y2,v('py')),v('vy')))),
  L.set('u',sub(mul(sub(y1,v('py')),v('vx')),mul(sub(x1,v('px')),v('vy')))),
  L.set('w',sub(mul(sub(y2,v('py')),v('vx')),mul(sub(x2,v('px')),v('vy')))),
  if_(either(gt(L.get('a'),.55),gt(L.get('b'),.55)),[
   if_(lt(L.get('a'),.55),[L.set('u',add(L.get('u'),mul(sub(L.get('w'),L.get('u')),div(sub(.55,L.get('a')),sub(L.get('b'),L.get('a')))))),L.set('a',.55)]),
   if_(lt(L.get('b'),.55),[L.set('w',add(L.get('w'),mul(sub(L.get('u'),L.get('w')),div(sub(.55,L.get('b')),sub(L.get('a'),L.get('b')))))),L.set('b',.55)]),
   stopDraw(),locateXY(div(mul(300,L.get('u')),L.get('a')),sub(5,div(150,L.get('a')))),startDraw(),
   locateXY(div(mul(300,L.get('w')),L.get('b')),sub(5,div(150,L.get('b')))),stopDraw(),
  ]),
 ],['a','b','u','w'],'카메라 근평면에 잘라 바닥 타일 투영'),
 vf('walls',['column'],c=>[
  if_(lt(c,v('cols')),[
   s('rayU',sub(div(mul(add(c,.5),2),v('cols')),1)),
   s('drawDepth',call('cast',sub(v('vx'),mul(mul(v('vy'),.8),v('rayU'))),add(v('vy'),mul(mul(v('vx'),.8),v('rayU'))))),
   put('depth',add(c,1),v('drawDepth')),s('height',min(1500,div(300,v('drawDepth')))),
   s('shade',min(5,floor(add(mul(v('drawDepth'),.44),mul(v('side'),.85))))),
   if_(eq(v('side'),0),[s('wallTex',floor(mul(mod(add(v('py'),mul(v('drawDepth'),v('ry'))),1),16)))],[s('wallTex',floor(mul(mod(add(v('px'),mul(v('drawDepth'),v('rx'))),1),16)))]),
   changeShape(sum(1,mul(sub(v('floor'),1),96),mul(v('shade'),16),v('wallTex'))),
   resetSize(),stretch('WIDTH',mul(67,sub(div(add(v('strip'),.12),6),1))),
   stretch('HEIGHT',mul(div(add(add(v('strip'),.12),128),2),sub(div(v('height'),128),1))),
   locateXY(add(-240,mul(add(c,.5),v('strip'))),5),stamp(),run('walls',add(c,1)),
  ]),
 ],[],'거리 음영과 텍스처가 있는 벽 스트립'),
 vf('projectsprites',['psi'],i=>[
  if_(le(i,ENTITIES),[
   put('drawn',i,0),put('ez',i,0),
   if_(gt(at('kind',i),0),[
    put('ez',i,add(mul(sub(at('ex',i),v('px')),v('vx')),mul(sub(at('ey',i),v('py')),v('vy')))),
    put('sx',i,sub(mul(sub(at('ey',i),v('py')),v('vx')),mul(sub(at('ex',i),v('px')),v('vy')))),
   ]),run('projectsprites',add(i,1)),
  ]),
 ],[],'월드 오브젝트를 카메라 좌표로 변환'),
 vf('spriteslice',['ssi','ssj','ssh','ssk'],(i,j,h,k,L)=>[
  if_(lt(j,16),[
   L.set('x',add(div(mul(300,at('sx',i)),at('ez',i)),mul(sub(j,7.5),div(mul(h,6),128)))),
   if_(both(gt(L.get('x'),-246),lt(L.get('x'),246)),[
    L.set('col',max(1,min(v('cols'),add(floor(div(add(L.get('x'),240),v('strip'))),1)))),
    if_(lt(at('ez',i),add(at('depth',L.get('col')),.035)),[
     changeShape(sum(1,mul(sub(k,1),16),j)),resetSize(),setSize(mul(67,div(h,128))),
     locateXY(L.get('x'),add(5,div(sub(h,div(300,at('ez',i))),2))),stamp(),
    ]),
   ]),run('spriteslice',i,add(j,1),h,k),
  ]),
 ],['x','col'],'깊이 버퍼로 몬스터의 가려진 부분 제거'),
 vf('spritesort',['sortpass'],(pass,L)=>[
  if_(lt(pass,ENTITIES),[
   s('sortId',0),s('sortDepth',.14),
   ...Array.from({length:ENTITIES},(_,j)=>j+1).map(i=>if_(both(eq(at('drawn',i),0),gt(at('ez',i),v('sortDepth'))),[s('sortDepth',at('ez',i)),s('sortId',i)])),
   if_(gt(v('sortId'),0),[
    put('drawn',v('sortId'),1),L.set('k',at('kind',v('sortId'))),L.set('h',div(300,v('sortDepth'))),
    if_(eq(L.get('k'),3),[L.set('h',mul(L.get('h'),1.45))]),
    if_(both(le(L.get('k'),3),either(gt(at('flash',v('sortId')),0),both(gt(at('wind',v('sortId')),0),eq(mod(v('frames'),6),0)))),[L.set('k',add(L.get('k'),3))]),
    if_(lt(abs(div(at('sx',v('sortId')),v('sortDepth'))),1.4),[run('spriteslice',v('sortId'),0,L.get('h'),L.get('k'))]),
    run('spritesort',add(pass,1)),
   ]),
  ]),
 ],['h','k'],'먼 적부터 그리는 거리 정렬'),
 vf('render',[],()=>[
  eraseAll(),show(),stopDraw(),setThickness(.65),setColor('#3a4a50'),
  ...Array.from({length:13},(_,i)=>i-6).flatMap(n=>[
   run('floorline',add(floor(v('px')),n),sub(floor(v('py')),7),add(floor(v('px')),n),add(floor(v('py')),7)),
   run('floorline',sub(floor(v('px')),7),add(floor(v('py')),n),add(floor(v('px')),7),add(floor(v('py')),n)),
  ]),run('walls',0),hide(),
  s('wallX',v('px')),s('wallY',v('py')),s('wallAngle',v('angle')),s('wallFloor',v('floor')),s('wallCols',v('cols')),
 ],[],'카메라가 변할 때 벽과 바닥 다시 그리기'),
 vf('rendersprites',[],()=>[
  eraseAll(),show(),run('projectsprites',1),run('spritesort',0),hide(),s('spriteFrame',v('frames')),
 ],[],'벽과 독립적으로 움직이는 3D 오브젝트'),
 vf('mapdrawrow',['mdr'],y=>[
  ...Array.from({length:SIZE},(_,x)=>if_(eq(at('map',idxy(x,y)),1),[
   stopDraw(),locateXY(174+x*2,sub(98,mul(y,2))),startDraw(),locateXY(175+x*2,sub(98,mul(y,2))),stopDraw(),
  ])),if_(lt(y,18),[run('mapdrawrow',add(y,1))]),
 ],[],'미니맵 벽 표시'),
 vf('drawmap',[],()=>[
  eraseAll(),hide(),
  if_(both(eq(v('minimap'),1),either(eq(v('state'),1),eq(v('state'),5))),[
   ...line(170,80,215,80,'#09151e',44),setColor('#547077'),setThickness(1.8),run('mapdrawrow',0),
   ...Array.from({length:ENEMIES},(_,j)=>j+1).map(i=>if_(gt(at('ehp',i),0),[
    ...line(add(173,mul(at('ex',i),2)),sub(99,mul(at('ey',i),2)),add(173.2,mul(at('ex',i),2)),sub(99,mul(at('ey',i),2)),'#ef957d',2.3),
   ])),
   ...line(204,68,205,68,'#e3c68e',2.8),
   ...line(add(173,mul(v('px'),2)),sub(99,mul(v('py'),2)),sum(173,mul(v('px'),2),mul(v('vx'),3)),sub(sub(99,mul(v('py'),2)),mul(v('vy'),3)),'#76ffda',1.8),
  ]),
 ],[],'벽 적 균열과 플레이어 미니맵'),
);

const edge=(code,prev,body)=>if_(both(isPressed(code),eq(v(prev),0)),body);
const keys=[[13,'prevEnter'],[80,'prevP'],[82,'prevR'],[77,'prevM'],[78,'prevN'],[70,'prevF'],[81,'prevQ'],[16,'prevShift'],[49,'prev1'],[50,'prev2'],[51,'prev3']];
const mainLoop=[
 s('now',timer.value()),s('dt',max(.001,min(.12,sub(v('now'),v('lastTime'))))),s('lastTime',v('now')),
 edge(13,'prevEnter',[if_(eq(v('state'),0),[s('state',1),s('invuln',1.8)])]),
 edge(80,'prevP',[if_(eq(v('state'),1),[s('state',5)],[if_(eq(v('state'),5),[s('state',1)])])]),
 edge(82,'prevR',[if_(either(eq(v('state'),3),eq(v('state'),4),eq(v('state'),5)),[run('newgame')])]),
 edge(77,'prevM',[s('minimap',sub(1,v('minimap')))]),edge(78,'prevN',[
  s('muted',sub(1,v('muted'))),{type:'sound_volume_set',params:[mul(sub(1,v('muted')),65),null]},
 ]),
 edge(70,'prevF',[if_(eq(v('cols'),60),[s('cols',80),s('strip',6)],[if_(eq(v('cols'),80),[s('cols',40),s('strip',12)],[s('cols',60),s('strip',8)])])]),
 if_(eq(v('state'),2),[
  edge(49,'prev1',[run('choose',v('choice1'))]),edge(50,'prev2',[run('choose',v('choice2'))]),edge(51,'prev3',[run('choose',v('choice3'))]),
 ]),
 if_(eq(v('state'),1),[
  inc('elapsed',v('dt')),s('danger',0),
  ...['shootCd','recoil','invuln','hurt','pulse','dashCd','dashTime','alertTime','hitmarker'].map(id=>s(id,max(0,sub(v(id),v('dt'))))),
  s('mana',min(100,add(v('mana'),mul(v('dt'),8)))),
  if_(either(isPressed(37),isPressed(74)),[inc('angle',mul(v('dt'),-112))]),
  if_(either(isPressed(39),isPressed(76)),[inc('angle',mul(v('dt'),112))]),
  s('angle',mod(v('angle'),360)),s('vx',cos(v('angle'))),s('vy',sin(v('angle'))),
  edge(16,'prevShift',[if_(le(v('dashCd'),0),[s('dashTime',.18),s('dashCd',v('dashPeriod')),s('invuln',.3)])]),
  run('moveplayer'),
  edge(81,'prevQ',[if_(ge(v('mana'),70),[inc('mana',-70),s('pulse',.35),sound('nova'),run('novahit',1)])]),
  if_(both(eq(v('state'),1),le(v('shootCd'),0),either(isPressed(32),{type:'is_clicked',params:[null]})),[run('fire')]),
  if_(eq(v('state'),1),[run('enemy',1),run('navigation')]),
  if_(both(eq(v('state'),1),eq(v('left'),0),lt(abs(sub(v('px'),15.5)),1.2),lt(abs(sub(v('py'),15.5)),1.2),isPressed(69)),[
   if_(lt(v('floor'),3),[inc('floor',1),run('newfloor'),run('offer')]),
  ]),
 ]),
 if_(either(eq(v('state'),0),eq(v('state'),1)),[
  if_(either(cmp(v('wallX'),'!=',v('px')),cmp(v('wallY'),'!=',v('py')),cmp(v('wallAngle'),'!=',v('angle')),cmp(v('wallFloor'),'!=',v('floor')),cmp(v('wallCols'),'!=',v('cols'))),[run('render')]),
 ]),
 if_(gt(v('score'),v('best')),[s('best',v('score'))]),
 ...keys.map(([code,id])=>if_(isPressed(code),[s(id,1)],[s(id,0)])),inc('frames',1),
];
const visibleWhen=cond=>[if_(cond,[show()],[hide()])];
const sprite=(id,name,picture,cond,entity={})=>obj(id,name,{scene:'keep',picture,entity:{x:0,y:0,scaleX:1,scaleY:1,visible:false,...entity},threads:[[when.run(),repeat.inf(visibleWhen(cond))]]});
const textbox=(id,x,y,w,h,size,color,text,body=[],align=0)=>obj(id,id,{
 scene:'keep',objectType:'textBox',text,
 entity:{x,y,scaleX:1,scaleY:1,width:w,height:h,textAlign:align,lineBreak:true,font:`${size}px Malgun Gothic`,bgColor:'transparent',colour:color,visible:true},
 threads:body.length?[[when.run(),repeat.inf(body)]]:[],
});
const cached=(cache,expr)=>[if_(cmp(v(cache),'!=',expr),[s(cache,expr),writeText(v(cache))])];
const playing=either(eq(v('state'),1),eq(v('state'),5));
const game=obj('engine','01 · 블록 3D 엔진 / 던전 · 전투 · 렌더링',{
 scene:'keep',pictures:art.wallPictures(),entity:{x:0,y:0,scaleX:1,scaleY:1,visible:false},
 threads:[[when.run(),timer.reset(),timer.start(),s('frames',0),s('cols',60),s('strip',8),s('minimap',1),s('muted',0),{type:'sound_volume_set',params:[65,null]},run('newgame'),s('state',0),repeat.inf(mainLoop)]],
});
game.sounds=['shot','kill','hurt','pickup','nova','relic','victory'].map(name=>({id:name,name,path:path.join(dir,'audio',name+'.wav'),duration:({shot:.18,kill:.25,hurt:.25,pickup:.35,nova:.6,relic:.7,victory:2.2})[name]}));
const objects=[
 obj('background','어둠과 바닥 안개',{scene:'keep',picture:art.background,entity:{x:0,y:0,scaleX:1,scaleY:1},threads:[]}),
 game,
 obj('monsters','02 · 깊이 버퍼로 그리는 적과 아이템',{scene:'keep',pictures:art.spritePictures(),entity:{x:0,y:0,scaleX:1,scaleY:1,visible:false},
  threads:[[when.run(),repeat.inf([
   if_(both(either(eq(v('state'),0),eq(v('state'),1)),cmp(v('spriteFrame'),'!=',v('frames'))),[run('rendersprites')]),
  ])]]}),
 obj('vignette','주변부의 어둠',{scene:'keep',picture:art.vignette,entity:{x:0,y:0,scaleX:1,scaleY:1},threads:[]}),
 obj('weapon','룬 캐스터',{scene:'keep',pictures:[{...art.weapon(false),name:'idle'},{...art.weapon(true),name:'fire'}],entity:{x:103,y:-57,scaleX:1,scaleY:1},
  threads:[[when.run(),repeat.inf([
   ...visibleWhen(playing),
   if_(gt(v('recoil'),.08),[changeShape('fire')],[changeShape('idle')]),
   locateXY(add(103,mul(sin(mul(v('elapsed'),240)),1.1)),sub(-57,mul(v('recoil'),40))),
  ])]]}),
 sprite('hurtfx','피격 비네트',art.hurt,both(eq(v('state'),1),gt(v('hurt'),0))),
 sprite('novafx','충격파',art.nova,both(eq(v('state'),1),gt(v('pulse'),0))),
 sprite('hud','전투 화면',art.hud,playing),
 obj('bars','체력 마력 막대',{scene:'keep',picture:art.svg(1,1,'<rect width="1" height="1" fill="#fff"/>'),entity:{x:0,y:0,scaleX:1,scaleY:1,visible:false},
  threads:[[when.run(),hide(),repeat.inf([
   eraseAll(),if_(playing,[
    ...line(-221,-117,-97,-117,'#352d36',5),...line(-221,-117,add(-221,mul(124,div(v('hp'),v('maxhp')))),-117,'#d9a78d',5),
    ...line(-65,-117,47,-117,'#20343d',5),...line(-65,-117,add(-65,mul(112,div(v('mana'),100))),-117,'#70cdbd',5),
    if_(gt(v('hitmarker'),0),[
     ...line(-4,9,4,1,'#ffe9b2',1.5),...line(-4,1,4,9,'#ffe9b2',1.5),
    ]),
   ]),
  ])]]}),
 textbox('health',-93,-101,44,12,8,'#e2c7b0','',[
  ...visibleWhen(playing),...cached('healthShown',join(floor(v('hp')),txt('/'),v('maxhp'))),
 ]),
 textbox('mana',56,-101,35,12,8,'#96d1c1','',[
  ...visibleWhen(playing),...cached('manaShown',floor(v('mana'))),
 ]),
 textbox('objective',-1,118,173,16,8,'#c3cfcb','',[
  ...visibleWhen(playing),...cached('objectiveShown',join(v('floor'),txt('층  '),at('floorNames',v('floor')),txt('  /  '),v('left'),txt(' 남음'))),
 ]),
 textbox('score',190,118,90,15,8,'#baa783','',[
  ...visibleWhen(playing),...cached('scoreShown',join(txt('SOUL '),v('score'),txt('  /  '),v('cols'))),
 ]),
 textbox('status',0,-80,450,17,8,'#e3ccb0','',[
  ...visibleWhen(playing),
  if_(gt(v('danger'),0),cached('statusShown',txt('공격 예고!  옆으로 이동하거나 SHIFT로 회피')),[
   if_(eq(v('left'),0),cached('statusShown',txt('균열이 열렸다  ·  지도에서 금색 표식을 찾아 E')),[
    if_(gt(v('alertTime'),0),cached('statusShown',txt('WASD 이동  ·  ← → 회전  ·  SPACE 발사  ·  Q 충격파')),
     cached('statusShown',join(txt('다음 유물까지  '),sub(v('nextRelic'),v('kills')),txt(' 처치    ·    강화 '),v('relics'),txt('개')))),
   ]),
  ]),
 ]),
 textbox('boss',0,96,245,14,9,'#e4a48b','',[
  if_(both(playing,eq(v('floor'),3)),[
   ...visibleWhen(gt(at('ehp',9),0)),if_(eq(v('bossPhase'),0),
    cached('bossShown',join(txt('왕관을 삼킨 자   '),max(0,floor(at('ehp',9))),txt(' / 360'))),
    cached('bossShown',join(txt('광폭한 왕관   '),max(0,floor(at('ehp',9))),txt(' / 360')))),
  ],[hide()]),
 ]),
 obj('minimap','던전 지도',{scene:'keep',picture:art.svg(1,1,'<rect width="1" height="1" fill="#fff"/>'),entity:{x:0,y:0,scaleX:1,scaleY:1,visible:false},
  threads:[[when.run(),hide(),repeat.inf([if_(eq(mod(v('frames'),8),0),[run('drawmap')])])]]}),
 sprite('title','심연의 성채 · 시작',art.title,eq(v('state'),0)),
 sprite('relicpanel','유물 선택',art.cardPanel,eq(v('state'),2)),
 ...[1,2,3].flatMap((n)=>{
  const x=-154+(n-1)*154;
  const card=obj('card'+n,'유물 '+n+' 선택',{scene:'keep',picture:art.relicCard(n),entity:{x,y:-29.5,scaleX:1,scaleY:1,visible:false},
   threads:[[when.run(),repeat.inf(visibleWhen(eq(v('state'),2)))],[when.objectClick(),run('choose',v('choice'+n))]]});
  const label=textbox('cardtext'+n,x,-59,133,53,10,'#dcd3bc','',[
   if_(eq(v('state'),2),[show(),...cached('choiceShown'+n,join(at('relicNames',v('choice'+n)),txt('\n\n'),at('relicDesc',v('choice'+n))))],[hide()]),
  ]);label.script.push([when.objectClick(),run('choose',v('choice'+n))]);return[card,label];
 }),
 sprite('endveil','결과와 일시정지',art.veil,either(eq(v('state'),3),eq(v('state'),4),eq(v('state'),5))),
 textbox('endtext',0,0,420,115,16,'#eaddc2','',[
  if_(eq(v('state'),5),[show(),...cached('overlayShown',txt('잠시 숨을 고르다\n\nP 계속   /   R 새 원정\nN 소리 켜기·끄기'))],[
   if_(eq(v('state'),3),[show(),...cached('overlayShown',join(txt('심연에 삼켜졌다\n\n'),v('floor'),txt('층  ·  '),v('kills'),txt('처치  ·  '),v('score'),txt('점\nR  새로운 원정')))],
    [if_(eq(v('state'),4),[show(),...cached('overlayShown',join(txt('왕관은 이제 당신의 것\n\n'),v('score'),txt('점  ·  '),floor(v('elapsed')),txt('초  ·  유물 '),v('relics'),txt('개\nR  다시 심연으로')))], [hide()])]),
  ]),
 ]),
];
const music=obj('music','직접 합성한 성채의 음악',{scene:'keep',entity:{x:0,y:0,scaleX:1,scaleY:1,visible:false},
 threads:[[when.run(),hide(),repeat.inf([{type:'sound_something_wait_with_block',params:[txt('ambient'),null]}])]]});
music.sounds=[{id:'ambient',name:'ambient',path:path.join(dir,'audio/ambient.wav'),duration:24}];objects.push(music);
export default {name:'심연의 성채 · ABYSSAL KEEP',speed:60,scenes:[scene('keep','심연의 성채')],variables,lists,functions,objects:objects.reverse()};
