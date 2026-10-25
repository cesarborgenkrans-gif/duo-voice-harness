// Session audio is owned by the main process; saved chat text contains no audio paths.
(() => {
  'use strict';
  window.createChatAudioController=({bridge,play,getBusy,getScope,spokenText=text=>text,onStatus,onMotion,canRetry=()=>false,prepareRetry})=>{
    let recordings=[],busy=false,revision=0;
    function paint(){
      const scope=getScope();
      for(const message of document.querySelectorAll('#log .msg')){
        message.querySelector('.chat-audio')?.remove();
        const item=recordings.find(item=>item.context?.kind===scope?.kind&&item.context?.id===scope?.id&&item.context?.entryId===message.dataset.entryId);
        const actor=['momotamu','vivi'].find(name=>message.classList.contains(name));
        const text=message.querySelector('.msg-body')?.textContent?.trim();
        const retry=!item&&!!actor&&!!text&&!message.querySelector('.msg-copy')?.disabled&&canRetry(message);
        if(!item&&!retry)continue;
        const row=document.createElement('div');row.className='chat-audio';
        if(item){const label=document.createElement('span');label.textContent=`Session audio · ${item.duration.toFixed(1)}s`;row.append(label);}
        for(const [action,title]of item?[['replay','Replay'],['save','Save audio']]:[['retry','Retry speech']]){
          const button=document.createElement('button');button.type='button';button.className='ghost';button.dataset.audioAction=action;button.textContent=title;button.disabled=busy||getBusy();
          button.addEventListener('click',async()=>{
            if(busy||getBusy()){onStatus('Finish the current activity before replaying or saving audio.','warn');return;}
            const context=scope?.id&&message.dataset.entryId?{kind:scope.kind,id:scope.id,entryId:message.dataset.entryId}:undefined;
            busy=true;paint();
            try{
              const speaker=item?.actor||actor;
              const prepared=action==='retry'?await prepareRetry(message,{actor:speaker,text:spokenText(text),context}):null;
              const request=action==='replay'?{chatReplayRecordingId:item.id,actor:speaker,voicePrepared:true}:action==='retry'?{...prepared.request,onStart:()=>{prepared.request.onStart?.();onMotion(true,speaker,text);},onEnd:()=>{prepared.request.onEnd?.();onMotion(false,speaker);}}:null;
              const result=action==='save'?await bridge.chatAudioSave(item.id):await play(request);
              if(prepared)await prepared.finish(result);
              if(!result.ok)throw Error(action==='retry'?'Speech failed. The reply is still here. '+(result.error||''):(result.error||'Audio playback stopped.'));
              onStatus(action==='save'?(result.cancelled?'Save cancelled. Session audio is still available.':`Saved ${result.name}.`):action==='retry'?'Speech finished. The same reply was spoken again.':'Replay finished. No new speech was generated.','ok');
            }catch(error){onStatus(error.message,'warn');}
            finally{busy=false;await refresh();}
          });
          row.append(button);
        }
        message.append(row);
      }
    }
    async function refresh(){
      const token=++revision;
      try{const result=await bridge?.chatAudioList?.();if(token!==revision)return;if(result?.ok)recordings=result.recordings;paint();}
      catch{/* Audio controls must not prevent a conversation from loading. */}
    }
    return {refresh,paint,get busy(){return busy;}};
  };
})();
