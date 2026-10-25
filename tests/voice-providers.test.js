'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createVoiceService}=require('../src/voice/voice-service');
const {normalizeVoiceRoute}=require('../src/voice/voice-route');
const {createSpeechService}=require('../src/speech/speech-service');
const {createGpuBudget,GiB}=require('../src/models/gpu-budget');

const route={schemaVersion:1,provider:'fixture-external',connectionId:'fixture-connection',voices:{vivi:'fixture-voice'}};
const request={id:'provider-request-123',actor:'vivi',text:'**Hello** there.',language:'English',voiceRoute:route};
const start={type:'start',sampleRate:24000,channels:1,format:'pcm_s16le'};
const pcm={type:'pcm',bytes:new Uint8Array([1,0,2,0])};
function adapter(stream){return {id:'fixture-external',label:'Synthetic external provider',contractVersion:1,
  capabilities:{streaming:true,sessionOnly:true,requiresLocalRuntime:false,voiceDirection:false,narrationContinuation:false},
  cancel(){},consumed(){},stream:stream||async function(opts,emit){emit(start);emit(pcm);emit({type:'end'});return {ok:true};}
};}
function service(provider){return createVoiceService({voiceRoot:'unavailable-local-reference-folder',resolveConnection:async()=>({fixture:true}),adapters:[provider],fetchImpl:async()=>{throw Error('Local HTTP must not run for an external provider.');},beforeGenerate:()=>{throw Error('Local GPU preparation must not run.');}});}

test('routes are versioned identifiers, default to VoxCPM2, and reject credential/address fields',()=>{
  assert.equal(normalizeVoiceRoute().provider,'voxcpm2');
  const normalized=normalizeVoiceRoute(route);normalized.voices.vivi='changed';assert.equal(route.voices.vivi,'fixture-voice');
  for(const value of [null,{...route,schemaVersion:2},{...route,apiKey:'synthetic-value'},{...route,url:'http://example.test'},{...route,voices:{unknown:'id'}},{...route,connectionId:'../outside'}])assert.throws(()=>normalizeVoiceRoute(value));
  const voice=service(adapter());assert.equal(voice.describe().id,'voxcpm2');assert.equal(voice.providers().length,5);
  assert.equal(voice.describe(route).capabilities.requiresLocalRuntime,false);
  assert.throws(()=>createVoiceService({adapters:[adapter(),adapter()]}),/duplicate/);
});

test('an external adapter synthesizes and Speech replays without local references, HTTP, runtime or GPU preparation',async()=>{
  let calls=0,captured;
  const voice=service(adapter(async(opts,emit)=>{calls++;captured=opts;emit(start);emit(pcm);emit({type:'end'});return {ok:true};}));
  const packets=[];const result=await voice.stream(request,p=>packets.push(p),11);
  assert.equal(result.ok,true);assert.equal(result.provider,'fixture-external');
  assert.equal(captured.text,'Hello there.');assert.equal(captured.voiceId,'fixture-voice');assert.equal(captured.voiceRoute.connectionId,'fixture-connection');
  assert.ok(captured.signal instanceof AbortSignal);
  assert.deepEqual(packets.map(p=>p.type),['start','pcm','end']);assert.ok(packets.every(p=>p.id===request.id));
  const speech=createSpeechService({voiceService:voice});
  const take=await speech.generate({...request,text:'**Literal narration**'},()=>{},11);
  assert.equal(take.ok,true);assert.equal(captured.text,'**Literal narration**');
  assert.equal((await speech.replay({id:'replay-fixture-123',replayRecordingId:take.recording.id},()=>{},11)).ok,true);
  assert.equal(calls,2);assert.equal(speech.audio(take.recording.id,11).bytes.toString('ascii',0,4),'RIFF');
});

test('unavailable providers and unsupported delivery options fail before generation without fallback',async()=>{
  let calls=0;const voice=service(adapter(async()=>{calls++;return {ok:true};}));
  for(const opts of [{...request,voiceRoute:{schemaVersion:1,provider:'not-installed'}},{...request,voiceRoute:{schemaVersion:1,provider:'fixture-external'}},{...request,voiceDirection:'Softly'},{...request,verbatim:true,narrationContinuation:true}]){
    assert.equal((await voice.stream(opts,()=>{},11)).ok,false);
  }
  assert.equal(calls,0);
});

