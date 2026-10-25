// One optional image job shares the current turn's lifetime, never playback ownership.
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.DiscussionImageFocusSchedule=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  function create({coordinator,turn,work,cancel}){
    let job=null;
    function start(){
      if(job)return job;
      if(!coordinator.isCurrent(turn))return Promise.resolve();
      // Register synchronously: Stop owns setup, queued inference and its settlement.
      job=coordinator.run(turn,'image-focus',work,{cancel}).catch(()=>{});
      return job;
    }
    return {start,settle:start};
  }
  return {create};
});
