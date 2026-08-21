import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

if (process.getuid?.() !== 0) {
  throw new Error('configure-server.mjs must run as root');
}

const appRoot = '/www/wwwroot/knowledgepilot';
const bridgeRoot = path.join(appRoot, 'automation/workspace-agent');
const mainEnvFile = path.join(appRoot, '.env');
const bridgeEnvDir = '/etc/knowledgepilot';
const bridgeEnvFile = path.join(bridgeEnvDir, 'workspace-agent.env');
const nginxFile = '/www/server/panel/vhost/nginx/node_knowledgepilot.conf';
const systemdDir = '/etc/systemd/system';
const markerStart = '    # KNOWLEDGEPILOT-WORKSPACE-AGENT-MCP-START';
const markerEnd = '    # KNOWLEDGEPILOT-WORKSPACE-AGENT-MCP-END';

function parseEnv(input) {
  const values = {};
  for (const raw of String(input || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const index = line.indexOf('=');
    if (index < 1) continue;
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value.replace(/\\n/g, '\n');
  }
  return values;
}

function envValue(value) {
  const normalized = String(value ?? '');
  if (/[\r\n\0]/.test(normalized)) throw new Error('Environment values cannot contain control characters');
  return JSON.stringify(normalized);
}

function randomSecret(bytes = 48) {
  return crypto.randomBytes(bytes).toString('base64url');
}

async function optionalRead(file) {
  try {
    return await fs.readFile(file, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return '';
    throw error;
  }
}

async function atomicWrite(file, content, mode, ownership) {
  const temporary = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temporary, content, { mode });
  if (ownership) await fs.chown(temporary, ownership.uid, ownership.gid);
  await fs.rename(temporary, file);
  await fs.chmod(file, mode);
}

const mainEnv = parseEnv(await fs.readFile(mainEnvFile, 'utf8'));
const existingBridgeEnv = parseEnv(await optionalRead(bridgeEnvFile));
if (!mainEnv.GPT_ACTION_API_KEY) throw new Error('GPT_ACTION_API_KEY is missing from Knowledge Pilot .env');

const publicPath = existingBridgeEnv.MCP_PUBLIC_PATH ||
  `/kp-${randomSecret(32)}/mcp`;
if (!/^\/kp-[A-Za-z0-9_-]{40,}\/mcp$/.test(publicPath)) {
  throw new Error('Existing MCP_PUBLIC_PATH is invalid');
}

const values = {
  MCP_HOST: '127.0.0.1',
  MCP_PORT: '3110',
  MCP_PUBLIC_PATH: publicPath,
  MCP_BEARER_TOKEN: existingBridgeEnv.MCP_BEARER_TOKEN || randomSecret(48),
  KP_BASE_URL: 'http://127.0.0.1:3100',
  KP_ACTION_API_KEY: mainEnv.GPT_ACTION_API_KEY,
  KP_REQUEST_TIMEOUT_MS: '30000',
  KP_STATE_FILE: path.join(appRoot, 'data/state.json'),
  WORKSPACE_AGENT_TRIGGER_ID: existingBridgeEnv.WORKSPACE_AGENT_TRIGGER_ID || '',
  WORKSPACE_AGENT_ACCESS_TOKEN: existingBridgeEnv.WORKSPACE_AGENT_ACCESS_TOKEN || '',
  WORKSPACE_AGENT_API_BASE: 'https://api.chatgpt.com/v1',
  WORKSPACE_AGENT_CONVERSATION_PREFIX: 'knowledgepilot-automation',
  TRIGGER_MAX_TASKS: '4',
  TRIGGER_COOLDOWN_SECONDS: '900',
  TRIGGER_STALE_SECONDS: '10800',
  TRIGGER_ERROR_BACKOFF_SECONDS: '1800',
  TRIGGER_SUSPENDED_ALERT_SECONDS: '600',
  TRIGGER_USE_BETA_RUN_STATUS: 'true',
  BRIDGE_STATE_DIR: '/var/lib/knowledgepilot-workspace-agent',
  TELEGRAM_BOT_TOKEN: existingBridgeEnv.TELEGRAM_BOT_TOKEN || mainEnv.TELEGRAM_BOT_TOKEN || '',
  TELEGRAM_ALERTS_ENABLED: 'true'
};

await fs.mkdir(bridgeEnvDir, { recursive: true, mode: 0o700 });
await fs.chmod(bridgeEnvDir, 0o700);
const envContent = [
  '# Managed Knowledge Pilot Workspace Agent bridge configuration.',
  '# Contains secrets. Keep root-readable only.',
  ...Object.entries(values).map(([key, value]) => `${key}=${envValue(value)}`),
  ''
].join('\n');
await atomicWrite(bridgeEnvFile, envContent, 0o600, { uid: 0, gid: 0 });

for (const unit of [
  'knowledgepilot-mcp.service',
  'knowledgepilot-agent-trigger.service',
  'knowledgepilot-agent-trigger.timer'
]) {
  const source = path.join(bridgeRoot, 'deploy', unit);
  const target = path.join(systemdDir, unit);
  await atomicWrite(target, await fs.readFile(source, 'utf8'), 0o644, { uid: 0, gid: 0 });
}

const nginxBlock = `${markerStart}
    location = ${publicPath} {
        access_log off;
        proxy_pass http://127.0.0.1:3110/mcp;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;
        proxy_request_buffering off;
        proxy_connect_timeout 10s;
        proxy_send_timeout 120s;
        proxy_read_timeout 120s;
        client_max_body_size 4m;
    }
${markerEnd}`;

const nginxStat = await fs.stat(nginxFile);
let nginx = await fs.readFile(nginxFile, 'utf8');
const existingStart = nginx.indexOf(markerStart);
const existingEnd = nginx.indexOf(markerEnd);
if (existingStart >= 0 || existingEnd >= 0) {
  if (existingStart < 0 || existingEnd < existingStart) throw new Error('Nginx MCP marker block is malformed');
  nginx = `${nginx.slice(0, existingStart)}${nginxBlock}${nginx.slice(existingEnd + markerEnd.length)}`;
} else {
  const anchor = '    location / {';
  const anchorIndex = nginx.indexOf(anchor);
  if (anchorIndex < 0) throw new Error('Could not find the aaPanel reverse-proxy location anchor');
  nginx = `${nginx.slice(0, anchorIndex)}${nginxBlock}\n\n${nginx.slice(anchorIndex)}`;
}
await atomicWrite(
  nginxFile,
  nginx,
  nginxStat.mode & 0o777,
  { uid: nginxStat.uid, gid: nginxStat.gid }
);

process.stdout.write(`${JSON.stringify({
  ok: true,
  environmentConfigured: true,
  systemdUnitsInstalled: 3,
  nginxRouteInstalled: true,
  routePreservedOnRerun: Boolean(existingBridgeEnv.MCP_PUBLIC_PATH),
  timerEnabled: false
})}\n`);
