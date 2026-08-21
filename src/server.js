import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { adminTokenMatches, cookie, createUserToken, parseCookies, verifyUserToken } from './auth.js';
import { nowIso } from './utils.js';
import { gptOpenApi } from './gpt-openapi.js';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon'
};

function send(res, status, body, headers = {}) {
  const payload = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
  res.writeHead(status, { 'content-length': payload.length, 'x-content-type-options': 'nosniff', ...headers });
  res.end(payload);
}

function json(res, status, data) {
  send(res, status, JSON.stringify(data), { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
}

function redirect(res, location, setCookie = null) {
  send(res, 302, '', { location, ...(setCookie ? { 'set-cookie': setCookie } : {}) });
}

function httpError(message, statusCode, code = '') {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (code) error.code = code;
  return error;
}

function statusForError(error) {
  if (Number(error?.statusCode)) return Number(error.statusCode);
  const message = String(error?.message || '').toLowerCase();
  if (message.includes('not found') || message.includes('no ungenerated')) return 404;
  if (message.includes('request body too large') || message.includes('exceeds the 30 mb limit')) return 413;
  if (message.includes('service is unavailable') || message.includes('learning is unavailable')) return 503;
  if (message.startsWith('invalid ') || message.endsWith(' is required') || message.includes('missing or too short')
    || message.includes('uploaded source') || message.includes('uploaded file') || message.includes('supported owned-copy formats')) return 400;
  if (message.includes('can no longer') || message.includes('cannot be ') || message.includes('must be ') || message.includes('only a ') || message.includes('not eligible') || message.includes('already ') || message.includes('not available for')) return 409;
  return 500;
}

function requireSameOrigin(req, config) {
  const origin = String(req.headers.origin || '');
  if (!origin) return;
  if (origin !== new URL(config.appBaseUrl).origin) throw httpError('Cross-origin account deletion is forbidden', 403, 'CROSS_ORIGIN_DELETE');
}

async function bodyBuffer(req, maxBytes = 30 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw httpError('Request body too large', 413, 'PAYLOAD_TOO_LARGE');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function bodyJson(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 2_000_000) throw httpError('Request body too large', 413, 'PAYLOAD_TOO_LARGE');
  }
  if (!body) return {};
  try {
    return JSON.parse(body);
  } catch (error) {
    error.statusCode = 400;
    error.code = 'INVALID_JSON';
    throw error;
  }
}

function routeMatch(pathname, pattern) {
  const names = [];
  const regex = new RegExp(`^${pattern.replace(/:([A-Za-z0-9_]+)/g, (_, name) => { names.push(name); return '([^/]+)'; })}$`);
  const match = pathname.match(regex);
  if (!match) return null;
  return Object.fromEntries(names.map((name, index) => [name, decodeURIComponent(match[index + 1])]));
}

function adminSession(config) {
  return createUserToken(config.appSecret, 'admin', 1);
}

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export function createServer({ config, store, learning, books = null, bookFiles = null, accounts = null, businessActions = null, telegram, whatsapp, scheduler, logger }) {
  const publicDir = path.resolve(process.cwd(), 'public');

  function currentUser(req) {
    const token = parseCookies(req.headers.cookie).kp_user;
    const parsed = verifyUserToken(config.appSecret, token);
    if (!parsed) return null;
    const user = store.read((state) => state.users[parsed.userId]);
    if (!user || user.accessVersion !== parsed.accessVersion) return null;
    return user;
  }

  function isAdmin(req) {
    const session = parseCookies(req.headers.cookie).kp_admin;
    return session === adminSession(config);
  }

  async function serveFile(res, file) {
    const resolved = path.resolve(file);
    const isPublic = isWithin(publicDir, resolved);
    const isCard = isWithin(config.cardDir, resolved);
    if (!isPublic && !isCard) return send(res, 403, 'Forbidden');
    try {
      const data = await fs.readFile(resolved);
      send(res, 200, data, { 'content-type': MIME[path.extname(resolved)] || 'application/octet-stream', 'cache-control': isPublic ? 'no-store' : 'private, max-age=300' });
    } catch (error) {
      send(res, error.code === 'ENOENT' ? 404 : 500, 'Not found');
    }
  }

  const server = http.createServer(async (req, res) => {
    const started = Date.now();
    try {
      const url = new URL(req.url, config.appBaseUrl);
      const pathname = url.pathname;
      if (pathname === '/health') return json(res, 200, { ok: true, time: nowIso(), whatsapp: whatsapp.status, telegram: telegram.enabled, scheduler: { enabled: config.scheduler.enabled, running: scheduler.running, lastTickAt: scheduler.lastTickAt, lastError: scheduler.lastError }, businessActions: Boolean(businessActions?.enabled) });
      if (pathname === '/gpt-action/openapi.json' && req.method === 'GET') return json(res, 200, gptOpenApi(config.appBaseUrl));
      if (pathname === '/privacy' && req.method === 'GET') return send(res, 200, `<!doctype html><html><head><meta charset="utf-8"><title>Knowledge Pilot Privacy</title></head><body style="max-width:760px;margin:40px auto;font:16px/1.6 system-ui"><h1>Knowledge Pilot Privacy</h1><p>This private self-hosted service stores learner profiles, lessons, progress, feedback, and message metadata on the operator's server. Data sent through the ChatGPT Action is processed within the connected ChatGPT Business workspace and returned to this server. The service does not sell data or use it for advertising.</p><p>Learners can permanently delete their account and live data from Settings. Administrators can perform the same deletion from the Learners panel. Protected disaster-recovery backups may retain historical data until normal backup rotation removes them.</p></body></html>`, { 'content-type': 'text/html; charset=utf-8' });
      if (pathname === '/' && req.method === 'GET') return serveFile(res, path.join(publicDir, 'index.html'));
      if (pathname === '/app' && req.method === 'GET') return serveFile(res, path.join(publicDir, 'app.html'));
      if (pathname === '/admin' && req.method === 'GET') return serveFile(res, path.join(publicDir, 'admin.html'));
      if (pathname === '/sw.js' && req.method === 'GET') return serveFile(res, path.join(publicDir, 'sw.js'));
      if (pathname.startsWith('/assets/')) return serveFile(res, path.join(publicDir, pathname.replace('/assets/', '')));
      if (pathname.startsWith('/cards/')) {
        const user = currentUser(req);
        if (!user) return json(res, 401, { error: 'Private user access required' });
        const cardFile = path.basename(pathname);
        const owned = store.read((state) => [
          ...Object.values(state.lessons || {}),
          ...Object.values(state.bookSessions || {})
        ].some((item) => item.userId === user.id && item.cardFile === cardFile));
        if (!owned) return json(res, 404, { error: 'Card not found' });
        return serveFile(res, path.join(config.cardDir, cardFile));
      }

      let params = routeMatch(pathname, '/u/:userId/:token');
      if (params && req.method === 'GET') {
        const parsed = verifyUserToken(config.appSecret, params.token);
        const user = store.read((state) => state.users[params.userId]);
        if (!parsed || parsed.userId !== params.userId || !user || parsed.accessVersion !== user.accessVersion) return send(res, 403, 'Invalid private access link');
        return redirect(res, '/app', cookie('kp_user', params.token, { secure: config.nodeEnv === 'production' }));
      }

      if (pathname === '/api/admin/login' && req.method === 'POST') {
        const body = await bodyJson(req);
        if (!adminTokenMatches(config.adminToken, body.token)) return json(res, 403, { error: 'Invalid admin token' });
        return jsonWithCookie(res, 200, { ok: true }, cookie('kp_admin', adminSession(config), { secure: config.nodeEnv === 'production', maxAge: 60 * 60 * 12 }));
      }
      if (pathname === '/api/admin/logout' && req.method === 'POST') return jsonWithCookie(res, 200, { ok: true }, cookie('kp_admin', '', { secure: config.nodeEnv === 'production', maxAge: 0 }));

      if (pathname === '/api/telegram/webhook' && req.method === 'POST') {
        if (!telegram.enabled) return json(res, 404, { error: 'Telegram disabled' });
        if (config.telegram.webhookSecret && req.headers['x-telegram-bot-api-secret-token'] !== config.telegram.webhookSecret) return json(res, 403, { error: 'Invalid webhook secret' });
        const body = await bodyJson(req);
        await telegram.handleUpdate(body);
        return json(res, 200, { ok: true });
      }

      if (pathname.startsWith('/api/gpt/')) {
        if (!businessActions?.enabled) return json(res, 404, { error: 'ChatGPT Business Actions are disabled' });
        if (!businessActions.authenticate(req.headers.authorization)) return json(res, 401, { error: 'Invalid Action API key' });
        if (pathname === '/api/gpt/health' && req.method === 'GET') return json(res, 200, { ok: true, mode: config.ai.provider, pending: businessActions.list({ status: 'pending', limit: 100 }).length, time: nowIso() });
        params = routeMatch(pathname, '/api/gpt/books/:bookId/source-text');
        if (params && req.method === 'GET') {
          if (!books) return json(res, 404, { error: 'Book learning is disabled' });
          return json(res, 200, await books.sourceChunk(params.bookId, url.searchParams.get('offset'), url.searchParams.get('limit')));
        }
        if (pathname === '/api/gpt/tasks' && req.method === 'GET') return json(res, 200, businessActions.list({ status: url.searchParams.get('status') || 'pending', limit: url.searchParams.get('limit') || 20 }));
        params = routeMatch(pathname, '/api/gpt/tasks/:taskId');
        if (params && req.method === 'GET') return json(res, 200, businessActions.getTask(params.taskId));
        params = routeMatch(pathname, '/api/gpt/tasks/:taskId/claim');
        if (params && req.method === 'POST') return json(res, 200, await businessActions.claim(params.taskId));
        params = routeMatch(pathname, '/api/gpt/tasks/:taskId/book-analysis-result');
        if (params && req.method === 'POST') return json(res, 200, await businessActions.submitBookAnalysis(params.taskId, await bodyJson(req)));
        params = routeMatch(pathname, '/api/gpt/tasks/:taskId/result');
        if (params && req.method === 'POST') return json(res, 200, await businessActions.submit(params.taskId, await bodyJson(req)));
        params = routeMatch(pathname, '/api/gpt/tasks/:taskId/fail');
        if (params && req.method === 'POST') return json(res, 200, await businessActions.fail(params.taskId, (await bodyJson(req)).reason));
        return json(res, 404, { error: 'Action endpoint not found' });
      }

      if (pathname.startsWith('/api/admin/')) {
        if (!isAdmin(req)) return json(res, 401, { error: 'Admin authentication required' });
        if (pathname === '/api/admin/status' && req.method === 'GET') return json(res, 200, {
          ok: true, version: config.version, whatsapp: whatsapp.status, telegram: telegram.enabled,
          scheduler: { enabled: config.scheduler.enabled, running: scheduler.running, lastTickAt: scheduler.lastTickAt, lastError: scheduler.lastError },
          aiProvider: config.ai.provider, businessActions: Boolean(businessActions?.enabled),
          pendingBusinessTasks: businessActions?.list({ status: 'pending', limit: 100 }).length || 0,
          internalJobs: store.read((state) => ({
            pending: Object.values(state.jobs || {}).filter((job) => job.status === 'pending').length,
            failed: Object.values(state.jobs || {}).filter((job) => job.status === 'failed').length
          })),
          actionSchemaUrl: `${config.appBaseUrl}/gpt-action/openapi.json`, customGptUrl: config.businessActions?.customGptUrl || '',
          books: store.read((state) => ({ total: Object.keys(state.books || {}).length, sessions: Object.keys(state.bookSessions || {}).length }))
        });
        if (pathname === '/api/admin/users' && req.method === 'GET') {
          const users = store.read((state) => Object.values(state.users)).map((user) => ({ ...user, accessUrl: learning.accessUrl(user), bindings: learning.bindingLinks(user) }));
          return json(res, 200, users);
        }
        if (pathname === '/api/admin/users' && req.method === 'POST') return json(res, 201, await learning.createUser(await bodyJson(req)));
        if (pathname === '/api/admin/plans' && req.method === 'GET') return json(res, 200, store.read((state) => Object.values(state.plans).sort((a, b) => b.createdAt.localeCompare(a.createdAt))));
        if (pathname === '/api/admin/lessons' && req.method === 'GET') return json(res, 200, store.read((state) => Object.values(state.lessons).sort((a, b) => b.createdAt.localeCompare(a.createdAt))));
        if (pathname === '/api/admin/books' && req.method === 'GET') return json(res, 200, store.read((state) => Object.values(state.books || {}).sort((a, b) => b.createdAt.localeCompare(a.createdAt))));
        if (pathname === '/api/admin/book-plans' && req.method === 'GET') return json(res, 200, store.read((state) => Object.values(state.bookPlans || {}).sort((a, b) => b.createdAt.localeCompare(a.createdAt))));
        if (pathname === '/api/admin/book-sessions' && req.method === 'GET') return json(res, 200, store.read((state) => Object.values(state.bookSessions || {}).sort((a, b) => b.createdAt.localeCompare(a.createdAt))));
        if (pathname === '/api/admin/jobs' && req.method === 'GET') return json(res, 200, store.read((state) => Object.values(state.jobs).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 300)));
        if (pathname === '/api/admin/business-tasks' && req.method === 'GET') return json(res, 200, businessActions ? businessActions.list({ status: url.searchParams.get('status') || 'all', limit: url.searchParams.get('limit') || 50 }) : []);
        if (pathname === '/api/admin/backups' && req.method === 'GET') return json(res, 200, await store.listBackups());
        if (pathname === '/api/admin/backups' && req.method === 'POST') return json(res, 201, { file: await store.backup('manual') });
        if (pathname === '/api/admin/whatsapp/pair' && req.method === 'POST') {
          const body = await bodyJson(req);
          return json(res, 200, { pairingCode: await whatsapp.requestPairingCode(body.phoneNumber) });
        }
        params = routeMatch(pathname, '/api/admin/users/:userId/plan');
        if (params && req.method === 'POST') {
          const plan = await learning.generateWeeklyPlan(params.userId);
          const user = store.read((state) => state.users[params.userId]);
          if (!plan.queued && user?.channels.telegram && telegram.enabled) await telegram.sendPlan(user, plan, learning.accessUrl(user)).catch((error) => logger.warn({ error: error.message }, 'Telegram plan notification failed'));
          if (!plan.queued && user?.channels.whatsapp && whatsapp.enabled) await whatsapp.sendPlan(user, plan, learning.accessUrl(user)).catch((error) => logger.warn({ error: error.message }, 'WhatsApp plan notification failed'));
          return json(res, 201, plan);
        }
        params = routeMatch(pathname, '/api/admin/users/:userId');
        if (params && req.method === 'DELETE') {
          if (!accounts) return json(res, 503, { error: 'Account deletion is unavailable' });
          requireSameOrigin(req, config);
          return json(res, 200, await accounts.deleteUser(params.userId, (await bodyJson(req)).confirmation, { actor: 'administrator' }));
        }
        params = routeMatch(pathname, '/api/admin/lessons/:lessonId/review');
        if (params && req.method === 'POST') {
          const body = await bodyJson(req);
          return json(res, 200, await learning.reviewLesson(params.lessonId, body.decision, body.note, { forceSchedule: body.decision === 'approve' }));
        }
        params = routeMatch(pathname, '/api/admin/lessons/:lessonId/schedule');
        if (params && req.method === 'POST') {
          const body = await bodyJson(req);
          return json(res, 200, await learning.scheduleLesson(params.lessonId, body.runAt || new Date().toISOString()));
        }
        params = routeMatch(pathname, '/api/admin/plans/:planId/generate/:proposalId');
        if (params && req.method === 'POST') {
          const body = await bodyJson(req);
          const plan = store.read((state) => state.plans[params.planId]);
          if (!plan) return json(res, 404, { error: 'Plan not found' });
          return json(res, 201, await learning.generateLesson(plan.userId, plan.id, params.proposalId, body.sourceUrls || []));
        }
        params = routeMatch(pathname, '/api/admin/books/:bookId/analyze');
        if (params && req.method === 'POST') {
          const book = store.read((state) => state.books?.[params.bookId]);
          if (!book || !books) return json(res, 404, { error: 'Book not found' });
          return json(res, 201, await books.queueAnalysis(book.userId, book.id));
        }
        params = routeMatch(pathname, '/api/admin/books/:bookId/generate/:sessionNumber');
        if (params && req.method === 'POST') {
          const book = store.read((state) => state.books?.[params.bookId]);
          if (!book || !books) return json(res, 404, { error: 'Book not found' });
          return json(res, 201, await books.generateSession(book.userId, book.id, Number(params.sessionNumber)));
        }
        params = routeMatch(pathname, '/api/admin/book-sessions/:sessionId/review');
        if (params && req.method === 'POST') {
          const body = await bodyJson(req);
          return json(res, 200, await books.reviewSession(params.sessionId, body.decision, body.note, { forceSchedule: body.decision === 'approve' }));
        }
        params = routeMatch(pathname, '/api/admin/book-sessions/:sessionId/schedule');
        if (params && req.method === 'POST') {
          const body = await bodyJson(req);
          return json(res, 200, await books.scheduleSession(params.sessionId, body.runAt || new Date().toISOString()));
        }
        return json(res, 404, { error: 'Admin endpoint not found' });
      }

      if (pathname.startsWith('/api/')) {
        const user = currentUser(req);
        if (!user) return json(res, 401, { error: 'Private user access required' });
        if (pathname === '/api/account' && req.method === 'DELETE') {
          if (!accounts) return json(res, 503, { error: 'Account deletion is unavailable' });
          requireSameOrigin(req, config);
          const result = await accounts.deleteUser(user.id, (await bodyJson(req)).confirmation, { actor: 'learner' });
          return jsonWithCookie(res, 200, result, cookie('kp_user', '', { secure: config.nodeEnv === 'production', maxAge: 0 }));
        }
        if (pathname === '/api/me' && req.method === 'GET') {
          const workflow = store.read((state) => {
            const lessons = Object.values(state.lessons || {}).filter((item) => item.userId === user.id);
            const sessions = Object.values(state.bookSessions || {}).filter((item) => item.userId === user.id);
            const jobs = Object.values(state.jobs || {}).filter((job) => job.userId === user.id);
            const nextJob = jobs.filter((job) => job.status === 'pending' && ['deliver_lesson', 'deliver_book_session', 'generate_lesson', 'generate_book_session'].includes(job.type)).sort((a, b) => a.runAt.localeCompare(b.runAt))[0] || null;
            return {
              needsReview: lessons.filter((item) => ['needs_review', 'needs_changes'].includes(item.reviewStatus)).length + sessions.filter((item) => ['needs_review', 'needs_changes'].includes(item.reviewStatus)).length,
              scheduledDeliveries: jobs.filter((job) => job.status === 'pending' && ['deliver_lesson', 'deliver_book_session'].includes(job.type)).length,
              futureGenerationJobs: jobs.filter((job) => job.status === 'pending' && ['generate_lesson', 'generate_book_session', 'generate_book_finale'].includes(job.type)).length,
              failedJobs: jobs.filter((job) => job.status === 'failed').length,
              nextJob: nextJob ? { type: nextJob.type, runAt: nextJob.runAt } : null
            };
          });
          return json(res, 200, { ...user, accessUrl: learning.accessUrl(user), bindings: learning.bindingLinks(user), telegramBotUsername: telegram.botUsername, whatsappStatus: whatsapp.status, aiProvider: config.ai.provider, pendingBusinessTasks: businessActions?.list({ status: 'pending', limit: 100 }).filter((task) => task.userId === user.id).length || 0, workflow, customGptUrl: config.businessActions?.customGptUrl || '', bookProgress: books ? books.progress(user.id) : null });
        }
        if (pathname === '/api/onboarding' && req.method === 'POST') return json(res, 200, await learning.updateOnboarding(user.id, await bodyJson(req)));
        if (pathname === '/api/plans' && req.method === 'GET') return json(res, 200, store.read((state) => Object.values(state.plans).filter((p) => p.userId === user.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt))));
        if (pathname === '/api/plans/generate' && req.method === 'POST') {
          const plan = await learning.generateWeeklyPlan(user.id);
          if (!plan.queued && user.channels.telegram && telegram.enabled) await telegram.sendPlan(user, plan, learning.accessUrl(user)).catch((error) => logger.warn({ error: error.message }, 'Telegram plan notification failed'));
          if (!plan.queued && user.channels.whatsapp && whatsapp.enabled) await whatsapp.sendPlan(user, plan, learning.accessUrl(user)).catch((error) => logger.warn({ error: error.message }, 'WhatsApp plan notification failed'));
          return json(res, 201, plan);
        }
        params = routeMatch(pathname, '/api/plans/:planId/approve');
        if (params && req.method === 'POST') return json(res, 200, await learning.approvePlan(user.id, params.planId));
        if (pathname === '/api/lessons' && req.method === 'GET') return json(res, 200, store.read((state) => Object.values(state.lessons || {}).filter((lesson) => lesson.userId === user.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt))));
        params = routeMatch(pathname, '/api/lessons/:lessonId');
        if (params && req.method === 'GET') {
          const lesson = store.read((state) => state.lessons[params.lessonId]);
          if (!lesson || lesson.userId !== user.id) return json(res, 404, { error: 'Lesson not found' });
          return json(res, 200, lesson);
        }
        params = routeMatch(pathname, '/api/lessons/:lessonId/review');
        if (params && req.method === 'POST') {
          const body = await bodyJson(req);
          return json(res, 200, await learning.reviewLesson(params.lessonId, body.decision, body.note, { userId: user.id, forceSchedule: body.decision === 'approve' }));
        }
        params = routeMatch(pathname, '/api/lessons/:lessonId/revise');
        if (params && req.method === 'POST') return json(res, 202, await learning.requestLessonRevision(user.id, params.lessonId, (await bodyJson(req)).note));
        params = routeMatch(pathname, '/api/lessons/:lessonId/schedule');
        if (params && req.method === 'POST') {
          const lesson = store.read((state) => state.lessons?.[params.lessonId]);
          if (!lesson || lesson.userId !== user.id) return json(res, 404, { error: 'Lesson not found' });
          return json(res, 200, await learning.scheduleLesson(params.lessonId, (await bodyJson(req)).runAt || new Date().toISOString()));
        }
        params = routeMatch(pathname, '/api/lessons/:lessonId/skip');
        if (params && req.method === 'POST') return json(res, 200, await learning.skipLesson(user.id, params.lessonId));

        params = routeMatch(pathname, '/api/lessons/:lessonId/complete');
        if (params && req.method === 'POST') return json(res, 200, await learning.completeLesson(user.id, params.lessonId));
        params = routeMatch(pathname, '/api/lessons/:lessonId/resume');
        if (params && req.method === 'POST') return json(res, 200, await learning.updateResume(user.id, params.lessonId, (await bodyJson(req)).percent));
        params = routeMatch(pathname, '/api/lessons/:lessonId/experience');
        if (params && req.method === 'POST') return json(res, 200, await learning.updateLessonExperience(user.id, params.lessonId, await bodyJson(req)));
        params = routeMatch(pathname, '/api/lessons/:lessonId/feedback');
        if (params && req.method === 'POST') return json(res, 200, await learning.submitFeedback(user.id, params.lessonId, await bodyJson(req)));
        params = routeMatch(pathname, '/api/lessons/:lessonId/follow-up');
        if (params && req.method === 'POST') return json(res, 200, await learning.answerFollowUp(user.id, params.lessonId, (await bodyJson(req)).question));

        if (pathname === '/api/books' && req.method === 'GET') return json(res, 200, books ? books.list(user.id) : []);
        if (pathname === '/api/books' && req.method === 'POST') {
          if (!books) return json(res, 404, { error: 'Book learning is disabled' });
          return json(res, 201, await books.addBook(user.id, await bodyJson(req)));
        }
        if (pathname === '/api/book-progress' && req.method === 'GET') return json(res, 200, books ? books.progress(user.id) : { totalBooks: 0, activeBooks: 0, completedBooks: 0, completedSessions: 0, books: [] });
        params = routeMatch(pathname, '/api/books/:bookId');
        if (params && req.method === 'GET') return json(res, 200, books.detail(user.id, params.bookId));
        params = routeMatch(pathname, '/api/books/:bookId/analyze');
        if (params && req.method === 'POST') return json(res, 201, await books.queueAnalysis(user.id, params.bookId));
        params = routeMatch(pathname, '/api/books/:bookId/upload-owned-copy');
        if (params && req.method === 'POST') {
          const filename = url.searchParams.get('filename') || req.headers['x-file-name'] || 'book-source.pdf';
          const buffer = await bodyBuffer(req);
          return json(res, 201, await books.uploadOwnedCopy(user.id, params.bookId, filename, buffer));
        }
        params = routeMatch(pathname, '/api/books/:bookId/plan/approve');
        if (params && req.method === 'POST') return json(res, 200, await books.approvePlan(user.id, params.bookId, await bodyJson(req)));
        params = routeMatch(pathname, '/api/books/:bookId/control');
        if (params && req.method === 'POST') return json(res, 200, await books.control(user.id, params.bookId, (await bodyJson(req)).action));
        params = routeMatch(pathname, '/api/books/:bookId/notes');
        if (params && req.method === 'POST') return json(res, 201, await books.addNote(user.id, params.bookId, await bodyJson(req)));
        params = routeMatch(pathname, '/api/books/:bookId/bookmarks');
        if (params && req.method === 'POST') return json(res, 201, await books.addBookmark(user.id, params.bookId, await bodyJson(req)));
        params = routeMatch(pathname, '/api/books/:bookId/topic-links/:linkId');
        if (params && req.method === 'POST') return json(res, 200, await books.reviewTopicLink(user.id, params.bookId, params.linkId, (await bodyJson(req)).decision));
        params = routeMatch(pathname, '/api/books/:bookId/next');
        if (params && req.method === 'POST') {
          const detail = books.detail(user.id, params.bookId);
          const generated = new Set(detail.sessions.map((session) => session.sessionNumber));
          const next = detail.plan?.sessions?.find((item) => item.isCore !== false && !generated.has(item.number));
          if (!next) return json(res, 409, { error: 'No ungenerated core book session remains' });
          return json(res, 201, await books.generateSession(user.id, params.bookId, next.number));
        }
        if (pathname === '/api/book-sessions' && req.method === 'GET') return json(res, 200, store.read((state) => Object.values(state.bookSessions || {}).filter((session) => session.userId === user.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt))));
        params = routeMatch(pathname, '/api/book-sessions/:sessionId');
        if (params && req.method === 'GET') {
          const session = store.read((state) => state.bookSessions?.[params.sessionId]);
          if (!session || session.userId !== user.id) return json(res, 404, { error: 'Book session not found' });
          const book = store.read((state) => state.books?.[session.bookId]);
          return json(res, 200, { session, book });
        }
        params = routeMatch(pathname, '/api/book-sessions/:sessionId/review');
        if (params && req.method === 'POST') {
          const body = await bodyJson(req);
          return json(res, 200, await books.reviewSession(params.sessionId, body.decision, body.note, { userId: user.id, forceSchedule: body.decision === 'approve' }));
        }
        params = routeMatch(pathname, '/api/book-sessions/:sessionId/revise');
        if (params && req.method === 'POST') return json(res, 202, await books.requestSessionRevision(user.id, params.sessionId, (await bodyJson(req)).note));
        params = routeMatch(pathname, '/api/book-sessions/:sessionId/schedule');
        if (params && req.method === 'POST') {
          const session = store.read((state) => state.bookSessions?.[params.sessionId]);
          if (!session || session.userId !== user.id) return json(res, 404, { error: 'Book session not found' });
          return json(res, 200, await books.scheduleSession(params.sessionId, (await bodyJson(req)).runAt || new Date().toISOString()));
        }

        params = routeMatch(pathname, '/api/book-sessions/:sessionId/complete');
        if (params && req.method === 'POST') return json(res, 200, await books.completeSession(user.id, params.sessionId));
        params = routeMatch(pathname, '/api/book-sessions/:sessionId/resume');
        if (params && req.method === 'POST') return json(res, 200, await books.updateResume(user.id, params.sessionId, (await bodyJson(req)).percent));
        params = routeMatch(pathname, '/api/book-sessions/:sessionId/feedback');
        if (params && req.method === 'POST') return json(res, 200, await books.submitSessionFeedback(user.id, params.sessionId, await bodyJson(req)));
        params = routeMatch(pathname, '/api/book-sessions/:sessionId/follow-up');
        if (params && req.method === 'POST') return json(res, 200, await books.answerFollowUp(user.id, params.sessionId, (await bodyJson(req)).question));
        params = routeMatch(pathname, '/api/book-sessions/:sessionId/skip');
        if (params && req.method === 'POST') return json(res, 200, await books.skipSession(user.id, params.sessionId));

        if (pathname === '/api/notices' && req.method === 'GET') return json(res, 200, store.read((state) => {
          const delivered = Object.values(state.messages || {})
            .filter((message) => message.userId === user.id && (message.kind === 'system_notice' || message.notice))
            .map((message) => ({ ...message, deliveryState: 'sent' }));
          const pending = Object.values(state.jobs || {})
            .filter((job) => job.userId === user.id && job.type === 'send_system_notice' && ['pending', 'running'].includes(job.status))
            .map((job) => ({
              id: `notice_${job.id}`,
              userId: job.userId,
              kind: job.payload?.kind || 'system_notice',
              notice: job.payload || {},
              results: { web: { status: 'available' } },
              deliveryState: job.status,
              createdAt: job.createdAt,
              updatedAt: job.updatedAt
            }));
          const byKey = new Map();
          for (const notice of [...delivered, ...pending]) {
            const key = notice.notice?.dedupeKey || notice.id;
            const existing = byKey.get(key);
            if (!existing || String(notice.createdAt || '') > String(existing.createdAt || '')) byKey.set(key, notice);
          }
          return [...byKey.values()].sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''))).slice(0, 50);
        }));
        if (pathname === '/api/progress' && req.method === 'GET') return json(res, 200, { ...learning.progress(user.id), books: books ? books.progress(user.id) : null });
        return json(res, 404, { error: 'Endpoint not found' });
      }

      send(res, 404, 'Not found');
    } catch (error) {
      logger.error({ method: req.method, url: req.url, error: error.stack || error.message, durationMs: Date.now() - started }, 'Request failed');
      const status = statusForError(error);
      json(res, status, {
        error: error.message || 'Internal server error',
        ...(error.code ? { code: error.code } : {}),
        ...(error.retryable !== undefined ? { retryable: Boolean(error.retryable) } : {}),
        ...(Array.isArray(error.details) ? { details: error.details } : {}),
        ...(error.diagnostics && typeof error.diagnostics === 'object' ? { diagnostics: error.diagnostics } : {}),
        ...(error.expectedOperation ? { expectedOperation: error.expectedOperation } : {})
      });
    }
  });

  function jsonWithCookie(res, status, data, setCookie) {
    send(res, status, JSON.stringify(data), { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'set-cookie': setCookie });
  }

  return server;
}
