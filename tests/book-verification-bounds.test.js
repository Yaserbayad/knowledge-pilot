import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBookAnalysis, normalizeBookSession } from '../src/services/books.js';

const huge = 'b'.repeat(50_000);
const finalAudit = {
  accuracyPassed: true,
  sourceTraceabilityPassed: true,
  completenessPassed: true,
  learnerFitPassed: true,
  noFabricationPassed: true,
  injected: huge
};

test('book-analysis normalization bounds and allowlists verification metadata', () => {
  const raw = {
    metadata: { title: 'Bounded Book', author: 'Author', bookType: 'nonfiction' },
    sourceAssessment: { quality: 'high', fullTextAvailable: false, limitations: [], sufficientForDetailedPlan: true },
    plan: { rationale: 'Plan', recommendedWeeks: 4, sessionsPerWeek: 3, typicalMinutes: 8, sessions: [] },
    verification: {
      researchApproach: huge,
      editionConfidence: 'high',
      sourceLimitations: Array(100).fill(huge),
      adversarialReview: {
        issuesFound: Array(100).fill(huge),
        correctionsMade: Array(100).fill(huge),
        unresolvedIssues: [],
        injected: huge
      },
      finalAudit,
      injected: { nested: huge }
    }
  };
  const book = { title: 'Bounded Book', author: 'Author', language: 'en' };
  const user = { language: 'en' };
  const normalized = normalizeBookAnalysis(raw, book, user);

  assert.strictEqual(normalized.verification, raw.verification);
  assert.deepEqual(Object.keys(raw.verification).sort(), ['adversarialReview', 'editionConfidence', 'finalAudit', 'researchApproach', 'sourceLimitations']);
  assert.ok(raw.verification.researchApproach.length <= 3000);
  assert.equal(raw.verification.sourceLimitations.length, 12);
  assert.ok(raw.verification.sourceLimitations.every((value) => value.length <= 1000));
  assert.equal(raw.verification.adversarialReview.issuesFound.length, 12);
  assert.equal(raw.verification.adversarialReview.correctionsMade.length, 12);
  assert.deepEqual(Object.keys(raw.verification.adversarialReview).sort(), ['correctionsMade', 'issuesFound', 'unresolvedIssues']);
  assert.deepEqual(Object.keys(raw.verification.finalAudit).sort(), ['accuracyPassed', 'completenessPassed', 'learnerFitPassed', 'noFabricationPassed', 'sourceTraceabilityPassed']);
});

test('book-session normalization bounds and allowlists verification metadata', () => {
  const raw = {
    title: 'Session 1', language: 'en', estimatedMinutes: 8, difficulty: 'moderate', scope: 'Scope',
    content: {
      hook: 'A sufficiently detailed hook for this normalization-only test.',
      summary: 'Summary', importantDetails: ['Detail'], context: 'Context', criticalAssessment: 'Assessment', practicalApplication: 'Application',
      quotations: [], connections: [], keyIdeas: ['One', 'Two', 'Three'], reflectionPrompt: 'Reflect', nextPreview: 'Next'
    },
    quiz: [], concepts: [], topicLinkSuggestions: [], claims: [], sources: [],
    verification: {
      researchApproach: huge,
      authorFaithfulness: huge,
      criticismBasis: huge,
      sourceLimitations: Array(100).fill(huge),
      adversarialReview: {
        issuesFound: Array(100).fill(huge),
        correctionsMade: Array(100).fill(huge),
        unresolvedIssues: [],
        injected: huge
      },
      finalAudit,
      injected: huge
    }
  };
  const book = { title: 'Bounded Book', author: 'Author', language: 'en' };
  const planItem = { number: 1, title: 'Session 1', scope: 'Scope', chapterRefs: [], pageRefs: [], estimatedMinutes: 8 };
  const user = { language: 'en' };
  const normalized = normalizeBookSession(raw, book, planItem, user, []);

  assert.strictEqual(normalized.verification, raw.verification);
  assert.deepEqual(Object.keys(raw.verification).sort(), ['adversarialReview', 'authorFaithfulness', 'criticismBasis', 'finalAudit', 'researchApproach', 'sourceLimitations']);
  assert.ok(raw.verification.researchApproach.length <= 3000);
  assert.ok(raw.verification.authorFaithfulness.length <= 3000);
  assert.ok(raw.verification.criticismBasis.length <= 3000);
  assert.equal(raw.verification.sourceLimitations.length, 12);
  assert.ok(raw.verification.sourceLimitations.every((value) => value.length <= 1000));
  assert.equal(raw.verification.adversarialReview.issuesFound.length, 12);
  assert.equal(raw.verification.adversarialReview.correctionsMade.length, 12);
  assert.deepEqual(Object.keys(raw.verification.adversarialReview).sort(), ['correctionsMade', 'issuesFound', 'unresolvedIssues']);
  assert.deepEqual(Object.keys(raw.verification.finalAudit).sort(), ['accuracyPassed', 'completenessPassed', 'learnerFitPassed', 'noFabricationPassed', 'sourceTraceabilityPassed']);
});
