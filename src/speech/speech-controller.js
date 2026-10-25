// Keep the Speech draft separate from chat; only completed matching takes can replay/save.
(() => {
  'use strict';
  window.createSpeechController=({bridge,play,stopAudio,getBusy,getSettings,onBusy,onActor,onMotion,onStatus})=>{
    const $=id=>document.getElementById('speech-'+id),key='duo-voice-speech-draft-v1';
    let busy=false,saving=false,inputBusy=false,stopped=false,recording=null,task=null,directionId=null;
    const snapshot=()=>({text:$('text').value,actor:$('voice').value,language:window.DiscussionVoiceLanguage.resolve(getSettings().voiceReplyLanguage),voiceDirection:$('direction').value});
    const names={momotamu:'Momotamu',vivi:'Vivi'},providers={voxcpm2:'VoiceGen / VoxCPM2',diy:'DIY speech server',elevenlabs:'ElevenLabs',cartesia:'Cartesia'};
    const supportsDirection=()=>!getSettings().voiceDisabled&&(!getSettings().voiceRoute||getSettings().voiceRoute.provider==='voxcpm2');
    try{const draft=JSON.parse(localStorage.getItem(key)||'null');if(draft){$('text').value=typeof draft.text==='string'?draft.text.slice(0,8000):'';$('direction').value=typeof draft.voiceDirection==='string'?draft.voiceDirection.slice(0,600):'';if(names[draft.actor])$('voice').value=draft.actor;localStorage.setItem(key,JSON.stringify({text:$('text').value,actor:$('voice').value,voiceDirection:$('direction').value}));}}catch{}
    const status=message=>{$('status').textContent=message;onStatus(message);};
    const paint=()=>{
      window.DiscussionSharedStage?.contextFlows?.();
      $('speak').disabled=!!getSettings().voiceDisabled||busy||saving||inputBusy||!bridge||!$('text').value.trim();
      $('stop').hidden=!busy;$('stop').disabled=stopped;
      $('replay').disabled=busy||saving||inputBusy||!recording;$('save').disabled=busy||saving||inputBusy||!recording;
      for(const id of ['text','voice','direction','language-change'])$(id).disabled=busy||saving||inputBusy;
      $('language').textContent=window.DiscussionVoiceLanguage.resolve(getSettings().voiceReplyLanguage);
      $('direction').disabled=busy||saving||inputBusy||!supportsDirection();
      if($('direction-note'))$('direction-note').textContent=supportsDirection()?'Describe the delivery, or suggest one from your text.':'This provider uses natural delivery. Any saved direction is kept for VoxCPM2 and is not sent.';
      if($('route-note')){const provider=getSettings().voiceRoute?.provider||'voxcpm2';$('route-note').textContent=getSettings().voiceDisabled?'Text only. Choose a provider in Settings → Voices to generate speech.':(providers[provider]||provider)+(['elevenlabs','cartesia'].includes(provider)?' · Speak may use account credits. Replay uses the completed take.':' · Your selected companion voices.');}
      $('count').textContent=$('text').value.length.toLocaleString()+' / 8,000';
      $('suggest').disabled=!supportsDirection()||busy||saving||inputBusy||!bridge?.voicePlan||!$('text').value.trim();
      $('take').textContent=recording?names[recording.actor]+' · '+recording.language+' · '+recording.duration.toFixed(1)+' seconds'+(recording.provider?' · '+providers[recording.provider]:''):'';
    };
    const invalidate=()=>{recording=null;bridge?.speechClear?.().catch(()=>{});try{const {language,...draft}=snapshot();localStorage.setItem(key,JSON.stringify(draft));}catch{}onActor($('voice').value);paint();};
    const run=async replay=>{
      if(busy||saving)return;
      if(getBusy()){status('Finish or stop the current conversation, listening or model operation first.');return;}
      if(!bridge){status('Open the desktop app to use Speech.');return;}
      if(!replay&&getSettings().voiceDisabled){status('Text only is selected. Choose a provider in Settings → Voices to generate speech.');return;}
      const draft=snapshot();if(!draft.text.trim()){status('Enter the words you want to hear.');$('text').focus();return;}
      if(replay&&!recording)return;
      stopped=false;busy=true;onBusy(true);paint();onActor(draft.actor);
      status(replay?'Preparing playback…':'Preparing speech…');
      const prior=recording;
      if(!replay){recording=null;await bridge.speechClear().catch(()=>{});}
      try{
        if(stopped){status('Speech stopped. Your text is kept.');return;}
        const result=await play({...draft,voiceDirection:supportsDirection()?draft.voiceDirection:undefined,baseURL:getSettings().voiceURL,voiceRoute:getSettings().voiceRoute,verbatim:true,...(replay?{replayRecordingId:prior.id}:{speechCapture:true}),onStart:()=>{status(replay?'Replaying…':'Speaking…');onMotion('speaking',draft.actor,draft.text);}});
        if(stopped||result.cancelled){status('Speech stopped. Your text is kept.');return;}
        if(!result.ok)throw Error(result.error||'Voice generation did not finish.');
        recording=result.recording?{...result.recording,provider:getSettings().voiceRoute?.provider||'voxcpm2'}:prior;
        status(result.recordingUnavailable||(result.delivery==='buffered'?'Finished. Buffered WAV received. Replay or save the audio.':'Finished. Replay or save the audio.'));
      }catch(error){status('Speech unavailable. '+error.message+' Your text is kept; try again or open Settings → Voices.');}
      finally{onMotion('speech-end',draft.actor);busy=false;onBusy(false);paint();}
    };
    const launch=replay=>{if(busy||saving)return task;task=run(replay);return task;};
    function stop(){if(!busy)return;stopped=true;status('Stopping speech…');if(directionId)bridge.cancelLlm(directionId).catch(()=>{});stopAudio();paint();}
    for(const id of ['text','voice','direction'])$(id).addEventListener(['text','direction'].includes(id)?'input':'change',invalidate);
    $('form').addEventListener('submit',event=>{event.preventDefault();void launch(false);});
    $('stop').onclick=stop;$('replay').onclick=()=>void launch(true);
    $('suggest').onclick=()=>{if(busy||saving||getBusy())return;const draft=snapshot();busy=true;stopped=false;directionId='direction-'+crypto.randomUUID();onBusy(true);paint();status('Suggesting delivery…');task=(async()=>{try{const result=await bridge.voicePlan({...getSettings(),...draft,id:directionId,recipe:'Perform the exact supplied words naturally; preserve the selected cloned voice.'});if(stopped){status('Delivery suggestion stopped. Your text is kept.');return;}if(!result.ok)throw Error(result.error);$('direction').value=result.voiceDirection;invalidate();status('Delivery suggested. Edit it, or Speak.');}catch(error){status(stopped?'Delivery suggestion stopped. Your text is kept.':'Delivery unavailable. '+error.message+' You can write Voice Direction yourself.');}finally{directionId=null;busy=false;onBusy(false);paint();}})();};
    $('save').onclick=async()=>{if(!recording||busy||saving)return;saving=true;paint();try{const result=await bridge.speechSave(recording.id);if(!result.ok)throw Error(result.error);status(result.cancelled?'Save cancelled. Your recording is still available.':'Saved '+result.name+'.');}catch(error){status('Could not save audio. '+error.message+' You can try Save audio again.');}finally{saving=false;paint();}};
    paint();if(!bridge)status('Open the desktop app to use Speech.');
    return {refresh:paint,snapshot:()=>({text:$('text').value,voiceDirection:$('direction').value,recordingId:recording?.id||null}),perform:()=>launch(false),suggest(){ $('suggest').click();return task;},setInputBusy(value){inputBusy=value;paint();},get busy(){return busy;},get actor(){return $('voice').value;},stop,async leave(){stop();await task;},entered(){onActor($('voice').value);paint();$('text').focus();}};
  };
})();
