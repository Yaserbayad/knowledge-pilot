import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { JsonStore } from '../src/store.js';
import { BookLearningService } from '../src/services/books.js';
import { BusinessActionsService } from '../src/services/business-actions.js';

const logger = { debug() {}, info() {}, warn() {}, error() {} };

const readingDocument = {
  version: 1,
  defaultLanguage: 'en',
  hero: { title: { en: 'Context and testimony', ar: 'السياق والشهادة' }, readTimeMinutes: 8 },
  sections: [{
    id: 'opening', title: { en: 'Separate the layers', ar: 'افصل بين الطبقات' }, optional: false,
    blocks: [{ id: 'idea-1', type: 'idea', text: { en: 'Testimony and general theory are different evidence types.', ar: 'الشهادة والنظرية العامة نوعان مختلفان من الأدلة.' } }]
  }],
  glossary: [],
  ending: { title: { en: 'Keep the distinction', ar: 'احتفظ بالتمييز' }, text: { en: 'Respect testimony while testing broader claims.', ar: 'احترم الشهادة واختبر الادعاءات الأوسع.' } }
};

function verification() {
  return {
    researchApproach: 'Compared publisher and independent academic context.',
    adversarialReview: { issuesFound: [], correctionsMade: [], unresolvedIssues: [] },
    finalAudit: { accuracyPassed: true, sourceTraceabilityPassed: true, completenessPassed: true, learnerFitPassed: true, noFabricationPassed: true },
    authorFaithfulness: 'The author account is explained before criticism.',
    criticismBasis: 'Independent academic commentary.',
    sourceLimitations: []
  };
}

