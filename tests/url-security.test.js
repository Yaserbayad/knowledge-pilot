import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const root = new URL('..', import.meta.url).pathname;

function load(overrides) {
  return spawnSync(process.execPath, ['--input-type=module', '-e', "import('./src/config.js')"], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_ENV: 'production',
      APP_BASE_URL: 'https://learn.example.test',
      APP_SECRET: 'a'.repeat(32),
      ADMIN_TOKEN: 'b'.repeat(32),
      GPT_ACTION_API_KEY: 'c'.repeat(32),
      DEFAULT_TIMEZONE: 'Europe/Brussels',
      DEFAULT_LANGUAGE: 'en',
      AI_PROVIDER: 'openai_compatible',
      AI_API_KEY: 'provider-secret',
      TELEGRAM_ENABLED: 'false',
      WHATSAPP_ENABLED: 'false',
      ...overrides
    }
  });
}

test('loopback exceptions do not trust remote hostnames that merely start with 127', () => {
  const result = load({ AI_BASE_URL: 'http://127.attacker.example/v1' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /AI_BASE_URL.*HTTPS/i);
});
