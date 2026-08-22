const BLOCK_TYPES = new Set([
  'prose', 'idea', 'pulse', 'register', 'sequence', 'example', 'matrix',
  'synthesis', 'context_note', 'definition', 'check', 'reading_end'
]);

const UI = {
  en: {
    outline: 'Outline', closeOutline: 'Close outline', switchLanguage: 'AR', switchLanguageLabel: 'Switch to Arabic',
    saved: 'Saved', sources: 'Sources', discuss: 'Ask', theme: 'Theme', progress: 'Reading progress',
    close: 'Close reader', section: 'Section', read: 'read', back: 'Back', highlight: 'Highlight', note: 'Note',
    saveNote: 'Save note', cancel: 'Cancel', noteLabel: 'Your note', sourceHeading: 'Sources', savedHeading: 'Saved notes & highlights',
    emptySaved: 'Nothing saved yet.', followUpHeading: 'Ask about this reading', followUpLabel: 'Question', send: 'Send',
    confidence: 'How confident do you feel?', low: 'Low', medium: 'Medium', high: 'High', complete: 'Complete reading',
    completed: 'Completed', useful: 'Useful', notUseful: 'Not useful', feedbackSaved: 'Feedback saved.',
    sectionFeedback: 'Report this section', unclear: 'Unclear', tooSimple: 'Too simple', tooDetailed: 'Too detailed',
    notRelevant: 'Not relevant', incorrect: 'May be incorrect', comment: 'Optional comment', save: 'Save',
    definition: 'Definition', closeDefinition: 'Close definition', loading: 'Loading reading…', unavailable: 'Reading shell unavailable.',
    legacy: 'This item uses the legacy reader.', selectText: 'Select text in the reading first.', savedOk: 'Saved.',
    answerSaved: 'Answer saved.', correct: 'Correct', review: 'Review this point', sourcesEmpty: 'No sources are attached.',
    followUpPending: 'Your question was queued for verified processing.', menu: 'Reader tools'
  },
  ar: {
    outline: 'الفهرس', closeOutline: 'إغلاق الفهرس', switchLanguage: 'EN', switchLanguageLabel: 'التبديل إلى الإنجليزية',
    saved: 'المحفوظات', sources: 'المصادر', discuss: 'اسأل', theme: 'النمط', progress: 'تقدم القراءة',
    close: 'إغلاق القارئ', section: 'القسم', read: 'مقروء', back: 'رجوع', highlight: 'تظليل', note: 'ملاحظة',
    saveNote: 'حفظ الملاحظة', cancel: 'إلغاء', noteLabel: 'ملاحظتك', sourceHeading: 'المصادر', savedHeading: 'الملاحظات والتظليلات',
    emptySaved: 'لا توجد عناصر محفوظة بعد.', followUpHeading: 'اسأل عن هذه القراءة', followUpLabel: 'السؤال', send: 'إرسال',
    confidence: 'ما مدى ثقتك بفهمك؟', low: 'منخفضة', medium: 'متوسطة', high: 'عالية', complete: 'إكمال القراءة',
    completed: 'مكتمل', useful: 'مفيد', notUseful: 'غير مفيد', feedbackSaved: 'تم حفظ الملاحظات.',
    sectionFeedback: 'الإبلاغ عن هذا القسم', unclear: 'غير واضح', tooSimple: 'مبسّط أكثر من اللازم', tooDetailed: 'تفصيلي أكثر من اللازم',
    notRelevant: 'غير ذي صلة', incorrect: 'قد يكون غير صحيح', comment: 'تعليق اختياري', save: 'حفظ',
    definition: 'تعريف', closeDefinition: 'إغلاق التعريف', loading: 'جارٍ تحميل القراءة…', unavailable: 'واجهة القراءة غير متاحة.',
    legacy: 'يستخدم هذا العنصر واجهة القراءة السابقة.', selectText: 'حدّد نصاً من القراءة أولاً.', savedOk: 'تم الحفظ.',
    answerSaved: 'تم حفظ الإجابة.', correct: 'صحيح', review: 'راجع هذه النقطة', sourcesEmpty: 'لا توجد مصادر مرفقة.',
    followUpPending: 'تمت إضافة سؤالك إلى المعالجة الموثّقة.', menu: 'أدوات القارئ'
  }
};

const state = {
  open: false,
  kind: null,
  id: null,
  record: null,
  document: null,
  language: 'en',
  experience: null,
  activeSectionId: '',
  activeBlockId: '',
  outlineOpen: false,
  drawer: null,
  definitionTrigger: null,
  selection: null,
  positionTimer: 0,
  saveInFlight: null,
  lastSavedPosition: '',
  modalReturnFocus: null
};

const root = document.createElement('div');
root.id = 'reading-shell-root';
root.className = 'reading-shell';
root.hidden = true;
root.setAttribute('aria-live', 'polite');
document.body.append(root);