test('verified Business book-session submission persists ReadingDocument v1 beside the established book delivery model', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'knowledge-pilot-reading-book-business-'));
  const config = {
    appBaseUrl: 'https://learn.example.com', appSecret: 'reader-book-business-secret-reader-book', defaultLanguage: 'en', defaultTimezone: 'Europe/Brussels',
    cardDir: path.join(root, 'cards'), businessActions: { autoScheduleApproved: false }, whatsapp: { dedicatedNumber: '' }
  };
  const store = await new JsonStore({ stateFile: path.join(root, 'state.json'), backupDir: path.join(root, 'backups'), retention: 2, logger }).init();
  await store.transaction((state) => {
    state.users.reader = {
      id: 'reader', name: 'Reader', language: 'en', timezone: 'Europe/Brussels', interests: [], rankedTopics: [], avoidedTopics: [], exampleQuestions: [], knowledgeRatings: {}, mastery: {}, preferredWindows: [],
      automation: { autoScheduleApproved: false, autoScheduleDelayMinutes: 0, notifyActionRequired: false }, channels: { web: true, telegram: false, whatsapp: false }
    };
    state.books.book_1 = {
      id: 'book_1', userId: 'reader', title: 'A Serious Book', author: 'Author', language: 'en', status: 'active', activePlanId: 'book_plan_1', ownedCopy: null,
      concepts: [], topicLinkSuggestions: [], approvedTopicLinks: [], progressPercent: 0
    };
    state.bookPlans.book_plan_1 = {
      id: 'book_plan_1', userId: 'reader', bookId: 'book_1', status: 'approved', sessionsPerWeek: 1, finalSynthesis: 'Synthesize the work.',
      sessions: [{ id: 'item_1', number: 1, title: 'Context and testimony', scope: 'Historical and autobiographical setting.', chapterRefs: ['Part One'], pageRefs: [], goals: ['Separate testimony from theory'], isCore: true, estimatedMinutes: 8 }]
    };
    state.businessTasks.task_1 = {
      id: 'task_1', type: 'book_session', userId: 'reader', payload: { bookId: 'book_1', planId: 'book_plan_1', sessionNumber: 1 }, dedupeKey: 'book-session:test', priority: 80,
      status: 'claimed', claimedAt: new Date().toISOString(), completedAt: null, attempts: 0, resultRef: null, error: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    };
  });

  const research = {
    async fetchUrls(sources) {
      return sources.map((source) => ({ ...source, domain: new URL(source.url).hostname, accessedAt: new Date().toISOString(), fetchStatus: 'ok', excerpt: 'Verified source excerpt.' }));
    }
  };
  const books = new BookLearningService({ store, config, logger, bookFiles: { async chunk() {} } });
  const service = new BusinessActionsService({
    store, research, learning: { accessUrl() { return 'https://learn.example.com/app'; } }, books,
    config: { enabled: true, apiKey: 'test', readingDocumentContract: 'v1', autoScheduleApproved: false, cardDir: config.cardDir }, logger
  });

  const depth = 'A careful interpretation distinguishes what an author directly observed from the meaning assigned to those events. It asks which conclusions can be generalized, what independent evidence would be required, how historical circumstances shaped the account, and where later readers may import assumptions the text does not establish. This preserves respect for testimony while maintaining a rigorous standard for broader claims.';
  const result = {
    title: 'Context and testimony', language: 'en', estimatedMinutes: 8, difficulty: 'moderate', scope: 'Historical and autobiographical setting.', chapterRefs: ['Part One'], pageRefs: [],
    readingDocument,
    content: {
      hook: 'How can a personal account inform us without automatically proving a general theory?',
      summary: `This session separates autobiographical testimony from broader interpretation. ${depth} ${depth}`,
      importantDetails: ['The account is personal testimony.', 'Broader claims should be assessed separately.'],
      context: `Historical context changes how the testimony should be interpreted. ${depth}`,
      criticalAssessment: `The testimony can be important while general claims still require independent evidence. ${depth}`,
      practicalApplication: `Separate observation, interpretation, and generalization when reading memoir-based arguments. ${depth}`,
      quotations: [],
      connections: ['Connects directly to evidence quality and testimonial knowledge.'],
      keyIdeas: ['Testimony and theory are different evidence types.', 'Context changes interpretation.', 'General claims need broader support.'],
      reflectionPrompt: 'Which parts of an argument are direct testimony and which are later interpretation?',
      nextPreview: 'Next, examine how the author turns experience into a wider model.'
    },
    quiz: [
      { type: 'recall', question: 'What layers should be separated?', expected: 'Observation or testimony, interpretation, and general theory.' },
      { type: 'application', question: 'How should another memoir-based claim be assessed?', expected: 'Respect testimony and seek broader independent evidence for general claims.' }
    ],
    concepts: [{ name: 'Testimonial evidence', explanation: 'First-person evidence about lived experience.', topicConnection: 'Critical thinking' }],
    topicLinkSuggestions: [{ concept: 'Testimonial evidence', topic: 'Evidence quality', reason: 'Useful cross-link.' }],
    sources: [
      { id: 's1', title: 'Publisher context', url: 'https://publisher.example.org/book', sourceType: 'publisher', claimsSupported: ['context'] },
      { id: 's2', title: 'Academic review', url: 'https://review.example.edu/book', sourceType: 'academic_review', claimsSupported: ['criticism'] }
    ],
    claims: [
      { text: 'The work combines testimony and interpretation.', sourceIds: ['s1', 's2'] },
      { text: 'General claims need evidence beyond one testimony.', sourceIds: ['s2'] }
    ],
    verification: verification()
  };

  const output = await service.submit('task_1', result);
  assert.equal(output.kind, 'book_session');
  assert.equal(output.session.generatedBy, 'chatgpt_business_action');
  assert.deepEqual(output.session.readingDocument, readingDocument);
  assert.equal(output.session.content.keyIdeas.length, 3, 'legacy book/channel content must remain intact');
  assert.deepEqual(store.snapshot().bookSessions[output.session.id].readingDocument, readingDocument);
  assert.equal(store.snapshot().businessTasks.task_1.status, 'completed');
});
