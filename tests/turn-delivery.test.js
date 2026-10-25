'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const Delivery = require('../src/conversation/turn-delivery');
const { SessionStore } = require('../src/conversation/session-store');

const failed = { state: 'failed', receivedSamples: 0, consumedSamples: 0, sampleRate: 0 };
const finished = { state: 'finished', receivedSamples: 24000, consumedSamples: 24000, sampleRate: 24000 };

test('only a failed receipt can be spoken again', () => {
  assert.deepEqual(Delivery.restart(failed), { state: 'not-started', receivedSamples: 0, consumedSamples: 0, sampleRate: 0 });
  assert.equal(Delivery.label(failed), 'Speech failed. This reply stays on screen.');
  assert.throws(() => Delivery.transition(failed, { state: 'playing', receivedSamples: 10, consumedSamples: 10, sampleRate: 24000 }), /already settled/);
  assert.throws(() => Delivery.restart(finished), /failed voice delivery/);
  assert.throws(() => Delivery.transition(finished, failed), /already settled/);
  assert.throws(() => Delivery.restart({ state: 'stopped', receivedSamples: 10, consumedSamples: 4, sampleRate: 24000 }), /failed voice delivery/);
});

test('a saved failed reply restarts in place and a finished reply stays settled', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'duo-delivery-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new SessionStore(root);
  const session = await store.create({ kind: 'chat' });
  const failedId = randomUUID();
  const doneId = randomUUID();
  let current = await store.append({ kind: session.kind, id: session.id, revision: session.revision, entry: { id: failedId, speaker: 'momotamu', text: 'Keep this reply.', status: 'complete', delivery: failed } });
  current = await store.append({ kind: session.kind, id: session.id, revision: current.revision, entry: { id: doneId, speaker: 'momotamu', text: 'Already spoken.', status: 'complete', delivery: finished } });
  const restarted = await store.delivery({ kind: session.kind, id: session.id, entryId: failedId, restart: true });
  assert.equal(restarted.entries.find(entry => entry.id === failedId).delivery.state, 'not-started');
  assert.deepEqual(restarted.entries.find(entry => entry.id === doneId).delivery, finished);
  await assert.rejects(store.delivery({ kind: session.kind, id: session.id, entryId: doneId, restart: true }), /failed voice delivery/);
  await assert.rejects(store.delivery({ kind: session.kind, id: session.id, entryId: failedId, restart: true }), /failed voice delivery/);
  const playing = await store.delivery({ kind: session.kind, id: session.id, entryId: failedId, delivery: { state: 'playing', receivedSamples: 100, consumedSamples: 40, sampleRate: 24000 } });
  assert.equal(playing.entries.find(entry => entry.id === failedId).delivery.state, 'playing');
  assert.equal(playing.entries.find(entry => entry.id === failedId).text, 'Keep this reply.');
});
