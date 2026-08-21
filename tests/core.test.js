import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { JsonStore } from '../src/store.js';
import { createUserToken, verifyUserToken, createBindingToken, verifyBindingToken } from '../src/auth.js';
import { AiService } from '../src/services/ai.js';
import { ResearchService } from '../src/services/research.js';
import { LearningService } from '../src/services/learning.js';

const logger = { debug() {}, info() {}, warn() {}, error() {} };

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'knowledge-pilot-'));
  const config = {
    appBaseUrl: 'http://127.0.0.1:3100', appSecret: 'test-secret-test-secret-test-secret',
    defaultLanguage: 'en', defaultTimezone: 'Europe/Brussels',
    cardDir: path.join(root, 'cards'),
    ai: { provider: 'mock' },
    research: { searxngUrl: '', maxResults: 6, fetchTimeoutMs: 1000 },
    whatsapp: { dedicatedNumber: '' }
  };
  const store = await new JsonStore({ stateFile: path.join(root, 'state.json'), backupDir: path.join(root, 'backups'), retention: 3, logger }).init();
  const ai = new AiService(config.ai, logger);
  const research = new ResearchService(config.research, logger);
  const learning = new LearningService({ store, ai, research, config, logger });
  return { root, config, store, learning };
}

test('signed user access tokens verify and reject tampering', () => {
  const token = createUserToken('secret', 'user_123', 2);
  assert.deepEqual(verifyUserToken('secret', token), { userId: 'user_123', accessVersion: 2 });
  assert.equal(verifyUserToken('secret', `${token}x`), null);
});


test('Telegram binding tokens fit deep-link constraints and verify', () => {
  const userId = 'user_123e4567e89b12d3a456426614174000';
  const expiresAt = Date.now() + 60 * 60 * 1000;
  const token = createBindingToken('secret', userId, 'telegram', expiresAt);
  assert.ok(token.length <= 64);
  assert.match(token, /^[A-Za-z0-9_-]+$/);
  const result = verifyBindingToken('secret', token, 'telegram');
  assert.equal(result.userId, userId);
  assert.equal(result.channel, 'telegram');
  assert.equal(verifyBindingToken('wrong-secret', token, 'telegram'), null);
  assert.equal(verifyBindingToken('secret', token, 'whatsapp'), null);
});

test('JSON store persists transactions and creates bounded backups', async () => {
  const { root, store } = await fixture();
  await store.transaction((state) => { state.settings.example = 'saved'; });
  const reloaded = await new JsonStore({ stateFile: path.join(root, 'state.json'), backupDir: path.join(root, 'backups'), retention: 2, logger }).init();
  assert.equal(reloaded.read((s) => s.settings.example), 'saved');
  await reloaded.backup('one');
  await reloaded.backup('two');
  await reloaded.backup('three');
  assert.equal((await reloaded.listBackups()).length, 2);
});

test('mock learning workflow creates plan, lesson, review, completion and progress', async () => {
  const { learning, store } = await fixture();
  const { user } = await learning.createUser({ name: 'Tester', language: 'en' });
  await learning.updateOnboarding(user.id, {
    interests: ['Science', 'History'], rankedTopics: ['Critical thinking', 'History'], avoidedTopics: [],
    exampleQuestions: ['Why do people misjudge probability?'], preferredWindows: ['morning'],
    knowledgeRatings: { 'Critical thinking': 'beginner' }, channels: { web: true }
  });
  const plan = await learning.generateWeeklyPlan(user.id);
  assert.equal(plan.proposals.length, 3);
  await learning.approvePlan(user.id, plan.id);
  const lesson = await learning.generateLesson(user.id, plan.id, plan.proposals[0].id);
  assert.equal(lesson.reviewStatus, 'needs_review');
  assert.equal(lesson.content.keyIdeas.length, 3);
  await learning.reviewLesson(lesson.id, 'approve', 'Test approval');
  await learning.scheduleLesson(lesson.id, new Date().toISOString());
  await learning.markDelivered(lesson.id, { web: { status: 'available' } });
  await learning.completeLesson(user.id, lesson.id);
  const progress = learning.progress(user.id);
  assert.equal(progress.completed, 1);
  assert.equal(progress.completionRate, 100);
  assert.ok(store.read((s) => Object.values(s.jobs).some((job) => job.type === 'send_reinforcement')));
});
