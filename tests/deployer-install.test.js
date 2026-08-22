import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const installer = path.resolve(new URL('../scripts/install-deployer.sh', import.meta.url).pathname);

test('installer removes only stale npm config keys without exposing their values', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kp-npmrc-'));
  const npmrc = path.join(dir, 'npmrc');
  await fs.writeFile(npmrc, 'APP_SECRET=DO-NOT-PRINT-ME\n--init.module=legacy\nregistry=https://registry.npmjs.org/\n', { mode: 0o600 });

  const result = spawnSync('bash', ['-c', 'set -euo pipefail; KP_DEPLOY_INSTALLER_LIBRARY_ONLY=1; source "$1"; sanitize_npm_config_file "$2"', 'test', installer, npmrc], { encoding: 'utf8' });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /DO-NOT-PRINT-ME|legacy/);
  assert.match(result.stdout, /KEY=APP_SECRET/);
  assert.match(result.stdout, /KEY=--init\.module/);

  const remaining = await fs.readFile(npmrc, 'utf8');
  assert.equal(remaining, 'registry=https://registry.npmjs.org/\n');
  assert.equal((await fs.stat(npmrc)).mode & 0o777, 0o600);
});