// The saved voice provider decides whether conversation replies are spoken.
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.DiscussionVoicePolicy=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const PAID=new Set(['elevenlabs','cartesia']);
  const LABELS={off:'Text only',voxcpm2:'VoiceGen / VoxCPM2',diy:'DIY speech server',elevenlabs:'ElevenLabs',cartesia:'Cartesia'};
  function providerId(settings){
    if(!settings||settings.voiceDisabled)return 'off';
    const id=settings.voiceRoute&&settings.voiceRoute.provider;
    return Object.hasOwn(LABELS,id)?id:'voxcpm2';
  }
  function migrate(saved){
    const next=saved&&typeof saved==='object'&&!Array.isArray(saved)?{...saved}:{};
    const checkboxOff=Object.hasOwn(next,'voiceOn')&&next.voiceOn===false;
    delete next.voiceOn;
    if(next.voiceDisabled){delete next.voiceSpeechDeferred;return next;}
    if(checkboxOff)next.voiceSpeechDeferred=true;
    else if(next.voiceSpeechDeferred!==true)delete next.voiceSpeechDeferred;
    return next;
  }
  function speaksReplies(settings){return !!settings&&!settings.voiceDisabled&&settings.voiceSpeechDeferred!==true;}
  function paid(settings){return PAID.has(providerId(settings));}
  function providerLabel(settings){return LABELS[providerId(settings)];}
  return {migrate,speaksReplies,paid,providerLabel,providerId};
});
