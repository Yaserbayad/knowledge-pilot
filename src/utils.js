import crypto from 'node:crypto';

export const nowIso = () => new Date().toISOString();
export const uid = (prefix = 'id') => `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`;
export const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
export const hmac = (secret, value) => crypto.createHmac('sha256', secret).update(value).digest('base64url');
export const randomCode = (length = 8) => crypto.randomBytes(Math.ceil(length / 2)).toString('hex').slice(0, length).toUpperCase();
export const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function safeJsonParse(value, fallback = null) {
  try { return JSON.parse(value); } catch { return fallback; }
}

export function extractJson(text) {
  const direct = safeJsonParse(text);
  if (direct) return direct;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  if (fenced) {
    const parsed = safeJsonParse(fenced);
    if (parsed) return parsed;
  }
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first >= 0 && last > first) return safeJsonParse(text.slice(first, last + 1));
  return null;
}

export function normalizePhone(input) {
  return String(input || '').replace(/[^0-9]/g, '');
}

export function splitMessage(text, max = 3900) {
  const parts = [];
  let remaining = String(text || '').trim();
  while (remaining.length > max) {
    let cut = remaining.lastIndexOf('\n\n', max);
    if (cut < max * 0.5) cut = remaining.lastIndexOf('\n', max);
    if (cut < max * 0.5) cut = remaining.lastIndexOf(' ', max);
    if (cut < max * 0.5) cut = max;
    parts.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  if (remaining) parts.push(remaining);
  return parts;
}

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[char]);
}

export function dateInTimezone(date, timezone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date).reduce((acc, part) => ({ ...acc, [part.type]: part.value }), {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function weekStartIso(date = new Date(), timezone = 'UTC') {
  const localDate = dateInTimezone(date, timezone);
  const d = new Date(`${localDate}T12:00:00Z`);
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() - day + 1);
  return d.toISOString().slice(0, 10);
}

export function formatLessonText(lesson) {
  const c = lesson.content || {};
  const list = (items = []) => items.map((x, i) => `${i + 1}. ${x}`).join('\n');
  const sources = (lesson.sources || []).map((s, i) => `${i + 1}. ${s.title || s.url} — ${s.url}`).join('\n');
  return [
    `📘 ${lesson.title}`,
    c.hook,
    c.coreExplanation,
    c.context ? `Context\n${c.context}` : '',
    c.examples?.length ? `Examples\n${list(c.examples)}` : '',
    c.perspectives?.length ? `Perspectives\n${list(c.perspectives)}` : '',
    c.misconceptions?.length ? `Common misconceptions\n${list(c.misconceptions)}` : '',
    c.practicalMeaning ? `Why it matters\n${c.practicalMeaning}` : '',
    c.keyIdeas?.length ? `Three ideas to retain\n${list(c.keyIdeas)}` : '',
    c.practicalTakeaway ? `Practical takeaway\n${c.practicalTakeaway}` : '',
    c.reflectionPrompt ? `Think\n${c.reflectionPrompt}` : '',
    c.nextTeaser ? `Next\n${c.nextTeaser}` : '',
    sources ? `Sources\n${sources}` : 'Sources: pending review'
  ].filter(Boolean).join('\n\n');
}

export function isSensitiveTopic(text) {
  return /\b(medical|health|diagnosis|treatment|legal|law|tax|investment|financial advice|religion|fatwa|election|politic|war|suicide|self-harm)\b/i.test(text || '');
}

export function formatBookSessionText(session, book = {}) {
  const c = session.content || {};
  const list = (items = []) => items.map((item, index) => `${index + 1}. ${typeof item === 'string' ? item : item.text || ''}`).join('\n');
  const refs = [...(session.chapterRefs || []), ...(session.pageRefs || [])].filter(Boolean).join(' · ');
  const sources = (session.sources || []).filter((source) => source.url).map((source, index) => `${index + 1}. ${source.title || source.url} — ${source.url}`).join('\n');
  return [
    `📚 ${book.title || session.label || session.title} — Session ${session.sessionNumber}`,
    session.title,
    refs ? `Book references\n${refs}` : '',
    c.hook,
    c.summary,
    c.importantDetails?.length ? `Important details\n${list(c.importantDetails)}` : '',
    c.context ? `Context\n${c.context}` : '',
    c.criticalAssessment ? `Critical assessment\n${c.criticalAssessment}` : '',
    c.practicalApplication ? `Practical application\n${c.practicalApplication}` : '',
    c.quotations?.length ? `Short selected passages\n${c.quotations.map((quote) => `“${quote.text}”${quote.location ? ` — ${quote.location}` : ''}`).join('\n')}` : '',
    c.connections?.length ? `Connections\n${list(c.connections)}` : '',
    c.keyIdeas?.length ? `Three ideas to retain\n${list(c.keyIdeas)}` : '',
    c.reflectionPrompt ? `Think\n${c.reflectionPrompt}` : '',
    c.nextPreview ? `Next book session\n${c.nextPreview}` : '',
    sources ? `Sources and criticism\n${sources}` : ''
  ].filter(Boolean).join('\n\n');
}
