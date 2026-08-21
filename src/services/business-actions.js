import { adminTokenMatches } from '../auth.js';
import { removeLessonCard } from './cards.js';
import { evaluateLesson } from './quality.js';
import { defaultLessonExperience, normalizeLesson, normalizePlan, SYSTEM_STANDARD } from './learning.js';
import { BOOK_STANDARD, evaluateBookSession, normalizeBookAnalysis, normalizeBookSession } from './books.js';
import { prepareBookAnalysisSubmission, ResultContractError } from './result-contracts.js';
import { nowIso, uid, weekStartIso } from '../utils.js';
import { queueSystemNotice, taskTypeLabel } from './notices.js';

const TASK_TYPES = new Set([
  'weekly_plan', 'lesson', 'follow_up', 'reinforcement_evaluation',
  'book_analysis', 'book_session', 'book_finale', 'book_follow_up', 'book_reinforcement_evaluation'
]);

function clean(value, max = 1000) {
  return String(value || '').trim().slice(0, max);
}

function cleanList(value, max = 20, itemMax = 1000) {
  return Array.isArray(value) ? value.map((item) => clean(item, itemMax)).filter(Boolean).slice(0, max) : [];
}

function safeUser(user) {
  return {
    id: user.id, name: user.name, language: user.language, timezone: user.timezone,
    interests: user.interests, rankedTopics: user.rankedTopics, avoidedTopics: user.avoidedTopics,
    exampleQuestions: user.exampleQuestions, knowledgeRatings: user.knowledgeRatings,
    mastery: user.mastery, preferredWindows: user.preferredWindows
  };
}

function assertActiveTaskContext(state, task) {
  const activeTask = state.businessTasks?.[task.id];
  if (!state.users?.[task.userId] || !activeTask || !['pending', 'claimed'].includes(activeTask.status)) {
    const error = new Error('Task context no longer exists');
    error.code = 'TASK_CONTEXT_DELETED';
    error.statusCode = 409;
    error.retryable = false;
    throw error;
  }
  return activeTask;
}

function completeActiveTask(state, task, resultRef, { submissionDiagnostics = null } = {}) {
  const target = assertActiveTaskContext(state, task);
  target.status = 'completed';
  target.completedAt = nowIso();
  target.claimedAt ||= nowIso();
  target.resultRef = resultRef || null;
  target.error = null;
  target.lastSubmissionError = null;
  target.acceptedSubmission = submissionDiagnostics ? { ...submissionDiagnostics, acceptedAt: nowIso() } : null;
  delete target.acceptedResult;
  target.updatedAt = nowIso();
  return target;
}

