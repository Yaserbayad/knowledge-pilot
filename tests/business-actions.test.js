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
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'knowledge-pilot-business-'));
  const config = {
    appBaseUrl: 'https://learn.example.com', appSecret: 'business-test-secret-business-test-secret',
    defaultLanguage: 'en', defaultTimezone: 'Europe/Brussels', cardDir: path.join(root, 'cards'),
    ai: { provider: 'chatgpt_business' }, whatsapp: { dedicatedNumber: '' }
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
    config: { enabled: true, apiKey: 'action-test-key', autoScheduleApproved: true, autoScheduleDelayMinutes: 2, cardDir: config.cardDir },
    logger
  });
  learning.setBusinessActions(businessActions);
  return { root, config, store, learning, businessActions };
}

function validLessonResult() {
  return {
    title: 'Why evidence quality changes what we should believe',
    question: 'How should a careful thinker compare strong and weak evidence?',
    topic: 'Critical thinking',
    language: 'en',
    estimatedMinutes: 8,
    difficulty: 'moderate',
    content: {
      hook: 'Two confident claims can sound equally convincing while resting on evidence of radically different quality.',
      coreExplanation: 'Evidence quality depends on how directly a source observes the question, how well alternative explanations are controlled, and whether independent investigators can reproduce or corroborate the result.',
      context: 'Modern scientific and historical reasoning developed methods for separating testimony, observation, controlled comparison, and repeated independent confirmation.',
      examples: ['A controlled comparison can distinguish a treatment effect from ordinary recovery.', 'Independent archives can corroborate a historical event without relying on one witness.'],
      perspectives: ['Experimental disciplines emphasize controlled comparison.', 'Historical disciplines often rely on converging independent records.'],
      misconceptions: ['A prestigious source can still make a weakly supported claim.', 'More sources do not help when all repeat the same original source.'],
      practicalMeaning: 'Before accepting an important conclusion, identify the original evidence and ask whether independent evidence points in the same direction.',
      knowledgeConnection: 'This extends the learner’s earlier interest in probabilistic reasoning by showing how evidence should change confidence rather than produce absolute certainty.',
      keyIdeas: ['Judge evidence by method, not confidence.', 'Independent corroboration matters.', 'Conclusions should match the strength of evidence.'],
      practicalTakeaway: 'For any major claim, write down the original evidence, the strongest alternative explanation, and one independent check.',
      reflectionPrompt: 'Which claim in your recent decisions would change most if its evidence source were weaker than you assumed?',
      nextTeaser: 'The next lesson can examine why repeated exposure makes unsupported claims feel true.'
    },
    quiz: [
      { type: 'recall', question: 'What makes corroboration independent?', expected: 'It must not merely repeat or depend on the same original source.' },
      { type: 'application', question: 'How would you assess a popular health claim?', expected: 'Trace the original evidence, assess the method, compare alternatives, and seek independent replication.' }
    ],
    sources: [
      { id: 's1', title: 'Government evidence guide', url: 'https://evidence.example.gov/guide', sourceType: 'official', claimsSupported: ['evidence quality'] },
      { id: 's2', title: 'University research methods', url: 'https://methods.example.edu/research', sourceType: 'textbook', claimsSupported: ['corroboration'] }
    ],
    claims: [
      { text: 'Controlled comparisons help distinguish causal effects from alternative explanations.', sourceIds: ['s1', 's2'] },
      { text: 'Independent corroboration is stronger than repeated reporting from one source.', sourceIds: ['s1', 's2'] }
    ],
    verification: {
      researchApproach: 'Compared independent official and academic explanations of evidence assessment.',
      consensusStatus: 'established', disagreements: [], uncertainty: [],
      adversarialReview: { issuesFound: ['The first draft overstated certainty.'], correctionsMade: ['Reframed conclusions in proportional terms.'], unresolvedIssues: [] },
      finalAudit: { accuracyPassed: true, sourceTraceabilityPassed: true, completenessPassed: true, learnerFitPassed: true, noFabricationPassed: true }
    }
  };
}

