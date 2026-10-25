// Audio preferences belong to shared input settings, not to a listening activity.
(() => {'use strict';
 const KEY='duo-voice-audio-input-v1';
 window.openDiscussionMicrophone=async (deviceId='')=>{
  let expired=false,timer;
  const pending=navigator.mediaDevices.getUserMedia({audio:{deviceId:deviceId?{exact:deviceId}:undefined,channelCount:1,echoCancellation:true,noiseSuppression:false,autoGainControl:false},video:false});
  pending.then(stream=>{if(expired)stream.getTracks().forEach(track=>track.stop());},()=>{});
  try{return await Promise.race([pending,new Promise((_,reject)=>{timer=setTimeout(()=>{expired=true;reject(Error('Microphone permission took too long. Check Windows microphone access, then retry.'));},15000);})]);}
  finally{clearTimeout(timer);}
 };
 window.createAudioInputController=({getBusy,onBusy})=>{
  const $=id=>document.getElementById(id),dialog=$('audio-input-panel'),select=$('listen-device');let prefs={},check=null;
  try{prefs=JSON.parse(localStorage.getItem(KEY)||'{}');}catch{}
  let selected=typeof prefs.deviceId==='string'?prefs.deviceId:'',label=prefs.label||'';
  $('listen-mic').checked=prefs.microphone!==false;$('listen-meeting').checked=!!prefs.meeting;
  const feedback=window.DiscussionStatus.create($('audio-input-status'));
  const message=(text,state='idle',options={})=>feedback.set({state,message:text,...options});
  message('Choose a microphone, then check its level before recording.');
  function save(){selected=select.value;label=select.selectedOptions[0]?.textContent||label;try{localStorage.setItem(KEY,JSON.stringify({deviceId:selected,label,microphone:$('listen-mic').checked,meeting:$('listen-meeting').checked}));feedback.resolve({state:'success',message:'Audio input saved.'});}catch{message('Audio input changed; it could not be saved for next time.','attention',{title:'Audio input was not saved'});}summary();}
  function summary(){const sources=[$('listen-mic').checked?(label||'Microphone'):null,$('listen-meeting').checked?'Computer / meeting audio':null].filter(Boolean);$('listen-source-summary').textContent=sources.join(' + ')||'No source selected';}
  function paint(){const busy=getBusy()||!!check;for(const id of ['listen-device','listen-devices','listen-mic','listen-meeting'])$(id).disabled=busy;$('audio-input-check').disabled=busy;$('audio-input-check').title=busy?'Finish the current recording, listening or playback first.':'';$('audio-input-disabled-note').textContent=busy&&!check?'Finish recording, listening or playback before changing audio input.':'';$('audio-input-check-stop').hidden=!check;}
  async function devices(recover=false){
   try{const list=(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='audioinput'&&d.deviceId&&d.deviceId!=='default');select.replaceChildren(new Option('System default microphone',''),...list.map((d,i)=>new Option(d.label||'Microphone '+(i+1),d.deviceId)));
    if(selected&&!list.some(d=>d.deviceId===selected)){select.add(new Option((label||'Selected microphone')+' · unavailable',selected));message('Reconnect it or choose another input.','attention',{title:'Selected microphone unavailable'});}
    select.value=selected;if(!selected||list.some(d=>d.deviceId===selected))label=select.selectedOptions[0]?.textContent||label;summary();paint();if(recover&&(!selected||list.some(d=>d.deviceId===selected)))feedback.resolve({state:'success',message:'Microphone list refreshed. Choose your input, then check its level.'});
   }catch(error){message('Check microphone permissions, then refresh inputs.','error',{title:'Microphones could not be listed',details:error.message,action:{label:'Refresh inputs',run:()=>void devices(true)}});}
  }
  async function stop(){const own=check;if(!own)return;check=null;clearTimeout(own.timer);await own.capture?.stop({flush:false}).catch(()=>{});onBusy(false);$('audio-input-meter').value=0;paint();}
  async function start(){if(getBusy()||check){message('Finish recording, listening or playback first.','attention',{title:'Microphone check is waiting'});return;}const own={peak:0};check=own;onBusy(true);paint();feedback.begin('Opening microphone…');
   try{own.capture=await window.createListeningCapture({deviceId:select.value,onChunk:()=>{},onLevel:rms=>{if(check===own){own.peak=Math.max(own.peak,rms);$('audio-input-meter').value=Math.min(1,rms*8);}},onEnded:()=>{void stop();message('Reconnect your microphone and try the check again.','error',{title:'Microphone disconnected'});}});if(check!==own){await own.capture.stop({flush:false});return;}await devices();message('Speak now. No audio is sent to AI. The check stops after 10 seconds.','working');own.timer=setTimeout(()=>{void stop();feedback.resolve({state:own.peak>.0001?'success':'attention',title:own.peak>.0001?'Microphone signal detected':'No microphone signal detected',message:own.peak>.0001?'Check finished. You can record now.':'Choose another input or check Windows microphone settings.'});},10000);
   }catch(error){if(check===own){await stop();message('Choose your microphone and check Windows microphone access, then retry.','error',{title:'Microphone check failed',details:error.message,action:{label:'Refresh inputs',run:()=>void devices(true)}});}}
  }
  async function calibrate(){
    if(getBusy()||check){message('Finish active recording, listening, or playback first.','attention');return;}
    const calStatus=$('hands-free-calibration-status'),calBtn=$('hands-free-calibrate');
    if(!calStatus)return;
    calBtn.disabled=true;calStatus.textContent='Measuring ambient noise… (please remain quiet)';onBusy(true);
    let cap=null,audioCtx=null;
    try{
      let noiseRmsSum=0,noiseSamples=0,chirpMicRmsSum=0,chirpSamples=0,phase='noise';
      cap=await window.createListeningCapture({deviceId:select.value,onChunk:()=>{},onLevel:rms=>{
        if(phase==='noise'){noiseRmsSum+=rms;noiseSamples++;}
        else if(phase==='chirp'){chirpMicRmsSum+=rms;chirpSamples++;}
      }});
      await new Promise(r=>setTimeout(r,400));
      const ambientFloor=noiseSamples>0?(noiseRmsSum/noiseSamples):.01;
      phase='chirp';calStatus.textContent='Emitting acoustic test pulse…';
      const AudioCtx=window.AudioContext||window.webkitAudioContext;
      if(AudioCtx){
        audioCtx=new AudioCtx();await audioCtx.resume();
        const outputMode=document.getElementById('voice-output-mode')?.value,outputDevice=document.getElementById('voice-output-device')?.value;
        if(outputMode==='meeting'&&outputDevice){if(!audioCtx.setSinkId)throw Error('Selected output cannot be calibrated on this device.');await audioCtx.setSinkId(outputDevice);}
        const osc=audioCtx.createOscillator(),gain=audioCtx.createGain();
        osc.type='sine';osc.frequency.setValueAtTime(440,audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(880,audioCtx.currentTime+.6);
        gain.gain.setValueAtTime(.001,audioCtx.currentTime);gain.gain.linearRampToValueAtTime(.18,audioCtx.currentTime+.1);
        gain.gain.setValueAtTime(.18,audioCtx.currentTime+.5);gain.gain.linearRampToValueAtTime(.001,audioCtx.currentTime+.6);
        osc.connect(gain);gain.connect(audioCtx.destination);osc.start();osc.stop(audioCtx.currentTime+.62);
      }
      await new Promise(r=>setTimeout(r,650));
      phase='done';
      const measuredChirpRms=chirpSamples>0?(chirpMicRmsSum/chirpSamples):.02;
      let coupling=measuredChirpRms/.18;
      if(!Number.isFinite(coupling)||coupling<.10)coupling=.20;
      coupling=Math.max(.15,Math.min(.75,coupling));
      localStorage.setItem('duo-voice-speaker-coupling',coupling.toFixed(2));
      const sens=$('hands-free-sensitivity');
      if(sens){
        if(ambientFloor>.026)sens.value='.035';
        else if(ambientFloor<.010)sens.value='.009';
        else sens.value='.018';
        localStorage.setItem('duo-voice-hands-free-threshold',sens.value);
      }
      calStatus.textContent=`Calibration complete: Echo coupling set to ${(coupling*100).toFixed(0)}% (ambient floor: ${(ambientFloor*1000).toFixed(1)}).`;
      feedback.resolve({state:'success',message:'Room & speaker calibration complete.'});
      return {coupling,ambientFloor};
    }catch(err){calStatus.textContent='Calibration could not complete: '+err.message;
    }finally{calBtn.disabled=false;if(cap)await cap.stop({flush:false}).catch(()=>{});if(audioCtx)await audioCtx.close().catch(()=>{});onBusy(false);paint();}
  }
  function open(){for(const panel of document.querySelectorAll('dialog[open]'))if(panel!==dialog)panel.close();if(!dialog.open)dialog.showModal();paint();void devices();}
  $('btn-audio-input').onclick=open;document.querySelectorAll('[data-audio-input-open]').forEach(el=>el.onclick=open);$('audio-input-close').onclick=()=>dialog.close();dialog.addEventListener('close',()=>{if(check){void stop();feedback.resolve({state:'idle',message:'Microphone check stopped.'});}});
  select.addEventListener('change',save);for(const id of ['listen-mic','listen-meeting'])$(id).addEventListener('change',save);$('listen-devices').onclick=()=>void devices(true);$('audio-input-check').onclick=()=>void start();$('audio-input-check-stop').onclick=()=>{void stop();feedback.resolve({state:'idle',message:'Microphone check stopped.'});};$('hands-free-calibrate')?.addEventListener('click',()=>void calibrate());navigator.mediaDevices?.addEventListener('devicechange',()=>void devices());addEventListener('beforeunload',()=>{check?.capture?.stop({flush:false});});void devices();summary();
  return {open,cancel:stop,refresh:paint,calibrate,get busy(){return !!check;}};
 };
})();
