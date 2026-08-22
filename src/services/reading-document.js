const LANGUAGES = ['en', 'ar'];

export const READING_DOCUMENT_VERSION = 1;
export const READING_BLOCK_TYPES = Object.freeze([
  'prose',
  'idea',
  'pulse',
  'register',
  'sequence',
  'example',
  'matrix',
  'synthesis',
  'context_note',
  'definition',
  'check',
  'reading_end'
]);

const BLOCK_TYPES = new Set(READING_BLOCK_TYPES);
const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,79}$/;

function contractError(message) {
  const error = new Error(message);
  error.code = 'INVALID_READING_DOCUMENT';
  error.statusCode = 400;
  return error;
}

function text(value, max) {
  return String(value ?? '').trim().slice(0, max);
}

function id(value, label) {
  const normalized = text(value, 80).toLowerCase();
  if (!ID_PATTERN.test(normalized)) throw contractError(`${label} must use a stable lowercase id`);
  return normalized;
}

function localized(value, label, max = 6000, { required = false } = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const normalized = Object.fromEntries(LANGUAGES.map((language) => [language, text(source[language], max)]));
  const present = LANGUAGES.filter((language) => normalized[language]);
  if (required && present.length !== LANGUAGES.length) throw contractError(`${label} must contain complete English and Arabic text`);
  if (present.length && present.length !== LANGUAGES.length) throw contractError(`${label} must contain both English and Arabic when supplied`);
  return present.length ? normalized : null;
}

function localizedList(value, label, { maxItems = 16, itemMax = 2000 } = {}) {
  if (value === undefined || value === null) return null;
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const en = Array.isArray(source.en) ? source.en.slice(0, maxItems).map((item) => text(item, itemMax)).filter(Boolean) : [];
  const ar = Array.isArray(source.ar) ? source.ar.slice(0, maxItems).map((item) => text(item, itemMax)).filter(Boolean) : [];
  if (!en.length && !ar.length) return null;
  if (!en.length || !ar.length || en.length !== ar.length) throw contractError(`${label} must contain aligned English and Arabic lists`);
  return { en, ar };
}

function assignLocalized(target, source, field, label, max, options = {}) {
  const normalized = localized(source?.[field], label, max, options);
  if (normalized) target[field] = normalized;
}

function normalizeStep(raw, sectionId, blockId, index) {
  const step = raw && typeof raw === 'object' ? raw : {};
  const normalized = { id: id(step.id || `${blockId}-step-${index + 1}`, `Step id in ${sectionId}/${blockId}`) };
  assignLocalized(normalized, step, 'label', `Step label in ${sectionId}/${blockId}`, 300);
  assignLocalized(normalized, step, 'title', `Step title in ${sectionId}/${blockId}`, 600);
  assignLocalized(normalized, step, 'text', `Step text in ${sectionId}/${blockId}`, 5000, { required: true });
  assignLocalized(normalized, step, 'output', `Step output in ${sectionId}/${blockId}`, 4000);
  return normalized;
}

function normalizeItem(raw, sectionId, blockId, index) {
  const item = raw && typeof raw === 'object' ? raw : {};
  const normalized = { id: id(item.id || `${blockId}-item-${index + 1}`, `Item id in ${sectionId}/${blockId}`) };
  assignLocalized(normalized, item, 'label', `Item label in ${sectionId}/${blockId}`, 300);
  assignLocalized(normalized, item, 'title', `Item title in ${sectionId}/${blockId}`, 600);
  assignLocalized(normalized, item, 'text', `Item text in ${sectionId}/${blockId}`, 4000, { required: true });
  return normalized;
}

function normalizeOption(raw, sectionId, blockId, index) {
  const option = raw && typeof raw === 'object' ? raw : {};
  return {
    id: id(option.id || `${blockId}-option-${index + 1}`, `Option id in ${sectionId}/${blockId}`),
    text: localized(option.text, `Option text in ${sectionId}/${blockId}`, 1200, { required: true })
  };
}

