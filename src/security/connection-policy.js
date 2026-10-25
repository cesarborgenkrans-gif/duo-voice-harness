'use strict';
const OFFICIAL=Object.freeze({openrouter:'https://openrouter.ai',elevenlabs:'https://api.elevenlabs.io',cartesia:'https://api.cartesia.ai'});
function connectionPolicy({provider='custom',url,localOnly=false}){
  if(typeof provider!=='string'||!/^[a-z][a-z0-9-]{1,50}$/.test(provider))throw Error('Invalid connection provider.');
  let target;try{target=new URL(url);}catch{throw Error('Enter a valid connection URL.');}
  const loopback=['localhost','127.0.0.1','[::1]'].includes(target.hostname);
  if(target.username||target.password||target.search||target.hash||!['http:','https:'].includes(target.protocol)||target.protocol==='http:'&&!loopback)throw Error('Use HTTPS for remote connections, or HTTP on loopback, without URL credentials, query or fragment.');
  if(OFFICIAL[provider]&&target.origin!==OFFICIAL[provider])throw Error('This provider requires its official API origin.');
  if(localOnly&&!loopback)throw Error('Local-only voice mode blocks remote speech connections.');
  return {provider,origin:target.origin,baseURL:target.href.replace(/\/+$/,''),loopback};
}
function sameOriginURL(connection,value){
  const target=new URL(value,connection.baseURL+'/');
  if(target.origin!==connection.origin||target.username||target.password||target.hash)throw Error('The request must stay on its configured origin.');
  return target.href;
}
module.exports={connectionPolicy,sameOriginURL,OFFICIAL};
