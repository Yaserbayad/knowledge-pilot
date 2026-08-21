import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLesson, normalizePlan } from '../src/services/learning.js';

const huge = 'x'.repeat(50_000);
const user = { language: 'en', interests: ['Science'], rankedTopics: ['Science'] };

test('weekly-plan normalization bounds model-controlled strings and proposal fields', () => {
  const plan = normalizePlan({
    primarySubject: huge,
    secondarySubjects: Array(10).fill(huge),
    rationale: huge,
    proposals: Array.from({ length: 10 }, () => ({
      title: huge, question: huge, topic: huge, reason: huge, estimatedMinutes: 8
    }))
  }, user);

  assert.ok(plan.primarySubject.length <= 300);
  assert.ok(plan.rationale.length <= 3000);
  assert.equal(plan.secondarySubjects.length, 3);
  assert.ok(plan.secondarySubjects.every((value) => value.length <= 300));
  assert.equal(plan.proposals.length, 5);
  assert.ok(plan.proposals.every((proposal) =>
    proposal.title.length <= 300
    && proposal.question.length <= 1200
    && proposal.topic.length <= 300
    && proposal.reason.length <= 1200));
});

test('lesson normalization bounds text, quiz cardinality, source annotations, and claim mappings', () => {
  const proposal = { title: 'Evidence', question: 'How strong?', topic: 'Critical thinking', estimatedMinutes: 8 };
  const sources = [{ id: 's1', title: huge, url: `https://example.org/${'a'.repeat(5000)}`, domain: huge, excerpt: huge, claimsSupported: Array(100).fill(huge) }];
  const lesson = normalizeLesson({
    title: huge, question: huge, topic: huge, language: huge,
    content: {
      hook: huge, coreExplanation: huge, context: huge,
      examples: Array(20).fill(huge), perspectives: Array(20).fill(huge), misconceptions: Array(20).fill(huge),
      practicalMeaning: huge, knowledgeConnection: huge, keyIdeas: Array(20).fill(huge),
      practicalTakeaway: huge, reflectionPrompt: huge, nextTeaser: huge
    },
    quiz: Array.from({ length: 20 }, () => ({ type: 'multiple_choice', question: huge, expected: huge, options: Array(100).fill(huge) })),
    sources: [{ id: 's1', claimsSupported: Array(100).fill(huge) }],
    claims: Array.from({ length: 100 }, () => ({ text: huge, sourceIds: Array(100).fill(huge) }))
  }, proposal, sources, user);

  assert.ok(lesson.title.length <= 300);
  assert.ok(lesson.question.length <= 1200);
  assert.ok(lesson.topic.length <= 300);
  assert.ok(lesson.language.length <= 20);
  assert.ok(lesson.content.hook.length <= 2000);
  assert.ok(lesson.content.coreExplanation.length <= 12_000);
  assert.ok(lesson.content.context.length <= 8000);
  assert.equal(lesson.content.examples.length, 4);
  assert.ok(lesson.content.examples.every((value) => value.length <= 3000));
  assert.ok(lesson.content.perspectives.every((value) => value.length <= 3000));
  assert.ok(lesson.content.misconceptions.every((value) => value.length <= 3000));
  assert.equal(lesson.content.keyIdeas.length, 3);
  assert.ok(lesson.content.keyIdeas.every((value) => value.length <= 1000));
  assert.equal(lesson.quiz.length, 5);
  assert.ok(lesson.quiz.every((item) => item.question.length <= 1500 && item.expected.length <= 3000));
  assert.ok(lesson.quiz.every((item) => item.options.length <= 8 && item.options.every((value) => value.length <= 500)));
  assert.ok(lesson.sources[0].title.length <= 500);
  assert.ok(lesson.sources[0].url.length <= 2000);
  assert.ok(lesson.sources[0].domain.length <= 253);
  assert.equal(lesson.sources[0].claimsSupported.length, 20);
  assert.ok(lesson.sources[0].claimsSupported.every((value) => value.length <= 300));
  assert.equal(lesson.claims.length, 20);
  assert.ok(lesson.claims.every((claim) => claim.text.length <= 2000 && claim.sourceIds.length <= 10));
  assert.ok(lesson.claims.every((claim) => claim.sourceIds.every((value) => value.length <= 120)));
});
