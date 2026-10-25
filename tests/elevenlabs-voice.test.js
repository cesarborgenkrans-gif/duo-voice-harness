'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {createVoiceService}=require('../src/voice/voice-service');
const {createSpeechService}=require('../src/speech/speech-service');
const {createConnectionRequest}=require('../src/security/connection-request');
const {createVoiceConnections}=require('../src/security/voice-connections');
const {normalizeVoiceRoute}=require('../src/voice/voice-route');
const origin='https://api.elevenlabs.io',secret='synthetic-elevenlabs-secret-not-an-account';
const route={schemaVersion:1,provider:'elevenlabs',connectionId:'fixture-connection',modelId:'fixture_model',voices:{momotamu:'voice_momo',vivi:'voice_vivi'}};
const request={id:'eleven-request-123',actor:'vivi',text:'**Synthetic** spoken text.',language:'English',voiceRoute:route};
const model={model_id:'fixture_model',name:'Synthetic model',can_do_text_to_speech:true,languages:[{language_id:'en'},{language_id:'sv'},{language_id:'ja'}],maximum_text_length_per_request:8000};
const pcm=Buffer.from([1,0,2,0,3,0,4,0,5,0,6,0,7,0,8,0]);
const json=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
function fixture({handler,elevenLabsOptions,connectionOverrides}={}){
  const calls=[];
  const bound=createConnectionRequest({credentials:{resolve:async(ref,binding)=>{assert.equal(ref,'fixture-secret');assert.deepEqual(binding,{provider:'elevenlabs',url:origin});return secret;}},fetchImpl:async(url,init)=>{
    const target=new URL(url);assert.equal(target.origin,origin);assert.equal(init.redirect,'error');assert.equal(init.headers.get('xi-api-key'),secret);assert.equal(init.headers.has('Authorization'),false);
    const call={path:target.pathname+target.search,method:init.method||'GET',init};calls.push(call);
    const response=await handler?.(call,calls);if(response)return response;
    if(target.pathname==='/v1/models')return json([model,{model_id:'conversion_only',can_do_text_to_speech:false}]);
    if(target.pathname==='/v2/voices')return json({voices:[{voice_id:'voice_momo',name:'Momotamu test',preview_url:'https://untrusted.test'},{voice_id:'voice_vivi',name:'Vivi test'}],has_more:false});
    if(target.pathname.startsWith('/v1/voices/'))return json({voice_id:target.pathname.split('/').at(-1),name:'Synthetic voice'});
    if(call.method==='POST')return new Response(pcm,{headers:{'Content-Type':'application/octet-stream','Content-Length':String(pcm.length)}});
    throw Error('Unexpected fixture request: '+call.path);
  }});
  const connection={provider:'elevenlabs',baseURL:origin,credentialRef:'fixture-secret',request:(value,init)=>bound({provider:'elevenlabs',url:origin,credentialRef:'fixture-secret'},value,init),...connectionOverrides};
  const service=createVoiceService({voiceRoot:'unavailable-local-voice-assets',elevenLabsOptions,resolveConnection:async()=>connection,fetchImpl:()=>{throw Error('Local VoxCPM2 must not be contacted.');},beforeGenerate:()=>{throw Error('Local runtime must not prepare.');}});
  return {service,connection,calls};
}
test('ElevenLabs discovery is authenticated, filtered and synthesis-free; routes preserve only a model identifier',async()=>{
  const f=fixture(),health=await f.service.health(undefined,route);
  assert.equal(health.discoveryOnly,true);assert.equal(health.models.length,1);assert.equal(health.outputFormat,'pcm_24000');
  assert.deepEqual(await f.service.profiles(route),[{id:'voice_momo',label:'Momotamu test'},{id:'voice_vivi',label:'Vivi test'}]);
  assert.ok(f.calls.every(call=>call.method==='GET'));assert.equal(normalizeVoiceRoute(route).modelId,'fixture_model');
  for(const value of [{...route,modelId:'https://outside.test'},{...route,modelId:''},{...route,provider:'diy'}])assert.throws(()=>normalizeVoiceRoute(value));
});
test('ElevenLabs selects both companion voices; Speech replay/export never submits another billable request',async()=>{
  const f=fixture();
  for(const actor of ['momotamu','vivi']){const packets=[],result=await f.service.stream({...request,actor,id:'eleven-'+actor+'-request'},p=>packets.push(p),11);assert.equal(result.ok,true,result.error);assert.equal(packets[0].type,'start');assert.equal(packets.at(-1).type,'end');assert.deepEqual(Buffer.concat(packets.filter(p=>p.type==='pcm').map(p=>p.bytes)),pcm);assert.equal(packets[0].sampleRate,24000);assert.equal(result.samples,8);}
  assert.ok(f.calls.some(call=>call.path.includes('/voice_momo/stream?output_format=pcm_24000')));
  const speech=createSpeechService({voiceService:f.service}),take=await speech.generate(request,()=>{},11);assert.equal(take.ok,true,take.error);
  const posts=f.calls.filter(call=>call.method==='POST');assert.equal(posts.length,3);
  assert.deepEqual(JSON.parse(posts[0].init.body),{text:'Synthetic spoken text.',model_id:'fixture_model'});
  assert.deepEqual(JSON.parse(posts[2].init.body),{text:request.text,model_id:'fixture_model'});
  assert.equal((await speech.replay({id:'eleven-replay-request',replayRecordingId:take.recording.id},()=>{},11)).ok,true);
  assert.equal(speech.audio(take.recording.id,11).bytes.toString('ascii',0,4),'RIFF');assert.equal(f.calls.filter(call=>call.method==='POST').length,3);
});
test('ElevenLabs model, voice, language, length and unsupported capability errors stop before synthesis',async()=>{
  for(const override of [{voiceRoute:{...route,modelId:undefined}},{voiceRoute:{...route,voices:{}}},{voiceRoute:{...route,modelId:'missing'}},{language:'German'},{voiceDirection:'Whisper'},{narrationContinuation:true,verbatim:true}]){
    const f=fixture(),result=await f.service.stream({...request,...override},()=>{},11);assert.equal(result.ok,false);assert.equal(f.calls.filter(call=>call.method==='POST').length,0);
  }
  const f=fixture({handler:call=>call.path==='/v1/models'?json([{...model,maximum_text_length_per_request:2}]):undefined});
  assert.match((await f.service.stream(request,()=>{},11)).error,/fewer characters/);assert.ok(f.calls.every(call=>call.method==='GET'));
  const wrong=fixture({handler:call=>call.path.startsWith('/v1/voices/')?json({voice_id:'other_voice',name:'Other'}):undefined});
  assert.match((await wrong.service.stream(request,()=>{},11)).error,/different voice/);assert.ok(wrong.calls.every(call=>call.method==='GET'));
});
test('ElevenLabs rejects missing credentials and non-root/unofficial connections without fetching',async()=>{
  for(const connectionOverrides of [{credentialRef:undefined},{baseURL:'https://outside.test'},{baseURL:origin+'/custom'},{provider:'diy'}]){
    const f=fixture({connectionOverrides});assert.equal((await f.service.stream(request,()=>{},11)).ok,false);assert.equal(f.calls.length,0);
  }
});

