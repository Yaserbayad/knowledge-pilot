import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = path.resolve(new URL('..', import.meta.url).pathname);
const installer = path.join(repoRoot, 'scripts', 'install-deployer.sh');
const engine = path.join(repoRoot, 'scripts', 'deploy-release.sh');

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: options.cwd || repoRoot,
    env: { ...process.env, ...(options.env || {}) },
    encoding: 'utf8'
  });
}

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kp-installer-sim-'));
  const source = path.join(root, 'source');
  const deployRepo = path.join(root, 'deploy-repo');
  await fs.mkdir(path.join(source, 'scripts'), { recursive: true });
  await fs.copyFile(engine, path.join(source, 'scripts', 'deploy-release.sh'));
  assert.equal(run('git', ['init', '-b', 'main'], { cwd: source }).status, 0);
  assert.equal(run('git', ['config', 'user.email', 'ci@example.invalid'], { cwd: source }).status, 0);
  assert.equal(run('git', ['config', 'user.name', 'CI'], { cwd: source }).status, 0);
  assert.equal(run('git', ['add', '.'], { cwd: source }).status, 0);
  assert.equal(run('git', ['commit', '-m', 'engine fixture'], { cwd: source }).status, 0);
  const sha = run('git', ['rev-parse', 'HEAD'], { cwd: source }).stdout.trim();
  assert.equal(run('git', ['clone', source, deployRepo], { cwd: root }).status, 0);
  await fs.writeFile(path.join(root, 'npmrc'), 'APP_SECRET=BOOTSTRAP-SECRET-SENTINEL\nregistry=https://registry.npmjs.org/\n', { mode: 0o600 });
  return { root, sha };
}

test('one-time installer atomically installs the exact source-controlled engine in disposable mode', async () => {
  const { root, sha } = await fixture();
  const result = run('bash', [installer, sha], {
    env: { KNOWLEDGE_PILOT_INSTALLER_TEST_MODE: '1', KP_INSTALL_TEST_ROOT: root }
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /INSTALL=PASS/);
  assert.match(result.stdout, new RegExp(`SOURCE_SHA=${sha}`));
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /BOOTSTRAP-SECRET-SENTINEL/);

  const installed = path.join(root, 'usr', 'local', 'sbin', 'deploy-knowledge-pilot');
  assert.equal((await fs.stat(installed)).mode & 0o777, 0o755);
  assert.equal(await fs.readFile(installed, 'utf8'), await fs.readFile(engine, 'utf8'));
  assert.equal(run('bash', [installed, '--self-test']).status, 0);
  assert.equal(await fs.readFile(path.join(root, 'npmrc'), 'utf8'), 'registry=https://registry.npmjs.org/\n');
});

test('one-time installer fails closed for an unavailable exact source commit', async () => {
  const { root } = await fixture();
  const unavailable = 'f'.repeat(40);
  const result = run('bash', [installer, unavailable], {
    env: { KNOWLEDGE_PILOT_INSTALLER_TEST_MODE: '1', KP_INSTALL_TEST_ROOT: root }
  });
  assert.notEqual(result.status, 0);
  await assert.rejects(fs.access(path.join(root, 'usr', 'local', 'sbin', 'deploy-knowledge-pilot')));
});