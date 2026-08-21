import assert from 'node:assert/strict';
import test from 'node:test';
import { canDeclareQueueEmpty, ensureTriggerIntent, taskFingerprint } from '../src/trigger-safety.mjs';

const options = {
  maxTasks: 4,
  conversationPrefix: 'knowledgepilot-automation',
  now: () => new Date('2026-08-21T12:00:00.000Z'),
  randomUUID: () => '11111111-2222-4333-8444-555555555555'
};

const queueA = [
  { id: 'task_1', type: 'lesson', updatedAt: '2026-08-21T11:00:00.000Z' },
  { id: 'task_2', type: 'book_analysis', updatedAt: '2026-08-21T11:01:00.000Z' }
];

const queueB = [
  ...queueA,
  { id: 'task_3', type: 'weekly_plan', updatedAt: '2026-08-21T11:02:00.000Z' }
];

test('trigger intent captures the idempotency key and exact request before external POST', () => {
  const state = {};
  const prepared = ensureTriggerIntent(state, queueA, options);

  assert.equal(prepared.created, true);
  assert.equal(state.triggerIntent.idempotencyKey, prepared.intent.idempotencyKey);
  assert.equal(state.triggerIntent.fingerprint, taskFingerprint(queueA));
  assert.equal(state.triggerIntent.request.conversation_key, 'knowledgepilot-automation-2026-08-21');
  assert.match(state.triggerIntent.request.input, /lesson, book_analysis/);
});

test('ambiguous retry reuses the exact persisted key and request', () => {
  const state = {};
  const first = ensureTriggerIntent(state, queueA, options);
  const original = structuredClone(first.intent);

  const retry = ensureTriggerIntent(state, queueA, {
    ...options,
    now: () => new Date('2026-08-21T12:10:00.000Z'),
    randomUUID: () => 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
  });

  assert.equal(retry.created, false);
  assert.deepEqual(retry.intent, original);
  assert.equal(retry.queueChanged, false);
});

test('changed queue never replaces an unresolved prior trigger intent', () => {
  const state = {};
  const first = ensureTriggerIntent(state, queueA, options);
  const retry = ensureTriggerIntent(state, queueB, {
    ...options,
    randomUUID: () => 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
  });

  assert.equal(retry.created, false);
  assert.equal(retry.queueChanged, true);
  assert.equal(retry.intent.idempotencyKey, first.intent.idempotencyKey);
  assert.equal(retry.intent.fingerprint, taskFingerprint(queueA));
  assert.deepEqual(retry.intent.request, first.intent.request);
});

test('an empty pending queue is not authoritative while a run or trigger outcome is unresolved', () => {
  assert.equal(canDeclareQueueEmpty({ activeRun: { runId: 'run_1' } }, []), false);
  assert.equal(canDeclareQueueEmpty({ triggerIntent: { idempotencyKey: 'idem_1' } }, []), false);
  assert.equal(canDeclareQueueEmpty({}, []), true);
  assert.equal(canDeclareQueueEmpty({}, queueA), false);
});
