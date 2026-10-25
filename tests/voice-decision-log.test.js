'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createVoiceDecisionLog } = require('../src/voice/voice-decision-log');
const { createVoiceService } = require('../src/voice/voice-service');
const delivery = require('../src/voice/reply-delivery');
const voiceRoot = path.join(__dirname, '..', 'assets', 'voice');
const temp = () => fs.mkdtemp(path.join(os.tmpdir(), 'voice-decision-'));
const lines = async file => (await fs.readFile(file, 'utf8')).trim().split('\n').map(line => JSON.parse(line));

test('decision log keeps allowlisted fields, never reply words, and rotates once', async () => {
  const root = await temp();
  try {
    const file = path.join(root, 'logs', 'voice-decisions.jsonl');
    const log = createVoiceDecisionLog({ file, maxBytes: 600, enabled: true });
    await log.record({ event: 'reply-header', rawHeaderLabel: 'english', headerMatched: true, languageSent: 'english', text: 'secret reply words', textLength: 18, voicegen: { healthy: true, loaded: false } });
    const [first] = await lines(file);
    assert.equal(first.rawHeaderLabel, 'english'); assert.equal(first.textLength, 18); assert.equal(first.text, undefined);
    assert.deepEqual(first.voicegen, { healthy: true, loaded: false }); assert.match(first.time, /^\d{4}-\d\d-\d\dT/);
    for (let i = 0; i < 20; i++) await log.record({ event: 'voice-result', reason: 'x'.repeat(40) });
    assert.ok((await fs.stat(file)).size <= 600); await fs.stat(file + '.1'); await assert.rejects(fs.stat(file + '.2'));
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('DUO_VOICE_LOG=0 disables the log and logging failures never throw', async () => {
  const root = await temp(), previous = process.env.DUO_VOICE_LOG;
  try {
    process.env.DUO_VOICE_LOG = '0';
    const off = createVoiceDecisionLog({ file: path.join(root, 'off.jsonl') });
    assert.equal(off.enabled, false); await off.record({ event: 'x' }); await assert.rejects(fs.stat(path.join(root, 'off.jsonl')));
    delete process.env.DUO_VOICE_LOG;
    assert.equal(createVoiceDecisionLog({ file: path.join(root, 'on.jsonl') }).enabled, true);
    const circular = { event: 'x' }; circular.self = circular;
    const on = createVoiceDecisionLog({ file: path.join(root, 'on.jsonl'), enabled: true });
    await on.record(circular); await on.record(null); await on.record({ event: 'ok', textLength: 1n });
    const blocked = path.join(root, 'dir.jsonl'); await fs.mkdir(blocked);
    await createVoiceDecisionLog({ file: blocked, enabled: true }).record({ event: 'x' });
  } finally { if (previous === undefined) delete process.env.DUO_VOICE_LOG; else process.env.DUO_VOICE_LOG = previous; await fs.rm(root, { recursive: true, force: true }); }
});

test('header inspection reports the label as written without changing parse', () => {
  assert.deepEqual(delivery.inspect('[[voice: english | warm]]Hi'), { present: true, matched: true, header: '[[voice: english | warm]]', label: 'english' });
  assert.deepEqual(delivery.inspect('[[voice: Japanese/English | warm]]Hi'), { present: true, matched: true, header: '[[voice: Japanese/English | warm]]', label: 'Japanese/English' });
  assert.deepEqual(delivery.inspect('[[voice: warm]]Hi'), { present: true, matched: true, header: '[[voice: warm]]', label: '' });
  assert.deepEqual(delivery.inspect('Hello'), { present: false, matched: false, header: '', label: '' });
  assert.equal(delivery.inspect('[[voice: English | warm').matched, false);
  assert.deepEqual(delivery.parse('[[voice: english | warm]]Hi'), { text: 'Hi', delivery: { voiceDirection: 'warm' } });
});

test('voice service records the session request and the VoiceGen refusal without changing the result', async () => {
  const entries = [];
  const fetchImpl = async url => {
    const route = new URL(url).pathname;
    if (route === '/api/health') return Response.json({ service: 'duo-voice-harness-voice', loaded: true, speech_sessions: { available: true, output_retention: ['session', 'archive'] } });
    if (route === '/api/speech-sessions') return Response.json({ error: "unsupported voice language: 'english'" }, { status: 400 });
    return Response.json({});
  };
  const service = createVoiceService({ voiceRoot, fetchImpl, decisionLog: entry => entries.push(entry) });
  const result = await service.stream({ id: 'voice-log-123', decisionId: 'reply-1', flow: { id: 'flow-1' }, actor: 'momotamu', preference: 'auto', text: 'Hello there.', language: 'english', voiceDirection: 'warm' }, () => {}, 1);
  assert.equal(result.ok, false); assert.match(result.error, /unsupported voice language: 'english'/);
  assert.deepEqual(entries.map(entry => entry.event), ['voice-session-create', 'voice-stream-error']);
  assert.equal(entries[0].languageSent, 'english'); assert.equal(entries[0].voiceMode, 'voice-directed'); assert.equal(entries[0].decisionId, 'reply-1'); assert.equal(entries[0].flowId, 'flow-1'); assert.equal(entries[0].voicegen.loaded, true);
  assert.equal(entries[1].httpStatus, 400); assert.equal(entries[1].stage, 'create'); assert.equal(entries[1].outcome, 'error'); assert.equal(entries[1].text, undefined);
  const throwing = createVoiceService({ voiceRoot, fetchImpl, decisionLog: () => { throw new Error('disk full'); } });
  const second = await throwing.stream({ id: 'voice-log-456', actor: 'momotamu', text: 'Hello.', language: 'English' }, () => {}, 1);
  assert.equal(second.ok, false); assert.match(second.error, /unsupported voice language/);
});
