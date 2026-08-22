import { BusinessActionsService as CoreBusinessActionsService } from './business-actions-core.js';
import { READING_BLOCK_TYPES, normalizeReadingDocument } from './reading-document.js';

const BILINGUAL_TASK_TYPES = new Set(['lesson', 'book_session', 'book_finale']);

const READING_DOCUMENT_CONTRACT = Object.freeze({
  version: 1,
  languages: ['en', 'ar'],
  rule: 'English and Arabic must describe the same logical sections and blocks using the same stable ids and one shared evidence/source model.',
  blockTypes: [...READING_BLOCK_TYPES]
});

function readingDocumentResultContract() {
  return {
    version: 1,
    defaultLanguage: 'en|ar',
    hero: {
      eyebrow: { en: 'optional string', ar: 'optional string' },
      title: { en: 'string', ar: 'string' },
      lede: { en: 'optional string', ar: 'optional string' },
      readTimeMinutes: 'number 1-30'
    },
    sections: [{
      id: 'stable lowercase logical id shared across languages',
      kicker: { en: 'optional string', ar: 'optional string' },
      title: { en: 'string', ar: 'string' },
      lede: { en: 'optional string', ar: 'optional string' },
      optional: 'boolean',
      blocks: [{
        id: 'stable lowercase logical id shared across languages',
        type: READING_BLOCK_TYPES.join('|'),
        label: { en: 'optional string', ar: 'optional string' },
        title: { en: 'optional string', ar: 'optional string' },
        text: { en: 'paired content', ar: 'paired content' },
        list: { en: ['aligned strings'], ar: ['aligned strings'] },
        items: 'optional aligned structured items',
        steps: 'optional aligned structured steps',
        columns: 'optional bilingual matrix columns',
        rows: 'optional bilingual matrix rows',
        options: 'optional bilingual check options with expectedOptionId'
      }]
    }],
    glossary: [{ id: 'stable id', term: { en: 'string', ar: 'string' }, definition: { en: 'string', ar: 'string' } }],
    ending: { title: { en: 'string', ar: 'string' }, text: { en: 'string', ar: 'string' } }
  };
}

function addBilingualContract(context) {
  if (!BILINGUAL_TASK_TYPES.has(context?.task?.type)) return context;
  return {
    ...context,
    readingDocumentContract: READING_DOCUMENT_CONTRACT,
    taskInstructions: `Produce the complete ReadingDocument in English and Arabic atomically from the same researched evidence. Preserve identical logical section/block ids, meaning, claims, examples, checks, and source basis across both languages. Do not translate by inventing or omitting facts. The learner language controls the default opening/channel language only. ${context.taskInstructions}`,
    resultContract: {
      ...context.resultContract,
      readingDocument: readingDocumentResultContract()
    }
  };
}

export class BusinessActionsService extends CoreBusinessActionsService {
  getTask(taskId) {
    return addBilingualContract(super.getTask(taskId));
  }

  async submit(taskId, result) {
    const task = this.store.read((state) => state.businessTasks?.[taskId]);
    if (task && BILINGUAL_TASK_TYPES.has(task.type)) {
      normalizeReadingDocument(result?.readingDocument, { required: true });
    }
    return super.submit(taskId, result);
  }
}
