'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),{createHash,randomUUID}=require('node:crypto'),I=require('./image-model');
const digest=b=>createHash('sha256').update(b).digest('hex');
function header(b){
  if(b.length>=24&&b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return {mime:'image/png',width:b.readUInt32BE(16),height:b.readUInt32BE(20),orientation:1};
  if(b.length>=30&&b.toString('ascii',0,4)==='RIFF'&&b.toString('ascii',8,12)==='WEBP'){
    const kind=b.toString('ascii',12,16);if(kind==='VP8X')return {mime:'image/webp',width:b.readUIntLE(24,3)+1,height:b.readUIntLE(27,3)+1,orientation:1};
    if(kind==='VP8L'&&b[20]===47){const v=b.readUInt32LE(21);return {mime:'image/webp',width:(v&16383)+1,height:((v>>>14)&16383)+1,orientation:1};}
    if(kind==='VP8 '&&b[23]===157&&b[24]===1&&b[25]===42)return {mime:'image/webp',width:b.readUInt16LE(26)&16383,height:b.readUInt16LE(28)&16383,orientation:1};
  }
  if(b[0]===255&&b[1]===216){let pos=2,orientation=1,dimensions;while(pos+4<=b.length){if(b[pos++]!==255)break;while(b[pos]===255)pos++;const marker=b[pos++];if(marker===218||marker===217)break;const length=b.readUInt16BE(pos);if(length<2||pos+length>b.length)break;
    if(marker===225&&b.toString('ascii',pos+2,pos+8)==='Exif\0\0'){try{const start=pos+8,little=b.toString('ascii',start,start+2)==='II',u16=x=>little?b.readUInt16LE(x):b.readUInt16BE(x),u32=x=>little?b.readUInt32LE(x):b.readUInt32BE(x),ifd=start+u32(start+4),count=u16(ifd);for(let j=0;j<count;j++){const e=ifd+2+j*12;if(u16(e)===274)orientation=u16(e+8);}}catch{throw new Error('Invalid image orientation metadata.');}}
    if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker))dimensions={width:b.readUInt16BE(pos+5),height:b.readUInt16BE(pos+3)};pos+=length;
  }if(dimensions)return {mime:'image/jpeg',...dimensions,orientation};}
  throw new Error('Use a valid PNG, JPEG, or WebP image.');
}
function orient(image,orientation,nativeImage){
  if(orientation===1)return image;if(orientation<1||orientation>8)throw new Error('Invalid image orientation.');
  const {width:w,height:h}=image.getSize(),swapped=orientation>=5,W=swapped?h:w,H=swapped?w:h,input=image.toBitmap(),output=Buffer.alloc(input.length);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){let X=x,Y=y;switch(orientation){case 2:X=w-1-x;break;case 3:X=w-1-x;Y=h-1-y;break;case 4:Y=h-1-y;break;case 5:X=y;Y=x;break;case 6:X=h-1-y;Y=x;break;case 7:X=h-1-y;Y=w-1-x;break;case 8:X=y;Y=w-1-x;break;}input.copy(output,(Y*W+X)*4,(y*w+x)*4,(y*w+x)*4+4);}
  return nativeImage.createFromBitmap(output,{width:W,height:H});
}
class ImageStore {
  constructor(nativeImage){this.nativeImage=nativeImage;}
  async import(folder,file){
    const stat=await fs.stat(file);if(!stat.isFile()||stat.size>16*1024*1024||stat.size===0)throw new Error('Choose an image smaller than 16 MiB.');
    const original=await fs.readFile(file);if(original.length>16*1024*1024)throw new Error('Image exceeds 16 MiB.');const info=header(original);
    if(!info.width||!info.height||info.width*info.height>40000000)throw new Error('Image exceeds 40 megapixels.');
    let image=this.nativeImage.createFromBuffer(original);
    if(image.isEmpty()&&info.mime==='image/webp'){
      const {BrowserWindow}=require('electron'),decoder=new BrowserWindow({show:false,width:1,height:1,webPreferences:{sandbox:true,nodeIntegration:false,contextIsolation:true}});
      try{await decoder.loadURL('data:text/html,<meta charset="utf-8"><title>Image decoder</title>');
        const url=await decoder.webContents.executeJavaScript(`new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>{const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;canvas.getContext('2d').drawImage(image,0,0);resolve(canvas.toDataURL('image/png'));};image.onerror=()=>reject(new Error('WebP image could not be decoded'));image.src=${JSON.stringify('data:image/webp;base64,'+original.toString('base64'))};})`);
        image=this.nativeImage.createFromDataURL(url);
      }finally{decoder.destroy();}
    }
    if(image.isEmpty())throw new Error('Image could not be decoded.');
    image=orient(image,info.orientation,this.nativeImage);let {width,height}=image.getSize();if(width*height>40000000)throw new Error('Image exceeds 40 megapixels.');
    const factor=Math.min(1,2048/Math.max(width,height));if(factor<1)image=image.resize({width:Math.max(1,Math.round(width*factor)),height:Math.max(1,Math.round(height*factor)),quality:'best'});
    let normalized=image.toPNG();while(normalized.length>4*1024*1024&&image.getSize().width>256){image=image.resize({width:Math.round(image.getSize().width*.8),quality:'best'});normalized=image.toPNG();}
    if(normalized.length>4*1024*1024)throw new Error('Image could not fit the vision input limit.');
    const size=image.getSize(),asset=I.asset({id:randomUUID(),name:path.basename(file).slice(0,240),originalMime:info.mime,mime:'image/png',hash:digest(normalized),originalHash:digest(original),width:size.width,height:size.height,originalWidth:info.width,originalHeight:info.height,bytes:normalized.length,originalBytes:original.length,transformed:factor<1||info.orientation!==1||size.width!==width||size.height!==height});
    const dir=path.join(folder,'images');await fs.mkdir(dir,{recursive:true});for(const [suffix,data]of [['original',original],['input.png',normalized],['thumbnail.png',image.resize({width:80,quality:'good'}).toPNG()]])await fs.writeFile(path.join(dir,asset.id+'.'+suffix),data,{flag:'wx'});
    return asset;
  }
  async read(folder,asset,variant='input'){
    I.asset(asset);if(!['input','original','thumbnail'].includes(variant))throw new Error('Invalid image variant.');
    const suffix=variant==='original'?'original':variant==='thumbnail'?'thumbnail.png':'input.png';const file=path.join(folder,'images',asset.id+'.'+suffix);
    const stat=await fs.stat(file);if(stat.size>(variant==='original'?16:4)*1024*1024)throw new Error('Saved image exceeds limit.');const data=await fs.readFile(file);
    if(variant!=='thumbnail'&&digest(data)!==(variant==='original'?asset.originalHash:asset.hash))throw new Error('Saved image changed or is unavailable.');
    return {asset,dataUrl:`data:${variant==='original'?asset.originalMime:asset.mime};base64,${data.toString('base64')}`};
  }
}
module.exports={ImageStore,header,orient};
