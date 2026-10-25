/* Momotamu presence: observe-only signal adapter.
   Receives the same calls as DiscussionSprites (through stage-fanout) plus a few read-only taps,
   normalises them and feeds the presence model. Every entry point is isolated: a failure here
   returns quietly and can never reach sprites, the conversation or voice. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DiscussionPresenceSignals = api;
})(globalThis, function () {
  'use strict';
  const HOST = 'momotamu', INPUT_STALE_MS = 2500, METER_SCALE = 8, STOP_QUIET_MS = 3000;   // an error within 3 s of a user stop is the stop's echo, not a failure
  const clamp01 = v => { v = +v; return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0; };
  function create({ model, getVoiceOn = () => true, now = () => Date.now(), onChange = () => {}, onCue = () => {} } = {}) {
    if (!model) throw new Error('Presence model required');
    const inputs = new Map();          // capture id -> {level, at}
    const outputs = new Map();         // playback id -> level (Momotamu only)
    let turn = null, ambient = null, ambientCapturing = true, listenPaused = false, modelOff = false, handsFreeBlocked = false, lastObserveIds = new Set();
    let stoppedAt = -Infinity, loadPending = false;   // Portrait cues: a user stop is not an error; a model load that ends without ok failed
    const isHost = actor => actor === undefined || actor === null || actor === HOST;
    function guard(fn) { return (...args) => { try { return fn(...args); } catch { return undefined; } }; }
    function inputActive() {
      const t = now();
      for (const [id, v] of inputs) if (t - v.at > (v.explicit ? 60000 : INPUT_STALE_MS)) inputs.delete(id);   // level-only sources (Hands-free) expire; begun sources wait for their end
      return inputs.size > 0;
    }
    function derive() {
      if (turn === 'speaking') return 'speaking';
      if (turn === 'thinking') return 'thinking';
      if (ambient === 'invited') return 'invited';
      if (ambient === 'checking') return 'checking';
      if (inputActive() || ambient === 'listening') return 'listening';
      if (ambient === 'paused' || listenPaused) return 'paused';
      if (modelOff) return 'off';
      let voiceOn = true; try { voiceOn = getVoiceOn() !== false; } catch {}
      return voiceOn ? 'idle' : 'voiceoff';
    }
    function update() {
      const state = derive();
      let mic = 0; for (const v of inputs.values()) mic = Math.max(mic, v.level);
      model.setMic(mic);
      let out = 0; for (const v of outputs.values()) out = Math.max(out, v);
      model.setTts(out);
      if (model.setState(state)) { try { onChange(state); } catch {} }
      return state;
    }
    function settle(sink) { turn = null; if (sink) model.sink(); update(); }
    const api = {
      // ---- DiscussionSprites-compatible surface (called by stage-fanout) ----
      lifecycle: guard((name, detail = {}) => {
        const actor = detail && detail.actor;
        switch (name) {
          case 'composing': turn = isHost(actor) ? 'thinking' : null; break;     // actor fence (H4): a guest turn rests the presence
          case 'speaking':
            if (!isHost(actor)) { turn = null; break; }
            if (getVoiceOn() === false && !detail.audioDriven) { turn = null; update(); model.landed(); return; }
            turn = 'speaking'; break;
          case 'speech-end': case 'reply-finished': if (isHost(actor) && turn) turn = null; break;
          case 'handoff': if (isHost(actor)) turn = null; break;
          case 'stop': stoppedAt = now(); settle(true); return;
          case 'error':
            if (isHost(actor) && now() - stoppedAt > STOP_QUIET_MS) { try { onCue('worried'); } catch {} }   // the Portrait's worried reaction
            settle(true); return;
          case 'completion': settle(false); return;
          case 'model-load': {   // model ready: the Portrait's happy reaction; a load that ends without ok: worried
            const d = detail || {};
            if (d.pending === true) loadPending = true;
            else if (d.ok === true) { loadPending = false; try { onCue('happy'); } catch {} }
            else if (d.pending === false && loadPending) { loadPending = false; try { onCue('worried'); } catch {} }
            break;
          }
          case 'listening-state': {
            const phase = detail && detail.phase;
            if (phase === 'paused' || phase === 'pausing') listenPaused = true;
            else if (phase) listenPaused = false;
            break;
          }
          default: break;
        }
        update();
      }),
      audio: guard((name, { source, id, actor, rms = 0 } = {}) => {
        if (!isHost(actor)) return;
        if (name === 'backchannel') { try { onCue('nod'); } catch {} return; }
        const key = String(id ?? source ?? 'default');
        if (source === 'input') {
          if (name === 'end') inputs.delete(key);
          else { const prior = inputs.get(key); inputs.set(key, { level: name === 'level' ? clamp01(rms * METER_SCALE) : (prior?.level || 0), at: now(), explicit: name === 'begin' || !!prior?.explicit }); }
        } else if (source === 'output') {
          if (name === 'end') outputs.delete(key);
          else outputs.set(key, name === 'level' ? clamp01(rms * METER_SCALE) : (outputs.get(key) || 0));
        }
        update();
      }),
      returnToIdle: guard(actor => { if (isHost(actor)) { turn = null; update(); } }),
      cancelAll: guard(() => {}),
      setSubagentActive: guard(() => { update(); }),
      // ---- read-only taps (H1, H2, H5, H6) ----
      listening: guard(value => {          // H1: invited-listening observe packet (content-free)
        if (!value || typeof value !== 'object') return;
        const phase = value.phase;
        if (value.mode !== 'invited') ambient = null;
        else ambient = phase === 'checking' ? 'checking' : (phase === 'replying' || phase === 'finishing') ? 'invited' : phase === 'listening' ? 'listening' : (phase === 'paused' || phase === 'pausing') ? 'paused' : null;
        ambientCapturing = !(ambient === 'listening' && value.capturing === false);
        if (Number(value.windowSeconds) > 0) model.setWindow(Number(value.windowSeconds));
        const ids = new Set();
        for (const e of Array.isArray(value.entries) ? value.entries.slice(-40) : []) {
          if (!e || e.id === undefined || e.error) continue; const id = String(e.id); ids.add(id);
          if (!lastObserveIds.has(id)) model.addPiece({ id, level: 0.7, pinned: !!e.pinned }); else model.pin(id, !!e.pinned);
        }
        lastObserveIds = ids;
        update();
      }),
      modelDelta: guard((requestId, chars) => {   // H2: counts only, never text
        if (turn !== 'thinking') return;
        const n = Math.max(0, +chars || 0); if (n) model.tokens(n / 4);
      }),
      handsFree: guard(state => { handsFreeBlocked = state === 'blocked'; }),   // H5
      readiness: guard(ready => { if (ready === undefined || ready === null) return; modelOff = !ready; update(); }),   // H6
      refresh: guard(() => update()),
      get inputGated() { return handsFreeBlocked || (ambient === 'listening' && !ambientCapturing); },
      get state() { return model.state; },
      snapshot: () => ({ turn, ambient, inputs: inputs.size, outputs: outputs.size, listenPaused, modelOff, handsFreeBlocked })
    };
    return api;
  }
  return Object.freeze({ create });
});