function normalizeMatrixRow(raw, sectionId, blockId, index, columnCount) {
  const row = raw && typeof raw === 'object' ? raw : {};
  const cells = Array.isArray(row.cells) ? row.cells.slice(0, 8) : [];
  if (!cells.length || cells.length !== columnCount) throw contractError(`Matrix row ${index + 1} in ${sectionId}/${blockId} must match its column count`);
  return {
    id: id(row.id || `${blockId}-row-${index + 1}`, `Matrix row id in ${sectionId}/${blockId}`),
    label: localized(row.label, `Matrix row label in ${sectionId}/${blockId}`, 500, { required: true }),
    cells: cells.map((cell, cellIndex) => localized(cell, `Matrix cell ${cellIndex + 1} in ${sectionId}/${blockId}`, 1600, { required: true }))
  };
}

function normalizeBlock(raw, sectionId, index) {
  const block = raw && typeof raw === 'object' ? raw : {};
  const blockId = id(block.id || `${sectionId}-block-${index + 1}`, `Block id in ${sectionId}`);
  const type = text(block.type, 40);
  if (!BLOCK_TYPES.has(type)) throw contractError(`Unsupported reading block type: ${type || '(missing)'}`);
  const normalized = { id: blockId, type };

  assignLocalized(normalized, block, 'label', `Block label in ${sectionId}/${blockId}`, 300);
  assignLocalized(normalized, block, 'title', `Block title in ${sectionId}/${blockId}`, 700);
  assignLocalized(normalized, block, 'text', `Block text in ${sectionId}/${blockId}`, 9000);
  assignLocalized(normalized, block, 'caption', `Block caption in ${sectionId}/${blockId}`, 1000);
  assignLocalized(normalized, block, 'prompt', `Block prompt in ${sectionId}/${blockId}`, 2000);
  assignLocalized(normalized, block, 'output', `Block output in ${sectionId}/${blockId}`, 5000);

  const list = localizedList(block.list, `Block list in ${sectionId}/${blockId}`);
  if (list) normalized.list = list;

  if (Array.isArray(block.items) && block.items.length) {
    normalized.items = block.items.slice(0, 16).map((item, itemIndex) => normalizeItem(item, sectionId, blockId, itemIndex));
  }
  if (Array.isArray(block.steps) && block.steps.length) {
    normalized.steps = block.steps.slice(0, 12).map((step, stepIndex) => normalizeStep(step, sectionId, blockId, stepIndex));
  }
  if (Array.isArray(block.columns) && block.columns.length) {
    normalized.columns = block.columns.slice(0, 8).map((column, columnIndex) => localized(column, `Matrix column ${columnIndex + 1} in ${sectionId}/${blockId}`, 500, { required: true }));
  }
  if (Array.isArray(block.rows) && block.rows.length) {
    if (!normalized.columns?.length) throw contractError(`Matrix rows in ${sectionId}/${blockId} require columns`);
    normalized.rows = block.rows.slice(0, 12).map((row, rowIndex) => normalizeMatrixRow(row, sectionId, blockId, rowIndex, normalized.columns.length));
  }
  if (Array.isArray(block.options) && block.options.length) {
    normalized.options = block.options.slice(0, 8).map((option, optionIndex) => normalizeOption(option, sectionId, blockId, optionIndex));
    normalized.expectedOptionId = id(block.expectedOptionId, `Expected option id in ${sectionId}/${blockId}`);
    if (!normalized.options.some((option) => option.id === normalized.expectedOptionId)) throw contractError(`Expected option in ${sectionId}/${blockId} must reference an available option`);
  }

  const hasLocalizedPayload = ['label', 'title', 'text', 'caption', 'prompt', 'output', 'list', 'items', 'steps', 'columns', 'rows', 'options']
    .some((field) => normalized[field] !== undefined);
  if (!hasLocalizedPayload) throw contractError(`Reading block ${sectionId}/${blockId} has no renderable bilingual content`);
  return normalized;
}

