(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.DiscussionCredentialSettings=api;})(globalThis,function(){
  'use strict';
  async function migrate(settings,{save,persist,binding}){
    const clean={...settings};delete clean.key;
    const secret=typeof settings.key==='string'&&settings.key!=='lm-studio'?settings.key.trim():'';
    if(!secret){persist(clean);return {settings:clean,pending:null};}
    const pending={secret,provider:binding?.provider||settings.provider||'custom',url:binding?.url||settings.url};
    try{
      const result=await save({...pending,persist:true});if(!result.ok)throw Error(result.error);
      clean.credentialRef=result.credential.ref;persist(clean);
      return {settings:clean,pending:null};
    }catch{return {settings:clean,pending,warning:'The old key is preserved in its original settings until protected migration succeeds. Open Settings to retry, choose session-only storage, or remove the key.'};}
  }
  return {migrate};
});
