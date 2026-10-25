'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),http=require('node:http');
const {randomUUID}=require('node:crypto'),{_electron}=require('playwright');
const root=path.resolve(__dirname,'..');
async function until(read,accept){const deadline=Date.now()+30000;do{const value=await read();if(accept(value))return value;await new Promise(resolve=>setTimeout(resolve,100));}while(Date.now()<deadline);throw Error('Cartesia fixture integration timed out.');}
async function run(){
  const output=path.join(root,'artifacts','cartesia-smoke-'+randomUUID());await fs.mkdir(output,{recursive:true});
  const secret=randomUUID(),errors=[];
  const model=http.createServer(async(req,res)=>{for await(const _part of req){}res.setHeader('Content-Type','application/json');if(req.url==='/v1/models')return res.end(JSON.stringify({data:[{id:'hosted-fixture-model'}]}));if(req.url==='/v1/chat/completions'){res.setHeader('Content-Type','text/event-stream');return res.end('data: '+JSON.stringify({choices:[{delta:{content:'[[voice: warmly]]\nSynthetic hosted reply.'},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');}res.writeHead(404);res.end('{}');});
  await new Promise(resolve=>model.listen(0,'127.0.0.1',resolve));const modelURL='http://127.0.0.1:'+model.address().port;let app,page;
  try{
    const env={...process.env,DUO_VOICE_DATA_ROOT:path.join(output,'data'),DUO_VOICE_SESSION_ROOT:path.join(output,'sessions'),DUO_VOICE_ROOT:path.join(output,'no-local-reference-assets'),DUO_CARTESIA_FIXTURE_KEY:secret};delete env.ELECTRON_RUN_AS_NODE;
    app=await _electron.launch({executablePath:require('electron'),cwd:root,args:[path.join(root,'scripts','fixtures','cartesia-main.cjs'),'--mute-audio'],env});page=await app.firstWindow();page.on('pageerror',error=>errors.push(error.message));await page.waitForFunction(()=>document.querySelector('.hands-free-button'));await page.locator('#turns').evaluate(el=>{el.value='2';});
    const credential=await page.evaluate(secret=>window.discussion.credentialSave({provider:'cartesia',url:'https://api.cartesia.ai',secret}),secret);assert.equal(credential.ok,true,credential.error);
    const saved=await page.evaluate(ref=>window.discussion.voiceConnections('save',{provider:'cartesia',baseURL:'https://api.cartesia.ai',credentialRef:ref}),credential.credential.ref);assert.equal(saved.ok,true,saved.error);
    const route={schemaVersion:1,provider:'cartesia',connectionId:saved.result.id,modelId:'fixture-model.6',voices:{momotamu:'voice_momo',vivi:'voice_vivi'}};
    assert.match((await page.evaluate(route=>window.discussion.voiceHealth(undefined,route),route)).error,/Local-only/);
    assert.equal(await app.evaluate(()=>global.__duoCartesiaFixture.calls.length),0);
    assert.equal((await page.evaluate(()=>window.discussion.voiceConnections('setLocalOnly',false))).ok,true);
    const health=await page.evaluate(route=>window.discussion.voiceHealth(undefined,route),route);assert.equal(health.ok,true,health.error);assert.equal(health.health.models[0].id,'fixture-model.6');assert.equal(health.health.voices.length,2);
    assert.equal(await app.evaluate(()=>global.__duoCartesiaFixture.calls.filter(call=>call.method==='POST').length),0);
    await page.evaluate(({route,modelURL})=>localStorage.setItem('duo-voice-settings',JSON.stringify({provider:'custom',developerConnection:true,url:modelURL+'/v1',model:'hosted-fixture-model',voiceOn:true,voiceRoute:route})),{route,modelURL});await page.reload();await page.waitForFunction(()=>document.querySelector('.hands-free-button'));await page.locator('#turns').evaluate(el=>{el.value='2';});
    await until(()=>page.locator('#conn').textContent(),text=>text.includes('Custom'));
    await page.locator('#src-input').fill('Exercise both selected hosted voices.');await page.locator('#btn-run').click();await until(()=>page.locator('#session-status').textContent(),text=>text.includes('3 turns saved'));await until(()=>page.locator('#btn-run').isDisabled(),disabled=>!disabled);
    const posts=()=>app.evaluate(()=>global.__duoCartesiaFixture.calls.filter(call=>call.method==='POST'));
    const chat=await posts();assert.equal(chat.length,2);assert.ok(chat.some(call=>call.body.voice==='voice_momo')&&chat.some(call=>call.body.voice==='voice_vivi'));assert.equal(await page.locator('.chat-audio').count(),2);
    await page.locator('#activities-toggle').click();await page.locator('[data-activity=speech]').first().click();await page.locator('#speech-text').fill('Synthetic hosted Speech take.');await page.locator('#speech-speak').click();await until(()=>page.locator('#speech-replay').isEnabled(),Boolean);
    const before=(await posts()).length;await page.locator('#speech-replay').click();await until(()=>page.locator('#speech-stop').isVisible(),visible=>!visible);assert.equal((await posts()).length,before);
    await page.locator('#speech-text').fill('Stop this synthetic hosted take.');await page.locator('#speech-speak').click();await until(async()=>(await posts()).length,count=>count>before);await page.locator('#speech-stop').click();await until(()=>page.locator('#speech-stop').isVisible(),visible=>!visible);assert.equal(await page.locator('#speech-replay').isEnabled(),false);assert.ok(await app.evaluate(()=>global.__duoCartesiaFixture.aborted)>0);
    assert.ok(!await page.evaluate(secret=>localStorage.getItem('duo-voice-settings').includes(secret),secret));
    const record=await fs.readFile(path.join(env.DUO_VOICE_DATA_ROOT,'credentials',credential.credential.ref+'.json'),'utf8');assert.ok(!record.includes(secret));
    await assert.rejects(fs.stat(path.join(env.DUO_VOICE_DATA_ROOT,'voicegen','backend.log')),error=>error.code==='ENOENT');assert.deepEqual(errors,[]);
    await page.screenshot({path:path.join(output,'cartesia-speech.png')});await fs.writeFile(path.join(output,'report.json'),JSON.stringify({passed:true,synthetic:true,hostedNetworkMocked:true,physicalAudioMuted:true,checks:['real encrypted credential and main IPC','local-only blocks before fetch','synthesis-free model/voice discovery','two selected companion voices in chat','Speech PCM playback','Replay without another POST','Stop aborts request and clears incomplete take','no local voice references or owned backend startup','no renderer errors']},null,2));console.log('CARTESIA FIXTURE SMOKE PASS\n'+path.join(output,'report.json'));
  }catch(error){if(page)await page.screenshot({path:path.join(output,'failure.png')});throw error;}
  finally{await app?.close();model.closeAllConnections();await new Promise(resolve=>model.close(resolve));}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
