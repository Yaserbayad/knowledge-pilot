import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = path.resolve(new URL('..', import.meta.url).pathname);
const deployScript = path.join(repoRoot, 'scripts', 'deploy-release.sh');
const installerScript = path.join(repoRoot, 'scripts', 'install-deployer.sh');

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: options.cwd || repoRoot,
    env: { ...process.env, ...(options.env || {}) },
    encoding: 'utf8'
  });
}

test('release verification explicitly refreshes authoritative origin/main and fails if remote main is unavailable', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kp-main-authority-'));
  const source = path.join(root, 'source');
  const deploy = path.join(root, 'deploy');
  await fs.mkdir(source, { recursive: true });
  assert.equal(run('git', ['init', '-b', 'main'], { cwd: source }).status, 0);
  assert.equal(run('git', ['config', 'user.email', 'ci@example.invalid'], { cwd: source }).status, 0);
  assert.equal(run('git', ['config', 'user.name', 'CI'], { cwd: source }).status, 0);
  await fs.writeFile(path.join(source, 'VERSION'), '9.8.7\n');
  assert.equal(run('git', ['add', 'VERSION'], { cwd: source }).status, 0);
  assert.equal(run('git', ['commit', '-m', 'release'], { cwd: source }).status, 0);
  const sha = run('git', ['rev-parse', 'HEAD'], { cwd: source }).stdout.trim();
  assert.equal(run('git', ['tag', 'v9.8.7'], { cwd: source }).status, 0);
  assert.equal(run('git', ['clone', source, deploy], { cwd: root }).status, 0);
  assert.equal(run('git', ['update-ref', '-d', 'refs/remotes/origin/main'], { cwd: deploy }).status, 0);
  assert.equal(run('git', ['config', '--unset-all', 'remote.origin.fetch'], { cwd: deploy }).status, 0);
  assert.equal(run('git', ['config', '--add', 'remote.origin.fetch', '+refs/tags/*:refs/tags/*'], { cwd: deploy }).status, 0);

  const repaired = run('bash', ['-c', `
set -euo pipefail
KP_DEPLOY_LIBRARY_ONLY=1
source "$1"
TEST_MODE=1
DEPLOY_REPO="$2"
RELEASE_TAG=v9.8.7
EXPECTED_SHA="$3"
resolve_release
git -C "$2" rev-parse --verify refs/remotes/origin/main >/dev/null
`, 'main-authority-repair-test', deployScript, deploy, sha]);
  assert.equal(repaired.status, 0, `${repaired.stdout}\n${repaired.stderr}`);

  assert.equal(run('git', ['branch', '-m', 'main', 'withdrawn'], { cwd: source }).status, 0);
  assert.equal(run('git', ['update-ref', '-d', 'refs/remotes/origin/main'], { cwd: deploy }).status, 0);
  const missing = run('bash', ['-c', `
set -euo pipefail
KP_DEPLOY_LIBRARY_ONLY=1
source "$1"
TEST_MODE=1
DEPLOY_REPO="$2"
RELEASE_TAG=v9.8.7
EXPECTED_SHA="$3"
if resolve_release; then
  echo 'release was accepted without authoritative remote main' >&2
  exit 20
fi
`, 'main-authority-missing-test', deployScript, deploy, sha]);
  assert.equal(missing.status, 0, `${missing.stdout}\n${missing.stderr}`);
});

test('graceful stop requires the exact process to exit, not only the listening port to clear', async () => {
  const source = await fs.readFile(deployScript, 'utf8');
  assert.match(source, /wait_for_process_exit\s+"\$pid"/);
  assert.match(source, /\$PROC_ROOT\/\$pid/);
});

test('rollback refuses file restoration when listener state is present but ambiguous', () => {
  const result = run('bash', ['-c', `
set -euo pipefail
KP_DEPLOY_LIBRARY_ONLY=1
source "$1"
marker="$2"
listener_snapshot() { printf '%s\n' 'LISTEN ambiguous-a' 'LISTEN ambiguous-b'; }
get_listener_pid() { return 1; }
graceful_stop_application() { return 1; }
restore_release_owned_files() { printf restored > "$marker"; return 0; }
start_application_as_runtime_user() { return 0; }
verify_running_release() { return 0; }
authenticated_local_smoke() { return 0; }
configure_workspace_agent_server() { return 0; }
external_smoke() { return 0; }
restore_workspace_timer_state() { return 0; }
ROLLBACK_VERSION=1.0.0
if perform_rollback; then
  echo 'ambiguous listener rollback was incorrectly accepted' >&2
  exit 20
fi
if [[ -e "$marker" ]]; then
  echo 'release-owned files were mutated under ambiguous listener state' >&2
  exit 21
fi
`, 'rollback-ambiguity-test', deployScript, path.join(os.tmpdir(), `kp-rollback-marker-${process.pid}`)]);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test('runtime-owned data permissions are preserved by release cutover helpers', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kp-runtime-perms-'));
  const live = path.join(root, 'live');
  const data = path.join(live, 'data');
  const file = path.join(data, 'state.json');
  await fs.mkdir(data, { recursive: true, mode: 0o700 });
  await fs.writeFile(path.join(live, '.env'), 'SAFE=1\n', { mode: 0o600 });
  await fs.writeFile(file, '{}\n', { mode: 0o600 });
  await fs.chmod(data, 0o700);
  await fs.chmod(file, 0o600);

  const result = run('bash', ['-c', `
set -euo pipefail
KP_DEPLOY_LIBRARY_ONLY=1
source "$1"
TEST_MODE=1
LIVE="$2"
apply_live_permissions
`, 'runtime-perms-test', deployScript, live]);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.equal((await fs.stat(data)).mode & 0o777, 0o700);
  assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
});

test('deployment verification is pinned to the exact Node binary serving production', async () => {
  const source = await fs.readFile(deployScript, 'utf8');
  assert.match(source, /readlink\s+-f\s+"\$process_root\/exe"/);
  assert.match(source, /RUNTIME_NODE_BINARY/);
  assert.match(source, /RUNTIME_NPM_BINARY/);
});

test('preflight proves the current local, authenticated, external and nginx baseline before cutover', async () => {
  const source = await fs.readFile(deployScript, 'utf8');
  assert.match(source, /verify_current_baseline/);
  assert.match(source, /authenticated_local_smoke/);
  assert.match(source, /external_smoke/);
  assert.match(source, /nginx\s+-t/);
});

test('one-time installer verifies its own uploaded bytes against the exact source commit before installation', async () => {
  const source = await fs.readFile(installerScript, 'utf8');
  assert.match(source, /verify_installer_source_integrity/);
  assert.match(source, /scripts\/install-deployer\.sh/);
  assert.match(source, /sha256sum/);
});
