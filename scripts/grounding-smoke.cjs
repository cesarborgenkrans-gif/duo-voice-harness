'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),http=require('node:http'),{randomUUID}=require('node:crypto'),{_electron}=require('playwright');
const {createDemoServer}=require('../examples/diy-speech-server.cjs');
const root=path.resolve(__dirname,'..');
async function until(read,accept){const deadline=Date.now()+25000;do{const value=await read();if(accept(value))return value;await new Promise(resolve=>setTimeout(resolve,75));}while(Date.now()<deadline);throw Error('Document integration check timed out.');}
async function run(){
 const output=path.join(root,'artifacts','grounding-smoke-'+randomUUID());await fs.mkdir(output,{recursive:true});
 const spoken=[],speech=createDemoServer({durationMs:120});speech.on('request',req=>{if(req.method==='POST'&&req.url==='/v1/speech'){let data='';req.on('data',part=>data+=part);req.on('end',()=>spoken.push(JSON.parse(data).text));}});await new Promise(resolve=>speech.listen(0,'127.0.0.1',resolve));const speechURL='http://127.0.0.1:'+speech.address().port;
 const requests=[],errors=[],checks=[],views=[];let mode='normal',earlyClosed=0,lateSent=0,app,page;
 const server=http.createServer(async(req,res)=>{
  let data='';for await(const part of req)data+=part;
  if(req.url==='/v1/models'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({data:[{id:'grounding-fixture'}]}));}
  if(req.url!=='/v1/chat/completions'){res.statusCode=404;return res.end('{}');}
  requests.push(JSON.parse(data));res.setHeader('Content-Type','text/event-stream');
  const send=content=>res.write('data: '+JSON.stringify({choices:[{delta:{content}}]})+'\n\n');
  if(mode==='abstain'){
   const parts=['[SPEAKER: vivi]',' [[voice: calm]]',' [AB','STAIN] UNSUPPORTED_POISON'];let index=0;
   const interval=setInterval(()=>{if(index<parts.length)send(parts[index++]);else{lateSent++;send(' LATE_UNSUPPORTED_TEXT');clearInterval(interval);res.end('data: [DONE]\n\n');}},45);
   res.on('close',()=>{clearInterval(interval);if(index===parts.length)earlyClosed++;});return;
  }
  send('The workshop access code is copper-leaf. [L2]');res.end('data: [DONE]\n\n');
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const modelURL='http://127.0.0.1:'+server.address().port;
 try{
  const env={...process.env,DUO_VOICE_DATA_ROOT:path.join(output,'data'),DUO_VOICE_SESSION_ROOT:path.join(output,'sessions'),DUO_VOICE_ROOT:path.join(output,'no-voice-assets')};delete env.ELECTRON_RUN_AS_NODE;
  app=await _electron.launch({executablePath:require('electron'),cwd:root,args:['.','--mute-audio'],env});page=await app.firstWindow();page.on('pageerror',error=>errors.push(error.message));await page.waitForFunction(()=>document.querySelector('.hands-free-button'));await page.locator('#turns').evaluate(el=>{el.value='2';});
  const connection=await page.evaluate(baseURL=>window.discussion.voiceConnections('save',{provider:'diy',baseURL}),speechURL);assert.equal(connection.ok,true);
  await page.evaluate(({modelURL,connectionId})=>localStorage.setItem('duo-voice-settings',JSON.stringify({provider:'custom',developerConnection:true,url:modelURL+'/v1',model:'grounding-fixture',voiceOn:true,voiceRoute:{schemaVersion:1,provider:'diy',connectionId,voices:{momotamu:'demo-momotamu',vivi:'demo-vivi'}}})),{modelURL,connectionId:connection.result.id});
  await page.reload();await page.waitForFunction(()=>document.querySelector('.hands-free-button'));await page.locator('#turns').evaluate(el=>{el.value='2';});await until(()=>page.locator('#conn').textContent(),text=>text.includes('Custom'));
  const file=path.join(output,'workshop.md');await fs.writeFile(file,'The workshop opens on Tuesday.\nThe access code is copper-leaf.');
  await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},file);
  await page.locator('#source-document-open').click();await page.locator('#source-pick').click();await until(()=>page.locator('#source-text').inputValue(),text=>text.includes('copper-leaf'));await page.locator('#source-use').click();await until(()=>page.locator('#source-panel').isVisible(),v=>!v);
  async function session(){const result=await page.evaluate(()=>window.discussion.sessionsList({kind:'discussion'}));assert.equal(result.ok,true);const item=result.sessions[0];assert.ok(item);const read=await page.evaluate(item=>window.discussion.sessionGet({kind:'discussion',id:item.id}),item);assert.equal(read.ok,true);return read.session;}
  const saved=await session();assert.equal(saved.sourceDocument.policy,'document-only');assert.match(saved.sourceDocument.text,/copper-leaf/);
  await page.locator('#src-input').fill('What is the workshop access code?');await page.locator('#btn-run').click();await until(()=>page.locator('#session-status').textContent(),text=>text.includes('3 turns saved'));await until(()=>page.locator('#btn-run').isDisabled(),v=>!v);
  assert.equal(requests.length,2,'each companion makes one grounded request without speculative prefetch');
  for(const request of requests){const messages=JSON.stringify(request.messages);assert.match(messages,/DOCUMENT-ONLY MODE/);assert.match(messages,/\[L2\] The access code is copper-leaf/);assert.match(messages,/The human question is/);}
  checks.push('visible file attachment, bounded text saved with chat, both companion requests include numbered source, no document prefetch');
  await page.locator('#src-input').fill('What is the orbital velocity of Jupiter?');await page.locator('#btn-run').click();await until(()=>page.locator('#session-status').textContent(),text=>text.includes('6 turns saved'));await until(()=>page.locator('#btn-run').isDisabled(),v=>!v);assert.equal(requests.length,2,'both refusals bypass model generation');
  const refused=(await session()).entries.slice(-2);assert.deepEqual(new Set(refused.map(e=>e.speaker)),new Set(['momotamu','vivi']));assert.ok(refused.every(e=>!e.text.includes('copper-leaf')));checks.push('every companion refuses absent support without another model POST');
  await page.reload();await page.waitForFunction(()=>document.querySelector('.hands-free-button'));await page.locator('#turns').evaluate(el=>{el.value='2';});await page.locator('#source-document-open').click();assert.match(await page.locator('#source-text').inputValue(),/copper-leaf/);
  for(const size of [{width:800,height:600},{width:800,height:1280},{width:480,height:800}]){
   await page.setViewportSize(size);await page.evaluate(size=>{document.body.dataset.windowMode=size.height>size.width?'panel':'free';},size);
   const metrics=await page.locator('#source-panel').evaluate(el=>{const r=el.getBoundingClientRect(),footer=document.querySelector('#source-use').getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,footerBottom:footer.bottom,horizontal:el.scrollWidth>el.clientWidth};});assert.ok(metrics.x>=0&&metrics.y>=0&&metrics.right<=size.width+1&&metrics.bottom<=size.height+1);assert.ok(metrics.footerBottom<=size.height);assert.equal(metrics.horizontal,false);views.push({size,...metrics});
   const before=await page.locator('#source-use').boundingBox();await page.locator('.source-options').evaluate(el=>el.scrollTop=el.scrollHeight);assert.ok(Math.abs((await page.locator('#source-use').boundingBox()).y-before.y)<1);await page.screenshot({path:path.join(output,`document-${size.width}x${size.height}.png`)});
  }
  await page.locator('#source-close').click();checks.push('reopen persistence; short desktop, portrait and narrow dialog keep footer fixed and controls scrollable');
  const current=await session(),grounding={sourceId:current.sourceDocument.id,session:{kind:current.kind,id:current.id},actor:'momotamu',question:'What is the workshop access code?'};
  async function request(reference=grounding){return page.evaluate(async({modelURL,reference})=>{const chunks=[];const result=await window.discussion.llmChatStream({id:crypto.randomUUID(),provider:'custom',developerConnection:true,baseURL:modelURL+'/v1',model:'grounding-fixture',messages:[{role:'user',content:reference.question}],grounding:reference},delta=>chunks.push(delta));return {result,chunks};},{modelURL,reference});}
  await app.evaluate((_e,root)=>{const gate=process.getBuiltinModule('module').createRequire(root+'/package.json')('./src/documents/document-gate');globalThis.__savedGate=gate.evaluate;gate.evaluate=async()=>{throw Error('Simulated check failure');};},root);
  const failed=await request();assert.equal(failed.result.ok,false);assert.match(failed.result.error,/Document check failed/);assert.equal(failed.result.groundingReceipt.state,'check-error');assert.equal(requests.length,2);
  const changed=await page.evaluate(current=>window.discussion.sessionTextSource({...current,source:{...current.sourceDocument,policy:'general'}}),current);assert.equal(changed.ok,true);
  const generalRef={...grounding,sourceId:changed.session.sourceDocument.id};const general=await request(generalRef);assert.equal(general.result.ok,true);assert.equal(general.result.groundingReceipt.state,'check-error-general');assert.equal(requests.length,3);
  await app.evaluate(()=>{const gate=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('./src/documents/document-gate');gate.evaluate=globalThis.__savedGate;});
  assert.equal((await request(grounding)).result.ok,false,'stale source reference rejected');assert.equal(requests.length,3);
  checks.push('main-process authoritative source, stale identity rejection, check-error stops strict request, General explicitly discloses failure');
  mode='abstain';const abstained=await request(generalRef);assert.equal(abstained.result.ok,true);assert.equal(abstained.result.text,'[ABSTAIN]');assert.equal(abstained.result.groundingReceipt.state,'model-abstain');assert.ok(!abstained.chunks.join('').includes('POISON'));await until(()=>Promise.resolve(earlyClosed),count=>count===1);assert.equal(lateSent,0);checks.push('split speaker/voice/ABSTAIN headers abort actual HTTP stream before poison delivery and late generation');
  await page.reload();await page.waitForFunction(()=>document.querySelector('.hands-free-button'));await page.locator('#turns').evaluate(el=>{el.value='2';});await page.locator('#src-input').fill('What is the workshop access code?');await page.locator('#btn-run').click();await until(()=>page.locator('#session-status').textContent(),text=>text.includes('9 turns saved'));await until(()=>page.locator('#btn-run').isDisabled(),v=>!v);assert.ok(!(await page.locator('#log').textContent()).includes('UNSUPPORTED'));assert.ok(!(await page.locator('#log').textContent()).includes('[ABSTAIN]'));assert.equal(lateSent,0);assert.equal(spoken.length,6);assert.ok(spoken.every(text=>!text.includes('UNSUPPORTED')&&!text.includes('[ABSTAIN]')));checks.push('renderer persists and speaks controlled persona refusals, never accompanying unsupported text or routing metadata');
  mode='normal';await app.evaluate((_e,root)=>{const gate=process.getBuiltinModule('module').createRequire(root+'/package.json')('./src/documents/document-gate');gate.evaluate=async()=>{globalThis.__gateWaiting=true;return new Promise(resolve=>{globalThis.__releaseGate=()=>resolve({decision:'ANSWERABLE',passages:[],topScore:1});});};},root);
  const beforeCancel=requests.length;await page.evaluate(({modelURL,reference})=>{window.__cancelledCheck=window.discussion.llmChatStream({id:'cancelled-document-check',provider:'custom',developerConnection:true,baseURL:modelURL+'/v1',model:'grounding-fixture',messages:[],grounding:reference},()=>{});},{modelURL,reference:generalRef});await until(()=>app.evaluate(()=>globalThis.__gateWaiting),Boolean);await page.evaluate(()=>window.discussion.cancelLlm('cancelled-document-check'));await app.evaluate(()=>globalThis.__releaseGate());assert.equal((await page.evaluate(()=>window.__cancelledCheck)).ok,false);assert.equal(requests.length,beforeCancel);await app.evaluate(()=>{process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('./src/documents/document-gate').evaluate=globalThis.__savedGate;});checks.push('Stop during a pending relevance check prevents a late model request');
  await page.locator('#source-document-open').click();await page.locator('#source-remove').click();await until(()=>page.locator('#source-panel').isVisible(),v=>!v);assert.equal((await session()).sourceDocument,null);
  assert.deepEqual(errors,[]);await fs.writeFile(path.join(output,'report.json'),JSON.stringify({passed:true,syntheticLanguageModel:true,physicalAudioMuted:true,checks,views,modelRequests:requests.length},null,2));console.log('GROUNDING SMOKE PASS\n'+path.join(output,'report.json'));
 }catch(error){if(page){console.error('STATUS',await page.locator('#status').textContent());console.error('SESSION',await page.locator('#session-status').textContent());console.error('ERRORS',errors);await page.screenshot({path:path.join(output,'failure.png')});}throw error;}
 finally{await app?.close();for(const service of [server,speech]){service.closeAllConnections();await new Promise(resolve=>service.close(resolve));}}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
