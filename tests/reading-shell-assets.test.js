import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const read = (relative) => fs.readFile(new URL(relative, import.meta.url), 'utf8');

test('production reading shell remains valid JavaScript', () => {
  const file = fileURLToPath(new URL('../public/reading-shell.js', import.meta.url));
  assert.doesNotThrow(() => execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' }));
});

test('learner shell loads the frozen reading experience through external strict-CSP assets', async () => {
  const html = await read('../public/app.html');
  assert.match(html, /\/assets\/reading-shell\.css/);
  assert.match(html, /<script type="module" src="\/assets\/reading-shell\.js"><\/script>/);
  assert.doesNotMatch(html, /<style\b/i);
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>\s*[^<]/i);
});

test('reading shell implements the bounded frozen grammar without rendering model HTML', async () => {
  const js = await read('../public/reading-shell.js');
  for (const type of ['prose', 'idea', 'pulse', 'register', 'sequence', 'example', 'matrix', 'synthesis', 'context_note', 'definition', 'check', 'reading_end']) {
    assert.match(js, new RegExp(`['\"]${type}['\"]`));
  }
  assert.doesNotMatch(js, /\.innerHTML\s*=/);
  assert.doesNotMatch(js, /insertAdjacentHTML/);
  assert.match(js, /textContent/);
  assert.match(js, /selectedLanguage/);
  assert.match(js, /currentSectionId/);
  assert.match(js, /anchorId/);
  assert.match(js, /\/api\/lessons\/.*\/experience/);
  assert.match(js, /\/api\/book-sessions\/.*\/experience/);
});

test('reading shell preserves bilingual position, RTL, outline/focus, steppers, definitions and reduced motion', async () => {
  const js = await read('../public/reading-shell.js');
  const css = await read('../public/reading-shell.css');
  assert.match(js, /language === 'ar'/);
  assert.match(js, /activeBlockId/);
  assert.match(js, /scrollIntoView/);
  assert.match(js, /Escape/);
  assert.match(js, /Tab/);
  assert.match(js, /aria-expanded/);
  assert.match(js, /aria-pressed/);
  assert.match(js, /definition/i);
  assert.match(js, /stepper/i);
  assert.match(css, /\[dir="rtl"\]/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /\.reading-section-spine/);
  assert.match(css, /\.reading-outline/);
  assert.match(css, /\.reading-progress/);
});

test('reader experience writes serialize instead of dropping user actions during an in-flight position save', async () => {
  const js = await read('../public/reading-shell.js');
  assert.doesNotMatch(js, /!state\.open\s*\|\|\s*state\.saveInFlight\)\s*return null/);
  assert.match(js, /while\s*\(state\.saveInFlight\)/);
  assert.match(js, /const nextLanguage = state\.language === 'ar' \? 'en' : 'ar'/);
  assert.match(js, /state\.language = nextLanguage/);
});

test('selection tracking keeps one stable listener pair across language rerenders', async () => {
  const js = await read('../public/reading-shell.js');
  assert.match(js, /function updateSelectionTracking\(\)/);
  assert.match(js, /removeEventListener\('mouseup', updateSelectionTracking\)/);
  assert.match(js, /removeEventListener\('keyup', updateSelectionTracking\)/);
  assert.match(js, /addEventListener\('mouseup', updateSelectionTracking\)/);
  assert.match(js, /addEventListener\('keyup', updateSelectionTracking\)/);
});

test('service worker caches only the new static reader assets, never reader API payloads', async () => {
  const sw = await read('../public/sw.js');
  assert.match(sw, /\/assets\/reading-shell\.css/);
  assert.match(sw, /\/assets\/reading-shell\.js/);
  assert.doesNotMatch(sw, /\/api\//);
  assert.match(sw, /url\.pathname !== '\/app'/);
  assert.match(sw, /startsWith\('\/assets\/'\)/);
});
