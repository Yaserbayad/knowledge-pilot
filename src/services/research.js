import dns from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { readFetchText } from '../http-response.js';
import { uid } from '../utils.js';

const MAX_SEARCH_RESPONSE_BYTES = 1024 * 1024;
const MAX_SOURCE_RESPONSE_BYTES = 1_500_000;
const BLOCKED = new net.BlockList();

for (const [network, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]
]) BLOCKED.addSubnet(network, prefix, 'ipv4');

for (const [network, prefix] of [
  ['::', 128], ['::1', 128], ['100::', 64], ['2001::', 32], ['2001:db8::', 32],
  ['2001:10::', 28], ['2001:20::', 28], ['2002::', 16], ['fc00::', 7],
  ['fe80::', 10], ['ff00::', 8]
]) BLOCKED.addSubnet(network, prefix, 'ipv6');

export function isBlockedAddress(address) {
  const family = net.isIP(address);
  if (!family) return true;
  return BLOCKED.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

function bareHostname(url) {
  return url.hostname.startsWith('[') && url.hostname.endsWith(']') ? url.hostname.slice(1, -1) : url.hostname;
}

async function validatePublicUrl(rawUrl) {
  const url = new URL(rawUrl);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only HTTP(S) sources are allowed');
  if (url.username || url.password) throw new Error('Source URLs with embedded credentials are blocked');
  const hostname = bareHostname(url);
  if (!hostname) throw new Error('Source URL hostname is required');
  const records = await dns.lookup(hostname, { all: true, verbatim: true });
  if (!records.length || records.some((record) => isBlockedAddress(record.address))) {
    throw new Error('Private or reserved-network source URLs are blocked');
  }
  return { url, records };
}

export function pinnedLookup(record) {
  const pinned = { address: String(record.address), family: Number(record.family) };
  return (_hostname, options, callback) => {
    if (typeof options === 'function') {
      callback = options;
      options = {};
    }
    if (options?.all) callback(null, [pinned]);
    else callback(null, pinned.address, pinned.family);
  };
}

function requestOnce(url, record, options) {
  const transport = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const request = transport.request(url, {
      method: 'GET',
      headers: options.headers,
      signal: options.signal,
      agent: false,
      lookup: pinnedLookup(record)
    }, resolve);
    request.once('error', reject);
    request.end();
  });
}

async function fetchPublic(rawUrl, options, maxRedirects = 5) {
  let current = String(rawUrl);
  for (let redirects = 0; redirects <= maxRedirects; redirects += 1) {
    const { url, records } = await validatePublicUrl(current);
    const response = await requestOnce(url, records[0], options);
    const status = Number(response.statusCode || 0);
    if (![301, 302, 303, 307, 308].includes(status)) return { response, url };
    response.destroy();
    if (redirects === maxRedirects) throw new Error('Too many redirects');
    const location = response.headers.location;
    if (!location) throw new Error('Redirect has no location');
    current = new URL(location, url).toString();
  }
  throw new Error('Redirect failed');
}

export async function readNodeText(stream, maxBytes, label = 'Response') {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error('maxBytes must be a positive safe integer');
  const chunks = [];
  let total = 0;
  try {
    for await (const value of stream) {
      const chunk = Buffer.from(value);
      total += chunk.length;
      if (total > maxBytes) {
        stream.destroy();
        throw new Error(`${label} exceeds the ${maxBytes} byte limit`);
      }
      chunks.push(chunk);
    }
  } catch (error) {
    if (!stream.destroyed) stream.destroy();
    throw error;
  }
  return Buffer.concat(chunks, total).toString('utf8');
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

function sourceHost(rawUrl) {
  try { return new URL(rawUrl).hostname; } catch { return 'invalid'; }
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
    const body = await readFetchText(response, MAX_SEARCH_RESPONSE_BYTES, 'SearXNG response');
    if (!response.ok) throw new Error(`SearXNG search failed: ${response.status}`);
    const data = JSON.parse(body);
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
      const { response, url } = await fetchPublic(source.url, {
        headers: {
          accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.2',
          'user-agent': 'KnowledgePilotResearch/1.0 (+educational source review)'
        },
        signal: AbortSignal.timeout(this.config.fetchTimeoutMs)
      });
      const status = Number(response.statusCode || 0);
      if (status < 200 || status >= 300) {
        response.destroy();
        throw new Error(`HTTP ${status}`);
      }
      const type = String(response.headers['content-type'] || '');
      if (!type.includes('text/html') && !type.includes('text/plain') && !type.includes('application/xhtml+xml')) {
        response.destroy();
        throw new Error(`Unsupported content type: ${type}`);
      }
      const html = await readNodeText(response, MAX_SOURCE_RESPONSE_BYTES, 'Research source');
      return {
        ...source,
        title: source.title || titleFromHtml(html, url.hostname),
        domain: url.hostname,
        accessedAt: new Date().toISOString(),
        excerpt: htmlToText(html).slice(0, 14000),
        fetchStatus: 'ok'
      };
    } catch (error) {
      this.logger.warn({ sourceHost: sourceHost(source.url), error: error.message }, 'Source fetch failed');
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
      this.logger.warn({ error: error.message }, 'Search failed');
    }
    for (const url of extraUrls) results.push({ id: uid('src'), title: url, url, snippet: '' });
    const unique = [...new Map(results.map((item) => [item.url, item])).values()].slice(0, this.config.maxResults);
    return Promise.all(unique.map((source) => this.fetchSource(source)));
  }
}
