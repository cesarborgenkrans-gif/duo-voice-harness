'use strict';
// Test-only Electron entry point: replace hosted fetch before loading the real app.
// No production hook, provider account or hosted network call is involved.
const assert=require('node:assert/strict'),path=require('node:path');
const {app}=require('electron');
if(!app||!process.env.DUO_CARTESIA_FIXTURE_KEY)throw Error('Launch this fixture with test:cartesia.');
const nativeFetch=global.fetch;
global.__duoCartesiaFixture={calls:[],aborted:0};
global.fetch=async(value,init={})=>{
  const url=new URL(value),state=global.__duoCartesiaFixture;
  if(url.origin!=='https://api.cartesia.ai'){
    if(url.hostname==='127.0.0.1'||url.hostname==='localhost')return nativeFetch(value,init);
    throw Error('Hosted fixture blocked an unexpected network origin.');
  }
  assert.equal(new Headers(init.headers).get('Authorization'),'Bearer '+process.env.DUO_CARTESIA_FIXTURE_KEY);assert.equal(new Headers(init.headers).get('Cartesia-Version'),'2026-08-14');assert.equal(init.redirect,'error');
  state.calls.push({method:init.method||'GET',path:url.pathname+url.search,...(init.body?{body:JSON.parse(init.body)}:{})});
  const json=data=>new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
  if(url.pathname==='/models')return json({data:[{id:'fixture-model.6',capability:'tts'}]});
  if(url.pathname==='/voices')return json({data:[{id:'voice_momo',name:'Momotamu fixture',status:'active'},{id:'voice_vivi',name:'Vivi fixture',status:'active'}],has_more:false});
  if(url.pathname.startsWith('/voices/'))return json({id:url.pathname.split('/').at(-1),name:'Fixture voice',status:'active'});
  if(init.method==='POST'&&url.pathname==='/tts/bytes'){
    const payload=JSON.parse(init.body);assert.ok(['voice_momo','voice_vivi'].includes(payload.voice));assert.deepEqual(payload.output_format,{container:'raw',encoding:'pcm_s16le',sample_rate:24000});assert.equal(payload.language,'en');let timer,closed=false,finish;
    return new Response(new ReadableStream({start(controller){
      let count=0;finish=()=>{if(closed)return;closed=true;clearInterval(timer);init.signal?.removeEventListener('abort',abort);};
      const abort=()=>{if(closed)return;state.aborted++;finish();controller.error(Error('Synthetic request aborted.'));};
      init.signal?.addEventListener('abort',abort,{once:true});
      timer=setInterval(()=>{if(closed)return;controller.enqueue(new Uint8Array(1920));if(++count===40){finish();controller.close();}},40);
      if(init.signal?.aborted)abort();
    },cancel(){finish?.();}}),{headers:{'Content-Type':'application/octet-stream'}});
  }
  throw Error('Unexpected hosted fixture endpoint.');
};
require(path.resolve(__dirname,'../../src/app/main.js'));