function cleanHttpsUrl(value, label = 'Source URL') {
  const text = clean(value, 2000);
  if (!text) throw new Error(`${label} is required`);
  let parsed;
  try { parsed = new URL(text); } catch { throw new Error(`${label} must be a valid HTTPS URL`); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error(`${label} must use direct HTTPS without embedded credentials`);
  return parsed.toString();
}

function cleanSourceSubmissions(result, max = 20) {
  const submitted = Array.isArray(result?.sources) ? result.sources.slice(0, max) : [];
  const normalized = submitted.map((source, index) => ({
    id: clean(source?.id, 120),
    title: clean(source?.title || source?.url || `Source ${index + 1}`, 400),
    url: cleanHttpsUrl(source?.url, 'Source URL'),
    sourceType: clean(source?.sourceType, 80),
    claimsSupported: cleanList(source?.claimsSupported, 20, 300)
  }));
  const ids = normalized.map((source) => source.id);
  const urls = normalized.map((source) => source.url);
  if (new Set(ids).size !== ids.length || ids.some((id) => !id)) throw new Error('Source IDs must be non-empty and unique');
  if (new Set(urls).size !== urls.length) throw new Error('Source URLs must be unique');
  return normalized;
}

function cleanFollowUpSourceUrls(value) {
  const urls = Array.isArray(value) ? value.slice(0, 8).map((url) => cleanHttpsUrl(url, 'Follow-up source URL')) : [];
  if (new Set(urls).size !== urls.length) throw new Error('Follow-up source URLs must be unique');
  return urls;
}

function queueDirectResponse(state, userId, text, origin, interactionId) {
  if (!state.users?.[userId]) throw new Error('Task user no longer exists');
  const existing = Object.values(state.jobs || {}).find((job) => job.type === 'send_direct_response' && job.payload?.interactionId === interactionId && ['pending', 'running'].includes(job.status));
  if (existing) return existing;
  const job = {
    id: uid('job'), type: 'send_direct_response', userId,
    payload: { text: clean(text, 12000), origin: clean(origin, 40), interactionId },
    runAt: nowIso(), status: 'pending', attempts: 0, lastError: null, createdAt: nowIso(), updatedAt: nowIso()
  };
  state.jobs[job.id] = job;
  return job;
}

function scheduleAcceptedLesson(state, lesson, runAt) {
  const parsed = new Date(runAt);
  if (Number.isNaN(parsed.getTime())) throw new Error('Invalid lesson schedule time');
  const running = Object.values(state.jobs || {}).find((job) => job.type === 'deliver_lesson' && job.payload?.lessonId === lesson.id && job.status === 'running');
  if (running) throw new Error('Lesson delivery is already in progress');
  lesson.status = 'scheduled';
  lesson.scheduledAt = parsed.toISOString();
  lesson.updatedAt = nowIso();
  const job = {
    id: uid('job'), type: 'deliver_lesson', userId: lesson.userId, payload: { lessonId: lesson.id },
    runAt: lesson.scheduledAt, status: 'pending', attempts: 0, lastError: null, createdAt: nowIso(), updatedAt: nowIso()
  };
  state.jobs[job.id] = job;
  return job;
}

function scheduleAcceptedBookSession(state, session, runAt) {
  const parsed = new Date(runAt);
  if (Number.isNaN(parsed.getTime())) throw new Error('Invalid book-session schedule time');
  const running = Object.values(state.jobs || {}).find((job) => job.type === 'deliver_book_session' && job.payload?.sessionId === session.id && job.status === 'running');
  if (running) throw new Error('Book-session delivery is already in progress');
  session.status = 'scheduled';
  session.scheduledAt = parsed.toISOString();
  session.updatedAt = nowIso();
  const job = {
    id: uid('job'), type: 'deliver_book_session', userId: session.userId, payload: { sessionId: session.id },
    runAt: session.scheduledAt, status: 'pending', attempts: 0, lastError: null, createdAt: nowIso(), updatedAt: nowIso()
  };
  state.jobs[job.id] = job;
  return job;
}

function businessAuditIssues(result, { minimumSources = 2 } = {}) {
  const issues = [];
  const verification = result?.verification || {};
  const adversarial = verification.adversarialReview || {};
  const audit = verification.finalAudit || {};
  const required = ['accuracyPassed', 'sourceTraceabilityPassed', 'completenessPassed', 'learnerFitPassed', 'noFabricationPassed'];
  for (const key of required) if (audit[key] !== true) issues.push(`Business final audit did not pass: ${key}`);
  if (!Array.isArray(adversarial.issuesFound)) issues.push('Adversarial review issues are missing');
  if (!Array.isArray(adversarial.correctionsMade)) issues.push('Adversarial review corrections are missing');
  if (Array.isArray(adversarial.unresolvedIssues) && adversarial.unresolvedIssues.length) issues.push('Adversarial review has unresolved issues');
  if (!Array.isArray(result?.sources) || result.sources.length < minimumSources) issues.push(`At least ${minimumSources} independent external source URL(s) are required`);
  return issues;
}

function taskWorkflow(book = false) {
  return [
    'Understand the learner and exact task.',
    book ? 'Identify what book material is lawfully available, including any user-owned extracted text.' : 'Research with current web access using authoritative and primary sources whenever possible.',
    'Triangulate important claims across independent sources.',
    'Separate the author’s position, established evidence, credible disagreement, and uncertainty.',
    'Create the requested output in the learner language.',
    'Perform an adversarial critique for errors, omissions, misleading simplifications, weak citations, and learner mismatch.',
    'Revise the output to resolve every correctable issue.',
    'Run the final audit and submit only when all audit fields can truthfully be true.'
  ];
}

function commonRestrictions(book = false) {
  return [
    'Never invent a source, quotation, statistic, page reference, chapter reference, or citation.',
    'Use direct public HTTPS URLs, not search-result redirect URLs.',
    'Do not submit hidden chain-of-thought. Submit concise audit findings and corrections only.',
    'Simplify without changing factual meaning.',
    'Acknowledge material uncertainty explicitly.',
    ...(book ? [
      'Do not reproduce substantial copyrighted text. Use transformative explanation and summary.',
      'Keep all submitted quotations combined to no more than 25 words per book session, necessary, attributed, and verified.',
      'When the supplied material cannot support chapter-level detail, set sufficientForDetailedPlan to false instead of guessing.'
    ] : [])
  ];
}

function staleClaim(task, timeoutMinutes = 30) {
  if (task?.status !== 'claimed' || !task.claimedAt) return false;
  const claimedAt = new Date(task.claimedAt).getTime();
  return Number.isFinite(claimedAt) && Date.now() - claimedAt >= Math.max(1, Number(timeoutMinutes) || 30) * 60_000;
}

export class BusinessActionsService {
  constructor({ store, research, learning, books = null, config, logger }) {
    this.store = store;
    this.research = research;
    this.learning = learning;
    this.books = books;
    this.config = config;
    this.logger = logger;
  }

  get enabled() { return this.config.enabled; }

  authenticate(value) {
    const token = String(value || '').replace(/^Bearer\s+/i, '');
    return Boolean(this.config.apiKey) && adminTokenMatches(this.config.apiKey, token);
  }

  async queue(type, userId, payload = {}, options = {}) {
    if (!TASK_TYPES.has(type)) throw new Error(`Unsupported Business task type: ${type}`);
    const user = this.store.read((state) => state.users[userId]);
    if (!user) throw new Error('User not found');
    const dedupeKey = options.dedupeKey || `${type}:${userId}:${payload.planId || ''}:${payload.proposalId || ''}:${payload.bookId || ''}:${payload.sessionNumber || ''}:${payload.interactionId || ''}`;
    return this.store.transaction((state) => {
      if (!state.users?.[userId]) throw new Error('User no longer exists');
      const existing = Object.values(state.businessTasks || {}).find((task) => task.dedupeKey === dedupeKey && ['pending', 'claimed'].includes(task.status));
      if (existing) return { queued: true, existing: true, task: existing };
      const task = {
        id: uid('btask'), type, userId, payload, dedupeKey, priority: Number(options.priority) || 50,
        status: 'pending', claimedAt: null, completedAt: null, attempts: 0, resultRef: null, error: null,
        createdAt: nowIso(), updatedAt: nowIso()
      };
      state.businessTasks ||= {}; state.businessTasks[task.id] = task;
      const shouldNotify = this.config.notifyPendingTasks !== false
        && user.automation?.notifyActionRequired !== false
        && ['weekly_plan', 'lesson', 'book_analysis', 'book_session', 'book_finale'].includes(type);
      if (shouldNotify) {
        queueSystemNotice(state, {
          userId,
          kind: 'processing_required',
          title: 'Verified processing is waiting',
          message: `A ${taskTypeLabel(type)} is queued and waiting for the Knowledge Pilot custom GPT to process it.`,
          actionUrl: this.config.customGptUrl || this.learning.accessUrl(user),
          actionLabel: this.config.customGptUrl ? 'Open Knowledge Pilot GPT' : 'Open dashboard',
          dedupeKey: `business-task-pending:${task.id}`,
          metadata: { taskId: task.id, taskType: type }
        });
      }
      return { queued: true, existing: false, task };
    });
  }

  queueWeeklyPlan(userId) { return this.queue('weekly_plan', userId, {}, { dedupeKey: `weekly_plan:${userId}:active`, priority: 70 }); }
  queueLesson(userId, planId, proposalId, options = {}) {
    const revision = options.revisionOf ? `:revision:${options.revisionOf}:${options.revisionNumber || 1}` : '';
    return this.queue('lesson', userId, { planId, proposalId, ...options }, { dedupeKey: `lesson:${planId}:${proposalId}${revision}`, priority: 80 });
  }
  queueFollowUp(userId, lessonId, interactionId, origin) { return this.queue('follow_up', userId, { lessonId, interactionId, origin }, { dedupeKey: `follow_up:${interactionId}`, priority: 90 }); }
  queueReinforcement(userId, lessonId, questionId, interactionId, origin) { return this.queue('reinforcement_evaluation', userId, { lessonId, questionId, interactionId, origin }, { dedupeKey: `reinforcement:${interactionId}`, priority: 85 }); }
  queueBookAnalysis(userId, bookId) { return this.queue('book_analysis', userId, { bookId }, { dedupeKey: `book_analysis:${bookId}:active`, priority: 95 }); }
  queueBookSession(userId, bookId, planId, sessionNumber, options = {}) {
    const revision = options.revisionOf ? `:revision:${options.revisionOf}:${options.mode || 'balanced'}` : '';
    return this.queue('book_session', userId, { bookId, planId, sessionNumber, ...options }, { dedupeKey: `book_session:${bookId}:${sessionNumber}${revision}`, priority: 82 });
  }
  queueBookFinale(userId, bookId) { return this.queue('book_finale', userId, { bookId }, { dedupeKey: `book_finale:${bookId}`, priority: 78 }); }
  queueBookFollowUp(userId, sessionId, interactionId, origin) { return this.queue('book_follow_up', userId, { sessionId, interactionId, origin }, { dedupeKey: `book_follow_up:${interactionId}`, priority: 90 }); }
  queueBookReinforcement(userId, sessionId, questionId, interactionId, origin) { return this.queue('book_reinforcement_evaluation', userId, { sessionId, questionId, interactionId, origin }, { dedupeKey: `book_reinforcement:${interactionId}`, priority: 85 }); }

  list({ status = 'pending', limit = 20 } = {}) {
    return this.store.read((state) => Object.values(state.businessTasks || {})
      .filter((task) => status === 'all' || task.status === status || (status === 'pending' && staleClaim(task, this.config.claimTimeoutMinutes)))
      .sort((a, b) => b.priority - a.priority || a.createdAt.localeCompare(b.createdAt))
      .slice(0, Math.min(Math.max(Number(limit) || 20, 1), 100))
      .map((task) => ({ id: task.id, type: task.type, userId: task.userId, status: task.status, priority: task.priority, createdAt: task.createdAt, claimedAt: task.claimedAt || null, updatedAt: task.updatedAt, error: task.error || null, submissionRejectCount: Number(task.submissionRejectCount || 0), lastSubmissionError: task.lastSubmissionError || null })));
  }

  getTask(taskId) {
    const snapshot = this.store.read((state) => ({
      task: state.businessTasks?.[taskId], users: state.users, plans: state.plans, lessons: state.lessons,
      interactions: state.interactions, books: state.books || {}, bookPlans: state.bookPlans || {}, bookSessions: state.bookSessions || {}
    }));
    const task = snapshot.task;
    if (!task) throw new Error('Business task not found');
    const user = snapshot.users[task.userId];
    if (!user) throw new Error('Task user not found');
    const isBook = task.type.startsWith('book_');
    const common = {
      task: { id: task.id, type: task.type, status: task.status, createdAt: task.createdAt, lastSubmissionError: task.lastSubmissionError || null },
      learner: safeUser(user), governingStandard: isBook ? BOOK_STANDARD : SYSTEM_STANDARD,
      workflow: taskWorkflow(isBook), restrictions: commonRestrictions(isBook)
    };

    if (task.type === 'weekly_plan') {
      const recentLessons = Object.values(snapshot.lessons).filter((lesson) => lesson.userId === user.id)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 12)
        .map((lesson) => ({ title: lesson.title, topic: lesson.topic, status: lesson.status, keyIdeas: lesson.content?.keyIdeas || [], feedback: lesson.feedback || null }));
      return { ...common, recentLessons,
        taskInstructions: 'Create a coherent three-lesson weekly topic plan. Keep one primary subject at roughly 70-80% and secondary exposure at 20-30%. Book sessions are a separate track and must not replace this topic plan. Always introduce new material, use curiosity-first questions, avoid excluded topics, and connect to existing knowledge.',
        resultContract: { primarySubject: 'string', secondarySubjects: ['string'], rationale: 'string', proposals: [{ title: 'string', question: 'string', topic: 'string', reason: 'string', estimatedMinutes: 'number 5-10' }], verification: { learnerFit: 'brief string', noveltyCheck: 'brief string', coherenceCheck: 'brief string' } }
      };
    }

    if (task.type === 'lesson') {
      const plan = snapshot.plans[task.payload.planId];
      const proposal = plan?.proposals?.find((item) => item.id === task.payload.proposalId);
      if (!plan || !proposal) throw new Error('Task plan or proposal not found');
      const previousKnowledge = Object.values(snapshot.lessons).filter((lesson) => lesson.userId === user.id && lesson.status === 'completed')
        .sort((a, b) => b.completedAt.localeCompare(a.completedAt)).slice(0, 10)
        .map((lesson) => ({ title: lesson.title, topic: lesson.topic, keyIdeas: lesson.content?.keyIdeas || [] }));
      const bookKnowledge = Object.values(snapshot.bookSessions).filter((session) => session.userId === user.id && session.status === 'completed')
        .sort((a, b) => b.completedAt.localeCompare(a.completedAt)).slice(0, 6)
        .map((session) => ({ bookTitle: snapshot.books[session.bookId]?.title, title: session.title, keyIdeas: session.content?.keyIdeas || [] }));
      const revisionOf = task.payload.revisionOf ? snapshot.lessons[task.payload.revisionOf] : null;
      return { ...common, plan: { id: plan.id, primarySubject: plan.primarySubject, secondarySubjects: plan.secondarySubjects, rationale: plan.rationale }, proposal, previousKnowledge, bookKnowledge,
        ...(revisionOf ? { revision: { currentLesson: revisionOf, requestedChanges: task.payload.requestedChanges || '', revisionNumber: task.payload.revisionNumber || 1 } } : {}),
        taskInstructions: revisionOf
          ? 'Revise the existing lesson to address the learner request and every valid quality issue. Re-research claims when necessary, preserve accurate material, and return a complete replacement lesson using the normal contract. Perform the adversarial review and final audit after revision.'
          : 'Research and produce one complete 5-10 minute lesson. Every material factual claim must map to one or more submitted source IDs. Include 2-4 recall, explanation, or application questions. Use book knowledge only when it creates a genuine connection. Perform an adversarial review and final audit after revising the lesson.',
        resultContract: {
          title: 'string', question: 'string', topic: 'string', language: 'learner language', estimatedMinutes: 'number 5-10', difficulty: 'easy|moderate|demanding',
          content: { hook: 'string', coreExplanation: 'string', context: 'string', examples: ['string'], perspectives: ['string'], misconceptions: ['string'], practicalMeaning: 'string', knowledgeConnection: 'string', keyIdeas: ['exactly 3 strings'], practicalTakeaway: 'string', reflectionPrompt: 'string', nextTeaser: 'string' },
          quiz: [{ type: 'recall|explanation|application|multiple_choice', question: 'string', expected: 'string', options: ['optional strings'] }],
          sources: [{ id: 'stable source id', title: 'string', url: 'direct public HTTPS URL', sourceType: 'primary|research|textbook|official|expert|journalism', claimsSupported: ['labels'] }],
          claims: [{ text: 'material claim', sourceIds: ['source ids'] }],
          verification: { researchApproach: 'brief string', consensusStatus: 'established|mixed|uncertain', disagreements: ['string'], uncertainty: ['string'], adversarialReview: { issuesFound: ['string'], correctionsMade: ['string'], unresolvedIssues: [] }, finalAudit: { accuracyPassed: true, sourceTraceabilityPassed: true, completenessPassed: true, learnerFitPassed: true, noFabricationPassed: true } }
        }
      };
    }

    if (task.type === 'book_analysis') {
      const book = snapshot.books[task.payload.bookId];
      if (!book) throw new Error('Book analysis context not found');
      const ownedCopy = book.ownedCopy ? {
        available: true, filename: book.ownedCopy.filename, format: book.ownedCopy.format,
        extractedCharacters: book.ownedCopy.extractedCharacters,
        chunkEndpoint: `/api/gpt/books/${book.id}/source-text?offset=0&limit=16000`,
        usage: 'Retrieve chunks repeatedly using nextOffset until the relevant planned scope is covered. Never claim to have read text that was not retrieved. Treat the owned text as the primary source for what the book says, but do not reproduce long passages.'
      } : { available: false };
      return { ...common, book, ownedCopy, contractVersion: 'book-analysis.v2', submissionOperation: 'submitBookAnalysisResult',
        taskInstructions: 'Identify the exact book as reliably as possible. Research its table of contents, structure, arguments, historical/author context, critical reception, and evidence quality. If enough lawful material exists, create a dynamic 5-10 minute session plan, normally three sessions per week, with core sessions, review checkpoints, and a final synthesis. Restructure chapter order only when it improves learning. If source coverage cannot support a detailed plan and no adequate owned copy is available, set sufficientForDetailedPlan=false and explain the limitation rather than guessing. When a sufficiently extracted user-owned copy has been reviewed and at least one independent external context or criticism source is verified, set sufficientForDetailedPlan=true if the submitted plan is complete.',
        resultContract: {
          contractVersion: 'book-analysis.v2',
          metadata: { title: 'string', author: 'string', isbn: 'string', edition: 'string', language: 'user edition language', publishedYear: 'number|null', publisher: 'string', bookType: 'nonfiction|business|science|history|psychology|biography|memoir|textbook|academic|fiction|other', coverUrl: 'https URL or empty', description: 'string' },
          sourceAssessment: { quality: 'high|medium|limited', fullTextAvailable: 'boolean', limitations: ['string'], sufficientForDetailedPlan: 'boolean' },
          plan: { rationale: 'string', recommendedWeeks: '1-24', sessionsPerWeek: 'normally 3', typicalMinutes: '5-10', difficulty: 'accessible|moderate|demanding', learningGoals: ['string'], reviewCheckpoints: ['string'], finalSynthesis: 'string', sessions: [{ title: 'string', scope: 'string', chapterRefs: ['verified references'], pageRefs: ['only when exact edition is known'], goals: ['string'], isCore: true, estimatedMinutes: '5-10' }] },
          sources: [{ id: 'stable id', title: 'string', url: 'direct HTTPS URL', sourceType: 'publisher|author|academic_review|expert_review|library|public_domain|research', claimsSupported: ['labels'] }],
          verification: { researchApproach: 'string', editionConfidence: 'high|medium|low', adversarialReview: { issuesFound: ['string'], correctionsMade: ['string'], unresolvedIssues: [] }, finalAudit: { accuracyPassed: true, sourceTraceabilityPassed: true, completenessPassed: true, learnerFitPassed: true, noFabricationPassed: true } }
        }
      };
    }

    if (task.type === 'book_session' || task.type === 'book_finale') {
      const book = snapshot.books[task.payload.bookId];
      const plan = snapshot.bookPlans[book?.activePlanId] || snapshot.bookPlans[task.payload.planId];
      if (!book || !plan) throw new Error('Book session context not found');
      const isFinale = task.type === 'book_finale';
      const item = isFinale ? {
        number: plan.sessions.length + 1, title: 'Complete book synthesis', scope: plan.finalSynthesis,
        chapterRefs: [], pageRefs: [], goals: ['Synthesize the whole book', 'Create a practical application plan', 'Assess recall and transfer'], estimatedMinutes: 10
      } : plan.sessions.find((candidate) => candidate.number === Number(task.payload.sessionNumber));
      if (!item) throw new Error('Book plan item not found');
      const previousSessions = Object.values(snapshot.bookSessions).filter((session) => session.bookId === book.id && session.status === 'completed')
        .sort((a, b) => a.sessionNumber - b.sessionNumber)
        .map((session) => ({ sessionNumber: session.sessionNumber, title: session.title, keyIdeas: session.content?.keyIdeas || [], concepts: session.concepts || [] }));
      const ownedCopy = book.ownedCopy ? { available: true, extractedCharacters: book.ownedCopy.extractedCharacters, chunkEndpoint: `/api/gpt/books/${book.id}/source-text?offset=0&limit=16000` } : { available: false };
      const revisionOf = task.payload.revisionOf ? snapshot.bookSessions[task.payload.revisionOf] : null;
      return { ...common, book, bookPlan: plan, planItem: item, previousBookSessions: previousSessions, ownedCopy,
        ...(revisionOf ? { revision: { currentSession: revisionOf, requestedChanges: task.payload.requestedChanges || '', revisionNumber: task.payload.revisionNumber || 1 } } : {}),
        taskInstructions: isFinale
          ? 'Create the final synthesis session: explain the complete argument or narrative architecture, preserve memorable examples, provide evidence-based criticism, create a practical application plan, connect genuinely useful topic knowledge, and include a final recall and application assessment.'
          : revisionOf
            ? `Revise Book Session ${item.number} to address the learner request and every valid quality issue. Preserve accurate material, re-check source support, and return a complete replacement session. Keep all quotations combined to 25 words or fewer.`
          : `Create Book Session ${item.number} as a transformative 450-1800 word learning experience for approximately 5-10 minutes. Faithfully explain the relevant part of the book, include important details and examples, essential context, evidence-based criticism, practical application, exactly three key ideas, and 2-4 recall/explanation/application/comparison questions. Keep all quotations combined to 25 words or fewer. Use the learner's requested preference: ${book.sessionPreference || 'balanced'}.`,
        resultContract: {
          title: 'string', language: 'learner language', estimatedMinutes: '5-10', difficulty: 'accessible|moderate|demanding', scope: 'string', chapterRefs: ['verified'], pageRefs: ['only if exact edition known'],
          content: { hook: 'string', summary: 'transformative explanation', importantDetails: ['string'], context: 'string', criticalAssessment: 'string', practicalApplication: 'string', quotations: [{ text: 'brief verified excerpt; all quotations combined must total no more than 25 words', location: 'chapter/page if verified' }], connections: ['string'], keyIdeas: ['exactly 3'], reflectionPrompt: 'string', nextPreview: 'string' },
          quiz: [{ type: 'recall|explanation|application|comparison', question: 'string', expected: 'string' }],
          concepts: [{ name: 'string', explanation: 'string', topicConnection: 'optional string' }],
          topicLinkSuggestions: [{ concept: 'string', topic: 'existing or suitable topic', reason: 'string' }],
          sources: [{ id: 'external stable id; use book_text in claims for owned-copy evidence', title: 'string', url: 'direct HTTPS URL', sourceType: 'publisher|author|academic_review|expert_review|library|public_domain|research', claimsSupported: ['labels'] }],
          claims: [{ text: 'material claim', sourceIds: ['external ids and/or book_text'] }],
          verification: { researchApproach: 'string', authorFaithfulness: 'string', criticismBasis: 'string', sourceLimitations: ['string'], adversarialReview: { issuesFound: ['string'], correctionsMade: ['string'], unresolvedIssues: [] }, finalAudit: { accuracyPassed: true, sourceTraceabilityPassed: true, completenessPassed: true, learnerFitPassed: true, noFabricationPassed: true } }
        }
      };
    }

    if (task.type === 'follow_up' || task.type === 'book_follow_up') {
      const isBookFollowUp = task.type === 'book_follow_up';
      const content = isBookFollowUp ? snapshot.bookSessions[task.payload.sessionId] : snapshot.lessons[task.payload.lessonId];
      const interaction = snapshot.interactions[task.payload.interactionId];
      if (!content || !interaction) throw new Error('Follow-up context not found');
      return { ...common, [isBookFollowUp ? 'bookSession' : 'lesson']: content, question: interaction.question,
        taskInstructions: `Answer directly in the learner language using the verified ${isBookFollowUp ? 'book session and book context' : 'lesson'} sources. State material uncertainty and do not quote substantial book text. Recommend a future session when deeper treatment is required.`,
        resultContract: { answer: 'string', confidence: 'high|medium|low', needsNewLesson: 'boolean', suggestedTopic: 'string', sourceUrls: ['optional HTTPS URLs'], verification: { accuracyChecked: true, noFabricationPassed: true } }
      };
    }

    const isBookReinforcement = task.type === 'book_reinforcement_evaluation';
    const content = isBookReinforcement ? snapshot.bookSessions[task.payload.sessionId] : snapshot.lessons[task.payload.lessonId];
    const question = content?.quiz?.find((item) => item.id === task.payload.questionId);
    const interaction = snapshot.interactions[task.payload.interactionId];
    if (!content || !question || !interaction) throw new Error('Reinforcement context not found');
    return { ...common, [isBookReinforcement ? 'bookSession' : 'lesson']: { id: content.id, title: content.title, topic: content.topic || snapshot.books[content.bookId]?.title }, question, learnerAnswer: interaction.answer,
      taskInstructions: 'Evaluate meaning, not exact wording. Be fair and concise. Identify the most important correction or missing element.',
      resultContract: { correct: 'boolean', score: '0-100', feedback: 'brief string', idealAnswer: 'brief string', verification: { fairnessChecked: true } }
    };
  }

  async claim(taskId) {
    return this.store.transaction((state) => {
      const task = state.businessTasks?.[taskId];
      if (!task) throw new Error('Business task not found');
      if (!['pending', 'claimed'].includes(task.status)) throw new Error(`Task cannot be claimed from status ${task.status}`);
      const reclaiming = staleClaim(task, this.config.claimTimeoutMinutes);
      if (task.status === 'pending' || reclaiming) {
        task.status = 'claimed';
        task.claimedAt = nowIso();
        task.attempts += 1;
        task.updatedAt = nowIso();
      }
      return task;
    });
  }

  async submit(taskId, result) {
    const task = this.store.read((state) => state.businessTasks?.[taskId]);
    if (!task) throw new Error('Business task not found');
    if (!['pending', 'claimed'].includes(task.status)) throw new Error(`Task is already ${task.status}`);

    let preparedResult = result;
    let submissionDiagnostics = null;
    try {
      if (task.type === 'book_analysis') {
        const book = this.store.read((state) => state.books?.[task.payload.bookId]);
        const prepared = prepareBookAnalysisSubmission(result, { book });
        preparedResult = prepared.result;
        submissionDiagnostics = prepared.diagnostics;
      }

      let output;
      if (task.type === 'weekly_plan') output = await this.#submitPlan(task, preparedResult);
      else if (task.type === 'lesson') output = await this.#submitLesson(task, preparedResult);
      else if (task.type === 'follow_up' || task.type === 'book_follow_up') output = await this.#submitFollowUp(task, preparedResult);
      else if (task.type === 'reinforcement_evaluation' || task.type === 'book_reinforcement_evaluation') output = await this.#submitReinforcement(task, preparedResult);
      else if (task.type === 'book_analysis') output = await this.#submitBookAnalysis(task, preparedResult, submissionDiagnostics);
      else if (task.type === 'book_session' || task.type === 'book_finale') output = await this.#submitBookSession(task, preparedResult);
      else throw new Error(`Unsupported task type: ${task.type}`);

      return submissionDiagnostics ? { ...output, submission: { accepted: true, ...submissionDiagnostics } } : output;
    } catch (error) {
      await this.#recordSubmissionRejection(taskId, error);
      throw error;
    }
  }

  async submitBookAnalysis(taskId, result) {
    const task = this.store.read((state) => state.businessTasks?.[taskId]);
    if (!task) throw new Error('Business task not found');
    if (task.type !== 'book_analysis') {
      const error = new ResultContractError('The specialized book-analysis endpoint can only accept book_analysis tasks', [`Task ${taskId} has type ${task.type}`]);
      await this.#recordSubmissionRejection(taskId, error);
      throw error;
    }
    return this.submit(taskId, result);
  }

  async #recordSubmissionRejection(taskId, error) {
    const retryable = error?.retryable !== false;
    const details = Array.isArray(error?.details) ? error.details.slice(0, 30).map((value) => clean(value, 1000)) : [];
    const diagnostics = error?.diagnostics && typeof error.diagnostics === 'object' ? error.diagnostics : {};
    await this.store.transaction((state) => {
      const task = state.businessTasks?.[taskId];
      if (!task || task.status === 'completed') return task || null;
      task.submissionRejectCount = Number(task.submissionRejectCount || 0) + 1;
      task.lastSubmissionError = {
        code: clean(error?.code || 'SUBMISSION_REJECTED', 120),
        message: clean(error?.message || 'Submission rejected', 2000),
        details,
        diagnostics,
        retryable,
        rejectedAt: nowIso()
      };
      task.error = task.lastSubmissionError.message;
      task.updatedAt = nowIso();
      if (retryable) {
        task.status = 'pending';
        task.claimedAt = null;
      } else {
        task.status = 'failed';
      }
      if (task.type === 'book_analysis') {
        const book = state.books?.[task.payload.bookId];
        if (book && retryable) {
          book.status = 'queued_analysis';
          book.analysisIntegrationError = task.lastSubmissionError;
          book.updatedAt = nowIso();
        }
      }
      const user = state.users?.[task.userId];
      if (user?.automation?.notifyActionRequired !== false) {
        queueSystemNotice(state, {
          userId: task.userId,
          kind: retryable ? 'processing_retry_required' : 'processing_failed',
          title: retryable ? 'Processing needs another attempt' : 'Processing failed',
          message: retryable
            ? `The ${taskTypeLabel(task.type)} result did not pass server validation and remains queued for correction.`
            : `The ${taskTypeLabel(task.type)} could not be completed automatically. Open Knowledge Pilot to review the failure.`,
          actionUrl: this.config.customGptUrl || this.learning.accessUrl(user),
          actionLabel: this.config.customGptUrl ? 'Open Knowledge Pilot GPT' : 'Open dashboard',
          dedupeKey: `business-task-rejection:${task.id}:${task.submissionRejectCount}`,
          metadata: { taskId: task.id, taskType: task.type, retryable, error: task.lastSubmissionError.message }
        });
      }
      return task;
    });
  }

  async fail(taskId, reason) {
    return this.store.transaction((state) => {
      const task = state.businessTasks?.[taskId];
      if (!task) throw new Error('Business task not found');
      const message = clean(reason || 'Unspecified failure', 2000);
      const integrationFailure = task.type === 'book_analysis'
        && /contract|schema|parsing|integration|server[- ]side result|result[- ]contract/i.test(message);

      if (integrationFailure) {
        task.status = 'pending';
        task.claimedAt = null;
        task.error = `Retryable integration issue reported by the GPT: ${message}`;
        task.lastSubmissionError = {
          code: 'CLIENT_REPORTED_CONTRACT_ERROR',
          message: task.error,
          details: [],
          diagnostics: {},
          retryable: true,
          rejectedAt: nowIso()
        };
        const book = state.books?.[task.payload.bookId];
        if (book) {
          book.status = 'queued_analysis';
          book.analysisIntegrationError = task.lastSubmissionError;
          book.updatedAt = nowIso();
        }
        task.updatedAt = nowIso();
        return task;
      }

      task.status = 'failed';
      task.error = message;
      task.updatedAt = nowIso();
      if (task.type === 'book_analysis') {
        const book = state.books?.[task.payload.bookId];
        if (book) {
          book.status = 'analysis_failed';
          if (book.analysisTaskId === task.id) book.analysisTaskId = null;
          book.sourceLimitations ||= [];
          if (!book.sourceLimitations.includes(task.error)) book.sourceLimitations.push(task.error);
          book.updatedAt = nowIso();
        }
      }
      const user = state.users?.[task.userId];
      if (user?.automation?.notifyActionRequired !== false) {
        queueSystemNotice(state, {
          userId: task.userId,
          kind: 'processing_failed',
          title: 'Processing failed',
          message: `The ${taskTypeLabel(task.type)} could not be completed automatically. Open Knowledge Pilot to retry or review the error.`,
          actionUrl: this.config.customGptUrl || this.learning.accessUrl(user),
          actionLabel: this.config.customGptUrl ? 'Open Knowledge Pilot GPT' : 'Open dashboard',
          dedupeKey: `business-task-failed:${task.id}`,
          metadata: { taskId: task.id, taskType: task.type, error: task.error }
        });
      }
      return task;
    });
  }

  async #submitPlan(task, result) {
    const user = this.store.read((state) => state.users[task.userId]);
    const normalized = normalizePlan(result, user);
    if (normalized.proposals.length !== 3) throw new Error('A Business weekly plan must contain exactly three proposals');
    if (!String(normalized.rationale || '').trim()) throw new Error('The weekly plan needs a rationale');
    if (normalized.proposals.some((proposal) => proposal.estimatedMinutes < 5 || proposal.estimatedMinutes > 10)) throw new Error('Business plan lessons must be estimated at 5-10 minutes');
    const primaryCount = normalized.proposals.filter((proposal) => proposal.topic.toLowerCase() === normalized.primarySubject.toLowerCase()).length;
    if (primaryCount < 2) throw new Error('At least two of three proposals must advance the primary subject');
    const excluded = (user.avoidedTopics || []).map((value) => value.toLowerCase());
    if (normalized.proposals.some((proposal) => excluded.some((term) => `${proposal.topic} ${proposal.title}`.toLowerCase().includes(term)))) throw new Error('The plan includes an avoided topic');
    const verification = result.verification || {};
    for (const key of ['learnerFit', 'noveltyCheck', 'coherenceCheck']) if (!String(verification[key] || '').trim()) throw new Error(`Plan verification is missing ${key}`);
    const plan = { id: uid('plan'), userId: user.id, weekStart: weekStartIso(new Date(), user.timezone), status: 'draft', ...normalized, businessVerification: result.verification || null, generatedBy: 'chatgpt_business_action', approvedAt: null, createdAt: nowIso(), updatedAt: nowIso() };
    await this.store.transaction((state) => {
      assertActiveTaskContext(state, task);
      state.plans[plan.id] = plan;
      if (user.automation?.notifyActionRequired !== false) {
        queueSystemNotice(state, {
          userId: user.id,
          kind: 'weekly_plan_ready',
          title: 'Weekly plan ready',
          message: `Your new weekly plan for “${plan.primarySubject}” is ready for review.`,
          actionUrl: `${this.learning.accessUrl(user)}#plan`,
          actionLabel: 'Review weekly plan',
          dedupeKey: `weekly-plan-ready:${plan.id}`,
          metadata: { planId: plan.id }
        });
      }
      completeActiveTask(state, task, plan.id);
      return plan;
    });
    return { kind: 'weekly_plan', plan };
  }

  async #submitLesson(task, result) {
    const snapshot = this.store.read((state) => ({ user: state.users[task.userId], plan: state.plans[task.payload.planId], lessons: state.lessons || {} }));
    const proposal = snapshot.plan?.proposals?.find((item) => item.id === task.payload.proposalId);
    if (!snapshot.user || !snapshot.plan || !proposal) throw new Error('Task lesson context no longer exists');
    const submittedSources = cleanSourceSubmissions(result, 12);
    const fetchedSources = await this.research.fetchUrls(submittedSources);
    const normalized = normalizeLesson(result, proposal, fetchedSources, snapshot.user);
    const existing = task.payload.revisionOf
      ? snapshot.lessons[task.payload.revisionOf]
      : Object.values(snapshot.lessons).find((candidate) => candidate.planId === snapshot.plan.id && candidate.proposalId === proposal.id && !['completed', 'delivered'].includes(candidate.status));
    const lesson = { id: existing?.id || uid('lesson'), userId: snapshot.user.id, planId: snapshot.plan.id, proposalId: proposal.id, ...normalized, status: 'draft', reviewStatus: 'pending', quality: null, businessVerification: result.verification || null, generatedBy: 'chatgpt_business_action', cardFile: null, scheduledAt: null, deliveredAt: null, completedAt: null, resumePercent: 0, experience: defaultLessonExperience(), remindersSent: 0, feedback: existing?.feedback || null, revisionNumber: Number(task.payload.revisionNumber || existing?.revisionNumber || 0), createdAt: existing?.createdAt || nowIso(), updatedAt: nowIso() };
    const baseQuality = evaluateLesson(lesson);
    const auditIssues = businessAuditIssues(result);
    const failedSources = lesson.sources.filter((source) => source.fetchStatus === 'failed');
    const warnings = [...(baseQuality.warnings || [])];
    if (failedSources.length) warnings.push(`${failedSources.length} optional submitted source(s) could not be fetched and were excluded from validation`);
    lesson.quality = { ...baseQuality, issues: [...baseQuality.issues, ...auditIssues], warnings, score: Math.max(0, baseQuality.score - auditIssues.length * 10 - Math.max(0, warnings.length - (baseQuality.warnings || []).length) * 3) };
    lesson.quality.status = lesson.quality.issues.length === 0 ? 'approved' : 'needs_review'; lesson.reviewStatus = lesson.quality.status;
    if (lesson.reviewStatus === 'approved') lesson.status = 'approved';
    try {
      await this.store.transaction((state) => {
        assertActiveTaskContext(state, task);
        if (!state.plans?.[snapshot.plan.id]) throw new Error('Task lesson context no longer exists');
        const running = Object.values(state.jobs || {}).find((job) => job.type === 'deliver_lesson' && job.payload?.lessonId === lesson.id && job.status === 'running');
        if (running) throw new Error('Lesson delivery is already in progress');
        state.lessons[lesson.id] = lesson;
        for (const job of Object.values(state.jobs || {})) {
          if (job.type === 'deliver_lesson' && job.payload?.lessonId === lesson.id && job.status === 'pending') {
            job.status = 'cancelled';
            job.cancelledAt = nowIso();
            job.updatedAt = nowIso();
          }
        }
        if (snapshot.user.automation?.notifyActionRequired !== false && lesson.reviewStatus === 'needs_review') {
          queueSystemNotice(state, {
            userId: lesson.userId,
            kind: 'lesson_review_required',
            title: 'Lesson needs your review',
            message: `“${lesson.title}” is ready, but automated validation found ${lesson.quality.issues.length} item(s) that require your decision.`,
            actionUrl: `${this.learning.accessUrl(snapshot.user)}#lesson=${lesson.id}`,
            actionLabel: 'Review lesson',
            dedupeKey: `lesson-review:${lesson.id}:r${lesson.revisionNumber || 0}`,
            metadata: { lessonId: lesson.id, issues: lesson.quality.issues }
          });
        } else if (lesson.reviewStatus === 'approved' && this.#autoScheduleFor(snapshot.user)) {
          scheduleAcceptedLesson(state, lesson, this.#automaticRunAt(snapshot.user));
        } else if (lesson.reviewStatus === 'approved' && snapshot.user.automation?.notifyActionRequired !== false) {
          queueSystemNotice(state, {
            userId: lesson.userId,
            kind: 'lesson_ready_to_schedule',
            title: 'Lesson ready to schedule',
            message: `“${lesson.title}” passed validation and is waiting for your delivery decision.`,
            actionUrl: `${this.learning.accessUrl(snapshot.user)}#lesson=${lesson.id}`,
            actionLabel: 'Open lesson',
            dedupeKey: `lesson-ready-unscheduled:${lesson.id}:r${lesson.revisionNumber || 0}`,
            metadata: { lessonId: lesson.id }
          });
        }
        completeActiveTask(state, task, lesson.id);
        return lesson;
      });
    } catch (error) {
      await removeLessonCard(this.config.cardDir, lesson.cardFile).catch(() => {});
      throw error;
    }
    return { kind: 'lesson', lesson };
  }

  async #submitBookAnalysis(task, result, submissionDiagnostics = null) {
    if (!this.books) throw new Error('Book service is unavailable');
    const snapshot = this.store.read((state) => ({ user: state.users[task.userId], book: state.books?.[task.payload.bookId] }));
    if (!snapshot.user || !snapshot.book) throw new Error('Book analysis context no longer exists');
    if (snapshot.book.analysisTaskId && snapshot.book.analysisTaskId !== task.id) {
      const error = new Error('A newer book-analysis task has replaced this submission');
      error.code = 'STALE_BOOK_ANALYSIS_TASK';
      error.statusCode = 409;
      error.retryable = false;
      throw error;
    }
    const submittedSources = cleanSourceSubmissions(result, 20);
    const fetchedSources = await this.research.fetchUrls(submittedSources);
    const normalized = normalizeBookAnalysis(result, snapshot.book, snapshot.user);
    const auditIssues = businessAuditIssues(result, { minimumSources: snapshot.book.ownedCopy ? 1 : 2 });
    const successfulSources = fetchedSources.filter((source) => source.fetchStatus === 'ok');
    const failedSources = fetchedSources.filter((source) => source.fetchStatus === 'failed');
    const minimumSuccessfulSources = snapshot.book.ownedCopy ? 1 : 2;
    const successfulDomains = new Set(successfulSources.map((source) => source.domain).filter(Boolean));
    const planIsStructurallyComplete = normalized.plan.sessions.length >= 4
      && normalized.plan.learningGoals.length >= 2
      && Boolean(normalized.plan.finalSynthesis);
    const ownedCopyCanSupportPlan = Boolean(snapshot.book.ownedCopy)
      && normalized.sourceAssessment.fullTextAvailable
      && planIsStructurallyComplete
      && successfulSources.length >= 1;
    const effectiveSufficientForDetailedPlan = normalized.sourceAssessment.sufficientForDetailedPlan || ownedCopyCanSupportPlan;

    if (effectiveSufficientForDetailedPlan) {
      if (normalized.plan.sessions.length < 4) auditIssues.push('A detailed book plan requires at least four sessions');
      if (normalized.plan.learningGoals.length < 2) auditIssues.push('The book plan requires at least two learning goals');
      if (!normalized.plan.finalSynthesis) auditIssues.push('The book plan requires a final synthesis description');
      const minimumWeeksForCadence = Math.ceil(normalized.plan.sessions.length / Math.max(normalized.plan.sessionsPerWeek, 1));
      if (normalized.plan.recommendedWeeks < minimumWeeksForCadence) normalized.plan.recommendedWeeks = minimumWeeksForCadence;
    }
    if (successfulSources.length < minimumSuccessfulSources) {
      auditIssues.push(`Fewer than ${minimumSuccessfulSources} submitted source(s) could be fetched successfully`);
    }
    if (!snapshot.book.ownedCopy && successfulDomains.size < 2) {
      auditIssues.push('Fewer than two independently diverse source domains could be verified');
    }
    if (auditIssues.length) throw new Error(`Book analysis failed verification: ${auditIssues.join('; ')}`);
    const fetchLimitations = failedSources.length
      ? [`${failedSources.length} submitted source(s) could not be fetched by the server and were excluded from verification.`]
      : [];
    const serverPromotionLimitations = !normalized.sourceAssessment.sufficientForDetailedPlan && ownedCopyCanSupportPlan
      ? ['The submitted analysis marked source coverage as limited, but the server accepted the detailed plan because a user-owned full text, a complete plan, and verified external context were available.']
      : [];
    const effectiveSourceQuality = ownedCopyCanSupportPlan && normalized.sourceAssessment.quality === 'limited'
      ? 'medium'
      : normalized.sourceAssessment.quality;
    let plan = null;
    const book = await this.store.transaction((state) => {
      assertActiveTaskContext(state, task);
      const target = state.books[snapshot.book.id];
      if (!target) throw new Error('Book analysis context no longer exists');
      const fictionDeferred = normalized.metadata.bookType === 'fiction';
      Object.assign(target, normalized.metadata, {
        sourceQuality: effectiveSourceQuality,
        sourceLimitations: fictionDeferred
          ? ['Fiction and literary guided-reading support is deferred from this version.']
          : [...normalized.sourceAssessment.limitations, ...fetchLimitations, ...serverPromotionLimitations],
        analysisSources: fetchedSources,
        businessVerification: {
          ...normalized.verification,
          serverAssessment: {
            modelSufficientForDetailedPlan: normalized.sourceAssessment.sufficientForDetailedPlan,
            effectiveSufficientForDetailedPlan,
            ownedCopyAvailable: Boolean(snapshot.book.ownedCopy),
            verifiedExternalSources: successfulSources.length,
            verifiedExternalDomains: successfulDomains.size,
            planIsStructurallyComplete,
            submissionContract: submissionDiagnostics
          }
        },
        status: fictionDeferred ? 'unsupported' : effectiveSufficientForDetailedPlan ? 'awaiting_plan_approval' : 'source_required',
        lastAnalysisTaskId: task.id,
        analysisTaskId: null,
        analysisIntegrationError: null,
        updatedAt: nowIso()
      });
      if (!fictionDeferred && effectiveSufficientForDetailedPlan) {
        for (const existingPlan of Object.values(state.bookPlans || {})) {
          if (existingPlan.bookId === target.id && existingPlan.status === 'draft') {
            existingPlan.status = 'superseded';
            existingPlan.updatedAt = nowIso();
          }
        }
        plan = { id: uid('bookplan'), userId: target.userId, bookId: target.id, status: 'draft', ...normalized.plan, targetWeeks: normalized.plan.recommendedWeeks, approvedAt: null, createdAt: nowIso(), updatedAt: nowIso() };
        state.bookPlans ||= {}; state.bookPlans[plan.id] = plan; target.activePlanId = plan.id;
        const job = { id: uid('job'), type: 'notify_book_plan', userId: target.userId, payload: { bookId: target.id }, runAt: nowIso(), status: 'pending', attempts: 0, lastError: null, createdAt: nowIso(), updatedAt: nowIso() };
        state.jobs[job.id] = job;
      } else if (snapshot.user.automation?.notifyActionRequired !== false) {
        const needsCopy = target.status === 'source_required';
        queueSystemNotice(state, {
          userId: target.userId,
          kind: needsCopy ? 'book_source_required' : 'book_unsupported',
          title: needsCopy ? 'Book source needed' : 'Book cannot continue automatically',
          message: needsCopy
            ? `Knowledge Pilot needs your legally obtained copy of “${target.title}” before it can build an accurate detailed plan.`
            : `“${target.title}” is not supported by the current guided-reading workflow.`,
          actionUrl: `${this.learning.accessUrl(snapshot.user)}#book=${target.id}`,
          actionLabel: needsCopy ? 'Upload owned copy' : 'Open book',
          dedupeKey: `${needsCopy ? 'book-source' : 'book-unsupported'}:${target.id}:${task.id}`,
          metadata: { bookId: target.id }
        });
      }
      completeActiveTask(state, task, target.id, { submissionDiagnostics });
      return target;
    });
    return { kind: 'book_analysis', book, plan, requiresOwnedCopy: book.status === 'source_required' };
  }

  async #submitBookSession(task, result) {
    if (!this.books) throw new Error('Book service is unavailable');
    const snapshot = this.store.read((state) => ({ user: state.users[task.userId], book: state.books?.[task.payload.bookId], plans: state.bookPlans || {}, sessions: state.bookSessions || {} }));
    if (!snapshot.user || !snapshot.book) throw new Error('Book session context no longer exists');
    const plan = snapshot.plans[snapshot.book.activePlanId] || snapshot.plans[task.payload.planId];
    if (!plan) throw new Error('Book plan no longer exists');
    const isFinale = task.type === 'book_finale';
    const planItem = isFinale
      ? { number: plan.sessions.length + 1, title: 'Complete book synthesis', scope: plan.finalSynthesis, chapterRefs: [], pageRefs: [], estimatedMinutes: 10 }
      : plan.sessions.find((item) => item.number === Number(task.payload.sessionNumber));
    if (!planItem) throw new Error('Book plan item no longer exists');

    const submittedSources = cleanSourceSubmissions(result, 16);
    const fetchedSources = await this.research.fetchUrls(submittedSources);
    if (snapshot.book.ownedCopy) fetchedSources.unshift({ id: 'book_text', title: `${snapshot.book.title} — user-owned copy`, url: '', domain: 'local-owned-copy', accessedAt: nowIso(), fetchStatus: 'ok', excerpt: 'Privately uploaded and extracted user-owned book text.', sourceType: 'owned_copy', claimsSupported: ['book content'] });

    const normalized = normalizeBookSession(result, snapshot.book, planItem, snapshot.user, fetchedSources);
    const existing = task.payload.revisionOf
      ? snapshot.sessions[task.payload.revisionOf]
      : Object.values(snapshot.sessions).find((candidate) => candidate.bookId === snapshot.book.id && candidate.sessionNumber === planItem.number && candidate.sessionType === (isFinale ? 'finale' : 'core') && !['completed', 'delivered'].includes(candidate.status));
    const session = {
      id: existing?.id || uid('booksession'), userId: snapshot.user.id, bookId: snapshot.book.id, planId: plan.id,
      sessionNumber: planItem.number, sessionType: isFinale ? 'finale' : 'core', ...normalized,
      status: 'draft', reviewStatus: 'pending', quality: null, generatedBy: 'chatgpt_business_action',
      businessVerification: result.verification || null, cardFile: null, scheduledAt: null, deliveredAt: null,
      completedAt: null, resumePercent: 0, remindersSent: 0,
      revisionNumber: Number(task.payload.revisionNumber || existing?.revisionNumber || 0),
      createdAt: existing?.createdAt || nowIso(), updatedAt: nowIso()
    };
    const quality = evaluateBookSession(session, snapshot.book);
    const auditIssues = businessAuditIssues(result, { minimumSources: snapshot.book.ownedCopy ? 1 : 2 });
    const failedExternal = fetchedSources.filter((source) => source.id !== 'book_text' && source.fetchStatus === 'failed');
    const warnings = [...(quality.warnings || [])];
    if (failedExternal.length) warnings.push(`${failedExternal.length} optional submitted source(s) could not be fetched and were excluded from validation`);
    session.quality = {
      ...quality,
      issues: [...quality.issues, ...auditIssues],
      warnings,
      score: Math.max(0, quality.score - auditIssues.length * 10 - Math.max(0, warnings.length - (quality.warnings || []).length) * 3)
    };
    session.quality.status = session.quality.issues.length ? 'needs_review' : 'approved';
    session.reviewStatus = session.quality.status;
    if (session.reviewStatus === 'approved') session.status = 'approved';
    session.cardFile = await this.books.createSessionCard(session, snapshot.book);

    try {
      await this.store.transaction((state) => {
        assertActiveTaskContext(state, task);
        if (!state.books?.[session.bookId] || !state.bookPlans?.[plan.id]) throw new Error('Book session context no longer exists');
        const running = Object.values(state.jobs || {}).find((job) => job.type === 'deliver_book_session' && job.payload?.sessionId === session.id && job.status === 'running');
        if (running) throw new Error('Book-session delivery is already in progress');
        state.bookSessions ||= {};
        state.bookSessions[session.id] = session;
        for (const job of Object.values(state.jobs || {})) {
          if (job.type === 'deliver_book_session' && job.payload?.sessionId === session.id && job.status === 'pending') {
            job.status = 'cancelled'; job.cancelledAt = nowIso(); job.updatedAt = nowIso();
          }
        }
        const book = state.books[session.bookId];
        book.concepts ||= [];
        for (const concept of session.concepts) if (!book.concepts.some((item) => item.name.toLowerCase() === concept.name.toLowerCase())) book.concepts.push({ ...concept, mastery: 'introduced', sourceSessionId: session.id });
        book.topicLinkSuggestions ||= [];
        for (const link of session.topicLinkSuggestions) {
          const exists = book.topicLinkSuggestions.some((item) => item.concept.toLowerCase() === link.concept.toLowerCase() && item.topic.toLowerCase() === link.topic.toLowerCase());
          if (!exists) book.topicLinkSuggestions.push(link);
        }
        book.updatedAt = nowIso();
        if (snapshot.user.automation?.notifyActionRequired !== false && session.reviewStatus === 'needs_review') {
          queueSystemNotice(state, {
            userId: session.userId,
            kind: 'book_session_review_required',
            title: 'Book session needs your review',
            message: `“${snapshot.book.title} — Session ${session.sessionNumber}” is ready, but automated validation found ${session.quality.issues.length} item(s) requiring your decision.`,
            actionUrl: `${this.learning.accessUrl(snapshot.user)}#book-session=${session.id}`,
            actionLabel: 'Review book session',
            dedupeKey: `book-session-review:${session.id}:r${session.revisionNumber || 0}`,
            metadata: { bookId: session.bookId, sessionId: session.id, issues: session.quality.issues }
          });
        } else if (session.reviewStatus === 'approved' && this.#autoScheduleFor(snapshot.user)) {
          scheduleAcceptedBookSession(state, session, this.#automaticRunAt(snapshot.user));
        } else if (session.reviewStatus === 'approved' && snapshot.user.automation?.notifyActionRequired !== false) {
          queueSystemNotice(state, {
            userId: session.userId,
            kind: 'book_session_ready_to_schedule',
            title: 'Book session ready to schedule',
            message: `“${snapshot.book.title} — Session ${session.sessionNumber}” passed validation and is waiting for your delivery decision.`,
            actionUrl: `${this.learning.accessUrl(snapshot.user)}#book-session=${session.id}`,
            actionLabel: 'Open book session',
            dedupeKey: `book-session-ready-unscheduled:${session.id}:r${session.revisionNumber || 0}`,
            metadata: { bookId: session.bookId, sessionId: session.id }
          });
        }
        completeActiveTask(state, task, session.id);
        return session;
      });
    } catch (error) {
      await removeLessonCard(this.config.cardDir, session.cardFile).catch(() => {});
      throw error;
    }

    return { kind: isFinale ? 'book_finale' : 'book_session', session };
  }

  async #submitFollowUp(task, result) {
    const answer = clean(result.answer, 12000);
    if (answer.length < 20) throw new Error('Follow-up answer is missing or too short');
    if (result.verification?.accuracyChecked !== true || result.verification?.noFabricationPassed !== true) throw new Error('Follow-up verification did not pass');
    const sourceUrls = cleanFollowUpSourceUrls(result.sourceUrls);
    const updated = await this.store.transaction((state) => {
      assertActiveTaskContext(state, task);
      const interaction = state.interactions[task.payload.interactionId]; if (!interaction) throw new Error('Follow-up interaction not found');
      interaction.answer = answer;
      interaction.confidence = ['high', 'medium', 'low'].includes(result.confidence) ? result.confidence : 'medium';
      interaction.needsNewLesson = Boolean(result.needsNewLesson);
      interaction.suggestedTopic = clean(result.suggestedTopic, 300);
      interaction.sourceUrls = sourceUrls;
      interaction.status = 'completed'; interaction.completedAt = nowIso();
      if (task.payload.origin && task.payload.origin !== 'web') queueDirectResponse(state, task.userId, interaction.answer, task.payload.origin, interaction.id);
      completeActiveTask(state, task, interaction.id);
      return interaction;
    });
    return { kind: task.type === 'book_follow_up' ? 'book_follow_up' : 'follow_up', interaction: updated };
  }

  async #submitReinforcement(task, result) {
    if (result.verification?.fairnessChecked !== true) throw new Error('Reinforcement fairness verification did not pass');
    const feedback = clean(result.feedback, 4000);
    const idealAnswer = clean(result.idealAnswer, 5000);
    if (!feedback || !idealAnswer) throw new Error('Reinforcement feedback and ideal answer are required');
    const updated = await this.store.transaction((state) => {
      assertActiveTaskContext(state, task);
      const interaction = state.interactions[task.payload.interactionId]; if (!interaction) throw new Error('Reinforcement interaction not found');
      interaction.evaluation = { correct: Boolean(result.correct), score: Math.max(0, Math.min(100, Number(result.score) || 0)), feedback, idealAnswer };
      interaction.status = 'completed'; interaction.completedAt = nowIso();
      if (task.type === 'book_reinforcement_evaluation' && interaction.evaluation.score >= 70) {
        const session = state.bookSessions?.[task.payload.sessionId];
        const book = session ? state.books?.[session.bookId] : null;
        if (book) {
          for (const concept of book.concepts || []) {
            if (concept.sourceSessionId === session.id) {
              concept.mastery = interaction.evaluation.score >= 85 ? 'retained' : 'understood';
              concept.updatedAt = nowIso();
            }
          }
          book.updatedAt = nowIso();
        }
      }
      const text = `${interaction.evaluation.feedback}\n\nSuggested answer: ${interaction.evaluation.idealAnswer}`;
      if (task.payload.origin && task.payload.origin !== 'web') queueDirectResponse(state, task.userId, text, task.payload.origin, interaction.id);
      completeActiveTask(state, task, interaction.id);
      return interaction;
    });
    return { kind: task.type === 'book_reinforcement_evaluation' ? 'book_reinforcement_evaluation' : 'reinforcement_evaluation', interaction: updated };
  }

  #autoScheduleFor(user) {
    return this.config.autoScheduleApproved !== false && user?.automation?.autoScheduleApproved !== false;
  }

  #automaticRunAt(user) {
    const delay = Math.max(0, Math.min(1440, Number(user?.automation?.autoScheduleDelayMinutes ?? this.config.autoScheduleDelayMinutes ?? 2) || 0));
    return new Date(Date.now() + delay * 60_000).toISOString();
  }
}
