import path from 'node:path';
import { loadEnv } from '../src/env.js';
loadEnv();
const { config } = await import('../src/config.js');
const { JsonStore } = await import('../src/store.js');
const store = await new JsonStore({ stateFile: config.stateFile, backupDir: config.backupDir, retention: config.backups.retention }).init();
console.log(await store.backup('cli'));
