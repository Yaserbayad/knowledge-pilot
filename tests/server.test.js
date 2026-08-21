import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { JsonStore } from '../src/store.js';
import { AiService } from '../src/services/ai.js';
import { ResearchService } from '../src/services/research.js';
import { LearningService } from '../src/services/learning.js';
import { BookLearningService } from '../src/services/books.js';
import { AccountDeletionService } from '../src/services/account-deletion.js';
import { createServer } from '../src/server.js';

const logger = { debug() {}, info() {}, warn() {}, error() {} };

test('HTTP admin can create a user and private link opens the learner API', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'knowledge-pilot-http-'));
  const config = {
    nodeEnv: 'development', appBaseUrl: 'http://127.0.0.1', appSecret: 'http-test-secret-http-test-secret', adminToken: 'admin-test-token',
    defaultLanguage: 'en', defaultTimezone: 'Europe/Brussels', cardDir: path.join(root, 'cards'),
    scheduler: { enabled: false }, telegram: { webhookSecret: '' }, ai: { provider: 'mock' }, research: { searxngUrl: '', maxResults: 6, fetchTimeoutMs: 1000 },
    whatsapp: { dedicatedNumber: '' }
  };
  const store = await new JsonStore({ stateFile: path.join(root, 'state.json'), backupDir: path.join(root, 'backups'), retention: 3, logger }).init();
  const learning = new LearningService({ store, ai: new AiService(config.ai, logger), research: new ResearchService(config.research, logger), config, logger });
  const telegram = { enabled: false, botUsername: null, handleUpdate() {} };
  const whatsapp = { enabled: false, status: 'disabled' };
  const server = createServer({ config, store, learning, telegram, whatsapp, scheduler: {}, logger });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  const login = await fetch(`${base}/api/admin/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: 'admin-test-token' }) });
  assert.equal(login.status, 200);
  const adminCookie = login.headers.get('set-cookie').split(';')[0];
  const created = await fetch(`${base}/api/admin/users`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: adminCookie }, body: JSON.stringify({ name: 'Web Tester' }) });
  assert.equal(created.status, 201);
  const result = await created.json();
  const privateUrl = new URL(result.accessUrl);
  const open = await fetch(`${base}${privateUrl.pathname}`, { redirect: 'manual' });
  assert.equal(open.status, 302);
  const userCookie = open.headers.get('set-cookie').split(';')[0];
  const me = await fetch(`${base}/api/me`, { headers: { cookie: userCookie } });
  assert.equal(me.status, 200);
  assert.equal((await me.json()).name, 'Web Tester');
});

test('learner can revise onboarding profile after initial completion and UI assets expose theme support', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'knowledge-pilot-profile-http-'));
  const config = {
    nodeEnv: 'development', appBaseUrl: 'http://127.0.0.1', appSecret: 'profile-test-secret-profile-test', adminToken: 'admin-test-token',
    defaultLanguage: 'en', defaultTimezone: 'Europe/Brussels', cardDir: path.join(root, 'cards'),
    scheduler: { enabled: false }, telegram: { webhookSecret: '' }, ai: { provider: 'mock' }, research: { searxngUrl: '', maxResults: 6, fetchTimeoutMs: 1000 },
    whatsapp: { dedicatedNumber: '' }
  };
  const store = await new JsonStore({ stateFile: path.join(root, 'state.json'), backupDir: path.join(root, 'backups'), retention: 3, logger }).init();
  const learning = new LearningService({ store, ai: new AiService(config.ai, logger), research: new ResearchService(config.research, logger), config, logger });
  const telegram = { enabled: false, botUsername: null, handleUpdate() {} };
  const whatsapp = { enabled: false, status: 'disabled' };
  const server = createServer({ config, store, learning, telegram, whatsapp, scheduler: {}, logger });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  const login = await fetch(`${base}/api/admin/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: 'admin-test-token' }) });
  const adminCookie = login.headers.get('set-cookie').split(';')[0];
  const created = await fetch(`${base}/api/admin/users`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: adminCookie }, body: JSON.stringify({ name: 'Profile Tester', language: 'en' }) });
  const result = await created.json();
  const privateUrl = new URL(result.accessUrl);
  const open = await fetch(`${base}${privateUrl.pathname}`, { redirect: 'manual' });
  const userCookie = open.headers.get('set-cookie').split(';')[0];

  const first = await fetch(`${base}/api/onboarding`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: userCookie }, body: JSON.stringify({
    language: 'en', interests: ['Science'], rankedTopics: ['Biology'], avoidedTopics: [], exampleQuestions: ['How do cells work?'], preferredWindows: ['morning'], knowledgeRatings: { Biology: 'beginner' }, channels: { web: true }
  }) });
  assert.equal(first.status, 200);

  const revised = await fetch(`${base}/api/onboarding`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: userCookie }, body: JSON.stringify({
    language: 'ar', interests: ['Science', 'History'], rankedTopics: ['Critical thinking', 'Biology'], avoidedTopics: ['Celebrity news'], exampleQuestions: ['كيف تتشكل القناعات؟'], preferredWindows: ['travel', 'evening'], knowledgeRatings: { 'Critical thinking': 'mixed', Biology: 'beginner' }, channels: { web: true, telegram: true }
  }) });
  assert.equal(revised.status, 200);

  const meResponse = await fetch(`${base}/api/me`, { headers: { cookie: userCookie } });
  const me = await meResponse.json();
  assert.equal(me.onboardingComplete, true);
  assert.equal(me.language, 'ar');
  assert.deepEqual(me.interests, ['Science', 'History']);
  assert.deepEqual(me.rankedTopics, ['Critical thinking', 'Biology']);
  assert.equal(me.channels.telegram, true);

  const app = await fetch(`${base}/app`);
  assert.match(await app.text(), /data-theme-toggle/);
  const theme = await fetch(`${base}/assets/theme.js`);
  assert.equal(theme.status, 200);
  assert.match(await theme.text(), /knowledge-pilot-theme/);
});


