import { formatLessonText, nowIso, uid } from '../utils.js';
import { queueSystemNotice } from './notices.js';

export class DeliveryService {
  constructor({ store, learning, books = null, telegram, whatsapp, config, logger }) {
    this.store = store;
    this.learning = learning;
    this.books = books;
    this.telegram = telegram;
    this.whatsapp = whatsapp;
    this.config = config;
    this.logger = logger;
  }

  async deliverLesson(lessonId) {
    const { lesson, user } = this.store.read((state) => ({ lesson: state.lessons[lessonId], user: state.users[state.lessons[lessonId]?.userId] }));
    if (!lesson || !user) throw new Error('Lesson or user not found');
    if (['delivered', 'completed'].includes(lesson.status)) return lesson;
    if (lesson.status !== 'scheduled') return { skipped: true, reason: `Lesson is ${lesson.status}` };
    if (lesson.reviewStatus !== 'approved') throw new Error('Unapproved lesson cannot be delivered');
    const results = { web: { status: 'available' } };
    const text = formatLessonText(lesson);
    if (user.channels.telegram && this.telegram.enabled) {
      try { results.telegram = await this.telegram.sendLesson(user, lesson, this.learning.accessUrl(user)); }
      catch (error) { results.telegram = { status: 'failed', error: error.message }; }
    }
    if (user.channels.whatsapp && this.whatsapp.enabled) {
      try { results.whatsapp = await this.whatsapp.sendLesson(user, lesson, this.learning.accessUrl(user), text); }
      catch (error) { results.whatsapp = { status: 'failed', error: error.message }; }
    }
    await this.#recordMessage({ userId: user.id, lessonId: lesson.id, kind: 'lesson', results });
    await this.#recordChannelFailures(user, results, { kind: 'lesson_delivery_failed', title: 'Lesson channel delivery problem', message: `“${lesson.title}” is available in Today, but one linked messaging channel could not receive it.`, actionUrl: `${this.learning.accessUrl(user)}#lesson=${lesson.id}`, dedupeKey: `lesson-channel-failure:${lesson.id}` });
    return this.learning.markDelivered(lessonId, results);
  }

  async deliverBookSession(sessionId) {
    if (!this.books) throw new Error('Book learning is unavailable');
    const { session, book, user } = this.store.read((state) => {
      const session = state.bookSessions?.[sessionId];
      const book = state.books?.[session?.bookId];
      return { session, book, user: state.users[session?.userId] };
    });
    if (!session || !book || !user) throw new Error('Book session, book, or user not found');
    if (['delivered', 'completed'].includes(session.status)) return session;
    if (session.status !== 'scheduled') return { skipped: true, reason: `Book session is ${session.status}` };
    if (session.reviewStatus !== 'approved') throw new Error('Unapproved book session cannot be delivered');
    if (book.status === 'paused' || book.status === 'archived') return { skipped: true, reason: `Book is ${book.status}` };
    const results = { web: { status: 'available' } };
    if (user.channels.telegram && this.telegram.enabled) {
      try { results.telegram = await this.telegram.sendBookSession(user, book, session, this.learning.accessUrl(user)); }
      catch (error) { results.telegram = { status: 'failed', error: error.message }; }
    }
    if (user.channels.whatsapp && this.whatsapp.enabled) {
      try { results.whatsapp = await this.whatsapp.sendBookSession(user, book, session, this.learning.accessUrl(user)); }
      catch (error) { results.whatsapp = { status: 'failed', error: error.message }; }
    }
    await this.#recordMessage({ userId: user.id, bookId: book.id, bookSessionId: session.id, kind: 'book_session', results });
    await this.#recordChannelFailures(user, results, { kind: 'book_delivery_failed', title: 'Book-session channel delivery problem', message: `“${book.title} — Session ${session.sessionNumber}” is available in Reading, but one linked messaging channel could not receive it.`, actionUrl: `${this.learning.accessUrl(user)}#book-session=${session.id}`, dedupeKey: `book-channel-failure:${session.id}` });
    return this.books.markDelivered(sessionId, results);
  }

