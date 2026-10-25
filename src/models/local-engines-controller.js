// Keep owned engine lifecycle visible; the main process retains GPU and busy guards.
(function(){
  'use strict';
  window.createLocalEnginesController=function({bridge,getSettings,getBusy,onLoad,onUnload,onVoiceStart,onVoiceWarmup,onVoiceStop,onSaveVoice,onModelSetup,onShareSetup=()=>{}}){
    const $=id=>document.getElementById(id),engines=$('engines-panel');
    let model=null,voice=null,gpu=null,refreshing=false,operation=null,poll=null;
    const feedback=window.DiscussionStatus.create($('engine-feedback'),{scope:'engines'});
    const modelFeedback=window.DiscussionStatus.create($('engine-model-status'),{scope:'engines'}),voiceState=window.DiscussionStatus.create($('engine-voice-status'),{scope:'engines'});
    feedback.set({state:'idle',message:''});
    const dialogs=['engines-panel','voice-panel','resources-panel'];
    function closePanels(){for(const id of dialogs)if($(id).open)$(id).close();}
    function paint(){
      const busy=getBusy(),transition=model?.operation||model?.state==='starting'||model?.state==='stopping';
      const warming=operation?.name==='Warm up voice'||voice?.warming||voice?.health?.warmup?.state==='warming';
      const modelText=!bridge?'Desktop app required':model?.loaded?`${model.loaded.modelLabel} · ${model.state==='ready'?'Loaded':model.state}`:transition?(model?.state==='stopping'?'Stopping AI model…':'Loading AI model…'):'Not loaded';
      if(model?.state==='unavailable'&&model.owned)modelFeedback.set({state:'error',title:'AI model is not responding',message:'The process is still running. Retry the status check, or stop and reload it.',details:model.error,action:{label:'Refresh status',run:()=>void refresh(true)}});
      else modelFeedback.resolve({state:transition?'working':model?.state==='ready'?'success':'idle',message:modelText});
      const voiceText=!bridge?'Desktop app required':warming?'Warming up voice…':voice?.connected?`${voice.loaded?(voice.health?.warmup?.state==='ready'?'Voice ready':'Model loaded'):'Service running · model cold'} · ${voice.owned?'owned by Duo Voice Harness':'external service'}`:voice?.starting?'Starting service…':'Stopped';
      if(voice?.owned&&!voice.connected&&!voice.starting)voiceState.set({state:'error',title:'Voice is not responding',message:'The app still owns a voice process. Check its status, or stop and start voice again.',details:voice.detail,action:{label:'Refresh status',run:()=>void refresh(true)}});
      else voiceState.resolve({state:warming||voice?.starting?'working':voice?.connected?'success':'idle',message:voiceText});
      $('engine-gpu-status').textContent=gpu?.available?`${(gpu.gpu.freeBytes/1024**3).toFixed(1)} GiB free of ${(gpu.gpu.totalBytes/1024**3).toFixed(1)} GiB · global GPU memory`:gpu?.reason||'GPU memory not checked';
      const gemma=window.DiscussionModelConfig.isGemmaPair(getSettings().localModelPath,getSettings().localMmprojPath);
      $('engine-model-load').disabled=!bridge||busy||!!operation||!!transition||getSettings().provider!=='local-llama'||!gemma||model?.state==='ready'&&!window.DiscussionModelConfig.pending(getSettings(),model.loaded);
      $('engine-model-stop').disabled=!bridge||busy||!(model?.owned||transition);
      $('engine-voice-start').disabled=!bridge||busy||!!operation||!!voice?.connected||!!voice?.starting;
      $('engine-voice-warmup').disabled=!bridge||busy||!!operation||!voice?.connected||!voice?.owned||!!voice?.health?.busy||!!voice?.starting;
      $('engine-voice-warmup').textContent=warming?'Warming up…':'Warm up voice';
      $('engine-voice-warmup').setAttribute('aria-busy',String(!!warming));
      $('engine-voice-stop').disabled=!bridge||(busy&&!warming)||!voice?.owned;
      $('engine-release').disabled=!bridge||busy||!!operation||!!transition||!!voice?.starting||!(model?.owned||voice?.owned);
      $('engine-refresh').disabled=refreshing;
      $('engine-disabled-note').textContent=busy?'Finish or cancel conversation, recording or playback before changing engines.':!bridge?'Engine controls are available in the desktop app.':!gemma?'Choose the model and matching projector in Gemma setup before loading.':'';
      $('engine-technical').textContent=JSON.stringify(facts(),null,2);$('engine-share-setup').disabled=busy;
    }
    function facts(){const cfg=getSettings();return {inference:{provider:cfg.provider,model:model?.loaded?.modelLabel||'Not loaded',state:model?.state||'Not checked'},voice:{service:!voice?'Not checked':voice.connected?'Connected':'Not connected',modelLoaded:voice?!!voice.loaded:null,output:cfg.voiceOutputMode==='meeting'?'Selected meeting route':'Speakers'},graphics:'Aligned 2D character sprites with audio-reactive motion',gpu:gpu?.available?{freeGiB:Number((gpu.gpu.freeBytes/1024**3).toFixed(1)),totalGiB:Number((gpu.gpu.totalBytes/1024**3).toFixed(1))}:'Not checked'};}
    async function refresh(recover=false){
      if(refreshing||!bridge){paint();return;}
      refreshing=true;paint();
      try{
        const results=await Promise.allSettled([bridge.localLlamaStatus(),bridge.voiceStatus(),bridge.gpuStatus()]);
        if(recover&&results.every(r=>r.status==='fulfilled')&&feedback.current?.title==='Engine status could not be checked')feedback.resolve({state:'success',message:'Engine status checked.'});
        for(let i=0;i<results.length;i++){const r=results[i];if(r.status==='fulfilled'){if(i===0)model=r.value;if(i===1)voice=r.value;if(i===2)gpu=r.value;}else feedback.set({state:'error',title:'Engine status could not be checked',message:'Try refreshing the engine status.',details:r.reason.message,action:{label:'Refresh status',run:()=>void refresh(true)}});}
      }finally{refreshing=false;paint();}
    }
    async function action(name,fn,{interrupt=false}={}){
      if(operation&&!interrupt)return;
      if(getBusy()&&!(interrupt&&name==='Stop voice'&&operation?.name==='Warm up voice')){feedback.set({state:'attention',title:'Engine change is waiting',message:'Finish or cancel conversation, playback or listening first.'});return;}
      const token={name};operation=token;paint();feedback.begin(name==='Warm up voice'?'Warming up voice…':name+'…');
      try{const result=await fn();if(operation!==token)return;if(result?.cancelled){feedback.resolve({state:'idle',message:'Voice warm-up cancelled.'});return;}if(result?.ok===false)throw Error(result.error||result.detail||'The engine operation failed.');feedback.resolve({state:result?.state==='stopping'?'working':name==='Stopping AI model'||name==='Stop voice'||name==='Release app engines'?'idle':'success',message:result?.detail||(name==='Stopping AI model'&&result?.state==='stopping'?'Stopping AI model…':({'Loading AI model':'AI model ready.','Stopping AI model':'AI model stopped.','Warm up voice':'Voice ready. No audio played or saved.'}[name]||name+' completed.'))});}
      catch(error){if(operation===token)feedback.set({state:'error',title:name+' failed',message:name==='Warm up voice'?'Check GPU memory and voice status. Start voice if it stopped, then retry.':'Check the engine setup, then retry. Other engines stay under your control.',details:error.message,action:{label:'Retry',run:()=>void action(name,fn,{interrupt})}});}
      finally{if(operation===token)operation=null;await refresh();}
    }
    function open(kind){
      closePanels();
      if($('model-panel').open)$('model-panel').close();
      const id=kind==='voice'?'voice-panel':kind==='resources'?'resources-panel':'engines-panel';
      $(id).showModal();
      if(kind==='voice'){$('cfg-voice-url').value=getSettings().voiceURL;if($('cfg-voice-language'))$('cfg-voice-language').value=window.DiscussionVoiceLanguage?.resolve(getSettings().voiceReplyLanguage)||'English';}
      if(kind==='voice')$('voice-panel').dispatchEvent(new Event('voice-settings-open'));
      if(id==='engines-panel'){refresh();poll=setInterval(refresh,4000);}
    }
    for(const [id,kind]of [['btn-local-engines','engines'],['titlebar-engines','engines'],['btn-voice-settings','voice'],['btn-resources','resources'],['engine-voice-setup','voice'],['engine-resources','resources'],['voice-resources','resources']])$(id).onclick=()=>open(kind);
    for(const [id,panel]of [['engines-close','engines-panel'],['voice-close','voice-panel'],['resources-close','resources-panel']])$(id).onclick=()=>$(panel).close();
    engines.addEventListener('close',()=>{clearInterval(poll);poll=null;});
    $('engine-model-setup').onclick=()=>{closePanels();onModelSetup();};
    $('engine-model-load').onclick=()=>action('Loading AI model',onLoad);
    $('engine-model-stop').onclick=()=>action('Stopping AI model',onUnload,{interrupt:true});
    $('engine-voice-start').onclick=()=>action('Start voice',onVoiceStart);
    $('engine-voice-warmup').onclick=()=>action('Warm up voice',onVoiceWarmup);
    $('engine-voice-stop').onclick=()=>action('Stop voice',onVoiceStop,{interrupt:true});
    $('engine-release').onclick=()=>action('Release app engines',async()=>{
      const outcomes=[];let failed=false;
      if(voice?.owned){const r=await onVoiceStop();outcomes.push(r?.ok?'Voice stopped':r?.error||'Voice stop failed');failed ||= !r?.ok;}
      if(model?.owned){const r=await onUnload();outcomes.push(r?.ok?'AI model stopped':r?.error||'AI model stop failed');failed ||= !r?.ok;}
      return {ok:!failed,detail:outcomes.join(' · ')};
    });
    $('engine-refresh').onclick=()=>void refresh(true);
    $('engine-share-setup').onclick=()=>{if(getBusy())return;closePanels();onShareSetup(facts());};

    paint();return {open,refresh,close:closePanels,paint};
  };
})();
