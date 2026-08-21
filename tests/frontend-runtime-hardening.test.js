import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

async function asset(name) {
  return fs.readFile(new URL(`../public/${name}`, import.meta.url), 'utf8');
}

test('frontend JavaScript emits no inline style attributes under the strict CSP', async () => {
  for (const name of ['app.js', 'admin.js']) {
    const source = await asset(name);
    assert.doesNotMatch(source, /\sstyle\s*=\s*["']/i, `${name} still emits CSP-blocked inline style attributes`);
  }
});

test('learner dialogs use one labeled focus-managed lifecycle', async () => {
  const source = await asset('app.js');
  assert.match(source, /function openDialogSurface\b/);
  assert.match(source, /aria-labelledby/);
  assert.match(source, /event\.key === ['"]Escape['"]/);
  assert.match(source, /event\.key === ['"]Tab['"]/);
  assert.match(source, /previous\?\.focus\?\.\(\)/);
  assert.doesNotMatch(source, /function openScheduleDialog[\s\S]*?dialog\.classList\.remove\(['"]hidden['"]\)[\s\S]*?function /);
  assert.doesNotMatch(source, /function openQuestionDialog[\s\S]*?dialog\.classList\.remove\(['"]hidden['"]\)[\s\S]*?function /);
});

test('administrator dialogs use one labeled focus-managed lifecycle', async () => {
  const source = await asset('admin.js');
  assert.match(source, /function openDialogSurface\b/);
  assert.match(source, /aria-labelledby/);
  assert.match(source, /event\.key === ['"]Escape['"]/);
  assert.match(source, /event\.key === ['"]Tab['"]/);
  assert.match(source, /previous\?\.focus\?\.\(\)/);
  assert.doesNotMatch(source, /function previewLesson[\s\S]*?classList\.remove\(['"]hidden['"]\)/);
  assert.doesNotMatch(source, /function previewBookSession[\s\S]*?classList\.remove\(['"]hidden['"]\)/);
});
