import { BusinessActionsService as CoreBusinessActionsService } from './business-actions-core.js';
import { READING_BLOCK_TYPES, normalizeReadingDocument } from './reading-document.js';

const BILINGUAL_TASK_TYPES = new Set(['lesson', 'book_session', 'book_finale']);
const RETRYABLE_INTEGRATION_PATTERN = /readingdocument|result[- ]contract|submission[- ]schema|schema(?: mismatch| validation| error)?|parsing|integration|server[- ]side result/i;
const WEEKLY_PLAN_TOPIC_RULE = 'For weekly plans, proposal.topic is the validator subject-allocation label: for at least two of the three proposals, set proposal.topic exactly equal to primarySubject using the same wording (comparison is case-insensitive). Put narrower subtopic specificity in the proposal title, question, and reason instead of replacing the subject-allocation topic.';

const READING_DOCUMENT_CONTRACT = Object.freeze({
  version: 1,
  languages: ['en', 'ar'],
  rule: 'English and Arabic must describe the same logical sections and blocks using the same stable ids and one shared evidence/source model.',
  blockTypes: [...READING_BLOCK_TYPES]
});

function readingDocumentResultContract() {
  const localizedOptional = { en: 'optional string', ar: 'optional string' };
  const localizedRequired = { en: 'string', ar: 'string' };
  return {
    version: 1,
    defaultLanguage: 'en|ar',
    hero: {
      eyebrow: localizedOptional,
      title: localizedRequired,
      lede: localizedOptional,
      readTimeMinutes: 'number 1-30'
    },
    sections: [{
      id: 'stable lowercase logical id shared across languages',
      kicker: localizedOptional,
      title: localizedRequired,
      lede: localizedOptional,
      optional: 'boolean',
      blocks: [{
        id: 'stable lowercase logical id shared across languages',
        type: READING_BLOCK_TYPES.join('|'),
        label: localizedOptional,
        title: localizedOptional,
        text: { en: 'optional paired content', ar: 'optional paired content' },
        caption: localizedOptional,
        prompt: localizedOptional,
        output: localizedOptional,
        list: { en: ['aligned strings'], ar: ['aligned strings'] },
        items: [{
          id: 'stable lowercase item id',
          label: localizedOptional,
          title: localizedOptional,
          text: localizedRequired
        }],
        steps: [{
          id: 'stable lowercase step id',
          label: localizedOptional,
          title: localizedOptional,
          text: localizedRequired,
          output: localizedOptional
        }],
        columns: [localizedRequired],
        rows: [{
          id: 'stable lowercase row id',
          label: localizedRequired,
          cells: [localizedRequired]
        }],
        options: [{
          id: 'stable lowercase option id',
          text: localizedRequired
        }],
        expectedOptionId: 'required when options are supplied'
      }]
    }],
    glossary: [{ id: 'stable id', term: localizedRequired, definition: localizedRequired }],
    ending: { title: localizedRequired, text: localizedRequired }
  };
}

function taskUsesReadingDocument(task) {
  return BILINGUAL_TASK_TYPES.has(task?.type) && task?.payload?.readingDocumentContract === 'v1';
}

function retryableIntegrationMessage(task) {
  return String(task?.lastSubmissionError?.message || task?.error || '');
}

function recoverableReadingFailure(task) {
  return taskUsesReadingDocument(task)
    && task?.status === 'failed'
    && RETRYABLE_INTEGRATION_PATTERN.test(retryableIntegrationMessage(task));
}

function recoverableRetryableFailure(task) {
  return recoverableReadingFailure(task) || (
    task?.type !== 'book_analysis'
    && task?.status === 'failed'
    && task?.lastSubmissionError?.retryable === true
  );
}

function taskSummary(task, status = task.status) {
  return {
    id: task.id,
    type: task.type,
    userId: task.userId,
    status,
    priority: task.priority,
    createdAt: task.createdAt,
    claimedAt: status === 'pending' ? null : (task.claimedAt || null),
    updatedAt: task.updatedAt,
    error: task.error || null,
    submissionRejectCount: Number(task.submissionRejectCount || 0),
    lastSubmissionError: task.lastSubmissionError || null
  };
}

function addWeeklyPlanContract(context) {
  const resultContract = context?.resultContract && typeof context.resultContract === 'object'
    ? context.resultContract
    : {};
  const proposalShape = Array.isArray(resultContract.proposals)
    && resultContract.proposals[0]
    && typeof resultContract.proposals[0] === 'object'
    ? resultContract.proposals[0]
    : null;
  return {
    ...context,
    taskInstructions: `${WEEKLY_PLAN_TOPIC_RULE} ${context.taskInstructions}`,
    resultContract: proposalShape
      ? {
          ...resultContract,
          proposals: [{
            ...proposalShape,
            topic: 'string; for at least two proposals exactly equal primarySubject'
          }]
        }
      : resultContract
  };
}

function addBilingualContract(context) {
  return {
    ...context,
    readingDocumentContract: READING_DOCUMENT_CONTRACT,
    taskInstructions: `Produce the complete ReadingDocument in English and Arabic atomically from the same researched evidence. Preserve identical logical section/block ids, meaning, claims, examples, checks, and source basis across both languages. Do not translate by inventing or omitting facts. Keep the established flat lesson/session content in the learner's configured language for concise Telegram/WhatsApp delivery and backward compatibility; the ReadingDocument is the bilingual web-reading payload. The learner language controls the default opening/channel language only. Every optional bilingual field must either be omitted or contain both en and ar. When using items, steps, columns, rows, or options, follow the explicit structured resultContract shapes exactly. ${context.taskInstructions}`,
    resultContract: {
      ...context.resultContract,
      readingDocument: readingDocumentResultContract()
    }
  };
}

