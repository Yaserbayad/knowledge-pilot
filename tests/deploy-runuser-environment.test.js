import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const deployScript = path.resolve(new URL('../scripts/deploy-release.sh', import.meta.url).pathname);

test('aaPanel startup injects the captured Node PATH inside the target-user command', async () => {
  const source = await fs.readFile(deployScript, 'utf8');
  assert.match(
    source,
    /runuser\s+-u\s+"\$RUNTIME_USER"\s+--\s+env\s+"PATH=\$RUNTIME_NODE_DIR:[^"]+"\s+bash\s+"\$AAPANEL_START_SCRIPT"/,
    'PATH must be set by env after runuser switches to www so PAM cannot replace the captured aaPanel Node path'
  );
  assert.doesNotMatch(
    source,
    /PATH="\$RUNTIME_NODE_DIR:\$PATH"\s+runuser/,
    'setting PATH only before runuser is not deterministic across PAM/runuser configurations'
  );
});
