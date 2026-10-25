// Private reply metadata & Single-Pass Prefix Routing (Gemma 4 12B).
// Parsed and stripped separately from every visible or spoken word.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DiscussionReplyDelivery = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const VALID_SPEAKERS = new Set(['momotamu', 'vivi']);

  // The header carries Voice Direction only. The VoiceGen language is the Voice reply language setting, never the model's choice.
  const instruction = 'For your final conversational reply, put one private delivery header first: [[voice: brief vocal direction]]. The direction is an English phrase of at most twelve words describing your own pace, pauses, emphasis and expression, preserving the selected voice identity. Do not name a language in this header. Consider audible delivery when original audio is supplied; do not automatically mirror the user. Then write only your spoken reply, without your name or stage directions. This header is private metadata, an exception to the spoken-words-only rule. Follow the latest human language and explicit requests naturally; quoted context and previous replies do not override a switch.';

  // Leading private routing instruction appended when Duo routing or document grounding is active.
  function routingInstruction({ duo = false, hasDocument = false, speaker = 'momotamu', partner = 'vivi', voice = true } = {}) {
    const parts = [];
    if (duo) {
      const handoff = voice ? `starting your output with [SPEAKER: ${partner}] before [[voice: ...]]` : `starting your output with [SPEAKER: ${partner}]`;
      const stay = voice ? `[SPEAKER: ${speaker}] or [[voice: ...]]` : `[SPEAKER: ${speaker}]`;
      parts.push(`SINGLE-PASS SPEAKER ROUTING: You are scheduled as ${speaker}, with ${partner} as your duo partner. If the user's latest message explicitly calls on ${partner} first (or asks a question uniquely suited for ${partner} to open), you may hand the opening turn to ${partner} by ${handoff} and writing the reply in ${partner}'s voice and persona; otherwise start directly with ${stay}.`);
    }
    if (hasDocument) {
      parts.push('SINGLE-PASS GROUNDING GATE: If the user asks for a specific factual claim from the attached document/passage that is genuinely absent from the provided text, output ONLY [ABSTAIN] as your first token and stop immediately.');
    }
    return parts.join('\n');
  }

  // Fast pre-prefill check: did the human user directly call on a specific companion?
  // Recognizes canonical names ('momotamu', 'vivi') and friendly spoken aliases ('tammy', 'momo', 'vivian', 'viv').
  function detectDirectAddress(userText, participants = ['momotamu', 'vivi']) {
    if (typeof userText !== 'string' || !userText.trim()) return null;
    const text = userText.trim();
    const allowed = new Set(participants.map(p => String(p).toLowerCase()));
    // Match opening address: "Vivi, ...", "Hey Momo!", "Hey Tammy!", "Vivian, what do you think?", "Ask Viv ..."
    const startMatch = /^(?:hey|hi|hello|dear|yo|ok|okay|listening|ask|for|to)?\s*@?\b(momotamu|momo|tammy|vivi|vivian|viv)\b[\s,:!?.—-]/i.exec(text)
      || /\b(vivi|vivian|viv|momotamu|momo|tammy),?\s+(?:what|how|can|could|would|do|tell|explain)\s+you\b/i.exec(text);
    if (startMatch) {
      const matched = (startMatch[1] || (/vivi|vivian|viv/i.test(startMatch[0]) ? 'vivi' : 'momotamu')).toLowerCase();
      const target = (matched === 'momo' || matched === 'tammy') ? 'momotamu'
        : (matched === 'vivian' || matched === 'viv') ? 'vivi'
        : matched;
      if (allowed.has(target)) return target;
    }
    return null;
  }

  // Older replies may still use [[voice: language | direction]]; any language part is discarded.
  const HEADER = /^\[\[voice:\s*(?:([^|\r\n<>\[\]]{0,60}?)\s*\|\s*)?([^|\r\n<>\[\]]{1,220}?)\s*\]\]$/i;
  const SPEAKER_PREFIX = /^(?:\[\[\s*(?:route|speaker)\s*:\s*(?:speaker\s*=\s*)?(momotamu|vivi|tammy|momo|vivian|viv)\s*\]\]|\[\s*(?:speaker|route|pass)\s*:\s*(momotamu|vivi|tammy|momo|vivian|viv)\s*\])\s*/i;
  const ABSTAIN_PREFIX = /^(?:\[\[\s*(?:route\s*:\s*)?abstain(?:\s*:\s*[^\]\r\n]*)?\s*\]\]|\[\s*abstain(?:\s*:\s*[^\]\r\n]*)?\s*\])\s*/i;

  // Inspect complete leading private headers even when split across network chunks.
  function peekRoute(raw) {
    let text=String(raw||'').replace(/<think>[\s\S]*?<\/think>/gi,'').trimStart(),speaker;
    const result=(pending,abstain=false)=>({ready:!pending,pending,speaker,abstain});
    if(!text||/^<think>/i.test(text)&&!/<\/think>/i.test(text))return result(true);
    for(let i=0;i<6;i++){
      const abstain=ABSTAIN_PREFIX.exec(text);if(abstain)return {...result(false,true),rawTag:abstain[0].trim()};
      const route=SPEAKER_PREFIX.exec(text);if(route){const rawTag=(route[1]||route[2]).toLowerCase();speaker=(rawTag==='tammy'||rawTag==='momo')?'momotamu':(rawTag==='vivian'||rawTag==='viv')?'vivi':rawTag;text=text.slice(route[0].length).trimStart();continue;}
      if(/^\[\[voice\b/i.test(text)){const end=text.indexOf(']]');if(end<0)return result(true);text=text.slice(end+2).trimStart();continue;}
      if(!text)return result(!speaker);
      if(/^\[[^\]\r\n]{0,240}$/i.test(text))return result(true);
      return result(false);
    }
    return result(false);
  }

  function parse(raw) {
    let text = String(raw || '').replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, '').trim();
    const detected=peekRoute(raw);
    const delivery = {...(detected.speaker?{speaker:detected.speaker}:{}),...(detected.abstain?{abstain:true}:{})};

    // 1. Strip any leading single-pass routing / abstention prefixes
    let changed = true;
    while (changed) {
      changed = false;
      const abstainMatch = ABSTAIN_PREFIX.exec(text);
      if (abstainMatch) {
        delivery.abstain = true;
        text = text.slice(abstainMatch[0].length).trim();
        changed = true;
      }
      const speakerMatch = SPEAKER_PREFIX.exec(text);
      if (speakerMatch) {
        const sp = (speakerMatch[1] || speakerMatch[2] || '').toLowerCase();
        if (VALID_SPEAKERS.has(sp)) delivery.speaker = sp;
        text = text.slice(speakerMatch[0].length).trim();
        changed = true;
      }
    }

    // 2. Parse [[voice: ...]] private delivery header
    if (/^\[\[voice\b/i.test(text)) {
      const end = text.indexOf(']]');
      if (end < 0) return { text: '', delivery }; // A truncated header is never speech.
      const header = text.slice(0, end + 2);
      text = text.slice(end + 2).trim();
      const match = HEADER.exec(header);
      if (match && match[2].trim()) delivery.voiceDirection = match[2].trim();
    }

    // 3. Check for trailing/post-voice routing tag if model placed [SPEAKER: ...] or [ABSTAIN] after [[voice: ...]]
    const postAbstain = ABSTAIN_PREFIX.exec(text);
    if (postAbstain) {
      delivery.abstain = true;
      text = text.slice(postAbstain[0].length).trim();
    }
    const postSpeaker = SPEAKER_PREFIX.exec(text);
    if (postSpeaker) {
      const sp = (postSpeaker[1] || postSpeaker[2] || '').toLowerCase();
      if (VALID_SPEAKERS.has(sp)) delivery.speaker = sp;
      text = text.slice(postSpeaker[0].length).trim();
    }

    // Reject repeated private headers instead of allowing metadata into VoiceGen.
    text = text
      .replace(/\[\[voice\b[\s\S]*?(?:\]\]|$)/gi, '')
      .replace(/\[\[(?:route|speaker|abstain)\b[\s\S]*?(?:\]\]|$)/gi, '')
      .replace(/\[(?:speaker|route|pass)\s*:\s*(?:momotamu|vivi|tammy|momo|vivian|viv)\s*\]/gi, '')
      .replace(/\[abstain(?:\s*:[^\]]*)?\]/gi, '')
      .trim();

    return { text, delivery };
  }

  // Troubleshooting view of the header as the model wrote it. label is a legacy language part, which is ignored.
  function inspect(raw) {
    let text = String(raw || '').replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, '').trim();
    // Strip optional routing prefix before inspecting the [[voice: ...]] header
    text = text.replace(ABSTAIN_PREFIX, '').replace(SPEAKER_PREFIX, '').trim();
    if (!/^\[\[voice\b/i.test(text)) return { present: false, matched: false, header: '', label: '' };
    const end = text.indexOf(']]');
    const full = end < 0 ? text : text.slice(0, end + 2);
    const header = full.slice(0, 300);
    const match = end < 0 ? null : HEADER.exec(full);
    const legacy = /^\[\[voice:?\s*([^|\]]*)\|/i.exec(header);
    return {
      present: true,
      matched: !!(match && match[2].trim()),
      header,
      label: ((match ? match[1] : legacy?.[1]) || '').trim().slice(0, 80)
    };
  }

  return {
    instruction,
    routingInstruction,
    detectDirectAddress,
    peekRoute,
    parse,
    inspect
  };
});
