const text = (value) => String(value || '').trim();
const compact = (values) => values.filter((value) => text(value));

export function lessonOutcomes(lesson) {
  const content = lesson?.content || {};
  return compact(content.keyIdeas || []).slice(0, 3);
}

export function lessonValue(lesson) {
  const content = lesson?.content || {};
  return text(content.practicalMeaning)
    || text(lesson?.question)
    || text(content.hook)
    || 'Build a useful mental model you can apply beyond this lesson.';
}

export function buildLessonSections(lesson) {
  const content = lesson?.content || {};
  const sections = [];
  const add = (id, title, kind, blocks, optional = false) => {
    const cleaned = compact(Array.isArray(blocks) ? blocks : [blocks]);
    if (cleaned.length) sections.push({ id, title, kind, blocks: cleaned, optional });
  };
  add('opening', 'Start with the question', 'prose', content.hook);
  add('mental-map', 'The mental map', 'key', content.keyIdeas);
  add('core', 'Core explanation', 'prose', content.coreExplanation);
  add('context', 'Essential context', 'prose', content.context);
  add('example', 'A concrete example', 'example', content.examples);
  add('perspectives', 'Other perspectives', 'comparison', content.perspectives, true);
  add('limitations', 'Limits and misconceptions', 'caution', content.misconceptions);
  add('application', 'Why this matters in practice', 'prose', content.practicalMeaning);
  add('connection', 'Connect it to what you know', 'connection', content.knowledgeConnection, true);
  const check = createLessonCheck(lesson);
  if (check) sections.push({ id: 'check', title: 'Check your understanding', kind: 'check', blocks: [], check });
  add('takeaway', 'Practical takeaway', 'takeaway', content.practicalTakeaway);
  add('reflection', 'Pause and reflect', 'reflection', content.reflectionPrompt, true);
  return sections.map((section, index) => ({ ...section, index, anchorId: `${section.id}-start` }));
}

export function createLessonCheck(lesson) {
  const quiz = Array.isArray(lesson?.quiz) ? lesson.quiz : [];
  const multipleChoice = quiz.find((item) => Array.isArray(item.options) && item.options.length >= 2);
  if (multipleChoice) {
    return {
      id: String(multipleChoice.id || 'lesson-check'),
      question: text(multipleChoice.question),
      expected: text(multipleChoice.expected),
      options: multipleChoice.options.map(text).filter(Boolean)
    };
  }
  const keyIdeas = lessonOutcomes(lesson);
  const distractors = compact(lesson?.content?.misconceptions || []);
  if (!keyIdeas.length || !distractors.length) return null;
  return {
    id: 'essential-check',
    question: 'Which statement best captures one of the lesson’s essential ideas?',
    expected: keyIdeas[0],
    options: [keyIdeas[0], ...distractors.slice(0, 2)]
  };
}

export function defaultExperience(lesson) {
  const existing = lesson?.experience || {};
  return {
    version: 1,
    revision: Number(existing.revision) || 0,
    currentSectionId: text(existing.currentSectionId) || 'cover',
    anchorId: text(existing.anchorId),
    completedSectionIds: Array.isArray(existing.completedSectionIds) ? [...new Set(existing.completedSectionIds.map(String))] : [],
    answers: existing.answers && typeof existing.answers === 'object' ? existing.answers : {},
    answerHistory: Array.isArray(existing.answerHistory) ? existing.answerHistory : [],
    highlights: Array.isArray(existing.highlights) ? existing.highlights : [],
    notes: Array.isArray(existing.notes) ? existing.notes : [],
    sectionFeedback: Array.isArray(existing.sectionFeedback) ? existing.sectionFeedback : [],
    confidence: existing.confidence || null,
    selectedLanguage: text(existing.selectedLanguage),
    startedAt: existing.startedAt || null,
    lastActivityAt: existing.lastActivityAt || null,
    completedEssentialAt: existing.completedEssentialAt || null,
    reviewAt: existing.reviewAt || null
  };
}

export function lessonPosition(lesson, plans = []) {
  const plan = plans.find((item) => item.id === lesson?.planId);
  const proposals = Array.isArray(plan?.proposals) ? plan.proposals : [];
  const index = proposals.findIndex((item) => item.id === lesson?.proposalId);
  return {
    current: index >= 0 ? index + 1 : null,
    total: proposals.length || null,
    label: index >= 0 && proposals.length ? `Lesson ${index + 1} of ${proposals.length}` : 'Daily lesson'
  };
}

export function remainingMinutes(lesson, sections, activeIndex) {
  const total = Math.max(1, Number(lesson?.estimatedMinutes) || 8);
  const remaining = Math.max(0, sections.length - activeIndex - 1);
  return Math.max(activeIndex >= sections.length - 1 ? 0 : 1, Math.ceil((total * remaining) / Math.max(1, sections.length)));
}

export function normalizeAnswer(value) {
  return text(value).toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

export function isExpectedAnswer(answer, expected) {
  const a = normalizeAnswer(answer);
  const e = normalizeAnswer(expected);
  return Boolean(a && e && (a === e || a.includes(e) || e.includes(a)));
}

export function mutationId(prefix = 'change') {
  const random = globalThis.crypto?.randomUUID?.().replaceAll('-', '') || `${Date.now()}${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${random}`.slice(0, 80);
}
