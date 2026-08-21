import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { JsonStore } from '../src/store.js';
import { STATE_SCHEMA_VERSION } from '../src/version.js';

const logger = { debug() {}, info() {}, warn() {}, error() {} };

async function makeStoreRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'knowledge-pilot-store-'));
  return {
    root,
    stateFile: path.join(root, 'state.json'),
    backupDir: path.join(root, 'backups')
  };
}

test('failed persistence does not publish the transaction draft in memory', async () => {
  const { stateFile, backupDir } = await makeStoreRoot();
  const store = await new JsonStore({ stateFile, backupDir, logger }).init();
  const before = store.snapshot();
  store.persist = async () => { throw new Error('simulated durable write failure'); };

  await assert.rejects(
    store.transaction((state) => { state.settings.mustNotCommit = true; }),
    /simulated durable write failure/
  );

  assert.deepEqual(store.snapshot(), before);
});

test('future state schemas fail closed instead of being rewritten as current', async () => {
  const { stateFile, backupDir } = await makeStoreRoot();
  await fs.mkdir(backupDir, { recursive: true });
  await fs.writeFile(stateFile, `${JSON.stringify({
    meta: {
      schemaVersion: STATE_SCHEMA_VERSION + 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastBackupAt: null
    },
    users: {}, plans: {}, lessons: {}, interactions: {}, jobs: {}, messages: {},
    businessTasks: {}, books: {}, bookPlans: {}, bookSessions: {},
    settings: { installationId: 'future-installation' }
  }, null, 2)}\n`, { mode: 0o600 });

  await assert.rejects(
    new JsonStore({ stateFile, backupDir, logger }).init(),
    /unsupported state schema/i
  );
});