test('ElevenLabs accepts languages beyond the original three only when the model advertises them, including Filipino and Cantonese codes',async()=>{
  for(const [language,code,text] of [['German','de','Guten Tag.'],['French','fr','Bonjour.'],['Tagalog','fil','Kumusta.'],['Cantonese','yue','你好。']]){
    const f=fixture({handler:call=>call.path==='/v1/models'?json([{...model,languages:[{language_id:code}]}]):undefined});
    const result=await f.service.stream({...request,language,text},()=>{},11);assert.equal(result.ok,true,result.error);assert.equal(f.calls.filter(call=>call.method==='POST').length,1);
    assert.equal(JSON.parse(f.calls.find(call=>call.method==='POST').init.body).text,text);
  }
});
test('ElevenLabs voice pagination sanitizes metadata and rejects repeated page tokens',async()=>{
  const f=fixture({handler:call=>call.path.startsWith('/v2/voices')?json(call.path.includes('next_page_token=')?{voices:[{voice_id:'second',name:'Second'}],has_more:false}:{voices:[{voice_id:'first',name:'First',samples:[{secret:'not returned'}]}],has_more:true,next_page_token:'safe /? token'}):undefined});
  assert.deepEqual(await f.service.profiles(route),[{id:'first',label:'First'},{id:'second',label:'Second'}]);assert.match(f.calls[1].path,/next_page_token=safe\+%2F%3F\+token/);
  const repeated=fixture({handler:call=>call.path.startsWith('/v2/voices')?json({voices:[],has_more:true,next_page_token:'same'}):undefined});await assert.rejects(repeated.service.profiles(route),/repeated/);assert.equal(repeated.calls.length,2);
});
test('ElevenLabs maps auth, access, missing voice, quota and upstream errors without leaking response bodies or retrying',async()=>{
  for(const status of [401,403,404,422,429,500]){
    const f=fixture({handler:call=>call.method==='POST'?new Response(secret+' provider-private-body',{status}):undefined}),packets=[];
    const result=await f.service.stream(request,p=>packets.push(p),11);assert.equal(result.ok,false);assert.equal(result.submitted,true);assert.equal(f.calls.filter(call=>call.method==='POST').length,1);assert.ok(!JSON.stringify({result,packets}).includes(secret));assert.equal(packets.some(p=>p.type==='end'),false);
  }
});
test('ElevenLabs rejects compressed, empty, truncated and oversized output without caching a replay take',async()=>{
  for(const response of [()=>new Response('compressed',{headers:{'Content-Type':'audio/mpeg'}}),()=>new Response('RIFF12345678WAVE',{headers:{'Content-Type':'application/octet-stream'}}),()=>new Response(new Uint8Array(),{headers:{'Content-Type':'audio/pcm'}}),()=>new Response(new Uint8Array([1,2,3]),{headers:{'Content-Type':'audio/pcm'}}),()=>new Response(pcm,{headers:{'Content-Type':'audio/pcm','Content-Length':'18'}}),()=>new Response(pcm,{headers:{'Content-Type':'audio/pcm','Content-Length':'999999999'}})]){
    const f=fixture({handler:call=>call.method==='POST'?response():undefined}),speech=createSpeechService({voiceService:f.service});
    const take=await speech.generate(request,()=>{},11);assert.equal(take.ok,false);assert.equal(take.recording,undefined);assert.equal(f.calls.filter(call=>call.method==='POST').length,1);
  }
});
test('ElevenLabs assembles odd packet boundaries and rejects a broken read without retry',async()=>{
  for(const broken of [false,true]){
    let index=0;const f=fixture({handler:call=>call.method==='POST'?new Response(new ReadableStream({pull(controller){if(index===0){controller.enqueue(pcm.subarray(0,3));index++;}else if(index===1){controller.enqueue(pcm.subarray(3));index++;}else if(broken)controller.error(Error(secret));else controller.close();}}),{headers:{'Content-Type':'audio/pcm'}}):undefined}),packets=[];
    const result=await f.service.stream(request,p=>packets.push(p),11);assert.equal(result.ok,!broken);assert.equal(f.calls.filter(call=>call.method==='POST').length,1);assert.ok(!JSON.stringify(result).includes(secret));if(!broken)assert.deepEqual(Buffer.concat(packets.filter(p=>p.type==='pcm').map(p=>p.bytes)),pcm);
  }
});
test('ElevenLabs rejects invalid discovery metadata and sanitizes transport errors before any synthesis',async()=>{
  for(const value of [{models:{}},{models:[{...model,languages:[{language_id:'not-a-language'}]}]},{models:[{...model,maximum_text_length_per_request:-1}]},{models:[model,model]},{voices:{voices:[],has_more:'yes'}}]){
    const f=fixture({handler:call=>call.path==='/v1/models'&&value.models?json(value.models):call.path.startsWith('/v2/voices')&&value.voices?json(value.voices):undefined});await assert.rejects(f.service.health(undefined,route),/invalid/);assert.ok(f.calls.every(call=>call.method==='GET'));
  }
  const f=fixture({handler:()=>{throw Error(secret);}});await assert.rejects(f.service.health(undefined,route),error=>!error.message.includes(secret)&&/discovery failed/.test(error.message));await assert.rejects(f.service.profiles(route),error=>!error.message.includes(secret));
});
test('ElevenLabs Stop wakes backpressure, fences late data and aborts only the active owner',async()=>{
  let arrived,cancelled=false;const first=new Promise(resolve=>{arrived=resolve;});
  const f=fixture({elevenLabsOptions:{bufferSeconds:.0001},handler:call=>call.method==='POST'?new Response(new ReadableStream({start(controller){controller.enqueue(Buffer.alloc(32000,1));},cancel(){cancelled=true;}}),{headers:{'Content-Type':'audio/pcm'}}):undefined}),packets=[];
  const running=f.service.stream(request,p=>{packets.push(p);if(p.type==='pcm')arrived();},11);await first;
  assert.equal(f.service.cancel(request.id,22).cancelled,false);assert.equal((await f.service.stream({...request,id:'eleven-other-request'},()=>{},11)).ok,false);
  assert.equal(f.service.cancel(request.id,11).cancelled,true);const result=await running;assert.equal(result.cancelled,true);assert.equal(result.providerCancellationConfirmed,false);assert.equal(cancelled,true);assert.equal(f.service.busy,false);assert.equal(packets.some(p=>p.type==='end'),false);assert.equal(f.calls.filter(call=>call.method==='POST').length,1);
});
test('ElevenLabs playback acknowledgements resume a bounded producer; wrong-owner acknowledgements do not',async()=>{
  let arrived;const first=new Promise(resolve=>{arrived=resolve;});const f=fixture({elevenLabsOptions:{bufferSeconds:.0001}}),packets=[];
  const running=f.service.stream(request,p=>{packets.push(p);if(p.type==='pcm')arrived();},11);await first;
  f.service.consumed(request.id,9999,22);await new Promise(resolve=>setImmediate(resolve));assert.equal(f.service.busy,true);
  // The initial header probe emits 12 bytes, then the remaining four after ack.
  f.service.consumed(request.id,6,11);await new Promise(resolve=>setImmediate(resolve));f.service.consumed(request.id,2,11);
  assert.equal((await running).ok,true);assert.equal(packets.at(-1).type,'end');
});
test('ElevenLabs timeout aborts an in-flight synthesis once and never reports provider billing cancellation',async()=>{
  const f=fixture({elevenLabsOptions:{timeoutMs:35},handler:call=>call.method==='POST'?new Promise((resolve,reject)=>call.init.signal.addEventListener('abort',()=>reject(Error('synthetic aborted')),{once:true})):undefined});
  const result=await f.service.stream(request,()=>{},11);assert.equal(result.ok,false);assert.match(result.error,/timed out/);assert.equal(result.cancelled,false);assert.equal(result.providerCancellationConfirmed,false);assert.equal(f.calls.filter(call=>call.method==='POST').length,1);
});
test('ElevenLabs pre-submit Stop prevents a billable POST after delayed model discovery',async()=>{
  let release,entered;const waiting=new Promise(resolve=>{entered=resolve;}),f=fixture({handler:call=>call.path==='/v1/models'?new Promise(resolve=>{release=()=>resolve(json([model]));entered();}):undefined});
  const running=f.service.stream(request,()=>{},11);await waiting;f.service.cancel(request.id,11);release();assert.equal((await running).cancelled,true);assert.equal(f.calls.filter(call=>call.method==='POST').length,0);
});
test('local-only policy blocks ElevenLabs before any request and every call rechecks a removed connection',async t=>{
  const folder=await fs.mkdtemp(path.join(os.tmpdir(),'duo-eleven-policy-'));t.after(()=>fs.rm(folder,{recursive:true,force:true}));let count=0;
  const connections=createVoiceConnections({file:path.join(folder,'connections.json'),credentials:{status:async()=>({provider:'elevenlabs',origin}),resolve:async()=>secret},fetchImpl:async()=>{count++;return json([]);}});
  const saved=await connections.save({provider:'elevenlabs',baseURL:origin,credentialRef:'fixture-secret'}),selected={...route,connectionId:saved.id};
  await assert.rejects(connections.resolve(selected),/Local-only/);assert.equal(count,0);
  await connections.setLocalOnly(false);const connection=await connections.resolve(selected);await connection.request('v1/models');assert.equal(count,1);
  await connections.setLocalOnly(true);await assert.rejects(connection.request('v1/models'),/Local-only/);await connections.setLocalOnly(false);await connections.remove(saved.id);await assert.rejects(connection.request('v1/models'),/removed/);assert.equal(count,1);
});
