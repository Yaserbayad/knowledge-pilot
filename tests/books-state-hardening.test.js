import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { JsonStore } from '../src/store.js';
import { AiService } from '../src/services/ai.js';
import { LearningService } from '../src/services/learning.js';
import { BookLearningService } from '../src/services/books.js';
import { BusinessActionsService } from '../src/services/business-actions.js';

const logger = { debug() {}, info() {}, warn() {}, error() {} };

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'knowledge-pilot-book-state-'));
  const config = {
    appBaseUrl: 'https://learn.example.com', appSecret: 'book-state-secret-book-state-secret',
    defaultLanguage: 'en', defaultTimezone: 'Europe/Brussels', cardDir: path.join(root, 'cards'),
    ai: { provider: 'chatgpt_business' }, whatsapp: { dedicatedNumber: '' }
  };
  const store = await new JsonStore({ stateFile: path.join(root, 'state.json'), backupDir: path.join(root, 'backups'), retention: 3, logger }).init();
  const research = { async fetchUrls(sources) { return sources; } };
  const learning = new LearningService({ store, ai: new AiService(config.ai, logger), research, config, logger });
  const books = new BookLearningService({ store, config, logger, bookFiles: { async save() {}, async chunk() {} } });
  const actions = new BusinessActionsService({ store, research, learning, books, config: { enabled: true, apiKey: 'book-state-key', cardDir: config.cardDir }, logger });
  learning.setBusinessActions(actions);
  books.setBusinessActions(actions);
  return { store, learning, books, actions };
}

function failWhenNewAnalysisTaskAppears(store, message, ignoreTaskId = null) {
  const original = store.transaction.bind(store);
  let injected = false;
  store.transaction = (mutator) => original(async (state) => {
    const before = new Set(Object.keys(state.businessTasks || {}));
    const value = await mutator(state);
    const added = Object.values(state.businessTasks || {}).find((task) =>
      !before.has(task.id) && task.id !== ignoreTaskId && task.type === 'book_analysis' && ['pending', 'claimed'].includes(task.status));
    if (!injected && added) {
      injected = true;
      throw new Error(message);
    }
    return value;
  });
}

test('book creation and its initial analysis task are one atomic state transition', async () => {
  const { store, learning, books } = await fixture();
  const { user } = await learning.createUser({ name: 'Atomic Book Learner' });
  failWhenNewAnalysisTaskAppears(store, 'simulated task creation failure');

  await assert.rejects(books.addBook(user.id, { title: 'Atomic Book', author: 'Writer' }), /task creation failure/);
  assert.equal(Object.values(store.snapshot().books).length, 0);
  assert.equal(Object.values(store.snapshot().businessTasks).filter((task) => task.type === 'book_analysis').length, 0);
});

test('forced re-analysis preserves the existing task when replacement task creation fails', async () => {
  const { store, learning, books } = await fixture();
  const { user } = await learning.createUser({ name: 'Reanalysis Learner' });
  const added = await books.addBook(user.id, { title: 'Reanalysis Book', author: 'Writer' });
  const originalTaskId = added.task.id;
  failWhenNewAnalysisTaskAppears(store, 'simulated replacement task failure', originalTaskId);

  await assert.rejects(books.queueAnalysis(user.id, added.book.id, { force: true }), /replacement task failure/);
  const state = store.snapshot();
  assert.equal(state.businessTasks[originalTaskId].status, 'pending');
  assert.equal(state.books[added.book.id].analysisTaskId, originalTaskId);
});

test('concurrent duplicate book additions converge to one book and one analysis task', async () => {
  const { store, learning, books } = await fixture();
  const { user } = await learning.createUser({ name: 'Duplicate Learner' });
  const [first, second] = await Promise.all([
    books.addBook(user.id, { title: 'The Same Book', author: 'Same Writer' }),
    books.addBook(user.id, { title: 'The Same Book', author: 'Same Writer' })
  ]);
  const state = store.snapshot();
  assert.equal(Object.values(state.books).filter((book) => book.userId === user.id).length, 1);
  assert.equal(Object.values(state.businessTasks).filter((task) => task.userId === user.id && task.type === 'book_analysis' && ['pending', 'claimed'].includes(task.status)).length, 1);
  assert.equal([first.merged, second.merged].filter(Boolean).length, 1);
});

