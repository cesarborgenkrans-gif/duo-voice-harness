'use strict';
const fs=require('node:fs/promises'),path=require('node:path');
const MAX_CHARACTERS=12000,MAX_BYTES=64*1024,MAX_LINES=400;
function validateSource(value){
 if(typeof value?.text==='string')value={...value,text:value.text.replace(/\r\n?/g,'\n')};
 if(!value||typeof value.name!=='string'||!value.name.trim()||value.name.length>120||/[\x00-\x1f]/.test(value.name)||typeof value.text!=='string'||!value.text.trim()||value.text.length>MAX_CHARACTERS||Buffer.byteLength(value.text)>MAX_BYTES||value.text.split('\n').length>MAX_LINES||value.text.includes('\0')||!value.text.isWellFormed()||!['document-only','general'].includes(value.policy))throw Error('Use nonempty UTF-8 text: at most 12,000 characters, 400 lines and 64 KiB, with a name and document mode.');
 return {name:value.name.trim(),text:value.text.replace(/\r\n?/g,'\n'),policy:value.policy};
}
async function readTextSource(filename){
 if(typeof filename!=='string'||!['.txt','.md','.markdown'].includes(path.extname(filename).toLowerCase()))throw Error('Choose a UTF-8 .txt or Markdown file. PDF import is not supported; export its text first.');
 const handle=await fs.open(filename,'r');
 try{
  const stat=await handle.stat();if(!stat.isFile()||stat.size>MAX_BYTES)throw Error('Choose a text file of at most 64 KiB.');
  const bytes=Buffer.alloc(MAX_BYTES+1);let used=0;
  while(used<bytes.length){const part=await handle.read(bytes,used,bytes.length-used,used);if(!part.bytesRead)break;used+=part.bytesRead;}
  if(used>MAX_BYTES)throw Error('This file grew beyond 64 KiB.');
  let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,used));}catch{throw Error('Save this document as UTF-8 text before attaching it.');}
  return validateSource({name:path.basename(filename).slice(0,120),text,policy:'document-only'});
 }finally{await handle.close();}
}
module.exports={validateSource,readTextSource,MAX_CHARACTERS,MAX_BYTES,MAX_LINES};
