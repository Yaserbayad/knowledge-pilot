import fs from 'node:fs/promises';
import path from 'node:path';
import { loadConfig } from './config.mjs';
import { readResponseText } from './http-response.mjs';
import { KnowledgePilotClient } from './knowledge-pilot-client.mjs';
import { canDeclareQueueEmpty, ensureTriggerIntent } from './trigger-safety.mjs';

const MAX_WORKSPACE_RESPONSE_BYTES = 2 * 1024 * 1024;
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
    const raw = await readResponseText(response, MAX_WORKSPACE_RESPONSE_BYTES, 'Workspace Agent response');
    let payload = null;
    if (raw) {
      try { payload = JSON.parse(raw); }
      catch { throw new Error(`Workspace Agent API returned invalid JSON (HTTP ${response.status})`); }
    }
    if (!response.ok) {
      const error = new Error(`Workspace Agent API returned HTTP ${response.status}`);
      error.status = response.status;
      error.code = payload?.error?.code || payload?.code || null;
      throw error;
    }
    return payload || {};
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('Workspace Agent API request timed out');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function pollRun(runId) {
  return workspaceRequest(
    `/workspace_agents/${encodeURIComponent(config.workspaceAgent.triggerId)}/runs/${encodeURIComponent(runId)}`
  );
}

