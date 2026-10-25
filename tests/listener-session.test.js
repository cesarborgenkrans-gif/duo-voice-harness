'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { SessionStore } = require('../src/conversation/session-store');

test('a discussion remembers who they speak to, and a solo chat cannot choose each other', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'duo-listener-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new SessionStore(root);
  const discussion = await store.create({ kind: 'discussion' });
  assert.equal(discussion.listener, undefined);
  const together = await store.listener({ kind: discussion.kind, id: discussion.id, revision: discussion.revision, listener: 'partner' });
  assert.equal(together.listener, 'partner');
  const saved = await store.get(discussion.kind, discussion.id);
  assert.equal(saved.listener, 'partner');
  const chat = await store.create({ kind: 'chat' });
  await assert.rejects(store.listener({ kind: chat.kind, id: chat.id, revision: chat.revision, listener: 'partner' }), /both companions/);
  await assert.rejects(store.listener({ kind: discussion.kind, id: discussion.id, revision: together.revision, listener: 'crowd' }), /who they speak to/);
});
