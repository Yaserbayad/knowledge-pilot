import fs from 'node:fs/promises';
import { loadEnv } from './env.js';

loadEnv();

const { config } = await import('./config.js');
const { createLogger } = await import('./logger.js');
const { JsonStore } = await import('./store.js');
const { AiService } = await import('./services/ai.js');
const { ResearchService } = await import('./services/research.js');
const { LearningService } = await import('./services/learning.js');
const { BusinessActionsService } = await import('./services/business-actions.js');
const { BookFileService } = await import('./services/book-files.js');
const { BookLearningService } = await import('./services/books.js');
const { AccountDeletionService } = await import('./services/account-deletion.js');
const { TelegramChannel } = await import('./channels/telegram.js');
const { WhatsAppChannel } = await import('./channels/whatsapp.js');
const { DeliveryService } = await import('./services/delivery.js');
const { Scheduler } = await import('./scheduler.js');
const { reconcileWorkflow } = await import('./services/workflow-reconcile.js');
const { createServer } = await import('./server.js');

const logger = createLogger(config.logLevel);
await fs.mkdir(config.dataDir, { recursive: true });
await fs.mkdir(config.backupDir, { recursive: true });
await fs.mkdir(config.cardDir, { recursive: true });
await fs.mkdir(config.bookFileDir, { recursive: true });
await fs.mkdir(config.whatsapp.authDir, { recursive: true });

const store = await new JsonStore({
  stateFile: config.stateFile,
  backupDir: config.backupDir,
  retention: config.backups.retention,
  logger
}).init();
const ai = new AiService(config.ai, logger);
const research = new ResearchService(config.research, logger);
const learning = new LearningService({ store, ai, research, config, logger });
const bookFiles = await new BookFileService({ rootDir: config.bookFileDir, logger }).init();
const books = new BookLearningService({ store, config, logger, bookFiles });
const accounts = new AccountDeletionService({ store, cardDir: config.cardDir, bookFileDir: config.bookFileDir, logger });
const businessActions = new BusinessActionsService({ store, research, learning, books, config: { ...config.businessActions, cardDir: config.cardDir }, logger });
learning.setBusinessActions(businessActions);
books.setBusinessActions(businessActions);
const telegram = new TelegramChannel({ config: { ...config.telegram, appSecret: config.appSecret, cardDir: config.cardDir }, store, learning, books, logger });
const whatsapp = new WhatsAppChannel({ config: { ...config.whatsapp, appSecret: config.appSecret, cardDir: config.cardDir }, store, learning, books, logger });
const delivery = new DeliveryService({ store, learning, books, telegram, whatsapp, config, logger });
const scheduler = new Scheduler({ store, learning, books, delivery, config: { ...config.scheduler, unfinishedItemLimit: config.automation.unfinishedItemLimit }, logger });

await reconcileWorkflow({ store, learning, books, config, logger });

await telegram.init();
await whatsapp.init();

if (telegram.enabled && config.appBaseUrl.startsWith('https://')) {
  await telegram.setWebhook(`${config.appBaseUrl}/api/telegram/webhook`).catch((error) => logger.warn({ error: error.message }, 'Telegram webhook was not configured automatically'));
}

const server = createServer({ config, store, learning, books, bookFiles, accounts, businessActions, telegram, whatsapp, scheduler, logger });
server.listen(config.port, config.host, () => {
  logger.info({ host: config.host, port: config.port, baseUrl: config.appBaseUrl }, 'Knowledge Pilot started');
});
scheduler.start();

const backupTimer = setInterval(() => store.backup('scheduled').catch((error) => logger.error({ error: error.message }, 'Scheduled backup failed')), config.backups.intervalHours * 60 * 60 * 1000);
backupTimer.unref();

async function shutdown(signal) {
  logger.info({ signal }, 'Shutting down');
  scheduler.stop();
  clearInterval(backupTimer);
  await new Promise((resolve) => server.close(resolve));
  await store.backup('shutdown').catch(() => {});
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (error) => logger.error({ error: error?.stack || String(error) }, 'Unhandled rejection'));
process.on('uncaughtException', (error) => {
  logger.error({ error: error.stack || error.message }, 'Uncaught exception');
  process.exit(1);
});
