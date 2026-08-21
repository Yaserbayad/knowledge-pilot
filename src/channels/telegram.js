import fs from 'node:fs/promises';
import path from 'node:path';
import { verifyBindingToken } from '../auth.js';
import { formatBookSessionText, formatLessonText, splitMessage } from '../utils.js';

export class TelegramChannel {
  constructor({ config, store, learning, books = null, logger }) {
    this.config = config;
    this.store = store;
    this.learning = learning;
    this.books = books;
    this.logger = logger;
    this.botUsername = null;
  }

  get enabled() { return this.config.enabled && Boolean(this.config.botToken); }

  async init() {
    if (!this.enabled) return;
    const me = await this.api('getMe', {});
    this.botUsername = me.username;
    this.logger.info({ username: this.botUsername }, 'Telegram bot ready');
  }

  async api(method, payload) {
    const response = await fetch(`https://api.telegram.org/bot${this.config.botToken}/${method}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(30000)
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.ok) throw new Error(`Telegram ${method} failed: ${body.description || response.status}`);
    return body.result;
  }

  async sendDocument(chatId, filePath, caption = '') {
    const bytes = await fs.readFile(filePath);
    const form = new FormData();
    form.set('chat_id', String(chatId));
    form.set('caption', caption);
    form.set('document', new Blob([bytes], { type: 'image/svg+xml' }), path.basename(filePath));
    const response = await fetch(`https://api.telegram.org/bot${this.config.botToken}/sendDocument`, {
      method: 'POST', body: form, signal: AbortSignal.timeout(30000)
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.ok) throw new Error(`Telegram sendDocument failed: ${body.description || response.status}`);
    return body.result;
  }

  async setWebhook(url) {
    if (!this.enabled) return null;
    return this.api('setWebhook', {
      url,
      secret_token: this.config.webhookSecret,
      allowed_updates: ['message', 'callback_query'],
      drop_pending_updates: false
    });
  }

  async sendText(chatId, text, replyMarkup = undefined) {
    const parts = splitMessage(text, 3900);
    let result = null;
    for (let i = 0; i < parts.length; i += 1) {
      result = await this.api('sendMessage', {
        chat_id: chatId,
        text: parts[i],
        disable_web_page_preview: true,
        ...(replyMarkup && i === parts.length - 1 ? { reply_markup: replyMarkup } : {})
      });
    }
    return result;
  }

  async sendPlan(user, plan, accessUrl) {
    if (!user.telegramChatId) return { status: 'not_bound' };
    const items = plan.proposals.map((p) => `${p.order}. ${p.title} (${p.estimatedMinutes} min)\n${p.question}`).join('\n\n');
    await this.sendText(user.telegramChatId, `Your proposed weekly learning plan\n\nPrimary: ${plan.primarySubject}\n\n${items}\n\nReview it on the web: ${accessUrl}#plan`, {
      inline_keyboard: [[{ text: 'Approve weekly plan', callback_data: `plan:${plan.id}` }], [{ text: 'Open plan', url: `${accessUrl}#plan` }]]
    });
    return { status: 'sent' };
  }

  async sendLesson(user, lesson, accessUrl) {
    if (!user.telegramChatId) return { status: 'not_bound' };
    const text = `${formatLessonText(lesson)}\n\nOpen the full lesson: ${accessUrl}#lesson=${lesson.id}`;
    await this.sendText(user.telegramChatId, text, {
      inline_keyboard: [
        [{ text: 'Open lesson', url: `${accessUrl}#lesson=${lesson.id}` }],
        [{ text: 'Mark complete', callback_data: `complete:${lesson.id}` }]
      ]
    });
    return { status: 'sent' };
  }

  async sendBookPlanReady(user, book, accessUrl) {
    if (!user.telegramChatId) return { status: 'not_bound' };
    await this.sendText(user.telegramChatId, `📚 Book plan ready\n\n${book.title}${book.author ? ` — ${book.author}` : ''}\n\nReview the proposed duration and structure:\n${accessUrl}#book=${book.id}`, {
      inline_keyboard: [[{ text: 'Open book plan', url: `${accessUrl}#book=${book.id}` }]]
    });
    return { status: 'sent' };
  }

  async sendBookSession(user, book, session, accessUrl) {
    if (!user.telegramChatId) return { status: 'not_bound' };
    if (session.cardFile && this.config.cardDir) {
      await this.sendDocument(user.telegramChatId, path.join(this.config.cardDir, session.cardFile), session.label).catch((error) => this.logger.warn({ error: error.message }, 'Telegram book card delivery failed'));
    }
    const text = `${formatBookSessionText(session, book)}\n\nOpen the complete book session: ${accessUrl}#book-session=${session.id}`;
    await this.sendText(user.telegramChatId, text, {
      inline_keyboard: [
        [{ text: 'Open book session', url: `${accessUrl}#book-session=${session.id}` }],
        [{ text: 'Mark complete', callback_data: `bookcomplete:${session.id}` }]
      ]
    });
    return { status: 'sent' };
  }

