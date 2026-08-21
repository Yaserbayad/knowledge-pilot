import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

async function waitForHealth(url) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('MCP test server did not start');
}

test('MCP server permits schema discovery but requires bearer auth for every tool call', async (t) => {
  const port = 39110;
  const token = 'test-token-'.padEnd(64, 'x');
  const child = spawn(process.execPath, ['src/mcp-server.mjs'], {
    cwd: new URL('..', import.meta.url),
    env: {
      ...process.env,
      MCP_HOST: '127.0.0.1',
      MCP_PORT: String(port),
      MCP_BEARER_TOKEN: token,
      KP_ACTION_API_KEY: 'test-knowledge-pilot-key',
      KP_BASE_URL: 'http://127.0.0.1:39999'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  t.after(() => child.kill('SIGTERM'));

  await waitForHealth(`http://127.0.0.1:${port}/health`);
  const discoveryClient = new Client({ name: 'bridge-discovery-test', version: '1.0.0' });
  const discoveryTransport = new StreamableHTTPClientTransport(
    new URL(`http://127.0.0.1:${port}/mcp`)
  );
  await discoveryClient.connect(discoveryTransport);
  t.after(() => discoveryClient.close());
  const discovered = await discoveryClient.listTools();
  assert.equal(discovered.tools.length, 8);
  const unauthorizedCall = await discoveryClient.callTool({
    name: 'get_knowledge_pilot_health',
    arguments: {}
  });
  assert.equal(unauthorizedCall.isError, true);
  assert.match(unauthorizedCall.content[0].text, /Authentication required/);

  const client = new Client({ name: 'bridge-test', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(
    new URL(`http://127.0.0.1:${port}/mcp`),
    { requestInit: { headers: { authorization: `Bearer ${token}` } } }
  );
  await client.connect(transport);
  t.after(() => client.close());
  const listed = await client.listTools();
  assert.deepEqual(
    listed.tools.map((tool) => tool.name).sort(),
    [
      'claim_knowledge_task',
      'get_knowledge_pilot_health',
      'get_knowledge_task_context',
      'get_owned_book_source_text',
      'list_knowledge_tasks',
      'report_knowledge_task_failure',
      'submit_book_analysis_result',
      'submit_knowledge_task_result'
    ]
  );
});
