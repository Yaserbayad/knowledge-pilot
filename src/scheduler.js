import { nowIso } from './utils.js';
import { queueSystemNotice } from './services/notices.js';

const EXTERNAL_EFFECT_JOB_TYPES = new Set([
  'deliver_lesson',
  'deliver_book_session',
  'notify_book_plan',
  'send_reminder',
  'send_book_reminder',
  'send_reinforcement',
  'send_book_reinforcement',
  'send_direct_response',
  'send_system_notice'
]);

function externalOutcomeUnknownMessage(type, error = '') {
  const detail = error ? ` Last error: ${error}` : '';
  return `External delivery outcome is unknown for ${type}; automatic retry is disabled to prevent duplicate sends.${detail}`;
}

export class Scheduler {
  constructor({ store, learning, books = null, delivery, config, logger }) {
    this.store = store;
    this.learning = learning;
    this.books = books;
    this.delivery = delivery;
    this.config = config;
    this.logger = logger;
    this.timer = null;
    this.running = false;
    this.lastTickAt = null;
    this.lastError = null;
  }

  start() {
    if (!this.config.enabled || this.timer) return;
    this.timer = setInterval(() => this.tick().catch((error) => this.logger.error({ error: error.message }, 'Scheduler tick failed')), this.config.pollSeconds * 1000);
    this.timer.unref();
    this.tick().catch(() => {});
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick() {
    if (this.running) return;
    this.running = true;
    this.lastTickAt = nowIso();
    try {
      const timeoutMs = Math.max(1, Number(this.config.runTimeoutMinutes || 15)) * 60_000;
      const staleIds = this.store.read((state) => Object.values(state.jobs || {}).filter((job) => {
        if (job.status !== 'running') return false;
        const startedAt = new Date(job.startedAt || job.updatedAt || 0).getTime();
        return Number.isFinite(startedAt) && Date.now() - startedAt >= timeoutMs;
      }).map((job) => job.id));
      if (staleIds.length) await this.store.transaction((state) => {
        for (const id of staleIds) {
          const job = state.jobs?.[id];
          if (!job || job.status !== 'running') continue;
          if (EXTERNAL_EFFECT_JOB_TYPES.has(job.type) && job.externalEffectStartedAt && !job.externalEffectCompletedAt) {
            job.status = 'failed';
            job.startedAt = null;
            job.ambiguousExternalEffect = true;
            job.lastError = externalOutcomeUnknownMessage(job.type);
            job.updatedAt = nowIso();
            const user = state.users?.[job.userId];
            if (job.type !== 'send_system_notice' && user?.automation?.notifyActionRequired !== false) {
              queueSystemNotice(state, {
                userId: job.userId,
                kind: 'external_delivery_reconciliation_required',
                title: 'Delivery needs reconciliation',
                message: 'A messaging delivery was interrupted after sending may have started. Knowledge Pilot will not retry it automatically because that could send a duplicate.',
                actionUrl: this.learning.accessUrl(user),
                actionLabel: 'Open dashboard',
                dedupeKey: `external-delivery-unknown:${job.id}`,
                metadata: { jobId: job.id, jobType: job.type }
              });
            }
            continue;
          }
          job.status = 'pending';
          job.runAt = nowIso();
          job.startedAt = null;
          job.lastError = 'Recovered after an interrupted or stale scheduler run';
          job.updatedAt = nowIso();
        }
      });
      const due = this.store.read((state) => Object.values(state.jobs)
        .filter((job) => job.status === 'pending' && job.runAt <= nowIso())
        .sort((a, b) => a.runAt.localeCompare(b.runAt))
        .slice(0, 10));
      for (const job of due) await this.#runJob(job);
      this.lastError = null;
    } catch (error) {
      this.lastError = error.message;
      throw error;
    } finally {
      this.running = false;
    }
  }

  async #markExternalEffectStarted(jobId) {
    return this.store.transaction((state) => {
      const target = state.jobs?.[jobId];
      if (!target || target.status !== 'running') return false;
      if (!target.externalEffectStartedAt) target.externalEffectStartedAt = nowIso();
      target.updatedAt = nowIso();
      return true;
    });
  }

