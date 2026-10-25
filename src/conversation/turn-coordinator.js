// One turn keeps ownership until its operations and cancellation callbacks settle.
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.DiscussionTurns=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  function cancelled(){const error=new Error('Response stopped.');error.name='AbortError';return error;}
  function create({onState=()=>{}}={}){
    let current=null,serial=0;
    const emit=turn=>{try{onState({id:turn.id,state:turn.state,jobs:[...turn.jobs.values()].map(job=>job.phase)});}catch{/* Observation cannot own a turn. */}};
    const owns=turn=>!!turn&&current===turn&&turn.state!=='settled';
    const isCurrent=turn=>owns(turn)&&!turn.signal.aborted;
    const check=turn=>{if(!isCurrent(turn))throw cancelled();};
    function begin(scope){
      if(current)throw Error('Wait for the current response to finish stopping.');
      const controller=new AbortController();
      current={id:'turn-'+(++serial),scope:Object.freeze({...scope}),controller,signal:controller.signal,state:'running',jobs:new Map(),cancelWork:new Set(),cancellation:null,finishing:false};
      emit(current);return current;
    }
    function run(turn,phase,work,{cancel,cleanup=false}={}){
      if(!owns(turn)||turn.finishing||(!cleanup&&!isCurrent(turn)))return Promise.reject(cancelled());
      const key=Symbol(phase),job={phase,cancel,started:false,cancelling:false};
      // Insert synchronously: Stop can see a job even before its first await.
      turn.jobs.set(key,job);
      job.promise=Promise.resolve().then(()=>{
        if(!cleanup)check(turn);
        job.started=true;return work();
      }).then(result=>{if(!cleanup)check(turn);return result;}).finally(()=>{turn.jobs.delete(key);emit(turn);});
      emit(turn);return job.promise;
    }
    async function drain(turn){
      while(turn.jobs.size||turn.cancelWork.size){
        await Promise.allSettled([...turn.jobs.values()].map(job=>job.promise).concat([...turn.cancelWork]));
      }
    }
    function cancel(turn=current){
      if(!owns(turn))return Promise.resolve();
      if(turn.cancellation)return turn.cancellation;
      turn.state='stopping';turn.controller.abort(cancelled());
      for(const job of turn.jobs.values()){
        if(!job.started||!job.cancel||job.cancelling)continue;
        job.cancelling=true;
        let result;try{result=job.cancel();}catch(error){result=Promise.reject(error);}
        const settled=Promise.resolve(result).catch(()=>{}).finally(()=>turn.cancelWork.delete(settled));
        turn.cancelWork.add(settled);
      }
      emit(turn);turn.cancellation=drain(turn);return turn.cancellation;
    }
    async function finish(turn){
      if(!owns(turn))return;
      turn.finishing=true;await drain(turn);
      turn.state='settled';emit(turn);if(current===turn)current=null;
    }
    return {begin,run,cancel,finish,check,isCurrent,get current(){return current;},get busy(){return !!current;}};
  }
  return {create};
});
