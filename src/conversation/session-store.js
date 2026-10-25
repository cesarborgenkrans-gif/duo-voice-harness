'use strict';
// Rule: commit session records before presentation. Export public Markdown on
// demand; materialize separate character notebooks without blocking conversation.
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { renderMarkdown, cleanResponse, bytes } = require('./conversation-model');
const B = require('./backstage-model');
const L = require('../listening/listening-model');
const I = require('../images/image-model');
const F = require('../images/image-focus');
const D = require('../documents/document-store');
const Delivery = require('./turn-delivery');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
class SessionStore {
  constructor(root) { this.root = path.resolve(root); this.queues = new Map(); }
  paths(kind, id) {
    if (!['chat', 'discussion'].includes(kind) || !UUID.test(id)) throw new Error('Invalid session identity.');
    const folder = path.join(this.root, kind === 'chat' ? 'chats' : 'discussions', id);
    return { folder, record: path.join(folder, 'session.json'), markdown: path.join(folder, kind === 'chat' ? 'chat.md' : 'ai-discussion.md') };
  }
  async atomic(file, text) {
    const temp = file + '.' + randomUUID() + '.tmp';
    try {
      const handle = await fs.open(temp, 'wx');
      try { await handle.writeFile(text, 'utf8'); await handle.sync(); } finally { await handle.close(); }
      await fs.rename(temp, file);
    } finally { await fs.rm(temp, { force: true }).catch(() => {}); }
  }
  async writeRecord(s) {
    this.validate(s, s.kind, s.id);
    const text = JSON.stringify(s, null, 2);
    if (bytes(text) > 20 * 1024 * 1024) throw new Error('Session is full. Start a new session.');
    await this.atomic(this.paths(s.kind, s.id).record, text);
  }
  enqueue(kind, id, task) {
    this.paths(kind, id);
    const key = kind + id, prior = this.queues.get(key) || Promise.resolve();
    const next = prior.catch(() => {}).then(task);
    this.queues.set(key, next);
    return next.finally(() => { if (this.queues.get(key) === next) this.queues.delete(key); });
  }
  validate(s, kind, id) {
    if(s.sourceDocument){require('../documents/text-source').validateSource(s.sourceDocument);if(!UUID.test(s.sourceDocument.id)||!Number.isFinite(Date.parse(s.sourceDocument.updatedAt)))throw Error('Invalid saved text source.');}
    D.validateDocuments(s);
    I.validate(s);
    if (s.schemaVersion !== 1 || s.kind !== kind || s.id !== id || !Number.isSafeInteger(s.revision) || s.revision < 0 ||
        !Array.isArray(s.entries) || s.entries.length > 10000 || typeof s.title !== 'string' || s.title.length > 120 ||
        !Array.isArray(s.participants) || s.participants[0] !== 'momotamu' ||
        (s.participants.length < 1 || s.participants.length > 2 || s.participants.length === 2 && s.participants[1] !== 'vivi') ||
        !Number.isFinite(Date.parse(s.createdAt)) || !Number.isFinite(Date.parse(s.updatedAt))) throw new Error('Invalid saved session.');
    if(s.worktreeId!=null&&!/^[a-z0-9][a-z0-9-]{0,63}$/.test(s.worktreeId))throw Error('Invalid Worktree identity.');
    if(s.replyRhythm!==undefined&&!['usual','natural'].includes(s.replyRhythm))throw Error('Invalid reply rhythm.');
    if(s.listener!==undefined&&!['user','partner'].includes(s.listener))throw Error('Invalid listener.');
    if(s.participantHistory!==undefined&&(!Array.isArray(s.participantHistory)||s.participantHistory.length>4||s.participantHistory.some(a=>!['momotamu','vivi'].includes(a))))throw Error('Invalid participant history.');
    const historical=[...new Set([...s.participants,...(s.participantHistory||[])])];
    const ids = new Set();
    for (const e of s.entries) {
      if (!UUID.test(e.id) || ids.has(e.id) || !['user', ...historical].includes(e.speaker) || !['complete', 'interrupted', 'capped'].includes(e.status) ||
          typeof e.text !== 'string' || !e.text.trim() || e.text.length > 20000 || !Number.isFinite(Date.parse(e.createdAt))) throw new Error('Invalid saved turn.');
      if(e.source!==undefined&&!['human','agent'].includes(e.source)||e.source==='agent'&&(e.speaker!=='user'||typeof e.sourceLabel!=='string'||!e.sourceLabel.trim()||e.sourceLabel.length>48))throw Error('Invalid input source.');
      ids.add(e.id);
      if(e.audio){if(e.speaker!=='user'||e.source==='agent'||!Number.isFinite(e.audio.duration)||e.audio.duration<=0||e.audio.duration>30.1||!['pending','ready','unavailable'].includes(e.audio.status)||typeof e.audio.transcript!=='string'||e.audio.transcript.length>8000||e.audio.status!=='ready'&&e.audio.transcript)throw Error('Invalid recorded contribution.');}
      if(e.audio?.reference&&(!UUID.test(e.audio.reference)||!Number.isSafeInteger(e.audio.expires)||e.audio.expires<=0))throw Error('Invalid retained audio reference.');
      if(e.delivery){if(e.speaker==='user')throw Error('Voice delivery belongs to a character reply.');Delivery.validate(e.delivery);}
      if (e.listening) { if (kind !== 'chat' || e.speaker !== 'user' || e.kind !== 'listening') throw new Error('Listening records belong to user chat turns.'); L.saved(e.listening); }
    }
    if (s.memory && (kind !== 'discussion' || typeof s.memory.enabled !== 'boolean' || typeof s.memory.text !== 'string' || bytes(s.memory.text) > 1800 || (s.memory.throughId && !s.entries.some(e => e.id === s.memory.throughId && e.status === 'complete')))) throw new Error('Invalid discussion memory.');
    if (s.backstage) {
      const b = s.backstage, noteIds = new Set();
      if (kind !== 'discussion' || typeof b.enabled !== 'boolean' || typeof b.revealAtEnd !== 'boolean' || !Number.isInteger(b.interval) || b.interval < 1 || b.interval > 12 || !Object.hasOwn(B.tones, b.tone) || !Number.isInteger(b.scheduleVersion) || b.scheduleVersion < 0 || !b.baselineCounts || !Array.isArray(b.notes) || b.notes.length > 2000) throw new Error('Invalid Backstage settings.');
      for (const owner of s.participants) if (!Number.isInteger(b.baselineCounts[owner] ?? 0) || (b.baselineCounts[owner] ?? 0) < 0) throw new Error('Invalid notebook cadence.');
      const schedules = new Set();
      for (const n of b.notes) {
        const schedule = `${n.owner}:${n.scheduleVersion}:${n.replyCount}`;
        if (!UUID.test(n.id) || noteIds.has(n.id) || schedules.has(schedule) || !historical.includes(n.owner) || typeof n.text !== 'string' || !n.text.trim() || bytes(n.text) > 1200 || !Number.isInteger(n.replyCount) || n.replyCount < 1 || !Number.isInteger(n.scheduleVersion) || n.scheduleVersion < 0 || !Number.isFinite(Date.parse(n.createdAt)) || !Array.isArray(n.sourceTurnIds) || n.sourceTurnIds.length > 6 || n.sourceTurnIds.some(id => !ids.has(id))) throw new Error('Invalid notebook entry.');
        noteIds.add(n.id); schedules.add(schedule);
      }
      for (const e of s.entries) {
        if (e.kind === 'reveal') {
          if (!Array.isArray(e.disclosures) || !e.disclosures.length || e.disclosures.length > 2 || !Array.isArray(e.reactedBy) || e.reactedBy.some(a => !historical.includes(a))) throw new Error('Invalid reveal event.');
          for (const d of e.disclosures) {
            const n = b.notes.find(n => n.id === d.noteId);
            if (!n || d.owner !== n.owner || !Number.isInteger(d.start) || !Number.isInteger(d.end) || d.start < 0 || d.end > n.text.length || d.start >= d.end || d.text !== n.text.slice(d.start, d.end)) throw new Error('Invalid disclosed excerpt.');
          }
        }
        if (e.kind === 'reaction' && (!Array.isArray(e.reactionTo) || !e.reactionTo.length || e.reactionTo.some(id => !s.entries.some(r => r.id === id && r.kind === 'reveal')))) throw new Error('Invalid reveal reaction.');
      }
    } else if (s.entries.some(e => e.kind === 'reveal' || e.kind === 'reaction')) throw new Error('Missing Backstage record.');
    if (s.entries.some(e => e.kind && !['reply', 'reveal', 'reaction','listening'].includes(e.kind))) throw new Error('Invalid turn kind.');
    return s;
  }
  async read(kind, id) {
    const p = this.paths(kind, id);
    const stat = await fs.stat(p.record);
    if (stat.size > 20 * 1024 * 1024) throw new Error('Saved session exceeds the supported size.');
    return this.validate(JSON.parse(await fs.readFile(p.record, 'utf8')), kind, id);
  }
  public(s) { return { ...s, markdownPath: this.paths(s.kind, s.id).markdown, notebookPaths: Object.fromEntries(s.participants.map(owner => [owner, path.join(this.paths(s.kind, s.id).folder, B.filenames[owner])])) }; }
  async mirror(s) {
    const p = this.paths(s.kind, s.id), desired = renderMarkdown(s);
    let warning = '';
    try {
      const existing = await fs.readFile(p.markdown, 'utf8');
      const existingDigest = createHash('sha256').update(existing).digest('hex');
      if (existing !== desired && existingDigest !== s.publicExportDigest) {
        const digest = createHash('sha256').update(existing).digest('hex').slice(0, 8);
        const backup = p.markdown.replace(/\.md$/, `-external-${Date.now()}-${digest}.md`);
        await this.atomic(backup, existing);
        warning = `External Markdown edits preserved in ${path.basename(backup)}. Session records provide the conversation history.`;
      }
    } catch (e) { if (e.code !== 'ENOENT') throw e; }
    await this.atomic(p.markdown, desired);
    return warning;
  }
  async get(kind, id) {
    return this.enqueue(kind, id, async () => {
      const s = await this.read(kind, id), warning = await this.syncNotepads(s);
      return { ...this.public(s), warning };
    });
  }
  async list(kind) {
    this.paths(kind, randomUUID());
    const directory = path.join(this.root, kind === 'chat' ? 'chats' : 'discussions');
    let dirs;
    try { dirs = await fs.readdir(directory, { withFileTypes: true }); } catch (e) { if (e.code === 'ENOENT') return []; throw e; }
    const list = [];
    for (const dir of dirs) {
      if (!dir.isDirectory() || !UUID.test(dir.name)) continue;
      // Preserve damaged records and show a recoverable error instead of hiding them.
      try { const s = await this.read(kind, dir.name); list.push({ id: s.id, title: s.title, updatedAt: s.updatedAt, count: s.entries.length,worktreeId:s.worktreeId||null }); }
      catch (e) { list.push({ id: dir.name, title: `Unreadable session (${dir.name.slice(0, 8)})`, updatedAt: '', error: e.message }); }
    }
    return list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  async create({ kind, companion = 'vivi' }) {
    const id = randomUUID(), p = this.paths(kind, id), now = new Date().toISOString();
    if (kind === 'discussion' && companion !== 'vivi') throw new Error('Invalid companion.');
    const s = { schemaVersion: 1, id, kind, title: kind === 'chat' ? 'New chat' : 'New discussion', participants: kind === 'chat' ? ['momotamu'] : ['momotamu', companion], createdAt: now, updatedAt: now, revision: 0, entries: [] };
    await fs.mkdir(p.folder, { recursive: true });
    await this.writeRecord(s);
    return this.public(s);
  }
  // Permanent remove of the session folder (record, markdown, notebooks, media). No trash.
  async delete({ kind, id }) {
    const p = this.paths(kind, id);
    return this.enqueue(kind, id, async () => {
      await fs.rm(p.folder, { recursive: true, force: true });
      return { kind, id };
    });
  }
  async append({ kind, id, revision, entry }) {
    return this.enqueue(kind, id, async () => {
      const s = await this.read(kind, id);
      if (!entry || !UUID.test(entry.id)) throw new Error('Invalid turn identity.');
      const text = entry.speaker === 'user' ? String(entry.text || '').trim() : cleanResponse(entry.text);
      const duplicate = s.entries.find(e => e.id === entry.id);
      if (duplicate) {
        if (JSON.stringify(duplicate.imageIds || []) !== JSON.stringify(entry.imageIds || [])) throw new Error('Image turn identity conflict.');
        if(JSON.stringify(duplicate.documentIds||[])!==JSON.stringify(entry.documentIds||[]))throw new Error('Document turn identity conflict.');
        if (JSON.stringify(duplicate.listening || null) !== JSON.stringify(entry.kind === 'listening' ? L.saved(entry.listening) : null)) throw new Error('Listening record identity conflict.');
        if((duplicate.source||'human')!==(entry.source||'human')||(duplicate.sourceLabel||'')!==(entry.sourceLabel||''))throw Error('Input source identity conflict.');
        if(!!duplicate.audio!==!!entry.audio||duplicate.audio&&duplicate.audio.duration!==entry.audio.duration)throw Error('Audio turn identity conflict.');
        if((duplicate.audio?.reference||null)!==(entry.audio?.reference||null))throw Error('Audio reference identity conflict.');
        if (duplicate.text !== text || duplicate.speaker !== entry.speaker || duplicate.status !== (entry.status || 'complete') || (duplicate.kind || 'reply') !== (entry.kind || 'reply') || JSON.stringify(duplicate.reactionTo || []) !== JSON.stringify([...new Set(entry.reactionTo || [])])) throw new Error('Turn identity conflict.');
        return this.public(s);
      }
      if (revision !== s.revision) throw new Error('Session changed. Reopen it before continuing.');
      if(entry.audio&&(entry.speaker!=='user'||entry.source==='agent'))throw Error('Original audio belongs to the human user.');
      if (!text || text.length > 20000 || !['user', ...s.participants].includes(entry.speaker) || !['complete', 'interrupted', 'capped'].includes(entry.status || 'complete')) throw new Error('Invalid conversation turn (maximum 20,000 characters).');
      const now = new Date().toISOString();
      const turnKind = entry.kind || 'reply';
      if (!['reply', 'reaction','listening'].includes(turnKind)) throw new Error('Reveal events require the reveal action.');
      const listeningRecord = turnKind === 'listening' ? L.saved(entry.listening) : null;
      if (listeningRecord && (kind !== 'chat' || entry.speaker !== 'user')) throw new Error('Listening records belong to user chat turns.');
      const reactionTo = [...new Set(entry.reactionTo || [])];
      if (turnKind === 'reaction' && (kind !== 'discussion' || entry.speaker === 'user' || !reactionTo.length || reactionTo.some(eventId => !B.pending(s, entry.speaker).some(e => e.id === eventId)))) throw new Error('Invalid reaction targets.');
      s.entries.push({ id: entry.id, speaker: entry.speaker, ...(entry.speaker==='user'?{source:entry.source==='agent'?'agent':'human',...(entry.source==='agent'?{sourceLabel:String(entry.sourceLabel||'External agent').replace(/[\r\n\x00-\x1f]/g,' ').slice(0,48)}:{})}:{}), text, status: entry.status || 'complete', createdAt: now, kind: turnKind, ...(entry.imageIds?.length ? {imageIds:entry.imageIds} : {}), ...(entry.documentIds?.length ? {documentIds:entry.documentIds} : {}), ...(listeningRecord ? {listening:listeningRecord} : {}), ...(turnKind === 'reaction' ? { reactionTo } : {}) });
      if(entry.audio)s.entries.at(-1).audio={duration:entry.audio.duration,status:'pending',transcript:'',...(entry.audio.reference?{reference:entry.audio.reference,expires:entry.audio.expires}:{})};
      if(entry.delivery){if(entry.speaker==='user')throw Error('Voice delivery belongs to a character reply.');s.entries.at(-1).delivery=Delivery.validate(entry.delivery);}
      if (turnKind === 'reaction' && (entry.status || 'complete') === 'complete') for (const eventId of reactionTo) s.entries.find(e => e.id === eventId).reactedBy.push(entry.speaker);
      if (s.entries.length > 10000) throw new Error('Session is full. Start a new session.');
      if (s.entries.length === 1 && entry.speaker === 'user' && /^New (chat|discussion)$/.test(s.title)) s.title = text.replace(/\s+/g, ' ').slice(0, 80);
      s.updatedAt = now; s.revision++;
      await this.writeRecord(s);
      return this.public(s);
    });
  }
  async audioTranscript({kind,id,entryId,text}) {
    return this.enqueue(kind,id,async()=>{
      const s=await this.read(kind,id),entry=s.entries.find(e=>e.id===entryId);
      if(!entry?.audio||typeof text!=='string'||text.length>8000)throw Error('Display transcript cannot update this turn.');
      if(entry.audio.status==='ready'){if(entry.audio.transcript===text.trim())return this.public(s);throw Error('Display transcript cannot update this turn.');}
      if(entry.audio.status==='unavailable'&&!text.trim())return this.public(s);
      // Patch only this receipt; newer turns, cast and context remain intact.
      entry.audio={...entry.audio,status:text.trim()?'ready':'unavailable',transcript:text.trim()};
      s.revision++;s.updatedAt=new Date().toISOString();await this.writeRecord(s);return this.public(s);
    });
  }
  async delivery({kind,id,entryId,delivery,restart=false}){
    return this.enqueue(kind,id,async()=>{
      const s=await this.read(kind,id),entry=s.entries.find(e=>e.id===entryId);
      if(!entry?.delivery||entry.speaker==='user')throw Error('Voice delivery cannot update this turn.');
      const next=restart?Delivery.restart(entry.delivery):Delivery.transition(entry.delivery,delivery);
      if(JSON.stringify(next)===JSON.stringify(entry.delivery))return this.public(s);
      entry.delivery=next;s.revision++;s.updatedAt=new Date().toISOString();
      await this.writeRecord(s);return this.public(s);
    });
  }
  async image({ kind, id, asset, reference, use, focus }) {
    return this.enqueue(kind,id,async()=>{
      const s=await this.read(kind,id);s.images ||= [];s.imageUses ||= [];
      if(asset){asset=I.asset(asset);if(!s.images.some(a=>a.id===asset.id))s.images.push(asset);}
      if(reference!==undefined)s.imageReference=reference||null;
      if(use){const previous=s.imageUses.find(u=>u.requestId===use.requestId);if(previous&&JSON.stringify(previous)!==JSON.stringify(use))throw new Error('Image request identity conflict.');if(!previous)s.imageUses.push(use);}
      if(focus){const previous=s.imageUses.find(u=>u.requestId===focus.requestId);if(!previous||previous.status!=='complete')throw new Error('Highlights require a completed image reply.');if(previous.focus)throw new Error('Highlights already saved for this reply.');previous.focus=F.validate(focus.value);}
      s.revision++;s.updatedAt=new Date().toISOString();await this.writeRecord(s);return this.public(s);
    });
  }
  async textSource({kind,id,revision,source}) {
    return this.enqueue(kind,id,async()=>{const s=await this.read(kind,id);if(s.revision!==revision)throw Error('Session changed. Reopen the document setup before saving.');s.sourceDocument=source===null?null:{...require('../documents/text-source').validateSource(source),id:randomUUID(),updatedAt:new Date().toISOString()};s.revision++;s.updatedAt=new Date().toISOString();await this.writeRecord(s);return this.public(s);});
  }
  async document({kind,id,asset,reference,receipt}) {
    return this.enqueue(kind,id,async()=>{
      const s=await this.read(kind,id);s.documents ||= [];s.documentReads ||= [];
      if(asset&&!s.documents.some(d=>d.id===asset.id))s.documents.push(asset);
      if(reference!==undefined)s.documentReference=reference||null;
      if(receipt){const previous=s.documentReads.find(r=>r.requestId===receipt.requestId);if(previous&&JSON.stringify(previous)!==JSON.stringify(receipt))throw new Error('Document receipt identity conflict.');if(!previous)s.documentReads.push(receipt);}
      s.updatedAt=new Date().toISOString();s.revision++;await this.writeRecord(s);return this.public(s);
    });
  }
  async cast({kind,id,revision,companion}){return this.enqueue(kind,id,async()=>{if(!['none','vivi'].includes(companion))throw Error('Invalid companion.');const s=await this.read(kind,id);if(s.revision!==revision)throw Error('Session changed. Reopen it before changing participants.');s.participantHistory=[...new Set([...(s.participantHistory||[]),...s.participants])];s.participants=companion==='none'?['momotamu']:['momotamu',companion];s.updatedAt=new Date().toISOString();s.revision++;await this.writeRecord(s);return this.public(s);});}
  async assignWorktree({kind,id,revision,worktreeId}){return this.enqueue(kind,id,async()=>{const s=await this.read(kind,id);if(s.revision!==revision)throw Error('Session changed. Reopen it before moving.');s.worktreeId=worktreeId||null;s.revision++;s.updatedAt=new Date().toISOString();await this.writeRecord(s);return this.public(s);});}
  async rename({ kind, id, revision, title }) {
    return this.enqueue(kind, id, async () => {
      if (typeof title !== 'string' || !title.trim() || title.length > 120 || /[\r\n]/.test(title)) throw new Error('Use a title of 1–120 characters.');
      const s = await this.read(kind, id);
      if (revision !== s.revision) throw new Error('Session changed. Reopen it before renaming.');
      s.title = title.trim(); s.revision++; s.updatedAt = new Date().toISOString();
      await this.writeRecord(s);
      return this.public(s);
    });
  }
  async rhythm({ kind, id, revision, replyRhythm }) {
    return this.enqueue(kind, id, async () => {
      if (!['usual', 'natural'].includes(replyRhythm)) throw new Error('Choose a supported reply rhythm.');
      const s = await this.read(kind, id);
      if (revision !== s.revision) throw new Error('Session changed. Reopen it before changing reply rhythm.');
      s.replyRhythm = replyRhythm; s.revision++; s.updatedAt = new Date().toISOString();
      await this.writeRecord(s);
      return this.public(s);
    });
  }
  async listener({ kind, id, revision, listener }) {
    return this.enqueue(kind, id, async () => {
      if (!['user', 'partner'].includes(listener)) throw new Error('Choose who they speak to.');
      const s = await this.read(kind, id);
      if (revision !== s.revision) throw new Error('Session changed. Reopen it before changing who they speak to.');
      if (listener === 'partner' && s.participants.length < 2) throw new Error('Choose both companions before they speak to each other.');
      s.listener = listener; s.revision++; s.updatedAt = new Date().toISOString();
      await this.writeRecord(s);
      return this.public(s);
    });
  }
  async memory({ kind, id, revision, enabled, text, throughId }) {
    return this.enqueue(kind, id, async () => {
      if (kind !== 'discussion') throw new Error('Discussion Master is available in Discussions.');
      const s = await this.read(kind, id);
      if (revision !== s.revision) throw new Error('Session changed. Reopen it before updating memory.');
      s.memory ||= { enabled: false, text: '', throughId: null };
      if (typeof enabled === 'boolean') s.memory.enabled = enabled;
      if (text !== undefined) {
        const clean = cleanResponse(text), index = s.entries.findIndex(e => e.id === throughId && e.status === 'complete');
        const oldIndex = s.entries.findIndex(e => e.id === s.memory.throughId);
        if (!s.memory.enabled || !clean || bytes(clean) > 1800 || index < 0 || index < oldIndex) throw new Error('Invalid discussion memory update.');
        s.memory.text = clean; s.memory.throughId = throughId; s.memory.updatedAt = new Date().toISOString();
      }
      s.revision++; s.updatedAt = new Date().toISOString();
      await this.writeRecord(s);
      return this.public(s);
    });
  }
  async export({ kind, id }) {
    return this.enqueue(kind, id, async () => {
      const s = await this.read(kind, id), warning = await this.mirror(s);
      s.publicExportDigest = createHash('sha256').update(renderMarkdown(s)).digest('hex'); s.revision++;
      await this.writeRecord(s);
      return { ...this.public(s), warning };
    });
  }
  async syncNotepads(s, previous = s) {
    const warnings = [];
    for (const owner of s.participants) {
      if (!s.backstage?.notes.some(n => n.owner === owner)) continue;
      const file = path.join(this.paths(s.kind, s.id).folder, B.filenames[owner]), desired = B.notebookMarkdown(s, owner);
      try {
        try {
          const existing = await fs.readFile(file, 'utf8');
          if (existing === desired) continue;
          if (existing !== desired && existing !== B.notebookMarkdown(previous, owner)) {
            const backup = file.replace(/\.md$/, `-external-${Date.now()}-${createHash('sha256').update(existing).digest('hex').slice(0, 8)}.md`);
            await this.atomic(backup, existing); warnings.push('External notebook edits preserved in ' + path.basename(backup));
          }
        } catch (e) { if (e.code !== 'ENOENT') throw e; }
        await this.atomic(file, desired);
      } catch (e) { warnings.push(`${B.filenames[owner]} could not be updated; the saved notebook is still available in Backstage: ${e.message}`); }
    }
    return warnings.join('; ');
  }
  async backstage({ kind, id, revision, settings }) {
    return this.enqueue(kind, id, async () => {
      if (kind !== 'discussion') throw new Error('Backstage is available in Discussions.');
      const s = await this.read(kind, id);
      if (revision !== s.revision) throw new Error('Session changed. Reopen it before changing Backstage.');
      if (!settings || Object.keys(settings).some(key => !['enabled', 'interval', 'tone', 'revealAtEnd'].includes(key))) throw new Error('Invalid Backstage settings.');
      const old = s.backstage || B.defaults(), b = { ...old, ...settings };
      if (b.enabled !== old.enabled || b.interval !== old.interval) { b.scheduleVersion++; b.baselineCounts = Object.fromEntries(s.participants.map(owner => [owner, B.replyCount(s, owner)])); }
      s.backstage = b; s.revision++; s.updatedAt = new Date().toISOString();
      await this.writeRecord(s); return this.public(s);
    });
  }
  async note({ kind, id, revision, note }) {
    return this.enqueue(kind, id, async () => {
      if (kind !== 'discussion' || !note || !UUID.test(note.id)) throw new Error('Invalid notebook request.');
      const s = await this.read(kind, id), previous = structuredClone(s), text = cleanResponse(note.text);
      const duplicate = s.backstage?.notes.find(n => n.id === note.id);
      if (duplicate) {
        if (duplicate.owner !== note.owner || duplicate.text !== text) throw new Error('Notebook identity conflict.');
        return { ...this.public(s), warning: await this.syncNotepads(s) };
      }
      if (revision !== s.revision) throw new Error('Session changed. Reopen it before writing a note.');
      const due = B.due(s, note.owner);
      if (!due || note.replyCount !== due.replyCount || note.scheduleVersion !== due.scheduleVersion || !text || bytes(text) > 1200 || !Array.isArray(note.sourceTurnIds) || !note.sourceTurnIds.length || note.sourceTurnIds.some(turnId => !s.entries.some(e => e.id === turnId && e.status === 'complete' && e.kind !== 'reveal' && e.kind !== 'reaction'))) throw new Error('Invalid or obsolete notebook entry.');
      s.backstage.notes.push({ id: note.id, owner: note.owner, text, replyCount: due.replyCount, scheduleVersion: due.scheduleVersion, sourceTurnIds: [...new Set(note.sourceTurnIds)], createdAt: new Date().toISOString() });
      s.revision++; s.updatedAt = new Date().toISOString();
      await this.writeRecord(s);
      return { ...this.public(s), warning: await this.syncNotepads(s, previous) };
    });
  }
  async reveal({ kind, id, revision, eventId, selections }) {
    return this.enqueue(kind, id, async () => {
      if (kind !== 'discussion' || !UUID.test(eventId || '') || !Array.isArray(selections) || !selections.length || selections.length > 2) throw new Error('Invalid reveal request.');
      const s = await this.read(kind, id), previous = structuredClone(s);
      const duplicate = s.entries.find(e => e.id === eventId);
      if (duplicate) {
        if (duplicate.kind !== 'reveal' || JSON.stringify(duplicate.disclosures.map(d => ({ noteId: d.noteId, start: d.start, end: d.end }))) !== JSON.stringify(selections)) throw new Error('Reveal identity conflict.');
        return this.public(s);
      }
      if (revision !== s.revision) throw new Error('Session changed. Reopen it before revealing a note.');
      if (s.participants.some(actor => B.pending(s, actor).length)) throw new Error('Finish the current reveal scene before revealing more notes.');
      const disclosures = selections.map(selection => {
        const n = s.backstage?.notes.find(n => n.id === selection.noteId), { start, end } = selection;
        const split = position => position > 0 && position < (n?.text.length || 0) && /[\uD800-\uDBFF]/.test(n.text[position - 1]) && /[\uDC00-\uDFFF]/.test(n.text[position]);
        if (!n || !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start >= end || end > n.text.length || split(start) || split(end) || B.alreadyShared(s, n, start, end)) throw new Error('Choose a private note or an unrevealed excerpt.');
        return { noteId: n.id, owner: n.owner, start, end, text: n.text.slice(start, end) };
      });
      if (new Set(disclosures.map(d => d.noteId)).size !== disclosures.length) throw new Error('Choose each notebook entry once.');
      const now = new Date().toISOString();
      s.entries.push({ id: eventId, speaker: 'user', kind: 'reveal', status: 'complete', text: 'The user revealed these Backstage diary excerpts:\n\n' + disclosures.map(d => `${require('./conversation-model').names[d.owner]} wrote:\n“${d.text}”`).join('\n\n'), createdAt: now, disclosures, reactedBy: [] });
      s.revision++; s.updatedAt = now; await this.writeRecord(s);
      return { ...this.public(s), warning: await this.syncNotepads(s, previous) };
    });
  }
}
module.exports = { SessionStore };
