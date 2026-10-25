/* Momotamu presence: pure light model extracted from characters/momotamu-presence/woven-rim-v9.html.
   No DOM, no audio, no timers. Inputs are normalised signals; the painter reads snapshot(). */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DiscussionPresenceModel = api;
})(globalThis, function () {
  'use strict';
  const STATES = Object.freeze(['idle', 'listening', 'checking', 'invited', 'thinking', 'speaking', 'paused', 'voiceoff', 'off']);
  // Visible state words reuse existing app labels; idle and off show nothing.
  const LABELS = Object.freeze({ idle: '', listening: 'Listening', checking: 'Checking invitation', invited: 'Replying', thinking: 'Thinking', speaking: 'Speaking', paused: 'Listening paused', voiceoff: 'Voice off', off: '' });
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const ease = u => { u = clamp(u, 0, 1); return u * u * (3 - 2 * u); };
  const level = v => clamp(Number.isFinite(+v) ? +v : 0, 0, 1);
  // Reduced motion: a fixed light height per state, intensity changes only.
  function reducedHeight(state, invitedLate) {
    if (state === 'speaking') return 1;
    if (state === 'thinking' || (state === 'invited' && invitedLate)) return 0.6;
    if (state === 'listening' || state === 'checking' || state === 'invited') return 0.35;
    return 0;
  }
  function create(options = {}) {
    let seed = Math.max(1, Math.floor(options.seed || 7));
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    let windowSeconds = Math.max(5, +options.windowSeconds || 120), rm = !!options.reducedMotion;
    let state = 'idle', prev = 'idle', stateT = 0, t = 0, revision = 0;
    let micIn = 0, ttsIn = 0, mic = 0, micSm = 0, tts = 0, ttsPhase = 0, bands = new Array(8).fill(0);
    let pieces = [], phase = 'prefill', tokAcc = 0, tokRateSm = 0, drop = null, mist = 0;
    const w = { idle: 1, listen: 0, think: 0, speak: 0 };
    let h = 0, cond = 0, checkA = -Math.PI / 2, pulses = [], pulseNext = 0.3, halo = 0;
    let check = null, release = null, snap = null, sinkT = 0;
    const age = p => t - p.born;
    const alive = p => p.pinned || (p === check && (state === 'checking' || state === 'invited')) || age(p) < windowSeconds;
    function setState(next) {
      if (!STATES.includes(next) || next === state) return false;
      prev = state; state = next; stateT = 0; revision++;
      if (next === 'thinking' && prev !== 'invited') { phase = 'prefill'; tokRateSm = 0; tokAcc = 0; }
      if (next === 'invited') { phase = 'prefill'; tokRateSm = 0; tokAcc = 0; snap = { t: 0, n: pieces.filter(alive).length }; }
      if (next === 'checking') { check = pieces.filter(alive).slice(-1)[0] || null; checkA = check ? check.land : -Math.PI / 2; release = null; }
      if (prev === 'checking' && next === 'listening' && check) release = { t: 0 };
      if (next === 'voiceoff') drop = null;
      if (next === 'speaking') { pulses = []; pulseNext = ttsPhase + 0.05; }
      return true;
    }
    function addPiece({ id, level: lvl = 0.7, pinned = false } = {}) {
      const key = id === undefined || id === null ? 'p' + revision + '-' + pieces.length : String(id);
      const existing = pieces.find(p => p.id === key);
      if (existing) { if (existing.pinned !== !!pinned) { existing.pinned = !!pinned; revision++; } return false; }
      pieces.push({ id: key, born: t, t0: t, pinned: !!pinned, land: rnd() * TAU, rest: 0.3 + rnd() * 0.3, lvl: level(lvl), wob: rnd() * TAU });
      if (pieces.length > 60) pieces.splice(0, pieces.length - 60);
      revision++; return true;
    }
    function step(dt) {
      dt = clamp(Number.isFinite(+dt) ? +dt : 0, 0, 0.1);
      t += dt; stateT += dt; if (sinkT > 0) sinkT = Math.max(0, sinkT - dt);
      const frozen = state === 'paused' || state === 'off';
      const hearing = ['idle', 'listening', 'checking', 'invited', 'thinking', 'voiceoff'].includes(state);
      const mr = (hearing && !frozen) ? micIn * (state === 'idle' ? 0.15 : 1) : 0;   // speaking: mic gated to 0
      mic += (mr - mic) * Math.min(1, dt * (mr > mic ? 12 : 2.5)); micSm += (mic - micSm) * Math.min(1, dt / 1.5);
      const tr = state === 'speaking' ? ttsIn : 0; tts += (tr - tts) * Math.min(1, dt * (tr > tts ? 33 : 6.6));
      ttsPhase += tts * dt * 0.9;
      // RMS-only playback: pseudo bands derived from the measured level (analyser bands are deferred).
      bands = bands.map((b, i) => { const nb = tts * Math.max(0, 0.6 + 0.4 * Math.sin(t * (1.1 + i * 0.37) + i)) * (1 - i * 0.06); return b + (nb - b) * Math.min(1, dt * (nb > b ? 25 : 5)); });
      if (frozen) return;
      const inv = state === 'invited', early = inv && stateT < 1.0;
      const tg = { idle: state === 'idle' ? 1 : 0, listen: (state === 'listening' || state === 'checking' || early) ? 1 : 0,
        think: (state === 'thinking' || (inv && !early)) ? 1 : 0, speak: state === 'speaking' ? 1 : 0 };
      for (const k in w) {
        const up = tg[k] > w[k];
        let tau = k === 'speak' ? (up ? 0.45 : 0.7) : (up ? 0.9 : 0.8);
        if (sinkT > 0 && !up) tau = 0.25;
        if (rm) tau = 0.15;
        w[k] += (tg[k] - w[k]) * Math.min(1, dt / tau);
      }
      const thinkingNow = state === 'thinking' || (inv && !early);
      const hT = state === 'speaking' ? 1 : thinkingNow ? (phase === 'prefill' ? 0.22 : 0.25 + 0.75 * Math.min(1, tokRateSm / 18)) : (state === 'listening' || state === 'checking' || inv) ? 0.35 : 0;
      const hTau = hT > h ? (state === 'speaking' ? 0.6 : 1.6) : (sinkT > 0 ? 0.35 : 2.8);
      h += (hT - h) * Math.min(1, dt / hTau);
      if (rm) h = reducedHeight(state, inv && !early);
      cond += (((state === 'checking' || early) ? 1 : 0) - cond) * Math.min(1, dt / (state === 'checking' ? 0.6 : 0.9));
      pieces = pieces.filter(alive);
      if (thinkingNow) {
        if (phase === 'prefill') mist += (0.55 - mist) * Math.min(1, dt / 1.2);
        else { const rate = dt > 0 ? tokAcc / dt : 0; tokRateSm += (rate - tokRateSm) * Math.min(1, dt / 1.5); const m = 0.4 + 0.5 * Math.min(1, tokRateSm / 20); mist += (m - mist) * Math.min(1, dt / 1.2); }
      } else mist += (0 - mist) * Math.min(1, dt / 1.0);
      tokAcc = 0;
      if (state === 'speaking' && ttsPhase >= pulseNext) { pulses.push({ r: 0.05, a: 0.3 + 0.7 * tts }); pulseNext = ttsPhase + 0.34; }
      pulses.forEach(g => { g.r += dt * (0.18 + 0.55 * tts); }); pulses = pulses.filter(g => g.r < 1.08);
      halo += (clamp((tts - 0.5) / 0.35, 0, 1) - halo) * Math.min(1, dt * (tts > 0.5 ? 10 : 3));
      if (snap) snap.t += dt; if (release) { release.t += dt; if (release.t > 1) release = null; } if (drop) { drop.t += dt; if (drop.t > 2.2) drop = null; }
    }
    const still = () => state === 'paused' || state === 'voiceoff' || state === 'off';
    function snapshot() {
      const live = pieces.filter(alive);
      return { state, prev, stateT, t, revision, reducedMotion: rm, windowSeconds,
        weights: { ...w }, w: { ...w }, height: h, h, cond, mist, mic, micSm, tts, ttsPhase, bands: bands.slice(), phase, tokenRate: tokRateSm,
        pieces: live.map(p => ({ ...p })), checkId: check ? check.id : null, check: { angle: checkA, id: check ? check.id : null }, checkA,
        pulses: pulses.map(p => ({ ...p })), halo, release: release ? { ...release } : null, snap: snap ? { ...snap } : null, drop: drop ? { ...drop } : null,
        still: still(), label: LABELS[state] };
    }
    function stillKey() { return [state, rm, pieces.filter(alive).length, drop && drop.t < 2.2 ? Math.round(drop.t * 60) : -1].join('|'); }
    return {
      setState, get state() { return state; },
      setMic(v) { micIn = level(v); }, setTts(v) { ttsIn = level(v); },
      tokens(n) { const v = +n; if (!(v > 0)) return; tokAcc += v; if (phase === 'prefill') phase = 'decode'; },
      addPiece, pin(id, pinned = true) { const p = pieces.find(x => x.id === String(id)); if (p && p.pinned !== !!pinned) { p.pinned = !!pinned; revision++; } },
      landed() { if (state === 'voiceoff') { drop = { t: 0 }; revision++; } },
      sink() { sinkT = 1.2; },
      setWindow(sec) { const v = +sec; if (v >= 5) windowSeconds = v; },
      setReducedMotion(v) { rm = !!v; revision++; }, get reducedMotion() { return rm; },
      step, still, stillKey, snapshot
    };
  }
  return Object.freeze({ create, states: STATES, labels: LABELS, reducedHeight });
});
