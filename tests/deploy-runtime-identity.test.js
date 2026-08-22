import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const deployScript = path.resolve(new URL('../scripts/deploy-release.sh', import.meta.url).pathname);

test('runtime verification rejects a root Knowledge Pilot process and accepts the expected runtime identity', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kp-runtime-identity-'));
  const live = path.join(root, 'live');
  const procRoot = path.join(root, 'proc');
  const processRoot = path.join(procRoot, '4242');
  await fs.mkdir(live, { recursive: true });
  await fs.mkdir(processRoot, { recursive: true });
  await fs.symlink(live, path.join(processRoot, 'cwd'));
  await fs.writeFile(path.join(processRoot, 'cmdline'), Buffer.from('/usr/bin/node\0src/index.js\0'));
  await fs.writeFile(path.join(processRoot, 'status'), 'Name:\tnode\nUid:\t0\t0\t0\t0\nGid:\t0\t0\t0\t0\n');

  const result = spawnSync('bash', ['-c', `
set -euo pipefail
KP_DEPLOY_LIBRARY_ONLY=1
source "$1"
LIVE="$2"
PROC_ROOT="$3"
RUNTIME_UID=1000
RUNTIME_GID=1000
if verify_process_identity 4242; then
  echo 'root runtime was incorrectly accepted' >&2
  exit 20
fi
cat > "$3/4242/status" <<'STATUS'
Name:\tnode
Uid:\t1000\t1000\t1000\t1000
Gid:\t1000\t1000\t1000\t1000
STATUS
verify_process_identity 4242
`, 'runtime-test', deployScript, live, procRoot], { encoding: 'utf8' });

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});
