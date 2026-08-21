import dns from 'node:dns/promises';
import net from 'node:net';
import { uid } from '../utils.js';

function isPrivateIp(address) {
  if (!net.isIP(address)) return true;
  if (address === '127.0.0.1' || address === '::1') return true;
  if (address.startsWith('10.') || address.startsWith('192.168.') || address.startsWith('169.254.')) return true;
  const match = address.match(/^172\.(\d+)\./);
  if (match && Number(match[1]) >= 16 && Number(match[1]) <= 31) return true;
  if (address.startsWith('fc') || address.startsWith('fd') || address.startsWith('fe80:')) return true;
  return false;
}

async function validatePublicUrl(rawUrl) {
  const url = new URL(rawUrl);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only HTTP(S) sources are allowed');
  if (['localhost', '0.0.0.0'].includes(url.hostname)) throw new Error('Local source URLs are blocked');
  const records = await dns.lookup(url.hostname, { all: true });
  if (!records.length || records.some((record) => isPrivateIp(record.address))) throw new Error('Private-network source URLs are blocked');
  return url;
}

async function fetchPublic(rawUrl, options, maxRedirects = 5) {
  let url = await validatePublicUrl(rawUrl);
  for (let redirects = 0; redirects <= maxRedirects; redirects += 1) {
    const response = await fetch(url, { ...options, redirect: 'manual' });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    if (redirects === maxRedirects) throw new Error('Too many redirects');
    const location = response.headers.get('location');
    if (!location) throw new Error('Redirect has no location');
    url = await validatePublicUrl(new URL(location, url).toString());
  }
  throw new Error('Redirect failed');
}

function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function titleFromHtml(html, fallback) {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  return title ? htmlToText(title).slice(0, 240) : fallback;
}

export class ResearchService {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
  }

  async search(query) {
    if (!this.config.searxngUrl) return [];
    const url = new URL('/search', this.config.searxngUrl);
    url.searchParams.set('q', query);
    url.searchParams.set('format', 'json');
    url.searchParams.set('language', 'all');
    const response = await fetch(url, {
      headers: { accept: 'application/json', 'user-agent': 'KnowledgePilot/1.0' },
      signal: AbortSignal.timeout(this.config.fetchTimeoutMs)
    });
    if (!response.ok) throw new Error(`SearXNG search failed: ${response.status}`);
    const data = await response.json();
    return (data.results || []).slice(0, this.config.maxResults).map((result) => ({
      id: uid('src'),
      title: result.title || result.url,
      url: result.url,
      snippet: result.content || '',
      engine: result.engine || null
    }));
  }

  async fetchSource(source) {
    try {
      const url = await validatePublicUrl(source.url);
      const response = await fetchPublic(url.toString(), {
        headers: {
          accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.2',
          'user-agent': 'KnowledgePilotResearch/1.0 (+educational source review)'
        },
        signal: AbortSignal.timeout(this.config.fetchTimeoutMs)
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const type = response.headers.get('content-type') || '';
      if (!type.includes('text/html') && !type.includes('text/plain') && !type.includes('application/xhtml+xml')) {
        throw new Error(`Unsupported content type: ${type}`);
      }
      const html = (await response.text()).slice(0, 1_500_000);
      return {
        ...source,
        title: source.title || titleFromHtml(html, url.hostname),
        domain: url.hostname,
        accessedAt: new Date().toISOString(),
        excerpt: htmlToText(html).slice(0, 14000),
        fetchStatus: 'ok'
      };
    } catch (error) {
      this.logger.warn({ url: source.url, error: error.message }, 'Source fetch failed');
      return { ...source, fetchStatus: 'failed', error: error.message, excerpt: source.snippet || '' };
    }
  }

  async fetchUrls(sources = []) {
    const unique = [...new Map((Array.isArray(sources) ? sources : [])
      .filter((source) => source && source.url)
      .map((source) => [String(source.url), source])).values()]
      .slice(0, this.config.maxResults || 12);
    return Promise.all(unique.map((source) => this.fetchSource(source)));
  }

  async gather(topic, question, extraUrls = []) {
    const query = `${topic} ${question}`.trim();
    let results = [];
    try { results = await this.search(query); } catch (error) {
      this.logger.warn({ error: error.message, query }, 'Search failed');
    }
    for (const url of extraUrls) results.push({ id: uid('src'), title: url, url, snippet: '' });
    const unique = [...new Map(results.map((item) => [item.url, item])).values()].slice(0, this.config.maxResults);
    return Promise.all(unique.map((source) => this.fetchSource(source)));
  }
}
