import fs from 'node:fs/promises';
import path from 'node:path';
import { verifyBindingToken } from '../auth.js';
import { formatBookSessionText, normalizePhone, sleep } from '../utils.js';

function messageText(message) {
  const m = message.message || {};
  return m.conversation || m.extendedTextMessage?.text || m.imageMessage?.caption || m.documentMessage?.caption || '';
}

export class WhatsAppChannel {
  constructor({ config, store, learning, books = null, logger }) {
    this.config = config;
    this.store = store;
    this.learning = learning;
    this.books = books;
    this.logger = logger;
    this.sock = null;
    this.status = 'disabled';
    this.lastSentAt = 0;
    this.baileys = null;
    this.connecting = false;
  }

  get enabled() { return this.config.enabled; }

  async init() {
    if (!this.enabled) return;
    try {
      this.baileys = await import('@whiskeysockets/baileys');
      await this.connect();
    } catch (error) {
      this.status = 'error';
      this.logger.error({ error: error.message }, 'WhatsApp failed to initialize');
    }
  }

  async connect() {
    if (!this.enabled || this.connecting) return;
    this.connecting = true;
    try {
      const { default: makeWASocket, useMultiFileAuthState, Browsers, fetchLatestBaileysVersion } = this.baileys;
      const { state, saveCreds } = await useMultiFileAuthState(this.config.authDir);
      const versionInfo = await fetchLatestBaileysVersion().catch(() => ({ version: undefined }));
      const silentLogger = {
        level: 'silent', trace() {}, debug() {}, info() {}, warn() {}, error() {}, fatal() {},
        child() { return silentLogger; }
      };
      this.sock = makeWASocket({
        auth: state,
        version: versionInfo.version,
        browser: Browsers.ubuntu('Knowledge Pilot'),
        markOnlineOnConnect: false,
        syncFullHistory: false,
        generateHighQualityLinkPreview: false,
        logger: silentLogger
      });
      this.status = 'connecting';
      this.sock.ev.on('creds.update', saveCreds);
      this.sock.ev.on('connection.update', ({ connection, lastDisconnect }) => {
        if (connection === 'open') {
          this.status = 'connected';
          this.logger.info({}, 'WhatsApp connected');
        }
        if (connection === 'close') {
          this.status = 'disconnected';
          const code = lastDisconnect?.error?.output?.statusCode || lastDisconnect?.error?.statusCode;
          const loggedOut = code === 401;
          this.logger.warn({ code, loggedOut }, 'WhatsApp connection closed');
          if (!loggedOut) setTimeout(() => this.connect().catch(() => {}), 5000);
        }
      });
      this.sock.ev.on('messages.upsert', ({ messages, type }) => {
        if (type !== 'notify') return;
        for (const message of messages) this.#handleMessage(message).catch((error) => this.logger.error({ error: error.message }, 'WhatsApp inbound failed'));
      });
    } finally {
      this.connecting = false;
    }
  }

  async requestPairingCode(phoneNumber) {
    if (!this.sock) throw new Error('WhatsApp socket is not initialized');
    return this.sock.requestPairingCode(normalizePhone(phoneNumber));
  }

  async sendText(jid, text) {
    if (!this.sock || this.status !== 'connected') throw new Error('WhatsApp is not connected');
    const wait = Math.max(0, this.config.minSendIntervalMs - (Date.now() - this.lastSentAt));
    if (wait) await sleep(wait);
    const result = await this.sock.sendMessage(jid, { text });
    this.lastSentAt = Date.now();
    return result;
  }

  async sendPlan(user, plan, accessUrl) {
    if (!user.whatsappJid) return { status: 'not_bound' };
    const items = plan.proposals.map((p) => `${p.order}. ${p.title} (${p.estimatedMinutes} min)\n${p.question}`).join('\n\n');
    await this.sendText(user.whatsappJid, `Your proposed weekly learning plan\n\nPrimary: ${plan.primarySubject}\n\n${items}\n\nReply APPROVE ${plan.id} or review it here:
${accessUrl}#plan`);
    return { status: 'sent' };
  }

