(()=>{'use strict';window.createWindowViewController=function({bridge,onTop,onStatus}){
 const $=id=>document.getElementById(id);let state={mode:'main',maximized:false,alwaysOnTop:false,sideScreenAvailable:false},changing=false;
 const topbarRight=document.querySelector('.topbar .right'),freeBar=$('free-titlebar');if(topbarRight&&freeBar&&freeBar.parentElement!==topbarRight)topbarRight.append(freeBar);
 function paint(value){state={...state,...value};document.body.dataset.windowMode=state.mode;$('free-titlebar').hidden=state.mode!=='free';if($('btn-minimize'))$('btn-minimize').hidden=!bridge||state.mode==='free';for(const id of ['window-view','titlebar-view']){const select=$(id);if(!select)continue;select.value=state.mode;select.querySelector('[value="panel"]').disabled=!!bridge&&!state.sideScreenAvailable;select.disabled=changing;}
  $('window-pin').setAttribute('aria-pressed',String(state.alwaysOnTop));$('window-pin').textContent=state.alwaysOnTop?'◆':'◇';$('window-pin').title=state.alwaysOnTop?'Allow other windows above':'Keep window on top';$('window-pin').setAttribute('aria-label',$('window-pin').title);$('cfg-always-on-top').checked=state.alwaysOnTop;
  $('window-maximize').textContent=state.maximized?'❐':'□';$('window-maximize').title=state.maximized?'Restore size':'Maximize';$('window-maximize').setAttribute('aria-label',$('window-maximize').title);
  for(const id of ['window-pin','window-minimize','window-maximize','window-close'])$(id).disabled=!bridge;
  for(const button of document.querySelectorAll('[data-window-view]')){button.setAttribute('aria-pressed',String(button.dataset.windowView===state.mode));button.disabled=changing||button.dataset.windowView==='panel'&&!!bridge&&!state.sideScreenAvailable;}
 }
 async function choose(mode){if(changing)return;changing=true;paint(state);try{const result=bridge?await bridge.selectWindowView(mode):{ok:true,mode};if(!result.ok)throw Error(result.error);paint(result);}catch(e){onStatus(e.message,'warn');}finally{changing=false;paint(state);}}
 for(const id of ['window-view','titlebar-view'])$(id).onchange=e=>choose(e.target.value);
 for(const button of document.querySelectorAll('[data-window-view]'))button.onclick=async()=>{window.DiscussionSharedStage?.exitRecording();await choose(button.dataset.windowView);$('view-menu').hidePopover();};
 $('view-menu').addEventListener('toggle',()=>{if(!$('view-menu').matches(':popover-open'))return;const anchor=$('view-toggle').getBoundingClientRect(),menu=$('view-menu');menu.style.left=Math.max(8,Math.min(anchor.right-menu.offsetWidth,innerWidth-menu.offsetWidth-8))+'px';menu.style.top=Math.min(anchor.bottom+8,Math.max(8,innerHeight-menu.offsetHeight-8))+'px';});
 for(const action of ['minimize','maximize','close'])$('window-'+action).onclick=async()=>{try{const r=await bridge.windowAction(action);if(!r.ok)onStatus(r.error,'warn');}catch(e){onStatus(e.message,'warn');}};
 $('window-pin').onclick=async()=>{try{const r=await bridge.setAlwaysOnTop(!state.alwaysOnTop);if(!r.ok)throw Error(r.error);paint(r);onTop(r.alwaysOnTop);}catch(e){onStatus(e.message,'warn');}};
 bridge?.onWindowView?.(value=>{paint(value);onTop(value.alwaysOnTop);});bridge?.windowView?.().then(r=>{if(r.ok)paint(r);}).catch(e=>onStatus(e.message,'warn'));paint(state);
 return{choose,snapshot:()=>({...state})};
};})();