async function triggerAgent(intent) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  let response;
  try {
    try {
      response = await fetch(
        `${config.workspaceAgent.apiBase}/workspace_agents/${encodeURIComponent(config.workspaceAgent.triggerId)}/trigger`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${config.workspaceAgent.accessToken}`,
            'content-type': 'application/json',
            accept: 'application/json',
            'Idempotency-Key': intent.idempotencyKey,
            ...(config.workspaceAgent.useBetaRunStatus
              ? { 'OpenAI-Beta': 'workspace_agent_runs=v1' }
              : {})
          },
          body: JSON.stringify(intent.request),
          signal: controller.signal
        }
      );
    } catch (error) {
      const wrapped = new Error(error?.name === 'AbortError'
        ? 'Workspace Agent trigger timed out before acceptance could be confirmed'
        : `Workspace Agent trigger failed before acceptance could be confirmed: ${error?.message || 'network error'}`);
      wrapped.outcomeUnknown = true;
      throw wrapped;
    }

    let raw;
    try {
      raw = await readResponseText(response, MAX_WORKSPACE_RESPONSE_BYTES, 'Workspace Agent trigger response');
    } catch (error) {
      error.status = response.status;
      error.outcomeUnknown = response.status === 202;
      throw error;
    }
    let payload = {};
    if (raw) {
      try { payload = JSON.parse(raw); } catch { payload = {}; }
    }
    if (response.status !== 202) {
      const error = new Error(`Workspace Agent trigger returned HTTP ${response.status}`);
      error.status = response.status;
      error.code = payload?.error?.code || payload?.code || null;
      error.definitiveRejected = true;
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
      await response.body?.cancel().catch(() => {});
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

async function markRunUnresolved(state, pending, reason) {
  const active = state.activeRun;
  if (!active) return;
  active.unresolvedAt ||= new Date().toISOString();
  active.unresolvedReason = String(reason || 'Workspace Agent run outcome could not be confirmed').slice(0, 500);
  await alertOnce(
    state,
    pending,
    `run-unresolved:${active.runId || active.idempotencyKey || active.triggeredAt}`,
    'Knowledge Pilot cannot confirm the outcome of an earlier Workspace Agent run. It will not start another run automatically because doing so could overlap or duplicate processing. Review the bridge state or Workspace Agent run before retrying.'
  );
  await writeState(state);
}

async function clearEmptyQueue(state) {
  state.activeRun = null;
  state.triggerIntent = null;
  state.lastEmptyAt = new Date().toISOString();
  await writeState(state);
  log('queue_empty');
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
    if (canDeclareQueueEmpty(state, pending)) {
      await clearEmptyQueue(state);
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
              'Knowledge Pilot automation failed before clearing its pending work. The bridge will respect the safety backoff before attempting another run.'
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
            await writeState(state);
          } else if (age < config.policy.staleSeconds) {
            await writeState(state);
            log('run_status_unknown', { status: run.status || 'missing' });
            return;
          } else {
            await markRunUnresolved(state, pending, `Unrecognized run status after stale threshold: ${run.status || 'missing'}`);
            log('run_outcome_unresolved', { status: run.status || 'missing' });
            return;
          }
        } catch (error) {
          state.activeRun.lastStatusCheckError = String(error?.message || 'unknown').slice(0, 500);
          state.activeRun.lastCheckedAt = new Date().toISOString();
          if (age < config.policy.staleSeconds) {
            await writeState(state);
            log('run_status_check_failed', { status: error?.status || null });
            return;
          }
          await markRunUnresolved(state, pending, state.activeRun.lastStatusCheckError);
          log('run_outcome_unresolved', { status: error?.status || null });
          return;
        }
      } else if (age < config.policy.staleSeconds) {
        log('run_cooldown_without_status', { ageSeconds: Math.round(age) });
        return;
      } else {
        await markRunUnresolved(state, pending, 'No authoritative run-status identifier is available after the stale threshold');
        log('run_outcome_unresolved', { status: 'unavailable' });
        return;
      }
    }

    if (canDeclareQueueEmpty(state, pending)) {
      await clearEmptyQueue(state);
      return;
    }

    if (secondsSince(state.lastErrorAt) < config.policy.errorBackoffSeconds) {
      log('error_backoff_active');
      return;
    }
    if (secondsSince(state.lastTriggeredAt) < config.policy.cooldownSeconds) {
      log('trigger_cooldown_active');
      return;
    }

    const prepared = ensureTriggerIntent(state, pending, {
      maxTasks: config.policy.maxTasks,
      conversationPrefix: config.workspaceAgent.conversationPrefix
    });
    if (prepared.created) {
      // This durable write must complete before the external POST. If the POST
      // later has an unknown outcome, the next invocation reuses this exact
      // idempotency key and request instead of creating a potentially duplicate run.
      await writeState(state);
    } else if (secondsSince(prepared.intent.createdAt) >= config.policy.staleSeconds) {
      await alertOnce(
        state,
        pending,
        `trigger-intent-unresolved:${prepared.intent.idempotencyKey}`,
        'Knowledge Pilot cannot confirm whether an earlier Workspace Agent trigger was accepted. It will not create a new idempotency key or start overlapping work automatically.'
      );
      await writeState(state);
      log('trigger_intent_unresolved', { queueChanged: prepared.queueChanged });
      return;
    } else if (prepared.queueChanged) {
      log('trigger_retry_queue_changed', { pending: pending.length });
    }

    try {
      const accepted = await triggerAgent(prepared.intent);
      const runId = accepted.agent_trigger_run_id || null;
      state.lastTriggeredAt = new Date().toISOString();
      state.activeRun = {
        triggeredAt: state.lastTriggeredAt,
        fingerprint: prepared.intent.fingerprint,
        idempotencyKey: prepared.intent.idempotencyKey,
        runId,
        conversationUrl: accepted.conversation_url || null,
        taskCountAtTrigger: prepared.intent.taskCount,
        lastStatus: 'queued'
      };
      state.triggerIntent = null;
      state.lastErrorAt = null;
      state.lastTriggerError = null;
      await writeState(state);
      log('trigger_accepted', {
        pending: pending.length,
        runStatusAvailable: Boolean(runId),
        reusedIntent: !prepared.created
      });
    } catch (error) {
      state.lastErrorAt = new Date().toISOString();
      state.lastTriggerError = {
        at: state.lastErrorAt,
        status: error?.status || null,
        code: error?.code || null,
        outcomeUnknown: Boolean(error?.outcomeUnknown),
        definitiveRejected: Boolean(error?.definitiveRejected),
        idempotencyKey: prepared.intent.idempotencyKey,
        message: String(error?.message || 'unknown').slice(0, 500)
      };
      await alertOnce(
        state,
        pending,
        `trigger-error:${prepared.intent.idempotencyKey}`,
        error?.outcomeUnknown
          ? 'Knowledge Pilot could not confirm whether its Workspace Agent trigger was accepted. The exact trigger intent and idempotency key were preserved; any automatic retry will reuse them rather than start duplicate work.'
          : 'Knowledge Pilot could not start its Workspace Agent. The exact trigger intent remains durable for a safe retry after the backoff.'
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
