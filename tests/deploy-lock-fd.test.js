import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const deployScript = path.resolve(new URL('../scripts/deploy-release.sh', import.meta.url).pathname);

test('application startup cannot inherit the deployment lock descriptor', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kp-deploy-lock-fd-'));
  const result = spawnSync('bash', ['-c', `
set -euo pipefail
KP_DEPLOY_LIBRARY_ONLY=1
source "$1"
AAPANEL_START_SCRIPT=/bin/true
AAPANEL_PID_FILE="$2/aapanel.pid"
LEAK_MARKER="$2/lock-fd-leaked"
RUNTIME_USER=www
runuser() {
  if [[ -e /proc/$$/fd/9 ]]; then
    printf 'deployment lock descriptor leaked into application startup\\n' > "$LEAK_MARKER"
  fi
  return 0
}
wait_for_listener() { return 0; }
get_listener_pid() { printf '4242\\n'; }
verify_process_identity() { return 0; }
exec 9>"$2/deploy.lock"
flock -n 9
start_application_as_runtime_user
[[ "$(cat "$AAPANEL_PID_FILE")" == 4242 ]]
[[ ! -e "$LEAK_MARKER" ]]
[[ -e /proc/$$/fd/9 ]]
`, 'lock-fd-test', deployScript, root], { encoding: 'utf8' });

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});
