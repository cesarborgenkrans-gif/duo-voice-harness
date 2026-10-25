(function () {
  'use strict';
  window.createSessionController = function ({ bridge, onLoad, onError, onChange = () => {} }) {
    const $ = id => document.getElementById(id);
    let kind = null, current = null, busy = false, loading = false, filter = 'all';
    const chats = $('session-controls'), chatsToggle = $('chats-toggle');
    const deleteDialog = $('session-delete-dialog');
    function positionChats() {
      const anchor = chatsToggle.getBoundingClientRect(), gap = 8;
      const width = Math.min(520, window.innerWidth - 24);
      const roomBelow = window.innerHeight - anchor.bottom - 20;
      const height = Math.min(430, window.innerHeight - 32);
      const top = roomBelow >= 240 ? anchor.bottom + gap : Math.max(12, anchor.top - height - gap);
      chats.style.left = Math.max(12, Math.min(anchor.right - width, window.innerWidth - width - 12)) + 'px';
      chats.style.top = top + 'px';
      chats.style.maxHeight = Math.min(height, window.innerHeight - top - 12) + 'px';
    }
    chats.addEventListener('beforetoggle', event => {
      const open = event.newState === 'open';
      chatsToggle.setAttribute('aria-expanded', String(open));
      if (open) positionChats();
    });
    window.addEventListener('resize', () => { if (chats.matches(':popover-open')) positionChats(); });
    window.addEventListener('scroll', event => {
      if (!(event.target instanceof Node && chats.contains(event.target)) && chats.matches(':popover-open')) chats.hidePopover();
    }, true);
    function paint() {
      if (!kind && chats.matches(':popover-open')) chats.hidePopover();
      chats.hidden = !kind;
      chatsToggle.hidden = !kind;
      $('session-current-info').hidden = !kind;
      $('session-current').textContent = loading ? 'Opening chat…' : current?.title || (kind === 'discussion' ? 'No discussion open' : 'No chat open');
      $('session-current').title = current?.title || '';
      $('session-document').hidden = kind !== 'discussion';
      $('session-memory-panel').hidden = kind !== 'discussion';
      $('session-memory-enabled').checked = !!current?.memory?.enabled;
      $('session-memory-text').textContent = current?.memory?.text || 'No memory prepared yet.';
      $('session-new').textContent = kind === 'discussion' ? 'New discussion' : 'New chat';
      $('session-title').value = current?.title || '';
      $('reply-rhythm').value = current?.replyRhythm || 'usual';
      $('reply-rhythm').disabled = busy || loading || !bridge || !current;
      $('listener-select').value = current?.listener === 'partner' ? 'partner' : 'user';
      $('listener-select').disabled = busy || loading || !bridge || !current;
      $('session-path').textContent = current?.markdownPath || '';
      $('session-status').textContent = !bridge ? 'Saved sessions require the Electron app.' : loading ? 'Opening session…' : current ? `${current.entries.length} turns saved · ${current.warning || 'On this device'}` : 'No session open. Send a message or choose New chat.';
      for (const control of chats.querySelectorAll('button, input, select')) {
        if (control.id === 'chats-close') continue;
        const allowWithoutSession = control.id === 'session-new' || control.id === 'session-select';
        control.disabled = busy || loading || !bridge || (!current && !allowWithoutSession);
      }
    }
    async function call(method, opts) {
      if (!bridge?.[method]) throw new Error('Saved sessions require the Electron app.');
      const r = await bridge[method](opts); if (!r.ok) throw new Error(r.error || 'Session operation failed.'); return r;
    }
    function sessionDay(iso) {
      const time = Date.parse(iso || '');
      if (!Number.isFinite(time)) return '';
      const date = new Date(time);
      const now = new Date();
      return date.toLocaleDateString(undefined, date.getFullYear() === now.getFullYear()
        ? { month: 'short', day: 'numeric' }
        : { year: 'numeric', month: 'short', day: 'numeric' });
    }
    async function refresh() {
      const { sessions: all } = await call('sessionsList', { kind });
      const sessions = filter === 'all' ? all : all.filter(s => filter === 'none' ? !s.worktreeId : s.worktreeId === filter);
      $('session-select').replaceChildren();
      if (!sessions.length) {
        const empty = document.createElement('option');
        empty.value = '';
        empty.textContent = 'No saved sessions';
        empty.disabled = true;
        empty.selected = true;
        $('session-select').append(empty);
      } else {
        $('session-select').replaceChildren(...sessions.map(s => {
          const option = document.createElement('option');
          option.value = s.id;
          const when = sessionDay(s.updatedAt);
          option.textContent = `${s.title} · ${s.count ?? '?'} turns${when ? ' · ' + when : ''}`;
          return option;
        }));
        if (current) $('session-select').value = current.id;
      }
      return sessions;
    }
    function accept(s, render = false) {
      current = s || null;
      if (kind) {
        if (current) localStorage.setItem('duo-voice-last-' + kind, current.id);
        else localStorage.removeItem('duo-voice-last-' + kind);
      }
      paint();
      onChange(current);
      if (render) {
        if (chats.matches(':popover-open')) chats.hidePopover();
        onLoad(current);
      }
    }
    async function change(task) {
      if (busy || loading) return;
      loading = true; paint();
      try { await task(); }
      catch (e) { $('session-status').textContent = 'Session error: ' + e.message; onError(e.message); }
      finally { loading = false; paint(); onChange(current); }
    }
    async function createSession(companion = 'vivi', worktreeId) {
      let session = (await call('sessionCreate', { kind, companion })).session;
      const assignId = worktreeId === undefined
        ? (filter === 'none' ? null : filter !== 'all' ? filter : null)
        : worktreeId;
      if (assignId) {
        const r = await bridge.worktree('assign', { kind, id: session.id, revision: session.revision, worktreeId: assignId });
        if (!r.ok) throw Error(r.error);
        session = r.result;
      }
      return session;
    }
    async function startNew(companion = 'vivi') {
      await change(async () => {
        const worktreeId = filter === 'none' ? null : filter !== 'all' ? filter : current?.worktreeId || null;
        const session = await createSession(companion, worktreeId);
        accept(session, true);
        await refresh();
      });
    }
    async function ensureOpen(companion = 'vivi') {
      if (current) return current;
      if (!kind || !bridge) throw new Error('Saved sessions require the Electron app.');
      if (busy || loading) throw new Error('Wait for the current session operation to finish.');
      await change(async () => {
        const session = await createSession(companion);
        accept(session, false);
        await refresh();
      });
      if (!current) throw new Error('A new session could not be created.');
      return current;
    }
    async function openEmpty() {
      accept(null, true);
      await refresh();
    }
    async function openNextOrEmpty(remaining) {
      let next = null;
      for (const item of remaining) {
        if (item.error) continue;
        try { next = (await call('sessionGet', { kind, id: item.id })).session; break; } catch { /* skip damaged folders */ }
      }
      if (next) accept(next, true);
      else await openEmpty();
    }
    function askDelete() {
      return new Promise(resolve => {
        if (!deleteDialog) {
          resolve(window.confirm('Delete this saved session forever?') ? { confirmed: true, exportFirst: false } : { confirmed: false, exportFirst: false });
          return;
        }
        const label = kind === 'discussion' ? 'discussion' : 'chat';
        const title = (current?.title || ('Untitled ' + label)).trim();
        $('session-delete-copy').textContent = 'Delete “' + title + '” forever? This removes the saved ' + label + ' and its session replay audio from this device. Exported audio and older voice archives are kept.';
        $('session-delete-export').checked = false;
        let settled = false;
        const finish = result => {
          if (settled) return;
          settled = true;
          $('session-delete-cancel').onclick = null;
          $('session-delete-confirm').onclick = null;
          deleteDialog.onclose = null;
          if (deleteDialog.open) deleteDialog.close();
          resolve(result);
        };
        $('session-delete-cancel').onclick = () => finish({ confirmed: false, exportFirst: false });
        $('session-delete-confirm').onclick = () => finish({ confirmed: true, exportFirst: !!$('session-delete-export').checked });
        deleteDialog.onclose = () => finish({ confirmed: false, exportFirst: false });
        deleteDialog.showModal();
      });
    }
    $('session-new').onclick = () => startNew(current?.participants[1] || 'vivi');
    $('session-select').onchange = () => {
      const id = $('session-select').value;
      if (!id) return;
      change(async () => { accept((await call('sessionGet', { kind, id })).session, true); });
    };
    async function deleteCurrent() {
      if (!current) return;
      const choice = await askDelete();
      if (!choice.confirmed) return;
      const removedId = current.id;
      let keptPath = null;
      await change(async () => {
        if (choice.exportFirst) {
          const exported = await call('sessionExportKeep', { kind, id: removedId });
          keptPath = exported.keptPath || null;
          if (exported.session) accept(exported.session, false);
        }
        await call('sessionDelete', { kind, id: removedId });
        if (localStorage.getItem('duo-voice-last-' + kind) === removedId) localStorage.removeItem('duo-voice-last-' + kind);
        const remaining = await refresh();
        await openNextOrEmpty(remaining);
      });
      if (keptPath) $('session-status').textContent = 'Deleted. Markdown copy kept at ' + keptPath;
    }
    $('session-delete').onclick = () => deleteCurrent();
    $('session-rename').onclick = () => { const title = $('session-title').value; change(async () => { accept((await call('sessionRename', { kind, id: current.id, revision: current.revision, title })).session); await refresh(); }); };
    $('session-memory-enabled').onchange = () => { const enabled = $('session-memory-enabled').checked; change(async () => { accept((await call('sessionMemory', { kind, id: current.id, revision: current.revision, enabled })).session); }); };
    $('reply-rhythm').onchange = () => {
      const replyRhythm = $('reply-rhythm').value;
      change(async () => { accept((await call('sessionRhythm', { kind, id: current.id, revision: current.revision, replyRhythm })).session); });
    };
    $('listener-select').onchange = () => {
      const listener = $('listener-select').value === 'partner' ? 'partner' : 'user';
      change(async () => { accept((await call('sessionListener', { kind, id: current.id, revision: current.revision, listener })).session); });
    };
    for (const op of ['open', 'reveal']) $('session-' + op).onclick = () => change(async () => { accept((await call(op === 'open' ? 'sessionOpen' : 'sessionFolder', { kind, id: current.id })).session); });
    return {
      get current() { return current; }, get loading() { return loading; },
      async activate(nextKind) {
        kind = nextKind; current = null; paint(); onChange(null);
        if (!kind || !bridge) return;
        await change(async () => {
          const saved = await refresh(), last = localStorage.getItem('duo-voice-last-' + kind);
          const id = saved.find(s => s.id === last && !s.error)?.id || saved.find(s => !s.error)?.id;
          if (!id) {
            await openEmpty();
            return;
          }
          accept((await call('sessionGet', { kind, id })).session, true);
          await refresh();
        });
      },
      startNew,
      ensureOpen,
      async setCast(companion) {
        if (!bridge) return null;
        if (!current) throw new Error('Open a saved session before changing participants.');
        if (busy || loading) throw new Error('Wait for the current session operation to finish.');
        let accepted = null;
        await change(async () => { accepted = (await call('sessionCast', { kind, id: current.id, revision: current.revision, companion })).session; accept(accepted); await refresh(); });
        if (!accepted) throw new Error('Participants could not be changed. Please try again.');
        return accepted;
      },
      async setFilter(value) { filter = value; await refresh(); },
      adopt(session) { if (session?.id === current?.id && session.revision >= current.revision) accept(session); },
      async audioTranscript(session, entryId, text) { const r = await call('sessionAudioTranscript', { kind: session.kind, id: session.id, entryId, text }); if (r.session.id === current?.id && r.session.revision >= current.revision) accept(r.session); return r.session; },
      async delivery(session, entryId, delivery, options={}) { const r = await call('sessionDelivery', { kind: session.kind, id: session.id, entryId, delivery, restart: options.restart===true }); if (r.session.id === current?.id && r.session.revision >= current.revision) accept(r.session); return r.session; },
      async setTextSource(source) {if(!current)throw Error('Open a chat before attaching text.');const result=await call('sessionTextSource',{kind,id:current.id,revision:current.revision,source});accept(result.session);},
      async saveMemory(memory) { accept((await call('sessionMemory', { kind, id: current.id, revision: current.revision, ...memory })).session); },
      async configureBackstage(settings) { await change(async () => { accept((await call('backstageSettings', { kind, id: current.id, revision: current.revision, settings })).session); }); },
      async saveNote(note) { accept((await call('backstageNote', { kind, id: current.id, revision: current.revision, note })).session); },
      async revealNotes(selections, eventId) { accept((await call('backstageReveal', { kind, id: current.id, revision: current.revision, selections, eventId })).session); },
      async showNotebook(owner) { await change(async () => { accept((await call('backstageNotebook', { kind, id: current.id, owner })).session); }); },
      setBusy(value) { busy = value; paint(); },
      async append(entry) {
        if (!current) throw new Error('Open a saved session before continuing.');
        $('session-status').textContent = 'Saving turn…';
        try {
          const before = current, record = { ...entry, id: entry.id || crypto.randomUUID() }; let result;
          try { result = await call('sessionAppend', { kind, id: before.id, revision: before.revision, entry: record }); }
          catch (error) {
            if (!/Session changed/.test(error.message)) throw error;
            const latest = (await call('sessionGet', { kind, id: before.id })).session;
            if (current.id !== before.id || JSON.stringify(latest.entries.map(({ audio, delivery, ...e }) => e)) !== JSON.stringify(before.entries.map(({ audio, delivery, ...e }) => e))) throw error;
            result = await call('sessionAppend', { kind, id: latest.id, revision: latest.revision, entry: record });
          }
          accept(result.session);
          await refresh();
        } catch (e) { $('session-status').textContent = 'Not saved: ' + e.message; throw e; }
      }
    };
  };
})();
