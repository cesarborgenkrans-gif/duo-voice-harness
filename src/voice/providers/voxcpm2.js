'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const DEFAULT_VOICE_URL = 'http://127.0.0.1:3234';
const SERVICE_NAME = 'duo-voice-harness-voice';
const ACTORS = ['momotamu', 'vivi'];

function normalizeVoiceURL(value = DEFAULT_VOICE_URL) {
  const url = new URL(value || DEFAULT_VOICE_URL);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password || !['', '/'].includes(url.pathname) || url.search || url.hash) {
    throw new Error('Voice service must use a loopback HTTP address with no path or credentials.');
  }
  return url.origin;
}

function selectProfile(actor) {
  if (!ACTORS.includes(actor)) throw new Error('Unknown voice actor.');
  return actor + '.selected';
}

function speechText(text) {
  return require('../../conversation/conversation-model').spokenText(text);
}

const MOMOTAMU_DIRECTION = 'Kind and girly with a pleasant tone';

function momotamuDirection(extra) {
  const trimmed = typeof extra === 'string' ? extra.trim() : '';
  if (!trimmed || trimmed.toLowerCase() === MOMOTAMU_DIRECTION.toLowerCase()) return MOMOTAMU_DIRECTION;
  if (trimmed.toLowerCase().startsWith(MOMOTAMU_DIRECTION.toLowerCase())) return trimmed.slice(0, 600);
  return `${MOMOTAMU_DIRECTION}. ${trimmed}`.slice(0, 600);
}

function validateWav(bytes) {
  if (bytes.length < 44 || bytes.length > 20 * 1024 * 1024 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') throw new Error('Voice reference must be a PCM WAV smaller than 20 MiB.');
  let fmt = false, audio = false;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const size = bytes.readUInt32LE(offset + 4);
    const kind = bytes.toString('ascii', offset, offset + 4);
    if (offset + 8 + size > bytes.length) throw new Error('Voice reference WAV is truncated.');
    if (kind === 'fmt ') {
      if (size < 16 || bytes.readUInt16LE(offset + 8) !== 1 || ![1, 2].includes(bytes.readUInt16LE(offset + 10))) throw new Error('Voice reference must be mono or stereo PCM WAV.');
      fmt = true;
    }
    if (kind === 'data' && size > 0) audio = true;
    offset += 8 + size + (size % 2);
  }
  if (!fmt || !audio) throw new Error('Voice reference WAV has no PCM audio.');
}

