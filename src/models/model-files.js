'use strict';
// Read LM Studio's selected storage without starting it or modifying its settings.
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const MODEL='gemma-4-12B-it-QAT-Q4_0.gguf',PROJECTOR='mmproj-gemma-4-12B-it-QAT-BF16.gguf';
async function smallText(file){const stat=await fs.stat(file);if(!stat.isFile()||stat.size>1024*1024)throw Error('Unsupported settings file.');return (await fs.readFile(file,'utf8')).replace(/^\uFEFF/,'').trim();}
function absolute(value,home){if(typeof value!=='string'||!value.trim())return null;const v=value.trim();const expanded=/^~[\\/]/.test(v)?path.join(home,v.slice(2)):v;return path.isAbsolute(expanded)?path.normalize(expanded):null;}
async function discoverLMStudio({home=os.homedir(),appData=process.env.APPDATA,env=process.env}={}){
 const warnings=[],pointerFile=path.join(home,'.lmstudio-home-pointer');let pointer=null;
 try{pointer=absolute(await smallText(pointerFile),home);if(!pointer)warnings.push('LM Studio home pointer is not an absolute path.');}catch(e){if(e.code!=='ENOENT')warnings.push('LM Studio home pointer could not be read.');}
 const envHome=absolute(env.LMSTUDIO_HOME,home),defaultHome=path.join(home,'.lmstudio');
 const activeHome=envHome||pointer||defaultHome;
 const settingsFiles=[path.join(activeHome,'settings.json')];
 // Older installations kept their settings in the Electron roaming directory.
 if(appData&&!envHome&&!pointer)settingsFiles.push(path.join(appData,'LM Studio','settings.json'));
 for(const file of settingsFiles){try{const settings=JSON.parse(await smallText(file)),folder=absolute(settings.downloadsFolder,home);if(folder)return {folder,settingsFile:file,home:path.dirname(file),source:'settings',pointerFile:pointer?pointerFile:null,warnings};if(settings.downloadsFolder)warnings.push('An invalid LM Studio downloadsFolder was ignored.');}catch(e){if(e.code!=='ENOENT')warnings.push('LM Studio settings could not be read: '+file);}}
 return {folder:path.join(envHome||pointer||defaultHome,'models'),home:envHome||pointer||defaultHome,source:'default',settingsFile:null,pointerFile:pointer?pointerFile:null,warnings};
}
async function inspectFile(file){try{const stat=await fs.stat(file);return {path:file,available:stat.isFile(),bytes:stat.size};}catch{return {path:file,available:false};}}
async function pair(folder){const [model,projector]=await Promise.all([inspectFile(path.join(folder,MODEL)),inspectFile(path.join(folder,PROJECTOR))]);return {folder,model,projector};}
async function findGemma(root){
 const expected=await pair(path.join(root,'lmstudio-community','gemma-4-12B-it-QAT-GGUF'));if(expected.model.available&&expected.projector.available)return expected;
 const flat=await pair(root);if(flat.model.available&&flat.projector.available)return flat;
 // Preserve exact quantization/projector identity; support other publisher/repo names.
 let checked=0;try{for(const publisher of await fs.readdir(root,{withFileTypes:true})){if(!publisher.isDirectory()||publisher.isSymbolicLink())continue;let repos;try{repos=await fs.readdir(path.join(root,publisher.name),{withFileTypes:true});}catch{continue;}for(const repo of repos){if(!repo.isDirectory()||repo.isSymbolicLink())continue;if(++checked>512)return expected;const found=await pair(path.join(root,publisher.name,repo.name));if(found.model.available&&found.projector.available)return found;}}}catch{}
 return expected;
}
async function inspectLocations({appFolder,selected,discoveryOptions}={}){
 const discovery=await discoverLMStudio(discoveryOptions),[lm,app]=await Promise.all([findGemma(discovery.folder),pair(appFolder)]);
 const current=selected?.modelPath?{model:await inspectFile(selected.modelPath),projector:await inspectFile(selected.projectorPath||'')}:null;
 return {lmstudio:{...lm,label:'LM Studio files',folder:discovery.folder,modelFolder:lm.folder,discovery},app:{...app,label:'Duo Voice Harness files'},selected:current};
}
module.exports={MODEL,PROJECTOR,discoverLMStudio,inspectLocations};
