import {
  buildLessonSections, defaultExperience, isExpectedAnswer, lessonOutcomes,
  lessonPosition, lessonValue, mutationId, remainingMinutes
} from './lesson-experience.js';

const state = { me: null, plans: [], lessons: [], bookSessions: [], books: [], bookDetails: {}, bookProgress: null, progress: null, notices: [], notice: '' };
const $ = (selector) => document.querySelector(selector);
const esc = (value = '') => String(value).replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[c]);
const RTL_LANGUAGES = new Set(['ar', 'fa', 'he', 'ur']);
const expandedLessonCards = new Set(JSON.parse(sessionStorage.getItem('kp-expanded-lessons') || '[]'));
const readerState = { activeIndex: null, saveTimer: null, saveQueue: Promise.resolve(), selection: null, observer: null };
const readerPreferences = (() => {
  try { return { theme: 'system', textSize: 'standard', focus: false, ...JSON.parse(localStorage.getItem('kp-reader-preferences') || '{}') }; }
  catch { return { theme: 'system', textSize: 'standard', focus: false }; }
})();

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || `Request failed (${response.status})`);
    error.status = response.status;
    error.code = data.code || '';
    throw error;
  }
  return data;
}

function showError(error) {
  $('#error').textContent = error.message || String(error);
  $('#error').classList.remove('hidden');
  $('#error').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function clearError() { $('#error').classList.add('hidden'); }

function showToast(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.remove('hidden');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.add('hidden'), 3500);
}

function csv(value) {
  return String(value || '').split(/[,\n]/).map((x) => x.trim()).filter(Boolean);
}

function formatBytes(value) {
  const bytes = Math.max(0, Number(value) || 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function selected(value, expected) { return value === expected ? 'selected' : ''; }
function checked(value) { return value ? 'checked' : ''; }
function lines(items = [], ranked = false) {
  return items.map((item, index) => ranked ? `${index + 1}. ${item}` : item).join('\n');
}

function currentLevel() {
  const ratings = Object.values(state.me?.knowledgeRatings || {});
  if (!ratings.length) return 'mixed';
  return ratings.sort((a, b) => ratings.filter((x) => x === b).length - ratings.filter((x) => x === a).length)[0];
}

function applyLanguage(language) {
  const lang = language || 'en';
  document.documentElement.lang = lang;
  document.documentElement.dir = RTL_LANGUAGES.has(lang) ? 'rtl' : 'ltr';
  document.body.classList.toggle('is-rtl', RTL_LANGUAGES.has(lang));
}

async function load() {
  try {
    state.me = await api('/api/me');
    applyLanguage(state.me.language);
    $('#user-name').textContent = state.me.name;
    $('#loading').classList.add('hidden');
    if (!state.me.onboardingComplete) return renderOnboarding();
    $('#workspace').classList.remove('hidden');
    await refreshData();
  } catch (error) {
    $('#loading').classList.add('hidden');
    showError(error);
  }
}

function profileFormHtml({ id, onboarding = false }) {
  const me = state.me || {};
  const windows = new Set(me.preferredWindows || []);
  const channels = me.channels || {};
  return `<form id="${id}" class="profile-form">
    <section class="form-section">
      <div class="section-heading">
        <div><div class="kicker">${onboarding ? 'Initial profile' : 'Learning profile'}</div><h2>${onboarding ? 'Configure your learning path' : 'Edit your learning path'}</h2></div>
        <p class="muted">${onboarding ? 'This takes approximately 5–10 minutes.' : 'Update your subjects, interests, schedule, or delivery preferences at any time.'}</p>
      </div>
      <div class="form-grid">
        <label>Name<input name="name" value="${esc(me.name)}" required autocomplete="name"></label>
        <label>Learning language<select name="language">
          <option value="ar" ${selected(me.language, 'ar')}>Arabic</option>
          <option value="en" ${selected(me.language, 'en')}>English</option>
          <option value="nl" ${selected(me.language, 'nl')}>Dutch</option>
        </select></label>
        <label>Timezone<input name="timezone" value="${esc(me.timezone || 'Europe/Brussels')}" autocomplete="off"></label>
        <label>General knowledge level<select name="level">
          <option value="beginner" ${selected(currentLevel(), 'beginner')}>Beginner across most selected subjects</option>
          <option value="mixed" ${selected(currentLevel(), 'mixed')}>Mixed</option>
          <option value="advanced_generalist" ${selected(currentLevel(), 'advanced_generalist')}>Advanced generalist</option>
        </select></label>
      </div>
    </section>

    <section class="form-section">
      <div class="section-heading"><div><div class="kicker">Curriculum</div><h3>What should the system teach?</h3></div><p class="muted">Use one item per line or separate items with commas.</p></div>
      <div class="form-grid">
        <label class="full">Broad interests<textarea name="interests" dir="auto" required placeholder="Science\nHistory\nBusiness\nCritical thinking">${esc(lines(me.interests))}</textarea><small>Broad areas used to discover suitable subjects.</small></label>
        <label class="full">Ranked priority topics<textarea name="rankedTopics" dir="auto" required placeholder="1. Critical thinking\n2. Modern history\n3. Business strategy">${esc(lines(me.rankedTopics, true))}</textarea><small>The first topic receives the highest priority.</small></label>
        <label class="full">Topics to avoid<textarea name="avoidedTopics" dir="auto" placeholder="Topics the system should not propose">${esc(lines(me.avoidedTopics))}</textarea></label>
        <label class="full">Questions you genuinely want to understand<textarea name="exampleQuestions" dir="auto" placeholder="Why do intelligent people believe misinformation?">${esc(lines(me.exampleQuestions))}</textarea></label>
      </div>
    </section>

    <section class="form-section">
      <div class="section-heading"><div><div class="kicker">Routine</div><h3>When and where should learning happen?</h3></div></div>
      <div class="choice-grid">
        <label class="choice"><input type="checkbox" name="preferredWindows" value="morning" ${checked(windows.has('morning'))}><span><strong>Morning</strong><small>Start the day with a lesson</small></span></label>
        <label class="choice"><input type="checkbox" name="preferredWindows" value="travel" ${checked(windows.has('travel'))}><span><strong>Travel</strong><small>Commute or time away from a desk</small></span></label>
        <label class="choice"><input type="checkbox" name="preferredWindows" value="evening" ${checked(windows.has('evening'))}><span><strong>Evening</strong><small>Quiet end-of-day learning</small></span></label>
      </div>
      <div class="choice-grid compact-choices">
        <label class="choice"><input type="checkbox" name="telegram" ${checked(channels.telegram)}><span><strong>Telegram</strong><small>Lessons and interactions</small></span></label>
        <label class="choice"><input type="checkbox" name="whatsapp" ${checked(channels.whatsapp)}><span><strong>WhatsApp</strong><small>Optional secondary delivery</small></span></label>
      </div>
    </section>

    <section class="form-section">
      <div class="section-heading"><div><div class="kicker">Automation</div><h3>Keep learning moving automatically</h3></div><p class="muted">Validated content is scheduled automatically. You remain able to review, reschedule, revise, or skip it.</p></div>
      <div class="choice-grid compact-choices">
        <label class="choice"><input type="checkbox" name="autoScheduleApproved" ${checked(me.automation?.autoScheduleApproved !== false)}><span><strong>Automatically schedule validated content</strong><small>Recommended for a seamless workflow</small></span></label>
        <label class="choice"><input type="checkbox" name="notifyActionRequired" ${checked(me.automation?.notifyActionRequired !== false)}><span><strong>Notify me when action is required</strong><small>Uses linked Telegram or WhatsApp</small></span></label>
      </div>
      <div class="form-grid"><label>Automatic delivery delay (minutes)<input type="number" name="autoScheduleDelayMinutes" min="0" max="1440" value="${Number(me.automation?.autoScheduleDelayMinutes ?? 2)}"></label></div>
    </section>

    <div class="form-actions">
      <button type="submit">${onboarding ? 'Create my learning profile' : 'Save profile changes'}</button>
      ${onboarding ? '<span class="muted">Knowledge Pilot will start preparing your first plan automatically.</span>' : '<span class="muted">Changes affect future plans and lessons; completed lessons remain unchanged.</span>'}
    </div>
  </form>`;
}

function readProfileForm(formElement) {
  const form = new FormData(formElement);
  const rankedTopics = csv(form.get('rankedTopics')).map((x) => x.replace(/^\d+[.)]\s*/, ''));
  const level = String(form.get('level') || 'mixed');
  const existingRatings = state.me.knowledgeRatings || {};
  const knowledgeRatings = Object.fromEntries(rankedTopics.map((topic) => [topic, existingRatings[topic] || level]));
  return {
    name: form.get('name'),
    language: form.get('language'),
    timezone: form.get('timezone'),
    interests: csv(form.get('interests')),
    rankedTopics,
    avoidedTopics: csv(form.get('avoidedTopics')),
    exampleQuestions: csv(form.get('exampleQuestions')),
    preferredWindows: form.getAll('preferredWindows'),
    knowledgeRatings,
    channels: {
      web: true,
      telegram: form.get('telegram') === 'on',
      whatsapp: form.get('whatsapp') === 'on'
    },
    automation: {
      autoScheduleApproved: form.get('autoScheduleApproved') === 'on',
      notifyActionRequired: form.get('notifyActionRequired') === 'on',
      autoScheduleDelayMinutes: Number(form.get('autoScheduleDelayMinutes') || 0)
    }
  };
}

function bindProfileForm(formId, { onboarding = false } = {}) {
  const form = document.getElementById(formId);
  if (!form) return;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearError();
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    const originalText = button.textContent;
    button.textContent = onboarding ? 'Creating profile…' : 'Saving changes…';
    try {
      await api('/api/onboarding', { method: 'POST', body: JSON.stringify(readProfileForm(form)) });
      state.me = await api('/api/me');
      applyLanguage(state.me.language);
      $('#user-name').textContent = state.me.name;
      if (onboarding) {
        $('#onboarding').classList.add('hidden');
        $('#workspace').classList.remove('hidden');
      }
      await refreshData();
      showToast(onboarding ? 'Your learning profile is ready.' : 'Learning profile updated.');
      if (!onboarding) switchTab('settings');
    } catch (error) {
      showError(error);
    } finally {
      button.disabled = false;
      button.textContent = originalText;
    }
  });
}

function renderOnboarding() {
  const el = $('#onboarding');
  el.classList.remove('hidden');
  el.innerHTML = `<div class="card onboarding-card">${profileFormHtml({ id: 'onboarding-form', onboarding: true })}</div>`;
  bindProfileForm('onboarding-form', { onboarding: true });
}

async function refreshData() {
  [state.plans, state.lessons, state.bookSessions, state.books, state.bookProgress, state.progress, state.me, state.notices] = await Promise.all([
    api('/api/plans'), api('/api/lessons'), api('/api/book-sessions'), api('/api/books'), api('/api/book-progress'), api('/api/progress'), api('/api/me'), api('/api/notices')
  ]);
  state.bookDetails = {};
  const details = await Promise.all(state.books.map((book) => api(`/api/books/${book.id}`).catch(() => null)));
  for (const detail of details) if (detail?.book) state.bookDetails[detail.book.id] = detail;
  applyLanguage(state.me.language);
  $('#user-name').textContent = state.me.name;
  renderToday(); renderPlan(); renderBooks(); renderLibrary(); renderProgress(); renderSettings();
}

function selectedLesson() {
  const id = location.hash.match(/lesson=([^&]+)/)?.[1];
  return id ? state.lessons.find((lesson) => lesson.id === id) || null : null;
}

function reviewRequired(item) {
  return ['needs_review', 'needs_changes'].includes(item?.reviewStatus);
}

function workflowLabel(item) {
  if (item.reviewStatus === 'revision_queued') return 'Revision queued';
  if (reviewRequired(item)) return 'Needs your review';
  if (item.status === 'scheduled') return item.scheduledAt ? `Scheduled ${new Date(item.scheduledAt).toLocaleString()}` : 'Scheduled';
  if (item.status === 'delivered') return 'Ready now';
  if (item.status === 'completed') return 'Completed';
  if (item.status === 'skipped') return 'Skipped';
  if (item.reviewStatus === 'approved') return 'Validated';
  return item.status || 'Processing';
}

function list(items, ordered = false) {
  if (!items?.length) return '';
  const tag = ordered ? 'ol' : 'ul';
  return `<${tag}>${items.map((item) => `<li dir="auto">${esc(item)}</li>`).join('')}</${tag}>`;
}

function reviewCard(kind, item, book = null) {
  const title = kind === 'book' ? `${book?.title || 'Book'} — Session ${item.sessionNumber}: ${item.title}` : item.title;
  return `<div class="list-item action-required-card">
    <div class="lesson-meta"><span class="badge warn">Needs your review</span><span class="muted">${item.estimatedMinutes || 8} min</span></div>
    <h3 dir="auto">${esc(title)}</h3>
    ${item.quality?.issues?.length ? `<p class="muted" dir="auto">${esc(item.quality.issues.join(' · '))}</p>` : '<p class="muted">Automated validation held this item for your decision.</p>'}
    <div class="actions">
      <button class="review-accept" data-kind="${kind}" data-id="${item.id}">Accept and schedule</button>
      <button class="secondary review-preview" data-kind="${kind}" data-id="${item.id}">Preview</button>
      <button class="ghost review-revise" data-kind="${kind}" data-id="${item.id}">Request changes</button>
      <button class="ghost review-skip" data-kind="${kind}" data-id="${item.id}">Skip</button>
    </div>
  </div>`;
}

