'use strict';

const { DEFAULT_VOICE_URL } = require('./voice-service');

// Keep the allocation lease until synthesis (or process shutdown) has settled.
function createVoiceWarmup({ runtime, reference, gpuBudget, fetchImpl = fetch, timeoutMs = 180000 }) {
  let operation = null;
  function warm(actor = 'momotamu') {
    if (operation) return Promise.resolve({ ok: false, error: 'Voice is already warming up.' });
    const job = { controller: new AbortController(), started: false, cancelled: false };
    operation = job;
    job.promise = (async () => {
      let timer;
      const alive = () => job.controller.signal.throwIfAborted();
      try {
        const status = await runtime.status(); alive();
        if (!status.connected || !status.owned) throw Error('Start the app’s voice service before warming it up.');
        if (!status.health?.warmup?.available) throw Error('Stop and start voice to enable warm-up in the updated backend.');
        if (status.health.busy) throw Error('Finish the current voice generation before warming up.');
        const selected = await reference(actor); alive();
        return await gpuBudget.run('voice warm-up', async () => {
          try {
            await gpuBudget.beforeVoice(); alive();
            timer = setTimeout(() => job.controller.abort(Error('Voice warm-up timed out.')), timeoutMs);
            job.started = true;
            const response = await fetchImpl(DEFAULT_VOICE_URL + '/api/warmup', {
              method: 'POST', redirect: 'error', signal: job.controller.signal,
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ reference_profile: selected.id, ref_audio_base64: selected.base64 })
            });
            const result = await response.json(); alive();
            if (!response.ok) throw Error(result.error || `Voice warm-up HTTP ${response.status}`);
            if (result.warmup?.state !== 'ready' || !(result.warmup.samples > 0)) throw Error('Voice warm-up did not produce audio.');
            return { ok: true, warmup: result.warmup };
          } catch (error) {
            // An aborted HTTP request alone does not stop GPU work in Python.
            if (job.started) {
              const stopped = await runtime.stop();
              job.stopped = stopped.stopped;
              if (!stopped.ok) {
                job.stopFailed = true;
                throw Error(error.message + ' ' + (stopped.error || 'Stop voice and check GPU status.'));
              }
            }
            throw error;
          }
        });
      } catch (error) {
        return { ok: false, cancelled: job.cancelled && !job.stopFailed, stopped: !!job.stopped, error: error.message };
      } finally {
        clearTimeout(timer);
        if (operation === job) operation = null;
      }
    })();
    return job.promise;
  }
  async function cancel() {
    if (!operation) return { ok: true, cancelled: false };
    const job = operation;
    job.cancelled = true;
    job.controller.abort(Error('Voice warm-up cancelled.'));
    return job.promise;
  }
  return { warm, cancel, get busy() { return operation !== null; } };
}

module.exports = { createVoiceWarmup };