test('learner HTTP API creates and lists a separate queued book track', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'knowledge-pilot-book-http-'));
  const config = {
    nodeEnv: 'development', appBaseUrl: 'http://127.0.0.1', appSecret: 'book-http-secret-book-http-secret', adminToken: 'admin-test-token',
    defaultLanguage: 'en', defaultTimezone: 'Europe/Brussels', cardDir: path.join(root, 'cards'),
    scheduler: { enabled: false }, telegram: { webhookSecret: '' }, ai: { provider: 'chatgpt_business' }, research: { searxngUrl: '', maxResults: 6, fetchTimeoutMs: 1000 },
    whatsapp: { dedicatedNumber: '' }
  };
  const store = await new JsonStore({ stateFile: path.join(root, 'state.json'), backupDir: path.join(root, 'backups'), retention: 3, logger }).init();
  const learning = new LearningService({ store, ai: new AiService(config.ai, logger), research: new ResearchService(config.research, logger), config, logger });
  const books = new BookLearningService({ store, config, logger, bookFiles: { async save() {}, async chunk() {} } });
  books.setBusinessActions({ queueBookAnalysis(userId, bookId) { return { id: 'task_book_1', userId, payload: { bookId }, status: 'pending' }; } });
  const telegram = { enabled: false, botUsername: null, handleUpdate() {} };
  const whatsapp = { enabled: false, status: 'disabled' };
  const server = createServer({ config, store, learning, books, telegram, whatsapp, scheduler: {}, logger });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;

  const login = await fetch(`${base}/api/admin/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: 'admin-test-token' }) });
  const adminCookie = login.headers.get('set-cookie').split(';')[0];
  const created = await fetch(`${base}/api/admin/users`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: adminCookie }, body: JSON.stringify({ name: 'Book API Tester', language: 'en' }) });
  const user = await created.json();
  const privateUrl = new URL(user.accessUrl);
  const open = await fetch(`${base}${privateUrl.pathname}`, { redirect: 'manual' });
  const userCookie = open.headers.get('set-cookie').split(';')[0];

  const add = await fetch(`${base}/api/books`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: userCookie }, body: JSON.stringify({ title: 'Educated', author: 'Tara Westover', language: 'en' }) });
  assert.equal(add.status, 201);
  const result = await add.json();
  assert.equal(result.book.title, 'Educated');
  assert.equal(result.book.status, 'queued_analysis');
  assert.equal(result.status, 'pending');
  assert.equal(result.payload.bookId, result.book.id);

  const list = await fetch(`${base}/api/books`, { headers: { cookie: userCookie } });
  assert.equal(list.status, 200);
  const records = await list.json();
  assert.equal(records.length, 1);
  assert.equal(records[0].title, 'Educated');
});

test('learner self-service API exposes held work, enforces ownership, schedules acceptance, and shows pending notices', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'knowledge-pilot-self-service-http-'));
  const config = {
    version: '1.3.0', nodeEnv: 'development', appBaseUrl: 'http://127.0.0.1', appSecret: 'self-service-http-secret-self-service', adminToken: 'admin-test-token',
    defaultLanguage: 'en', defaultTimezone: 'Europe/Brussels', cardDir: path.join(root, 'cards'),
    scheduler: { enabled: false }, telegram: { webhookSecret: '' }, ai: { provider: 'mock' }, research: { searxngUrl: '', maxResults: 6, fetchTimeoutMs: 1000 },
    businessActions: { autoScheduleApproved: false, autoScheduleDelayMinutes: 5 }, automation: { notifyActionRequired: true, startFirstPlanAfterOnboarding: false },
    whatsapp: { dedicatedNumber: '' }
  };
  const store = await new JsonStore({ stateFile: path.join(root, 'state.json'), backupDir: path.join(root, 'backups'), retention: 3, logger }).init();
  const learning = new LearningService({ store, ai: new AiService(config.ai, logger), research: new ResearchService(config.research, logger), config, logger });
  const telegram = { enabled: false, botUsername: null, handleUpdate() {} };
  const whatsapp = { enabled: false, status: 'disabled' };
  const scheduler = { running: false, lastTickAt: null, lastError: null };
  const server = createServer({ config, store, learning, telegram, whatsapp, scheduler, logger });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;

  const { user: owner } = await learning.createUser({ name: 'Owner' });
  const { user: other } = await learning.createUser({ name: 'Other' });
  const cookieFor = async (target) => {
    const privateUrl = new URL(learning.accessUrl(target));
    const opened = await fetch(`${base}${privateUrl.pathname}`, { redirect: 'manual' });
    return opened.headers.get('set-cookie').split(';')[0];
  };
  const ownerCookie = await cookieFor(owner);
  const otherCookie = await cookieFor(other);
  const now = new Date().toISOString();
  await store.transaction((state) => {
    state.lessons.lesson_held = {
      id: 'lesson_held', userId: owner.id, title: 'Held lesson', topic: 'Reasoning', status: 'draft', reviewStatus: 'needs_review',
      quality: { score: 80, issues: ['One issue'], warnings: [] }, scheduledAt: null, deliveredAt: null, createdAt: now, updatedAt: now
    };
    state.jobs.notice_pending = {
      id: 'notice_pending', type: 'send_system_notice', userId: owner.id, status: 'pending', runAt: now, attempts: 0, lastError: null,
      payload: { kind: 'lesson_review_required', title: 'Lesson needs your review', message: 'Review it.', actionUrl: `${learning.accessUrl(owner)}#lesson=lesson_held`, actionLabel: 'Review lesson', dedupeKey: 'held-lesson', metadata: { lessonId: 'lesson_held' } },
      createdAt: now, updatedAt: now
    };
  });

  const ownerList = await fetch(`${base}/api/lessons`, { headers: { cookie: ownerCookie } });
  assert.equal(ownerList.status, 200);
  assert.equal((await ownerList.json())[0].reviewStatus, 'needs_review');
  assert.equal((await fetch(`${base}/api/lessons/lesson_held`, { headers: { cookie: otherCookie } })).status, 404);
  assert.equal((await fetch(`${base}/api/lessons/lesson_held/review`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: otherCookie }, body: JSON.stringify({ decision: 'approve' }) })).status, 404);

  const invalid = await fetch(`${base}/api/lessons/lesson_held/review`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: ownerCookie }, body: JSON.stringify({ decision: 'maybe' }) });
  assert.equal(invalid.status, 400);
  const accepted = await fetch(`${base}/api/lessons/lesson_held/review`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: ownerCookie }, body: JSON.stringify({ decision: 'approve' }) });
  assert.equal(accepted.status, 200);
  assert.equal((await accepted.json()).status, 'scheduled');
  const prematureComplete = await fetch(`${base}/api/lessons/lesson_held/complete`, { method: 'POST', headers: { cookie: ownerCookie } });
  assert.equal(prematureComplete.status, 409);

  const noticesResponse = await fetch(`${base}/api/notices`, { headers: { cookie: ownerCookie } });
  assert.equal(noticesResponse.status, 200);
  const notices = await noticesResponse.json();
  assert.ok(notices.some((notice) => notice.notice?.dedupeKey === 'held-lesson' && notice.deliveryState === 'pending'));
});

