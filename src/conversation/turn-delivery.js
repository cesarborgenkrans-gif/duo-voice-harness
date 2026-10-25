// Generated words and audio delivery are independent records.
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.DiscussionTurnDelivery=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const states=['not-started','playing','finished','stopped','failed','text-only'];
  const terminal=new Set(['finished','stopped','failed','text-only']);
  function validate(value){
    if(!value||Object.keys(value).some(k=>!['state','receivedSamples','consumedSamples','sampleRate'].includes(k))||!states.includes(value.state))throw Error('Invalid voice delivery receipt.');
    const {receivedSamples=0,consumedSamples=0,sampleRate=0}=value;
    if(!Number.isSafeInteger(receivedSamples)||!Number.isSafeInteger(consumedSamples)||receivedSamples<0||receivedSamples>57600000||consumedSamples<0||consumedSamples>receivedSamples||!Number.isSafeInteger(sampleRate)||sampleRate<0||sampleRate>96000||(consumedSamples>0&&!sampleRate)||value.state==='playing'&&!consumedSamples||value.state==='text-only'&&(receivedSamples||consumedSamples||sampleRate))throw Error('Invalid voice delivery measurements.');
    return {state:value.state,receivedSamples,consumedSamples,sampleRate};
  }
  function transition(previous,next){
    const before=validate(previous),after=validate(next);
    if(terminal.has(before.state)&&JSON.stringify(before)!==JSON.stringify(after))throw Error('Voice delivery is already settled.');
    if(before.state==='playing'&&after.state==='not-started'||after.receivedSamples<before.receivedSamples||after.consumedSamples<before.consumedSamples)throw Error('Voice delivery cannot move backwards.');
    return after;
  }
  function restart(previous){
    const before=validate(previous);
    if(before.state!=='failed')throw Error('Only a failed voice delivery can be spoken again.');
    return {state:'not-started',receivedSamples:0,consumedSamples:0,sampleRate:0};
  }
  function historyText(entry){
    if(!entry.delivery||entry.delivery.state==='text-only')return entry.text;
    const state=entry.delivery.state;
    if(state==='finished')return entry.text;
    const note=state==='stopped'?'Audio was stopped before completion; this reply was interrupted during delivery. Respond to the latest user contribution rather than automatically restarting this reply.':state==='failed'?'Audio delivery failed.':state==='playing'?'Audio delivery was not confirmed complete.':'Audio was not confirmed to have started.';
    return '[Generated reply; '+note+' The full text below was saved, but do not assume all of it was spoken or heard. The exact audible words are unknown.]\n'+entry.text;
  }
  function label(receipt){return {'not-started':'Voice not started',playing:'Speaking',finished:'Voice finished',stopped:'Voice stopped · audio incomplete',failed:'Speech failed. This reply stays on screen.','text-only':'Text only'}[receipt.state];}
  function track(entry,persist=async()=>{}){
    let receipt=validate(entry.delivery),drained=false,started=false,writes=Promise.resolve(),failure;
    const save=()=>{const snapshot={...receipt};entry.delivery=snapshot;writes=writes.then(()=>persist(snapshot)).then(()=>{failure=null;},error=>{failure=error;});};
    return {
      playback(packet){
        if(terminal.has(receipt.state))return;
        receipt={...receipt,receivedSamples:Math.max(receipt.receivedSamples,packet.received||0),consumedSamples:Math.max(receipt.consumedSamples,packet.consumed||0),sampleRate:packet.rate||receipt.sampleRate};
        if(packet.type==='drained')drained=true;
        if(receipt.consumedSamples&&!started){started=true;receipt.state='playing';save();}
      },
      async settle({cancelled=false,failed=false}={}){
        if(!terminal.has(receipt.state)){receipt.state=drained?'finished':cancelled?'stopped':failed?'failed':'stopped';save();}
        await writes;if(failure)throw failure;return {...receipt};
      }
    };
  }
  return {validate,transition,restart,historyText,label,track};
});
