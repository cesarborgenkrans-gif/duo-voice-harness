const test = require('node:test');
const assert = require('node:assert/strict');

const gate = require('../src/documents/document-gate.js');
const delivery = require('../src/voice/reply-delivery.js');

test('DocumentGate chunks long attached documents into bounded candidate passages', () => {
  const longText = [
    '# Chapter 1: Architecture',
    'Duo Voice Harness runs Gemma 4 12B locally alongside VoxCPM2 for bilingual voice synthesis.',
    '# Chapter 2: Memory Budget',
    'By performing document gating on the CPU in under 20 milliseconds, zero extra GPU VRAM is consumed.',
    '# Chapter 3: Sprite Rigging',
    'Vivi uses upper-body pivot anchors and spring-damper physics for expressive animations.'
  ].join('\n\n');

  const chunks = gate.chunkDocument(longText, { idPrefix: 'spec', chunkChars: 110, overlapChars: 24 });
  assert.ok(chunks.length >= 3);
  assert.equal(chunks[0].id, 'spec-1');
  assert.ok(chunks.every((c) => c.text.length > 0));
});

test('DocumentGate passes answerable queries and rejects an unrelated query', async () => {
  const passages = gate.chunkDocument([
    'Momotamu and Vivi share a stage powered by a local Gemma 4 12B language model.',
    'Audio synthesis is handled by VoxCPM2 at 16kHz with expressive voice direction.',
    'The Jev 2-gate RAG loop verifies candidate passages against a 0.6 relevance cutoff before generation.'
  ].join('\n\n'));

  const hit = await gate.evaluate({
    query: 'What model handles audio synthesis and at what sample rate?',
    passages
  });
  assert.equal(hit.decision, 'ANSWERABLE');
  assert.ok(hit.topScore >= 0.6);
  assert.equal('tokensOnGuess' in hit, false);
  assert.ok(Number.isFinite(hit.latencyMs));
  assert.ok(Array.isArray(hit.candidateScores) && hit.candidateScores.length > 0);

  const miss = await gate.evaluate({
    query: 'What is the orbital velocity of Jupiter around the sun in kilometers per second?',
    passages
  });
  assert.equal(miss.decision, 'NOT_IN_DOCS');
  assert.ok(miss.topScore < 0.6);
  assert.equal(miss.retries, 1);
  assert.equal('tokensOnGuess' in miss, false);
});

test('DocumentGate Orbital Retry Loop recovers synonym queries and allows overview prompts', async () => {
  const passages = [
    { id: 'p1', text: 'The configuration modal displays graphics card memory usage and driver status.' }
  ];

  // Query uses "vram" and "settings", which Orbital Retry expands to "memory graphics gpu" and "configuration"
  const retryHit = await gate.evaluate({
    query: 'Where is vram shown in settings?',
    passages,
    threshold: 0.55
  });
  assert.equal(retryHit.decision, 'ANSWERABLE');

  const overview = await gate.evaluate({
    query: 'Can you summarize what this document is about?',
    passages
  });
  assert.equal(overview.decision, 'OVERVIEW');
  assert.equal(overview.gate1Pass,null);
  assert.equal(overview.gates,0);
  assert.equal(overview.retries, 0);
});

test('ReplyDelivery peekRoute detects single-pass speaker and abstention tokens on the first stream chunk', () => {
  // Incomplete opening bracket waits for rest of tag
  const partial = delivery.peekRoute('[SPEA');
  assert.equal(partial.ready, false);

  // Explicit speaker tag
  const viviRoute = delivery.peekRoute('[SPEAKER: vivi] [[voice: english | bright]] Oh! Let me take this one!');
  assert.equal(viviRoute.ready, true);
  assert.equal(viviRoute.speaker, 'vivi');
  assert.equal(viviRoute.abstain, false);

  // Explicit abstention tag
  const abstainRoute = delivery.peekRoute('[ABSTAIN] That detail is not in the attached reading.');
  assert.equal(abstainRoute.ready, true);
  assert.equal(abstainRoute.abstain, true);

  // Aliases normalize to canonical speaker IDs
  const tammyRoute = delivery.peekRoute('[SPEAKER: tammy] Hello!');
  assert.equal(tammyRoute.ready, true);
  assert.equal(tammyRoute.speaker, 'momotamu');

  const vivianRoute = delivery.peekRoute('[SPEAKER: vivian] Hello!');
  assert.equal(vivianRoute.ready, true);
  assert.equal(vivianRoute.speaker, 'vivi');

  // Normal text with no bracket resolves immediately
  const normal = delivery.peekRoute('Hello there!');
  assert.equal(normal.ready, true);
  assert.equal(normal.speaker, undefined);
  assert.equal(normal.abstain, false);
});

test('ReplyDelivery parse strips single-pass routing prefixes and preserves voice direction', () => {
  const parsed = delivery.parse('[SPEAKER: vivi]\n[[voice: english | playful teasing]]\nHere is my answer!');
  assert.equal(parsed.text, 'Here is my answer!');
  assert.deepEqual(parsed.delivery, {
    voiceDirection: 'playful teasing',
    speaker: 'vivi'
  });

  const abstained = delivery.parse('[SPEAKER: momotamu] [ABSTAIN] I checked the notes, and that is not mentioned.');
  assert.equal(abstained.text, 'I checked the notes, and that is not mentioned.');
  assert.deepEqual(abstained.delivery, {
    speaker: 'momotamu',
    abstain: true
  });
});

test('ReplyDelivery routing asks for a voice header only when speech will use one', () => {
  const spoken = delivery.routingInstruction({ duo: true, speaker: 'momotamu', partner: 'vivi', voice: true });
  const quiet = delivery.routingInstruction({ duo: true, speaker: 'momotamu', partner: 'vivi', voice: false });
  assert.match(spoken, /\[\[voice:/);
  assert.doesNotMatch(quiet, /\[\[voice:/);
  assert.match(quiet, /\[SPEAKER: vivi\]/);
  assert.match(delivery.routingInstruction({ hasDocument: true, voice: false }), /\[ABSTAIN\]/);
});

test('ReplyDelivery detectDirectAddress identifies when the user calls on a specific companion or alias', () => {
  assert.equal(delivery.detectDirectAddress('Vivi, what do you think about this paragraph?', ['momotamu', 'vivi']), 'vivi');
  assert.equal(delivery.detectDirectAddress('Hey Momo, can you explain the Japanese phrase?', ['momotamu', 'vivi']), 'momotamu');
  assert.equal(delivery.detectDirectAddress('Hey Tammy, can you explain this?', ['momotamu', 'vivi']), 'momotamu');
  assert.equal(delivery.detectDirectAddress('Tammy, what do you think?', ['momotamu', 'vivi']), 'momotamu');
  assert.equal(delivery.detectDirectAddress('Vivian, what do you think about this?', ['momotamu', 'vivi']), 'vivi');
  assert.equal(delivery.detectDirectAddress('Ask Viv what she feels about this.', ['momotamu', 'vivi']), 'vivi');
  assert.equal(delivery.detectDirectAddress('Both of you, what is your opinion on this?', ['momotamu', 'vivi']), null);
});
