import assert from 'node:assert/strict';
import test from 'node:test';
import { loadConfig, publicConfig } from '../src/config.mjs';

const KEYS = [
  'MCP_BEARER_TOKEN',
  'KP_ACTION_API_KEY',
  'WORKSPACE_AGENT_TRIGGER_ID',
  'WORKSPACE_AGENT_ACCESS_TOKEN'
];

function withEnv(values, callback) {
  const before = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
  Object.assign(process.env, values);
  try {
    return callback();
  } finally {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('public config never returns secrets', () => withEnv({
  MCP_BEARER_TOKEN: 'm'.repeat(64),
  KP_ACTION_API_KEY: 'knowledge-secret',
  WORKSPACE_AGENT_TRIGGER_ID: 'agtch_example',
  WORKSPACE_AGENT_ACCESS_TOKEN: 'workspace-secret-token'
}, () => {
  const result = JSON.stringify(publicConfig(loadConfig({ requireMcp: true, requireTrigger: true })));
  assert.doesNotMatch(result, /knowledge-secret|workspace-secret|mmmmmmmm/);
}));

test('trigger validation rejects missing trigger credentials', () => withEnv({
  MCP_BEARER_TOKEN: 'm'.repeat(64),
  KP_ACTION_API_KEY: 'knowledge-secret',
  WORKSPACE_AGENT_TRIGGER_ID: '',
  WORKSPACE_AGENT_ACCESS_TOKEN: ''
}, () => {
  assert.throws(() => loadConfig({ requireTrigger: true }), /TRIGGER_ID/);
}));
