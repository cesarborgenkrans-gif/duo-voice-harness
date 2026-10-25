// SPDX-License-Identifier: Apache-2.0
// Adapted and modified for Duo Voice Harness from VoiceGen/Live Conversation.
// See runtime/voicegen-oui/{LICENSE,NOTICE,ORIGIN.md} for license and provenance.
/*
   One mono PCM AudioWorklet for the experimental Character Conversation lane.
   It receives transferable Float32 packets from the page, reports consumed
   samples for bounded backpressure, and drains cleanly without a native audio
   consumer. This file is served from 'self' so Duo Voice Harness's CSP stays strict.
*/

class VoiceConversationPCMProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.queue = [];
    this.current = null;
    this.offset = 0;
    this.started = false;
    this.ended = false;
    this.stopped = false;
    this.drained = false;
    this.wasUnderrun = false;
    this.underrunFrames = 0;
    this.consumedSinceReport = 0;
    this.levelSquares = 0;
    this.levelSamples = 0;
    this.port.onmessage = (event) => {
      const data = event.data || {};
      if (data.type === 'samples' && data.samples) {
        this.queue.push(new Float32Array(data.samples));
        this.wasUnderrun = false;
        this.underrunFrames = 0;
      } else if (data.type === 'start') {
        this.started = true;
      } else if (data.type === 'end') {
        this.ended = true;
        this.wasUnderrun = false;
        this.underrunFrames = 0;
      } else if (data.type === 'stop') {
        this.stopped = true;
        this.queue = [];
        this.current = null;
      }
    };
  }

  reportConsumed(force) {
    if (!this.consumedSinceReport || (!force && this.consumedSinceReport < 1024)) return;
    this.port.postMessage({ type: 'consumed', samples: this.consumedSinceReport });
    this.consumedSinceReport = 0;
  }

  finish(stopped) {
    this.reportConsumed(true);
    if (this.drained) return false;
    this.drained = true;
    this.port.postMessage({ type: 'level', rms: 0 });
    this.port.postMessage({ type: 'drained', stopped: !!stopped });
    return false;
  }

  process(inputs, outputs) {
    const output = outputs[0] && outputs[0][0];
    if (!output) return this.finish(this.stopped);
    output.fill(0);
    if (this.stopped) return this.finish(true);
    if (!this.started) return true;

    let writeOffset = 0;
    while (writeOffset < output.length) {
      if (!this.current) {
        this.current = this.queue.shift() || null;
        this.offset = 0;
      }
      if (!this.current) break;
      const available = this.current.length - this.offset;
      const count = Math.min(available, output.length - writeOffset);
      output.set(this.current.subarray(this.offset, this.offset + count), writeOffset);
      writeOffset += count;
      this.offset += count;
      this.consumedSinceReport += count;
      if (this.offset >= this.current.length) {
        this.current = null;
        this.offset = 0;
      }
    }
    this.reportConsumed(false);
    // Meter what the device is rendering, including underrun silence. Network
    // packet arrival is not playback time. A full 40 ms window avoids block jitter.
    for (const value of output) {
      this.levelSquares += value * value;
      if (++this.levelSamples >= Math.round(sampleRate * .04)) {
        this.port.postMessage({ type: 'level', rms: Math.sqrt(this.levelSquares / this.levelSamples) });
        this.levelSquares = this.levelSamples = 0;
      }
    }

    if (writeOffset === 0 && !this.ended && !this.wasUnderrun) {
      if (++this.underrunFrames >= Math.max(1, Math.round(sampleRate * .05 / output.length))) {
        this.wasUnderrun = true;
        this.port.postMessage({ type: 'underrun' });
      }
    } else if (writeOffset > 0) {
      this.underrunFrames = 0;
    }
    if (!this.current && !this.queue.length && this.ended) return this.finish(false);
    return true;
  }
}

registerProcessor('voice-conversation-pcm-processor', VoiceConversationPCMProcessor);
