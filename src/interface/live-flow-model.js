(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.DiscussionLiveFlow=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const phases=['input','context','model','voice','buffer','playback','transcript','image','image-focus'];
 const states=['waiting','active','ready','attention','done','skipped','error','cancelled'];
 const node=()=>({state:'waiting',since:0,ended:0,version:0});
 const initial=()=>({id:null,source:'text',note:false,model:'AI model',actor:'',turn:1,terminal:'idle',direction:false,received:0,consumed:0,rate:0,nodes:Object.fromEntries(phases.map(p=>[p,node()])),requests:{}});
 // Presentation nodes for the Runtime collaboration map (Slice C: Voice direction from model+direction; Chat from model).
 function displayNodes(snapshot){
  const s=snapshot||initial();
  const nodes=s.nodes||{};
  const voiceSkipped=nodes.voice&&nodes.voice.state==='skipped';
  const modelState=(nodes.model&&nodes.model.state)||'waiting';
  let direction='waiting';
  if(voiceSkipped)direction='skipped';
  else if(modelState==='error'||modelState==='cancelled')direction=modelState;
  else if(modelState==='done')direction='done';
  else if(modelState==='active'&&s.direction)direction='active';
  let chat='waiting';
  if(modelState==='error'||modelState==='cancelled')chat=modelState;
  else if(modelState==='done')chat='done';
  else if(modelState==='active')chat='active';
  const modelNode=nodes.model||node();
  return {
   input:nodes.input||node(),
   context:nodes.context||node(),
   model:modelNode,
   direction:{state:direction,since:modelNode.since||0,ended:modelNode.ended||0,version:(modelNode.version||0)+(s.direction?1:0),optional:true,dim:!!voiceSkipped},
   voice:Object.assign({},nodes.voice||node(),{optional:true,dim:!!voiceSkipped}),
   chat:{state:chat,since:modelNode.since||0,ended:modelNode.ended||0,version:modelNode.version||0,optional:false,dim:false},
   playback:Object.assign({},nodes.playback||node(),{optional:true,dim:!!(voiceSkipped||(nodes.playback&&nodes.playback.state==='skipped'))}),
   buffer:nodes.buffer||node(),
   transcript:nodes.transcript||node(),
   image:nodes.image||node(),
   'image-focus':nodes['image-focus']||node()
  };
 }
 function create(now=()=>Date.now()){
  let value=initial();
  function begin(id,source='text',note=false){value=initial();value.id=id;value.source=['text','audio','dictate'].includes(source)?source:'text';value.note=!!note;value.terminal='active';return value;}
  function bind(id,phase,requestId){if(id!==value.id||!phases.includes(phase))return;value.requests[phase]=requestId;}
  function turn(id,actor,index){if(id!==value.id||value.terminal!=='active')return;value.actor=String(actor).slice(0,60);value.turn=index;if(index>1){for(const p of ['context','model','voice','buffer','playback','image','image-focus']){value.nodes[p]=node();delete value.requests[p];}value.direction=false;value.received=value.consumed=value.rate=0;}}
  function event(packet){if(!packet||packet.runId!==value.id||!value.id||!phases.includes(packet.phase)||!states.includes(packet.state))return false;
   if(packet.requestId&&value.requests[packet.phase]!==packet.requestId)return false;
   const nodeRef=value.nodes[packet.phase];
   if(value.terminal==='cancelled'||['error','cancelled'].includes(nodeRef.state)||nodeRef.state==='done'&&packet.state!=='done')return false;
   if(packet.state!==nodeRef.state){nodeRef.state=packet.state;nodeRef.version++;if(packet.state==='active')nodeRef.since=now();if(['done','ready','error','cancelled','skipped'].includes(packet.state))nodeRef.ended=now();}
   if(typeof packet.model==='string')value.model=packet.model.slice(0,80);
   for(const key of ['worktree','document','image','audio','direction','note'])if(typeof packet[key]==='boolean')value[key]=packet[key];
   if(['text','audio','dictate'].includes(packet.source))value.source=packet.source;
   for(const key of ['received','consumed','rate'])if(Number.isFinite(packet[key])&&packet[key]>=0)value[key]=Math.min(packet[key],key==='rate'?96000:96000*600);
   return true;
  }
  function end(id,outcome='done'){if(id!==value.id)return;value.terminal=outcome;if(outcome==='done')return;for(const [phase,nodeRef]of Object.entries(value.nodes))if(['waiting','active','attention'].includes(nodeRef.state)&&phase!=='transcript'){nodeRef.state=outcome==='attention'?'cancelled':outcome;nodeRef.ended=now();nodeRef.version++;}}
  return {begin,bind,turn,event,end,reset(){value=initial();},snapshot:()=>structuredClone(value),displayNodes:()=>displayNodes(value)};
 }
 return {create,phases,displayNodes};
});