test('active-book limit is enforced inside the serialized mutation boundary', async () => {
  const { store, learning, books } = await fixture();
  const { user } = await learning.createUser({ name: 'Limit Learner' });
  const results = await Promise.allSettled([
    books.addBook(user.id, { title: 'Book One', author: 'Writer' }),
    books.addBook(user.id, { title: 'Book Two', author: 'Writer' }),
    books.addBook(user.id, { title: 'Book Three', author: 'Writer' }),
    books.addBook(user.id, { title: 'Book Four', author: 'Writer' })
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 3);
  assert.equal(results.filter((result) => result.status === 'rejected').length, 1);
  assert.equal(Object.values(store.snapshot().books).filter((book) => book.userId === user.id).length, 3);
});

test('completed book-session progress cannot regress below 100 percent', async () => {
  const { store, learning, books } = await fixture();
  const { user } = await learning.createUser({ name: 'Completed Session Learner' });
  await store.transaction((state) => {
    state.bookSessions.session_done = { id: 'session_done', userId: user.id, bookId: 'book_done', status: 'completed', resumePercent: 100, updatedAt: new Date().toISOString() };
  });
  const session = await books.updateResume(user.id, 'session_done', 35);
  assert.equal(session.resumePercent, 100);
  assert.equal(store.snapshot().bookSessions.session_done.resumePercent, 100);
});

test('book controls reject invalid state jumps', async () => {
  const { store, learning, books } = await fixture();
  const { user } = await learning.createUser({ name: 'Control Learner' });
  await store.transaction((state) => {
    state.books.book_source = { id: 'book_source', userId: user.id, title: 'Needs Source', status: 'source_required', activePlanId: null, updatedAt: new Date().toISOString() };
    state.books.book_queue = { id: 'book_queue', userId: user.id, title: 'Queued', status: 'queued_analysis', activePlanId: null, updatedAt: new Date().toISOString() };
  });
  await assert.rejects(books.control(user.id, 'book_source', 'resume'), /cannot|invalid|paused/i);
  await assert.rejects(books.control(user.id, 'book_queue', 'pause'), /cannot|invalid|active/i);
  assert.equal(store.snapshot().books.book_source.status, 'source_required');
  assert.equal(store.snapshot().books.book_queue.status, 'queued_analysis');
});

test('a skipped approved book session stays skipped when the book is resumed', async () => {
  const { store, learning, books } = await fixture();
  const { user } = await learning.createUser({ name: 'Skip Learner' });
  await store.transaction((state) => {
    state.bookPlans.plan_skip = {
      id: 'plan_skip', userId: user.id, bookId: 'book_skip', status: 'approved', sessionsPerWeek: 3,
      sessions: [{ id: 'item_1', number: 1, title: 'Session 1', scope: 'Scope', isCore: true, estimatedMinutes: 8 }],
      updatedAt: new Date().toISOString()
    };
    state.books.book_skip = { id: 'book_skip', userId: user.id, title: 'Skip Book', status: 'active', activePlanId: 'plan_skip', currentSessionNumber: 0, progressPercent: 0, concepts: [], updatedAt: new Date().toISOString() };
    state.bookSessions.session_skip = {
      id: 'session_skip', userId: user.id, bookId: 'book_skip', planId: 'plan_skip', sessionNumber: 1, sessionType: 'core',
      status: 'skipped', reviewStatus: 'approved', scheduledAt: null, updatedAt: new Date().toISOString()
    };
  });
  await books.control(user.id, 'book_skip', 'pause');
  await books.control(user.id, 'book_skip', 'resume');
  const state = store.snapshot();
  assert.equal(state.bookSessions.session_skip.status, 'skipped');
  assert.equal(Object.values(state.jobs).some((job) => job.type === 'deliver_book_session' && job.payload?.sessionId === 'session_skip' && job.status === 'pending'), false);
});
