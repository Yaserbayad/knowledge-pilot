import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const root = new URL('..', import.meta.url).pathname;

function productionEnv(overrides = {}) {
  return {
    ...process.env,
    NODE_ENV: 'production',
    APP_BASE_URL: 'https://learn.example.test',
    APP_SECRET: 'a'.repeat(32),
    ADMIN_TOKEN: 'b'.repeat(32),
    GPT_ACTION_API_KEY: 'c'.repeat(32),
    DEFAULT_TIMEZONE: 'Europe/Brussels',
    DEFAULT_LANGUAGE: 'en',
    AI_PROVIDER: 'chatgpt_business',
    GPT_ACTIONS_ENABLED: 'true',
    TELEGRAM_ENABLED: 'false',
    WHATSAPP_ENABLED: 'false',
    ...overrides
  };
}

function importConfig(overrides = {}) {
  return spawnSync(process.execPath, [
    '--input-type=module',
    '-e',
    "import('./src/config.js').then(() => process.stdout.write('ok')).catch((error) => { console.error(error.message); process.exit(1); })"
  ], {
    cwd: root,
    env: productionEnv(overrides),
    encoding: 'utf8'
  });
}

test('production startup rejects weak application secrets', () => {
  const result = importConfig({ APP_SECRET: 'short-secret' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /APP_SECRET.*at least 32/i);
});

test('production startup rejects unsupported timezone and language settings', () => {
  const timezone = importConfig({ DEFAULT_TIMEZONE: 'Mars/Olympus' });
  assert.notEqual(timezone.status, 0);
  assert.match(timezone.stderr, /DEFAULT_TIMEZONE/i);

  const language = importConfig({ DEFAULT_LANGUAGE: 'fr' });
  assert.notEqual(language.status, 0);
  assert.match(language.stderr, /DEFAULT_LANGUAGE/i);
});

test('production startup rejects remote plaintext AI provider endpoints', () => {
  const openAi = importConfig({
    AI_PROVIDER: 'openai_compatible',
    AI_API_KEY: 'provider-secret',
    AI_BASE_URL: 'http://ai.example.test/v1'
  });
  assert.notEqual(openAi.status, 0);
  assert.match(openAi.stderr, /AI_BASE_URL.*HTTPS/i);

  const ollama = importConfig({
    AI_PROVIDER: 'ollama',
    OLLAMA_BASE_URL: 'http://ollama.example.test'
  });
  assert.notEqual(ollama.status, 0);
  assert.match(ollama.stderr, /OLLAMA_BASE_URL.*HTTPS/i);
});

test('production permits loopback HTTP provider endpoints', () => {
  const openAi = importConfig({
    AI_PROVIDER: 'openai_compatible',
    AI_API_KEY: 'provider-secret',
    AI_BASE_URL: 'http://127.0.0.1:3200/v1'
  });
  assert.equal(openAi.status, 0, openAi.stderr);

  const ollama = importConfig({
    AI_PROVIDER: 'ollama',
    OLLAMA_BASE_URL: 'http://localhost:11434'
  });
  assert.equal(ollama.status, 0, ollama.stderr);
});

test('production Telegram requires a strong webhook secret when enabled', () => {
  const result = importConfig({
    TELEGRAM_ENABLED: 'true',
    TELEGRAM_BOT_TOKEN: '123456:example-bot-token',
    TELEGRAM_WEBHOOK_SECRET: ''
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /TELEGRAM_WEBHOOK_SECRET/i);
});
