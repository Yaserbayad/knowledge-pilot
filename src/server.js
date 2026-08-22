import { randomUUID } from 'node:crypto';
import { parseCookies, verifyUserToken } from './auth.js';
import { createServer as createCoreServer } from './server-core.js';

// Compatibility marker: the unchanged HTTP core continues to own /api/lessons/:lessonId/experience.
const BOOK_EXPERIENCE_ROUTE = /^\/api\/book-sessions\/([^/]+)\/experience$/;
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: https:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "frame-src 'none'",
  "form-action 'self'",
  "manifest-src 'self'",
  "worker-src 'self'"
].join('; ');

function requestIdFor(req) {
  const supplied = String(req.headers['x-request-id'] || '');
  return /^[A-Za-z0-9._:-]{1,128}$/.test(supplied) ? supplied : randomUUID();
}

function applySecurityHeaders(res, config) {
  res.setHeader('content-security-policy', CSP);
  res.setHeader('referrer-policy', 'no-referrer');
  res.setHeader('x-frame-options', 'DENY');
  res.setHeader('permissions-policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  if (config.nodeEnv === 'production') res.setHeader('strict-transport-security', 'max-age=31536000');
}

function json(res, status, data) {
  const payload = Buffer.from(JSON.stringify(data));
  res.writeHead(status, {
    'content-length': payload.length,
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  });
  res.end(payload);
}

function httpError(message, statusCode, code = '') {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (code) error.code = code;
  return error;
}

function requireSameOrigin(req, config) {
  const fetchSite = String(req.headers['sec-fetch-site'] || '').toLowerCase();
  if (fetchSite === 'cross-site') throw httpError('Cross-site browser request is forbidden', 403, 'CROSS_SITE_REQUEST');
  const origin = String(req.headers.origin || '');
  if (!origin) return;
  if (origin !== new URL(config.appBaseUrl).origin) throw httpError('Cross-origin browser request is forbidden', 403, 'CROSS_ORIGIN_REQUEST');
}

function bodyJson(req, maxBytes = 2_000_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > maxBytes) tooLarge = true;

    const cleanup = () => {
      req.off('data', onData);
      req.off('end', onEnd);
      req.off('aborted', onAborted);
      req.off('error', onError);
    };
    const onData = (chunk) => {
      size += chunk.length;
      if (size > maxBytes) tooLarge = true;
      if (!tooLarge) chunks.push(chunk);
    };
    const onEnd = () => {
      cleanup();
      if (tooLarge) return reject(httpError('Request body too large', 413, 'PAYLOAD_TOO_LARGE'));
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(httpError('Invalid JSON', 400, 'INVALID_JSON'));
      }
    };
    const onAborted = () => {
      cleanup();
      reject(httpError('Request body aborted', 400, 'REQUEST_ABORTED'));
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    req.on('data', onData);
    req.on('end', onEnd);
    req.on('aborted', onAborted);
    req.on('error', onError);
  });
}

function statusForError(error) {
  if (Number(error?.statusCode)) return Number(error.statusCode);
  const message = String(error?.message || '').toLowerCase();
  if (message.includes('not found')) return 404;
  if (message.includes('not available for')) return 409;
  if (message.startsWith('invalid ') || message.endsWith(' is required')) return 400;
  return 500;
}

function currentUser(req, config, store) {
  const token = parseCookies(req.headers.cookie).kp_user;
  const parsed = verifyUserToken(config.appSecret, token);
  if (!parsed) return null;
  const user = store.read((state) => state.users?.[parsed.userId]);
  if (!user || user.accessVersion !== parsed.accessVersion) return null;
  return user;
}

export function createServer(args) {
  const { config, store, books = null, logger } = args;
  const server = createCoreServer(args);
  const coreListeners = server.listeners('request');
  if (coreListeners.length !== 1) throw new Error('Unexpected HTTP request-listener topology');
  const coreHandler = coreListeners[0];
  server.removeListener('request', coreHandler);

  server.on('request', async (req, res) => {
    const started = Date.now();
    const requestId = requestIdFor(req);
    let pathname = '/';
    try {
      const url = new URL(req.url, config.appBaseUrl);
      pathname = url.pathname;
      const route = pathname.match(BOOK_EXPERIENCE_ROUTE);
      if (!route || req.method !== 'POST') return coreHandler.call(server, req, res);

      applySecurityHeaders(res, config);
      res.setHeader('x-request-id', requestId);
      const user = currentUser(req, config, store);
      if (!user) return json(res, 401, { error: 'Private user access required' });
      requireSameOrigin(req, config);
      if (!books?.updateSessionExperience) return json(res, 503, { error: 'Book learning is unavailable' });

      let sessionId;
      try {
        sessionId = decodeURIComponent(route[1]);
      } catch {
        throw httpError('Invalid route encoding', 400, 'INVALID_ROUTE_ENCODING');
      }
      return json(res, 200, await books.updateSessionExperience(user.id, sessionId, await bodyJson(req)));
    } catch (error) {
      const status = statusForError(error);
      logger?.error?.({
        method: req.method,
        path: pathname,
        requestId,
        status,
        error: error.stack || error.message,
        durationMs: Date.now() - started
      }, 'Request failed');
      if (status >= 500) return json(res, status, { error: 'Internal server error' });
      return json(res, status, {
        error: error.message || 'Request failed',
        ...(error.code ? { code: error.code } : {})
      });
    }
  });

  return server;
}
