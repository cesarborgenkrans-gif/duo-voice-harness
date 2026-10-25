// Prompt seeds write an editable task into the message box. They do not change a companion's voice.
(function(root){
  const topics=(typeof module!=='undefined'&&module.exports)?require('./topic-bank'):root.DiscussionTopics;
  const blank='____';
  const seeds=[
    {id:'roast',label:'Roast',pool:'either',prefix:'Topic to roast: ',suffix:'. Take the idea apart together, in your own voices. Witty, specific, and fair. The joke is about the idea.'},
    {id:'duel',label:'Academic Duel',pool:'either',prefix:'Topic to debate: ',suffix:'. Momotamu, defend the idea. Vivi, press on its flaws and edge cases. Do this in your own voices, and build on each other\'s points.'},
    {id:'skit',label:'Comedy Skit',pool:'either',prefix:'Topic for a skit: ',suffix:'. Build a short scene together, line by line, in your own voices.'},
    {id:'dive',label:'Deep Dive',pool:'either',prefix:'Topic to examine: ',suffix:'. Momotamu, map the big picture and a practical next step. Vivi, name the hidden edge cases and risks. Do this in your own voices.'},
    {id:'kanji',label:'Kanji Story',pool:'things',prefix:'Topic for a kanji: ',suffix:'. Teach one Japanese kanji related to it, in your own voices. Vivi, share the visual radical story and a memory anchor. Momotamu, teach the pronunciation, reading, and one speakable sentence.'},
    {id:'phrase',label:'Phrase Lab',pool:'situations',prefix:'Topic for a phrase: ',suffix:'. Teach one practical Japanese phrase for this situation, in your own voices. Momotamu, model the pronunciation, rhythm, and politeness level. Vivi, explain when to use it, the nuance, and what not to say.'},
    {id:'recall',label:'Micro Recall',pool:'things',prefix:'Topic for a recall drill: ',suffix:'. Run a short Japanese recall challenge, in your own voices. Momotamu, ask one short question and leave room for an answer. Vivi, give the answer, why it works, and one repetition.'}
  ];
  function sentence(seed,topic){return seed.prefix+topic+seed.suffix;}
  function matchSeed(current){
    const text=String(current||'').trim();
    for(const seed of seeds){
      if(text.startsWith(seed.prefix)&&text.endsWith(seed.suffix)&&text.length>=seed.prefix.length+seed.suffix.length){
        return {seed,topic:text.slice(seed.prefix.length,text.length-seed.suffix.length)};
      }
    }
    return null;
  }
  function topicOf(current){const matched=matchSeed(current);return matched?matched.topic:'';}
  function topicFrom(current){
    const matched=matchSeed(current);
    if(matched){const topic=matched.topic.trim();return topic&&topic!==blank?topic:blank;}
    const text=String(current||'').trim();
    if(!text)return blank;
    return text.split('\n')[0].trim().slice(0,240)||blank;
  }
  function placed(seed,topic){
    const value=sentence(seed,topic);
    const at=seed.prefix.length;
    return {value,selectStart:at,selectEnd:at+topic.length,topic};
  }
  function fill(current,id){
    const seed=seeds.find(item=>item.id===id);
    if(!seed)throw Error('Unknown prompt seed.');
    return placed(seed,topicFrom(current));
  }
  function poolFor(current){
    const kind=matchSeed(current)?.seed.pool||'either';
    if(kind==='things')return topics.things;
    if(kind==='situations')return topics.situations;
    return topics.things.concat(topics.situations);
  }
  function pick(pool,avoid,random){
    const choices=pool.filter(item=>item!==avoid);
    const list=choices.length?choices:pool;
    return list[Math.min(list.length-1,Math.floor(random()*list.length))];
  }
  function suggest(current,random=Math.random,ownedTopic=''){
    const matched=matchSeed(current);
    if(!matched){
      const text=String(current??''),at=text.indexOf(blank);
      if(at<0)return null;
      const topic=pick(poolFor(text),'',random);
      const value=text.slice(0,at)+topic+text.slice(at+blank.length);
      return {value,selectStart:at,selectEnd:at+topic.length,topic};
    }
    if(matched.topic===blank)return placed(matched.seed,pick(poolFor(current),'',random));
    if(ownedTopic&&matched.topic===ownedTopic)return placed(matched.seed,pick(poolFor(current),ownedTopic,random));
    return null;
  }
  const api={seeds,fill,suggest,topicOf,blank,topics};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.DiscussionPromptSeeds=api;
})(typeof window==='undefined'?globalThis:window);
