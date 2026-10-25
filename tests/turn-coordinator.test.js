'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {create}=require('../src/conversation/turn-coordinator');
const {createModelRequestLane}=require('../src/models/model-request-lane');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('Stop invalidates output immediately but keeps ownership until job and cancellation cleanup finish',async()=>{
 const c=create(),turn=c.begin({sessionId:'chat-a'}),reply=deferred(),cleanup=deferred();let cancelled=0;
 const job=c.run(turn,'model',()=>reply.promise,{cancel:()=>{cancelled++;return cleanup.promise;}});
 const rejected=assert.rejects(job,/stopped/);await tick();
 let settled=false;const stopping=c.cancel(turn).then(()=>{settled=true;});
 assert.equal(c.isCurrent(turn),false);assert.equal(c.busy,true);assert.equal(cancelled,1);
 assert.throws(()=>c.begin({sessionId:'chat-b'}),/stopping/);c.cancel(turn);assert.equal(cancelled,1);
 reply.resolve('obsolete response');await rejected;await tick();assert.equal(settled,false);
 cleanup.resolve();await stopping;assert.equal(c.busy,true);
 await c.run(turn,'delivery-receipt',async()=>{}, {cleanup:true});await c.finish(turn);
 const next=c.begin({sessionId:'chat-b'});assert.equal(c.isCurrent(turn),false);assert.equal(c.isCurrent(next),true);await c.finish(next);
});

test('cancel before dispatch prevents the operation; failure releases tracked jobs and observer errors are harmless',async()=>{
 const c=create({onState:()=>{throw Error('broken visual');}}),turn=c.begin({});let dispatched=0;
 const job=c.run(turn,'voice',()=>dispatched++);const rejected=assert.rejects(job,/stopped/);
 await c.cancel(turn);await rejected;assert.equal(dispatched,0);await c.finish(turn);
 const second=c.begin({});await assert.rejects(c.run(second,'model',()=>{throw Error('offline');}),/offline/);
 await c.finish(second);assert.equal(c.busy,false);
});

test('failed voice delivery settles before receipts and no new turn can replace the draining owner',async()=>{
 const c=create(),turn=c.begin({}),voice=deferred(),receipt=deferred();
 const playing=c.run(turn,'voice',()=>voice.promise);const rejected=assert.rejects(playing,/stopped/);await tick();
 const stopped=c.cancel(turn);voice.resolve();await rejected;await stopped;
 const saving=c.run(turn,'receipt',()=>receipt.promise,{cleanup:true});await tick();const finished=c.finish(turn);
 assert.throws(()=>c.begin({}),/stopping/);receipt.resolve();await saving;await finished;assert.equal(c.busy,false);
});

test('model requests serialize actual completion, discard cancelled queued work and reject late data',async()=>{
 const lane=createModelRequestLane(),first=new AbortController(),second=new AbortController(),wait=deferred();let running=0,peak=0,queuedRan=false;
 const active=lane.run(first.signal,async()=>{peak=Math.max(peak,++running);const result=await wait.promise;running--;return result;});
 const rejected=assert.rejects(active);await tick();
 const queued=lane.run(second.signal,()=>{queuedRan=true;});const queuedRejected=assert.rejects(queued);second.abort();await queuedRejected;
 first.abort();let thirdRan=false;const third=lane.run(new AbortController().signal,()=>{thirdRan=true;peak=Math.max(peak,++running);running--;return 'fresh';});
 await tick();assert.equal(lane.busy,true);assert.equal(thirdRan,false);assert.equal(queuedRan,false);
 wait.resolve('late answer');await rejected;assert.equal(await third,'fresh');assert.equal(peak,1);assert.equal(lane.busy,false);
});

test('bounded queue recovers from a failed request without parallel inference',async()=>{
 const lane=createModelRequestLane({maxQueued:1}),hold=deferred();const active=lane.run(undefined,()=>hold.promise);await tick();
 const queued=lane.run(undefined,()=>{throw Error('request failed');});const rejection=assert.rejects(queued,/request failed/);
 await assert.rejects(lane.run(undefined,()=>{}),/queue is full/);hold.resolve();await active;await rejection;
 assert.equal(await lane.run(undefined,()=>42),42);assert.equal(lane.busy,false);
});