test('learner book metadata hides server paths and generated cards require the owning private session', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'knowledge-pilot-private-assets-http-'));
  const config = {
    version: '1.3.0', nodeEnv: 'development', appBaseUrl: 'http://127.0.0.1', appSecret: 'private-assets-secret-private-assets', adminToken: 'admin-test-token',
    defaultLanguage: 'en', defaultTimezone: 'Europe/Brussels', cardDir: path.join(root, 'cards'),
    scheduler: { enabled: false }, telegram: { webhookSecret: '' }, ai: { provider: 'mock' }, research: { searxngUrl: '', maxResults: 6, fetchTimeoutMs: 1000 },
    businessActions: { autoScheduleApproved: true, autoScheduleDelayMinutes: 2 }, automation: { notifyActionRequired: true, startFirstPlanAfterOnboarding: false },
    whatsapp: { dedicatedNumber: '' }
  };
  await fs.mkdir(config.cardDir, { recursive: true });
  await fs.writeFile(path.join(config.cardDir, 'owner-card.svg'), '<svg xmlns="http://www.w3.org/2000/svg"></svg>');
  const store = await new JsonStore({ stateFile: path.join(root, 'state.json'), backupDir: path.join(root, 'backups'), retention: 3, logger }).init();
  const learning = new LearningService({ store, ai: new AiService(config.ai, logger), research: new ResearchService(config.research, logger), config, logger });
  const books = new BookLearningService({ store, config, logger, bookFiles: { async save() {}, async chunk() {} } });
  const telegram = { enabled: false, botUsername: null, handleUpdate() {} };
  const whatsapp = { enabled: false, status: 'disabled' };
  const scheduler = { running: false, lastTickAt: null, lastError: null };
  const server = createServer({ config, store, learning, books, telegram, whatsapp, scheduler, logger });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;

  const { user: owner } = await learning.createUser({ name: 'Asset Owner' });
  const { user: other } = await learning.createUser({ name: 'Asset Other' });
  const cookieFor = async (target) => {
    const privateUrl = new URL(learning.accessUrl(target));
    const opened = await fetch(`${base}${privateUrl.pathname}`, { redirect: 'manual' });
    return opened.headers.get('set-cookie').split(';')[0];
  };
  const ownerCookie = await cookieFor(owner);
  const otherCookie = await cookieFor(other);
  const now = new Date().toISOString();
  await store.transaction((state) => {
    state.books.book_private = {
      id: 'book_private', userId: owner.id, title: 'Private Book', status: 'active', updatedAt: now, createdAt: now,
      ownedCopy: {
        filename: 'private.pdf', format: 'pdf', sizeBytes: 100, extractedCharacters: 500, uploadedAt: now,
        originalPath: '/srv/private/original.pdf', textPath: '/srv/private/extracted.txt'
      }
    };
    state.lessons.lesson_card = {
      id: 'lesson_card', userId: owner.id, title: 'Private card', status: 'delivered', reviewStatus: 'approved',
      cardFile: 'owner-card.svg', deliveredAt: now, createdAt: now, updatedAt: now
    };
  });

  const booksResponse = await fetch(`${base}/api/books`, { headers: { cookie: ownerCookie } });
  const listedBook = (await booksResponse.json())[0];
  assert.equal(listedBook.ownedCopy.filename, 'private.pdf');
  assert.equal('originalPath' in listedBook.ownedCopy, false);
  assert.equal('textPath' in listedBook.ownedCopy, false);

  assert.equal((await fetch(`${base}/cards/owner-card.svg`)).status, 401);
  assert.equal((await fetch(`${base}/cards/owner-card.svg`, { headers: { cookie: otherCookie } })).status, 404);
  const card = await fetch(`${base}/cards/owner-card.svg`, { headers: { cookie: ownerCookie } });
  assert.equal(card.status, 200);
  assert.match(card.headers.get('content-type'), /image\/svg\+xml/);
});

