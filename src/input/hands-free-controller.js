// Hands-free owns only microphone capture. The ordinary conversation owns replies.
(() => {'use strict';
 window.createHandsFreeController=({bridge,input,getBusy,getScope,getTurn,send,interrupt,onLevel=()=>{},isVoiceActive=()=>false,getSpeakerLevel=()=>0,onBackchannel=()=>{}})=>{
  const field=document.getElementById('src-input'),toolbar=document.getElementById('input-methods-src-input')||field.nextElementSibling;
  const button=document.createElement('button'),status=document.createElement('span');
  button.type='button';button.className='ghost hands-free-button';button.textContent='Hands-free';button.setAttribute('aria-pressed','false');
  status.className='hands-free-status';status.setAttribute('role','status');if(toolbar.insertBefore)toolbar.insertBefore(button,toolbar.querySelector('.input-mode-choice,.input-audio-settings'));else toolbar.append(button);toolbar.append(status);
  const feedback=window.DiscussionStatus?.create(status);
  let owner=null,submission=0,preparing=0;
  const sensitivity=document.getElementById('hands-free-sensitivity');
  const scope=()=>JSON.stringify(getScope());
  const paint=(state,message='')=>{button.dataset.state=state;button.setAttribute('aria-pressed',String(!!owner));button.textContent=owner?'Hands-free · '+({listening:'Listening',hearing:'Hearing you',qualified:'Hearing you',blocked:'Not listening',sending:'Sending',error:'Paused'}[state]||state):'Hands-free';status.textContent=message;};
  const checked=r=>{if(!r?.ok)throw Error(r?.error||'Audio could not be prepared.');return r;};
  const owns=a=>owner===a&&scope()===a.scope;
  function reset(a){a.gate.reset();a.frames=[];a.pre=[];a.started=false;a.barging=false;}
  async function end(message=''){
    const a=owner;owner=null;if(a){clearInterval(a.timer);await a.capture?.stop({flush:false}).catch(()=>{});}if(owner)return;onLevel(0,true);paint('off',message);input.refresh();
  }
  function wav(frames,rate){
    const samples=new Float32Array(frames.reduce((n,f)=>n+f.length,0));let at=0;for(const f of frames){samples.set(f,at);at+=f.length;}
    const n=Math.floor(samples.length*16000/rate),bytes=new Uint8Array(44+n*2),v=new DataView(bytes.buffer);
    const str=(at,s)=>[...s].forEach((c,i)=>v.setUint8(at+i,c.charCodeAt(0)));str(0,'RIFF');v.setUint32(4,bytes.length-8,true);str(8,'WAVE');str(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,16000,true);v.setUint32(28,32000,true);v.setUint16(32,2,true);v.setUint16(34,16,true);str(36,'data');v.setUint32(40,n*2,true);
    for(let i=0;i<n;i++)v.setInt16(44+i*2,Math.round(Math.max(-1,Math.min(1,samples[Math.floor(i*rate/16000)]))*32767),true);
    let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(binary);
  }
  async function submit(a,frames,rate){
    const job=++submission;preparing=job;a.processing=true;paint('sending');reset(a);let captureId;
    try{
      // Qualified speech has already requested cancellation; capture never dispatches a second model turn.
      while(owns(a)&&getBusy())await new Promise(resolve=>setTimeout(resolve,50));
      if(!owns(a))return;
      const result=checked(await bridge.inputBegin('conversation'));captureId=result.id;
      if(!owns(a)){await bridge.inputClear();return;}
      const duration=frames.reduce((n,f)=>n+f.length,0)/rate;
      const size=Math.ceil(frames.length/Math.ceil(duration/9.8));
      for(let at=0,sequence=0;at<frames.length;at+=size,sequence++){if(!owns(a)){await bridge.inputClear();return;}checked(await bridge.inputChunk({id:result.id,sequence,data:wav(frames.slice(at,at+size),rate)}));}
      const recording=checked(await bridge.inputFinish(result.id));captureId=null;
      if(!owns(a)){await bridge.inputClear({token:recording.token});return;}
      input.attach(field,recording);a.replyAt=null;a.replyOwner=null;
      preparing=0;const reply=send();a.processing=false;await reply;
      if(!owns(a)||job!==submission)return;
      if(input.draft(field))throw Error('Your recording is kept. Use Send audio to retry, or Remove audio.');
      a.processing=false;if(a.blocked)reset(a);else if(!a.started)paint('listening');
    }catch(error){if(captureId)await bridge.inputClear().catch(()=>{});if(owns(a)&&job===submission){await end('Hands-free paused. '+error.message);feedback?.set({state:'error',title:'Hands-free paused',message:error.message});}}finally{if(preparing===job)preparing=0;input.refresh();}
  }
  function frame(a,samples,rate){
    if(!owns(a)||a.processing||a.blocked)return;
    const seconds=samples.length/rate,rms=Math.sqrt(samples.reduce((n,x)=>n+x*x,0)/samples.length);
    onLevel(rms,false);
    const bargeIn=Boolean(isVoiceActive?.()||getTurn()||a.barging);
    if(bargeIn)a.barging=true;
    const speakerRms=Number(getSpeakerLevel?.())||0;
    const event=a.gate.feed(rms,seconds,{speakerRms,bargeIn});
    if(event.state==='waiting'){a.pre.push(samples);while(a.pre.length>32)a.pre.shift();return;}
    if(!a.started){a.frames=a.pre.splice(0);a.started=true;}a.frames.push(samples);
    if(event.qualified&&getBusy())interrupt();
    if(event.state==='discard'){if(event.backchannel){try{onBackchannel();}catch{}}reset(a);paint('listening',event.backchannel?'Acknowledged · speaking':'Brief sound skipped · speak for at least 2 seconds.');}
    else if(event.state==='send'){const frames=a.frames;void submit(a,frames,rate);}
    else paint(event.state,event.state==='qualified'?'Pause for 0.85 seconds to send.':'Keep speaking · at least 2 seconds.');
  }
  function refresh(){
    button.hidden=getScope().activity!=='chat';
    if(!owner)return;
    const a=owner;if(!owns(a)){void end('Hands-free ended after the conversation or microphone changed.');return;}
    // Conversation turns are interruptible from their first token, including voice buffering.
    const blocked=getBusy()&&!getTurn()&&!isVoiceActive();
    if(a.blocked!==blocked||(!blocked&&button.dataset.state==='sending')){a.blocked=blocked;reset(a);onLevel(0,true);paint(blocked?'blocked':'listening');}
    for(const el of toolbar.querySelectorAll('.input-mode-choice button,.input-talk,.input-dictate'))el.disabled=true;
  }
  async function start(){
    if(owner){await end();return;}if(!bridge||preparing||getBusy()||input.busy||input.draft(field)||getScope().activity!=='chat'||getScope().longListening){paint('off','Finish the current operation or remove attached audio first.');return;}
    toolbar.querySelector('[data-mode="conversation"]').click();input.refresh();
    const speakerCoupling=Number(localStorage.getItem('duo-voice-speaker-coupling'))||.35;
    const a={scope:scope(),gate:window.DiscussionHandsFreeGate.create({threshold:Number(sensitivity.value),speakerCoupling}),frames:[],pre:[],started:false,processing:false,blocked:false,replyAt:null};owner=a;paint('blocked','Opening microphone…');
    try{a.capture=await window.createListeningCapture({deviceId:document.getElementById('listen-device').value,onChunk:()=>{},onLevel:()=>{},onFrame:(samples,rate)=>frame(a,samples,rate),onEnded:()=>owns(a)&&void end('Microphone disconnected. Choose Audio input and try again.')});if(!owns(a)){await a.capture.stop({flush:false});return;}a.timer=setInterval(refresh,80);paint('listening',a.capture.device||'Selected microphone');}
    catch(error){if(owner===a){await end('Hands-free could not start. '+error.message);feedback?.set({state:'error',title:'Microphone could not open',message:error.message});}}
  }
  button.onclick=()=>void start();
  setInterval(()=>{if(!owner)button.hidden=getScope().activity!=='chat';},250);
  sensitivity.value=localStorage.getItem('duo-voice-hands-free-threshold')||'.018';
  sensitivity.onchange=()=>{localStorage.setItem('duo-voice-hands-free-threshold',sensitivity.value);void end('Sensitivity changed. Click Hands-free to resume.');};
  addEventListener('beforeunload',()=>void end());
  document.addEventListener('visibilitychange',()=>{if(document.hidden)void end();});
  return {end,refresh,setCoupling(c){if(owner?.gate?.setCoupling)owner.gate.setCoupling(c);},replyStarted(turn){const a=owner;if(!a||a.replyOwner===turn.id)return;a.replyOwner=turn.id;a.replyAt=performance.now();a.processing=false;},get preparing(){return !!preparing;},get active(){return !!owner;}};
 };
})();
