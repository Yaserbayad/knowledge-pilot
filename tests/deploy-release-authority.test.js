import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const deployScript = path.resolve(new URL('../scripts/deploy-release.sh', import.meta.url).pathname);

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: options.cwd,
    env: { ...process.env, ...(options.env || {}) },
    encoding: 'utf8'
  });
}

test('production deployment engine contains no release-specific application version', async () => {
  const source = await fs.readFile(deployScript, 'utf8');
  assert.doesNotMatch(source, /v1\.4\.2|v1\.4\.3|v1\.4\.4|v1\.5\.0/);
});

test('a tag deleted from the authoritative remote cannot remain deployable from a stale local tag', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kp-release-authority-'));
  const sourceRepo = path.join(root, 'source');
  const deployRepo = path.join(root, 'deploy');
  await fs.mkdir(sourceRepo, { recursive: true });

  assert.equal(run('git', ['init', '-b', 'main'], { cwd: sourceRepo }).status, 0);
  assert.equal(run('git', ['config', 'user.email', 'ci@example.invalid'], { cwd: sourceRepo }).status, 0);
  assert.equal(run('git', ['config', 'user.name', 'CI'], { cwd: sourceRepo }).status, 0);
  await fs.writeFile(path.join(sourceRepo, 'VERSION'), '2.3.4\n');
  assert.equal(run('git', ['add', 'VERSION'], { cwd: sourceRepo }).status, 0);
  assert.equal(run('git', ['commit', '-m', 'fixture release'], { cwd: sourceRepo }).status, 0);
  const sha = run('git', ['rev-parse', 'HEAD'], { cwd: sourceRepo }).stdout.trim();
  assert.equal(run('git', ['tag', 'v2.3.4'], { cwd: sourceRepo }).status, 0);
  assert.equal(run('git', ['clone', sourceRepo, deployRepo], { cwd: root }).status, 0);
  assert.equal(run('git', ['tag', '-d', 'v2.3.4'], { cwd: sourceRepo }).status, 0);

  const result = run('bash', ['-c', `
set -euo pipefail
KP_DEPLOY_LIBRARY_ONLY=1
source "$1"
TEST_MODE=1
DEPLOY_REPO="$2"
RELEASE_TAG=v2.3.4
EXPECTED_SHA="$3"
if resolve_release; then
  echo 'deleted authoritative tag was incorrectly accepted from stale local state' >&2
  exit 20
fi
`, 'authority-test', deployScript, deployRepo, sha]);

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});
