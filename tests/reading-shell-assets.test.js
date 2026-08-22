import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const read = (relative) => fs.readFile(new URL(relative, import.meta.url), 'utf8');

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

test('service worker caches only the new static reader assets, never reader API payloads', async () => {
  const sw = await read('../public/sw.js');
  assert.match(sw, /\/assets\/reading-shell\.css/);
  assert.match(sw, /\/assets\/reading-shell\.js/);
  assert.doesNotMatch(sw, /\/api\//);
  assert.match(sw, /url\.pathname !== '\/app'/);
  assert.match(sw, /startsWith\('\/assets\/'\)/);
});
