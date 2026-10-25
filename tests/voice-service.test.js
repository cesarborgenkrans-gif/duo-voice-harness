'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createVoiceService, normalizeVoiceURL, selectProfile, validateWav } = require('../src/voice/voice-service');
const voiceRoot = path.join(__dirname, '..', 'assets','voice');

function fixture({ delayCreate = 0, failed = false, long = false, sampleRate = 48000, service = 'duo-voice-harness-voice', retention = ['session', 'archive'] } = {}) {
  const calls = [];
  let released = false;
  const fetchImpl = async (url, init = {}) => {
    const route = new URL(url).pathname;
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ route, body });
    if (route === '/api/health') return Response.json({ service, speech_sessions: { available: true, output_retention: retention } });
    if (route === '/api/speech-sessions') {
      if (delayCreate) await new Promise(resolve => setTimeout(resolve, delayCreate));
      return Response.json({ session_id: 'session-123456' });
    }
    if (route.endsWith('/audio')) {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(long ? sampleRate * 2 : [1, 2, 3]));
          controller.enqueue(new Uint8Array(long ? sampleRate * 2 : [4, 5, 6]));
          controller.close();
        }, cancel() { released = true; }
      });
      return new Response(stream, { headers: { 'X-Sample-Rate': String(sampleRate), 'X-Audio-Format': 'pcm_s16le' } });
    }
    if (route.endsWith('/text') || route.endsWith('/complete') || route.endsWith('/cancel')) return Response.json({ status: 'ok' });
    return Response.json({ state: failed ? 'failed' : 'completed', error: failed ? 'GPU failure' : undefined, record: { filename: 'fixture.wav' } });
  };
  return { fetchImpl, calls, get released() { return released; } };
}
const options = { id: 'voice-test-123', actor: 'momotamu', preference: 'auto', text: 'Hello, friend.', language: 'English' };

test('voice URL rejects remote hosts, redirects through paths, credentials, and non-HTTP', () => {
  assert.equal(normalizeVoiceURL('http://localhost:3233/'), 'http://localhost:3233');
  for (const url of ['https://localhost', 'http://example.com', 'http://localhost/other', 'http://user:pass@localhost', 'http://localhost?url=x']) assert.throws(() => normalizeVoiceURL(url));
});
test('reference identity follows the character, independently of output language', () => {
  for (const actor of ['momotamu', 'vivi']) assert.equal(selectProfile(actor), actor + '.selected');
  assert.throws(() => selectProfile('invalid'));
});
test('reading continuation stays chunked and does not request a single utterance', async () => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const route = new URL(url).pathname;
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ route, body });
    if (route === '/api/health') return Response.json({ service: 'duo-voice-harness-voice', speech_sessions: { available: true, narration_continuation: true, output_retention: ['session', 'archive'] } });
    if (route === '/api/speech-sessions') return Response.json({ session_id: 'session-123456' });
    if (route.endsWith('/audio')) return new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([1, 2])); controller.close(); } }), { headers: { 'X-Sample-Rate': '48000', 'X-Audio-Format': 'pcm_s16le' } });
    if (route.endsWith('/text') || route.endsWith('/complete') || route.endsWith('/cancel')) return Response.json({ status: 'ok' });
    return Response.json({ state: 'completed', record: { filename: 'fixture.wav' } });
  };
  const service = createVoiceService({ voiceRoot, fetchImpl });
  const result = await service.stream({ ...options, text: 'Read this.', verbatim: true, narrationContinuation: true }, () => {}, 42);
  assert.equal(result.ok, true, result.error);
  const create = calls.find(call => call.route === '/api/speech-sessions');
  assert.equal(create.body.narration_continuation, true);
  assert.equal(create.body.single_utterance, undefined);
  assert.equal(create.body.mode, 'voice-clone');
  assert.equal(create.body.voice_direction, undefined);
  assert.equal(create.body.seed, 42425);
  assert.equal(create.body.inference_timesteps, 8);
});
test('verbatim narration preserves literal source tags and whitespace', async () => {
  const fake = fixture(), service = createVoiceService({ voiceRoot, fetchImpl: fake.fetchImpl });
  const text = '<think>A word in a programming article.</think>\n\nRead this exact text.';
  const result = await service.stream({ ...options, text, verbatim: true }, () => {}, 42);
  assert.equal(result.ok, true);
  assert.equal(fake.calls.find(call => call.route.endsWith('/text')).body.delta, text);
});
test('real reference registry validates all four selected recordings and reports SHA256', async () => {
  const service = createVoiceService({ voiceRoot });
  const profiles = await service.profiles();
  assert.equal(profiles.length, 2);
  for (const profile of profiles) { assert.equal(profile.available, true); assert.match(profile.sha256, /^[a-f0-9]{64}$/); }
  assert.throws(() => validateWav(Buffer.from('not a WAV')));
});
test('stream sends app reference bytes and checks terminal state after PCM, ignoring backend URLs', async () => {
  const fake = fixture();
  const service = createVoiceService({ voiceRoot, fetchImpl: fake.fetchImpl });
  const packets = [];
  const result = await service.stream(options, packet => packets.push(packet), 42);
  assert.equal(result.ok, true);
  assert.equal(result.profile, 'momotamu.selected');
  assert.equal(result.samples, 3);
  assert.deepEqual(packets.map(packet => packet.type), ['start', 'pcm', 'pcm', 'end']);
  const create = fake.calls.find(call => call.route === '/api/speech-sessions');
  assert.equal(create.body.mode, 'voice-directed');
  assert.equal(create.body.output_retention, 'session');
  assert.equal(create.body.voice_direction, 'Kind and girly with a pleasant tone');
  assert.equal(create.body.seed, 42425);
  assert.equal(create.body.inference_timesteps, 8);
  assert.equal(create.body.single_utterance, true);
  assert.equal(create.body.narration_continuation, undefined);
  assert.equal(create.body.reference_profile, 'momotamu.selected');
  assert.equal(create.body.ref_audio_base64, (await fs.readFile(path.join(voiceRoot, 'momotamu/momotamu-reference-original-jp.wav'))).toString('base64'));
});

