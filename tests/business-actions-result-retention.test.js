import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { JsonStore } from '../src/store.js';
import { AiService } from '../src/services/ai.js';
import { LearningService } from '../src/services/learning.js';
import { BookLearningService } from '../src/services/books.js';
import { BusinessActionsService } from '../src/services/business-actions.js';

const logger = { debug() {}, info() {}, warn() {}, error() {} };

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'knowledge-pilot-result-retention-'));
  const config = {
    appBaseUrl: 'https://learn.example.com',
    appSecret: 'result-retention-secret-result-retention-secret',
    defaultLanguage: 'en',
    defaultTimezone: 'Europe/Brussels',
    cardDir: path.join(root, 'cards'),
    ai: { provider: 'chatgpt_business' },
    whatsapp: { dedicatedNumber: '' }
  };
  const store = await new JsonStore({
    stateFile: path.join(root, 'state.json'),
    backupDir: path.join(root, 'backups'),
    retention: 2,
    logger
  }).init();
  const research = {
    async fetchUrls(sources) {
      return sources.map((source) => ({
        ...source,
        domain: new URL(source.url).hostname,
        accessedAt: new Date().toISOString(),
        fetchStatus: 'ok',
        excerpt: 'Verified source excerpt.'
      }));
    }
  };
  const learning = new LearningService({ store, ai: new AiService(config.ai, logger), research, config, logger });
  const books = new BookLearningService({ store, config, logger, bookFiles: { async save() {}, async chunk() {} } });
  const actions = new BusinessActionsService({
    store, research, learning, books,
    config: { enabled: true, apiKey: 'result-retention-action-key', autoScheduleApproved: true, cardDir: config.cardDir },
    logger
  });
  learning.setBusinessActions(actions);
  books.setBusinessActions(actions);
  return { store, learning, books, actions };
}

test('completed book-analysis task keeps only compact acceptance metadata, not the full accepted payload', async () => {
  const { store, learning, books, actions } = await fixture();
  const { user } = await learning.createUser({ name: 'Retention Learner', language: 'en' });
  const added = await books.addBook(user.id, { title: 'A Bounded Book', author: 'Example Author' });
  const largeDescription = `bounded-marker-${'x'.repeat(100_000)}`;

  const output = await actions.submit(added.task.id, {
    contractVersion: 'book-analysis.v2',
    metadata: {
      title: 'A Bounded Book',
      author: 'Example Author',
      language: 'en',
      bookType: 'nonfiction',
      description: largeDescription
    },
    sourceAssessment: {
      quality: 'limited',
      fullTextAvailable: false,
      limitations: ['A full lawful text is not available.'],
      sufficientForDetailedPlan: false
    },
    plan: {
      rationale: 'Detailed planning is deferred until stronger source material is available.',
      recommendedWeeks: 1,
      sessionsPerWeek: 1,
      typicalMinutes: 8,
      difficulty: 'moderate',
      learningGoals: [],
      reviewCheckpoints: [],
      finalSynthesis: '',
      sessions: []
    },
    sources: [
      { id: 's1', title: 'Publisher source', url: 'https://publisher.example.org/book', sourceType: 'publisher', claimsSupported: ['metadata'] },
      { id: 's2', title: 'Library source', url: 'https://library.example.edu/book', sourceType: 'library', claimsSupported: ['metadata'] }
    ],
    verification: {
      researchApproach: 'Compared two independent public sources.',
      editionConfidence: 'low',
      sourceLimitations: ['No full text.'],
      adversarialReview: { issuesFound: [], correctionsMade: [], unresolvedIssues: [] },
      finalAudit: {
        accuracyPassed: true,
        sourceTraceabilityPassed: true,
        completenessPassed: true,
        learnerFitPassed: true,
        noFabricationPassed: true
      }
    }
  });

  assert.equal(output.book.status, 'source_required');
  const task = store.snapshot().businessTasks[added.task.id];
  assert.equal(task.status, 'completed');
  assert.equal(task.resultRef, output.book.id);
  assert.ok(task.acceptedSubmission?.payloadHash);
  assert.equal(Object.hasOwn(task, 'acceptedResult'), false);
  assert.equal(JSON.stringify(task).includes('bounded-marker-'), false);
  assert.ok(JSON.stringify(task).length < 20_000);
});
