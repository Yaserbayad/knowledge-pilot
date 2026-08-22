import test from 'node:test';
import assert from 'node:assert/strict';
import { formatBookSessionText, formatLessonText } from '../src/utils.js';

const bilingualReadingDocument = {
  version: 1,
  hero: { title: { en: 'English web title', ar: 'عنوان الويب العربي' } },
  sections: [{ id: 'opening', title: { en: 'Opening', ar: 'البداية العربية' }, blocks: [] }],
  ending: { title: { en: 'End', ar: 'النهاية العربية' }, text: { en: 'Finish', ar: 'النص العربي النهائي' } }
};

test('lesson channel formatter remains learner-language flat content and does not duplicate bilingual web content', () => {
  const lesson = {
    title: 'English channel title',
    content: {
      hook: 'English hook.', coreExplanation: 'English explanation.', context: '', examples: [], perspectives: [], misconceptions: [],
      practicalMeaning: '', keyIdeas: ['One', 'Two', 'Three'], practicalTakeaway: '', reflectionPrompt: '', nextTeaser: ''
    },
    sources: [],
    readingDocument: bilingualReadingDocument
  };
  const text = formatLessonText(lesson);
  assert.match(text, /English channel title/);
  assert.match(text, /English explanation/);
  assert.doesNotMatch(text, /عنوان الويب العربي|البداية العربية|النص العربي النهائي/);
});

test('book-session channel formatter remains learner-language flat content and does not duplicate bilingual web content', () => {
  const session = {
    sessionNumber: 1, title: 'English session', chapterRefs: [], pageRefs: [],
    content: {
      hook: 'English hook.', summary: 'English summary.', importantDetails: [], context: '', criticalAssessment: '', practicalApplication: '',
      quotations: [], connections: [], keyIdeas: ['One', 'Two', 'Three'], reflectionPrompt: '', nextPreview: ''
    },
    sources: [],
    readingDocument: bilingualReadingDocument
  };
  const text = formatBookSessionText(session, { title: 'English book' });
  assert.match(text, /English book/);
  assert.match(text, /English summary/);
  assert.doesNotMatch(text, /عنوان الويب العربي|البداية العربية|النص العربي النهائي/);
});
