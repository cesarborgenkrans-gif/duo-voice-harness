'use strict';
// Real Electron safeStorage and IPC; generated secrets and loopback servers only.
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),http=require('node:http');
const {randomUUID}=require('node:crypto'),{_electron}=require('playwright');
const root=path.resolve(__dirname,'..');
async function until(read,accept){const deadline=Date.now()+20000;do{const value=await read();if(accept(value))return value;await new Promise(resolve=>setTimeout(resolve,100));}while(Date.now()<deadline);throw Error('Credential check timed out.');}
async function run(){
  const output=path.join(root,'artifacts','credentials-smoke-'+randomUUID());await fs.mkdir(output,{recursive:true});
  const secret=randomUUID(),replacement=randomUUID(),sessionSecret=randomUUID();let unexpected=0,authorized=false;
  const other=http.createServer((_req,res)=>{unexpected++;res.end('{}');});await new Promise(resolve=>other.listen(0,'127.0.0.1',resolve));
  const otherOrigin='http://127.0.0.1:'+other.address().port;
  const server=http.createServer((req,res)=>{
    if(req.url.startsWith('/redirect')){res.writeHead(302,{Location:otherOrigin+'/models'});res.end();return;}
    authorized=req.headers.authorization==='Bearer '+secret||req.headers.authorization==='Bearer '+replacement;
    if(req.url.startsWith('/echo')){res.writeHead(400);res.end('Synthetic provider error '+req.headers.authorization);return;}
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data:[{id:'credential-fixture-model'}]}));
  });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+server.address().port;let app,page;
  try{
    const env={...process.env,DUO_VOICE_DATA_ROOT:path.join(output,'data'),DUO_VOICE_SESSION_ROOT:path.join(output,'sessions')};delete env.ELECTRON_RUN_AS_NODE;
    app=await _electron.launch({executablePath:require('electron'),cwd:root,args:['.'],env});page=await app.firstWindow();
    await page.waitForFunction(()=>document.querySelector('.hands-free-button'));
    const protectedAvailable=await app.evaluate(async({safeStorage})=>safeStorage.isAsyncEncryptionAvailable());assert.equal(protectedAvailable,true,'This Windows integration check requires OS-backed encryption');
    await page.evaluate(({origin,secret})=>localStorage.setItem('duo-voice-settings',JSON.stringify({provider:'custom',developerConnection:true,url:origin+'/v1',key:secret,model:'credential-fixture-model',voiceOn:false})),{origin,secret});
    await page.reload();await page.waitForFunction(()=>document.querySelector('.hands-free-button'));
    const settings=await page.evaluate(()=>JSON.parse(localStorage.getItem('duo-voice-settings')));
    assert.ok(settings.credentialRef);assert.equal('key' in settings,false);assert.ok(!JSON.stringify(settings).includes(secret));
    const record=await fs.readFile(path.join(env.DUO_VOICE_DATA_ROOT,'credentials',settings.credentialRef+'.json'),'utf8');assert.ok(!record.includes(secret));
    const request={provider:'custom',baseURL:origin+'/v1',credentialRef:settings.credentialRef};
    assert.equal((await page.evaluate(opts=>window.discussion.llmModels(opts),request)).ok,true);assert.equal(authorized,true);
    assert.equal((await page.evaluate(opts=>window.discussion.llmModels(opts),{...request,baseURL:otherOrigin+'/v1'})).ok,false);assert.equal(unexpected,0);
    assert.equal((await page.evaluate(opts=>window.discussion.llmModels(opts),{...request,baseURL:origin+'/redirect'})).ok,false);assert.equal(unexpected,0);
    const echoed=await page.evaluate(opts=>window.discussion.llmChat(opts),{...request,baseURL:origin+'/echo',messages:[{role:'user',content:'Synthetic error check.'}]});
    assert.equal(echoed.ok,false);assert.ok(!JSON.stringify(echoed).includes(secret));assert.match(echoed.error,/redacted/);
    await page.locator('#gear').click();await page.locator('#developer-connection > summary').click();
    assert.equal(await page.locator('#cfg-key').getAttribute('type'),'password');assert.equal(await page.locator('#cfg-key').inputValue(),'');
    await page.locator('#cfg-key').fill(replacement);await page.locator('#cfg-save').click();
    await until(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('duo-voice-settings')).credentialRef),ref=>ref&&ref!==settings.credentialRef);
    assert.equal(await page.locator('#cfg-key').inputValue(),'');
    assert.equal((await page.evaluate(ref=>window.discussion.credentialStatus(ref),settings.credentialRef)).ok,false);
    const current=await page.evaluate(()=>JSON.parse(localStorage.getItem('duo-voice-settings')));
    assert.ok(!JSON.stringify(current).includes(replacement));
    await page.locator('#cfg-key-remove').click();await until(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('duo-voice-settings')).credentialRef),ref=>ref==='');
    assert.equal((await page.evaluate(opts=>window.discussion.llmModels(opts),{...request,credentialRef:current.credentialRef})).ok,false);
    // Simulate an unavailable OS protector; migration must preserve the original until explicit session-only consent.
    await app.evaluate(({safeStorage})=>{safeStorage.isAsyncEncryptionAvailable=async()=>false;});
    await page.evaluate(({origin,sessionSecret})=>localStorage.setItem('duo-voice-settings',JSON.stringify({provider:'custom',developerConnection:true,url:origin+'/v1',key:sessionSecret,model:'credential-fixture-model',voiceOn:false})),{origin,sessionSecret});
    await page.reload();await page.waitForFunction(()=>document.querySelector('.hands-free-button'));
    assert.equal(await page.evaluate(()=>!!JSON.parse(localStorage.getItem('duo-voice-settings')).key),true,'Failed migration preserves the old setting');
    await page.locator('#gear').click();await page.locator('#developer-connection > summary').click();
    await page.locator('#cfg-key-session').check();await page.locator('#cfg-save').click();
    const sessionRef=await until(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('duo-voice-settings')).credentialRef),Boolean);
    assert.equal(await page.evaluate(()=>Object.hasOwn(JSON.parse(localStorage.getItem('duo-voice-settings')),'key')),false);
    assert.equal((await page.evaluate(ref=>window.discussion.credentialStatus(ref),sessionRef)).credential.mode,'session');
    assert.match(await page.locator('#status').textContent(),/migration completed/);
    await assert.rejects(fs.stat(path.join(env.DUO_VOICE_DATA_ROOT,'credentials',sessionRef+'.json')),error=>error.code==='ENOENT');
    await page.screenshot({path:path.join(output,'credential-settings.png')});
    await app.evaluate((_electron,value)=>{process.emit('unhandledRejection',Error('Synthetic diagnostic '+value));},sessionSecret);
    const diagnostic=await fs.readFile(path.join(env.DUO_VOICE_DATA_ROOT,'logs','main-errors.log'),'utf8');assert.ok(!diagnostic.includes(sessionSecret));assert.match(diagnostic,/redacted/);
    const report={passed:true,protectedAvailable,checks:['real OS-backed encryption','verified legacy migration','opaque settings references','blank saved-key field','origin binding','redirect rejection','provider-error and diagnostic redaction','UI key replacement','UI key removal','failed migration preserves original','explicit session-only recovery without a key file']};
    await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log('CREDENTIALS SMOKE PASS\n'+path.join(output,'report.json'));
  }finally{await app?.close();for(const instance of [server,other]){instance.closeAllConnections();await new Promise(resolve=>instance.close(resolve));}}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
