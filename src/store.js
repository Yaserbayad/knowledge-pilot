import fs from 'node:fs/promises';
import path from 'node:path';
import { nowIso, uid } from './utils.js';
import { STATE_SCHEMA_VERSION } from './version.js';
import { defaultLessonExperience } from './services/learning.js';

const emptyState = () => ({
  meta: {
    schemaVersion: STATE_SCHEMA_VERSION,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    lastBackupAt: null
  },
  users: {},
  plans: {},
  lessons: {},
  interactions: {},
  jobs: {},
  messages: {},
  businessTasks: {},
  books: {},
  bookPlans: {},
  bookSessions: {},
  settings: {
    installationId: uid('install')
  }
});

export class JsonStore {
  constructor({ stateFile, backupDir, retention = 30, logger = console }) {
    this.stateFile = stateFile;
    this.backupDir = backupDir;
    this.retention = retention;
    this.logger = logger;
    this.state = emptyState();
    this.writeQueue = Promise.resolve();
  }

  async init() {
    await fs.mkdir(path.dirname(this.stateFile), { recursive: true });
    await fs.mkdir(this.backupDir, { recursive: true });
    try {
      const raw = await fs.readFile(this.stateFile, 'utf8');
      this.state = JSON.parse(raw);
      this.state.users ||= {};
      this.state.plans ||= {};
      this.state.lessons ||= {};
      this.state.interactions ||= {};
      this.state.jobs ||= {};
      this.state.messages ||= {};
      this.state.businessTasks ||= {};
      this.state.books ||= {};
      this.state.bookPlans ||= {};
      this.state.bookSessions ||= {};
      this.state.settings ||= { installationId: uid('install') };
      this.state.meta ||= {};
      this.state.meta.createdAt ||= nowIso();
      this.state.meta.lastBackupAt ??= null;
      this.state.meta.schemaVersion = STATE_SCHEMA_VERSION;
      for (const user of Object.values(this.state.users)) {
        user.channels = { web: true, telegram: false, whatsapp: false, ...(user.channels || {}) };
        user.automation = {
          autoScheduleApproved: true,
          autoScheduleDelayMinutes: 2,
          notifyActionRequired: true,
          ...(user.automation || {})
        };
      }
      for (const lesson of Object.values(this.state.lessons)) {
        lesson.experience = defaultLessonExperience(lesson.experience);
      }
      await this.persist();
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await this.persist();
    }
    return this;
  }

  snapshot() {
    return structuredClone(this.state);
  }

  read(selector = (state) => state) {
    return structuredClone(selector(this.state));
  }

  async transaction(mutator) {
    const run = async () => {
      const draft = structuredClone(this.state);
      const result = await mutator(draft);
      draft.meta.updatedAt = nowIso();
      this.state = draft;
      await this.persist();
      return structuredClone(result);
    };
    this.writeQueue = this.writeQueue.then(run, run);
    return this.writeQueue;
  }

  async persist() {
    const temp = `${this.stateFile}.tmp`;
    const data = `${JSON.stringify(this.state, null, 2)}\n`;
    await fs.writeFile(temp, data, { mode: 0o600 });
    await fs.rename(temp, this.stateFile);
  }

  async backup(reason = 'scheduled') {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = path.join(this.backupDir, `state-${stamp}-${reason.replace(/[^a-z0-9_-]/gi, '_')}.json`);
    await fs.copyFile(this.stateFile, file);
    await this.transaction((state) => {
      state.meta.lastBackupAt = nowIso();
      return file;
    });
    await this.pruneBackups();
    return file;
  }

  async pruneBackups() {
    const entries = (await fs.readdir(this.backupDir, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => entry.name)
      .sort()
      .reverse();
    for (const name of entries.slice(this.retention)) {
      await fs.rm(path.join(this.backupDir, name), { force: true });
    }
  }

  async listBackups() {
    const entries = await fs.readdir(this.backupDir, { withFileTypes: true });
    return Promise.all(entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map(async (entry) => {
        const full = path.join(this.backupDir, entry.name);
        const stat = await fs.stat(full);
        return { name: entry.name, size: stat.size, createdAt: stat.mtime.toISOString() };
      }));
  }
}
