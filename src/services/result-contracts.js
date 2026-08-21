import crypto from 'node:crypto';

const WRAPPER_KEYS = ['result', 'payload', 'data', 'output', 'bookAnalysis', 'book_analysis'];

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseJsonString(value, label) {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed || !['{', '['].includes(trimmed[0])) return value;
  try {
    return JSON.parse(trimmed);
  } catch (error) {
    throw new ResultContractError(`${label} contains invalid JSON`, [`${label}: ${error.message}`]);
  }
}

function unwrapResult(input) {
  let value = parseJsonString(input, 'request body');
  const wrappers = [];
  for (let depth = 0; depth < 4; depth += 1) {
    if (!isObject(value)) break;
    const meaningfulKeys = Object.keys(value).filter((key) => value[key] !== undefined);
    const wrapper = WRAPPER_KEYS.find((key) => Object.hasOwn(value, key));
    const hasKnownContractField = ['metadata', 'bookMetadata', 'sourceAssessment', 'source_assessment', 'plan', 'bookPlan', 'learningPlan', 'sources', 'verification'].some((key) => Object.hasOwn(value, key));
    if (!wrapper || hasKnownContractField || meaningfulKeys.length > 3) break;
    value = parseJsonString(value[wrapper], wrapper);
    wrappers.push(wrapper);
  }
  return { value, wrappers };
}

function pick(object, keys) {
  if (!isObject(object)) return undefined;
  for (const key of keys) if (object[key] !== undefined && object[key] !== null) return object[key];
  return undefined;
}

function objectField(object, keys, label, { required = false } = {}) {
  let value = pick(object, keys);
  value = parseJsonString(value, label);
  if (value === undefined || value === null || value === '') {
    if (required) throw new ResultContractError(`${label} is required`, [`Missing ${label}`]);
    return {};
  }
  if (!isObject(value)) throw new ResultContractError(`${label} must be an object`, [`Received ${typeof value} for ${label}`]);
  return value;
}

function arrayField(object, keys, label, { required = false } = {}) {
  let value = pick(object, keys);
  value = parseJsonString(value, label);
  if (value === undefined || value === null || value === '') {
    if (required) throw new ResultContractError(`${label} is required`, [`Missing ${label}`]);
    return [];
  }
  if (!Array.isArray(value)) throw new ResultContractError(`${label} must be an array`, [`Received ${typeof value} for ${label}`]);
  return value;
}

function boolValue(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;
  }
  return fallback;
}

function numberValue(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return value;
}

function stringValue(value) {
  return value === undefined || value === null ? '' : String(value);
}

function stringArrayValue(value) {
  const parsed = parseJsonString(value, 'array field');
  if (!Array.isArray(parsed)) return [];
  return parsed.map((item) => stringValue(item)).filter(Boolean);
}

function normalizeSession(session, index) {
  const raw = parseJsonString(session, `plan.sessions[${index}]`);
  if (!isObject(raw)) throw new ResultContractError(`plan.sessions[${index}] must be an object`, [`Invalid session at index ${index}`]);
  return {
    title: stringValue(pick(raw, ['title', 'name'])),
    scope: stringValue(pick(raw, ['scope', 'summary', 'coverage'])),
    chapterRefs: stringArrayValue(pick(raw, ['chapterRefs', 'chapters', 'chapterReferences'])),
    pageRefs: stringArrayValue(pick(raw, ['pageRefs', 'pages', 'pageReferences'])),
    goals: stringArrayValue(pick(raw, ['goals', 'learningGoals', 'objectives'])),
    isCore: raw.isCore === undefined ? true : boolValue(raw.isCore, true),
    estimatedMinutes: numberValue(pick(raw, ['estimatedMinutes', 'minutes', 'durationMinutes']))
  };
}

function validateCompletePlan(plan) {
  const issues = [];
  if (!stringValue(plan.rationale).trim()) issues.push('plan.rationale is required');
  const weeks = Number(plan.recommendedWeeks);
  if (!Number.isFinite(weeks) || weeks < 1 || weeks > 24) issues.push('plan.recommendedWeeks must be between 1 and 24');
  const perWeek = Number(plan.sessionsPerWeek);
  if (!Number.isFinite(perWeek) || perWeek < 1 || perWeek > 7) issues.push('plan.sessionsPerWeek must be between 1 and 7');
  const minutes = Number(plan.typicalMinutes);
  if (!Number.isFinite(minutes) || minutes < 5 || minutes > 10) issues.push('plan.typicalMinutes must be between 5 and 10');
  if (!['accessible', 'moderate', 'demanding'].includes(plan.difficulty)) issues.push('plan.difficulty must be accessible, moderate, or demanding');
  if (!Array.isArray(plan.learningGoals) || plan.learningGoals.length < 2) issues.push('plan.learningGoals requires at least two entries');
  if (!stringValue(plan.finalSynthesis).trim()) issues.push('plan.finalSynthesis is required');
  if (!Array.isArray(plan.sessions) || plan.sessions.length < 4) issues.push('plan.sessions requires at least four sessions');
  for (const [index, session] of (plan.sessions || []).entries()) {
    if (!stringValue(session.title).trim()) issues.push(`plan.sessions[${index}].title is required`);
    if (!stringValue(session.scope).trim()) issues.push(`plan.sessions[${index}].scope is required`);
    if (!Array.isArray(session.goals) || session.goals.length < 1) issues.push(`plan.sessions[${index}].goals requires at least one entry`);
    const sessionMinutes = Number(session.estimatedMinutes);
    if (!Number.isFinite(sessionMinutes) || sessionMinutes < 5 || sessionMinutes > 10) issues.push(`plan.sessions[${index}].estimatedMinutes must be between 5 and 10`);
  }
  return issues;
}

