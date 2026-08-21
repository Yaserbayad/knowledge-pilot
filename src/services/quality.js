import { isSensitiveTopic } from '../utils.js';

function authorityScore(source) {
  const domain = String(source.domain || '').toLowerCase();
  if (/\.gov\.|\.gov$|\.edu\.|\.edu$/.test(domain)) return 3;
  if (/who\.int$|un\.org$|europa\.eu$|oecd\.org$|worldbank\.org$|nature\.com$|science\.org$|doi\.org$/.test(domain)) return 3;
  if (/\.org$/.test(domain)) return 2;
  return 1;
}

export function evaluateLesson(lesson) {
  const issues = [];
  const warnings = [];
  const sources = (lesson.sources || []).filter((s) => s.fetchStatus !== 'failed');
  const uniqueDomains = new Set(sources.map((s) => s.domain).filter(Boolean));
  const content = lesson.content || {};
  const required = ['hook', 'coreExplanation', 'context', 'practicalMeaning', 'knowledgeConnection', 'practicalTakeaway', 'reflectionPrompt', 'nextTeaser'];
  for (const key of required) if (!content[key] || String(content[key]).trim().length < 12) issues.push(`Missing or weak ${key}`);
  if (!Array.isArray(content.keyIdeas) || content.keyIdeas.length !== 3) issues.push('Exactly three key ideas are required');
  if (!Array.isArray(content.examples) || content.examples.length < 1) issues.push('At least one example is required');
  if (!Array.isArray(content.perspectives) || content.perspectives.length < 1) issues.push('At least one relevant perspective is required');
  if (!Array.isArray(content.misconceptions) || content.misconceptions.length < 1) issues.push('At least one misconception is required');
  if (!Array.isArray(lesson.quiz) || lesson.quiz.length < 2) issues.push('At least two retrieval or application questions are required');
  if (sources.length < 2) issues.push('Fewer than two successfully fetched sources');
  if (uniqueDomains.size < 2) issues.push('Sources are not independently diverse');
  const authority = sources.reduce((sum, source) => sum + authorityScore(source), 0);
  if (sources.length && authority / sources.length < 1.5) warnings.push('Source authority should be reviewed; domain suffix alone does not establish credibility');
  const validSourceIds = new Set((lesson.sources || []).map((source) => source.id));
  const successfulSourceIds = new Set(sources.map((source) => source.id));
  if (!Array.isArray(lesson.claims) || lesson.claims.length < 2) issues.push('Material claim map is incomplete');
  for (const source of lesson.sources || []) {
    if (!String(source.url || '').startsWith('https://')) issues.push('A source is not a direct HTTPS URL');
  }
  for (const claim of lesson.claims || []) {
    if (!claim.sourceIds?.length) issues.push('A factual claim has no source citation');
    if ((claim.sourceIds || []).some((id) => !validSourceIds.has(id))) issues.push('A claim cites a source that was not supplied');
    if ((claim.sourceIds || []).length && !(claim.sourceIds || []).some((id) => successfulSourceIds.has(id))) issues.push('A factual claim is supported only by sources that could not be verified');
  }
  const sensitive = isSensitiveTopic(`${lesson.topic} ${lesson.title} ${lesson.question}`);
  if (sensitive) issues.push('Sensitive topic requires human review');
  const score = Math.max(0, 100 - issues.length * 15 - warnings.length * 5);
  return {
    score,
    issues,
    warnings,
    sensitive,
    sourceCount: sources.length,
    uniqueDomainCount: uniqueDomains.size,
    status: issues.length === 0 ? 'approved' : 'needs_review'
  };
}