function el(tag, className = '', text = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function button(className, text, label = '') {
  const node = el('button', className, text);
  node.type = 'button';
  if (label) node.setAttribute('aria-label', label);
  return node;
}

function ui() { return UI[state.language] || UI.en; }
function localized(value) { return value?.[state.language] || value?.en || value?.ar || ''; }
function finiteText(value) { return String(value ?? '').trim(); }
function isReadingDocument(value) { return value && value.version === 1 && Array.isArray(value.sections) && value.sections.length > 0; }
function sectionById(id) { return state.document?.sections?.find((section) => section.id === id) || null; }
function endpoint(path) { return path; }

async function api(path, options = {}) {
  const headers = { ...(options.body ? { 'content-type': 'application/json' } : {}), ...(options.headers || {}) };
  const response = await fetch(endpoint(path), { credentials: 'same-origin', ...options, headers });
  const text = await response.text();
  let data = {};
  if (text) {
    try { data = JSON.parse(text); } catch { data = { error: text }; }
  }
  if (!response.ok) {
    const error = new Error(data.error || `Request failed (${response.status})`);
    error.status = response.status;
    error.code = data.code || '';
    error.data = data;
    throw error;
  }
  return data;
}

function parseRoute() {
  const hash = location.hash.replace(/^#/, '');
  const match = hash.match(/^(lesson|book-session)=([^&]+)$/);
  if (!match) return null;
  try { return { kind: match[1], id: decodeURIComponent(match[2]) }; }
  catch { return null; }
}

function recordPath(kind, id) {
  return kind === 'lesson' ? `/api/lessons/${encodeURIComponent(id)}` : `/api/book-sessions/${encodeURIComponent(id)}`;
}
function experiencePath() {
  return state.kind === 'lesson'
    ? `/api/lessons/${encodeURIComponent(state.id)}/experience`
    : `/api/book-sessions/${encodeURIComponent(state.id)}/experience`;
}
function completePath() {
  return state.kind === 'lesson'
    ? `/api/lessons/${encodeURIComponent(state.id)}/complete`
    : `/api/book-sessions/${encodeURIComponent(state.id)}/complete`;
}
function feedbackPath() {
  return state.kind === 'lesson'
    ? `/api/lessons/${encodeURIComponent(state.id)}/feedback`
    : `/api/book-sessions/${encodeURIComponent(state.id)}/feedback`;
}
function followUpPath() {
  return state.kind === 'lesson'
    ? `/api/lessons/${encodeURIComponent(state.id)}/follow-up`
    : `/api/book-sessions/${encodeURIComponent(state.id)}/follow-up`;
}

function defaultExperience(existing = {}) {
  return {
    revision: Number(existing.revision) || 0,
    currentSectionId: finiteText(existing.currentSectionId || 'cover'),
    anchorId: finiteText(existing.anchorId),
    completedSectionIds: Array.isArray(existing.completedSectionIds) ? existing.completedSectionIds.map(String) : [],
    answers: existing.answers && typeof existing.answers === 'object' ? existing.answers : {},
    highlights: Array.isArray(existing.highlights) ? existing.highlights : [],
    notes: Array.isArray(existing.notes) ? existing.notes : [],
    sectionFeedback: Array.isArray(existing.sectionFeedback) ? existing.sectionFeedback : [],
    confidence: ['low', 'medium', 'high'].includes(existing.confidence) ? existing.confidence : null,
    selectedLanguage: ['en', 'ar'].includes(existing.selectedLanguage) ? existing.selectedLanguage : '',
    startedAt: existing.startedAt || null
  };
}

function chooseLanguage(record) {
  const saved = record?.experience?.selectedLanguage;
  if (saved === 'en' || saved === 'ar') return saved;
  const preferred = record?.readingDocument?.defaultLanguage;
  if (preferred === 'en' || preferred === 'ar') return preferred;
  return record?.language === 'ar' ? 'ar' : 'en';
}

function setShellDirection() {
  root.lang = state.language;
  root.setAttribute('dir', state.language === 'ar' ? 'rtl' : 'ltr');
}

function closeReader() {
  state.open = false;
  clearTimeout(state.positionTimer);
  root.hidden = true;
  root.replaceChildren();
  document.body.classList.remove('reading-shell-open');
  state.drawer = null;
  state.selection = null;
  if (location.hash) location.hash = '';
}

function toast(message, kind = 'status') {
  let node = root.querySelector('.reading-toast');
  if (!node) {
    node = el('div', 'reading-toast');
    node.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    node.setAttribute('aria-live', 'polite');
    root.append(node);
  }
  node.textContent = message;
  node.classList.add('show');
  clearTimeout(node._hideTimer);
  node._hideTimer = setTimeout(() => node.classList.remove('show'), 2600);
}

async function refreshRecord() {
  const payload = await api(recordPath(state.kind, state.id));
  const record = state.kind === 'book-session' ? payload?.session : payload;
  const relatedBook = state.kind === 'book-session' ? payload?.book : null;
  if (!record) throw new Error(ui().unavailable);
  state.record = relatedBook ? { ...record, bookTitle: relatedBook.title || record.bookTitle || '' } : record;
  state.document = record.readingDocument;
  state.experience = defaultExperience(record.experience);
  return state.record;
}

async function performExperienceSave(patch = {}, mutation = null, retry = true) {
  let canRetry = retry;
  while (state.open) {
    try {
      const payload = {
        baseRevision: state.experience?.revision || 0,
        currentSectionId: patch.currentSectionId || state.activeSectionId || state.experience?.currentSectionId || 'cover',
        anchorId: patch.anchorId !== undefined ? patch.anchorId : (state.activeBlockId || state.experience?.anchorId || ''),
        completedSectionIds: patch.completedSectionIds || state.experience?.completedSectionIds || [],
        selectedLanguage: patch.selectedLanguage || state.language,
        sectionTotal: Math.max(1, state.document?.sections?.length || 1),
        ...(patch.started !== undefined ? { started: patch.started } : {}),
        ...(patch.confidence ? { confidence: patch.confidence } : {}),
        ...(mutation ? { mutation } : {})
      };
      const saved = await api(experiencePath(), { method: 'POST', body: JSON.stringify(payload) });
      state.experience = { ...state.experience, ...(saved.experience || {}), revision: saved.revision ?? saved.experience?.revision ?? state.experience?.revision };
      if (state.record) state.record.resumePercent = saved.resumePercent ?? state.record.resumePercent;
      return saved;
    } catch (error) {
      if (error.status === 409 && canRetry) {
        canRetry = false;
        await refreshRecord();
        continue;
      }
      toast(error.message, 'error');
      return null;
    }
  }
  return null;
}

async function saveExperience(patch = {}, mutation = null, retry = true) {
  if (!state.open) return null;
  while (state.saveInFlight) {
    try { await state.saveInFlight; } catch {}
    if (!state.open) return null;
  }
  const run = performExperienceSave(patch, mutation, retry);
  state.saveInFlight = run;
  try {
    return await run;
  } finally {
    if (state.saveInFlight === run) state.saveInFlight = null;
  }
}

function completedBefore(sectionId) {
  const sections = state.document?.sections || [];
  const index = sections.findIndex((section) => section.id === sectionId);
  const prior = index > 0 ? sections.slice(0, index).map((section) => section.id) : [];
  return [...new Set([...(state.experience?.completedSectionIds || []), ...prior])];
}

function queuePositionSave() {
  clearTimeout(state.positionTimer);
  const fingerprint = `${state.activeSectionId}:${state.activeBlockId}:${state.language}`;
  if (fingerprint === state.lastSavedPosition) return;
  state.positionTimer = setTimeout(async () => {
    const saved = await saveExperience({
      currentSectionId: state.activeSectionId,
      anchorId: state.activeBlockId,
      completedSectionIds: completedBefore(state.activeSectionId),
      selectedLanguage: state.language,
      started: true
    });
    if (saved) state.lastSavedPosition = fingerprint;
  }, 650);
}

function appendLocalizedText(container, value, className = '') {
  const text = localized(value);
  if (!text) return null;
  const p = el('p', className);
  appendTextWithTerms(p, text);
  container.append(p);
  return p;
}

function appendTextWithTerms(container, text) {
  const glossary = state.document?.glossary || [];
  const terms = glossary
    .map((entry) => ({ entry, term: localized(entry.term) }))
    .filter(({ term }) => term && term.length >= 2)
    .sort((a, b) => b.term.length - a.term.length);
  let remaining = text;
  while (remaining) {
    let best = null;
    for (const candidate of terms) {
      const haystack = state.language === 'en' ? remaining.toLocaleLowerCase('en') : remaining;
      const needle = state.language === 'en' ? candidate.term.toLocaleLowerCase('en') : candidate.term;
      const index = haystack.indexOf(needle);
      if (index >= 0 && (!best || index < best.index || (index === best.index && candidate.term.length > best.term.length))) {
        best = { ...candidate, index };
      }
    }
    if (!best) {
      container.append(document.createTextNode(remaining));
      break;
    }
    if (best.index > 0) container.append(document.createTextNode(remaining.slice(0, best.index)));
    const termButton = button('reading-term', remaining.slice(best.index, best.index + best.term.length), `${ui().definition}: ${best.term}`);
    termButton.dataset.termId = best.entry.id;
    termButton.addEventListener('click', () => openDefinition(best.entry, termButton));
    container.append(termButton);
    remaining = remaining.slice(best.index + best.term.length);
  }
}

function renderItems(block, container) {
  if (!Array.isArray(block.items) || !block.items.length) return;
  const grid = el('div', 'reading-register-grid');
  for (const item of block.items) {
    const card = el('div', 'reading-register-item');
    if (localized(item.label)) card.append(el('small', '', localized(item.label)));
    if (localized(item.title)) card.append(el('b', '', localized(item.title)));
    appendLocalizedText(card, item.text);
    grid.append(card);
  }
  container.append(grid);
}

function renderList(block, container) {
  const values = block.list?.[state.language] || block.list?.en || [];
  if (!Array.isArray(values) || !values.length) return;
  const list = el('ul', 'reading-list');
  for (const value of values) {
    const item = el('li');
    appendTextWithTerms(item, finiteText(value));
    list.append(item);
  }
  container.append(list);
}

function renderSequence(block, container) {
  const steps = Array.isArray(block.steps) ? block.steps : [];
  if (!steps.length) return;
  const stepper = el('div', 'reading-sequence');
  stepper.dataset.stepper = block.id;
  const output = el('div', 'reading-step-output');
  output.setAttribute('role', 'status');
  let active = 0;
  try {
    const stored = Number(localStorage.getItem(`kp-reading-stepper:${state.id}:${block.id}`));
    if (Number.isInteger(stored) && stored >= 0 && stored < steps.length) active = stored;
  } catch {}
  const setStepper = (index) => {
    active = Math.max(0, Math.min(steps.length - 1, index));
    [...stepper.querySelectorAll('button')].forEach((node, buttonIndex) => {
      node.classList.toggle('active', buttonIndex === active);
      node.setAttribute('aria-pressed', String(buttonIndex === active));
    });
    const step = steps[active];
    output.textContent = localized(step.output) || localized(step.text) || '';
    try { localStorage.setItem(`kp-reading-stepper:${state.id}:${block.id}`, String(active)); } catch {}
  };
  steps.forEach((step, index) => {
    const control = button('reading-step');
    control.setAttribute('aria-pressed', 'false');
    control.append(el('span', '', localized(step.label) || String(index + 1).padStart(2, '0')));
    control.append(el('b', '', localized(step.title) || localized(step.text)));
    control.addEventListener('click', () => setStepper(index));
    stepper.append(control);
  });
  container.append(stepper, output);
  requestAnimationFrame(() => setStepper(active));
}

function renderMatrix(block, container) {
  const columns = Array.isArray(block.columns) ? block.columns : [];
  const rows = Array.isArray(block.rows) ? block.rows : [];
  if (!columns.length || !rows.length) return;
  const wrap = el('div', 'reading-matrix-wrap');
  const table = el('table', 'reading-matrix');
  const head = el('thead');
  const headRow = el('tr');
  headRow.append(el('th', '', ''));
  for (const column of columns) headRow.append(el('th', '', localized(column)));
  head.append(headRow);
  const body = el('tbody');
  for (const row of rows) {
    const tr = el('tr');
    tr.append(el('th', '', localized(row.label)));
    for (const cell of row.cells || []) tr.append(el('td', '', localized(cell)));
    body.append(tr);
  }
  table.append(head, body);
  wrap.append(table);
  container.append(wrap);
}

function mutationId(prefix) {
  const uuid = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${uuid}`.slice(0, 78).toLowerCase().replace(/[^a-z0-9_-]/g, '-');
}

function renderCheck(block, container, sectionId) {
  const options = Array.isArray(block.options) ? block.options : [];
  if (!options.length) return;
  const answers = state.experience?.answers || {};
  const prior = answers[block.id];
  const group = el('div', 'reading-check-options');
  const feedback = el('div', 'reading-check-feedback');
  feedback.setAttribute('role', 'status');
  const choose = async (option) => {
    const correct = option.id === block.expectedOptionId;
    const saved = await saveExperience({}, {
      id: mutationId('answer'), type: 'answer', questionId: block.id, sectionId,
      answer: option.id, correct, skipped: false
    });
    if (saved) {
      [...group.querySelectorAll('button')].forEach((control) => control.setAttribute('aria-pressed', String(control.dataset.optionId === option.id)));
      feedback.textContent = correct ? `${ui().correct}. ${ui().answerSaved}` : `${ui().review}. ${ui().answerSaved}`;
    }
  };
  for (const option of options) {
    const control = button('reading-check-option', localized(option.text));
    control.dataset.optionId = option.id;
    control.setAttribute('aria-pressed', String(prior?.answer === option.id));
    control.addEventListener('click', () => choose(option));
    group.append(control);
  }
  container.append(group, feedback);
}

function renderBlock(block, sectionId, index) {
  if (!BLOCK_TYPES.has(block.type)) return null;
  const outer = el('div', `reading-block reading-${block.type.replace('_', '-')}`);
  outer.dataset.blockId = block.id;
  outer.id = `reading-block-${block.id}`;
  if (localized(block.label)) outer.append(el('small', 'reading-block-label', localized(block.label)));
  if (localized(block.title)) outer.append(el('h3', 'reading-block-title', localized(block.title)));

  if (block.type === 'sequence') {
    appendLocalizedText(outer, block.text);
    renderSequence(block, outer);
  } else if (block.type === 'matrix') {
    appendLocalizedText(outer, block.text);
    renderMatrix(block, outer);
  } else if (block.type === 'check') {
    appendLocalizedText(outer, block.prompt || block.text, 'reading-check-prompt');
    renderCheck(block, outer, sectionId);
  } else {
    appendLocalizedText(outer, block.text);
    renderList(block, outer);
    renderItems(block, outer);
  }
  if (localized(block.caption)) outer.append(el('div', 'reading-caption', localized(block.caption)));
  if (block.type === 'reading_end' && localized(block.output)) outer.append(el('p', 'reading-ending-output', localized(block.output)));
  outer.dataset.wbs = `${index + 1}`;
  return outer;
}

function sectionFeedbackButton(section) {
  const control = button('reading-section-feedback', ui().sectionFeedback);
  control.addEventListener('click', () => openSectionFeedback(section, control));
  return control;
}

function renderSection(section, index) {
  const node = el('section', 'reading-section');
  node.dataset.sectionId = section.id;
  node.id = `reading-section-${section.id}`;
  const head = el('header', 'reading-section-head');
  const kicker = el('div', 'reading-section-kicker');
  kicker.append(el('span', 'reading-section-num', String(index + 1).padStart(2, '0')));
  if (localized(section.kicker)) kicker.append(el('small', '', localized(section.kicker)));
  head.append(kicker, el('h2', '', localized(section.title)));
  if (localized(section.lede)) head.append(el('p', 'reading-lede', localized(section.lede)));
  node.append(head);
  const stream = el('div', 'reading-prose-stream');
  (section.blocks || []).forEach((block, blockIndex) => {
    const rendered = renderBlock(block, section.id, blockIndex);
    if (rendered) stream.append(rendered);
  });
  node.append(stream, sectionFeedbackButton(section));
  return node;
}

function createToolbar() {
  const bar = el('header', 'reading-sticky');
  const inner = el('div', 'reading-sticky-inner');
  const outline = button('reading-outline-btn', ui().outline);
  outline.setAttribute('aria-expanded', 'false');
  outline.addEventListener('click', () => toggleOutline(true));
  const current = el('div', 'reading-current');
  current.append(el('span', 'reading-current-wbs', '01'), el('b', 'reading-current-title', localized(state.document.sections[0]?.title)), el('span', 'reading-current-meta', `${ui().section} 1/${state.document.sections.length}`));
  const language = button('reading-lang-btn', ui().switchLanguage, ui().switchLanguageLabel);
  language.addEventListener('click', switchLanguage);
  const tools = button('reading-tools-btn', '•••', ui().menu);
  tools.addEventListener('click', () => openTools(tools));
  const close = button('reading-close-btn', '×', ui().close);
  close.addEventListener('click', closeReader);
  inner.append(outline, current, language, tools, close);
  const track = el('progress', 'reading-progress');
  track.max = 100;
  track.value = 0;
  track.setAttribute('aria-label', ui().progress);
  bar.append(inner, track);
  return bar;
}

function createHero() {
  const hero = el('section', 'reading-hero');
  const copy = el('div');
  if (localized(state.document.hero?.eyebrow)) copy.append(el('small', '', localized(state.document.hero.eyebrow)));
  copy.append(el('h1', '', localized(state.document.hero?.title) || state.record?.title || ''));
  if (localized(state.document.hero?.lede)) copy.append(el('p', 'reading-dek', localized(state.document.hero.lede)));
  const meta = el('aside', 'reading-hero-meta');
  meta.append(el('b', '', state.kind === 'lesson' ? 'Knowledge Pilot' : (state.record?.bookTitle || state.record?.title || 'Book session')));
  meta.append(el('span', '', `${state.document.hero?.readTimeMinutes || state.record?.estimatedMinutes || 8} min`));
  hero.append(copy, meta);
  return hero;
}

function createSpine() {
  const nav = el('nav', 'reading-section-spine');
  nav.setAttribute('aria-label', ui().outline);
  state.document.sections.forEach((section, index) => {
    const control = button('', String(index + 1).padStart(2, '0'), localized(section.title));
    control.dataset.sectionTarget = section.id;
    control.addEventListener('click', () => scrollToSection(section.id));
    nav.append(control);
  });
  return nav;
}

function createOutline() {
  const scrim = el('button', 'reading-scrim');
  scrim.type = 'button';
  scrim.tabIndex = -1;
  scrim.setAttribute('aria-label', ui().closeOutline);
  scrim.addEventListener('click', () => toggleOutline(false));
  const drawer = el('aside', 'reading-outline');
  drawer.setAttribute('aria-hidden', 'true');
  drawer.setAttribute('aria-label', ui().outline);
  const head = el('div', 'reading-outline-head');
  head.append(el('b', '', ui().outline));
  const close = button('', '×', ui().closeOutline);
  close.addEventListener('click', () => toggleOutline(false));
  head.append(close);
  const list = el('div', 'reading-outline-list');
  state.document.sections.forEach((section, index) => {
    const control = button('');
    control.dataset.outlineTarget = section.id;
    control.append(el('span', '', String(index + 1).padStart(2, '0')), el('b', '', localized(section.title)));
    control.addEventListener('click', () => { toggleOutline(false); scrollToSection(section.id); });
    list.append(control);
  });
  drawer.append(head, list);
  return { scrim, drawer };
}

function createEnding() {
  const wrap = el('footer', 'reading-ending');
  if (localized(state.document.ending?.title)) wrap.append(el('small', '', state.kind === 'lesson' ? 'Knowledge Pilot' : 'Read'));
  wrap.append(el('h3', '', localized(state.document.ending?.title)));
  appendLocalizedText(wrap, state.document.ending?.text);
  const confidence = el('div', 'reading-confidence');
  confidence.append(el('b', '', ui().confidence));
  const confidenceActions = el('div', 'reading-confidence-actions');
  for (const level of ['low', 'medium', 'high']) {
    const control = button('', ui()[level]);
    control.setAttribute('aria-pressed', String(state.experience?.confidence === level));
    control.addEventListener('click', async () => {
      const saved = await saveExperience({ confidence: level });
      if (saved) [...confidenceActions.querySelectorAll('button')].forEach((item) => item.setAttribute('aria-pressed', String(item === control)));
    });
    confidenceActions.append(control);
  }
  confidence.append(confidenceActions);
  const complete = button('reading-complete-btn', state.record?.status === 'completed' ? ui().completed : ui().complete);
  complete.disabled = state.record?.status === 'completed';
  complete.addEventListener('click', async () => {
    try {
      await api(completePath(), { method: 'POST', body: '{}' });
      state.record.status = 'completed';
      complete.textContent = ui().completed;
      complete.disabled = true;
      toast(ui().completed);
      renderCompletionFeedback(wrap);
    } catch (error) { toast(error.message, 'error'); }
  });
  wrap.append(confidence, complete);
  if (state.record?.status === 'completed') renderCompletionFeedback(wrap);
  return wrap;
}

function renderCompletionFeedback(container) {
  if (container.querySelector('.reading-completion-feedback')) return;
  const row = el('div', 'reading-completion-feedback');
  for (const [label, useful] of [[ui().useful, true], [ui().notUseful, false]]) {
    const control = button('', label);
    control.addEventListener('click', async () => {
      try {
        await api(feedbackPath(), { method: 'POST', body: JSON.stringify({ useful }) });
        toast(ui().feedbackSaved);
      } catch (error) { toast(error.message, 'error'); }
    });
    row.append(control);
  }
  container.append(row);
}

function renderReader() {
  const restoreBlock = state.activeBlockId || state.experience?.anchorId || '';
  const restoreSection = state.activeSectionId || state.experience?.currentSectionId || state.document.sections[0]?.id || '';
  root.replaceChildren();
  setShellDirection();
  const toolbar = createToolbar();
  const hero = createHero();
  const reader = el('div', 'reading-reader');
  const layout = el('div', 'reading-reader-layout');
  const spine = createSpine();
  const article = el('article', 'reading-article');
  state.document.sections.forEach((section, index) => article.append(renderSection(section, index)));
  article.append(createEnding());
  layout.append(spine, article);
  reader.append(layout);
  const { scrim, drawer } = createOutline();
  const definition = createDefinitionPopover();
  root.append(toolbar, hero, reader, scrim, drawer, definition);
  root.hidden = false;
  document.body.classList.add('reading-shell-open');
  setupScrollTracking();
  setupSelectionTracking();
  requestAnimationFrame(() => {
    const target = root.querySelector(`[data-block-id="${cssEscape(restoreBlock)}"]`) || root.querySelector(`[data-section-id="${cssEscape(restoreSection)}"]`);
    if (target) target.scrollIntoView({ block: 'start', behavior: 'auto' });
    updateScrollState();
  });
}

function cssEscape(value) {
  return window.CSS?.escape ? window.CSS.escape(value || '') : String(value || '').replace(/[^a-zA-Z0-9_-]/g, '');
}

function setupScrollTracking() {
  root.removeEventListener('scroll', updateScrollState);
  root.addEventListener('scroll', updateScrollState, { passive: true });
}

function updateScrollState() {
  if (!state.open) return;
  const toolbar = root.querySelector('.reading-sticky');
  const threshold = (toolbar?.getBoundingClientRect().bottom || 64) + 34;
  const sections = [...root.querySelectorAll('.reading-section')];
  let activeSection = sections[0] || null;
  for (const section of sections) if (section.getBoundingClientRect().top <= threshold) activeSection = section;
  if (activeSection) state.activeSectionId = activeSection.dataset.sectionId || '';
  const blocks = activeSection ? [...activeSection.querySelectorAll('[data-block-id]')] : [];
  let activeBlock = blocks[0] || null;
  const blockThreshold = Math.max(threshold + 80, innerHeight * 0.34);
  for (const block of blocks) if (block.getBoundingClientRect().top <= blockThreshold) activeBlock = block;
  if (activeBlock) state.activeBlockId = activeBlock.dataset.blockId || '';

  const currentSectionIndex = Math.max(0, state.document.sections.findIndex((section) => section.id === state.activeSectionId));
  root.querySelector('.reading-current-title')?.replaceChildren(document.createTextNode(localized(state.document.sections[currentSectionIndex]?.title)));
  const currentWbs = root.querySelector('.reading-current-wbs');
  if (currentWbs) currentWbs.textContent = `${String(currentSectionIndex + 1).padStart(2, '0')}.${String(Math.max(1, blocks.indexOf(activeBlock) + 1))}`;
  const meta = root.querySelector('.reading-current-meta');
  if (meta) meta.textContent = `${ui().section} ${currentSectionIndex + 1}/${state.document.sections.length}`;
  root.querySelectorAll('[data-section-target]').forEach((control, index) => {
    control.classList.toggle('active', index === currentSectionIndex);
    control.classList.toggle('done', index < currentSectionIndex);
    if (index === currentSectionIndex) control.setAttribute('aria-current', 'step'); else control.removeAttribute('aria-current');
  });
  root.querySelectorAll('[data-outline-target]').forEach((control, index) => {
    control.classList.toggle('active', index === currentSectionIndex);
    if (index === currentSectionIndex) control.setAttribute('aria-current', 'location'); else control.removeAttribute('aria-current');
  });

  const max = Math.max(1, root.scrollHeight - root.clientHeight);
  const pct = Math.max(0, Math.min(100, Math.round((root.scrollTop / max) * 100)));
  const progress = root.querySelector('.reading-progress');
  if (progress) {
    progress.value = pct;
    progress.setAttribute('aria-valuetext', `${pct}% ${ui().read}`);
  }
  queuePositionSave();
}

function scrollToSection(sectionId) {
  root.querySelector(`[data-section-id="${cssEscape(sectionId)}"]`)?.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}

async function switchLanguage() {
  const blockId = state.activeBlockId;
  const nextLanguage = state.language === 'ar' ? 'en' : 'ar';
  const saved = await saveExperience({ selectedLanguage: nextLanguage, anchorId: blockId, currentSectionId: state.activeSectionId });
  if (!saved) return;
  state.language = nextLanguage;
  renderReader();
  requestAnimationFrame(() => root.querySelector(`[data-block-id="${cssEscape(blockId)}"]`)?.scrollIntoView({ block: 'start', behavior: 'auto' }));
}

function toggleOutline(open) {
  const drawer = root.querySelector('.reading-outline');
  const scrim = root.querySelector('.reading-scrim');
  const main = root.querySelector('.reading-reader');
  const hero = root.querySelector('.reading-hero');
  const toolbar = root.querySelector('.reading-sticky');
  if (!drawer || !scrim) return;
  state.outlineOpen = Boolean(open);
  drawer.classList.toggle('open', state.outlineOpen);
  scrim.classList.toggle('show', state.outlineOpen);
  drawer.setAttribute('aria-hidden', String(!state.outlineOpen));
  toolbar?.querySelector('.reading-outline-btn')?.setAttribute('aria-expanded', String(state.outlineOpen));
  if (state.outlineOpen) {
    state.modalReturnFocus = document.activeElement;
    if (main) main.inert = true;
    if (hero) hero.inert = true;
    drawer.querySelector('button')?.focus({ preventScroll: true });
  } else {
    if (main) main.inert = false;
    if (hero) hero.inert = false;
    state.modalReturnFocus?.focus?.({ preventScroll: true });
  }
}

function createDefinitionPopover() {
  const pop = el('aside', 'reading-definition-pop');
  pop.hidden = true;
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-modal', 'false');
  const close = button('', '×', ui().closeDefinition);
  close.addEventListener('click', closeDefinition);
  pop.append(close, el('b', 'reading-definition-term'), el('p', 'reading-definition-text'));
  return pop;
}

function openDefinition(entry, trigger) {
  closeDefinition(false);
  const pop = root.querySelector('.reading-definition-pop');
  if (!pop) return;
  state.definitionTrigger = trigger;
  pop.querySelector('.reading-definition-term').textContent = localized(entry.term);
  pop.querySelector('.reading-definition-text').textContent = localized(entry.definition);
  pop.hidden = false;
  pop.querySelector('button')?.focus({ preventScroll: true });
}

function closeDefinition(restore = true) {
  const pop = root.querySelector('.reading-definition-pop');
  if (pop) pop.hidden = true;
  if (restore) state.definitionTrigger?.focus?.({ preventScroll: true });
  state.definitionTrigger = null;
}

function updateSelectionTracking() {
  const selection = getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) { state.selection = null; return; }
  const range = selection.getRangeAt(0);
  const common = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement;
  if (!common || !root.contains(common)) { state.selection = null; return; }
  const passage = selection.toString().replace(/\s+/g, ' ').trim().slice(0, 1200);
  if (!passage) { state.selection = null; return; }
  const block = common.closest?.('[data-block-id]');
  const section = common.closest?.('[data-section-id]');
  state.selection = { passage, anchorId: block?.dataset.blockId || state.activeBlockId, sectionId: section?.dataset.sectionId || state.activeSectionId };
}

function setupSelectionTracking() {
  root.removeEventListener('mouseup', updateSelectionTracking);
  root.removeEventListener('keyup', updateSelectionTracking);
  root.addEventListener('mouseup', updateSelectionTracking);
  root.addEventListener('keyup', updateSelectionTracking);
}

async function saveHighlight() {
  if (!state.selection) return toast(ui().selectText, 'error');
  const saved = await saveExperience({}, {
    id: mutationId('highlight'), type: 'highlight', sectionId: state.selection.sectionId, anchorId: state.selection.anchorId,
    passage: state.selection.passage, language: state.language
  });
  if (saved) toast(ui().savedOk);
}

function openNoteDialog(trigger) {
  if (!state.selection) return toast(ui().selectText, 'error');
  openModal({
    title: ui().note,
    trigger,
    build(body, close) {
      const label = el('label', 'reading-field-label', ui().noteLabel);
      const textarea = el('textarea', 'reading-textarea');
      textarea.rows = 5;
      label.append(textarea);
      const actions = el('div', 'reading-modal-actions');
      const cancel = button('', ui().cancel);
      cancel.addEventListener('click', close);
      const save = button('primary', ui().saveNote);
      save.addEventListener('click', async () => {
        const note = textarea.value.trim();
        if (!note) return textarea.focus();
        const saved = await saveExperience({}, {
          id: mutationId('note'), type: 'note', sectionId: state.selection.sectionId, anchorId: state.selection.anchorId,
          passage: state.selection.passage, note, language: state.language
        });
        if (saved) { close(); toast(ui().savedOk); }
      });
      actions.append(cancel, save);
      body.append(label, actions);
      requestAnimationFrame(() => textarea.focus());
    }
  });
}

function openSaved(trigger) {
  openModal({
    title: ui().savedHeading,
    trigger,
    build(body) {
      const entries = [
        ...(state.experience?.highlights || []).map((item) => ({ type: ui().highlight, ...item })),
        ...(state.experience?.notes || []).map((item) => ({ type: ui().note, ...item }))
      ].sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
      if (!entries.length) return body.append(el('p', 'reading-empty', ui().emptySaved));
      for (const entry of entries) {
        const card = el('article', 'reading-saved-card');
        card.append(el('small', '', entry.type));
        if (entry.passage) card.append(el('blockquote', '', entry.passage));
        if (entry.note) card.append(el('p', '', entry.note));
        body.append(card);
      }
    }
  });
}

function openSources(trigger) {
  openModal({
    title: ui().sourceHeading,
    trigger,
    build(body) {
      const sources = Array.isArray(state.record?.sources) ? state.record.sources : [];
      if (!sources.length) return body.append(el('p', 'reading-empty', ui().sourcesEmpty));
      const list = el('ol', 'reading-source-list');
      for (const source of sources) {
        const item = el('li');
        const link = el('a', '', finiteText(source.title || source.domain || source.url || source.id));
        if (source.url) {
          link.href = source.url;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
        }
        item.append(link);
        if (source.domain) item.append(el('small', '', source.domain));
        list.append(item);
      }
      body.append(list);
    }
  });
}

function openFollowUp(trigger) {
  openModal({
    title: ui().followUpHeading,
    trigger,
    build(body) {
      const label = el('label', 'reading-field-label', ui().followUpLabel);
      const textarea = el('textarea', 'reading-textarea');
      textarea.rows = 5;
      label.append(textarea);
      const result = el('div', 'reading-follow-up-result');
      result.setAttribute('role', 'status');
      const send = button('primary', ui().send);
      send.addEventListener('click', async () => {
        const question = textarea.value.trim();
        if (!question) return textarea.focus();
        send.disabled = true;
        try {
          const response = await api(followUpPath(), { method: 'POST', body: JSON.stringify({ question }) });
          result.textContent = response.answer || response.message || (response.pending ? ui().followUpPending : ui().savedOk);
        } catch (error) { result.textContent = error.message; }
        finally { send.disabled = false; }
      });
      body.append(label, send, result);
      requestAnimationFrame(() => textarea.focus());
    }
  });
}

function openSectionFeedback(section, trigger) {
  openModal({
    title: ui().sectionFeedback,
    trigger,
    build(body, close) {
      const categories = [
        ['unclear', ui().unclear], ['too_simple', ui().tooSimple], ['too_detailed', ui().tooDetailed],
        ['not_relevant', ui().notRelevant], ['incorrect', ui().incorrect]
      ];
      let selected = '';
      const group = el('div', 'reading-feedback-categories');
      for (const [value, label] of categories) {
        const control = button('', label);
        control.setAttribute('aria-pressed', 'false');
        control.addEventListener('click', () => {
          selected = value;
          [...group.querySelectorAll('button')].forEach((item) => item.setAttribute('aria-pressed', String(item === control)));
        });
        group.append(control);
      }
      const label = el('label', 'reading-field-label', ui().comment);
      const textarea = el('textarea', 'reading-textarea');
      textarea.rows = 3;
      label.append(textarea);
      const save = button('primary', ui().save);
      save.addEventListener('click', async () => {
        if (!selected) return group.querySelector('button')?.focus();
        const saved = await saveExperience({}, {
          id: mutationId('feedback'), type: 'section_feedback', sectionId: section.id, category: selected,
          comment: textarea.value.trim(), language: state.language
        });
        if (saved) { close(); toast(ui().savedOk); }
      });
      body.append(group, label, save);
    }
  });
}

function openTools(trigger) {
  openModal({
    title: ui().menu,
    trigger,
    className: 'reading-tools-modal',
    build(body, close) {
      const actions = [
        [ui().highlight, async () => { close(false); await saveHighlight(); }],
        [ui().note, () => { close(false); openNoteDialog(trigger); }],
        [ui().saved, () => { close(false); openSaved(trigger); }],
        [ui().sources, () => { close(false); openSources(trigger); }],
        [ui().discuss, () => { close(false); openFollowUp(trigger); }]
      ];
      for (const [label, action] of actions) {
        const control = button('reading-tool-action', label);
        control.addEventListener('click', action);
        body.append(control);
      }
      const theme = button('reading-tool-action', ui().theme);
      theme.addEventListener('click', () => window.KPTheme?.toggleTheme?.());
      body.append(theme);
    }
  });
}

function openModal({ title, trigger, build, className = '' }) {
  closeModal(false);
  state.modalReturnFocus = trigger || document.activeElement;
  const modal = el('div', `reading-modal ${className}`.trim());
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  const panel = el('div', 'reading-modal-panel');
  const headingId = `reading-modal-title-${Date.now()}`;
  const head = el('div', 'reading-modal-head');
  const heading = el('h2', '', title);
  heading.id = headingId;
  modal.setAttribute('aria-labelledby', headingId);
  const closeControl = button('', '×', ui().cancel);
  closeControl.addEventListener('click', () => closeModal());
  head.append(heading, closeControl);
  const body = el('div', 'reading-modal-body');
  const close = (restore = true) => closeModal(restore);
  build(body, close);
  panel.append(head, body);
  modal.append(panel);
  modal.addEventListener('mousedown', (event) => { if (event.target === modal) closeModal(); });
  root.append(modal);
  requestAnimationFrame(() => closeControl.focus({ preventScroll: true }));
}

function closeModal(restore = true) {
  const modal = root.querySelector('.reading-modal');
  if (modal) modal.remove();
  if (restore) state.modalReturnFocus?.focus?.({ preventScroll: true });
}

function trapFocus(event, container) {
  const focusable = [...container.querySelectorAll('button:not([disabled]),a[href],textarea,input,select,[tabindex]:not([tabindex="-1"])')]
    .filter((node) => !node.hidden && node.getAttribute('aria-hidden') !== 'true');
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}

function onKeydown(event) {
  if (!state.open) return;
  if (event.key === 'Escape') {
    if (root.querySelector('.reading-modal')) return closeModal();
    if (!root.querySelector('.reading-definition-pop')?.hidden) return closeDefinition();
    if (state.outlineOpen) return toggleOutline(false);
    return;
  }
  if (event.key === 'Tab') {
    const modal = root.querySelector('.reading-modal');
    if (modal) return trapFocus(event, modal);
    const outline = root.querySelector('.reading-outline.open');
    if (outline) trapFocus(event, outline);
  }
}

document.addEventListener('keydown', onKeydown);

async function loadRoute(route) {
  state.kind = route.kind;
  state.id = route.id;
  root.hidden = false;
  root.replaceChildren(el('div', 'reading-loading', UI.en.loading));
  try {
    const payload = await api(recordPath(route.kind, route.id));
    const record = route.kind === 'book-session' ? payload?.session : payload;
    const relatedBook = route.kind === 'book-session' ? payload?.book : null;
    if (!record || !isReadingDocument(record.readingDocument)) {
      state.open = false;
      root.hidden = true;
      root.replaceChildren();
      document.body.classList.remove('reading-shell-open');
      return;
    }
    state.record = relatedBook ? { ...record, bookTitle: relatedBook.title || record.bookTitle || '' } : record;
    state.document = record.readingDocument;
    state.experience = defaultExperience(record.experience);
    state.language = chooseLanguage(record);
    state.activeSectionId = state.experience.currentSectionId === 'cover' ? state.document.sections[0].id : state.experience.currentSectionId;
    state.activeBlockId = state.experience.anchorId;
    state.open = true;
    state.lastSavedPosition = '';
    renderReader();
    saveExperience({ started: true, selectedLanguage: state.language });
  } catch (error) {
    state.open = false;
    root.hidden = false;
    const notice = el('div', 'reading-loading');
    notice.append(el('b', '', ui().unavailable), el('p', '', error.message));
    root.replaceChildren(notice);
  }
}

async function syncFromHash() {
  const route = parseRoute();
  if (!route) {
    if (state.open) {
      state.open = false;
      clearTimeout(state.positionTimer);
      root.hidden = true;
      root.replaceChildren();
      document.body.classList.remove('reading-shell-open');
    }
    return;
  }
  if (state.open && state.kind === route.kind && state.id === route.id) return;
  await loadRoute(route);
}

window.addEventListener('hashchange', syncFromHash);
window.addEventListener('pageshow', syncFromHash);
queueMicrotask(syncFromHash);
