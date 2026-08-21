import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const scriptUrl = new URL('../scripts/install-aapanel.sh', import.meta.url);

test('aaPanel preparation uses the canonical path and a locked fail-closed install', async () => {
  const source = await fs.readFile(scriptUrl, 'utf8');
  assert.match(source, /APP_DIR="\$\{1:-\/www\/wwwroot\/knowledgepilot\}"/);
  assert.match(source, /\[ ! -f \.env \][\s\S]*exit 1/);
  assert.doesNotMatch(source, /cp\s+\.env\.example\s+\.env/);
  assert.match(source, /npm ci --omit=dev --ignore-scripts/);
  assert.doesNotMatch(source, /npm install/);
});

test('aaPanel preparation verifies configuration and the full application before handoff', async () => {
  const source = await fs.readFile(scriptUrl, 'utf8');
  const configIndex = source.indexOf('node scripts/verify-config.js');
  const checkIndex = source.indexOf('npm run check');
  assert.ok(configIndex >= 0, 'configuration verification is required');
  assert.ok(checkIndex > configIndex, 'full checks must follow configuration verification');
});

test('aaPanel preparation never starts or mutates an unverified process manager', async () => {
  const source = await fs.readFile(scriptUrl, 'utf8');
  assert.doesNotMatch(source, /\bpm2\s+(?:start|restart|reload|save|delete)\b/);
  assert.match(source, /process manager/i);
});
