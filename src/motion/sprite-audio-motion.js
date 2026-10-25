/* Rule: react to played/captured RMS, hold reviewed poses, and spring above planted
   feet. This numeric-only engine is shared by the app, Studio, and video export. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else (root.window||root).DiscussionAudioMotion=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
  const level=v=>Number.isFinite(v)?clamp(v,0,1):0;
  // A single quiet reaction per guest turn. Pose 4 is reserved for this role.
  const guestCuriosity={afterMs:1200,holdMs:900,beats:[[0,160],[3,180],[1,180],[4,900],[1,180],[3,180],[0,240]]};
  function createReactor(){
    let source=null,id=null,rms=0,age=Infinity,envelope=0,q=0,velocity=0,sequence=0;
    function reset(){source=id=null;rms=envelope=q=velocity=0;age=Infinity;sequence++;}
    function begin(kind,key){if(!['input','output'].includes(kind)||typeof key!=='string'||!key)return false;reset();source=kind;id=key;age=0;return true;}
    function sample(kind,key,value){if(kind!==source||key!==id)return false;rms=level(value);age=0;sequence++;return true;}
    function end(kind,key){if(kind!==source||key!==id)return false;source=id=null;rms=0;age=Infinity;sequence++;return true;}
    function advance(ms,{enabled=true}={}){
      if(!Number.isFinite(ms)||ms<0)throw Error('Invalid audio motion time');
      if(!enabled){envelope=q=velocity=0;age+=ms;return snapshot();}
      // Small fixed substeps keep the spring stable across 30/60/120 Hz displays.
      for(let left=ms;left>0;){const dt=Math.min(left,1000/240);left-=dt;age+=dt;
        const value=age>180?0:rms,gate=source==='input'?.009:.007;
        const target=value<=gate?0:clamp(Math.log1p((value-gate)*18)/Math.log1p(18*.32),0,1);
        envelope+=(target-envelope)*(1-Math.exp(-dt/(target>envelope?45:170)));
        const wanted=envelope*(source==='input'?.013:.024),omega=2*Math.PI*3.1;
        velocity+=(omega*omega*(wanted-q)-2*.62*omega*velocity)*dt/1000;
        q=clamp(q+velocity*dt/1000,-.012,.032);
      }return snapshot();
    }
    function snapshot(){return{source,rms:age>180?0:rms,envelope,squish:q,sequence};}
    function nod(amount=.022){q=clamp(q+amount,-.012,.032);velocity+=.35;}
    return{begin,sample,end,reset,advance,snapshot,nod};
  }
  const conversationProfiles={
    // closed: the closed-mouth neighbour of a speaking posture; closedHold: the drawing held when motion is reduced.
    momotamu:{postures:[2,3],blink:null,emphasis:4,closed:{2:1},closedHold:1,edges:[[0,1],[1,2],[2,3],[3,4],[4,3],[3,2],[2,1],[1,0]]},
    vivi:{postures:[1,3],blink:4,emphasis:5,closedHold:0,edges:[[0,1],[1,0],[0,6],[6,0],[0,7],[7,0],[6,7],[7,6],[1,6],[6,1],[3,6],[6,3],[1,3],[3,1],[1,4],[4,1],[3,4],[4,3],[1,5],[5,1],[3,5],[5,3],[4,5],[5,4],[0,2],[2,0],[2,6],[6,2]]},
    viviFront:{postures:[2,7],blink:6,emphasis:5,closed:{2:0},closedHold:0,edges:[[0,2],[2,0],[0,7],[7,0],[2,7],[7,2],[2,6],[6,2],[0,6],[6,0],[2,5],[5,2],[7,5],[5,7],[0,5],[5,0]]}
  };
  function createConversationSpeech(actor,options={}){
    const profile=conversationProfiles[actor];if(!profile)throw Error('Unknown conversation actor');
    return createSpeech({compatibleDirectedEdges:profile.edges},{...options,profile});
  }
  // A pause shorter than this keeps the speaking pose (or its closed-mouth neighbour); only a real pause returns to rest.
  // The rest drawing a turn opens on is shown at least START_MIN_MS, so entering speech never flashes it.
  const PAUSE_MS=600,REST_MIN_MS=240,START_MIN_MS=120,MOUTH_MIN_MS=250;
  function createSpeech(data,{random=Math.random,profile=null}={}){
    const postures=profile?.postures||[1,5],blink=profile?profile.blink:6,emphasis=profile?profile.emphasis:2;
    const edges=profile?data.compatibleDirectedEdges:data.compatibleDirectedEdges.filter(([a,b])=>a!==4&&b!==4),bridges=new Map();
    for(const [a,b]of edges){if(!bridges.has(a))bridges.set(a,[]);bridges.get(a).push(b);}
    // Front Speaking variations: 3 is the near-closed settle beside open 1 and 5. Only direct two-way edges qualify.
    const closedOf=new Map(Object.entries(profile?profile.closed||{}:data.closedMouth||{1:3,5:3}).map(([a,b])=>[+a,+b]).filter(([a,b])=>bridges.get(a)?.includes(b)&&bridges.get(b)?.includes(a)));
    const closedHold=profile?(profile.closedHold??3):(data.closedHold??0);
    let clock=0,frame=0,poseStart=0,queue=[],mode='idle',audioDriven=true,rms=0,levelAt=-Infinity;
    let mouthOpen=true,mouthAt=0,peak=0;
    let voiced=0,quiet=0,talking=false,posture=1,nextPosture=3300,nextBlink=6500,nextGesture=10000,blinkUntil=0,gestureUntil=0;
    const between=(a,b)=>a+(b-a)*random();
    function route(goal){
      if(queue.length||goal===frame)return;
      const todo=[[frame]],seen=new Set([frame]);let found=null;
      for(let i=0;i<todo.length;i++){const p=todo[i];if(p.at(-1)===goal){found=p;break;}for(const n of bridges.get(p.at(-1))||[]){if(!seen.has(n)){seen.add(n);todo.push([...p,n]);}}}
      if(!found)return;const first=Math.max(clock,poseStart+(frame===0?(poseStart>0?REST_MIN_MS:START_MIN_MS):frame===blink?135:180));
      queue=found.slice(1).map((f,i,a)=>({frame:f,at:first+i*180,final:i===a.length-1}));
    }
    function drain(){while(queue.length&&queue[0].at<=clock){const b=queue.shift();if(frame!==b.frame){frame=b.frame;poseStart=b.at;}}}
    function begin(register='auto',options={}){
      clock=0;frame=0;poseStart=0;queue=[];mode='speaking';audioDriven=options.audioDriven!==false;rms=0;levelAt=-Infinity;
      voiced=quiet=0;talking=false;mouthOpen=true;mouthAt=0;peak=0;posture=postures[0];nextPosture=between(2800,4200);nextBlink=between(5800,8500);nextGesture=between(9500,13500);blinkUntil=gestureUntil=0;
    }
    function setLevel(value){rms=level(value);levelAt=clock;}
    function advance(ms){
      if(!Number.isFinite(ms)||ms<0)throw Error('Invalid speech time');
      for(let left=ms;left>0;){const dt=Math.min(left,10);left-=dt;clock+=dt;drain();
        if(mode==='return'){if(!queue.length&&frame===0)mode='complete';continue;}
        if(mode!=='speaking')continue;
        const audible=!audioDriven||(clock-levelAt<180&&rms>.014);
        if(audible){voiced+=dt;quiet=0;if(voiced>=45)talking=true;}else{quiet+=dt;voiced=0;if(quiet>=PAUSE_MS)talking=false;}
        if(clock>=nextPosture){posture=posture===postures[0]?postures[1]:postures[0];nextPosture=clock+between(2800,4400);}
        // Mouth rhythm: loud syllables open, soft ones and short gaps close to the neighbour, never faster than 4 changes a second.
        peak=Math.max(audible&&audioDriven?rms:0,peak*Math.exp(-dt/1600));
        if(!talking)mouthOpen=true;
        else if(audioDriven&&!queue.length&&clock-Math.max(mouthAt,poseStart)>=MOUTH_MIN_MS){
          const loud=audible&&rms>=Math.max(.03,peak*.6),soft=!audible||rms<Math.max(.02,peak*.35);
          if(mouthOpen&&soft){mouthOpen=false;mouthAt=clock;}else if(!mouthOpen&&loud){mouthOpen=true;mouthAt=clock;}
        }
        let goal=talking?(!mouthOpen&&closedOf.has(posture)?closedOf.get(posture):posture):0;
        // A blink or emphasis is a complete deliberate gesture with a soft return.
        // Independent deadlines never make a silent mouth open just to blink.
        if(blink!==null&&talking&&frame===postures[0]&&!queue.length&&clock>=nextBlink){blinkUntil=clock+135;nextBlink=clock+between(6200,9500);}
        if(emphasis!==null&&talking&&frame===postures[0]&&!queue.length&&!blinkUntil&&clock>=nextGesture&&rms>.09){gestureUntil=clock+440;nextGesture=clock+between(10000,15000);}
        if(blinkUntil){if(clock<blinkUntil)goal=blink;else{blinkUntil=0;goal=postures[0];}}
        else if(gestureUntil){if(clock<gestureUntil)goal=emphasis;else{gestureUntil=0;goal=postures[0];}}
        route(goal);drain();
      }
    }
    function finish(){mode='return';talking=false;queue=[];blinkUntil=gestureUntil=0;route(0);drain();if(frame===0)mode='complete';}
    function seekBeat(){queue=[];frame=closedHold;poseStart=clock;}
    function state(){return{frame,clockMs:clock,elapsedMs:clock-poseStart,mode,completed:mode==='complete',talking,audioDriven,
      phrase:frame===blink?'blink':talking&&!mouthOpen&&frame===closedOf.get(posture)?'closed syllable':frame===emphasis?'emphasis':frame===0?'quiet pause':posture===postures[1]?'thoughtful hold':'soft speech',duration:Infinity};}
    function nod(){if(blink!==null&&talking&&!queue.length)blinkUntil=clock+135;}
    return{begin,advance,finish,state,setLevel,seekBeat,nod};
  }
  // Prepared WAVs are PCM16. RIFF chunks are walked, so non-44-byte headers work.
  function wavEnvelope(bytes,stepMs=40){
    const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),tag=at=>String.fromCharCode(...Array.from({length:4},(_,i)=>v.getUint8(at+i)));
    if(v.byteLength<12||tag(0)!=='RIFF'||tag(8)!=='WAVE')throw Error('Expected PCM WAV for motion analysis');
    let fmt=null,data=null;
    for(let p=12;p+8<=v.byteLength;){const n=v.getUint32(p+4,true),end=p+8+n;if(end>v.byteLength)throw Error('Truncated WAV');
      if(tag(p)==='fmt '&&n>=16)fmt={code:v.getUint16(p+8,true),channels:v.getUint16(p+10,true),rate:v.getUint32(p+12,true),bits:v.getUint16(p+22,true)};
      if(tag(p)==='data')data={offset:p+8,length:n};p=end+(n%2);
    }
    if(!fmt||!data||fmt.code!==1||fmt.bits!==16||fmt.channels<1||fmt.channels>8||fmt.rate<8000||fmt.rate>192000)throw Error('Motion analysis needs PCM16 WAV');
    const samples=Math.floor(data.length/(2*fmt.channels)),window=Math.max(1,Math.round(fmt.rate*stepMs/1000)),values=[];
    for(let start=0;start<samples;start+=window){const end=Math.min(samples,start+window);let square=0;
      for(let i=start;i<end;i++){let value=0;for(let c=0;c<fmt.channels;c++)value+=v.getInt16(data.offset+(i*fmt.channels+c)*2,true)/32768;value/=fmt.channels;square+=value*value;}
      values.push(Math.sqrt(square/(end-start)));
    }return{stepMs,values,duration:samples/fmt.rate};
  }
  return{createReactor,createSpeech,createConversationSpeech,conversationProfiles,wavEnvelope,guestCuriosity};
});
