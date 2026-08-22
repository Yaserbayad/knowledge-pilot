import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

test('reader source links are constrained to http/https before becoming navigable', async () => {
  const js = await fs.readFile(new URL('../public/reading-shell-a11y.js', import.meta.url), 'utf8');
  assert.match(js, /reading-source-list a\[href\]/);
  assert.match(js, /\['http:', 'https:'\]\.includes\(url\.protocol\)/);
  assert.match(js, /removeAttribute\('href'\)/);
});
