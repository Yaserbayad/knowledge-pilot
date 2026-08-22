import test from 'node:test';
import assert from 'node:assert/strict';
import { BusinessActionsService } from '../src/services/business-actions.js';

const logger = { debug() {}, info() {}, warn() {}, error() {} };

function serviceFor(type, { marked = true } = {}) {
  const user = {
    id: 'reader', name: 'Reader', language: 'en', timezone: 'Europe/Brussels',
    interests: [], rankedTopics: [], avoidedTopics: [], exampleQuestions: [], knowledgeRatings: {}, mastery: {}, preferredWindows: [],
    automation: { notifyActionRequired: false }
  };
  const basePayload = type === 'lesson'
    ? { planId: 'plan_1', proposalId: 'proposal_1' }
    : { bookId: 'book_1', planId: 'book_plan_1', sessionNumber: 1 };
  const task = {
    id: 'task_1', type, userId: user.id, status: 'pending', priority: 80,
    payload: { ...basePayload, ...(marked ? { readingDocumentContract: 'v1' } : {}) },
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
  const service = new BusinessActionsService({
    store,
    research: {},
    learning: { accessUrl() { return 'https://learn.example.com/app'; } },
    books: {},
    config: { enabled: true, apiKey: 'test-key', readingDocumentContract: 'v1', notifyPendingTasks: false },
    logger
  });
  return { service, state };
}

for (const type of ['lesson', 'book_session']) {
  test(`${type} task marked v1 requires one bounded English/Arabic ReadingDocument`, async () => {
    const { service } = serviceFor(type);
    const context = service.getTask('task_1');
    assert.equal(context.readingDocumentContract?.version, 1);
    assert.deepEqual(context.readingDocumentContract?.languages, ['en', 'ar']);
    assert.match(context.taskInstructions, /English.*Arabic|Arabic.*English/i);
    assert.match(context.taskInstructions, /Telegram\/WhatsApp/);
    assert.ok(context.resultContract.readingDocument, 'readingDocument must be declared in the result contract');

    await assert.rejects(
      service.submit('task_1', { verification: { finalAudit: {} }, sources: [] }),
      (error) => error.code === 'INVALID_READING_DOCUMENT'
    );
  });
}

test('new lesson tasks are marked v1 while an existing pre-upgrade task remains on its legacy contract', async () => {
  const fresh = serviceFor('lesson');
  delete fresh.state.businessTasks.task_1;
  const queued = await fresh.service.queue('lesson', 'reader', { planId: 'plan_1', proposalId: 'proposal_1' }, { dedupeKey: 'new-reader-contract' });
  assert.equal(queued.task.payload.readingDocumentContract, 'v1');
  assert.equal(fresh.service.getTask(queued.task.id).readingDocumentContract?.version, 1);

  const legacy = serviceFor('lesson', { marked: false });
  const legacyContext = legacy.service.getTask('task_1');
  assert.equal(legacyContext.readingDocumentContract, undefined);
  assert.equal(legacyContext.resultContract.readingDocument, undefined);
  await assert.rejects(
    legacy.service.submit('task_1', { verification: { finalAudit: {} }, sources: [] }),
    (error) => error.code !== 'INVALID_READING_DOCUMENT'
  );
});
