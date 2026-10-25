'use strict';
// Read-only setup inspection: never starts engines, probes accounts or reads stored keys.
const fs=require('node:fs/promises');
const path=require('node:path');
const {createVoiceService}=require('../src/voice/voice-service');
async function inspectSetup({root=path.resolve(__dirname,'..'),env=process.env,nodeVersion=process.versions.node}={}){
 const exists=async file=>{try{return (await fs.stat(file)).isFile();}catch{return false;}};
 const [major,minor]=nodeVersion.split('.').map(Number);
 const application=[
  {name:'Node.js 22.12+',ok:major>22||major===22&&minor>=12,action:'Install Node.js 22.12 or newer.'},
  {name:'Locked dependencies',ok:await exists(path.join(root,'package-lock.json')),action:'Restore package-lock.json from the complete source.'},
  {name:'Electron desktop runtime',ok:await exists(path.join(root,'node_modules/electron/dist/electron.exe')),action:'Run npm ci, then the launcher or npm start to download the desktop binary on first use.'},
  {name:'Application entry point',ok:await exists(path.join(root,'src/app/main.js')),action:'Restore the complete source.'}
 ];
 let references;
 try{references=await createVoiceService({voiceRoot:path.join(root,'assets/voice')}).profiles();}
 catch{references=[{id:'voice-registry',available:false,error:'Restore assets/voice/profiles.json and its selected WAVs.'}];}
 for(const ref of references)application.push({name:ref.id+' reference',ok:ref.available,action:ref.available?'':ref.error});
 const llama=env.DUO_VOICE_LLAMA_BINARY||path.join(root,'runtime/llama.cpp/win-x64/llama-server.exe');
 const candidates=[env.DUO_VOICE_MODEL_PATH,env.LOCALAPPDATA&&path.join(env.LOCALAPPDATA,'VoiceGenOui/models/VoxCPM2'),env.LOCALAPPDATA&&path.join(env.LOCALAPPDATA,'VoiceGenChiyukiAI/models/VoxCPM2')].filter(Boolean);
 let modelFound=false;for(const candidate of candidates)if(await exists(path.join(candidate,'config.json')))modelFound=true;
 return {interfaceReady:application.every(c=>c.ok),application,
  languageModel:{state:'not-tested',runtimePresent:await exists(llama),next:'Use Local engines → AI model setup to select a model and matching projector. Run npm run setup:llama if the built-in runtime is missing.'},
  microphone:{state:'not-tested',next:'Native microphone understanding needs the built-in Gemma pair, its projector and microphone permission.'},
  voice:{provider:'VoxCPM2 — featured local integration',state:'not-tested',modelConfigFound:modelFound,pythonEnvironmentConfigured:!!env.DUO_VOICE_WSL_VENV,next:'Use Local engines → Start voice → Warm up voice. WSL/ROCm, a compatible Python environment and weights are required. Environment discovery is checked at startup.'},
  note:'Engine readiness is separate from interface readiness. This check makes no network requests, starts no engines and does not verify hardware or model contents.'};
}
async function main(){
 const report=await inspectSetup();
 if(process.argv.includes('--json'))console.log(JSON.stringify(report,null,2));
 else{
  console.log('Duo Voice Harness — setup check');
  for(const check of report.application)console.log(`${check.ok?'OK':'NEEDS SETUP'} · ${check.name}${check.ok?'':' — '+check.action}`);
  console.log('\nLanguage model · '+report.languageModel.next);
  console.log('Microphone · '+report.microphone.next);
  console.log('Featured voice · '+report.voice.next);
  console.log('\n'+report.note);
 }
 if(!report.interfaceReady)process.exitCode=1;
}
if(require.main===module)main().catch(error=>{console.error('Setup inspection failed: '+error.message);process.exitCode=1;});
module.exports={inspectSetup};
