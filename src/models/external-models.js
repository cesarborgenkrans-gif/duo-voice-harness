// Read only: other applications own their models and unload controls.
'use strict';
async function inspectExternalModels({fetchImpl=fetch}={}){
 async function read(url){try{const response=await fetchImpl(url,{signal:AbortSignal.timeout(1200),redirect:'error'});if(!response.ok)return null;return await response.json();}catch{return null;}}
 const [lm,ollama]=await Promise.all([read('http://127.0.0.1:1234/api/v1/models'),read('http://127.0.0.1:11434/api/ps')]);
 let studio=lm;if(!studio)studio=await read('http://127.0.0.1:1234/api/v0/models');
 const models=[...(studio?.models||studio?.data||[]).filter(m=>m.loaded_instances?.length||m.state==='loaded').map(m=>({app:'LM Studio',name:m.display_name||m.key||m.id})),...(ollama?.models||[]).map(m=>({app:'Ollama',name:m.name||m.model}))];
 return {models,checked:['LM Studio on 1234','Ollama on 11434'],note:'Unavailable, authenticated or non-default endpoints are not observable; global GPU headroom still applies.'};
}
module.exports={inspectExternalModels};
