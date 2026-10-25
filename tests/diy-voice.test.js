'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {createDemoServer}=require('../examples/diy-speech-server.cjs');
const {createVoiceService}=require('../src/voice/voice-service');
const {createSpeechService}=require('../src/speech/speech-service');
const {createConnectionRequest}=require('../src/security/connection-request');
const {readBounded}=require('../src/voice/providers/diy');
const {wav,decodeWav}=require('../src/voice/pcm-wav');
const route={schemaVersion:1,provider:'diy',connectionId:'fixture-connection',voices:{momotamu:'demo-momotamu',vivi:'demo-vivi'}};
const request={id:'diy-request-123',actor:'vivi',text:'Synthetic words only.',language:'English',voiceRoute:route};
async function fixture(t,{formats,durationMs=80,token='',fault,diyOptions}={}){
  const server=createDemoServer({formats,durationMs,token});
  if(fault){const handler=server.listeners('request')[0];server.removeAllListeners('request');server.on('request',(req,res)=>{fault(req,res);return handler(req,res);});}
  const paths=[];server.on('request',req=>paths.push(req.method+' '+req.url));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{server.closeAllConnections();if(server.listening)await new Promise(resolve=>server.close(resolve));});
  const origin='http://127.0.0.1:'+server.address().port;
  const authenticated=createConnectionRequest({credentials:{resolve:async()=>token}});
  const connection={baseURL:origin,request:(path,init)=>authenticated({provider:'diy',url:origin,...(token?{credentialRef:'fixture-token'}:{})},path,init)};
  const service=createVoiceService({voiceRoot:'unavailable-local-references',diyOptions,fetchImpl:()=>{throw Error('Must not call VoxCPM2.');},beforeGenerate:()=>{throw Error('Must not prepare VoxCPM2.');},resolveConnection:async()=>connection});
  return {server,origin,connection,service,paths};
}
test('real DIY PCM server exposes two companion voices, streams distinct tones and supports Speech replay without WSL',async t=>{
  const f=await fixture(t,{token:randomUUID()});
  assert.equal((await f.service.health(undefined,route)).contractVersion,1);
  assert.equal((await f.service.profiles(route)).length,2);
  const outputs=[];
  for(const actor of ['momotamu','vivi']){const packets=[];const result=await f.service.stream({...request,actor,id:'diy-'+actor+'-request'},p=>packets.push(p),11);assert.equal(result.ok,true,result.error);assert.equal(result.delivery,'streaming');assert.equal(result.cleanupConfirmed,true);outputs.push(Buffer.concat(packets.filter(p=>p.type==='pcm').map(p=>p.bytes)));}
  assert.notDeepEqual(outputs[0],outputs[1]);
  const speech=createSpeechService({voiceService:f.service});
  const take=await speech.generate(request,()=>{},11);assert.equal(take.ok,true,take.error);
  const before=f.paths.filter(path=>path==='POST /v1/speech').length;
  assert.equal((await speech.replay({id:'diy-replay-request',replayRecordingId:take.recording.id},()=>{},11)).ok,true);
  assert.equal(f.paths.filter(path=>path==='POST /v1/speech').length,before);
  assert.equal(decodeWav(speech.audio(take.recording.id,11).bytes).sampleRate,24000);
});
test('WAV-only DIY responses are decoded to PCM and explicitly marked buffered',async t=>{
  const f=await fixture(t,{formats:['wav']});const packets=[];
  const result=await f.service.stream(request,p=>packets.push(p),11);
  assert.equal(result.ok,true,result.error);assert.equal(result.delivery,'buffered');
  assert.equal(packets[0].format,'pcm_s16le');assert.equal(packets[0].delivery,'buffered');
  assert.equal(Buffer.concat(packets.filter(p=>p.type==='pcm').map(p=>p.bytes)).length,24000*.08*2);
});
test('DIY cancellation wakes a producer paused by backpressure and confirms server cancellation',async t=>{
  const f=await fixture(t,{durationMs:4000,diyOptions:{bufferSeconds:.02}});let arrived;
  const first=new Promise(resolve=>{arrived=resolve;}),packets=[];
  const playing=f.service.stream(request,p=>{packets.push(p);if(p.type==='pcm')arrived();},11);
  await first;await new Promise(resolve=>setTimeout(resolve,60));
  assert.equal(packets.filter(p=>p.type==='pcm').length,1);
  assert.equal(f.service.cancel(request.id,22).cancelled,false);
  assert.equal(f.service.cancel(request.id,11).cancelled,true);
  const result=await playing;assert.equal(result.cancelled,true);assert.equal(result.cleanupConfirmed,true);
  assert.equal(packets.some(p=>p.type==='end'),false);
  const state=await (await fetch(f.origin+'/v1/speech/'+request.id)).json();assert.equal(state.state,'cancelled');
});
test('DIY generation resumes only after playback acknowledgement from its owner',async t=>{
  const f=await fixture(t,{durationMs:160,diyOptions:{bufferSeconds:.02}});let arrived;
  const first=new Promise(resolve=>{arrived=resolve;}),packets=[];
  const playing=f.service.stream(request,p=>{packets.push(p);if(p.type==='pcm'){if(packets.filter(p=>p.type==='pcm').length===1)arrived();else f.service.consumed(request.id,p.bytes.length/2,11);}},11);
  await first;f.service.consumed(request.id,960,22);await new Promise(resolve=>setTimeout(resolve,40));assert.equal(packets.filter(p=>p.type==='pcm').length,1);
  f.service.consumed(request.id,960,11);assert.equal((await playing).ok,true);
});
test('timeout aborts the stream and attempts bounded cancellation, without automatic generation retries',async t=>{
  const f=await fixture(t,{durationMs:4000,diyOptions:{timeoutMs:100}});
  const result=await f.service.stream(request,()=>{},11);
  assert.equal(result.ok,false);assert.equal(result.cancelled,false);assert.match(result.error,/timed out/);
  assert.equal(result.cleanupConfirmed,true);assert.equal(f.paths.filter(path=>path==='POST /v1/speech').length,1);
});
test('malformed headers, cleanly partial PCM and false completion do not create replayable takes',async t=>{
  const faults=[
    (req,res)=>{if(req.url.endsWith('/audio')){const write=res.writeHead.bind(res);res.writeHead=(status,headers)=>write(status,{...headers,'X-Audio-Format':'mp3'});}},
    (req,res)=>{if(req.url.endsWith('/audio')){const write=res.write.bind(res);res.write=bytes=>write(bytes.subarray(0,bytes.length-2));}},
    (req,res)=>{if(/^\/v1\/speech\/[\w-]+$/.test(req.url)&&req.method==='GET'){const end=res.end.bind(res);res.end=bytes=>{const value=JSON.parse(bytes);value.audioSamples++;return end(JSON.stringify(value));};}}
  ];
  for(const fault of faults){const f=await fixture(t,{fault});const speech=createSpeechService({voiceService:f.service});const take=await speech.generate(request,()=>{},11);assert.equal(take.ok,false);assert.equal(take.recording,undefined);assert.equal(f.service.busy,false);}
});
test('compressed and truncated WAVs are rejected before their bytes can reach the PCM player',()=>{
  const valid=wav(Buffer.from([1,0,2,0]),24000);assert.equal(decodeWav(valid).pcm.length,4);
  const compressed=Buffer.from(valid);compressed.writeUInt16LE(3,20);
  for(const bytes of [compressed,valid.subarray(0,-2),Buffer.from('not audio')])assert.throws(()=>decodeWav(bytes));
});
test('response-size limits reject oversized bodies without buffering them',async()=>{
  let cancelled=false;
  const response=new Response(new ReadableStream({cancel(){cancelled=true;}}),{headers:{'Content-Length':'99999999'}});
  await assert.rejects(readBounded(response,64*1024),/size limit/);assert.equal(cancelled,true);
});
test('unknown voice and unavailable service fail with no voice fallback',async t=>{
  const f=await fixture(t);
  const missing=await f.service.stream({...request,voiceRoute:{...route,voices:{vivi:'unknown-voice'}}},()=>{},11);assert.equal(missing.ok,false);assert.match(missing.error,/Choose a voice/);assert.equal(f.paths.some(path=>path==='POST /v1/speech'),false);
  f.server.closeAllConnections();await new Promise(resolve=>f.server.close(resolve));
  const unavailable=await f.service.stream(request,()=>{},11);assert.equal(unavailable.ok,false);assert.match(unavailable.error,/unavailable/);
});
test('an incompatible capability version is rejected before text submission',async t=>{
  const f=await fixture(t,{fault:(req,res)=>{if(req.url==='/v1/capabilities'){const end=res.end.bind(res);res.end=bytes=>{const value=JSON.parse(bytes);value.contractVersion=2;return end(JSON.stringify(value));};}}});
  const result=await f.service.stream(request,()=>{},11);assert.equal(result.ok,false);assert.match(result.error,/contract version 1/);assert.equal(f.paths.some(path=>path==='POST /v1/speech'),false);
});
test('a pre-create cancellation tombstone prevents a late job from resurrecting',async t=>{
  const f=await fixture(t);const id='cancel-before-create';
  const cancelled=await fetch(f.origin+'/v1/speech/'+id+'/cancel',{method:'POST'});assert.equal((await cancelled.json()).state,'cancelled');
  const late=await fetch(f.origin+'/v1/speech',{method:'POST',body:JSON.stringify({contractVersion:1,requestId:id,actor:'vivi',voiceId:'demo-vivi',text:'Late request.',language:'English',outputRetention:'session',format:'pcm_s16le'})});assert.equal(late.status,409);
});
