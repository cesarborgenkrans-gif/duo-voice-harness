// Last-resort renderer error reporting: log every uncaught error and show at most one quiet notice per interval.
(function (root) {
  'use strict';
  const quiet = [/ResizeObserver loop/i];
  const isAbort = reason => reason?.name === 'AbortError' || reason === 'cancelled' || reason === 'timeout';
  function describe(value) {
    if (value instanceof Error) return { message: value.message || value.name || 'Error', details: String(value.stack || value.message || value.name) };
    if (typeof value === 'string') return { message: value, details: value };
    try { return { message: 'Unexpected error', details: JSON.stringify(value) ?? String(value) }; } catch { return { message: 'Unexpected error', details: String(value) }; }
  }
  function create({ doc = root.document, Status = root.DiscussionStatus, now = () => Date.now(), interval = 15000, hideAfter = 12000, log = (...args) => console.error(...args), schedule = (fn, ms) => setTimeout(fn, ms), cancel = id => clearTimeout(id) } = {}) {
    let lastShown = -Infinity, suppressed = 0, feedback = null, hideTimer = null;
    function ensure() {
      if (feedback || !doc?.body || !Status) return feedback;
      const host = doc.createElement('div');
      host.id = 'runtime-error-status'; host.className = 'runtime-error-status'; host.hidden = true;
      doc.body.append(host); feedback = Status.create(host);
      return feedback;
    }
    function report(kind, value) {
      const info = describe(value);
      if (quiet.some(pattern => pattern.test(info.message))) return false;
      if (isAbort(value)) return false;
      log('[Duo Voice Harness] Uncaught ' + kind + ':', value);
      const time = now();
      if (time - lastShown < interval) { suppressed++; return false; }
      const status = ensure();
      if (!status) return false;
      lastShown = time;
      const more = suppressed ? ` ${suppressed} more since the last notice.` : '';
      suppressed = 0;
      status.resolve({ state: 'attention', title: 'Something went wrong', message: 'The last action may not have finished.' + more, details: info.details.slice(0, 2000) });
      if (hideTimer !== null) cancel(hideTimer);
      hideTimer = schedule(() => { hideTimer = null; status.resolve({ state: 'idle', message: '' }); }, hideAfter);
      return true;
    }
    return { report };
  }
  function install(target = root, options) {
    const reporter = create(options);
    target.addEventListener('error', event => reporter.report('error', event.error ?? event.message));
    target.addEventListener('unhandledrejection', event => reporter.report('promise rejection', event.reason));
    return reporter;
  }
  const api = { create, install, describe };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.DiscussionRuntimeErrors = api; api.install(root); }
})(typeof globalThis !== 'undefined' ? globalThis : this);