function openScheduleDialog(kind, id, currentAt = '') {
  const dialog = $('#dialog');
  const endpoint = kind === 'book' ? '/api/book-sessions' : '/api/lessons';
  const suggested = currentAt ? new Date(currentAt) : new Date(Date.now() + 5 * 60_000);
  const localValue = new Date(suggested.getTime() - suggested.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  dialog.classList.remove('hidden');
  dialog.innerHTML = `<div class="card"><div class="dialog-heading"><h2>Choose delivery time</h2><button type="button" class="icon-button ghost" id="close-dialog" aria-label="Close">×</button></div><form id="schedule-form"><label>Delivery date and time<input type="datetime-local" name="runAt" value="${esc(localValue)}" required></label><div class="actions dialog-actions"><button>Save schedule</button><button type="button" class="ghost" id="deliver-immediately">Deliver now</button></div></form></div>`;
  const close = () => dialog.classList.add('hidden');
  $('#close-dialog').onclick = close;
  $('#schedule-form').onsubmit = async (event) => {
    event.preventDefault();
    const value = new FormData(event.target).get('runAt');
    const runAt = new Date(String(value));
    if (Number.isNaN(runAt.getTime())) return showError(new Error('Choose a valid delivery time.'));
    await api(`${endpoint}/${id}/schedule`, { method: 'POST', body: JSON.stringify({ runAt: runAt.toISOString() }) });
    close(); await refreshData(); showToast('Delivery schedule updated.');
  };
  $('#deliver-immediately').onclick = async () => {
    await api(`${endpoint}/${id}/schedule`, { method: 'POST', body: JSON.stringify({ runAt: new Date().toISOString() }) });
    close(); await refreshData(); showToast('Queued for immediate delivery.');
  };
}

function bindReviewActions(root = document) {
  root.querySelectorAll('.review-accept').forEach((button) => button.onclick = async () => {
    const base = button.dataset.kind === 'book' ? '/api/book-sessions' : '/api/lessons';
    button.disabled = true;
    try {
      await api(`${base}/${button.dataset.id}/review`, { method: 'POST', body: JSON.stringify({ decision: 'approve', note: 'Accepted by learner' }) });
      await refreshData(); showToast('Accepted and scheduled automatically.');
    } catch (error) { showError(error); } finally { button.disabled = false; }
  });
  root.querySelectorAll('.review-preview').forEach((button) => button.onclick = () => {
    if (button.dataset.kind === 'book') { location.hash = `book-session=${button.dataset.id}`; switchTab('books'); renderBooks(); }
    else { location.hash = `lesson=${button.dataset.id}`; switchTab('today'); renderToday(); }
  });
  root.querySelectorAll('.review-revise').forEach((button) => button.onclick = async () => {
    const note = prompt('What should be corrected or changed?');
    if (note === null) return;
    const base = button.dataset.kind === 'book' ? '/api/book-sessions' : '/api/lessons';
    button.disabled = true;
    try { await api(`${base}/${button.dataset.id}/revise`, { method: 'POST', body: JSON.stringify({ note }) }); await refreshData(); showToast('Revision queued for verified processing.'); }
    catch (error) { showError(error); }
    finally { button.disabled = false; }
  });
  root.querySelectorAll('.review-skip').forEach((button) => button.onclick = async () => {
    const base = button.dataset.kind === 'book' ? '/api/book-sessions' : '/api/lessons';
    button.disabled = true;
    try { await api(`${base}/${button.dataset.id}/skip`, { method: 'POST', body: '{}' }); await refreshData(); showToast('Item skipped.'); }
    catch (error) { showError(error); }
    finally { button.disabled = false; }
  });
}

function renderToday() {
  const lesson = selectedLesson();
  if (lesson) return renderLessonExperience(lesson);
  renderTodayCards();
}

function uiText(lesson, key) {
  const arabic = RTL_LANGUAGES.has(lesson?.language);
  const words = {
    en: {
      today: 'Today', primary: 'Primary lesson', also: 'Also available', whyNow: 'Why this lesson now?',
      outcomes: 'What you will understand', outline: 'Lesson outline', start: 'Start lesson', continueLesson: 'Continue lesson',
      details: 'Details', hideDetails: 'Hide details', newLesson: 'Not started', inProgress: 'In progress', completed: 'Completed',
      back: 'Back to Today', begin: 'Begin lesson', resume: 'Resume where I stopped', welcomeBack: 'Welcome back',
      reviewLast: 'Review the last section', minutes: 'minutes', section: 'Section', remaining: 'remaining',
      next: 'Next section', complete: 'Complete lesson', skipSection: 'Skip optional section', outlineButton: 'Outline',
      sources: 'Sources', notes: 'Saved', reading: 'Reading settings', focus: 'Focus', leaveFocus: 'Leave focus',
      more: 'More', optional: 'Optional depth', selectAnswer: 'Choose an answer', check: 'Check answer',
      retry: 'Try again', continue: 'Continue', skipCheck: 'Skip', correct: 'That’s it.', notQuite: 'Not quite.',
      privateAnswer: 'Your response is saved privately.', saveResponse: 'Save response', summary: 'Lesson complete',
      confidence: 'How clear does this feel now?', low: 'Not yet clear', medium: 'Mostly clear', high: 'Very clear',
      nextReview: 'Next review', nextLesson: 'Next lesson', noItems: 'No lessons are due right now',
      dailyHeading: 'One clear lesson, at your pace.', about: 'About', exampleLabel: 'Example', perspectiveLabel: 'Perspective',
      limitationLabel: 'Limitation', continueEssential: 'Continue essential path',
      answerSuccess: 'You identified the essential distinction.', keyIdea: 'The key idea is',
      sectionActions: 'Section actions', simpler: 'Explain more simply', deeper: 'Go deeper',
      anotherExample: 'Give another example', challenge: 'Challenge this claim', summarize: 'Summarize this section',
      savePoint: 'Save this point', report: 'Report unclear or incorrect content', aiOnDemand: 'AI actions run only when you explicitly choose them.',
      addNote: 'Add a private note', note: 'Note', saveNote: 'Save note', savedEmpty: 'Highlights and notes you save will appear here.',
      readingTheme: 'Reading theme', deviceDefault: 'Device default', softLight: 'Soft light', softDark: 'Soft dark',
      warmTheme: 'Warm / sepia', textSize: 'Text size', comfortable: 'Comfortable', large: 'Large', xlarge: 'Extra large', apply: 'Apply',
      connectionLabel: 'Connection', savedItems: 'saved items', highlightLabel: 'Highlight', noteLabel: 'Note'
      , discussTitle: 'Discuss this context', questionLabel: 'Question', aiProcessing: 'This action uses verified AI processing only when you submit it.',
      ask: 'Ask', cancel: 'Cancel'
    },
    ar: {
      today: 'اليوم', primary: 'الدرس الرئيسي', also: 'متاح أيضًا', whyNow: 'لماذا هذا الدرس الآن؟',
      outcomes: 'ما الذي ستفهمه', outline: 'مخطط الدرس', start: 'ابدأ الدرس', continueLesson: 'تابع الدرس',
      details: 'التفاصيل', hideDetails: 'إخفاء التفاصيل', newLesson: 'لم يبدأ', inProgress: 'قيد التعلّم', completed: 'مكتمل',
      back: 'العودة إلى اليوم', begin: 'ابدأ الدرس', resume: 'تابع من حيث توقفت', welcomeBack: 'مرحبًا بعودتك',
      reviewLast: 'راجع القسم السابق', minutes: 'دقائق', section: 'القسم', remaining: 'متبقية',
      next: 'القسم التالي', complete: 'أكمل الدرس', skipSection: 'تخطَّ القسم الاختياري', outlineButton: 'المخطط',
      sources: 'المصادر', notes: 'المحفوظات', reading: 'إعدادات القراءة', focus: 'تركيز', leaveFocus: 'إنهاء التركيز',
      more: 'المزيد', optional: 'تعمّق اختياري', selectAnswer: 'اختر إجابة', check: 'تحقق من الإجابة',
      retry: 'حاول مرة أخرى', continue: 'تابع', skipCheck: 'تخطَّ', correct: 'صحيح.', notQuite: 'ليست دقيقة تمامًا.',
      privateAnswer: 'حُفظت إجابتك بشكل خاص.', saveResponse: 'احفظ الإجابة', summary: 'اكتمل الدرس',
      confidence: 'ما مدى وضوح الفكرة الآن؟', low: 'غير واضحة بعد', medium: 'واضحة غالبًا', high: 'واضحة جدًا',
      nextReview: 'المراجعة التالية', nextLesson: 'الدرس التالي', noItems: 'لا توجد دروس مستحقة الآن',
      dailyHeading: 'درس واحد واضح، وبالوتيرة التي تناسبك.', about: 'نحو', exampleLabel: 'مثال', perspectiveLabel: 'وجهة نظر',
      limitationLabel: 'حدود الفكرة', continueEssential: 'تابع المسار الأساسي',
      answerSuccess: 'لقد حدّدت التمييز الأساسي.', keyIdea: 'الفكرة الأساسية هي',
      sectionActions: 'إجراءات القسم', simpler: 'اشرح بصورة أبسط', deeper: 'تعمّق أكثر',
      anotherExample: 'قدّم مثالًا آخر', challenge: 'اختبر هذا الادعاء', summarize: 'لخّص هذا القسم',
      savePoint: 'احفظ هذه النقطة', report: 'أبلغ عن محتوى غير واضح أو غير دقيق', aiOnDemand: 'لا تُستخدم معالجة الذكاء الاصطناعي إلا عندما تختارها صراحةً.',
      addNote: 'أضف ملاحظة خاصة', note: 'الملاحظة', saveNote: 'احفظ الملاحظة', savedEmpty: 'ستظهر هنا النقاط المظللة والملاحظات التي تحفظها.',
      readingTheme: 'سمة القراءة', deviceDefault: 'إعداد الجهاز', softLight: 'فاتح هادئ', softDark: 'داكن هادئ',
      warmTheme: 'دافئ / بني فاتح', textSize: 'حجم النص', comfortable: 'مريح', large: 'كبير', xlarge: 'كبير جدًا', apply: 'تطبيق',
      connectionLabel: 'صلة معرفية', savedItems: 'عناصر محفوظة', highlightLabel: 'تظليل', noteLabel: 'ملاحظة'
      , discussTitle: 'ناقش هذا السياق', questionLabel: 'السؤال', aiProcessing: 'لا تُستخدم معالجة الذكاء الاصطناعي الموثّقة إلا عند إرسال السؤال.',
      ask: 'اسأل', cancel: 'إلغاء'
    }
  };
  return (arabic ? words.ar : words.en)[key] || words.en[key] || key;
}

function sectionTitle(lesson, section) {
  if (!RTL_LANGUAGES.has(lesson?.language)) return section.title;
  return ({
    opening: 'ابدأ بالسؤال', 'mental-map': 'الخريطة الذهنية', core: 'الشرح الأساسي', context: 'السياق الضروري',
    example: 'مثال عملي', perspectives: 'وجهات نظر أخرى', limitations: 'الحدود والمفاهيم الخاطئة',
    application: 'لماذا يهم هذا عمليًا', connection: 'اربطه بما تعرفه', check: 'تحقق من فهمك',
    takeaway: 'الخلاصة العملية', reflection: 'توقّف وفكّر'
  })[section.id] || section.title;
}

function backArrow(lesson) {
  return RTL_LANGUAGES.has(lesson?.language) ? '→' : '←';
}

function positionLabel(lesson, position) {
  if (RTL_LANGUAGES.has(lesson?.language) && position.current && position.total) return `الدرس ${position.current} من ${position.total}`;
  return position.label;
}

function availableTodayLessons() {
  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
  return state.lessons
    .filter((lesson) => lesson.status === 'delivered' || (lesson.status === 'completed' && new Date(lesson.completedAt || 0).getTime() >= oneDayAgo))
    .sort((a, b) => {
      const aActive = a.status === 'delivered' ? 1 : 0;
      const bActive = b.status === 'delivered' ? 1 : 0;
      return bActive - aActive || String(b.deliveredAt || b.updatedAt || '').localeCompare(String(a.deliveredAt || a.updatedAt || ''));
    });
}

function lessonProgressLabel(lesson) {
  const experience = defaultExperience(lesson);
  if (lesson.status === 'completed') return uiText(lesson, 'completed');
  if (experience.startedAt || lesson.resumePercent > 0) return uiText(lesson, 'inProgress');
  return uiText(lesson, 'newLesson');
}

function todayLessonCard(lesson, index) {
  const experience = defaultExperience(lesson);
  const expanded = expandedLessonCards.has(lesson.id);
  const outcomes = lessonOutcomes(lesson);
  const sections = buildLessonSections(lesson);
  const position = lessonPosition(lesson, state.plans);
  const primary = index === 0;
  const started = Boolean(experience.startedAt || lesson.resumePercent > 0);
  const detailsId = `lesson-details-${lesson.id}`;
  return `<article class="today-lesson-card ${primary ? 'is-primary' : ''}" dir="${RTL_LANGUAGES.has(lesson.language) ? 'rtl' : 'ltr'}">
    <div class="today-card-main">
      <div class="today-card-kicker">${esc(primary ? uiText(lesson, 'primary') : uiText(lesson, 'also'))}</div>
      <h2 dir="auto">${esc(lesson.title)}</h2>
      <p class="today-card-value" dir="auto">${esc(lessonValue(lesson))}</p>
      <div class="today-card-meta" aria-label="Lesson information">
        <span>${esc(positionLabel(lesson, position))}</span><span aria-hidden="true">·</span>
        <span>${Number(lesson.estimatedMinutes) || 8} ${esc(uiText(lesson, 'minutes'))}</span><span aria-hidden="true">·</span>
        <span>${esc(lessonProgressLabel(lesson))}${lesson.resumePercent > 0 && lesson.status !== 'completed' ? ` · ${Number(lesson.resumePercent)}%` : ''}</span>
      </div>
      ${lesson.resumePercent > 0 && lesson.status !== 'completed' ? `<div class="lesson-progress-track" role="progressbar" aria-label="Lesson progress" aria-valuenow="${Number(lesson.resumePercent)}" aria-valuemin="0" aria-valuemax="100"><span style="inline-size:${Number(lesson.resumePercent)}%"></span></div>` : ''}
      <div class="today-card-actions">
        <button class="open-lesson-cover" data-id="${lesson.id}">${esc(started ? uiText(lesson, 'continueLesson') : uiText(lesson, 'start'))}</button>
        <button class="ghost toggle-lesson-details" data-id="${lesson.id}" aria-expanded="${expanded}" aria-controls="${detailsId}">${esc(expanded ? uiText(lesson, 'hideDetails') : uiText(lesson, 'details'))}</button>
      </div>
    </div>
    <div id="${detailsId}" class="today-card-details ${expanded ? '' : 'hidden'}">
      <div><h3>${esc(uiText(lesson, 'outcomes'))}</h3>${list(outcomes)}</div>
      <div><h3>${esc(uiText(lesson, 'outline'))}</h3><ol>${sections.slice(0, 6).map((section) => `<li>${esc(sectionTitle(lesson, section))}</li>`).join('')}</ol></div>
      <div><h3>${esc(uiText(lesson, 'whyNow'))}</h3><p dir="auto">${esc(lesson.question || lessonValue(lesson))}</p></div>
    </div>
  </article>`;
}

function renderTodayCards() {
  document.body.classList.remove('lesson-focus');
  document.body.classList.remove('is-reading-lesson');
  document.body.dataset.readerTheme = '';
  const el = $('#tab-today');
  const lessons = availableTodayLessons();
  const deliveredBook = state.bookSessions.filter((item) => item.status === 'delivered')
    .sort((a, b) => String(b.deliveredAt || '').localeCompare(String(a.deliveredAt || '')))[0];
  const reviewLessons = state.lessons.filter(reviewRequired);
  const reviewSessions = state.bookSessions.filter(reviewRequired);
  const actionItems = [
    ...reviewLessons.map((item) => reviewCard('lesson', item)),
    ...reviewSessions.map((item) => reviewCard('book', item, state.books.find((book) => book.id === item.bookId)))
  ];
  const actionHtml = actionItems.length ? `<div class="card"><div class="section-heading"><div><div class="kicker">Action required</div><h2>Review held content</h2></div><span class="badge warn">${actionItems.length}</span></div><p class="muted">Only content held by validation needs your decision.</p><div class="list">${actionItems.join('')}</div></div>` : '';
  const notices = state.notices.slice(0, 3).map((message) => message.notice || message).filter(Boolean);
  const noticeHtml = notices.length ? `<div class="card compact-notices"><div class="section-heading"><h2>Recent activity</h2></div><div class="list">${notices.map((notice) => `<div class="list-item"><strong>${esc(notice.title || 'Knowledge Pilot')}</strong><p class="muted">${esc(notice.message || '')}</p>${notice.actionUrl ? `<a href="${esc(notice.actionUrl)}">${esc(notice.actionLabel || 'Open')}</a>` : ''}</div>`).join('')}</div></div>` : '';
  const bookHtml = deliveredBook ? (() => {
    const book = state.books.find((item) => item.id === deliveredBook.bookId);
    return `<article class="today-lesson-card book-today-card"><div class="today-card-main"><div class="today-card-kicker">Book session</div><h2 dir="auto">${esc(book?.title || 'Book')} — Session ${Number(deliveredBook.sessionNumber) || 1}</h2><p class="today-card-value" dir="auto">${esc(deliveredBook.title || deliveredBook.content?.summary || '')}</p><div class="today-card-meta"><span>${Number(deliveredBook.estimatedMinutes) || 8} minutes</span><span aria-hidden="true">·</span><span>Ready now</span></div><div class="today-card-actions"><button id="open-today-book">Open book session</button></div></div></article>`;
  })() : '';
  if (lessons.length || deliveredBook) {
    const languageLesson = lessons[0] || { language: state.me.language };
    el.innerHTML = `<div class="today-heading"><div class="kicker">${esc(uiText(languageLesson, 'today'))}</div><h1>${esc(uiText(languageLesson, 'dailyHeading'))}</h1></div>
      <div class="today-lessons">${lessons.slice(0, 4).map(todayLessonCard).join('')}${bookHtml}</div>${actionHtml}${noticeHtml}`;
    el.querySelectorAll('.open-lesson-cover').forEach((button) => button.onclick = () => {
      readerState.activeIndex = null;
      location.hash = `lesson=${encodeURIComponent(button.dataset.id)}`;
    });
    el.querySelectorAll('.toggle-lesson-details').forEach((button) => button.onclick = () => {
      const id = button.dataset.id;
      if (expandedLessonCards.has(id)) expandedLessonCards.delete(id);
      else {
        if (window.innerWidth < 640) expandedLessonCards.clear();
        expandedLessonCards.add(id);
      }
      sessionStorage.setItem('kp-expanded-lessons', JSON.stringify([...expandedLessonCards]));
      renderTodayCards();
      document.querySelector(`[data-id="${CSS.escape(id)}"].toggle-lesson-details`)?.focus();
    });
    if ($('#open-today-book')) $('#open-today-book').onclick = () => {
      location.hash = `book-session=${deliveredBook.id}`;
      switchTab('books');
      renderBooks();
    };
    bindReviewActions(el);
    return;
  }
  const workflow = state.me.workflow || {};
  let message = 'Knowledge Pilot will prepare and deliver the next validated item automatically.';
  if (state.me.pendingBusinessTasks) message = `${state.me.pendingBusinessTasks} verified-processing task${state.me.pendingBusinessTasks === 1 ? '' : 's'} are waiting.`;
  else if (workflow.scheduledDeliveries) message = `Your next validated item is scheduled${workflow.nextJob?.runAt ? ` for ${new Date(workflow.nextJob.runAt).toLocaleString()}` : ''}.`;
  el.innerHTML = `${actionHtml}<div class="card empty-state"><div class="kicker">${esc(uiText(state.lessons[0], 'today'))}</div><h2>${esc(uiText(state.lessons[0], 'noItems'))}</h2><p>${esc(message)}</p><button id="today-plan">Open weekly plan</button></div>${noticeHtml}`;
  $('#today-plan').onclick = () => switchTab('plan');
  bindReviewActions(el);
}

function persistReaderPreferences() {
  localStorage.setItem('kp-reader-preferences', JSON.stringify(readerPreferences));
  applyReaderPreferences();
}

function applyReaderPreferences() {
  document.body.dataset.readerTheme = readerPreferences.theme;
  document.body.dataset.readerText = readerPreferences.textSize;
  document.body.classList.toggle('lesson-focus', Boolean(readerPreferences.focus && selectedLesson() && location.hash.includes('reader=1')));
}

function lessonById(id) {
  return state.lessons.find((item) => item.id === id);
}

async function saveExperience(lessonId, patch, { retry = true } = {}) {
  const run = async () => {
    const lesson = lessonById(lessonId);
    if (!lesson) return null;
    const experience = defaultExperience(lesson);
    const payload = { ...patch, baseRevision: experience.revision };
    const pendingKey = `kp-pending-experience-${state.me.id}-${lessonId}`;
    localStorage.setItem(pendingKey, JSON.stringify(payload));
    try {
      const result = await api(`/api/lessons/${lessonId}/experience`, { method: 'POST', body: JSON.stringify(payload), keepalive: true });
      lesson.experience = result.experience;
      lesson.resumePercent = result.resumePercent;
      localStorage.removeItem(pendingKey);
      return result;
    } catch (error) {
      if (error.status === 409 && retry) {
        const current = await api(`/api/lessons/${lessonId}`);
        const index = state.lessons.findIndex((item) => item.id === lessonId);
        if (index >= 0) state.lessons[index] = current;
        const rebased = { ...patch, baseRevision: defaultExperience(current).revision };
        const result = await api(`/api/lessons/${lessonId}/experience`, { method: 'POST', body: JSON.stringify(rebased), keepalive: true });
        current.experience = result.experience;
        current.resumePercent = result.resumePercent;
        localStorage.removeItem(pendingKey);
        return result;
      }
      if (!navigator.onLine || error instanceof TypeError) showToast('Saved on this device. It will sync when the connection returns.');
      else showError(error);
      throw error;
    }
  };
  readerState.saveQueue = readerState.saveQueue.then(run, run);
  return readerState.saveQueue;
}

function debouncedExperienceSave(lessonId, patch) {
  clearTimeout(readerState.saveTimer);
  readerState.saveTimer = setTimeout(() => saveExperience(lessonId, patch).catch(() => {}), 650);
}

async function retryPendingExperience() {
  if (!state.me || !navigator.onLine) return;
  for (const lesson of state.lessons) {
    const key = `kp-pending-experience-${state.me.id}-${lesson.id}`;
    const pending = localStorage.getItem(key);
    if (!pending) continue;
    try { await saveExperience(lesson.id, JSON.parse(pending)); } catch {}
  }
}

function highlightedText(raw, lesson, sectionId) {
  const value = String(raw || '');
  const passages = defaultExperience(lesson).highlights.filter((item) => item.sectionId === sectionId).map((item) => item.passage).filter(Boolean);
  if (!passages.length) return esc(value);
  let cursor = 0;
  let html = '';
  const matches = passages.map((passage) => ({ passage, index: value.indexOf(passage) })).filter((match) => match.index >= 0).sort((a, b) => a.index - b.index);
  for (const match of matches) {
    if (match.index < cursor) continue;
    html += esc(value.slice(cursor, match.index));
    html += `<mark>${esc(match.passage)}</mark>`;
    cursor = match.index + match.passage.length;
  }
  return html + esc(value.slice(cursor));
}

function renderSectionBlocks(section, lesson) {
  const items = section.blocks || [];
  if (section.kind === 'key') return `<div class="content-block key-point"><ol>${items.map((item, index) => `<li id="${section.id}-block-${index}" dir="auto">${highlightedText(item, lesson, section.id)}</li>`).join('')}</ol></div>`;
  if (['example', 'comparison', 'caution'].includes(section.kind)) {
    return items.map((item, index) => `<div id="${section.id}-block-${index}" class="content-block ${section.kind}" dir="auto"><div class="block-label">${esc(section.kind === 'caution' ? uiText(lesson, 'limitationLabel') : section.kind === 'example' ? uiText(lesson, 'exampleLabel') : uiText(lesson, 'perspectiveLabel'))}</div><p>${highlightedText(item, lesson, section.id)}</p></div>`).join('');
  }
  return items.map((item, index) => `<p id="${section.id}-block-${index}" dir="auto">${highlightedText(item, lesson, section.id)}</p>`).join('');
}

function renderKnowledgeCheck(section, lesson) {
  const check = section.check;
  const saved = defaultExperience(lesson).answers[check.id];
  const selectedAnswer = saved?.answer || '';
  const answered = Boolean(saved);
  const feedback = answered ? `<div class="answer-feedback ${saved.correct ? 'is-correct' : 'is-incorrect'}" role="status"><strong>${esc(uiText(lesson, saved.correct ? 'correct' : 'notQuite'))}</strong><p dir="auto">${esc(saved.correct ? uiText(lesson, 'answerSuccess') : `${uiText(lesson, 'keyIdea')}: ${check.expected}`)}</p></div>` : '';
  return `<form id="lesson-check-form" class="knowledge-check">
    <fieldset><legend dir="auto">${esc(check.question)}</legend>
      ${check.options.map((option, index) => `<label class="check-option"><input type="radio" name="answer" value="${esc(option)}" ${selectedAnswer === option ? 'checked' : ''}><span dir="auto">${esc(option)}</span></label>`).join('')}
    </fieldset>
    ${feedback}
    <div class="actions">${!answered ? `<button type="button" class="ghost" id="skip-check">${esc(uiText(lesson, 'skipCheck'))}</button>` : ''}</div>
  </form>`;
}

function renderLessonCover(lesson) {
  const el = $('#tab-today');
  const experience = defaultExperience(lesson);
  const outcomes = lessonOutcomes(lesson);
  const position = lessonPosition(lesson, state.plans);
  const held = reviewRequired(lesson) || lesson.reviewStatus === 'revision_queued';
  const started = Boolean(experience.startedAt || lesson.resumePercent > 0);
  const lessonDir = RTL_LANGUAGES.has(lesson.language) ? 'rtl' : 'ltr';
  el.innerHTML = `<div class="lesson-shell lesson-cover-shell" dir="${lessonDir}">
    <button class="reader-back ghost" id="exit-lesson">${backArrow(lesson)} ${esc(uiText(lesson, 'back'))}</button>
    <article class="lesson-cover">
      <div class="lesson-cover-position">${esc(positionLabel(lesson, position))}</div>
      <h1 dir="auto">${esc(lesson.title)}</h1>
      <p class="lesson-cover-value" dir="auto">${esc(lessonValue(lesson))}</p>
      <div class="lesson-cover-outcomes"><h2>${esc(uiText(lesson, 'outcomes'))}</h2>${list(outcomes)}</div>
      <div class="lesson-cover-meta"><span>${esc(uiText(lesson, 'about'))} ${Number(lesson.estimatedMinutes) || 8} ${esc(uiText(lesson, 'minutes'))}</span><span>${esc(lessonProgressLabel(lesson))}</span></div>
      ${started && experience.lastActivityAt ? `<aside class="welcome-back"><strong>${esc(uiText(lesson, 'welcomeBack'))}</strong><p dir="auto">${esc(lesson.content?.keyIdeas?.[0] || lessonValue(lesson))}</p></aside>` : ''}
      <div class="lesson-cover-actions">
        ${['delivered', 'completed'].includes(lesson.status) ? `<button id="begin-lesson">${esc(started ? uiText(lesson, 'resume') : uiText(lesson, 'begin'))}</button>` : ''}
        ${held ? `<button class="review-accept" data-kind="lesson" data-id="${lesson.id}">Accept and schedule</button><button class="secondary review-revise" data-kind="lesson" data-id="${lesson.id}">Request changes</button>` : ''}
      </div>
    </article>
  </div>`;
  $('#exit-lesson').onclick = () => { location.hash = ''; };
  if ($('#begin-lesson')) $('#begin-lesson').onclick = async () => {
    const sections = buildLessonSections(lesson);
    const savedIndex = sections.findIndex((section) => section.id === experience.currentSectionId);
    readerState.activeIndex = savedIndex >= 0 ? savedIndex : 0;
    await saveExperience(lesson.id, { started: true, selectedLanguage: lesson.language, currentSectionId: sections[readerState.activeIndex]?.id || 'opening', anchorId: sections[readerState.activeIndex]?.anchorId || '' }).catch(() => {});
    location.hash = `lesson=${encodeURIComponent(lesson.id)}&reader=1`;
  };
  bindReviewActions(el);
}

function renderCompletion(lesson) {
  const el = $('#tab-today');
  const experience = defaultExperience(lesson);
  const next = state.lessons.find((item) => item.planId === lesson.planId && item.id !== lesson.id && !['completed', 'skipped'].includes(item.status));
  const savedCount = experience.highlights.length + experience.notes.length;
  const reviewAt = experience.reviewAt ? new Date(experience.reviewAt).toLocaleString() : 'Within the next day';
  el.innerHTML = `<div class="lesson-shell completion-shell" dir="${RTL_LANGUAGES.has(lesson.language) ? 'rtl' : 'ltr'}">
    <button class="reader-back ghost" id="exit-lesson">${backArrow(lesson)} ${esc(uiText(lesson, 'back'))}</button>
    <article class="completion-panel">
      <div class="completion-mark" aria-hidden="true">✓</div>
      <div class="kicker">${esc(uiText(lesson, 'summary'))}</div>
      <h1 dir="auto">${esc(lesson.title)}</h1>
      <p class="completion-summary" dir="auto">${esc(lesson.content?.practicalTakeaway || lessonValue(lesson))}</p>
      <div class="content-block connection"><div class="block-label">${esc(uiText(lesson, 'connectionLabel'))}</div><p dir="auto">${esc(lesson.content?.knowledgeConnection || 'This strengthens the mental model built across your learning path.')}</p></div>
      <section class="confidence-check"><h2>${esc(uiText(lesson, 'confidence'))}</h2><div class="segmented" role="group" aria-label="${esc(uiText(lesson, 'confidence'))}">
        ${['low', 'medium', 'high'].map((level) => `<button class="${experience.confidence === level ? 'selected' : 'ghost'} confidence-option" data-level="${level}" aria-pressed="${experience.confidence === level}">${esc(uiText(lesson, level))}</button>`).join('')}
      </div></section>
      <dl class="completion-details"><div><dt>${esc(uiText(lesson, 'notes'))}</dt><dd>${savedCount} ${esc(uiText(lesson, 'savedItems'))}</dd></div><div><dt>${esc(uiText(lesson, 'nextReview'))}</dt><dd>${esc(reviewAt)}</dd></div><div><dt>${esc(uiText(lesson, 'nextLesson'))}</dt><dd dir="auto">${esc(next?.title || lesson.content?.nextTeaser || 'Your next validated lesson will appear automatically.')}</dd></div></dl>
      <button id="finish-to-today">${esc(uiText(lesson, 'back'))}</button>
    </article>
    ${feedbackHtml(lesson)}
  </div>`;
  $('#exit-lesson').onclick = $('#finish-to-today').onclick = () => { location.hash = ''; };
  el.querySelectorAll('.confidence-option').forEach((button) => button.onclick = async () => {
    await saveExperience(lesson.id, { confidence: button.dataset.level }).catch(() => {});
    renderCompletion(lessonById(lesson.id));
  });
  if ($('#feedback-form')) bindFeedback(lesson);
}

function renderLessonReader(lesson) {
  applyReaderPreferences();
  const el = $('#tab-today');
  const sections = buildLessonSections(lesson);
  const experience = defaultExperience(lesson);
  if (!sections.length) return renderLessonCover(lesson);
  if (lesson.status === 'completed' || experience.completedEssentialAt) return renderCompletion(lesson);
  if (readerState.activeIndex === null) {
    const saved = sections.findIndex((section) => section.id === experience.currentSectionId);
    readerState.activeIndex = saved >= 0 ? saved : 0;
  }
  readerState.activeIndex = Math.max(0, Math.min(readerState.activeIndex, sections.length - 1));
  const active = sections[readerState.activeIndex];
  const completed = new Set(experience.completedSectionIds);
  const progress = Math.round((completed.size / Math.max(1, sections.length)) * 100);
  const remaining = remainingMinutes(lesson, sections, readerState.activeIndex);
  const canComplete = sections.filter((section) => !section.optional).every((section) => completed.has(section.id) || section.id === active.id);
  const isLast = readerState.activeIndex === sections.length - 1;
  const checkAnswer = active.kind === 'check' ? experience.answers[active.check.id] : null;
  const actionLabel = active.kind === 'check' && !checkAnswer
    ? uiText(lesson, 'check')
    : active.kind === 'check' && checkAnswer && !checkAnswer.correct && !checkAnswer.skipped
      ? uiText(lesson, 'retry')
      : isLast && canComplete ? uiText(lesson, 'complete') : isLast ? uiText(lesson, 'continueEssential') : uiText(lesson, 'next');
  el.innerHTML = `<div class="lesson-reader" dir="${RTL_LANGUAGES.has(lesson.language) ? 'rtl' : 'ltr'}">
    <header class="reader-toolbar">
      <button class="reader-back ghost" id="exit-reader" aria-label="${esc(uiText(lesson, 'back'))}">${backArrow(lesson)} <span>${esc(uiText(lesson, 'back'))}</span></button>
      <div class="reader-toolbar-actions">
        <button class="ghost" id="open-outline" aria-haspopup="dialog">${esc(uiText(lesson, 'outlineButton'))}</button>
        <button class="ghost" id="open-saved" aria-haspopup="dialog">${esc(uiText(lesson, 'notes'))}</button>
        <button class="ghost" id="open-sources" aria-haspopup="dialog">${esc(uiText(lesson, 'sources'))}</button>
        <button class="ghost" id="reader-settings" aria-haspopup="dialog">${esc(uiText(lesson, 'reading'))}</button>
        <button class="ghost" id="toggle-focus">${esc(readerPreferences.focus ? uiText(lesson, 'leaveFocus') : uiText(lesson, 'focus'))}</button>
      </div>
    </header>
    <div class="reader-progress" aria-label="Lesson progress">
      <div><span>${esc(uiText(lesson, 'section'))} ${readerState.activeIndex + 1} / ${sections.length}</span><span>${remaining} ${esc(uiText(lesson, 'minutes'))} ${esc(uiText(lesson, 'remaining'))}</span></div>
      <div class="reader-progress-track" role="progressbar" aria-valuenow="${progress}" aria-valuemin="0" aria-valuemax="100"><span style="inline-size:${progress}%"></span></div>
    </div>
    <div class="reader-column">
      <article class="reader-section" data-section-id="${active.id}" aria-labelledby="active-section-title">
        <div class="section-overline">${active.optional ? esc(uiText(lesson, 'optional')) : `${esc(uiText(lesson, 'section'))} ${readerState.activeIndex + 1}`}</div>
        <h1 id="active-section-title" dir="auto">${esc(sectionTitle(lesson, active))}</h1>
        <div class="reader-prose" id="${active.anchorId}">
          ${active.kind === 'check' ? renderKnowledgeCheck(active, lesson) : renderSectionBlocks(active, lesson)}
        </div>
        <div class="section-secondary-actions">
          <button class="ghost" id="section-more" aria-haspopup="dialog">⋯ ${esc(uiText(lesson, 'more'))}</button>
          ${active.optional ? `<button class="ghost" id="skip-section">${esc(uiText(lesson, 'skipSection'))}</button>` : ''}
        </div>
      </article>
    </div>
    <div class="reader-sticky"><button id="reader-continue">${esc(actionLabel)}</button></div>
  </div>
  <div id="selection-toolbar" class="selection-toolbar hidden" role="toolbar" aria-label="Selected text actions">
    <button data-selection-action="highlight">${esc(uiText(lesson, 'highlightLabel'))}</button><button data-selection-action="note" class="secondary">${esc(uiText(lesson, 'addNote'))}</button><button data-selection-action="discuss" class="ghost">${esc(uiText(lesson, 'discussTitle'))}</button>
  </div>`;
  bindReaderActions(lesson, sections, active, { canComplete, isLast });
  observeMeaningfulAnchor(lesson, active);
}

function openAccessibleSheet(title, body, bind = () => {}) {
  const dialog = $('#dialog');
  const previous = document.activeElement;
  dialog.classList.remove('hidden');
  dialog.innerHTML = `<div class="card lesson-sheet" role="document"><div class="dialog-heading"><h2>${esc(title)}</h2><button type="button" class="icon-button ghost" id="close-dialog" aria-label="Close">×</button></div>${body}</div>`;
  const close = () => {
    dialog.classList.add('hidden');
    dialog.innerHTML = '';
    previous?.focus?.();
  };
  $('#close-dialog').onclick = close;
  dialog.onclick = (event) => { if (event.target === dialog) close(); };
  dialog.onkeydown = (event) => {
    if (event.key === 'Escape') close();
    if (event.key === 'Tab') {
      const focusable = [...dialog.querySelectorAll('button, a[href], input, textarea, select')].filter((item) => !item.disabled);
      if (!focusable.length) return;
      const first = focusable[0]; const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  };
  bind(dialog, close);
  $('#close-dialog').focus();
}

function openOutlineSheet(lesson, sections) {
  const experience = defaultExperience(lesson);
  openAccessibleSheet(uiText(lesson, 'outlineButton'), `<nav class="lesson-outline" aria-label="${esc(uiText(lesson, 'outline'))}">${sections.map((section, index) => `<button class="outline-item ${index === readerState.activeIndex ? 'is-current' : ''}" data-index="${index}"><span>${experience.completedSectionIds.includes(section.id) ? '✓' : index + 1}</span><span dir="auto">${esc(sectionTitle(lesson, section))}${section.optional ? ` <small>(${esc(uiText(lesson, 'optional'))})</small>` : ''}</span></button>`).join('')}</nav>`, (root, close) => {
    root.querySelectorAll('.outline-item').forEach((button) => button.onclick = () => {
      readerState.activeIndex = Number(button.dataset.index);
      const target = sections[readerState.activeIndex];
      saveExperience(lesson.id, { currentSectionId: target.id, anchorId: target.anchorId, sectionTotal: sections.length }).catch(() => {});
      close(); renderLessonReader(lessonById(lesson.id)); window.scrollTo({ top: 0 });
    });
  });
}

function openSourcesSheet(lesson) {
  const sources = (lesson.sources || []).filter((source) => source.title || source.url);
  const claims = lesson.claims || [];
  openAccessibleSheet(uiText(lesson, 'sources'), sources.length ? `<div class="source-list">${sources.map((source) => {
    const supported = claims.filter((claim) => claim.sourceIds?.includes(source.id)).map((claim) => claim.text).filter(Boolean);
    return `<article class="source-item"><h3 dir="auto">${esc(source.title)}</h3>${source.domain ? `<p class="muted">${esc(source.domain)}</p>` : ''}${supported.length ? `<p dir="auto"><strong>Supports:</strong> ${esc(supported.slice(0, 2).join(' · '))}</p>` : ''}${source.excerpt ? `<details><summary>Relevant passage</summary><p dir="auto">${esc(source.excerpt)}</p></details>` : ''}${source.url ? `<a class="button-link secondary" href="${esc(source.url)}" target="_blank" rel="noopener noreferrer">Open original</a>` : '<span class="muted">Original link unavailable</span>'}</article>`;
  }).join('')}</div>` : '<p class="notice warn">No public source details are available for this lesson.</p>');
}

function openSavedSheet(lesson) {
  const experience = defaultExperience(lesson);
  const items = [
    ...experience.highlights.map((item) => ({ ...item, type: uiText(lesson, 'highlightLabel') })),
    ...experience.notes.map((item) => ({ ...item, type: uiText(lesson, 'noteLabel') }))
  ].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  openAccessibleSheet(uiText(lesson, 'notes'), items.length ? `<div class="saved-list">${items.map((item) => `<article class="saved-item"><div class="block-label">${esc(item.type)} · ${esc(item.sectionId)}</div>${item.passage ? `<blockquote dir="auto">${esc(item.passage)}</blockquote>` : ''}${item.note ? `<p dir="auto">${esc(item.note)}</p>` : ''}</article>`).join('')}</div>` : `<p class="muted">${esc(uiText(lesson, 'savedEmpty'))}</p>`);
}

function openReaderSettings(lesson) {
  openAccessibleSheet(uiText(lesson, 'reading'), `<form id="reader-preferences" class="reader-preferences">
    <label>${esc(uiText(lesson, 'readingTheme'))}<select name="theme"><option value="system" ${selected(readerPreferences.theme, 'system')}>${esc(uiText(lesson, 'deviceDefault'))}</option><option value="light" ${selected(readerPreferences.theme, 'light')}>${esc(uiText(lesson, 'softLight'))}</option><option value="dark" ${selected(readerPreferences.theme, 'dark')}>${esc(uiText(lesson, 'softDark'))}</option><option value="warm" ${selected(readerPreferences.theme, 'warm')}>${esc(uiText(lesson, 'warmTheme'))}</option></select></label>
    <label>${esc(uiText(lesson, 'textSize'))}<select name="textSize"><option value="standard" ${selected(readerPreferences.textSize, 'standard')}>${esc(uiText(lesson, 'comfortable'))}</option><option value="large" ${selected(readerPreferences.textSize, 'large')}>${esc(uiText(lesson, 'large'))}</option><option value="xlarge" ${selected(readerPreferences.textSize, 'xlarge')}>${esc(uiText(lesson, 'xlarge'))}</option></select></label>
    <button>${esc(uiText(lesson, 'apply'))}</button>
  </form>`, (root, close) => {
    $('#reader-preferences').onsubmit = (event) => {
      event.preventDefault();
      const data = new FormData(event.target);
      readerPreferences.theme = data.get('theme');
      readerPreferences.textSize = data.get('textSize');
      persistReaderPreferences(); close(); renderLessonReader(lessonById(lesson.id));
    };
  });
}

function openSectionMenu(lesson, section) {
  const actions = [
    ['simpler', uiText(lesson, 'simpler')], ['deeper', uiText(lesson, 'deeper')], ['example', uiText(lesson, 'anotherExample')],
    ['challenge', uiText(lesson, 'challenge')], ['summary', uiText(lesson, 'summarize')], ['save', uiText(lesson, 'savePoint')], ['report', uiText(lesson, 'report')]
  ];
  openAccessibleSheet(uiText(lesson, 'sectionActions'), `<div class="context-action-list">${actions.map(([id, label]) => `<button class="ghost context-action" data-action="${id}">${esc(label)}</button>`).join('')}</div><p class="muted">${esc(uiText(lesson, 'aiOnDemand'))}</p>`, (root, close) => {
    root.querySelectorAll('.context-action').forEach((button) => button.onclick = () => {
      const action = button.dataset.action;
      close();
      if (action === 'save') return saveSelectionAsNote(lesson, { passage: section.blocks?.[0] || sectionTitle(lesson, section), sectionId: section.id, anchorId: section.anchorId });
      if (action === 'report') return openSectionFeedback(lesson, section);
      const prompts = {
        simpler: 'Explain this section more simply without losing accuracy.',
        deeper: 'Go deeper on this section and distinguish what is established, disputed, and uncertain.',
        example: 'Give me one additional concrete example for this section.',
        challenge: 'Challenge the central claim in this section. Give the strongest limitation or counterargument.',
        summary: 'Summarize this section in three precise sentences.'
      };
      openQuestionDialog(lesson, `${prompts[action]}\n\nSection: ${section.title}\nContext: ${(section.blocks || []).join(' ')}`);
    });
  });
}

function openSectionFeedback(lesson, section) {
  openAccessibleSheet('Report this section', `<form id="section-feedback-form"><label>What should improve?<select name="category"><option value="unclear">Unclear explanation</option><option value="too_simple">Too simple</option><option value="too_detailed">Too detailed</option><option value="not_relevant">Not relevant to my goals</option><option value="incorrect">Possibly incorrect</option></select></label><label>Optional comment<textarea name="comment" dir="auto"></textarea></label><button>Save feedback</button></form>`, (root, close) => {
    $('#section-feedback-form').onsubmit = async (event) => {
      event.preventDefault();
      const data = new FormData(event.target);
      await saveExperience(lesson.id, { mutation: { id: mutationId('feedback'), type: 'section_feedback', sectionId: section.id, category: data.get('category'), comment: data.get('comment'), language: lesson.language } }).catch(() => {});
      close(); showToast('Section feedback saved.');
    };
  });
}

function saveSelectionAsNote(lesson, selection) {
  openAccessibleSheet(uiText(lesson, 'addNote'), `${selection.passage ? `<blockquote dir="auto">${esc(selection.passage)}</blockquote>` : ''}<form id="lesson-note-form"><label>${esc(uiText(lesson, 'note'))}<textarea name="note" dir="auto" required autofocus></textarea></label><button>${esc(uiText(lesson, 'saveNote'))}</button></form>`, (root, close) => {
    $('#lesson-note-form').onsubmit = async (event) => {
      event.preventDefault();
      await saveExperience(lesson.id, { mutation: { id: mutationId('note'), type: 'note', ...selection, note: new FormData(event.target).get('note'), language: lesson.language } }).catch(() => {});
      close(); showToast('Private note saved.'); renderLessonReader(lessonById(lesson.id));
    };
  });
}

function showSelectionToolbar(lesson, section) {
  const selection = getSelection();
  const toolbar = $('#selection-toolbar');
  if (!toolbar || !selection || selection.isCollapsed) return toolbar?.classList.add('hidden');
  const passage = selection.toString().replace(/\s+/g, ' ').trim();
  const range = selection.rangeCount ? selection.getRangeAt(0) : null;
  if (!passage || passage.length > 1200 || !range || !$('.reader-prose')?.contains(range.commonAncestorContainer)) return toolbar.classList.add('hidden');
  const anchorElement = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement;
  readerState.selection = { passage, sectionId: section.id, anchorId: anchorElement?.closest('[id]')?.id || section.anchorId };
  toolbar.classList.remove('hidden');
  const rect = range.getBoundingClientRect();
  toolbar.style.insetInlineStart = `${Math.max(12, Math.min(window.innerWidth - toolbar.offsetWidth - 12, rect.left))}px`;
  toolbar.style.insetBlockStart = `${Math.max(12, rect.top - toolbar.offsetHeight - 8)}px`;
}

function bindSelectionActions(lesson, section) {
  const prose = $('.reader-prose');
  if (!prose) return;
  prose.addEventListener('mouseup', () => setTimeout(() => showSelectionToolbar(lesson, section), 0));
  prose.addEventListener('touchend', () => setTimeout(() => showSelectionToolbar(lesson, section), 80), { passive: true });
  document.querySelectorAll('[data-selection-action]').forEach((button) => button.onclick = async () => {
    const selection = readerState.selection;
    if (!selection) return;
    $('#selection-toolbar').classList.add('hidden');
    getSelection()?.removeAllRanges();
    if (button.dataset.selectionAction === 'highlight') {
      await saveExperience(lesson.id, { mutation: { id: mutationId('highlight'), type: 'highlight', ...selection, language: lesson.language } }).catch(() => {});
      showToast('Highlight saved.'); renderLessonReader(lessonById(lesson.id));
    } else if (button.dataset.selectionAction === 'note') saveSelectionAsNote(lesson, selection);
    else openQuestionDialog(lesson, `Discuss this selected passage in the context of the lesson. Use Socratic guidance where useful.\n\nSelected passage: ${selection.passage}`);
  });
}

function bindReaderActions(lesson, sections, active, { canComplete, isLast }) {
  $('#exit-reader').onclick = () => {
    saveExperience(lesson.id, { currentSectionId: active.id, anchorId: readerState.selection?.anchorId || active.anchorId, sectionTotal: sections.length }).catch(() => {});
    readerPreferences.focus = false; persistReaderPreferences(); location.hash = '';
  };
  $('#open-outline').onclick = () => openOutlineSheet(lesson, sections);
  $('#open-sources').onclick = () => openSourcesSheet(lesson);
  $('#open-saved').onclick = () => openSavedSheet(lesson);
  $('#reader-settings').onclick = () => openReaderSettings(lesson);
  $('#toggle-focus').onclick = () => { readerPreferences.focus = !readerPreferences.focus; persistReaderPreferences(); renderLessonReader(lesson); };
  $('#section-more').onclick = () => openSectionMenu(lesson, active);
  if ($('#skip-section')) $('#skip-section').onclick = () => advanceReader(lesson, sections, active, { skipped: true });
  $('#reader-continue').onclick = () => {
    const saved = active.kind === 'check' ? defaultExperience(lessonById(lesson.id)).answers[active.check.id] : null;
    if (active.kind === 'check' && !saved) return $('#lesson-check-form')?.requestSubmit();
    if (active.kind === 'check' && saved && !saved.correct && !saved.skipped) {
      const current = lessonById(lesson.id);
      current.experience = defaultExperience(current);
      delete current.experience.answers[active.check.id];
      return renderLessonReader(current);
    }
    return advanceReader(lesson, sections, active, { complete: isLast && canComplete });
  };
  const form = $('#lesson-check-form');
  if (form) {
    form.onsubmit = async (event) => {
      event.preventDefault();
      const answer = new FormData(event.target).get('answer');
      if (!answer) return showToast(uiText(lesson, 'selectAnswer'));
      const correct = isExpectedAnswer(answer, active.check.expected);
      lesson.experience = defaultExperience(lesson);
      lesson.experience.answers[active.check.id] = { answer, correct, skipped: false, sectionId: active.id };
      await saveExperience(lesson.id, { mutation: { id: mutationId('answer'), type: 'answer', questionId: active.check.id, sectionId: active.id, answer, correct } }).catch(() => {});
      renderLessonReader(lessonById(lesson.id));
    };
    if ($('#skip-check')) $('#skip-check').onclick = async () => {
      await saveExperience(lesson.id, { mutation: { id: mutationId('answer'), type: 'answer', questionId: active.check.id, sectionId: active.id, answer: '', correct: null, skipped: true } }).catch(() => {});
      advanceReader(lessonById(lesson.id), sections, active, { skipped: true });
    };
  }
  bindSelectionActions(lesson, active);
}

async function advanceReader(lesson, sections, active, { complete = false } = {}) {
  const completedSectionIds = [active.id];
  if (complete || readerState.activeIndex >= sections.length - 1) {
    const essential = sections.filter((section) => !section.optional).map((section) => section.id);
    const done = new Set([...defaultExperience(lesson).completedSectionIds, ...completedSectionIds]);
    if (essential.every((id) => done.has(id))) {
      await saveExperience(lesson.id, { currentSectionId: 'complete', completedSectionIds, sectionTotal: sections.length }).catch(() => {});
      await api(`/api/lessons/${lesson.id}/complete`, { method: 'POST', body: '{}' });
      const current = await api(`/api/lessons/${lesson.id}`);
      const index = state.lessons.findIndex((item) => item.id === lesson.id);
      state.lessons[index] = current;
      return renderCompletion(current);
    }
    const missingIndex = sections.findIndex((section) => !section.optional && !done.has(section.id));
    if (missingIndex >= 0) readerState.activeIndex = missingIndex - 1;
  }
  readerState.activeIndex = Math.min(readerState.activeIndex + 1, sections.length - 1);
  const next = sections[readerState.activeIndex];
  await saveExperience(lesson.id, { currentSectionId: next.id, anchorId: next.anchorId, completedSectionIds, sectionTotal: sections.length }).catch(() => {});
  renderLessonReader(lessonById(lesson.id));
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function observeMeaningfulAnchor(lesson, section) {
  readerState.observer?.disconnect();
  const blocks = [...document.querySelectorAll('.reader-prose [id]')];
  if (!blocks.length || !('IntersectionObserver' in window)) return;
  readerState.observer = new IntersectionObserver((entries) => {
    const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
    if (visible) debouncedExperienceSave(lesson.id, { currentSectionId: section.id, anchorId: visible.target.id, sectionTotal: buildLessonSections(lesson).length });
  }, { rootMargin: '-15% 0px -55% 0px', threshold: [0.1, 0.5] });
  blocks.forEach((block) => readerState.observer.observe(block));
}

function renderLessonExperience(lesson) {
  const reading = location.hash.includes('reader=1');
  document.body.classList.add('is-reading-lesson');
  if (reading && ['delivered', 'completed'].includes(lesson.status)) return renderLessonReader(lesson);
  readerPreferences.focus = false;
  applyReaderPreferences();
  renderLessonCover(lesson);
}

function feedbackHtml(lesson) {
  const ar = RTL_LANGUAGES.has(lesson?.language);
  const t = ar ? {
    title: 'ملاحظاتك على الدرس', saved: 'حُفظت ملاحظاتك.', useful: 'هل كان مفيدًا؟', usefulYes: 'مفيد', usefulNo: 'غير مفيد',
    interesting: 'هل كان مثيرًا للاهتمام؟', interestingYes: 'نعم', interestingNo: 'لا', difficulty: 'الصعوبة', right: 'مناسبة',
    easy: 'سهل جدًا', hard: 'صعب جدًا', depth: 'العمق', shallow: 'سطحي جدًا', deep: 'متعمّق جدًا', format: 'التنسيق',
    formatRight: 'مناسب', text: 'أفضل النص', audio: 'أفضل الصوت', visual: 'أفضل مزيدًا من العناصر البصرية',
    comment: 'تعليق اختياري', save: 'احفظ الملاحظات'
  } : {
    title: 'Lesson feedback', saved: 'Your feedback has been saved.', useful: 'Useful?', usefulYes: 'Useful', usefulNo: 'Not useful',
    interesting: 'Interesting?', interestingYes: 'Interesting', interestingNo: 'Not interesting', difficulty: 'Difficulty', right: 'Right',
    easy: 'Too easy', hard: 'Too hard', depth: 'Depth', shallow: 'Too shallow', deep: 'Too deep', format: 'Format',
    formatRight: 'Format was right', text: 'Prefer text', audio: 'Prefer audio', visual: 'Prefer more visual',
    comment: 'Comment', save: 'Save feedback'
  };
  return `<div class="card"><h2>${esc(t.title)}</h2>
    ${lesson.feedback ? `<div class="notice">${esc(t.saved)}</div>` : `<form id="feedback-form" class="feedback-row">
      <label>${esc(t.useful)}<select name="useful"><option value="true">${esc(t.usefulYes)}</option><option value="false">${esc(t.usefulNo)}</option></select></label>
      <label>${esc(t.interesting)}<select name="interesting"><option value="true">${esc(t.interestingYes)}</option><option value="false">${esc(t.interestingNo)}</option></select></label>
      <label>${esc(t.difficulty)}<select name="difficulty"><option value="right">${esc(t.right)}</option><option value="easy">${esc(t.easy)}</option><option value="hard">${esc(t.hard)}</option></select></label>
      <label>${esc(t.depth)}<select name="depth"><option value="right">${esc(t.right)}</option><option value="shallow">${esc(t.shallow)}</option><option value="deep">${esc(t.deep)}</option></select></label>
      <label>${esc(t.format)}<select name="format"><option value="right">${esc(t.formatRight)}</option><option value="text">${esc(t.text)}</option><option value="audio">${esc(t.audio)}</option><option value="visual">${esc(t.visual)}</option></select></label>
      <label>${esc(t.comment)}<textarea name="comment" dir="auto"></textarea></label>
      <div class="full"><button>${esc(t.save)}</button></div>
    </form>`}
  </div>`;
}

function bindFeedback(lesson) {
  $('#feedback-form').onsubmit = async (event) => {
    event.preventDefault();
    const form = new FormData(event.target);
    await api(`/api/lessons/${lesson.id}/feedback`, { method: 'POST', body: JSON.stringify({
      useful: form.get('useful') === 'true', interesting: form.get('interesting') === 'true', difficulty: form.get('difficulty'), depth: form.get('depth'), format: form.get('format'), comment: form.get('comment')
    }) });
    await refreshData();
    showToast('Feedback saved.');
  };
}

function openQuestionDialog(lesson, starter = '') {
  const dialog = $('#dialog');
  dialog.classList.remove('hidden');
  dialog.innerHTML = `<div class="card"><div class="dialog-heading"><h2>${esc(uiText(lesson, 'discussTitle'))}</h2><button type="button" class="icon-button ghost" id="close-dialog" aria-label="Close">×</button></div><form id="question-form"><label>${esc(uiText(lesson, 'questionLabel'))}<textarea name="question" dir="auto" required autofocus>${esc(starter)}</textarea></label><p class="muted">${esc(uiText(lesson, 'aiProcessing'))}</p><div class="actions dialog-actions"><button>${esc(uiText(lesson, 'ask'))}</button><button type="button" class="ghost" id="cancel-dialog">${esc(uiText(lesson, 'cancel'))}</button></div></form><div id="question-answer"></div></div>`;
  const close = () => dialog.classList.add('hidden');
  $('#close-dialog').onclick = close;
  $('#cancel-dialog').onclick = close;
  $('#question-form').onsubmit = async (event) => {
    event.preventDefault();
    const button = event.target.querySelector('button');
    button.disabled = true;
    try {
      const result = await api(`/api/lessons/${lesson.id}/follow-up`, { method: 'POST', body: JSON.stringify({ question: new FormData(event.target).get('question') }) });
      $('#question-answer').innerHTML = `<div class="notice dialog-result" dir="auto">${esc(result.answer)}</div>`;
    } catch (error) {
      $('#question-answer').innerHTML = `<div class="notice error dialog-result">${esc(error.message)}</div>`;
    } finally { button.disabled = false; }
  };
}

function renderPlan() {
  const el = $('#tab-plan');
  const plan = state.plans[0];
  if (!plan) {
    const pending = state.me.pendingBusinessTasks || 0;
    el.innerHTML = `<div class="card empty-state"><div class="empty-icon" aria-hidden="true">▦</div><h2>Your first weekly plan is being prepared</h2><p>Knowledge Pilot starts this automatically from your onboarding profile.</p>${state.notice ? `<div class="notice">${esc(state.notice)}</div>` : ''}${pending ? `<div class="notice warn">${pending} verified-processing task${pending === 1 ? '' : 's'} waiting.${state.me.customGptUrl ? ` <a href="${esc(state.me.customGptUrl)}" target="_blank" rel="noopener noreferrer">Open processing GPT</a>` : ''}</div>` : ''}<button id="generate-plan" ${pending ? 'disabled' : ''}>${state.me.aiProvider === 'chatgpt_business' ? 'Queue a weekly plan' : 'Generate weekly plan'}</button></div>`;
    $('#generate-plan').onclick = async () => {
      $('#generate-plan').disabled = true;
      try { await api('/api/plans/generate', { method: 'POST', body: '{}' }); await refreshData(); }
      catch (error) { showError(error); }
    };
    return;
  }
  const cards = plan.proposals.map((proposal) => {
    const lesson = state.lessons.find((item) => item.planId === plan.id && item.proposalId === proposal.id && item.status !== 'archived');
    const status = lesson ? workflowLabel(lesson) : plan.status === 'approved' ? 'Preparation scheduled' : 'Planned';
    const tag = lesson?.status === 'completed' ? 'good' : reviewRequired(lesson) ? 'warn' : '';
    return `<article class="weekly-lesson-card">
      <div class="weekly-card-content">
        <div class="weekly-card-topline"><span class="badge" dir="auto">${esc(proposal.topic)}</span><span class="badge ${tag}">${esc(status)}</span></div>
        <h3 dir="auto">${proposal.order}. ${esc(proposal.title)}</h3>
        <p dir="auto">${esc(proposal.question)}</p>
        ${proposal.reason ? `<small dir="auto">${esc(proposal.reason)}</small>` : ''}
      </div>
      <div class="weekly-card-footer"><span class="muted">${proposal.estimatedMinutes} min</span>${lesson ? `<button class="secondary plan-lesson-open" data-id="${lesson.id}">${lesson.experience?.startedAt ? 'Continue' : 'View lesson'}</button>` : '<span class="muted">No action needed</span>'}</div>
    </article>`;
  }).join('');
  el.innerHTML = `<div class="card"><div class="kicker">Week of ${esc(plan.weekStart)}</div><h2 dir="auto">${esc(plan.primarySubject)}</h2><p dir="auto">${esc(plan.rationale)}</p>
    <div class="weekly-grid">${cards}</div>
    <div class="actions card-footer">${plan.status === 'draft' ? '<button id="approve-plan">Approve weekly plan</button>' : '<span class="badge good">Plan approved</span>'}<button class="secondary" id="new-plan">Generate a new proposal</button></div></div>`;
  if ($('#approve-plan')) $('#approve-plan').onclick = async () => { await api(`/api/plans/${plan.id}/approve`, { method: 'POST', body: '{}' }); await refreshData(); showToast('Weekly plan approved. Validated lessons will be delivered automatically.'); };
  $('#new-plan').onclick = async () => { await api('/api/plans/generate', { method: 'POST', body: '{}' }); await refreshData(); showToast('Replacement plan queued.'); };
  document.querySelectorAll('.plan-lesson-open').forEach((button) => button.onclick = () => { location.hash = `lesson=${button.dataset.id}`; switchTab('today'); renderToday(); });
}


function bookStatusLabel(status) {
  return ({ queued_analysis: 'Analysis queued', awaiting_plan_approval: 'Plan ready', source_required: 'Owned copy needed', active: 'Active', paused: 'Paused', completed: 'Completed', archived: 'Archived', unsupported: 'Not supported yet', analysis_failed: 'Analysis failed' })[status] || status;
}

function bookCover(book) {
  return book.coverUrl
    ? `<img class="book-cover" src="${esc(book.coverUrl)}" alt="${esc(book.title)} cover" loading="lazy" referrerpolicy="no-referrer">`
    : '<div class="book-cover placeholder" aria-hidden="true">▥</div>';
}

function bookSessionFromHash() {
  const id = location.hash.match(/book-session=([^&]+)/)?.[1];
  if (!id) return null;
  for (const detail of Object.values(state.bookDetails)) {
    const session = detail.sessions?.find((item) => item.id === id);
    if (session) return { session, book: detail.book, plan: detail.plan };
  }
  return null;
}

function renderBookSessionView(found) {
  const { session, book } = found;
  const content = session.content || {};
  const quotations = content.quotations || [];
  const held = reviewRequired(session);
  const readable = ['delivered', 'completed'].includes(session.status);
  const scheduled = session.status === 'scheduled';
  const processing = ['pending', 'revision_queued'].includes(session.reviewStatus);
  return `<article class="card lesson-article book-session-article" dir="${RTL_LANGUAGES.has(session.language) ? 'rtl' : 'ltr'}">
    <div class="lesson-meta"><div class="actions"><span class="badge">Book session</span><span class="badge ${session.status === 'completed' ? 'good' : held ? 'warn' : ''}">${esc(workflowLabel(session))}</span></div><span class="muted">${session.estimatedMinutes} min</span></div>
    <div class="kicker" dir="auto">${esc(book.title)} · Session ${session.sessionNumber}</div>
    <h1 dir="auto">${esc(session.title)}</h1>
    ${(session.chapterRefs?.length || session.pageRefs?.length) ? `<p class="muted" dir="auto">${esc([...(session.chapterRefs || []), ...(session.pageRefs || [])].join(' · '))}</p>` : ''}
    ${session.cardFile ? `<img class="lesson-card-image" src="/cards/${encodeURIComponent(session.cardFile)}" alt="Book session summary card">` : ''}
    ${held && session.quality?.issues?.length ? `<div class="notice warn"><strong>Automated review notes</strong><br>${session.quality.issues.map(esc).join('<br>')}</div>` : ''}
    ${processing ? '<div class="notice">A verified revision or generation task is waiting for processing. You will be notified when it is ready.</div>' : ''}
    <div class="lesson-body">
      <section><h3>Opening</h3><p dir="auto">${esc(content.hook)}</p></section>
      <section><h3>Book explanation</h3><p dir="auto">${esc(content.summary)}</p></section>
      ${content.importantDetails?.length ? `<section><h3>Important details and examples</h3>${list(content.importantDetails)}</section>` : ''}
      ${content.context ? `<section><h3>Context</h3><p dir="auto">${esc(content.context)}</p></section>` : ''}
      ${content.criticalAssessment ? `<section><h3>Critical assessment</h3><p dir="auto">${esc(content.criticalAssessment)}</p></section>` : ''}
      ${content.practicalApplication ? `<section><h3>Practical application</h3><p dir="auto">${esc(content.practicalApplication)}</p></section>` : ''}
      ${quotations.length ? `<section><h3>Short selected passages</h3>${quotations.map((quote) => `<blockquote dir="auto">“${esc(quote.text)}”${quote.location ? `<footer>— ${esc(quote.location)}</footer>` : ''}</blockquote>`).join('')}</section>` : ''}
      ${content.connections?.length ? `<section><h3>Connections</h3>${list(content.connections)}</section>` : ''}
      <section><h3>Three ideas to retain</h3>${list(content.keyIdeas, true)}</section>
      <section><h3>Think</h3><p dir="auto">${esc(content.reflectionPrompt)}</p></section>
      ${session.sources?.some((source) => source.url) ? `<section><h3>Sources and criticism</h3><ol>${session.sources.filter((source) => source.url).map((source) => `<li dir="auto"><a href="${esc(source.url)}" target="_blank" rel="noopener noreferrer">${esc(source.title)}</a></li>`).join('')}</ol></section>` : ''}
    </div>
    <div class="actions lesson-actions">
      ${held ? `<button class="review-accept" data-kind="book" data-id="${session.id}">Accept and schedule</button><button class="secondary review-revise" data-kind="book" data-id="${session.id}">Request changes</button><button class="ghost review-skip" data-kind="book" data-id="${session.id}">Skip</button>` : ''}
      ${session.status === 'approved' ? `<button id="schedule-book-session">Schedule delivery</button><button class="secondary review-revise" data-kind="book" data-id="${session.id}">Request changes</button><button class="ghost review-skip" data-kind="book" data-id="${session.id}">Skip</button>` : ''}
      ${scheduled ? `<span class="notice">Delivery is scheduled for ${esc(new Date(session.scheduledAt).toLocaleString())}.</span><button id="schedule-book-session-now">Deliver now</button><button class="secondary" id="reschedule-book-session">Change time</button><button class="secondary review-revise" data-kind="book" data-id="${session.id}">Request changes</button><button class="ghost" id="skip-book-session">Skip session</button>` : ''}
      ${session.status === 'delivered' ? '<button id="complete-book-session">Mark complete</button><button class="ghost" id="skip-book-session">Skip session</button>' : ''}
      ${readable ? '<button class="secondary" id="ask-book-question">Ask about this book</button><button class="ghost" id="bookmark-book-session">Bookmark</button>' : ''}
      ${session.status === 'completed' ? '<span class="badge good">Completed</span>' : ''}
      <button class="ghost" id="back-to-book">Back to book</button>
    </div>
  </article>
  ${session.status === 'completed' ? `<div class="card"><h2>Session feedback</h2>${session.feedback ? '<div class="notice">Feedback saved.</div>' : `<form id="book-feedback-form" class="feedback-row"><label>Useful?<select name="useful"><option value="true">Useful</option><option value="false">Not useful</option></select></label><label>Depth<select name="depth"><option value="right">Right</option><option value="too_shallow">Too shallow</option><option value="too_deep">Too deep</option></select></label><label>Comment<textarea name="comment" dir="auto"></textarea></label><div class="full"><button>Save feedback</button></div></form>`}</div>` : ''}`;
}

function bookDetailHtml(detail) {
  const { book, plan, sessions = [] } = detail;
  const sourceWarning = book.sourceLimitations?.length ? `<div class="notice warn book-source-warning"><strong>Source limitation</strong><br>${book.sourceLimitations.map(esc).join('<br>')}</div>` : '';
  const planHtml = plan ? `<div class="card"><div class="section-heading"><div><div class="kicker">Book plan</div><h2>Structure and pacing</h2></div><span class="badge">${plan.sessions.length} sessions</span></div>
    <p dir="auto">${esc(plan.rationale)}</p>
    <div class="grid three"><div class="list-item"><strong>${plan.targetWeeks || plan.recommendedWeeks} weeks</strong><div class="muted">Recommended duration</div></div><div class="list-item"><strong>${plan.sessionsPerWeek} sessions/week</strong><div class="muted">Normal cadence</div></div><div class="list-item"><strong>${plan.typicalMinutes} min</strong><div class="muted">Typical session</div></div></div>
    ${book.status === 'awaiting_plan_approval' ? `<form id="approve-book-plan" class="form-grid"><label>Target weeks<input type="number" name="targetWeeks" min="1" max="24" value="${plan.recommendedWeeks}"></label><label>Sessions per week<input type="number" name="sessionsPerWeek" min="1" max="7" value="${plan.sessionsPerWeek}"></label><div class="full"><button>Approve duration and structure</button></div></form>` : ''}
    <details><summary>View session map</summary><div class="book-plan-list">${plan.sessions.map((item) => `<div class="book-plan-item"><strong dir="auto">${item.number}. ${esc(item.title)}</strong><p dir="auto">${esc(item.scope)}</p><small>${esc([...(item.chapterRefs || []), ...(item.pageRefs || [])].join(' · '))}</small></div>`).join('')}</div></details>
  </div>` : '';
  const sessionHtml = sessions.length ? `<div class="card"><div class="section-heading"><div><div class="kicker">Reading track</div><h2>Book sessions</h2></div><span class="badge">${sessions.filter((item) => item.status === 'completed').length}/${plan?.sessions?.filter((item) => item.isCore !== false).length || sessions.length}</span></div><div class="list">${sessions.map((session) => `<button class="list-item ghost book-session-open" data-id="${session.id}"><div class="lesson-meta"><span class="badge">Session ${session.sessionNumber}</span><span class="badge ${session.status === 'completed' ? 'good' : reviewRequired(session) ? 'warn' : ''}">${esc(workflowLabel(session))}</span></div><h3 dir="auto">${esc(session.title)}</h3><small dir="auto">${esc(session.content?.keyIdeas?.join(' · ') || session.scope || '')}</small></button>`).join('')}</div></div>` : '';
  const uploadNeedsAnalysis = ['queued_analysis', 'source_required', 'analysis_failed', 'unsupported', 'awaiting_plan_approval'].includes(book.status);
  const ownedCopy = book.ownedCopy;
  const copyUpload = `<div class="card ${book.status === 'source_required' ? 'book-source-warning' : ''}"><div class="section-heading"><div><div class="kicker">${book.status === 'source_required' ? 'More source material required' : 'Private book source'}</div><h2>${ownedCopy ? 'Replace the owned book file' : 'Add your owned book file'}</h2></div>${ownedCopy ? '<span class="badge good">File available</span>' : '<span class="badge">Optional</span>'}</div>
    <p>${book.status === 'source_required' ? 'The available public material was not sufficient for an accurate chapter-level plan.' : 'You can attach or replace a legally obtained copy at any time.'} PDF, EPUB, TXT, and Markdown are supported up to 30 MB. The file remains private on your server; only bounded extracted chunks are available to your private processing action.</p>
    ${ownedCopy ? `<div class="notice"><strong dir="auto">${esc(ownedCopy.filename)}</strong><br><span class="muted">${esc(String(ownedCopy.format || '').toUpperCase())} · ${esc(formatBytes(ownedCopy.sizeBytes))} · ${Number(ownedCopy.extractedCharacters || 0).toLocaleString()} extracted characters${ownedCopy.uploadedAt ? ` · uploaded ${esc(new Date(ownedCopy.uploadedAt).toLocaleString())}` : ''}</span></div>` : ''}
    <form id="owned-copy-form" class="upload-zone"><label>${ownedCopy ? 'Choose a replacement file' : 'Choose an owned book file'}<input type="file" name="file" accept=".pdf,.epub,.txt,.md,application/pdf,application/epub+zip,text/plain,text/markdown" required></label><button>${uploadNeedsAnalysis ? 'Upload and re-analyze' : ownedCopy ? 'Replace file' : 'Upload file'}</button></form>
    <p class="muted">${uploadNeedsAnalysis ? 'The source analysis will restart so the plan can use this file.' : 'Your current sessions and progress will remain unchanged. Future generated sessions can use the new source.'}</p>
  </div>`;
  const conceptsHtml = book.concepts?.length ? `<div class="card"><div class="section-heading"><div><div class="kicker">Knowledge extracted</div><h2>Book concepts</h2></div><span class="badge">${book.concepts.length}</span></div><div class="list">${book.concepts.map((concept) => `<div class="list-item"><div class="lesson-meta"><strong dir="auto">${esc(concept.name)}</strong><span class="badge ${concept.mastery === 'retained' ? 'good' : ''}">${esc(concept.mastery || 'introduced')}</span></div><p dir="auto">${esc(concept.explanation || '')}</p>${concept.topicConnection ? `<small dir="auto">Possible topic connection: ${esc(concept.topicConnection)}</small>` : ''}</div>`).join('')}</div></div>` : '';
  const pendingLinks = (book.topicLinkSuggestions || []).filter((link) => link.status === 'pending');
  const topicLinksHtml = (book.topicLinkSuggestions || []).length ? `<div class="card"><div class="section-heading"><div><div class="kicker">Cross-disciplinary learning</div><h2>Topic connections</h2></div><span class="badge">${pendingLinks.length} pending</span></div><div class="list">${book.topicLinkSuggestions.map((link) => `<div class="list-item"><div class="lesson-meta"><strong dir="auto">${esc(link.concept)} → ${esc(link.topic)}</strong><span class="badge ${link.status === 'approved' ? 'good' : link.status === 'rejected' ? 'bad' : 'warn'}">${esc(link.status)}</span></div><p dir="auto">${esc(link.reason || '')}</p>${link.status === 'pending' ? `<div class="actions"><button class="secondary book-link-review" data-id="${link.id}" data-decision="approve">Approve link</button><button class="ghost book-link-review" data-id="${link.id}" data-decision="reject">Reject</button></div>` : ''}</div>`).join('')}</div></div>` : '';
  return `<div class="card book-card"><div class="book-card-header">${bookCover(book)}<div><div class="lesson-meta"><span class="badge ${book.status === 'active' || book.status === 'completed' ? 'good' : book.status === 'source_required' ? 'warn' : ''}">${esc(bookStatusLabel(book.status))}</span><span class="badge">Sources: ${esc(book.sourceQuality || 'pending')}</span><span class="muted">${Number(book.progressPercent || 0)}%</span></div><h1 dir="auto">${esc(book.title)}</h1><p class="muted" dir="auto">${esc(book.author || '')}${book.edition ? ` · ${esc(book.edition)}` : ''}</p><div class="progress-track"><div class="progress-fill" style="width:${Number(book.progressPercent || 0)}%"></div></div></div></div>${book.description ? `<p dir="auto">${esc(book.description)}</p>` : ''}${sourceWarning}
    <div class="book-controls">
      ${book.status === 'active' ? '<button class="secondary book-control" data-action="pause">Pause</button>' : ''}
      ${book.status === 'paused' ? '<button class="secondary book-control" data-action="resume">Resume</button>' : ''}
      ${['active', 'completed'].includes(book.status) ? '<button class="ghost book-control" data-action="speed_up">Speed up</button><button class="ghost book-control" data-action="slow_down">Slow down</button><button class="ghost book-control" data-action="deeper">More depth</button><button class="ghost book-control" data-action="shorter">Shorter sessions</button>' : ''}
      ${book.status === 'active' ? '<button id="prepare-next-book-session">Prepare next session now</button>' : ''}
      ${['active', 'paused', 'completed'].includes(book.status) ? '<button class="ghost book-control" data-action="restart">Restart track</button><button class="danger book-control" data-action="archive">Archive</button>' : ''}
    </div>
  </div>${copyUpload}${planHtml}${sessionHtml}${conceptsHtml}${topicLinksHtml}
  <div class="grid two"><div class="card"><h2>Personal note</h2><form id="book-note-form"><label>Note<textarea name="text" dir="auto" required></textarea></label><button>Save note</button></form>${book.notes?.length ? `<div class="list">${book.notes.slice().reverse().map((note) => `<div class="list-item" dir="auto">${esc(note.text)}</div>`).join('')}</div>` : ''}</div><div class="card"><h2>Bookmarks</h2>${book.bookmarks?.length ? `<div class="list">${book.bookmarks.slice().reverse().map((bookmark) => `<div class="list-item">${esc(bookmark.label)}</div>`).join('')}</div>` : '<p class="muted">Bookmark a session while reading it.</p>'}</div></div>`;
}

function renderBooks() {
  const el = $('#tab-books');
  const foundSession = bookSessionFromHash();
  if (foundSession) {
    el.innerHTML = renderBookSessionView(foundSession);
    bindBookSessionActions(foundSession);
    return;
  }
  const selectedId = location.hash.match(/book=([^&]+)/)?.[1];
  const selected = selectedId ? state.bookDetails[selectedId] : null;
  el.innerHTML = `<div class="card"><div class="section-heading"><div><div class="kicker">Separate learning track</div><h2>Add a book</h2></div><span class="badge">Up to 3 active</span></div><p>Enter a title and author, ISBN, or a public catalogue/publisher URL. You may also attach your legally obtained PDF or ebook now, or add it later from the book page.</p><form id="add-book-form" class="form-grid"><label>Title<input name="title" dir="auto" placeholder="How to Win Friends and Influence People"></label><label>Author<input name="author" dir="auto" placeholder="Dale Carnegie"></label><label>ISBN<input name="isbn" inputmode="numeric"></label><label>Book or catalogue URL<input name="url" type="url" placeholder="https://..."></label><label>Edition language<select name="language"><option value="${esc(state.me.language)}">Profile language (${esc(state.me.language)})</option><option value="en">English</option><option value="ar">Arabic</option><option value="nl">Dutch</option></select></label><label class="full">Owned book file (optional)<input name="file" type="file" accept=".pdf,.epub,.txt,.md,application/pdf,application/epub+zip,text/plain,text/markdown"></label><div class="full"><button>Add and analyze book</button></div></form></div>
    ${selected ? bookDetailHtml(selected) : ''}
    <div class="card"><div class="section-heading"><div><div class="kicker">Your collection</div><h2>Books</h2></div><span class="badge">${state.books.length}</span></div>${state.books.length ? `<div class="book-grid">${state.books.map((book) => `<button class="list-item ghost book-open" data-id="${book.id}"><div class="book-card-header">${bookCover(book)}<div><div class="lesson-meta"><span class="badge ${book.status === 'source_required' ? 'warn' : ''}">${esc(bookStatusLabel(book.status))}</span><span class="muted">${Number(book.progressPercent || 0)}%</span></div><h3 dir="auto">${esc(book.title)}</h3><p class="muted" dir="auto">${esc(book.author || '')}</p><div class="progress-track"><div class="progress-fill" style="width:${Number(book.progressPercent || 0)}%"></div></div></div></div></button>`).join('')}</div>` : '<div class="empty-state compact"><p class="muted">No books added yet.</p></div>'}</div>`;
  bindBookActions(selected);
}

function bindBookActions(selected) {
  $('#add-book-form').onsubmit = async (event) => {
    event.preventDefault(); clearError();
    const form = new FormData(event.target);
    const file = form.get('file');
    form.delete('file');
    const data = Object.fromEntries(form);
    if (file instanceof File && file.size && !data.title && !data.isbn && !data.url) {
      data.title = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() || 'Owned book';
    }
    const button = event.target.querySelector('button'); button.disabled = true;
    try {
      const result = await api('/api/books', { method: 'POST', body: JSON.stringify(data) });
      if (file instanceof File && file.size) await uploadOwnedBookFile(result.book.id, file);
      state.notice = result.queued ? 'Book analysis queued for ChatGPT Business.' : '';
      await refreshData(); location.hash = `book=${result.book.id}`; switchTab('books'); renderBooks();
      showToast(file instanceof File && file.size ? 'Book and owned file added.' : result.merged ? 'Existing book opened.' : 'Book added and analysis queued.');
    }
    catch (error) { showError(error); } finally { button.disabled = false; }
  };
  document.querySelectorAll('#tab-books .book-open').forEach((button) => button.onclick = () => { location.hash = `book=${button.dataset.id}`; renderBooks(); });
  if (!selected) return;
  const book = selected.book;
  document.querySelectorAll('#tab-books .book-session-open').forEach((button) => button.onclick = () => { location.hash = `book-session=${button.dataset.id}`; renderBooks(); window.scrollTo({ top: 0 }); });
  document.querySelectorAll('#tab-books .book-control').forEach((button) => button.onclick = async () => {
    const action = button.dataset.action;
    if (['restart', 'archive'].includes(action) && !confirm(action === 'restart' ? 'Restart this book from session one while keeping notes and bookmarks?' : 'Archive this book and cancel pending deliveries?')) return;
    await api(`/api/books/${book.id}/control`, { method: 'POST', body: JSON.stringify({ action }) });
    await refreshData(); showToast('Book settings updated.');
  });
  document.querySelectorAll('#tab-books .book-link-review').forEach((button) => button.onclick = async () => {
    await api(`/api/books/${book.id}/topic-links/${button.dataset.id}`, { method: 'POST', body: JSON.stringify({ decision: button.dataset.decision }) });
    await refreshData(); showToast('Topic connection reviewed.');
  });
  if ($('#approve-book-plan')) $('#approve-book-plan').onsubmit = async (event) => { event.preventDefault(); const form = new FormData(event.target); await api(`/api/books/${book.id}/plan/approve`, { method: 'POST', body: JSON.stringify({ targetWeeks: Number(form.get('targetWeeks')), sessionsPerWeek: Number(form.get('sessionsPerWeek')) }) }); await refreshData(); showToast('Book plan approved. Sessions will be prepared on schedule and validated sessions will deliver automatically.'); };
  if ($('#prepare-next-book-session')) $('#prepare-next-book-session').onclick = async () => { await api(`/api/books/${book.id}/next`, { method: 'POST', body: '{}' }); await refreshData(); showToast('Next book session queued for ChatGPT Business.'); };
  if ($('#book-note-form')) $('#book-note-form').onsubmit = async (event) => { event.preventDefault(); const text = new FormData(event.target).get('text'); await api(`/api/books/${book.id}/notes`, { method: 'POST', body: JSON.stringify({ text }) }); await refreshData(); showToast('Note saved.'); };
  if ($('#owned-copy-form')) $('#owned-copy-form').onsubmit = async (event) => {
    event.preventDefault(); const file = new FormData(event.target).get('file'); if (!(file instanceof File) || !file.size) return;
    const button = event.target.querySelector('button'); const previousLabel = button.textContent; button.disabled = true; button.textContent = 'Uploading and extracting…';
    try {
      const result = await uploadOwnedBookFile(book.id, file);
      await refreshData(); showToast(result.queued ? 'Owned copy uploaded. Source analysis was queued again.' : 'Owned copy saved. Current progress was preserved.');
    } catch (error) { showError(error); } finally { button.disabled = false; button.textContent = previousLabel; }
  };
}

async function uploadOwnedBookFile(bookId, file) {
  const response = await fetch(`/api/books/${bookId}/upload-owned-copy?filename=${encodeURIComponent(file.name)}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': file.type || 'application/octet-stream' },
    body: file
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(result.error || 'Upload failed');
    error.status = response.status;
    throw error;
  }
  return result;
}

function bindBookSessionActions(found) {
  const { session, book } = found;
  if ($('#complete-book-session')) $('#complete-book-session').onclick = async () => { await api(`/api/book-sessions/${session.id}/complete`, { method: 'POST', body: '{}' }); await refreshData(); renderBooks(); showToast('Book session completed.'); };
  if ($('#skip-book-session')) $('#skip-book-session').onclick = async () => { await api(`/api/book-sessions/${session.id}/skip`, { method: 'POST', body: '{}' }); await refreshData(); renderBooks(); showToast('Book session skipped.'); };
  if ($('#schedule-book-session')) $('#schedule-book-session').onclick = () => openScheduleDialog('book', session.id, session.scheduledAt);
  if ($('#reschedule-book-session')) $('#reschedule-book-session').onclick = () => openScheduleDialog('book', session.id, session.scheduledAt);
  if ($('#schedule-book-session-now')) $('#schedule-book-session-now').onclick = async () => { await api(`/api/book-sessions/${session.id}/schedule`, { method: 'POST', body: JSON.stringify({ runAt: new Date().toISOString() }) }); await refreshData(); renderBooks(); showToast('Book session queued for immediate delivery.'); };
  if ($('#back-to-book')) $('#back-to-book').onclick = () => { location.hash = `book=${book.id}`; renderBooks(); };
  if ($('#bookmark-book-session')) $('#bookmark-book-session').onclick = async () => { await api(`/api/books/${book.id}/bookmarks`, { method: 'POST', body: JSON.stringify({ sessionId: session.id, label: `${session.sessionNumber}. ${session.title}` }) }); await refreshData(); showToast('Session bookmarked.'); };
  if ($('#ask-book-question')) $('#ask-book-question').onclick = () => {
    const dialog = $('#dialog'); dialog.classList.remove('hidden');
    dialog.innerHTML = `<div class="card"><div class="dialog-heading"><h2>Ask about this book session</h2><button type="button" class="icon-button ghost" id="close-dialog">×</button></div><form id="book-question-form"><label>Question<textarea name="question" dir="auto" required autofocus></textarea></label><div class="actions dialog-actions"><button>Ask</button></div></form><div id="book-question-answer"></div></div>`;
    $('#close-dialog').onclick = () => dialog.classList.add('hidden');
    $('#book-question-form').onsubmit = async (event) => { event.preventDefault(); const result = await api(`/api/book-sessions/${session.id}/follow-up`, { method: 'POST', body: JSON.stringify({ question: new FormData(event.target).get('question') }) }); $('#book-question-answer').innerHTML = `<div class="notice dialog-result" dir="auto">${esc(result.answer)}</div>`; };
  };
  if ($('#book-feedback-form')) $('#book-feedback-form').onsubmit = async (event) => { event.preventDefault(); const form = new FormData(event.target); await api(`/api/book-sessions/${session.id}/feedback`, { method: 'POST', body: JSON.stringify({ useful: form.get('useful') === 'true', depth: form.get('depth'), comment: form.get('comment') }) }); await refreshData(); renderBooks(); showToast('Book feedback saved.'); };
  bindReviewActions($('#tab-books'));
}

function renderLibrary() {
  const visible = state.lessons.filter((lesson) => ['approved', 'scheduled', 'delivered', 'completed'].includes(lesson.status));
  $('#tab-library').innerHTML = `<div class="card"><div class="section-heading"><div><div class="kicker">Archive</div><h2>Knowledge library</h2></div><span class="badge">${visible.length} lesson${visible.length === 1 ? '' : 's'}</span></div>${visible.length ? `<div class="list">${visible.map((lesson) => `<button class="list-item ghost lesson-open" data-id="${lesson.id}"><div class="lesson-meta"><div class="actions"><span class="badge" dir="auto">${esc(lesson.topic)}</span><span class="badge ${lesson.status === 'completed' ? 'good' : ''}">${esc(lesson.status)}</span></div><span class="muted">${lesson.estimatedMinutes} min</span></div><h3 dir="auto">${esc(lesson.title)}</h3><small dir="auto">${esc(lesson.content?.keyIdeas?.join(' · ') || '')}</small></button>`).join('')}</div>` : '<div class="empty-state compact"><p class="muted">Completed and approved lessons will appear here.</p></div>'}</div>`;
  document.querySelectorAll('.lesson-open').forEach((button) => button.onclick = () => { location.hash = `lesson=${button.dataset.id}`; switchTab('today'); renderToday(); });
}

function renderProgress() {
  const progress = state.progress;
  const books = progress.books || state.bookProgress || { totalBooks: 0, activeBooks: 0, completedBooks: 0, completedSessions: 0 };
  $('#tab-progress').innerHTML = `<div class="grid three metrics-grid"><div class="card metric-card"><div class="metric">${progress.completed}</div><div class="metric-label">Completed topic lessons</div></div><div class="card metric-card"><div class="metric">${progress.completionRate}%</div><div class="metric-label">Topic completion rate</div></div><div class="card metric-card"><div class="metric">${progress.activeMinutes}</div><div class="metric-label">Topic learning minutes</div></div></div>
  <div class="grid three metrics-grid"><div class="card metric-card"><div class="metric">${books.activeBooks || 0}</div><div class="metric-label">Active books</div></div><div class="card metric-card"><div class="metric">${books.completedSessions || 0}</div><div class="metric-label">Completed book sessions</div></div><div class="card metric-card"><div class="metric">${books.completedBooks || 0}</div><div class="metric-label">Completed books</div></div></div>
  <div class="card"><h2>Topics</h2>${Object.keys(progress.byTopic).length ? `<div class="list">${Object.entries(progress.byTopic).map(([topic, item]) => `<div class="list-item"><strong dir="auto">${esc(topic)}</strong><div class="muted">${item.completed} completed · ${item.retainedSignals} retained signals</div></div>`).join('')}</div>` : '<div class="empty-state compact"><p class="muted">Topic progress appears after lessons are completed.</p></div>'}</div>
  <div class="card"><h2>Book progress</h2>${state.books.length ? `<div class="list">${state.books.map((book) => `<button class="list-item ghost book-open" data-id="${book.id}"><strong dir="auto">${esc(book.title)}</strong><div class="progress-track"><div class="progress-fill" style="width:${Number(book.progressPercent || 0)}%"></div></div><div class="muted">${Number(book.progressPercent || 0)}% · ${esc(book.status)}</div></button>`).join('')}</div>` : '<div class="empty-state compact"><p class="muted">Add a book to begin the separate book-learning track.</p></div>'}</div>`;
  document.querySelectorAll('#tab-progress .book-open').forEach((button) => button.onclick = () => { location.hash = `book=${button.dataset.id}`; switchTab('books'); renderBooks(); });
}

function renderSettings() {
  const bindings = state.me.bindings || {};
  const telegramLink = state.me.telegramBotUsername ? `https://t.me/${state.me.telegramBotUsername}?start=${encodeURIComponent(bindings.telegramToken)}` : '';
  $('#tab-settings').innerHTML = `<div class="card profile-editor-card">${profileFormHtml({ id: 'profile-form' })}</div>
  <div class="grid two settings-grid">
    <div class="card"><div class="section-heading"><h2>Telegram</h2>${state.me.telegramChatId ? '<span class="badge good">Linked</span>' : '<span class="badge warn">Not linked</span>'}</div>${state.me.telegramChatId ? '<div class="notice">Telegram is linked and ready for lesson delivery.</div>' : telegramLink ? `<p>Open the bot and press Start to connect this profile.</p><a class="button-link" href="${esc(telegramLink)}" target="_blank" rel="noopener noreferrer">Link Telegram</a>` : '<p class="notice warn">Telegram is not configured by the administrator.</p>'}</div>
    <div class="card"><div class="section-heading"><h2>WhatsApp</h2>${state.me.whatsappJid ? '<span class="badge good">Linked</span>' : '<span class="badge warn">Not linked</span>'}</div>${state.me.whatsappJid ? '<div class="notice">WhatsApp is linked.</div>' : `<p>Send this message to the dedicated WhatsApp number:</p><pre class="code">LINK ${esc(bindings.whatsappCode)}</pre><p class="muted">Number: ${esc(bindings.whatsappNumber || 'Not configured')}</p><p class="muted">Connection: ${esc(state.me.whatsappStatus)}</p>`}</div>
    <div class="card"><h2>Appearance</h2><p>The light or dark theme can be changed from the button in the top bar. Your choice is saved on this device.</p></div>
    <div class="card"><h2>Private access</h2><p class="muted">Keep this link private. Anyone with it can access this learning profile.</p><pre class="code">${esc(state.me.accessUrl)}</pre></div>
  </div>
  <div class="card danger-zone"><div class="section-heading"><div><h2>Delete account and all data</h2><p class="muted">Permanently removes this profile, plans, lessons, reading tracks, progress, messages, tasks, generated cards, and uploaded book files. Protected backups expire through normal rotation.</p></div></div><button class="danger" id="delete-account">Delete my account</button></div>`;
  bindProfileForm('profile-form');
  $('#delete-account').onclick = async () => {
    const confirmation = prompt(`Type your profile name exactly to permanently delete your account and all data:\n\n${state.me.name}`, '');
    if (confirmation === null) return;
    if (confirmation !== state.me.name) return showToast('The profile name did not match. Nothing was deleted.', 'error');
    if (!confirm('This permanently deletes your Knowledge Pilot account and all live data. Continue?')) return;
    const button = $('#delete-account');
    button.disabled = true;
    try {
      await api('/api/account', { method: 'DELETE', body: JSON.stringify({ confirmation }) });
      alert('Your Knowledge Pilot account and live data were permanently deleted.');
      location.replace('/');
    } catch (e) {
      button.disabled = false;
      showToast(e.message || String(e), 'error');
    }
  };
}

function switchTab(name) {
  if (name !== 'today' && selectedLesson() && location.hash.includes('reader=1')) {
    const lesson = selectedLesson();
    const sections = buildLessonSections(lesson);
    const section = sections[readerState.activeIndex || 0];
    if (section) saveExperience(lesson.id, { currentSectionId: section.id, anchorId: section.anchorId, sectionTotal: sections.length }).catch(() => {});
    readerPreferences.focus = false;
    history.replaceState(null, '', location.pathname);
    applyReaderPreferences();
  }
  document.querySelectorAll('.nav-tabs button').forEach((button) => {
    const active = button.dataset.tab === name;
    button.classList.toggle('active', active);
    button.setAttribute('aria-current', active ? 'page' : 'false');
  });
  document.querySelectorAll('.section').forEach((section) => section.classList.toggle('active', section.id === `tab-${name}`));
  if (window.innerWidth < 760) window.scrollTo({ top: 0, behavior: 'smooth' });
}

document.querySelectorAll('.nav-tabs button').forEach((button) => button.onclick = () => switchTab(button.dataset.tab));
window.addEventListener('hashchange', () => { if (location.hash === '#plan') switchTab('plan'); else if (location.hash.startsWith('#book=') || location.hash.startsWith('#book-session=')) { switchTab('books'); renderBooks(); } else { switchTab('today'); renderToday(); } });
load().then(() => { if (location.hash === '#plan') switchTab('plan'); else if (location.hash.startsWith('#book=') || location.hash.startsWith('#book-session=')) switchTab('books'); else if (location.hash.startsWith('#lesson=')) switchTab('today'); });
window.addEventListener('online', retryPendingExperience);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'hidden' || !selectedLesson() || !location.hash.includes('reader=1')) return;
  const lesson = selectedLesson();
  const sections = buildLessonSections(lesson);
  const section = sections[readerState.activeIndex || 0];
  if (section) saveExperience(lesson.id, { currentSectionId: section.id, anchorId: readerState.selection?.anchorId || section.anchorId, sectionTotal: sections.length }).catch(() => {});
});
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
