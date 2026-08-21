import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = path.resolve(new URL('..', import.meta.url).pathname);
const deployScript = path.join(repoRoot, 'scripts', 'deploy-release.sh');
const bootstrapScript = path.join(repoRoot, 'scripts', 'install-deployer.sh');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || repoRoot,
    env: { ...process.env, ...(options.env || {}) },
    encoding: 'utf8'
  });
  return result;
}

async function read(file) {
  return fs.readFile(file, 'utf8');
}

function shellFunction(command) {
  return run('bash', ['-c', `set -euo pipefail; KP_DEPLOY_LIBRARY_ONLY=1; source "${deployScript}"; ${command}`]);
}

test('deployment engine accepts only semantic release tags plus exact commit SHAs', async () => {
  await fs.access(deployScript);
  assert.equal(shellFunction(`validate_release_args v1.4.3 ${'a'.repeat(40)}`).status, 0);
  assert.equal(shellFunction(`validate_release_args v1.5.0 ${'b'.repeat(40)}`).status, 0);
  assert.notEqual(shellFunction(`validate_release_args main ${'a'.repeat(40)}`).status, 0);
  assert.notEqual(shellFunction(`validate_release_args latest ${'a'.repeat(40)}`).status, 0);
  assert.notEqual(shellFunction('validate_release_args v1.4.3 deadbeef').status, 0);
});

test('environment mode checks compare permission strings, not decimalized octal arithmetic', async () => {
  assert.equal(shellFunction('is_safe_env_mode 600').status, 0);
  assert.notEqual(shellFunction('is_safe_env_mode 644').status, 0);
  assert.notEqual(shellFunction('is_safe_env_mode 660').status, 0);
  const source = await read(deployScript);
  assert.doesNotMatch(source, /%\s*1000|%\s*100|%\s*10/);
});

test('deploy-key identity ignores optional public-key comments', async () => {
  const first = shellFunction(`canonical_public_key 'ssh-ed25519 AAAATEST production-server'`);
  const second = shellFunction(`canonical_public_key 'ssh-ed25519 AAAATEST different-comment'`);
  assert.equal(first.status, 0);
  assert.equal(second.status, 0);
  assert.equal(first.stdout.trim(), 'ssh-ed25519 AAAATEST');
  assert.equal(second.stdout.trim(), first.stdout.trim());
});