function rendererFixture(worktree){
 const source=fs.readFileSync(require.resolve('../src/app/renderer.js'),'utf8');
 const start=source.indexOf('  let activeLlmRequestId = null;'),end=source.indexOf('  async function llmModels()',start);
 const c=create(),backend=deferred(),cancelCleanup=deferred(),calls=[],chunks=[];let callback;
 const bridge={cancelLlm:id=>{calls.push(['cancel',id]);return cancelCleanup.promise;},llmChatStream:async(opts,onChunk)=>{calls.push(['send',opts]);callback=onChunk;return backend.promise;}};
 const context={turnCoordinator:c,bridge,presenceTap:()=>{},cancelDisplayTranscript:async()=>{},runSettings:null,settings:{url:'http://local',provider:'local-llama'},worktreeController:{context:()=>worktree||Promise.resolve(null)},modelId:()=> 'gemma',modelConfig:{generation:()=>({})},liveFlow:{bind(){}},Date,Math,AbortController,setTimeout,clearTimeout};
 vm.runInNewContext(source.slice(start,end)+'\nthis.chat=llmChatStream;',context);
 return {c,backend,cancelCleanup,calls,chunks,chat:context.chat,chunk:value=>callback(value)};
}
test('actual renderer model route cannot dispatch after Stop during context setup',async()=>{
 const setup=deferred(),f=rendererFixture(setup.promise),turn=f.c.begin({});
 const task=f.chat([],text=>f.chunks.push(text),{turn});await tick();const stopping=f.c.cancel(turn);
 f.cancelCleanup.resolve();setup.resolve(null);const result=await task;await stopping;await f.c.finish(turn);
 assert.equal(result.cancelled,true);assert.equal(f.calls.some(c=>c[0]==='send'),false);
});
test('actual renderer route rejects late chunks/results and waits for the backend promise on Stop',async()=>{
 const f=rendererFixture(),turn=f.c.begin({});const task=f.chat([],text=>f.chunks.push(text),{turn});await tick();
 f.chunk('valid partial');let settled=false;const stop=f.c.cancel(turn).then(()=>{settled=true;});f.cancelCleanup.resolve();f.chunk('late partial');await tick();assert.equal(settled,false);
 f.backend.resolve({ok:true,text:'late final'});const result=await task;await stop;await f.c.finish(turn);
 assert.deepEqual(f.chunks,['valid partial']);assert.equal(result.ok,false);assert.equal(result.cancelled,true);
 assert.equal('turn' in f.calls.find(c=>c[0]==='send')[1],false);
});

test('actual voice route stopped during device preparation sends no synthesis request and waits for cleanup',async()=>{
 const source=fs.readFileSync(require.resolve('../src/app/renderer.js'),'utf8');
 const start=source.indexOf('  async function playVoice(opts)'),end=source.indexOf("  window.addEventListener('beforeunload'",start);
 const c=create(),device=deferred(),cleanup=deferred();let synthesis=0;
 class Player{constructor(){this.stopped=false;}prepare(){return device.promise;}stop(){this.stopped=true;}}
 const bridge={ttsCancel:()=>cleanup.promise,ttsStream:async()=>{synthesis++;return {ok:true};}};
 const context={turnCoordinator:c,bridge,window:{DiscussionVoicePlayer:Player},settings:{voiceOutputMode:'speakers'},activeVoiceId:null,activeVoicePlayer:null,chatAudioController:null,listeningBusy:false,abort:false,sprites:null,listeningController:null,reader:null,sessionController:null,backstageController:null,modelController:null,running:true,modelOperation:false,crypto:{randomUUID:()=> 'fixture'},liveFlow:{},voicePerformance:async()=>({})};
 vm.runInNewContext(source.slice(start,end)+'\nthis.play=playVoice;this.stop=()=>{activeVoicePlayer?.stop();return bridge.ttsCancel(activeVoiceId);};',context);
 const turn=c.begin({}),voice=c.run(turn,'voice',()=>context.play({turn,voicePrepared:true}),{cancel:context.stop});
 const rejected=assert.rejects(voice,/stopped/);await tick();let settled=false;const stop=c.cancel(turn).then(()=>{settled=true;});
 device.resolve();await rejected;await tick();assert.equal(synthesis,0);assert.equal(settled,false);
 cleanup.resolve();await stop;await c.finish(turn);assert.equal(c.busy,false);
});

