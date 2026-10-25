/* Slow reflections on warm brass pixels in the currently registered Vivi pose. */
(()=>{'use strict';
 const instances=new WeakMap(),motion=matchMedia('(prefers-reduced-motion: reduce)');
 function capture(canvas,{enabled=()=>true}={}){
  let effect=instances.get(canvas);if(!effect){effect={canvas,enabled,clock:4,last:null,painted:0};instances.set(canvas,effect);requestAnimationFrame(now=>tick(effect,now));}
  effect.enabled=enabled;
  const ctx=canvas.getContext('2d'),base=ctx.getImageData(0,0,canvas.width,canvas.height),mask=[];
  // Colour select only brass; skin, white hair, pink cloth and dark engraving remain unchanged.
  for(let y=0;y<base.height;y++)for(let x=0;x<base.width;x++){const i=(y*base.width+x)*4,R=base.data[i],G=base.data[i+1],B=base.data[i+2];
   if(base.data[i+3]<32||R<70||B/R>.82||G/R<.48||G/R>.94)continue;
   const weight=Math.min(1,(R-B)/70)*Math.min(1,(R-60)/50);
   mask.push({i,x,y,weight});
  }
  effect.base=base;effect.mask=mask;effect.copy=new ImageData(new Uint8ClampedArray(base.data),base.width,base.height);
  canvas.dataset.brassPixels=String(mask.length);render(effect,effect.clock);
  return effect;
 }
 function render(e,seconds){if(!e.base)return;e.copy.data.set(e.base.data);
  if(!motion.matches){for(const p of e.mask){const phase=(seconds+(p.y/e.base.height)*2.1)%16/16,progress=(phase-.2)/.6;
   if(progress<=0||progress>=1)continue;
   const u=(p.x/e.base.width-.5)*2,v=(p.y/e.base.height-.5)*2;
   const centre=-.9+1.8*progress,curved=.8*u+.35*v+.18*v*v;
   const shine=Math.exp(-((curved-centre)**2)/.19)*Math.sin(Math.PI*progress)**2*p.weight*.16;
   for(let k=0;k<3;k++)e.copy.data[p.i+k]=Math.round(e.base.data[p.i+k]+(255-e.base.data[p.i+k])*shine*[1,.86,.58][k]);
  }}
  e.canvas.getContext('2d').putImageData(e.copy,0,0);
 }
 function tick(e,now){const dt=e.last===null?0:Math.min((now-e.last)/1000,.1);e.last=now;
  if(!document.hidden&&e.enabled()&&!motion.matches){e.clock+=dt;if(now-e.painted>50){render(e,e.clock);e.painted=now;}}
  requestAnimationFrame(time=>tick(e,time));
 }
 motion.addEventListener('change',()=>{document.querySelectorAll('canvas').forEach(c=>{const e=instances.get(c);if(e)render(e,e.clock);});});
 window.ViviBrassLight=Object.freeze({capture,inspect:canvas=>{const e=instances.get(canvas);return e?{pixels:e.mask.length,seconds:e.clock}:null;},renderAt(canvas,seconds){const e=instances.get(canvas);if(e)render(e,seconds);}});
})();
