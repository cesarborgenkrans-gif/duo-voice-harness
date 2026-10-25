// Serialize app GPU allocations, measure global memory, and leave room for voice and the desktop.
'use strict';
const {execFile}=require('node:child_process'),path=require('node:path');
const GiB=1024**3;
function createGpuBudget({root,readImpl,voiceStatus=async()=>({}),marginGiB=1,voiceGiB=7}={}){
 let lease=null,last=null,reading=null;
 async function performRead(){try{const data=readImpl?await readImpl():await new Promise((resolve,reject)=>execFile('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(root,'scripts','gpu-memory.ps1')],{windowsHide:true,timeout:12000,maxBuffer:50000},(e,out)=>{if(e)return reject(e);try{resolve(JSON.parse(out.replace(/^\uFEFF/,'')));}catch(e){reject(e);}}));const gpu=(data.adapters||[]).sort((a,b)=>b.totalBytes-a.totalBytes)[0];if(!data.available||!gpu||![gpu.totalBytes,gpu.freeBytes,gpu.usedBytes].every(Number.isFinite)||gpu.totalBytes<=0||gpu.freeBytes<0||gpu.freeBytes>gpu.totalBytes)throw Error('GPU telemetry is unavailable.');last={...data,at:new Date().toISOString(),gpu,marginGiB,voiceGiB,lease};return last;}catch(e){return last={available:false,reason:e.message,at:new Date().toISOString(),lease};}}
 async function read({fresh=false}={}){if(reading)return reading;if(!fresh&&last?.available&&Date.now()-Date.parse(last.at)<1500)return {...last,lease};reading=performRead();try{return await reading;}finally{reading=null;}}
 async function check({kind='inference',modelBytes=0,projectorBytes=0,config={},voiceLoaded=false,reserveLocalVoice=true}={}){
  const data=await read({fresh:kind!=='inference'&&!(kind==='voice'&&voiceLoaded)});if(!data.available)throw Error('GPU safety check unavailable. Refresh GPU status before a new GPU load. '+data.reason);
  // This is deliberately a budget, not a claim of exact model VRAM. Capacity,
  // projector workspace and physical batch all affect the conservative allowance.
  const capacity=(config.context||12288)/12288,batch=(config.ubatchSize||512)/512;
  let allocationGiB=kind==='model'?(modelBytes+projectorBytes)/GiB+Math.max(3,capacity*2+batch):kind==='voice'?(voiceLoaded?0:voiceGiB):0;
  const reserveVoice=kind==='model'&&reserveLocalVoice&&!voiceLoaded?voiceGiB:0,requiredGiB=allocationGiB+marginGiB+reserveVoice;
  if(data.gpu.freeBytes/GiB<requiredGiB)throw Error('GPU load paused: '+(data.gpu.freeBytes/GiB).toFixed(1)+' GiB free; '+requiredGiB.toFixed(1)+' GiB budget needed ('+kind+', voice and desktop headroom). Stop another GPU task or release Gemma, then retry.');
  return {...data,allocationGiB,reserveVoiceGiB:reserveVoice,requiredGiB};
 }
 async function run(kind,fn){if(lease)throw Error('GPU allocation already in progress: '+lease+'. Wait before another load.');lease=kind;try{return await fn();}finally{lease=null;}}
 async function beforeModel(opts){const status=opts?.reserveLocalVoice===false?{}:await voiceStatus();return check({...opts,kind:'model',voiceLoaded:status.connected&&status.loaded});}
 async function beforeVoice(){const status=await voiceStatus();return check({kind:'voice',voiceLoaded:status.connected&&status.loaded});}
 async function waitForRelease(before,{timeoutMs=10000}={}){if(!before?.available)return read();const deadline=Date.now()+timeoutMs;let data;do{data=await read();if(data.available&&data.gpu.usedBytes<=before.gpu.usedBytes-GiB*.25)return {...data,released:true};await new Promise(r=>setTimeout(r,400));}while(Date.now()<deadline);return {...data,released:false,note:'Owned process exited; global memory may include other applications. Check free memory before the next load.'};}
 return {read,check,run,beforeModel,beforeVoice,waitForRelease,get busy(){return !!lease;}};
}
module.exports={createGpuBudget,GiB};
