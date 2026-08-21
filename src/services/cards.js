import fs from 'node:fs/promises';
import path from 'node:path';
import { escapeHtml } from '../utils.js';

function wrap(text, max = 42) {
  const words = String(text || '').split(/\s+/);
  const lines = [];
  let line = '';
  for (const word of words) {
    if (`${line} ${word}`.trim().length > max && line) {
      lines.push(line);
      line = word;
    } else line = `${line} ${word}`.trim();
  }
  if (line) lines.push(line);
  return lines.slice(0, 4);
}

export async function createLessonCard(cardDir, lesson) {
  await fs.mkdir(cardDir, { recursive: true });
  const rtl = lesson.language === 'ar';
  const titleLines = wrap(lesson.title, 35);
  const ideas = (lesson.content?.keyIdeas || []).slice(0, 3);
  const titleSvg = titleLines.map((line, i) => `<text x="${rtl ? 1100 : 100}" y="${150 + i * 62}" text-anchor="${rtl ? 'end' : 'start'}" class="title">${escapeHtml(line)}</text>`).join('');
  const ideasSvg = ideas.map((idea, i) => {
    const lines = wrap(idea, 52);
    const y = 330 + i * 105;
    return `<circle cx="${rtl ? 1080 : 120}" cy="${y - 8}" r="9" fill="#2f6f61"/>${lines.map((line, j) => `<text x="${rtl ? 1045 : 155}" y="${y + j * 34}" text-anchor="${rtl ? 'end' : 'start'}" class="idea">${escapeHtml(line)}</text>`).join('')}`;
  }).join('');
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675">
  <rect width="1200" height="675" rx="28" fill="#f5f1e8"/>
  <rect x="46" y="44" width="1108" height="587" rx="24" fill="#fffdf8" stroke="#d8d0c2" stroke-width="2"/>
  <text x="${rtl ? 1100 : 100}" y="95" text-anchor="${rtl ? 'end' : 'start'}" class="label">KNOWLEDGE PILOT</text>
  ${titleSvg}
  ${ideasSvg}
  <text x="${rtl ? 1100 : 100}" y="600" text-anchor="${rtl ? 'end' : 'start'}" class="footer">${escapeHtml(lesson.topic || '')}</text>
  <style>
    .label { font-family: Arial, 'Noto Sans Arabic', sans-serif; font-size: 22px; letter-spacing: 3px; fill: #2f6f61; font-weight: 700; }
    .title { font-family: Arial, 'Noto Sans Arabic', sans-serif; font-size: 48px; fill: #1c2925; font-weight: 700; direction: ${rtl ? 'rtl' : 'ltr'}; }
    .idea { font-family: Arial, 'Noto Sans Arabic', sans-serif; font-size: 27px; fill: #283632; direction: ${rtl ? 'rtl' : 'ltr'}; }
    .footer { font-family: Arial, 'Noto Sans Arabic', sans-serif; font-size: 22px; fill: #6b746f; direction: ${rtl ? 'rtl' : 'ltr'}; }
  </style>
</svg>`;
  const filename = `${lesson.id}.svg`;
  await fs.writeFile(path.join(cardDir, filename), svg, 'utf8');
  return filename;
}

export async function removeLessonCard(cardDir, filename) {
  if (!cardDir || !filename || path.basename(filename) !== filename) return false;
  await fs.rm(path.join(cardDir, filename), { force: true });
  return true;
}
