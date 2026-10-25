'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {connectionPolicy}=require('./connection-policy');
const REF=/^credential-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function createCredentialStore({root,safeStorage,platform=process.platform}){
  const sessions=new Map(),known=new Set(),operations=new Map();
  const file=id=>{if(!REF.test(id||''))throw Error('Invalid credential reference.');return path.join(root,id+'.json');};
  const metadata=item=>({ref:item.ref,provider:item.provider,origin:item.origin,mode:item.mode});
  function locked(ref,action){file(ref);const operation=(operations.get(ref)||Promise.resolve()).catch(()=>{}).then(action);operations.set(ref,operation);return operation.finally(()=>{if(operations.get(ref)===operation)operations.delete(ref);});}
  async function available(){try{return (platform!=='linux'||!['basic_text','unknown'].includes(safeStorage.getSelectedStorageBackend()))&&await safeStorage.isAsyncEncryptionAvailable();}catch{return false;}}
  async function disk(item){
    await fs.mkdir(root,{recursive:true});const target=file(item.ref),temporary=target+'.'+randomUUID()+'.tmp';
    try{await fs.writeFile(temporary,JSON.stringify(item),{encoding:'utf8',mode:0o600,flag:'wx'});await fs.rename(temporary,target);}finally{await fs.unlink(temporary).catch(()=>{});}
  }
  async function read(ref){
    if(sessions.has(ref))return sessions.get(ref);
    let item;try{item=JSON.parse(await fs.readFile(file(ref),'utf8'));}catch{throw Error('This credential is unavailable. Enter the key again in Settings.');}
    if(item.schemaVersion!==1||item.ref!==ref||typeof item.ciphertext!=='string'||item.mode!=='protected')throw Error('The protected credential record is invalid.');
    return item;
  }
  async function save({provider,url,secret,persist=true}){
    const binding=connectionPolicy({provider,url});
    if(typeof secret!=='string'||!secret.trim()||secret.length>8192||/[\r\n\0]/.test(secret)||typeof persist!=='boolean')throw Error('Enter a valid API key and storage choice.');
    known.add(secret);
    const item={schemaVersion:1,ref:'credential-'+randomUUID(),provider:binding.provider,origin:binding.origin,mode:persist?'protected':'session'};
    if(!persist){sessions.set(item.ref,{...item,secret});return metadata(item);}
    if(!await available())throw Error('Protected storage is unavailable. Select session-only storage to continue without saving the key to disk.');
    try{
      const protectedValue=JSON.stringify({...item,secret});
      item.ciphertext=(await safeStorage.encryptStringAsync(protectedValue)).toString('base64');
      await disk(item);
      const saved=await read(item.ref),verified=await safeStorage.decryptStringAsync(Buffer.from(saved.ciphertext,'base64'));
      if(verified.result!==protectedValue)throw Error('verification');
      return metadata(item);
    }catch{await fs.unlink(file(item.ref)).catch(()=>{});throw Error('The key could not be protected and verified. Existing credentials were preserved.');}
  }
  async function resolve(ref,{provider,url}){
    return locked(ref,async()=>{
    const binding=connectionPolicy({provider,url}),item=await read(ref);
    if(item.provider!==binding.provider||item.origin!==binding.origin)throw Error('This key belongs to another provider or origin. Save a key for this connection.');
    if(item.mode==='session'){known.add(item.secret);return item.secret;}
    if(!await available())throw Error('Protected storage is unavailable. Enter a session-only key or restore OS credential protection.');
    try{
      const decrypted=await safeStorage.decryptStringAsync(Buffer.from(item.ciphertext,'base64'));
      const protectedValue=JSON.parse(decrypted.result);
      if(protectedValue.ref!==item.ref||protectedValue.provider!==item.provider||protectedValue.origin!==item.origin||typeof protectedValue.secret!=='string')throw Error('binding');
      known.add(protectedValue.secret);
      if(decrypted.shouldReEncrypt){item.ciphertext=(await safeStorage.encryptStringAsync(decrypted.result)).toString('base64');await disk(item);}
      return protectedValue.secret;
    }catch{throw Error('The saved key could not be decrypted. Replace it in Settings.');}
    });
  }
  async function remove(ref){return locked(ref,async()=>{sessions.delete(ref);await fs.unlink(file(ref)).catch(error=>{if(error.code!=='ENOENT')throw Error('The saved key could not be removed.');});return {ok:true};});}
  function redact(value){let result=String(value??'');for(const secret of known)result=result.split(secret).join('[redacted]');return result.replace(/(Bearer\s+)[^\s"',}]+/gi,'$1[redacted]');}
  return {save,resolve,remove,available,redact,status:async ref=>metadata(await read(ref)),clearSession:()=>sessions.clear()};
}
module.exports={createCredentialStore};
