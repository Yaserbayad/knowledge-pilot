import crypto from 'node:crypto';

export function taskFingerprint(tasks) {
  return crypto.createHash('sha256')
    .update((Array.isArray(tasks) ? tasks : []).map((task) => `${task.id}:${task.updatedAt || task.createdAt || ''}`).join('|'))
    .digest('hex')
    .slice(0, 32);
}

export function canDeclareQueueEmpty(state, tasks) {
  return (!Array.isArray(tasks) || tasks.length === 0)
    && !state?.activeRun
    && !state?.triggerIntent;
}

function triggerInput(tasks, maxTasks) {
  const types = [...new Set((Array.isArray(tasks) ? tasks : []).slice(0, maxTasks).map((task) => task.type))];
  return [
    `Process up to ${maxTasks} pending Knowledge Pilot tasks autonomously.`,
    'Start by listing pending tasks and process them in descending priority, one at a time.',
    'For each task: load context, claim it, perform careful web research when required, follow the dynamic result contract, run adversarial review and final audit, then submit through the correct tool.',
    'Correct and resubmit retryable HTTP 422 or contract errors. Report failure only for genuine evidence or safety impossibility.',
    `Expected pending task types include: ${types.join(', ') || 'unknown'}.`,
    'Stop after the task limit or when the pending queue is empty. Do not ask the user to confirm routine Knowledge Pilot tool actions.'
  ].join(' ');
}

function createTriggerIntent(tasks, {
  maxTasks,
  conversationPrefix,
  now = () => new Date(),
  randomUUID = crypto.randomUUID
}) {
  const createdAt = now().toISOString();
  const fingerprint = taskFingerprint(tasks);
  const idempotencyKey = crypto.createHash('sha256')
    .update(`${fingerprint}:${createdAt}:${randomUUID()}`)
    .digest('hex');
  return {
    createdAt,
    fingerprint,
    idempotencyKey,
    taskCount: Array.isArray(tasks) ? tasks.length : 0,
    request: {
      conversation_key: `${conversationPrefix}-${createdAt.slice(0, 10)}`,
      input: triggerInput(tasks, maxTasks)
    }
  };
}

export function ensureTriggerIntent(state, tasks, options) {
  const currentFingerprint = taskFingerprint(tasks);
  if (state.triggerIntent) {
    return {
      intent: state.triggerIntent,
      created: false,
      queueChanged: state.triggerIntent.fingerprint !== currentFingerprint
    };
  }
  const intent = createTriggerIntent(tasks, options);
  state.triggerIntent = intent;
  return { intent, created: true, queueChanged: false };
}
