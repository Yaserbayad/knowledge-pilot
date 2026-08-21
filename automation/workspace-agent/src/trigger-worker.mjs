import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { loadConfig } from './config.mjs';
import { KnowledgePilotClient } from './knowledge-pilot-client.mjs';

const config = loadConfig({ requireTrigger: true });
const client = new KnowledgePilotClient(config.knowledgePilot);
const stateFile = path.join(config.runtime.stateDir, 'trigger-state.json');
const lockFile = path.join(config.runtime.stateDir, 'trigger.lock');

function log(event, fields = {}) {
  process.stdout.write(`${JSON.stringify({
    time: new Date().toISOString(),
    event,
    ...fields
  })}\n`);
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return fallback;
    throw error;
  }
}

async function writeState(state) {
  const temporary = `${stateFile}.${process.pid}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(temporary, stateFile);
}

function secondsSince(value) {
  const timestamp = Date.parse(value || '');
  return Number.isFinite(timestamp) ? Math.max(0, (Date.now() - timestamp) / 1000) : Infinity;
}

function taskFingerprint(tasks) {
  return crypto.createHash('sha256')
    .update(tasks.map((task) => `${task.id}:${task.updatedAt || task.createdAt || ''}`).join('|'))
    .digest('hex')
    .slice(0, 32);
}

function idempotencyKey(fingerprint) {
  return crypto.createHash('sha256')
    .update(`${fingerprint}:${new Date().toISOString()}:${crypto.randomUUID()}`)
    .digest('hex');
}

function dailyConversationKey() {
  const day = new Date().toISOString().slice(0, 10);
  return `${config.workspaceAgent.conversationPrefix}-${day}`;
}

async function workspaceRequest(pathname, { method = 'GET', body, beta = false } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(`${config.workspaceAgent.apiBase}${pathname}`, {
      method,
      headers: {
        authorization: `Bearer ${config.workspaceAgent.accessToken}`,
        accept: 'application/json',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(beta ? { 'OpenAI-Beta': 'workspace_agent_runs=v1' } : {})
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal
    });
    const raw = await response.text();
    let payload = null;
    if (raw) {
      try { payload = JSON.parse(raw); } catch { payload = null; }
    }
    if (!response.ok) {
      const error = new Error(`Workspace Agent API returned HTTP ${response.status}`);
      error.status = response.status;
      error.code = payload?.error?.code || payload?.code || null;
      throw error;
    }
    return payload || {};
  } finally {
    clearTimeout(timeout);
  }
}

async function pollRun(runId) {
  return workspaceRequest(
    `/workspace_agents/${encodeURIComponent(config.workspaceAgent.triggerId)}/runs/${encodeURIComponent(runId)}`
  );
}

async function triggerAgent(tasks, key) {
  const types = [...new Set(tasks.slice(0, config.policy.maxTasks).map((task) => task.type))];
  const input = [
    `Process up to ${config.policy.maxTasks} pending Knowledge Pilot tasks autonomously.`,
    'Start by listing pending tasks and process them in descending priority, one at a time.',
    'For each task: load context, claim it, perform careful web research when required, follow the dynamic result contract, run adversarial review and final audit, then submit through the correct tool.',
    'Correct and resubmit retryable HTTP 422 or contract errors. Report failure only for genuine evidence or safety impossibility.',
    `Expected pending task types include: ${types.join(', ') || 'unknown'}.`,
    'Stop after the task limit or when the pending queue is empty. Do not ask the user to confirm routine Knowledge Pilot tool actions.'
  ].join(' ');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(
      `${config.workspaceAgent.apiBase}/workspace_agents/${encodeURIComponent(config.workspaceAgent.triggerId)}/trigger`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${config.workspaceAgent.accessToken}`,
          'content-type': 'application/json',
          accept: 'application/json',
          'Idempotency-Key': key,
          ...(config.workspaceAgent.useBetaRunStatus
            ? { 'OpenAI-Beta': 'workspace_agent_runs=v1' }
            : {})
        },
        body: JSON.stringify({
          conversation_key: dailyConversationKey(),
          input
        }),
        signal: controller.signal
      }
    );
    const raw = await response.text();
    let payload = {};
    if (raw) {
      try { payload = JSON.parse(raw); } catch { payload = {}; }
    }
    if (response.status !== 202) {
      const error = new Error(`Workspace Agent trigger returned HTTP ${response.status}`);
      error.status = response.status;
      error.code = payload?.error?.code || payload?.code || null;
      throw error;
    }
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

async function affectedChatIds(tasks) {
  if (!config.telegram.enabled || !config.telegram.botToken) return [];
  try {
    const state = JSON.parse(await fs.readFile(config.knowledgePilot.stateFile, 'utf8'));
    const userIds = new Set(tasks.map((task) => task.userId).filter(Boolean));
    return [...new Set(Object.values(state.users || {})
      .filter((user) => userIds.has(user.id) && user.telegramChatId)
      .map((user) => String(user.telegramChatId)))];
  } catch (error) {
    log('telegram_recipient_lookup_failed', { message: String(error?.message || 'unknown').slice(0, 300) });
    return [];
  }
}

async function telegramAlert(tasks, message) {
  const chatIds = await affectedChatIds(tasks);
  for (const chatId of chatIds) {
    try {
      const response = await fetch(
        `https://api.telegram.org/bot${config.telegram.botToken}/sendMessage`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, text: message, disable_web_page_preview: true })
        }
      );
      if (!response.ok) log('telegram_alert_failed', { status: response.status });
    } catch (error) {
      log('telegram_alert_failed', { message: String(error?.message || 'unknown').slice(0, 300) });
    }
  }
}

