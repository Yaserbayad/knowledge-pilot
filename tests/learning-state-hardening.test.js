import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { JsonStore } from '../src/store.js';
import { LearningService } from '../src/services/learning.js';

const logger = { debug() {}, info() {}, warn() {}, error() {} };

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'knowledge-pilot-learning-state-'));
  const store = await new JsonStore({ stateFile: path.join(root, 'state.json'), backupDir: path.join(root, 'backups'), logger }).init();
  const config = {
    appBaseUrl: 'http://127.0.0.1:3100', appSecret: 'x'.repeat(32), defaultLanguage: 'en', defaultTimezone: 'Europe/Brussels',
    ai: { provider: 'mock' }, businessActions: { autoScheduleApproved: false }, automation: { notifyActionRequired: false },
    whatsapp: { dedicatedNumber: '' }
  };
  const service = new LearningService({ store, ai: {}, research: {}, config, logger });
  return { store, service };
}

test('completed lesson progress cannot regress below 100 percent', async () => {
  const { store, service } = await fixture();
  const now = new Date().toISOString();
  await store.transaction((state) => {
    state.users.user_1 = { id: 'user_1', accessVersion: 1, automation: {} };
    state.lessons.lesson_1 = {
      id: 'lesson_1', userId: 'user_1', status: 'completed', resumePercent: 100,
      experience: { revision: 1, currentSectionId: 'complete' }, completedAt: now, createdAt: now, updatedAt: now
    };
  });

  const result = await service.updateResume('user_1', 'lesson_1', 20);
  assert.equal(result.status, 'completed');
  assert.equal(result.resumePercent, 100);
});

test('approving a replacement plan retires pending or claimed work from superseded plans', async () => {
  const { store, service } = await fixture();
  const now = new Date().toISOString();
  await store.transaction((state) => {
    state.users.user_1 = { id: 'user_1', accessVersion: 1, automation: {} };
    state.plans.plan_old = { id: 'plan_old', userId: 'user_1', status: 'approved', proposals: [], createdAt: now, updatedAt: now };
    state.plans.plan_new = { id: 'plan_new', userId: 'user_1', status: 'draft', proposals: [], createdAt: now, updatedAt: now };
    state.jobs.job_old = { id: 'job_old', userId: 'user_1', type: 'generate_lesson', status: 'pending', payload: { planId: 'plan_old' }, runAt: now, createdAt: now, updatedAt: now };
    state.businessTasks.task_pending = { id: 'task_pending', userId: 'user_1', type: 'lesson', status: 'pending', payload: { planId: 'plan_old' }, createdAt: now, updatedAt: now };
    state.businessTasks.task_claimed = { id: 'task_claimed', userId: 'user_1', type: 'lesson', status: 'claimed', payload: { planId: 'plan_old' }, createdAt: now, updatedAt: now };
  });

  await service.approvePlan('user_1', 'plan_new');
  const state = store.snapshot();
  assert.equal(state.plans.plan_old.status, 'superseded');
  assert.equal(state.jobs.job_old.status, 'cancelled');
  assert.equal(state.businessTasks.task_pending.status, 'cancelled');
  assert.equal(state.businessTasks.task_claimed.status, 'cancelled');
});
