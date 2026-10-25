'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {createSpeechService} = require('../src/speech/speech-service');

const request = {id:'speech-request-123', actor:'vivi', language:'English', text:'Keep only for this session.'};
function fixture() {
  let calls = 0;
  const voiceService = {
    cancel() {},
    async stream(opts, emit) {
      calls++;
      emit({id:opts.id, type:'start', sampleRate:24000});
      emit({id:opts.id, type:'pcm', bytes:Buffer.from([1,0,2,0])});
      emit({id:opts.id, type:'end'});
      return {ok:true};
    }
  };
  return {service:createSpeechService({voiceService}), get calls(){return calls;}};
}

test('a completed Speech take replays and exports from memory without another synthesis', async () => {
  const fake = fixture();
  const completed = await fake.service.generate(request, () => {}, 11);
  assert.equal(completed.ok, true);
  const id = completed.recording.id;
  const packets = [];
  const replay = await fake.service.replay({id:'replay-request-123', replayRecordingId:id}, p => packets.push(p), 11);
  assert.equal(replay.ok, true);
  assert.deepEqual(packets.map(p => p.type), ['start','pcm','end']);
  const audio = fake.service.audio(id, 11);
  assert.equal(audio.bytes.toString('ascii',0,4), 'RIFF');
  assert.deepEqual(audio.bytes.subarray(44), Buffer.from([1,0,2,0]));
  assert.equal(fake.calls, 1);
});

test('Speech accepts the shared Persona catalog and rejects unknown languages before synthesis',async()=>{
  const {LANGUAGES}=require('../src/voice/voice-language'),fake=fixture();
  for(const language of LANGUAGES){const result=await fake.service.generate({...request,language},()=>{},11);assert.equal(result.ok,true,language+': '+result.error);assert.equal(result.recording.language,language);}
  assert.equal(fake.calls,LANGUAGES.length);
  const invalid=await fake.service.generate({...request,language:'Unknown language'},()=>{},11);assert.equal(invalid.ok,false);assert.equal(fake.calls,LANGUAGES.length);
});

test('recordings belong to their window; clearing one owner preserves another owner', async () => {
  const {service} = fixture();
  const first = await service.generate(request, () => {}, 11);
  const second = await service.generate(request, () => {}, 22);
  assert.throws(() => service.audio(first.recording.id, 22), /no longer available/);
  service.clear(11);
  assert.throws(() => service.audio(first.recording.id, 11), /no longer available/);
  assert.equal(service.audio(second.recording.id, 22).actor, 'vivi');
});

test('a new completed take replaces the old take and a new service cannot reopen it', async () => {
  const {service} = fixture();
  const first = await service.generate(request, () => {}, 11);
  const second = await service.generate(request, () => {}, 11);
  assert.throws(() => service.audio(first.recording.id, 11), /no longer available/);
  assert.equal(service.audio(second.recording.id, 11).actor, 'vivi');
  assert.throws(() => fixture().service.audio(second.recording.id, 11), /no longer available/);
});

test('failed or incomplete synthesis never exposes an exportable recording', async () => {
  for (const result of [{ok:false, error:'Synthetic failure'}, {ok:true}]) {
    const service = createSpeechService({voiceService:{cancel(){}, async stream(_opts, emit) {
      emit({type:'start', sampleRate:24000});
      emit({type:'pcm', bytes:Buffer.from([1,0])});
      return result;
    }}});
    const completed = await service.generate(request, () => {}, 11);
    assert.equal(completed.ok, false);
    assert.equal(completed.recording, undefined);
  }
});

test('chat recordings preserve reply association, all reply languages and model-text cleanup mode', async () => {
  let captured;
  const service=createSpeechService({maxRecordings:24,verbatim:false,voiceService:{cancel(){},async stream(opts,emit){
    captured=opts;emit({type:'start',sampleRate:24000});emit({type:'pcm',bytes:Buffer.from([1,0])});emit({type:'end'});return {ok:true};
  }}});
  const context={kind:'discussion',id:'session-123456',entryId:'entry-123456'};
  const result=await service.generate({...request,language:'Arabic',recordingContext:context},()=>{},11);
  assert.equal(result.ok,true);
  assert.equal(captured.verbatim,false);
  assert.deepEqual(service.list(11)[0].context,context);
  assert.deepEqual(service.list(22),[]);
  assert.equal(service.audio(result.recording.id,11).context.entryId,context.entryId);
});

