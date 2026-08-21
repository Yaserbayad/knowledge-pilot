import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const scriptUrl = new URL('../scripts/install-aapanel.sh', import.meta.url);

test('aaPanel preparation uses the canonical path and locked fail-closed installs', async () => {
  const source = await fs.readFile(scriptUrl, 'utf8');
  assert.match(source, /APP_DIR="\$\{1:-\/www\/wwwroot\/knowledgepilot\}"/);
  assert.match(source, /\[ ! -f \.env \][\s\S]*exit 1/);
  assert.doesNotMatch(source, /cp\s+\.env\.example\s+\.env/);
  assert.match(source, /npm ci --ignore-scripts/);
  assert.match(source, /npm ci --omit=dev --ignore-scripts/);
  assert.doesNotMatch(source, /npm install/);
});

test('aaPanel preparation verifies configuration, full suite and audit before production dependency handoff', async () => {
  const source = await fs.readFile(scriptUrl, 'utf8');
  const fullInstallIndex = source.indexOf('npm ci --ignore-scripts');
  const configIndex = source.indexOf('node scripts/verify-config.js');
  const checkIndex = source.indexOf('npm run check');
  const auditIndex = source.indexOf('npm audit --omit=dev --audit-level=high');
  const prodInstallIndex = source.indexOf('npm ci --omit=dev --ignore-scripts');
  assert.ok(fullInstallIndex >= 0, 'locked full dependency install is required for the complete test suite');
  assert.ok(configIndex > fullInstallIndex, 'configuration verification must follow the full locked install');
  assert.ok(checkIndex > configIndex, 'full checks must follow configuration verification');
  assert.ok(auditIndex > checkIndex, 'production dependency audit must follow the complete suite');
  assert.ok(prodInstallIndex > auditIndex, 'production-only dependency preparation must happen last');
});

test('aaPanel preparation never starts or mutates an unverified process manager', async () => {
  const source = await fs.readFile(scriptUrl, 'utf8');
  assert.doesNotMatch(source, /\bpm2\s+(?:start|restart|reload|save|delete)\b/);
  assert.match(source, /process manager/i);
});