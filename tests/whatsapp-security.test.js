import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createBindingToken, verifyBindingToken } from '../src/auth.js';
import { JsonStore } from '../src/store.js';
import { AiService } from '../src/services/ai.js';
import { LearningService } from '../src/services/learning.js';
import { WhatsAppChannel } from '../src/channels/whatsapp.js';

const logger = { debug() {}, info() {}, warn() {}, error() {} };

async function waitFor(predicate, timeoutMs = 1000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for WhatsApp test event');
}

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'knowledge-pilot-whatsapp-security-'));
  const appSecret = 'whatsapp-security-secret-whatsapp-security-secret';
  const store = await new JsonStore({ stateFile: path.join(root, 'state.json'), backupDir: path.join(root, 'backups'), retention: 2, logger }).init();
  const learningConfig = {
    appBaseUrl: 'https://learn.example.com', appSecret,
    defaultLanguage: 'en', defaultTimezone: 'Europe/Brussels',
    cardDir: path.join(root, 'cards'), ai: { provider: 'mock' },
    research: { searxngUrl: '', maxResults: 3, fetchTimeoutMs: 1000 },
    whatsapp: { dedicatedNumber: '+32000000000' }
  };
  const learning = new LearningService({
    store,
    ai: new AiService(learningConfig.ai, logger),
    research: { async gather() { return []; } },
    config: learningConfig,
    logger
  });
  const channel = new WhatsAppChannel({
    config: { enabled: true, appSecret, authDir: path.join(root, 'wa-auth'), minSendIntervalMs: 0, dedicatedNumber: '+32000000000' },
    store, learning, logger
  });
  const handlers = new Map();
  const sent = [];
  const sock = {
    ev: { on(name, fn) { handlers.set(name, fn); } },
    async sendMessage(jid, payload) { sent.push({ jid, ...payload }); return { key: { id: `sent_${sent.length}` } }; },
    async requestPairingCode() { return 'pair'; }
  };
  channel.baileys = {
    default: () => sock,
    useMultiFileAuthState: async () => ({ state: {}, saveCreds() {} }),
    Browsers: { ubuntu: () => ['Knowledge Pilot'] },
    fetchLatestBaileysVersion: async () => ({ version: [2, 3000, 0] })
  };
  await channel.connect();
  handlers.get('connection.update')?.({ connection: 'open' });

  async function inbound(jid, text) {
    const before = sent.length;
    handlers.get('messages.upsert')?.({
      type: 'notify',
      messages: [{ key: { fromMe: false, remoteJid: jid }, message: { conversation: text } }]
    });
    return waitFor(() => sent.length > before ? sent.at(-1) : null);
  }

  return { appSecret, store, learning, channel, sent, inbound };
}

test('learner settings expose a signed expiring WhatsApp binding token', async () => {
  const { appSecret, learning } = await fixture();
  const { user } = await learning.createUser({ name: 'WhatsApp Learner' });
  const bindings = learning.bindingLinks(user);
  assert.match(bindings.whatsappCode, /^[A-Za-z0-9_-]+$/);
  assert.ok(bindings.whatsappCode.length > 12);
  const verified = verifyBindingToken(appSecret, bindings.whatsappCode, 'whatsapp');
  assert.equal(verified.userId, user.id);
  assert.equal(verified.channel, 'whatsapp');
  assert.ok(verified.expiresAt > Date.now());
});

test('valid WhatsApp token links atomically and displaces any prior owner of the incoming JID', async () => {
  const { store, learning, inbound } = await fixture();
  const { user: target } = await learning.createUser({ name: 'Target' });
  const { user: prior } = await learning.createUser({ name: 'Prior' });
  const incomingJid = '32470000000@s.whatsapp.net';
  await store.transaction((state) => {
    state.users[prior.id].whatsappJid = incomingJid;
    state.users[prior.id].channels.whatsapp = true;
  });

  const token = learning.bindingLinks(target).whatsappCode;
  const reply = await inbound(incomingJid, `LINK ${token}`);
  assert.match(reply.text, /linked/i);
  const state = store.snapshot();
  assert.equal(state.users[target.id].whatsappJid, incomingJid);
  assert.equal(state.users[target.id].channels.whatsapp, true);
  assert.equal(state.users[prior.id].whatsappJid, null);
  assert.equal(state.users[prior.id].channels.whatsapp, false);
  assert.equal(Object.values(state.users).filter((user) => user.whatsappJid === incomingJid).length, 1);
});

test('tampered, wrong-channel, and expired binding tokens are rejected without changing ownership', async () => {
  const { appSecret, store, learning, inbound } = await fixture();
  const { user } = await learning.createUser({ name: 'Protected' });
  const jid = '32471111111@s.whatsapp.net';
  const valid = learning.bindingLinks(user).whatsappCode;
  const badTokens = [
    `${valid.slice(0, -1)}${valid.endsWith('A') ? 'B' : 'A'}`,
    createBindingToken(appSecret, user.id, 'telegram', Date.now() + 60_000),
    createBindingToken(appSecret, user.id, 'whatsapp', Date.now() - 1_000)
  ];

  for (const token of badTokens) {
    const reply = await inbound(jid, `LINK ${token}`);
    assert.match(reply.text, /invalid|expired/i);
    assert.equal(store.snapshot().users[user.id].whatsappJid, null);
  }
});