test('old or archive-only backends are rejected before preparation, reference upload or text submission', async () => {
  for (const retention of [null, ['archive'], 'session']) {
    const fake = fixture({retention});
    let prepared = false;
    const service = createVoiceService({voiceRoot, fetchImpl: fake.fetchImpl, beforeGenerate: () => {prepared = true;}});
    const result = await service.stream({...options, output_retention: 'archive'}, () => {}, 42);
    assert.equal(result.ok, false);
    assert.match(result.error, /session-only.*restart/i);
    assert.equal(prepared, false);
    assert.deepEqual(fake.calls.map(call => call.route), ['/api/health']);
  }
});
test('failed generation cannot be reported as completed because audio EOF arrived', async () => {
  const fake = fixture({ failed: true });
  const service = createVoiceService({ voiceRoot, fetchImpl: fake.fetchImpl });
  const packets = [];
  const result = await service.stream(options, packet => packets.push(packet), 42);
  assert.equal(result.ok, false); assert.equal(result.error, 'GPU failure');
  assert.equal(packets.at(-1).type, 'error');
  assert(fake.calls.some(call => call.route.endsWith('/cancel')));
});
test('Stop during creation cancels a late session and never submits text', async () => {
  const fake = fixture({ delayCreate: 80 });
  const service = createVoiceService({ voiceRoot, fetchImpl: fake.fetchImpl });
  const running = service.stream(options, () => {}, 42);
  while (!fake.calls.some(call => call.route === '/api/speech-sessions')) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(service.cancel(options.id, 99).cancelled, false);
  assert.equal(service.cancel(options.id, 42).cancelled, true);
  const result = await running;
  assert.equal(result.cancelled, true);
  assert(fake.calls.some(call => call.route.endsWith('/cancel')));
  assert(!fake.calls.some(call => call.route.endsWith('/text')));
});
test('bounded buffering waits for playback acknowledgements and wakes on Stop', async () => {
  const fake = fixture({ long: true });
  const service = createVoiceService({ voiceRoot, fetchImpl: fake.fetchImpl, bufferSeconds: 0.5, timeoutMs: 3000 });
  const packets = [];
  const running = service.stream(options, packet => packets.push(packet), 42);
  while (!packets.some(packet => packet.type === 'pcm')) await new Promise(resolve => setTimeout(resolve, 5));
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(packets.filter(packet => packet.type === 'pcm').length, 1);
  service.consumed(options.id, 48000, 99);
  assert.equal(packets.filter(packet => packet.type === 'pcm').length, 1);
  service.cancelOwner(42);
  assert.equal((await running).cancelled, true);
});
test('timeout releases a blocked playback queue', async () => {
  const fake = fixture({ long: true });
  const service = createVoiceService({ voiceRoot, fetchImpl: fake.fetchImpl, bufferSeconds: 0.5, timeoutMs: 60 });
  const result = await service.stream(options, () => {}, 42);
  assert.equal(result.ok, false); assert.equal(result.cancelled, false); assert.match(result.error, /timed out/);
});
test('invalid requests never reach the engine; optional companions use selected clones', async () => {
  const fake = fixture(); const service = createVoiceService({ voiceRoot, fetchImpl: fake.fetchImpl });
  for (const opts of [{ ...options, actor: 'unknown' }, { ...options, text: 'a'.repeat(8001) }, { ...options, baseURL: 'http://example.com' }]) {
    assert.equal((await service.stream(opts, () => {}, 42)).ok, false);
  }
  assert.equal(fake.calls.length, 0);
  assert.equal((await service.stream({ ...options, actor: 'vivi' }, () => {}, 42)).ok, true);
  assert.equal(fake.calls.find(call => call.route === '/api/speech-sessions').body.mode, 'voice-clone');
});
test('profile paths cannot escape the voice folder', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'discussion-voice-test-'));
  try {
    const references = path.join(temp, 'voice'); await fs.mkdir(references);
    await fs.copyFile(path.join(voiceRoot, 'momotamu/momotamu-reference-original-jp.wav'), path.join(temp, 'outside.wav'));
    await fs.writeFile(path.join(references, 'profiles.json'), JSON.stringify({ schemaVersion: 1, profiles: { 'momotamu.selected': { file: '../outside.wav' } } }));
    const fake = fixture(); const service = createVoiceService({ voiceRoot: references, fetchImpl: fake.fetchImpl });
    const result = await service.stream(options, () => {}, 42);
    assert.equal(result.ok, false); assert.match(result.error, /inside the voice folder/);
    assert(!fake.calls.some(call => call.route === '/api/speech-sessions'));
  } finally { await fs.rm(temp, { recursive: true, force: true }); }
});
test('hidden model reasoning is never spoken or used to select a clone profile', async () => {
  const fake = fixture(); const service = createVoiceService({ voiceRoot, fetchImpl: fake.fetchImpl });
  const result = await service.stream({ ...options, text: '<think>日本語の内部思考</think>Hello, friend.' }, () => {}, 42);
  assert.equal(result.profile, 'momotamu.selected');
  assert.equal(fake.calls.find(call => call.route.endsWith('/text')).body.delta, 'Hello, friend.');
  assert.equal((await service.stream({ ...options, text: '<think>Unfinished internal reasoning' }, () => {}, 42)).ok, false);
});

