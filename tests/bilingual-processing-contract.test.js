import test from 'node:test';
import assert from 'node:assert/strict';
import { BusinessActionsService } from '../src/services/business-actions.js';

const logger = { debug() {}, info() {}, warn() {}, error() {} };

function serviceFor(type) {
  const user = {
    id: 'reader', name: 'Reader', language: 'en', timezone: 'Europe/Brussels',
    interests: [], rankedTopics: [], avoidedTopics: [], exampleQuestions: [], knowledgeRatings: {}, mastery: {}, preferredWindows: []
  };
  const task = {
    id: 'task_1', type, userId: user.id, status: 'pending', priority: 80,
    payload: type === 'lesson'
      ? { planId: 'plan_1', proposalId: 'proposal_1' }
      : { bookId: 'book_1', planId: 'book_plan_1', sessionNumber: 1 },
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
  };
  const state = {
    users: { [user.id]: user },
    businessTasks: { [task.id]: task },
    plans: {
      plan_1: {
        id: 'plan_1', primarySubject: 'Economics', secondarySubjects: [], rationale: '',
        proposals: [{ id: 'proposal_1', title: 'Incentives', question: 'Why incentives?', topic: 'Economics', estimatedMinutes: 8 }]
      }
    },
    lessons: {}, interactions: {}, jobs: {}, messages: {},
    books: { book_1: { id: 'book_1', userId: user.id, title: 'Thinking in Systems', language: 'en', sessionPreference: 'balanced', activePlanId: 'book_plan_1' } },
    bookPlans: {
      book_plan_1: {
        id: 'book_plan_1', bookId: 'book_1', status: 'approved', finalSynthesis: 'Synthesize the book.',
        sessions: [{ id: 'item_1', number: 1, title: 'Feedback loops', scope: 'Feedback loops', chapterRefs: [], pageRefs: [], goals: [], estimatedMinutes: 8 }]
      }
    },
    bookSessions: {}
  };
  const store = {
    read(fn) { return fn(state); },
    transaction(fn) { return Promise.resolve(fn(state)); }
  };
  return new BusinessActionsService({
    store,
    research: {},
    learning: { accessUrl() { return 'https://learn.example.com/app'; } },
    books: {},
    config: { enabled: true, apiKey: 'test-key', readingDocumentContract: 'v1' },
    logger
  });
}

for (const type of ['lesson', 'book_session']) {
  test(`${type} task contract requires one bounded English/Arabic ReadingDocument v1`, async () => {
    const service = serviceFor(type);
    const context = service.getTask('task_1');
    assert.equal(context.readingDocumentContract?.version, 1);
    assert.deepEqual(context.readingDocumentContract?.languages, ['en', 'ar']);
    assert.match(context.taskInstructions, /English.*Arabic|Arabic.*English/i);
    assert.ok(context.resultContract.readingDocument, 'readingDocument must be declared in the result contract');

    await assert.rejects(
      service.submit('task_1', { verification: { finalAudit: {} }, sources: [] }),
      (error) => error.code === 'INVALID_READING_DOCUMENT'
    );
  });
}
