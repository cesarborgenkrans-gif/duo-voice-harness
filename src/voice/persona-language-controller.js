// Persona owns the speech language. A native dialog escapes the compact panel's scroll area.
(()=>{'use strict';
window.createPersonaLanguageController=({getLanguage,onChoose})=>{
 const $=id=>document.getElementById(id),api=window.DiscussionVoiceLanguage,panel=$('persona-language-panel');let opener=$('recipe-language-open');
 for(const language of api.LANGUAGES){const option=document.createElement('option');option.value=language;option.textContent=language;$('cfg-voice-language').append(option);}
 function paint(){
  const selected=api.resolve(getLanguage()),query=$('persona-language-search').value.trim().toLocaleLowerCase();
  $('recipe-language-open').textContent=selected+' · Choose language…';$('cfg-voice-language').value=selected;
  $('persona-language-current').textContent='Current speech language: '+selected+' · Saved on this device';
  const names=api.LANGUAGES.filter(name=>(name+' '+api.CODES[name]).toLocaleLowerCase().includes(query));
  $('persona-language-count').textContent=names.length?names.length+' languages and dialects · Choose to save':'No matches. Try another name or code.';
  const list=$('persona-language-list');list.replaceChildren();
  for(const name of names){const button=document.createElement('button');button.type='button';button.className='ghost';button.textContent=name;button.setAttribute('aria-pressed',String(name===selected));button.addEventListener('click',()=>{try{onChoose(name);paint();panel.close();}catch(error){$('persona-language-count').textContent=error.message;}});list.append(button);}
 }
 function open(event){opener=event?.currentTarget||$('recipe-language-open');$('persona-language-search').value='';paint();panel.showModal();$('persona-language-search').focus();}
 $('recipe-language-open').addEventListener('click',open);$('persona-language-search').addEventListener('input',paint);$('persona-language-close').addEventListener('click',()=>panel.close());
 $('speech-language-change').addEventListener('click',open);
 panel.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();panel.close();}});
 panel.addEventListener('close',()=>opener.focus());paint();return {paint,open};
};
})();