test('chat cache evicts oldest takes at count and byte limits while retaining newer replies', async () => {
  for(const limits of [{maxRecordings:2,maxBytes:100},{maxRecordings:24,maxBytes:8}]){
    // Use the same synthetic four-byte take for both independent bounds.
    const source={cancel(){},async stream(opts,emit){
      emit({type:'start',sampleRate:24000});emit({type:'pcm',bytes:Buffer.from([1,0,2,0])});emit({type:'end'});return {ok:true};
    }};
    const service=createSpeechService({voiceService:source,...limits});
    const first=await service.generate(request,()=>{},11);
    const second=await service.generate(request,()=>{},11);
    const third=await service.generate(request,()=>{},11);
    assert.throws(()=>service.audio(first.recording.id,11),/no longer available/);
    assert.deepEqual(service.list(11).map(item=>item.id),[second.recording.id,third.recording.id]);
  }
});

test('clearing a chat drops only that chat audio, without mutating already exported bytes', async () => {
  const source={cancel(){},async stream(opts,emit){emit({type:'start',sampleRate:24000});emit({type:'pcm',bytes:Buffer.from([1,0])});emit({type:'end'});return {ok:true};}};
  const service=createSpeechService({voiceService:source,maxRecordings:24});
  const first=await service.generate({...request,recordingContext:{kind:'chat',id:'session-one',entryId:'entry-one'}},()=>{},11);
  const second=await service.generate({...request,recordingContext:{kind:'chat',id:'session-two',entryId:'entry-two'}},()=>{},11);
  const exported=service.audio(first.recording.id,11).bytes;
  service.clearSession(11,{kind:'chat',id:'session-one'});
  assert.throws(()=>service.audio(first.recording.id,11),/no longer available/);
  assert.equal(service.audio(second.recording.id,11).actor,'vivi');
  assert.equal(exported.toString('ascii',0,4),'RIFF');
  assert.deepEqual(exported.subarray(44),Buffer.from([1,0]));
});

test('clearing during synthesis cancels the lease so late success cannot recreate audio', async () => {
  let release,started,cancelled=false;
  const pending=new Promise(resolve=>{release=resolve;});
  const ready=new Promise(resolve=>{started=resolve;});
  const service=createSpeechService({voiceService:{cancel(){cancelled=true;},async stream(opts,emit){
    emit({type:'start',sampleRate:24000});emit({type:'pcm',bytes:Buffer.from([1,0])});started();await pending;emit({type:'end'});return {ok:true};
  }}});
  const running=service.generate({...request,recordingContext:{kind:'chat',id:'session-one',entryId:'entry-one'}},()=>{},11);
  await ready;service.clearSession(11,{kind:'chat',id:'session-one'});release();
  assert.equal((await running).cancelled,true);assert.equal(cancelled,true);assert.deepEqual(service.list(11),[]);
});

test('oversized replay takes do not turn a successful playback into a failed generation', async () => {
  const service=createSpeechService({maxBytes:1,voiceService:{cancel(){},async stream(opts,emit){
    emit({type:'start',sampleRate:24000});emit({type:'pcm',bytes:Buffer.from([1,0])});emit({type:'end'});return {ok:true};
  }}});
  const result=await service.generate(request,()=>{},11);
  assert.equal(result.ok,true);assert.match(result.recordingUnavailable,/memory limit/);assert.deepEqual(service.list(11),[]);
});

test('clearing a chat wakes a replay paused by backpressure without emitting late audio', async () => {
  const service=createSpeechService({voiceService:{cancel(){},async stream(opts,emit){
    emit({type:'start',sampleRate:8000});emit({type:'pcm',bytes:Buffer.alloc(64000)});emit({type:'end'});return {ok:true};
  }}});
  const context={kind:'chat',id:'session-one',entryId:'entry-one'};
  const take=await service.generate({...request,recordingContext:context},()=>{},11);
  const packets=[];
  const replay=service.replay({id:'replay-backpressure',replayRecordingId:take.recording.id},p=>packets.push(p),11);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(packets.filter(p=>p.type==='pcm').length,2);
  service.clearSession(11,context);
  assert.equal((await replay).cancelled,true);
  assert.equal(packets.filter(p=>p.type==='pcm').length,2);
  assert.equal(packets.some(p=>p.type==='end'),false);
});
