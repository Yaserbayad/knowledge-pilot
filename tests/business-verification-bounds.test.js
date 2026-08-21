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
const huge = 'v'.repeat(50_000);

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'knowledge-pilot-business-verification-'));
  const config = {
    appBaseUrl: 'https://learn.example.com',
    appSecret: 'business-verification-secret-business-verification',
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
    config: { enabled: true, apiKey: 'verification-test-key', cardDir: config.cardDir },
    logger
  });
  learning.setBusinessActions(businessActions);
  return { store, learning, businessActions };
}

test('weekly-plan verification is stored as a bounded allowlisted summary', async () => {
  const { store, learning, businessActions } = await fixture();
  const { user } = await learning.createUser({ name: 'Verification Learner', language: 'en' });
  const queued = await businessActions.queueWeeklyPlan(user.id);

  const output = await businessActions.submit(queued.task.id, {
    primarySubject: 'Critical thinking',
    secondarySubjects: ['History'],
    rationale: 'Build evidence assessment.',
    proposals: [
      { title: 'Evidence quality', question: 'How should evidence change confidence?', topic: 'Critical thinking', reason: 'Foundation', estimatedMinutes: 8 },
      { title: 'Corroboration', question: 'How do independent sources change confidence?', topic: 'Critical thinking', reason: 'Application', estimatedMinutes: 8 },
      { title: 'Historical evidence', question: 'How do historians compare sources?', topic: 'History', reason: 'Transfer', estimatedMinutes: 8 }
    ],
    verification: {
      learnerFit: huge,
      noveltyCheck: huge,
      coherenceCheck: huge,
      injected: { nested: huge, more: Array(100).fill(huge) }
    }
  });

  const stored = store.snapshot().plans[output.plan.id].businessVerification;
  assert.deepEqual(Object.keys(stored).sort(), ['coherenceCheck', 'learnerFit', 'noveltyCheck']);
  assert.ok(stored.learnerFit.length <= 2000);
  assert.ok(stored.noveltyCheck.length <= 2000);
  assert.ok(stored.coherenceCheck.length <= 2000);
  assert.ok(JSON.stringify(stored).length <= 6500);
});
