import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { JsonStore } from '../src/store.js';
import { AiService } from '../src/services/ai.js';
import { ResearchService } from '../src/services/research.js';
import { LearningService } from '../src/services/learning.js';
import {
  buildLessonSections, defaultExperience, isExpectedAnswer, lessonPosition, lessonValue
} from '../public/lesson-experience.js';

const logger = { debug() {}, info() {}, warn() {}, error() {} };

const sampleLesson = {
  id: 'lesson_reader',
  userId: 'user_reader',
  planId: 'plan_reader',
  proposalId: 'proposal_two',
  status: 'delivered',
  language: 'en',
  title: 'How shared beliefs coordinate groups',
  question: 'How can strangers cooperate?',
  estimatedMinutes: 8,
  content: {
    hook: 'Small groups can rely on personal trust.',
    coreExplanation: 'Shared institutions allow coordination beyond direct relationships.',
    context: 'Language and enforcement both matter.',
    examples: ['Currency works when coordinated recognition shapes behavior.'],
    perspectives: ['Incentives remain important.'],
    misconceptions: ['A social construct is not automatically false.'],
    practicalMeaning: 'This helps you evaluate institutional claims.',
    knowledgeConnection: 'It connects to trust and governance.',
    keyIdeas: ['Recognition can create causal effects.', 'Rules stabilize expectations.', 'Enforcement changes incentives.'],
    practicalTakeaway: 'Ask what coordinates recognition and enforcement.',
    reflectionPrompt: 'Which institution do you rely on?',
    nextTeaser: 'How institutions persist.'
  },
  quiz: [],
  sources: []
};

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'knowledge-pilot-reader-'));
  const config = {
    appBaseUrl: 'http://127.0.0.1:3100',
    appSecret: 'test-secret-test-secret-test-secret',
    defaultLanguage: 'en',
    defaultTimezone: 'UTC',
    cardDir: path.join(root, 'cards'),
    ai: { provider: 'mock' },
    research: { searxngUrl: '', maxResults: 6, fetchTimeoutMs: 1000 },
    businessActions: { autoScheduleApproved: true, autoScheduleDelayMinutes: 2 },
    whatsapp: { dedicatedNumber: '' }
  };
  const store = await new JsonStore({ stateFile: path.join(root, 'state.json'), backupDir: path.join(root, 'backups'), logger }).init();
  const learning = new LearningService({
    store,
    ai: new AiService(config.ai, logger),
    research: new ResearchService(config.research, logger),
    config,
    logger
  });
  return { store, learning };
}

test('lesson experience builds a cover and stable guided sections without decorative media', () => {
  const sections = buildLessonSections(sampleLesson);
  assert.equal(sections[0].id, 'opening');
  assert.ok(sections.some((section) => section.id === 'core'));
  assert.ok(sections.some((section) => section.id === 'check'));
  assert.ok(sections.every((section) => /^[a-z0-9-]+$/.test(section.id)));
  assert.equal(lessonValue(sampleLesson), sampleLesson.content.practicalMeaning);
  assert.deepEqual(lessonPosition(sampleLesson, [{
    id: 'plan_reader',
    proposals: [{ id: 'proposal_one' }, { id: 'proposal_two' }, { id: 'proposal_three' }]
  }]), { current: 2, total: 3, label: 'Lesson 2 of 3' });
  assert.equal(isExpectedAnswer('Rules stabilize expectations.', 'Rules stabilize expectations.'), true);
  assert.equal(defaultExperience(sampleLesson).currentSectionId, 'cover');
});

test('lesson experience saves durable anchors and private mutations while rejecting stale writes', async () => {
  const { store, learning } = await fixture();
  await store.transaction((state) => {
    state.users.user_reader = { id: 'user_reader', name: 'Reader', accessVersion: 1 };
    state.users.user_other = { id: 'user_other', name: 'Other', accessVersion: 1 };
    state.lessons.lesson_reader = structuredClone(sampleLesson);
  });

  const first = await learning.updateLessonExperience('user_reader', 'lesson_reader', {
    baseRevision: 0,
    started: true,
    currentSectionId: 'core',
    anchorId: 'core-block-0',
    completedSectionIds: ['opening', 'mental-map'],
    sectionTotal: 8,
    selectedLanguage: 'en'
  });
  assert.equal(first.experience.currentSectionId, 'core');
  assert.equal(first.experience.anchorId, 'core-block-0');
  assert.equal(first.resumePercent, 25);

  const note = await learning.updateLessonExperience('user_reader', 'lesson_reader', {
    baseRevision: first.revision,
    mutation: {
      id: 'note-123',
      type: 'note',
      sectionId: 'core',
      anchorId: 'core-block-0',
      passage: 'Shared institutions allow coordination.',
      note: '<script>private but rendered as text</script>',
      language: 'en'
    }
  });
  assert.equal(note.experience.notes.length, 1);
  assert.equal(note.experience.notes[0].note, '<script>private but rendered as text</script>');
  await assert.rejects(
    learning.updateLessonExperience('user_reader', 'lesson_reader', { baseRevision: 0, currentSectionId: 'context' }),
    (error) => error.statusCode === 409 && error.code === 'STALE_LESSON_PROGRESS'
  );
  await assert.rejects(
    learning.updateLessonExperience('user_other', 'lesson_reader', { baseRevision: note.revision, currentSectionId: 'context' }),
    /Lesson not found/
  );
});

test('learner assets expose the deliberate cover/reader flow and responsive Weekly cards', async () => {
  const app = await fs.readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const css = await fs.readFile(new URL('../public/styles.css', import.meta.url), 'utf8');
  const server = await fs.readFile(new URL('../src/server.js', import.meta.url), 'utf8');
  assert.match(app, /function renderTodayCards\(/);
  assert.match(app, /class="lesson-cover"/);
  assert.match(app, /class="lesson-reader"/);
  assert.match(app, /kp-pending-experience-/);
  assert.doesNotMatch(app, /lesson\.cardFile/);
  assert.match(css, /grid-template-columns: repeat\(auto-fit, minmax\(min\(100%, 300px\), 1fr\)\)/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
  assert.match(css, /body\.lesson-focus/);
  assert.match(server, /\/api\/lessons\/:lessonId\/experience/);
  assert.match(server, /pathname === '\/sw\.js'/);
});