  async sendBookReminder(user, book, session, accessUrl) {
    if (!user.telegramChatId) return { status: 'not_bound' };
    await this.sendText(user.telegramChatId, `📚 Book reminder: continue “${book.title} — Session ${session.sessionNumber}”.\n${accessUrl}#book-session=${session.id}`);
    return { status: 'sent' };
  }

  async sendSystemNotice(user, notice = {}) {
    if (!user.telegramChatId) return { status: 'not_bound' };
    const title = String(notice.title || 'Knowledge Pilot');
    const message = String(notice.message || 'Open Knowledge Pilot for details.');
    const actionUrl = String(notice.actionUrl || '');
    const actionLabel = String(notice.actionLabel || 'Open Knowledge Pilot');
    const rows = [];
    const lessonId = notice.metadata?.lessonId;
    const sessionId = notice.metadata?.sessionId;
    if (notice.kind === 'lesson_review_required' && lessonId) {
      rows.push([{ text: 'Accept and schedule', callback_data: `lapprove:${lessonId}` }, { text: 'Skip', callback_data: `lskip:${lessonId}` }]);
    }
    if (notice.kind === 'book_session_review_required' && sessionId) {
      rows.push([{ text: 'Accept and schedule', callback_data: `bapprove:${sessionId}` }, { text: 'Skip', callback_data: `bskip:${sessionId}` }]);
    }
    if (actionUrl) rows.push([{ text: actionLabel, url: actionUrl }]);
    await this.sendText(user.telegramChatId, `${title}

${message}`, rows.length ? { inline_keyboard: rows } : undefined);
    return { status: 'sent' };
  }

  async sendBookReinforcement(user, book, session, question) {
    if (!user.telegramChatId) return { status: 'not_bound' };
    await this.sendText(user.telegramChatId, `📚 Recall from “${book.title} — Session ${session.sessionNumber}”:\n\n${question.question}\n\nReply directly with your answer.`);
    return { status: 'sent' };
  }

  async sendReminder(user, lesson, accessUrl) {
    if (!user.telegramChatId) return { status: 'not_bound' };
    await this.sendText(user.telegramChatId, `Reminder: continue “${lesson.title}”.\n${accessUrl}#lesson=${lesson.id}`);
    return { status: 'sent' };
  }

  async sendReinforcement(user, lesson, question) {
    if (!user.telegramChatId) return { status: 'not_bound' };
    await this.sendText(user.telegramChatId, `Recall from “${lesson.title}”:\n\n${question.question}\n\nReply directly with your answer.`);
    return { status: 'sent' };
  }

  async handleUpdate(update) {
    if (update.callback_query) return this.#handleCallback(update.callback_query);
    if (update.message) return this.#handleMessage(update.message);
    return null;
  }

