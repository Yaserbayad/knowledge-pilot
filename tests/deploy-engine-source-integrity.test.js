import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const deployScript = path.resolve(new URL('../scripts/deploy-release.sh', import.meta.url).pathname);

function run(command, args) {
  return spawnSync(command, args, { encoding: 'utf8' });
}

test('stage verification rejects release engine source that differs from the installed deployer', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kp-engine-source-'));
  const stage = path.join(root, 'stage');
  await fs.mkdir(path.join(stage, 'scripts'), { recursive: true });
  await fs.copyFile(deployScript, path.join(stage, 'scripts', 'deploy-release.sh'));

  const same = run('bash', ['-c', `
set -euo pipefail
KP_DEPLOY_LIBRARY_ONLY=1
source "$1"
STAGE="$2"
installed_engine_matches_stage
`, 'engine-source-match', deployScript, stage]);
  assert.equal(same.status, 0, `${same.stdout}\n${same.stderr}`);

  await fs.appendFile(path.join(stage, 'scripts', 'deploy-release.sh'), '\n# stale-or-new-engine-difference\n');
  const different = run('bash', ['-c', `
set -euo pipefail
KP_DEPLOY_LIBRARY_ONLY=1
source "$1"
STAGE="$2"
if installed_engine_matches_stage; then
  echo 'divergent release engine was accepted' >&2
  exit 20
fi
`, 'engine-source-mismatch', deployScript, stage]);
  assert.equal(different.status, 0, `${different.stdout}\n${different.stderr}`);
});
