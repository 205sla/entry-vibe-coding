const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');

test('audio setup rejects corrupt cache/download without replacing installed files',async()=>{
 const {AUDIO_VENDOR_FILES,installAudioVendors,verifyAudioVendors}=await import('../scripts/setup-audio.mjs');
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'entry-audio-vendor-test-'));
 const vendorDir=path.join(temp,'vendor'),cacheDir=path.join(temp,'cache');
 await fs.mkdir(vendorDir);await fs.mkdir(cacheDir);
 const originalFetch=global.fetch;
 try{
  for(const item of AUDIO_VENDOR_FILES){
   await fs.writeFile(path.join(vendorDir,item.name),'old incompatible vendor');
   await fs.writeFile(path.join(cacheDir,item.name),'corrupt cached vendor');
  }
  await assert.rejects(verifyAudioVendors(vendorDir),/missing or mismatched/);
  global.fetch=async()=>new Response('corrupt download',{status:200});
  await assert.rejects(installAudioVendors({vendorDir,cacheDir}),/checksum mismatch/);
  for(const item of AUDIO_VENDOR_FILES)assert.equal(await fs.readFile(path.join(vendorDir,item.name),'utf8'),'old incompatible vendor');
 }finally{
  global.fetch=originalFetch;
  // Only the exact directory created by mkdtemp above is removed.
  await fs.rm(temp,{recursive:true,force:true});
 }
});
