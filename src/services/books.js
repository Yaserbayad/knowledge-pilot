import {
  BOOK_STANDARD,
  BookLearningService as CoreBookLearningService,
  evaluateBookSession,
  normalizeBookAnalysis,
  normalizeBookSession as normalizeCoreBookSession
} from './books-core.js';
import { normalizeReadingDocument } from './reading-document.js';
import { clamp, nowIso } from '../utils.js';

export { BOOK_STANDARD, evaluateBookSession, normalizeBookAnalysis };

function cleanAnchor(value) {
  const text = String(value || '');
  return /^[a-z0-9][a-z0-9_-]{0,79}$/i.test(text) ? text : '';
}

function cleanPassage(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 1200);
}

export function defaultBookSessionExperience(existing = {}) {
  return {
    version: 1,
    revision: Number(existing.revision) || 0,
    currentSectionId: String(existing.currentSectionId || 'cover'),
    anchorId: String(existing.anchorId || ''),
    completedSectionIds: Array.isArray(existing.completedSectionIds) ? [...new Set(existing.completedSectionIds.map(String))] : [],
    answers: existing.answers && typeof existing.answers === 'object' ? existing.answers : {},
    answerHistory: Array.isArray(existing.answerHistory) ? existing.answerHistory : [],
    highlights: Array.isArray(existing.highlights) ? existing.highlights : [],
    notes: Array.isArray(existing.notes) ? existing.notes : [],
    sectionFeedback: Array.isArray(existing.sectionFeedback) ? existing.sectionFeedback : [],
    confidence: ['low', 'medium', 'high'].includes(existing.confidence) ? existing.confidence : null,
    selectedLanguage: ['en', 'ar'].includes(existing.selectedLanguage) ? existing.selectedLanguage : '',
    startedAt: existing.startedAt || null,
    lastActivityAt: existing.lastActivityAt || null,
    completedEssentialAt: existing.completedEssentialAt || null,
    reviewAt: existing.reviewAt || null,
    appliedMutationIds: Array.isArray(existing.appliedMutationIds) ? existing.appliedMutationIds.slice(-100) : []
  };
}

export function normalizeBookSession(raw, book, planItem, user, sources = []) {
  const normalized = normalizeCoreBookSession(raw, book, planItem, user, sources);
  return {
    ...normalized,
    readingDocument: raw?.readingDocument
      ? normalizeReadingDocument(raw.readingDocument, { required: true })
      : null
  };
}

export class BookLearningService extends CoreBookLearningService {
  async updateSessionExperience(userId, sessionId, input = {}) {
    return this.store.transaction((state) => {
      const session = state.bookSessions?.[sessionId];
      if (!session || session.userId !== userId) throw new Error('Book session not found');
      if (!['delivered', 'completed'].includes(session.status)) throw new Error('Book session is not available for reading yet');
      session.experience = defaultBookSessionExperience(session.experience);
      const experience = session.experience;
      const baseRevision = Number(input.baseRevision);
      if (Number.isFinite(baseRevision) && baseRevision !== experience.revision) {
        const error = new Error('Book-session progress changed on another device. Refresh and retry.');
        error.statusCode = 409;
        error.code = 'STALE_BOOK_SESSION_PROGRESS';
        error.current = session;
        throw error;
      }

      const sectionId = cleanAnchor(input.currentSectionId);
      const anchorId = cleanAnchor(input.anchorId);
      if (sectionId) experience.currentSectionId = sectionId;
      if (input.anchorId !== undefined) experience.anchorId = anchorId;
      if (Array.isArray(input.completedSectionIds)) {
        experience.completedSectionIds = [...new Set([
          ...experience.completedSectionIds,
          ...input.completedSectionIds.map(cleanAnchor).filter(Boolean)
        ])].slice(0, 100);
      }
      if (['en', 'ar'].includes(input.selectedLanguage)) experience.selectedLanguage = input.selectedLanguage;
      if (input.started === true) experience.startedAt ||= nowIso();

      const mutation = input.mutation && typeof input.mutation === 'object' ? input.mutation : null;
      const mutationId = cleanAnchor(mutation?.id);
      if (mutation && mutationId && !experience.appliedMutationIds.includes(mutationId)) {
        const section = cleanAnchor(mutation.sectionId) || experience.currentSectionId;
        if (mutation.type === 'answer') {
          const questionId = cleanAnchor(mutation.questionId);
          if (!questionId) throw new Error('Invalid question identifier');
          const record = {
            id: mutationId,
            questionId,
            sectionId: section,
            answer: String(mutation.answer || '').slice(0, 5000),
            correct: mutation.correct === null || mutation.correct === undefined ? null : Boolean(mutation.correct),
            skipped: Boolean(mutation.skipped),
            attemptedAt: nowIso()
          };
          experience.answers[questionId] = record;
          experience.answerHistory.push(record);
          experience.answerHistory = experience.answerHistory.slice(-100);
        } else if (mutation.type === 'highlight') {
          const passage = cleanPassage(mutation.passage);
          if (!passage) throw new Error('Highlighted passage is required');
          experience.highlights.push({
            id: mutationId,
            sectionId: section,
            anchorId: cleanAnchor(mutation.anchorId),
            passage,
            language: ['en', 'ar'].includes(mutation.language) ? mutation.language : (experience.selectedLanguage || 'en'),
            createdAt: nowIso()
          });
          experience.highlights = experience.highlights.slice(-200);
        } else if (mutation.type === 'note') {
          const note = String(mutation.note || '').trim().slice(0, 5000);
          if (!note) throw new Error('Note is required');
          experience.notes.push({
            id: mutationId,
            sectionId: section,
            anchorId: cleanAnchor(mutation.anchorId),
            passage: cleanPassage(mutation.passage),
            note,
            language: ['en', 'ar'].includes(mutation.language) ? mutation.language : (experience.selectedLanguage || 'en'),
            createdAt: nowIso()
          });
          experience.notes = experience.notes.slice(-200);
        } else if (mutation.type === 'section_feedback') {
          const allowed = new Set(['unclear', 'too_simple', 'too_detailed', 'not_relevant', 'incorrect']);
          if (!allowed.has(mutation.category)) throw new Error('Invalid feedback category');
          experience.sectionFeedback.push({
            id: mutationId,
            sectionId: section,
            category: mutation.category,
            comment: String(mutation.comment || '').trim().slice(0, 1000),
            language: ['en', 'ar'].includes(mutation.language) ? mutation.language : (experience.selectedLanguage || 'en'),
            contentVersion: Number(session.revisionNumber || 0),
            createdAt: nowIso()
          });
          experience.sectionFeedback = experience.sectionFeedback.slice(-100);
        } else {
          throw new Error('Invalid book-session progress mutation');
        }
        experience.appliedMutationIds.push(mutationId);
        experience.appliedMutationIds = experience.appliedMutationIds.slice(-100);
      }

      if (['low', 'medium', 'high'].includes(input.confidence)) experience.confidence = input.confidence;
      experience.lastActivityAt = nowIso();
      experience.revision += 1;
      const sectionTotal = clamp(Number(input.sectionTotal) || 1, 1, 100);
      session.resumePercent = session.status === 'completed'
        ? 100
        : clamp(Math.round((experience.completedSectionIds.length / sectionTotal) * 100), 0, 99);
      session.updatedAt = nowIso();
      return { conflict: false, revision: experience.revision, experience, resumePercent: session.resumePercent };
    });
  }
}