function normalizeSection(raw, index) {
  const section = raw && typeof raw === 'object' ? raw : {};
  const sectionId = id(section.id || `section-${index + 1}`, 'Section id');
  const blocks = Array.isArray(section.blocks) ? section.blocks.slice(0, 20) : [];
  if (!blocks.length) throw contractError(`Reading section ${sectionId} requires at least one block`);
  const normalized = {
    id: sectionId,
    title: localized(section.title, `Section title ${sectionId}`, 800, { required: true }),
    optional: section.optional === true,
    blocks: blocks.map((block, blockIndex) => normalizeBlock(block, sectionId, blockIndex))
  };
  assignLocalized(normalized, section, 'kicker', `Section kicker ${sectionId}`, 300);
  assignLocalized(normalized, section, 'lede', `Section lede ${sectionId}`, 2400);
  return normalized;
}

function assertUniqueIds(document) {
  const ids = new Set();
  const add = (value, label) => {
    if (ids.has(value)) throw contractError(`Duplicate stable reading id: ${value} (${label})`);
    ids.add(value);
  };
  for (const section of document.sections) {
    add(section.id, 'section');
    for (const block of section.blocks) {
      add(block.id, 'block');
      for (const item of block.items || []) add(item.id, 'item');
      for (const step of block.steps || []) add(step.id, 'step');
      for (const row of block.rows || []) add(row.id, 'row');
      for (const option of block.options || []) add(option.id, 'option');
    }
  }
  for (const term of document.glossary || []) add(term.id, 'glossary');
}

export function normalizeReadingDocument(value, { required = false } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    if (required) throw contractError('ReadingDocument v1 is required');
    return null;
  }
  if (Number(value.version) !== READING_DOCUMENT_VERSION) throw contractError(`Unsupported ReadingDocument version: ${value.version}`);
  const sections = Array.isArray(value.sections) ? value.sections.slice(0, 16) : [];
  if (!sections.length) throw contractError('ReadingDocument requires at least one section');
  const defaultLanguage = LANGUAGES.includes(value.defaultLanguage) ? value.defaultLanguage : 'en';
  const hero = value.hero && typeof value.hero === 'object' ? value.hero : {};
  const ending = value.ending && typeof value.ending === 'object' ? value.ending : {};
  const normalized = {
    version: READING_DOCUMENT_VERSION,
    defaultLanguage,
    hero: {
      ...(localized(hero.eyebrow, 'Reading hero eyebrow', 300) ? { eyebrow: localized(hero.eyebrow, 'Reading hero eyebrow', 300) } : {}),
      title: localized(hero.title, 'Reading hero title', 1000, { required: true }),
      ...(localized(hero.lede, 'Reading hero lede', 3000) ? { lede: localized(hero.lede, 'Reading hero lede', 3000) } : {}),
      readTimeMinutes: Math.max(1, Math.min(30, Number(hero.readTimeMinutes) || 8))
    },
    sections: sections.map(normalizeSection),
    glossary: Array.isArray(value.glossary) ? value.glossary.slice(0, 40).map((entry, index) => {
      const term = entry && typeof entry === 'object' ? entry : {};
      return {
        id: id(term.id || `term-${index + 1}`, 'Glossary id'),
        term: localized(term.term, 'Glossary term', 400, { required: true }),
        definition: localized(term.definition, 'Glossary definition', 2400, { required: true })
      };
    }) : [],
    ending: {
      title: localized(ending.title, 'Reading ending title', 800, { required: true }),
      text: localized(ending.text, 'Reading ending text', 3000, { required: true })
    }
  };
  assertUniqueIds(normalized);
  return normalized;
}

export function readingDocumentIssues(value) {
  try {
    normalizeReadingDocument(value, { required: true });
    return [];
  } catch (error) {
    return [error.message || 'Invalid ReadingDocument'];
  }
}
