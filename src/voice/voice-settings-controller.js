// Draft provider choices stay separate from active settings until Save.
(()=>{'use strict';
window.createVoiceSettingsController=({bridge,getSettings,getBusy,onSave,onPreview,onStop,onLocalStart,onLocalWarm,onLocalStop,onLocalCheck})=>{
 const $=id=>document.getElementById(id),panel=$('voice-panel'),cache=new Map();
 const providers={voxcpm2:{label:'VoiceGen / VoxCPM2',note:'Install VoiceGen Oui: WSL, ROCm, a Python environment, and VoxCPM2 weights you download. An RX 7900 XTX can run that setup once it is installed. Momotamu and Vivi use the reference recordings included with Duo.'},diy:{label:'DIY speech server',note:'Connect your own compatible speech server. Duo leaves its engine and hardware under your control.'},elevenlabs:{label:'ElevenLabs',url:'https://api.elevenlabs.io',note:'Use voices from your own ElevenLabs account. No local voice engine is needed.'},cartesia:{label:'Cartesia',url:'https://api.cartesia.ai',note:'Use voices from your own Cartesia account. No local voice engine is needed.'},off:{label:'Text only',note:'Continue the conversation without generating speech. Your chats and saved audio are kept.'}};
 let connections=[],selected='',pending=false,previewing=false,revision=0,credentialOK=true,localJob='';
 const kind=()=>$('voice-provider').value,hosted=()=>['elevenlabs','cartesia'].includes(kind()),external=()=>!['off','voxcpm2'].includes(kind());
 const connection=()=>connections.find(item=>item.id===selected&&item.provider===kind());
 const note=(text,state='idle')=>{$('voice-settings-status').textContent=text;$('voice-settings-status').dataset.state=state;};
 const current=stamp=>{if(stamp!==revision)throw Error('Voice setup was closed.');};
 function requiresRemote(){if(hosted())return true;if(kind()!=='diy')return false;try{return !['localhost','127.0.0.1','[::1]'].includes(new URL($('voice-server').value).hostname);}catch{return false;}}
 function changedConnection(){const item=connection();return !item||kind()==='diy'&&$('voice-server').value.trim().replace(/\/+$/,'')!==item.baseURL||!!$('voice-key').value;}
 function validRoute(){return !external()||!!connection()&&credentialOK&&!changedConnection()&&!!$('voice-momotamu').value&&!!$('voice-vivi').value&&(!hosted()||!!$('voice-model').value);}
 function route(){if(!external())return undefined;if(!validRoute())throw Error('Check the connection, then choose a model and a voice for each companion.');return {schemaVersion:1,provider:kind(),connectionId:selected,...(hosted()?{modelId:$('voice-model').value}:{}),voices:{momotamu:$('voice-momotamu').value,vivi:$('voice-vivi').value}};}
 function paint(){
  const off=kind()==='off',local=kind()==='voxcpm2',cloud=requiresRemote(),blocked=pending||previewing;
  panel.dataset.connected=String(external()&&!!connection()&&credentialOK);
  $('voice-local-setup').hidden=!local;$('voice-connection-setup').hidden=!external();$('voice-server-row').hidden=kind()!=='diy';$('voice-model-row').hidden=!hosted();
  $('voice-cast').hidden=off;$('voice-reply-options').hidden=off;$('voice-key-remove').hidden=!connection()?.credentialRef;
  $('voice-provider-description').textContent=providers[kind()].note;
  $('voice-cloud-note').hidden=!cloud;$('voice-cloud-note').textContent=hosted()?`Previews and speech send your spoken text to ${providers[kind()].label} and may use credits.`:'Spoken text goes to your remote server. Its operator controls retention and any charges.';
  $('voice-remote-row').hidden=!cloud;$('voice-cancel-note').hidden=!cloud;
  $('voice-preview-note').textContent=hosted()?'Preview generates a short take. Replay in Speech uses cached audio.':'Preview plays a short sentence through the selected output.';
  $('voice-capability-note').textContent=local?'Included reference voices support delivery direction and reading continuation.':'This route uses natural delivery. Free-form Voice Direction and reading continuation are unavailable.';
  for(const el of panel.querySelectorAll('input,select,button'))if(!['voice-close','voice-preview-stop'].includes(el.id))el.disabled=blocked||!bridge;
  for(const actor of ['momotamu','vivi']){$('voice-'+actor).disabled=blocked||!external()||!connection();$('voice-preview-'+actor).disabled=blocked||!bridge||off||!validRoute()||cloud&&!$('voice-remote-allow').checked;}
  $('voice-connect').disabled=blocked||!bridge||cloud&&!$('voice-remote-allow').checked;
  $('voice-save').disabled=blocked||!bridge||!validRoute()||cloud&&!$('voice-remote-allow').checked;
  $('voice-preview-stop').hidden=!previewing;$('voice-output-test').disabled=blocked||!bridge||off||!validRoute()||cloud&&!$('voice-remote-allow').checked;
  if(localJob==='warm')$('btn-stop-voice').disabled=false;
  panel.setAttribute('aria-busy',String(pending));
 }
 function options(id,list,value,placeholder){const el=$(id);el.replaceChildren(new Option(placeholder,''),...list.map(item=>new Option(item.label,item.id)));if(value&&!list.some(item=>item.id===value))el.add(new Option('Saved selection · '+value,value));el.value=value||'';}
 function fillVoices(){
  const saved=getSettings().voiceRoute,matching=saved?.provider===kind()&&saved.connectionId===selected,discovered=cache.get(selected);
  const labels=getSettings().voiceLabels,stored=labels?.connectionId===selected?labels:{};
  options('voice-model',discovered?.models||[stored.model].filter(Boolean),matching?saved.modelId:'','Choose a model');
  for(const actor of ['momotamu','vivi'])options('voice-'+actor,external()?discovered?.voices||[stored[actor]].filter(Boolean):[],matching?saved.voices?.[actor]:'',external()?'Choose a voice':'Included '+(actor==='vivi'?'Vivi':'Momotamu')+' reference');
 }
 async function keyStatus(stamp){
  const ref=connection()?.credentialRef;credentialOK=!hosted()||!!ref;
  $('voice-key-status').textContent=ref?'Checking saved key…':hosted()?'Add your API key to connect.':'API key optional for your server.';
  if(ref){const result=await bridge.credentialStatus(ref);current(stamp);credentialOK=result.ok;$('voice-key-status').textContent=result.ok?result.credential.mode==='session'?'Key kept until the app closes.':'Key saved with OS protection.':'Saved key unavailable. Enter a replacement.';}
 }
 async function selectConnection(stamp){
  selected=$('voice-connection').value;$('voice-key').value='';$('voice-key-session').checked=false;
  $('voice-server').value=connection()?.baseURL||'http://127.0.0.1:3235';fillVoices();await keyStatus(stamp);$('voice-connection-details').open=!connection()||!credentialOK;$('voice-connection-summary').textContent=connection()?'Manage connection':'Connect your provider';paint();
 }
 function connectionChoices(){const available=connections.filter(item=>item.provider===kind());$('voice-connection').replaceChildren(new Option('New connection…',''),...available.map((item,i)=>new Option((providers[kind()].url?providers[kind()].label+' connection '+(i+1):item.baseURL),item.id)));const saved=getSettings().voiceRoute;selected=available.find(item=>item.id===saved?.connectionId)?.id||available[0]?.id||'';$('voice-connection').value=selected;$('voice-connection-row').hidden=!available.length;}
 async function changeProvider(){const stamp=++revision;pending=true;$('voice-key').value='';paint();try{connectionChoices();await selectConnection(stamp);current(stamp);note('Save to use these voices.');}catch(error){if(stamp===revision)note(error.message,'error');}finally{if(stamp===revision){pending=false;paint();}}}
 async function action(fn){if(pending||previewing)return;if(!bridge){note('Open the desktop app to configure voices.','error');return;}if(getBusy()){note('Finish or stop playback, listening or the current conversation first.','error');return;}const stamp=revision;pending=true;paint();try{return await fn(stamp);}catch(error){if(stamp===revision)note(error.message,'error');}finally{if(stamp===revision){pending=false;paint();}}}
 async function policy(stamp){const result=await bridge.voiceConnections('setLocalOnly',!$('voice-remote-allow').checked);current(stamp);if(!result.ok)throw Error(result.error);}
 async function connect(stamp){
  if(requiresRemote()&&!$('voice-remote-allow').checked)throw Error('Allow remote voice connections before checking this provider.');
  const baseURL=providers[kind()].url||$('voice-server').value.trim();let url;try{url=new URL(baseURL);}catch{throw Error('Enter a complete speech server address, such as http://127.0.0.1:3235.');}
  if(url.username||url.password||url.search||url.hash||url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)))throw Error('Use HTTPS remotely, or HTTP on localhost, without a key or query in the address.');
  const prior=connection(),sameOrigin=prior&&new URL(prior.baseURL).origin===url.origin;let ref=sameOrigin?prior.credentialRef:undefined;
  const secret=$('voice-key').value;
  if(secret){const result=await bridge.credentialSave({provider:kind(),url:baseURL,secret,persist:!$('voice-key-session').checked});current(stamp);if(!result.ok)throw Error(result.error);ref=result.credential.ref;$('voice-key').value='';}
  if(hosted()&&!ref)throw Error('Enter your own '+providers[kind()].label+' API key first.');
  await policy(stamp);
  const result=await bridge.voiceConnections('save',{...(prior?.baseURL===baseURL.replace(/\/+$/,'')?{id:prior.id}:{}),provider:kind(),baseURL,...(ref?{credentialRef:ref}:{})});current(stamp);if(!result.ok)throw Error(result.error);
  selected=result.result.id;connections=connections.filter(item=>item.id!==selected).concat(result.result);$('voice-connection-row').hidden=false;const id=selected;connectionChoices();selected=id;$('voice-connection').value=id;await keyStatus(stamp);
  // A verified replacement is committed before retiring a now-unreferenced old key.
  if(prior?.credentialRef&&ref!==prior.credentialRef&&!connections.some(item=>item.credentialRef===prior.credentialRef))await bridge.credentialRemove(prior.credentialRef);
  current(stamp);note('Finding available voices… No speech is generated.');
  const inspected=await bridge.voiceHealth(undefined,{schemaVersion:1,provider:kind(),connectionId:selected});current(stamp);
  if(!inspected.ok)throw Error(inspected.error);
  const data=inspected.health;cache.set(selected,{voices:data.voices||[],models:data.models||[]});
  const before={model:$('voice-model').value,momotamu:$('voice-momotamu').value,vivi:$('voice-vivi').value};fillVoices();
  for(const [field,value] of Object.entries(before)){const el=$(field==='model'?'voice-model':'voice-'+field);if([...el.options].some(option=>option.value===value))el.value=value;}
  $('voice-connection-details').open=false;$('voice-connection-summary').textContent='Manage connection';
  note(data.voices?.length?'Connected. Choose a voice for each companion, then preview or save.':'Connected, but no voices are available. Check your provider account.','success');
 }
 async function preview(actor,output){
  if(pending||previewing||getBusy()){note('Finish or stop the current audio or operation first.','error');return {ok:false,error:'Another operation is active.'};}
  if(kind()==='off'||!validRoute()){note('Check the connection and choose the companion voices first.','error');return {ok:false,error:'Voice setup is incomplete.'};}
  if(requiresRemote()&&!$('voice-remote-allow').checked){note('Allow remote voice connections before previewing.','error');return {ok:false,error:'Remote voices are blocked.'};}
  const stamp=revision;previewing=true;paint();note('Playing '+(actor==='vivi'?'Vivi':'Momotamu')+'…');
  try{const result=await onPreview({actor,voiceRoute:route(),baseURL:$('cfg-voice-url').value.trim(),language:$('cfg-voice-language').value,output:output||{mode:$('voice-output-mode').value,deviceId:$('voice-output-device').value}});if(stamp===revision)note(result.ok?'Preview finished. Save when you’re happy with the selection.':result.cancelled?'Preview stopped.':result.error||'Preview did not finish.',result.ok?'success':'idle');return result;}
  catch(error){if(stamp===revision)note(error.message,'error');return {ok:false,error:error.message};}
  finally{if(stamp===revision){previewing=false;paint();}}
 }
 $('voice-provider').onchange=()=>void changeProvider();$('voice-connection').onchange=()=>void action(stamp=>selectConnection(stamp));
 $('voice-connect').onclick=()=>void action(connect);
 for(const id of ['voice-server','voice-key'])$(id).addEventListener('input',()=>{paint();note('Check the updated connection before saving or previewing.');});
 for(const id of ['voice-model','voice-momotamu','voice-vivi'])$(id).onchange=paint;
 $('voice-remote-allow').onchange=()=>{$('voice-local-only').checked=!$('voice-remote-allow').checked;paint();};$('voice-local-only').onchange=()=>{$('voice-remote-allow').checked=!$('voice-local-only').checked;paint();};
 $('voice-preview-momotamu').onclick=()=>void preview('momotamu');$('voice-preview-vivi').onclick=()=>void preview('vivi');$('voice-preview-stop').onclick=()=>{onStop();note('Stopping preview…');};
 $('voice-key-remove').onclick=()=>void action(async stamp=>{const prior=connection(),ref=prior?.credentialRef;if(!ref)return;const removed=await bridge.credentialRemove(ref);current(stamp);if(!removed.ok)throw Error(removed.error);credentialOK=!hosted();const updated=await bridge.voiceConnections('save',{id:prior.id,provider:prior.provider,baseURL:prior.baseURL});current(stamp);if(!updated.ok)throw Error(updated.error);connections=connections.map(item=>item.id===prior.id?updated.result:item);credentialOK=!hosted();cache.delete(selected);$('voice-key-status').textContent='Key removed. Enter a replacement to reconnect.';note('Key removed from this app. Revoke it at the provider to invalidate it there.');});
 $('voice-save').onclick=()=>void action(async stamp=>{
  if(!validRoute())throw Error('Complete the provider and voice selection first.');
  if(requiresRemote()&&!$('voice-remote-allow').checked)throw Error('Remote voice connections are blocked.');
  const voiceOutputMode=$('voice-output-mode').value,voiceOutputDevice=$('voice-output-device').value;if(voiceOutputMode==='meeting'&&!voiceOutputDevice)throw Error('Choose an installed meeting output device under Playback.');
  const selectedRoute=kind()==='off'?getSettings().voiceRoute:route();let voiceURL=getSettings().voiceURL;
  if(kind()==='voxcpm2'){voiceURL=$('cfg-voice-url').value.trim();let url;try{url=new URL(voiceURL);}catch{throw Error('Enter a complete local VoiceGen server address.');}if(!['http:','https:'].includes(url.protocol)||!['localhost','127.0.0.1','[::1]'].includes(url.hostname)||url.username||url.password||url.search||url.hash||url.pathname!=='/')throw Error('Use a local VoiceGen address without credentials, a query or a path.');}
  const label=field=>{const el=$(field);return el.value?{id:el.value,label:el.selectedOptions[0].textContent}:undefined;};
  const voiceLabels=external()?{connectionId:selected,model:label('voice-model'),momotamu:label('voice-momotamu'),vivi:label('voice-vivi')}:getSettings().voiceLabels;
  await policy(stamp);
  await onSave({voiceRoute:selectedRoute,voiceLabels,voiceDisabled:kind()==='off',voiceSpeechDeferred:false,voiceURL,voiceReplyLanguage:$('cfg-voice-language').value,voiceOutputMode,voiceOutputDevice});current(stamp);note(kind()==='off'?'Text only saved. No speech will be generated.':providers[kind()].label+' saved. New replies will be spoken.','success');
 });
 for(const [id,fn,name] of [['btn-start-voice',onLocalStart,'start'],['voice-warm',onLocalWarm,'warm'],['btn-check-voice',onLocalCheck,'check']])$(id).onclick=()=>void action(async()=>{localJob=name;paint();try{const result=await fn();if(result?.ok===false)throw Error(result.error);note(name==='warm'?'Local voice warmed up.':name==='start'?'Local voice started.':'Local voice status checked.','success');}finally{localJob='';}});
 $('btn-stop-voice').onclick=async()=>{try{if(getBusy()&&localJob!=='warm')throw Error('Finish or stop playback before stopping the local engine.');const result=await onLocalStop();note(result?.ok===false?result.error:'Local voice stopped.');}catch(error){note(error.message,'error');}};
 async function open(){const stamp=++revision;pending=true;previewing=false;const settings=getSettings();$('voice-provider').value=settings.voiceDisabled?'off':providers[settings.voiceRoute?.provider]?settings.voiceRoute.provider:'voxcpm2';$('voice-key').value='';$('cfg-voice-url').value=settings.voiceURL||'http://127.0.0.1:3234';$('cfg-voice-language').value=window.DiscussionVoiceLanguage?.resolve(settings.voiceReplyLanguage)||'English';$('voice-setup-body').scrollTop=0;$('voice-playback-options').open=false;note('Save to use these voices.');paint();
  try{if(!bridge)return;const result=await bridge.voiceConnections('list');current(stamp);if(!result.ok)throw Error(result.error);connections=result.result.connections;$('voice-local-only').checked=result.result.localOnly;$('voice-remote-allow').checked=!result.result.localOnly;connectionChoices();await selectConnection(stamp);current(stamp);}catch(error){if(stamp===revision)note(error.message,'error');}finally{if(stamp===revision){pending=false;paint();}}
 }
 panel.addEventListener('voice-settings-open',()=>void open());panel.addEventListener('close',()=>{revision++;if(previewing)onStop();pending=false;previewing=false;$('voice-key').value='';});
 paint();return {preview,open,canPreview:()=>!!bridge&&kind()!=='off'&&!pending&&!previewing&&!getBusy()&&validRoute()&&(!requiresRemote()||$('voice-remote-allow').checked),get busy(){return pending||previewing;}};
};})();
