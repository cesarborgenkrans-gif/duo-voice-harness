// Only bounded, non-content lifecycle metadata may cross this observation channel.
'use strict';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function flowEvent(sender,flow,requestId,phase,state,details={}){
 try{
  if(!UUID.test(flow?.id||'')||!['input','transcript','context','model','voice','image','image-focus'].includes(phase)||!['active','done','error','cancelled','ready'].includes(state)||sender.isDestroyed())return;
  const packet={runId:flow.id,requestId:String(requestId||'').slice(0,100),phase,state};
  if(typeof details.model==='string')packet.model=details.model.split(/[\\/]/).at(-1).slice(0,80);
  for(const key of ['worktree','document','image','audio'])if(typeof details[key]==='boolean')packet[key]=details[key];
  sender.send('conversation-flow',packet);
 }catch{/* An observer cannot fail capture, inference or playback. */}
}
module.exports={flowEvent};
