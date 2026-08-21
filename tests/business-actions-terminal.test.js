import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { JsonStore } from '../src/store.js';
import { AiService } from '../src/services/ai.js';
import { LearningService } from '../src/services/learning.js';
import { BusinessActionsService } from '../src/services/business-actions.js';

const logger = { debug() {}, info() {}, warn() {}, error() {} };

test('a late failure report cannot downgrade an already completed Business task', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'knowledge-pilot-business-terminal-'));
  const config = {
    appBaseUrl: 'https://learn.example.com',
    appSecret: 'business-terminal-secret-business-terminal',
    defaultLanguage: 'en',
    defaultTimezone: 'Europe/Brussels',
    cardDir: path.join(root, 'cards'),
    ai: { provider: 'chatgpt_business' },
    whatsapp: { dedicatedNumber: '' }
  };
  const store = await new JsonStore({ stateFile: path.join(root, 'state.json'), backupDir: path.join(root, 'backups'), retention: 2, logger }).init();
  const research = { async fetchUrls(sources) { return sources; } };
  const learning = new LearningService({ store, ai: new AiService(config.ai, logger), research, config, logger });
  const businessActions = new BusinessActionsService({
    store, research, learning,
    config: { enabled: true, apiKey: 'terminal-test-key', cardDir: config.cardDir },
    logger
  });
  learning.setBusinessActions(businessActions);

  const { user } = await learning.createUser({ name: 'Terminal Learner' });
  const queued = await businessActions.queueWeeklyPlan(user.id);
  await store.transaction((state) => {
    const task = state.businessTasks[queued.task.id];
    task.status = 'completed';
    task.completedAt = new Date().toISOString();
    task.resultRef = 'plan_accepted';
    task.error = null;
    task.updatedAt = task.completedAt;
  });

  const result = await businessActions.fail(queued.task.id, 'late duplicated failure callback');
  assert.equal(result.status, 'completed');
  assert.equal(result.resultRef, 'plan_accepted');
  assert.equal(result.error, null);

  const persisted = store.snapshot().businessTasks[queued.task.id];
  assert.equal(persisted.status, 'completed');
  assert.equal(persisted.resultRef, 'plan_accepted');
  assert.equal(persisted.error, null);
});