  async #runExternal(job, operation) {
    const prepared = await this.#markExternalEffectStarted(job.id);
    if (!prepared) return;
    return operation();
  }

  async #runJob(job) {
    const claimed = await this.store.transaction((state) => {
      const target = state.jobs[job.id];
      if (!target || target.status !== 'pending') return false;
      target.status = 'running';
      target.attempts += 1;
      target.startedAt = nowIso();
      target.updatedAt = nowIso();
      return true;
    });
    if (!claimed) return;
    try {
      if (job.type === 'generate_lesson') {
        await this.learning.generateLesson(job.userId, job.payload.planId, job.payload.proposalId);
      } else if (job.type === 'generate_book_session') {
        if (!this.books) throw new Error('Book learning is unavailable');
        const book = this.store.read((state) => state.books?.[job.payload.bookId]);
        if (!book) throw new Error('Book not found');
        if (book.status === 'paused') {
          await this.store.transaction((state) => {
            const target = state.jobs[job.id];
            target.status = 'pending';
            target.runAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
            target.lastError = 'Book is paused';
            target.updatedAt = nowIso();
          });
          return;
        }
        if (book.status !== 'active' && book.status !== 'completed') throw new Error(`Book cannot generate sessions from status ${book.status}`);
        await this.books.generateSession(job.userId, job.payload.bookId, job.payload.sessionNumber);
      } else if (job.type === 'generate_book_finale') {
        if (!this.books?.businessActions) throw new Error('Book Business Actions are unavailable');
        await this.books.businessActions.queueBookFinale(job.userId, job.payload.bookId);
      } else if (job.type === 'deliver_lesson') {
        const unfinished = this.store.read((state) => Object.values(state.lessons)
          .filter((lesson) => lesson.userId === job.userId && lesson.status === 'delivered').length);
        const limit = Math.max(1, Number(this.config.unfinishedItemLimit || 3));
        if (unfinished >= limit) {
          await this.store.transaction((state) => {
            const target = state.jobs[job.id];
            target.status = 'pending';
            target.runAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
            target.lastError = `Paused because ${limit} lessons are unfinished`;
            target.updatedAt = nowIso();
            const user = state.users[job.userId];
            if (user?.automation?.notifyActionRequired !== false) queueSystemNotice(state, {
              userId: job.userId, kind: 'lesson_backlog', title: 'Lesson delivery paused',
              message: `You have ${unfinished} unfinished lessons. Complete or skip one and Knowledge Pilot will resume automatically.`,
              actionUrl: this.learning.accessUrl(user), actionLabel: 'Open Today',
              dedupeKey: `lesson-backlog:${job.userId}:${unfinished}`
            });
          });
          return;
        }
        await this.#runExternal(job, () => this.delivery.deliverLesson(job.payload.lessonId));
      } else if (job.type === 'deliver_book_session') {
        const deliveryContext = this.store.read((state) => {
          const session = state.bookSessions?.[job.payload.sessionId];
          return { session, book: session ? state.books?.[session.bookId] : null };
        });
        if (!deliveryContext.session || !deliveryContext.book) throw new Error('Book delivery context not found');
        if (deliveryContext.book.status === 'paused') {
          await this.store.transaction((state) => {
            const target = state.jobs[job.id];
            target.status = 'pending';
            target.runAt = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
            target.lastError = 'Deferred because the book is paused';
            target.updatedAt = nowIso();
          });
          return;
        }
        if (deliveryContext.book.status === 'archived') {
          await this.store.transaction((state) => {
            const target = state.jobs[job.id];
            target.status = 'cancelled';
            target.cancelledAt = nowIso();
            target.updatedAt = nowIso();
          });
          return;
        }
        const unfinished = this.store.read((state) => Object.values(state.bookSessions || {})
          .filter((session) => session.userId === job.userId && session.status === 'delivered').length);
        const limit = Math.max(1, Number(this.config.unfinishedItemLimit || 3));
        if (unfinished >= limit) {
          await this.store.transaction((state) => {
            const target = state.jobs[job.id];
            target.status = 'pending';
            target.runAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
            target.lastError = `Paused because ${limit} book sessions are unfinished`;
            target.updatedAt = nowIso();
            const user = state.users[job.userId];
            if (user?.automation?.notifyActionRequired !== false) queueSystemNotice(state, {
              userId: job.userId, kind: 'book_backlog', title: 'Book delivery paused',
              message: `You have ${unfinished} unfinished book sessions. Complete or skip one and Knowledge Pilot will resume automatically.`,
              actionUrl: this.learning.accessUrl(user), actionLabel: 'Open Reading',
              dedupeKey: `book-backlog:${job.userId}:${unfinished}`
            });
          });
          return;
        }
        await this.#runExternal(job, () => this.delivery.deliverBookSession(job.payload.sessionId));
      } else if (job.type === 'notify_book_plan') {
        await this.#runExternal(job, () => this.delivery.notifyBookPlanReady(job.payload.bookId));
      } else if (job.type === 'send_reminder') {
        await this.#runExternal(job, () => this.delivery.sendReminder(job.payload.lessonId));
      } else if (job.type === 'send_book_reminder') {
        await this.#runExternal(job, () => this.delivery.sendBookReminder(job.payload.sessionId));
      } else if (job.type === 'send_reinforcement') {
        await this.#runExternal(job, () => this.delivery.sendReinforcement(job.payload.lessonId, job.payload.questionId));
      } else if (job.type === 'send_book_reinforcement') {
        await this.#runExternal(job, () => this.delivery.sendBookReinforcement(job.payload.sessionId, job.payload.questionId));
      } else if (job.type === 'send_direct_response') {
        await this.#runExternal(job, () => this.delivery.sendDirectResponse(job.userId, job.payload.text, job.payload.origin, job.payload.interactionId));
      } else if (job.type === 'send_system_notice') {
        await this.#runExternal(job, () => this.delivery.sendSystemNotice(job.userId, job.payload));
      } else if (job.type === 'backup') {
        await this.store.backup('job');
      } else {
        throw new Error(`Unknown job type: ${job.type}`);
      }
      await this.store.transaction((state) => {
        const target = state.jobs[job.id];
        if (target && target.status === 'running') {
          target.status = 'completed';
          target.completedAt = nowIso();
          if (target.externalEffectStartedAt) target.externalEffectCompletedAt = target.completedAt;
          target.startedAt = null;
          target.updatedAt = nowIso();
        }
      });
    } catch (error) {
      this.logger.error({ jobId: job.id, type: job.type, error: error.message }, 'Job failed');
      await this.store.transaction((state) => {
        const target = state.jobs[job.id];
        if (!target) return;
        target.startedAt = null;
        target.updatedAt = nowIso();
        const ambiguousExternalEffect = EXTERNAL_EFFECT_JOB_TYPES.has(target.type)
          && target.externalEffectStartedAt
          && !target.externalEffectCompletedAt;
        if (ambiguousExternalEffect) {
          target.status = 'failed';
          target.ambiguousExternalEffect = true;
          target.lastError = externalOutcomeUnknownMessage(target.type, error.message);
          const user = state.users?.[target.userId];
          if (target.type !== 'send_system_notice' && user?.automation?.notifyActionRequired !== false) {
            queueSystemNotice(state, {
              userId: target.userId,
              kind: 'external_delivery_reconciliation_required',
              title: 'Delivery needs reconciliation',
              message: 'A messaging delivery failed after sending may have started. Knowledge Pilot will not retry it automatically because that could send a duplicate.',
              actionUrl: this.learning.accessUrl(user),
              actionLabel: 'Open dashboard',
              dedupeKey: `external-delivery-unknown:${target.id}`,
              metadata: { jobId: target.id, jobType: target.type }
            });
          }
          return;
        }
        target.lastError = error.message;
        if (target.attempts >= this.config.maxAttempts) {
          target.status = 'failed';
          const user = state.users?.[target.userId];
          if (target.type !== 'send_system_notice' && user?.automation?.notifyActionRequired !== false) {
            queueSystemNotice(state, {
              userId: target.userId,
              kind: 'system_job_failed',
              title: 'Knowledge Pilot needs attention',
              message: `A ${String(target.type || 'system').replaceAll('_', ' ')} task failed after ${target.attempts} attempts. Open the dashboard to review it.`,
              actionUrl: this.learning.accessUrl(user),
              actionLabel: 'Open dashboard',
              dedupeKey: `system-job-failed:${target.id}`,
              metadata: { jobId: target.id, jobType: target.type, error: target.lastError }
            });
          }
        } else {
          target.status = 'pending';
          target.runAt = new Date(Date.now() + Math.min(60, 2 ** target.attempts) * 60 * 1000).toISOString();
        }
      });
    }
  }
}
