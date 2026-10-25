'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {createVoiceConnections}=require('../src/security/voice-connections');
test('voice settings replace a connection credential without breaking saved routes; invalid updates preserve the record',async t=>{
 const folder=await fs.mkdtemp(path.join(os.tmpdir(),'duo-voice-settings-'));t.after(()=>fs.rm(folder,{recursive:true,force:true}));const origin='https://api.cartesia.ai',requests=[];
 const connections=createVoiceConnections({file:path.join(folder,'connections.json'),credentials:{status:async ref=>({provider:ref==='foreign'?'elevenlabs':'cartesia',origin}),resolve:async ref=>ref},fetchImpl:async(_url,init)=>{requests.push(init.headers.get('Authorization'));return new Response('{}');}});
 const first=await connections.save({provider:'cartesia',baseURL:origin,credentialRef:'synthetic-original'});await connections.setLocalOnly(false);
 const route={schemaVersion:1,provider:'cartesia',connectionId:first.id},bound=await connections.resolve(route);await bound.request('models');
 const updated=await connections.save({id:first.id,provider:'cartesia',baseURL:origin,credentialRef:'synthetic-replacement'});assert.equal(updated.id,first.id);assert.equal((await connections.list()).connections.length,1);await bound.request('models');assert.deepEqual(requests,['Bearer synthetic-original','Bearer synthetic-replacement']);
 for(const input of [{id:first.id,provider:'elevenlabs',baseURL:'https://api.elevenlabs.io'},{id:first.id,provider:'cartesia',baseURL:origin,credentialRef:'foreign'},{id:'connection-'+randomUUID(),provider:'cartesia',baseURL:origin},{id:'../outside',provider:'cartesia',baseURL:origin}])await assert.rejects(connections.save(input));
 assert.equal((await connections.list()).connections[0].credentialRef,'synthetic-replacement');
 const cleared=await connections.save({id:first.id,provider:'cartesia',baseURL:origin});assert.equal(cleared.credentialRef,undefined);assert.equal((await connections.list()).connections.length,1);
});