  async sendLesson(user, lesson, accessUrl, formattedText) {
    if (!user.whatsappJid) return { status: 'not_bound' };
    await this.sendText(user.whatsappJid, `${formattedText}\n\nOpen the full lesson:\n${accessUrl}#lesson=${lesson.id}\n\nReply DONE ${lesson.id} when completed.`);
    return { status: 'sent' };
  }

  async sendBookPlanReady(user, book, accessUrl) {
    if (!user.whatsappJid) return { status: 'not_bound' };
    await this.sendText(user.whatsappJid, `📚 Book plan ready\n\n${book.title}${book.author ? ` — ${book.author}` : ''}\n\nReview the duration and structure:\n${accessUrl}#book=${book.id}`);
    return { status: 'sent' };
  }

  async sendBookSession(user, book, session, accessUrl) {
    if (!user.whatsappJid) return { status: 'not_bound' };
    if (session.cardFile && this.config.cardDir) {
      const document = await fs.readFile(path.join(this.config.cardDir, session.cardFile));
      await this.sock.sendMessage(user.whatsappJid, { document, mimetype: 'image/svg+xml', fileName: session.cardFile, caption: session.label }).catch((error) => this.logger.warn({ error: error.message }, 'WhatsApp book card delivery failed'));
    }
    await this.sendText(user.whatsappJid, `${formatBookSessionText(session, book)}\n\nOpen the full book session:\n${accessUrl}#book-session=${session.id}\n\nReply BOOKDONE ${session.id} when completed.`);
    return { status: 'sent' };
  }

  async sendBookReminder(user, book, session, accessUrl) {
    if (!user.whatsappJid) return { status: 'not_bound' };
    await this.sendText(user.whatsappJid, `📚 Book reminder: continue “${book.title} — Session ${session.sessionNumber}”.\n${accessUrl}#book-session=${session.id}`);
    return { status: 'sent' };
  }

  async sendSystemNotice(user, notice = {}) {
    if (!user.whatsappJid) return { status: 'not_bound' };
    const title = String(notice.title || 'Knowledge Pilot');
    const message = String(notice.message || 'Open Knowledge Pilot for details.');
    const actionUrl = String(notice.actionUrl || '');
    await this.sendText(user.whatsappJid, `${title}

${message}${actionUrl ? `

${actionUrl}` : ''}`);
    return { status: 'sent' };
  }

  async sendBookReinforcement(user, book, session, question) {
    if (!user.whatsappJid) return { status: 'not_bound' };
    await this.sendText(user.whatsappJid, `📚 Recall from “${book.title} — Session ${session.sessionNumber}”:\n\n${question.question}\n\nReply with your answer.`);
    return { status: 'sent' };
  }

  async sendReminder(user, lesson, accessUrl) {
    if (!user.whatsappJid) return { status: 'not_bound' };
    await this.sendText(user.whatsappJid, `Reminder: continue “${lesson.title}”.\n${accessUrl}#lesson=${lesson.id}`);
    return { status: 'sent' };
  }

  async sendReinforcement(user, lesson, question) {
    if (!user.whatsappJid) return { status: 'not_bound' };
    await this.sendText(user.whatsappJid, `Recall from “${lesson.title}”:\n\n${question.question}\n\nReply with your answer.`);
    return { status: 'sent' };
  }

