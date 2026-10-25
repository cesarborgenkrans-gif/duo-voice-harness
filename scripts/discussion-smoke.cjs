'use strict';
// Inspect actual Electron requests and round boundaries using a synthetic model. No speech or real inference.
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),http=require('node:http');
const {randomUUID}=require('node:crypto'),{_electron}=require('playwright');
const root=path.resolve(__dirname,'..');
async function until(read,accept){const deadline=Date.now()+20000;do{const value=await read();if(accept(value))return value;await new Promise(resolve=>setTimeout(resolve,50));}while(Date.now()<deadline);throw Error('Discussion check timed out.');}
async function run(){
 const output=path.join(root,'artifacts','discussion-smoke-'+randomUUID());await fs.mkdir(output,{recursive:true});
 const requests=[],errors=[],lines=['One shared office day could make planning easier.','Would that day actually help people work together?','We could reserve it for planning and mentoring.','That gives the commute a useful purpose.'];
 const model=http.createServer(async(req,res)=>{
  let body='';for await(const part of req)body+=part;
  if(req.url==='/v1/models'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({data:[{id:'discussion-fixture'}]}));}
  if(req.url==='/v1/chat/completions'){
   const request=JSON.parse(body);requests.push(request);res.setHeader('Content-Type','text/event-stream');
   res.end('data: '+JSON.stringify({choices:[{delta:{content:'[[voice: Conversational, easy pace]] '+lines[(requests.length-1)%lines.length]},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');return;
  }
  res.writeHead(404);res.end();
 });
 await new Promise(resolve=>model.listen(0,'127.0.0.1',resolve));const baseURL='http://127.0.0.1:'+model.address().port+'/v1';let app,page;
 try{
  const env={...process.env,DUO_VOICE_DATA_ROOT:path.join(output,'data'),DUO_VOICE_SESSION_ROOT:path.join(output,'sessions')};delete env.ELECTRON_RUN_AS_NODE;
  app=await _electron.launch({executablePath:require('electron'),cwd:root,args:['.','--windowed','--mute-audio'],env});page=await app.firstWindow();page.on('pageerror',error=>errors.push(error.message));
  await page.waitForFunction(()=>document.querySelector('.hands-free-button'));
  await page.evaluate(baseURL=>{localStorage.setItem('duo-voice-settings',JSON.stringify({provider:'custom',developerConnection:true,url:baseURL,model:'discussion-fixture',voiceOn:false}));localStorage.setItem('duo-voice-momotamu-recipe-v1',JSON.stringify({detail:'expanded',voiceLanguage:'ja'}));},baseURL);
  await page.reload();await page.waitForFunction(()=>document.querySelector('.hands-free-button'));await page.locator('#text-pace').evaluate(el=>{el.value='0';});
  const migrated=await page.evaluate(()=>JSON.parse(localStorage.getItem('duo-voice-settings')));
  assert.equal(migrated.voiceSpeechDeferred,true);assert.equal(Object.hasOwn(migrated,'voiceOn'),false);assert.equal(migrated.voiceDisabled,undefined);
  assert.equal(await page.locator('#voice-speech-choice').isVisible(),true);assert.match(await page.locator('#voice-speech-choice-copy').textContent(),/stay silent/);
  assert.equal(await page.locator('#turns').inputValue(),'4');assert.equal(await page.locator('#btn-run span').textContent(),'Discuss!');assert.equal(await page.locator('#reply-rhythm-control').isVisible(),false);
  async function exchange(text,turnCount){if(text)await page.locator('#src-input').fill(text);await page.locator('#btn-run').click();await until(()=>page.locator('#session-status').textContent(),value=>value.includes(turnCount+' turns saved'));await until(()=>page.locator('#btn-run').isDisabled(),value=>!value);assert.match(await page.locator('#status').textContent(),/Your turn · 4 contributions/);}
  await exchange('Should we keep a shared office day?',5);
  assert.equal(requests.length,4);assert.equal(await page.locator('#log .msg.momotamu').count(),2);assert.equal(await page.locator('#log .msg.vivi').count(),2);
  for(const [index,request] of requests.entries()){
   const system=request.messages.find(m=>m.role==='system').content;assert.match(system,/DISCUSS EXCHANGE DIRECTION/);assert.doesNotMatch(system,/Reply in 1–3|A fuller explanation/);
   const cue=request.messages.at(-1).content;assert.match(cue,index===0?/human has just contributed/:/partner’s latest actual point/);
   if(index)assert.ok(request.messages.some(m=>typeof m.content==='string'&&m.content.includes(lines[index-1])),'Partner context reaches the following request');
  }
  await exchange('',9);assert.equal(requests.length,8,'Empty Discuss continues for one bounded exchange');
  await exchange('Explain in depth how that would work, with an example.',14);assert.equal(requests.length,12);
  assert.ok(requests[8].messages.some(m=>typeof m.content==='string'&&m.content.includes('Explain in depth')));assert.match(requests[8].messages[0].content,/direct human request[\s\S]*may use more than this default length/);
  await page.locator('#conversation-options').evaluate(el=>{el.open=true;});await page.locator('.participant-chip[data-value=momotamu]').click();await until(()=>page.locator('#reply-rhythm-control').isVisible(),Boolean);await page.locator('#src-input').fill('Explain the plan directly to me.');await page.locator('#btn-run').click();await until(()=>Promise.resolve(requests.length),n=>n===13);await until(()=>page.locator('#btn-run').isDisabled(),value=>!value);
  assert.doesNotMatch(requests.at(-1).messages[0].content,/DISCUSS EXCHANGE DIRECTION/);assert.match(requests.at(-1).messages[0].content,/A fuller explanation/);assert.deepEqual(errors,[]);
  await fs.writeFile(path.join(output,'report.json'),JSON.stringify({passed:true,synthetic:true,noSpeechRequests:true,checks:['four contributions by default, then human pause','both speakers receive Discuss direction despite expanded Recipe','follow-ups use actual partner context','empty Discuss continues one bounded exchange','explicit depth request reaches the model unchanged','solo keeps its Recipe length and rhythm controls','no renderer errors']},null,2));console.log('DISCUSSION SMOKE PASS\n'+path.join(output,'report.json'));
 }catch(error){if(page)await page.screenshot({path:path.join(output,'failure.png')});throw error;}
 finally{await app?.close();model.closeAllConnections();await new Promise(resolve=>model.close(resolve));}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
