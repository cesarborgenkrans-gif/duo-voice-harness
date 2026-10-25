'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {createHash}=require('node:crypto');
const root=path.resolve(__dirname,'..');
const report=JSON.parse(fs.readFileSync(path.join(root,'characters/vivi/registration.json'),'utf8'));
const context={window:{}};vm.runInNewContext(fs.readFileSync(path.join(root,'src/motion/sprite-actions.js'),'utf8'),context);
const actor=context.window.DiscussionSpriteActions.actors.vivi;
test('Vivi registration retains the measured source sheets and a single body scale',()=>{
 const scales=new Set();let count=0;
 for(const [name,sheet]of Object.entries(report.sheets)){
  assert.equal(createHash('sha256').update(fs.readFileSync(path.join(root,name))).digest('hex'),sheet.sha256);
  for(const frame of sheet.frames){scales.add(frame.scale);count++;}
 }
 assert.equal(scales.size,1);assert.equal(count,40);
});
test('every Vivi action plants the measured boot centre and sole on the shared anchor',()=>{
 for(const action of actor.actions)for(let i=0;i<8;i++){
  const r=action.registration[i],measured=report.sheets[action.sheet].frames[i];
  assert.equal(r.tx,measured.tx);assert.equal(r.ty,measured.ty);assert.equal(r.scale,measured.scale);
  assert.ok(Math.abs(measured.sourceFoot[0]*r.scale+r.tx-192)<1e-9);
  assert.ok(Math.abs(measured.sourceFoot[1]*r.scale+r.ty-465)<1e-9);
  const [l,t,right,bottom]=measured.outputAlphaBounds;assert.ok(l>=2&&t>=2&&right<=382&&bottom<=510,'Full alpha remains crop safe');
 }
});
