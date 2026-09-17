#!/usr/bin/env node
// Official browser distributions, pinned by commit AND content hash.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const AUDIO_VENDOR_FILES=[
    {name:'preloadjs-0.6.0.min.js',repo:'PreloadJS',commit:'ba52a4d4a1308962107cb1acd144bd28735637da',sha256:'671d2d4201bf3fe25c22d343ea377ed88c0646b2bb8bb490e1ce6aa6143426b9'},
    {name:'soundjs-0.6.0.min.js',repo:'SoundJS',commit:'093c91fc1dc78dd85dd103467e280f01034a177b',sha256:'09c0c658a5d0a5fe8db0ba8f2e55513bd9a7f8525e678ca344430521e8559ca6'},
    {name:'flashaudioplugin-0.6.0.min.js',repo:'SoundJS',commit:'093c91fc1dc78dd85dd103467e280f01034a177b',sha256:'2f0325655de628188e6b5bb62b5f9b15e3b1b67b3ccd23d028c58d51679a9194'},
];
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
async function validFile(file,item){
    try {const bytes=await fs.readFile(file);return digest(bytes)===item.sha256?bytes:null;}
    catch(e){if(e.code==='ENOENT')return null;throw e;}
}
export async function verifyAudioVendors(vendorDir=path.join(root,'public/lib/vendor')) {
    for(const item of AUDIO_VENDOR_FILES){
        if(!await validFile(path.join(vendorDir,item.name),item))throw new Error(`Audio vendor missing or mismatched: ${item.name}. Run node scripts/setup-audio.mjs`);
    }
    return {note:'PreloadJS + SoundJS 0.6.0, SHA-256 verified'};
}
export async function installAudioVendors({vendorDir=path.join(root,'public/lib/vendor'),cacheDir=path.join(root,'.setup-cache/audio')}={}){
    await fs.mkdir(vendorDir,{recursive:true});await fs.mkdir(cacheDir,{recursive:true});
    const pending=[];
    for(const item of AUDIO_VENDOR_FILES){
        if(await validFile(path.join(vendorDir,item.name),item))continue;
        const cache=path.join(cacheDir,item.name);
        let bytes=await validFile(cache,item);
        if(!bytes){
            const url=`https://raw.githubusercontent.com/CreateJS/${item.repo}/${item.commit}/lib/${item.name}`;
            const response=await fetch(url,{signal:AbortSignal.timeout(30000)});
            if(!response.ok)throw new Error(`HTTP ${response.status}: ${url}`);
            bytes=Buffer.from(await response.arrayBuffer());
            if(digest(bytes)!==item.sha256)throw new Error(`Audio download checksum mismatch: ${item.name}`);
            await fs.writeFile(cache,bytes);
        }
        pending.push({item,bytes});
    }
    // Acquire and validate the whole set before replacing any installed file.
    for(const {item,bytes} of pending)await fs.writeFile(path.join(vendorDir,item.name),bytes);
    return verifyAudioVendors(vendorDir);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
    installAudioVendors().then(result=>console.log(result.note)).catch(e=>{console.error(e.message);process.exitCode=1;});
}
