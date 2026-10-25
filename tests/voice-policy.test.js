'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { migrate, speaksReplies, paid, providerLabel } = require('../src/voice/voice-policy');

test('a saved speech provider speaks, and Text only does not call for replies', () => {
  assert.equal(speaksReplies(migrate({ voiceRoute: { provider: 'diy' } })), true);
  assert.equal(speaksReplies(migrate({})), true);
  const textOnly = migrate({ voiceDisabled: true, voiceRoute: { provider: 'elevenlabs' }, voiceReplyLanguage: 'French' });
  assert.equal(textOnly.voiceDisabled, true);
  assert.equal(textOnly.voiceReplyLanguage, 'French');
  assert.equal(textOnly.voiceRoute.provider, 'elevenlabs');
  assert.equal(speaksReplies(textOnly), false);
  assert.equal(providerLabel(textOnly), 'Text only');
  assert.equal(paid(textOnly), false);
});

test('an unchecked automatic-reading preference asks before speech and keeps the provider', () => {
  const saved = { voiceOn: false, voiceDisabled: false, key: 'secret', voiceRoute: { provider: 'cartesia' }, voiceReplyLanguage: 'Swedish', voiceLabels: { vivi: 'kept' } };
  const once = migrate(saved);
  assert.equal(saved.voiceOn, false);
  assert.equal(Object.hasOwn(once, 'voiceOn'), false);
  assert.equal(once.voiceSpeechDeferred, true);
  assert.equal(once.voiceDisabled, false);
  assert.equal(once.key, 'secret');
  assert.equal(once.voiceReplyLanguage, 'Swedish');
  assert.deepEqual(once.voiceLabels, { vivi: 'kept' });
  assert.equal(once.voiceRoute.provider, 'cartesia');
  assert.equal(speaksReplies(once), false);
  assert.equal(paid(once), true);
  assert.equal(providerLabel(once), 'Cartesia');
  assert.deepEqual(migrate(once), once);
});

test('Text only wins over the old checkbox, and a chosen provider keeps speaking', () => {
  const textOnly = migrate({ voiceOn: false, voiceDisabled: true, voiceRoute: { provider: 'elevenlabs' } });
  assert.equal(textOnly.voiceDisabled, true);
  assert.equal(Object.hasOwn(textOnly, 'voiceOn'), false);
  assert.equal(Object.hasOwn(textOnly, 'voiceSpeechDeferred'), false);
  assert.equal(speaksReplies(textOnly), false);
  const speaking = migrate({ voiceOn: true, voiceRoute: { provider: 'voxcpm2' } });
  assert.equal(Object.hasOwn(speaking, 'voiceOn'), false);
  assert.equal(Object.hasOwn(speaking, 'voiceSpeechDeferred'), false);
  assert.equal(speaksReplies(speaking), true);
  assert.equal(providerLabel(speaking), 'VoiceGen / VoxCPM2');
  assert.equal(paid(migrate({ voiceSpeechDeferred: true, voiceRoute: { provider: 'elevenlabs' } })), true);
  assert.equal(speaksReplies(migrate({ voiceSpeechDeferred: true, voiceRoute: { provider: 'diy' } })), false);
  assert.equal(paid(migrate({ voiceRoute: { provider: 'diy' } })), false);
});
