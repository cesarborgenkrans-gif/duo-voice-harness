'use strict';
// Real Electron rendering at simulated view sizes; no model loading or paid APIs.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {_electron}=require('playwright');
const root=path.resolve(__dirname,'..');
async function run(){
 const output=path.join(root,'artifacts','interface-smoke-'+randomUUID());await fs.mkdir(output,{recursive:true});
 const env={...process.env,DUO_VOICE_DATA_ROOT:path.join(output,'data'),DUO_VOICE_SESSION_ROOT:path.join(output,'sessions')};delete env.ELECTRON_RUN_AS_NODE;
 let app,page;const errors=[],failedFiles=[],report={passed:false,checks:[],views:[],output};
 try{
  app=await _electron.launch({executablePath:require('electron'),cwd:root,args:['.','--windowed'],env,timeout:30000});page=await app.firstWindow();
  page.on('pageerror',e=>errors.push(e.stack));page.on('requestfailed',r=>{if(r.url().startsWith('file:'))failedFiles.push(r.url());});
  await page.waitForFunction(()=>window.DiscussionSmoothMotion&&window.DiscussionSprites&&document.querySelector('.input-methods'));
  assert.equal(await page.locator('#input-methods-src-input .input-talk').textContent(),'🎙 Hold to talk','Microphone label retains its UTF-8 icon and text');
  await page.evaluate(()=>{document.querySelector('#log').innerHTML='<article class="msg user"><div class="msg-name">You</div><div class="msg-body">Can you help me think through this idea?</div></article><article class="msg momotamu"><div class="msg-name">Momotamu</div><div class="msg-body">Let’s take it one step at a time. What would you like to explore first?</div></article><article class="msg vivi"><div class="msg-name">Vivi</div><div class="msg-body">I’m listening. We can make room for both the details and the bigger picture.</div></article>';});
  for(const size of [{width:1440,height:2560},{width:800,height:1280}]){
   await page.setViewportSize(size);
   await page.evaluate(()=>{document.body.dataset.windowMode='panel';});
   await page.waitForFunction(()=>['activities-toggle','view-toggle','gear'].every(id=>document.getElementById(id).getBoundingClientRect().height>=60));
   const metrics=await page.evaluate(()=>{
    const box=s=>{const r=document.querySelector(s).getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom};};
    return{viewport:{width:innerWidth,height:innerHeight},stage:box('.stage'),composer:box('.app>.console'),input:box('#src-input'),send:box('#btn-run'),tray:box('#composer-controls'),
     controls:['#activities-toggle','#view-toggle','#gear'].map(s=>({selector:s,...box(s)})),
     messageFont:parseFloat(getComputedStyle(document.querySelector('.msg-body')).fontSize),
     cursor:getComputedStyle(document.querySelector('#src-input')).cursor,
     horizontalOverflow:document.documentElement.scrollWidth>innerWidth,
     consoleScroll:document.querySelector('.app>.console').scrollHeight>document.querySelector('.app>.console').clientHeight,
     trayScroll:document.getElementById('composer-controls').scrollHeight>document.getElementById('composer-controls').clientHeight};
   });
   report.views.push(metrics);
   assert.ok(metrics.stage.height>=150&&metrics.stage.height<=300.5,'The cast has the enlarged platform');
   assert.ok(metrics.composer.height/metrics.viewport.height>=.20-.002,'Composer receives at least twenty percent');
   assert.ok(metrics.messageFont>=28,'Side messages are readable');
   assert.ok(metrics.controls.every(c=>c.height>=60),'Side menu buttons have large targets');
   assert.match(metrics.cursor,/cursor-side\.svg/);assert.equal(metrics.horizontalOverflow,false);
   assert.ok(metrics.send.bottom<=metrics.composer.bottom,'Send remains visible without scrolling the input panel');
   assert.equal(metrics.consoleScroll,false,'Default input controls fit without internal scrolling');
   assert.ok(metrics.tray.height<=92&&metrics.tray.height>=72&&metrics.trayScroll,'One scrolling control row plus the fixed Send row keeps the total near two');
   const scrolled=await page.evaluate(()=>{const tray=document.getElementById('composer-controls');const y=document.getElementById('src-input').getBoundingClientRect().y;tray.scrollTop=tray.scrollHeight;return{scrolled:tray.scrollTop>0,inputY:document.getElementById('src-input').getBoundingClientRect().y,priorY:y,sendParent:document.getElementById('btn-run').parentElement.id};});
   assert.equal(scrolled.scrolled,true);assert.equal(scrolled.inputY,scrolled.priorY);assert.equal(scrolled.sendParent,'composer-submit');
   await page.screenshot({path:path.join(output,`side-controls-scrolled-${size.width}.png`)});
   await page.locator('#conversation-options').evaluate(el=>{el.open=true;});
   const fixed=await page.evaluate(()=>({input:document.getElementById('src-input').getBoundingClientRect().y,send:document.getElementById('btn-run').getBoundingClientRect().bottom}));assert.equal(fixed.input,metrics.input.y);assert.equal(fixed.send,metrics.send.bottom);
   await page.locator('#conversation-options').evaluate(el=>{el.open=false;});await page.locator('#composer-controls').evaluate(el=>{el.scrollTop=0;});
   await page.screenshot({path:path.join(output,`side-${size.width}x${size.height}.png`)});
   await page.locator('#view-toggle').click();assert.equal(await page.locator('#view-menu').evaluate(el=>el.matches(':popover-open')),true);
   await page.waitForFunction(()=>{const r=document.getElementById('view-menu').getBoundingClientRect();return r.x>=0&&r.y>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1;});
   const menu=await page.locator('#view-menu').boundingBox();assert.ok(menu.x>=0&&menu.y>=0&&menu.x+menu.width<=size.width+1&&menu.y+menu.height<=size.height+1,'View menu stays on screen');
   await page.screenshot({path:path.join(output,`side-menu-${size.width}.png`)});await page.locator('#view-toggle').click();
  }
  report.checks.push('roomy cast, fixed composer/Send, one scrolling control row plus Send, menu targets, message size, cursor and popup reachability');
  const anchors=await page.evaluate(async()=>{
   const motion=window.DiscussionSmoothMotion,actor=window.DiscussionSpriteActions.actors.vivi;
   const actions=[...new Map(actor.actions.map(a=>[a.sheet,a])).values()];const frames=[];
   const measure=canvas=>{const {data,width,height}=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height);let bottom=-1;for(let y=height-1;y>=0&&bottom<0;y--)for(let x=0;x<width;x++)if(data[(y*width+x)*4+3]>=128){bottom=y;break;}let left=width,right=-1;for(let y=bottom-22;y<=bottom;y++)for(let x=0;x<width;x++)if(data[(y*width+x)*4+3]>=128){left=Math.min(left,x);right=Math.max(right,x);}return{x:(left+right+1)/2,y:bottom};};
   for(const action of actions){const image=new Image();image.src=action.sheet;await image.decode();for(let frame=0;frame<8;frame++){const pose=motion.pose(image,action,frame);frames.push({sheet:action.sheet,frame,...measure(pose.canvas)});}}
   const action=actions[0],image=new Image();image.src=action.sheet;await image.decode();const canvas=document.createElement('canvas');canvas.width=384;canvas.height=512;const painter=motion.createPainter(canvas);painter.setPose(image,action,0);painter.draw({moving:false});const before=Array.from(canvas.getContext('2d').getImageData(0,360,384,152).data);painter.setSquish(.03);painter.advance(1100);const after=Array.from(canvas.getContext('2d').getImageData(0,360,384,152).data);
   const changedRows=[...new Set(before.flatMap((v,i)=>v===after[i]?[]:[360+Math.floor(i/(384*4))]))];
   let maxAlphaDelta=0,maxColorDelta=0,opaqueChanges=0;for(let i=0;i<before.length;i++){const d=Math.abs(before[i]-after[i]);if(i%4===3)maxAlphaDelta=Math.max(maxAlphaDelta,d);else maxColorDelta=Math.max(maxColorDelta,d);if(d&&before[i-i%4+3]===255)opaqueChanges++;}
   // Drawing a cropped canvas region can round translucent GPU color channels
   // by one level. Alpha and opaque foot pixels must remain exactly unchanged.
   return{frames,lowerBodyStable:maxAlphaDelta===0&&opaqueChanges===0&&maxColorDelta<=1,changedRows,maxAlphaDelta,maxColorDelta,opaqueChanges};
  });
  report.anchors=anchors;assert.ok(anchors.frames.every(f=>Math.abs(f.x-192)<=1.5&&Math.abs(f.y-465)<=1.5),'Every Vivi frame has a stable sole anchor');assert.equal(anchors.lowerBodyStable,true,'Changed lower-body rows: '+anchors.changedRows.join(','));
  report.checks.push('all forty Vivi frames share the sole anchor; motion leaves lower-body pixels planted');
  const cursorSize=await page.evaluate(async()=>{const image=new Image();image.src='assets/cursor-side.svg';await image.decode();return[image.naturalWidth,image.naturalHeight];});assert.deepEqual(cursorSize,[96,96]);report.cursorSize=cursorSize;
  const facing=await page.evaluate(async()=>{
   const sprites=window.DiscussionSprites,canvas=document.getElementById('vivi-sprite');
   sprites.setSoloActor('vivi');await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);const solo=canvas.dataset.spriteFacing;
   void sprites.setSubagentActive(true,'vivi');void sprites.lifecycle('speaking',{actor:'vivi',audioDriven:true});
   await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);const duo=canvas.dataset.spriteFacing;
   sprites.cancel('vivi','interface-check');sprites.settle('vivi','side-listen');return{solo,duo};
  });assert.deepEqual(facing,{solo:'front',duo:'left'});report.facing=facing;
  const scrollColor=await page.locator('#composer-controls').evaluate(el=>getComputedStyle(el).scrollbarColor);
  await page.waitForFunction(before=>getComputedStyle(document.getElementById('composer-controls')).scrollbarColor!==before,scrollColor);report.checks.push('scrollbar color animates; expanded controls keep writing and Send fixed');
  await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await page.locator('#composer-controls').evaluate(el=>getComputedStyle(el).animationName),'none');await page.emulateMedia({reducedMotion:'no-preference'});
  for(const mode of ['main','free']){await page.setViewportSize({width:1160,height:900});await page.evaluate(mode=>{document.body.dataset.windowMode=mode;},mode);await page.waitForFunction(()=>document.getElementById('btn-run').parentElement.classList.contains('composer-actions'));await page.screenshot({path:path.join(output,mode+'.png')});const stage=await page.locator('.stage').boundingBox();assert.ok(stage.height>100,'Regular views retain their existing character platform');}
  report.checks.push('Monitor and Free form keep their existing layout');
  assert.deepEqual(errors,[]);assert.deepEqual(failedFiles,[]);report.passed=true;console.log('INTERFACE SMOKE PASS');
 }catch(error){report.error=error.stack;if(page)await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});throw error;}
 finally{report.rendererErrors=errors;report.failedFiles=failedFiles;await app?.close();await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(path.join(output,'report.json'));}
}
if(require.main===module)run().catch(error=>{console.error(error);process.exitCode=1;});
