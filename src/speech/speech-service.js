// Cache completed owner-scoped speech only; replay with bounded PCM backpressure.
'use strict';
const {randomUUID}=require('node:crypto');
const {wav}=require('../voice/pcm-wav');
const ACTORS=new Set(['momotamu','vivi']);
const LANGUAGES=new Set(require('../voice/voice-language').LANGUAGES);
function validateSpeech(opts,languages=LANGUAGES){
  if(!opts||typeof opts.text!=='string'||!opts.text.trim()||opts.text.length>8000)throw Error('Enter between 1 and 8,000 characters.');
  if(!ACTORS.has(opts.actor))throw Error('Choose an available voice.');
  if(!languages.has(opts.language))throw Error('Choose a speech language.');
  if(!/^[\w-]{6,100}$/.test(opts.id||''))throw Error('Invalid speech request.');
  return opts;
}
function createSpeechService({voiceService,replayTimeoutMs=610000,maxRecordings=1,maxBytes=64*1024*1024,verbatim=true}){
  const recordings=new Map(),active=new Map();
  const get=(id,owner)=>{const item=recordings.get(owner)?.get(id);if(!item)throw Error('This recording is no longer available in this window.');return item;};
  const summary=item=>({id:item.id,actor:item.actor,language:item.language,duration:item.duration,context:item.context});
  const matches=(item,scope)=>item.context?.id===scope?.id&&item.context?.kind===scope?.kind;
  async function generate(opts,emit,owner){
    let lease;
    try{
      validateSpeech(opts);if(active.size)throw Error('Finish or stop the active speech first.');
      const context=opts.recordingContext;
      if(context&&(!['chat','discussion'].includes(context.kind)||!/^[\w-]{6,100}$/.test(context.id||'')||!/^[\w-]{6,100}$/.test(context.entryId||'')))throw Error('Invalid recording context.');
      lease={owner,id:opts.id,cancelled:false,context};active.set(opts.id,lease);
      let rate,ended=false,total=0;const chunks=[];
      const result=await voiceService.stream({...opts,verbatim},packet=>{
        if(packet.type==='start')rate=packet.sampleRate;
        if(packet.type==='pcm'){
          const bytes=Buffer.from(packet.bytes);total+=bytes.length;
          if(!Number.isInteger(rate)||rate<8000||rate>96000||total>rate*2*600)throw Error('Speech exceeds the recording limit.');
          chunks.push(bytes);
        }
        if(packet.type==='end')ended=true;
        emit(packet);
      },owner);
      if(!result.ok||lease.cancelled)return {...result,ok:false,cancelled:lease.cancelled||result.cancelled};
      if(!ended||!rate||!total||total%2)throw Error('The voice recording did not finish. Your text is kept.');
      if(total>maxBytes)return {...result,recordingUnavailable:'Audio played, but this take exceeds the session replay memory limit.'};
      const recording={id:'speech-'+randomUUID(),actor:opts.actor,language:opts.language,context:context?{kind:context.kind,id:context.id,entryId:context.entryId}:undefined,rate,pcm:Buffer.concat(chunks),duration:total/(rate*2)};
      const items=recordings.get(owner)||new Map();
      items.set(recording.id,recording);
      let used=[...items.values()].reduce((sum,item)=>sum+item.pcm.length,0);
      while(items.size>maxRecordings||used>maxBytes){const oldest=items.keys().next().value;used-=items.get(oldest).pcm.length;items.delete(oldest);}
      recordings.set(owner,items);
      return {...result,recording:summary(recording)};
    }catch(error){return {ok:false,cancelled:!!lease?.cancelled,error:error.message};}
    finally{if(lease&&active.get(opts.id)===lease)active.delete(opts.id);}
  }
  async function replay(opts,emit,owner){
    let lease,timer;
    try{
      if(!/^[\w-]{6,100}$/.test(opts?.id||''))throw Error('Invalid replay request.');
      if(active.size)throw Error('Finish or stop the active speech first.');
      const item=get(opts.replayRecordingId,owner);
      lease={id:opts.id,owner,cancelled:false,pending:0,context:item.context};active.set(opts.id,lease);
      timer=setTimeout(()=>{lease.cancelled=true;lease.wake?.();},replayTimeoutMs);
      emit({id:opts.id,type:'start',sampleRate:item.rate});
      for(let offset=0;offset<item.pcm.length;offset+=16384){
        while(lease.pending>=item.rate*2&&!lease.cancelled)await new Promise(resolve=>{lease.wake=resolve;});
        if(lease.cancelled)return {ok:false,cancelled:true};
        const bytes=item.pcm.subarray(offset,offset+16384);lease.pending+=bytes.length/2;
        emit({id:opts.id,type:'pcm',bytes});
      }
      emit({id:opts.id,type:'end'});return {ok:true,recording:summary(item)};
    }catch(error){return {ok:false,error:error.message};}
    finally{clearTimeout(timer);if(lease&&active.get(opts.id)===lease)active.delete(opts.id);}
  }
  function cancel(id,owner){const lease=active.get(id);if(lease?.owner!==owner)return;lease.cancelled=true;lease.wake?.();voiceService.cancel(id,owner);}
  function consumed(id,samples,owner){const lease=active.get(id);if(lease?.owner===owner&&Number.isSafeInteger(samples)&&samples>0){lease.pending=Math.max(0,(lease.pending||0)-samples);lease.wake?.();}}
  function cancelOwner(owner){for(const [id,lease]of active)if(lease.owner===owner)cancel(id,owner);}
  function clear(owner){recordings.delete(owner);cancelOwner(owner);}
  function clearSession(owner,scope){for(const [id,item]of recordings.get(owner)||[])if(matches(item,scope))recordings.get(owner).delete(id);for(const [id,lease]of active)if(lease.owner===owner&&matches(lease,scope))cancel(id,owner);}
  return {generate,replay,cancel,consumed,clear,clearSession,cancelOwner,list:(owner)=>[...(recordings.get(owner)?.values()||[])].map(summary),get busy(){return active.size>0;},audio:(id,owner)=>{const item=get(id,owner);return {bytes:wav(item.pcm,item.rate),actor:item.actor,context:item.context};}};
}
module.exports={createSpeechService,validateSpeech};
