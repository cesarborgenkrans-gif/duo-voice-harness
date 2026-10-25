(function(){
  'use strict';
  window.createModelController=function({bridge,getSettings,onSave,onStart,onStop,onProviderSettings,onStatus}){
    const $=id=>document.getElementById(id),M=window.DiscussionModelConfig,dialog=$('model-panel');
    let runtime=null,preset=null,locations=null,busy=false,operation=false,refreshing=false,poll=null,restoreFocus=true;
    const engineKeys=Object.keys(M.engineDefaults),responseKeys=Object.keys(M.responseDefaults);
    const responseLabels={temperature:['Temperature',0,2,.05,'Higher adds variety'],topP:['Top-p',.05,1,.01,'Breadth of likely words'],topK:['Top-k',0,200,1,'0 disables the shortlist'],minP:['Min-p',0,1,.01,'Filters unlikely words'],repeatPenalty:['Repetition penalty',.8,2,.01,'1 leaves repeats unchanged'],frequencyPenalty:['Frequency penalty',-2,2,.05,'Discourages repeated wording'],presencePenalty:['Presence penalty',-2,2,.05,'Encourages new wording'],maxTokens:['Reply token cap',32,500,1,'Maximum output, not a target']};
    for(const [key,[label,min,max,step,hint]] of Object.entries(responseLabels)){
      const wrap=document.createElement('label');wrap.className='model-knob';
      wrap.htmlFor='response-'+key;
      wrap.innerHTML=`<span>${label}<output id="value-${key}" for="response-${key}"></output></span><input id="response-${key}" data-model-edit type="range" min="${min}" max="${max}" step="${step}"><small>${hint}</small>`;
      $('model-response-knobs').append(wrap);
    }
    const engineLabels={context:['Context tokens',[2048,4096,8192,12288,16384,32768,65536]],gpuLayers:['GPU layer limit',null,0,999],threads:['CPU threads · 0 auto',null,0,128],batchSize:['Logical batch',[128,256,512,1024,2048,4096]],ubatchSize:['Physical batch',[32,64,128,256,512,1024,2048]],flashAttention:['Flash Attention',['auto','on','off']],cacheK:['Key cache',['f16','q8_0','q4_0']],cacheV:['Value cache',['f16','q8_0','q4_0']],reasoningBudget:['Thinking token budget',null,0,2048],imageTokens:['Vision detail · tokens per image',[70,140,280,560,1120]]};
    for(const [key,[label,choices,min,max]] of Object.entries(engineLabels)){
      const wrap=document.createElement('label');wrap.className='model-knob engine-knob';
      wrap.innerHTML=`<span>${label}</span>`+(choices?`<select id="engine-${key}" data-model-edit>${choices.map(v=>`<option value="${v}">${v}</option>`).join('')}</select>`:`<input id="engine-${key}" data-model-edit type="number" min="${min}" max="${max}" step="1">`);
      $('model-engine-knobs').append(wrap);
    }
    function engineDraft(){return {modelPath:$('model-file').value,mmprojPath:$('model-projector').value,...M.engine(Object.fromEntries(engineKeys.map(k=>[k,['flashAttention','cacheK','cacheV'].includes(k)?$('engine-'+k).value:Number($('engine-'+k).value)])))};}
    function responseDraft(){return M.response(Object.fromEntries(responseKeys.map(k=>[k,Number($('response-'+k).value)])));}
    function fill(){
      const settings=getSettings(),launch=M.launch(settings),generation=M.generation(settings);
      $('model-file').value=launch.modelPath;$('model-projector').value=launch.mmprojPath;
      for(const key of engineKeys)$('engine-'+key).value=String(launch[key]);
      for(const key of responseKeys)$('response-'+key).value=String(generation[key]);
      selectLocation();
      paint();
    }
    const normal=p=>String(p||'').replace(/\\/g,'/').toLowerCase();
    function selectLocation(){
      const selected=Object.entries(locations||{}).find(([,l])=>normal(l.model.path)===normal($('model-file').value)&&normal(l.projector.path)===normal($('model-projector').value));
      $('model-location').value=selected?.[0]||'custom';
    }
    function paint(){
      const settings=getSettings(),local=settings.provider==='local-llama',loaded=runtime?.loaded;
      const gemma=local&&M.isGemmaPair(M.launch(settings).modelPath,M.launch(settings).mmprojPath);
      $('model-gemma-select').textContent=gemma?'Gemma selected':'Use Gemma setup';
      $('model-gemma').dataset.selected=String(gemma);
      const savedLocation=Object.values(locations||{}).find(l=>normal(l.model.path)===normal(M.launch(settings).modelPath)&&normal(l.projector.path)===normal(M.launch(settings).mmprojPath));
      const filesReady=savedLocation?.model.available&&savedLocation?.projector.available;
      $('model-gemma-status').textContent=!bridge?'Local model loading is available in the desktop app.':!locations?'Checking the Gemma files…':filesReady?(gemma?(runtime?.state==='ready'&&!M.pending(settings,loaded)?'Gemma is running in the built-in engine.':loaded?'Gemma files are ready. Reload below to apply your saved choices.':'Gemma files are ready. Load below when you want to start.'):'Gemma files are ready on this computer.'): 'Choose the GGUF model and matching projector under Model & engine; custom paths are checked when loading.';
      $('model-provider-note').textContent=local?'Built-in llama.cpp · runs on this computer':`Active provider: ${settings.provider}. Provider settings manage its connection; engine choices below select built-in llama.cpp.`;
      const selected=M.launch(settings).modelPath;
      $('model-selection').textContent='Saved local files: '+(M.isGemmaPair(selected,M.launch(settings).mmprojPath)?'Gemma 4 12B QAT · Q4_0':selected.split(/[\\/]/).pop());
      $('model-state').textContent=runtime?.state==='ready'?'● Local engine ready':runtime?.state==='starting'?'◐ Loading AI model…':runtime?.state==='stopping'?'◐ Stopping AI model…':runtime?.state==='unavailable'?'◐ Local engine unavailable':'○ Local engine stopped';
      $('model-state').dataset.state=runtime?.state||'stopped';
      $('model-loaded-name').textContent=loaded?.modelLabel||'No built-in model loaded';
      $('model-loaded-file').textContent=loaded?.modelPath||'Choose files below, then load when you are ready.';
      const facts=loaded?[
        ['Context',`${loaded.config.context.toLocaleString()} tokens at launch${runtime.observed?.context ? ` · server reports ${runtime.observed.context.toLocaleString()}`:''}`],
        ['GPU layers',`${loaded.config.gpuLayers} requested${runtime.observed?.offloadedLayers ? ` · ${runtime.observed.offloadedLayers.join('/')} offloaded`:''}`],
        ['Projector',loaded.mmprojPath||'None · text only'],
        ['Vision detail',loaded.mmprojPath?`${loaded.config.imageTokens??'server default'} tokens per image · higher adds detail and processing time`:'Text only'],
        ['Engine',`PID ${loaded.pid||'unavailable'} · one inference slot${runtime.observed?.busySlots==null?'':` · ${runtime.observed.busySlots?'generating':'idle'}`}`],
        ['Endpoint',loaded.baseURL],['Model file',`${(loaded.modelBytes/1073741824).toFixed(2)} GiB on disk · not a VRAM measurement`]
      ]:[];
      $('model-facts').replaceChildren(...facts.map(([name,value])=>{const row=document.createElement('div'),dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=name;dd.textContent=value;row.append(dt,dd);return row;}));
      $('model-log').textContent=runtime?.log||'No local engine log yet.';
      $('model-preset-status').textContent=!preset?'Checking the standard model files…':preset.model.available?(preset.projector.available?'Gemma QAT weights and matching projector found.':'Gemma QAT weights found; its projector is missing. Choose a matching projector or clear it for text only.'):'Standard Gemma file is missing on this computer. Choose your GGUF file below.';
      let changed=false,invalid='';
      try{const draft=engineDraft();changed=JSON.stringify(draft)!==JSON.stringify(M.launch(settings));}catch(e){invalid=e.message;}
      const pending=M.pending(settings,loaded),locked=busy||operation||!!runtime?.operation;
      $('model-pending').textContent=invalid|| (changed?'Unsaved engine choices. Save before loading.':pending?'Saved choices differ from the resident model. Reload to apply them.':loaded?'Saved engine choices match the resident model.':'Saved choices are ready to load.');
      for(const el of dialog.querySelectorAll('[data-model-edit]'))el.disabled=locked;
      $('model-gemma-select').disabled=locked||!bridge||gemma;
      for(const key of ['topK','minP','repeatPenalty'])$('response-'+key).disabled=locked||!local;
      $('model-start').textContent=loaded?(pending?'Reload AI model':'AI model loaded'):'Load AI model';
      $('model-start').disabled=locked||changed||!!invalid||!bridge||!local||loaded&&!pending;
      $('model-stop').disabled=busy||!bridge||!(loaded||runtime?.operation||operation);
      $('model-engine-save').disabled=locked||!!invalid||!bridge;
      $('model-response-save').disabled=locked;
      $('model-provider').disabled=locked;
      $('model-refresh').disabled=refreshing;
      for(const key of responseKeys)$('value-'+key).textContent=$('response-'+key).value;
      const location=locations?.[$('model-location').value];
      $('model-location-status').textContent=location?`${location.model.available&&location.projector.available?'Both Gemma files found':'Files missing — see Resources'} · ${location.folder||location.model.path.replace(/[\\/][^\\/]+$/,'')}`:'Chosen files stay where they are. Save engine choices before loading.';
      $('model-open-folder').disabled=!bridge?.localModelFolder;
      if(location)$('model-preset-status').textContent=location.model.available&&location.projector.available?'Gemma QAT weights and matching projector found.':'Choose both matching GGUF files. The projector is required for native listening and images.';
    }
    const feedback=window.DiscussionStatus.create($('model-feedback'),{scope:'engines'});
    const fail=(error,title='Model setup needs attention')=>feedback.set({state:'error',title,message:'Check the model files and engine choices, then retry.',details:error.message||String(error)});
    async function refresh(){
      if(refreshing||!bridge?.localLlamaInspect)return;
      refreshing=true;paint();
      try{const s=getSettings(),r=await bridge.localLlamaInspect({modelPath:s.localModelPath,projectorPath:s.localMmprojPath});if(!r.ok)throw new Error(r.error||'Model inspection failed.');runtime=r.runtime;preset=r.preset;locations=r.locations||{lmstudio:{model:r.preset.model,projector:r.preset.projector}};if(runtime.state==='unavailable'&&runtime.owned)fail(Error(runtime.error||'The owned model process is unresponsive.'),'AI model is not responding');}
      catch(e){fail(e);}finally{refreshing=false;selectLocation();paint();}
    }
    async function save(patch,message){try{await onSave(patch);feedback.resolve({state:'success',message});fill();}catch(e){fail(e);}}
    for(const el of dialog.querySelectorAll('input,select'))el.addEventListener('input',paint);
    $('model-response-save').onclick=()=>{try{const g=responseDraft();save({generation:g,temp:g.temperature},'Response settings saved. They apply to your next run; notebook and Master requests retain their own token caps.');}catch(e){fail(e);}};
    $('model-engine-save').onclick=()=>{try{const draft=engineDraft();save({provider:'local-llama',localModelSource:$('model-location').value,localModelPath:draft.modelPath,localMmprojPath:draft.mmprojPath,localEngine:M.engine(draft),localContext:draft.context},'Engine choices saved. Load or reload explicitly to apply them.');}catch(e){fail(e);}};
    $('model-preset').onclick=()=>{const source=locations?.[$('model-location').value]?$('model-location').value:'lmstudio',chosen=locations?.[source];save({provider:'local-llama',localModelSource:source,localModelPath:chosen?.model.path||$('model-file').value||M.preset.modelPath,localMmprojPath:chosen?.projector.path||$('model-projector').value||M.preset.mmprojPath,localEngine:{...M.engineDefaults},localContext:M.engineDefaults.context,generation:{...M.responseDefaults},temp:M.responseDefaults.temperature,gemmaProfileVersion:M.profileVersion},'Duo Voice Harness setup saved. Google sampling + bounded app capacity; load or reload explicitly.');};
    $('model-location').onchange=()=>{const location=locations?.[$('model-location').value];if(location){$('model-file').value=location.model.path;$('model-projector').value=location.projector.path;}paint();};
    $('model-open-folder').onclick=async()=>{try{const r=await bridge.localModelFolder();if(!r.ok)throw Error(r.error);}catch(e){fail(e);}};
    $('model-gemma-select').onclick=()=>{const source=$('model-location').value;save({provider:'local-llama',localModelSource:source,localModelPath:locations?.[source]?.model.path||$('model-file').value,localMmprojPath:locations?.[source]?.projector.path||$('model-projector').value},'Gemma setup selected. Click Load AI model to start it. Your engine and response settings are retained.');};
    $('model-other-local').onclick=()=>{$('btn-loadmodel').click();$('model-engine-section').open=true;$('model-engine-section').scrollIntoView({block:'nearest'});$('model-pick-model').focus({preventScroll:true});};
    for(const link of dialog.querySelectorAll('a[href^="https://"]'))link.onclick=async event=>{if(!bridge?.openURL)return;event.preventDefault();try{const r=await bridge.openURL(link.href);if(!r.ok)throw new Error(r.error||'The model page could not open.');}catch(error){fail(error);}};
    $('model-help').addEventListener('toggle',event=>$('model-help-toggle').setAttribute('aria-expanded',String(event.newState==='open')));
    for(const kind of ['model','projector'])$('model-pick-'+kind).onclick=async()=>{try{const r=await bridge.localLlamaPick(kind);if(r.ok)$(kind==='model'?'model-file':'model-projector').value=r.path;selectLocation();paint();}catch(e){fail(e);}};
    $('model-projector-clear').onclick=()=>{$('model-projector').value='';selectLocation();paint();};
    $('model-start').onclick=async()=>{if(busy||operation)return;operation=true;paint();feedback.begin('Loading AI model…');try{const r=await onStart();if(!r.ok)throw Error(r.error||'Model loading failed.');feedback.resolve({state:'success',message:'AI model ready.'});}catch(e){fail(e,'AI model could not load');}finally{operation=false;await refresh();onStatus(feedback.current?.message||'');}};
    $('model-stop').onclick=async()=>{feedback.begin('Stopping AI model…');try{const r=await onStop();if(!r.ok)throw Error(r.error||'Model stopping failed.');feedback.resolve({state:r.state==='stopping'?'working':'idle',message:r.state==='stopping'?'Stopping AI model…':'AI model stopped.'});await refresh();}catch(e){fail(e,'AI model could not stop');}};
    $('model-provider').onclick=()=>{restoreFocus=false;dialog.close();onProviderSettings();};
    $('model-close').onclick=()=>dialog.close();
    dialog.addEventListener('close',()=>{if($('model-help').matches(':popover-open'))$('model-help').hidePopover();clearInterval(poll);poll=null;$('btn-loadmodel').setAttribute('aria-expanded','false');if(restoreFocus)$('btn-loadmodel').focus();restoreFocus=true;});
    return {open(){fill();if(!dialog.open)dialog.showModal();$('btn-loadmodel').setAttribute('aria-expanded','true');refresh();if(!poll)poll=setInterval(()=>{if(dialog.open)refresh();},2000);},setBusy(value){busy=value;paint();},refresh,settingsChanged(){if(dialog.open)fill();}};
  };
})();
