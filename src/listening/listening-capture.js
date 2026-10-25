(function(){
  'use strict';
  window.createListeningCapture=async function({deviceId,onChunk,onLevel,onEnded,onFrame,workletURL='src/listening/listening-worklet.js'}){
    const stream=await window.openDiscussionMicrophone(deviceId);
    const ready=promise=>{let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Audio input did not become ready. Check Settings → Audio input and retry.')),10000);})]).finally(()=>clearTimeout(timer));};
    let context,node,source,closing=false,flushed;
    try{
      context=new AudioContext({sampleRate:16000});await ready(context.audioWorklet.addModule(workletURL));await ready(context.resume());source=context.createMediaStreamSource(stream);node=new AudioWorkletNode(context,'listening-capture');
      if(onFrame)node.port.postMessage({frames:true});
      node.port.onmessage=({data})=>{if(data.flushed){flushed?.();return;}if(data.level!==undefined)onLevel(data.level);if(data.samples&&onFrame){onFrame(data.samples,context.sampleRate);return;}if(data.samples){const rate=context.sampleRate,frames=Math.floor(data.samples.length*16000/rate),wav=new Uint8Array(44+frames*2),v=new DataView(wav.buffer),write=(at,s)=>[...s].forEach((c,i)=>v.setUint8(at+i,c.charCodeAt(0)));write(0,'RIFF');v.setUint32(4,wav.length-8,true);write(8,'WAVE');write(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,16000,true);v.setUint32(28,32000,true);v.setUint16(32,2,true);v.setUint16(34,16,true);write(36,'data');v.setUint32(40,frames*2,true);for(let i=0;i<frames;i++){const x=Math.min(data.samples.length-1,i*rate/16000),a=Math.floor(x),f=x-a,value=data.samples[a]*(1-f)+(data.samples[Math.min(a+1,data.samples.length-1)]||0)*f;v.setInt16(44+i*2,Math.round(Math.max(-1,Math.min(1,value))*32767),true);}if(frames>=1600){let binary='';for(let i=0;i<wav.length;i+=8192)binary+=String.fromCharCode(...wav.subarray(i,i+8192));onChunk(btoa(binary));}}};
      stream.getAudioTracks().forEach(t=>t.addEventListener('ended',()=>{if(!closing)onEnded();}));source.connect(node);node.connect(context.destination);
      return {device:stream.getAudioTracks()[0]?.label||'Microphone',async stop({flush=true}={}){if(closing)return;closing=true;try{source.disconnect();if(flush)await new Promise(resolve=>{const timer=setTimeout(resolve,1500);flushed=()=>{clearTimeout(timer);resolve();};node.port.postMessage('flush');});}finally{if(onFrame)node.port.postMessage({frames:true});
      node.port.onmessage=null;node.disconnect();stream.getTracks().forEach(t=>t.stop());await context.close();}}};
    }catch(e){stream.getTracks().forEach(t=>t.stop());await context?.close();throw e;}
  };
})();
