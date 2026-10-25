(() => {
'use strict';
window.createMomotamuSpeechDirector=function(motion,{random=Math.random}={}){
 const definitions=motion.phrases;
 let current=null,index=0,elapsed=0,clock=0,nextBlink=0,lastSpeech=null,register='auto',mode='sustained',completed=false,finishRequested=false,blinkRequested=false,auditionOnly=false;
 const history=[];
 const clone=p=>({...p,frames:[...p.frames],ms:[...p.ms]});
 function load(id,p=definitions[id]){
  current=clone(p);index=0;elapsed=0;completed=false;
  history.push({id:current.id,kind:current.kind,atMs:clock});if(history.length>50)history.shift();
 }
 function scheduleBlink(){const [a,b]=motion.blinkGapMs;nextBlink=clock+a+random()*(b-a);}
 function choose(){
  let tone=register;
  if(tone==='auto'){
   const entries=Object.entries(motion.autoToneWeights),sum=entries.reduce((n,[,w])=>n+w,0);
   let pick=random()*sum;tone=entries[entries.length-1][0];
   for(const [name,weight] of entries){pick-=weight;if(pick<0){tone=name;break;}}
  }
  let pool=Object.values(definitions).filter(p=>p.kind==='speech'&&p.tone===tone&&p.id!==lastSpeech);
  if(!pool.length)pool=Object.values(definitions).filter(p=>p.kind==='speech'&&p.id!==lastSpeech);
  const result=pool[Math.min(pool.length-1,Math.floor(random()*pool.length))];lastSpeech=result.id;load(result.id);
 }
 function done(){completed=true;elapsed=0;index=current.frames.length-1;}
 function boundary(){
  if(current.kind==='return')return done();
  if(finishRequested){finishRequested=false;return load('return');}
  if(blinkRequested){blinkRequested=false;scheduleBlink();return load('blink');}
  if(auditionOnly)return done();
  if(mode==='phrase'&&current.kind!=='entry')return done();
  if(mode==='sustained'&&clock>=nextBlink){
   blinkRequested=false;scheduleBlink();return load('blink');
  }
  choose();
 }
 function begin(tone='auto',playMode='sustained'){
  if(!['auto','quiet','explain','warm','thoughtful'].includes(tone))throw Error('Unknown speaking register');
  if(!['sustained','phrase'].includes(playMode))throw Error('Unknown speaking mode');
  register=tone;mode=playMode;clock=0;finishRequested=false;blinkRequested=false;auditionOnly=false;lastSpeech=null;history.length=0;scheduleBlink();load('entry');
 }
 function advance(ms){
  if(!Number.isFinite(ms)||ms<0)throw Error('Invalid elapsed time');
  if(!current||completed)return;
  let remaining=ms;
  while(remaining>0&&!completed){
   const left=current.ms[index]-elapsed,used=Math.min(left,remaining);elapsed+=used;clock+=used;remaining-=used;
   if(elapsed>=current.ms[index]){
    elapsed=0;
    if(index+1<current.frames.length)index++;
    else boundary();
   }
  }
 }
 function setRegister(tone){if(!['auto','quiet','explain','warm','thoughtful'].includes(tone))throw Error('Unknown register');register=tone;}
 function audition(id,reverse=false){
  if(!definitions[id])throw Error('Unknown phrase');
  mode='phrase';auditionOnly=true;register=definitions[id].tone;finishRequested=false;blinkRequested=false;
  const phrase=clone(definitions[id]);
  if(reverse){phrase.frames.reverse();phrase.ms.reverse();phrase.id=id+'-reverse';}
  load(id,phrase);
 }
 function finish(){
  if(!current||completed){finishRequested=false;mode='phrase';load('return');return;}
  finishRequested=true;
 }
 function blink(){
  if(!current||completed){mode='phrase';blinkRequested=false;load('blink');return;}
  blinkRequested=true;
 }
 function seekBeat(i){if(!current||!Number.isInteger(i)||i<0||i>=current.frames.length)throw Error('Invalid beat');index=i;elapsed=0;completed=false;}
 function state(){
  return{phrase:current?.id,kind:current?.kind,beat:index,frame:current?.frames[index]??0,duration:current?.ms[index]??0,
   frames:current?[...current.frames]:[],ms:current?[...current.ms]:[],elapsedMs:elapsed,register,mode,completed,clockMs:clock,nextBlinkMs:nextBlink,
   finishRequested,blinkRequested,history:history.map(x=>({...x}))};
 }
 return{begin,advance,setRegister,audition,finish,blink,seekBeat,state};
};
})();
