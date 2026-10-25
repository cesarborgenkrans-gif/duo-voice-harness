(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./turn-delivery') : root.DiscussionTurnDelivery);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DiscussionConversation = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (delivery) {
  'use strict';
  const names = { user: 'User-san', momotamu: 'Momotamu', vivi: 'Vivi' };
  const bytes = text => new TextEncoder().encode(text).length;
  function clipBytes(text, limit) {
    let result = '', used = 0;
    for (const character of text) { const cost = bytes(character); if (used + cost > limit) break; result += character; used += cost; }
    return result;
  }
  function cleanResponse(text, actor) {
    const clean=String(text || '').replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, '').trim();
    const label=names[actor];
    if(!label)return clean;
    return clean.replace(new RegExp('^(?:\\*\\*)?'+label.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?:\\*\\*)?\\s*:(?:\\*\\*)?\\s*','i'),'');
  }
  function spokenText(text){
    return cleanResponse(text)
      .replace(/```[^\n]*\n([\s\S]*?)```/g,'$1')
      .replace(/\[([^\]]+)\]\([^\s)]+\)/g,'$1')
      .replace(/^\s{0,3}(?:#{1,6}\s+|>\s*|[-*+]\s+)/gm,'')
      .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g,'$2')
      .replace(/(^|[\s(])([*_])(?=\S)([^\n]*?\S)\2(?=$|[\s.,!?;:)])/g,'$1$3')
      .replace(/`([^`\n]+)`/g,'$1')
      .replace(/(?:\r?\n\s*\|[-:\s|]+\|\s*)+/g,'')
      .replace(/\|/g,' ')
      .replace(/\p{Extended_Pictographic}/gu,'')
      .replace(/[ \t]+/g,' ')
      .replace(/^[ \t]+|[ \t]+$/gm,'')
      .replace(/\n{3,}/g,'\n\n').trim();
  }
  function boundedHistory(entries, limit = 6000, count = 16) {
    const kept = []; let used = 0;
    for (const original of [...entries].reverse()) {
      const entry={...original,text:contextText(original),_contextText:true};
      if (!['complete','interrupted'].includes(entry.status)) continue;
      const cost = bytes(entry.text) + 80;
      if (kept.length >= count) break;
      if (used + cost > limit) {
        if (!kept.length) { const text = clipBytes(entry.text, Math.max(0, limit - 160)) + '\n[Long turn excerpt; full text is saved in the session.]'; kept.unshift({ ...entry, text }); used = bytes(text) + 80; }
        break;
      }
      kept.unshift(entry); used += cost;
    }
    return { entries: kept, bytes: used, omitted: entries.length - kept.length };
  }
  function nextSpeaker(session) {
    const last = [...session.entries].reverse().find(e => e.speaker !== 'user');
    if (!last) return session.participants[0];
    if (['interrupted','capped'].includes(last.status)) return last.speaker;
    return session.participants[(session.participants.indexOf(last.speaker) + 1) % session.participants.length];
  }
  function roleMessages(speaker, entries) {
    // A partner's text is observed dialogue, never this character's own answer.
    return entries.map(e => {
      const text=e._contextText?e.text:contextText(e);
      return {role:e.speaker===speaker?'assistant':'user',content:e.speaker===speaker?text:e.speaker==='user'?`${e.source==='agent'?(e.sourceLabel||'External agent')+' (external AI; a separate contributor)':'User-san (the human user; a separate participant)'} said:\n${text}`:`${names[e.speaker]} said (quoted character dialogue):\n${text}`,...(e.audio?.reference&&e.audio.status!=='ready'?{audioReference:e.audio.reference}:{})};
    });
  }
  const recoveryGuidance = speaker => {
    switch (speaker) {
      case 'momotamu': return "Open with a brief, friendly in-character conversational acknowledgment of yielding the floor (e.g. 'Oh, go ahead!', 'Oops, got carried away—what's on your mind?', or 'Ah, tell me!'), then smoothly address their thought.";
      case 'vivi': return "React with curious attention (e.g. 'Oh! Tell me more!' or 'Ah, what is it?') before continuing.";
      default: return "Briefly acknowledge the conversational interruption naturally and politely before addressing their thought.";
    }
  };
  function contextText(entry){const text=delivery.historyText({...entry,text:contributionText(entry)});return entry.status==='interrupted'?`[Your generated reply was interrupted. Respond to the latest user contribution; do not assume the user heard this entire reply. Exact audible words are unknown. ${recoveryGuidance(entry.speaker)}]\n`+text:text;}
  function contributionText(entry){if(!entry.audio)return entry.text;return [entry.text==='Voice message'?'':entry.text,entry.audio.status==='ready'?'Approximate transcript of the human recording:\n'+entry.audio.transcript:'[Earlier human audio: words unavailable; do not infer its content.]'].filter(Boolean).join('\n\n');}
  function renderMarkdown(session) {
    const heading = session.title.replace(/[\r\n]/g, ' ');
    return `# ${heading}\n\n${session.kind === 'chat' ? 'Chat' : 'Discussion'} · ${session.participants.map(id => names[id]).join(' + ')}\n\nCreated: ${session.createdAt}\n` +
      (session.memory?.text ? `\n### Discussion Master — compressed memory (may omit details)\n\n${session.memory.text}\n\nCovers through turn: ${session.memory.throughId}\n` : '') +
      session.entries.map(e => `\n---\n\n## ${e.kind === 'reveal' ? 'Backstage reveal' : e.speaker==='user'&&e.source==='agent'?(e.sourceLabel||'External agent')+' · AI':names[e.speaker]} · ${e.createdAt}${e.kind === 'reaction' ? ' · Theatrical reaction' : ''}${e.status === 'interrupted' ? ' · Interrupted' : e.status === 'capped' ? ' · Reply token cap reached; incomplete' : ''}${e.delivery?' · '+delivery.label(e.delivery):''}\n\n${e.audio?contributionText(e):e.text}\n`).join('');
  }
  function memoryBatch(session) {
    const through = session.memory?.throughId;
    const offset = through ? session.entries.findIndex(e => e.id === through) + 1 : 0;
    const pending = session.entries.slice(offset).filter(e => e.status === 'complete');
    const batch = []; let used = 0;
    for (const e of pending) {
      const full=contextText(e),text = clipBytes(full, 3000), cost = bytes(text) + 100;
      if (used + cost > 4200 && batch.length) break;
      batch.push({ ...e, text: text + (text !== full ? '\n[Long turn excerpt; do not infer omitted content.]' : '') }); used += cost;
      if (batch.length >= 6) break;
    }
    return { entries: batch, throughId: batch.at(-1)?.id, remaining: pending.length - batch.length };
  }
  return { names, bytes, clipBytes, cleanResponse, spokenText, boundedHistory, nextSpeaker, roleMessages, renderMarkdown, memoryBatch };
});
