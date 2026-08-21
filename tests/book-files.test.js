import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { BookFileService } from '../src/services/book-files.js';
import { JsonStore } from '../src/store.js';

const logger = { debug() {}, info() {}, warn() {}, error() {} };

test('owned TXT copy is stored privately and exposed only through bounded chunks', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'knowledge-pilot-book-files-'));
  const service = await new BookFileService({ rootDir: root, logger }).init();
  const body = `${'This is a lawful learner-owned source used for testing. '.repeat(20)}\nSecond section.`;
  const source = await service.save({ userId: 'user_test', bookId: 'book_test', filename: '../unsafe name.txt', buffer: Buffer.from(body) });
  assert.equal(source.filename, 'unsafe_name.txt');
  assert.equal(source.format, 'txt');
  assert.ok(source.extractedCharacters >= 200);
  assert.equal(path.isAbsolute(source.textPath), false);
  const first = await service.chunk(source, 0, 1000);
  assert.equal(first.offset, 0);
  assert.ok(first.text.includes('lawful learner-owned source'));
  assert.ok(first.text.length <= 1000);
  if (first.nextOffset !== null) {
    const second = await service.chunk(source, first.nextOffset, 1000);
    assert.equal(second.offset, first.nextOffset);
  }
});

test('owned-copy validation rejects mislabeled PDF data', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'knowledge-pilot-invalid-pdf-'));
  const service = await new BookFileService({ rootDir: root, logger }).init();
  await assert.rejects(
    service.save({ userId: 'user_test', bookId: 'book_test', filename: 'fake.pdf', buffer: Buffer.from('not a pdf'.repeat(30)) }),
    /not a valid PDF/
  );
});

test('owned-copy replacement uses versioned files and removes only the superseded source', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'knowledge-pilot-replace-book-file-'));
  const service = await new BookFileService({ rootDir: root, logger }).init();
  const first = await service.save({
    userId: 'user_test',
    bookId: 'book_test',
    filename: 'first-edition.txt',
    buffer: Buffer.from('First lawful owned edition. '.repeat(30))
  });
  const second = await service.save({
    userId: 'user_test',
    bookId: 'book_test',
    filename: 'revised-edition.txt',
    buffer: Buffer.from('Revised lawful owned edition. '.repeat(30))
  });

  assert.notEqual(first.originalPath, second.originalPath);
  assert.notEqual(first.textPath, second.textPath);
  assert.match((await service.chunk(first, 0, 1000)).text, /First lawful/);
  assert.match((await service.chunk(second, 0, 1000)).text, /Revised lawful/);

  await service.removeSource(first);
  await assert.rejects(service.chunk(first, 0, 1000), /ENOENT/);
  assert.match((await service.chunk(second, 0, 1000)).text, /Revised lawful/);
});

test('schema version 2 state migrates without losing existing records', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'knowledge-pilot-migration-'));
  const stateFile = path.join(root, 'state.json');
  const backupDir = path.join(root, 'backups');
  await fs.mkdir(backupDir, { recursive: true });
  await fs.writeFile(stateFile, JSON.stringify({
    meta: { schemaVersion: 2 },
    users: { user_existing: { id: 'user_existing', name: 'Existing learner' } },
    plans: {}, lessons: { lesson_existing: { id: 'lesson_existing', userId: 'user_existing', status: 'delivered', resumePercent: 40 } }, interactions: {}, jobs: {}, messages: {}, businessTasks: {}, settings: { installationId: 'existing' }
  }));
  const store = await new JsonStore({ stateFile, backupDir, logger }).init();
  const state = store.snapshot();
  assert.equal(state.meta.schemaVersion, 5);
  assert.equal(state.users.user_existing.name, 'Existing learner');
  assert.deepEqual(state.books, {});
  assert.deepEqual(state.bookPlans, {});
  assert.deepEqual(state.bookSessions, {});
  assert.equal(state.lessons.lesson_existing.experience.currentSectionId, 'cover');
  assert.equal(state.lessons.lesson_existing.experience.revision, 0);
});

test('learner and admin assets expose the separate Books workspace', async () => {
  const app = await fs.readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const appHtml = await fs.readFile(new URL('../public/app.html', import.meta.url), 'utf8');
  const admin = await fs.readFile(new URL('../public/admin.html', import.meta.url), 'utf8');
  assert.match(app, /book/i);
  assert.match(app, /You can attach or replace a legally obtained copy at any time/);
  assert.match(app, /Owned book file \(optional\)/);
  assert.match(app, /Current progress was preserved/);
  assert.match(appHtml, /Books/i);
  assert.match(admin, /Books/i);
});
