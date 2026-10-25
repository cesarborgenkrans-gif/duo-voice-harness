// Rule: validate knobs centrally; separate saved choices from resident facts.
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.DiscussionModelConfig=api;})(globalThis,function(){
  'use strict';
  // Names identify the expected pair; the main process discovers absolute storage paths.
  const preset=Object.freeze({name:'Gemma 4 12B QAT',modelPath:'gemma-4-12B-it-QAT-Q4_0.gguf',mmprojPath:'mmproj-gemma-4-12B-it-QAT-BF16.gguf'});
  const engineDefaults=Object.freeze({context:12288,gpuLayers:99,threads:0,batchSize:512,ubatchSize:256,flashAttention:'auto',cacheK:'f16',cacheV:'f16',reasoningBudget:0,imageTokens:560});
  // Google model-card sampling; reply capacity and engine limits are app choices.
  const responseDefaults=Object.freeze({temperature:1,topP:.95,topK:64,minP:0,repeatPenalty:1,frequencyPenalty:0,presencePenalty:0,maxTokens:240});
  const profileVersion=1;
  function isGemmaPair(model,projector){return /(?:^|[\\/])gemma-4-12B-it-QAT-Q4_0\.gguf$/i.test(model||'')&&/(?:^|[\\/])mmproj-gemma-4-12B-it-QAT-BF16\.gguf$/i.test(projector||'');}
  function relocatedSettings(saved,locations){
    const normal=p=>String(p||'').replace(/\\/g,'/').toLowerCase(),ready=l=>l?.model.available&&l?.projector.available;
    const named=isGemmaPair(saved.localModelPath,saved.localMmprojPath),unresolved=normal(saved.localModelPath)===normal(preset.modelPath);
    const managed=locations?.[saved.localModelSource],current=locations?.selected;
    if(saved.localModelSource==='custom')return saved;
    if(!named&&!unresolved&&saved.localModelPath)return saved;
    const selectedReady=current?ready(current):Object.values(locations||{}).some(l=>l?.model&&normal(l.model.path)===normal(saved.localModelPath)&&ready(l));
    const destination=ready(managed)?managed:!selectedReady?['lmstudio','app'].map(k=>locations?.[k]).find(ready):null;
    if(destination&&(normal(saved.localModelPath)!==normal(destination.model.path)||normal(saved.localMmprojPath)!==normal(destination.projector.path)))
      return {...saved,localModelSource:destination===locations.lmstudio?'lmstudio':'app',localModelPath:destination.model.path,localMmprojPath:destination.projector.path};
    return saved;
  }
  function migrateSettings(saved={}){
    if(saved.gemmaProfileVersion)return saved;
    const old={temperature:.45,topP:.95,topK:40,minP:.05,repeatPenalty:1.05,frequencyPenalty:.2,presencePenalty:.1,maxTokens:140};
    const same=(saved.temp===undefined||Number(saved.temp)===.45)&&Object.entries(saved.generation||{}).every(([k,v])=>old[k]===v);
    const result={...saved,gemmaProfileVersion:profileVersion};
    if(same){result.generation={...responseDefaults};result.temp=responseDefaults.temperature;}
    const oldEngine={context:12288,gpuLayers:99,threads:0,batchSize:512,ubatchSize:512,flashAttention:'auto',cacheK:'f16',cacheV:'f16',reasoningBudget:0,imageTokens:560};
    if(Object.entries(saved.localEngine||{}).every(([k,v])=>oldEngine[k]===v))result.localEngine={...engineDefaults};
    return result;
  }
  function number(value,fallback,min,max,integer=false){if(value===undefined)return fallback;if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max||integer&&!Number.isInteger(value))throw new Error(`Use ${integer?'a whole number':'a number'} from ${min} to ${max}.`);return value;}
  function choice(value,fallback,choices){if(value===undefined)return fallback;if(!choices.includes(value))throw new Error('Unsupported engine setting.');return value;}
  function engine(v={}){
    const d=engineDefaults,r={context:number(v.context,d.context,2048,65536,true),gpuLayers:number(v.gpuLayers,d.gpuLayers,0,999,true),threads:number(v.threads,d.threads,0,128,true),batchSize:number(v.batchSize,d.batchSize,32,4096,true),ubatchSize:number(v.ubatchSize,d.ubatchSize,32,4096,true),flashAttention:choice(v.flashAttention,d.flashAttention,['auto','on','off']),cacheK:choice(v.cacheK,d.cacheK,['f16','q8_0','q4_0']),cacheV:choice(v.cacheV,d.cacheV,['f16','q8_0','q4_0']),reasoningBudget:number(v.reasoningBudget,d.reasoningBudget,0,2048,true)};
    r.imageTokens=choice(v.imageTokens,d.imageTokens,[70,140,280,560,1120]);
    if(r.ubatchSize>r.batchSize)throw new Error('Physical batch size cannot exceed logical batch size.');return r;
  }
  function response(v={}){const d=responseDefaults;return {temperature:number(v.temperature,d.temperature,0,2),topP:number(v.topP,d.topP,.05,1),topK:number(v.topK,d.topK,0,200,true),minP:number(v.minP,d.minP,0,1),repeatPenalty:number(v.repeatPenalty,d.repeatPenalty,.8,2),frequencyPenalty:number(v.frequencyPenalty,d.frequencyPenalty,-2,2),presencePenalty:number(v.presencePenalty,d.presencePenalty,-2,2),maxTokens:number(v.maxTokens,d.maxTokens,32,500,true)};}
  function generation(s){return response({...s.generation,temperature:Number(s.temp??responseDefaults.temperature)});}
  function launch(s){return {modelPath:s.localModelPath||preset.modelPath,mmprojPath:s.localMmprojPath??preset.mmprojPath,...engine({...s.localEngine,context:Number(s.localContext||engineDefaults.context)})};}
  function pending(s,loaded){if(!loaded?.config)return false;const d=launch(s),p=v=>String(v||'').replace(/\\/g,'/').toLowerCase();return p(d.modelPath)!==p(loaded.modelPath)||p(d.mmprojPath)!==p(loaded.mmprojPath)||JSON.stringify(engine(d))!==JSON.stringify(loaded.config);}
  function requestBody(o){const g=response({...o.generation,...(o.temperature===undefined?{}:{temperature:o.temperature}),...(o.maxTokens===undefined?{}:{maxTokens:o.maxTokens})});const b={model:o.model||'local-model',messages:o.messages,temperature:g.temperature,top_p:g.topP,frequency_penalty:g.frequencyPenalty,presence_penalty:g.presencePenalty,max_tokens:g.maxTokens,stream:!!o.stream};if(o.provider==='local-llama')Object.assign(b,{top_k:g.topK,min_p:g.minP,repeat_penalty:g.repeatPenalty});return b;}
  return {preset,profileVersion,isGemmaPair,relocatedSettings,migrateSettings,engineDefaults,responseDefaults,engine,response,generation,launch,pending,requestBody};
});
