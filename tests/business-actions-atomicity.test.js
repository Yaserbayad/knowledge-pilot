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
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'knowledge-pilot-business-atomic-'));
  const config = {
    appBaseUrl: 'https://learn.example.com',
    appSecret: 'business-atomic-secret-business-atomic-secret',
    defaultLanguage: 'en',
    defaultTimezone: 'Europe/Brussels',
    cardDir: path.join(root, 'cards'),
    ai: { provider: 'chatgpt_business' },
    whatsapp: { dedicatedNumber: '' }
  };
  const store = await new JsonStore({ stateFile: path.join(root, 'state.json'), backupDir: path.join(root, 'backups'), retention: 3, logger }).init();
  const research = {
    async fetchUrls(sources) {
      return sources.map((source) => ({
        ...source,
        domain: new URL(source.url).hostname,
        accessedAt: new Date().toISOString(),
        fetchStatus: 'ok',
        excerpt: 'Verified source excerpt with enough material to support the submitted claims.'
      }));
    }
  };
  const learning = new LearningService({ store, ai: new AiService(config.ai, logger), research, config, logger });
  const businessActions = new BusinessActionsService({
    store, research, learning,
    config: { enabled: true, apiKey: 'atomic-test-key', autoScheduleApproved: true, autoScheduleDelayMinutes: 0, cardDir: config.cardDir },
    logger
  });
  learning.setBusinessActions(businessActions);
  return { root, store, learning, businessActions };
}

function validPlanResult() {
  return {
    primarySubject: 'Critical thinking',
    secondarySubjects: ['History'],
    rationale: 'Build evidence assessment while preserving interdisciplinary transfer.',
    proposals: [
      { title: 'Evidence quality', question: 'How should evidence change confidence?', topic: 'Critical thinking', reason: 'Foundation', estimatedMinutes: 8 },
      { title: 'Historical corroboration', question: 'How do historians verify events?', topic: 'History', reason: 'Transfer', estimatedMinutes: 7 },
      { title: 'Cognitive bias', question: 'Why does repetition feel true?', topic: 'Critical thinking', reason: 'Application', estimatedMinutes: 9 }
    ],
    verification: { learnerFit: 'Matches declared priorities.', noveltyCheck: 'No duplicate lesson.', coherenceCheck: 'Progresses from method to transfer.' }
  };
}

function validLessonResult() {
  return {
    title: 'Why evidence quality changes what we should believe',
    question: 'How should a careful thinker compare strong and weak evidence?',
    topic: 'Critical thinking', language: 'en', estimatedMinutes: 8, difficulty: 'moderate',
    content: {
      hook: 'Two confident claims can sound equally convincing while resting on evidence of radically different quality.',
      coreExplanation: 'Evidence quality depends on how directly a source observes the question, how well alternatives are controlled, and whether independent investigators can reproduce or corroborate the result.',
      context: 'Scientific and historical reasoning use different methods for separating testimony, observation, controlled comparison, and independent confirmation.',
      examples: ['A controlled comparison can distinguish a treatment effect from ordinary recovery.'],
      perspectives: ['Experimental disciplines emphasize controlled comparison.'],
      misconceptions: ['More sources do not help when all repeat the same original source.'],
      practicalMeaning: 'Identify the original evidence and ask whether independent evidence points in the same direction.',
      knowledgeConnection: 'This connects evidence quality to calibrated confidence rather than absolute certainty.',
      keyIdeas: ['Judge evidence by method.', 'Independent corroboration matters.', 'Confidence should match evidence strength.'],
      practicalTakeaway: 'Write down the evidence, strongest alternative explanation, and one independent check.',
      reflectionPrompt: 'Which recent belief would change most if its evidence source were weaker than assumed?',
      nextTeaser: 'Next, examine why repeated exposure can make unsupported claims feel true.'
    },
    quiz: [
      { type: 'recall', question: 'What makes corroboration independent?', expected: 'It must not depend on the same original source.' },
      { type: 'application', question: 'How should you assess a popular health claim?', expected: 'Trace the evidence, assess method, alternatives, and independent replication.' }
    ],
    sources: [
      { id: 's1', title: 'Government evidence guide', url: 'https://evidence.example.gov/guide', sourceType: 'official', claimsSupported: ['evidence quality'] },
      { id: 's2', title: 'University research methods', url: 'https://methods.example.edu/research', sourceType: 'textbook', claimsSupported: ['corroboration'] }
    ],
    claims: [
      { text: 'Controlled comparisons help distinguish causal effects from alternatives.', sourceIds: ['s1', 's2'] },
      { text: 'Independent corroboration is stronger than repeated reporting from one source.', sourceIds: ['s1', 's2'] }
    ],
    verification: {
      researchApproach: 'Compared independent official and academic explanations.',
      consensusStatus: 'established', disagreements: [], uncertainty: [],
      adversarialReview: { issuesFound: ['The first draft overstated certainty.'], correctionsMade: ['Reframed conclusions proportionally.'], unresolvedIssues: [] },
      finalAudit: { accuracyPassed: true, sourceTraceabilityPassed: true, completenessPassed: true, learnerFitPassed: true, noFabricationPassed: true }
    }
  };
}

