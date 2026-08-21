import path from 'node:path';
import process from 'node:process';
import { APP_VERSION } from './version.js';

const ALLOWED_PROVIDERS = new Set(['chatgpt_business', 'mock', 'openai_compatible', 'ollama']);
const ALLOWED_LANGUAGES = new Set(['ar', 'en', 'nl']);

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

function productionSecret(name, value, minLength) {
  if (process.env.NODE_ENV !== 'production') return value;
  const text = String(value || '');
  if (!text || text.length < minLength || text.includes('replace-with') || text.includes('development')) {
    throw new Error(`${name} must be configured with at least ${minLength} non-placeholder characters in production`);
  }
  return text;
}

function isLoopbackHostname(hostname) {
  const host = String(hostname || '').toLowerCase();
  return host === 'localhost' || host === '::1' || host === '[::1]' || host.startsWith('127.');
}

function serviceUrl(name, value, { required = true, requireHttpsInProduction = false, allowLoopbackHttp = false } = {}) {
  const text = String(value || '').replace(/\/$/, '');
  if (!text) {
    if (required) throw new Error(`${name} must be configured`);
    return '';
  }
  let url;
  try { url = new URL(text); } catch { throw new Error(`${name} must be a valid URL`); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error(`${name} must use HTTP or HTTPS`);
  if (url.username || url.password) throw new Error(`${name} must not contain embedded credentials`);
  if (process.env.NODE_ENV === 'production' && requireHttpsInProduction && url.protocol !== 'https:') {
    if (!allowLoopbackHttp || !isLoopbackHostname(url.hostname)) {
      throw new Error(`${name} must use HTTPS in production unless it targets an explicit loopback host`);
    }
  }
  return text;
}

function timezone(name, value) {
  const text = String(value || '');
  try { new Intl.DateTimeFormat('en-US', { timeZone: text }).format(new Date(0)); }
  catch { throw new Error(`${name} must be a supported IANA timezone`); }
  return text;
}

function language(name, value) {
  const text = String(value || '').toLowerCase();
  if (!ALLOWED_LANGUAGES.has(text)) throw new Error(`${name} must be one of: ${[...ALLOWED_LANGUAGES].join(', ')}`);
  return text;
}

const root = process.cwd();
const dataDir = path.resolve(root, process.env.DATA_DIR || './data');
const port = boundedInteger('PORT', 3100, 1, 65535);
const nodeEnv = process.env.NODE_ENV || 'development';
const provider = process.env.AI_PROVIDER || 'mock';
if (!ALLOWED_PROVIDERS.has(provider)) throw new Error(`Unsupported AI_PROVIDER: ${provider}`);

const appBaseUrl = serviceUrl('APP_BASE_URL', process.env.APP_BASE_URL || `http://127.0.0.1:${port}`, {
  requireHttpsInProduction: true,
  allowLoopbackHttp: false
});
const appSecret = productionSecret('APP_SECRET', process.env.APP_SECRET || 'development-only-secret-change-me', 32);
const adminToken = productionSecret('ADMIN_TOKEN', process.env.ADMIN_TOKEN || 'development-admin-token', 24);
const defaultTimezone = timezone('DEFAULT_TIMEZONE', process.env.DEFAULT_TIMEZONE || 'Europe/Brussels');
const defaultLanguage = language('DEFAULT_LANGUAGE', process.env.DEFAULT_LANGUAGE || 'ar');
const actionsEnabled = provider === 'chatgpt_business' || bool('GPT_ACTIONS_ENABLED', false);
const gptActionApiKey = actionsEnabled
  ? productionSecret('GPT_ACTION_API_KEY', process.env.GPT_ACTION_API_KEY || 'development-gpt-action-token', 32)
  : (process.env.GPT_ACTION_API_KEY || '');
const telegramEnabled = bool('TELEGRAM_ENABLED', false);
const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN || '';
const telegramWebhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET || '';
if (nodeEnv === 'production' && telegramEnabled) {
  if (!telegramBotToken) throw new Error('TELEGRAM_BOT_TOKEN must be configured when Telegram is enabled in production');
  productionSecret('TELEGRAM_WEBHOOK_SECRET', telegramWebhookSecret, 24);
}
const aiApiKey = process.env.AI_API_KEY || '';
if (nodeEnv === 'production' && provider === 'openai_compatible' && !aiApiKey) {
  throw new Error('AI_API_KEY must be configured for openai_compatible mode in production');
}

export const config = {
  version: APP_VERSION,
  nodeEnv,
  host: process.env.HOST || '127.0.0.1',
  port,
  appBaseUrl,
  appSecret,
  adminToken,
  defaultTimezone,
  defaultLanguage,
  dataDir,
  stateFile: path.join(dataDir, 'state.json'),
  backupDir: path.join(dataDir, 'backups'),
  cardDir: path.join(dataDir, 'cards'),
  bookFileDir: path.join(dataDir, 'book-files'),
  logLevel: process.env.LOG_LEVEL || 'info',
  ai: {
    provider,
    apiKey: aiApiKey,
    baseUrl: serviceUrl('AI_BASE_URL', process.env.AI_BASE_URL || 'https://api.openai.com/v1', {
      requireHttpsInProduction: true,
      allowLoopbackHttp: true
    }),
    model: process.env.AI_MODEL || 'gpt-5-mini',
    ollamaBaseUrl: serviceUrl('OLLAMA_BASE_URL', process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434', {
      requireHttpsInProduction: true,
      allowLoopbackHttp: true
    }),
    ollamaModel: process.env.OLLAMA_MODEL || 'qwen3:8b'
  },
  research: {
    searxngUrl: serviceUrl('SEARXNG_URL', process.env.SEARXNG_URL || '', {
      required: false,
      requireHttpsInProduction: true,
      allowLoopbackHttp: true
    }),
    maxResults: boundedInteger('RESEARCH_MAX_RESULTS', 12, 1, 50),
    fetchTimeoutMs: boundedInteger('RESEARCH_FETCH_TIMEOUT_MS', 12000, 1000, 120000)
  },
  businessActions: {
    enabled: actionsEnabled,
    apiKey: gptActionApiKey,
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
    enabled: telegramEnabled,
    botToken: telegramBotToken,
    webhookSecret: telegramWebhookSecret
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