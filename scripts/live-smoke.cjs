'use strict';
// Opt-in hardware verification. Starts only Duo-owned engines and plays a short duet.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {_electron}=require('playwright');
const {selectProfile,validateWav}=require('../src/voice/voice-service');
const root=path.resolve(__dirname,'..');
async function inputReference(appRoot,actor='vivi'){
 const voiceRoot=await fs.realpath(path.join(appRoot,'assets/voice'));
 const registry=JSON.parse(await fs.readFile(path.join(voiceRoot,'profiles.json'),'utf8'));
 const id=selectProfile(actor),selected=registry.schemaVersion===1&&registry.profiles?.[id];
 assert.equal(typeof selected?.file,'string',`Missing selected reference: ${id}`);
 const file=await fs.realpath(path.resolve(voiceRoot,selected.file)),relative=path.relative(voiceRoot,file);
 assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative),'Reference must stay inside assets/voice');
 const stat=await fs.stat(file);assert.ok(stat.isFile()&&stat.size<=20*1024*1024,'Reference must be a WAV smaller than 20 MiB');
 const bytes=await fs.readFile(file);validateWav(bytes);return {bytes,profile:id,file:relative};
}
async function until(read,accept,label,timeout=180000){let last;const end=Date.now()+timeout;let tick=0;do{last=await read();if(accept(last))return last;if(tick++%15===0)console.log(label+'…');await new Promise(r=>setTimeout(r,1000));}while(Date.now()<end);throw Error(label+' timed out: '+JSON.stringify(last));}
function inputWav(bytes){
 let fmt,data;for(let p=12;p+8<=bytes.length;){const size=bytes.readUInt32LE(p+4),tag=bytes.toString('ascii',p,p+4);if(tag==='fmt ')fmt={channels:bytes.readUInt16LE(p+10),rate:bytes.readUInt32LE(p+12),bits:bytes.readUInt16LE(p+22)};if(tag==='data')data=bytes.subarray(p+8,p+8+size);p+=8+size+(size%2);}
 assert.equal(fmt.bits,16);const frames=Math.min(Math.floor(data.length/(fmt.channels*2)),fmt.rate*8),out=Buffer.alloc(Math.floor(frames*16000/fmt.rate)*2);
 for(let n=0;n<out.length/2;n++){let sum=0;const at=Math.floor(n*fmt.rate/16000);for(let c=0;c<fmt.channels;c++)sum+=data.readInt16LE((at*fmt.channels+c)*2);out.writeInt16LE(Math.round(sum/fmt.channels),n*2);}
 return require('../src/voice/pcm-wav').wav(out,16000).toString('base64');
}
async function run(){
 const output=path.join(root,'artifacts','live-smoke-'+randomUUID());await fs.mkdir(output,{recursive:true});
 const env={...process.env,DUO_VOICE_DATA_ROOT:path.join(output,'data'),DUO_VOICE_SESSION_ROOT:path.join(output,'sessions')};delete env.ELECTRON_RUN_AS_NODE;
 const errors=[];let app,page;const report={passed:false,output,checks:[]};
 try{
  app=await _electron.launch({executablePath:require('electron'),cwd:root,args:['.'],env,timeout:30000});page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.stack));
  await page.waitForFunction(()=>document.querySelector('.hands-free-button'));
  await page.locator('#titlebar-engines').click();await page.locator('#engine-model-load').click();
  const model=await until(()=>page.evaluate(()=>window.discussion.localLlamaStatus()),s=>s.ok&&!!s.loaded,'Load Gemma');
  assert.equal(model.owned,true);report.model={pid:model.loaded.pid,model:model.model,baseURL:model.baseURL};report.checks.push('owned Gemma model and audio projector loaded');
  await page.locator('#engine-voice-start').click();
  const voice=await until(()=>page.evaluate(()=>window.discussion.voiceStatus()),s=>s.connected&&!s.starting,'Start Duo voice');
  assert.equal(voice.owned,true);assert.equal(voice.health.service,'duo-voice-harness-voice');report.voice={baseURL:voice.baseURL,service:voice.health.service,dataRoot:voice.health.data_root};
  await page.locator('#engine-voice-warmup').click();await until(()=>page.evaluate(()=>window.discussion.voiceStatus()),s=>s.loaded&&!s.warming,'Warm VoxCPM2',240000);report.checks.push('owned VoxCPM2 backend warmed');
  await page.locator('#engines-close').click();
  await page.evaluate(()=>{document.querySelector('#turns').value='2';document.querySelector('#text-pace').value='0';});
  await page.locator('#src-input').fill('Momotamu and Vivi: each introduce yourself in one short English sentence. This is an audio test.');await page.locator('#btn-run').click();
  await until(()=>page.locator('#session-status').textContent(),s=>s.includes('3 turns saved'),'Real duet');
  await until(()=>page.locator('#btn-run').isDisabled(),v=>!v,'Playback settled');
  report.status=await page.locator('#status').textContent();assert.doesNotMatch(report.status,/unavailable|failed|stopped:/i);
  report.transcript=await page.locator('#log').innerText();assert.equal(await page.locator('#log .msg.vivi').count(),1);assert.equal(await page.locator('#log .msg.momotamu').count(),1);
  report.checks.push('real typed duet with both voices and completed playback');
  await page.screenshot({path:path.join(output,'conversation.png')});
  // Known local reference through the real input IPC, 16 kHz packing and native Gemma transcription.
  const reference=await inputReference(root);report.inputReference={profile:reference.profile,file:reference.file};
  const data=inputWav(reference.bytes);
  const input=await page.evaluate(async data=>{const b=window.discussion;const started=await b.inputBegin('dictation');if(!started.ok)return started;const chunk=await b.inputChunk({id:started.id,sequence:0,data});if(!chunk.ok)return chunk;return b.inputFinish(started.id);},data);
  assert.equal(input.ok,true,input.error);assert.ok(input.text.trim());report.inputTranscript=input.text;report.checks.push('real native audio-input transcription from a known local WAV');
  assert.deepEqual(errors,[]);report.passed=true;
 }catch(error){report.error=error.stack;report.rendererErrors=errors;if(page)await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});throw error;
 }finally{
  await app?.close();
  if(report.model){try{process.kill(report.model.pid,0);report.modelExited=false;}catch{report.modelExited=true;}}
  await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(path.join(output,'report.json'));
 }
 assert.equal(report.modelExited,true,'The owned model process must exit when Duo closes');
 console.log('LIVE SMOKE PASS');
}
if(require.main===module)run().catch(e=>{console.error(e);process.exitCode=1;});
module.exports={inputReference,inputWav};
