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
import { DeliveryService } from '../src/services/delivery.js';
import { Scheduler } from '../src/scheduler.js';
import { TelegramChannel } from '../src/channels/telegram.js';
import { reconcileWorkflow } from '../src/services/workflow-reconcile.js';

const logger = { debug() {}, info() {}, warn() {}, error() {} };

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'knowledge-pilot-lifecycle-'));
  const config = {
    nodeEnv: 'development', appBaseUrl: 'https://learn.example.com', appSecret: 'lifecycle-secret-lifecycle-secret',
    defaultLanguage: 'en', defaultTimezone: 'Europe/Brussels', cardDir: path.join(root, 'cards'),
    ai: { provider: 'mock' }, research: { searxngUrl: '', maxResults: 6, fetchTimeoutMs: 1000 },
    businessActions: { autoScheduleApproved: true, autoScheduleDelayMinutes: 2 },
    automation: { notifyActionRequired: true, startFirstPlanAfterOnboarding: false },
    whatsapp: { dedicatedNumber: '' }
  };
  const store = await new JsonStore({ stateFile: path.join(root, 'state.json'), backupDir: path.join(root, 'backups'), retention: 3, logger }).init();
  const learning = new LearningService({ store, ai: new AiService(config.ai, logger), research: new ResearchService(config.research, logger), config, logger });
  const books = new BookLearningService({ store, config, logger, bookFiles: { async save() {}, async chunk() {} } });
  const { user } = await learning.createUser({ name: 'Lifecycle Learner', language: 'en' });
  return { root, config, store, learning, books, user };
}

function job(id, type, userId, payload, status = 'pending') {
  const now = new Date().toISOString();
  return { id, type, userId, payload, runAt: now, status, attempts: 0, lastError: null, createdAt: now, updatedAt: now };
}

test('lesson lifecycle is guarded, idempotent, and skip cancels downstream work', async () => {
  const { store, learning, user } = await fixture();
  await store.transaction((state) => {
    state.lessons.lesson_skip = {
      id: 'lesson_skip', userId: user.id, title: 'Scheduled lesson', status: 'scheduled', reviewStatus: 'approved',
      scheduledAt: new Date().toISOString(), quiz: [{ id: 'q1', question: 'Q?', expected: 'A' }], remindersSent: 0,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    };
    state.jobs.deliver = job('deliver', 'deliver_lesson', user.id, { lessonId: 'lesson_skip' });
    state.jobs.reminder = job('reminder', 'send_reminder', user.id, { lessonId: 'lesson_skip' });
    state.jobs.reinforcement = job('reinforcement', 'send_reinforcement', user.id, { lessonId: 'lesson_skip', questionId: 'q1' });
  });
  const skipped = await learning.skipLesson(user.id, 'lesson_skip');
  assert.equal(skipped.status, 'skipped');
  assert.equal((await learning.skipLesson(user.id, 'lesson_skip')).status, 'skipped');
  for (const id of ['deliver', 'reminder', 'reinforcement']) assert.equal(store.snapshot().jobs[id].status, 'cancelled');
  await assert.rejects(learning.completeLesson(user.id, 'lesson_skip'), /Only a delivered lesson/);

  await store.transaction((state) => {
    state.lessons.lesson_done = {
      id: 'lesson_done', userId: user.id, title: 'Delivered lesson', status: 'delivered', reviewStatus: 'approved',
      deliveredAt: new Date().toISOString(), quiz: [{ id: 'q2', question: 'Q?', expected: 'A' }], remindersSent: 0,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    };
    state.jobs.done_reminder = job('done_reminder', 'send_reminder', user.id, { lessonId: 'lesson_done' });
  });
  const completed = await learning.completeLesson(user.id, 'lesson_done');
  assert.equal(completed.status, 'completed');
  const reinforcementCount = Object.values(store.snapshot().jobs).filter((item) => item.type === 'send_reinforcement' && item.payload?.lessonId === 'lesson_done').length;
  await learning.completeLesson(user.id, 'lesson_done');
  assert.equal(Object.values(store.snapshot().jobs).filter((item) => item.type === 'send_reinforcement' && item.payload?.lessonId === 'lesson_done').length, reinforcementCount);
  assert.equal(store.snapshot().jobs.done_reminder.status, 'cancelled');
});

