import assert from 'node:assert/strict';
import test from 'node:test';
import { loadConfig } from '../src/config.mjs';
import { KnowledgePilotClient } from '../src/knowledge-pilot-client.mjs';

const KEYS = [
  'MCP_HOST', 'MCP_BEARER_TOKEN', 'KP_BASE_URL', 'KP_ACTION_API_KEY',
  'WORKSPACE_AGENT_TRIGGER_ID', 'WORKSPACE_AGENT_ACCESS_TOKEN', 'WORKSPACE_AGENT_API_BASE'
];

function withEnv(values, callback) {
  const before = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
  for (const key of KEYS) delete process.env[key];
  Object.assign(process.env, values);
  try { return callback(); }
  finally {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

const baseSecrets = {
  MCP_BEARER_TOKEN: 'm'.repeat(64),
  KP_ACTION_API_KEY: 'k'.repeat(48),
  WORKSPACE_AGENT_TRIGGER_ID: 'agtch_example',
  WORKSPACE_AGENT_ACCESS_TOKEN: 'w'.repeat(48)
};

test('MCP bridge rejects non-loopback bind addresses', () => withEnv({
  ...baseSecrets,
  MCP_HOST: '0.0.0.0'
}, () => {
  assert.throws(() => loadConfig({ requireMcp: true }), /MCP_HOST.*loopback/i);
}));

test('credential-bearing remote endpoints require HTTPS', () => withEnv({
  ...baseSecrets,
  KP_BASE_URL: 'http://knowledge.example.test',
  WORKSPACE_AGENT_API_BASE: 'http://agent.example.test/v1'
}, () => {
  assert.throws(() => loadConfig({ requireTrigger: true }), /HTTPS/i);
}));

test('loopback HTTP remains allowed for the local Knowledge Pilot connection', () => withEnv({
  ...baseSecrets,
  MCP_HOST: '127.0.0.1',
  KP_BASE_URL: 'http://127.0.0.1:3100',
  WORKSPACE_AGENT_API_BASE: 'https://api.chatgpt.com/v1'
}, () => {
  const config = loadConfig({ requireMcp: true, requireTrigger: true });
  assert.equal(config.knowledgePilot.baseUrl, 'http://127.0.0.1:3100');
}));

test('bridge endpoint URLs reject embedded credentials', () => withEnv({
  ...baseSecrets,
  KP_BASE_URL: 'https://user:password@knowledge.example.test'
}, () => {
  assert.throws(() => loadConfig(), /embedded credentials/i);
}));

test('Knowledge Pilot client cancels an oversized response stream before full buffering', async () => {
  let cancelled = false;
  const client = new KnowledgePilotClient(
    { baseUrl: 'http://127.0.0.1:3100', apiKey: 'secret', timeoutMs: 1000 },
    async () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(3 * 1024 * 1024));
        controller.enqueue(new Uint8Array(2 * 1024 * 1024));
      },
      cancel() { cancelled = true; }
    }), { status: 200 })
  );

  await assert.rejects(client.health(), /safe size limit/i);
  assert.equal(cancelled, true);
});
