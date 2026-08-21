import test from 'node:test';
import assert from 'node:assert/strict';
import { readFetchText } from '../src/http-response.js';

test('bounded fetch reader returns bodies within the byte limit', async () => {
  const response = new Response('hello world', { status: 200 });
  assert.equal(await readFetchText(response, 64, 'Test response'), 'hello world');
});

test('bounded fetch reader rejects and cancels a live stream when the byte limit is exceeded', async () => {
  let cancelled = false;
  const response = new Response(new ReadableStream({
    pull(controller) {
      controller.enqueue(new Uint8Array(40));
    },
    cancel() { cancelled = true; }
  }));

  await assert.rejects(
    readFetchText(response, 64, 'Test response'),
    /exceeds the 64 byte limit/i
  );
  assert.equal(cancelled, true);
});

test('bounded fetch reader counts UTF-8 bytes rather than JavaScript characters', async () => {
  const response = new Response('😀😀😀');
  await assert.rejects(
    readFetchText(response, 8, 'Unicode response'),
    /exceeds the 8 byte limit/i
  );
});