test('book-session lifecycle is guarded, idempotent, and skip cancels downstream work', async () => {
  const { store, books, user } = await fixture();
  await store.transaction((state) => {
    state.books.book_1 = { id: 'book_1', userId: user.id, title: 'Test Book', status: 'active', currentSessionNumber: 0, concepts: [], updatedAt: new Date().toISOString() };
    state.bookPlans.plan_1 = { id: 'plan_1', userId: user.id, bookId: 'book_1', sessions: [{ number: 1, isCore: true }, { number: 2, isCore: true }] };
    state.bookSessions.session_skip = {
      id: 'session_skip', userId: user.id, bookId: 'book_1', planId: 'plan_1', sessionNumber: 1,
      title: 'Scheduled session', status: 'scheduled', reviewStatus: 'approved', scheduledAt: new Date().toISOString(),
      quiz: [{ id: 'bq1', question: 'Q?', expected: 'A' }], concepts: [], remindersSent: 0,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    };
    state.jobs.book_deliver = job('book_deliver', 'deliver_book_session', user.id, { sessionId: 'session_skip' });
    state.jobs.book_reminder = job('book_reminder', 'send_book_reminder', user.id, { sessionId: 'session_skip' });
    state.jobs.book_reinforcement = job('book_reinforcement', 'send_book_reinforcement', user.id, { sessionId: 'session_skip', questionId: 'bq1' });
  });
  assert.equal((await books.skipSession(user.id, 'session_skip')).status, 'skipped');
  assert.equal((await books.skipSession(user.id, 'session_skip')).status, 'skipped');
  for (const id of ['book_deliver', 'book_reminder', 'book_reinforcement']) assert.equal(store.snapshot().jobs[id].status, 'cancelled');
  await assert.rejects(books.completeSession(user.id, 'session_skip'), /Only a delivered book session/);

  await store.transaction((state) => {
    state.bookSessions.session_done = {
      id: 'session_done', userId: user.id, bookId: 'book_1', planId: 'plan_1', sessionNumber: 2, sessionType: 'core',
      title: 'Delivered session', status: 'delivered', reviewStatus: 'approved', deliveredAt: new Date().toISOString(),
      quiz: [{ id: 'bq2', question: 'Q?', expected: 'A' }], concepts: [], remindersSent: 0,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    };
  });
  assert.equal((await books.completeSession(user.id, 'session_done')).status, 'completed');
  const count = Object.values(store.snapshot().jobs).filter((item) => item.type === 'send_book_reinforcement' && item.payload?.sessionId === 'session_done').length;
  await books.completeSession(user.id, 'session_done');
  assert.equal(Object.values(store.snapshot().jobs).filter((item) => item.type === 'send_book_reinforcement' && item.payload?.sessionId === 'session_done').length, count);
});

