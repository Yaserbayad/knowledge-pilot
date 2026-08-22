import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { JsonStore } from '../src/store.js';
import { STATE_SCHEMA_VERSION } from '../src/version.js';

const logger = { debug() {}, info() {}, warn() {}, error() {} };

const readingDocument = {
  version: 1,
  defaultLanguage: 'en',
  hero: { title: { en: 'Systems', ar: 'الأنظمة' }, readTimeMinutes: 8 },
  sections: [{
    id: 'opening', title: { en: 'Start', ar: 'البداية' }, optional: false,
    blocks: [{ id: 'idea-1', type: 'idea', text: { en: 'A system has interacting parts.', ar: 'يتكون النظام من أجزاء متفاعلة.' } }]
  }],
  glossary: [],
  ending: { title: { en: 'Keep the model', ar: 'احتفظ بالنموذج' }, text: { en: 'Look for relationships.', ar: 'ابحث عن العلاقات.' } }
};

test('ReadingDocument and rich book experience are additive schema-5 data that survive reload and unrelated writes', async () => {
  assert.equal(STATE_SCHEMA_VERSION, 5, 'this surgical update must not bump runtime state schema');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'knowledge-pilot-reading-schema-'));
  const stateFile = path.join(root, 'state.json');
  const backupDir = path.join(root, 'backups');
  const initial = {
    meta: { schemaVersion: 5, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), lastBackupAt: null },
    users: { reader: { id: 'reader', channels: { web: true }, automation: {} } },
    plans: {}, interactions: {}, jobs: {}, messages: {}, businessTasks: {}, books: {}, bookPlans: {}, settings: { installationId: 'install_test' },
    lessons: {
      lesson_1: { id: 'lesson_1', userId: 'reader', status: 'delivered', readingDocument, experience: { selectedLanguage: 'ar', anchorId: 'idea-1', revision: 3 } }
    },
    bookSessions: {
      session_1: {
        id: 'session_1', userId: 'reader', status: 'delivered', readingDocument,
        experience: {
          version: 1, revision: 2, currentSectionId: 'opening', anchorId: 'idea-1', selectedLanguage: 'ar',
          completedSectionIds: [], answers: {}, answerHistory: [], highlights: [], notes: [{ id: 'note-1', note: 'keep', language: 'ar' }],
          sectionFeedback: [], confidence: 'medium', startedAt: null, lastActivityAt: null, completedEssentialAt: null, reviewAt: null, appliedMutationIds: []
        }
      }
    }
  };
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(stateFile, `${JSON.stringify(initial, null, 2)}\n`);

  const first = await new JsonStore({ stateFile, backupDir, retention: 2, logger }).init();
  assert.equal(first.snapshot().meta.schemaVersion, 5);
  assert.deepEqual(first.snapshot().lessons.lesson_1.readingDocument, readingDocument);
  assert.deepEqual(first.snapshot().bookSessions.session_1.readingDocument, readingDocument);
  assert.equal(first.snapshot().bookSessions.session_1.experience.selectedLanguage, 'ar');

  await first.transaction((state) => {
    state.settings.unrelatedWrite = 'preserve-additive-reader-fields';
  });

  const reloaded = await new JsonStore({ stateFile, backupDir, retention: 2, logger }).init();
  const state = reloaded.snapshot();
  assert.equal(state.meta.schemaVersion, 5);
  assert.deepEqual(state.lessons.lesson_1.readingDocument, readingDocument);
  assert.deepEqual(state.bookSessions.session_1.readingDocument, readingDocument);
  assert.equal(state.bookSessions.session_1.experience.notes[0].language, 'ar');
  assert.equal(state.settings.unrelatedWrite, 'preserve-additive-reader-fields');
});
