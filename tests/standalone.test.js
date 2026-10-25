'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {personalPaths}=require('../src/app/personal-data');
const root=path.resolve(__dirname,'..');
function files(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(dir,e.name)):[path.join(dir,e.name)]);}
test('the runtime has no unresolved relative CommonJS imports',()=>{
 const missing=[];
 for(const file of files(path.join(root,'src')).filter(f=>f.endsWith('.js'))){
  for(const match of fs.readFileSync(file,'utf8').matchAll(/require\(['"](\.[^'"]+)['"]\)/g)){
   try{require.resolve(path.resolve(path.dirname(file),match[1]));}catch{missing.push(path.relative(root,file)+' -> '+match[1]);}
  }
 }
 assert.deepEqual(missing,[]);
});
test('Duo paths ignore every legacy AI Discussion override and never migrate sibling data',()=>{
 const userData=path.join(root,'artifacts','isolated-profile');
 const paths=personalPaths({appRoot:root,userData,env:{AI_DISCUSSION_DATA_ROOT:'C:/foreign',AI_DISCUSSION_SESSION_ROOT:'C:/foreign-session',AI_DISCUSSION_WORKTREE_ROOT:'C:/foreign-worktree'}});
 assert.equal(paths.root,userData);assert.equal(paths.worktrees,path.join(userData,'worktrees'));
 const main=fs.readFileSync(path.join(root,'src/app/main.js'),'utf8');
 assert.doesNotMatch(main,/migratePersonalData|AI_DISCUSSION_|require\(['"][^'"]*(?:studio|agent-access|presentation)\//);
});
test('HTML scripts are external, exist, and load conversation models before their dependents',()=>{
 const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
 assert.doesNotMatch(html,/<script\s*>/);
 const scripts=[...html.matchAll(/<script[^>]*src="([^"]+)"/g)].map(m=>m[1]);
 for(const script of scripts)assert.ok(fs.existsSync(path.join(root,script)),script);
 assert.ok(scripts.indexOf('src/conversation/conversation-model.js')<scripts.indexOf('src/conversation/backstage-model.js'));
 assert.ok(scripts.includes('src/listening/listening-capture.js'));
});
test('speech PCM packaging is independent of studio export modules',()=>{
 const {wav}=require('../src/voice/pcm-wav');const pcm=Buffer.alloc(320);
 const bytes=wav(pcm,16000);assert.equal(bytes.readUInt32LE(24),16000);assert.equal(bytes.readUInt32LE(40),pcm.length);assert.equal(bytes.length,pcm.length+44);
});