test('learner and administrator deletion endpoints require exact confirmation, isolate owners, and invalidate private access', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'knowledge-pilot-account-delete-http-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const config = {
    version: '1.4.1', nodeEnv: 'development', appBaseUrl: 'http://127.0.0.1', appSecret: 'delete-http-secret-delete-http-secret', adminToken: 'admin-test-token',
    defaultLanguage: 'en', defaultTimezone: 'Europe/Brussels', cardDir: path.join(root, 'cards'), bookFileDir: path.join(root, 'book-files'),
    scheduler: { enabled: false }, telegram: { webhookSecret: '' }, ai: { provider: 'mock' }, research: { searxngUrl: '', maxResults: 6, fetchTimeoutMs: 1000 },
    businessActions: { autoScheduleApproved: true, autoScheduleDelayMinutes: 2 }, automation: { notifyActionRequired: true, startFirstPlanAfterOnboarding: false },
    whatsapp: { dedicatedNumber: '' }
  };
  await fs.mkdir(config.cardDir, { recursive: true });
  const store = await new JsonStore({ stateFile: path.join(root, 'state.json'), backupDir: path.join(root, 'backups'), retention: 3, logger }).init();
  const learning = new LearningService({ store, ai: new AiService(config.ai, logger), research: new ResearchService(config.research, logger), config, logger });
  const accounts = new AccountDeletionService({ store, cardDir: config.cardDir, bookFileDir: config.bookFileDir, logger });
  const telegram = { enabled: false, botUsername: null, handleUpdate() {} };
  const whatsapp = { enabled: false, status: 'disabled' };
  const scheduler = { running: false, lastTickAt: null, lastError: null };
  const server = createServer({ config, store, learning, accounts, telegram, whatsapp, scheduler, logger });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;

  const login = await fetch(`${base}/api/admin/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: 'admin-test-token' }) });
  const adminCookie = login.headers.get('set-cookie').split(';')[0];
  const selfCreate = await fetch(`${base}/api/admin/users`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: adminCookie }, body: JSON.stringify({ name: 'Self Delete' }) });
  const selfCreated = await selfCreate.json();
  const selfUser = selfCreated.user;
  const adminCreate = await fetch(`${base}/api/admin/users`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: adminCookie }, body: JSON.stringify({ name: 'Admin Delete' }) });
  const adminCreated = await adminCreate.json();
  const adminUser = adminCreated.user;
  const selfOpen = await fetch(`${base}${new URL(selfCreated.accessUrl).pathname}`, { redirect: 'manual' });
  const selfCookie = selfOpen.headers.get('set-cookie').split(';')[0];
  const now = new Date().toISOString();
  await store.transaction((state) => {
    state.lessons.self_lesson = { id: 'self_lesson', userId: selfUser.id, title: 'Private', createdAt: now, updatedAt: now };
    state.lessons.admin_lesson = { id: 'admin_lesson', userId: adminUser.id, title: 'Private', createdAt: now, updatedAt: now };
  });

  const crossOrigin = await fetch(`${base}/api/account`, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json', cookie: selfCookie, origin: 'https://attacker.example' },
    body: JSON.stringify({ confirmation: 'Self Delete' })
  });
  assert.equal(crossOrigin.status, 403);
  assert.ok(store.read((state) => state.users[selfUser.id]));

  const mismatch = await fetch(`${base}/api/account`, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json', cookie: selfCookie },
    body: JSON.stringify({ confirmation: 'wrong' })
  });
  assert.equal(mismatch.status, 400);

  const selfDelete = await fetch(`${base}/api/account`, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json', cookie: selfCookie },
    body: JSON.stringify({ confirmation: 'Self Delete' })
  });
  assert.equal(selfDelete.status, 200);
  assert.match(selfDelete.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal((await fetch(`${base}/api/me`, { headers: { cookie: selfCookie } })).status, 401);
  assert.equal(store.read((state) => state.lessons.self_lesson), undefined);
  assert.ok(store.read((state) => state.users[adminUser.id]));

  const adminMismatch = await fetch(`${base}/api/admin/users/${adminUser.id}`, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json', cookie: adminCookie },
    body: JSON.stringify({ confirmation: 'wrong' })
  });
  assert.equal(adminMismatch.status, 400);
  const adminDelete = await fetch(`${base}/api/admin/users/${adminUser.id}`, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json', cookie: adminCookie },
    body: JSON.stringify({ confirmation: 'Admin Delete' })
  });
  assert.equal(adminDelete.status, 200);
  assert.equal(store.read((state) => state.users[adminUser.id]), undefined);
  assert.equal(store.read((state) => state.lessons.admin_lesson), undefined);
});
