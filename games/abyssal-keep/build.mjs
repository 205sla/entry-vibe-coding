import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const dir=path.dirname(fileURLToPath(import.meta.url));
fs.mkdirSync(path.join(dir,'audio'),{recursive:true});
// Original synthesized effects, mono PCM. SoundJS supports the bundled WAVs.
const durations={shot:.18,kill:.25,hurt:.25,pickup:.35,nova:.6,relic:.7,victory:2.2,ambient:24};
for(const [name,duration] of Object.entries(durations)){
 const rate=22050,n=Math.round(rate*duration),buf=Buffer.alloc(44+n*2);
 buf.write('RIFF');buf.writeUInt32LE(36+n*2,4);buf.write('WAVEfmt ',8);buf.writeUInt32LE(16,16);buf.writeUInt16LE(1,20);buf.writeUInt16LE(1,22);buf.writeUInt32LE(rate,24);buf.writeUInt32LE(rate*2,28);buf.writeUInt16LE(2,32);buf.writeUInt16LE(16,34);buf.write('data',36);buf.writeUInt32LE(n*2,40);
 let seed=713;for(let i=0;i<n;i++){
  const t=i/rate,p=t/duration;seed=(Math.imul(seed,1664525)+1013904223)|0;const noise=seed/2147483648;
  let value=0;
  if(name==='shot')value=(Math.sin(2*Math.PI*(450*t-600*t*t))*.5+noise*.45)*Math.exp(-p*8);
  if(name==='kill')value=(Math.sin(2*Math.PI*(180*t-140*t*t))*.5+noise*.3)*Math.exp(-p*5);
  if(name==='hurt')value=(noise*.6+Math.sin(t*520)*.4)*Math.exp(-p*7);
  if(name==='nova')value=(noise*.4+Math.sin(2*Math.PI*(95*t-35*t*t))*.5)*Math.exp(-p*5);
  if(name==='pickup'||name==='relic'){
   const notes=name==='pickup'?[659,988]:[392,494,587,784];const ix=Math.min(notes.length-1,Math.floor(p*notes.length));
   value=(Math.sin(t*2*Math.PI*notes[ix])+.2*Math.sin(t*4*Math.PI*notes[ix]))*.36*Math.sin(Math.PI*(p*notes.length%1));
  }
  if(name==='victory')value=[196,293.66,392,493.88].reduce((a,f)=>a+Math.sin(t*2*Math.PI*f),0)*.12*Math.min(1,t*15)*Math.exp(-p*2);
  if(name==='ambient'){
   const chords=[[98,146.832,196],[87.307,130.813,174.614],[82.407,123.471,164.814],[73.416,110,146.832]];
   const chord=chords[Math.min(3,Math.floor(t/6))],beat=t%1.5;
   value=chord.reduce((a,f)=>a+Math.sin(t*2*Math.PI*f)+.25*Math.sin(t*2*Math.PI*f*1.003),0)*.035;
   value+=Math.sin(t*2*Math.PI*chord[Math.floor(t/.75)%3]*2)*.025*Math.exp(-(t%.75)*6);
   value+=Math.sin(t*2*Math.PI*49)*.07*Math.exp(-beat*12);
   value*=Math.min(1,t*3,(duration-t)*3);
  }
  buf.writeInt16LE(Math.round(Math.max(-1,Math.min(1,value*.46))*32767),44+i*2);
 }
 fs.writeFileSync(path.join(dir,'audio',name+'.wav'),buf);
}
const existing=fs.readdirSync(dir).filter(n=>/^abyssal-keep_\d+\.ent$/.test(n));
const version=1+Math.max(0,...existing.map(n=>+n.match(/_(\d+)/)[1]));
const outfile=path.join(dir,`abyssal-keep_${String(version).padStart(3,'0')}.ent`);
const result=spawnSync(process.execPath,['tools/make-ent.mjs',path.join(dir,'spec.mjs'),'--out',outfile],{cwd:path.resolve(dir,'../..'),stdio:'inherit'});
if(result.status!==0)process.exit(result.status||1);
console.log(outfile);
