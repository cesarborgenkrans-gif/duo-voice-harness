// Explicit operation states; routine refreshes cannot erase unresolved issues.
(function(root){'use strict';
 const states=new Set(['idle','working','success','attention','error']);
 function transition(previous,next,replace=false){
  if(!states.has(next.state))throw Error('Unknown feedback state.');
  if(!replace&&previous?.state==='error'&&next.state!=='error')return previous;
  if(!replace&&['error','attention'].includes(previous?.state)&&!['error','attention'].includes(next.state))return previous;
  return next;
 }
 const issues=new Map();
 function badge(){
  const engineIssues=[...issues.values()].filter(v=>v.scope==='engines');const gear=document.getElementById('gear'),entry=document.getElementById('btn-local-engines');if(!gear)return;
  let mark=document.getElementById('settings-issue-indicator');if(!mark){mark=document.createElement('span');mark.id='settings-issue-indicator';mark.className='settings-issue-indicator';mark.textContent='!';mark.setAttribute('role','img');mark.setAttribute('aria-label','Local engines need attention');mark.title='Local engines need attention';mark.onclick=event=>{event.stopPropagation();entry?.click();};gear.append(mark);}
  mark.hidden=!engineIssues.length;for(const button of [entry,document.getElementById('titlebar-engines')])if(button){button.dataset.needsAttention=String(!!engineIssues.length);button.title=engineIssues.length?'Local engines need attention':'';}
 }
 function create(host,{scope}={}){
  const icons={idle:'',working:'◌',success:'✓',attention:'△',error:'!'};let current=null,collapsed=false;
  const icon=document.createElement('span'),copy=document.createElement('div'),title=document.createElement('strong'),body=document.createElement('span'),controls=document.createElement('div'),action=document.createElement('button'),collapse=document.createElement('button'),details=document.createElement('details'),summary=document.createElement('summary'),technical=document.createElement('pre'),announcement=document.createElement('span');
  host.classList.add('ui-status');host.removeAttribute('role');host.removeAttribute('aria-live');icon.className='ui-status-icon';icon.setAttribute('aria-hidden','true');copy.className='ui-status-copy';body.className='ui-status-message';controls.className='ui-status-controls';action.type=collapse.type='button';action.className=collapse.className='ghost';collapse.setAttribute('aria-label','Collapse status message');summary.textContent='Details';details.append(summary,technical);copy.append(title,body,details);controls.append(action,collapse);announcement.className='ui-status-announcement';host.replaceChildren(icon,copy,controls,announcement);host.hidden=true;icon.hidden=title.hidden=body.hidden=details.hidden=action.hidden=collapse.hidden=true;collapse.textContent='−';
  function set(next,{replace=false}={}){
   next={state:'idle',...next};if(['error','attention'].includes(next.state)&&!next.title)next.title=next.state==='error'?'Action failed':'Needs attention';const accepted=transition(current,next,replace);if(accepted===current)return false;
   if(!replace&&current&&['state','title','message','details'].every(k=>current[k]===next[k])&&current.action?.label===next.action?.label)return false;
   const announce=current?.state!==next.state||current?.title!==next.title;current=accepted;collapsed=false;host.hidden=!next.title&&!next.message;host.dataset.state=next.state;host.dataset.collapsed='false';icon.textContent=icons[next.state];icon.hidden=!icons[next.state];title.textContent=next.title||'';title.hidden=!next.title;body.textContent=next.message||'';body.hidden=!next.message;technical.textContent=String(next.details||'').slice(0,1600);details.hidden=!next.details;details.open=false;
   action.hidden=!next.action;action.textContent=next.action?.label||'';action.disabled=!!next.action?.disabled;action.onclick=next.action?.run||null;collapse.hidden=!['error','attention'].includes(next.state);collapse.textContent='−';
   announcement.setAttribute('role',next.state==='error'?'alert':'status');if(announce)announcement.textContent=[next.title,next.message].filter(Boolean).join('. ');
   if(scope){if(['error','attention'].includes(next.state))issues.set(host,{scope,...next});else if(next.state!=='working')issues.delete(host);badge();}return true;
  }
  collapse.onclick=()=>{collapsed=!collapsed;host.dataset.collapsed=String(collapsed);collapse.textContent=collapsed?'+':'−';collapse.setAttribute('aria-label',collapsed?'Expand status message':'Collapse status message');};
  return {set,begin(message){return set({state:'working',message},{replace:true});},resolve(next){return set(next,{replace:true});},get current(){return current;}};
 }
 const api={transition,create};if(typeof module==='object'&&module.exports)module.exports=api;else root.DiscussionStatus=api;
})(globalThis);
