import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { JsonStore } from '../src/store.js';
import { AccountDeletionService } from '../src/services/account-deletion.js';

const logger = { debug() {}, info() {}, warn() {}, error() {} };

async function exists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

test('permanent account deletion removes every owned record and private file without affecting another learner', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'knowledge-pilot-account-delete-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const cardDir = path.join(root, 'cards');
  const bookFileDir = path.join(root, 'book-files');
  await fs.mkdir(cardDir, { recursive: true });
  await fs.mkdir(path.join(bookFileDir, 'user_delete', 'book_delete'), { recursive: true });
  await fs.writeFile(path.join(cardDir, 'delete-only.svg'), '<svg/>');
  await fs.writeFile(path.join(cardDir, 'shared.svg'), '<svg/>');
  await fs.writeFile(path.join(bookFileDir, 'user_delete', 'book_delete', 'source.txt'), 'private text');

  const store = await new JsonStore({
    stateFile: path.join(root, 'state.json'),
    backupDir: path.join(root, 'backups'),
    retention: 3,
    logger
  }).init();
  const collections = ['plans', 'lessons', 'interactions', 'jobs', 'messages', 'businessTasks', 'books', 'bookPlans', 'bookSessions'];
  await store.transaction((state) => {
    state.users.user_delete = { id: 'user_delete', name: 'Delete Me', accessVersion: 1 };
    state.users.user_keep = { id: 'user_keep', name: 'Keep Me', accessVersion: 1 };
    for (const collection of collections) {
      state[collection][`${collection}_delete`] = { id: `${collection}_delete`, userId: 'user_delete' };
      state[collection][`${collection}_keep`] = { id: `${collection}_keep`, userId: 'user_keep' };
    }
    state.lessons.lessons_delete.cardFile = 'delete-only.svg';
    state.bookSessions.bookSessions_delete.cardFile = 'shared.svg';
    state.lessons.lessons_keep.cardFile = 'shared.svg';
  });

  const accounts = new AccountDeletionService({ store, cardDir, bookFileDir, logger });
  const preview = accounts.preview('user_delete');
  assert.equal(preview.user.name, 'Delete Me');
  assert.equal(preview.totalRecords, collections.length + 1);
  assert.equal(preview.records.businessTasks, 1);

  await assert.rejects(accounts.deleteUser('user_delete', 'delete me'), {
    code: 'DELETE_CONFIRMATION_MISMATCH',
    statusCode: 400
  });
  assert.ok(store.read((state) => state.users.user_delete));

  const result = await accounts.deleteUser('user_delete', 'Delete Me', { actor: 'administrator' });
  assert.equal(result.ok, true);
  assert.equal(result.actor, 'administrator');
  assert.equal(result.totalRecords, collections.length + 1);
  assert.equal(result.deleted.users, 1);

  const snapshot = store.snapshot();
  assert.equal(snapshot.users.user_delete, undefined);
  assert.equal(snapshot.users.user_keep.name, 'Keep Me');
  for (const collection of collections) {
    assert.equal(Object.values(snapshot[collection]).some((record) => record.userId === 'user_delete'), false, collection);
    assert.equal(Object.values(snapshot[collection]).some((record) => record.userId === 'user_keep'), true, collection);
  }
  assert.equal(snapshot.meta.accountDeletion.totalCompleted, 1);
  assert.equal(JSON.stringify(snapshot.meta.accountDeletion).includes('user_delete'), false);
  assert.equal(await exists(path.join(cardDir, 'delete-only.svg')), false);
  assert.equal(await exists(path.join(cardDir, 'shared.svg')), true);
  assert.equal(await exists(path.join(bookFileDir, 'user_delete')), false);

  await assert.rejects(accounts.deleteUser('user_delete', 'Delete Me'), {
    code: 'USER_NOT_FOUND',
    statusCode: 404
  });
});
