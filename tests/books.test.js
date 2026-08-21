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
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'knowledge-pilot-books-'));
  const config = {
    appBaseUrl: 'https://learn.example.com', appSecret: 'book-test-secret-book-test-secret',
    defaultLanguage: 'en', defaultTimezone: 'Europe/Brussels', cardDir: path.join(root, 'cards'),
    ai: { provider: 'chatgpt_business' }, whatsapp: { dedicatedNumber: '' }
  };
  const store = await new JsonStore({ stateFile: path.join(root, 'state.json'), backupDir: path.join(root, 'backups'), retention: 3, logger }).init();
  const research = {
    async fetchUrls(sources) {
      return sources.map((source) => ({ ...source, domain: new URL(source.url).hostname, accessedAt: new Date().toISOString(), fetchStatus: 'ok', excerpt: 'Verified source excerpt.' }));
    }
  };
  const learning = new LearningService({ store, ai: new AiService(config.ai, logger), research, config, logger });
  const books = new BookLearningService({ store, config, logger, bookFiles: { async save() {}, async chunk() {} } });
  const actions = new BusinessActionsService({ store, research, learning, books, config: { enabled: true, apiKey: 'book-action-key', autoScheduleApproved: true, autoScheduleDelayMinutes: 1, cardDir: config.cardDir }, logger });
  learning.setBusinessActions(actions);
  books.setBusinessActions(actions);
  return { root, config, store, learning, books, actions };
}

function verification() {
  return {
    researchApproach: 'Compared publisher, author, library, and independent critical sources.',
    adversarialReview: { issuesFound: ['Initial structure was too compressed.'], correctionsMade: ['Added context and separated criticism.'], unresolvedIssues: [] },
    finalAudit: { accuracyPassed: true, sourceTraceabilityPassed: true, completenessPassed: true, learnerFitPassed: true, noFabricationPassed: true }
  };
}

test('owned files can be added or replaced in every lifecycle state without resetting active progress', async () => {
  const { learning, books, store } = await fixture();
  const { user } = await learning.createUser({ name: 'Source Owner', language: 'en' });
  let uploadNumber = 0;
  const removed = [];
  books.bookFiles = {
    async save({ filename, buffer }) {
      uploadNumber += 1;
      return {
        filename,
        format: 'txt',
        sizeBytes: buffer.length,
        extractedCharacters: buffer.length,
        uploadedAt: new Date().toISOString(),
        originalPath: `user/book/original-${uploadNumber}.txt`,
        textPath: `user/book/source-${uploadNumber}.txt`
      };
    },
    async removeSource(source) { removed.push(source.originalPath); }
  };

  const active = await books.addBook(user.id, { title: 'Active Book', author: 'Writer' });
  await store.transaction((state) => {
    state.businessTasks[active.task.id].status = 'completed';
    state.books[active.book.id].status = 'active';
    state.books[active.book.id].progressPercent = 42;
    state.books[active.book.id].ownedCopy = {
      filename: 'old.txt', format: 'txt', sizeBytes: 300, extractedCharacters: 300,
      uploadedAt: new Date().toISOString(), originalPath: 'user/book/old.txt', textPath: 'user/book/old-source.txt'
    };
  });

  const activeUpload = await books.uploadOwnedCopy(user.id, active.book.id, 'new.txt', Buffer.from('New source text. '.repeat(30)));
  assert.equal(activeUpload.queued, false);
  assert.equal(activeUpload.trackPreserved, true);
  assert.equal(activeUpload.replaced, true);
  assert.equal(books.detail(user.id, active.book.id).book.status, 'active');
  assert.equal(books.detail(user.id, active.book.id).book.progressPercent, 42);
  assert.ok(removed.includes('user/book/old.txt'));

  const waiting = await books.addBook(user.id, { title: 'Waiting Book', author: 'Writer' });
  await store.transaction((state) => {
    state.books[waiting.book.id].status = 'source_required';
    state.books[waiting.book.id].ownedCopy = {
      filename: 'limited.txt', format: 'txt', sizeBytes: 250, extractedCharacters: 250,
      uploadedAt: new Date().toISOString(), originalPath: 'user/book/limited.txt', textPath: 'user/book/limited-source.txt'
    };
  });

  const waitingUpload = await books.uploadOwnedCopy(user.id, waiting.book.id, 'complete.txt', Buffer.from('Complete source text. '.repeat(30)));
  assert.equal(waitingUpload.queued, true);
  assert.equal(waitingUpload.trackPreserved, false);
  assert.notEqual(waitingUpload.task.id, waiting.task.id);
  assert.equal(store.read((state) => state.businessTasks[waiting.task.id].status), 'superseded');
  assert.equal(books.detail(user.id, waiting.book.id).book.status, 'queued_analysis');
});