test('delivery uses a signed private link and does not send the same lesson twice', async () => {
  const { store, learning, books, config, user } = await fixture();
  let sends = 0;
  let deliveredUrl = '';
  const telegram = {
    enabled: true,
    async sendLesson(_user, _lesson, accessUrl) { sends += 1; deliveredUrl = accessUrl; return { status: 'sent' }; }
  };
  const whatsapp = { enabled: false };
  const delivery = new DeliveryService({ store, learning, books, telegram, whatsapp, config, logger });
  await store.transaction((state) => {
    state.users[user.id].channels.telegram = true;
    state.users[user.id].telegramChatId = '123';
    state.lessons.lesson_delivery = {
      id: 'lesson_delivery', userId: user.id, title: 'Private delivery', status: 'scheduled', reviewStatus: 'approved',
      scheduledAt: new Date().toISOString(), quiz: [], remindersSent: 0, content: {}, sources: [],
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    };
  });
  await delivery.deliverLesson('lesson_delivery');
  await delivery.deliverLesson('lesson_delivery');
  assert.equal(sends, 1);
  assert.match(deliveredUrl, /^https:\/\/learn\.example\.com\/u\//);
  assert.equal(store.snapshot().lessons.lesson_delivery.status, 'delivered');
  assert.equal(Object.values(store.snapshot().messages).filter((message) => message.lessonId === 'lesson_delivery' && message.kind === 'lesson').length, 1);
});

test('scheduler recovers a stale running job and completes it once', async () => {
  const { store, learning, books, user } = await fixture();
  let notices = 0;
  const delivery = {
    async sendSystemNotice(targetUserId, payload) {
      assert.equal(targetUserId, user.id);
      assert.equal(payload.title, 'Recovered notice');
      notices += 1;
      return { web: { status: 'available' } };
    }
  };
  await store.transaction((state) => {
    const stale = job('stale_notice', 'send_system_notice', user.id, { title: 'Recovered notice', message: 'Continue.' }, 'running');
    stale.attempts = 1;
    stale.startedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    state.jobs[stale.id] = stale;
  });
  const scheduler = new Scheduler({ store, learning, books, delivery, config: { enabled: true, pollSeconds: 30, maxAttempts: 3, runTimeoutMinutes: 15, unfinishedItemLimit: 3 }, logger });
  await scheduler.tick();
  const recovered = store.snapshot().jobs.stale_notice;
  assert.equal(recovered.status, 'completed');
  assert.equal(recovered.attempts, 2);
  assert.equal(notices, 1);
});


test('learner can approve a held book session and force scheduling without administrator settings', async () => {
  const { store, books, user } = await fixture();
  await store.transaction((state) => {
    state.users[user.id].automation.autoScheduleApproved = false;
    state.books.book_review = { id: 'book_review', userId: user.id, title: 'Review Book', status: 'active', updatedAt: new Date().toISOString() };
    state.bookSessions.session_review = {
      id: 'session_review', userId: user.id, bookId: 'book_review', planId: 'plan_review', sessionNumber: 1,
      title: 'Held session', status: 'draft', reviewStatus: 'needs_review', quality: { issues: ['Check one item'], warnings: [] },
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    };
  });
  const { user: other } = await (async () => {
    const created = await books.store.transaction((state) => {
      const other = { ...state.users[user.id], id: 'user_other', name: 'Other', accessVersion: 1 };
      state.users[other.id] = other;
      return { user: other };
    });
    return created;
  })();
  await assert.rejects(books.reviewSession('session_review', 'approve', '', { userId: other.id, forceSchedule: true }), /Book session not found/);
  const result = await books.reviewSession('session_review', 'approve', 'Accepted by learner', { userId: user.id, forceSchedule: true });
  assert.equal(result.status, 'scheduled');
  assert.ok(Object.values(store.snapshot().jobs).some((item) => item.type === 'deliver_book_session' && item.payload?.sessionId === 'session_review'));
});

test('Telegram review notice exposes learner actions and approval schedules the lesson', async () => {
  const { store, learning, books, user } = await fixture();
  await store.transaction((state) => {
    state.users[user.id].channels.telegram = true;
    state.users[user.id].telegramChatId = '555';
    state.users[user.id].automation.autoScheduleApproved = false;
    state.lessons.lesson_telegram = {
      id: 'lesson_telegram', userId: user.id, title: 'Telegram held lesson', status: 'draft', reviewStatus: 'needs_review',
      quality: { issues: ['Review item'], warnings: [] }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    };
  });
  const sent = [];
  const answers = [];
  const telegram = new TelegramChannel({ config: { enabled: true, botToken: 'test', appSecret: 'lifecycle-secret-lifecycle-secret' }, store, learning, books, logger });
  telegram.sendText = async (chatId, text, replyMarkup) => { sent.push({ chatId, text, replyMarkup }); return { ok: true }; };
  telegram.api = async (method, payload) => { answers.push({ method, payload }); return { ok: true }; };
  await telegram.sendSystemNotice(store.snapshot().users[user.id], {
    kind: 'lesson_review_required', title: 'Lesson needs your review', message: 'Choose an action.',
    actionUrl: learning.accessUrl(store.snapshot().users[user.id]), actionLabel: 'Open dashboard', metadata: { lessonId: 'lesson_telegram' }
  });
  assert.equal(sent[0].chatId, '555');
  assert.ok(sent[0].replyMarkup.inline_keyboard.flat().some((button) => button.callback_data === 'lapprove:lesson_telegram'));
  await telegram.handleUpdate({ callback_query: { id: 'callback_1', data: 'lapprove:lesson_telegram', message: { chat: { id: 555 } } } });
  assert.equal(store.snapshot().lessons.lesson_telegram.status, 'scheduled');
  assert.ok(answers.some((entry) => entry.method === 'answerCallbackQuery'));
});

test('rescheduling is rejected once delivery is already running', async () => {
  const { store, learning, books, user } = await fixture();
  const originalRunAt = new Date(Date.now() + 60_000).toISOString();
  await store.transaction((state) => {
    state.books.book_running = { id: 'book_running', userId: user.id, title: 'Running Book', status: 'active', updatedAt: new Date().toISOString() };
    state.lessons.lesson_running = {
      id: 'lesson_running', userId: user.id, title: 'Running lesson', status: 'scheduled', reviewStatus: 'approved',
      scheduledAt: originalRunAt, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    };
    state.bookSessions.session_running = {
      id: 'session_running', userId: user.id, bookId: 'book_running', title: 'Running session', sessionNumber: 1,
      status: 'scheduled', reviewStatus: 'approved', scheduledAt: originalRunAt,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    };
    state.jobs.lesson_running_job = job('lesson_running_job', 'deliver_lesson', user.id, { lessonId: 'lesson_running' }, 'running');
    state.jobs.book_running_job = job('book_running_job', 'deliver_book_session', user.id, { sessionId: 'session_running' }, 'running');
  });

  await assert.rejects(learning.scheduleLesson('lesson_running', new Date(Date.now() + 120_000).toISOString()), /already in progress/);
  await assert.rejects(books.scheduleSession('session_running', new Date(Date.now() + 120_000).toISOString()), /already in progress/);
  const state = store.snapshot();
  assert.equal(state.lessons.lesson_running.scheduledAt, originalRunAt);
  assert.equal(state.bookSessions.session_running.scheduledAt, originalRunAt);
});

test('startup reconciliation repairs orphaned automation and restores learner notices', async () => {
  const { store, learning, books, config, user } = await fixture();
  const now = new Date().toISOString();
  await store.transaction((state) => {
    state.plans.plan_draft = { id: 'plan_draft', userId: user.id, status: 'draft', createdAt: now, updatedAt: now };
    state.lessons.lesson_orphan = {
      id: 'lesson_orphan', userId: user.id, title: 'Approved orphan', status: 'approved', reviewStatus: 'approved',
      createdAt: now, updatedAt: now
    };
    state.lessons.lesson_held_legacy = {
      id: 'lesson_held_legacy', userId: user.id, title: 'Legacy hold', status: 'draft', reviewStatus: 'needs_review',
      quality: { issues: ['Check support'], warnings: [] }, createdAt: now, updatedAt: now
    };
    state.books.book_reconcile = {
      id: 'book_reconcile', userId: user.id, title: 'Reconcile Book', status: 'awaiting_plan_approval', activePlanId: 'bookplan_reconcile',
      createdAt: now, updatedAt: now
    };
    state.bookSessions.session_orphan = {
      id: 'session_orphan', userId: user.id, bookId: 'book_reconcile', title: 'Scheduled orphan', sessionNumber: 1,
      status: 'scheduled', reviewStatus: 'approved', scheduledAt: now, createdAt: now, updatedAt: now
    };
    state.businessTasks.task_waiting = {
      id: 'task_waiting', type: 'lesson', userId: user.id, status: 'pending', priority: 80,
      payload: {}, createdAt: now, updatedAt: now
    };
  });

  const result = await reconcileWorkflow({ store, learning, books, config: { ...config, businessActions: { ...config.businessActions, customGptUrl: 'https://chatgpt.com/g/test' } }, logger });
  const state = store.snapshot();
  assert.equal(result.lessonsScheduled, 1);
  assert.equal(result.bookSessionsScheduled, 1);
  assert.ok(Object.values(state.jobs).some((item) => item.type === 'deliver_lesson' && item.payload?.lessonId === 'lesson_orphan'));
  assert.ok(Object.values(state.jobs).some((item) => item.type === 'deliver_book_session' && item.payload?.sessionId === 'session_orphan'));
  const noticeKinds = Object.values(state.jobs).filter((item) => item.type === 'send_system_notice').map((item) => item.payload?.kind);
  assert.ok(noticeKinds.includes('lesson_review_required'));
  assert.ok(noticeKinds.includes('weekly_plan_approval_required'));
  assert.ok(noticeKinds.includes('book_plan_approval_required'));
  assert.ok(noticeKinds.includes('processing_required'));
});
