'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {connectionPolicy}=require('./connection-policy');
const {createConnectionRequest}=require('./connection-request');
function createVoiceConnections({file,credentials,fetchImpl}){
  let queue=Promise.resolve();
  const request=createConnectionRequest({credentials,fetchImpl});
  async function read(){try{const value=JSON.parse(await fs.readFile(file,'utf8'));if(value.schemaVersion!==1||typeof value.localOnly!=='boolean'||!Array.isArray(value.connections))throw Error('schema');return value;}catch(error){if(error.code==='ENOENT')return {schemaVersion:1,localOnly:true,connections:[]};throw Error('The voice connection configuration is invalid.');}}
  function change(update){const operation=queue.catch(()=>{}).then(async()=>{const state=await read(),next=await update(state);await fs.mkdir(path.dirname(file),{recursive:true});const temporary=file+'.'+randomUUID()+'.tmp';try{await fs.writeFile(temporary,JSON.stringify(next),{mode:0o600,flag:'wx'});await fs.rename(temporary,file);}finally{await fs.unlink(temporary).catch(()=>{});}return next;});queue=operation;return operation;}
  async function save(input){
    const normalized=connectionPolicy({provider:input.provider,url:input.baseURL});
    if(input.credentialRef){const meta=await credentials.status(input.credentialRef);if(meta.provider!==normalized.provider||meta.origin!==normalized.origin)throw Error('This credential belongs to another connection.');}
    if(input.id!==undefined&&(typeof input.id!=='string'||!/^connection-[0-9a-f-]{36}$/.test(input.id)))throw Error('Invalid saved voice connection.');
    const connection={id:input.id||'connection-'+randomUUID(),provider:normalized.provider,baseURL:normalized.baseURL,...(input.credentialRef?{credentialRef:input.credentialRef}:{})};
    await change(state=>{if(input.id&&!state.connections.some(item=>item.id===input.id&&item.provider===normalized.provider))throw Error('This voice connection was removed or belongs to another provider.');return {...state,connections:input.id?state.connections.map(item=>item.id===input.id?connection:item):[...state.connections,connection]};});return connection;
  }
  async function resolve(route){const state=await read(),item=state.connections.find(item=>item.id===route.connectionId);if(!item||item.provider!==route.provider)throw Error('Choose a configured connection for this voice provider.');connectionPolicy({...item,url:item.baseURL,localOnly:state.localOnly});return {...item,request:async(value,init)=>{const current=await read(),active=current.connections.find(connection=>connection.id===item.id);if(!active||active.provider!==route.provider)throw Error('This voice connection was removed.');return request({...active,url:active.baseURL,localOnly:current.localOnly},value,init);}};}
  return {list:read,save,resolve,setLocalOnly:enabled=>{if(typeof enabled!=='boolean')throw Error('Choose a local-only voice policy.');return change(state=>({...state,localOnly:enabled}));},remove:id=>change(state=>({...state,connections:state.connections.filter(item=>item.id!==id)}))};
}
module.exports={createVoiceConnections};
