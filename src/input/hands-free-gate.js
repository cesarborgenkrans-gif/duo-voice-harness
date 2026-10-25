// Acoustic activity gate; no transcription or model inference.
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.DiscussionHandsFreeGate=api;})(globalThis,function(){
  'use strict';
  function create({threshold=.018,minSpeech=2,silence=.85,maxDuration=29,speakerCoupling=.35}={}){
    let speech=0,quiet=0,duration=0,qualified=false,started=false,coupling=Number(speakerCoupling)||.35;
    const reset=()=>{speech=quiet=duration=0;qualified=started=false;};
    return {reset,setCoupling(c){if(Number.isFinite(+c))coupling=+c;},get coupling(){return coupling;},feed(rms,seconds,{speakerRms=0,bargeIn=false}={}){
      const floor = bargeIn ? Math.max(threshold * 1.75, speakerRms * coupling + threshold) : threshold;
      const voiced = rms >= floor;
      if(!started&&!voiced)return {state:'waiting'};
      started=true;duration+=seconds;
      if(voiced){speech+=seconds;quiet=0;}else quiet+=seconds;
      const targetMin = bargeIn ? (rms >= floor * 2.5 && speech + 1e-6 >= .85 ? .85 : 1.2) : minSpeech;
      const newlyQualified = !qualified && speech + 1e-6 >= targetMin;
      if(newlyQualified)qualified=true;
      if(quiet+1e-6>=silence||duration>=maxDuration){const event={state:qualified?'send':'discard',speech,duration,qualified:newlyQualified,backchannel:bargeIn&&!qualified};reset();return event;}
      return {state:qualified?'qualified':'hearing',qualified:newlyQualified,speech,remaining:Math.max(0,silence-quiet),bargeIn};
    }};
  }
  return {create};
});
