// Read-only invitation-listening telemetry. No capture, inference or timers for simulated stages.
(function(root){'use strict';root.createListeningFlowController=function({bridge}){
 const model=root.DiscussionLiveFlow.create();let listening={mode:'invited',phase:'idle',sessionId:null,entries:[]},chat={state:'waiting'},timer=null,disposed=false;
 const safe=fn=>{try{return fn();}catch{return null;}};
 function publish(){safe(()=>{const reply=model.snapshot();reply.nodes.chat=chat;bridge?.publishListeningFlowSnapshot?.({...listening,reply:reply.id?reply:null});});}
 function schedule(){if(!disposed&&!timer)timer=setTimeout(()=>{timer=null;publish();},80);}
 const off=bridge?.onConversationFlow?.(packet=>safe(()=>{if(model.event(packet))schedule();}));
 const api={
  observe(value){safe(()=>{if(value.sessionId&&value.sessionId!==listening.sessionId){model.reset();chat={state:'waiting'};}listening=value;schedule();});},
  beginReply(){return safe(()=>{if(listening.mode!=='invited'||!listening.sessionId)return null;const id=crypto.randomUUID();model.begin(id,'text');chat={state:'waiting'};schedule();return id;});},
  get id(){return model.snapshot().id;},
  bind(id,phase,requestId){safe(()=>model.bind(id,phase,requestId));},
  turn(id,actor,index){safe(()=>{if(id===model.snapshot().id)chat={state:'waiting'};model.turn(id,actor,index);schedule();});},
  event(phase,state,details={},id=model.snapshot().id){safe(()=>{if(phase==='chat'){if(id===model.snapshot().id&&model.snapshot().terminal==='active'){chat={state};schedule();}return;}if(model.event({runId:id,phase,state,...details}))schedule();});},
  end(id,outcome){safe(()=>{if(id===model.snapshot().id&&outcome!=='done'&&chat.state==='active')chat={state:outcome==='attention'?'cancelled':outcome};model.end(id,outcome);schedule();});}
 };
 addEventListener('beforeunload',()=>{disposed=true;clearTimeout(timer);off?.();});schedule();return api;
};})(window);
