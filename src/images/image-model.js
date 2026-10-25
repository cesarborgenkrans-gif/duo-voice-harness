/* Rule: shared view follows immutable foreground request identity, not selection. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.DiscussionImages=api;})(globalThis,()=>{
  const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  function asset(a){
    if(!a||!UUID.test(a.id)||typeof a.name!=='string'||!a.name||a.name.length>240||!['image/png','image/jpeg','image/webp'].includes(a.originalMime)||a.mime!=='image/png'||!['hash','originalHash'].every(k=>/^[a-f0-9]{64}$/.test(a[k]))||!['width','height','originalWidth','originalHeight','bytes','originalBytes'].every(k=>Number.isSafeInteger(a[k])&&a[k]>0)||a.width>2048||a.height>2048||a.bytes>4*1024*1024||a.originalBytes>16*1024*1024||a.originalWidth*a.originalHeight>40000000)throw new Error('Invalid image asset.');
    return {id:a.id,name:a.name,originalMime:a.originalMime,mime:a.mime,hash:a.hash,originalHash:a.originalHash,width:a.width,height:a.height,originalWidth:a.originalWidth,originalHeight:a.originalHeight,bytes:a.bytes,originalBytes:a.originalBytes,transformed:!!a.transformed};
  }
  function validate(s){
    const assets=s.images||[];if(!Array.isArray(assets)||assets.length>200)throw new Error('Too many saved images.');const ids=new Set();for(const a of assets){asset(a);if(ids.has(a.id))throw new Error('Duplicate image identity.');ids.add(a.id);}if(s.imageReference&&!ids.has(s.imageReference))throw new Error('Missing shared image.');
    for(const e of s.entries||[])if(e.imageIds&&(!Array.isArray(e.imageIds)||e.imageIds.length>1||e.imageIds.some(id=>!ids.has(id))))throw new Error('Missing turn image.');
    if(s.imageUses&&(!Array.isArray(s.imageUses)||s.imageUses.length>10000))throw new Error('Invalid image history.');
    for(const u of s.imageUses||[]){
      if(!/^[\w-]{6,120}$/.test(u.requestId)||!ids.has(u.imageId)||![...s.participants,...(s.participantHistory||[])].includes(u.participant)||!['complete','cancelled','failed'].includes(u.status)||!Number.isFinite(Date.parse(u.at)))throw new Error('Invalid image use.');
      if(u.focus){const f=u.focus;if(u.status!=='complete'||!['complete','empty','unavailable','cancelled'].includes(f.status)||!Number.isFinite(Date.parse(f.at))||!Array.isArray(f.regions)||f.regions.length>3||(f.status==='complete')!==!!f.regions.length||f.message!==undefined&&(typeof f.message!=='string'||f.message.length>240))throw new Error('Invalid saved highlights.');for(const r of f.regions)if(!r||typeof r.label!=='string'||!r.label.trim()||r.label.length>80||typeof r.phrase!=='string'||!r.phrase.trim()||r.phrase.length>160||!Array.isArray(r.box_2d)||r.box_2d.length!==4||!r.box_2d.every(n=>Number.isInteger(n)&&n>=0&&n<=1000)||r.box_2d[0]>=r.box_2d[2]||r.box_2d[1]>=r.box_2d[3])throw new Error('Invalid saved highlight box.');}
    }
  }
  function tracker(){let sessionKey='',current=null,last=null;return {
    reset(key){if(sessionKey!==key){sessionKey=key;current=null;last=null;}},
    begin(packet){if(packet.sessionKey!==sessionKey)return false;current={...packet,phase:'sending'};return true;},
    update(packet){if(packet.sessionKey!==sessionKey||!current||packet.requestId!==current.requestId||packet.imageId!==current.imageId)return false;current={...current,...packet};if(['complete','failed','cancelled'].includes(packet.phase)){last=current;current=null;}return true;},
    get current(){return current;},get last(){return last;}
  };}
  return {asset,validate,tracker,UUID};
});
