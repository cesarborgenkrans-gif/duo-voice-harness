/* Feature owners choose the acting; frame numbers only locate the reviewed drawings.
   A single director owns Momotamu, exits through compatible poses, and pauses offscreen.
   Pose banks: a feature kind (today only idle) can be acted from another approved 4x2 sheet.
   Each choice borrows the reviewed registration of an existing catalog action, so the foot anchor never moves.
   A choice with a rest pattern is re-rolled every cycle (home, visit, home, visit...) so idle never runs on a fixed clock.
   Speech faces the viewer in solo chat (front Speaking variations) and turns 3/4 toward the guest on the duo Stage. */
(() => {
  'use strict';
  window.MomotamuPoseBanks = Object.freeze({
    storageKey: 'duo-voice-momotamu-idle',
    idle: Object.freeze({
      label: 'Resting pose', defaultChoice: 'subtle',
      choices: Object.freeze([
        // The idle since the October 10 promotion: Subtle expressions. Home 0, then visits 1 and 2 with a return home between them.
        Object.freeze({ id: 'subtle', label: 'Subtle expressions', source: 'viewer-idle', frames: Object.freeze([0, 1, 0, 2, 0]), durationsMs: Object.freeze([6500, 3000, 6500, 3000, 100]), rest: Object.freeze({ visits: Object.freeze([1, 2]), homeMs: Object.freeze([4500, 8500]), visitMs: Object.freeze([2000, 4000]) }) }),
        // The idle before October 10: hand-near-chin home (identical drawing in the Listening and Reflection sheets) with a blink.
        Object.freeze({ id: 'reflection', label: 'Reflection', source: 'viewer-listening', frames: Object.freeze([0, 3, 0]), durationsMs: Object.freeze([7000, 110, 2600]), rest: Object.freeze({ visits: Object.freeze([3]), homeMs: Object.freeze([5500, 9500]), visitMs: Object.freeze([110, 110]) }) }),
        // Arms relaxed, listening tilt, hands at waist; the wave and gesture drawings stay out of idle.
        Object.freeze({ id: 'open-attention', label: 'Open attention', source: 'viewer-open-attention', frames: Object.freeze([0, 1, 0, 2, 0]), durationsMs: Object.freeze([6500, 3000, 6500, 3000, 100]), rest: Object.freeze({ visits: Object.freeze([1, 2]), homeMs: Object.freeze([4500, 8500]), visitMs: Object.freeze([2000, 4000]) }) }),
        // Picked October 11: the shared attending home of the Listening sheet, resting on its closed-mouth soft smile (frame 2). Both drawings are on the Listening sheet; drift about 2 px.
        Object.freeze({ id: 'soft-listening', label: 'Soft listening', source: 'viewer-listening', frames: Object.freeze([0, 2, 0]), durationsMs: Object.freeze([7000, 2500, 100]), rest: Object.freeze({ visits: Object.freeze([2]), homeMs: Object.freeze([5000, 9000]), visitMs: Object.freeze([1800, 3200]) }) })
      ])
    })
  });
  window.createMomotamuFeatureDirector = function({actions, speech, paint, setSway=()=>{}, random=Math.random, poses={}, cast='solo'}) {
    const byKey=new Map(actions.map(a=>[a.key,a])),sources=new Map(),chosen=new Map();
    const conversationSource=byKey.get('3q-reflection-speaking');
    const conversation=conversationSource?{...conversationSource,transitionEdges:window.DiscussionAudioMotion?.conversationProfiles.momotamu.edges}:null;
    // Two voices: the front sheet faces the viewer when Momotamu is alone; the 3/4 sheet faces the guest on the duo Stage.
    const frontVoice=window.DiscussionAudioMotion ? window.DiscussionAudioMotion.createSpeech(speech,{random}) : window.createMomotamuSpeechDirector(speech,{random});
    const duoVoice=window.DiscussionAudioMotion && conversation ? window.DiscussionAudioMotion.createConversationSpeech('momotamu',{random}) : null;
    const frontSpeaking=byKey.get('viewer-speaking');
    let castMode=cast==='duo'?'duo':'solo',voice=frontVoice,speakingAction=frontSpeaking;
    const castVoice=()=>castMode==='duo'&&duoVoice?{voice:duoVoice,action:conversation}:{voice:frontVoice,action:frontSpeaking};
    let current=null,steps=[],index=0,elapsed=0,exiting=false,reduced=false,visible=true,revision=0,painted='',reason='startup';
    let guestTurn=null;
    const curiosity=window.DiscussionAudioMotion?.guestCuriosity;
    const actionFor=kind=>kind==='speaking'?speakingAction:chosen.get(kind)?.action||byKey.get('viewer-'+(kind==='curiosity'?'speaking':kind));
    const target=()=>[...sources.values()].sort((a,b)=>b.priority-a.priority||b.revision-a.revision)[0]||{kind:'idle',owner:'idle',priority:0};
    const signature=value=>value.kind+':'+!!value.frozen;
    const step=(frame,ms)=>({frame,ms});
    const between=([low,high])=>Math.round(low+(high-low)*Math.min(1,Math.max(0,random())));
    function restChoice(kind){const bank=window.MomotamuPoseBanks?.[kind];const id=chosen.get(kind)?.id||bank?.defaultChoice;return bank?.choices.find(c=>c.id===id)?.rest||null;}
    // One idle cycle: home, visit, home, visit... Every hold is drawn afresh, so there is no repeating clock.
    function restSteps(rest){const out=[];for(const frame of rest.visits)out.push(step(0,between(rest.homeMs)),step(frame,between(rest.visitMs)));return out;}
    function draw() {
      if(!current)return;
      const frame=current.kind==='speaking'?voice.state().frame:steps[index].frame;
      const action=actionFor(current.kind),key=action.key+':'+frame;
      if(key!==painted){painted=key;paint(action,frame);}
      setSway(current.kind==='speaking'&&!exiting&&!reduced&&visible);
    }
    function enter(next) {
      current={...next};elapsed=0;index=0;exiting=false;
      if(current.kind==='speaking'){({voice,action:speakingAction}=castVoice());voice.begin(current.register||'auto',{audioDriven:!!current.audioDriven});}
      else {
        const action=actionFor(current.kind),rest=current.kind==='idle'&&restChoice('idle');
        steps=rest?restSteps(rest):action.frames.map((frame,i)=>step(frame,action.durationsMs[i]));
        if(current.kind==='listening')steps=action.frames.map((frame,i)=>step(frame,[2600,2900,220,135,230,1800,2000,2600][i]));
        if(current.kind==='curiosity')steps=curiosity.beats.map(([frame,ms])=>step(frame,ms));
      }
      if(reduced||current.frozen){
        const held={idle:0,listening:0,'image-inspection':2,reading:2,reflection:2,clarification:2,speaking:3,curiosity:0}[current.kind];
        if(current.kind==='speaking')voice.seekBeat(1); // holds a closed-mouth drawing (front 0, 3/4 1)
        else steps=[step(held,Infinity)];
      }
      draw();
    }
    function reconcile(immediate=false) {
      const next=target();
      if(current&&signature(current)===signature(next)){
        current={...next};return;
      }
      if(!current||immediate||reduced||!visible||current.frozen){enter(next);return;}
      if(exiting)return; // The latest owner is resolved again when this exit completes.
      if(current.kind==='speaking'){exiting=true;voice.finish();draw();return;}
      const frame=steps[index].frame;
      if(current.kind==='curiosity'){
        const returns=frame===4?[step(1,180),step(3,180),step(0,160)]:frame===1?[step(3,180),step(0,160)]:frame===3?[step(0,160)]:[];
        if(!returns.length){enter(next);return;}steps=returns;index=0;elapsed=0;exiting=true;draw();return;
      }
      const exits={reflection:frame>=2&&frame<=4?[step(5,160),step(6,180)]:frame===1||frame===5?[step(6,180)]:[],clarification:frame>=2&&frame<=4?[step(5,170),step(6,180)]:frame===1||frame===5?[step(6,180)]:[],reading:frame>=2&&frame<=5?[step(6,180)]:[],'image-inspection':frame>=2&&frame<=5?[step(6,180)]:[],listening:frame===3?[step(4,160),step(5,180)]:frame===2||frame===4?[step(5,180)]:[]};
      if(!exits[current.kind]?.length){enter(next);return;}
      steps=exits[current.kind];index=0;elapsed=0;exiting=true;draw();
    }
    function own(owner,kind,priority,options={}) {
      const old=sources.get(owner);
      if(!kind)sources.delete(owner);
      else if(old?.kind===kind&&!!old.frozen===!!options.frozen)return;
      else sources.set(owner,{owner,kind,priority,...options,revision:++revision});
      reconcile();
    }
    function reset(why='reset') {
      sources.clear();guestTurn=null;reason=why;painted='';enter(target());
    }
    function advance(ms) {
      if(!Number.isFinite(ms)||ms<0)throw Error('Invalid motion time');
      if(!visible||reduced||current?.frozen)return;
      if(guestTurn){guestTurn.elapsed+=ms;if(curiosity&&!guestTurn.reacted&&guestTurn.elapsed>=curiosity.afterMs&&current?.owner==='partner'&&current.kind==='listening'){guestTurn.reacted=true;own('guest-curiosity','curiosity',31,{once:true});}}
      if(current.kind==='speaking'){
        voice.advance(ms);
        if(exiting&&voice.state().completed)enter(target());
        else draw();
        return;
      }
      elapsed+=ms;
      while(elapsed>=steps[index].ms){
        elapsed-=steps[index].ms;
        if(index+1<steps.length)index++;
        else if(exiting){enter(target());break;}
        else if(current.once){
          if(sources.get(current.owner)?.revision===current.revision)sources.delete(current.owner);
          enter(target());break;
        }else{index=0;const rest=current.kind==='idle'&&restChoice('idle');if(rest)steps=restSteps(rest);}
      }
      draw();
    }
    // Choose the sheet that acts a feature kind. The idle in progress restarts from its home drawing at once.
    function setPose(kind,id) {
      const bank=window.MomotamuPoseBanks?.[kind],choice=bank?.choices.find(c=>c.id===id),base=choice&&byKey.get(choice.source);
      if(!base)return false;
      const action=choice.frames?{...base,key:'viewer-'+kind,title:choice.label,frames:[...choice.frames],durationsMs:[...choice.durationsMs]}:{...base,key:'viewer-'+kind};
      chosen.set(kind,{id,action});painted='';
      if(current?.kind===kind&&!exiting)enter(current);
      return true;
    }
    function poseChoices(){const out={};for(const kind of ['idle'])out[kind]=chosen.get(kind)?.id||window.MomotamuPoseBanks?.[kind]?.defaultChoice||null;return out;}
    function clearGuest(){guestTurn=null;sources.delete('guest-curiosity');}
    function idle(){clearGuest();own('speaker',null);own('reply',null);own('partner',null);}
    function event(name,detail={}) {
      reason=name;
      const actor=detail.actor||'momotamu',lead=actor==='momotamu';
      switch(name){
        case 'listening-state': {
          const phase=detail.phase;
          if(['starting','listening','pausing','paused','error'].includes(phase))own('capture','listening',90,{frozen:phase!=='listening'&&phase!=='starting'});
          else if(['finishing','summarizing','saving'].includes(phase))own('capture','reflection',90);
          else own('capture',null);
          return true;
        }
        case 'image-use':
          if(lead&&['sending','looking'].includes(detail.phase))own('image','image-inspection',50);
          else own('image',null);
          return true;
        case 'reading':own('reader',detail.active===false?null:'reading',40);return true;
        case 'passage':own('ambient','reading',10,{once:true});return true;
        case 'activity':own('ambient',detail.value==='reading'?'reading':null,10,{once:true});return true;
        case 'composing':
          clearGuest();
          own('question',null);own('speaker',null);
          if(lead){own('partner',null);own('reply',detail.image?'image-inspection':detail.reading?'reading':'reflection',60);return true;}
          own('reply',null);own('partner','listening',30);return false;
        case 'speaking':
          if(!lead){if(!guestTurn||guestTurn.actor!==actor)guestTurn={actor,elapsed:0,reacted:false};own('partner','listening',30);return false;}
          clearGuest();own('partner',null);own('reply',null);own('speaker','speaking',80,{register:detail.register||'auto',audioDriven:!!detail.audioDriven});return true;
        case 'speech-end':if(lead)own('speaker',null);else{clearGuest();own('partner',null);}return lead;
        case 'reply-finished':
          if(!lead){clearGuest();own('partner',null);return false;}
          idle();
          if(!detail.cancelled&&/[?？][\s"'”’]*$/u.test(detail.text||''))own('question','clarification',20,{once:true});
          return true;
        case 'input':own('question',null);own('ambient',null);return true;
        case 'choice':if(detail.kind==='activity')event('activity',detail);return true;
        case 'grounding':own('reply','reading',60);return true;
        case 'live-law-search':own('search',detail.pending===false?null:'reading',40);return true;
        case 'model-load':own('model',detail.pending===false?null:'reflection',40);return true;
        case 'handoff':
          if(lead){idle();if(detail.to&&detail.to!=='momotamu')own('partner','listening',30);return true;}
          clearGuest();own('partner',null);return false;
        case 'completion':case 'idle':idle();return true;
        case 'welcome':reset('welcome');return true;
        case 'stop':case 'error':reset(name);return true;
        default:return false;
      }
    }
    function snapshot(){return{motion:current?.kind,target:target().kind,owner:current?.owner,exiting,reason,reducedMotion:reduced,visible,frozen:!!current?.frozen,sources:[...sources.keys()],phrase:current?.kind==='speaking'?voice.state().phrase:null,poses:poseChoices(),cast:castMode,speakingSheet:speakingAction?.key||null,frame:current?.kind==='speaking'?voice.state().frame:steps[index]?.frame};}
    function setReducedMotion(value){reduced=!!value;painted='';enter(target());}
    function setVisible(value){visible=!!value;draw();}
    // Solo or duo applies from the next speaking turn; a turn in progress keeps its sheet so the face never cuts mid-phrase.
    function setCast(value){castMode=value==='duo'?'duo':'solo';return castMode;}
    for(const kind of ['idle'])setPose(kind,poses?.[kind]||window.MomotamuPoseBanks?.[kind]?.defaultChoice);
    enter(target());
    return{event,reset,advance,snapshot,setReducedMotion,setVisible,setPose,setCast,setAudioLevel:rms=>{frontVoice.setLevel?.(rms);duoVoice?.setLevel?.(rms);}};
  };
})();
