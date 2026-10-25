'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const {inputReference,inputWav}=require('../scripts/live-smoke.cjs');
const {inspectSetup}=require('../scripts/setup-check.cjs');
const {wav}=require('../src/voice/pcm-wav');
const root=path.resolve(__dirname,'..');
async function fixture(t){
 await fs.mkdir(path.join(root,'artifacts'),{recursive:true});
 const folder=await fs.mkdtemp(path.join(root,'artifacts','setup-test-'));
 t.after(()=>fs.rm(folder,{recursive:true,force:true}));return folder;
}
test('live input follows the registry when the selected voice filename changes',async t=>{
 const folder=await fixture(t),voice=path.join(folder,'assets/voice');
 await fs.mkdir(path.join(voice,'vivi'),{recursive:true});
 await fs.writeFile(path.join(voice,'vivi','changed-reference.wav'),wav(Buffer.alloc(48000*2),48000));
 await fs.writeFile(path.join(voice,'profiles.json'),JSON.stringify({schemaVersion:1,profiles:{'vivi.selected':{file:'vivi/changed-reference.wav'}}}));
 const ref=await inputReference(folder);
 assert.equal(ref.profile,'vivi.selected');assert.equal(path.basename(ref.file),'changed-reference.wav');
 const packed=Buffer.from(inputWav(ref.bytes),'base64');assert.equal(packed.readUInt32LE(24),16000);assert.equal(packed.readUInt32LE(40),32000);
});
test('live input rejects a registry path escaping the voice asset folder',async t=>{
 const folder=await fixture(t),voice=path.join(folder,'assets/voice');await fs.mkdir(voice,{recursive:true});
 await fs.writeFile(path.join(folder,'outside.wav'),wav(Buffer.alloc(320),16000));
 await fs.writeFile(path.join(voice,'profiles.json'),JSON.stringify({schemaVersion:1,profiles:{'vivi.selected':{file:'../../outside.wav'}}}));
 await assert.rejects(inputReference(folder),/inside assets\/voice/);
});
test('setup inspection separates optional engines from desktop prerequisites',async()=>{
 const report=await inspectSetup({root,env:{},nodeVersion:'22.12.0'});
 assert.ok(report.interfaceReady,JSON.stringify(report.application));
 assert.equal(report.voice.modelConfigFound,false);assert.equal(report.voice.state,'not-tested');
 assert.equal(report.languageModel.state,'not-tested');assert.equal(report.microphone.state,'not-tested');
});
test('setup inspection reports an incomplete clone rather than a ready interface',async t=>{
 const folder=await fixture(t),report=await inspectSetup({root:folder,env:{},nodeVersion:'18.0.0'});
 assert.equal(report.interfaceReady,false);assert.ok(report.application.some(c=>c.name==='Locked dependencies'&&!c.ok));
 assert.ok(report.application.some(c=>c.name==='Node.js 22.12+'&&!c.ok));
 const older=await inspectSetup({root:folder,env:{},nodeVersion:'22.11.0'});assert.equal(older.application[0].ok,false);
});
test('Windows launcher clears inherited Electron Node mode only for its child',{skip:process.platform!=='win32'},async t=>{
 const folder=await fixture(t);
 const script=`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$env:ELECTRON_RUN_AS_NODE = '1'
$env:DUO_VOICE_DATA_ROOT = $env:DUO_LAUNCH_TEST_ROOT
function Start-Process {
 param($FilePath,$ArgumentList,$WorkingDirectory,[switch]$PassThru,[switch]$Wait,$RedirectStandardOutput,$RedirectStandardError)
 if (Test-Path Env:ELECTRON_RUN_AS_NODE) { throw 'Child inherited Node mode' }
 if ($ArgumentList -notcontains '--windowed') { throw 'Window argument missing' }
 if ($WorkingDirectory -ne $env:DUO_LAUNCH_TEST_APP) { throw 'Wrong working directory' }
 return [pscustomobject]@{ExitCode=0}
}
& (Join-Path $env:DUO_LAUNCH_TEST_APP 'Start-Duo-Voice.ps1') -Windowed
if ($env:ELECTRON_RUN_AS_NODE -ne '1') { throw 'Parent environment was not restored' }
Write-Output 'LAUNCH CONTRACT PASS'
`;
 const encoded=Buffer.from(script,'utf16le').toString('base64');
 const output=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',encoded],{env:{...process.env,DUO_LAUNCH_TEST_ROOT:folder,DUO_LAUNCH_TEST_APP:root},encoding:'utf8',stdio:['ignore','pipe','pipe'],windowsHide:true,timeout:20000});
 assert.match(output,/LAUNCH CONTRACT PASS/);
});
test('Windows launcher materializes a missing desktop binary from an installed Electron package',{skip:process.platform!=='win32'},async t=>{
 const folder=await fixture(t),electron=path.join(folder,'node_modules/electron');await fs.mkdir(electron,{recursive:true});
 await fs.copyFile(path.join(root,'Start-Duo-Voice.ps1'),path.join(folder,'Start-Duo-Voice.ps1'));
 await fs.writeFile(path.join(folder,'package-lock.json'),'{}');await fs.writeFile(path.join(electron,'package.json'),'{}');
 await fs.writeFile(path.join(electron,'install.js'),"const fs=require('node:fs'),path=require('node:path');fs.mkdirSync(path.join(__dirname,'dist'));fs.writeFileSync(path.join(__dirname,'dist/electron.exe'),'fixture');");
 const script=`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$env:DUO_VOICE_DATA_ROOT = Join-Path $env:DUO_LAUNCH_TEST_APP 'data'
function Start-Process {
 param($FilePath,$ArgumentList,$WorkingDirectory,[switch]$PassThru,[switch]$Wait,$RedirectStandardOutput,$RedirectStandardError)
 if (-not (Test-Path -LiteralPath $FilePath -PathType Leaf)) { throw 'Desktop binary is missing' }
 return [pscustomobject]@{ExitCode=0}
}
& (Join-Path $env:DUO_LAUNCH_TEST_APP 'Start-Duo-Voice.ps1')
Write-Output 'FIRST LAUNCH PASS'
`;
 const output=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{env:{...process.env,DUO_LAUNCH_TEST_APP:folder},encoding:'utf8',stdio:['ignore','pipe','pipe'],windowsHide:true,timeout:20000});
 assert.match(output,/FIRST LAUNCH PASS/);assert.equal(await fs.readFile(path.join(electron,'dist/electron.exe'),'utf8'),'fixture');
});