test('the shared boundary rejects compressed/stereo PCM, ordering errors, truncated audio and false success',async()=>{
  for(const sequence of [
    [{...start,format:'mp3'},pcm,{type:'end'}],
    [{...start,channels:2},pcm,{type:'end'}],
    [pcm,start,{type:'end'}],
    [start,{type:'pcm',bytes:new Uint8Array([1])},{type:'end'}],
    [start,pcm],
    [start,pcm,{type:'error',error:'Synthetic provider failure'}],
    [{...start,id:'different-request'},pcm,{type:'end'}]
  ]){
    const packets=[];const voice=service(adapter(async(opts,emit)=>{for(const packet of sequence)emit(packet);return {ok:true};}));
    const result=await voice.stream(request,p=>packets.push(p),11);
    assert.equal(result.ok,false);assert.ok(packets.some(p=>p.type==='error'));
    assert.equal(voice.busy,false);
  }
});

test('cancellation is owner-scoped, fences late audio, and holds the lane until adapter cleanup settles',async()=>{
  let release,finish,captured,cancelled=0;
  const pending=new Promise(resolve=>{release=resolve;}),cleanup=new Promise(resolve=>{finish=resolve;});
  const external=adapter(async(opts,emit)=>{captured=opts;emit(start);emit(pcm);await pending;emit(pcm);emit({type:'end'});await cleanup;return {ok:true};});
  external.cancel=()=>{cancelled++;release();};
  const voice=service(external),packets=[];
  const running=voice.stream(request,p=>packets.push(p),11);
  assert.equal(voice.cancel(request.id,22).cancelled,false);
  assert.equal((await voice.stream({...request,id:'other-request-123'},()=>{},11)).ok,false);
  assert.equal(voice.cancel(request.id,11).cancelled,true);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(captured.signal.aborted,true);assert.equal(voice.busy,true);assert.equal(cancelled,1);
  assert.deepEqual(packets.map(p=>p.type),['start','pcm']);
  finish();assert.equal((await running).cancelled,true);assert.equal(voice.busy,false);
});

test('backpressure acknowledgements reach only the active request owner',async()=>{
  let release;const waiting=new Promise(resolve=>{release=resolve;}),acknowledgements=[];
  const external=adapter(async(opts,emit)=>{emit(start);emit(pcm);await waiting;emit({type:'end'});return {ok:true};});
  external.consumed=(id,samples,owner)=>{acknowledgements.push({id,samples,owner});release();};
  const voice=service(external),running=voice.stream(request,()=>{},11);
  voice.consumed(request.id,2,22);voice.consumed(request.id,-1,11);voice.consumed('other-request',2,11);
  assert.deepEqual(acknowledgements,[]);
  voice.consumed(request.id,2,11);assert.equal((await running).ok,true);
  assert.deepEqual(acknowledgements,[{id:request.id,samples:2,owner:11}]);
});

test('model GPU budget omits the VoxCPM2 reserve for external speech while preserving the model safety check',async()=>{
  let voiceStatusCalls=0;
  const gpu=createGpuBudget({readImpl:async()=>({available:true,adapters:[{name:'Synthetic GPU',totalBytes:24*GiB,usedBytes:18*GiB,freeBytes:6*GiB}]}),voiceStatus:async()=>{voiceStatusCalls++;return {connected:false};}});
  const external=await gpu.beforeModel({reserveLocalVoice:false});
  assert.equal(external.reserveVoiceGiB,0);assert.equal(voiceStatusCalls,0);
  await assert.rejects(gpu.beforeModel({}),/GPU load paused/);assert.equal(voiceStatusCalls,1);
  await assert.rejects(gpu.beforeModel({reserveLocalVoice:false,modelBytes:10*GiB}),/GPU load paused/);
});
