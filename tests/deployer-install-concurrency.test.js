import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const installer = path.resolve(new URL('../scripts/install-deployer.sh', import.meta.url).pathname);

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: options.cwd,
    env: { ...process.env, ...(options.env || {}) },
    encoding: 'utf8'
  });
}

test('deployer installation refuses to replace the engine while an application deployment is active', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kp-deployer-race-'));
  const source = path.join(root, 'source');
  const deployRepo = path.join(root, 'deploy-repo');
  await fs.mkdir(path.join(source, 'scripts'), { recursive: true });
  await fs.writeFile(path.join(source, 'scripts', 'deploy-release.sh'), '#!/usr/bin/env bash\nset -euo pipefail\n[[ "${1:-}" == "--self-test" ]] && { printf "SELF_TEST=PASS\\n"; exit 0; }\n');
  await fs.copyFile(installer, path.join(source, 'scripts', 'install-deployer.sh'));

  assert.equal(run('git', ['init', '-b', 'main'], { cwd: source }).status, 0);
  assert.equal(run('git', ['config', 'user.email', 'ci@example.invalid'], { cwd: source }).status, 0);
  assert.equal(run('git', ['config', 'user.name', 'CI'], { cwd: source }).status, 0);
  assert.equal(run('git', ['add', '.'], { cwd: source }).status, 0);
  assert.equal(run('git', ['commit', '-m', 'fixture engine'], { cwd: source }).status, 0);
  const sha = run('git', ['rev-parse', 'HEAD'], { cwd: source }).stdout.trim();
  assert.equal(run('git', ['clone', source, deployRepo], { cwd: root }).status, 0);

  const result = run('bash', ['-c', `
set -euo pipefail
root="$1"
installer="$2"
sha="$3"
exec 8>"$root/deploy.lock"
flock -n 8
set +e
KNOWLEDGE_PILOT_INSTALLER_TEST_MODE=1 KP_INSTALL_TEST_ROOT="$root" bash "$installer" "$sha" >"$root/output" 2>&1
rc=$?
set -e
test "$rc" -ne 0
test ! -e "$root/usr/local/sbin/deploy-knowledge-pilot"
grep -qi 'deployment is active' "$root/output"
`, 'installer-race-test', root, installer, sha]);

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});
