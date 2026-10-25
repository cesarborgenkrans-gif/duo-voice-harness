(function () {
  'use strict';
  window.createBackstageController = function ({ sessionController, onReveal, onResume, onStop, onStatus }) {
    const $ = id => document.getElementById(id), B = window.DiscussionBackstage, C = window.DiscussionConversation;
    let session = null, owner = 'momotamu', selectedId = null, busy = false, queued = false, savingSettings = false;
    const dialog = $('backstage-panel');
    const currentNote = () => session?.backstage?.notes.find(n => n.owner === owner && n.id === selectedId);
    function selection() {
      const n = currentNote(); if (!n) return null;
      const field = $('backstage-text'), start = field.selectionStart, end = field.selectionEnd;
      return { noteId: n.id, start: start === end ? 0 : start, end: start === end ? n.text.length : end };
    }
    function paintSelection() {
      const n = currentNote(), choice = selection();
      if (!n || !choice) return;
      const partial = choice.start !== 0 || choice.end !== n.text.length;
      const disclosed = B.alreadyShared(session, n, choice.start, choice.end);
      $('backstage-reveal').textContent = partial ? 'Reveal selected excerpt' : 'Reveal entry';
      $('backstage-selection').textContent = disclosed ? 'This selection is already public.' : partial ? `Only these words will be disclosed: “${n.text.slice(choice.start, choice.end)}”` : 'Reveal will disclose this entire entry to the partner and add a short reaction scene.';
      $('backstage-reveal').disabled = disclosed || queued || !!B.reactionSpeaker(session) || savingSettings || sessionController.loading;
    }
    function paint() {
      const discussion = session?.kind === 'discussion';
      $('backstage-toggle').hidden = !discussion;
      $('backstage-settings').hidden = !discussion;
      if (!discussion) { if (dialog.open) dialog.close(); return; }
      const b = session.backstage || B.defaults(), notes = b.notes || [];
      $('backstage-toggle').textContent = `✉ Backstage${notes.length ? ' · ' + notes.length : ''}`;
      if (!savingSettings) { $('backstage-enabled').checked = b.enabled; $('backstage-interval').value = String(b.interval); $('backstage-tone').value = b.tone; $('backstage-reveal-end').checked = b.revealAtEnd; }
      for (const id of ['backstage-enabled', 'backstage-interval', 'backstage-tone', 'backstage-reveal-end']) $(id).disabled = busy || savingSettings || sessionController.loading;
      if (!session.participants.includes(owner)) owner = session.participants[0];
      $('backstage-owners').replaceChildren(...session.participants.map(actor => {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'ghost'; button.textContent = C.names[actor]; button.setAttribute('aria-pressed', String(actor === owner)); button.dataset.owner = actor;
        button.onclick = () => { owner = actor; selectedId = null; paint(); }; return button;
      }));
      const ownNotes = notes.filter(n => n.owner === owner);
      if (!ownNotes.some(n => n.id === selectedId)) selectedId = ownNotes.at(-1)?.id || null;
      $('backstage-empty').hidden = !!ownNotes.length;
      $('backstage-empty').textContent = !b.enabled ? 'Enable Backstage in Session options to start these notebooks. Existing notes stay available.' : `${C.names[owner]} writes after ${b.interval} completed replies of their own. Reaction turns and interrupted replies do not count.`;
      $('backstage-note-view').hidden = !ownNotes.length;
      $('backstage-entry').replaceChildren(...[...ownNotes].reverse().map(n => { const option = document.createElement('option'); option.value = n.id; option.textContent = `After reply ${n.replyCount} · ${B.visibility(session, n) === 'private' ? 'Sealed' : B.visibility(session, n) === 'partial' ? 'Partly shared' : 'Shared'}`; return option; }));
      $('backstage-entry').value = selectedId || '';
      const n = currentNote();
      if (n) {
        if ($('backstage-text').value !== n.text) { $('backstage-text').value = n.text; $('backstage-text').setSelectionRange(0, 0); }
        const status = B.visibility(session, n);
        $('backstage-visibility').textContent = status === 'private' ? '✉ Sealed from partner' : status === 'partial' ? '◐ Partly revealed' : '↗ Revealed';
        $('backstage-visibility').dataset.visibility = status;
        $('backstage-note-time').textContent = new Date(n.createdAt).toLocaleString();
        $('backstage-file').disabled = busy || sessionController.loading;
        paintSelection();
      }
      $('backstage-stop').hidden = !busy;
      $('backstage-resume').hidden = !B.reactionSpeaker(session) || busy;
      $('backstage-configure').disabled = busy || sessionController.loading;
    }
    async function configure() {
      if (busy || savingSettings || sessionController.loading) return;
      const settings = { enabled: $('backstage-enabled').checked, interval: Number($('backstage-interval').value), tone: $('backstage-tone').value, revealAtEnd: $('backstage-reveal-end').checked };
      savingSettings = true; paint();
      try { await sessionController.configureBackstage(settings); }
      catch (e) { onStatus('Backstage settings: ' + e.message, 'err'); }
      finally { savingSettings = false; paint(); }
    }
    for (const id of ['backstage-enabled', 'backstage-interval', 'backstage-tone', 'backstage-reveal-end']) $(id).addEventListener('change', configure);
    $('backstage-toggle').onclick = () => { paint(); dialog.showModal(); };
    $('backstage-close').onclick = () => dialog.close();
    dialog.addEventListener('close', () => { if (!$('backstage-toggle').hidden) $('backstage-toggle').focus(); });
    $('backstage-entry').onchange = () => { selectedId = $('backstage-entry').value; paint(); };
    for (const event of ['select', 'keyup', 'mouseup']) $('backstage-text').addEventListener(event, paintSelection);
    $('backstage-reveal').onclick = async () => {
      const choice = selection(); if (!choice) return;
      try { await onReveal([choice]); dialog.close(); }
      catch (e) { $('backstage-status').textContent = 'Reveal: ' + e.message; }
    };
    $('backstage-file').onclick = async () => { try { await sessionController.showNotebook(owner); } catch (e) { $('backstage-status').textContent = e.message; } };
    $('backstage-configure').onclick = () => { dialog.close(); $('session-tools').open = true; $('backstage-enabled').focus(); };
    $('backstage-resume').onclick = () => { dialog.close(); onResume(); };
    $('backstage-stop').onclick = onStop;
    return {
      update(s) { if (s?.id !== session?.id) { selectedId = null; queued = false; $('backstage-status').textContent = ''; } session = s; paint(); },
      setBusy(value) { busy = value; paint(); },
      setQueued(value) { queued = value; paint(); },
      status(text) { $('backstage-status').textContent = text; },
      close() { if (dialog.open) dialog.close(); }
    };
  };
})();