  async #handleMessage(message) {
    if (message.key?.fromMe) return;
    const jid = message.key?.remoteJid;
    if (!jid || jid.endsWith('@g.us')) return;
    const text = messageText(message).trim();
    if (!text) return;
    const linkMatch = text.match(/^LINK\s+([A-Za-z0-9_-]{20,128})$/);
    if (linkMatch) {
      const binding = this.config.appSecret
        ? verifyBindingToken(this.config.appSecret, linkMatch[1], 'whatsapp')
        : null;
      if (!binding) return this.sendText(jid, 'Invalid or expired Knowledge Pilot linking token.');
      const linked = await this.store.transaction((state) => {
        const target = state.users?.[binding.userId];
        if (!target) return false;
        for (const candidate of Object.values(state.users || {})) {
          if (candidate.id !== target.id && candidate.whatsappJid === jid) {
            candidate.whatsappJid = null;
            candidate.channels ||= {};
            candidate.channels.whatsapp = false;
            candidate.updatedAt = new Date().toISOString();
          }
        }
        target.whatsappJid = jid;
        target.channels ||= {};
        target.channels.whatsapp = true;
        target.whatsappLinkCode = null;
        target.updatedAt = new Date().toISOString();
        return true;
      });
      if (!linked) return this.sendText(jid, 'Invalid or expired Knowledge Pilot linking token.');
      return this.sendText(jid, 'WhatsApp is linked to your Knowledge Pilot profile.');
    }
    if (/^LINK\b/i.test(text)) return this.sendText(jid, 'Invalid or expired Knowledge Pilot linking token.');
    const user = this.store.read((state) => Object.values(state.users).find((u) => u.whatsappJid === jid));
    if (!user) return this.sendText(jid, 'Send LINK followed by the code shown on your private Knowledge Pilot page.');
    const approve = text.match(/^APPROVE\s+(plan_[a-z0-9]+)$/i);
    if (approve) {
      await this.learning.approvePlan(user.id, approve[1]);
      return this.sendText(jid, 'Weekly plan approved. The first lesson is being prepared.');
    }
    const bookDone = text.match(/^BOOKDONE\s+(booksession_[a-z0-9]+)$/i);
    if (bookDone && this.books) {
      await this.books.completeSession(user.id, bookDone[1]);
      return this.sendText(jid, 'Book session completed. Recall questions will follow automatically.');
    }
    const done = text.match(/^DONE\s+(lesson_[a-z0-9]+)$/i);
    if (done) {
      await this.learning.completeLesson(user.id, done[1]);
      return this.sendText(jid, 'Lesson completed. Reinforcement questions will follow automatically.');
    }
    const pendingBook = this.books ? await this.books.answerPendingReinforcement(user.id, text, 'whatsapp') : null;
    if (pendingBook) return this.sendText(jid, pendingBook.pending ? pendingBook.evaluation.feedback : `${pendingBook.evaluation.feedback}\n\nSuggested answer: ${pendingBook.evaluation.idealAnswer}`);
    const pending = await this.learning.answerPendingReinforcement(user.id, text, 'whatsapp');
    if (pending) return this.sendText(jid, pending.pending ? pending.evaluation.feedback : `${pending.evaluation.feedback}\n\nSuggested answer: ${pending.evaluation.idealAnswer}`);
    const latest = this.store.read((state) => {
      const lessons = Object.values(state.lessons).filter((item) => item.userId === user.id && ['delivered', 'completed'].includes(item.status)).map((item) => ({ kind: 'lesson', item, date: item.deliveredAt || item.createdAt }));
      const bookSessions = Object.values(state.bookSessions || {}).filter((item) => item.userId === user.id && ['delivered', 'completed'].includes(item.status)).map((item) => ({ kind: 'book', item, date: item.deliveredAt || item.createdAt }));
      return [...lessons, ...bookSessions].sort((a, b) => b.date.localeCompare(a.date))[0] || null;
    });
    if (!latest) return this.sendText(jid, 'There is no active lesson or book session yet.');
    const answer = latest.kind === 'book' && this.books
      ? await this.books.answerFollowUp(user.id, latest.item.id, text, 'whatsapp')
      : await this.learning.answerFollowUp(user.id, latest.item.id, text, 'whatsapp');
    return this.sendText(jid, answer.answer);
  }
}
