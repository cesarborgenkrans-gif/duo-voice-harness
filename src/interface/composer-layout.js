// Side view keeps writing and Send visible; only the secondary controls scroll.
(() => {
  'use strict';
  const controls=document.getElementById('composer-controls');
  const submit=document.getElementById('composer-submit');
  const actions=document.querySelector('.composer-actions');
  const buttons=['btn-run','btn-stop'].map(id=>document.getElementById(id));
  if(!controls||!submit||!actions||buttons.some(b=>!b))return;
  function sync(){
    const side=document.body.dataset.windowMode==='panel';
    const target=side?submit:actions;
    if(buttons.some(button=>button.parentElement!==target))target.append(...buttons);
    controls.tabIndex=side?0:-1;
    if(!side)controls.scrollTop=0;
  }
  new MutationObserver(sync).observe(document.body,{attributes:true,attributeFilter:['data-window-mode']});
  sync();
})();
