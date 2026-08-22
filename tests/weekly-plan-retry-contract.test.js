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

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'knowledge-pilot-weekly-plan-'));
  const config = {
    appBaseUrl: 'https://learn.example.com',
    appSecret: 'weekly-plan-test-secret-weekly-plan-test-secret',
    defaultLanguage: 'en',
    defaultTimezone: 'Europe/Brussels',
    cardDir: path.join(root, 'cards'),
    ai: { provider: 'chatgpt_business' },
    whatsapp: { dedicatedNumber: '' }
  };
  const store = await new JsonStore({
    stateFile: path.join(root, 'state.json'),
    backupDir: path.join(root, 'backups'),
    retention: 3,
    logger
  }).init();
  const research = { async fetchUrls(sources) { return sources; } };
  const learning = new LearningService({
    store,
    ai: new AiService(config.ai, logger),
    research,
    config,
    logger
  });
  const businessActions = new BusinessActionsService({
    store,
    research,
    learning,
    config: {
      enabled: true,
      apiKey: 'action-test-key',
      autoScheduleApproved: true,
      autoScheduleDelayMinutes: 2,
      cardDir: config.cardDir
    },
    logger
  });
  learning.setBusinessActions(businessActions);
  const { user } = await learning.createUser({ name: 'Earth Science Learner', language: 'en' });
  await learning.updateOnboarding(user.id, {
    interests: ['Earth science', 'Astronomy'],
    rankedTopics: ['Earth science', 'Astronomy'],
    avoidedTopics: [],
    exampleQuestions: ['How does Earth change over time?'],
    preferredWindows: ['morning'],
    knowledgeRatings: {},
    channels: { web: true }
  });
  const queued = await learning.generateWeeklyPlan(user.id);
  return { store, businessActions, taskId: queued.task.id };
}

function semanticallyPrimaryButNonCanonicalPlan() {
  return {
    primarySubject: 'Earth science',
    secondarySubjects: ['Astronomy'],
    rationale: 'Build a coherent Earth-science sequence with one complementary astronomy lesson.',
    proposals: [
      {
        title: 'Plate tectonics in motion',
        question: 'Why do continents move?',
        topic: 'Plate tectonics',
        reason: 'Core Earth-science mechanism.',
        estimatedMinutes: 8
      },
      {
        title: 'The rock cycle as a system',
        question: 'How does one rock type become another?',
        topic: 'Rock cycle',
        reason: 'Connects surface and interior Earth processes.',
        estimatedMinutes: 8
      },
      {
        title: 'Reading the night sky',
        question: 'Why do stars appear to move across the sky?',
        topic: 'Astronomy',
        reason: 'Secondary exposure.',
        estimatedMinutes: 7
      }
    ],
    verification: {
      learnerFit: 'Matches the learner priorities.',
      noveltyCheck: 'Introduces new material.',
      coherenceCheck: 'Two Earth-science lessons plus one secondary lesson.'
    }
  };
}

test('weekly-plan task context states the validator topic allocation rule explicitly', async () => {
  const { businessActions, taskId } = await fixture();
  const context = businessActions.getTask(taskId);
  assert.match(
    context.taskInstructions,
    /proposal\.topic.*exactly equal.*primarySubject/i,
    'the dynamic task contract must tell the agent how the validator recognizes primary-subject proposals'
  );
});

test('a retryable weekly-plan validation rejection cannot be converted into permanent failure', async () => {
  const { store, businessActions, taskId } = await fixture();

  await assert.rejects(
    businessActions.submit(taskId, semanticallyPrimaryButNonCanonicalPlan()),
    /At least two of three proposals must advance the primary subject/
  );

  let task = store.snapshot().businessTasks[taskId];
  assert.equal(task.status, 'pending');
  assert.equal(task.lastSubmissionError?.retryable, true);

  await businessActions.fail(
    taskId,
    'The validator did not recognize at least two proposals as advancing the primary subject.'
  );

  task = store.snapshot().businessTasks[taskId];
  assert.equal(task.status, 'pending');
  assert.equal(task.lastSubmissionError?.retryable, true);
});
