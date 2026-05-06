function defaultFetch() {
  if (typeof fetch !== 'undefined') return fetch;
  throw new Error('Global fetch is not available. Use Node 18+ or provide fetchImpl.');
}

function normalizeBaseUrl(baseUrl) {
  return String(baseUrl || '').trim().replace(/\/+$/, '');
}

function buildQuery(params = {}) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && String(v).trim() !== '') {
      q.append(k, String(v));
    }
  }
  const qs = q.toString();
  return qs ? `?${qs}` : '';
}

function isNonRetryableStatus(status) {
  return Number(status) === 400 || Number(status) === 404;
}

function toBool(v) {
  if (typeof v === 'boolean') return v;
  if (v === undefined || v === null) return false;
  const s = String(v).toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'y';
}

class RatingsApiClient {
  constructor(options = {}) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl || process.env.SYNC_RATINGS_API_URL || '');
    this.timeoutMs = Number(options.timeoutMs || process.env.SYNC_RATINGS_API_TIMEOUT_MS || 30000);
    this.retries = Math.max(1, Number(options.retries || process.env.SYNC_JELLYFIN_RETRIES || 3));
    this.retryDelayMs = Math.max(1, Number(options.retryDelayMs || process.env.SYNC_JELLYFIN_RETRY_DELAY || 1000));
    this.fetchImpl = options.fetchImpl || defaultFetch();
    this.sleep = options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.apiKey = options.apiKey || process.env.SYNC_RATINGS_API_KEY || '';
    this.useApiKeyHeader = toBool(options.useApiKeyHeader ?? process.env.SYNC_RATINGS_API_USE_KEY_HEADER);
  }

  async getRating({ title, year }) {
    const query = buildQuery({ title, year });
    return this.#requestWithRetry('GET', `/rating${query}`);
  }

  async getRatingsBatch({ items }) {
    const payload = await this.#requestWithRetry('POST', '/ratings/batch', {
      body: { items: Array.isArray(items) ? items : [] },
    });

    if (!payload || !Array.isArray(payload.results)) {
      const err = new Error('Ratings API contract error: missing "results" array');
      err.retryable = false;
      throw err;
    }

    return payload.results;
  }

  async #requestWithRetry(method, path, { body } = {}) {
    let lastErr;
    for (let i = 0; i < this.retries; i++) {
      try {
        return await this.#request(method, path, { body });
      } catch (err) {
        lastErr = err;
        if (err && err.retryable === false) throw err;
        if (i < this.retries - 1) {
          const backoff = this.retryDelayMs * Math.pow(2, i);
          await this.sleep(backoff);
        }
      }
    }
    throw lastErr;
  }

  async #request(method, path, { body } = {}) {
    if (!this.baseUrl) {
      const err = new Error('SYNC_RATINGS_API_URL is required for RatingsApiClient');
      err.retryable = false;
      throw err;
    }

    const endpoint = `${this.baseUrl}${path}`;
    const headers = { 'content-type': 'application/json' };
    if (this.apiKey && this.useApiKeyHeader) headers['x-api-key'] = this.apiKey;

    let signal;
    if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
      signal = AbortSignal.timeout(this.timeoutMs);
    }

    let res;
    try {
      res = await this.fetchImpl(endpoint, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal,
      });
    } catch (err) {
      const out = new Error(`Ratings API network error: ${err && err.message ? err.message : err}`);
      out.retryable = true;
      throw out;
    }

    const payload = await res.json().catch(() => null);
    if (!res.ok) {
      const message = payload && (payload.error || payload.message)
        ? (payload.error || payload.message)
        : `HTTP ${res.status}`;
      const out = new Error(`Ratings API error: ${message}`);
      out.status = res.status;
      out.retryable = !isNonRetryableStatus(res.status);
      throw out;
    }

    return payload;
  }
}

module.exports = RatingsApiClient;