  async notifyBookPlanReady(bookId) {
    const { book, user } = this.store.read((state) => ({ book: state.books?.[bookId], user: state.users[state.books?.[bookId]?.userId] }));
    if (!book || !user) throw new Error('Book or user not found');
    const results = { web: { status: 'available' } };
    if (user.channels.telegram && this.telegram.enabled) {
      try { results.telegram = await this.telegram.sendBookPlanReady(user, book, this.learning.accessUrl(user)); }
      catch (error) { results.telegram = { status: 'failed', error: error.message }; }
    }
    if (user.channels.whatsapp && this.whatsapp.enabled) {
      try { results.whatsapp = await this.whatsapp.sendBookPlanReady(user, book, this.learning.accessUrl(user)); }
      catch (error) { results.whatsapp = { status: 'failed', error: error.message }; }
    }
    await this.#recordMessage({ userId: user.id, bookId: book.id, kind: 'book_plan_ready', results });
    return results;
  }

  async sendReminder(lessonId) {
    const { lesson, user } = this.store.read((state) => ({ lesson: state.lessons[lessonId], user: state.users[state.lessons[lessonId]?.userId] }));
    if (!lesson || !user || lesson.status !== 'delivered' || lesson.remindersSent >= 2) return { skipped: true };
    const results = {};
    if (user.channels.telegram && this.telegram.enabled) {
      try { results.telegram = await this.telegram.sendReminder(user, lesson, this.learning.accessUrl(user)); }
      catch (error) { results.telegram = { status: 'failed', error: error.message }; }
    }
    if (user.channels.whatsapp && this.whatsapp.enabled) {
      try { results.whatsapp = await this.whatsapp.sendReminder(user, lesson, this.learning.accessUrl(user)); }
      catch (error) { results.whatsapp = { status: 'failed', error: error.message }; }
    }
    await this.store.transaction((state) => {
      const target = state.lessons[lessonId];
      if (target && target.status !== 'completed') { target.remindersSent += 1; target.updatedAt = nowIso(); }
    });
    await this.#recordMessage({ userId: user.id, lessonId: lesson.id, kind: 'reminder', results });
    return results;
  }

  async sendBookReminder(sessionId) {
    if (!this.books) return { skipped: true };
    const { session, book, user } = this.store.read((state) => {
      const session = state.bookSessions?.[sessionId];
      return { session, book: state.books?.[session?.bookId], user: state.users[session?.userId] };
    });
    if (!session || !book || !user || session.status !== 'delivered' || session.remindersSent >= 2 || book.status !== 'active') return { skipped: true };
    const results = {};
    if (user.channels.telegram && this.telegram.enabled) {
      try { results.telegram = await this.telegram.sendBookReminder(user, book, session, this.learning.accessUrl(user)); }
      catch (error) { results.telegram = { status: 'failed', error: error.message }; }
    }
    if (user.channels.whatsapp && this.whatsapp.enabled) {
      try { results.whatsapp = await this.whatsapp.sendBookReminder(user, book, session, this.learning.accessUrl(user)); }
      catch (error) { results.whatsapp = { status: 'failed', error: error.message }; }
    }
    await this.store.transaction((state) => {
      const target = state.bookSessions?.[sessionId];
      if (target && target.status !== 'completed') { target.remindersSent += 1; target.updatedAt = nowIso(); }
    });
    await this.#recordMessage({ userId: user.id, bookId: book.id, bookSessionId: session.id, kind: 'book_reminder', results });
    return results;
  }

  async sendSystemNotice(userId, notice = {}) {
    const user = this.store.read((state) => state.users[userId]);
    if (!user) throw new Error('User not found');
    const results = { web: { status: 'available' } };
    if (user.channels.telegram && this.telegram.enabled) {
      try { results.telegram = await this.telegram.sendSystemNotice(user, notice); }
      catch (error) { results.telegram = { status: 'failed', error: error.message }; }
    }
    if (user.channels.whatsapp && this.whatsapp.enabled) {
      try { results.whatsapp = await this.whatsapp.sendSystemNotice(user, notice); }
      catch (error) { results.whatsapp = { status: 'failed', error: error.message }; }
    }
    await this.#recordMessage({ userId, kind: notice.kind || 'system_notice', notice, results });
    return results;
  }

