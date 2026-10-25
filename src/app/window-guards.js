'use strict';
// Every web contents the app creates: no new windows, no navigation away from its own page.
// Links that ask for a new window open in the system browser, only from the main window and only for http(s).

function externalURL(value) {
  if (typeof value !== 'string' || !value || value.length > 2048) return null;
  let url;
  try { url = new URL(value); } catch { return null; }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) return null;
  return url.href;
}

function samePage(target, current) {
  try {
    const a = new URL(target), b = new URL(current);
    if (a.protocol !== 'file:' || b.protocol !== 'file:') return false;
    a.hash = b.hash = ''; a.search = b.search = '';
    return a.href === b.href;
  } catch { return false; }
}

function create({ openExternal, allowExternal = () => true, log = () => {} } = {}) {
  function open(contents, value) {
    const url = externalURL(value);
    if (!url || !allowExternal(contents)) { log('Blocked new window', String(value).slice(0, 200)); return false; }
    Promise.resolve().then(() => openExternal(url)).catch(error => log('External link failed', error?.message || error));
    return true;
  }
  function attach(contents) {
    if (!contents || typeof contents.setWindowOpenHandler !== 'function') return false;
    contents.setWindowOpenHandler(({ url }) => { open(contents, url); return { action: 'deny' }; });
    contents.on('will-navigate', (event, url) => {
      if (String(url).startsWith('devtools://') || samePage(url, contents.getURL())) return;
      event.preventDefault();
      log('Blocked navigation', String(url).slice(0, 200));
    });
    return true;
  }
  return { attach, open, externalURL, samePage };
}

module.exports = { create, externalURL, samePage };