test('ChatGPT Business queue creates, processes, validates and schedules plan and lesson work', async () => {
  const { learning, businessActions, store } = await fixture();
  const { user } = await learning.createUser({ name: 'Business Learner', language: 'en' });
  await learning.updateOnboarding(user.id, {
    interests: ['Critical thinking', 'History'], rankedTopics: ['Critical thinking', 'History'], avoidedTopics: [],
    exampleQuestions: ['How should evidence change confidence?'], preferredWindows: ['morning'], knowledgeRatings: {}, channels: { web: true }
  });

  const queuedPlan = await learning.generateWeeklyPlan(user.id);
  assert.equal(queuedPlan.queued, true);
  const planTask = queuedPlan.task;
  assert.equal(businessActions.getTask(planTask.id).task.type, 'weekly_plan');

  const planOutput = await businessActions.submit(planTask.id, {
    primarySubject: 'Critical thinking', secondarySubjects: ['History'], rationale: 'Build evidence assessment while preserving interdisciplinary transfer.',
    proposals: [
      { title: 'Evidence quality', question: 'How should evidence change confidence?', topic: 'Critical thinking', reason: 'Foundation', estimatedMinutes: 8 },
      { title: 'Historical corroboration', question: 'How do historians verify events?', topic: 'History', reason: 'Transfer', estimatedMinutes: 7 },
      { title: 'Cognitive bias', question: 'Why does repetition feel true?', topic: 'Critical thinking', reason: 'Application', estimatedMinutes: 9 }
    ],
    verification: { learnerFit: 'Matches declared priorities.', noveltyCheck: 'No duplicate lesson.', coherenceCheck: 'Progresses from method to transfer.' }
  });
  assert.equal(planOutput.plan.proposals.length, 3);

  await learning.approvePlan(user.id, planOutput.plan.id);
  const firstProposal = planOutput.plan.proposals[0];
  const queuedLesson = await learning.generateLesson(user.id, planOutput.plan.id, firstProposal.id);
  assert.equal(queuedLesson.queued, true);

  const lessonOutput = await businessActions.submit(queuedLesson.task.id, validLessonResult());
  assert.equal(lessonOutput.lesson.reviewStatus, 'approved');
  assert.equal(lessonOutput.lesson.generatedBy, 'chatgpt_business_action');
  assert.ok(store.read((state) => Object.values(state.jobs).some((job) => job.type === 'deliver_lesson' && job.payload.lessonId === lessonOutput.lesson.id)));
});

test('onboarding starts verified planning once and preserves partial automation changes', async () => {
  const { learning, businessActions, store } = await fixture();
  const { user } = await learning.createUser({ name: 'Automated Learner', language: 'en' });
  assert.equal(user.automation.autoScheduleApproved, true);
  assert.equal(user.automation.autoScheduleDelayMinutes, 2);

  const onboarded = await learning.updateOnboarding(user.id, {
    interests: ['Critical thinking'], rankedTopics: ['Critical thinking'], avoidedTopics: [],
    exampleQuestions: ['How should I test a claim?'], preferredWindows: ['morning'], knowledgeRatings: {},
    channels: { web: true }, automation: { autoScheduleDelayMinutes: 0 }
  });
  assert.equal(onboarded.initialPlanQueued, true);
  assert.equal(onboarded.automation.autoScheduleApproved, true);
  assert.equal(onboarded.automation.autoScheduleDelayMinutes, 0);
  assert.equal(onboarded.automation.notifyActionRequired, true);

  const revised = await learning.updateOnboarding(user.id, { automation: { notifyActionRequired: false } });
  assert.equal(revised.automation.autoScheduleApproved, true);
  assert.equal(revised.automation.autoScheduleDelayMinutes, 0);
  assert.equal(revised.automation.notifyActionRequired, false);
  assert.equal(Object.values(store.snapshot().businessTasks).filter((task) => task.type === 'weekly_plan').length, 1);
  assert.equal(businessActions.list({ status: 'pending' }).length, 1);
});

test('optional failed sources become warnings while validated lesson still auto-schedules', async () => {
  const { learning, businessActions, store } = await fixture();
  const { user } = await learning.createUser({ name: 'Source Warning Learner', language: 'en' });
  await learning.updateOnboarding(user.id, {
    interests: ['Critical thinking'], rankedTopics: ['Critical thinking'], avoidedTopics: [], exampleQuestions: [],
    preferredWindows: ['morning'], knowledgeRatings: {}, channels: { web: true }
  });
  const queuedPlan = await learning.generateWeeklyPlan(user.id);
  const planOutput = await businessActions.submit(queuedPlan.task.id, {
    primarySubject: 'Critical thinking', secondarySubjects: [], rationale: 'Evidence assessment.',
    proposals: [
      { title: 'Evidence quality', question: 'How strong is the evidence?', topic: 'Critical thinking', reason: 'Foundation', estimatedMinutes: 8 },
      { title: 'Alternatives', question: 'What else could explain it?', topic: 'Critical thinking', reason: 'Application', estimatedMinutes: 8 },
      { title: 'Testing', question: 'How can we test it?', topic: 'Critical thinking', reason: 'Practice', estimatedMinutes: 8 }
    ],
    verification: { learnerFit: 'Matched.', noveltyCheck: 'New.', coherenceCheck: 'Coherent.' }
  });
  await learning.approvePlan(user.id, planOutput.plan.id);
  const task = await learning.generateLesson(user.id, planOutput.plan.id, planOutput.plan.proposals[0].id);

  businessActions.research.fetchUrls = async (sources) => sources.map((source) => ({
    ...source,
    domain: new URL(source.url).hostname,
    accessedAt: new Date().toISOString(),
    fetchStatus: source.id === 's3' ? 'failed' : 'ok',
    excerpt: source.id === 's3' ? '' : 'Verified source excerpt with enough material.'
  }));
  const result = validLessonResult();
  result.sources.push({ id: 's3', title: 'Unavailable optional source', url: 'https://optional.example.org/report', sourceType: 'research', claimsSupported: [] });
  const output = await businessActions.submit(task.task.id, result);
  assert.equal(output.lesson.reviewStatus, 'approved');
  assert.match(output.lesson.quality.warnings.join(' '), /optional submitted source/i);
  assert.ok(Object.values(store.snapshot().jobs).some((job) => job.type === 'deliver_lesson' && job.payload.lessonId === output.lesson.id && job.status === 'pending'));
});