  async sendDirectResponse(userId, text, origin = 'all', interactionId = null) {
    const user = this.store.read((state) => state.users[userId]);
    if (!user) throw new Error('User not found');
    const results = {};
    if ((origin === 'telegram' || origin === 'all') && user.channels.telegram && this.telegram.enabled && user.telegramChatId) {
      try { results.telegram = await this.telegram.sendText(user.telegramChatId, text); }
      catch (error) { results.telegram = { status: 'failed', error: error.message }; }
    }
    if ((origin === 'whatsapp' || origin === 'all') && user.channels.whatsapp && this.whatsapp.enabled && user.whatsappJid) {
      try { results.whatsapp = await this.whatsapp.sendText(user.whatsappJid, text); }
      catch (error) { results.whatsapp = { status: 'failed', error: error.message }; }
    }
    await this.#recordMessage({ userId, kind: 'direct_ai_response', results, interactionId, origin });
    return results;
  }

  async sendReinforcement(lessonId, questionId) {
    const { lesson, user } = this.store.read((state) => ({ lesson: state.lessons[lessonId], user: state.users[state.lessons[lessonId]?.userId] }));
    if (!lesson || !user) throw new Error('Lesson or user not found');
    const question = (lesson.quiz || []).find((item) => item.id === questionId);
    if (!question) throw new Error('Question not found');
    const results = {};
    if (user.channels.telegram && this.telegram.enabled) {
      try { results.telegram = await this.telegram.sendReinforcement(user, lesson, question); }
      catch (error) { results.telegram = { status: 'failed', error: error.message }; }
    }
    if (user.channels.whatsapp && this.whatsapp.enabled) {
      try { results.whatsapp = await this.whatsapp.sendReinforcement(user, lesson, question); }
      catch (error) { results.whatsapp = { status: 'failed', error: error.message }; }
    }
    if (Object.keys(results).length) await this.#recordMessage({ userId: user.id, lessonId: lesson.id, kind: 'reinforcement', results, questionId });
    return Object.keys(results).length ? results : { skipped: true, reason: 'No active messaging channel' };
  }

  async sendBookReinforcement(sessionId, questionId) {
    if (!this.books) throw new Error('Book learning is unavailable');
    const { session, book, user } = this.store.read((state) => {
      const session = state.bookSessions?.[sessionId];
      return { session, book: state.books?.[session?.bookId], user: state.users[session?.userId] };
    });
    if (!session || !book || !user) throw new Error('Book session context not found');
    if (session.status !== 'completed' || ['paused', 'archived'].includes(book.status)) return { skipped: true };
    const question = (session.quiz || []).find((item) => item.id === questionId);
    if (!question) throw new Error('Book question not found');
    const results = {};
    if (user.channels.telegram && this.telegram.enabled) {
      try { results.telegram = await this.telegram.sendBookReinforcement(user, book, session, question); }
      catch (error) { results.telegram = { status: 'failed', error: error.message }; }
    }
    if (user.channels.whatsapp && this.whatsapp.enabled) {
      try { results.whatsapp = await this.whatsapp.sendBookReinforcement(user, book, session, question); }
      catch (error) { results.whatsapp = { status: 'failed', error: error.message }; }
    }
    if (Object.keys(results).length) await this.#recordMessage({ userId: user.id, bookId: book.id, bookSessionId: session.id, kind: 'book_reinforcement', results, questionId });
    return Object.keys(results).length ? results : { skipped: true, reason: 'No active messaging channel' };
  }

  async #recordChannelFailures(user, results, notice) {
    const failures = Object.entries(results || {}).filter(([, result]) => result?.status === 'failed');
    if (!failures.length) return;
    await this.store.transaction((state) => {
      queueSystemNotice(state, {
        userId: user.id,
        kind: notice.kind,
        title: notice.title,
        message: `${notice.message} Failed channel${failures.length === 1 ? '' : 's'}: ${failures.map(([channel]) => channel).join(', ')}.`,
        actionUrl: notice.actionUrl,
        actionLabel: 'Open dashboard',
        dedupeKey: notice.dedupeKey,
        metadata: { failures: Object.fromEntries(failures) }
      });
    });
  }

  async #recordMessage(recordInput) {
    const record = { id: uid('message'), ...recordInput, createdAt: nowIso() };
    await this.store.transaction((state) => { state.messages[record.id] = record; return record; });
  }
}
