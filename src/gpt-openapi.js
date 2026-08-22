import { gptOpenApi as coreGptOpenApi } from './gpt-openapi-core.js';
import { READING_BLOCK_TYPES } from './services/reading-document.js';

const localizedText = () => ({
  type: 'object',
  properties: { en: { type: 'string' }, ar: { type: 'string' } },
  required: ['en', 'ar'],
  additionalProperties: false
});

const localizedList = () => ({
  type: 'object',
  properties: {
    en: { type: 'array', items: { type: 'string' } },
    ar: { type: 'array', items: { type: 'string' } }
  },
  required: ['en', 'ar'],
  additionalProperties: false
});

function readingSchemas() {
  return {
    LocalizedReadingTextV1: localizedText(),
    LocalizedReadingListV1: localizedList(),
    ReadingItemV1: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        label: { $ref: '#/components/schemas/LocalizedReadingTextV1' },
        title: { $ref: '#/components/schemas/LocalizedReadingTextV1' },
        text: { $ref: '#/components/schemas/LocalizedReadingTextV1' }
      },
      required: ['id', 'text'],
      additionalProperties: false
    },
    ReadingStepV1: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        label: { $ref: '#/components/schemas/LocalizedReadingTextV1' },
        title: { $ref: '#/components/schemas/LocalizedReadingTextV1' },
        text: { $ref: '#/components/schemas/LocalizedReadingTextV1' },
        output: { $ref: '#/components/schemas/LocalizedReadingTextV1' }
      },
      required: ['id', 'text'],
      additionalProperties: false
    },
    ReadingMatrixRowV1: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        label: { $ref: '#/components/schemas/LocalizedReadingTextV1' },
        cells: { type: 'array', items: { $ref: '#/components/schemas/LocalizedReadingTextV1' } }
      },
      required: ['id', 'label', 'cells'],
      additionalProperties: false
    },
    ReadingOptionV1: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        text: { $ref: '#/components/schemas/LocalizedReadingTextV1' }
      },
      required: ['id', 'text'],
      additionalProperties: false
    },
    ReadingBlockV1: {
      type: 'object',
      description: 'One bounded presentation primitive from the frozen reading shell. Arbitrary HTML is not accepted.',
      properties: {
        id: { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,79}$' },
        type: { type: 'string', enum: [...READING_BLOCK_TYPES] },
        label: { $ref: '#/components/schemas/LocalizedReadingTextV1' },
        title: { $ref: '#/components/schemas/LocalizedReadingTextV1' },
        text: { $ref: '#/components/schemas/LocalizedReadingTextV1' },
        caption: { $ref: '#/components/schemas/LocalizedReadingTextV1' },
        prompt: { $ref: '#/components/schemas/LocalizedReadingTextV1' },
        output: { $ref: '#/components/schemas/LocalizedReadingTextV1' },
        list: { $ref: '#/components/schemas/LocalizedReadingListV1' },
        items: { type: 'array', items: { $ref: '#/components/schemas/ReadingItemV1' } },
        steps: { type: 'array', items: { $ref: '#/components/schemas/ReadingStepV1' } },
        columns: { type: 'array', items: { $ref: '#/components/schemas/LocalizedReadingTextV1' } },
        rows: { type: 'array', items: { $ref: '#/components/schemas/ReadingMatrixRowV1' } },
        options: { type: 'array', items: { $ref: '#/components/schemas/ReadingOptionV1' } },
        expectedOptionId: { type: 'string' }
      },
      required: ['id', 'type'],
      additionalProperties: false
    },
    ReadingSectionV1: {
      type: 'object',
      properties: {
        id: { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,79}$' },
        kicker: { $ref: '#/components/schemas/LocalizedReadingTextV1' },
        title: { $ref: '#/components/schemas/LocalizedReadingTextV1' },
        lede: { $ref: '#/components/schemas/LocalizedReadingTextV1' },
        optional: { type: 'boolean' },
        blocks: { type: 'array', minItems: 1, maxItems: 20, items: { $ref: '#/components/schemas/ReadingBlockV1' } }
      },
      required: ['id', 'title', 'blocks'],
      additionalProperties: false
    },
    ReadingGlossaryEntryV1: {
      type: 'object',
      properties: {
        id: { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,79}$' },
        term: { $ref: '#/components/schemas/LocalizedReadingTextV1' },
        definition: { $ref: '#/components/schemas/LocalizedReadingTextV1' }
      },
      required: ['id', 'term', 'definition'],
      additionalProperties: false
    },
    ReadingDocumentV1: {
      type: 'object',
      description: 'Validated bilingual reading document. English and Arabic share one logical structure, stable IDs, and evidence model.',
      properties: {
        version: { type: 'integer', const: 1 },
        defaultLanguage: { type: 'string', enum: ['en', 'ar'] },
        hero: {
          type: 'object',
          properties: {
            eyebrow: { $ref: '#/components/schemas/LocalizedReadingTextV1' },
            title: { $ref: '#/components/schemas/LocalizedReadingTextV1' },
            lede: { $ref: '#/components/schemas/LocalizedReadingTextV1' },
            readTimeMinutes: { type: 'number', minimum: 1, maximum: 30 }
          },
          required: ['title'],
          additionalProperties: false
        },
        sections: { type: 'array', minItems: 1, maxItems: 16, items: { $ref: '#/components/schemas/ReadingSectionV1' } },
        glossary: { type: 'array', maxItems: 40, items: { $ref: '#/components/schemas/ReadingGlossaryEntryV1' } },
        ending: {
          type: 'object',
          properties: {
            title: { $ref: '#/components/schemas/LocalizedReadingTextV1' },
            text: { $ref: '#/components/schemas/LocalizedReadingTextV1' }
          },
          required: ['title', 'text'],
          additionalProperties: false
        }
      },
      required: ['version', 'hero', 'sections', 'ending'],
      additionalProperties: false
    }
  };
}

export function gptOpenApi(baseUrl) {
  const spec = coreGptOpenApi(baseUrl);
  const schemas = spec.components.schemas;
  Object.assign(schemas, readingSchemas());
  schemas.TaskResultSubmission.properties.readingDocument = { $ref: '#/components/schemas/ReadingDocumentV1' };
  schemas.TaskContext.properties.readingDocumentContract = {
    type: 'object',
    description: 'Present on lesson/book-session work that requires ReadingDocument v1.',
    properties: {
      version: { type: 'integer', const: 1 },
      languages: { type: 'array', items: { type: 'string', enum: ['en', 'ar'] } },
      rule: { type: 'string' },
      blockTypes: { type: 'array', items: { type: 'string', enum: [...READING_BLOCK_TYPES] } }
    },
    additionalProperties: false
  };
  return spec;
}
