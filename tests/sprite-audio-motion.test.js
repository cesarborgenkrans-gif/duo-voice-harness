'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const A = require('../src/motion/sprite-audio-motion');
const root = path.resolve(__dirname, '..');

const w = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(root, 'src/motion/momotamu-motion-data.js'), 'utf8'), w);
const poses = w.window.MomotamuSpeakingMotion;

function run(r, ms, value, source = 'output', id = 'voice') {
  for (let t = 0; t < ms; t += 10) {
    r.sample(source, id, value);
    r.advance(10);
  }
  return r.snapshot();
}

test('Silence/noise cannot bounce; volume changes response; old sessions cannot animate a new owner', () => {
  const r = A.createReactor();
  r.begin('output', 'voice');
  assert.equal(run(r, 1000, 0.002).squish, 0);

  const soft = run(r, 1500, 0.04).squish;
  const loud = run(r, 1500, 0.25).squish;
  assert(loud > soft * 1.4);
  assert(loud <= 0.032);

  r.begin('input', 'mic');
  assert.equal(r.sample('output', 'voice', 1), false);
  const listening = run(r, 1500, 0.25, 'input', 'mic').squish;
  assert(listening < loud);

  assert.equal(r.end('output', 'voice'), false);
  r.end('input', 'mic');
  for (let i = 0; i < 200; i++) r.advance(10);
  assert(Math.abs(r.snapshot().squish) < 0.0001);
});

test('Bounded spring settles without fresh meters and behaves consistently across display refresh rates', () => {
  const ends = [];
  for (const fps of [30, 60, 120]) {
    const r = A.createReactor();
    r.begin('output', 'voice');
    let high = 0;
    for (let t = 0; t < 1500; t += 1000 / fps) {
      r.sample('output', 'voice', 0.9);
      r.advance(1000 / fps);
      high = Math.max(high, r.snapshot().squish);
    }
    assert(high <= 0.032);
    ends.push(r.snapshot().squish);
    for (let t = 0; t < 3000; t += 1000 / fps) r.advance(1000 / fps);
    assert(Math.abs(r.snapshot().squish) < 0.0001);
    r.sample('output', 'voice', 0.3);
    r.advance(60, { enabled: false });
    assert.equal(r.snapshot().squish, 0);
  }
  assert(Math.max(...ends) - Math.min(...ends) < 0.0001);
});

test('Audio-aware speaking stays closed in silence, bridges reviewed edges, holds posture and returns from gestures', () => {
  const d = A.createSpeech(poses, { random: () => 0.31 });
  d.begin('auto', { audioDriven: true });
  d.advance(5000);
  assert.equal(d.state().frame, 0);

  const trace = [];
  for (let t = 0; t < 60000; t += 10) {
    d.setLevel(t % 6000 > 5000 ? 0 : 0.18);
    d.advance(10);
    const s = d.state();
    if (trace.at(-1)?.frame !== s.frame) trace.push({ frame: s.frame, time: t });
  }
  assert(trace.some(b => b.frame === 6), 'Blink independently of syllables');
  assert(trace.some(b => b.frame === 2), 'Occasional deliberate emphasis');
  assert(trace.some(b => [4, 5].includes(b.frame)), 'Slow posture variation');
  assert(trace.filter(b => b.frame === 0).length > 1, 'Meaningful pauses close the mouth');

  for (let i = 1; i < trace.length; i++) {
    assert(poses.compatibleDirectedEdges.some(([a, b]) => a === trace[i - 1].frame && b === trace[i].frame), `${trace[i - 1].frame}->${trace[i].frame}`);
  }
  assert(trace.some((b, i) => [1, 4, 5].includes(b.frame) && trace[i + 1]?.time - b.time >= 2000), 'Speech poses hold for seconds');
  assert(trace.every(b => b.frame !== 4), 'Pose 4 belongs only to guest curiosity');

  d.finish();
  d.advance(1000);
  assert.equal(d.state().frame, 0);
  assert.equal(d.state().completed, true);
});

test('Short word gaps do not flap whole-body poses; missing audio falls quiet and text-only speech needs no fabricated meter', () => {
  const d = A.createSpeech(poses, { random: () => 0.5 });
  d.begin('auto', { audioDriven: true });

  for (let t = 0; t < 800; t += 10) {
    d.setLevel(0.12);
    d.advance(10);
  }
  assert.equal(d.state().frame, 1);

  for (let t = 0; t < 200; t += 10) {
    d.setLevel(0);
    d.advance(10);
  }
  assert.ok([1, 3].includes(d.state().frame), 'a word gap keeps the pose or closes to its neighbour, never rest');

  d.advance(1200);
  assert.equal(d.state().frame, 0);

  d.begin('auto', { audioDriven: false });
  d.advance(1000);
  assert.equal(d.state().frame, 1);
});

function worklet(file, rate) {
  let Processor;
  const messages = [];
  class Base {
    constructor() {
      this.port = { postMessage: m => messages.push(m) };
    }
  }
  vm.runInNewContext(fs.readFileSync(path.join(root, file), 'utf8'), {
    AudioWorkletProcessor: Base,
    sampleRate: rate,
    Float32Array,
    registerProcessor: (_n, p) => (Processor = p)
  });
  return { p: new Processor(), messages };
}

