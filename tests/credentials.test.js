'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),http=require('node:http');
const {createCredentialStore}=require('../src/security/credential-store');
const {connectionPolicy}=require('../src/security/connection-policy');
const {createConnectionRequest}=require('../src/security/connection-request');
const {createVoiceConnections}=require('../src/security/voice-connections');
const {migrate}=require('../src/security/credential-settings');
function protector(){
  const key=crypto.randomBytes(32);let enabled=true;
  return {set enabled(value){enabled=value;},async isAsyncEncryptionAvailable(){return enabled;},getSelectedStorageBackend(){return 'gnome_libsecret';},
    async encryptStringAsync(text){const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key,iv);return Buffer.concat([iv,cipher.update(text,'utf8'),cipher.final(),cipher.getAuthTag()]);},
    async decryptStringAsync(bytes){const decipher=crypto.createDecipheriv('aes-256-gcm',key,bytes.subarray(0,12));decipher.setAuthTag(bytes.subarray(-16));return {result:Buffer.concat([decipher.update(bytes.subarray(12,-16)),decipher.final()]).toString('utf8'),shouldReEncrypt:false};}
  };
}
async function fixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'duo-credentials-'));t.after(()=>{assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir(),'duo-credentials-')));return fs.rm(root,{recursive:true,force:true});});const safeStorage=protector(),store=createCredentialStore({root:path.join(root,'credentials'),safeStorage,platform:'win32'});return {root,store,safeStorage,secret:crypto.randomUUID()};}

test('protected records contain encrypted secrets and expose only metadata',async t=>{
  const {root,store,secret}=await fixture(t),meta=await store.save({provider:'custom',url:'https://example.test/v1',secret});
  const raw=await fs.readFile(path.join(root,'credentials',meta.ref+'.json'),'utf8');
  assert.equal(raw.includes(secret),false);assert.equal(JSON.stringify(await store.status(meta.ref)).includes(secret),false);
  assert.equal(await store.resolve(meta.ref,{provider:'custom',url:'https://example.test/another'}),secret);
  await assert.rejects(store.resolve(meta.ref,{provider:'custom',url:'https://other.test'}),/another provider or origin/);
  await assert.rejects(store.resolve(meta.ref,{provider:'other',url:'https://example.test'}),/another provider or origin/);
  assert.equal(store.redact('Authorization: Bearer '+secret).includes(secret),false);
});

test('encrypted binding prevents tampering with a record origin',async t=>{
  const {root,store,secret}=await fixture(t),meta=await store.save({provider:'custom',url:'https://example.test',secret});
  const file=path.join(root,'credentials',meta.ref+'.json'),record=JSON.parse(await fs.readFile(file,'utf8'));record.origin='https://other.test';await fs.writeFile(file,JSON.stringify(record));
  await assert.rejects(store.resolve(meta.ref,{provider:'custom',url:'https://other.test'}),/could not be decrypted/);
});

test('unavailable protection requires explicit session storage and a new store cannot recover a session key',async t=>{
  const {root,store,safeStorage,secret}=await fixture(t);safeStorage.enabled=false;
  await assert.rejects(store.save({provider:'custom',url:'https://example.test',secret}),/session-only/);
  assert.deepEqual(await fs.readdir(root),[]);
  const meta=await store.save({provider:'custom',url:'https://example.test',secret,persist:false});assert.equal(meta.mode,'session');
  assert.equal(await store.resolve(meta.ref,{provider:'custom',url:'https://example.test'}),secret);
  const restarted=createCredentialStore({root:path.join(root,'credentials'),safeStorage});await assert.rejects(restarted.status(meta.ref),/unavailable/);
  await store.remove(meta.ref);await assert.rejects(store.status(meta.ref),/unavailable/);
});

test('failed protected replacement preserves an existing key; removal makes it unusable',async t=>{
  const {store,safeStorage,secret}=await fixture(t),meta=await store.save({provider:'custom',url:'https://example.test',secret});
  safeStorage.enabled=false;await assert.rejects(store.save({provider:'custom',url:'https://example.test',secret:crypto.randomUUID()}));safeStorage.enabled=true;
  assert.equal(await store.resolve(meta.ref,{provider:'custom',url:'https://example.test'}),secret);
  await store.remove(meta.ref);await assert.rejects(store.resolve(meta.ref,{provider:'custom',url:'https://example.test'}),/unavailable/);
});

