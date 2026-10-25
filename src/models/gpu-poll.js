// GPU budget reads start a system query in the main process. Poll every 6 s only while a GPU
// readout is open or a model is loading, otherwise once a minute, and never while the window is hidden.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DiscussionGpuPoll = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  function create({ poll, isHidden = () => false, isFast = () => false, now = () => Date.now(), setTimer = (fn, ms) => setInterval(fn, ms), clearTimer = id => clearInterval(id), fastMs = 6000, slowMs = 60000, warn = (...args) => console.warn(...args) } = {}) {
    let timer = null, last = -Infinity, running = false;
    async function refresh() {
      if (running) return false;
      running = true; last = now();
      try { await poll(); } catch (error) { warn('GPU status check failed', error); } finally { running = false; }
      return true;
    }
    function stop() { if (timer !== null) clearTimer(timer); timer = null; }
    function tick() {
      if (isHidden()) { stop(); return false; }
      if (!isFast() && now() - last < slowMs) return false;
      refresh();
      return true;
    }
    function start() { if (timer !== null || isHidden()) return false; timer = setTimer(tick, fastMs); return true; }
    function visibility() { if (isHidden()) stop(); else { start(); tick(); } }
    return { start, stop, tick, refresh, visibility, get active() { return timer !== null; } };
  }
  return { create };
});
