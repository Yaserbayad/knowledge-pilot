import test from 'node:test';
import assert from 'node:assert/strict';
import { createUserToken } from '../src/auth.js';
import { createServer } from '../src/server.js';

function fixture(logger = { debug() {}, info() {}, warn() {}, error() {} }) {
  const config = {
    version: '1.4.1',
    nodeEnv: 'production',
    appBaseUrl: 'https://placeholder.invalid',
    appSecret: 'server-hardening-secret-server-hardening',
    adminToken: 'server-hardening-admin-token',
    cardDir: '/tmp/knowledge-pilot-unused-cards',
    scheduler: { enabled: true },
    telegram: { webhookSecret: '' },
    ai: { provider: 'mock' },
    research: { searxngUrl: '', maxResults: 6, fetchTimeoutMs: 1000 },
    businessActions: { customGptUrl: '' }
  };
  const store = { read(selector) { return selector({ users: {}, lessons: {}, bookSessions: {}, jobs: {}, books: {} }); } };
  const learning = {
    async createUser() { throw new Error('internal create-user failure with sensitive detail'); }
  };
  const telegram = { enabled: false, botUsername: null };
  const whatsapp = { enabled: false, status: 'disabled' };
  const scheduler = { running: true, lastTickAt: 'private-internal-tick', lastError: 'private-internal-error' };
  const server = createServer({ config, store, learning, telegram, whatsapp, scheduler, logger });
  return { config, server };
}

async function start(t, logger) {
  const built = fixture(logger);
  await new Promise((resolve) => built.server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => built.server.close(resolve)));
  const base = `http://127.0.0.1:${built.server.address().port}`;
  built.config.appBaseUrl = base;
  return { ...built, base };
}

function adminCookie(config) {
  return `kp_admin=${createUserToken(config.appSecret, 'admin', 1)}`;
}

test('public health is minimal while still exposing release identity', async (t) => {
  const { base } = await start(t);
  const response = await fetch(`${base}/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, version: '1.4.1' });
});

test('responses include baseline security headers and production HSTS', async (t) => {
  const { base } = await start(t);
  const response = await fetch(`${base}/health`);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  assert.match(response.headers.get('permissions-policy') || '', /camera=\(\)/);
  assert.match(response.headers.get('strict-transport-security') || '', /max-age=/);
});

test('JSON request limit is enforced by UTF-8 bytes', async (t) => {
  const { base } = await start(t);
  const oversized = JSON.stringify({ token: '😀'.repeat(550_000) });
  assert.ok(Buffer.byteLength(oversized) > 2_000_000);
  assert.ok(oversized.length < 2_000_000);
  const response = await fetch(`${base}/api/admin/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: oversized
  });
  assert.equal(response.status, 413);
});

test('authenticated browser mutations reject cross-origin and cross-site requests', async (t) => {
  const { base, config } = await start(t);
  const cookie = adminCookie(config);

  const originAttack = await fetch(`${base}/api/admin/logout`, {
    method: 'POST',
    headers: { cookie, origin: 'https://attacker.example' }
  });
  assert.equal(originAttack.status, 403);

  const fetchMetadataAttack = await fetch(`${base}/api/admin/logout`, {
    method: 'POST',
    headers: { cookie, 'sec-fetch-site': 'cross-site' }
  });
  assert.equal(fetchMetadataAttack.status, 403);

  const sameOrigin = await fetch(`${base}/api/admin/logout`, {
    method: 'POST',
    headers: { cookie, origin: base, 'sec-fetch-site': 'same-origin' }
  });
  assert.equal(sameOrigin.status, 200);
});

test('request errors use a correlation id, omit raw query data from logs, and hide internal 500 details', async (t) => {
  const errors = [];
  const logger = { debug() {}, info() {}, warn() {}, error(data, message) { errors.push({ data, message }); } };
  const { base, config } = await start(t, logger);

  const malformed = await fetch(`${base}/api/admin/login?private_token=must-not-appear`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-request-id': 'audit-request-1' },
    body: '{broken'
  });
  assert.equal(malformed.status, 400);
  assert.equal(malformed.headers.get('x-request-id'), 'audit-request-1');
  assert.equal(errors[0].data.requestId, 'audit-request-1');
  assert.equal(errors[0].data.path, '/api/admin/login');
  assert.equal('url' in errors[0].data, false);
  assert.doesNotMatch(JSON.stringify(errors[0].data), /must-not-appear/);

  const internal = await fetch(`${base}/api/admin/users`, {
    method: 'POST',
    headers: {
      cookie: adminCookie(config),
      origin: base,
      'sec-fetch-site': 'same-origin',
      'content-type': 'application/json'
    },
    body: JSON.stringify({ name: 'Tester' })
  });
  assert.equal(internal.status, 500);
  assert.deepEqual(await internal.json(), { error: 'Internal server error' });
});
