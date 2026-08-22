import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createUserToken } from '../src/auth.js';
import { JsonStore } from '../src/store.js';
import { BookLearningService, defaultBookSessionExperience } from '../src/services/books.js';
import { createServer } from '../src/server.js';

const logger = { debug() {}, info() {}, warn() {}, error() {} };

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'knowledge-pilot-book-reader-http-'));
  const config = {
    nodeEnv: 'development', appBaseUrl: 'http://127.0.0.1', appSecret: 'book-reader-http-secret-book-reader', adminToken: 'admin-test-token',
    defaultLanguage: 'en', defaultTimezone: 'Europe/Brussels', cardDir: path.join(root, 'cards'),
    scheduler: { enabled: false }, telegram: { webhookSecret: '' }, ai: { provider: 'mock' }, research: {},
    businessActions: {}, whatsapp: { dedicatedNumber: '' }
  };
  const store = await new JsonStore({ stateFile: path.join(root, 'state.json'), backupDir: path.join(root, 'backups'), retention: 2, logger }).init();
  const books = new BookLearningService({ store, config, logger, bookFiles: { async chunk() {} } });
  await store.transaction((state) => {
    state.users.reader = { id: 'reader', name: 'Reader', accessVersion: 1, language: 'en' };
    state.bookSessions.session_reader = {
      id: 'session_reader', userId: 'reader', bookId: 'book_reader', status: 'delivered', language: 'en', resumePercent: 0,
      experience: defaultBookSessionExperience(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    };
  });
  const server = createServer({
    config, store, learning: {}, books,
    telegram: { enabled: false, botUsername: null, handleUpdate() {} },
    whatsapp: { enabled: false, status: 'disabled' }, scheduler: {}, logger
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const token = createUserToken(config.appSecret, 'reader', 1);
  return { base, cookie: `kp_user=${token}` };
}

test('authenticated learner can persist book-session reading experience and receives stale-write conflicts', async (t) => {
  const { base, cookie } = await fixture(t);
  const first = await fetch(`${base}/api/book-sessions/session_reader/experience`, {
    method: 'POST', headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ baseRevision: 0, currentSectionId: 'opening', selectedLanguage: 'ar', completedSectionIds: ['opening'], sectionTotal: 2 })
  });
  assert.equal(first.status, 200);
  const saved = await first.json();
  assert.equal(saved.experience.selectedLanguage, 'ar');
  assert.equal(saved.revision, 1);
  assert.equal(saved.resumePercent, 50);

  const stale = await fetch(`${base}/api/book-sessions/session_reader/experience`, {
    method: 'POST', headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ baseRevision: 0, currentSectionId: 'core', sectionTotal: 2 })
  });
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).code, 'STALE_BOOK_SESSION_PROGRESS');
});

test('book-session experience endpoint retains normal same-origin and authentication protections', async (t) => {
  const { base, cookie } = await fixture(t);
  const unauthenticated = await fetch(`${base}/api/book-sessions/session_reader/experience`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}'
  });
  assert.equal(unauthenticated.status, 401);

  const crossOrigin = await fetch(`${base}/api/book-sessions/session_reader/experience`, {
    method: 'POST', headers: { 'content-type': 'application/json', cookie, origin: 'https://attacker.example' }, body: '{}'
  });
  assert.equal(crossOrigin.status, 403);
  assert.equal((await crossOrigin.json()).code, 'CROSS_ORIGIN_REQUEST');
});
