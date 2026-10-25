'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function harness(options, sink) {
  const sent = [], ack = [];
  class Context {
    constructor() { this.sampleRate = 48000; this.state = 'running'; this.audioWorklet = { addModule: async () => {} }; }
    async resume() {} async close() { this.state = 'closed'; }
  }
  class Node { constructor() { this.port = { postMessage: message => sent.push(message) }; } connect() {} disconnect() {} }
  if(sink)Context.prototype.setSinkId=sink;
  const context = vm.createContext({ window: {}, AudioContext: Context, AudioWorkletNode: Node, Uint8Array, Float32Array, DataView });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src/voice/voice-player.js'), 'utf8'), context);
  const player = new context.window.DiscussionVoicePlayer({ ttsConsumed: (...args) => ack.push(args) }, options);
  return { player, sent, ack };
}
test('PCM decoder preserves signed samples across odd network packet boundaries and drains', async () => {
  const { player, sent, ack } = harness(); await player.prepare();
  player.receive({ id: 'voice-123', type: 'start', sampleRate: 48000 });
  player.receive({ id: 'voice-123', type: 'pcm', bytes: [0, 128, 255] });
  player.receive({ id: 'voice-123', type: 'pcm', bytes: [127, 0, 0] });
  const samples = sent.filter(message => message.type === 'samples').flatMap(message => [...new Float32Array(message.samples)]);
  assert.deepEqual(samples, [-1, 32767 / 32768, 0]);
  player.node.port.onmessage({ data: { type: 'consumed', samples: 3 } });
  assert.deepEqual(ack, [['voice-123', 3]]);
  player.receive({ id: 'voice-123', type: 'end' });
  player.node.port.onmessage({ data: { type: 'drained' } });
  await player.done; assert.equal(player.context.state, 'closed');
});
test('Stop settles playback without waiting for ended and drops late packets', async () => {
  const { player, sent } = harness(); await player.prepare(); player.stop(); await player.done;
  const count = sent.length;
  player.receive({ id: 'voice-123', type: 'pcm', bytes: [1, 2] });
  assert.equal(sent.length, count); assert.equal(player.context.state, 'closed');
});
test('Selected output is opened before playback; missing or failed routes close the context',async()=>{
  const opened=[],routed=harness({sinkId:'meeting-device'},async function(id){opened.push(id);});
  await routed.player.prepare();assert.deepEqual(opened,['meeting-device']);routed.player.stop();
  const unsupported=harness({sinkId:'meeting-device'}).player;
  await assert.rejects(unsupported.prepare(),/Use normal speakers/);assert.equal(unsupported.context.state,'closed');
  const failed=harness({sinkId:'removed-device'},async()=>{throw Error('Device unavailable');}).player;
  await assert.rejects(failed.prepare(),/Device unavailable/);assert.equal(failed.context.state,'closed');
});
test('playback waits for 1.2 seconds of audio, and a short clip still starts when the stream ends', async () => {
  const { player, sent } = harness(); await player.prepare();
  player.receive({ id: 'voice-123', type: 'start', sampleRate: 48000 });
  player.receive({ id: 'voice-123', type: 'pcm', bytes: new Uint8Array(48000) });
  assert.equal(sent.some(message => message.type === 'start'), false, 'half a second must not open the speaker');
  player.receive({ id: 'voice-123', type: 'pcm', bytes: new Uint8Array(48000 * 2) });
  assert.equal(sent.filter(message => message.type === 'start').length, 1);
  const late = harness(); await late.player.prepare();
  late.player.receive({ id: 'voice-short', type: 'start', sampleRate: 48000 });
  late.player.receive({ id: 'voice-short', type: 'pcm', bytes: [0, 0] });
  late.player.receive({ id: 'voice-short', type: 'end' });
  const types = late.sent.map(message => message.type);
  assert.deepEqual(types, ['samples', 'start', 'end']);
  late.player.stop();
  player.stop();
});
test('VoiceGen audio is resampled onto the device rate, and a truncated packet still fails', async () => {
  const { player, sent } = harness(); await player.prepare();
  player.receive({ id: 'voice-123', type: 'start', sampleRate: 24000 });
  player.receive({ id: 'voice-123', type: 'pcm', bytes: [0, 0, 0, 64] });
  const samples = sent.filter(message => message.type === 'samples').flatMap(message => [...new Float32Array(message.samples)]);
  assert.equal(samples.length, 4);
  player.receive({ id: 'voice-123', type: 'pcm', bytes: [1] });
  assert.throws(() => player.receive({ id: 'voice-123', type: 'end' }), /Truncated/); player.stop();
});

test('multi-packet continuous resampling preserves phase and smooth waveform continuity across arbitrary chunk boundaries', async () => {
  const { player, sent } = harness(); await player.prepare();
  player.receive({ id: 'voice-sine', type: 'start', sampleRate: 24000 });
  const totalIn = 512 * 5;
  for (let chunk = 0; chunk < 5; chunk++) {
    const bytes = new Uint8Array(512 * 2);
    const view = new DataView(bytes.buffer);
    for (let i = 0; i < 512; i++) {
      const val = Math.sin(2 * Math.PI * 440 * (chunk * 512 + i) / 24000);
      view.setInt16(i * 2, Math.round(val * 32767), true);
    }
    player.receive({ id: 'voice-sine', type: 'pcm', bytes });
  }
  const samples = sent.filter(message => message.type === 'samples').flatMap(message => [...new Float32Array(message.samples)]);
  assert.equal(samples.length, totalIn * 2);
  let maxStep = 0;
  for (let i = 1; i < samples.length; i++) {
    const step = Math.abs(samples[i] - samples[i - 1]);
    if (step > maxStep) maxStep = step;
  }
  assert(maxStep < 0.065, 'Step should be continuous without boundary spikes: ' + maxStep);
  player.stop();
});

test('Only active playback meters reach the sprite callback; stop and drain fence late worklet levels', async () => {
  const levels=[],{player}=harness({onLevel:rms=>levels.push(rms)});await player.prepare();
  player.node.port.onmessage({data:{type:'level',rms:.2}});assert.deepEqual(levels,[.2]);
  player.stop();const count=levels.length;player.node.port.onmessage({data:{type:'level',rms:.9}});assert.equal(levels.length,count);assert.equal(levels.at(-1),0);
  const other=harness({onLevel:rms=>levels.push(rms)}).player;await other.prepare();other.node.port.onmessage({data:{type:'drained'}});const end=levels.length;other.node.port.onmessage({data:{type:'level',rms:.9}});assert.equal(levels.length,end);
});

test('flow playback observes consumed samples, and observer failures cannot interrupt PCM',async()=>{
 const events=[],{player,ack}=harness({onPlayback:event=>{events.push(event);throw Error('diagram unavailable');}});await player.prepare();
 player.receive({id:'voice-flow',type:'start',sampleRate:48000});
 player.receive({id:'voice-flow',type:'pcm',bytes:[0,0,0,0]});
 assert.equal(events[0].type,'buffer');assert.equal(events[0].received,2);assert.equal(events[0].consumed,0);
 player.node.port.onmessage({data:{type:'consumed',samples:2}});
 assert.equal(events[1].type,'playing');assert.equal(events[1].consumed,2);assert.deepEqual(ack,[['voice-flow',2]]);
 player.receive({id:'voice-flow',type:'end'});player.node.port.onmessage({data:{type:'drained'}});await player.done;
 assert.equal(events.at(-1).type,'drained');assert.equal(player.context.state,'closed');
});
