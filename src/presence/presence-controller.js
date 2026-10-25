/* Momotamu presence: display form controller.
   Owns the form preference (Character / Presence / Portrait), the View and Settings controls, and the conversation
   cast layout for all forms: solo chats put Momotamu beside the composer (her sprite, the disc or the portrait, same slot),
   a chosen guest opens the Stage band, Recording view carries the stage. Also the disc's and the portrait's animation loop.
   The Stage rule (momotamu-form-rule.js): opening the Stage shows her as Character and closing it brings the earlier form back.
   Observe only: it reads app state from the DOM and never drives the conversation, listening or voice.
   Elements are moved, never recreated, so the sprite runtime keeps its canvas.
   Also owns the Character form's Resting pose preference (which approved sheet acts her idle); the sprite runtime applies it. */
(() => {
  'use strict';
  const KEY = 'duo-voice-momotamu-form', ASSET_BASE = 'characters/momotamu-presence/assets/gen/';
  const FORMS = ['character', 'presence', 'portrait'];
  const CONVERSATION = ['chat', 'discussions'];
  const $ = id => document.getElementById(id);
  const storage = (() => { try { return window.localStorage; } catch { return null; } })();
  const readForm = () => { try { const value = localStorage.getItem(KEY); return FORMS.includes(value) ? value : 'character'; } catch { return 'character'; } };
  const saveForm = () => { try { localStorage.setItem(KEY, form); } catch { /* preference stays for this run */ } };
  const media = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  const Model = window.DiscussionPresenceModel, Signals = window.DiscussionPresenceSignals;
  let getSettings = () => ({});
  const model = Model.create({ reducedMotion: !!media?.matches });
  const signals = Signals.create({ model, getVoiceOn: () => { try { const settings = getSettings(); return window.DiscussionVoicePolicy ? window.DiscussionVoicePolicy.speaksReplies(settings) : !settings?.voiceDisabled && settings?.voiceSpeechDeferred !== true; } catch { return true; } }, onCue: name => cue(name) });
  const rule = (() => { try { return window.DiscussionMomotamuFormRule?.create({ storage }) || null; } catch { return null; } })();
  let form = readForm(), layout = '', started = false, painter = null, assets = null, failed = false, errors = 0;
  // Portrait form: loaded the first time it is shown; any failure shows the Character instead.
  const portrait = { root: null, frame: null, main: null, jewel: null, meter: null, fill: null, word: null, painter: null, frames: null, assets: null,
    loading: false, failed: false, errors: 0, lastWord: null, lastGated: null, lastKey: null, happyAt: -1 };
  // Resting pose: choices come from MomotamuPoseBanks (momotamu-feature-motion.js); nothing changes until one is picked.
  const poseBank = () => window.MomotamuPoseBanks?.idle || null;
  const readPose = () => {
    const bank = poseBank(); if (!bank) return '';
    try { const value = localStorage.getItem(window.MomotamuPoseBanks.storageKey); return bank.choices.some(c => c.id === value) ? value : bank.defaultChoice; } catch { return bank.defaultChoice; }
  };
  let pose = readPose();
  let slot = null, root = null, canvas = null, stateWord = null, meter = null, meterFill = null, frame = 0, last = 0, acc = 0, lastKey = null, lastWord = null, lastGated = null;

  function build() {
    root = document.createElement('div'); root.id = 'momotamu-presence'; root.className = 'presence-disc'; root.hidden = true;
    const plate = document.createElement('div'); plate.className = 'presence-plate'; plate.setAttribute('role', 'img'); plate.setAttribute('aria-label', 'Momotamu');
    canvas = document.createElement('canvas'); canvas.className = 'presence-canvas'; canvas.setAttribute('aria-hidden', 'true'); plate.append(canvas);
    meter = document.createElement('div'); meter.className = 'presence-meter'; meter.setAttribute('role', 'meter'); meter.setAttribute('aria-label', 'Microphone level');
    meter.setAttribute('aria-valuemin', '0'); meter.setAttribute('aria-valuemax', '100'); meter.setAttribute('aria-valuenow', '0');
    meterFill = document.createElement('span'); meter.append(meterFill);
    stateWord = document.createElement('span'); stateWord.className = 'presence-state'; stateWord.setAttribute('role', 'status');
    root.append(plate, meter, stateWord);
    slot = document.createElement('div'); slot.id = 'momotamu-slot'; slot.className = 'cast-slot'; slot.hidden = true;
    const p = portrait;
    p.root = document.createElement('div'); p.root.id = 'momotamu-portrait'; p.root.className = 'portrait-card'; p.root.hidden = true;
    p.frame = document.createElement('div'); p.frame.className = 'portrait-frame'; p.frame.setAttribute('role', 'img'); p.frame.setAttribute('aria-label', 'Momotamu');
    p.main = document.createElement('canvas'); p.main.className = 'portrait-main'; p.main.setAttribute('aria-hidden', 'true');
    p.jewel = document.createElement('canvas'); p.jewel.className = 'portrait-jewel'; p.jewel.setAttribute('aria-hidden', 'true');
    p.frame.append(p.main, p.jewel);
    p.meter = document.createElement('div'); p.meter.className = 'presence-meter'; p.meter.setAttribute('role', 'meter'); p.meter.setAttribute('aria-label', 'Microphone level');
    p.meter.setAttribute('aria-valuemin', '0'); p.meter.setAttribute('aria-valuemax', '100'); p.meter.setAttribute('aria-valuenow', '0');
    p.fill = document.createElement('span'); p.meter.append(p.fill);
    p.word = document.createElement('span'); p.word.className = 'presence-state'; p.word.setAttribute('role', 'status');
    p.root.append(p.frame, p.meter, p.word);
    return root;
  }
  function place(node, parent, before) {
    if (!node || !parent || before === node) return;
    if (node.parentElement === parent && (before ? node.nextSibling === before : true)) return;
    parent.insertBefore(node, before || null);
  }
  function computeLayout() {
    const app = document.querySelector('.app'), stage = document.querySelector('.stage');
    if (!app || !CONVERSATION.includes(app.dataset.activity)) return '';
    if (document.body.classList.contains('recording-mode')) return 'recording';
    return 'stage'; // Duo keeps every cast, including solo, on the top platform.
  }
  function homeMascot() {
    // Momotamu's character mascot always returns to the first place on the stage it came from.
    const mascot = $('momotamu-stage'), stage = document.querySelector('.stage');
    if (mascot && stage && mascot.parentElement !== stage) place(mascot, stage, stage.firstElementChild);
  }
  // The Stage is open while a guest is chosen in a conversation; elsewhere (Studio, Make a short) it is not observed.
  function stageOpen() {
    const app = document.querySelector('.app'), stage = document.querySelector('.stage');
    if (!app || !CONVERSATION.includes(app.dataset.activity)) return null;
    return stage?.dataset.subagent === 'active';
  }
  function apply() {
    try {
      const app = document.querySelector('.app'); if (!app || !root) return;
      const open = stageOpen();
      if (rule && open !== null) { try { const next = rule.update(open, form); if (next !== form) { form = next; saveForm(); } } catch { /* the form stays as chosen */ } }
      if (form === 'portrait') loadPortrait();
      const next = computeLayout();
      // The visual for this form: the disc, the portrait, or none (the Character sprite). An unavailable portrait shows the Character.
      const visual = form === 'presence' ? root : form === 'portrait' && portrait.painter && !portrait.failed ? portrait.root : null;
      const shown = !!visual && !!next, presence = !!visual, shownForm = visual ? form : 'character'; layout = next;
      app.dataset.momotamuForm = shownForm;
      if (next) app.dataset.castLayout = next; else delete app.dataset.castLayout;
      const sprite = $('momotamu-sprite'), bubble = $('momotamu-bubble'), mascot = $('momotamu-stage');
      if (sprite) sprite.hidden = shown; if (bubble) bubble.hidden = shown;
      try { window.DiscussionSprites?.setMomotamuVisible?.(!shown); } catch { /* sprites keep running */ }
      if (next === 'pulse') { const console = document.querySelector('.console'); place(slot, console, console?.firstChild); }
      slot.hidden = next !== 'pulse';
      if (!presence && next === 'pulse') place(mascot, slot, null); else homeMascot();
      for (const el of [root, portrait.root]) if (el !== visual || !shown) { el.hidden = true; el.dataset.layout = ''; }
      if (shown && next === 'pulse') place(visual, slot, null);
      else if (shown) place(visual, mascot, bubble || mascot?.firstChild);
      if (shown) { visual.hidden = false; visual.dataset.layout = next; }
      syncControls();
      lastKey = null; portrait.lastKey = null;
      if (shown) start(); else stop();
    } catch {
      // A layout failure falls back to the original workbench with the character on its stage.
      try { homeMascot(); const app = document.querySelector('.app'); if (app) delete app.dataset.castLayout; if (slot) slot.hidden = true; if (portrait.root) portrait.root.hidden = true; } catch {}
    }
  }
  function loadPortrait() {
    const p = portrait; if (p.painter || p.loading || p.failed) return;
    const Frames = window.DiscussionPortraitFrames, Painter = window.DiscussionPortraitPainter;
    if (!Frames || !Painter || !window.DiscussionPresencePainter) { p.failed = true; return; }
    p.loading = true;
    const presenceReady = assets ? Promise.resolve(assets) : window.DiscussionPresencePainter.loadAssets(ASSET_BASE).then(loaded => (assets = assets || loaded));
    Promise.all([Painter.loadAssets(Frames.ROOT), presenceReady]).then(([loaded, glass]) => {
      p.assets = loaded; p.frames = Frames.create(loaded.norm, { seed: 11 });
      p.painter = Painter.create({ main: p.main, jewel: p.jewel, assets: loaded, presenceAssets: glass });
      p.loading = false; apply();
    }).catch(() => { p.loading = false; p.failed = true; apply(); });
  }
  function portraitFail() { const p = portrait; p.failed = true; p.painter = null; apply(); }
  // Portrait reactions from presence signals: happy (model ready) holds the happy frame and sparkles the jewel briefly;
  // worried (an error) holds the worried frame only. The frame chooser times both from the manifest.
  function cue(name) {
    try {
      if (name === 'nod') {
        if (form === 'portrait' && portrait.frames?.cue?.(name)) portrait.happyAt = performance.now();
        else if (form === 'presence') model.addPiece({ level: 0.85 });
        return;
      }
      if (form === 'portrait' && portrait.frames?.cue(name) && name === 'happy') portrait.happyAt = performance.now();
    } catch { /* observe only */ }
  }
  function theme() { return document.body?.dataset.theme === 'light' ? 'light' : 'dark'; }
  function syncControls() {
    document.querySelectorAll('input[name="momotamu-form"]').forEach(input => { input.checked = input.value === form; });
    const select = $('cfg-momotamu-form'); if (select) select.value = form;
    const bank = poseBank();
    ['cfg-momotamu-idle', 'view-momotamu-idle'].forEach(id => { const control = $(id); if (control && pose) control.value = pose; });
    const row = $('momotamu-idle-choice'); if (row) row.hidden = !bank || form !== 'character';
    const setting = $('cfg-momotamu-idle-row'); if (setting) setting.hidden = !bank;
  }
  function fillPoses(select) {
    const bank = poseBank();
    if (!select || !bank || select.options.length) return;
    for (const choice of bank.choices) select.append(new Option(choice.label + (choice.id === bank.defaultChoice ? ' (default)' : ''), choice.id));
  }
  function setPose(value) {
    const bank = poseBank(); if (!bank) return false;
    pose = bank.choices.some(c => c.id === value) ? value : bank.defaultChoice;
    try { localStorage.setItem(window.MomotamuPoseBanks.storageKey, pose); } catch { /* preference stays for this run */ }
    let applied = false;
    try { applied = !!window.DiscussionSprites?.setMomotamuPose?.('idle', pose); } catch { /* the sprite keeps its current idle */ }
    syncControls();
    return applied;
  }
  // A choice in View or Settings. During a Stage it is kept for the rest of that Stage.
  function setForm(value) {
    form = FORMS.includes(value) ? value : 'character';
    try { if (rule) form = rule.choose(form); } catch { /* the choice stands */ }
    saveForm();
    apply();
  }
  function measure() {
    if (canvas && painter) {
      const rect = canvas.getBoundingClientRect();
      if (rect.width >= 4 && painter.resize(rect.width, window.devicePixelRatio || 1)) lastKey = null;
    }
    const p = portrait;
    if (p.painter && p.frame) {
      const rect = p.frame.getBoundingClientRect();
      if (rect.width >= 4 && p.painter.resize(rect.width, window.devicePixelRatio || 1, theme())) p.lastKey = null;
    }
  }
  function paintPortrait(dt) {
    const p = portrait, rm = model.reducedMotion, snap = model.snapshot();
    p.frames.step(dt, { state: snap.state, level: snap.tts, reducedMotion: rm });
    const since = p.happyAt >= 0 ? (performance.now() - p.happyAt) / 1000 : Infinity;
    const happy = since < 1.9 ? { k: p.frames.happy ? 1 : Math.max(0, 1 - (since - 1.5) / 0.4), t: since } : null;
    // Still states (paused, voice off, off) redraw only when something visible changes.
    const key = snap.still && !happy ? [model.stillKey(), p.frames.frame, p.painter.size, theme()].join('|') : null;
    if (key === null || key !== p.lastKey) { p.painter.draw(snap, { frame: p.frames.frame, bob: snap.still ? 0 : p.frames.bob(rm), reducedMotion: rm, happy, dt }); p.lastKey = key; }
    if (snap.label !== p.lastWord) { p.word.textContent = snap.label; p.root.dataset.state = snap.state; p.lastWord = snap.label; }
    const pct = Math.round(snap.mic * 100); p.fill.style.width = pct + '%'; p.meter.setAttribute('aria-valuenow', String(pct));
    const gated = !!signals.inputGated; if (gated !== p.lastGated) { p.meter.classList.toggle('gated', gated); if (gated) p.meter.title = 'Microphone paused'; else p.meter.removeAttribute('title'); p.lastGated = gated; }
  }
  function paint(dt) {
    signals.refresh();
    model.step(dt);
    if (form === 'portrait') {
      if (portrait.painter && !portrait.root.hidden) { try { paintPortrait(dt); portrait.errors = 0; } catch { if (++portrait.errors > 3) portraitFail(); } }
      return;
    }
    const still = model.still();
    const snap = model.snapshot();
    const key = still ? [model.stillKey(), painter?.size].join('|') : null;
    if (painter && (key === null || key !== lastKey)) { painter.draw(snap); lastKey = key; }
    if (snap.label !== lastWord) { stateWord.textContent = snap.label; root.dataset.state = snap.state; lastWord = snap.label; }
    const pct = Math.round(snap.mic * 100); meterFill.style.width = pct + '%'; meter.setAttribute('aria-valuenow', String(pct));
    const gated = !!signals.inputGated; if (gated !== lastGated) { meter.classList.toggle('gated', gated); if (gated) meter.title = 'Microphone paused'; else meter.removeAttribute('title'); lastGated = gated; }
  }
  function loop(now) {
    frame = 0;
    if (!started) return;
    if (document.visibilityState === 'hidden') { last = 0; return; }
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 0; last = now; acc += dt;
    const cap = form === 'portrait' ? 1 / 36 : (painter?.size || 0) >= 160 ? 1 / 60 : 1 / 30;   // the portrait and smaller discs redraw at 30-36 fps
    if (acc >= cap - 0.001) {
      try { paint(acc); errors = 0; } catch { if (++errors > 3) { fail(); return; } }
      acc = 0;
    }
    frame = requestAnimationFrame(loop);
  }
  function start() { if (failed) return; started = true; measure(); if (!frame) { last = 0; frame = requestAnimationFrame(loop); } }
  function stop() { started = false; if (frame) cancelAnimationFrame(frame); frame = 0; last = 0; }
  function fail() { failed = true; stop(); root?.classList.add('presence-fallback'); }
  function init(options = {}) {
    try {
      if (root) return api;
      if (typeof options.getSettings === 'function') getSettings = options.getSettings;
      build();
      document.querySelectorAll('input[name="momotamu-form"]').forEach(input => input.addEventListener('change', () => { if (input.checked) setForm(input.value); }));
      $('cfg-momotamu-form')?.addEventListener('change', event => setForm(event.target.value));
      ['cfg-momotamu-idle', 'view-momotamu-idle'].forEach(id => { const select = $(id); fillPoses(select); select?.addEventListener('change', event => setPose(event.target.value)); });
      window.addEventListener('storage', event => { if (event.key === window.MomotamuPoseBanks?.storageKey) { pose = readPose(); syncControls(); } });
      syncControls();
      const watch = new MutationObserver(apply), app = document.querySelector('.app'), stage = document.querySelector('.stage');
      if (app) watch.observe(app, { attributes: true, attributeFilter: ['data-activity'] });
      if (stage) watch.observe(stage, { attributes: true, attributeFilter: ['data-subagent'] });
      watch.observe(document.body, { attributes: true, attributeFilter: ['class'] });
      new MutationObserver(() => { try { measure(); } catch {} }).observe(document.body, { attributes: true, attributeFilter: ['data-theme'] });
      const handsFree = () => { const b = document.querySelector('.hands-free-button'); signals.handsFree(b && b.getAttribute('aria-pressed') === 'true' ? b.dataset.state : 'off'); };
      const button = document.querySelector('.hands-free-button');
      if (button) new MutationObserver(handsFree).observe(button, { attributes: true, attributeFilter: ['data-state', 'aria-pressed'] });
      if (window.ResizeObserver) { const resized = new ResizeObserver(() => { try { measure(); } catch {} }); resized.observe(canvas); resized.observe(portrait.frame); }
      const onMotion = event => { model.setReducedMotion(!!event.matches); lastKey = null; portrait.lastKey = null; };
      if (media?.addEventListener) media.addEventListener('change', onMotion); else media?.addListener?.(onMotion);
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && started && !frame) { last = 0; frame = requestAnimationFrame(loop); } });
      window.DiscussionPresencePainter.loadAssets(options.assetBase || ASSET_BASE).then(loaded => {
        assets = loaded; painter = window.DiscussionPresencePainter.create(canvas, assets); lastKey = null; measure();
      }).catch(fail);
      apply();
    } catch { fail(); }
    return api;
  }
  const api = {
    init, setForm, setPose, signals, model,
    get form() { return form; }, get layout() { return layout; }, get pose() { return pose; },
    snapshot: () => ({ form, pose, layout, state: model.state, failed, ready: !!painter, signals: signals.snapshot(),
      portrait: { ready: !!portrait.painter, failed: portrait.failed, frame: portrait.frames?.frame || null }, stage: rule ? rule.snapshot() : null })
  };
  window.DiscussionPresence = api;
  window.DISCUSSION_PRESENCE_QA = Object.freeze({ snapshot: api.snapshot });
})();
