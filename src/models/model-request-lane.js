'use strict';
// Cancellation invalidates a result; only actual completion releases the lane.
function createModelRequestLane({maxQueued=8}={}){
  let active=false;const queue=[];
  function next(){
    if(active)return;
    const job=queue.shift();if(!job)return;
    job.signal?.removeEventListener('abort',job.abort);
    if(job.signal?.aborted){job.reject(job.signal.reason||Error('Model request cancelled.'));next();return;}
    active=true;let released=false;
    job.resolve(()=>{if(released)return;released=true;active=false;next();});
  }
  function acquire(signal){
    if(signal?.aborted)return Promise.reject(signal.reason||Error('Model request cancelled.'));
    if(queue.length>=maxQueued)return Promise.reject(Error('The model request queue is full. Wait for the current response.'));
    return new Promise((resolve,reject)=>{
      const job={signal,resolve,reject};
      job.abort=()=>{const index=queue.indexOf(job);if(index<0)return;queue.splice(index,1);reject(signal.reason||Error('Model request cancelled.'));};
      signal?.addEventListener('abort',job.abort,{once:true});queue.push(job);next();
    });
  }
  async function run(signal,work){
    const release=await acquire(signal);
    try{signal?.throwIfAborted();const result=await work();signal?.throwIfAborted();return result;}
    finally{release();}
  }
  return {acquire,run,get busy(){return active||queue.length>0;},get queued(){return queue.length;}};
}
module.exports={createModelRequestLane};
