/* PCM playback stays in the renderer. Same clock as Live Conversation:
   device rate, resampled PCM, 1.2 s before the speaker opens, 0.5 s packets,
   and at most 4 s queued so the playhead stays behind VoiceGen. */
(() => {
  'use strict';
  const PREBUFFER_SECONDS = 1.2;
  const MAX_BUFFER_SECONDS = 4;
  const PACKET_SECONDS = 0.5;
  class VoicePlayer {
    constructor(bridge, { onLevel = () => {}, onPlayback = () => {}, workletURL = 'src/voice/voice-pcm-worklet.js', sinkId = '' } = {}) {
      this.bridge = bridge; this.onLevel = onLevel; this.onPlayback = onPlayback; this.workletURL = workletURL; this.sinkId = sinkId;
      this.receivedSamples = 0; this.consumedSamples = 0; this.queuedContextSamples = 0;
      this.stopped = false; this.drained = false; this.pendingByte = null; this.armed = false; this.playbackStarted = false; this.endedPosted = false;
      this.sourceSampleRate = 0; this.pendingTail = null; this.closing = false;
      this.resamplePhase = 0; this.lastSourceSample = 0; this.hasLastSourceSample = false;
      this.done = new Promise(resolve => { this.resolve = resolve; });
    }
    observe(type) { try { this.onPlayback({ type, received: this.receivedSamples, consumed: this.consumedSamples, rate: this.context?.sampleRate || 0 }); } catch { /* Presentation cannot interrupt audio. */ } }
    async prepare() {
      this.context = new AudioContext();
      if (this.sinkId && this.sinkId !== 'default') {
        if (typeof this.context.setSinkId !== 'function') { await this.context.close(); throw Error('This audio runtime cannot select an output device. Use normal speakers.'); }
        try { await this.context.setSinkId(this.sinkId); } catch (error) { await this.context.close(); throw Error('Could not open the selected meeting audio device: ' + error.message + '. Use normal speakers.'); }
      }
      await this.context.audioWorklet.addModule(this.workletURL);
      if (this.stopped) { await this.context.close(); return; }
      this.node = new AudioWorkletNode(this.context, 'voice-conversation-pcm-processor', { outputChannelCount: [1] });
      this.node.connect(this.context.destination);
      this.node.port.onmessage = event => {
        if (this.stopped || this.drained) return;
        if (event.data.type === 'level') this.onLevel(Number.isFinite(event.data.rms) ? Math.max(0, Math.min(1, event.data.rms)) : 0);
        if (event.data.type === 'consumed' && this.id) {
          const samples = event.data.samples;
          const rate = this.context.sampleRate || samples;
          const sourceSamples = Math.max(1, Math.round(samples * (this.sourceSampleRate || rate) / rate));
          this.bridge.ttsConsumed(this.id, sourceSamples);
          this.consumedSamples += samples;
          this.queuedContextSamples = Math.max(0, this.queuedContextSamples - samples);
          this.observe('playing');
          this.flushPending();
        }
        if (event.data.type === 'underrun' && this.consumedSamples > 0) this.observe('buffering');
        if (event.data.type === 'drained') { this.drained = true; this.observe('drained'); this.onLevel(0); this.resolve(); this.context.close().catch(() => {}); }
      };
      await this.context.resume();
      if (this.context.state !== 'running') throw new Error('Audio playback could not start.');
    }
    decode(bytes) {
      const aligned = this.pendingByte === null ? bytes : new Uint8Array([this.pendingByte, ...bytes]);
      this.pendingByte = aligned.length % 2 ? aligned[aligned.length - 1] : null;
      const samples = new Float32Array(Math.floor(aligned.length / 2));
      const view = new DataView(aligned.buffer, aligned.byteOffset, aligned.byteLength);
      for (let index = 0; index < samples.length; index++) samples[index] = view.getInt16(index * 2, true) / 32768;
      return samples;
    }
    resample(samples) {
      const destinationRate = this.context.sampleRate;
      const sourceRate = this.sourceSampleRate || destinationRate;
      if (destinationRate === sourceRate || !samples.length) return samples;
      const ratio = sourceRate / destinationRate;
      const outputLength = Math.max(1, Math.round((samples.length - this.resamplePhase) / ratio));
      const output = new Float32Array(outputLength);
      for (let index = 0; index < outputLength; index++) {
        const position = this.resamplePhase + index * ratio;
        const left = Math.floor(position);
        const mix = position - left;
        const sLeft = left < 0 ? (this.hasLastSourceSample ? this.lastSourceSample : samples[0]) : samples[Math.min(samples.length - 1, left)];
        const sRight = left + 1 < samples.length ? samples[left + 1] : (samples.length > 1 ? 2 * samples[samples.length - 1] - samples[samples.length - 2] : samples[samples.length - 1]);
        output[index] = sLeft * (1 - mix) + sRight * mix;
      }
      this.resamplePhase = (this.resamplePhase + outputLength * ratio) - samples.length;
      this.lastSourceSample = samples[samples.length - 1];
      this.hasLastSourceSample = true;
      return output;
    }
    startPlayback() {
      if (this.playbackStarted || !this.armed || !this.node) return;
      this.playbackStarted = true;
      this.node.port.postMessage({ type: 'start' });
    }
    enqueue(samples, force) {
      if (!samples.length || this.stopped) return;
      const rate = this.context.sampleRate;
      const packetSamples = Math.max(1, Math.round(rate * PACKET_SECONDS));
      const limit = Math.max(1, Math.round(rate * MAX_BUFFER_SECONDS));
      let offset = 0;
      while (offset < samples.length) {
        const count = Math.min(packetSamples, samples.length - offset);
        if (!force && this.queuedContextSamples > 0 && this.queuedContextSamples + count > limit) {
          this.pendingTail = samples.subarray(offset);
          return;
        }
        const packet = samples.slice(offset, offset + count);
        this.queuedContextSamples += packet.length;
        this.receivedSamples += packet.length;
        this.node.port.postMessage({ type: 'samples', samples: packet.buffer }, [packet.buffer]);
        this.observe('buffer');
        if (this.queuedContextSamples >= Math.round(rate * PREBUFFER_SECONDS)) this.startPlayback();
        offset += count;
      }
      this.pendingTail = null;
    }
    flushPending() {
      if (!this.pendingTail || this.stopped) return;
      const tail = this.pendingTail;
      this.pendingTail = null;
      this.enqueue(tail, this.closing);
    }
    receive(packet) {
      if (this.stopped) return;
      this.id = packet.id;
      if (packet.type === 'start') {
        if (!Number.isInteger(packet.sampleRate) || packet.sampleRate < 8000 || packet.sampleRate > 96000) throw new Error('Voice sample rate is not supported.');
        this.sourceSampleRate = packet.sampleRate;
        this.resamplePhase = 0;
        this.lastSourceSample = 0;
        this.hasLastSourceSample = false;
        this.armed = true;
      } else if (packet.type === 'pcm') {
        if (!this.armed) return;
        const decoded = this.decode(new Uint8Array(packet.bytes));
        if (decoded.length) this.enqueue(this.resample(decoded));
      } else if (packet.type === 'end') {
        if (this.pendingByte !== null) throw new Error('Truncated PCM packet.');
        this.closing = true;
        this.flushPending();
        this.startPlayback();
        if (!this.endedPosted) { this.endedPosted = true; this.node.port.postMessage({ type: 'end' }); }
      } else if (packet.type === 'error') this.stop();
    }
    stop() {
      if (this.stopped) return;
      this.stopped = true;
      this.resamplePhase = 0;
      this.lastSourceSample = 0;
      this.hasLastSourceSample = false;
      this.pendingTail = null;
      if (!this.drained) this.observe('stopped');
      this.onLevel(0);
      this.node?.port.postMessage({ type: 'stop' });
      this.node?.disconnect();
      if (this.context && this.context.state !== 'closed') this.context.close().catch(() => {});
      this.resolve();
    }
  }
  window.DiscussionVoicePlayer = VoicePlayer;
})();
