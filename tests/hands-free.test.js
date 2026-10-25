"use strict";
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const Gate=require('../src/input/hands-free-gate');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function feed(g,level,count){let e;for(let i=0;i<count;i++)e=g.feed(level,.01);return e;}

test('gate ignores silence and short acknowledgements; qualifying speech sends at 0.85 seconds',()=>{
 const g=Gate.create();assert.equal(feed(g,0,1000).state,'waiting');feed(g,.03,100);assert.equal(feed(g,0,85).state,'discard');
 assert.equal(feed(g,.03,200).state,'qualified');assert.equal(feed(g,0,84).state,'qualified');assert.equal(g.feed(0,.01).state,'send');
});

test('renewed speech resets silence, cumulative activity excludes gaps and long captures are bounded',()=>{
 const g=Gate.create();feed(g,.03,100);feed(g,0,60);feed(g,.03,100);feed(g,0,84);assert.equal(g.feed(.03,.01).state,'qualified');assert.equal(feed(g,0,85).state,'send');
 assert.equal(feed(g,.03,2900).state,'send');
});

function fixture({isVoiceActive,getSpeakerLevel,onBackchannel}={}){
 class E{constructor(){this.dataset={};this.value='';this.children=[];}append(...e){this.children.push(...e);}setAttribute(k,v){this[k]=v;}querySelectorAll(){return [];}querySelector(){return {click(){}};}}
 const toolbar=new E(),field=new E();field.nextElementSibling=toolbar;
 const sensitivity=new E(),device=new E();device.value='selected-mic';const nodes={'src-input':field,'hands-free-sensitivity':sensitivity,'listen-device':device};
 let now=0,busy=false,turn,options,draft,sent=0,stops=0,cancels=0,resolveSend,resolveStop;const intervals=[];
 const input={busy:false,refresh(){},draft:()=>draft,attach(_f,r){draft=r;}};
 const bridge={inputBegin:async()=>({ok:true,id:'capture'}),inputChunk:async()=>({ok:true}),inputFinish:async()=>({ok:true,token:'original-audio'}),inputClear:async()=>({ok:true})};
 const window={DiscussionHandsFreeGate:Gate,createListeningCapture:async o=>{options=o;return {stop:async()=>{stops++;}};}};
 const context=vm.createContext({window,document:{getElementById:k=>nodes[k],createElement:()=>new E(),addEventListener(){}},localStorage:{getItem:()=>null,setItem(){}},performance:{now:()=>now},setInterval:f=>{intervals.push(f);return f;},clearInterval(){},setTimeout,addEventListener(){},Float32Array,Uint8Array,DataView,btoa:s=>Buffer.from(s,'binary').toString('base64')});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/input/hands-free-controller.js'),'utf8'),context);
 let scope={activity:'chat',session:'one',longListening:false};
 const c=window.createHandsFreeController({bridge,input,getBusy:()=>busy,getScope:()=>scope,getTurn:()=>turn,isVoiceActive,getSpeakerLevel,onBackchannel,send:()=>{sent++;busy=true;turn='one';return new Promise(r=>resolveSend=r);},interrupt:()=>{cancels++;return new Promise(r=>resolveStop=r);}});
 const frames=(level,n)=>{for(let i=0;i<n;i++)options.onFrame(new Float32Array(160).fill(level),16000);};
 return {c,button:toolbar.children[0],frames,clock:n=>{now=n;intervals.forEach(f=>f());},start:()=>toolbar.children[0].onclick(),reply:()=>{draft=undefined;c.replyStarted({id:turn});},settle:()=>{busy=false;turn=undefined;resolveStop?.();resolveSend?.();},switch:()=>{scope={...scope,session:'two'};},get sent(){return sent;},get cancels(){return cancels;},get stops(){return stops;}};
}

test('controller listens during generation immediately, ignores brief feedback and waits for settled cancellation',async()=>{
 const f=fixture();await f.start();await tick();f.frames(.03,200);f.frames(0,85);await tick();assert.equal(f.sent,1);
 f.clock(100);assert.equal(f.button.dataset.state,'listening');
 f.frames(.04,30);f.frames(0,85);assert.equal(f.cancels,0);
 f.frames(.04,120);assert.equal(f.cancels,1);f.frames(0,85);await tick();assert.equal(f.sent,1);
 f.settle();await new Promise(r=>setTimeout(r,70));assert.equal(f.sent,2);f.settle();await tick();await f.c.end();
});

test('ending or switching chats releases capture and cannot submit retained frames',async()=>{
 const f=fixture();await f.start();await tick();f.frames(.03,150);f.switch();f.clock(100);await tick();assert.equal(f.c.active,false);assert.equal(f.stops,1);f.frames(.03,200);f.frames(0,85);assert.equal(f.sent,0);
});