async function alertOnce(state, tasks, key, message) {
  if (state.lastAlertKey === key && secondsSince(state.lastAlertAt) < 86400) return;
  await telegramAlert(tasks, message);
  state.lastAlertKey = key;
  state.lastAlertAt = new Date().toISOString();
}

async function acquireLock() {
  try {
    return await fs.open(lockFile, 'wx', 0o600);
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    const details = await fs.stat(lockFile).catch(() => null);
    const ageSeconds = details ? Math.max(0, (Date.now() - details.mtimeMs) / 1000) : 0;
    if (details && ageSeconds > 600) {
      await fs.unlink(lockFile).catch(() => {});
      return fs.open(lockFile, 'wx', 0o600);
    }
    return null;
  }
}

async function main() {
  await fs.mkdir(config.runtime.stateDir, { recursive: true, mode: 0o700 });
  const lock = await acquireLock();
  if (!lock) {
    log('already_running');
    return;
  }

  try {
    const state = await readJson(stateFile, {});
    const pending = await client.listTasks({ status: 'pending', limit: 100 });
    if (!pending.length) {
      state.activeRun = null;
      state.lastEmptyAt = new Date().toISOString();
      await writeState(state);
      log('queue_empty');
      return;
    }

    if (state.activeRun) {
      const age = secondsSince(state.activeRun.triggeredAt);
      if (state.activeRun.runId && config.workspaceAgent.useBetaRunStatus) {
        try {
          const run = await pollRun(state.activeRun.runId);
          state.activeRun.lastStatus = run.status;
          state.activeRun.lastCheckedAt = new Date().toISOString();
          if (['queued', 'in_progress'].includes(run.status)) {
            await writeState(state);
            log('run_active', { status: run.status, ageSeconds: Math.round(age) });
            return;
          }
          if (run.status === 'suspended') {
            if (age >= config.policy.suspendedAlertSeconds) {
              await alertOnce(
                state,
                pending,
                `suspended:${state.activeRun.runId}`,
                'Knowledge Pilot automation is paused and needs attention in ChatGPT. Open the Workspace Agent run and complete the requested approval or connection.'
              );
            }
            await writeState(state);
            log('run_suspended', { ageSeconds: Math.round(age) });
            return;
          }
          if (run.status === 'failed') {
            await alertOnce(
              state,
              pending,
              `failed:${state.activeRun.runId}`,
              'Knowledge Pilot automation failed before clearing its pending work. The server will retry after the safety backoff; check the Workspace Agent run if the notice repeats.'
            );
            state.lastErrorAt = new Date().toISOString();
            state.activeRun = null;
            await writeState(state);
            log('run_failed', { code: run.error?.code || 'unknown' });
            return;
          }
          if (run.status === 'completed') {
            state.lastCompletedAt = new Date().toISOString();
            state.activeRun = null;
          } else if (age < config.policy.staleSeconds) {
            await writeState(state);
            log('run_status_unknown', { status: run.status || 'missing' });
            return;
          } else {
            state.activeRun = null;
          }
        } catch (error) {
          if (age < config.policy.staleSeconds) {
            log('run_status_check_failed', { status: error?.status || null });
            return;
          }
          state.activeRun = null;
        }
      } else if (age < config.policy.staleSeconds) {
        log('run_cooldown_without_status', { ageSeconds: Math.round(age) });
        return;
      } else {
        state.activeRun = null;
      }
    }

    if (secondsSince(state.lastErrorAt) < config.policy.errorBackoffSeconds) {
      log('error_backoff_active');
      return;
    }
    if (secondsSince(state.lastTriggeredAt) < config.policy.cooldownSeconds) {
      log('trigger_cooldown_active');
      return;
    }

    const fingerprint = taskFingerprint(pending);
    const key = idempotencyKey(fingerprint);
    try {
      const accepted = await triggerAgent(pending, key);
      const runId = accepted.agent_trigger_run_id || null;
      state.lastTriggeredAt = new Date().toISOString();
      state.activeRun = {
        triggeredAt: state.lastTriggeredAt,
        fingerprint,
        idempotencyKey: key,
        runId,
        conversationUrl: accepted.conversation_url || null,
        taskCountAtTrigger: pending.length,
        lastStatus: 'queued'
      };
      state.lastErrorAt = null;
      await writeState(state);
      log('trigger_accepted', {
        pending: pending.length,
        runStatusAvailable: Boolean(runId)
      });
    } catch (error) {
      state.lastErrorAt = new Date().toISOString();
      state.lastTriggerError = {
        at: state.lastErrorAt,
        status: error?.status || null,
        code: error?.code || null,
        message: String(error?.message || 'unknown').slice(0, 500)
      };
      await alertOnce(
        state,
        pending,
        `trigger-error:${error?.status || 'network'}:${error?.code || 'unknown'}`,
        'Knowledge Pilot could not start its autonomous research agent. Pending work is safe and will retry automatically. Check the server automation if this notice repeats.'
      );
      await writeState(state);
      throw error;
    }
  } finally {
    await lock?.close().catch(() => {});
    await fs.unlink(lockFile).catch(() => {});
  }
}

main().catch((error) => {
  log('worker_failed', {
    status: error?.status || null,
    code: error?.code || null,
    message: String(error?.message || 'unknown').slice(0, 500)
  });
  process.exitCode = 1;
});
