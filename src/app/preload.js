const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('discussion', {
  isElectron: true,
  credentialSave: input => ipcRenderer.invoke('credential-save',input),
  credentialStatus: ref => ipcRenderer.invoke('credential-status',ref),
  credentialRemove: ref => ipcRenderer.invoke('credential-remove',ref),
  voiceConnections: (operation,input) => ipcRenderer.invoke('voice-connections',operation,input),
  publishFlowSnapshot:value=>ipcRenderer.send('flow-observer-publish',value),
  publishListeningFlowSnapshot:value=>ipcRenderer.send('flow-listening-observer-publish',value),
  onConversationFlow:callback=>{const listener=(_e,packet)=>callback(packet);ipcRenderer.on('conversation-flow',listener);return()=>ipcRenderer.removeListener('conversation-flow',listener);},
  shelveInterviewPreparation:raw=>ipcRenderer.invoke('shelve-interview-preparation',raw),
  worktree:(op,args={})=>ipcRenderer.invoke('worktree-operation',op,args),
  gpuStatus:()=>ipcRenderer.invoke('gpu-status'),
  companionStageOwner:()=>ipcRenderer.invoke('companion-stage-owner'),
  onCompanionStageOwner:callback=>{const listener=(_e,owner)=>callback(owner);ipcRenderer.on('companion-stage-owner',listener);return()=>ipcRenderer.removeListener('companion-stage-owner',listener);},
  documentPreflight: opts => ipcRenderer.invoke('document-preflight',opts),
  documentPreview: opts => ipcRenderer.invoke('document-preview',opts),
  documentReference: opts => ipcRenderer.invoke('document-reference',opts),
  onDocumentProgress: callback => {const listener=(_event,packet)=>callback(packet);ipcRenderer.on('document-progress',listener);return ()=>ipcRenderer.removeListener('document-progress',listener);},
  inputBegin: (mode,flow) => ipcRenderer.invoke('input-begin',{mode,flow}),
  inputChunk: opts => ipcRenderer.invoke('input-chunk',opts),
  inputFinish: id => ipcRenderer.invoke('input-finish',{id}),
  inputTranscribe: token => ipcRenderer.invoke('input-transcribe',{token}),
  inputClear: opts => ipcRenderer.invoke('input-clear',opts),
  inputRelease: token => ipcRenderer.invoke('input-release',{token}),
  inputCancelTranscript: () => ipcRenderer.invoke('input-cancelTranscript'),
  voicePlan: opts => ipcRenderer.invoke('voice-plan',opts),
  sessionsList: opts => ipcRenderer.invoke('session-list', opts),
  sessionGet: opts => ipcRenderer.invoke('session-get', opts),
  sessionCast:opts=>ipcRenderer.invoke('session-cast',opts),
  sessionCreate: opts => ipcRenderer.invoke('session-create', opts),
  sessionTextSource: opts => ipcRenderer.invoke('session-text-source', opts),
  pickTextSource: () => ipcRenderer.invoke('text-source-pick'),
  sessionDelete: opts => ipcRenderer.invoke('session-delete', opts),
  sessionAppend: opts => ipcRenderer.invoke('session-append', opts),
  sessionAudioTranscript: opts => ipcRenderer.invoke('session-audioTranscript', opts),
  sessionDelivery: opts => ipcRenderer.invoke('session-delivery', opts),
  sessionRename: opts => ipcRenderer.invoke('session-rename', opts),
  sessionRhythm: opts => ipcRenderer.invoke('session-rhythm', opts),
  sessionListener: opts => ipcRenderer.invoke('session-listener', opts),
  sessionMemory: opts => ipcRenderer.invoke('session-memory', opts),
  sessionOpen: opts => ipcRenderer.invoke('session-open', opts),
  sessionFolder: opts => ipcRenderer.invoke('session-folder', opts),
  sessionExport: opts => ipcRenderer.invoke('session-export', opts),
  sessionExportKeep: opts => ipcRenderer.invoke('session-export-keep', opts),
  backstageSettings: opts => ipcRenderer.invoke('session-backstage', opts),
  backstageNote: opts => ipcRenderer.invoke('session-note', opts),
  backstageReveal: opts => ipcRenderer.invoke('session-reveal', opts),
  backstageNotebook: opts => ipcRenderer.invoke('session-notebook', opts),
  // LLM (proxied to a local OpenAI-compatible server to dodge CORS); full messages[] (supports vision)
  llmChat: opts => ipcRenderer.invoke('llm-chat', opts),
  llmChatStream: (opts, onChunk) => {
    const listener = (_event, payload) => { if (payload && payload.id === opts.id) onChunk(payload.delta || ''); };
    ipcRenderer.on('llm-chat-stream-chunk', listener);
    return ipcRenderer.invoke('llm-chat-stream', opts).finally(() => ipcRenderer.removeListener('llm-chat-stream-chunk', listener));
  },
  cancelLlm: id => ipcRenderer.invoke('llm-cancel', id),
  llmModels: opts => ipcRenderer.invoke('llm-models', opts),
  llmLoad: opts => ipcRenderer.invoke('llm-load', opts),   // load a model into LM Studio (JIT)
  localLlamaPick: kind => ipcRenderer.invoke('local-llama-pick', kind),
  localLlamaLoad: opts => ipcRenderer.invoke('local-llama-load', opts),
  localLlamaStop: () => ipcRenderer.invoke('local-llama-stop'),
  localLlamaStatus: () => ipcRenderer.invoke('local-llama-status'),
  localLlamaInspect: opts => ipcRenderer.invoke('local-llama-inspect',opts),
  localModelFolder: () => ipcRenderer.invoke('local-model-folder'),
  // Voice packets are scoped to one request; listeners detach on every exit path.
  ttsStream: (opts, onPacket) => {
    let callbackError;
    let terminalResolve;
    const terminal = new Promise(resolve => { terminalResolve = resolve; });
    const listener = (_event, packet) => {
      if (packet?.id !== opts.id || callbackError) return;
      try { onPacket(packet); }
      catch (error) { callbackError = error; ipcRenderer.invoke('tts-cancel', opts.id).catch(() => {}); }
      if (packet.type === 'end' || packet.type === 'error' || callbackError) terminalResolve();
    };
    ipcRenderer.on('tts-stream-packet', listener);
    // invoke replies and send packets are separate IPC paths. Keep the listener
    // until the terminal packet arrives, even when the reply overtakes it.
    return ipcRenderer.invoke('tts-stream', opts).then(async result => {
      if (result.ok && !callbackError) {
        let timer;
        try { await Promise.race([terminal, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Voice terminal packet was not delivered.')), 5000); })]); }
        catch (error) { callbackError = error; await ipcRenderer.invoke('tts-cancel', opts.id).catch(() => {}); }
        finally { clearTimeout(timer); }
      }
      return callbackError ? { ok: false, error: callbackError.message } : result;
    })
      .finally(() => ipcRenderer.removeListener('tts-stream-packet', listener));
  },
  ttsCancel: id => ipcRenderer.invoke('tts-cancel', id),
  ttsConsumed: (id, samples) => ipcRenderer.send('tts-consumed', id, samples),
  voiceDecisionLog: entry => { try { ipcRenderer.send('voice-decision-log', entry); } catch {} },
  speechSave: id => ipcRenderer.invoke('speech-save',id),
  speechClear: () => ipcRenderer.invoke('speech-clear'),
  chatAudioList: () => ipcRenderer.invoke('chat-audio-list'),
  chatAudioSave: id => ipcRenderer.invoke('chat-audio-save',id),
  chatAudioClear: () => ipcRenderer.invoke('chat-audio-clear'),
  openDataFolder: kind => ipcRenderer.invoke('data-folder',kind),
  voiceProfiles: voiceRoute => ipcRenderer.invoke('voice-profiles',voiceRoute),
  voiceProviderInfo: voiceRoute => ipcRenderer.invoke('voice-provider-info',voiceRoute),
  voiceHealth: (baseURL,voiceRoute) => ipcRenderer.invoke('voice-health', baseURL,voiceRoute),
  voiceStart: () => ipcRenderer.invoke('voice-start'),
  voiceWarmup: () => ipcRenderer.invoke('voice-warmup'),
  voiceStop: () => ipcRenderer.invoke('voice-stop'),
  voiceStatus: () => ipcRenderer.invoke('voice-status'),
  vramTelemetry: baseURL => ipcRenderer.invoke('vram-telemetry', baseURL),
  openURL: url => ipcRenderer.invoke('open-url', url),
  restartApp: () => ipcRenderer.invoke('app-restart'),   // relaunch the whole app
  windowView:()=>ipcRenderer.invoke('window-view'),
  selectWindowView:mode=>ipcRenderer.invoke('window-view-select',mode),
  windowAction:action=>ipcRenderer.invoke('window-action',action),
  onWindowView:callback=>{const listener=(_e,state)=>callback(state);ipcRenderer.on('window-view-state',listener);return()=>ipcRenderer.removeListener('window-view-state',listener);},
  minimizeWindow: () => ipcRenderer.invoke('window-minimize'),
  setAlwaysOnTop: enabled => ipcRenderer.invoke('window-set-always-on-top', enabled),
  windowAlwaysOnTop: () => ipcRenderer.invoke('window-always-on-top'),
  // move the frameless window: 'panel' (side screen) | 'main' (primary strip) | undefined (toggle)
  moveWindow: target => ipcRenderer.invoke('move-window', target),
  windowLocation: () => ipcRenderer.invoke('window-location'),
});
