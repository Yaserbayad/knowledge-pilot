import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

for (const file of ['index.html', 'app.html', 'admin.html']) {
  test(`${file} contains no inline executable script`, async () => {
    const html = await fs.readFile(new URL(`../public/${file}`, import.meta.url), 'utf8');
    const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
    for (const match of scripts) {
      assert.match(match[1], /\bsrc\s*=/i, `inline script found in ${file}`);
      assert.equal(match[2].trim(), '', `inline script body found in ${file}`);
    }
  });
}

test('service worker caches only the static shell and never private learner URLs or API payloads', async () => {
  const source = await fs.readFile(new URL('../public/sw.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /pathname\.startsWith\(['"]\/api\//);
  assert.doesNotMatch(source, /pathname\.startsWith\(['"]\/u\//);
  assert.match(source, /url\.pathname !== ['"]\/app['"] && !url\.pathname\.startsWith\(['"]\/assets\//);
});
