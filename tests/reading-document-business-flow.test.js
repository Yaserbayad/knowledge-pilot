import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { JsonStore } from '../src/store.js';
import { BusinessActionsService } from '../src/services/business-actions.js';

const logger = { debug() {}, info() {}, warn() {}, error() {} };

const readingDocument = {
  version: 1,
  defaultLanguage: 'en',
  hero: { title: { en: 'How evidence changes belief', ar: 'كيف يغيّر الدليل الاعتقاد' }, readTimeMinutes: 8 },
  sections: [{
    id: 'opening', title: { en: 'Start with the evidence', ar: 'ابدأ بالدليل' }, optional: false,
    blocks: [{ id: 'idea-1', type: 'idea', text: { en: 'Strong claims need strong evidence.', ar: 'تحتاج الادعاءات القوية إلى أدلة قوية.' } }]
  }],
  glossary: [],
  ending: { title: { en: 'Use the model', ar: 'استخدم النموذج' }, text: { en: 'Trace the original evidence.', ar: 'تتبّع الدليل الأصلي.' } }
};

function lessonResult() {
  return {
    title: 'Evidence quality', question: 'How should evidence change confidence?', topic: 'Critical thinking', language: 'en', estimatedMinutes: 8, difficulty: 'moderate',
    readingDocument,
    content: {
      hook: 'Two confident claims can sound identical while resting on radically different evidence.',
      coreExplanation: 'Evidence quality depends on directness, method, alternative explanations, and whether independent investigators can corroborate a result.',
      context: 'Scientific and historical methods distinguish testimony, observation, controlled comparison, and independent confirmation.',
      examples: ['A controlled comparison can separate treatment effects from ordinary recovery.', 'Independent archives can corroborate an event.'],
      perspectives: ['Experimental fields emphasize controlled comparison.', 'Historical fields emphasize converging independent records.'],
      misconceptions: ['Prestige does not guarantee strong evidence.', 'Repeated reports are not independent when they share one source.'],
      practicalMeaning: 'Trace important conclusions back to original evidence and seek an independent check.',
      knowledgeConnection: 'This extends probabilistic reasoning by linking evidence strength to confidence.',
      keyIdeas: ['Judge evidence by method.', 'Independent corroboration matters.', 'Confidence should match evidence strength.'],
      practicalTakeaway: 'For a major claim, identify the evidence, an alternative explanation, and an independent check.',
      reflectionPrompt: 'Which recent belief depends most on a single source?',
      nextTeaser: 'Next: why repetition can make weak claims feel true.'
    },
    quiz: [
      { type: 'recall', question: 'What makes corroboration independent?', expected: 'It does not depend on the same original source.' },
      { type: 'application', question: 'How should you test a popular claim?', expected: 'Trace the original evidence, assess method, alternatives, and independent corroboration.' }
    ],
    sources: [
      { id: 's1', title: 'Evidence guide', url: 'https://evidence.example.gov/guide', sourceType: 'official', claimsSupported: ['evidence quality'] },
      { id: 's2', title: 'Research methods', url: 'https://methods.example.edu/research', sourceType: 'academic', claimsSupported: ['corroboration'] }
    ],
    claims: [
      { text: 'Controlled comparisons help distinguish effects from alternative explanations.', sourceIds: ['s1', 's2'] },
      { text: 'Independent corroboration is stronger than repeated reporting from one source.', sourceIds: ['s1', 's2'] }
    ],
    verification: {
      researchApproach: 'Compared independent official and academic explanations.', consensusStatus: 'established', disagreements: [], uncertainty: [],
      adversarialReview: { issuesFound: [], correctionsMade: [], unresolvedIssues: [] },
      finalAudit: { accuracyPassed: true, sourceTraceabilityPassed: true, completenessPassed: true, learnerFitPassed: true, noFabricationPassed: true }
    }
  };
}

test('verified Business lesson submission validates and persists ReadingDocument v1 without replacing legacy delivery fields', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'knowledge-pilot-reading-business-'));
  const store = await new JsonStore({ stateFile: path.join(root, 'state.json'), backupDir: path.join(root, 'backups'), retention: 2, logger }).init();
  await store.transaction((state) => {
    state.users.reader = {
      id: 'reader', name: 'Reader', language: 'en', timezone: 'Europe/Brussels', interests: [], rankedTopics: [], avoidedTopics: [], exampleQuestions: [], knowledgeRatings: {}, mastery: {}, preferredWindows: [],
      automation: { autoScheduleApproved: false, autoScheduleDelayMinutes: 0, notifyActionRequired: false }, channels: { web: true, telegram: false, whatsapp: false }
    };
    state.plans.plan_1 = {
      id: 'plan_1', userId: 'reader', status: 'approved', primarySubject: 'Critical thinking', secondarySubjects: [], rationale: 'Evidence literacy',
      proposals: [{ id: 'proposal_1', title: 'Evidence quality', question: 'How should evidence change confidence?', topic: 'Critical thinking', reason: 'Foundation', estimatedMinutes: 8 }]
    };
    state.businessTasks.task_1 = {
      id: 'task_1', type: 'lesson', userId: 'reader', payload: { planId: 'plan_1', proposalId: 'proposal_1' }, dedupeKey: 'lesson:test', priority: 80,
      status: 'claimed', claimedAt: new Date().toISOString(), completedAt: null, attempts: 0, resultRef: null, error: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    };
  });

  const research = {
    async fetchUrls(sources) {
      return sources.map((source) => ({ ...source, domain: new URL(source.url).hostname, accessedAt: new Date().toISOString(), fetchStatus: 'ok', excerpt: 'Verified source excerpt sufficient for validation.' }));
    }
  };
  const service = new BusinessActionsService({
    store, research, learning: { accessUrl() { return 'https://learn.example.com/app'; } }, books: null,
    config: { enabled: true, apiKey: 'test', readingDocumentContract: 'v1', autoScheduleApproved: false, cardDir: path.join(root, 'cards') }, logger
  });

  const output = await service.submit('task_1', lessonResult());
  assert.equal(output.kind, 'lesson');
  assert.equal(output.lesson.generatedBy, 'chatgpt_business_action');
  assert.deepEqual(output.lesson.readingDocument, readingDocument);
  assert.equal(output.lesson.content.keyIdeas.length, 3, 'legacy learner/channel content must remain intact');

  const state = store.snapshot();
  assert.deepEqual(state.lessons[output.lesson.id].readingDocument, readingDocument);
  assert.equal(state.businessTasks.task_1.status, 'completed');
});
