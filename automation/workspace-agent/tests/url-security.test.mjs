import assert from 'node:assert/strict';
import test from 'node:test';
import { loadConfig } from '../src/config.mjs';

function withEnv(values, callback) {
  const keys = ['MCP_HOST', 'MCP_BEARER_TOKEN', 'KP_BASE_URL', 'KP_ACTION_API_KEY', 'WORKSPACE_AGENT_TRIGGER_ID', 'WORKSPACE_AGENT_ACCESS_TOKEN', 'WORKSPACE_AGENT_API_BASE'];
  const before = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  for (const key of keys) delete process.env[key];
  Object.assign(process.env, values);
  try { return callback(); }
  finally {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('bridge does not treat a remote hostname beginning with 127 as loopback', () => withEnv({
  KP_ACTION_API_KEY: 'k'.repeat(48),
  KP_BASE_URL: 'http://127.attacker.example:3100'
}, () => {
  assert.throws(() => loadConfig(), /KP_BASE_URL.*HTTPS/i);
}));
