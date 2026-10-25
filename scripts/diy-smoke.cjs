'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),http=require('node:http'),{randomUUID}=require('node:crypto');
const {_electron}=require('playwright'),{createDemoServer}=require('../examples/diy-speech-server.cjs');
const root=path.resolve(__dirname,'..');
async function until(read,accept){const deadline=Date.now()+30000;do{const value=await read();if(accept(value))return value;await new Promise(resolve=>setTimeout(resolve,100));}while(Date.now()<deadline);throw Error('DIY integration check timed out.');}
async function listen(server){await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));return 'http://127.0.0.1:'+server.address().port;}
async function run(){
  const output=path.join(root,'artifacts','diy-smoke-'+randomUUID());await fs.mkdir(output,{recursive:true});
  const pcm=createDemoServer({durationMs:1600}),buffered=createDemoServer({formats:['wav'],durationMs:120});
  const selected=[],requests=[],errors=[];
  pcm.on('request',req=>{if(req.method==='POST'&&req.url==='/v1/speech'){let text='';req.on('data',part=>{text+=part;});req.on('end',()=>{const body=JSON.parse(text);requests.push(body);selected.push(body.voiceId);});}});
  let completions=0;
  const model=http.createServer(async(req,res)=>{
    for await(const _part of req){}res.setHeader('Content-Type','application/json');
    if(req.url==='/v1/models')return res.end(JSON.stringify({data:[{id:'diy-fixture-model'}]}));
    if(req.url==='/v1/chat/completions'){completions++;res.setHeader('Content-Type','text/event-stream');return res.end('data: '+JSON.stringify({choices:[{delta:{content:'[[voice: softly and calmly]]\nThis is a synthetic DIY integration reply.'},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');}
    res.statusCode=404;res.end('{}');
  });
  const pcmURL=await listen(pcm),wavURL=await listen(buffered),modelURL=await listen(model);
  let blockedSpeech=0;
  const proxy=http.createServer(async(req,res)=>{
    const chunks=[];for await(const part of req)chunks.push(part);
    const body=Buffer.concat(chunks),pathOnly=req.url.split('?')[0];
    if(blockedSpeech<1&&req.method==='POST'&&pathOnly==='/v1/speech'){blockedSpeech++;res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:{code:'SYNTHESIS_FAILED'}}));return;}
    const headers={};
    if(req.headers['content-type'])headers['content-type']=req.headers['content-type'];
    if(req.headers.authorization)headers.authorization=req.headers.authorization;
    if(body.length)headers['content-length']=String(body.length);
    const upstream=http.request({hostname:'127.0.0.1',port:pcm.address().port,path:req.url,method:req.method,headers},up=>{res.writeHead(up.statusCode||502,up.headers);up.pipe(res);});
    upstream.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end();});
    upstream.end(body);
  });
  const proxyURL=await listen(proxy);
  let app,page;
  async function configure(baseURL){
    const configured=await page.evaluate(baseURL=>window.discussion.voiceConnections('save',{provider:'diy',baseURL}),baseURL);assert.equal(configured.ok,true);
    const route={schemaVersion:1,provider:'diy',connectionId:configured.result.id,voices:{momotamu:'demo-momotamu',vivi:'demo-vivi'}};
    await page.evaluate(({route,modelURL})=>localStorage.setItem('duo-voice-settings',JSON.stringify({provider:'custom',developerConnection:true,url:modelURL+'/v1',model:'diy-fixture-model',voiceRoute:route})),{route,modelURL});
    await page.reload();await page.waitForFunction(()=>document.querySelector('.hands-free-button'));await page.locator('#turns').evaluate(el=>{el.value='2';});return route;
  }
  async function speech(){if(!await page.locator('#speech-panel').isVisible()){await page.locator('#activities-toggle').click();await page.locator('[data-activity=speech]').first().click();}}
  try{
    const env={...process.env,DUO_VOICE_DATA_ROOT:path.join(output,'data'),DUO_VOICE_SESSION_ROOT:path.join(output,'sessions'),DUO_VOICE_ROOT:path.join(output,'no-local-voice-references')};delete env.ELECTRON_RUN_AS_NODE;
    app=await _electron.launch({executablePath:require('electron'),cwd:root,args:['.','--mute-audio'],env});page=await app.firstWindow();page.on('pageerror',error=>errors.push(error.message));
    await page.waitForFunction(()=>document.querySelector('.hands-free-button'));await page.locator('#turns').evaluate(el=>{el.value='2';});const route=await configure(pcmURL);
    const health=await page.evaluate(route=>window.discussion.voiceHealth(undefined,route),route);assert.equal(health.ok,true);assert.equal(health.health.synthetic,true);
    assert.equal((await page.evaluate(route=>window.discussion.voiceProfiles(route),route)).length,2);
    await until(()=>page.locator('#conn').textContent(),text=>text.includes('Custom'));
    await page.locator('#src-input').fill('Test the two DIY companion voices.');await page.locator('#btn-run').click();
    await until(()=>page.locator('#session-status').textContent(),text=>text.includes('3 turns saved'));
    await until(()=>page.locator('#btn-run').isDisabled(),disabled=>!disabled);
    assert.ok(selected.includes('demo-momotamu')&&selected.includes('demo-vivi'));
    assert.equal(await page.locator('.chat-audio').count(),2);
    assert.match(await page.locator('#voice-direction-receipt').textContent(),/not supported/);
    await page.locator('#recipe-toggle').click();await page.locator('#recipe-tab-voice').click();await page.locator('#recipe-language-open').click();
    assert.equal(await page.locator('#persona-language-list button').count(),39);
    for(const size of [{width:480,height:800},{width:800,height:600}]){
      await page.setViewportSize(size);
      await page.evaluate(size=>{document.body.dataset.windowMode=size.height>size.width?'panel':'free';},size);
      const bounds=await page.locator('#persona-language-panel').evaluate(el=>{const r=el.getBoundingClientRect();return {inside:r.x>=0&&r.y>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1,horizontal:el.scrollWidth>el.clientWidth};});assert.equal(bounds.inside,true);assert.equal(bounds.horizontal,false);
      await page.screenshot({path:path.join(output,`persona-languages-${size.width}x${size.height}.png`)});
    }
    await page.locator('#persona-language-search').fill('no such language');assert.match(await page.locator('#persona-language-count').textContent(),/No matches/);
    await page.keyboard.press('Escape');assert.equal(await page.locator('#persona-language-panel').isVisible(),false);await page.locator('#recipe-language-open').click();assert.equal(await page.locator('#persona-language-list button').count(),39);
    await page.locator('#persona-language-search').fill('fr');await page.locator('#persona-language-list button').getByText('French',{exact:true}).click();
    assert.equal(await page.locator('#persona-language-panel').isVisible(),false);assert.equal(await page.locator('#recipe-panel').isVisible(),true);
    assert.equal(await page.locator('#recipe-language-open').evaluate(el=>el===document.activeElement),true);
    const previewBefore=requests.length;await page.locator('#recipe-voice-preview').click();await until(()=>page.locator('#recipe-voice-status').textContent(),text=>text.includes('Preview complete'));
    assert.equal(requests.length,previewBefore+1);assert.equal(requests.at(-1).language,'French');assert.match(requests.at(-1).text,/Bonjour/);
    await page.locator('#recipe-close').click();await page.locator('#gear').click();await page.locator('#btn-voice-settings').click();await until(()=>page.locator('#voice-save').isEnabled(),Boolean);
    await page.locator('#voice-provider').selectOption('off');await page.locator('#voice-save').click();await until(()=>page.locator('#voice-settings-status').textContent(),text=>text.includes('Text only saved'));await page.locator('#voice-close').click();
    await page.locator('#gear').click();
    const beforeSilent=requests.length,silentAnswers=completions;
    await page.locator('#src-input').fill('A written reply with no speech.');await page.locator('#btn-run').click();
    await until(()=>page.locator('#session-status').textContent(),text=>text.includes('6 turns saved'));await until(()=>page.locator('#btn-run').isDisabled(),disabled=>!disabled);
    assert.equal(requests.length,beforeSilent);assert.equal(completions,silentAnswers+2);assert.equal(await page.locator('[data-audio-action=speak]').count(),0);assert.equal(await page.locator('[data-audio-action=retry]').count(),0);
    assert.match(await page.locator('.msg.momotamu .msg-body').last().textContent(),/synthetic DIY integration reply/);
    const failedRoute=await page.evaluate(async baseURL=>{const configured=await window.discussion.voiceConnections('save',{provider:'diy',baseURL});if(!configured.ok)throw Error(configured.error);const settings=JSON.parse(localStorage.getItem('duo-voice-settings'));settings.voiceRoute={schemaVersion:1,provider:'diy',connectionId:configured.result.id,voices:{momotamu:'demo-momotamu',vivi:'demo-vivi'}};settings.voiceDisabled=false;delete settings.voiceSpeechDeferred;delete settings.voiceOn;localStorage.setItem('duo-voice-settings',JSON.stringify(settings));return settings.voiceRoute;},proxyURL);
    await page.reload();await page.waitForFunction(()=>document.querySelector('.hands-free-button'));await page.locator('#turns').evaluate(el=>{el.value='2';});
    const beforeFail=requests.length,failAnswers=completions;
    await page.locator('#src-input').fill('Hear this reply once speech fails.');await page.locator('#btn-run').click();
    await until(()=>page.locator('#session-status').textContent(),text=>text.includes('9 turns saved'));await until(()=>page.locator('#btn-run').isDisabled(),disabled=>!disabled);
    assert.equal(completions,failAnswers+2);assert.equal(requests.length,beforeFail+1);assert.equal(blockedSpeech,1);assert.equal(await page.locator('[data-audio-action=retry]').count(),1);
    assert.match(await page.locator('#status').textContent(),/Speech failed/);assert.match(await page.locator('.voice-delivery-receipt').textContent(),/Speech failed/);
    const failedRow=page.locator('.msg').filter({has:page.locator('[data-audio-action=retry]')});
    assert.match(await failedRow.locator('.msg-body').textContent(),/synthetic DIY integration reply/);
    const failedVoice=await failedRow.evaluate(el=>el.classList.contains('vivi')?'demo-vivi':'demo-momotamu');
    await failedRow.locator('[data-audio-action=retry]').click();
    await until(()=>page.locator('[data-audio-action=retry]').count(),count=>count===0);await until(()=>page.locator('#btn-run').isDisabled(),disabled=>!disabled);
    assert.equal(completions,failAnswers+2);assert.equal(requests.length,beforeFail+2);assert.equal(requests.at(-1).voiceId,failedVoice);assert.equal(requests.at(-1).language,'French');assert.match(requests.at(-1).text,/synthetic DIY integration reply/);
    await page.locator('[data-audio-action=replay]').last().click();await until(()=>page.locator('#btn-run').isDisabled(),disabled=>!disabled);assert.equal(requests.length,beforeFail+2);
    await page.reload();await page.waitForFunction(()=>document.querySelector('.hands-free-button'));await page.locator('#turns').evaluate(el=>{el.value='2';});
    assert.equal(await page.locator('[data-audio-action=speak]').count(),0);assert.equal(await page.locator('[data-audio-action=retry]').count(),0);
    assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('duo-voice-settings')).voiceReplyLanguage),'French');
    assert.equal(failedRoute.provider,'diy');
    await page.evaluate(()=>localStorage.setItem('duo-voice-speech-draft-v1',JSON.stringify({text:'Keep my older script.',actor:'vivi',language:'Japanese',voiceDirection:'Keep my older direction.'})));
    await page.reload();await page.waitForFunction(()=>document.querySelector('.hands-free-button'));await speech();
    assert.equal(await page.locator('select#speech-language').count(),0);assert.equal(await page.locator('#speech-language').textContent(),'French');
    assert.equal(await page.locator('#speech-text').inputValue(),'Keep my older script.');assert.equal(await page.locator('#speech-voice').inputValue(),'vivi');assert.equal(await page.locator('#speech-direction').inputValue(),'Keep my older direction.');
    assert.equal(await page.evaluate(()=>Object.hasOwn(JSON.parse(localStorage.getItem('duo-voice-speech-draft-v1')),'language')),false);
    await page.locator('#speech-language-change').click();assert.equal(await page.locator('#persona-language-list button').count(),39);await page.locator('#persona-language-search').fill('ar');await page.locator('#persona-language-list button').getByText('Arabic',{exact:true}).click();
    assert.equal(await page.locator('#speech-language').textContent(),'Arabic');assert.equal(await page.locator('#speech-language-change').evaluate(el=>el===document.activeElement),true);assert.match(await page.locator('#recipe-language-open').textContent(),/Arabic/);
    assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('duo-voice-settings')).voiceReplyLanguage),'Arabic');
    await page.locator('#speech-text').fill('مرحباً. هذا اختبار للصوت.');await page.locator('#speech-speak').click();
    await until(()=>page.locator('#speech-replay').isEnabled(),Boolean);const before=selected.length;
    assert.equal(requests.at(-1).language,'Arabic');assert.match(await page.locator('#speech-take').textContent(),/Arabic/);
    await page.locator('#speech-language-change').click();await page.locator('#persona-language-search').fill('ko');await page.locator('#persona-language-list button').getByText('Korean',{exact:true}).click();assert.equal(await page.locator('#speech-language').textContent(),'Korean');
    assert.equal(await page.locator('#speech-replay').isEnabled(),true);assert.equal(await page.locator('#speech-save').isEnabled(),true);assert.match(await page.locator('#speech-take').textContent(),/Arabic/);assert.equal(selected.length,before);
    await page.screenshot({path:path.join(output,'speech-shared-persona-language.png')});
    await page.locator('#speech-replay').click();await until(()=>page.locator('#speech-stop').isVisible(),visible=>!visible);assert.equal(selected.length,before);
    await page.locator('#speech-text').fill('Cancel this synthetic take.');await page.locator('#speech-speak').click();
    await until(()=>Promise.resolve(selected.length),count=>count>before);await page.locator('#speech-stop').click();
    await until(()=>page.locator('#speech-status').textContent(),text=>text.includes('stopped'));await until(()=>page.locator('#speech-stop').isVisible(),visible=>!visible);
    assert.equal(await page.locator('#speech-replay').isEnabled(),false);
    await configure(wavURL);await speech();await page.locator('#speech-text').fill('Buffered WAV test.');await page.locator('#speech-speak').click();
    await until(()=>page.locator('#speech-status').textContent(),text=>text.includes('Buffered WAV received'));
    await page.screenshot({path:path.join(output,'diy-buffered-speech.png')});
    await assert.rejects(fs.stat(path.join(env.DUO_VOICE_DATA_ROOT,'voicegen','backend.log')),error=>error.code==='ENOENT');
    assert.deepEqual(errors,[]);
    await fs.writeFile(path.join(output,'report.json'),JSON.stringify({passed:true,checks:['DIY capability and voice discovery','two companion voices through chat','39-choice Persona language dialog at narrow and short sizes, search and focus return','Persona French preview reaches the active provider','Text only writes the reply without calling speech','a failed reply stays readable and Retry speech speaks that same text once','Replay makes no new synthesis request','language persists after reload','generated direction handled as unsupported','actual PCM player and Speech cache replay','Stop during DIY generation','buffered WAV decoding and label','no local reference assets','no owned VoiceGen startup','no renderer errors'],synthetic:true,physicalAudioMuted:true},null,2));
    console.log('DIY SMOKE PASS\n'+path.join(output,'report.json'));
  }catch(error){if(page){console.error('STATUS',await page.locator('#status').textContent());console.error('SPEECH',await page.locator('#speech-status').textContent());console.error('ERRORS',errors);await page.screenshot({path:path.join(output,'failure.png')});}throw error;}
  finally{await app?.close();for(const server of [pcm,buffered,model,proxy]){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
