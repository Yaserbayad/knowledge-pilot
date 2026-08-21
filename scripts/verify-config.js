import fs from 'node:fs/promises';
import { loadEnv } from '../src/env.js';

loadEnv();
const { config } = await import('../src/config.js');

const failures = [];
const warnings = [];
const allowedProviders = new Set(['chatgpt_business', 'mock', 'openai_compatible', 'ollama']);
const secretChecks = [
  ['APP_SECRET', config.appSecret, 32],
  ['ADMIN_TOKEN', config.adminToken, 24],
  ['GPT_ACTION_API_KEY', config.businessActions.apiKey, 32]
];
for (const [name, value, min] of secretChecks) {
  if (!value || value.length < min || value.includes('replace-with') || value.includes('development')) failures.push(`${name} is missing, a placeholder, or shorter than ${min} characters`);
}
if (config.nodeEnv === 'production' && !config.appBaseUrl.startsWith('https://')) failures.push('APP_BASE_URL must use HTTPS in production');
if (/example\.com/i.test(config.appBaseUrl)) warnings.push('APP_BASE_URL still appears to use an example domain');
if (!allowedProviders.has(config.ai.provider)) failures.push(`Unsupported AI_PROVIDER: ${config.ai.provider}`);
if (config.ai.provider === 'chatgpt_business' && !config.businessActions.enabled) failures.push('GPT Actions must be enabled for chatgpt_business mode');
if (config.ai.provider === 'chatgpt_business' && !config.businessActions.customGptUrl) warnings.push('CUSTOM_GPT_URL is empty; action-required notices cannot link directly to the processing GPT');
if (config.ai.provider === 'chatgpt_business' && !config.businessActions.notifyPendingTasks) warnings.push('GPT_NOTIFY_PENDING_TASKS is disabled; learners will not be notified when verified processing is waiting');
if (!config.businessActions.autoScheduleApproved) warnings.push('GPT_AUTO_SCHEDULE_APPROVED is disabled; validated content will wait for learner scheduling');
if (!config.scheduler.enabled) failures.push('SCHEDULER_ENABLED must be true for automatic generation, delivery, notices, reminders, and backups');
if (config.telegram.enabled && !config.telegram.botToken) failures.push('TELEGRAM_BOT_TOKEN is required when Telegram is enabled');
if (config.whatsapp.enabled && !config.whatsapp.dedicatedNumber) warnings.push('WHATSAPP_DEDICATED_NUMBER is empty');

for (const dir of [config.dataDir, config.backupDir, config.cardDir, config.bookFileDir]) {
  try { await fs.mkdir(dir, { recursive: true }); await fs.access(dir, fs.constants.W_OK); }
  catch { failures.push(`Directory is not writable: ${dir}`); }
}

console.log(JSON.stringify({
  ok: failures.length === 0,
  version: config.version,
  mode: config.ai.provider,
  baseUrl: config.appBaseUrl,
  businessActions: config.businessActions.enabled,
  autoScheduleApproved: config.businessActions.autoScheduleApproved,
  scheduler: config.scheduler.enabled,
  telegram: config.telegram.enabled,
  whatsapp: config.whatsapp.enabled,
  warnings,
  failures
}, null, 2));

if (failures.length) process.exitCode = 1;
