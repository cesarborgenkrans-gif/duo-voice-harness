// One speculative reply stays private until its semantic snapshot is validated.
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.DiscussionReplyPrefetch=api;})(globalThis,function(){
  'use strict';
  function create(){
    let slot=null;
    async function discard(){
      const old=slot;slot=null;if(!old)return;
      if(!old.settled){old.controller.abort();try{await old.cancel();}catch{}}
      await old.promise;
    }
    function start(snapshot,work,cancel=()=>{}){
      if(slot||!snapshot)return false;
      const item={key:JSON.stringify(snapshot),cancel,controller:new AbortController(),settled:false,result:null};slot=item;
      item.promise=Promise.resolve().then(()=>{item.controller.signal.throwIfAborted();return work(item.controller.signal);}).then(result=>{
        if(slot===item&&result?.ok&&result.text?.trim()&&result.finishReason!=='length')item.result=result;
      }).catch(()=>{}).finally(()=>{item.settled=true;});
      return true;
    }
    async function take(snapshot){
      const item=slot;if(!item)return null;
      try{
      let current=await snapshot();
      if(!current||JSON.stringify(current)!==item.key){await discard();return null;}
      await item.promise;
      current=await snapshot();
      if(slot!==item||!current||JSON.stringify(current)!==item.key){await discard();return null;}
      slot=null;return item.result;
      }catch{await discard();return null;}
    }
    return {start,take,discard,get pending(){return !!slot;}};
  }
  return {create};
});
