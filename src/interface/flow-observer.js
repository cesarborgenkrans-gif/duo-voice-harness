'use strict';
const phases=['input','context','model','voice','buffer','playback','transcript','chat','image','image-focus'];
const states=['waiting','active','ready','attention','done','skipped','error','cancelled'];
// Explicit allowlists: never forward conversation text, prompts, paths or audio.
function cleanSnapshot(raw){
 if(!raw||typeof raw!=='object')return null;
 const out={id:typeof raw.id==='string'&&/^[a-f0-9-]{36}$/i.test(raw.id)?raw.id:null,source:['text','audio','dictate'].includes(raw.source)?raw.source:'text',terminal:['idle','active','done','cancelled','error','attention'].includes(raw.terminal)?raw.terminal:'idle',nodes:{}};
 for(const key of ['note','worktree','document','image','direction','excluded'])out[key]=raw[key]===true;
 for(const key of ['received','consumed','rate'])out[key]=Number.isFinite(raw[key])?Math.max(0,Math.min(raw[key],key==='rate'?96000:57600000)):0;
 for(const phase of phases){const n=raw.nodes?.[phase]||{};out.nodes[phase]={state:states.includes(n.state)?n.state:'waiting'};}
 return out;
}
const bound=(value,max)=>Number.isFinite(value)?Math.max(0,Math.min(value,max)):0;
function cleanListeningSnapshot(raw){
 if(!raw||typeof raw!=='object')return null;
 const out={mode:raw.mode==='invited'?'invited':'other',phase:['idle','starting','listening','paused','finishing','checking','replying'].includes(raw.phase)?raw.phase:'idle',sessionId:typeof raw.sessionId==='string'&&/^[a-f0-9-]{36}$/i.test(raw.sessionId)?raw.sessionId:null,startedAt:bound(raw.startedAt,Date.now()+10000),windowSeconds:bound(raw.windowSeconds,600),pending:bound(raw.pending,100),gaps:bound(raw.gaps,100000),lagMs:bound(raw.lagMs,600000),check:['waiting','settling','active','invited','not-invited','error'].includes(raw.check)?raw.check:'waiting',reply:cleanSnapshot(raw.reply)};
 for(const name of ['capturing','microphone','meeting'])out[name]=raw[name]===true;
 out.entries=(Array.isArray(raw.entries)?raw.entries:[]).slice(-408).map(e=>({id:typeof e?.id==='string'&&/^\d{1,12}$/.test(e.id)?e.id:'',source:e?.source==='meeting'?'meeting':'mic',startMs:bound(e?.startMs,Date.now()+10000),endMs:bound(e?.endMs,Date.now()+10000),error:e?.error===true,pinned:e?.pinned===true}));
 return out;
}
function register({ipcMain,BrowserWindow,root,getMain}){
 const path=require('node:path'),previews={talk:null,listening:null},snapshots={talk:null,listening:null};
 const trusted=e=>{const main=getMain();return main&&!main.isDestroyed()&&e.sender===main.webContents&&e.senderFrame===e.sender.mainFrame;};
 const envelope=kind=>({connected:!!getMain()&&!getMain().isDestroyed()&&!!snapshots[kind],snapshot:snapshots[kind]});
 const send=kind=>{try{const preview=previews[kind];if(preview&&!preview.isDestroyed())preview.webContents.send('flow-observer-state',envelope(kind));}catch{}};
 for(const [kind,channel,clean] of [['talk','flow-observer-publish',cleanSnapshot],['listening','flow-listening-observer-publish',cleanListeningSnapshot]])ipcMain.on(channel,(e,value)=>{if(!trusted(e))return;const cleaned=clean(value);if(cleaned){snapshots[kind]=cleaned;send(kind);}});
 ipcMain.handle('flow-observer-read',e=>{const kind=Object.keys(previews).find(k=>previews[k]&&!previews[k].isDestroyed()&&e.sender===previews[k].webContents&&e.senderFrame===e.sender.mainFrame);if(!kind)throw Error('Untrusted flow observer');return envelope(kind);});
 function open(kind='talk'){
  if(!Object.hasOwn(previews,kind))kind='talk';
  let preview=previews[kind];if(preview&&!preview.isDestroyed()){preview.show();preview.focus();return preview;}
  preview=new BrowserWindow({width:340,height:820,minWidth:320,minHeight:460,title:'Duo Voice Harness · '+(kind==='listening'?'Listening · ':'Talk · ')+'Real backend test',backgroundColor:'#f4f6f3',webPreferences:{preload:path.join(root,'src/interface/flow-observer-preload.js'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  previews[kind]=preview;preview.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  preview.webContents.on('will-navigate',e=>e.preventDefault());
  preview.on('closed',()=>{if(previews[kind]===preview)previews[kind]=null;});
  preview.loadFile(path.join(root,'docs',kind==='listening'?'flow-listening-real-backend-test.html':'flow-real-backend-test.html'));
  return preview;
 }
 function disconnect(){for(const kind of Object.keys(snapshots)){snapshots[kind]=null;send(kind);}}
 return {open,disconnect,close(){for(const preview of Object.values(previews))preview?.close();},attach(main){main.webContents.on('did-start-navigation',(_e,_url,_inPlace,isMain)=>{if(isMain)disconnect();});main.webContents.on('render-process-gone',disconnect);}};
}
module.exports={cleanSnapshot,cleanListeningSnapshot,register};
