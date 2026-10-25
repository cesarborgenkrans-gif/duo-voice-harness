'use strict';
async function requestListeningModel(target,messages,maxTokens,signal,fetchImpl=fetch,options={}){
  const transcription=options.transcription||messages[0]?.content===require('./listening-model').transcribePrompt;
  const res=await fetchImpl(target.baseURL+'/chat/completions',{method:'POST',redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(options.timeoutMs||90000)]),headers:{'Content-Type':'application/json'},body:JSON.stringify({model:target.model,messages,stream:false,temperature:transcription?0:1,top_k:transcription?1:64,top_p:transcription?1:.95,min_p:0,repeat_penalty:1,max_tokens:maxTokens,chat_template_kwargs:{enable_thinking:false},...(options.schema?{response_format:{type:'json_object',schema:options.schema}}:{})})});
  if(!res.ok)throw new Error(`Audio model HTTP ${res.status}: ${(await res.text()).slice(0,200)}`);
  const result=await res.json();if(result.choices?.[0]?.finish_reason==='length')throw new Error('Audio analysis reached its output limit; this segment is unavailable. Try a shorter listening phase.');
  return result.choices?.[0]?.message?.content||'';
}
module.exports={requestListeningModel};
