import path from 'node:path';
import process from 'node:process';
import { APP_VERSION } from './version.js';

function bool(name, fallback = false) {
  const value = process.env[name];
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function integer(name, fallback) {
  const value = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(value) ? value : fallback;
}

function boundedInteger(name, fallback, min, max = Number.MAX_SAFE_INTEGER) {
  return Math.min(max, Math.max(min, integer(name, fallback)));
}

function requiredInProduction(name, value) {
  if (process.env.NODE_ENV === 'production' && (!value || value.startsWith('replace-with'))) {
    throw new Error(`${name} must be configured in production`);
  }
  return value;
}

const root = process.cwd();
const dataDir = path.resolve(root, process.env.DATA_DIR || './data');
const port = boundedInteger('PORT', 3100, 1, 65535);

export const config = {
  version: APP_VERSION,
  nodeEnv: process.env.NODE_ENV || 'development',
  host: process.env.HOST || '127.0.0.1',
  port,
  appBaseUrl: (process.env.APP_BASE_URL || `http://127.0.0.1:${port}`).replace(/\/$/, ''),
  appSecret: requiredInProduction('APP_SECRET', process.env.APP_SECRET || 'development-only-secret-change-me'),
  adminToken: requiredInProduction('ADMIN_TOKEN', process.env.ADMIN_TOKEN || 'development-admin-token'),
  defaultTimezone: process.env.DEFAULT_TIMEZONE || 'Europe/Brussels',
  defaultLanguage: process.env.DEFAULT_LANGUAGE || 'ar',
  dataDir,
  stateFile: path.join(dataDir, 'state.json'),
  backupDir: path.join(dataDir, 'backups'),
  cardDir: path.join(dataDir, 'cards'),
  bookFileDir: path.join(dataDir, 'book-files'),
  logLevel: process.env.LOG_LEVEL || 'info',
  ai: {
    provider: process.env.AI_PROVIDER || 'mock',
    apiKey: process.env.AI_API_KEY || '',
    baseUrl: (process.env.AI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, ''),
    model: process.env.AI_MODEL || 'gpt-5-mini',
    ollamaBaseUrl: (process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434').replace(/\/$/, ''),
    ollamaModel: process.env.OLLAMA_MODEL || 'qwen3:8b'
  },
  research: {
    searxngUrl: (process.env.SEARXNG_URL || '').replace(/\/$/, ''),
    maxResults: boundedInteger('RESEARCH_MAX_RESULTS', 12, 1, 50),
    fetchTimeoutMs: boundedInteger('RESEARCH_FETCH_TIMEOUT_MS', 12000, 1000, 120000)
  },
  businessActions: {
    enabled: (process.env.AI_PROVIDER || 'mock') === 'chatgpt_business' || bool('GPT_ACTIONS_ENABLED', false),
    apiKey: requiredInProduction('GPT_ACTION_API_KEY', process.env.GPT_ACTION_API_KEY || 'development-gpt-action-token'),
    autoScheduleApproved: bool('GPT_AUTO_SCHEDULE_APPROVED', true),
    autoScheduleDelayMinutes: boundedInteger('GPT_AUTO_SCHEDULE_DELAY_MINUTES', 2, 0, 1440),
    claimTimeoutMinutes: boundedInteger('GPT_TASK_CLAIM_TIMEOUT_MINUTES', 30, 1, 1440),
    notifyPendingTasks: bool('GPT_NOTIFY_PENDING_TASKS', true),
    customGptUrl: process.env.CUSTOM_GPT_URL || ''
  },
  automation: {
    startFirstPlanAfterOnboarding: bool('AUTO_START_FIRST_PLAN', true),
    notifyActionRequired: bool('NOTIFY_ACTION_REQUIRED', true),
    unfinishedItemLimit: boundedInteger('UNFINISHED_ITEM_LIMIT', 3, 1, 50)
  },
  telegram: {
    enabled: bool('TELEGRAM_ENABLED', false),
    botToken: process.env.TELEGRAM_BOT_TOKEN || '',
    webhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET || ''
  },
  whatsapp: {
    enabled: bool('WHATSAPP_ENABLED', false),
    authDir: path.resolve(root, process.env.WHATSAPP_AUTH_DIR || './data/whatsapp-auth'),
    dedicatedNumber: process.env.WHATSAPP_DEDICATED_NUMBER || '',
    minSendIntervalMs: boundedInteger('WHATSAPP_MIN_SEND_INTERVAL_MS', 2500, 250, 60000)
  },
  scheduler: {
    enabled: bool('SCHEDULER_ENABLED', true),
    pollSeconds: boundedInteger('SCHEDULER_POLL_SECONDS', 30, 5, 3600),
    maxAttempts: boundedInteger('MAX_JOB_ATTEMPTS', 4, 1, 20),
    runTimeoutMinutes: boundedInteger('JOB_RUN_TIMEOUT_MINUTES', 15, 1, 1440)
  },
  backups: {
    intervalHours: boundedInteger('BACKUP_INTERVAL_HOURS', 6, 1, 168),
    retention: boundedInteger('BACKUP_RETENTION', 30, 1, 365)
  }
};
