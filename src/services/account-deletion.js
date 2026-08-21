import fs from 'node:fs/promises';
import path from 'node:path';
import { nowIso } from '../utils.js';

const RESERVED_COLLECTIONS = new Set(['meta', 'settings', 'users']);

function serviceError(message, statusCode, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function normalized(value) {
  return String(value ?? '').normalize('NFKC');
}

function isDirectChild(root, candidate) {
  if (!root || !candidate) return false;
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

async function removeWithRetry(target, options, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await fs.rm(target, options);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, attempt * 25));
    }
  }
  throw lastError;
}

export class AccountDeletionService {
  constructor({ store, cardDir, bookFileDir, logger = console }) {
    this.store = store;
    this.cardDir = cardDir ? path.resolve(cardDir) : null;
    this.bookFileDir = bookFileDir ? path.resolve(bookFileDir) : null;
    this.logger = logger;
  }

  preview(userId) {
    return this.store.read((state) => {
      const user = state.users?.[userId];
      if (!user) throw serviceError('Learner not found', 404, 'USER_NOT_FOUND');
      const records = {};
      for (const [collectionName, collection] of Object.entries(state)) {
        if (RESERVED_COLLECTIONS.has(collectionName) || !collection || typeof collection !== 'object' || Array.isArray(collection)) continue;
        const count = Object.values(collection).filter((record) => record && typeof record === 'object' && record.userId === userId).length;
        if (count) records[collectionName] = count;
      }
      return {
        user: { id: user.id, name: user.name },
        records,
        totalRecords: 1 + Object.values(records).reduce((sum, count) => sum + count, 0),
        backupRetentionNotice: 'Protected disaster-recovery backups may retain historical data until normal backup rotation removes them.'
      };
    });
  }

  async deleteUser(userId, confirmation, { actor = 'learner' } = {}) {
    const preview = this.preview(userId);
    if (!normalized(confirmation) || normalized(confirmation) !== normalized(preview.user.name)) {
      throw serviceError('Type the learner name exactly to confirm permanent deletion', 400, 'DELETE_CONFIRMATION_MISMATCH');
    }

    const deletion = await this.store.transaction((state) => {
      const user = state.users?.[userId];
      if (!user) throw serviceError('Learner not found', 404, 'USER_NOT_FOUND');
      if (normalized(confirmation) !== normalized(user.name)) {
        throw serviceError('The learner name changed; review the account and confirm again', 409, 'DELETE_CONFIRMATION_STALE');
      }

      const deleted = { users: 1 };
      const cardFiles = new Set();
      const ownedCards = [
        ...Object.values(state.lessons || {}),
        ...Object.values(state.bookSessions || {})
      ].filter((record) => record?.userId === userId && record.cardFile);
      const cardsUsedByOthers = new Set([
        ...Object.values(state.lessons || {}),
        ...Object.values(state.bookSessions || {})
      ].filter((record) => record?.userId !== userId && record.cardFile).map((record) => record.cardFile));
      for (const record of ownedCards) {
        if (!cardsUsedByOthers.has(record.cardFile)) cardFiles.add(record.cardFile);
      }

      for (const [collectionName, collection] of Object.entries(state)) {
        if (RESERVED_COLLECTIONS.has(collectionName) || !collection || typeof collection !== 'object' || Array.isArray(collection)) continue;
        let count = 0;
        for (const [recordId, record] of Object.entries(collection)) {
          if (record && typeof record === 'object' && record.userId === userId) {
            delete collection[recordId];
            count += 1;
          }
        }
        if (count) deleted[collectionName] = count;
      }

      delete state.users[userId];
      state.meta ||= {};
      state.meta.accountDeletion ||= {};
      state.meta.accountDeletion.lastCompletedAt = nowIso();
      state.meta.accountDeletion.totalCompleted = Number(state.meta.accountDeletion.totalCompleted || 0) + 1;

      return {
        user: { id: user.id, name: user.name },
        actor,
        deleted,
        totalRecords: Object.values(deleted).reduce((sum, count) => sum + count, 0),
        cardFiles: [...cardFiles]
      };
    });

    const cleanupFailures = [];
    let deletedFiles = 0;
    if (this.cardDir) {
      for (const filename of deletion.cardFiles) {
        if (path.basename(filename) !== filename) {
          cleanupFailures.push({ type: 'card', name: filename, error: 'Unsafe card filename was rejected' });
          continue;
        }
        const target = path.join(this.cardDir, filename);
        if (!isDirectChild(this.cardDir, target)) {
          cleanupFailures.push({ type: 'card', name: filename, error: 'Card path was outside the configured directory' });
          continue;
        }
        try {
          await removeWithRetry(target, { force: true });
          deletedFiles += 1;
        } catch (error) {
          cleanupFailures.push({ type: 'card', name: filename, error: error.message });
        }
      }
    }

    if (this.bookFileDir) {
      const userDirectory = path.join(this.bookFileDir, userId);
      if (isDirectChild(this.bookFileDir, userDirectory)) {
        try {
          await removeWithRetry(userDirectory, { recursive: true, force: true });
          deletedFiles += 1;
        } catch (error) {
          cleanupFailures.push({ type: 'book_files', name: userId, error: error.message });
        }
      } else {
        cleanupFailures.push({ type: 'book_files', name: userId, error: 'User directory was outside the configured book-file directory' });
      }
    }

    if (cleanupFailures.length) {
      this.logger.error({ userId, cleanupFailures }, 'Learner data was removed but filesystem cleanup needs administrator attention');
      throw serviceError('The account was deleted, but some private files require administrator cleanup', 500, 'ACCOUNT_FILES_CLEANUP_INCOMPLETE');
    }

    return {
      ok: true,
      user: deletion.user,
      actor: deletion.actor,
      deleted: deletion.deleted,
      totalRecords: deletion.totalRecords,
      deletedFiles,
      deletedAt: nowIso(),
      backupRetentionNotice: 'Protected disaster-recovery backups may retain historical data until normal backup rotation removes them.'
    };
  }
}
