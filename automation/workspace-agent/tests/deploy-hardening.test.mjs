import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const deploy = (name) => new URL(`../deploy/${name}`, import.meta.url);

test('systemd unit templates do not pin an aaPanel Node patch version', async () => {
  for (const name of ['knowledgepilot-mcp.service', 'knowledgepilot-agent-trigger.service']) {
    const source = await fs.readFile(deploy(name), 'utf8');
    assert.match(source, /^ExecStart=__NODE_BINARY__\s+src\//m, `${name} must use the Node binary placeholder`);
    assert.doesNotMatch(source, /\/www\/server\/nodejs\/v\d/i, `${name} pins an aaPanel Node installation`);
  }
});

test('server configuration renders the exact running Node binary into unit templates', async () => {
  const source = await fs.readFile(deploy('configure-server.mjs'), 'utf8');
  assert.match(source, /process\.execPath/);
  assert.match(source, /replaceAll\(['"]__NODE_BINARY__['"],\s*nodeBinary\)/);
  assert.match(source, /unit template.*placeholder/i);
});