function createVoxCPM2Provider({ voiceRoot, fetchImpl = fetch, timeoutMs = 180000, bufferSeconds = 8,beforeGenerate,engineBusy=()=>false,decisionLog=null }) {
  const active = new Map();
  // Troubleshooting only: a failed decision log never affects synthesis. Lengths only, never words.
  const note = build => { try { decisionLog?.(build()); } catch {} };
  const noteBase = o => { o = o || {}; const s = v => typeof v === 'string' ? v : undefined; return { source: 'main', flowId: s(o.flow?.id), decisionId: s(o.decisionId), voiceRequestId: s(o.id), speaker: s(o.actor), languageSent: s(o.language), recipePreference: s(o.preference), verbatim: o.verbatim === true, textLength: typeof o.text === 'string' ? o.text.length : undefined }; };
  async function request(base, route, body, signal) {
    const response = await fetchImpl(base + route, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal, redirect: 'error' });
    const payload = await response.json();
    if (!response.ok) { const error = new Error(payload.error || `VoiceGen HTTP ${response.status}`); error.status = response.status; throw error; }
    return payload;
  }
  async function profile(id) {
    const registry = JSON.parse(await fs.readFile(path.join(voiceRoot, 'profiles.json'), 'utf8'));
    const selected = registry.schemaVersion === 1 && registry.profiles?.[id];
    if (!selected || typeof selected.file !== 'string') throw new Error(`Voice profile ${id} is missing from assets/voice/profiles.json.`);
    const root = await fs.realpath(voiceRoot);
    const file = await fs.realpath(path.resolve(root, selected.file));
    const relative = path.relative(root, file);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Voice reference must stay inside the voice folder.');
    const stat = await fs.stat(file);
    if (!stat.isFile() || stat.size > 20 * 1024 * 1024) throw new Error('Voice reference is too large or is not a file.');
    const bytes = await fs.readFile(file);
    validateWav(bytes);
    return { id, label: selected.label || id, filename: path.basename(file), sha256: crypto.createHash('sha256').update(bytes).digest('hex'), base64: bytes.toString('base64') };
  }
  async function health(value) {
    const base = normalizeVoiceURL(value);
    const data = await request(base, '/api/health', undefined, AbortSignal.timeout(3000));
    if (data.service !== SERVICE_NAME) throw new Error('This voice service belongs to another app. Start Duo Voice Harness voice on port 3234.');
    if (!data.speech_sessions?.available) throw new Error('This voice server does not provide speech sessions. Start the included backend.');
    return data;
  }
  async function profiles() {
    return Promise.all(ACTORS.map(selectProfile).map(async id => {
      try { const item = await profile(id); const { base64, ...info } = item; return { ...info, available: true }; }
      catch (error) { return { id, available: false, error: error.message }; }
    }));
  }
  function cancel(id, owner) {
    const turn = active.get(id);
    if (!turn || turn.owner !== owner) return { ok: true, cancelled: false };
    turn.cancelled = true;
    turn.controller.abort();
    turn.wake?.();
    // A create request is allowed to finish so a late session can be cleaned up.
    if (turn.sessionPath) request(turn.base, turn.sessionPath + '/cancel', {}, AbortSignal.timeout(5000)).catch(() => {});
    return { ok: true, cancelled: true };
  }
  function consumed(id, samples, owner) {
    const turn = active.get(id);
    if (!turn || turn.owner !== owner || !Number.isSafeInteger(samples) || samples < 1) return;
    turn.pendingSamples = Math.max(0, turn.pendingSamples - Math.min(samples, turn.pendingSamples));
    turn.wake?.();
  }
  async function stream(opts, emit, owner) {
    let turn, timer, stage = 'validate', healthNote;
    try {
      if(engineBusy())throw Error('Wait for voice warm-up to finish, or stop voice first.');
      if(opts?.voiceRoute?.connectionId)throw Error('Named VoxCPM2 connections are not configured. Use its local voice address.');
      if (!opts || !/^[\w-]{6,100}$/.test(opts.id || '') || active.has(opts.id)) throw new Error('Invalid or duplicate voice request ID.');
      if (typeof opts.text !== 'string' || !opts.text.trim() || opts.text.length > 8000) throw new Error('Voice text must contain 1–8000 characters.');
      // Narration is source text; model replies still remove private think tags.
      opts = { ...opts, text: opts.verbatim === true ? opts.text : speechText(opts.text) };
      if (!opts.text) throw new Error('The reply contains no speakable text.');
      if(opts.voiceId && opts.voiceId!==selectProfile(opts.actor))throw Error('The selected VoxCPM2 voice must match its companion reference.');
      if (!ACTORS.includes(opts.actor)) throw new Error('Unknown voice actor.');
      if (typeof opts.language !== 'string' || opts.language.length > 40) throw new Error('Voice language is required.');
      if(opts.voiceDirection!==undefined&&(typeof opts.voiceDirection!=='string'||opts.voiceDirection.length>600))throw new Error('Voice direction exceeds 600 characters.');
      if(opts.narrationContinuation!==undefined&&typeof opts.narrationContinuation!=='boolean')throw Error('Invalid narration continuation flag.');
      if(opts.narrationContinuation&&(opts.verbatim!==true||opts.voiceDirection?.trim()))throw Error('Reading continuation requires exact source words without Voice Direction.');
      const base = normalizeVoiceURL(opts.baseURL);
      turn = { id: opts.id, base, owner, controller: new AbortController(), pendingSamples: 0, cancelled: false, timedOut: false };
      active.set(turn.id, turn);
      timer = setTimeout(() => { turn.timedOut = true; cancel(turn.id, owner); }, timeoutMs);
      const alive = () => { if (turn.cancelled) throw new Error(turn.timedOut ? 'Voice generation timed out.' : 'Voice generation cancelled.'); };
      stage = 'health';
      const data = await health(base);
      healthNote = { healthy: true, service: data?.service, loaded: data?.loaded };
      alive();
      if (!Array.isArray(data.speech_sessions?.output_retention) || !data.speech_sessions.output_retention.includes('session')) {
        throw new Error('This voice backend cannot keep generated audio session-only. Stop and restart the included voice backend to update it.');
      }
      if(beforeGenerate)await beforeGenerate({baseURL:base,health:data});alive();
      stage = 'profile';
      const selected = await profile(selectProfile(opts.actor));
      alive();
      const payload = {
        mode: 'voice-clone', language: opts.language, output_retention: 'session',
        reference_profile: selected.id, ref_audio_base64: selected.base64,
        seed: opts.actor === 'momotamu' ? 42425 : 28,
        cfg_value: 2, inference_timesteps: opts.actor === 'momotamu' ? 8 : 10, max_len: 4096, denoise: false
      };
      const extraDirection = opts.voiceDirection?.trim() || '';
      // Momotamu's standard direction is always sent. An on-the-fly note is appended. Reading stays a plain clone.
      if (opts.actor === 'momotamu' && !opts.narrationContinuation) {
        payload.mode = 'voice-directed';
        payload.voice_direction = momotamuDirection(extraDirection);
      } else if (extraDirection) {
        payload.mode = 'voice-directed';
        payload.voice_direction = extraDirection;
      }
      if(opts.narrationContinuation){if(!data.speech_sessions?.narration_continuation)throw Error('Restart the included VoiceGen backend to enable reading continuation.');payload.narration_continuation=true;}
      else payload.single_utterance=true;
      stage = 'create';
      note(() => ({ ...noteBase(opts), event: 'voice-session-create', voiceMode: payload.mode, hasDirection: payload.mode === 'voice-directed', voicegen: healthNote }));
      const session = await request(base, '/api/speech-sessions', payload, AbortSignal.timeout(timeoutMs));
      stage = 'stream';
      if (!/^[\w-]{6,160}$/.test(session.session_id || '')) throw new Error('VoiceGen returned an invalid session ID.');
      turn.sessionPath = '/api/speech-sessions/' + session.session_id;
      alive();
      const response = await fetchImpl(base + turn.sessionPath + '/audio', { signal: turn.controller.signal, redirect: 'error' });
      if (!response.ok || !response.body) throw new Error(`Voice audio stream HTTP ${response.status}`);
      const rate = Number(response.headers.get('X-Sample-Rate'));
      if (response.headers.get('X-Audio-Format') !== 'pcm_s16le' || !Number.isInteger(rate) || rate < 8000 || rate > 96000) throw new Error('VoiceGen returned an unsupported PCM format.');
      alive();
      emit({ id: turn.id, type: 'start', sampleRate: rate, channels: 1, format: 'pcm_s16le', profile: selected?.id || 'voice-design', referenceSha256: selected?.sha256 });
      await request(base, turn.sessionPath + '/text', { delta: opts.text }, turn.controller.signal);
      await request(base, turn.sessionPath + '/complete', {}, turn.controller.signal);
      let bytes = 0;
      const reader = response.body.getReader();
      try {
        while (true) {
          alive();
          while (turn.pendingSamples >= rate * bufferSeconds) {
            await new Promise(resolve => { turn.wake = resolve; if (turn.cancelled) resolve(); });
            turn.wake = null; alive();
          }
          const packet = await reader.read();
          if (packet.done) break;
          alive();
          bytes += packet.value.length;
          if (bytes > rate * 2 * 600) throw new Error('Voice output exceeds ten minutes.');
          turn.pendingSamples += Math.floor(packet.value.length / 2);
          emit({ id: turn.id, type: 'pcm', bytes: packet.value });
        }
      } finally { await reader.cancel().catch(() => {}); }
      if (!bytes || bytes % 2) throw new Error('VoiceGen returned empty or truncated PCM audio.');
      let final = await request(base, turn.sessionPath, undefined, turn.controller.signal);
      while (!['completed', 'failed', 'cancelled', 'timed_out'].includes(final.state)) {
        await new Promise(resolve => setTimeout(resolve, 80)); alive();
        final = await request(base, turn.sessionPath, undefined, turn.controller.signal);
      }
      if (final.state !== 'completed') throw new Error(final.error || `Voice session ${final.state}.`);
      alive();
      emit({ id: turn.id, type: 'end' });
      return { ok: true, sessionId: session.session_id, profile: selected?.id || 'voice-design', sampleRate: rate, samples: bytes / 2, record: final.record };
    } catch (error) {
      note(() => ({ ...noteBase(opts), event: 'voice-stream-error', stage, voicegen: healthNote || (stage === 'health' ? { healthy: false } : undefined), outcome: turn?.cancelled && !turn?.timedOut ? 'cancelled' : 'error', reason: error?.message, httpStatus: error?.status }));
      if (turn?.sessionPath) {
        const until = Date.now() + 9000;
        try {
          let cleanup = await request(turn.base, turn.sessionPath + '/cancel', {}, AbortSignal.timeout(2000));
          while (!['completed', 'failed', 'cancelled', 'timed_out'].includes(cleanup.state) && Date.now() < until) {
            await new Promise(resolve => setTimeout(resolve, 100));
            cleanup = await request(turn.base, turn.sessionPath, undefined, AbortSignal.timeout(1500));
          }
        } catch { /* A disconnected backend owns its own bounded idle-session timeout. */ }
      }
      if (turn) emit({ id: turn.id, type: 'error', error: error.message });
      return { ok: false, cancelled: !!turn?.cancelled && !turn?.timedOut, error: error.message };
    } finally { clearTimeout(timer); if (turn) active.delete(turn.id); }
  }
  function cancelOwner(owner) { for (const [id, turn] of active) if (turn.owner === owner) cancel(id, owner); }
  return { id:'voxcpm2', label:'VoxCPM2 · included local VoiceGen', contractVersion:1, capabilities:Object.freeze({streaming:true,referenceAudio:true,voiceDirection:true,narrationContinuation:true,sessionOnly:true,requiresLocalRuntime:true}), get busy(){return active.size>0||engineBusy();}, reference:actor=>profile(selectProfile(actor)), stream, cancel, consumed, health, profiles, cancelOwner, cancelAll: () => { for (const [id, turn] of active) cancel(id, turn.owner); } };
}
module.exports = { createVoxCPM2Provider, normalizeVoiceURL, selectProfile, speechText, validateWav, DEFAULT_VOICE_URL, SERVICE_NAME };
