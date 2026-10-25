'use strict';
const {randomUUID}=require('node:crypto'),L=require('./listening-model'),T=require('../input/input-model');
// One temporary listening lease pins the resident model and serializes annotation.
function createListeningService({target,request,onProgress=()=>{}}){
  let active=null;
  function current(owner,id){if(!active||active.owner!==owner||active.id!==id)throw new Error('This listening phase is no longer active.');return active;}
  function emit(s){if(active===s)onProgress(s.owner,{id:s.id,completed:s.chunks.length,pending:s.pending,duration:s.duration,transcript:L.render(s.chunks),outputReserved:s.reserved,stage:s.stage});}
  async function begin(owner,options={}){
    if(active)throw new Error('A Listening phase is already active.');
    const s={owner,id:randomUUID(),controller:new AbortController(),chunks:[],duration:0,pending:0,reserved:0,chain:Promise.resolve(),stage:'listening',startedAt:Date.now(),source:options.meeting?(options.microphone===false?'meeting':'microphone+meeting'):'microphone',maxChunks:L.LIMITS.maxChunks*(options.meeting&&options.microphone!==false?2:1)};active=s;
    try{s.target=await target();if(active!==s)throw new Error('Listening was cancelled.');return {id:s.id,model:s.target.model,startedAt:s.startedAt};}catch(e){if(active===s)active=null;throw e;}
  }
  async function chunk(owner,{id,sequence,data,source,startMs}){
    const s=current(owner,id);if(source!==undefined&&!['mic','meeting'].includes(source))throw Error('Invalid audio source.');if(s.stage!=='listening'||sequence!==s.chunks.length+s.pending||s.pending>=L.LIMITS.queue||sequence>=s.maxChunks)throw new Error('Listening queue is full, closed, or out of order.');
    const audio=L.wav(data);const start=Number.isFinite(startMs)?Math.max(0,(startMs-s.startedAt)/1000):s.duration;const end=start+audio.seconds;if(end>L.LIMITS.maxSeconds+.1)throw new Error('Listening reached its ten-minute limit.');
    s.duration=Math.max(s.duration,end);s.pending++;s.reserved+=L.LIMITS.transcriptionTokens+L.LIMITS.analysisTokens;emit(s);
    const task=s.chain.then(async()=>{
      if(active!==s)throw new Error('Listening was cancelled.');
      let item={start,end,source,segments:[]};
      try{
        if(audio.rms<.0006){s.chunks.push(item);s.pending--;if(s.tails)delete s.tails[source||'mic'];if(s.previousWords)delete s.previousWords[source||'mic'];emit(s);return item;}
        const prior=L.render(s.chunks.slice(-2)).slice(-3500),prefix=s.tails?.[source||'mic']||Buffer.alloc(0),pcm=Buffer.concat([prefix,audio.bytes.subarray(44)]),header=Buffer.from(audio.bytes.subarray(0,44));header.writeUInt32LE(pcm.length+36,4);header.writeUInt32LE(pcm.length,40);
        let words=T.parseTranscript(await request(s.target,[{role:'system',content:T.prompt},{role:'user',content:[{type:'text',text:prefix.length?'Return structured original-language words, including the leading repeated context, in this recording.':'Return structured original-language words from this recording.'},{type:'input_audio',input_audio:{format:'wav',data:Buffer.concat([header,pcm]).toString('base64')}}]}],L.LIMITS.transcriptionTokens,s.controller.signal,undefined,{transcription:true,schema:T.schema}),{allowEmpty:true,maxLength:7000});
        if(active!==s||s.controller.signal.aborted)throw new Error('Listening was cancelled.');
        if(prefix.length&&s.previousWords?.[source||'mic'])words=L.trimOverlap(s.previousWords[source||'mic'],words);
        if(!words||words==='[No intelligible speech]')item.segments=[];
        else{
          if(!words||words.length>7000||words.includes('<|'))throw new Error('The model returned unusable transcription instead of spoken words.');
          try{
            const text=await request(s.target,[{role:'system',content:L.audioPrompt},{role:'user',content:[{type:'text',text:`Words already transcribed (quoted):\n${words}\n\nCopy exact contiguous quotations from these words into the JSON words fields. Do not change, translate, or retranscribe them. Use the audio only to attribute speakers and describe delivery.\nPrevious provisional speaker context (quoted):\n${prior||'(first segment)'}\nThe first ${prefix.length/32000} seconds are repeated audio context; annotate only the new segment.`},{type:'input_audio',input_audio:{format:'wav',data:Buffer.concat([header,pcm]).toString('base64')}}]}],L.LIMITS.analysisTokens,s.controller.signal);
            item.segments=L.align(words,L.annotation(text));
          }catch(e){if(s.controller.signal.aborted)throw e;item.segments=[{speaker:'Unknown speaker',words,vocal:'Voice/speaker analysis unavailable: '+String(e.message).slice(0,220),certainty:'uncertain'}];}
        }
        s.previousWords||={};s.tails||={};s.previousWords[source||'mic']=words;s.tails[source||'mic']=Buffer.from(audio.bytes.subarray(Math.max(44,audio.bytes.length-64000)));
      }catch(e){if(s.controller.signal.aborted)throw e;item.error=String(e.message).slice(0,300);if(s.tails)delete s.tails[source||'mic'];if(s.previousWords)delete s.previousWords[source||'mic'];}
      if(active!==s)throw new Error('Listening was cancelled.');s.chunks.push(item);s.pending--;emit(s);return item;
    });
    s.chain=task.catch(()=>{});return task;
  }
  async function finish(owner,{id,transcript}){
    const s=current(owner,id);if(['finishing','summarizing'].includes(s.stage))throw new Error('The brief is already being prepared.');if(s.stage==='prepared'&&s.prepared?.transcript===(transcript??L.render(s.chunks)))return s.prepared;s.stage='finishing';emit(s);await s.chain;current(owner,id);
    const source=transcript===undefined?L.render(s.chunks):transcript;
    if(typeof source!=='string'||!source.trim()||source.length>L.LIMITS.transcript){s.stage='listening';emit(s);throw new Error('No transcript is ready, or it exceeds the listening limit.');}
    if(!s.chunks.some(c=>c.segments.length)){s.stage='listening';emit(s);throw new Error('No intelligible speech was transcribed. Cancel or resume listening.');}
    s.stage='summarizing';emit(s);let brief='';
    try{
      for(let offset=0;offset<source.length;offset+=10000){current(owner,id);s.reserved+=L.LIMITS.summaryTokens;emit(s);brief=await request(s.target,[{role:'system',content:L.summaryPrompt},{role:'user',content:`Previous compressed brief (quoted, possibly lossy):\n${brief||'(none)'}\n\nNext chronological transcript portion (quoted):\n${source.slice(offset,offset+10000)}\n\nMerge into one compact brief, retaining earlier important points.`}],L.LIMITS.summaryTokens,s.controller.signal);if(!brief.trim()||brief.length>L.LIMITS.brief)throw new Error('The listening brief is empty or too long; retry with a shorter edited transcript.');}
      current(owner,id);s.stage='prepared';s.prepared={id:s.id,brief,transcript:source,duration:s.duration,source:s.source};emit(s);return s.prepared;
    }catch(e){if(active===s){s.stage='listening';emit(s);}throw e;}
  }
  function reopen(owner,id){const s=current(owner,id);if(['finishing','summarizing'].includes(s.stage))throw new Error('Cancel the brief before resuming.');s.prepared=null;s.stage='listening';emit(s);}
  function cancel(owner,id){if(active?.owner===owner&&(!id||active.id===id)){active.controller.abort();active.tail=null;active=null;}return {ok:true};}
  return {begin,chunk,finish,reopen,cancel,get busy(){return !!active;}};
}
module.exports={createListeningService};
