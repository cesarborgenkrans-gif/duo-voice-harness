'use strict';
// Real Electron, renderer, IPC, HTTP and audio worklets; controlled model/PCM fixtures.
// This is an integration test, not evidence of model quality or acoustic echo rejection.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const http=require('node:http');
const {randomUUID}=require('node:crypto');
const {_electron}=require('playwright');
const root=path.resolve(__dirname,'..');
const {SERVICE_NAME}=require('../src/voice/voice-service');
async function until(read,accept,timeout=45000){const end=Date.now()+timeout;let value;do{value=await read();if(accept(value))return value;await new Promise(r=>setTimeout(r,150));}while(Date.now()<end);throw Error('Timed out: '+JSON.stringify(value));}
async function run(){
 const output=path.join(root,'artifacts','desktop-smoke-'+randomUUID());await fs.mkdir(output,{recursive:true});
 const calls=[],errors=[],failedFiles=[];
 const server=http.createServer(async(req,res)=>{
  let raw='';for await(const chunk of req)raw+=chunk;
  const body=raw?JSON.parse(raw):{};calls.push(req.method+' '+req.url);
  const json=value=>{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
  if(req.url==='/v1/models')return json({data:[{id:'desktop-test-model'}]});
  if(req.url==='/v1/chat/completions'){
   const text='This is a controlled desktop integration test.';
   if(!body.stream)return json({choices:[{message:{content:text},finish_reason:'stop'}]});
   res.writeHead(200,{'Content-Type':'text/event-stream'});
   res.end('data: '+JSON.stringify({choices:[{delta:{content:text},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');return;
  }
  if(req.url==='/api/health')return json({service:SERVICE_NAME,loaded:true,speech_sessions:{available:true,output_retention:['session','archive']}});
  if(req.url==='/api/speech-sessions')return json({session_id:'fixture-'+randomUUID()});
  if(req.url.endsWith('/audio')){
   const pcm=Buffer.alloc(48000);for(let n=0;n<pcm.length/2;n++)pcm.writeInt16LE(Math.round(300*Math.sin(n*2*Math.PI*220/48000)),n*2);
   res.writeHead(200,{'Content-Type':'application/octet-stream','X-Sample-Rate':'48000','X-Audio-Format':'pcm_s16le'});res.end(pcm);return;
  }
  if(req.url.endsWith('/text')||req.url.endsWith('/complete')||req.url.endsWith('/cancel'))return json({ok:true});
  if(req.url.startsWith('/api/speech-sessions/'))return json({state:'completed'});
  res.writeHead(404);res.end();
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const origin='http://127.0.0.1:'+server.address().port;
 let app,page;
 try{
  const env={...process.env,DUO_VOICE_DATA_ROOT:path.join(output,'data'),DUO_VOICE_SESSION_ROOT:path.join(output,'sessions')};delete env.ELECTRON_RUN_AS_NODE;
  app=await _electron.launch({executablePath:require('electron'),cwd:root,args:['.','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream'],env,timeout:30000});
  page=await app.firstWindow();
  page.on('pageerror',e=>errors.push(e.stack));
  page.on('requestfailed',r=>{if(r.url().startsWith('file:'))failedFiles.push(r.url());});
  await page.waitForFunction(()=>document.querySelector('.hands-free-button'));
  const paths=await app.evaluate(({app})=>({userData:app.getPath('userData'),sessionData:app.getPath('sessionData')}));
  assert.equal(paths.userData,env.DUO_VOICE_DATA_ROOT);assert.equal(paths.sessionData,paths.userData);
  await page.evaluate(({origin})=>{localStorage.setItem('duo-voice-settings',JSON.stringify({provider:'custom',developerConnection:true,url:origin+'/v1',model:'desktop-test-model',voiceURL:origin,voiceOn:true}));}, {origin});
  await page.reload();await page.waitForFunction(()=>document.querySelector('.hands-free-button'));
  await until(()=>page.locator('#gear').getAttribute('data-model-ready'),v=>v==='true');
  await page.evaluate(()=>{document.querySelector('#turns').value='2';document.querySelector('#text-pace').value='0';});
  await page.locator('#src-input').fill('Test both companions.');await page.locator('#btn-run').click();
  await until(()=>page.locator('#session-status').textContent(),v=>v.includes('3 turns saved'));
  await until(()=>page.locator('#btn-run').isDisabled(),v=>!v);
  assert.equal(await page.locator('#log .msg.momotamu').count(),1);
  assert.equal(await page.locator('#log .msg.vivi').count(),1);
  const status=await page.locator('#status').textContent();assert.doesNotMatch(status,/unavailable|failed|stopped:/i);
  assert.equal(calls.filter(x=>x==='POST /api/speech-sessions').length,2,'Both voices must stream through the actual player');
  await until(()=>page.locator('.chat-audio').count(),v=>v===2);
  const cached=await page.evaluate(()=>window.discussion.chatAudioList());
  assert.equal(cached.recordings.length,2);
  assert.ok(cached.recordings.every(item=>item.context?.entryId&&item.context.kind==='discussion'));
  await page.locator('.msg.momotamu [data-audio-action=replay]').click();
  await until(()=>page.locator('#status').textContent(),v=>v.includes('Replay finished'));
  assert.equal(calls.filter(x=>x==='POST /api/speech-sessions').length,2,'Chat Replay must not synthesize again');
  await app.evaluate(({dialog})=>{dialog.showSaveDialog=async()=>({canceled:true});});
  await page.locator('.msg.momotamu [data-audio-action=save]').click();
  await until(()=>page.locator('#status').textContent(),v=>v.includes('Save cancelled'));
  assert.equal((await page.evaluate(()=>window.discussion.chatAudioList())).recordings.length,2);
  const exported=path.join(output,'exports','reply.wav');await fs.mkdir(path.dirname(exported),{recursive:true});
  await app.evaluate(({dialog},filePath)=>{dialog.showSaveDialog=async(_window,opts)=>{global.__savedAudioName=opts.defaultPath;return {canceled:false,filePath};};},exported);
  await page.locator('.msg.momotamu [data-audio-action=save]').click();
  await until(()=>page.locator('#status').textContent(),v=>v.includes('Saved reply.wav'));
  assert.equal((await fs.readFile(exported)).toString('ascii',0,4),'RIFF');
  const proposedName=await app.evaluate(()=>global.__savedAudioName);
  const momo=cached.recordings.find(item=>item.actor==='momotamu');
  assert.ok(proposedName.includes(momo.context.id)&&proposedName.includes(momo.context.entryId),'Export name identifies its chat and reply');
  await page.screenshot({path:path.join(output,'conversation.png')});
  await page.locator('#gear').click();
  assert.equal(await page.locator('#settings').isVisible(),true);
  await page.screenshot({path:path.join(output,'settings.png')});
  const saveBox=await page.locator('#cfg-save').boundingBox(),winHeight=await page.evaluate(()=>innerHeight);
  assert.ok(saveBox&&saveBox.y+saveBox.height<=winHeight,'Settings footer save button must remain inside viewport bounds');
  await page.locator('#settings-close').click();
  assert.equal(await page.locator('#settings').isVisible(),false);
  await app.evaluate(({shell})=>{global.__openedDataFolders=[];shell.openPath=async folder=>{global.__openedDataFolders.push(folder);return '';};});
  await page.locator('#gear').click();await page.locator('#btn-resources').click();
  await page.locator('#data-conversations').click();
  await until(()=>page.locator('#data-status').textContent(),v=>v.includes(env.DUO_VOICE_SESSION_ROOT));
  await page.locator('#data-application').click();
  await until(()=>page.locator('#data-status').textContent(),v=>v.includes(env.DUO_VOICE_DATA_ROOT));
  assert.deepEqual(await app.evaluate(()=>global.__openedDataFolders),[env.DUO_VOICE_SESSION_ROOT,env.DUO_VOICE_DATA_ROOT]);
  assert.equal((await page.evaluate(()=>window.discussion.openDataFolder('arbitrary-path'))).ok,false);
  await page.screenshot({path:path.join(output,'data-folders.png')});
  await page.locator('#resources-close').click();
  await page.locator('#settings-close').click();
  // Hardware capture is simulated, but this exercises Chromium getUserMedia and the real capture worklet.
  await page.locator('.hands-free-button').click();
  await until(()=>page.locator('.hands-free-button').getAttribute('data-state'),v=>v==='listening');
  await page.locator('.hands-free-button').click();
  await page.locator('#activities-toggle').click();await page.locator('[data-activity="speech"]').first().click();
  assert.equal(await page.locator('#speech-panel').isVisible(),true);
  await page.locator('#speech-text').fill('Direct speech integration test.');await page.locator('#speech-speak').click();
  await until(()=>page.locator('#speech-take').textContent(),v=>v.includes('seconds'));
  await until(()=>page.locator('#speech-replay').isEnabled(),Boolean);
  await page.locator('#speech-replay').click();await until(()=>page.locator('#speech-stop').isVisible(),v=>!v);
  await page.locator('#activities-toggle').click();await page.locator('[data-activity="chat"]').first().click();
  await page.reload();await page.waitForFunction(()=>document.querySelector('.hands-free-button'));
  await until(()=>page.locator('#log .msg').count(),v=>v===3);
  assert.equal((await page.evaluate(()=>window.discussion.chatAudioList())).recordings.length,0,'Reload releases session audio');
  assert.equal(await page.locator('.chat-audio').count(),0,'Saved text must not claim expired audio is available');
  assert.equal((await fs.readFile(exported)).toString('ascii',0,4),'RIFF','Explicit export survives reload');
  // Exercise the real deletion handler after proving that reload expires audio.
  const regenerated=await page.evaluate(async({origin,context})=>window.discussion.ttsStream({
    id:'voice-delete-fixture',actor:'momotamu',language:'English',text:'Synthetic deletion check.',baseURL:origin,recordingContext:context
  },()=>{}),{origin,context:momo.context});
  assert.equal(regenerated.ok,true);
  assert.equal((await page.evaluate(()=>window.discussion.chatAudioList())).recordings.length,1);
  const other=await page.evaluate(()=>window.discussion.sessionCreate({kind:'chat'}));assert.equal(other.ok,true);
  const legacy=path.join(env.DUO_VOICE_DATA_ROOT,'voicegen','outputs','legacy.wav');await fs.mkdir(path.dirname(legacy),{recursive:true});await fs.writeFile(legacy,'preserve legacy');
  const removed=await page.evaluate(context=>window.discussion.sessionDelete(context),momo.context);assert.equal(removed.ok,true);
  assert.equal((await page.evaluate(()=>window.discussion.chatAudioList())).recordings.length,0,'Deleting a chat clears its associated replay cache');
  assert.equal((await page.evaluate(scope=>window.discussion.sessionGet(scope),{kind:'chat',id:other.session.id})).ok,true,'Unrelated saved chat survives');
  assert.equal(await fs.readFile(legacy,'utf8'),'preserve legacy');
  assert.equal((await fs.readFile(exported)).toString('ascii',0,4),'RIFF','Deliberate export survives chat deletion');
  assert.deepEqual(errors,[]);assert.deepEqual(failedFiles,[]);
  const report={passed:true,paths,status,modelRequests:calls.filter(x=>x==='POST /v1/chat/completions').length,voiceRequests:calls.filter(x=>x==='POST /api/speech-sessions').length,checks:['desktop startup','isolated stores','both personas','PCM playback','chat Replay without synthesis','Save cancel and WAV export','chat/reply identity in export name','allowlisted data folders','reload expires session audio','chat deletion clears associated audio and preserves unrelated chat, legacy archive and export','fake-device microphone capture','Speech and replay','saved-session reload','no renderer exceptions','no missing resources']};
  await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log('DESKTOP SMOKE PASS\n'+path.join(output,'report.json'));
 }catch(error){if(page){console.error('STATUS',await page.locator('#status').textContent());console.error('LOG',await page.locator('#log').innerText());console.error('ERRORS',errors);console.error('CALLS',calls);await page.screenshot({path:path.join(output,'failure.png')});}throw error;}finally{await app?.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
}
run().catch(e=>{console.error(e);process.exitCode=1;});
