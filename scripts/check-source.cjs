'use strict';
// Rule: inspect the selected source without echoing secret values or changing Git.
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),errors=[],disclosures=[];
const git=(args,input)=>spawnSync('git',args,{cwd:root,input,encoding:'utf8',maxBuffer:32*1024*1024});
const listed=git(['ls-files','-c','-o','--exclude-standard','-z']);if(listed.status!==0)throw Error('Run source inspection inside its Git checkout.');
const names=[...new Set(listed.stdout.split('\0').filter(Boolean))].sort();
const selected=names.filter(name=>fs.existsSync(path.join(root,name)));
const probes=['node_modules/probe.js','artifacts/profile/Local Storage/data','.local-data/profile','sessions/probe/session.json','chats/probe/session.json','discussions/probe/session.json','worktrees/probe/worktree.md','image-drafts/probe.png','runtime/llama.cpp/win-x64/llama-server.exe','runtime/models/model.gguf','runtime/voicegen-oui/outputs/probe.wav','runtime/voicegen-oui/cache/probe.json','runtime/_runtime/probe.wav','.env','.env.local','credentials/probe.json','credentials.json','voice-connections.json','secrets.json','.vscode/settings.json','logs/probe.log','local-launcher.lnk','private.pem'];
const ignored=git(['check-ignore','--no-index','--stdin','-z'],probes.join('\0')+'\0');if(![0,1].includes(ignored.status))throw Error('Could not inspect ignore rules.');
const ignoredPaths=new Set(ignored.stdout.split('\0').filter(Boolean));for(const probe of probes)if(!ignoredPaths.has(probe))errors.push('Runtime/private path is not ignored: '+probe);
const required=['README.md','CONTRIBUTING.md','LICENSE','NOTICE','package-lock.json','index.html','src/app/main.js','assets/voice/profiles.json','docs/ASSET-INVENTORY.json','.github/workflows/checks.yml'];
for(const name of required)if(!selected.includes(name))errors.push('Missing candidate source: '+name);
const forbidden=/^(?:node_modules|artifacts|\.local-data|data|runtime-data|sessions|chats|discussions|worktrees|image-drafts|outputs|credentials|dist|build|coverage|logs|\.venv|venv|\.vscode|\.idea)(?:\/|$)|^runtime\/(?:llama\.cpp|models|_runtime)(?:\/|$)|^runtime\/voicegen(?:-oui)?\/(?:outputs|cache)(?:\/|$)|(?:^|\/)node_modules\/|(?:^|\/)\.env(?:\.(?!example$|template$)|$)|\.(?:gguf|safetensors|ckpt|onnx|lnk|pem|key|p12|pfx|log)$/i;
const privateNames=/^(?:credentials|secrets|voice-connections)\.json$/i;
const secrets=[['provider-key',/\bsk-(?:proj-)?[A-Za-z0-9_-]{24,}\b/g],['github-token',/\bgh[pousr]_[A-Za-z0-9]{30,}\b/g],['private-key',/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],['personal-email',/\b[A-Z0-9._%+-]+@(?:gmail|hotmail|outlook|yahoo)\.[A-Z]{2,}\b/gi]];
const binary=new Set(['.png','.jpg','.jpeg','.webp','.gif','.ico','.wav','.mp3','.ogg','.mp4','.webm','.glb','.ttf','.woff','.woff2']);
let syntax=0;
for(const name of selected){
 const full=path.join(root,name),stat=fs.lstatSync(full),ext=path.extname(name).toLowerCase();
 if(stat.isSymbolicLink()||!stat.isFile()){errors.push('Candidate must contain ordinary files: '+name);continue;}
 if(forbidden.test(name)||privateNames.test(path.basename(name)))errors.push('Runtime/private material in source selection: '+name);
 const bytes=fs.readFileSync(full);if(binary.has(ext))continue;
 const text=bytes.toString('utf8');if(text.includes('\uFFFD')||text.includes('\0'))errors.push('Unexpected binary or invalid UTF-8 source: '+name);
 for(const [label,pattern] of secrets){pattern.lastIndex=0;for(const match of text.matchAll(pattern)){const line=text.slice(0,match.index).split('\n').length;errors.push(label+' requires review at '+name+':'+line);}}
 if(/[A-Z]:[\\/]ai-(?:codexa|chiyuki|lab|signal)[\\/]/i.test(text))disclosures.push(name+' contains an external workspace-origin/reference path; review its intended disclosure.');
 if(/\r\r\n/.test(text))errors.push('Doubled carriage returns: '+name);
 if(['.js','.cjs'].includes(ext)){const result=spawnSync(process.execPath,['--check',full],{encoding:'utf8',windowsHide:true});syntax++;if(result.status!==0)errors.push('JavaScript syntax failed: '+name);}
 if(ext==='.json'){try{JSON.parse(text);}catch{errors.push('Invalid JSON: '+name);}}
 if(ext==='.md')for(const match of text.matchAll(/\]\(([^)]+)\)/g)){
  const target=match[1].split('#',1)[0];if(!target||/^[a-z][a-z0-9+.-]*:/i.test(target))continue;
  if(!fs.existsSync(path.resolve(path.dirname(full),decodeURIComponent(target))))errors.push('Missing Markdown link in '+name+': '+target);
 }
}
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')),lock=JSON.parse(fs.readFileSync(path.join(root,'package-lock.json'),'utf8'));
if(pkg.version!==lock.version||pkg.version!==lock.packages?.['']?.version)errors.push('Package and lockfile version disagree.');
const assets=spawnSync(process.execPath,[path.join(root,'scripts/audit-assets.cjs')],{cwd:root,encoding:'utf8',windowsHide:true});if(assets.status!==0)errors.push('Asset inventory does not match selected source. Run npm run audit:assets for details.');
console.log(JSON.stringify({passed:errors.length===0,files:selected.length,javascriptSyntaxChecks:syntax,ignoreProbes:probes.length,contentScan:'Narrow credential/private-material patterns only; not a complete secret audit.',disclosures,errors},null,2));if(errors.length)process.exitCode=1;
