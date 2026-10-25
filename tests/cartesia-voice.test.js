'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {createVoiceService}=require('../src/voice/voice-service');
const {createSpeechService}=require('../src/speech/speech-service');
const {createConnectionRequest}=require('../src/security/connection-request');
const {createVoiceConnections}=require('../src/security/voice-connections');
const {normalizeVoiceRoute}=require('../src/voice/voice-route');
const origin='https://api.cartesia.ai',secret='synthetic-cartesia-secret-not-an-account';
const route={schemaVersion:1,provider:'cartesia',connectionId:'fixture-connection',modelId:'fixture-model.6',voices:{momotamu:'voice_momo',vivi:'voice_vivi'}};
const request={id:'cartesia-request-123',actor:'vivi',text:'**Synthetic** spoken text.',language:'English',voiceRoute:route};
const model={id:'fixture-model.6',capability:'tts'};
const pcm=Buffer.from([1,0,2,0,3,0,4,0,5,0,6,0,7,0,8,0]);
const json=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
function fixture({handler,cartesiaOptions,connectionOverrides}={}){
  const calls=[];
  const bound=createConnectionRequest({credentials:{resolve:async(ref,binding)=>{assert.equal(ref,'fixture-secret');assert.deepEqual(binding,{provider:'cartesia',url:origin});return secret;}},fetchImpl:async(url,init)=>{
    const target=new URL(url);assert.equal(target.origin,origin);assert.equal(init.redirect,'error');assert.equal(init.headers.get('Authorization'),'Bearer '+secret);assert.equal(init.headers.has('xi-api-key'),false);assert.equal(init.headers.get('Cartesia-Version'),'2026-08-14');
    const call={path:target.pathname+target.search,method:init.method||'GET',init};calls.push(call);
    const response=await handler?.(call,calls);if(response)return response;
    if(target.pathname==='/models')return json({data:[model,{id:'stt-only',capability:'stt',modes:['batch']}]});
    if(target.pathname==='/voices')return json({data:[{id:'voice_momo',name:'Momotamu test',status:'active',preview_file_url:'https://untrusted.test'},{id:'voice_vivi',name:'Vivi test',status:'active'}],has_more:false});
    if(target.pathname.startsWith('/voices/'))return json({id:target.pathname.split('/').at(-1),name:'Synthetic voice',status:'active'});
    if(call.method==='POST')return new Response(pcm,{headers:{'Content-Type':'application/octet-stream','Content-Length':String(pcm.length)}});
    throw Error('Unexpected fixture request: '+call.path);
  }});
  const connection={provider:'cartesia',baseURL:origin,credentialRef:'fixture-secret',request:(value,init)=>bound({provider:'cartesia',url:origin,credentialRef:'fixture-secret'},value,init),...connectionOverrides};
  const service=createVoiceService({voiceRoot:'unavailable-local-voice-assets',cartesiaOptions,resolveConnection:async()=>connection,fetchImpl:()=>{throw Error('Local VoxCPM2 must not be contacted.');},beforeGenerate:()=>{throw Error('Local runtime must not prepare.');}});
  return {service,connection,calls};
}
test('Cartesia discovery is authenticated, filtered and synthesis-free; routes preserve only a model identifier',async()=>{
  const f=fixture(),health=await f.service.health(undefined,route);
  assert.equal(health.discoveryOnly,true);assert.equal(health.models.length,1);assert.equal(health.apiVersion,'2026-08-14');assert.deepEqual(health.outputFormat,{container:'raw',encoding:'pcm_s16le',sample_rate:24000});
  assert.deepEqual(await f.service.profiles(route),[{id:'voice_momo',label:'Momotamu test'},{id:'voice_vivi',label:'Vivi test'}]);
  assert.ok(f.calls.every(call=>call.method==='GET'));assert.equal(normalizeVoiceRoute(route).modelId,'fixture-model.6');
  for(const value of [{...route,modelId:'https://outside.test'},{...route,modelId:''},{...route,provider:'diy'}])assert.throws(()=>normalizeVoiceRoute(value));
});
test('Cartesia selects both companion voices; Speech replay/export never submits another billable request',async()=>{
  const f=fixture();
  for(const actor of ['momotamu','vivi']){const packets=[],result=await f.service.stream({...request,actor,id:'cartesia-'+actor+'-request'},p=>packets.push(p),11);assert.equal(result.ok,true,result.error);assert.equal(packets[0].type,'start');assert.equal(packets.at(-1).type,'end');assert.deepEqual(Buffer.concat(packets.filter(p=>p.type==='pcm').map(p=>p.bytes)),pcm);assert.equal(packets[0].sampleRate,24000);assert.equal(result.samples,8);}
  assert.ok(f.calls.some(call=>call.method==='POST'&&JSON.parse(call.init.body).voice==='voice_momo'));assert.ok(f.calls.filter(call=>call.method==='POST').every(call=>call.path==='/tts/bytes'));
  const speech=createSpeechService({voiceService:f.service}),take=await speech.generate(request,()=>{},11);assert.equal(take.ok,true,take.error);
  const posts=f.calls.filter(call=>call.method==='POST');assert.equal(posts.length,3);
  assert.deepEqual(JSON.parse(posts[0].init.body),{model_id:'fixture-model.6',transcript:'Synthetic spoken text.',voice:'voice_momo',language:'en',output_format:{container:'raw',encoding:'pcm_s16le',sample_rate:24000}});
  assert.deepEqual(JSON.parse(posts[2].init.body),{model_id:'fixture-model.6',transcript:request.text,voice:'voice_vivi',language:'en',output_format:{container:'raw',encoding:'pcm_s16le',sample_rate:24000}});
  assert.equal((await speech.replay({id:'cartesia-replay-request',replayRecordingId:take.recording.id},()=>{},11)).ok,true);
  assert.equal(speech.audio(take.recording.id,11).bytes.toString('ascii',0,4),'RIFF');assert.equal(f.calls.filter(call=>call.method==='POST').length,3);
});
test('Cartesia model, voice, language, length and unsupported capability errors stop before synthesis',async()=>{
  for(const override of [{voiceRoute:{...route,modelId:undefined}},{voiceRoute:{...route,voices:{}}},{voiceRoute:{...route,modelId:'missing'}},{language:'Unknown language'},{voiceDirection:'Whisper'},{narrationContinuation:true,verbatim:true}]){
    const f=fixture(),result=await f.service.stream({...request,...override},()=>{},11);assert.equal(result.ok,false);assert.equal(f.calls.filter(call=>call.method==='POST').length,0);
  }
  const f=fixture();assert.equal((await f.service.stream({...request,text:'a'.repeat(8001)},()=>{},11)).ok,false);assert.equal(f.calls.length,0);
  const wrong=fixture({handler:call=>call.path.startsWith('/voices/')?json({id:'other_voice',name:'Other',status:'active'}):undefined});
  assert.match((await wrong.service.stream(request,()=>{},11)).error,/different voice/);assert.ok(wrong.calls.every(call=>call.method==='GET'));
  const archived=fixture({handler:call=>call.path.startsWith('/voices/')?json({id:'voice_vivi',name:'Vivi',status:'archived'}):undefined});assert.match((await archived.service.stream(request,()=>{},11)).error,/inactive/);assert.ok(archived.calls.every(call=>call.method==='GET'));
});
test('Cartesia rejects missing credentials and non-root/unofficial connections without fetching',async()=>{
  for(const connectionOverrides of [{credentialRef:undefined},{baseURL:'https://outside.test'},{baseURL:origin+'/custom'},{provider:'diy'}]){
    const f=fixture({connectionOverrides});assert.equal((await f.service.stream(request,()=>{},11)).ok,false);assert.equal(f.calls.length,0);
  }
});
test('Cartesia sends the selected supported UI language without adding delivery instructions or extra transcript context',async()=>{
  for(const [language,code] of [['English','en'],['Swedish','sv'],['Japanese','ja'],['German','de'],['Arabic','ar'],['French','fr']]){
    const f=fixture(),text='Literal source: [[voice: this stays literal]]';
    const result=await f.service.stream({...request,language,text,verbatim:true},()=>{},11);assert.equal(result.ok,true,result.error);
    const body=JSON.parse(f.calls.find(call=>call.method==='POST').init.body);assert.equal(body.language,code);assert.equal(body.transcript,text);assert.equal('generation_config' in body,false);assert.equal('locale' in body,false);
  }
});
test('Cartesia bounds catalog bytes and page count before synthesis',async()=>{
  let cancelled=false;
  const oversized=fixture({handler:call=>call.path.startsWith('/models?')?new Response(new ReadableStream({cancel(){cancelled=true;}}),{headers:{'Content-Length':'999999999'}}):undefined});
  await assert.rejects(oversized.service.health(undefined,route),/size limit/);assert.equal(cancelled,true);assert.ok(oversized.calls.every(call=>call.method==='GET'));
  let page=0;const endless=fixture({handler:call=>call.path.startsWith('/voices?')?json({data:[],has_more:true,next_page:'page-'+(++page)}):undefined});
  await assert.rejects(endless.service.profiles(route),/ten pages/);assert.equal(endless.calls.length,10);
});
test('Cartesia voice pagination sanitizes metadata and rejects repeated page tokens',async()=>{
  const f=fixture({handler:call=>call.path.startsWith('/voices?')?json(call.path.includes('starting_after=')?{data:[{id:'second',name:'Second',status:'active'}],has_more:false}:{data:[{id:'first',name:'First',status:'active',samples:[{secret:'not returned'}]}],has_more:true,next_page:'cursor-voice'}):undefined});
  assert.deepEqual(await f.service.profiles(route),[{id:'first',label:'First'},{id:'second',label:'Second'}]);assert.match(f.calls[1].path,/starting_after=cursor-voice/);
  const repeated=fixture({handler:call=>call.path.startsWith('/voices?')?json({data:[],has_more:true,next_page:'same'}):undefined});await assert.rejects(repeated.service.profiles(route),/repeated/);assert.equal(repeated.calls.length,2);
  const external=fixture({handler:call=>call.path.startsWith('/voices?')?json({data:[],has_more:true,next_page:'https://outside.test/voices'}):undefined});await assert.rejects(external.service.profiles(route),/invalid/);assert.equal(external.calls.length,1);
});
test('Cartesia maps auth, access, missing voice, quota and upstream errors without leaking response bodies or retrying',async()=>{
  for(const status of [400,401,403,404,422,429,500]){
    const f=fixture({handler:call=>call.method==='POST'?new Response(secret+' provider-private-body',{status}):undefined}),packets=[];
    const result=await f.service.stream(request,p=>packets.push(p),11);assert.equal(result.ok,false);assert.equal(result.submitted,true);assert.equal(f.calls.filter(call=>call.method==='POST').length,1);assert.ok(!JSON.stringify({result,packets}).includes(secret));assert.equal(packets.some(p=>p.type==='end'),false);
  }
});
test('Cartesia rejects compressed, empty, truncated and oversized output without caching a replay take',async()=>{
  for(const response of [()=>new Response('compressed',{headers:{'Content-Type':'audio/mpeg'}}),()=>new Response('RIFF12345678WAVE',{headers:{'Content-Type':'application/octet-stream'}}),()=>new Response(new Uint8Array(),{headers:{'Content-Type':'audio/pcm'}}),()=>new Response(new Uint8Array([1,2,3]),{headers:{'Content-Type':'audio/pcm'}}),()=>new Response(pcm,{headers:{'Content-Type':'audio/pcm','Content-Length':'18'}}),()=>new Response(pcm,{headers:{'Content-Type':'audio/pcm','Content-Length':'999999999'}})]){
    const f=fixture({handler:call=>call.method==='POST'?response():undefined}),speech=createSpeechService({voiceService:f.service});
    const take=await speech.generate(request,()=>{},11);assert.equal(take.ok,false);assert.equal(take.recording,undefined);assert.equal(f.calls.filter(call=>call.method==='POST').length,1);
  }
});
test('Cartesia assembles odd packet boundaries and rejects a broken read without retry',async()=>{
  for(const broken of [false,true]){
    let index=0;const f=fixture({handler:call=>call.method==='POST'?new Response(new ReadableStream({pull(controller){if(index===0){controller.enqueue(pcm.subarray(0,3));index++;}else if(index===1){controller.enqueue(pcm.subarray(3));index++;}else if(broken)controller.error(Error(secret));else controller.close();}}),{headers:{'Content-Type':'audio/pcm'}}):undefined}),packets=[];
    const result=await f.service.stream(request,p=>packets.push(p),11);assert.equal(result.ok,!broken);assert.equal(f.calls.filter(call=>call.method==='POST').length,1);assert.ok(!JSON.stringify(result).includes(secret));if(!broken)assert.deepEqual(Buffer.concat(packets.filter(p=>p.type==='pcm').map(p=>p.bytes)),pcm);
  }
});
test('Cartesia rejects invalid discovery metadata and sanitizes transport errors before any synthesis',async()=>{
  for(const value of [{models:{}},{models:{data:[{capability:'tts',id:'../bad'}]}},{models:{data:[model,model]}},{voices:{data:[],has_more:'yes'}}]){
    const f=fixture({handler:call=>call.path.startsWith('/models?')&&value.models?json(value.models):call.path.startsWith('/voices?')&&value.voices?json(value.voices):undefined});await assert.rejects(f.service.health(undefined,route),/invalid/);assert.ok(f.calls.every(call=>call.method==='GET'));
  }
  const f=fixture({handler:()=>{throw Error(secret);}});await assert.rejects(f.service.health(undefined,route),error=>!error.message.includes(secret)&&/discovery failed/.test(error.message));await assert.rejects(f.service.profiles(route),error=>!error.message.includes(secret));
});
test('Cartesia Stop wakes backpressure, fences late data and aborts only the active owner',async()=>{
  let arrived,cancelled=false;const first=new Promise(resolve=>{arrived=resolve;});
  const f=fixture({cartesiaOptions:{bufferSeconds:.0001},handler:call=>call.method==='POST'?new Response(new ReadableStream({start(controller){controller.enqueue(Buffer.alloc(32000,1));},cancel(){cancelled=true;}}),{headers:{'Content-Type':'audio/pcm'}}):undefined}),packets=[];
  const running=f.service.stream(request,p=>{packets.push(p);if(p.type==='pcm')arrived();},11);await first;
  assert.equal(f.service.cancel(request.id,22).cancelled,false);assert.equal((await f.service.stream({...request,id:'cartesia-other-request'},()=>{},11)).ok,false);
  assert.equal(f.service.cancel(request.id,11).cancelled,true);const result=await running;assert.equal(result.cancelled,true);assert.equal(result.providerCancellationConfirmed,false);assert.equal(cancelled,true);assert.equal(f.service.busy,false);assert.equal(packets.some(p=>p.type==='end'),false);assert.equal(f.calls.filter(call=>call.method==='POST').length,1);
});
test('Cartesia playback acknowledgements resume a bounded producer; wrong-owner acknowledgements do not',async()=>{
  let arrived;const first=new Promise(resolve=>{arrived=resolve;});const f=fixture({cartesiaOptions:{bufferSeconds:.0001}}),packets=[];
  const running=f.service.stream(request,p=>{packets.push(p);if(p.type==='pcm')arrived();},11);await first;
  f.service.consumed(request.id,9999,22);await new Promise(resolve=>setImmediate(resolve));assert.equal(f.service.busy,true);
  // The initial header probe emits 12 bytes, then the remaining four after ack.
  f.service.consumed(request.id,6,11);await new Promise(resolve=>setImmediate(resolve));f.service.consumed(request.id,2,11);
  assert.equal((await running).ok,true);assert.equal(packets.at(-1).type,'end');
});
test('Cartesia timeout aborts an in-flight synthesis once and never reports provider billing cancellation',async()=>{
  const f=fixture({cartesiaOptions:{timeoutMs:35},handler:call=>call.method==='POST'?new Promise((resolve,reject)=>call.init.signal.addEventListener('abort',()=>reject(Error('synthetic aborted')),{once:true})):undefined});
  const result=await f.service.stream(request,()=>{},11);assert.equal(result.ok,false);assert.match(result.error,/timed out/);assert.equal(result.cancelled,false);assert.equal(result.providerCancellationConfirmed,false);assert.equal(f.calls.filter(call=>call.method==='POST').length,1);
});
test('Cartesia pre-submit Stop prevents a billable POST after delayed model discovery',async()=>{
  let release,entered;const waiting=new Promise(resolve=>{entered=resolve;}),f=fixture({handler:call=>call.path.startsWith('/models?')?new Promise(resolve=>{release=()=>resolve(json({data:[model]}));entered();}):undefined});
  const running=f.service.stream(request,()=>{},11);await waiting;f.service.cancel(request.id,11);release();assert.equal((await running).cancelled,true);assert.equal(f.calls.filter(call=>call.method==='POST').length,0);
});
test('local-only policy blocks Cartesia before any request and every call rechecks a removed connection',async t=>{
  const folder=await fs.mkdtemp(path.join(os.tmpdir(),'duo-cartesia-policy-'));t.after(()=>fs.rm(folder,{recursive:true,force:true}));let count=0;
  const connections=createVoiceConnections({file:path.join(folder,'connections.json'),credentials:{status:async()=>({provider:'cartesia',origin}),resolve:async()=>secret},fetchImpl:async()=>{count++;return json([]);}});
  const saved=await connections.save({provider:'cartesia',baseURL:origin,credentialRef:'fixture-secret'}),selected={...route,connectionId:saved.id};
  await assert.rejects(connections.resolve(selected),/Local-only/);assert.equal(count,0);
  await connections.setLocalOnly(false);const connection=await connections.resolve(selected);await connection.request('v1/models');assert.equal(count,1);
  await connections.setLocalOnly(true);await assert.rejects(connection.request('v1/models'),/Local-only/);await connections.setLocalOnly(false);await connections.remove(saved.id);await assert.rejects(connection.request('v1/models'),/removed/);assert.equal(count,1);
});
