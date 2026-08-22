import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const repoRoot = path.resolve(new URL('..', import.meta.url).pathname);
const deployScript = path.join(repoRoot, 'scripts', 'deploy-release.sh');

test('workspace-agent deployment activates the validated MCP nginx route', async () => {
  const source = await fs.readFile(deployScript, 'utf8');
  const match = source.match(/configure_workspace_agent_server\(\) \{([\s\S]*?)^\}/m);
  assert.ok(match, 'configure_workspace_agent_server helper must exist');
  const body = match[1];
  const configureIndex = body.indexOf('configure-server.mjs');
  const nginxTestIndex = body.indexOf('nginx -t');
  const nginxReloadIndex = body.search(/(?:systemctl\s+reload\s+nginx|nginx\s+-s\s+reload|service\s+nginx\s+reload)/);
  assert.ok(configureIndex >= 0, 'workspace-agent server configuration must run');
  assert.ok(nginxTestIndex > configureIndex, 'nginx config must be syntax-checked after route generation');
  assert.ok(nginxReloadIndex > nginxTestIndex, 'validated nginx configuration must be reloaded before deployment continues');
});