test('engine encodes the permanent safety invariants and forbidden stop patterns', async () => {
  const source = await read(deployScript);
  assert.match(source, /flock\s+-n/);
  assert.match(source, /git\s+archive/);
  assert.match(source, /--exclude=['"]?\.env/);
  assert.match(source, /--exclude=['"]?data\//);
  assert.match(source, /--exclude=['"]?\.well-known\//);
  assert.match(source, /runuser\s+-u\s+"?\$RUNTIME_USER"?\s+--\s+bash\s+"?\$AAPANEL_START_SCRIPT"?/);
  assert.match(source, /\[\[ "\$target" == "\$AAPANEL_PID_FILE" \]\] && continue/);
  assert.match(source, /node\s+--input-type=module/);
  assert.match(source, /api\/gpt\/health/);
  assert.match(source, /gpt-action\/openapi\.json/);
  assert.doesNotMatch(source, /\bpkill\b/);
  assert.doesNotMatch(source, /\bkillall\b/);
  assert.doesNotMatch(source, /kill\s+-9/);
  assert.doesNotMatch(source, /gh\s+auth/);
  assert.doesNotMatch(source, /npm\s+11|npm@11|11\.x/);
  assert.doesNotMatch(source, /systemctl\s+(?:enable|start|restart)\s+knowledgepilot-agent-trigger\.timer/);
});

test('engine verifies runtime facts after start instead of trusting start command success', async () => {
  const source = await read(deployScript);
  const startIndex = source.indexOf('start_application_as_runtime_user');
  const verifyIndex = source.indexOf('verify_running_release', startIndex + 1);
  assert.ok(startIndex >= 0, 'runtime-user start helper is required');
  assert.ok(verifyIndex > startIndex, 'post-start runtime verification must follow startup');
  for (const marker of ['/proc/', 'cwd', 'cmdline', '127.0.0.1', 'RUNTIME_USER', 'VERSION', '/health']) {
    assert.ok(source.includes(marker), `missing runtime verification marker: ${marker}`);
  }
});

test('live stop becomes rollback-eligible before TERM can mutate production availability', async () => {
  const source = await read(deployScript);
  const liveStop = source.indexOf('phase LIVE_STOP');
  const rollbackEligible = source.indexOf('CUTOVER_STARTED=1', liveStop);
  const stopCall = source.indexOf('graceful_stop_application "$CURRENT_PID"', liveStop);
  assert.ok(liveStop >= 0);
  assert.ok(rollbackEligible > liveStop, 'rollback eligibility must be set inside LIVE_STOP');
  assert.ok(stopCall > rollbackEligible, 'rollback eligibility must be set before sending TERM');
});

test('workspace-agent topology changes fail closed as deployment-architecture changes', () => {
  assert.equal(shellFunction('workspace_agent_topology_matches 1 1').status, 0);
  assert.equal(shellFunction('workspace_agent_topology_matches 0 0').status, 0);
  assert.notEqual(shellFunction('workspace_agent_topology_matches 1 0').status, 0);
  assert.notEqual(shellFunction('workspace_agent_topology_matches 0 1').status, 0);
});

test('one-time installer is source-controlled, atomic, syntax-checks and self-tests the installed engine', async () => {
  const source = await read(bootstrapScript);
  assert.match(source, /\/usr\/local\/sbin\/deploy-knowledge-pilot/);
  assert.match(source, /bash\s+-n/);
  assert.match(source, /--self-test/);
  assert.match(source, /0755/);
  assert.match(source, /git\s+(?:show|archive)/);
  assert.doesNotMatch(source, /\.env\s*$/m);
  assert.doesNotMatch(source, /cat\s+.*\.env/);
});

async function writeExecutable(file, content) {
  await fs.writeFile(file, content, { mode: 0o755 });
}

async function makeFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kp-deploy-sim-'));
  const live = path.join(root, 'live');
  const stage = path.join(root, 'stage');
  const rollback = path.join(root, 'rollback');
  const sourceRepo = path.join(root, 'source');
  const deployRepo = path.join(root, 'deploy-repo');
  const bin = path.join(root, 'bin');
  const state = path.join(root, 'runtime');
  const proc = path.join(root, 'proc');
  const pidDir = path.join(root, 'aapanel', 'pids');
  const scriptDir = path.join(root, 'aapanel', 'scripts');
  await Promise.all([live, bin, state, proc, pidDir, scriptDir].map((dir) => fs.mkdir(dir, { recursive: true })));
  await fs.mkdir(path.join(live, 'src'), { recursive: true });
  await fs.mkdir(path.join(live, 'data'), { recursive: true });
  await fs.mkdir(path.join(live, '.well-known'), { recursive: true });
  await fs.writeFile(path.join(live, '.env'), 'APP_SECRET=SUPER-SECRET-SENTINEL\nGPT_ACTION_API_KEY=ANOTHER-SECRET-SENTINEL\nAPP_BASE_URL=https://example.invalid\n', { mode: 0o600 });
  await fs.writeFile(path.join(live, 'VERSION'), '1.4.2\n');
  await fs.writeFile(path.join(live, 'src', 'index.js'), 'old release\n');
  await fs.writeFile(path.join(live, 'stale-release-file.txt'), 'must disappear\n');
  await fs.writeFile(path.join(live, 'data', 'state.json'), '{"preserve":true}\n');
  await fs.writeFile(path.join(live, '.well-known', 'acme.txt'), 'server-owned\n');

  await fs.mkdir(path.join(sourceRepo, 'src'), { recursive: true });
  await fs.mkdir(path.join(sourceRepo, 'scripts'), { recursive: true });
  await fs.writeFile(path.join(sourceRepo, 'VERSION'), '1.4.3\n');
  await fs.writeFile(path.join(sourceRepo, 'src', 'index.js'), 'new release\n');
  await fs.copyFile(deployScript, path.join(sourceRepo, 'scripts', 'deploy-release.sh'));
  await fs.writeFile(path.join(sourceRepo, 'scripts', 'install-aapanel.sh'), '#!/usr/bin/env bash\nset -euo pipefail\nnpm ci --ignore-scripts\nnode scripts/verify-config.js\nnpm run check\nnpm audit --omit=dev --audit-level=high\nnpm ci --omit=dev --ignore-scripts\n');
  await fs.chmod(path.join(sourceRepo, 'scripts', 'install-aapanel.sh'), 0o755);
  await fs.writeFile(path.join(sourceRepo, 'scripts', 'verify-config.js'), 'process.exit(0);\n');
  await fs.writeFile(path.join(sourceRepo, 'package.json'), JSON.stringify({ name: 'knowledge-pilot', version: '1.4.3', private: true, type: 'module', engines: { node: '>=22.0.0' }, scripts: { check: 'node --check src/index.js' } }, null, 2));
  await fs.writeFile(path.join(sourceRepo, 'package-lock.json'), JSON.stringify({ name: 'knowledge-pilot', version: '1.4.3', lockfileVersion: 3, requires: true, packages: { '': { name: 'knowledge-pilot', version: '1.4.3' } } }, null, 2));
  await fs.writeFile(path.join(sourceRepo, 'new-release-file.txt'), 'new\n');

  assert.equal(run('git', ['init', '-b', 'main'], { cwd: sourceRepo }).status, 0);
  assert.equal(run('git', ['config', 'user.email', 'ci@example.invalid'], { cwd: sourceRepo }).status, 0);
  assert.equal(run('git', ['config', 'user.name', 'CI'], { cwd: sourceRepo }).status, 0);
  assert.equal(run('git', ['add', '.'], { cwd: sourceRepo }).status, 0);
  assert.equal(run('git', ['commit', '-m', 'fixture release'], { cwd: sourceRepo }).status, 0);
  const sha = run('git', ['rev-parse', 'HEAD'], { cwd: sourceRepo }).stdout.trim();
  assert.equal(run('git', ['tag', 'v1.4.3'], { cwd: sourceRepo }).status, 0);
  assert.equal(run('git', ['clone', sourceRepo, deployRepo], { cwd: root }).status, 0);

  const pid = '4242';
  async function markRunning(version = '1.4.2') {
    await fs.mkdir(path.join(proc, pid), { recursive: true });
    try { await fs.unlink(path.join(proc, pid, 'cwd')); } catch {}
    await fs.symlink(live, path.join(proc, pid, 'cwd'));
    await fs.writeFile(path.join(proc, pid, 'cmdline'), Buffer.from('/usr/bin/node\0src/index.js\0'));
    await fs.writeFile(path.join(proc, pid, 'status'), 'Name:\tnode\nUid:\t1000\t1000\t1000\t1000\nGid:\t1000\t1000\t1000\t1000\n');
    await fs.writeFile(path.join(state, 'running'), `${pid}\n`);
    await fs.writeFile(path.join(state, 'version'), `${version}\n`);
    await fs.writeFile(path.join(pidDir, 'knowledgepilot.pid'), `${pid}\n`);
  }
  await markRunning();
  await writeExecutable(path.join(scriptDir, 'knowledgepilot.sh'), `#!/usr/bin/env bash\ncd "${live}"\nnohup node src/index.js >/dev/null 2>&1 &\n`);

  await writeExecutable(path.join(bin, 'npm'), '#!/usr/bin/env bash\nprintf "npm %s\\n" "$*" >> "$KP_TEST_ROOT/commands.log"\nif [ -n "${KP_TEST_NPM_FAIL_MATCH:-}" ] && [[ "$*" == *"$KP_TEST_NPM_FAIL_MATCH"* ]]; then exit 42; fi\nexit 0\n');
  await writeExecutable(path.join(bin, 'ss'), '#!/usr/bin/env bash\nif [ -f "$KP_TEST_ROOT/runtime/running" ]; then pid=$(cat "$KP_TEST_ROOT/runtime/running"); printf "LISTEN 0 511 127.0.0.1:3100 0.0.0.0:* users:((\\\"node\\\",pid=%s,fd=20))\\n" "$pid"; fi\n');
  await writeExecutable(path.join(bin, 'runuser'), `#!/usr/bin/env bash\nset -e\nif [ "$1" = "-u" ] && [ "$3" = "--" ] && [ "$4" = "test" ]; then exit 0; fi\nif [ "$1" = "-u" ] && [ "$3" = "--" ] && [ "$4" = "bash" ]; then\n  pid=4242\n  mkdir -p "$KP_TEST_ROOT/proc/$pid"\n  rm -f "$KP_TEST_ROOT/proc/$pid/cwd"\n  ln -s "$KP_TEST_ROOT/live" "$KP_TEST_ROOT/proc/$pid/cwd"\n  printf '/usr/bin/node\\0src/index.js\\0' > "$KP_TEST_ROOT/proc/$pid/cmdline"\n  printf 'Name:\\tnode\\nUid:\\t1000\\t1000\\t1000\\t1000\\nGid:\\t1000\\t1000\\t1000\\t1000\\n' > "$KP_TEST_ROOT/proc/$pid/status"\n  printf '%s\\n' "$pid" > "$KP_TEST_ROOT/runtime/running"\n  cat "$KP_TEST_ROOT/live/VERSION" > "$KP_TEST_ROOT/runtime/version"\n  printf '%s\\n' "$pid" > "$KP_TEST_ROOT/aapanel/pids/knowledgepilot.pid"\n  exit 0\nfi\nexit 1\n`);
  await writeExecutable(path.join(bin, 'curl'), `#!/usr/bin/env bash\nset -e\nurl="\${@: -1}"\nversion=$(cat "$KP_TEST_ROOT/live/VERSION")\nif [[ "$url" == https://* ]] && [ "\${KP_TEST_FAIL_EXTERNAL_ON_VERSION:-}" = "$version" ]; then exit 22; fi\ncase "$url" in\n  */gpt-action/openapi.json) printf '{"info":{"version":"%s"}}\\n' "$version" ;;\n  *) printf '{"ok":true,"version":"%s"}\\n' "$version" ;;\nesac\n`);

  return { root, live, stage, rollback, deployRepo, bin, sha };
}

async function runSimulation({ failExternal = false, failStage = false } = {}) {
  const fixture = await makeFixture();
  const result = run('bash', [deployScript, 'v1.4.3', fixture.sha], {
    env: {
      KNOWLEDGE_PILOT_DEPLOY_TEST_MODE: '1',
      KP_TEST_ROOT: fixture.root,
      KP_TEST_FAIL_EXTERNAL_ON_VERSION: failExternal ? '1.4.3' : '',
      KP_TEST_NPM_FAIL_MATCH: failStage ? 'ci --ignore-scripts' : '',
      PATH: `${fixture.bin}:${process.env.PATH}`
    }
  });
  return { ...fixture, result };
}

test('disposable simulation performs a generic cutover while preserving runtime-owned material', async () => {
  const { live, result } = await runSimulation();
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /RESULT=PASS/);
  assert.match(result.stdout, /RELEASE=v1\.4\.3/);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /SUPER-SECRET-SENTINEL|ANOTHER-SECRET-SENTINEL/);
  assert.equal(await fs.readFile(path.join(live, '.env'), 'utf8'), 'APP_SECRET=SUPER-SECRET-SENTINEL\nGPT_ACTION_API_KEY=ANOTHER-SECRET-SENTINEL\nAPP_BASE_URL=https://example.invalid\n');
  assert.equal(await fs.readFile(path.join(live, 'data', 'state.json'), 'utf8'), '{"preserve":true}\n');
  assert.equal(await fs.readFile(path.join(live, '.well-known', 'acme.txt'), 'utf8'), 'server-owned\n');
  await assert.rejects(fs.access(path.join(live, 'stale-release-file.txt')));
  assert.equal(await fs.readFile(path.join(live, 'new-release-file.txt'), 'utf8'), 'new\n');
});

test('pre-cutover staging failure leaves the running release-owned tree untouched', async () => {
  const { live, result } = await runSimulation({ failStage: true });
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /FAILED_PHASE=STAGE_VERIFY/);
  assert.doesNotMatch(result.stdout, /ROLLBACK=PASS/);
  assert.equal((await fs.readFile(path.join(live, 'VERSION'), 'utf8')).trim(), '1.4.2');
  assert.equal(await fs.readFile(path.join(live, 'src', 'index.js'), 'utf8'), 'old release\n');
  assert.equal(await fs.readFile(path.join(live, 'stale-release-file.txt'), 'utf8'), 'must disappear\n');
  assert.equal(await fs.readFile(path.join(live, '.env'), 'utf8'), 'APP_SECRET=SUPER-SECRET-SENTINEL\nGPT_ACTION_API_KEY=ANOTHER-SECRET-SENTINEL\nAPP_BASE_URL=https://example.invalid\n');
});

test('post-cutover simulation failure automatically restores and verifies the prior release', async () => {
  const { live, result } = await runSimulation({ failExternal: true });
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /RESULT=FAIL/);
  assert.match(result.stdout, /ROLLBACK=PASS/);
  assert.equal((await fs.readFile(path.join(live, 'VERSION'), 'utf8')).trim(), '1.4.2');
  assert.equal(await fs.readFile(path.join(live, 'src', 'index.js'), 'utf8'), 'old release\n');
  assert.equal(await fs.readFile(path.join(live, 'data', 'state.json'), 'utf8'), '{"preserve":true}\n');
  assert.equal(await fs.readFile(path.join(live, '.well-known', 'acme.txt'), 'utf8'), 'server-owned\n');
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /SUPER-SECRET-SENTINEL|ANOTHER-SECRET-SENTINEL/);
});
