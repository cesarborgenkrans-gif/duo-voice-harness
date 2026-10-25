'use strict';
const ACTORS=['momotamu','vivi'];
// Versioned route data contains identifiers only; credentials are resolved in main.
function normalizeVoiceRoute(value){
  if(value===undefined)return {schemaVersion:1,provider:'voxcpm2',voices:{}};
  if(!value||value.schemaVersion!==1||typeof value.provider!=='string'||!/^[a-z][a-z0-9-]{1,50}$/.test(value.provider))throw Error('Unsupported voice route. Use configuration version 1 and an installed provider.');
  if(Object.keys(value).some(key=>!['schemaVersion','provider','connectionId','modelId','voices'].includes(key)))throw Error('Voice routes contain identifiers only. Configure addresses and credentials through a connection.');
  if(value.modelId!==undefined&&(typeof value.modelId!=='string'||! /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$/.test(value.modelId)))throw Error('Invalid voice model identifier.');
  if(value.modelId!==undefined&&!['elevenlabs','cartesia'].includes(value.provider))throw Error('Model selection is not supported by this voice provider.');
  if(value.connectionId!==undefined&&(typeof value.connectionId!=='string'||!/^[\w-]{1,100}$/.test(value.connectionId)))throw Error('Invalid voice connection identifier.');
  const voices={};
  if(value.voices!==undefined){
    if(!value.voices||typeof value.voices!=='object'||Array.isArray(value.voices))throw Error('Invalid companion voice selection.');
    for(const [actor,id]of Object.entries(value.voices)){
      if(!ACTORS.includes(actor)||typeof id!=='string'||!id.trim()||id.length>200)throw Error('Invalid companion voice selection.');
      voices[actor]=id;
    }
  }
  return {schemaVersion:1,provider:value.provider,...(value.connectionId?{connectionId:value.connectionId}:{}),...(value.modelId?{modelId:value.modelId}:{}),voices};
}
module.exports={normalizeVoiceRoute};
