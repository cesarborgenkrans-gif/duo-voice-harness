'use strict';
const {createVoxCPM2Provider,speechText}=require('./providers/voxcpm2');
const {createDiyProvider}=require('./providers/diy');
const {createElevenLabsProvider}=require('./providers/elevenlabs');
const {createCartesiaProvider}=require('./providers/cartesia');
const {normalizeVoiceRoute}=require('./voice-route');

function createVoiceService({adapters=[],resolveConnection,diyOptions,elevenLabsOptions,cartesiaOptions,...options}={}){
  const local=createVoxCPM2Provider(options),registry=new Map(),active=new Map();
  for(const provider of [local,createDiyProvider(diyOptions),createElevenLabsProvider(elevenLabsOptions),createCartesiaProvider(cartesiaOptions),...adapters]){
    if(!provider||provider.contractVersion!==1||typeof provider.id!=='string'||!/^[a-z][a-z0-9-]{1,50}$/.test(provider.id)||typeof provider.label!=='string'||registry.has(provider.id)||provider.capabilities?.sessionOnly!==true||provider.capabilities.streaming!==true||!['requiresLocalRuntime','voiceDirection','narrationContinuation'].every(flag=>typeof provider.capabilities[flag]==='boolean')||!['stream','cancel','consumed'].every(method=>typeof provider[method]==='function'))throw Error('Invalid or duplicate voice provider adapter.');
    registry.set(provider.id,provider);
  }
  function select(value){
    const route=normalizeVoiceRoute(value),provider=registry.get(route.provider);
    if(!provider)throw Error('This voice provider is not installed. Choose VoxCPM2 or configure an available adapter.');
    return {provider,route};
  }
  function describe(value){const {provider,route}=select(value);return {schemaVersion:1,id:provider.id,label:provider.label,capabilities:{...provider.capabilities},route};}
  function cancel(id,owner){
    const turn=active.get(id);
    if(!turn||turn.owner!==owner)return {ok:true,cancelled:false};
    turn.cancelled=true;turn.controller.abort();
    try{turn.provider.cancel(id,owner);}catch{/* The stream promise still owns final cleanup. */}
    return {ok:true,cancelled:true};
  }
  async function stream(input,emit,owner){
    let turn;
    try{
      if(!input||!/^[\w-]{6,100}$/.test(input.id||'')||active.has(input.id))throw Error('Invalid or duplicate voice request ID.');
      if(active.size)throw Error('Finish or stop current voice playback before changing voice or provider.');
      const {provider,route}=select(input.voiceRoute);
      if(!provider.capabilities.requiresLocalRuntime&&!route.connectionId)throw Error('Configure a voice connection before using this provider.');
      if(provider.busy)throw Error('Wait for the selected voice provider to finish its current operation.');
      if(!['momotamu','vivi'].includes(input.actor))throw Error('Unknown voice actor.');
      if(typeof input.text!=='string'||!input.text.trim()||input.text.length>8000)throw Error('Voice text must contain 1–8000 characters.');
      const text=input.verbatim===true?input.text:speechText(input.text);
      if(!text.trim())throw Error('The reply contains no speakable text.');
      if(typeof input.language!=='string'||!input.language.trim()||input.language.length>40)throw Error('Voice language is required.');
      if(input.voiceDirection!==undefined&&(typeof input.voiceDirection!=='string'||input.voiceDirection.length>600))throw Error('Voice direction exceeds 600 characters.');
      if(input.voiceDirection?.trim()&&!provider.capabilities.voiceDirection)throw Error('This voice provider does not support Voice Direction. Clear it or choose another provider.');
      if(input.narrationContinuation!==undefined&&typeof input.narrationContinuation!=='boolean')throw Error('Invalid narration continuation flag.');
      if(input.narrationContinuation&&!provider.capabilities.narrationContinuation)throw Error('This voice provider does not support reading continuation.');
      if(input.narrationContinuation&&(input.verbatim!==true||input.voiceDirection?.trim()))throw Error('Reading continuation requires exact source words without Voice Direction.');
      turn={id:input.id,owner,provider,controller:new AbortController(),cancelled:false,started:false,terminal:false,bytes:0,rate:0};
      active.set(turn.id,turn);
      const packet=value=>{
        if(turn.cancelled||turn.terminal)return;
        if(!value||value.id!==undefined&&value.id!==turn.id)throw Error('Voice provider returned a mismatched request ID.');
        if(value.type==='start'){
          if(turn.started||!Number.isInteger(value.sampleRate)||value.sampleRate<8000||value.sampleRate>96000||value.channels!==1||value.format!=='pcm_s16le')throw Error('Voice provider must emit mono pcm_s16le audio at 8–96 kHz. Compressed audio requires a decoder.');
          turn.started=true;turn.rate=value.sampleRate;
        }else if(value.type==='pcm'){
          if(!turn.started||!(value.bytes instanceof Uint8Array))throw Error('Voice provider returned audio before its format declaration or invalid PCM bytes.');
          turn.bytes+=value.bytes.byteLength;
          if(turn.bytes>turn.rate*2*600)throw Error('Voice output exceeds ten minutes.');
        }else if(value.type==='end'){
          if(!turn.started||!turn.bytes||turn.bytes%2)throw Error('Voice provider returned empty or truncated PCM audio.');
          turn.terminal=true;
        }else if(value.type==='error'){turn.terminal=true;turn.failure=value.error||'Voice provider reported an error.';}
        else throw Error('Unknown voice provider packet.');
        emit({...value,id:turn.id,provider:provider.id});
      };
      const connection=route.connectionId?(resolveConnection?await resolveConnection(route):undefined):undefined;
      if(route.connectionId&&!connection)throw Error('This voice connection is not configured.');
      const result=await provider.stream({...input,text,connection,voiceRoute:route,voiceId:route.voices[input.actor],signal:turn.controller.signal},packet,owner);
      if(turn.cancelled)return {...result,ok:false,cancelled:true};
      if(!result||typeof result.ok!=='boolean')throw Error('Voice provider returned an invalid completion result.');
      if(result?.ok&&turn.failure)throw Error(turn.failure);
      if(result?.ok&&(!turn.terminal||!turn.started||!turn.bytes||turn.bytes%2))throw Error('Voice provider did not complete its audio stream.');
      return {...result,provider:provider.id};
    }catch(error){
      if(turn&&!turn.cancelled){try{turn.provider.cancel(turn.id,owner);}catch{}if(!turn.terminal)emit({id:turn.id,type:'error',error:error.message});}
      return {ok:false,cancelled:!!turn?.cancelled,error:error.message};
    }finally{if(turn&&active.get(turn.id)===turn)active.delete(turn.id);}
  }
  function consumed(id,samples,owner){const turn=active.get(id);if(turn?.owner===owner&&Number.isSafeInteger(samples)&&samples>0)turn.provider.consumed(id,samples,owner);}
  function cancelOwner(owner){for(const [id,turn]of active)if(turn.owner===owner)cancel(id,owner);}
  return {stream,cancel,consumed,cancelOwner,cancelAll:()=>{for(const [id,turn]of active)cancel(id,turn.owner);},
    describe,providers:()=>[...registry.values()].map(provider=>describe({schemaVersion:1,provider:provider.id})),
    get busy(){return active.size>0||[...registry.values()].some(provider=>provider.busy);},
    // Existing engine-management calls explicitly address the featured local adapter.
    reference:actor=>local.reference(actor),
    health:async(baseURL,voiceRoute)=>{const {provider,route}=select(voiceRoute);if(!provider.health)throw Error('This provider does not offer a health check.');return provider.health(provider.capabilities.requiresLocalRuntime?baseURL:await resolveConnection?.(route),route);},
    profiles:async(voiceRoute)=>{const {provider,route}=select(voiceRoute);return provider.profiles?provider.profiles(provider.capabilities.requiresLocalRuntime?route:await resolveConnection?.(route),route):[];}
  };
}
module.exports={createVoiceService};
