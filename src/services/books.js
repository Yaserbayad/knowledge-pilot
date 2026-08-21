import { createLessonCard } from './cards.js';
import { queueSystemNotice } from './notices.js';
import { clamp, nowIso, uid } from '../utils.js';

export const BOOK_STANDARD = `You are the book-learning engine for Knowledge Pilot.
Your purpose is to replace most of the learner's need to read the full book while preserving the author's main arguments, chapter knowledge, memorable examples, historical and author context, practical applications, and the ability to discuss the book intelligently.
Explain the author faithfully before evaluating the work. Prioritize evidence and critical assessment where claims are testable. Simplify technical material without changing its meaning. Use only lawfully available material, user-owned extracted text supplied by the server, and verified external sources. Never reproduce substantial copyrighted passages. Quotations must be brief, necessary, attributed, and no more than 25 words combined across the entire session.
Book learning is a separate track connected to topic learning only when genuinely useful. A normal session is 5-10 minutes and introduces new material while integrating recall and review. Label material source limitations whenever they affect accuracy.`;

const ACTIVE_BOOK_STATUSES = new Set(['active', 'paused', 'awaiting_plan_approval', 'queued_analysis']);
const REANALYZE_AFTER_UPLOAD_STATUSES = new Set(['queued_analysis', 'source_required', 'analysis_failed', 'unsupported', 'awaiting_plan_approval']);
const BOOK_TYPES = new Set(['nonfiction', 'business', 'science', 'history', 'psychology', 'biography', 'memoir', 'textbook', 'academic', 'fiction', 'other']);

function clean(value, max = 1000) {
  return String(value || '').trim().slice(0, max);
}

function cleanList(value, max = 20, itemMax = 1000) {
  return Array.isArray(value) ? value.map((item) => clean(item, itemMax)).filter(Boolean).slice(0, max) : [];
}

