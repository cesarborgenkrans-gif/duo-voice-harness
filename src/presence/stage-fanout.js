/* One stage, several observers: forwards every DiscussionSprites call to the sprite runtime
   (primary, whose result is returned unchanged) and then to each presence observer.
   An observer failure is swallowed so it cannot affect sprites, the conversation or voice. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DiscussionStageFanout = api;
})(globalThis, function () {
  'use strict';
  function create(targets) {
    const list = Array.isArray(targets) ? targets : [];
    const primary = list[0];
    if (!primary) return null;
    const observers = list.slice(1).filter(Boolean);
    const out = {};
    for (const name of Object.keys(primary)) {
      const member = primary[name];
      if (typeof member !== 'function') { out[name] = member; continue; }
      out[name] = function (...args) {
        try { return member.apply(primary, args); }
        finally {
          for (const observer of observers) {
            try { const fn = observer[name]; if (typeof fn === 'function') fn.apply(observer, args); } catch { /* observe only */ }
          }
        }
      };
    }
    return Object.freeze(out);
  }
  return Object.freeze({ create });
});
