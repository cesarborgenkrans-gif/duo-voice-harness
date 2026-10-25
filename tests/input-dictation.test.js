const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {EventEmitter} = require('node:events');
const {wav: packWav} = require('../src/voice/pcm-wav');
const {createInputService} = require('../src/input/input-service');
const {transcribeWav} = require('../src/input/windows-dictation');

function chunk() {
  const pcm = Buffer.alloc(6400);
  for (let i = 0; i < pcm.length; i += 2) pcm.writeInt16LE(1200, i);
  return packWav(pcm, 16000).toString('base64');
}

function service(extra = {}) {
  const calls = [];
  const dictateCalls = [];
  const api = createInputService({
    target: async () => { calls.push('target'); if (extra.model === false) throw Error('Load Gemma 4 12B with its matching audio projector in Settings → AI model.'); return {baseURL: 'http://127.0.0.1:1', model: 'gemma'}; },
    request: async () => { calls.push('request'); return extra.plan || '{"direction":"softly"}'; },
    dictate: async wav => { dictateCalls.push(wav); if (extra.dictateError) throw extra.dictateError; return extra.text || 'job interview'; },
    ...extra.hooks
  });
  return {api, calls, dictateCalls};
}

test('dictation records text without asking the AI model to listen', async () => {
  const {api, calls, dictateCalls} = service({model: false});
  const started = await api.begin(7, 'dictation');
  await api.chunk(7, {id: started.id, sequence: 0, data: chunk()});
  const result = await api.finish(7, started.id);
  assert.equal(result.text, 'job interview');
  assert.equal(result.warning, undefined);
  assert.deepEqual(calls, []);
  assert.equal(dictateCalls.length, 1);
  assert.equal(dictateCalls[0].toString('ascii', 0, 4), 'RIFF');
});

test('a worktree-style dictation still rejects silence before recognition', async () => {
  const {api, dictateCalls} = service();
  const started = await api.begin(7, 'dictation');
  const silent = packWav(Buffer.alloc(6400), 16000).toString('base64');
  await api.chunk(7, {id: started.id, sequence: 0, data: silent});
  await assert.rejects(() => api.finish(7, started.id), /almost no sound/);
  assert.equal(dictateCalls.length, 0);
});

test('conversation still requires the loaded model and keeps the original audio', async () => {
  const blocked = service({model: false});
  await assert.rejects(() => blocked.api.begin(7, 'conversation'), /Load Gemma/);
  const {api, calls, dictateCalls} = service();
  const started = await api.begin(7, 'conversation');
  await api.chunk(7, {id: started.id, sequence: 0, data: chunk()});
  const result = await api.finish(7, started.id);
  assert.equal(typeof result.token, 'string');
  assert.equal(result.text, undefined);
  assert.deepEqual(calls, ['target']);
  assert.equal(dictateCalls.length, 0);
  const shown = await api.transcribe(7, result.token);
  assert.equal(shown.text, 'job interview');
  assert.deepEqual(calls, ['target']);
});

test('spoken script text is ready when delivery suggestion has no model', async () => {
  const {api, calls} = service({model: false});
  const started = await api.begin(7, 'speech');
  await api.chunk(7, {id: started.id, sequence: 0, data: chunk()});
  const result = await api.finish(7, started.id);
  assert.equal(result.text, 'job interview');
  assert.match(result.warning, /delivery suggestion needs the AI model/);
  assert.deepEqual(calls, ['target']);
});

test('spoken script still asks the model for delivery when it is already loaded', async () => {
  const {api, calls} = service();
  const started = await api.begin(7, 'speech');
  await api.chunk(7, {id: started.id, sequence: 0, data: chunk()});
  const result = await api.finish(7, started.id);
  assert.equal(result.text, 'job interview');
  assert.equal(result.voiceDirection, 'softly');
  assert.deepEqual(calls, ['target', 'request']);
});

function child() {
  const proc = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = () => { proc.killed = true; proc.emit('close', 1); };
  return proc;
}

test('windows dictation reads recognizer text and removes its temporary files', async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'duo-dictate-test-'));
  const wav = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(80)]);
  try {
    let command = '';
    const text = await transcribeWav(wav, {platform: 'win32', folder, timeoutMs: 5000, spawnImpl: (cmd, argv) => {
      command = cmd;
      const proc = child();
      queueMicrotask(async () => {
        const seen = await fs.readFile(argv[argv.indexOf('-WavPath') + 1]);
        assert.deepEqual(seen, wav);
        await fs.writeFile(argv[argv.indexOf('-ResultPath') + 1], JSON.stringify({ok: true, text: ' job interview ', error: ''}));
        proc.emit('close', 0);
      });
      return proc;
    }});
    assert.equal(text, 'job interview');
    assert.match(command, /powershell\.exe$/i);
    assert.deepEqual(await fs.readdir(folder), []);
  } finally { await fs.rm(folder, {recursive: true, force: true}); }
});

test('windows dictation reports recognizer failure and cancellation', async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'duo-dictate-test-'));
  const wav = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(40)]);
  try {
    await assert.rejects(transcribeWav(wav, {platform: 'linux'}), /Windows speech recognition/);
    await assert.rejects(transcribeWav(wav, {platform: 'win32', folder, spawnImpl: (cmd, argv) => {
      const proc = child();
      queueMicrotask(async () => {
        await fs.writeFile(argv[argv.indexOf('-ResultPath') + 1], JSON.stringify({ok: false, text: '', error: 'No clear words were recognized.'}));
        proc.emit('close', 3);
      });
      return proc;
    }}), /No clear words/);
    const controller = new AbortController();
    let killed = false;
    const pending = transcribeWav(wav, {platform: 'win32', folder, signal: controller.signal, spawnImpl: () => {
      const proc = child();
      proc.kill = () => { killed = true; proc.emit('close', 1); };
      queueMicrotask(() => controller.abort(Error('Recording cancelled.')));
      return proc;
    }});
    await assert.rejects(pending, /Recording cancelled/);
    assert.equal(killed, true);
  } finally { await fs.rm(folder, {recursive: true, force: true}); }
});