function desktopFixture(beforeDispatch){
 const source=fs.readFileSync(require.resolve('../src/app/main.js'),'utf8');
 const a=source.indexOf("ipcMain.handle('llm-chat-stream'"),b=source.indexOf("ipcMain.handle('llm-models'",a);
 const handlers=new Map(),activeLlmStreams=new Map(),lane=createModelRequestLane(),network=deferred(),packets=[];let fetched=0;
 const sender={id:7,isDestroyed:()=>false,send:(...args)=>packets.push(args)};
 const context={ipcMain:{handle:(id,fn)=>handlers.set(id,fn)},voiceSender:e=>e.sender.id,microphone:{cancelTranscript:()=>beforeDispatch||Promise.resolve(),history:(_owner,m)=>m,release(){}},activeLlmStreams,modelRequests:lane,llmRequestKey:(sender,id)=>`${sender.id}:${id}`,registerModelRequest:(sender,id,c)=>{const key=`${sender.id}:${id}`;activeLlmStreams.set(key,c);return key;},LLM_TIMEOUT_MS:45000,modelTarget:async()=>({baseURL:'http://local',model:'gemma'}),withWorktree:async(_opts,m)=>m,llmRequestBody:o=>o,flowEvent(){},imageReceipts:new Map(),imageFocusContexts:new Map(),visionCapabilities:new Map(),credentials:{redact:value=>value},localizedFailure:(_code,_args,error)=>({ok:false,error}),fetch:async()=>{fetched++;return network.promise;},AbortController,setTimeout,clearTimeout,TextDecoder,Date,Math,Number,String,Error};
 vm.runInNewContext(source.slice(a,b),context);
 const response=()=>{
  let read=false;
  return {ok:true,body:{getReader:()=>({read:async()=>{
   if(read)return {done:true};read=true;
   return {done:false,value:new TextEncoder().encode('data: {"choices":[{"delta":{"content":"late reply"}}]}\n\n')};
  }})}};
 };
 return {handlers,activeLlmStreams,lane,network,packets,response,get fetched(){return fetched;},event:{sender}};
}
test('actual desktop handler registers cancellation before waiting for prior transcription',async()=>{
 const wait=deferred(),f=desktopFixture(wait.promise),task=f.handlers.get('llm-chat-stream')(f.event,{id:'early-stop',messages:[]});
 assert.equal(f.activeLlmStreams.size,1);f.handlers.get('llm-cancel')(f.event,'early-stop');wait.resolve();
 assert.equal((await task).ok,false);assert.equal(f.fetched,0);assert.equal(f.activeLlmStreams.size,0);assert.equal(f.lane.busy,false);
});
test('actual desktop stream discards a noncompliant late provider response and releases inference after settlement',async()=>{
 const f=desktopFixture(),task=f.handlers.get('llm-chat-stream')(f.event,{id:'late-stop',messages:[]});await tick();assert.equal(f.fetched,1);
 f.handlers.get('llm-cancel')(f.event,'late-stop');assert.equal(f.lane.busy,true);f.network.resolve(f.response());
 assert.equal((await task).ok,false);assert.equal(f.packets.length,0);assert.equal(f.activeLlmStreams.size,0);assert.equal(f.lane.busy,false);
});
test('No active turn: cancel, finish and checks are safe, so beforeunload still reaches stopAudio',async()=>{
 const c=create();
 assert.equal(c.isCurrent(null),false);assert.equal(c.isCurrent(undefined),false);
 await c.cancel();await c.cancel(null);await c.finish(null);
 assert.throws(()=>c.check(null),/stopped/);
 await assert.rejects(c.run(null,'model',()=>1),/stopped/);
 let stopped=0;const beforeunload=()=>{void c.cancel();stopped++;};
 assert.doesNotThrow(beforeunload);assert.equal(stopped,1);
 const turn=c.begin({sessionId:'chat-a'});await c.finish(turn);
 assert.doesNotThrow(beforeunload);assert.equal(stopped,2);assert.equal(c.busy,false);
 const renderer=fs.readFileSync(require('node:path').join(__dirname,'../src/app/renderer.js'),'utf8');
 assert.match(renderer,/addEventListener\('beforeunload',\(\)=>\{void turnCoordinator\.cancel\(\);stopAudio\(\);\}\)/);
});
