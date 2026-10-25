/* Duration-aware 4x2 atlas player using the per-pose registration from each character rig. */
(() => {
  'use strict';

  const catalog = window.DiscussionSpriteActions;
  const actors = catalog ? Object.keys(catalog.actors) : [];
  const state = {};
  for (const actor of actors) document.getElementById(actor + '-sprite')?.style.setProperty('--character-scale', String(catalog.actors[actor].displayScale ?? 1));
  const images = new Map();
  const media = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  let reducedMotion = !!(media && media.matches);
  let eventSerial = 0;
  let subagentActive = false;
  let subagentActor = 'vivi';
  let soloActor='momotamu';
  let momotamuMotion = null;
  let momotamuHidden = false;   // Presence form: the sprite is hidden and her director rests
  let motionLastTime = 0;

  const wait = (ms, token) => new Promise(resolve => {
    let remaining = ms;
    let last = performance.now();
    let visible = document.visibilityState === 'visible';
    let timer = null;
    const accountTime = () => {
      const now = performance.now();
      if (visible) remaining -= now - last;
      last = now;
      visible = document.visibilityState === 'visible';
    };
    const finish = () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', accountTime);
      token.timer = null; token.finish = null; resolve();
    };
    const poll = () => {
      accountTime();
      if (remaining <= 0) { finish(); return; }
      timer = window.setTimeout(poll, Math.min(120, remaining));
      token.timer = timer;
    };
    token.finish = finish;
    document.addEventListener('visibilitychange', accountTime);
    poll();
  });
  const actionFor = (actor, key) => {
    const actions=catalog?.actors?.[actor]?.actions;
    const action=actions?.find(action=>action.key===key);
    if(actor==='vivi'&&action&&window.DiscussionAudioMotion?.conversationProfiles){if(/convo-3q/.test(action.sheet))return {...action,transitionEdges:window.DiscussionAudioMotion.conversationProfiles.vivi.edges};if(key==='viewer-speaking'||key==='welcome')return {...action,transitionEdges:window.DiscussionAudioMotion.conversationProfiles.viviFront.edges};}
    return action;
  };
  const normalizeCandidates = (actor, candidates) => (Array.isArray(candidates) ? candidates : [candidates])
    .map(candidate => typeof candidate === 'string' ? { key: candidate, weight: 1 } : candidate)
    .filter(candidate => candidate && actionFor(actor, candidate.key));
  const choose = candidates => {
    const total = candidates.reduce((sum, item) => sum + Math.max(0, Number(item.weight) || 0), 0);
    if (!total) return candidates[0];
    let roll = Math.random() * total;
    for (const item of candidates) {
      roll -= Math.max(0, Number(item.weight) || 0);
      if (roll <= 0) return item;
    }
    return candidates[candidates.length - 1];
  };
  const cycleSteps = (action, looping, cycle = 0) => {
    if (action.phrases?.length) return action.phrases[cycle % action.phrases.length].map(([frame, durationMs]) => ({ frame, durationMs }));
    const steps = action.frames.map((frame, index) => ({ frame, durationMs: action.durationsMs[index] }));
    if (action.mode !== 'pingpong') return steps;
    const reverse = steps.slice(looping ? 1 : 0, -1).reverse();
    return steps.concat(reverse);
  };

  function loadImage(action) {
    if (!images.has(action.sheet)) {
      const promise = new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error(`Could not load sprite sheet: ${action.sheet}`));
        image.src = action.sheet;
      });
      images.set(action.sheet, promise);
      promise.catch(() => images.delete(action.sheet));
    }
    return images.get(action.sheet);
  }

  function orientedAction(actor,action){
    if(!action)return action;
    const key=action.key||'';
    if(actor==='momotamu'&&subagentActive){
      if(/convo-3q/.test(action.sheet))return action;
      const target=/image/.test(key)?'3q-image-inspection':/reading/.test(key)?'3q-reading':/clarif/.test(key)?'3q-clarification':/listen|idle|neutral|attentive|welcome|open-attention/.test(key)?'3q-listening':'3q-reflection-speaking';
      return actionFor(actor,target)||action;
    }
    if(actor==='vivi'){
      if(subagentActive){if(/convo-3q/.test(action.sheet))return action;const target=/present|speaking|welcome/.test(key)?'present':/comprehension/.test(key)?'side-comprehension':/reflect|clarif|reassure|emotion/.test(key)?'reflect':'side-listen';return actionFor(actor,target)||action;}
      if(/convo-3q/.test(action.sheet))return actionFor(actor,/present|speaking|welcome/.test(key)?'viewer-speaking':/reflect|clarif|reassure/.test(key)?'reassure':'attentive-idle')||action;
    }
    if(actor==='momotamu'&&!subagentActive&&/convo-3q/.test(action.sheet))return actionFor(actor,/listen/.test(key)?'viewer-listening':'viewer-speaking')||action;
    return action;
  }
  function paint(actor, action, frame) {
    action=orientedAction(actor,action);
    if(!action.registration[frame])frame=action.frames[0];
    const s = state[actor];
    if (!s?.el) return;
    const paintId = ++s.paintId;
    s.action = action.key;
    s.frame = frame;
    s.el.dataset.spriteAction = action.key;
    s.el.dataset.spriteFrame = String(frame);
    loadImage(action).then(image => {
      if (paintId !== s.paintId) return;
      const faceInward=actor==='vivi'&&subagentActive;
      s.el.dataset.spriteFacing=subagentActive?(actor==='momotamu'?'right':'left'):'front';
      const registration = action.registration[frame];
      if (!registration) return;
      const ctx = s.el.getContext('2d');
      if (!ctx) return;
      if (s.smooth) {
        s.smooth.setPose(image, action, frame, { facing: faceInward ? 'left' : 'front', smooth: !reducedMotion });
        s.smooth.draw({ moving: !reducedMotion });
        delete s.el.dataset.spriteError;
        return;
      }
      const [x, y, width, height] = registration.crop;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.clearRect(0, 0, s.el.width, s.el.height);
      // Render one pose at a time; cross-fading pose silhouettes caused a doubled-character effect.
      ctx.setTransform(
        faceInward ? -registration.scale : registration.scale,
        0, 0, registration.scale,
        faceInward ? s.el.width - registration.tx : registration.tx,
        registration.ty
      );
      ctx.drawImage(image, x, y, width, height, 0, 0, width, height);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      if (actor === 'vivi') window.ViviBrassLight?.capture(s.el, { enabled: () => subagentActive && subagentActor === 'vivi' && !reducedMotion });
      delete s.el.dataset.spriteError;
    }).catch(error => {
      if (paintId !== s.paintId) return;
      s.el.dataset.spriteError = error.message;
    });
  }

  function settle(actor, preferredKey) {
    const spec = catalog?.actors?.[actor];
    const action = actionFor(actor, preferredKey || spec?.defaultAction);
    if (!state[actor] || !action) return;
    paint(actor, action, action.frames[0]);
    state[actor].active = false;
  }

  function cancel(actor, reason = 'cancelled') {
    const s = state[actor];
    if (!s) return;
    s.serial += 1;
    s.paintId += 1;
    if (s.token?.timer) clearTimeout(s.token.timer);
    if (s.token?.finish) s.token.finish();
    s.token = null;
    s.active = false;
    s.pending = null;
    s.reason = reason;
    s.speech = null;
    if (actor === 'momotamu') momotamuMotion?.reset(reason);
    // Starting a speech pose must keep the voice stream already opened by playVoice.
    if (reason !== 'speaking') { audioMotions[actor]?.reset(); s.smooth?.setSquish(0); }
  }

  function cancelAll(reason = 'cancelled') {
    actors.forEach(actor => cancel(actor, reason));
  }

  function returnToIdle(actor, preferredKey) {
    if (actor === 'momotamu' && momotamuMotion) { momotamuMotion.event('idle'); return Promise.resolve(true); }
    const s = state[actor];
    const optional = actor === subagentActor;
    const key = preferredKey || (actor === 'momotamu' ? subagentActive ? 'neutral' : 'attentive-idle' : optional ? 'side-listen' : 'attentive-idle');
    if (!s) return Promise.resolve(false);
    if(actor==='vivi'&&s.speech){s.speech=null;s.active=false;}
    if (actor !== 'momotamu' && !optional) { cancel(actor, 'subagent-hidden'); settle(actor, 'attentive-idle'); return Promise.resolve(true); }
    if (actor === 'momotamu' && subagentActive && key === 'neutral') {
      cancel(actor, 'conversation-idle');
      settle(actor, 'neutral');
      return Promise.resolve(true);
    }
    if (reducedMotion) { settle(actor, key); return Promise.resolve(true); }
    if (s.active && s.action === key) return Promise.resolve(true);
    return start(actor, { action: key, loop: true, interrupt: true, reason: 'idle-loop' });
  }

  function setSubagentActive(active, actor = 'vivi') {
    if(subagentActive===!!active&&subagentActor===actor)return Promise.resolve(true);
    subagentActive=!!active;soloActor='momotamu';
    // Solo chat speaks to the viewer from the front sheet; a guest on the Stage turns her 3/4 toward the guest.
    momotamuMotion?.setCast?.(subagentActive ? 'duo' : 'solo');
    if (catalog?.actors?.[actor] && actor !== 'momotamu') subagentActor = actor;
    actors.forEach(id => cancel(id, 'subagent-state-change'));
    const optionalActors = actors.filter(id => id !== 'momotamu');
    if (subagentActive) {
      optionalActors.filter(id => id !== subagentActor).forEach(id => settle(id, 'attentive-idle'));
      return Promise.all([
        momotamuMotion ? Promise.resolve(momotamuMotion.event('idle')) : play('momotamu', 'neutral', { reason: 'subagent-joined', settleAction: 'neutral', interrupt: true }),
        play(subagentActor, 'call-in', { reason: 'subagent-call-in', settleAction: 'side-listen', interrupt: true })
      ]);
    }
    optionalActors.forEach(id => settle(id, 'attentive-idle'));
    return momotamuMotion ? Promise.resolve(momotamuMotion.event('idle')) : play('momotamu', 'welcome', { reason: 'subagent-left', settleAction: 'attentive-idle', interrupt: true });
  }

  function setSoloActor(actor='momotamu'){
    if(!['momotamu','vivi'].includes(actor))return false;
    if(!subagentActive&&soloActor===actor)return true;
    setSubagentActive(false,'vivi');soloActor=actor;
    returnToIdle(actor,'attentive-idle');return true;
  }

  async function runRequest(actor, request, serial) {
    const s = state[actor];
    const candidates = normalizeCandidates(actor, request.candidates || request.action);
    if (!s || !candidates.length) return false;
    s.active = true;
    let cycles = 0;

    if (reducedMotion) {
      const picked = choose(candidates);
      const action = actionFor(actor, picked.key);
      paint(actor, action, action.frames[Math.floor(action.frames.length / 2)] || 0);
      s.lastChoice = action.key;
      s.reason = request.reason || '';
      s.cycle += 1;
      s.active = false;
      if (request.settleAction) settle(actor, request.settleAction);
      else if (request.settle === true) settle(actor);
      return true;
    }

    do {
      if (serial !== s.serial) return false;
      const picked = choose(candidates);
      const action = actionFor(actor, picked.key);
      const steps = cycleSteps(action, !!request.loop, s.cycle);
      s.lastChoice = action.key;
      s.reason = request.reason || '';
      s.cycle += 1;

      for (const step of steps) {
        if (serial !== s.serial) return false;
        paint(actor, action, step.frame);
        const duration = step.durationMs || Math.round(1000 / (action.nominalFps || 5));
        const token = { timer: null, finish: null };
        s.token = token;
        await wait(duration, token);
        if (s.token === token) s.token = null;
      }
      cycles += 1;
    } while (request.loop && serial === s.serial && !s.pending && cycles < (request.maxCycles || Infinity));

    if (serial !== s.serial) return false;
    s.active = false;
    if (s.pending) {
      const next = s.pending;
      s.pending = null;
      return start(actor, next, true);
    }
    if (request.settleAction) { returnToIdle(actor, request.settleAction); return true; }
    else if (request.settle === true) settle(actor);
    return true;
  }

  function start(actor, request, fromBoundary = false) {
    const s = state[actor];
    if (!s) return Promise.resolve(false);
    if (s.active && !request.interrupt && !fromBoundary) {
      s.pending = request;
      return Promise.resolve(true);
    }
    if (request.interrupt) cancel(actor, request.reason || 'interrupt');
    const serial = ++s.serial;
    return runRequest(actor, request, serial);
  }

  function play(actor, candidates, options = {}) {
    return start(actor, { ...options, candidates });
  }

  function classifyMomotamu(text, mode) {
    const value = `${mode || ''} ${text || ''}`.toLocaleLowerCase('en');
    if (subagentActive) {
      if (/reassur|encourag|support|stress|worr|afraid|comfort|thank/.test(value)) return [
        { key: 'reassure', weight: 4 }, { key: 'listen', weight: 1 }
      ];
      if (/explain|present|show|example|point|answer/.test(value)) return [
        { key: 'explain', weight: 4 }, { key: 'emphasis', weight: 1 }
      ];
      if (/reflect|think|clarif|consider|wonder|reason/.test(value)) return [
        { key: 'think', weight: 3 }, { key: 'listen', weight: 2 }
      ];
      return [{ key: 'listen', weight: 4 }, { key: 'neutral', weight: 1 }];
    }
    if (/reassur|encourag|support|stress|worr|afraid|comfort|thank/.test(value)) return [
      { key: 'open-arms', weight: 3 }, { key: 'attentive', weight: 2 }
    ];
    if (/explain|present|show|example|point|answer/.test(value)) return [
      { key: 'expressive', weight: 4 }, { key: 'open-arms', weight: 1 }
    ];
    return [{ key: 'attentive', weight: 4 }, { key: 'expressive', weight: 1 }];
  }

  function classifyVivi(text, mode) {
    const value = `${mode || ''} ${text || ''}`.toLocaleLowerCase('en');
    if (/reassur|encourag|support|stress|worr|afraid|comfort|thank|difficult/.test(value)) return 'reassure';
    if (/explain|present|show|example|point|answer/.test(value)) return 'present';
    if (/reflect|think|clarif|consider|wonder|reason|question/.test(value)) return 'reflect';
    return 'listen';
  }

  function classifyOptional(actor, text, mode) {
    return classifyVivi(text, mode);
  }

  function lifecycle(name, detail = {}) {
    eventSerial += 1;
    const actor = detail.actor;
    if(!subagentActive&&soloActor==='vivi'&&(!actor||actor==='vivi')){
      if(['speaking','composing','completion','stop','idle'].includes(name))return start('vivi',{action:name==='speaking'?'viewer-speaking':name==='composing'?'viewer-comprehension':'attentive-idle',loop:name==='speaking'||name==='composing',interrupt:true,reason:name});
    }
    const optional = subagentActive;
    const companion = subagentActor;
    if(actor==='vivi'&&((optional&&companion==='vivi')||(!optional&&soloActor==='vivi'))&&name==='speaking'&&window.DiscussionAudioMotion?.createConversationSpeech){momotamuMotion?.event(name,detail);const s=state.vivi;if(!s.speech){cancel('vivi','speaking');s.speech=window.DiscussionAudioMotion.createConversationSpeech(optional?'vivi':'viviFront');s.speech.begin('auto',{audioDriven:!!detail.audioDriven||audioMotions.vivi?.snapshot().source==='output'});s.active=true;s.reason=name;paint('vivi',actionFor('vivi',optional?'present':'viewer-speaking'),s.speech.state().frame);}return Promise.resolve(true);}
    if(actor==='vivi'&&['speech-end','reply-finished','handoff'].includes(name)){momotamuMotion?.event(name,detail);if(state.vivi?.speech){state.vivi.speech=null;state.vivi.active=false;}return returnToIdle('vivi',optional?'side-listen':'attentive-idle');}
    if (momotamuMotion?.event(name, detail)) {
      if (optional) {
        if (companion === 'vivi' && ['image-use', 'reading', 'passage'].includes(name)) play(companion, detail.active === false || detail.phase === 'done' ? 'side-listen' : 'viewer-comprehension', { reason: name, loop: detail.active !== false, interrupt: true });
        if (name === 'stop' || name === 'error') { cancel(companion, name); play(companion, 'side-listen', { reason: name, interrupt: true }); }
        else if (['grounding', 'choice', 'live-law-search'].includes(name)) play(companion, companion === 'vivi' ? 'side-comprehension' : 'side-listen', { reason: name, loop: detail.pending !== false });
        else if (['completion', 'model-load'].includes(name) || name === 'handoff' && detail.to === companion || (['composing', 'speaking'].includes(name) && actor !== companion)) { if (companion === 'vivi' && state.vivi?.speech) { state.vivi.speech = null; state.vivi.active = false; } play(companion, 'side-listen', { reason: name, loop: true, interrupt: true }); }
      }
      return Promise.resolve(true);
    }
    switch (name) {
      case 'welcome':
        return play('momotamu', name === 'welcome' ? 'open-arms' : 'attentive-idle', { reason: name, settleAction: 'attentive-idle' });
      case 'input':
        return play('momotamu', optional ? 'listen' : 'attentive-idle', { reason: name, settleAction: optional ? 'neutral' : 'attentive-idle' });
      case 'choice':
        return Promise.all([
          play('momotamu', optional ? 'listen' : 'attentive-idle', { reason: name, loop: true }),
          ...(optional ? [play(companion, 'side-listen', { reason: name })] : [])
        ]);
      case 'grounding':
        return Promise.all([
          play('momotamu', optional ? 'listen' : 'attentive-idle', { reason: name, loop: true }),
          ...(optional ? [play(companion, 'side-listen', { reason: name, loop: true })] : [])
        ]);
      case 'composing':
        if (actor !== 'momotamu' && (!optional || actor !== companion)) return Promise.resolve(false);
        return play(actor || 'momotamu', actor === companion && optional ? (actor === 'vivi' ? 'reflect' : 'think-clarify') : optional ? 'think' : 'attentive-idle', { reason: name, loop: true, interrupt: true });
      case 'speaking': {
        if (actor !== 'momotamu' && (!optional || actor !== companion)) return Promise.resolve(false);
        const speaker = actor || 'momotamu';
        const gesture = actor === 'vivi' ? (/broadcast|podcast/.test(detail.mode || '') ? 'viewer-speaking' : 'present') : actor === companion && optional ? classifyOptional(actor, detail.text, detail.mode) : classifyMomotamu(detail.text, detail.mode);
        const current = state[speaker];
        if (speaker === 'momotamu' && current?.active) {
          const candidateKeys = Array.isArray(gesture) ? gesture.map(item => item.key) : [gesture];
          if (candidateKeys.includes(current.lastChoice)) return Promise.resolve(true);
          // Let the current gesture finish before switching to a different one.
          return play(speaker, gesture, { reason: name, loop: true });
        }
        return play(speaker, gesture, { reason: name, loop: true, interrupt: speaker !== 'momotamu' });
      }
      case 'handoff':
        return Promise.all([
          play(actor || 'momotamu', actor === companion && optional ? classifyOptional(actor, detail.text, detail.mode) : classifyMomotamu(detail.text, detail.mode), { reason: name, settleAction: actor === companion && optional ? 'side-listen' : optional ? 'neutral' : 'attentive-idle', interrupt: true }),
          ...(optional && detail.to === companion ? [play(companion, 'side-listen', { reason: name })] : [])
        ]);
      case 'completion':
        return Promise.all([
          play('momotamu', optional ? 'neutral' : 'welcome', { reason: name, settleAction: optional ? 'neutral' : 'attentive-idle' }),
          ...(optional ? [play(companion, 'side-listen', { reason: name })] : [])
        ]);
      case 'stop':
      case 'error':
        cancelAll(name);
        return Promise.all([
          optional
            ? play('momotamu', 'neutral', { reason: name, settleAction: 'neutral', interrupt: true })
            : play('momotamu', 'attentive-idle', { reason: name, loop: true, interrupt: true }),
          ...(optional ? [play(companion, 'side-listen', { reason: name, interrupt: true })] : [])
        ]);
      case 'model-load':
        return Promise.all([
          play('momotamu', optional ? 'listen' : 'open-arms', { reason: name, settleAction: optional ? 'neutral' : 'attentive-idle' }),
          ...(optional ? [play(companion, 'side-listen', { reason: name })] : [])
        ]);
      case 'live-law-search':
        return Promise.all([
          play('momotamu', optional ? 'listen' : 'attentive-idle', { reason: name, loop: true }),
          ...(optional ? [play(companion, 'side-listen', { reason: name, loop: detail.pending !== false })] : [])
        ]);
      default:
        return Promise.resolve(false);
    }
  }

  const audioMotions=Object.fromEntries(['momotamu','vivi'].map(actor=>[actor,window.DiscussionAudioMotion?.createReactor()]));
  function audio(name,{source,id,actor='momotamu',rms=0}={}) {
    const audioMotion=audioMotions[actor];
    if(!audioMotion)return false;
    if(name==='begin')return audioMotion.begin(source,id);
    if(name==='level')return audioMotion.sample(source,id,rms);
    if(name==='end')return audioMotion.end(source,id);
    if(name==='backchannel'){audioMotion.nod?.();return true;}
    return false;
  }
  function snapshot() {
    return actors.reduce((out, actor) => {
      const s = state[actor];
      out[actor] = s ? { action: s.action, frame: s.frame, active: s.active, cycle: s.cycle, reason: s.reason, lastChoice: s.lastChoice, ...(actor === 'momotamu' && momotamuMotion ? { feature: momotamuMotion.snapshot() } : {}), ...(s.smooth ? {audio:audioMotions[actor]?.snapshot(),smooth:s.smooth.snapshot()} : {}) } : null;
      return out;
    }, {});
  }

  function init() {
    if (!catalog || catalog.grid?.[0] !== 4 || catalog.grid?.[1] !== 2) return false;
    actors.forEach(actor => {
      const spec = catalog.actors[actor];
      const el = document.getElementById(`${actor}-sprite`);
      if (el && spec?.canvas) { el.width = spec.canvas[0]; el.height = spec.canvas[1]; }
      state[actor] = { el, serial: 0, token: null, active: false, pending: null, action: '', frame: 0, cycle: 0, reason: '', lastChoice: '', paintId: 0 };
      if (audioMotions[actor] && el && window.DiscussionSmoothMotion) state[actor].smooth = window.DiscussionSmoothMotion.createPainter(el, { edges: actor === 'momotamu' ? window.MomotamuSpeakingMotion?.compatibleDirectedEdges || [] : [] });
      settle(actor);
    });
    if (window.createMomotamuFeatureDirector && window.MomotamuSpeakingMotion) {
      momotamuMotion = window.createMomotamuFeatureDirector({
        actions: catalog.actors.momotamu.actions, speech: window.MomotamuSpeakingMotion, poses: { idle: readIdlePose() }, cast: subagentActive ? 'duo' : 'solo',
        paint: (action, frame) => paint('momotamu', action, frame),
        setSway: active => state.momotamu.el?.classList.toggle('natural-speech-sway', active)
      });
      momotamuMotion.setReducedMotion(reducedMotion);
      momotamuMotion.setVisible(!momotamuHidden && document.visibilityState === 'visible');
      const animate = now => {
        const delta = motionLastTime ? Math.min(100, now - motionLastTime) : 0;
        const prior=momotamuMotion.snapshot(),reaction=audioMotions.momotamu?.advance(delta,{enabled:!reducedMotion&&prior.visible&&!prior.frozen});
        momotamuMotion.setAudioLevel(reaction?.source==='output'?reaction.rms:0);
        if (motionLastTime) momotamuMotion.advance(delta);
        motionLastTime = now;
        const feature = momotamuMotion.snapshot();
        state.momotamu.smooth?.setSquish(reaction?.squish||0);
        if (feature.visible && !feature.reducedMotion && !feature.frozen) state.momotamu.smooth?.advance(delta);
        state.momotamu.active = feature.motion !== 'idle';
        state.momotamu.reason = feature.reason;
        state.momotamu.el.dataset.spriteMotion = feature.motion;
        const vivi=state.vivi;
        if(vivi?.smooth){
          const viviOnStage=(subagentActive&&subagentActor==='vivi')||(!subagentActive&&soloActor==='vivi');
          const moving=!reducedMotion&&document.visibilityState==='visible'&&viviOnStage&&!feature.frozen;
          const reaction=audioMotions.vivi.advance(delta,{enabled:moving});
          if(vivi.speech&&moving){vivi.speech.setLevel(reaction.source==='output'?reaction.rms:0);vivi.speech.advance(delta);const speechAct=actionFor('vivi',subagentActive?'present':'viewer-speaking'),frame=vivi.speech.state().frame;if(vivi.frame!==frame||vivi.action!==speechAct.key)paint('vivi',speechAct,frame);}
          vivi.smooth.setSquish(reaction.squish);vivi.smooth.advance(delta,{moving});
        }
        requestAnimationFrame(animate);
      };
      requestAnimationFrame(animate);
      document.addEventListener('visibilitychange', () => { motionLastTime = 0; momotamuMotion.setVisible(!momotamuHidden && document.visibilityState === 'visible'); });
    }
    lifecycle('welcome');
    return actors.every(actor => !!state[actor]?.el);
  }

  if (media) {
    const onChange = event => {
      reducedMotion = !!event.matches;
      if (momotamuMotion) actors.filter(actor => actor !== 'momotamu').forEach(actor => cancel(actor, 'reduced-motion-change'));
      else cancelAll('reduced-motion-change');
      if (momotamuMotion) momotamuMotion.setReducedMotion(reducedMotion);
      if (subagentActive) {
        if (!momotamuMotion) settle('momotamu', 'neutral');
        settle(subagentActor, 'side-listen');
      } else {
        if (!momotamuMotion) settle('momotamu', 'attentive-idle');
        actors.filter(actor => actor !== 'momotamu').forEach(actor => settle(actor, 'attentive-idle'));
      }
    };
    if (media.addEventListener) media.addEventListener('change', onChange);
    else if (media.addListener) media.addListener(onChange);
  }

  // Resting pose: the saved idle sheet choice applies live, here and in any other window that shares the preference.
  function readIdlePose() { try { return localStorage.getItem(window.MomotamuPoseBanks?.storageKey) || ''; } catch { return ''; } }
  function setMomotamuPose(kind, id) { return !!momotamuMotion?.setPose?.(kind, id); }
  window.addEventListener('storage', event => {
    const banks = window.MomotamuPoseBanks;
    if (banks && event.key === banks.storageKey) setMomotamuPose('idle', event.newValue || banks.idle.defaultChoice);
  });

  // Display form switch: pause or resume Momotamu's director through the existing visibility path.
  function setMomotamuVisible(value) {
    momotamuHidden = !value;
    if (momotamuMotion) { motionLastTime = 0; momotamuMotion.setVisible(!momotamuHidden && document.visibilityState === 'visible'); }
    return true;
  }

  window.DiscussionSprites = Object.freeze({ init, play, lifecycle, audio, cancel, cancelAll, settle, returnToIdle, setSubagentActive, setSoloActor, setMomotamuVisible, setMomotamuPose, snapshot, classifyMomotamu, classifyVivi });
  window.DISCUSSION_SPRITE_QA = Object.freeze({
    version: 2,
    atlasGrid: Object.freeze([4, 2]),
    actors,
    actionCount: actors.reduce((n, actor) => n + catalog.actors[actor].actions.length, 0),
    get reducedMotion() { return reducedMotion; },
    get eventSerial() { return eventSerial; },
    snapshot,
    actionKeys: actor => (catalog?.actors?.[actor]?.actions || []).map(action => action.key),
    validate: () => ({
      ok: !!catalog && catalog.grid?.[0] === 4 && catalog.grid?.[1] === 2
        && actors.every(actor => state[actor]?.el && catalog.actors[actor].actions.every(action => action.frames.length === action.durationsMs.length && action.registration.length === 8)),
      actionCount: actors.reduce((n, actor) => n + catalog.actors[actor].actions.length, 0),
      state: snapshot()
    })
  });
})();