test('interrupted generation remains in bounded history with an explicit incomplete-context annotation and persona recovery',()=>{
 const c=require('../src/conversation/conversation-model');
 const hm=c.boundedHistory([{speaker:'momotamu',text:'An unfinished thought',status:'interrupted'}]);
 assert.equal(hm.entries.length,1);assert.match(hm.entries[0].text,/interrupted/);assert.match(hm.entries[0].text,/Exact audible words are unknown/);
 assert.match(hm.entries[0].text,/Oops, got carried away/);
 const hv=c.boundedHistory([{speaker:'vivi',text:'Thought',status:'interrupted'}]);
 assert.match(hv.entries[0].text,/curious attention/);
});

test('barge-in rejects speaker bleed, triggers onBackchannel for conversational nods, and interrupts on sustained speech',async()=>{
 let voiceActive=false,speakerRms=0,backchannels=0;
 const f=fixture({isVoiceActive:()=>voiceActive,getSpeakerLevel:()=>speakerRms,onBackchannel:()=>backchannels++});
 await f.start();await tick();
 f.frames(.03,200);f.frames(0,85);await tick();assert.equal(f.sent,1);
 f.clock(100);
 f.reply();
 voiceActive=true;speakerRms=.05;
 f.clock(3100);
 assert.equal(f.button.dataset.state,'listening');
 f.frames(.025,200);
 assert.equal(f.cancels,0);
 f.frames(.045,60);f.frames(0,85);
 assert.equal(f.cancels,0);
 assert.equal(backchannels,1);
 f.frames(.045,130);assert.equal(f.cancels,1);
 f.frames(0,85);await tick();assert.equal(f.sent,1);
 f.settle();await new Promise(r=>setTimeout(r,70));assert.equal(f.sent,2);
 f.reply();
 f.settle();await tick();
 assert.equal(f.button.dataset.state,'listening');
 await f.c.end();
});

test('gate accepts configurable acoustic coupling factor and dynamically updates',()=>{
 const g=Gate.create({threshold:.018,speakerCoupling:.40});
 assert.equal(g.coupling,.40);
 g.setCoupling(.25);
 assert.equal(g.coupling,.25);
 g.setCoupling(.50);
 assert.equal(g.feed(.040,.01,{speakerRms:.05,bargeIn:true}).state,'waiting');
 assert.equal(g.feed(.045,.01,{speakerRms:.05,bargeIn:true}).state,'hearing');
});

test('audio input controller room calibration measures noise, computes coupling, and updates threshold',async()=>{
 class E{constructor(){this.dataset={};this.value='';this.children=[];this.selectedOptions=[{textContent:'Mock Mic'}];}append(...e){this.children.push(...e);}setAttribute(k,v){this[k]=v;}addEventListener(){}}
 const nodes={
  'audio-input-panel':new E(),'listen-device':new E(),'listen-mic':new E(),'listen-meeting':new E(),
  'audio-input-status':new E(),'audio-input-meter':new E(),'listen-source-summary':new E(),
  'audio-input-disabled-note':new E(),'audio-input-check':new E(),'audio-input-check-stop':new E(),
  'listen-devices':new E(),'btn-audio-input':new E(),'audio-input-close':new E(),
  'hands-free-calibrate':new E(),'hands-free-calibration-status':new E(),'hands-free-sensitivity':new E()
 };
 const store=new Map();
 const win={
  DiscussionStatus:{create:()=>({set(){},begin(){},resolve(){}})},
  createListeningCapture:async opts=>{
   opts.onLevel(.008);
   setTimeout(()=>opts.onLevel(.045),450);
   return {stop:async()=>{}};
  },
  AudioContext:class{
   constructor(){this.currentTime=0;this.destination={};}
   createOscillator(){return {type:'',frequency:{setValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){},start(){},stop(){}};}
   createGain(){return {gain:{setValueAtTime(){},linearRampToValueAtTime(){}},connect(){}};}
   resume(){return Promise.resolve();}
   close(){return Promise.resolve();}
  }
 };
 const ctx=vm.createContext({
  window:win,document:{getElementById:k=>nodes[k],createElement:()=>new E(),querySelectorAll:()=>[],addEventListener(){}},
  localStorage:{getItem:k=>store.get(k),setItem:(k,v)=>store.set(k,v)},
  navigator:{mediaDevices:{enumerateDevices:async()=>[],addEventListener:()=>{}}},
  addEventListener:()=>{},
  setTimeout,clearTimeout,Promise,Error,Number,Math
 });
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/input/audio-input-controller.js'),'utf8'),ctx);
 const c=win.createAudioInputController({getBusy:()=>false,onBusy:()=>{}});
 const result=await c.calibrate();
 assert.ok(result.coupling>=.15&&result.coupling<=.75);
 assert.equal(store.has('duo-voice-speaker-coupling'),true);
 assert.equal(nodes['hands-free-sensitivity'].value,'.009');
});
