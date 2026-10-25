'use strict';
// Synthetic tones, not speech. No models, reference uploads, subprocesses or output files.
const http=require('node:http'),{timingSafeEqual}=require('node:crypto');
const {wav}=require('../src/voice/pcm-wav');
function createDemoServer({formats=['pcm_s16le','wav'],token='',durationMs=1200,sampleRate=24000}={}){
  const jobs=new Map(),voices=[{id:'demo-momotamu',label:'Momotamu test tone · 330 Hz'},{id:'demo-vivi',label:'Vivi test tone · 440 Hz'}];
  const send=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
  const status=job=>({contractVersion:1,requestId:job.id,state:job.state,audioSamples:job.audioSamples});
  function stop(job){if(!['completed','cancelled','failed'].includes(job.state))job.state='cancelled';job.response?.destroy();}
  function prune(){for(const [id,job]of jobs)if(Date.now()-job.createdAt>60000){stop(job);jobs.delete(id);}while(jobs.size>=32){const item=[...jobs].find(([,job])=>['completed','cancelled','failed'].includes(job.state));if(!item)break;jobs.delete(item[0]);}}
  async function body(req){let length=0,parts=[];for await(const part of req){length+=part.length;if(length>65536)throw Error('Request exceeds 64 KiB.');parts.push(part);}return JSON.parse(Buffer.concat(parts).toString('utf8')||'{}');}
  function pcm(job,offset,count){const bytes=Buffer.alloc(count*2),frequency=job.voiceId==='demo-momotamu'?330:440;for(let n=0;n<count;n++){const frame=offset+n,envelope=Math.min(1,frame/240,(job.samples-frame)/240);bytes.writeInt16LE(Math.round(Math.sin(frame*2*Math.PI*frequency/sampleRate)*1000*Math.max(0,envelope)),n*2);}return bytes;}
  const server=http.createServer(async(req,res)=>{
    try{
      if(token){const supplied=Buffer.from(req.headers.authorization||''),expected=Buffer.from('Bearer '+token);if(supplied.length!==expected.length||!timingSafeEqual(supplied,expected))return send(res,401,{error:{code:'AUTH_REQUIRED'}});}
      prune();const url=new URL(req.url,'http://localhost');
      if(req.method==='GET'&&url.pathname==='/v1/capabilities')return send(res,200,{contractVersion:1,sessionOnly:true,synthetic:true,formats,voices});
      if(req.method==='POST'&&url.pathname==='/v1/speech'){
        const input=await body(req);
        if(input.contractVersion!==1||!/^[\w-]{6,100}$/.test(input.requestId||'')||!['momotamu','vivi'].includes(input.actor)||!voices.some(voice=>voice.id===input.voiceId)||typeof input.text!=='string'||!input.text.trim()||input.text.length>8000||typeof input.language!=='string'||input.outputRetention!=='session'||!formats.includes(input.format))return send(res,400,{error:{code:'INVALID_REQUEST'}});
        if(jobs.has(input.requestId))return send(res,409,{error:{code:'REQUEST_ALREADY_EXISTS'}});
        if(jobs.size>=32||[...jobs.values()].some(job=>['open','generating'].includes(job.state)))return send(res,409,{error:{code:'BUSY'}});
        const job={id:input.requestId,voiceId:input.voiceId,format:input.format,samples:Math.round(sampleRate*durationMs/1000),audioSamples:0,state:'open',createdAt:Date.now()};jobs.set(job.id,job);
        return send(res,201,{contractVersion:1,requestId:job.id,format:job.format,delivery:job.format==='wav'?'buffered':'streaming',sampleRate,channels:1});
      }
      const match=/^\/v1\/speech\/([\w-]{6,100})(?:\/(audio|cancel))?$/.exec(url.pathname);
      if(!match)return send(res,404,{error:{code:'NOT_FOUND'}});
      const [,id,action]=match;let job=jobs.get(id);
      if(req.method==='POST'&&action==='cancel'){
        // Tombstones prevent a cancelled create from appearing later with this ID.
        if(!job){if(jobs.size>=32)return send(res,409,{error:{code:'BUSY'}});job={id,state:'cancelled',audioSamples:0,createdAt:Date.now()};jobs.set(id,job);}
        stop(job);return send(res,200,status(job));
      }
      if(!job)return send(res,404,{error:{code:'NOT_FOUND'}});
      if(req.method==='GET'&&!action)return send(res,200,status(job));
      if(req.method!=='GET'||action!=='audio'||job.state!=='open')return send(res,409,{error:{code:'AUDIO_UNAVAILABLE'}});
      job.state='generating';job.response=res;
      res.on('close',()=>{if(job.state==='generating')job.state='cancelled';});
      res.writeHead(200,{'Content-Type':job.format==='wav'?'audio/wav':'application/octet-stream','Cache-Control':'no-store','X-Duo-Speech-Version':'1','X-Audio-Format':job.format,'X-Sample-Rate':String(sampleRate),'X-Audio-Channels':'1'});
      if(job.format==='wav'){const bytes=wav(pcm(job,0,job.samples),sampleRate);job.audioSamples=job.samples;job.state='completed';res.end(bytes);return;}
      const packetSize=Math.round(sampleRate*.04);
      for(let offset=0;offset<job.samples&&job.state==='generating';offset+=packetSize){
        const count=Math.min(packetSize,job.samples-offset);
        if(!res.write(pcm(job,offset,count))){await new Promise(resolve=>{const done=()=>{res.removeListener('drain',done);res.removeListener('close',done);resolve();};res.once('drain',done);res.once('close',done);});}
        job.audioSamples+=count;await new Promise(resolve=>setTimeout(resolve,40));
      }
      if(job.state==='generating'){job.state='completed';res.end();}
    }catch{if(!res.headersSent)send(res,400,{error:{code:'INVALID_REQUEST'}});else res.destroy();}
  });
  server.on('close',()=>{for(const job of jobs.values())stop(job);jobs.clear();});
  return server;
}
if(require.main===module){
  const port=Number(process.env.DUO_DIY_DEMO_PORT||3235);
  if(!Number.isInteger(port)||port<0||port>65535)throw Error('DUO_DIY_DEMO_PORT must be a valid port.');
  const server=createDemoServer({token:process.env.DUO_DIY_DEMO_TOKEN||''});
  server.listen(port,'127.0.0.1',()=>console.log('Synthetic DIY test tones only · http://127.0.0.1:'+server.address().port+' · Ctrl+C stops this server.'));
}
module.exports={createDemoServer};
