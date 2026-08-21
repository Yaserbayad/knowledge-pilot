import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { JsonStore } from '../src/store.js';
import { Scheduler } from '../src/scheduler.js';

const logger = { debug() {}, info() {}, warn() {}, error() {} };

async function makeFixture(delivery) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'knowledge-pilot-scheduler-safe-'));
  const store = await new JsonStore({
    stateFile: path.join(root, 'state.json'),
    backupDir: path.join(root, 'backups'),
    retention: 2,
    logger
  }).init();
  const learning = { accessUrl() { return 'https://example.test/app'; } };
  const scheduler = new Scheduler({
    store,
    learning,
    delivery,
    config: { enabled: true, pollSeconds: 30, maxAttempts: 4, runTimeoutMinutes: 1, unfinishedItemLimit: 3 },
    logger
  });
  return { store, scheduler };
}

test('stale job with a persisted external-send intent is not retried', async () => {
  let sends = 0;
  const { store, scheduler } = await makeFixture({
    async sendDirectResponse() { sends += 1; }
  });
  const old = new Date(Date.now() - 5 * 60_000).toISOString();
  await store.transaction((state) => {
    state.jobs.job_ambiguous = {
      id: 'job_ambiguous', type: 'send_direct_response', userId: 'user_missing', status: 'running',
      runAt: old, attempts: 1, startedAt: old, externalEffectStartedAt: old, lastError: null,
      payload: { text: 'hello', origin: 'telegram', interactionId: 'interaction_1' }, createdAt: old, updatedAt: old
    };
  });

  await scheduler.tick();
  const job = store.read((state) => state.jobs.job_ambiguous);
  assert.equal(job.status, 'failed');
  assert.match(job.lastError, /outcome is unknown/i);
  assert.equal(sends, 0);
});

test('external delivery failure after intent persistence fails closed instead of retrying', async () => {
  const { store, scheduler } = await makeFixture({
    async sendDirectResponse() { throw new Error('simulated failure after external effect may have occurred'); }
  });
  const now = new Date().toISOString();
  await store.transaction((state) => {
    state.jobs.job_send = {
      id: 'job_send', type: 'send_direct_response', userId: 'user_missing', status: 'pending',
      runAt: now, attempts: 0, startedAt: null, lastError: null,
      payload: { text: 'hello', origin: 'telegram', interactionId: 'interaction_1' }, createdAt: now, updatedAt: now
    };
  });

  await scheduler.tick();
  const job = store.read((state) => state.jobs.job_send);
  assert.equal(job.status, 'failed');
  assert.equal(job.attempts, 1);
  assert.ok(job.externalEffectStartedAt);
  assert.match(job.lastError, /outcome is unknown/i);
});