async function createFollowUpContext({ store, learning, businessActions, origin = 'telegram' }) {
  const { user } = await learning.createUser({ name: 'Follow-up Learner', language: 'en' });
  const lessonId = 'lesson_followup';
  const interactionId = 'interaction_followup';
  await store.transaction((state) => {
    state.lessons[lessonId] = { id: lessonId, userId: user.id, title: 'Evidence', topic: 'Critical thinking', status: 'delivered', sources: [] };
    state.interactions[interactionId] = {
      id: interactionId, userId: user.id, lessonId, type: 'follow_up', question: 'What changes if the evidence is indirect?',
      answer: '', status: 'pending_business', origin, createdAt: new Date().toISOString()
    };
  });
  const queued = await businessActions.queueFollowUp(user.id, lessonId, interactionId, origin);
  return { user, lessonId, interactionId, taskId: queued.task.id };
}

test('an ambiguous persistence acknowledgement never downgrades an already accepted Business result', async () => {
  const { store, learning, businessActions } = await fixture();
  const { user } = await learning.createUser({ name: 'Atomic Plan Learner', language: 'en' });
  const queued = await businessActions.queueWeeklyPlan(user.id);
  const originalTransaction = store.transaction.bind(store);
  let injected = false;
  store.transaction = async (mutator) => {
    const value = await originalTransaction(mutator);
    const task = store.snapshot().businessTasks[queued.task.id];
    if (!injected && task?.status === 'completed') {
      injected = true;
      throw new Error('simulated ambiguous persistence acknowledgement');
    }
    return value;
  };

  await assert.rejects(businessActions.submit(queued.task.id, validPlanResult()), /ambiguous persistence acknowledgement/);
  const state = store.snapshot();
  assert.equal(state.businessTasks[queued.task.id].status, 'completed');
  assert.equal(Object.values(state.plans).filter((plan) => plan.generatedBy === 'chatgpt_business_action').length, 1);
});

test('accepted lesson and delivery job are committed without a fallible secondary scheduling transaction', async () => {
  const { store, learning, businessActions } = await fixture();
  const { user } = await learning.createUser({ name: 'Atomic Lesson Learner', language: 'en' });
  const proposal = { id: 'proposal_atomic', title: 'Evidence quality', question: 'How strong is the evidence?', topic: 'Critical thinking', reason: 'Foundation', estimatedMinutes: 8, order: 1 };
  await store.transaction((state) => {
    state.plans.plan_atomic = { id: 'plan_atomic', userId: user.id, status: 'approved', primarySubject: 'Critical thinking', secondarySubjects: [], rationale: 'Evidence assessment.', proposals: [proposal], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  });
  const queued = await businessActions.queueLesson(user.id, 'plan_atomic', proposal.id);
  learning.scheduleLesson = async () => { throw new Error('secondary scheduler must not be called after acceptance'); };

  const output = await businessActions.submit(queued.task.id, validLessonResult());
  const state = store.snapshot();
  assert.equal(state.businessTasks[queued.task.id].status, 'completed');
  assert.equal(output.lesson.status, 'scheduled');
  assert.equal(Object.values(state.jobs).filter((job) => job.type === 'deliver_lesson' && job.payload?.lessonId === output.lesson.id && job.status === 'pending').length, 1);
});

test('direct-response job and follow-up acceptance share the same task-terminal transaction', async () => {
  const { store, learning, businessActions } = await fixture();
  const { interactionId, taskId } = await createFollowUpContext({ store, learning, businessActions, origin: 'telegram' });
  const originalTransaction = store.transaction.bind(store);
  store.transaction = (mutator) => originalTransaction((state) => {
    const before = new Set(Object.keys(state.jobs || {}));
    const value = mutator(state);
    const addedDirect = Object.values(state.jobs || {}).some((job) => !before.has(job.id) && job.type === 'send_direct_response');
    if (addedDirect && ['pending', 'claimed'].includes(state.businessTasks[taskId]?.status)) {
      throw new Error('direct response was queued before the Business task became terminal');
    }
    return value;
  });

  const output = await businessActions.submit(taskId, {
    answer: 'Indirect evidence can still be useful, but confidence should reflect the extra inferential steps and alternative explanations.',
    confidence: 'medium', needsNewLesson: false, suggestedTopic: '', sourceUrls: ['https://example.org/evidence'],
    verification: { accuracyChecked: true, noFabricationPassed: true }
  });
  const state = store.snapshot();
  assert.equal(output.interaction.id, interactionId);
  assert.equal(state.businessTasks[taskId].status, 'completed');
  assert.equal(Object.values(state.jobs).filter((job) => job.type === 'send_direct_response' && job.payload?.interactionId === interactionId).length, 1);
});

test('follow-up result rejects non-HTTPS source URLs before accepting the interaction', async () => {
  const { store, learning, businessActions } = await fixture();
  const { interactionId, taskId } = await createFollowUpContext({ store, learning, businessActions, origin: 'web' });
  await assert.rejects(businessActions.submit(taskId, {
    answer: 'Indirect evidence can still be useful, but confidence should reflect the additional inference and uncertainty.',
    confidence: 'medium', needsNewLesson: false, suggestedTopic: '', sourceUrls: ['http://example.org/insecure'],
    verification: { accuracyChecked: true, noFabricationPassed: true }
  }), /HTTPS/i);
  const state = store.snapshot();
  assert.equal(state.businessTasks[taskId].status, 'pending');
  assert.equal(state.interactions[interactionId].status, 'pending_business');
});
