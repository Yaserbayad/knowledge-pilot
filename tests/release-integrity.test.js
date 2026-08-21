import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { APP_VERSION } from '../src/version.js';

async function readJson(name) {
  return JSON.parse(await fs.readFile(new URL(`../${name}`, import.meta.url), 'utf8'));
}

test('release identity stays consistent across runtime, package metadata, lockfile, and shell cache', async () => {
  const version = (await fs.readFile(new URL('../VERSION', import.meta.url), 'utf8')).trim();
  const packageJson = await readJson('package.json');
  const packageLock = await readJson('package-lock.json');
  const serviceWorker = await fs.readFile(new URL('../public/sw.js', import.meta.url), 'utf8');

  assert.match(version, /^\d+\.\d+\.\d+$/);
  assert.equal(APP_VERSION, version);
  assert.equal(packageJson.version, version);
  assert.equal(packageLock.version, version);
  assert.equal(packageLock.packages?.['']?.version, version);
  assert.match(serviceWorker, new RegExp(`knowledge-pilot-shell-v${version.replaceAll('.', '\\.')}['"]`));
});
