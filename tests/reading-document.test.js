import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLesson } from '../src/services/learning.js';

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