test('held lesson is visible to the learner and explicit learner approval schedules it without admin', async () => {
  const { learning, businessActions, store } = await fixture();
  const { user } = await learning.createUser({ name: 'Self Service Learner', language: 'en' });
  await learning.updateOnboarding(user.id, {
    interests: ['Critical thinking'], rankedTopics: ['Critical thinking'], avoidedTopics: [], exampleQuestions: [],
    preferredWindows: ['morning'], knowledgeRatings: {}, channels: { web: true },
    automation: { autoScheduleApproved: false, autoScheduleDelayMinutes: 10, notifyActionRequired: true }
  });
  const queuedPlan = await learning.generateWeeklyPlan(user.id);
  const planOutput = await businessActions.submit(queuedPlan.task.id, {
    primarySubject: 'Critical thinking', secondarySubjects: [], rationale: 'Evidence assessment.',
    proposals: [
      { title: 'Evidence quality', question: 'How strong is the evidence?', topic: 'Critical thinking', reason: 'Foundation', estimatedMinutes: 8 },
      { title: 'Alternatives', question: 'What else could explain it?', topic: 'Critical thinking', reason: 'Application', estimatedMinutes: 8 },
      { title: 'Testing', question: 'How can we test it?', topic: 'Critical thinking', reason: 'Practice', estimatedMinutes: 8 }
    ],
    verification: { learnerFit: 'Matched.', noveltyCheck: 'New.', coherenceCheck: 'Coherent.' }
  });
  await learning.approvePlan(user.id, planOutput.plan.id);
  const queued = await learning.generateLesson(user.id, planOutput.plan.id, planOutput.plan.proposals[0].id);
  const result = validLessonResult();
  result.content.misconceptions = [];
  const output = await businessActions.submit(queued.task.id, result);
  assert.equal(output.lesson.status, 'draft');
  assert.equal(output.lesson.reviewStatus, 'needs_review');
  assert.equal(Object.values(store.snapshot().jobs).some((job) => job.type === 'deliver_lesson' && job.payload?.lessonId === output.lesson.id), false);
  assert.ok(Object.values(store.snapshot().jobs).some((job) => job.type === 'send_system_notice' && job.payload?.metadata?.lessonId === output.lesson.id));

  const { user: other } = await learning.createUser({ name: 'Other Learner' });
  await assert.rejects(learning.reviewLesson(output.lesson.id, 'approve', '', { userId: other.id, forceSchedule: true }), /Lesson not found/);
  const approved = await learning.reviewLesson(output.lesson.id, 'approve', 'Accepted by learner', { userId: user.id, forceSchedule: true });
  assert.equal(approved.status, 'scheduled');
  assert.equal(approved.reviewStatus, 'approved');
  assert.ok(Object.values(store.snapshot().jobs).some((job) => job.type === 'deliver_lesson' && job.payload?.lessonId === output.lesson.id && job.status === 'pending'));
});

test('stale claimed verified-processing tasks are safely reclaimable', async () => {
  const { learning, businessActions, store } = await fixture();
  const { user } = await learning.createUser({ name: 'Recovery Learner' });
  const queued = await businessActions.queueWeeklyPlan(user.id);
  const firstClaim = await businessActions.claim(queued.task.id);
  assert.equal(firstClaim.status, 'claimed');
  await store.transaction((state) => {
    state.businessTasks[queued.task.id].claimedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  });
  const pending = businessActions.list({ status: 'pending' });
  assert.ok(pending.some((task) => task.id === queued.task.id));
  const reclaimed = await businessActions.claim(queued.task.id);
  assert.equal(reclaimed.status, 'claimed');
  assert.equal(reclaimed.attempts, 2);
});
