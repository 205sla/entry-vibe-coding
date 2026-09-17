import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {obj,scene,when,txt,setVar,writeText,wait} from '../../tools/lib/spec-dsl.mjs';
const dir=path.dirname(fileURLToPath(import.meta.url));
const volume=n=>({type:'sound_volume_set',params:[n,null]});
const play=name=>({type:'sound_something_wait_with_block',params:[txt(name),null]});
const box=(id,text,x,y,w,h,size,colour,bgColor='#101e35',threads=[])=>obj(id,text,{objectType:'textBox',text,scene:'audio',entity:{x,y,width:w,height:h,scaleX:1,scaleY:1,regX:0,regY:0,textAlign:0,font:`${size}px Malgun Gothic`,fontSize:size,colour,bgColor,visible:true,lineBreak:true},threads});
const sequence=(kind,level=60)=>[
 setVar('phase',kind),volume(level),writeText(kind==='mute'?'음소거 · 소리가 없어야 합니다':`${kind.toUpperCase()} · 네 음 재생 중`),
 play(kind==='mp3'?'tone-mp3':'tone-wav'),wait(0.15),volume(60),setVar('phase','idle'),writeText('숫자 1 · WAV     숫자 2 · MP3     숫자 3 · 음소거'),
];
const controller=box('control','시작 버튼을 누른 뒤 숫자 1, 2, 3을 누르세요',0,8,450,90,19,'#e4f1ff','#182d48',[
 [when.run(),volume(60),setVar('phase','idle'),writeText('숫자 1 · WAV     숫자 2 · MP3     숫자 3 · 음소거')],
 [when.keyPressed(49),...sequence('wav')],
 [when.keyPressed(50),...sequence('mp3')],
 [when.keyPressed(51),...sequence('mute',0)],
]);
controller.sounds=[{id:'wav1',name:'tone-wav',path:path.join(dir,'audio/tone.wav'),duration:1.6},{id:'mp31',name:'tone-mp3',path:path.join(dir,'audio/tone.mp3'),duration:1.6}];
export default {
 name:'소리 검증실 · WAV & MP3',scenes:[scene('audio','소리 검증')],
 variables:[{id:'phase',name:'phase',value:'idle',visible:false}],
 objects:[
  box('title','소리 검증실',0,98,450,42,30,'#7dd3fc'),
  controller,
  box('guide','1과 2에서 같은 네 음이 들리고\n3에서는 아무 소리도 나지 않으면 정상입니다.',0,-76,450,56,16,'#b8c8df'),
  box('background',' ',0,0,480,270,16,'#fff','#101e35'),
 ],
};