test('Output worklet meters consumed PCM rather than queued PCM and includes underrun silence', () => {
  const { p, messages } = worklet('src/voice/voice-pcm-worklet.js', 48000);
  p.port.onmessage({ data: { type: 'start' } });
  p.port.onmessage({ data: { type: 'samples', samples: new Float32Array(960).fill(0.5).buffer } });

  assert.equal(messages.filter(m => m.type === 'level').length, 0);
  for (let i = 0; i < 15; i++) p.process([], [[new Float32Array(128)]]);

  const levels = messages.filter(m => m.type === 'level');
  assert.equal(levels.length, 1);
  assert(Math.abs(levels[0].rms - Math.sqrt(0.125)) < 0.00001);

  p.port.onmessage({ data: { type: 'end' } });
  p.process([], [[new Float32Array(128)]]);
  assert.equal(messages.at(-2).rms, 0);
  assert.equal(messages.at(-1).type, 'drained');
});

test('WAV analysis walks RIFF chunks and measures RMS in mono while rejecting unsupported/truncated audio', () => {
  const wav = Buffer.alloc(44 + 3200 * 2);
  wav.write('RIFF');
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(16000, 24);
  wav.writeUInt32LE(32000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(6400, 40);
  for (let i = 44; i < wav.length; i += 2) wav.writeInt16LE(8192, i);

  const e = A.wavEnvelope(wav);
  assert.equal(e.duration, 0.2);
  assert.equal(e.values.length, 5);
  assert(e.values.every(v => v === 0.25));
  assert.throws(() => A.wavEnvelope(wav.subarray(0, 60)), /Truncated/);
});

function trace(speech, levels, stepMs = 10) {
  const out = [];
  let t = 0;
  for (const value of levels) {
    if (value !== null) speech.setLevel(value);
    speech.advance(stepMs);
    t += stepMs;
    const f = speech.state().frame;
    if (!out.length || out.at(-1).frame !== f) out.push({ frame: f, at: t });
  }
  return out;
}

const pattern = (ms, fn) => Array.from({ length: Math.round(ms / 10) }, (_, i) => fn(i * 10));

test('Only a real pause returns to rest: gaps under 600 ms stay in speech, and rest holds at least 240 ms', () => {
  const d = A.createSpeech(poses, { random: () => 0.5 });
  d.begin('auto', { audioDriven: true });
  const levels = [
    ...pattern(1500, () => 0.12),
    ...pattern(500, () => 0),
    ...pattern(1200, () => 0.12),
    ...pattern(700, () => 0),
    ...pattern(30, () => 0.12),
    ...pattern(1500, () => 0.12)
  ];
  const changes = trace(d, levels);
  const rests = changes.filter(c => c.frame === 0 && c.at > 100);

  assert.ok(!changes.some(c => c.frame === 0 && c.at > 1500 && c.at <= 2000 + 200), 'a 500 ms gap must not return to rest');
  assert.equal(rests.length, 1, 'the 700 ms pause returns to rest once');
  assert.ok(rests[0].at >= 3200 + 600);
  const after = changes[changes.indexOf(rests[0]) + 1];
  assert.ok(after && after.at - rests[0].at >= 240, 'rest is held at least 240 ms');
  const edges = poses.compatibleDirectedEdges;
  for (let i = 1; i < changes.length; i++) {
    assert.ok(edges.some(([a, b]) => a === changes[i - 1].frame && b === changes[i].frame), 'reviewed edge');
  }
});

test('Loud speech alternates open and closed mouths at no more than 4 changes a second, holding each at least 180 ms', () => {
  for (const beat of [70, 130, 210]) {
    for (const [name, speech, open, closed] of [
      ['front', A.createSpeech(poses, { random: () => 0.5 }), 1, 3],
      ['3q', A.createConversationSpeech('momotamu', { random: () => 0.5 }), 2, 1]
    ]) {
      const syllables = t => (Math.floor(t / beat) % 2 ? 0.012 : 0.16);
      speech.begin('auto', { audioDriven: true });
      const changes = trace(speech, pattern(2700, syllables));
      const talk = changes.filter(c => c.at >= 400);
      assert.ok(talk.some(c => c.frame === open) && talk.some(c => c.frame === closed), name + ' alternates');
      assert.ok(talk.length >= 6, name + ' rhythm');
      for (let i = 2; i < changes.length; i++) {
        assert.ok(changes[i].at - changes[i - 1].at >= 180, name + ' hold ' + (changes[i].at - changes[i - 1].at));
      }
      for (const c of talk) {
        assert.ok(changes.filter(o => o.at > c.at && o.at < c.at + 1000).length <= 4, name + ' rate');
      }
      assert.ok(talk.every(c => c.frame === open || c.frame === closed), name + ' stays on the open/closed pair');
    }
  }
  const steady = A.createSpeech(poses, { random: () => 0.5 });
  steady.begin('auto', { audioDriven: true });
  assert.deepEqual(trace(steady, pattern(2500, () => 0.15)).map(c => c.frame), [0, 3, 1], 'a constant voice holds its open pose');
});
