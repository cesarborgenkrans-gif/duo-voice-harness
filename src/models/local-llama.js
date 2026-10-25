'use strict';
// Rule: own one process and wait for its exit before replacing it; opening UI
// only inspects. Resident launch settings never come from the renderer draft.
const fs=require('node:fs/promises'),path=require('node:path'),net=require('node:net');
const {spawn}=require('node:child_process'),M=require('./model-config');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function reserveLoopbackPort(){const server=net.createServer();await new Promise((r,j)=>{server.once('error',j);server.listen(0,'127.0.0.1',r);});const {port}=server.address();await new Promise(r=>server.close(r));return port;}
function createLocalLlamaRuntime({binaryPath,fetchImpl=fetch,spawnImpl=spawn,pollMs=400,loadTimeoutMs=180000,beforeLoad}){
  let active=null,operation=null,cancelled=false,lastError='',lastRun=null;
  const snapshot=r=>r?{pid:r.child.pid||null,modelPath:r.modelPath,mmprojPath:r.mmprojPath,modelLabel:r.modelLabel,baseURL:r.baseURL,config:r.config,modelBytes:r.modelBytes,projectorBytes:r.projectorBytes,startedAt:r.startedAt}:null;
  async function stopOwned(){
    const run=active;if(!run)return;
    if(run.exited||run.spawnError){active=null;return;}
    await new Promise((resolve,reject)=>{
      const exit=()=>{clearTimeout(timer);resolve();};
      const timer=setTimeout(()=>{run.child.removeListener('exit',exit);reject(new Error('The owned model process did not exit. Retry Stop; no second process was started.'));},5000);
      run.stopping=true;run.child.once('exit',exit);try{run.child.kill();}catch(e){clearTimeout(timer);run.child.removeListener('exit',exit);reject(e);}
    });
    if(active===run)active=null;
  }
  async function stop(){cancelled=true;try{await stopOwned();return {ok:true,state:operation?'stopping':'stopped'};}catch(e){lastError=e.message;return {ok:false,state:'error',error:lastError};}}
  async function status({details=false,timeoutMs=5000}={}){
    const run=active,base={state:operation||'stopped',operation,lastError,binaryPath,owned:!!run,loaded:snapshot(run),previous:lastRun?.snapshot||null,log:details?(run?.stderr||lastRun?.log||''):undefined,models:[]};
    if(!run||run.exited||run.spawnError)return {...base,ok:false,owned:false,loaded:null};
    if(!run.ready)return {...base,ok:false,state:cancelled?'stopping':'starting'};
    try{
      const res=await fetchImpl(`${run.baseURL}/models`,{signal:AbortSignal.timeout(timeoutMs)});if(!res.ok)throw new Error('The model server is not responding.');
      const payload=await res.json(),result={...base,ok:true,state:'ready',baseURL:run.baseURL,modelLabel:run.modelLabel,model:run.modelId,models:(payload.data||[]).map(m=>m.id)};
      if(details){
        const get=route=>fetchImpl(`${run.baseURL.replace(/\/v1$/,'')}/${route}`,{signal:AbortSignal.timeout(1500)}).then(r=>r.ok?r.json():null).catch(()=>null);
        const [props,slots]=await Promise.all([get('props'),get('slots')]);
        result.observed={context:props?.default_generation_settings?.n_ctx??props?.n_ctx??null,totalSlots:props?.total_slots??null,busySlots:Array.isArray(slots)?slots.filter(s=>s.is_processing).length:null,offloadedLayers:run.offloadedLayers||null};
      }
      if(active!==run||run.exited)return {...base,ok:false,state:'stopped',owned:false,loaded:null};
      return result;
    }catch(e){return {...base,ok:false,state:'unavailable',error:e.message};}
  }
  async function load(options={}){
    if(operation)return {ok:false,error:'A local model operation is already in progress.'};
    operation='starting';cancelled=false;lastError='';let spawned=null;
    const requireCurrent=()=>{if(cancelled)throw new Error('Local model loading was stopped.');};
    try{
      const config=M.engine(options);
      async function file(input,label){if(typeof input!=='string'||path.extname(input.trim()).toLowerCase()!=='.gguf')throw new Error(`Choose a ${label} GGUF file.`);const resolved=await fs.realpath(input.trim()),stat=await fs.stat(resolved);if(!stat.isFile())throw new Error(`The selected ${label} is not a file.`);return {resolved,bytes:stat.size};}
      const model=await file(options.modelPath,'model'),projector=options.mmprojPath?await file(options.mmprojPath,'projector'):{resolved:'',bytes:0};
      const executable=await fs.realpath(binaryPath);requireCurrent();
      if(active?.ready&&active.modelPath===model.resolved&&active.mmprojPath===projector.resolved&&JSON.stringify(active.config)===JSON.stringify(config))return {...await status(),status:'already'};
      await stopOwned();requireCurrent();
      if(options.beforeLoad)throw new Error('Load hooks belong to the owned runtime, not request options.');
      if(beforeLoad)await beforeLoad({modelBytes:model.bytes,projectorBytes:projector.bytes,config,voiceRoute:options.voiceRoute});requireCurrent();
      const port=await reserveLoopbackPort();requireCurrent();
      const baseURL=`http://127.0.0.1:${port}/v1`,modelLabel=path.basename(model.resolved),modelId=M.isGemmaPair(model.resolved,projector.resolved)?'google/gemma-4-12b-qat':`local-${modelLabel.replace(/\.gguf$/i,'').replace(/[^a-z0-9._-]+/gi,'-').slice(0,80)}`;
      const args=['--model',model.resolved,'--host','127.0.0.1','--port',String(port),'--alias',modelId,'--ctx-size',String(config.context),'--n-gpu-layers',String(config.gpuLayers),'--parallel','1','--jinja','--batch-size',String(config.batchSize),'--ubatch-size',String(config.ubatchSize),'--flash-attn',config.flashAttention,'--cache-type-k',config.cacheK,'--cache-type-v',config.cacheV,'--reasoning-budget',String(config.reasoningBudget)];
      if(config.threads)args.push('--threads',String(config.threads));if(projector.resolved)args.push('--mmproj',projector.resolved,'--image-min-tokens',String(config.imageTokens),'--image-max-tokens',String(config.imageTokens));
      const child=spawnImpl(executable,args,{cwd:path.dirname(executable),windowsHide:true,stdio:['ignore','ignore','pipe']});
      const run={child,modelPath:model.resolved,mmprojPath:projector.resolved,modelBytes:model.bytes,projectorBytes:projector.bytes,modelLabel,modelId,baseURL,config,stderr:'',ready:false,exited:false,startedAt:new Date().toISOString()};active=run;spawned=run;
      child.stderr?.on('data',chunk=>{const text=run.stderr+chunk.toString(),match=/offloaded (\d+)\/(\d+) layers/.exec(text);if(match)run.offloadedLayers=match.slice(1).map(Number);run.stderr=text.slice(-12000);});child.once('error',e=>{run.spawnError=e;});
      child.once('exit',code=>{run.exited=true;lastRun={snapshot:snapshot(run),log:run.stderr};if(active===run)active=null;if(code&&!run.stopping&&!cancelled)lastError=`llama.cpp exited (${code}). ${run.stderr.slice(-700)}`;});
      const deadline=Date.now()+loadTimeoutMs;
      while(Date.now()<deadline){
        requireCurrent();if(run.spawnError)throw run.spawnError;if(run.exited)throw new Error(`llama.cpp exited before readiness. ${run.stderr.slice(-900).trim()}`);
        const health=await fetchImpl(`${baseURL.replace(/\/v1$/,'')}/health`,{signal:AbortSignal.timeout(1200)}).catch(()=>null);requireCurrent();if(run.exited)throw new Error('The model process exited while loading.');
        if(health?.ok){run.ready=true;const current=await status();requireCurrent();if(current.ok)return {...current,status:'loaded'};run.ready=false;}
        await sleep(pollMs);
      }
      throw new Error(`Model loading exceeded ${Math.round(loadTimeoutMs/1000)} seconds. ${run.stderr.slice(-900).trim()}`);
    }catch(e){lastError=String(e.message||e).slice(0,1200);if(spawned&&active===spawned)await stopOwned().catch(e=>{lastError+=' '+e.message;});return {ok:false,error:lastError};}
    finally{operation=null;cancelled=false;}
  }
  return {load,stop,status,get operation(){return operation;}};
}
module.exports={createLocalLlamaRuntime};
