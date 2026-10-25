/* A button that opens a panel wears that panel's colour while the panel is open, so the cause of the panel is visible.
   The colour is read from the open panel itself, so it follows the theme. State stays on aria-expanded, which the existing open and close paths already set. */
(() => {
  'use strict';
  const solid=color=>color&&color!=='transparent'&&!/rgba\([^)]*,\s*0\)$/.test(color);
  function wear(button){
    if(button.getAttribute('aria-expanded')!=='true')return;
    const panel=document.getElementById(button.getAttribute('aria-controls'));if(!panel)return;
    const style=getComputedStyle(panel);
    for(const [name,value] of [['--owner-bg',style.backgroundColor],['--owner-border',style.borderTopColor],['--owner-text',style.color]])solid(value)?button.style.setProperty(name,value):button.style.removeProperty(name);
  }
  const observer=new MutationObserver(records=>{for(const record of records)requestAnimationFrame(()=>wear(record.target));});
  for(const button of document.querySelectorAll('button[aria-controls][aria-expanded]')){observer.observe(button,{attributes:true,attributeFilter:['aria-expanded']});wear(button);}
})();