  async #handleCallback(callback) {
    const chatId = String(callback.message?.chat?.id || '');
    const user = this.store.read((state) => Object.values(state.users).find((u) => String(u.telegramChatId) === chatId));
    if (!user) return this.api('answerCallbackQuery', { callback_query_id: callback.id, text: 'Account is not linked.' });
    const [action, id, value] = String(callback.data || '').split(':');
    try {
      if (action === 'bookcomplete') {
        if (!this.books) throw new Error('Book learning is unavailable');
        await this.books.completeSession(user.id, id);
        await this.api('answerCallbackQuery', { callback_query_id: callback.id, text: 'Book session completed.' });
        return this.sendText(chatId, 'Book session completed. Recall questions will be scheduled automatically.');
      }
      if (action === 'complete') {
        await this.learning.completeLesson(user.id, id);
        await this.api('answerCallbackQuery', { callback_query_id: callback.id, text: 'Lesson completed.' });
        return this.sendText(chatId, 'Completed. Reinforcement questions will be scheduled automatically. Was this lesson useful?', {
          inline_keyboard: [[{ text: 'Useful', callback_data: `useful:${id}:yes` }, { text: 'Not useful', callback_data: `useful:${id}:no` }]]
        });
      }
      if (action === 'plan') {
        await this.learning.approvePlan(user.id, id);
        await this.api('answerCallbackQuery', { callback_query_id: callback.id, text: 'Weekly plan approved.' });
        return this.sendText(chatId, 'Weekly plan approved. The first lesson is being prepared.');
      }
      if (action === 'lapprove') {
        await this.learning.reviewLesson(id, 'approve', 'Approved from Telegram', { userId: user.id, forceSchedule: true });
        await this.api('answerCallbackQuery', { callback_query_id: callback.id, text: 'Lesson accepted and scheduled.' });
        return this.sendText(chatId, 'Lesson accepted. It will be delivered automatically.');
      }
      if (action === 'lskip') {
        await this.learning.skipLesson(user.id, id);
        await this.api('answerCallbackQuery', { callback_query_id: callback.id, text: 'Lesson skipped.' });
        return this.sendText(chatId, 'Lesson skipped.');
      }
      if (action === 'bapprove') {
        if (!this.books) throw new Error('Book learning is unavailable');
        await this.books.reviewSession(id, 'approve', 'Approved from Telegram', { userId: user.id, forceSchedule: true });
        await this.api('answerCallbackQuery', { callback_query_id: callback.id, text: 'Book session accepted and scheduled.' });
        return this.sendText(chatId, 'Book session accepted. It will be delivered automatically.');
      }
      if (action === 'bskip') {
        if (!this.books) throw new Error('Book learning is unavailable');
        await this.books.skipSession(user.id, id);
        await this.api('answerCallbackQuery', { callback_query_id: callback.id, text: 'Book session skipped.' });
        return this.sendText(chatId, 'Book session skipped.');
      }
      if (action === 'useful') {
        await this.learning.submitFeedback(user.id, id, { useful: value === 'yes' });
        return this.api('answerCallbackQuery', { callback_query_id: callback.id, text: 'Feedback saved.' });
      }
    } catch (error) {
      this.logger.error({ error: error.message }, 'Telegram callback failed');
      return this.api('answerCallbackQuery', { callback_query_id: callback.id, text: 'Action failed.' });
    }
    return this.api('answerCallbackQuery', { callback_query_id: callback.id });
  }

  async #handleMessage(message) {
    const chatId = String(message.chat?.id || '');
    const text = String(message.text || '').trim();
    if (!text) return null;
    if (text.startsWith('/start')) {
      const token = text.split(/\s+/)[1];
      const binding = verifyBindingToken(this.config.appSecret, token, 'telegram');
      if (!binding) return this.sendText(chatId, 'This linking code is invalid or expired. Open your Knowledge Pilot profile and generate a new link.');
      const linkedUser = await this.store.transaction((state) => {
        const user = state.users[binding.userId];
        if (!user) throw new Error('User not found');
        for (const candidate of Object.values(state.users || {})) {
          if (candidate.id !== user.id && String(candidate.telegramChatId || '') === chatId) {
            candidate.telegramChatId = null;
            candidate.channels.telegram = false;
            candidate.updatedAt = new Date().toISOString();
          }
        }
        user.telegramChatId = chatId;
        user.channels.telegram = true;
        user.updatedAt = new Date().toISOString();
        return user;
      });
      const accessUrl = this.learning.accessUrl(linkedUser);
      return this.sendText(chatId, 'Telegram is linked to your Knowledge Pilot profile. You will receive deliveries and notices whenever the system needs your action.', {
        inline_keyboard: [[{ text: 'Open dashboard', url: accessUrl }]]
      });
    }
    const user = this.store.read((state) => Object.values(state.users).find((u) => String(u.telegramChatId) === chatId));
    if (!user) return this.sendText(chatId, 'Open your private Knowledge Pilot page and use the Telegram linking button first.');
    const pendingBook = this.books ? await this.books.answerPendingReinforcement(user.id, text, 'telegram') : null;
    if (pendingBook) return this.sendText(chatId, pendingBook.pending ? pendingBook.evaluation.feedback : `${pendingBook.evaluation.feedback}\n\nSuggested answer: ${pendingBook.evaluation.idealAnswer}`);
    const pending = await this.learning.answerPendingReinforcement(user.id, text, 'telegram');
    if (pending) return this.sendText(chatId, pending.pending ? pending.evaluation.feedback : `${pending.evaluation.feedback}\n\nSuggested answer: ${pending.evaluation.idealAnswer}`);
    const latest = this.store.read((state) => {
      const lesson = Object.values(state.lessons).filter((item) => item.userId === user.id && ['delivered', 'completed'].includes(item.status))
        .map((item) => ({ kind: 'lesson', item, date: item.deliveredAt || item.createdAt }));
      const bookSession = Object.values(state.bookSessions || {}).filter((item) => item.userId === user.id && ['delivered', 'completed'].includes(item.status))
        .map((item) => ({ kind: 'book', item, date: item.deliveredAt || item.createdAt }));
      return [...lesson, ...bookSession].sort((a, b) => b.date.localeCompare(a.date))[0] || null;
    });
    if (!latest) return this.sendText(chatId, 'There is no active lesson or book session yet.');
    const answer = latest.kind === 'book' && this.books
      ? await this.books.answerFollowUp(user.id, latest.item.id, text, 'telegram')
      : await this.learning.answerFollowUp(user.id, latest.item.id, text, 'telegram');
    return this.sendText(chatId, answer.answer);
  }
}