test('all references condition English, Swedish and Japanese without a design fallback', async () => {
  const registry=JSON.parse(await fs.readFile(path.join(voiceRoot,'profiles.json'),'utf8'));
  for(const actor of ['momotamu','vivi'])for(const language of ['English','Swedish','Japanese']){
    const fake=fixture(),service=createVoiceService({voiceRoot,fetchImpl:fake.fetchImpl});
    const result=await service.stream({...options,actor,language},()=>{},42);
    assert.equal(result.ok,true,result.error);assert.equal(result.profile,actor+'.selected');
    const payload=fake.calls.find(c=>c.route==='/api/speech-sessions').body;
    const momotamu=actor==='momotamu';
    assert.equal(payload.mode,momotamu?'voice-directed':'voice-clone');assert.equal(payload.language,language);
    assert.equal(payload.ref_audio_base64,(await fs.readFile(path.join(voiceRoot,registry.profiles[actor+'.selected'].file))).toString('base64'));
    assert.equal(payload.voice_design,undefined);
    if(momotamu){
      assert.equal(payload.voice_direction,'Kind and girly with a pleasant tone');
      assert.equal(payload.seed,42425);assert.equal(payload.inference_timesteps,8);
    }else{
      assert.equal(payload.voice_direction,undefined);assert.equal(payload.inference_timesteps,10);
      assert.equal(payload.seed,28);
    }
  }
});

test('momotamu appends an on-the-fly direction and does not repeat her standard phrase', async () => {
  const phrase = 'Kind and girly with a pleasant tone';
  const fake = fixture(), service = createVoiceService({ voiceRoot, fetchImpl: fake.fetchImpl });
  assert.equal((await service.stream({ ...options, id: 'voice-test-soft', voiceDirection: 'softly' }, () => {}, 42)).ok, true);
  assert.equal(fake.calls.find(call => call.route === '/api/speech-sessions').body.voice_direction, `${phrase}. softly`);
  const again = fixture(), second = createVoiceService({ voiceRoot, fetchImpl: again.fetchImpl });
  const already = `${phrase}, a little slower`;
  assert.equal((await second.stream({ ...options, voiceDirection: already }, () => {}, 42)).ok, true);
  assert.equal(again.calls.find(call => call.route === '/api/speech-sessions').body.voice_direction, already);
});

test('a foreign voice backend is rejected before synthesis or model operations', async () => {
 const fake=fixture({service:'other-app-voice'});
 const service=createVoiceService({voiceRoot,fetchImpl:fake.fetchImpl});
 const result=await service.stream(options,()=>{},42);
 assert.equal(result.ok,false);assert.match(result.error,/belongs to another app/);
 assert.deepEqual(fake.calls.map(c=>c.route),['/api/health']);
});

test('generated replies strip Markdown for voice while literal Speech preserves it', async()=>{
  const text='Here are two words:\n* **Hej** (Hello)\n* **Tack** (Thank you)';
  for(const verbatim of [false,true]){
    const fake=fixture(),service=createVoiceService({voiceRoot,fetchImpl:fake.fetchImpl});
    const result=await service.stream({...options,text,verbatim},()=>{},42);
    assert.equal(result.ok,true);
    assert.equal(fake.calls.find(call=>call.route.endsWith('/text')).body.delta,verbatim?text:'Here are two words:\nHej (Hello)\nTack (Thank you)');
  }
  const {spokenText}=require('../src/conversation/conversation-model');
  assert.equal(spokenText('2 * 3 = 6, file_name, and **a small smile**.'),'2 * 3 = 6, file_name, and a small smile.');
  assert.equal(spokenText('| Metric | Score |\n|---|---|\n| Accuracy | 99% |'),'Metric Score Accuracy 99%');
  assert.equal(spokenText('Hello world! 😊✨ Have fun.'),'Hello world! Have fun.');
});
