import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLesson } from '../src/services/learning.js';
import { normalizeBookSession } from '../src/services/books.js';
import { normalizeReadingDocument } from '../src/services/reading-document.js';

const bilingualReadingDocument = {
  version: 1,
  defaultLanguage: 'en',
  hero: {
    eyebrow: { en: 'Mental model', ar: 'نموذج ذهني' },
    title: { en: 'Why incentives matter', ar: 'لماذا تهم الحوافز' },
    lede: { en: 'A short introduction.', ar: 'مقدمة قصيرة.' },
    readTimeMinutes: 8
  },
  sections: [{
    id: 'opening',
    kicker: { en: 'Start here', ar: 'ابدأ هنا' },
    title: { en: 'The central question', ar: 'السؤال المركزي' },
    optional: false,
    blocks: [{
      id: 'opening-idea',
      type: 'idea',
      label: { en: 'Key idea', ar: 'الفكرة الأساسية' },
      title: { en: 'Behavior follows incentives', ar: 'السلوك يتبع الحوافز' },
      text: { en: 'People respond to changing costs and rewards.', ar: 'يستجيب الناس لتغير التكاليف والمكافآت.' }
    }]
  }],
  glossary: [{
    id: 'incentive',
    term: { en: 'Incentive', ar: 'حافز' },
    definition: { en: 'A factor that changes the payoff of an action.', ar: 'عامل يغيّر عائد القيام بفعل ما.' }
  }],
  ending: {
    title: { en: 'Keep the model', ar: 'احتفظ بالنموذج' },
    text: { en: 'Look for the incentive before judging the behavior.', ar: 'ابحث عن الحافز قبل الحكم على السلوك.' }
  }
};

test('normalizeLesson retains a complete English/Arabic ReadingDocument v1', () => {
  const proposal = { title: 'Incentives', question: 'Why incentives?', topic: 'Economics', estimatedMinutes: 8 };
  const user = { language: 'en' };
  const normalized = normalizeLesson({
    title: 'Incentives',
    readingDocument: bilingualReadingDocument,
    content: {},
    sources: [],
    claims: []
  }, proposal, [], user);

  assert.deepEqual(normalized.readingDocument, bilingualReadingDocument);
});

test('ReadingDocument rejects one-sided locale content and unsupported block types', () => {
  const missingArabic = structuredClone(bilingualReadingDocument);
  missingArabic.sections[0].blocks[0].text.ar = '';
  assert.throws(
    () => normalizeReadingDocument(missingArabic, { required: true }),
    (error) => error.code === 'INVALID_READING_DOCUMENT' && /English and Arabic/.test(error.message)
  );

  const unsupported = structuredClone(bilingualReadingDocument);
  unsupported.sections[0].blocks[0].type = 'arbitrary_html';
  assert.throws(
    () => normalizeReadingDocument(unsupported, { required: true }),
    (error) => error.code === 'INVALID_READING_DOCUMENT' && /Unsupported reading block type/.test(error.message)
  );
});

test('ReadingDocument rejects duplicate stable ids across its render tree', () => {
  const duplicate = structuredClone(bilingualReadingDocument);
  duplicate.glossary[0].id = 'opening-idea';
  assert.throws(
    () => normalizeReadingDocument(duplicate, { required: true }),
    (error) => error.code === 'INVALID_READING_DOCUMENT' && /Duplicate stable reading id/.test(error.message)
  );
});

test('normalizeBookSession retains the same validated bilingual ReadingDocument v1 contract', () => {
  const book = { title: 'Thinking in Systems', language: 'en', ownedCopy: null };
  const planItem = { title: 'Feedback loops', number: 1, scope: 'Feedback loops', chapterRefs: [], pageRefs: [], estimatedMinutes: 8 };
  const user = { language: 'en' };
  const normalized = normalizeBookSession({
    title: 'Feedback loops',
    readingDocument: bilingualReadingDocument,
    content: {},
    quiz: [],
    sources: [],
    claims: []
  }, book, planItem, user, []);

  assert.deepEqual(normalized.readingDocument, bilingualReadingDocument);
});
