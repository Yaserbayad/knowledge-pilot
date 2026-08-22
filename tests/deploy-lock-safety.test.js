import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const deployScript = path.resolve(new URL('../scripts/deploy-release.sh', import.meta.url).pathname);

test('a concurrent invocation that loses the deployment lock cannot clean the active stage', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kp-deploy-lock-'));
  const stage = path.join(root, 'stage');
  const sentinel = path.join(stage, 'active-deployment-sentinel');
  await fs.mkdir(stage, { recursive: true });
  await fs.writeFile(sentinel, 'keep\n');

  const sha = 'a'.repeat(40);
  const result = spawnSync('bash', ['-c', `
set -euo pipefail
root="$1"
script="$2"
sha="$3"
exec 8>"$root/deploy.lock"
flock 8
set +e
KNOWLEDGE_PILOT_DEPLOY_TEST_MODE=1 KP_TEST_ROOT="$root" bash "$script" v1.4.3 "$sha" >"$root/output" 2>&1
rc=$?
set -e
test "$rc" -ne 0
test -f "$root/stage/active-deployment-sentinel"
grep -q 'another deployment is active' "$root/output"
`, 'lock-test', root, deployScript, sha], { encoding: 'utf8' });

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.equal(await fs.readFile(sentinel, 'utf8'), 'keep\n');
});
