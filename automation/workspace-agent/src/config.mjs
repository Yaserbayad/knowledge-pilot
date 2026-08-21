import net from 'node:net';
import path from 'node:path';

function text(name, fallback = '') {
  const value = process.env[name];
  return value == null ? fallback : String(value).trim();
}

function bool(name, fallback = false) {
  const value = text(name);
  if (!value) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function integer(name, fallback, min, max) {
  const value = Number.parseInt(text(name), 10);
  const resolved = Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, resolved));
}

function loopbackHost(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host === '::1') return true;
  return net.isIP(host) === 4 && host.split('.')[0] === '127';
}

function url(name, fallback, { credentials = false } = {}) {
  const value = text(name, fallback).replace(/\/+$/, '');
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute URL`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`${name} must use HTTP or HTTPS`);
  }
  if (parsed.username || parsed.password) {
    throw new Error(`${name} must not contain embedded credentials`);
  }
  if (credentials && parsed.protocol !== 'https:' && !loopbackHost(parsed.hostname)) {
    throw new Error(`${name} must use HTTPS when bearer credentials are sent to a non-loopback host`);
  }
  return value;
}

export function loadConfig({ requireMcp = false, requireTrigger = false } = {}) {
  const mcpHost = text('MCP_HOST', '127.0.0.1');
  if (requireMcp && !loopbackHost(mcpHost)) {
    throw new Error('MCP_HOST must be an explicit loopback host');
  }

  const config = {
    mcp: {
      host: mcpHost,
      port: integer('MCP_PORT', 3110, 1, 65535),
      bearerToken: text('MCP_BEARER_TOKEN')
    },
    knowledgePilot: {
      baseUrl: url('KP_BASE_URL', 'http://127.0.0.1:3100', { credentials: true }),
      apiKey: text('KP_ACTION_API_KEY'),
      timeoutMs: integer('KP_REQUEST_TIMEOUT_MS', 30000, 1000, 120000),
      stateFile: path.resolve(text('KP_STATE_FILE', '/www/wwwroot/knowledgepilot/data/state.json'))
    },
    workspaceAgent: {
      triggerId: text('WORKSPACE_AGENT_TRIGGER_ID'),
      accessToken: text('WORKSPACE_AGENT_ACCESS_TOKEN'),
      apiBase: url('WORKSPACE_AGENT_API_BASE', 'https://api.chatgpt.com/v1', { credentials: true }),
      conversationPrefix: text('WORKSPACE_AGENT_CONVERSATION_PREFIX', 'knowledgepilot-automation'),
      useBetaRunStatus: bool('TRIGGER_USE_BETA_RUN_STATUS', true)
    },
    policy: {
      maxTasks: integer('TRIGGER_MAX_TASKS', 4, 1, 10),
      cooldownSeconds: integer('TRIGGER_COOLDOWN_SECONDS', 900, 60, 86400),
      staleSeconds: integer('TRIGGER_STALE_SECONDS', 10800, 900, 86400),
      errorBackoffSeconds: integer('TRIGGER_ERROR_BACKOFF_SECONDS', 1800, 60, 86400),
      suspendedAlertSeconds: integer('TRIGGER_SUSPENDED_ALERT_SECONDS', 600, 60, 86400)
    },
    runtime: {
      stateDir: path.resolve(text('BRIDGE_STATE_DIR', '/var/lib/knowledgepilot-workspace-agent'))
    },
    telegram: {
      enabled: bool('TELEGRAM_ALERTS_ENABLED', true),
      botToken: text('TELEGRAM_BOT_TOKEN')
    }
  };

  const errors = [];
  if (!config.knowledgePilot.apiKey || config.knowledgePilot.apiKey.startsWith('replace-with')) {
    errors.push('KP_ACTION_API_KEY is not configured');
  }
  if (requireMcp && (
    config.mcp.bearerToken.length < 32 ||
    config.mcp.bearerToken.startsWith('replace-with')
  )) {
    errors.push('MCP_BEARER_TOKEN must contain at least 32 random characters');
  }
  if (requireTrigger) {
    if (!/^agtch_[A-Za-z0-9_-]+$/.test(config.workspaceAgent.triggerId)) {
      errors.push('WORKSPACE_AGENT_TRIGGER_ID must be a valid agtch_ identifier');
    }
    if (config.workspaceAgent.accessToken.length < 20) {
      errors.push('WORKSPACE_AGENT_ACCESS_TOKEN is not configured');
    }
  }
  if (errors.length) throw new Error(errors.join('; '));
  return config;
}

export function publicConfig(config) {
  return {
    mcp: { host: config.mcp.host, port: config.mcp.port, authenticated: Boolean(config.mcp.bearerToken) },
    knowledgePilot: { baseUrl: config.knowledgePilot.baseUrl, configured: Boolean(config.knowledgePilot.apiKey) },
    workspaceAgent: {
      triggerIdConfigured: Boolean(config.workspaceAgent.triggerId),
      accessTokenConfigured: Boolean(config.workspaceAgent.accessToken),
      apiBase: config.workspaceAgent.apiBase,
      betaRunStatus: config.workspaceAgent.useBetaRunStatus
    },
    policy: config.policy,
    telegramAlerts: config.telegram.enabled && Boolean(config.telegram.botToken),
    stateDir: config.runtime.stateDir
  };
}
