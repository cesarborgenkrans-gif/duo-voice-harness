'use strict';
// Rule: inventory public-source media by bytes; keep history identities in ignored artifacts.
// --write updates the current inventory. --history writes a private, read-only Git audit.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const media=new Set(['.png','.jpg','.jpeg','.webp','.gif','.svg','.ico','.wav','.mp3','.ogg','.mp4','.webm','.glb','.gltf','.ttf','.woff','.woff2']);
const git=(...args)=>execFileSync('git',args,{cwd:root,maxBuffer:32*1024*1024});
function category(name){
 if(/^characters\/(momotamu|vivi)\/active\//.test(name))return 'character-art';
 if(name.startsWith('characters/momotamu-presence/'))return 'presence-art';
 if(name.startsWith('assets/voice/'))return 'voice-reference';
 if(/^assets\/cursor(?:-side)?\.svg$/.test(name))return 'interface-vector';
 if(name.startsWith('assets/brand/')||/^assets\/(icon(?:-256)?\.(?:png|ico)|sparklesnap-google-logo-v1\.jpg)$/.test(name))return 'brand';
 if(name.startsWith('docs/media/'))return 'readme-media';
 return 'unclassified';
}
function wavInfo(bytes){
 if(bytes.toString('ascii',0,4)!=='RIFF'||bytes.toString('ascii',8,12)!=='WAVE')throw Error('Invalid WAV header.');
 let fmt,dataBytes=0;for(let i=12;i+8<=bytes.length;){const size=bytes.readUInt32LE(i+4),start=i+8;if(start+size>bytes.length)throw Error('Truncated WAV chunk.');const type=bytes.toString('ascii',i,i+4);if(type==='fmt '&&size>=16)fmt={format:bytes.readUInt16LE(start),channels:bytes.readUInt16LE(start+2),sampleRate:bytes.readUInt32LE(start+4),byteRate:bytes.readUInt32LE(start+8),bitsPerSample:bytes.readUInt16LE(start+14)};if(type==='data')dataBytes+=size;i=start+size+(size%2);}
 if(!fmt?.byteRate||!dataBytes)throw Error('WAV lacks audio format/data.');return {...fmt,dataBytes,durationSeconds:Number((dataBytes/fmt.byteRate).toFixed(4))};
}
const inventoryPath=path.join(root,'docs','ASSET-INVENTORY.json');
const previous=fs.existsSync(inventoryPath)?JSON.parse(fs.readFileSync(inventoryPath,'utf8')):{};
const names=[...new Set(git('ls-files','-c','-o','--exclude-standard','-z').toString('utf8').split('\0').filter(Boolean))].sort();
const entries=names.filter(name=>media.has(path.extname(name).toLowerCase())&&fs.existsSync(path.join(root,name))).map(name=>{
 const bytes=fs.readFileSync(path.join(root,name)),group=category(name),entry={path:name,category:group,bytes:bytes.length,sha256:sha(bytes),publicationStatus:group==='interface-vector'?'code-license-declared':'owner-confirmation-pending'};
 if(path.extname(name).toLowerCase()==='.wav')entry.audio=wavInfo(bytes);
 if(path.extname(name).toLowerCase()==='.png'&&bytes.toString('ascii',1,4)==='PNG')entry.image={width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20)};
 const prior=previous.assets?.find(asset=>asset.path===name&&asset.sha256===entry.sha256&&asset.category===group);
 if(prior?.ownerConfirmation){
  if(!previous.ownerStatements?.[prior.ownerConfirmation])throw Error('Missing owner statement for '+name);
  entry.ownerConfirmation=prior.ownerConfirmation;entry.publicationStatus=prior.publicationStatus;
 }
 return entry;
});
const inventory={schemaVersion:1,scope:'Existing nonignored media in the current working source, including untracked candidates. Hashes identify bytes, not ownership.',rightsGuide:'ASSET-PROVENANCE.md',ownerStatements:previous.ownerStatements||{},groups:{
 'character-art':{declaredTerms:'../CHARACTER-GUIDELINES.md',evidence:'Owner-confirmed entries link to the dated statement for these exact bytes. Creation-tool details remain pending.'},
 'presence-art':{declaredTerms:'../CHARACTER-GUIDELINES.md',evidence:'The owner selected the existing character-art terms for the two inventoried stage textures on 2026-10-24. New assets require their own provenance review.'},
 'brand':{declaredTerms:'../CHARACTER-GUIDELINES.md#the-sparklesnap-brand',evidence:'Owner-confirmed entries link to the dated creation statement; generation-tool details remain pending.'},
 'voice-reference':{declaredTerms:'../CHARACTER-GUIDELINES.md',evidence:'Owner-confirmed creation statement plus original voice-design logs. Exact tools/model revisions and detailed inputs remain to be recorded; original metadata is preserved.'},
 'interface-vector':{declaredTerms:'../LICENSE',evidence:'Simple editable polygon cursor source distributed with the MIT application code.'},
 'readme-media':{declaredTerms:'../CHARACTER-GUIDELINES.md',evidence:'README banner composed from the existing stage preview, and the 28-second intro film supplied by the owner. Creation details for the film remain with that source.'}
},assets:entries};
const serialized=JSON.stringify(inventory,null,2)+'\n';
if(process.argv.includes('--write'))fs.writeFileSync(inventoryPath,serialized);
else if(!fs.existsSync(inventoryPath)||fs.readFileSync(inventoryPath,'utf8').replace(/\r\n/g,'\n')!==serialized){console.error('Asset inventory is stale. Review changes, then run npm run audit:assets -- --write.');process.exitCode=1;}
if(entries.some(e=>e.category==='unclassified')){console.error('Unclassified media requires an explicit provenance category.');process.exitCode=1;}
console.log(JSON.stringify({mediaFiles:entries.length,ownerConfirmedFiles:entries.filter(e=>e.ownerConfirmation).length,pendingOwnerConfirmation:entries.filter(e=>e.publicationStatus==='owner-confirmation-pending').length,creationDetailsPending:entries.filter(e=>e.publicationStatus==='owner-confirmed-details-pending').length,publicationClearance:'separate-release-review',categories:entries.reduce((counts,e)=>(counts[e.category]=(counts[e.category]||0)+1,counts),{})}));
if(process.argv.includes('--history')){
 const commits=git('rev-list','--all').toString().trim().split('\n').filter(Boolean),versions=new Map(),runtimePaths=new Set();
 for(const commit of commits)for(const raw of git('ls-tree','-r','-z',commit).toString('utf8').split('\0').filter(Boolean)){
  const [meta,name]=raw.split('\t'),oid=meta.split(' ')[2];
  if(media.has(path.extname(name).toLowerCase())){const key=name+'\0'+oid;if(!versions.has(key))versions.set(key,{path:name,gitBlob:oid,reachableIn:[]});versions.get(key).reachableIn.push(commit);}
  if(/(^|\/)(?:node_modules|artifacts|\.local-data|sessions|chats|discussions|outputs|credentials)(?:\/|$)|(?:^|\/)\.env(?:\.|$)|\.(?:gguf|safetensors|lnk)$/i.test(name))runtimePaths.add(name);
 }
 const historicalMedia=[...versions.values()].map(entry=>{const bytes=git('cat-file','blob',entry.gitBlob),digest=sha(bytes),current=entries.find(asset=>asset.path===entry.path);return {...entry,bytes:bytes.length,sha256:digest,relation:current?(current.sha256===digest?'current-bytes':'older-bytes-at-current-path'):'path-absent-from-working-media',...(entry.path.endsWith('.wav')?{audio:wavInfo(bytes)}:{})};});
 const identities=git('log','--all','--format=%H%x00%an%x00%ae%x00%cn%x00%ce').toString('utf8').trim().split('\n').filter(Boolean).map(line=>{const [commit,authorName,authorEmail,committerName,committerEmail]=line.split('\0');return {commit,authorName,authorEmail,committerName,committerEmail};});
 const report={reviewScope:'Commits reachable from all local Git refs; excludes unreachable objects/reflogs and is not a complete secret or rights audit.',commits:commits.length,refs:git('for-each-ref','--format=%(refname)').toString().trim().split('\n').filter(Boolean),remotes:git('remote').toString().trim().split('\n').filter(Boolean),identities,media:historicalMedia,runtimeOrPrivatePaths:[...runtimePaths].sort()};
 const folder=path.join(root,'artifacts','asset-audit-'+new Date().toISOString().replace(/[:.]/g,'-'));fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(folder,'history.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({commits:commits.length,historicalMediaVersions:historicalMedia.length,historicalMediaPaths:new Set(historicalMedia.map(e=>e.path)).size,absentPaths:[...new Set(historicalMedia.filter(e=>e.relation==='path-absent-from-working-media').map(e=>e.path))],olderVersions:historicalMedia.filter(e=>e.relation==='older-bytes-at-current-path').length,runtimeOrPrivatePathCount:runtimePaths.size,privateReport:path.relative(root,path.join(folder,'history.json')).replaceAll('\\','/')}));
}