function submissionContractError(cause) {
  const message = String(cause?.message || 'ReadingDocument v1 failed result-contract validation').trim().slice(0, 2000);
  const error = new Error(message);
  error.code = 'RESULT_CONTRACT_INVALID';
  error.statusCode = 422;
  error.retryable = true;
  error.details = [message];
  error.diagnostics = {
    contract: 'reading-document.v1',
    originalCode: String(cause?.code || 'INVALID_READING_DOCUMENT').slice(0, 120)
  };
  return error;
}

export class BusinessActionsService extends CoreBusinessActionsService {
  async queue(type, userId, payload = {}, options = {}) {
    const versionedPayload = this.config.readingDocumentContract === 'v1' && BILINGUAL_TASK_TYPES.has(type)
      ? { ...payload, readingDocumentContract: 'v1' }
      : payload;
    return super.queue(type, userId, versionedPayload, options);
  }

  list(options = {}) {
    const status = options.status || 'pending';
    if (status !== 'pending') return super.list(options);
    const limit = Math.min(Math.max(Number(options.limit) || 20, 1), 100);
    const normal = super.list({ status: 'pending', limit: 100 });
    const recovered = this.store.read((state) => Object.values(state.businessTasks || {})
      .filter(recoverableRetryableFailure)
      .map((task) => taskSummary(task, 'pending')));
    const combined = new Map(normal.map((task) => [task.id, task]));
    for (const task of recovered) combined.set(task.id, task);
    return [...combined.values()]
      .sort((a, b) => b.priority - a.priority || a.createdAt.localeCompare(b.createdAt))
      .slice(0, limit);
  }

  getTask(taskId) {
    const context = super.getTask(taskId);
    const task = this.store.read((state) => state.businessTasks?.[taskId]);
    const recoveredContext = recoverableRetryableFailure(task)
      ? {
          ...context,
          task: { ...context.task, status: 'pending' },
          retryingPriorIntegrationFailure: true
        }
      : context;
    const contractContext = task?.type === 'weekly_plan'
      ? addWeeklyPlanContract(recoveredContext)
      : recoveredContext;
    return taskUsesReadingDocument(task) ? addBilingualContract(contractContext) : contractContext;
  }

  async #recordRetryableContractError(taskId, error, { reuseExisting = false } = {}) {
    const now = new Date().toISOString();
    return this.store.transaction((state) => {
      const task = state.businessTasks?.[taskId];
      if (!task || task.status === 'completed') return task || null;
      if (reuseExisting && task.lastSubmissionError?.retryable === true) {
        task.status = 'pending';
        task.claimedAt = null;
        task.error = task.lastSubmissionError.message;
        task.updatedAt = now;
        return task;
      }
      const message = String(error?.message || 'Submission contract rejected').trim().slice(0, 2000);
      task.submissionRejectCount = Number(task.submissionRejectCount || 0) + 1;
      task.lastSubmissionError = {
        code: String(error?.code || 'CLIENT_REPORTED_CONTRACT_ERROR').trim().slice(0, 120),
        message,
        details: Array.isArray(error?.details) ? error.details.slice(0, 30).map((value) => String(value).slice(0, 1000)) : [],
        diagnostics: error?.diagnostics && typeof error.diagnostics === 'object' ? error.diagnostics : {},
        retryable: true,
        rejectedAt: now
      };
      task.status = 'pending';
      task.claimedAt = null;
      task.error = message;
      task.updatedAt = now;
      return task;
    });
  }

  async claim(taskId) {
    const task = this.store.read((state) => state.businessTasks?.[taskId]);
    if (recoverableRetryableFailure(task)) {
      const error = Object.assign(new Error(retryableIntegrationMessage(task)), {
        code: 'CLIENT_REPORTED_CONTRACT_ERROR'
      });
      await this.#recordRetryableContractError(taskId, error, { reuseExisting: true });
    }
    return super.claim(taskId);
  }

  async submit(taskId, result) {
    const task = this.store.read((state) => state.businessTasks?.[taskId]);
    if (taskUsesReadingDocument(task)) {
      try {
        const readingDocument = normalizeReadingDocument(result?.readingDocument, { required: true });
        result = { ...result, readingDocument };
      } catch (cause) {
        const error = submissionContractError(cause);
        await this.#recordRetryableContractError(taskId, error);
        throw error;
      }
    }
    return super.submit(taskId, result);
  }

  async fail(taskId, reason) {
    const task = this.store.read((state) => state.businessTasks?.[taskId]);
    const message = String(reason || 'Unspecified failure').trim().slice(0, 2000);
    if (task?.type !== 'book_analysis' && task?.lastSubmissionError?.retryable === true) {
      return this.#recordRetryableContractError(taskId, task.lastSubmissionError, { reuseExisting: true });
    }
    if (task?.type !== 'book_analysis' && RETRYABLE_INTEGRATION_PATTERN.test(message)) {
      const error = Object.assign(new Error(`Retryable integration issue reported by the GPT: ${message}`), {
        code: 'CLIENT_REPORTED_CONTRACT_ERROR'
      });
      return this.#recordRetryableContractError(taskId, error, { reuseExisting: true });
    }
    return super.fail(taskId, reason);
  }
}