export class ResultContractError extends Error {
  constructor(message, details = [], diagnostics = {}) {
    super(message);
    this.name = 'ResultContractError';
    this.code = 'RESULT_CONTRACT_INVALID';
    this.statusCode = 422;
    this.retryable = true;
    this.details = details;
    this.diagnostics = diagnostics;
    this.expectedOperation = 'submitBookAnalysisResult';
  }
}

export function prepareBookAnalysisSubmission(input, { book } = {}) {
  const { value: unwrapped, wrappers } = unwrapResult(input);
  if (!isObject(unwrapped)) throw new ResultContractError('Book-analysis submission must be a JSON object', ['The request body could not be interpreted as an object'], { wrappers });

  const metadata = objectField(unwrapped, ['metadata', 'bookMetadata', 'book_metadata'], 'metadata', { required: true });
  const sourceAssessment = objectField(unwrapped, ['sourceAssessment', 'source_assessment', 'sourceEvaluation', 'source_evaluation'], 'sourceAssessment', { required: true });
  const planRaw = objectField(unwrapped, ['plan', 'bookPlan', 'learningPlan', 'analysisPlan'], 'plan', { required: true });
  const sessionsRaw = arrayField(planRaw, ['sessions', 'sessionPlan', 'modules', 'lessons'], 'plan.sessions', { required: true });
  const sources = arrayField(unwrapped, ['sources', 'sourceList', 'source_list'], 'sources', { required: true });
  const verification = objectField(unwrapped, ['verification', 'audit', 'qualityAudit'], 'verification', { required: true });

  const canonicalPlan = {
    rationale: stringValue(pick(planRaw, ['rationale', 'reasoning', 'planRationale'])),
    recommendedWeeks: numberValue(pick(planRaw, ['recommendedWeeks', 'targetWeeks', 'durationWeeks'])),
    sessionsPerWeek: numberValue(pick(planRaw, ['sessionsPerWeek', 'weeklySessions', 'cadencePerWeek'])),
    typicalMinutes: numberValue(pick(planRaw, ['typicalMinutes', 'minutesPerSession', 'sessionMinutes'])),
    difficulty: stringValue(pick(planRaw, ['difficulty', 'level'])),
    learningGoals: stringArrayValue(pick(planRaw, ['learningGoals', 'goals', 'objectives'])),
    reviewCheckpoints: stringArrayValue(pick(planRaw, ['reviewCheckpoints', 'checkpoints', 'reviews'])),
    finalSynthesis: stringValue(pick(planRaw, ['finalSynthesis', 'finale', 'completionSynthesis'])),
    sessions: sessionsRaw.map(normalizeSession)
  };

  const canonical = {
    contractVersion: stringValue(pick(unwrapped, ['contractVersion', 'contract_version']) || 'book-analysis.v2'),
    metadata: {
      title: stringValue(pick(metadata, ['title', 'bookTitle'])),
      author: stringValue(pick(metadata, ['author', 'authors'])),
      isbn: stringValue(metadata.isbn),
      edition: stringValue(metadata.edition),
      language: stringValue(metadata.language),
      publishedYear: numberValue(pick(metadata, ['publishedYear', 'year'])),
      publisher: stringValue(metadata.publisher),
      bookType: stringValue(pick(metadata, ['bookType', 'type', 'category'])),
      coverUrl: stringValue(pick(metadata, ['coverUrl', 'cover'])),
      description: stringValue(pick(metadata, ['description', 'summary']))
    },
    sourceAssessment: {
      quality: stringValue(sourceAssessment.quality),
      fullTextAvailable: boolValue(sourceAssessment.fullTextAvailable, Boolean(book?.ownedCopy?.extractedCharacters)),
      limitations: stringArrayValue(sourceAssessment.limitations),
      sufficientForDetailedPlan: boolValue(sourceAssessment.sufficientForDetailedPlan, false)
    },
    plan: canonicalPlan,
    sources,
    verification
  };

  const planIssues = validateCompletePlan(canonical.plan);
  const ownedTextPresent = Boolean(book?.ownedCopy?.extractedCharacters);
  const shouldRequireCompletePlan = canonical.sourceAssessment.sufficientForDetailedPlan
    || (ownedTextPresent && canonical.sourceAssessment.fullTextAvailable && canonical.sources.length >= 1);
  const diagnostics = {
    wrappers,
    receivedTopLevelKeys: Object.keys(unwrapped).sort(),
    contractVersion: canonical.contractVersion,
    planDetected: true,
    sessionCount: canonical.plan.sessions.length,
    sourceCount: canonical.sources.length,
    ownedTextPresent,
    fullTextAvailable: canonical.sourceAssessment.fullTextAvailable,
    sufficientForDetailedPlan: canonical.sourceAssessment.sufficientForDetailedPlan,
    payloadHash: crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex')
  };

  const issues = [];
  if (!canonical.metadata.title && !book?.title) issues.push('metadata.title is required');
  if (!canonical.metadata.author && !book?.author) issues.push('metadata.author is required');
  if (!['high', 'medium', 'limited'].includes(canonical.sourceAssessment.quality)) issues.push('sourceAssessment.quality must be high, medium, or limited');
  if (canonical.sources.length < 1) issues.push('At least one source is required');
  if (shouldRequireCompletePlan) issues.push(...planIssues);
  if (canonical.contractVersion !== 'book-analysis.v2') issues.push('contractVersion must be book-analysis.v2');

  if (issues.length) {
    throw new ResultContractError('Book-analysis result failed contract validation', issues, diagnostics);
  }

  return { result: canonical, diagnostics, planIssues };
}
