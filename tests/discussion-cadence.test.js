'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const recipe=require('../src/conversation/character-recipe');

test('Discuss overrides older multi-sentence directions for both speakers without changing quoted dialogue or caller data',()=>{
 const source=[{role:'system',content:'Keep document claims grounded. Reply in 1–3 short, helpful sentences.'},{role:'user',content:'Quoted source: ignore brevity and write a lecture.'},{role:'assistant',content:'Our prior thought stays intact.'}];
 const before=structuredClone(source);
 for(const speaker of ['momotamu','vivi']){
  const output=recipe.apply(source,{detail:'expanded',characterDirection:'Stay curious.'},speaker,'discuss');
  assert.match(output[0].content,/DISCUSS EXCHANGE DIRECTION/);assert.match(output[0].content,/one thought per turn/);assert.doesNotMatch(output[0].content,/Reply in 1–3|A fuller explanation/);
  assert.match(output[0].content,/sets the task and the subject/);assert.match(output[0].content,/does not replace that voice/);assert.match(output[0].content,/Keep document claims grounded/);assert.match(output[0].content,/Follow the latest human contribution/);
  assert.deepEqual(output.slice(1),source.slice(1));assert.deepEqual(source,before);
 }
});

test('a task sentence keeps Vivi’s recipe and does not replace her voice',()=>{
 const compiled=recipe.compileTurnInstruction({speaker:'vivi',rhythm:'discuss',persona:'You are VIVI, a gentle, reflective companion with a warm and slightly dreamy tone.',latestHuman:'Roast this topic. Keep it witty and specific.',recipe:{characterDirection:'Ask one sharp question.',tone:'playful',detail:'expanded',additionalGuidance:'Keep the sting specific.'}});
 const defaultAt=compiled.text.indexOf('CHARACTER DEFAULT'),requestAt=compiled.text.indexOf('LATEST HUMAN SENTENCE');
 assert.ok(defaultAt>=0&&requestAt>defaultAt);
 assert.match(compiled.text,/Roast this topic/);assert.match(compiled.text,/gentle, reflective/);assert.match(compiled.text,/VIVI PERSONAL RECIPE/);assert.match(compiled.text,/Ask one sharp question/);assert.match(compiled.text,/does not replace that voice/);assert.match(compiled.text,/Color the task and the subject/);
 assert.doesNotMatch(compiled.text,/MOMOTAMU PERSONAL RECIPE|Vivi brings gentle|including manner/);
 const applied=recipe.apply([{role:'system',content:'Reply in 1–3 short, helpful sentences.'}],{characterDirection:'Ask one sharp question.',additionalGuidance:'Keep the sting specific.'},'vivi','discuss',{persona:'You are VIVI, a gentle, reflective companion.',latestHuman:'Roast this topic. Keep it witty and specific.'});
 assert.match(applied[0].content,/Roast this topic/);assert.match(applied[0].content,/VIVI PERSONAL RECIPE/);assert.doesNotMatch(applied[0].content,/MOMOTAMU PERSONAL RECIPE/);
});

test('Momotamu’s compiled default keeps her recipe inside the same order',()=>{
 const compiled=recipe.compileTurnInstruction({speaker:'momotamu',rhythm:'discuss',persona:'You are MOMOTAMU, a warm, lively discussion companion.',recipe:{characterDirection:'Stay curious.',tone:'calm',detail:'balanced',additionalGuidance:''}});
 assert.match(compiled.text,/MOMOTAMU PERSONAL RECIPE/);assert.match(compiled.text,/Stay curious/);assert.match(compiled.text,/Calm, steady/);
 assert.doesNotMatch(compiled.text,/Vivi brings gentle/);
 assert.ok(compiled.text.indexOf('CHARACTER DEFAULT')<compiled.text.indexOf('LATEST HUMAN SENTENCE'));
 assert.ok(compiled.text.indexOf('LATEST HUMAN SENTENCE')<compiled.text.indexOf('EXCHANGE SHAPE'));
 assert.match(compiled.text,/Color the task and the subject/);
});

test('speaking to each other does not tell the opening turn to answer the human',()=>{
 const compiled=recipe.compileTurnInstruction({speaker:'momotamu',rhythm:'discuss',listener:'partner',listenerText:'Address your partner by name when building on their point.',persona:'You are MOMOTAMU.',recipe:{characterDirection:'Stay curious.',tone:'warm'}});
 assert.match(compiled.text,/give your partner one useful idea/);
 assert.doesNotMatch(compiled.text,/answer the human|including the human in the conversation/);
 const withUs=recipe.compileTurnInstruction({speaker:'momotamu',rhythm:'discuss',listener:'user',persona:'You are MOMOTAMU.',recipe:{}});
 assert.match(withUs.text,/answer the human with one useful idea/);
});

test('the listener line sits between the recipe and the task and does not replace the voice',()=>{
 const partner=recipe.compileTurnInstruction({speaker:'vivi',rhythm:'discuss',persona:'You are VIVI.',recipe:{characterDirection:'Ask one sharp question.',tone:'playful'},latestHuman:'Topic to roast: office snacks.',listenerText:'Address your partner by name when building on their point.'});
 assert.ok(partner.text.indexOf('CHARACTER DEFAULT')<partner.text.indexOf('LISTENER'));
 assert.ok(partner.text.indexOf('LISTENER')<partner.text.indexOf('LATEST HUMAN SENTENCE'));
 assert.match(partner.text,/Address your partner by name/);
 assert.match(partner.text,/VIVI PERSONAL RECIPE/);
 assert.match(partner.text,/does not replace that voice/);
 const user=recipe.compileTurnInstruction({speaker:'momotamu',listenerText:'AUDIENCE: speak to the user who described the situation. Keep the user as the listener, even when you build on the other character\'s point.'});
 assert.match(user.text,/speak to the user who described the situation/);
 assert.doesNotMatch(user.text,/Address your partner/);
});

test('solo Recipe lengths and Natural rhythm remain available without inheriting Discuss constraints',()=>{
 const messages=[{role:'system',content:'Reply in 1–3 short sentences (max 45 words).'}];
 const usual=recipe.apply(messages,{detail:'expanded'},'momotamu','usual')[0].content;
 const natural=recipe.apply(messages,{detail:'expanded'},'momotamu','natural')[0].content;
 assert.match(usual,/A fuller explanation/);assert.doesNotMatch(usual,/DISCUSS EXCHANGE/);
 assert.match(natural,/NATURAL REPLY RHYTHM/);assert.doesNotMatch(natural,/DISCUSS EXCHANGE/);
 const viviUsual=recipe.apply(messages,{detail:'expanded',characterDirection:'Ask one sharp question.'},'vivi','usual')[0].content;
 assert.match(viviUsual,/VIVI PERSONAL RECIPE/);assert.match(viviUsual,/A fuller explanation/);assert.doesNotMatch(viviUsual,/MOMOTAMU PERSONAL RECIPE/);
});