test('settings migration commits an opaque reference only after verified storage and preserves plaintext on failure',async t=>{
  const {store,secret}=await fixture(t),original={provider:'custom',url:'https://example.test/v1',key:secret};let serialized=JSON.stringify(original),saved=false;
  const result=await migrate(original,{save:async input=>{const credential=await store.save(input);saved=true;return {ok:true,credential};},persist:value=>{assert.equal(saved,true);serialized=JSON.stringify(value);}});
  assert.equal(result.pending,null);assert.equal(serialized.includes(secret),false);assert.equal('key' in JSON.parse(serialized),false);
  serialized=JSON.stringify(original);
  const failed=await migrate(original,{save:async()=>({ok:false}),persist:value=>{serialized=JSON.stringify(value);}});
  assert.equal(serialized,JSON.stringify(original));assert.equal(failed.pending.secret,secret);assert.equal('key' in failed.settings,false);
});

test('connection policy fixes hosted origins, rejects URL credentials and remote HTTP, and preserves local-only voice mode',()=>{
  for(const url of ['http://example.test','https://user:pass@example.test','https://example.test?key=value','ftp://localhost','http://localhost.attacker.test'])assert.throws(()=>connectionPolicy({url}));
  assert.equal(connectionPolicy({url:'http://127.0.0.1:3235/v1'}).loopback,true);
  assert.throws(()=>connectionPolicy({provider:'elevenlabs',url:'https://other.test'}),/official/);
  assert.throws(()=>connectionPolicy({url:'https://example.test',localOnly:true}),/Local-only/);
});

test('credential-bearing redirects never reach another origin',async t=>{
  const {store,secret}=await fixture(t);let secondRequests=0,received=false;
  const second=http.createServer((_req,res)=>{secondRequests++;res.end('{}');});await new Promise(resolve=>second.listen(0,'127.0.0.1',resolve));
  const first=http.createServer((req,res)=>{received=req.headers.authorization==='Bearer '+secret;res.writeHead(302,{Location:'http://127.0.0.1:'+second.address().port+'/stolen'});res.end();});await new Promise(resolve=>first.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{for(const server of [first,second]){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}});
  const url='http://127.0.0.1:'+first.address().port,meta=await store.save({provider:'custom',url,secret,persist:false});
  const request=createConnectionRequest({credentials:store});
  await assert.rejects(request({provider:'custom',url,credentialRef:meta.ref},'/redirect',{redirect:'follow'}));
  assert.equal(received,true);assert.equal(secondRequests,0);
  await assert.rejects(request({provider:'custom',url,credentialRef:meta.ref},'http://127.0.0.1:'+second.address().port),/configured origin/);
  assert.equal(secondRequests,0);
});

test('voice connection records contain references only and local-only policy is rechecked before every request',async t=>{
  const {root,store,secret}=await fixture(t);let calls=0;
  const connections=createVoiceConnections({file:path.join(root,'connections.json'),credentials:store,fetchImpl:async()=>{calls++;return Response.json({});}});
  const meta=await store.save({provider:'custom',url:'https://example.test',secret});
  const config=await connections.save({provider:'custom',baseURL:'https://example.test/v1',credentialRef:meta.ref});
  const route={provider:'custom',connectionId:config.id};await assert.rejects(connections.resolve(route),/Local-only/);
  await connections.setLocalOnly(false);const resolved=await connections.resolve(route);
  await resolved.request('/audio');assert.equal(calls,1);
  await connections.setLocalOnly(true);await assert.rejects(resolved.request('/audio'),/Local-only/);assert.equal(calls,1);
  assert.equal((await fs.readFile(path.join(root,'connections.json'),'utf8')).includes(secret),false);
});

test('failed protected verification never acknowledges a saved key',async t=>{
  const {root,safeStorage,secret}=await fixture(t);
  safeStorage.decryptStringAsync=async()=>({result:'invalid verification',shouldReEncrypt:false});
  const store=createCredentialStore({root:path.join(root,'verification'),safeStorage,platform:'win32'});
  await assert.rejects(store.save({provider:'custom',url:'https://example.test',secret}),/could not be protected and verified/);
  assert.deepEqual(await fs.readdir(path.join(root,'verification')),[]);
});

test('removal waits for in-flight key rotation and cannot leave a resurrected record',async t=>{
  const {root,store,safeStorage,secret}=await fixture(t),meta=await store.save({provider:'custom',url:'https://example.test',secret});
  const decrypt=safeStorage.decryptStringAsync;let release,ready;
  const started=new Promise(resolve=>{ready=resolve;}),gate=new Promise(resolve=>{release=resolve;});
  safeStorage.decryptStringAsync=async bytes=>{const value=await decrypt(bytes);ready();await gate;return {...value,shouldReEncrypt:true};};
  const reading=store.resolve(meta.ref,{provider:'custom',url:'https://example.test'});await started;
  const removing=store.remove(meta.ref);release();await reading;await removing;
  await assert.rejects(fs.stat(path.join(root,'credentials',meta.ref+'.json')),error=>error.code==='ENOENT');
  await assert.rejects(store.status(meta.ref),/unavailable/);
});
