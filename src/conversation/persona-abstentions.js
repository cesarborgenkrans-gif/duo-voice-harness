// Provides natural, non-repetitive in-character "One Good No" abstentions when retrieved context is ungrounded.
(function (root) {
  'use strict';

  const POOLS = {
    momotamu: ["I couldn’t find enough support for that in the supplied text. Could we check another passage?", "Let’s stay with what this text supports. I don’t have enough evidence here to answer that."],
    vivi: ["I don’t have enough support in the supplied text to answer that. We can look at another passage together.", "The available text doesn’t give me enough evidence for that answer. I’d rather leave it open than guess."]
  };

  const lastIndices = new Map();

  function getRefusal(speaker = 'momotamu') {
    const actor = POOLS[speaker] ? speaker : 'momotamu';
    const pool = POOLS[actor];
    const last = lastIndices.get(actor);
    let nextIdx = Math.floor(Math.random() * pool.length);
    if (pool.length > 1 && nextIdx === last) {
      nextIdx = (nextIdx + 1) % pool.length;
    }
    lastIndices.set(actor, nextIdx);
    return pool[nextIdx];
  }

  function reset() {
    lastIndices.clear();
  }

  const api = { POOLS, getRefusal, reset };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DiscussionPersonaAbstentions = api;
})(typeof window === 'undefined' ? globalThis : window);
