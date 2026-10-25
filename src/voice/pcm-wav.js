'use strict';
function wav(pcm,rate){const h=Buffer.alloc(44);h.write('RIFF');h.writeUInt32LE(36+pcm.length,4);h.write('WAVE',8);h.write('fmt ',12);h.writeUInt32LE(16,16);h.writeUInt16LE(1,20);h.writeUInt16LE(1,22);h.writeUInt32LE(rate,24);h.writeUInt32LE(rate*2,28);h.writeUInt16LE(2,32);h.writeUInt16LE(16,34);h.write('data',36);h.writeUInt32LE(pcm.length,40);return Buffer.concat([h,pcm]);}

function decodeWav(value,{maxBytes=64*1024*1024}={}){
  const bytes=Buffer.isBuffer(value)?value:Buffer.from(value);
  if(bytes.length<44||bytes.length>maxBytes||bytes.toString('ascii',0,4)!=='RIFF'||bytes.toString('ascii',8,12)!=='WAVE'||bytes.readUInt32LE(4)!==bytes.length-8)throw Error('DIY voice returned an invalid or oversized WAV.');
  let rate,pcm;
  for(let offset=12;offset<bytes.length;){
    if(offset+8>bytes.length)throw Error('DIY voice returned a truncated WAV chunk.');
    const kind=bytes.toString('ascii',offset,offset+4),size=bytes.readUInt32LE(offset+4),end=offset+8+size;
    if(end+(size%2)>bytes.length)throw Error('DIY voice returned a truncated WAV chunk.');
    if(kind==='fmt '){
      if(rate||size<16||bytes.readUInt16LE(offset+8)!==1||bytes.readUInt16LE(offset+10)!==1||bytes.readUInt16LE(offset+22)!==16||bytes.readUInt16LE(offset+20)!==2)throw Error('DIY WAV must contain mono, 16-bit integer PCM.');
      rate=bytes.readUInt32LE(offset+12);
      if(rate<8000||rate>96000||bytes.readUInt32LE(offset+16)!==rate*2)throw Error('DIY WAV has an unsupported sample rate or byte rate.');
    }else if(kind==='data'){
      if(pcm||!size||size%2)throw Error('DIY WAV has invalid or duplicate audio data.');
      pcm=bytes.subarray(offset+8,end);
    }
    offset=end+size%2;
  }
  if(!rate||!pcm||pcm.length>rate*2*600)throw Error('DIY WAV has missing audio or exceeds ten minutes.');
  return {pcm,sampleRate:rate};
}
module.exports={wav,decodeWav};
