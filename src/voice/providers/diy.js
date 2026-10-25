'use strict';
const {decodeWav}=require('../pcm-wav');
const MAX_AUDIO_BYTES=64*1024*1024,MAX_JSON_BYTES=64*1024;
async function readBounded(response,limit){
  if(!response.body)throw Error('DIY voice returned no response body.');
  if(Number(response.headers.get('content-length'))>limit){await response.body.cancel().catch(()=>{});throw Error('DIY voice response exceeds its size limit.');}
  const reader=response.body.getReader(),chunks=[];let total=0;
  try{while(true){const next=await reader.read();if(next.done)break;total+=next.value.byteLength;if(total>limit)throw Error('DIY voice response exceeds its size limit.');chunks.push(Buffer.from(next.value));}}finally{await reader.cancel().catch(()=>{});}
  return Buffer.concat(chunks,total);
}
function httpError(status){return Error(status===401||status===403?'DIY voice authentication failed. Check the connection credential.':status===429?'DIY voice is busy or rate limited. Try again later.':`DIY voice HTTP ${status}. Check the server and its Duo speech contract.`);}
async function json(connection,route,body,signal){
  const response=await connection.request(route,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal});
  if(!response.ok){await response.body?.cancel().catch(()=>{});throw httpError(response.status);}
  const bytes=await readBounded(response,MAX_JSON_BYTES);
  try{return JSON.parse(bytes.toString('utf8'));}catch{throw Error('DIY voice returned invalid JSON.');}
}
function validateCapabilities(value){
  if(value?.contractVersion!==1||value.sessionOnly!==true||!Array.isArray(value.formats)||!value.formats.length||value.formats.some(format=>!['pcm_s16le','wav'].includes(format))||!Array.isArray(value.voices)||!value.voices.length||value.voices.length>200)throw Error('DIY server must implement Duo speech contract version 1 with session-only output.');
  const ids=new Set();
  for(const voice of value.voices){if(typeof voice?.id!=='string'||!voice.id.trim()||voice.id.length>200||ids.has(voice.id)||typeof voice.label!=='string'||voice.label.length>200)throw Error('DIY voice catalog is invalid.');ids.add(voice.id);}
  return value;
}
function createDiyProvider({timeoutMs=180000,bufferSeconds=8,cleanupTimeoutMs=3000}={}){
  const active=new Map();
  async function health(connection){if(!connection?.request)throw Error('Configure a DIY voice connection first.');return validateCapabilities(await json(connection,'v1/capabilities',undefined,AbortSignal.timeout(5000)));}
  function cancel(id,owner){
    const turn=active.get(id);if(!turn||turn.owner!==owner)return {ok:true,cancelled:false};
    if(!turn.cancelled){turn.cancelled=true;turn.controller.abort();turn.wake?.();}
    return {ok:true,cancelled:true};
  }
  function consumed(id,samples,owner){const turn=active.get(id);if(turn?.owner===owner&&Number.isSafeInteger(samples)&&samples>0){turn.pending=Math.max(0,turn.pending-samples);turn.wake?.();}}
  async function stream(opts,emit,owner){
    const turn={id:opts.id,owner,controller:new AbortController(),cancelled:false,pending:0,attempted:false};
    let timer,reader,outcome,timedOut=false;
    const abort=()=>cancel(opts.id,owner),alive=()=>{if(turn.cancelled||opts.signal?.aborted)throw Error(timedOut?'DIY voice timed out.':'DIY voice cancelled.');};
    try{
      if(active.size)throw Error('DIY voice is already active.');
      if(!/^[\w-]{6,100}$/.test(opts.id||''))throw Error('Invalid DIY request ID.');
      if(!opts.connection?.request)throw Error('Configure a DIY voice connection first.');
      opts.signal?.throwIfAborted();active.set(turn.id,turn);opts.signal?.addEventListener('abort',abort,{once:true});
      timer=setTimeout(()=>{timedOut=true;cancel(turn.id,owner);},timeoutMs);
      const capabilities=validateCapabilities(await json(opts.connection,'v1/capabilities',undefined,turn.controller.signal));alive();
      if(!capabilities.voices.some(voice=>voice.id===opts.voiceId))throw Error('Choose a voice from this DIY server for '+opts.actor+'.');
      const format=capabilities.formats.includes('pcm_s16le')?'pcm_s16le':'wav',delivery=format==='wav'?'buffered':'streaming';
      const route='v1/speech/'+encodeURIComponent(opts.id);turn.route=route;turn.attempted=true;
      const created=await json(opts.connection,'v1/speech',{contractVersion:1,requestId:opts.id,actor:opts.actor,voiceId:opts.voiceId,text:opts.text,language:opts.language,outputRetention:'session',format},turn.controller.signal);alive();
      const rate=created.sampleRate;
      if(created.contractVersion!==1||created.requestId!==opts.id||created.format!==format||created.delivery!==delivery||created.channels!==1||!Number.isInteger(rate)||rate<8000||rate>96000)throw Error('DIY voice returned invalid job/audio metadata.');
      const response=await opts.connection.request(route+'/audio',{signal:turn.controller.signal});alive();
      if(!response.ok){await response.body?.cancel().catch(()=>{});throw httpError(response.status);}
      if(response.headers.get('X-Duo-Speech-Version')!=='1'||response.headers.get('X-Audio-Format')!==format||Number(response.headers.get('X-Sample-Rate'))!==rate||response.headers.get('X-Audio-Channels')!=='1'||response.headers.get('Content-Type')?.split(';')[0]!== (format==='wav'?'audio/wav':'application/octet-stream'))throw Error('DIY audio headers do not match the selected format.');
      let total=0;
      const start=()=>emit({id:opts.id,type:'start',sampleRate:rate,channels:1,format:'pcm_s16le',delivery});
      async function packets(bytes){
        for(let offset=0;offset<bytes.byteLength;offset+=16384){
          while(turn.pending>=rate*bufferSeconds){alive();await new Promise(resolve=>{turn.wake=resolve;});turn.wake=null;}
          alive();const packet=bytes.subarray(offset,offset+16384);total+=packet.byteLength;
          if(total>MAX_AUDIO_BYTES||total>rate*2*600)throw Error('DIY audio exceeds 64 MiB or ten minutes.');
          turn.pending+=packet.byteLength/2;emit({id:opts.id,type:'pcm',bytes:packet});
        }
      }
      if(format==='wav'){
        const decoded=decodeWav(await readBounded(response,MAX_AUDIO_BYTES));alive();
        if(decoded.sampleRate!==rate)throw Error('DIY WAV sample rate does not match the job.');
        start();await packets(decoded.pcm);
      }else{
        if(!response.body)throw Error('DIY voice returned no audio.');
        start();reader=response.body.getReader();
        while(true){alive();while(turn.pending>=rate*bufferSeconds){await new Promise(resolve=>{turn.wake=resolve;});turn.wake=null;alive();}const part=await reader.read();if(part.done)break;await packets(part.value);}
      }
      if(!total||total%2)throw Error('DIY voice returned empty or truncated PCM.');
      let final=await json(opts.connection,route,undefined,turn.controller.signal);alive();
      while(['open','generating'].includes(final.state)){await new Promise(resolve=>setTimeout(resolve,80));alive();final=await json(opts.connection,route,undefined,turn.controller.signal);}
      if(final.contractVersion!==1||final.requestId!==opts.id||final.state!=='completed'||final.audioSamples!==total/2)throw Error('DIY voice did not confirm a complete matching audio take.');
      alive();emit({id:opts.id,type:'end'});outcome={ok:true,delivery,sampleRate:rate,samples:total/2};return outcome;
    }catch(error){
      const message=timedOut?'DIY voice timed out.':turn.cancelled?'DIY voice cancelled.':error.name==='TypeError'?'DIY voice connection is unavailable or closed early. Check the configured server.':error.message||'DIY voice is unavailable. Check its server.';
      if(!turn.cancelled||timedOut)emit({id:opts.id,type:'error',error:message});
      outcome={ok:false,cancelled:turn.cancelled&&!timedOut,error:message};return outcome;
    }finally{
      clearTimeout(timer);opts.signal?.removeEventListener('abort',abort);turn.controller.abort();turn.wake?.();
      await reader?.cancel().catch(()=>{});
      if(turn.attempted){try{const stopped=await json(opts.connection,turn.route+'/cancel',{},AbortSignal.timeout(cleanupTimeoutMs));turn.cleanupConfirmed=['completed','cancelled','failed'].includes(stopped.state);}catch{/* An external server owns its worker lifecycle; never kill its process. */}}
      if(turn.attempted&&outcome)outcome.cleanupConfirmed=turn.cleanupConfirmed===true;
      if(active.get(turn.id)===turn)active.delete(turn.id);
    }
  }
  return {id:'diy',label:'DIY speech server',contractVersion:1,capabilities:Object.freeze({streaming:true,sessionOnly:true,requiresLocalRuntime:false,voiceDirection:false,narrationContinuation:false,referenceAudio:false}),stream,cancel,consumed,health,profiles:async connection=>(await health(connection)).voices,get busy(){return active.size>0;}};
}
module.exports={createDiyProvider,validateCapabilities,readBounded};
