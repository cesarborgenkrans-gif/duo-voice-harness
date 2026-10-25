'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const seeds=require('../src/conversation/prompt-seeds');

test('an empty message gets a roast seed with the blank selected',()=>{
 const filled=seeds.fill('','roast');
 assert.match(filled.value,/^Topic to roast: ____\./);
 assert.match(filled.value,/in your own voices/);
 assert.match(filled.value,/The joke is about the idea/);
 assert.equal(filled.value.slice(filled.selectStart,filled.selectEnd),'____');
});

test('a topic with a period survives a switch to another template',()=>{
 const roast=seeds.fill('Dr. Smith','roast');
 assert.equal(roast.value.slice(roast.selectStart,roast.selectEnd),'Dr. Smith');
 const skit=seeds.fill(roast.value,'skit');
 assert.match(skit.value,/^Topic for a skit: Dr\. Smith\. Build a short scene/);
 assert.equal(skit.value.slice(skit.selectStart,skit.selectEnd),'Dr. Smith');
});

test('existing message text becomes the topic, and a later seed keeps it',()=>{
 const first=seeds.fill('office snacks','duel');
 assert.match(first.value,/^Topic to debate: office snacks\./);
 assert.match(first.value,/in your own voices/);
 const next=seeds.fill(first.value,'skit');
 assert.match(next.value,/^Topic for a skit: office snacks\./);
 assert.doesNotMatch(next.value,/Topic to debate/);
});

test('a Japanese template keeps the topic and leaves the blank ready',()=>{
 const filled=seeds.fill('','kanji');
 assert.match(filled.value,/^Topic for a kanji: ____\./);
 assert.match(filled.value,/in your own voices/);
 assert.equal(filled.value.slice(filled.selectStart,filled.selectEnd),'____');
 const next=seeds.fill(seeds.fill('train station','phrase').value,'recall');
 assert.match(next.value,/^Topic for a recall drill: train station\./);
 assert.doesNotMatch(next.value,/Topic for a phrase/);
});

test('a blank kanji prompt receives a concrete thing, and the next click picks another',()=>{
 const blank=seeds.fill('','kanji').value;
 const first=seeds.suggest(blank,()=>0);
 assert.equal(first.topic,seeds.topics.things[0]);
 assert.equal(first.value.includes('____'),false);
 assert.equal(first.value.slice(first.selectStart,first.selectEnd),first.topic);
 const second=seeds.suggest(first.value,()=>0,first.topic);
 assert.equal(second.topic,seeds.topics.things[1]);
 assert.doesNotMatch(second.value,/____/);
});

test('Phrase Lab draws from situations, and a typed topic hides the random choice',()=>{
 const phrase=seeds.suggest(seeds.fill('','phrase').value,()=>0);
 assert.ok(seeds.topics.situations.includes(phrase.topic));
 assert.equal(seeds.topics.things.includes(phrase.topic),false);
 assert.equal(seeds.suggest(seeds.fill('a red umbrella','kanji').value,()=>0),null);
 assert.equal(seeds.suggest('Topic for a kanji: my own garden.',()=>0),null);
 assert.equal(seeds.suggest('hello',()=>0),null);
});

test('the bar has the four conversation templates and the three Japanese drills',()=>{
 assert.deepEqual(seeds.seeds.map(seed=>seed.id),['roast','duel','skit','dive','kanji','phrase','recall']);
});
