import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { JsonStore } from '../src/store.js';
import { AiService } from '../src/services/ai.js';
import { LearningService } from '../src/services/learning.js';
import { BusinessActionsService } from '../src/services/business-actions.js';
import { createServer } from '../src/server.js';
import { APP_VERSION } from '../src/version.js';

const logger = { debug() {}, info() {}, warn() {}, error() {} };

test('GPT Action schema is public while task APIs require the configured bearer key', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'knowledge-pilot-gpt-api-'));
  const config = {
    nodeEnv: 'development', appBaseUrl: 'https://learn.example.com', appSecret: 'gpt-api-secret-gpt-api-secret', adminToken: 'admin-token',
    defaultLanguage: 'en', defaultTimezone: 'Europe/Brussels', cardDir: path.join(root, 'cards'),
    scheduler: { enabled: false }, telegram: { webhookSecret: '' }, ai: { provider: 'chatgpt_business' },
    whatsapp: { dedicatedNumber: '' }
  };
  const store = await new JsonStore({ stateFile: path.join(root, 'state.json'), backupDir: path.join(root, 'backups'), retention: 3, logger }).init();
  const research = { async fetchUrls() { return []; } };
  const learning = new LearningService({ store, ai: new AiService(config.ai, logger), research, config, logger });
  const businessActions = new BusinessActionsService({ store, research, learning, config: { enabled: true, apiKey: 'secret-action-key', autoScheduleApproved: false, autoScheduleDelayMinutes: 2, cardDir: config.cardDir }, logger });
  learning.setBusinessActions(businessActions);
  const telegram = { enabled: false, botUsername: null, handleUpdate() {} };
  const whatsapp = { enabled: false, status: 'disabled' };
  const server = createServer({ config, store, learning, businessActions, telegram, whatsapp, scheduler: {}, logger });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;

  const schemaResponse = await fetch(`${base}/gpt-action/openapi.json`);
  assert.equal(schemaResponse.status, 200);
  const schema = await schemaResponse.json();
  assert.equal(schema.openapi, '3.1.0');
  assert.equal(schema.info.version, APP_VERSION);
  assert.ok(schema.paths['/api/gpt/tasks/{taskId}/result']);

  const visitSchema = (node, location = 'root') => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'object') {
      assert.ok(node.properties && typeof node.properties === 'object', `Object schema missing properties at ${location}`);
    }
    for (const [key, value] of Object.entries(node)) visitSchema(value, `${location}.${key}`);
  };
  visitSchema(schema);
  for (const [route, pathItem] of Object.entries(schema.paths)) {
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue;
      for (const parameter of operation.parameters || []) {
        assert.equal(parameter.$ref, undefined, `Reusable parameter reference is not GPT Action compatible at ${method.toUpperCase()} ${route}`);
        assert.equal(typeof parameter.name, 'string');
      }
    }
  }

  assert.equal((await fetch(`${base}/api/gpt/health`)).status, 401);
  const health = await fetch(`${base}/api/gpt/health`, { headers: { authorization: 'Bearer secret-action-key' } });
  assert.equal(health.status, 200);

  const { user } = await learning.createUser({ name: 'Action User' });
  await learning.generateWeeklyPlan(user.id);
  const tasksResponse = await fetch(`${base}/api/gpt/tasks`, { headers: { authorization: 'Bearer secret-action-key' } });
  const tasks = await tasksResponse.json();
  assert.equal(tasks.length, 1);
  const contextResponse = await fetch(`${base}/api/gpt/tasks/${tasks[0].id}`, { headers: { authorization: 'Bearer secret-action-key' } });
  assert.equal(contextResponse.status, 200);
  assert.equal((await contextResponse.json()).task.type, 'weekly_plan');
});
