import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { JsonStore } from '../src/store.js';
import { BookLearningService, defaultBookSessionExperience } from '../src/services/books.js';

const logger = { debug() {}, info() {}, warn() {}, error() {} };

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'knowledge-pilot-book-reader-'));
  const store = await new JsonStore({
    stateFile: path.join(root, 'state.json'),
    backupDir: path.join(root, 'backups'),
    retention: 2,
    logger
  }).init();
  const books = new BookLearningService({
    store,
    config: { businessActions: { autoScheduleApproved: false } },
    logger,
    bookFiles: { async chunk() {} }
  });
  await store.transaction((state) => {
    state.users.reader = { id: 'reader', language: 'en' };
    state.users.other = { id: 'other', language: 'en' };
    state.bookSessions.session_reader = {
      id: 'session_reader',
      userId: 'reader',
      bookId: 'book_reader',
      status: 'delivered',
      language: 'en',
      resumePercent: 0,
      experience: defaultBookSessionExperience(),
      updatedAt: new Date().toISOString()
    };
  });
  return { store, books };
}

test('book-session experience persists bilingual position and private mutations', async () => {
  const { store, books } = await fixture();
  const result = await books.updateSessionExperience('reader', 'session_reader', {
    baseRevision: 0,
    currentSectionId: 'core-model',
    anchorId: 'idea-2',
    completedSectionIds: ['opening'],
    selectedLanguage: 'ar',
    started: true,
    sectionTotal: 2,
    mutation: {
      id: 'note-1',
      type: 'note',
      sectionId: 'core-model',
      anchorId: 'idea-2',
      passage: 'A bounded highlighted passage.',
      note: 'Keep this connection.',
      language: 'ar'
    }
  });

  assert.equal(result.revision, 1);
  assert.equal(result.experience.currentSectionId, 'core-model');
  assert.equal(result.experience.anchorId, 'idea-2');
  assert.equal(result.experience.selectedLanguage, 'ar');
  assert.equal(result.experience.notes.length, 1);
  assert.equal(result.experience.notes[0].language, 'ar');
  assert.equal(result.resumePercent, 50);
  assert.equal(store.snapshot().bookSessions.session_reader.experience.revision, 1);
});

test('book-session experience rejects stale revisions and another learner', async () => {
  const { books } = await fixture();
  await books.updateSessionExperience('reader', 'session_reader', {
    baseRevision: 0,
    currentSectionId: 'opening',
    sectionTotal: 2
  });

  await assert.rejects(
    books.updateSessionExperience('reader', 'session_reader', { baseRevision: 0, currentSectionId: 'core', sectionTotal: 2 }),
    (error) => error.statusCode === 409 && error.code === 'STALE_BOOK_SESSION_PROGRESS'
  );
  await assert.rejects(
    books.updateSessionExperience('other', 'session_reader', { baseRevision: 1, currentSectionId: 'core', sectionTotal: 2 }),
    /Book session not found/
  );
});
