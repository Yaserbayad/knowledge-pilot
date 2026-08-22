import {
  BOOK_STANDARD,
  BookLearningService,
  evaluateBookSession,
  normalizeBookAnalysis,
  normalizeBookSession as normalizeCoreBookSession
} from './books-core.js';
import { normalizeReadingDocument } from './reading-document.js';

export { BOOK_STANDARD, BookLearningService, evaluateBookSession, normalizeBookAnalysis };

export function normalizeBookSession(raw, book, planItem, user, sources = []) {
  const normalized = normalizeCoreBookSession(raw, book, planItem, user, sources);
  return {
    ...normalized,
    readingDocument: raw?.readingDocument
      ? normalizeReadingDocument(raw.readingDocument, { required: true })
      : null
  };
}