test('book workflow identifies, plans, approves, generates and completes a separate book track', async () => {
  const { learning, books, actions, store } = await fixture();
  const { user } = await learning.createUser({ name: 'Book Learner', language: 'en' });
  await learning.updateOnboarding(user.id, { interests: ['History'], rankedTopics: ['History'], avoidedTopics: [], exampleQuestions: [], preferredWindows: ['evening'], knowledgeRatings: {}, channels: { web: true } });

  const added = await books.addBook(user.id, { title: "Man's Search for Meaning", author: 'Viktor Frankl', language: 'en' });
  assert.equal(added.queued, true);
  const analysisTask = added.task;
  const analysis = await actions.submit(analysisTask.id, {
    metadata: { title: "Man's Search for Meaning", author: 'Viktor E. Frankl', isbn: '', edition: 'English edition', language: 'en', publishedYear: 1946, publisher: 'Beacon Press', bookType: 'psychology', coverUrl: 'https://publisher.example.org/cover.jpg', description: 'A memoir and psychological argument about meaning under suffering.' },
    sourceAssessment: { quality: 'high', fullTextAvailable: false, limitations: ['Page references vary by edition.'], sufficientForDetailedPlan: true },
    plan: {
      rationale: 'Move from historical context to logotherapy, criticism, and application.', recommendedWeeks: 2, sessionsPerWeek: 3, typicalMinutes: 8, difficulty: 'moderate',
      learningGoals: ['Understand the memoir context', 'Explain logotherapy', 'Assess the book critically'], reviewCheckpoints: ['After session 2'], finalSynthesis: 'Synthesize the memoir, theory, criticism, and practical implications.',
      sessions: [
        { title: 'Context and captivity', scope: 'Historical and autobiographical setting.', chapterRefs: ['Part One'], pageRefs: [], goals: ['Understand context'], isCore: true, estimatedMinutes: 8 },
        { title: 'Meaning and survival', scope: 'The central observations about meaning.', chapterRefs: ['Part One'], pageRefs: [], goals: ['Explain the core claim'], isCore: true, estimatedMinutes: 8 },
        { title: 'Logotherapy', scope: 'The book’s therapeutic framework.', chapterRefs: ['Part Two'], pageRefs: [], goals: ['Understand logotherapy'], isCore: true, estimatedMinutes: 8 },
        { title: 'Criticism and application', scope: 'Evidence, limits, and practical use.', chapterRefs: ['Part Two'], pageRefs: [], goals: ['Evaluate and apply'], isCore: true, estimatedMinutes: 9 }
      ]
    },
    sources: [
      { id: 's1', title: 'Publisher page', url: 'https://publisher.example.org/frankl', sourceType: 'publisher', claimsSupported: ['metadata'] },
      { id: 's2', title: 'University review', url: 'https://university.example.edu/frankl-review', sourceType: 'academic_review', claimsSupported: ['critical context'] }
    ],
    verification: { ...verification(), editionConfidence: 'medium' }
  });
  assert.equal(analysis.book.status, 'awaiting_plan_approval');
  assert.equal(analysis.plan.sessions.length, 4);

  await books.approvePlan(user.id, analysis.book.id, { targetWeeks: 2, sessionsPerWeek: 3 });
  const queuedSession = await books.generateSession(user.id, analysis.book.id, 1);
  assert.equal(queuedSession.queued, true);
  const depthParagraph = 'A careful interpretation distinguishes what the author personally observed from the meaning later assigned to those events. It also asks which conclusions can be generalized, what independent evidence would be required, how historical circumstances shaped the account, and where later readers may import assumptions that the text itself does not establish. This distinction preserves respect for testimony while maintaining a rigorous standard for broader psychological claims.';
  const sessionOutput = await actions.submit(queuedSession.task.id, {
    title: 'Context and captivity', language: 'en', estimatedMinutes: 8, difficulty: 'moderate', scope: 'Historical and autobiographical setting.', chapterRefs: ['Part One'], pageRefs: [],
    content: {
      hook: 'How can a memoir convey both personal testimony and a general psychological claim?',
      summary: `This session explains the historical setting and the author’s account while distinguishing testimony from later theoretical interpretation. ${depthParagraph} ${depthParagraph}`,
      importantDetails: ['The narrative is autobiographical.', 'The later theory should be assessed separately from the memoir.'],
      context: `The work emerged from postwar Europe and later editions changed its framing and audience. ${depthParagraph}`,
      criticalAssessment: `The testimony is historically important, but broad psychological conclusions require evidence beyond one memoir. ${depthParagraph}`,
      practicalApplication: `Separate lived experience, interpretation, and generalizable evidence when reading memoir-based arguments. ${depthParagraph}`,
      quotations: [{ text: 'A brief attributed phrase.', location: 'Part One' }],
      connections: ['Connects to evidence quality and testimonial knowledge.'],
      keyIdeas: ['Testimony and theory are different evidence types.', 'Historical context changes interpretation.', 'General claims need broader support.'],
      reflectionPrompt: 'Which parts of the argument are testimony, interpretation, and general theory?',
      nextPreview: 'The next session examines how meaning functions in the author’s survival narrative.'
    },
    quiz: [
      { type: 'recall', question: 'What three layers should be separated?', expected: 'Testimony, interpretation, and general theory.' },
      { type: 'application', question: 'How would you assess another memoir-based claim?', expected: 'Respect the testimony while seeking broader evidence for general claims.' }
    ],
    concepts: [{ name: 'Testimonial evidence', explanation: 'First-person evidence about lived experience.', topicConnection: 'Critical thinking' }],
    topicLinkSuggestions: [{ concept: 'Testimonial evidence', topic: 'Evidence quality', reason: 'Useful cross-link to critical reasoning.' }],
    sources: [
      { id: 's1', title: 'Publisher page', url: 'https://publisher.example.org/frankl', sourceType: 'publisher', claimsSupported: ['book context'] },
      { id: 's2', title: 'University review', url: 'https://university.example.edu/frankl-review', sourceType: 'academic_review', claimsSupported: ['criticism'] }
    ],
    claims: [
      { text: 'The work combines memoir and psychological interpretation.', sourceIds: ['s1', 's2'] },
      { text: 'General psychological claims require broader evidence than one testimony.', sourceIds: ['s2'] }
    ],
    verification: { ...verification(), authorFaithfulness: 'The author’s account is explained before criticism.', criticismBasis: 'Independent academic commentary.', sourceLimitations: [] }
  });
  assert.equal(sessionOutput.session.reviewStatus, 'approved');
  assert.ok(store.read((state) => Object.values(state.jobs).some((job) => job.type === 'deliver_book_session')));

  await books.markDelivered(sessionOutput.session.id, { web: { status: 'available' } });
  await books.completeSession(user.id, sessionOutput.session.id);
  let detail = books.detail(user.id, analysis.book.id);
  assert.equal(detail.book.concepts[0].mastery, 'understood');
  const link = detail.book.topicLinkSuggestions[0];
  await books.reviewTopicLink(user.id, analysis.book.id, link.id, 'approve');
  detail = books.detail(user.id, analysis.book.id);
  assert.equal(detail.book.topicLinkSuggestions[0].status, 'approved');
  assert.equal(detail.book.approvedTopicLinks.length, 1);

  const beforePace = detail.plan.sessionsPerWeek;
  await books.control(user.id, analysis.book.id, 'speed_up');
  detail = books.detail(user.id, analysis.book.id);
  assert.equal(detail.plan.sessionsPerWeek, Math.min(7, beforePace + 1));
  await books.control(user.id, analysis.book.id, 'pause');
  assert.equal(books.detail(user.id, analysis.book.id).book.status, 'paused');
  await books.control(user.id, analysis.book.id, 'resume');
  assert.equal(books.detail(user.id, analysis.book.id).book.status, 'active');

  const progress = books.progress(user.id);
  assert.equal(progress.completedSessions, 1);
  assert.equal(progress.totalBooks, 1);
});
