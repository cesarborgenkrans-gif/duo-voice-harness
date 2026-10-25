'use strict';
const {connectionPolicy,sameOriginURL}=require('./connection-policy');
function createConnectionRequest({credentials,fetchImpl=fetch}){
  return async function request(config,value,init={}){
    const connection=connectionPolicy(config),url=sameOriginURL(connection,value),headers=new Headers(init.headers);
    if(['authorization','xi-api-key','x-api-key'].some(name=>headers.has(name)))throw Error('Supply a credential reference, not an authorization header.');
    if(config.credentialRef){
      const secret=await credentials.resolve(config.credentialRef,{provider:connection.provider,url:connection.baseURL});
      const name=config.provider==='elevenlabs'?'xi-api-key':'Authorization';
      headers.set(name,name==='Authorization'?'Bearer '+secret:secret);
    }
    // Never follow a redirect with a credential or synthesis payload.
    return fetchImpl(url,{...init,headers,redirect:'error'});
  };
}
module.exports={createConnectionRequest};
