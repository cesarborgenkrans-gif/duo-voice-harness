'use strict';
// Test-only Electron entry point: replace hosted fetch before loading the real app.
// No production hook, provider account or hosted network call is involved.
const assert=require('node:assert/strict'),path=require('node:path');
const {app}=require('electron');
if(!app||!process.env.DUO_ELEVEN_FIXTURE_KEY)throw Error('Launch this fixture with test:elevenlabs.');
const nativeFetch=global.fetch;
global.__duoElevenFixture={calls:[],aborted:0};
global.fetch=async(value,init={})=>{
  const url=new URL(value),state=global.__duoElevenFixture;
  if(url.origin!=='https://api.elevenlabs.io'){
    if(url.hostname==='127.0.0.1'||url.hostname==='localhost')return nativeFetch(value,init);
    throw Error('Hosted fixture blocked an unexpected network origin.');
  }
  assert.equal(new Headers(init.headers).get('xi-api-key'),process.env.DUO_ELEVEN_FIXTURE_KEY);assert.equal(init.redirect,'error');
  state.calls.push({method:init.method||'GET',path:url.pathname+url.search,...(init.body?{body:JSON.parse(init.body)}:{})});
  const json=data=>new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
  if(url.pathname==='/v1/models')return json([{model_id:'fixture_model',name:'Synthetic hosted model',can_do_text_to_speech:true,languages:[{language_id:'en'},{language_id:'sv'},{language_id:'ja'}],maximum_text_length_per_request:8000}]);
  if(url.pathname==='/v2/voices')return json({voices:[{voice_id:'voice_momo',name:'Momotamu fixture'},{voice_id:'voice_vivi',name:'Vivi fixture'}],has_more:false});
  if(url.pathname.startsWith('/v1/voices/'))return json({voice_id:url.pathname.split('/').at(-1),name:'Fixture voice'});
  if(init.method==='POST'&&/^\/v1\/text-to-speech\/voice_(momo|vivi)\/stream$/.test(url.pathname)){
    assert.equal(url.searchParams.get('output_format'),'pcm_24000');let timer,closed=false,finish;
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
