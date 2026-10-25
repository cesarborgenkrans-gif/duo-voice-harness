'use strict';
// Tokenizer counts are exact for the supplied text; request overhead, images,
// and future tool reads are separate. Fallback ranges are approximate.
function estimate(text) {
  const chars=[...String(text||'')];let latin=0,other=0;
  for(const c of chars) /[\x00-\x7f\u00a0-\u024f]/.test(c)?latin++:other++;
  const tokens=Math.ceil(latin/3.5+other*1.3);
  return {tokens,lower:Math.ceil(latin/5+other*.7),upper:Math.ceil(latin/2+other*3),exact:false,method:'Approximate text estimate; varies by model and language'};
}
async function countText(text,{baseURL,signal,fetchImpl=fetch,parseSpecial=false,addSpecial=false}={}) {
  if(!baseURL)return estimate(text);
  try {
    const res=await fetchImpl(new URL('/tokenize',baseURL),{method:'POST',redirect:'error',headers:{'Content-Type':'application/json'},signal:signal?AbortSignal.any([signal,AbortSignal.timeout(5000)]):AbortSignal.timeout(5000),body:JSON.stringify({content:text,add_special:addSpecial,parse_special:parseSpecial})});
    if(!res.ok)throw new Error('Tokenizer unavailable.');const data=await res.json();
    if(!Array.isArray(data.tokens))throw new Error('Invalid tokenizer reply.');
    return {tokens:data.tokens.length,exact:true,method:'Loaded model tokenizer · extracted text only'};
  } catch(error) {if(signal?.aborted)throw error;return estimate(text);}
}
async function countRequest(messages,tools,options={}) {
  const images=messages.reduce((n,m)=>n+(Array.isArray(m.content)?m.content.filter(p=>p.type==='image_url').length:0),0);
  const textual=messages.map(m=>({...m,content:Array.isArray(m.content)?m.content.map(p=>p.type==='text'?p.text:'[Attached image]').join('\n'):m.content}));
  const fallback=()=>({...estimate(JSON.stringify({messages:textual,tools})),imageReserve:images*(options.imageTokens||1120),method:images?'Approximate text request · visual tokens reserved separately':'Approximate request estimate · includes messages and tool definitions'});
  if(!options.baseURL || messages.some(m=>Array.isArray(m.content)))return fallback();
  try {
    const response=await (options.fetchImpl||fetch)(new URL('/apply-template',options.baseURL),{method:'POST',redirect:'error',headers:{'Content-Type':'application/json'},signal:options.signal?AbortSignal.any([options.signal,AbortSignal.timeout(5000)]):AbortSignal.timeout(5000),body:JSON.stringify({messages,tools,add_generation_prompt:true})});
    const data=await response.json();if(!response.ok||typeof data.prompt!=='string'||tools?.some(t=>!data.prompt.includes(t.function.name)))return fallback();
    const count=await countText(data.prompt,{...options,parseSpecial:true,addSpecial:true});
    return {...count,method:count.exact?'Loaded model tokenizer · formatted text request':fallback().method};
  } catch(error) {if(options.signal?.aborted)throw error;return fallback();}
}
module.exports={estimate,countText,countRequest};
