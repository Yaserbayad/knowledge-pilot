const SAFE_ID = /^[A-Za-z0-9_-]{1,160}$/;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

function safeId(value, label) {
  const normalized = String(value || '');
  if (!SAFE_ID.test(normalized)) throw new Error(`${label} is invalid`);
  return normalized;
}

function queryString(params = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value != null && value !== '') query.set(key, String(value));
  }
  const serialized = query.toString();
  return serialized ? `?${serialized}` : '';
}

export class KnowledgePilotClient {
  constructor(config, fetchImpl = globalThis.fetch) {
    this.baseUrl = config.baseUrl;
    this.apiKey = config.apiKey;
    this.timeoutMs = config.timeoutMs;
    this.fetch = fetchImpl;
  }

  async request(method, path, body) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    let response;
    try {
      response = await this.fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          accept: 'application/json',
          ...(body === undefined ? {} : { 'content-type': 'application/json' })
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal
      });
    } catch (error) {
      if (error?.name === 'AbortError') throw new Error('Knowledge Pilot request timed out');
      throw new Error(`Knowledge Pilot request failed: ${error?.message || 'network error'}`);
    } finally {
      clearTimeout(timeout);
    }

    const raw = await response.text();
    if (Buffer.byteLength(raw, 'utf8') > MAX_RESPONSE_BYTES) {
      throw new Error('Knowledge Pilot response exceeded the safe size limit');
    }
    let payload = null;
    if (raw) {
      try {
        payload = JSON.parse(raw);
      } catch {
        throw new Error(`Knowledge Pilot returned invalid JSON (HTTP ${response.status})`);
      }
    }
    if (!response.ok) {
      const error = new Error(
        payload?.message || payload?.error || `Knowledge Pilot returned HTTP ${response.status}`
      );
      error.status = response.status;
      error.details = payload;
      throw error;
    }
    return payload;
  }

  health() {
    return this.request('GET', '/api/gpt/health');
  }

  listTasks({ status = 'pending', limit = 20 } = {}) {
    const allowed = new Set(['pending', 'claimed', 'completed', 'failed', 'all']);
    if (!allowed.has(status)) throw new Error('Task status is invalid');
    const boundedLimit = Math.min(100, Math.max(1, Number.parseInt(limit, 10) || 20));
    return this.request('GET', `/api/gpt/tasks${queryString({ status, limit: boundedLimit })}`);
  }

  getTask(taskId) {
    return this.request('GET', `/api/gpt/tasks/${safeId(taskId, 'Task ID')}`);
  }

  claimTask(taskId) {
    return this.request('POST', `/api/gpt/tasks/${safeId(taskId, 'Task ID')}/claim`, {});
  }

  submitTask(taskId, result) {
    if (!result || typeof result !== 'object' || Array.isArray(result)) {
      throw new Error('Task result must be a JSON object');
    }
    return this.request('POST', `/api/gpt/tasks/${safeId(taskId, 'Task ID')}/result`, result);
  }

  submitBookAnalysis(taskId, result) {
    if (!result || typeof result !== 'object' || Array.isArray(result)) {
      throw new Error('Book analysis result must be a JSON object');
    }
    return this.request(
      'POST',
      `/api/gpt/tasks/${safeId(taskId, 'Task ID')}/book-analysis-result`,
      result
    );
  }

  failTask(taskId, reason) {
    const normalized = String(reason || '').trim();
    if (normalized.length < 10 || normalized.length > 2000) {
      throw new Error('Failure reason must be between 10 and 2,000 characters');
    }
    return this.request(
      'POST',
      `/api/gpt/tasks/${safeId(taskId, 'Task ID')}/fail`,
      { reason: normalized }
    );
  }

  getBookText(bookId, { offset = 0, limit = 16000 } = {}) {
    const boundedOffset = Math.max(0, Number.parseInt(offset, 10) || 0);
    const boundedLimit = Math.min(24000, Math.max(1000, Number.parseInt(limit, 10) || 16000));
    return this.request(
      'GET',
      `/api/gpt/books/${safeId(bookId, 'Book ID')}/source-text${queryString({
        offset: boundedOffset,
        limit: boundedLimit
      })}`
    );
  }
}

export function safeError(error) {
  const details = error?.details && typeof error.details === 'object' ? error.details : undefined;
  return {
    ok: false,
    error: String(error?.message || 'Unknown error').slice(0, 2000),
    ...(Number.isInteger(error?.status) ? { status: error.status } : {}),
    ...(details ? { details } : {})
  };
}
