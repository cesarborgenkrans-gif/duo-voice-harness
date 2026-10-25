/* The conversation header holds what belongs to the conversation: who is taking part, which saved chat is open, and the shared image.
   Existing controls stay the source of truth; this file only places them and mirrors their state. The renderer calls sync() when it updates the activity. */
(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  const select=$('conversation-partner'),chipHost=$('participant-chips'),controls=$('conversation-controls');
  const chats=$('chats-toggle'),chatName=$('session-current'),newChat=$('session-new'),quickNew=$('session-new-quick');
  const image=$('image-view-toggle'),actions=document.querySelector('.chat-actions'),tools=document.querySelector('.stage-tools'),persona=$('recipe-toggle');
  if(!select||!chipHost||!controls)return;

  // Participants: one chip per option of the select.
  const chips=[...select.options].map(option=>{
    const chip=document.createElement('button');chip.type='button';chip.className='ghost participant-chip';chip.dataset.value=option.value;
    chip.textContent=option.value==='momotamu'?'Solo · Momotamu':'✦ Duo · '+option.textContent.replace(' + ',' & ');chip.title=option.value==='momotamu'?'Solo chat with Momotamu only':'Autonomous duo discussion with Momotamu and Vivi';
    chip.addEventListener('click',()=>{if(select.disabled||select.value===option.value)return;select.value=option.value;select.dispatchEvent(new Event('change',{bubbles:true}));sync();});
    chipHost.append(chip);return chip;
  });

  // Saved chats: the open chat's name is the button that opens them, with New chat beside it.
  function nameChats(){
    if(!chats||!chatName)return;
    const name=chatName.textContent.trim()||'Chats',label=document.createElement('span');label.className='chat-name';label.textContent=name;
    chats.replaceChildren(label,' ▾');chats.setAttribute('aria-label','Saved chats. Open: '+name);chats.title=chatName.title||name;
    if(quickNew&&newChat)quickNew.textContent='+ '+newChat.textContent.trim();
  }
  if(chatName)new MutationObserver(nameChats).observe(chatName,{childList:true,characterData:true,subtree:true});
  if(newChat)new MutationObserver(nameChats).observe(newChat,{childList:true,characterData:true,subtree:true});
  quickNew?.addEventListener('click',()=>{if(!newChat?.disabled)newChat.click();});

  function sync(){
    const inHeader=!controls.hidden&&!document.querySelector('.app.studio-producing');
    chipHost.hidden=!inHeader;controls.classList.toggle('shown-as-chips',inHeader);
    for(const chip of chips){chip.setAttribute('aria-pressed',String(chip.dataset.value===select.value));chip.disabled=select.disabled;}
    // Image view sits with the conversation when there is one on screen, and returns beside Attach in activities without it.
    if(image&&actions&&tools){if(inHeader){if(image.parentElement!==actions)actions.prepend(image);}else if(image.parentElement!==tools)tools.insertBefore(image,persona&&persona.parentElement===tools?persona:null);}
    nameChats();
  }
  select.addEventListener('change',()=>queueMicrotask(sync));
  window.DiscussionConversationHeader={sync};sync();
})();