function normalizeIdentifier(value) {
  return clean(value, 300).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function publicOwnedCopy(source) {
  if (!source) return null;
  return {
    filename: source.filename || '',
    format: source.format || '',
    sizeBytes: Number(source.sizeBytes) || 0,
    extractedCharacters: Number(source.extractedCharacters) || 0,
    uploadedAt: source.uploadedAt || null
  };
}

function publicBook(book) {
  if (!book) return book;
  return { ...book, ownedCopy: publicOwnedCopy(book.ownedCopy) };
}

function validIsbn(value) {
  if (!value) return true;
  if (/^\d{13}$/.test(value)) {
    const sum = value.split('').reduce((total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 1 : 3), 0);
    return sum % 10 === 0;
  }
  if (/^\d{9}[\dX]$/.test(value)) {
    const sum = value.split('').reduce((total, digit, index) => total + (digit === 'X' ? 10 : Number(digit)) * (10 - index), 0);
    return sum % 11 === 0;
  }
  return false;
}

function cancelBookJobs(state, bookId, { includeDelivery = false, includeReview = false } = {}) {
  const sessionIds = new Set(Object.values(state.bookSessions || {}).filter((session) => session.bookId === bookId).map((session) => session.id));
  const cancellable = new Set(['generate_book_session', 'generate_book_finale']);
  if (includeDelivery) cancellable.add('deliver_book_session');
  if (includeReview) {
    cancellable.add('send_book_reminder');
    cancellable.add('send_book_reinforcement');
  }
  for (const job of Object.values(state.jobs || {})) {
    const belongs = job.payload?.bookId === bookId || sessionIds.has(job.payload?.sessionId);
    if (belongs && cancellable.has(job.type) && job.status === 'pending') {
      job.status = 'cancelled';
      job.cancelledAt = nowIso();
      job.updatedAt = nowIso();
    }
  }
}

function queueBookAnalysisTask(state, { businessActions, userId, bookId }) {
  const user = state.users?.[userId];
  if (!user) throw new Error('User no longer exists');
  if (!businessActions) throw new Error('ChatGPT Business Actions service is unavailable');
  const dedupeKey = `book_analysis:${bookId}:active`;
  const existing = Object.values(state.businessTasks || {}).find((task) => task.dedupeKey === dedupeKey && ['pending', 'claimed'].includes(task.status));
  if (existing) return { queued: true, existing: true, task: existing };
  const task = {
    id: uid('btask'), type: 'book_analysis', userId, payload: { bookId }, dedupeKey, priority: 95,
    status: 'pending', claimedAt: null, completedAt: null, attempts: 0, resultRef: null, error: null,
    createdAt: nowIso(), updatedAt: nowIso()
  };
  state.businessTasks ||= {};
  state.businessTasks[task.id] = task;
  const actionConfig = businessActions.config || {};
  if (actionConfig.notifyPendingTasks !== false && user.automation?.notifyActionRequired !== false) {
    queueSystemNotice(state, {
      userId,
      kind: 'processing_required',
      title: 'Verified processing is waiting',
      message: 'A book analysis is queued and waiting for the Knowledge Pilot custom GPT to process it.',
      actionUrl: actionConfig.customGptUrl || businessActions.learning?.accessUrl(user) || '',
      actionLabel: actionConfig.customGptUrl ? 'Open Knowledge Pilot GPT' : 'Open dashboard',
      dedupeKey: `business-task-pending:${task.id}`,
      metadata: { taskId: task.id, taskType: task.type }
    });
  }
  return { queued: true, existing: false, task };
}

function scheduleRemainingBookWork(state, { userId, book, plan, restartExisting = false, startAt = Date.now() }) {
  if (!plan) return;
  const core = (plan.sessions || []).filter((item) => item.isCore !== false);
  const sessionsPerWeek = clamp(Number(plan.sessionsPerWeek) || 3, 1, 7);
  const intervalMs = (7 / sessionsPerWeek) * 24 * 60 * 60 * 1000;
  const sessions = Object.values(state.bookSessions || {}).filter((session) => session.bookId === book.id && session.sessionType !== 'finale');
  const byNumber = new Map(sessions.map((session) => [session.sessionNumber, session]));
  let queueIndex = 0;
  for (const item of core) {
    const existingSession = byNumber.get(item.number);
    if (existingSession && !restartExisting && ['completed', 'delivered', 'scheduled', 'skipped'].includes(existingSession.status)) continue;
    const runAt = new Date(startAt + queueIndex * intervalMs).toISOString();
    queueIndex += 1;
    if (existingSession) {
      if (existingSession.reviewStatus !== 'approved') continue;
      existingSession.status = 'scheduled';
      existingSession.scheduledAt = runAt;
      existingSession.updatedAt = nowIso();
      const exists = Object.values(state.jobs || {}).some((job) => job.type === 'deliver_book_session' && job.payload?.sessionId === existingSession.id && job.status === 'pending');
      if (!exists) {
        const job = { id: uid('job'), type: 'deliver_book_session', userId, payload: { sessionId: existingSession.id }, runAt, status: 'pending', attempts: 0, lastError: null, createdAt: nowIso(), updatedAt: nowIso() };
        state.jobs[job.id] = job;
      }
      continue;
    }
    const exists = Object.values(state.jobs || {}).some((job) => job.type === 'generate_book_session' && job.payload?.bookId === book.id && job.payload?.sessionNumber === item.number && job.status === 'pending');
    if (!exists) {
      const job = { id: uid('job'), type: 'generate_book_session', userId, payload: { bookId: book.id, planId: plan.id, sessionNumber: item.number }, runAt, status: 'pending', attempts: 0, lastError: null, createdAt: nowIso(), updatedAt: nowIso() };
      state.jobs[job.id] = job;
    } else {
      const job = Object.values(state.jobs).find((candidate) => candidate.type === 'generate_book_session' && candidate.payload?.bookId === book.id && candidate.payload?.sessionNumber === item.number && candidate.status === 'pending');
      job.runAt = runAt;
      job.updatedAt = nowIso();
    }
  }
}

export function normalizeBookAnalysis(raw, book, user) {
  const metadata = raw.metadata || {};
  const plan = raw.plan || {};
  const sessions = Array.isArray(plan.sessions) ? plan.sessions.slice(0, 36) : [];
  return {
    metadata: {
      title: clean(metadata.title || book.title, 300),
      author: clean(metadata.author || book.author, 240),
      isbn: clean(metadata.isbn || book.isbn, 40),
      edition: clean(metadata.edition || book.edition, 160),
      language: clean(metadata.language || book.language || user.language, 20),
      publishedYear: Number(metadata.publishedYear) || null,
      publisher: clean(metadata.publisher, 200),
      bookType: BOOK_TYPES.has(metadata.bookType) ? metadata.bookType : 'nonfiction',
      coverUrl: /^https:\/\//.test(metadata.coverUrl || '') ? clean(metadata.coverUrl, 1000) : '',
      description: clean(metadata.description, 1800)
    },
    sourceAssessment: {
      quality: ['high', 'medium', 'limited'].includes(raw.sourceAssessment?.quality) ? raw.sourceAssessment.quality : 'limited',
      fullTextAvailable: Boolean(raw.sourceAssessment?.fullTextAvailable || book.ownedCopy?.extractedCharacters),
      limitations: cleanList(raw.sourceAssessment?.limitations, 10, 600),
      sufficientForDetailedPlan: Boolean(raw.sourceAssessment?.sufficientForDetailedPlan)
    },
    plan: {
      rationale: clean(plan.rationale, 1800),
      recommendedWeeks: clamp(Number(plan.recommendedWeeks) || 4, 1, 24),
      sessionsPerWeek: clamp(Number(plan.sessionsPerWeek) || 3, 1, 7),
      typicalMinutes: clamp(Number(plan.typicalMinutes) || 8, 5, 10),
      difficulty: ['accessible', 'moderate', 'demanding'].includes(plan.difficulty) ? plan.difficulty : 'moderate',
      learningGoals: cleanList(plan.learningGoals, 12, 400),
      reviewCheckpoints: cleanList(plan.reviewCheckpoints, 12, 400),
      finalSynthesis: clean(plan.finalSynthesis || 'Complete synthesis, application plan, and final assessment.', 1000),
      sessions: sessions.map((session, index) => ({
        id: uid('bookplanitem'),
        number: index + 1,
        title: clean(session.title || `Session ${index + 1}`, 240),
        scope: clean(session.scope, 1200),
        chapterRefs: cleanList(session.chapterRefs, 12, 160),
        pageRefs: cleanList(session.pageRefs, 12, 80),
        goals: cleanList(session.goals, 8, 300),
        isCore: session.isCore !== false,
        estimatedMinutes: clamp(Number(session.estimatedMinutes) || Number(plan.typicalMinutes) || 8, 5, 10)
      }))
    },
    sources: Array.isArray(raw.sources) ? raw.sources.slice(0, 20) : [],
    verification: raw.verification || {}
  };
}

export function normalizeBookSession(raw, book, planItem, user, sources = []) {
  const content = raw.content || {};
  const annotations = new Map((Array.isArray(raw.sources) ? raw.sources : []).map((source) => [String(source.id || ''), source]));
  return {
    title: clean(raw.title || planItem.title, 300),
    label: `${book.title} — Session ${planItem.number}`,
    language: clean(raw.language || book.language || user.language, 20),
    estimatedMinutes: clamp(Number(raw.estimatedMinutes) || planItem.estimatedMinutes || 8, 5, 10),
    difficulty: ['accessible', 'moderate', 'demanding'].includes(raw.difficulty) ? raw.difficulty : 'moderate',
    scope: clean(raw.scope || planItem.scope, 1600),
    chapterRefs: cleanList(raw.chapterRefs?.length ? raw.chapterRefs : planItem.chapterRefs, 15, 180),
    pageRefs: cleanList(raw.pageRefs?.length ? raw.pageRefs : planItem.pageRefs, 15, 100),
    content: {
      hook: clean(content.hook, 1200),
      summary: clean(content.summary, 9000),
      importantDetails: cleanList(content.importantDetails, 8, 1200),
      context: clean(content.context, 3200),
      criticalAssessment: clean(content.criticalAssessment, 4200),
      practicalApplication: clean(content.practicalApplication, 3000),
      quotations: Array.isArray(content.quotations) ? content.quotations.slice(0, 3).map((quote) => ({
        text: clean(quote.text, 300),
        location: clean(quote.location, 180)
      })).filter((quote) => quote.text) : [],
      connections: cleanList(content.connections, 6, 700),
      keyIdeas: cleanList(content.keyIdeas, 3, 700),
      reflectionPrompt: clean(content.reflectionPrompt, 1200),
      nextPreview: clean(content.nextPreview, 1200)
    },
    quiz: Array.isArray(raw.quiz) ? raw.quiz.slice(0, 5).map((question) => ({
      id: uid('bookquestion'),
      type: ['recall', 'explanation', 'application', 'comparison'].includes(question.type) ? question.type : 'recall',
      question: clean(question.question, 1000),
      expected: clean(question.expected, 1800)
    })).filter((question) => question.question) : [],
    concepts: Array.isArray(raw.concepts) ? raw.concepts.slice(0, 15).map((concept) => ({
      id: uid('bookconcept'),
      name: clean(concept.name, 200),
      explanation: clean(concept.explanation, 1000),
      topicConnection: clean(concept.topicConnection, 600)
    })).filter((concept) => concept.name) : [],
    topicLinkSuggestions: Array.isArray(raw.topicLinkSuggestions) ? raw.topicLinkSuggestions.slice(0, 8).map((link) => ({
      id: uid('booklink'),
      concept: clean(link.concept, 220),
      topic: clean(link.topic, 220),
      reason: clean(link.reason, 700),
      status: 'pending'
    })).filter((link) => link.concept && link.topic) : [],
    sources: sources.map((source, index) => {
      const annotation = annotations.get(String(source.id || '')) || {};
      return {
        id: source.id || `booksrc_${index + 1}`,
        title: clean(source.title || source.url || 'Book source', 400),
        url: clean(source.url, 1200),
        domain: clean(source.domain, 200),
        accessedAt: source.accessedAt || nowIso(),
        fetchStatus: source.fetchStatus || 'ok',
        excerpt: clean(source.excerpt, 2000),
        sourceType: clean(source.sourceType || annotation.sourceType, 80),
        claimsSupported: cleanList(annotation.claimsSupported || source.claimsSupported, 20, 300)
      };
    }),
    claims: Array.isArray(raw.claims) ? raw.claims.slice(0, 30).map((claim) => ({
      text: clean(claim.text, 1200),
      sourceIds: cleanList(claim.sourceIds, 10, 120)
    })).filter((claim) => claim.text) : [],
    verification: raw.verification || {}
  };
}

export function evaluateBookSession(session, book) {
  const issues = [];
  const warnings = [];
  const content = session.content || {};
  for (const field of ['hook', 'summary', 'context', 'criticalAssessment', 'practicalApplication', 'reflectionPrompt', 'nextPreview']) {
    if (String(content[field] || '').trim().length < 20) issues.push(`Missing or weak ${field}`);
  }
  if (!Array.isArray(content.importantDetails) || content.importantDetails.length < 1) issues.push('At least one important detail is required');
  if (!Array.isArray(content.keyIdeas) || content.keyIdeas.length !== 3) issues.push('Exactly three key ideas are required');
  if (!Array.isArray(session.quiz) || session.quiz.length < 2) issues.push('At least two recall, explanation, application, or comparison questions are required');
  const quotedWords = (content.quotations || []).reduce((total, quote) => total + quote.text.trim().split(/\s+/).filter(Boolean).length, 0);
  if (quotedWords > 25) issues.push('Combined quotations exceed the 25-word session limit');
  const lessonWords = [content.hook, content.summary, ...(content.importantDetails || []), content.context, content.criticalAssessment, content.practicalApplication, ...(content.connections || []), ...(content.keyIdeas || []), content.reflectionPrompt, content.nextPreview]
    .join(' ').trim().split(/\s+/).filter(Boolean).length;
  if (lessonWords < 450) issues.push('Book session is too short for the required depth');
  if (lessonWords > 1800) issues.push('Book session is too long for a 5-10 minute learning unit');
  const successful = (session.sources || []).filter((source) => source.fetchStatus !== 'failed');
  const successfulExternal = successful.filter((source) => source.id !== 'book_text' && source.sourceType !== 'owned_copy');
  if (!book.ownedCopy && successfulExternal.length < 2) issues.push('At least two verified sources are required when no owned copy is available');
  if (book.ownedCopy && successfulExternal.length < 1) issues.push('At least one verified external context or criticism source is required alongside the owned copy');
  const validIds = new Set((session.sources || []).map((source) => source.id));
  const successfulIds = new Set(successful.map((source) => source.id));
  for (const claim of session.claims || []) {
    if (!claim.sourceIds?.length) issues.push('A material claim has no source mapping');
    if ((claim.sourceIds || []).some((id) => !validIds.has(id))) issues.push('A claim cites an unavailable source');
    if ((claim.sourceIds || []).length && !(claim.sourceIds || []).some((id) => successfulIds.has(id))) issues.push('A material claim is supported only by sources that could not be verified');
  }
  return { score: Math.max(0, 100 - issues.length * 12 - warnings.length * 4), issues, warnings, status: issues.length ? 'needs_review' : 'approved' };
}

export class BookLearningService {
  constructor({ store, config, logger, bookFiles }) {
    this.store = store;
    this.config = config;
    this.logger = logger;
    this.bookFiles = bookFiles;
    this.businessActions = null;
  }

  setBusinessActions(service) { this.businessActions = service; }

  async addBook(userId, input = {}) {
    const user = this.store.read((state) => state.users[userId]);
    if (!user) throw new Error('User not found');
    if (!this.businessActions) throw new Error('ChatGPT Business Actions service is unavailable');
    const title = clean(input.title, 300);
    const author = clean(input.author, 240);
    const isbn = clean(input.isbn, 40).replace(/[^0-9Xx]/g, '').toUpperCase();
    const inputUrl = clean(input.url, 1200);
    if (inputUrl && !/^https:\/\//.test(inputUrl)) throw new Error('Book URLs must use public HTTPS');
    if (!validIsbn(isbn)) throw new Error('ISBN must be a valid ISBN-10 or ISBN-13');
    if (!title && !isbn && !inputUrl) throw new Error('Enter a title, ISBN, or public HTTPS book URL');
    const book = {
      id: uid('book'), userId, title: title || 'Book awaiting identification', author, isbn, inputUrl,
      edition: clean(input.edition, 160), language: clean(input.language || user.language, 20), bookType: 'nonfiction',
      coverUrl: '', description: '', publishedYear: null, publisher: '', status: 'queued_analysis', sourceQuality: 'pending',
      sourceLimitations: [], analysisSources: [], ownedCopy: null, activePlanId: null, currentSessionNumber: 0,
      progressPercent: 0, pace: 'standard', sessionPreference: 'balanced', notes: [], bookmarks: [], concepts: [], topicLinkSuggestions: [], analysisTaskId: null, lastAnalysisTaskId: null, analysisIntegrationError: null,
      createdAt: nowIso(), updatedAt: nowIso()
    };
    return this.store.transaction((state) => {
      if (!state.users?.[userId]) throw new Error('User no longer exists');
      state.books ||= {};
      const duplicate = Object.values(state.books).find((candidate) => candidate.userId === userId && (
        (isbn && candidate.isbn === isbn) ||
        (title && normalizeIdentifier(candidate.title) === normalizeIdentifier(title) && normalizeIdentifier(candidate.author) === normalizeIdentifier(author))
      ));
      if (duplicate) return { book: publicBook(duplicate), merged: true, queued: false };
      const activeCount = Object.values(state.books).filter((candidate) => candidate.userId === userId && ACTIVE_BOOK_STATUSES.has(candidate.status)).length;
      if (activeCount >= 3) throw new Error('A learner may have up to three active or pending books');
      state.books[book.id] = book;
      const queued = queueBookAnalysisTask(state, { businessActions: this.businessActions, userId, bookId: book.id });
      book.analysisTaskId = queued.task.id;
      book.updatedAt = nowIso();
      return { book: publicBook(book), merged: false, ...queued };
    });
  }

  async queueAnalysis(userId, bookId, { force = false } = {}) {
    if (!this.businessActions) throw new Error('ChatGPT Business Actions service is unavailable');
    return this.store.transaction((state) => {
      const target = state.books?.[bookId];
      if (!target || target.userId !== userId || !state.users?.[userId]) throw new Error('Book no longer exists');
      const currentTask = target.analysisTaskId ? state.businessTasks?.[target.analysisTaskId] : null;
      const existing = currentTask && ['pending', 'claimed'].includes(currentTask.status) ? currentTask : null;
      if (existing && !force) return { queued: true, existing: true, task: existing };

      cancelBookJobs(state, bookId, { includeDelivery: true });
      for (const task of Object.values(state.businessTasks || {})) {
        if (task.type === 'book_analysis' && task.payload?.bookId === bookId && ['pending', 'claimed'].includes(task.status)) {
          task.status = 'superseded';
          task.error = 'Superseded by a newer book-analysis request.';
          task.updatedAt = nowIso();
        }
      }
      target.status = 'queued_analysis';
      target.sourceQuality = 'pending';
      target.sourceLimitations = [];
      target.analysisIntegrationError = null;
      target.analysisTaskId = null;
      target.updatedAt = nowIso();
      const queued = queueBookAnalysisTask(state, { businessActions: this.businessActions, userId, bookId });
      target.analysisTaskId = queued.task.id;
      target.updatedAt = nowIso();
      return queued;
    });
  }

  getOwnedBook(userId, bookId) {
    const book = this.store.read((state) => state.books?.[bookId]);
    if (!book || book.userId !== userId) throw new Error('Book not found');
    return book;
  }

  list(userId) {
    return this.store.read((state) => Object.values(state.books || {}).filter((book) => book.userId === userId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(publicBook));
  }

  detail(userId, bookId) {
    const snapshot = this.store.read((state) => {
      const book = state.books?.[bookId];
      const fallbackPlan = Object.values(state.bookPlans || {}).filter((plan) => plan.bookId === bookId).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] || null;
      return {
        book,
        plan: book?.activePlanId ? state.bookPlans?.[book.activePlanId] || fallbackPlan : fallbackPlan,
        sessions: Object.values(state.bookSessions || {}).filter((session) => session.bookId === bookId).sort((a, b) => a.sessionNumber - b.sessionNumber)
      };
    });
    if (!snapshot.book || snapshot.book.userId !== userId) throw new Error('Book not found');
    return { ...snapshot, book: publicBook(snapshot.book) };
  }

  async uploadOwnedCopy(userId, bookId, filename, buffer) {
    const existingBook = this.getOwnedBook(userId, bookId);
    const previousSource = existingBook.ownedCopy;
    const shouldReanalyze = REANALYZE_AFTER_UPLOAD_STATUSES.has(existingBook.status);
    const source = await this.bookFiles.save({ userId, bookId, filename, buffer });
    try {
      await this.store.transaction((state) => {
        const book = state.books[bookId];
        if (!book || book.userId !== userId || !state.users?.[userId]) throw new Error('Book no longer exists');
        book.ownedCopy = source;
        book.updatedAt = nowIso();
        return book;
      });
    } catch (error) {
      if (this.bookFiles.removeSource) await this.bookFiles.removeSource(source).catch(() => {});
      throw error;
    }
    if (previousSource && this.bookFiles.removeSource) await this.bookFiles.removeSource(previousSource).catch((error) => {
      this.logger.warn({ error: error.message, userId, bookId }, 'Previous owned book copy could not be removed');
    });
    if (shouldReanalyze) {
      return { ...(await this.queueAnalysis(userId, bookId, { force: true })), book: publicBook(this.getOwnedBook(userId, bookId)), trackPreserved: false };
    }
    return {
      book: publicBook(this.getOwnedBook(userId, bookId)),
      queued: false,
      replaced: Boolean(previousSource),
      trackPreserved: true
    };
  }

  async approvePlan(userId, bookId, input = {}) {
    const { book, plan } = this.detail(userId, bookId);
    if (!plan) throw new Error('Book plan is not available');
    const targetWeeks = clamp(Number(input.targetWeeks) || plan.recommendedWeeks, 1, 24);
    const sessionsPerWeek = clamp(Number(input.sessionsPerWeek) || plan.sessionsPerWeek || 3, 1, 7);
    const now = Date.now();
    const core = plan.sessions.filter((item) => item.isCore !== false);
    await this.store.transaction((state) => {
      const targetPlan = state.bookPlans[plan.id];
      targetPlan.status = 'approved';
      targetPlan.targetWeeks = targetWeeks;
      targetPlan.sessionsPerWeek = sessionsPerWeek;
      targetPlan.approvedAt = nowIso();
      targetPlan.updatedAt = nowIso();
      const targetBook = state.books[bookId];
      targetBook.status = 'active';
      targetBook.activePlanId = plan.id;
      targetBook.updatedAt = nowIso();
      cancelBookJobs(state, bookId);
      scheduleRemainingBookWork(state, { userId, book: targetBook, plan: targetPlan, startAt: now });
      return targetPlan;
    });
    return this.detail(userId, bookId);
  }

  async generateSession(userId, bookId, sessionNumber, options = {}) {
    const { book, plan } = this.detail(userId, bookId);
    if (book.status !== 'active') throw new Error('Book must be active before generating sessions');
    const item = plan?.sessions?.find((candidate) => candidate.number === Number(sessionNumber));
    if (!item) throw new Error('Book plan session not found');
    if (!this.businessActions) throw new Error('ChatGPT Business Actions service is unavailable');
    return this.businessActions.queueBookSession(userId, bookId, plan.id, item.number, options);
  }

  async scheduleSession(sessionId, runAt = new Date().toISOString()) {
    return this.store.transaction((state) => {
      const session = state.bookSessions?.[sessionId];
      if (!session) throw new Error('Book session not found');
      if (session.reviewStatus !== 'approved') throw new Error('Book session must be approved before scheduling');
      if (!['approved', 'scheduled'].includes(session.status)) throw new Error('Book session is not eligible for scheduling');
      const parsedRunAt = new Date(runAt);
      if (Number.isNaN(parsedRunAt.getTime())) throw new Error('Invalid book-session schedule time');
      const existing = Object.values(state.jobs).find((job) => job.type === 'deliver_book_session' && job.payload?.sessionId === sessionId && ['pending', 'running'].includes(job.status));
      if (existing?.status === 'running') throw new Error('Book-session delivery is already in progress');
      session.status = 'scheduled';
      session.scheduledAt = parsedRunAt.toISOString();
      session.updatedAt = nowIso();
      if (existing) {
        existing.runAt = session.scheduledAt;
        existing.updatedAt = nowIso();
        return { session, job: existing };
      }
      const job = { id: uid('job'), type: 'deliver_book_session', userId: session.userId, payload: { sessionId }, runAt: session.scheduledAt, status: 'pending', attempts: 0, lastError: null, createdAt: nowIso(), updatedAt: nowIso() };
      state.jobs[job.id] = job;
      return { session, job };
    });
  }

  async markDelivered(sessionId, results) {
    return this.store.transaction((state) => {
      const session = state.bookSessions?.[sessionId];
      if (!session) throw new Error('Book session not found');
      if (session.status === 'delivered' && session.deliveredAt) return session;
      if (session.status !== 'scheduled') throw new Error('Only a scheduled book session can be delivered');
      session.status = 'delivered'; session.deliveredAt = nowIso(); session.deliveryResults = results; session.updatedAt = nowIso();
      for (const hours of [24, 48]) {
        const job = { id: uid('job'), type: 'send_book_reminder', userId: session.userId, payload: { sessionId }, runAt: new Date(Date.now() + hours * 3600000).toISOString(), status: 'pending', attempts: 0, lastError: null, createdAt: nowIso(), updatedAt: nowIso() };
        state.jobs[job.id] = job;
      }
      return session;
    });
  }

  async completeSession(userId, sessionId) {
    const result = await this.store.transaction((state) => {
      const session = state.bookSessions?.[sessionId];
      if (!session || session.userId !== userId) throw new Error('Book session not found');
      if (session.status === 'completed') {
        const book = state.books[session.bookId];
        return { session, book, allComplete: book.status === 'completed', alreadyCompleted: true };
      }
      if (session.status !== 'delivered') throw new Error('Only a delivered book session can be completed');
      session.status = 'completed'; session.completedAt = nowIso(); session.resumePercent = 100; session.updatedAt = nowIso();
      const book = state.books[session.bookId];
      const plan = state.bookPlans[session.planId];
      const coreNumbers = plan.sessions.filter((item) => item.isCore !== false).map((item) => item.number);
      const completedNumbers = Object.values(state.bookSessions || {}).filter((candidate) => candidate.bookId === book.id && candidate.status === 'completed').map((candidate) => candidate.sessionNumber);
      book.currentSessionNumber = Math.max(book.currentSessionNumber || 0, session.sessionNumber);
      book.progressPercent = Math.round((new Set(completedNumbers.filter((number) => coreNumbers.includes(number))).size / Math.max(coreNumbers.length, 1)) * 100);
      for (const concept of session.concepts || []) {
        const tracked = (book.concepts || []).find((item) => item.sourceSessionId === session.id && item.name.toLowerCase() === concept.name.toLowerCase());
        if (tracked && tracked.mastery === 'introduced') {
          tracked.mastery = 'understood';
          tracked.updatedAt = nowIso();
        }
      }
      const allComplete = coreNumbers.every((number) => completedNumbers.includes(number));
      if (allComplete) book.status = 'completed';
      book.updatedAt = nowIso();
      for (const hours of [4, 24, 72]) {
        const question = session.quiz?.[(hours === 4 ? 0 : hours === 24 ? 1 : 2) % Math.max(session.quiz?.length || 1, 1)];
        if (!question) continue;
        const job = { id: uid('job'), type: 'send_book_reinforcement', userId, payload: { sessionId, questionId: question.id }, runAt: new Date(Date.now() + hours * 3600000).toISOString(), status: 'pending', attempts: 0, lastError: null, createdAt: nowIso(), updatedAt: nowIso() };
        state.jobs[job.id] = job;
      }
      return { session, book, allComplete };
    });
    if (result.allComplete && !result.alreadyCompleted && result.session.sessionType !== 'finale' && this.businessActions) {
      const finaleExists = this.store.read((state) => Object.values(state.bookSessions || {}).some((candidate) => candidate.bookId === result.book.id && candidate.sessionType === 'finale'));
      if (!finaleExists) await this.businessActions.queueBookFinale(userId, result.book.id);
    }
    return result.session;
  }

  async updateResume(userId, sessionId, percent) {
    return this.store.transaction((state) => {
      const session = state.bookSessions?.[sessionId];
      if (!session || session.userId !== userId) throw new Error('Book session not found');
      if (!['delivered', 'completed'].includes(session.status)) throw new Error('Book session is not available for reading yet');
      if (session.status === 'completed') return session;
      session.resumePercent = clamp(Number(percent) || 0, 0, 99); session.updatedAt = nowIso(); return session;
    });
  }

  async addNote(userId, bookId, input = {}) {
    return this.store.transaction((state) => {
      const book = state.books?.[bookId];
      if (!book || book.userId !== userId) throw new Error('Book not found');
      const note = { id: uid('booknote'), text: clean(input.text, 4000), sessionId: clean(input.sessionId, 100), createdAt: nowIso(), updatedAt: nowIso() };
      if (!note.text) throw new Error('Note text is required');
      if (note.sessionId) {
        const session = state.bookSessions?.[note.sessionId];
        if (!session || session.userId !== userId || session.bookId !== bookId || !['delivered', 'completed'].includes(session.status)) throw new Error('Book session is not available for notes');
      }
      book.notes ||= []; book.notes.push(note); book.updatedAt = nowIso(); return note;
    });
  }

  async addBookmark(userId, bookId, input = {}) {
    return this.store.transaction((state) => {
      const book = state.books?.[bookId];
      if (!book || book.userId !== userId) throw new Error('Book not found');
      const bookmark = { id: uid('bookmark'), sessionId: clean(input.sessionId, 100), label: clean(input.label || 'Saved session', 300), createdAt: nowIso() };
      if (!bookmark.sessionId) throw new Error('Book session is required');
      const session = state.bookSessions?.[bookmark.sessionId];
      if (!session || session.userId !== userId || session.bookId !== bookId || !['delivered', 'completed'].includes(session.status)) throw new Error('Book session is not available for bookmarking');
      book.bookmarks ||= []; book.bookmarks.push(bookmark); book.updatedAt = nowIso(); return bookmark;
    });
  }

  async control(userId, bookId, action) {
    const allowed = new Set(['pause', 'resume', 'archive', 'restart', 'speed_up', 'slow_down', 'deeper', 'shorter']);
    if (!allowed.has(action)) throw new Error('Invalid book control');
    return this.store.transaction((state) => {
      const book = state.books?.[bookId];
      if (!book || book.userId !== userId) throw new Error('Book not found');
      const plan = state.bookPlans?.[book.activePlanId];
      if (action === 'pause') {
        if (book.status !== 'active') throw new Error('Only an active book can be paused');
        book.status = 'paused';
      }
      if (action === 'resume') {
        if (book.status !== 'paused') throw new Error('Only a paused book can be resumed');
        if (!plan || plan.status !== 'approved') throw new Error('An approved book plan is required before resuming');
        book.status = 'active';
        scheduleRemainingBookWork(state, { userId, book, plan, startAt: Date.now() });
      }
      if (action === 'archive') {
        book.status = 'archived';
        cancelBookJobs(state, bookId, { includeDelivery: true, includeReview: true });
      }
      if (action === 'restart') {
        cancelBookJobs(state, bookId, { includeDelivery: true, includeReview: true });
        book.status = 'active';
        book.currentSessionNumber = 0;
        book.progressPercent = 0;
        for (const concept of book.concepts || []) {
          concept.mastery = 'introduced';
          concept.updatedAt = nowIso();
        }
        for (const session of Object.values(state.bookSessions || {}).filter((candidate) => candidate.bookId === bookId)) {
          if (session.sessionType === 'finale') {
            session.status = 'archived';
            continue;
          }
          session.status = session.reviewStatus === 'approved' ? 'approved' : 'draft';
          session.completedAt = null;
          session.deliveredAt = null;
          session.scheduledAt = null;
          session.skippedAt = null;
          session.resumePercent = 0;
          session.remindersSent = 0;
          session.updatedAt = nowIso();
        }
        scheduleRemainingBookWork(state, { userId, book, plan, restartExisting: true, startAt: Date.now() });
      }
      if (action === 'speed_up' || action === 'slow_down') {
        if (!plan) throw new Error('Book plan is not available');
        const current = clamp(Number(plan.sessionsPerWeek) || 3, 1, 7);
        plan.sessionsPerWeek = action === 'speed_up' ? Math.min(7, current + 1) : Math.max(1, current - 1);
        const coreCount = (plan.sessions || []).filter((item) => item.isCore !== false).length;
        plan.targetWeeks = Math.max(1, Math.ceil(coreCount / plan.sessionsPerWeek));
        plan.updatedAt = nowIso();
        book.pace = action === 'speed_up' ? 'faster' : 'slower';
        cancelBookJobs(state, bookId, { includeDelivery: true });
        scheduleRemainingBookWork(state, { userId, book, plan, startAt: Date.now() });
      }
      if (action === 'deeper') book.sessionPreference = 'deeper';
      if (action === 'shorter') book.sessionPreference = 'shorter';
      book.updatedAt = nowIso();
      return { book, plan };
    });
  }

  async reviewTopicLink(userId, bookId, linkId, decision) {
    if (!['approve', 'reject'].includes(decision)) throw new Error('Invalid topic-link decision');
    return this.store.transaction((state) => {
      const book = state.books?.[bookId];
      if (!book || book.userId !== userId) throw new Error('Book not found');
      const link = (book.topicLinkSuggestions || []).find((item) => item.id === linkId);
      if (!link) throw new Error('Topic-link suggestion not found');
      link.status = decision === 'approve' ? 'approved' : 'rejected';
      link.reviewedAt = nowIso();
      if (decision === 'approve') {
        book.approvedTopicLinks ||= [];
        if (!book.approvedTopicLinks.some((item) => item.concept === link.concept && item.topic === link.topic)) {
          book.approvedTopicLinks.push({ ...link });
        }
      }
      book.updatedAt = nowIso();
      return link;
    });
  }

  async skipSession(userId, sessionId) {
    return this.store.transaction((state) => {
      const session = state.bookSessions?.[sessionId];
      if (!session || session.userId !== userId) throw new Error('Book session not found');
      if (session.status === 'skipped') return session;
      if (session.status === 'completed') throw new Error('Completed book sessions cannot be skipped');
      session.status = 'skipped';
      session.skippedAt = nowIso();
      session.updatedAt = nowIso();
      for (const job of Object.values(state.jobs || {})) {
        if (job.payload?.sessionId === sessionId && ['deliver_book_session', 'send_book_reminder', 'send_book_reinforcement'].includes(job.type) && job.status === 'pending') {
          job.status = 'cancelled';
          job.cancelledAt = nowIso();
          job.updatedAt = nowIso();
        }
      }
      return session;
    });
  }

  async reviewSession(sessionId, decision, note = '', options = {}) {
    const reviewed = await this.store.transaction((state) => {
      const session = state.bookSessions?.[sessionId];
      if (!session) throw new Error('Book session not found');
      if (options.userId && session.userId !== options.userId) throw new Error('Book session not found');
      if (!['approve', 'reject', 'changes'].includes(decision)) throw new Error('Invalid review decision');
      if (['delivered', 'completed', 'skipped'].includes(session.status)) throw new Error('This book session can no longer be reviewed');
      session.reviewStatus = decision === 'approve' ? 'approved' : decision === 'reject' ? 'rejected' : 'needs_changes';
      session.status = decision === 'approve' ? 'approved' : 'draft';
      session.reviewNote = clean(note, 2000);
      session.reviewedAt = nowIso();
      session.updatedAt = nowIso();
      if (decision !== 'approve') {
        session.scheduledAt = null;
        for (const job of Object.values(state.jobs || {})) {
          if (job.type === 'deliver_book_session' && job.payload?.sessionId === sessionId && job.status === 'pending') {
            job.status = 'cancelled';
            job.cancelledAt = nowIso();
            job.updatedAt = nowIso();
          }
        }
      }
      return session;
    });
    if (decision === 'approve' && options.schedule !== false && (options.forceSchedule || this.#autoScheduleFor(reviewed.userId))) {
      await this.scheduleSession(reviewed.id, this.#automaticRunAt(reviewed.userId));
    }
    return this.store.read((state) => state.bookSessions?.[reviewed.id]);
  }

  async requestSessionRevision(userId, sessionId, note = '') {
    const snapshot = this.store.read((state) => ({ session: state.bookSessions?.[sessionId], user: state.users[userId] }));
    if (!snapshot.session || snapshot.session.userId !== userId || !snapshot.user) throw new Error('Book session not found');
    if (['delivered', 'completed', 'skipped'].includes(snapshot.session.status)) throw new Error('This book session can no longer be revised');
    if (!this.businessActions) throw new Error('ChatGPT Business Actions service is unavailable');
    const revisionNumber = Number(snapshot.session.revisionNumber || 0) + 1;
    await this.store.transaction((state) => {
      const session = state.bookSessions[sessionId];
      session.reviewStatus = 'revision_queued';
      session.status = 'draft';
      session.reviewNote = clean(note, 2000);
      session.revisionNumber = revisionNumber;
      session.scheduledAt = null;
      session.updatedAt = nowIso();
      for (const job of Object.values(state.jobs || {})) {
        if (job.type === 'deliver_book_session' && job.payload?.sessionId === sessionId && job.status === 'pending') {
          job.status = 'cancelled'; job.cancelledAt = nowIso(); job.updatedAt = nowIso();
        }
      }
    });
    return this.businessActions.queueBookSession(userId, snapshot.session.bookId, snapshot.session.planId, snapshot.session.sessionNumber, {
      revisionOf: sessionId,
      revisionNumber,
      requestedChanges: clean(note, 2000),
      mode: snapshot.session.sessionType || 'core'
    });
  }

  #autoScheduleFor(userId) {
    const user = this.store.read((state) => state.users[userId]);
    return this.config.businessActions?.autoScheduleApproved !== false && user?.automation?.autoScheduleApproved !== false;
  }

  #automaticRunAt(userId) {
    const user = this.store.read((state) => state.users[userId]);
    const delay = clamp(Number(user?.automation?.autoScheduleDelayMinutes ?? this.config.businessActions?.autoScheduleDelayMinutes ?? 2), 0, 1440);
    return new Date(Date.now() + delay * 60_000).toISOString();
  }

  async sourceChunk(bookId, offset, limit) {
    const book = this.store.read((state) => state.books?.[bookId]);
    if (!book) throw new Error('Book not found');
    return this.bookFiles.chunk(book.ownedCopy, offset, limit);
  }

  async answerFollowUp(userId, sessionId, question, origin = 'web') {
    const snapshot = this.store.read((state) => ({ user: state.users[userId], session: state.bookSessions?.[sessionId] }));
    if (!snapshot.user || !snapshot.session || snapshot.session.userId !== userId) throw new Error('Book session not found');
    if (!['delivered', 'completed'].includes(snapshot.session.status)) throw new Error('The book session must be delivered before asking a follow-up');
    if (!clean(question, 5000)) throw new Error('Question is required');
    if (!this.businessActions) throw new Error('ChatGPT Business Actions service is unavailable');
    const interaction = {
      id: uid('interaction'), userId, bookId: snapshot.session.bookId, bookSessionId: sessionId,
      type: 'book_follow_up', question: clean(question, 5000), answer: '', confidence: null,
      needsNewLesson: false, suggestedTopic: '', status: 'pending_business', origin, createdAt: nowIso()
    };
    await this.store.transaction((state) => {
      if (!state.users?.[userId] || state.bookSessions?.[sessionId]?.userId !== userId) throw new Error('Book session no longer exists');
      state.interactions[interaction.id] = interaction;
      return interaction;
    });
    const queued = await this.businessActions.queueBookFollowUp(userId, sessionId, interaction.id, origin);
    return { ...interaction, pending: true, taskId: queued.task.id, answer: 'Your book question was queued for verified processing through ChatGPT Business.' };
  }

  async answerPendingReinforcement(userId, answer, origin = 'web') {
    const pending = this.store.read((state) => Object.values(state.messages || {})
      .filter((message) => message.userId === userId && message.kind === 'book_reinforcement' && !message.answeredAt)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]);
    if (!pending) return null;
    const session = this.store.read((state) => state.bookSessions?.[pending.bookSessionId]);
    const question = session?.quiz?.find((item) => item.id === pending.questionId);
    if (!session || !question) return null;
    const interaction = {
      id: uid('interaction'), userId, bookId: session.bookId, bookSessionId: session.id, questionId: question.id,
      type: 'book_answer', answer: clean(answer, 5000), evaluation: null, status: 'pending_business', origin, createdAt: nowIso()
    };
    await this.store.transaction((state) => {
      if (!state.users?.[userId] || state.bookSessions?.[session.id]?.userId !== userId) throw new Error('Book session no longer exists');
      state.interactions[interaction.id] = interaction;
      const message = state.messages[pending.id];
      if (message) { message.answeredAt = nowIso(); message.answer = interaction.answer; }
      return interaction;
    });
    const queued = await this.businessActions.queueBookReinforcement(userId, session.id, question.id, interaction.id, origin);
    return { session, question, pending: true, taskId: queued.task.id, evaluation: { feedback: 'Your answer was queued for verified evaluation through ChatGPT Business.', idealAnswer: '' } };
  }

  async submitSessionFeedback(userId, sessionId, input = {}) {
    return this.store.transaction((state) => {
      const session = state.bookSessions?.[sessionId];
      if (!session || session.userId !== userId) throw new Error('Book session not found');
      if (session.status !== 'completed') throw new Error('Feedback is available after completing the book session');
      session.feedback = {
        useful: input.useful ?? null,
        depth: ['too_shallow', 'right', 'too_deep'].includes(input.depth) ? input.depth : null,
        format: clean(input.format, 120),
        comment: clean(input.comment, 1000),
        submittedAt: nowIso()
      };
      session.updatedAt = nowIso();
      return session.feedback;
    });
  }

  progress(userId) {
    const books = this.list(userId);
    const sessions = this.store.read((state) => Object.values(state.bookSessions || {}).filter((session) => session.userId === userId));
    return {
      totalBooks: books.length,
      activeBooks: books.filter((book) => book.status === 'active').length,
      completedBooks: books.filter((book) => book.status === 'completed').length,
      completedSessions: sessions.filter((session) => session.status === 'completed').length,
      books: books.map((book) => ({ id: book.id, title: book.title, status: book.status, progressPercent: book.progressPercent || 0, currentSessionNumber: book.currentSessionNumber || 0 }))
    };
  }

  async createSessionCard(session, book) {
    return createLessonCard(this.config.cardDir, {
      id: session.id,
      title: session.label,
      topic: `BOOK SESSION • ${book.author || book.title}`,
      language: session.language,
      content: { keyIdeas: session.content.keyIdeas }
    });
  }
}
