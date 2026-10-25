'use strict';
// Only the main-process connection resolver supplies authentication and fetch.
const ORIGIN='https://api.cartesia.ai',API_VERSION='2026-08-14',RATE=24000,MAX_JSON=2*1024*1024;
function failure(message){const error=Error(message);error.userFacing=true;return error;}
function identifier(value){return typeof value==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$/.test(value);}
function checkConnection(connection){
  if(connection?.provider!=='cartesia'||connection.baseURL!==ORIGIN||!connection.credentialRef||typeof connection.request!=='function')throw failure('Configure a Cartesia connection at its official API origin with a saved credential.');
}
function httpError(status){
  const messages={400:'Cartesia rejected this request. Check the selected model, voice, language and PCM format.',401:'Cartesia authentication failed. Replace or check the saved key.',403:'Cartesia denied access. Check key permissions, voice access and account format restrictions.',404:'The selected Cartesia voice or model is unavailable.',422:'Cartesia rejected this voice/model, language or output format. Check the selected configuration.',429:'Cartesia quota, rate or concurrency limit reached. Check your account before trying again.'};
  return failure(messages[status]||`Cartesia HTTP ${status}. Check service availability before trying again.`);
}
async function checked(connection,path,init){
  const response=await connection.request(path,{...init,headers:{...init?.headers,'Cartesia-Version':API_VERSION}});
  if(!response.ok){await response.body?.cancel().catch(()=>{});throw httpError(response.status);}
  return response;
}
async function json(connection,path,signal){
  const response=await checked(connection,path,{signal});
  if(!response.body)throw failure('Cartesia returned no catalog response.');
  if(Number(response.headers.get('content-length'))>MAX_JSON){await response.body.cancel().catch(()=>{});throw failure('Cartesia catalog exceeds its size limit.');}
  const reader=response.body.getReader(),parts=[];let total=0;
  try{while(true){const part=await reader.read();if(part.done)break;total+=part.value.byteLength;if(total>MAX_JSON)throw failure('Cartesia catalog exceeds its size limit.');parts.push(Buffer.from(part.value));}}
  finally{await reader.cancel().catch(()=>{});}
  try{return JSON.parse(Buffer.concat(parts,total).toString('utf8'));}catch{throw failure('Cartesia returned invalid catalog JSON.');}
}
function voice(value){
  if(!identifier(value?.id)||typeof value.name!=='string'||value.name.length>300||value.status!=='active')throw failure('Cartesia returned invalid or inactive voice metadata.');
  return {id:value.id,label:value.name};
}
async function models(connection,signal){
  const catalog=await json(connection,'models?capability=tts',signal);
  if(!Array.isArray(catalog?.data)||catalog.data.length>200)throw failure('Cartesia returned an invalid model catalog.');
  const seen=new Set(),result=[];
  for(const item of catalog.data){
    if(item?.capability!=='tts')continue;
    if(!identifier(item.id)||seen.has(item.id))throw failure('Cartesia returned invalid speech model metadata.');
    seen.add(item.id);result.push({id:item.id,label:item.id});
  }
  return result;
}
async function voices(connection,signal){
  const result=[],tokens=new Set(),ids=new Set();let token;
  for(let page=0;page<10;page++){
    const query=new URLSearchParams({limit:'100'});if(token)query.set('starting_after',token);
    const catalog=await json(connection,'voices?'+query,signal);
    if(!Array.isArray(catalog?.data)||catalog.data.length>100||typeof catalog.has_more!=='boolean')throw failure('Cartesia returned an invalid voice page.');
    for(const item of catalog.data){const selected=voice(item);if(!ids.has(selected.id)){ids.add(selected.id);result.push(selected);}if(result.length>1000)throw failure('Cartesia voice catalog exceeds 1000 voices.');}
    if(!catalog.has_more)return result;
    token=catalog.next_page;
    if(!identifier(token)||tokens.has(token))throw failure('Cartesia returned an invalid or repeated voice cursor.');
    tokens.add(token);
  }
  throw failure('Cartesia voice catalog exceeds ten pages.');
}
function createCartesiaProvider({timeoutMs=180000,bufferSeconds=8}={}){
  const active=new Map();
  function cancel(id,owner){const turn=active.get(id);if(!turn||turn.owner!==owner)return {ok:true,cancelled:false};turn.cancelled=true;turn.controller.abort();turn.wake?.();return {ok:true,cancelled:true};}
  function consumed(id,samples,owner){const turn=active.get(id);if(turn?.owner===owner&&Number.isSafeInteger(samples)&&samples>0){turn.pending=Math.max(0,turn.pending-samples);turn.wake?.();}}
  async function discovery(operation){try{return await operation();}catch(error){if(error.userFacing)throw error;throw failure('Cartesia discovery failed or timed out. Check the connection, saved key and read permissions.');}}
  async function health(connection){return discovery(async()=>{checkConnection(connection);const signal=AbortSignal.timeout(15000);return {provider:'cartesia',models:await models(connection,signal),voices:await voices(connection,signal),apiVersion:API_VERSION,outputFormat:{container:'raw',encoding:'pcm_s16le',sample_rate:RATE},sampleRate:RATE,discoveryOnly:true};});}
  async function stream(opts,emit,owner){
    const turn={id:opts.id,owner,controller:new AbortController(),pending:0,cancelled:false};let reader,timer,timedOut=false,submitted=false;
    const abort=()=>cancel(turn.id,owner),alive=()=>{if(turn.controller.signal.aborted||opts.signal?.aborted)throw failure('Cartesia request stopped.');};
    try{
      if(active.size)throw failure('Cartesia speech is already active.');
      checkConnection(opts.connection);
      if(!identifier(opts.voiceId)||!identifier(opts.voiceRoute?.modelId))throw failure('Choose a Cartesia model and a voice for this companion before speaking.');
      opts.signal?.throwIfAborted();active.set(turn.id,turn);opts.signal?.addEventListener('abort',abort,{once:true});
      timer=setTimeout(()=>{timedOut=true;cancel(turn.id,owner);},timeoutMs);
      const signal=turn.controller.signal,catalog=await models(opts.connection,signal);alive();
      const model=catalog.find(item=>item.id===opts.voiceRoute.modelId);
      if(!model)throw failure('Choose an available Cartesia text-to-speech model.');
      const language=require('../voice-language').providerCode(opts.language,'cartesia');
      if(!language)throw failure('Choose a speech language in Persona. The provider validates the selected model’s language support.');
      const selected=voice(await json(opts.connection,'voices/'+encodeURIComponent(opts.voiceId),signal));alive();
      if(selected.id!==opts.voiceId)throw failure('Cartesia returned a different voice. Select the companion voice again.');
      // One POST only. Do not retry ambiguous failures or fall back to another provider.
      submitted=true;
      const response=await checked(opts.connection,'tts/bytes',{method:'POST',signal,headers:{'Content-Type':'application/json',Accept:'application/octet-stream'},body:JSON.stringify({model_id:model.id,transcript:opts.text,voice:opts.voiceId,language,output_format:{container:'raw',encoding:'pcm_s16le',sample_rate:RATE}})});alive();
      const contentType=response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
      if(!['application/octet-stream','audio/pcm','audio/x-pcm'].includes(contentType)){await response.body?.cancel().catch(()=>{});throw failure('Cartesia did not return raw PCM. No compressed audio was sent to playback.');}
      if(!response.body)throw failure('Cartesia returned no audio.');
      const declared=response.headers.get('content-length');
      if(declared!==null&&(! /^\d+$/.test(declared)||Number(declared)>RATE*2*600||Number(declared)===0||Number(declared)%2)){await response.body.cancel().catch(()=>{});throw failure('Cartesia returned an invalid audio length.');}
      reader=response.body.getReader();let total=0,started=false,prefix=Buffer.alloc(0);
      async function packets(bytes){
        for(let offset=0;offset<bytes.byteLength;offset+=16384){
          while(turn.pending>=RATE*bufferSeconds){alive();await new Promise(resolve=>{turn.wake=resolve;});turn.wake=null;}
          alive();const chunk=bytes.subarray(offset,offset+16384);total+=chunk.byteLength;
          if(total>RATE*2*600)throw failure('Cartesia output exceeds ten minutes.');
          turn.pending+=chunk.byteLength/2;emit({id:turn.id,type:'pcm',bytes:chunk});
        }
      }
      function start(){if(/^(RIFF|OggS|fLaC|ID3)/.test(prefix.toString('ascii',0,4)))throw failure('Cartesia returned a container or compressed stream instead of PCM.');emit({id:turn.id,type:'start',sampleRate:RATE,channels:1,format:'pcm_s16le',delivery:'streaming'});started=true;}
      while(true){
        alive();while(turn.pending>=RATE*bufferSeconds){await new Promise(resolve=>{turn.wake=resolve;});turn.wake=null;alive();}
        const part=await reader.read();if(part.done)break;
        if(!started){const needed=Math.max(0,12-prefix.length),head=part.value.subarray(0,needed);prefix=Buffer.concat([prefix,head]);if(prefix.length<12)continue;start();await packets(prefix);await packets(part.value.subarray(head.length));}
        else await packets(part.value);
      }
      alive();if(!started&&prefix.length){start();await packets(prefix);}
      if(!total||total%2||declared!==null&&Number(declared)!==total)throw failure('Cartesia returned empty or truncated PCM audio.');
      emit({id:turn.id,type:'end'});return {ok:true,delivery:'streaming',sampleRate:RATE,samples:total/2};
    }catch(error){
      const message=timedOut?'Cartesia request timed out. It was not retried.':turn.cancelled?'Cartesia playback/request stopped.':error.userFacing?error.message:'Cartesia connection failed or closed early. Check your connection and account before trying again.';
      if(!turn.cancelled||timedOut)emit({id:turn.id,type:'error',error:message});
      return {ok:false,cancelled:turn.cancelled&&!timedOut,error:message,submitted,providerCancellationConfirmed:false};
    }finally{clearTimeout(timer);opts.signal?.removeEventListener('abort',abort);turn.controller.abort();turn.wake?.();await reader?.cancel().catch(()=>{});if(active.get(turn.id)===turn)active.delete(turn.id);}
  }
  return {id:'cartesia',label:'Cartesia · your account',contractVersion:1,capabilities:Object.freeze({streaming:true,sessionOnly:true,requiresLocalRuntime:false,voiceDirection:false,narrationContinuation:false,referenceAudio:false}),stream,cancel,consumed,health,profiles:async connection=>discovery(async()=>{checkConnection(connection);return voices(connection,AbortSignal.timeout(15000));}),get busy(){return active.size>0;}};
}
module.exports={createCartesiaProvider,API_VERSION};
