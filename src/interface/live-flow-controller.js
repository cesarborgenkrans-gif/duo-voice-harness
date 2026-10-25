// A disposable read-only view. Its failures cannot reach the conversation pipeline.
(()=>{'use strict';window.createLiveFlowController=({bridge})=>{
 const $=id=>document.getElementById(id),app=document.querySelector('.app'),panel=$('live-flow'),choice=$('live-flow-choice'),check=$('live-flow-toggle'),hint=$('live-flow-help'),glossary=$('live-flow-glossary'),glossaryOpenBtn=$('live-flow-glossary-open'),settings=$('settings');
 const model=window.DiscussionLiveFlow.create(),labels={waiting:'Waiting',active:'Working',ready:'Ready to send',attention:'Buffering',done:'Done',skipped:'Not used this turn',error:'Needs attention',cancelled:'Stopped'};
 const routeSpec=[
  ['input','1','You','Speak to the local AI.','\u00b9','input',false],
  ['context','2','Context','Remembers chat + attachments.','','input',false],
  ['image','↗','Shared image','Prepared pixels accompany this request.','','input',true],
  ['model','3','Local model','Writes the reply.','','model',false],
  ['direction','4','Voice direction','Model plans how it should sound.','\u00b2','model',true],
  ['voice','5','VoiceGen','Hands reply + direction to the local voice engine.','\u00b3','voice',true],
  ['chat','6','Chat','Reply appears in the chat window.','','out',false],
  ['playback','7','Simultaneous playback','Spoken reply streams.','','out',true],
  ['image-focus','↳','Image highlights','Separate model request estimates mentioned objects.','','model',true]
 ];
 let observedChat={state:"waiting"},publishTimer=null; let enabled=false,visible=false,glossaryOpen=false,timer=null,clock=null,selected=null,disposed=false,untracked=false;
 try{enabled=localStorage.getItem('duo-voice-live-flow')==='true';}catch{}
 const nodes={}, route=$('live-flow-route');
 for(const [phase,number,title,purpose,fn,tone,optional] of routeSpec){
  const button=document.createElement('button');button.type='button';button.className='live-flow-node'+(optional?' lf-optional':'');button.dataset.phase=phase;button.dataset.tone=tone;if(optional)button.dataset.optional='true';
  button.innerHTML=`<span class="lf-number">${number}</span><span class="lf-heading"><strong>${title}</strong><small>${purpose}${fn?`<span class="lf-fn">${fn}</span>`:''}</small></span><span class="lf-state"></span>`;
  if(phase==='playback'){const inside=document.createElement('div');inside.className='lf-buffer';inside.textContent='Audio buffer';button.append(inside);}
  button.onclick=()=>{selected=selected===phase?null:phase;draw();button.scrollIntoView({block:'nearest'});};
  route.append(button);nodes[phase]=button;
  if(phase==='image-focus')button.classList.add('lf-image-branch');
 }
 const transcript=document.createElement('button');transcript.type='button';transcript.className='lf-transcript';transcript.innerHTML='<strong>Display transcript</strong><span class="lf-state"></span>';
 transcript.onclick=()=>{selected=selected==='transcript'?null:'transcript';draw();transcript.scrollIntoView({block:'nearest'});};
 route.append(transcript);nodes.transcript=transcript;

 function setGlossaryOpen(open){
  glossaryOpen=!!open&&!!glossary;
  if(glossary)glossary.hidden=!glossaryOpen;
  panel?.classList.toggle('has-glossary',glossaryOpen);
  app?.classList.toggle('has-live-glossary',visible&&glossaryOpen);
  if(glossaryOpenBtn)glossaryOpenBtn.setAttribute('aria-expanded',String(glossaryOpen));
 }
 function openGlossary(){
  // Prefer a clear demo surface: close Settings so the rail is not covered.
  if(settings&&!settings.hidden){
   settings.hidden=true;
   const gear=$('gear');if(gear)gear.setAttribute('aria-expanded','false');
  }
  if(!visible){
   const available=document.body.dataset.windowMode==='free'&&app&&app.dataset.activity==='chat'&&!document.body.classList.contains('recording-mode');
   if(available&&innerWidth>=1280){enabled=true;if(check)check.checked=true;try{localStorage.setItem('duo-voice-live-flow','true');}catch{}}
   refresh();
  }
  if(!visible)return;
  setGlossaryOpen(true);
 }
 function closeGlossary(){setGlossaryOpen(false);}
 glossaryOpenBtn?.addEventListener('click',()=>{if(glossaryOpen)closeGlossary();else openGlossary();});
 $('settings-runtime-glossary')?.addEventListener('click',()=>{openGlossary();});
 $('live-flow-glossary-close')?.addEventListener('click',closeGlossary);

 function publish(){try{const snapshot=model.snapshot();snapshot.nodes.chat=observedChat;snapshot.excluded=untracked;bridge?.publishFlowSnapshot?.(snapshot);}catch{}}
 function schedule(){if(!publishTimer&&!disposed)publishTimer=setTimeout(()=>{publishTimer=null;publish();},80);if(visible&&!timer&&!disposed)timer=setTimeout(()=>{timer=null;safe(draw);},80);}
 function draw(){
  if(!visible||disposed)return;
  const s=model.snapshot();
  const display=model.displayNodes?model.displayNodes():(window.DiscussionLiveFlow.displayNodes?window.DiscussionLiveFlow.displayNodes(s):s.nodes);
  for(const [phase,button] of Object.entries(nodes)){
   if(phase==='transcript'){
    const state=s.nodes.transcript;button.dataset.state=state.state;button.dataset.version=state.version;
    button.setAttribute('aria-expanded',String(selected==='transcript'));
    let caption=labels[state.state]||state.state;if(state.state==='active'&&state.since)caption+=' \u00b7 '+Math.floor((Date.now()-state.since)/1000)+'s';
    button.querySelector('.lf-state').textContent=caption;continue;
   }
   const state=display[phase]||{state:'waiting',version:0};
   if(phase==='image'||phase==='image-focus')button.hidden=!s.image;
   if(button.dataset.version!==String(state.version)){button.dataset.pulse=['active','done'].includes(state.state)?(state.version%2?'a':'b'):'';}
   button.dataset.state=state.state;button.dataset.version=state.version;
   button.classList.toggle('lf-dim',!!state.dim||state.state==='skipped');
   button.classList.toggle('lf-beat',phase==='direction'&&!state.dim&&(state.state==='active'||(state.state==='done'&&s.direction&&s.nodes.voice&&s.nodes.voice.state==='waiting')));
   button.setAttribute('aria-expanded',String(phase===selected));
   let caption=labels[state.state]||state.state;
   if(phase==='image')caption=({active:'Sending image',done:'Image submitted'})[state.state]||caption;
   if(phase==='image-focus')caption=({ready:'Waiting for model',active:'Estimating locations',done:'Locations checked'})[state.state]||caption;
   if(phase==='direction'&&state.state==='done'&&!s.direction&&!state.dim)caption='Natural voice';
   if(state.state==='active'&&state.since)caption+=' \u00b7 '+Math.floor((Date.now()-state.since)/1000)+'s';
   button.querySelector('.lf-state').textContent=caption;
  }
  nodes.input.querySelector('small').innerHTML=(s.source==='audio'?(s.note?'Original audio + typed note.':'Speak to the local AI.'):s.source==='dictate'?'Microphone \u2192 editable draft.':'Speak to the local AI.')+'<span class="lf-fn">\u00b9</span>';
  nodes.context.querySelector('small').textContent=['Remembers chat + attachments.',s.worktree?'Worktree.':null,s.document?'Document.':null,s.image?'Image.':null].filter(Boolean).join(' ');
  const queued=s.rate?Math.max(0,s.received-s.consumed)/s.rate:0;
  nodes.playback.querySelector('.lf-buffer').textContent=s.rate?'Audio buffer \u00b7 '+queued.toFixed(1)+'s queued':'Audio buffer';
  nodes.transcript.hidden=s.source==='text';
  nodes.transcript.querySelector('strong').textContent=s.source==='dictate'?'Dictation \u2192 editable text':'Afterward \u00b7 display transcript';
  nodes.transcript.classList.toggle('lf-before',s.source==='dictate');
 }
 function settingsBlocking(){return !!(settings&&!settings.hidden);}
 function refresh(){
  const available=document.body.dataset.windowMode==='free'&&app.dataset.activity==='chat'&&!document.body.classList.contains('recording-mode');
  choice.hidden=false;if(check)check.checked=enabled;const wide=innerWidth>=1280;
  if(hint)hint.textContent=!available?'Opens beside the conversation in Free form Conversation.':wide?'See You, context, model, and voice work together.':'Widen the window to show the flow beside the conversation.';
  const blocked=settingsBlocking();
  visible=enabled&&available&&wide&&!blocked;
  panel.hidden=!visible;
  app.classList.toggle('has-live-flow',visible);
  if(!visible){setGlossaryOpen(false);}
  else{app.classList.toggle('has-live-glossary',glossaryOpen);panel.classList.toggle('has-glossary',glossaryOpen);if(glossary)glossary.hidden=!glossaryOpen;}
  if(visible){panel.style.setProperty('--lf-top',Math.max(82,$('conversation-workbench').offsetTop)+'px');draw();if(!clock)clock=setInterval(schedule,1000);}
  else{clearInterval(clock);clock=null;clearTimeout(timer);timer=null;}
 }
 check.onchange=()=>{enabled=check.checked;try{localStorage.setItem('duo-voice-live-flow',String(enabled));}catch{}refresh();};
 $('live-flow-close').onclick=()=>{enabled=false;check.checked=false;try{localStorage.setItem('duo-voice-live-flow','false');}catch{}closeGlossary();refresh();};
 const observer=new MutationObserver(refresh);observer.observe(document.body,{attributes:true,attributeFilter:['data-window-mode','class']});observer.observe(app,{attributes:true,attributeFilter:['data-activity']});
 if(settings)observer.observe(settings,{attributes:true,attributeFilter:['hidden']});
 addEventListener('resize',refresh);
 const unsubscribe=bridge?.onConversationFlow?.(packet=>{try{if(model.event(packet))schedule();}catch{}});
 function safe(fn,fallback){try{return fn();}catch{return fallback;}}
 const api={begin(source,note){return safe(()=>{untracked=false;observedChat={state:"waiting"};const id=crypto.randomUUID();model.begin(id,source,note);schedule();return id;},null);},get id(){return model.snapshot().id;},get source(){return model.snapshot().source;},get pending(){const s=model.snapshot();return s.terminal==='active'&&s.nodes.input.state==='ready';},bind(id,phase,requestId){safe(()=>model.bind(id,phase,requestId));},turn(id,actor,index){safe(()=>{if(id===model.snapshot().id)observedChat={state:"waiting"};model.turn(id,actor,index);schedule();});},event(phase,state,details={},id=model.snapshot().id){safe(()=>{if(phase==='chat'){if(id===model.snapshot().id&&model.snapshot().terminal==='active'){observedChat={state};schedule();}return;}if(model.event({runId:id,phase,state,...details}))schedule();});},end(id,outcome){safe(()=>{if(id===model.snapshot().id&&outcome!=="done"&&observedChat.state==="active")observedChat={state:outcome==="attention"?"cancelled":outcome};model.end(id,outcome);schedule();});},reset(excluded=false){safe(()=>{untracked=excluded;observedChat={state:"waiting"};model.reset();schedule();});},refresh,openGlossary,closeGlossary};
 addEventListener('beforeunload',()=>{disposed=true;clearTimeout(publishTimer);clearTimeout(timer);clearInterval(clock);observer.disconnect();unsubscribe?.();removeEventListener('resize',refresh);});refresh();schedule();return api;
};})();
