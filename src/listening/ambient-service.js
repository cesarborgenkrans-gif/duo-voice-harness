'use strict';
const {randomUUID}=require('node:crypto'),L=require('./listening-model'),M=require('./ambient-model'),T=require('../input/input-model');
function createAmbientService({target,request,onProgress=()=>{},handoffWaitMs=10000}){
 let active=null;
 const current=(owner,id)=>{if(!active||active.owner!==owner||active.id!==id)throw Error('This listening session is no longer active.');return active;};
 const emit=s=>{if(active===s)onProgress(s.owner,{id:s.id,stage:s.handoff?'finishing':s.paused?'paused':s.suspended?'replying':'listening',...s.transcript.snapshot(),pending:s.queue.length+(s.running?1:0),gaps:s.gaps,lagMs:s.runningItem?Math.max(0,Date.now()-s.runningItem.endMs):0});};
 async function drain(s){
  if(s.running||s.suspended||s.paused||active!==s)return;
  s.running=true;
  try{
   while(s.queue.length&&!s.suspended&&!s.paused&&active===s){
    const item=s.queue.shift(),epoch=s.epoch,job=new AbortController();s.runningItem=item;s.transcriptionAbort=job;
    let text='',error;
    try{
     if(item.audio.rms>.0006){
      const raw=await request(s.target,[{role:'system',content:T.prompt},{role:'user',content:[{type:'text',text:'Return the structured speech result in the original spoken language.'},{type:'input_audio',input_audio:{format:'wav',data:item.data}}]}],300,AbortSignal.any([s.controller.signal,job.signal]),undefined,{transcription:true,schema:T.schema});
      text=T.parseTranscript(raw,{allowEmpty:true,maxLength:4000});if(text.includes('<|'))throw Error('Unusable transcription.');
     }
    }catch(e){if(active!==s)return;if(epoch===s.epoch){error=String(e.message).slice(0,250);s.gaps++;}}
    finally{if(s.transcriptionAbort===job)s.transcriptionAbort=null;}
    if(active!==s)return;if(epoch!==s.epoch)continue;
    if(text||error)s.transcript.add({...item,text,error});emit(s);
   }
  }finally{s.running=false;s.runningItem=null;emit(s);}
 }
 const startDrain=s=>{if(!s.running&&!s.suspended&&!s.paused)s.draining=drain(s).catch(()=>{if(active===s){s.gaps++;emit(s);}});};
 async function begin(owner,settings={}){if(active)throw Error('Background listening is already active.');const s={owner,id:randomUUID(),controller:new AbortController(),transcript:M.createTranscript(settings),sequence:{mic:0,meeting:0},queue:[],running:false,paused:false,suspended:false,handoff:false,gaps:0,epoch:0};active=s;try{s.target=await target();current(owner,s.id);return {id:s.id,model:s.target.model};}catch(e){if(active===s)active=null;throw e;}}
 function chunk(owner,{id,source,sequence,data,startMs}){
  const s=current(owner,id);if(!['mic','meeting'].includes(source)||sequence!==s.sequence[source])throw Error('Listening audio is out of order.');
  const audio=L.wav(data);if(audio.seconds>4.1)throw Error('Background listening accepts at most four seconds per segment.');s.sequence[source]++;
  if(s.paused||s.handoff||s.suspended&&!s.classifying&&s.discarding)return {accepted:false};
  const start=Number.isFinite(startMs)?Math.min(Date.now(),Math.max(Date.now()-10000,startMs)):Date.now()-audio.seconds*1000;
  if(s.queue.length>=4){s.queue.shift();s.gaps++;}s.queue.push({source,data,audio,startMs:start,endMs:start+audio.seconds*1000});emit(s);startDrain(s);return {accepted:true};
 }
 async function suspend(owner,{id,suspended=true,discardPending=false,settlePending=false}){
  const s=current(owner,id);
  if(settlePending){
   if(s.handoff)throw Error('A listening handoff is already in progress.');
   const paused=s.paused;s.handoff=true;s.paused=false;s.suspended=false;emit(s);startDrain(s);
   const timer=setTimeout(()=>{
    if(active!==s||!s.handoff)return;
    const unfinished=[...(s.runningItem&&s.transcriptionAbort?[s.runningItem]:[]),...s.queue];
    s.epoch++;s.queue=[];s.gaps+=unfinished.length;
    for(const item of unfinished)s.transcript.add({...item,text:'',error:'Not transcribed before handoff. Repeat your question or type it.'});
    s.transcriptionAbort?.abort(new Error('Listening handoff deadline reached.'));emit(s);
   },handoffWaitMs);
   try{await s.draining;current(owner,id);s.paused=paused;}
   finally{clearTimeout(timer);s.handoff=false;}
  }
  s.suspended=!!suspended;s.discarding=s.suspended&&discardPending;
  if(discardPending){s.queue=[];s.epoch++;}emit(s);
  if(s.suspended){await s.draining;current(owner,id);}else startDrain(s);return {};
 }
 async function detect(owner,{id,text,names}){const s=current(owner,id);if(!s.suspended||s.running||s.classifying)throw Error('Suspend transcription before checking an invitation.');if(typeof text!=='string'||text.length>6000)throw Error('Invitation context is too large.');if(!M.mentions(text,names))return {addressed:false};s.classifying=true;try{const raw=await request(s.target,[{role:'system',content:M.invitationPrompt},{role:'user',content:JSON.stringify({names:M.aliases(names),utterance:text})}],80,s.controller.signal);current(owner,id);return {addressed:M.decision(raw)};}finally{s.classifying=false;}}
 async function pause(owner,{id}){const s=current(owner,id);s.paused=true;await s.draining;current(owner,id);emit(s);return {};}
 function resume(owner,{id}){const s=current(owner,id);s.paused=false;startDrain(s);emit(s);return {};}
 function cancel(owner,id){if(active?.owner===owner&&(!id||active.id===id)){const s=active;active=null;s.queue=[];s.controller.abort();}return {};}
 function forget(owner,{id}){const s=current(owner,id);s.epoch++;s.queue=[];s.transcript.forget();emit(s);return {};}
 function correct(owner,{id,entryId,text}){const s=current(owner,id);s.transcript.correct(entryId,text);emit(s);return {};}
 function pin(owner,{id,entryId}){const s=current(owner,id);s.transcript.pin(entryId);emit(s);return {};}
 function setWindow(owner,{id,windowSeconds}){const s=current(owner,id);s.transcript.setWindow(windowSeconds);emit(s);return {};}
 return {begin,chunk,suspend,detect,pause,resume,cancel,forget,correct,pin,setWindow,get busy(){return !!active;},get suspended(){return !!active?.suspended&&!active.running&&!active.classifying;}};
}
module.exports={createAmbientService};
