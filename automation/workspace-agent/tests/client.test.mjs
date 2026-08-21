import assert from 'node:assert/strict';
import test from 'node:test';
import { KnowledgePilotClient, safeError } from '../src/knowledge-pilot-client.mjs';

function clientWith(handler) {
  return new KnowledgePilotClient(
    { baseUrl: 'http://127.0.0.1:3100', apiKey: 'secret', timeoutMs: 1000 },
    handler
  );
}

test('client authenticates and lists bounded pending tasks', async () => {
  const client = clientWith(async (url, options) => {
    assert.equal(options.headers.authorization, 'Bearer secret');
    assert.match(url, /status=pending/);
    assert.match(url, /limit=100/);
    return new Response(JSON.stringify([{ id: 'task_1' }]), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  });
  assert.deepEqual(await client.listTasks({ status: 'pending', limit: 999 }), [{ id: 'task_1' }]);
});

test('client rejects path injection and invalid failure reasons', async () => {
  const client = clientWith(() => {
    throw new Error('fetch should not be called');
  });
  assert.throws(() => client.getTask('../state.json'), /invalid/);
  assert.throws(() => client.failTask('task_1', 'short'), /between 10/);
});

test('client forwards retryable contract diagnostics without secrets', async () => {
  const client = clientWith(async () => new Response(JSON.stringify({
    error: 'RESULT_CONTRACT_INVALID',
    details: ['plan.sessions must contain at least four entries']
  }), {
    status: 422,
    headers: { 'content-type': 'application/json' }
  }));
  let caught;
  try {
    await client.submitBookAnalysis('task_1', { contractVersion: 'book-analysis.v2' });
  } catch (error) {
    caught = safeError(error);
  }
  assert.equal(caught.status, 422);
  assert.equal(caught.details.error, 'RESULT_CONTRACT_INVALID');
  assert.doesNotMatch(JSON.stringify(caught), /Bearer secret/);
});

test('book text limits are bounded before calling the API', async () => {
  const client = clientWith(async (url) => {
    assert.match(url, /offset=0/);
    assert.match(url, /limit=24000/);
    return new Response(JSON.stringify({
      offset: 0,
      limit: 24000,
      totalCharacters: 1,
      text: 'x',
      nextOffset: null
    }), { status: 200 });
  });
  await client.getBookText('book_1', { offset: -5, limit: 999999 });
});
