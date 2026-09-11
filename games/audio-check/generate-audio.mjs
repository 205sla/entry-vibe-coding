// Original deterministic test tones. No sound from the reference project is reused.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
const dir=path.dirname(fileURLToPath(import.meta.url));
const output=path.join(dir,'audio');fs.mkdirSync(output,{recursive:true});
const rate=22050,duration=1.6,count=Math.round(rate*duration),data=Buffer.alloc(44+count*2);
data.write('RIFF');data.writeUInt32LE(data.length-8,4);data.write('WAVEfmt ',8);
data.writeUInt32LE(16,16);data.writeUInt16LE(1,20);data.writeUInt16LE(1,22);
data.writeUInt32LE(rate,24);data.writeUInt32LE(rate*2,28);data.writeUInt16LE(2,32);data.writeUInt16LE(16,34);
data.write('data',36);data.writeUInt32LE(count*2,40);
for(let i=0;i<count;i++){
 const t=i/rate,local=t%0.4,frequency=[440,554.365,659.255,880][Math.min(3,Math.floor(t/0.4))];
 const envelope=Math.min(1,local/0.02,(0.4-local)/0.05);
 data.writeInt16LE(Math.round(0.32*envelope*Math.sin(2*Math.PI*frequency*t)*32767),44+i*2);
}
fs.writeFileSync(path.join(output,'tone.wav'),data);
const encoder=process.env.FFMPEG_PATH||'ffmpeg';
execFileSync(encoder,['-hide_banner','-loglevel','error','-y','-i',path.join(output,'tone.wav'),'-codec:a','libmp3lame','-b:a','96k',path.join(output,'tone.mp3')],{stdio:'inherit',windowsHide:true});
console.log('Generated original 1.6-second WAV and MP3 test tones.');
