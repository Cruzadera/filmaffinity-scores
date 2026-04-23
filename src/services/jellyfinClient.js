/*
Reusable Jellyfin API client
Configurable via constructor or environment variables:
  - JELLYFIN_BASE_URL
  - JELLYFIN_API_KEY
  - JELLYFIN_TIMEOUT (ms)

Usage:
  const JellyfinClient = require('./services/jellyfinClient');
  const client = new JellyfinClient({ baseUrl, apiKey });
  await client.getItems({ Limit: 10 });
*/

const DEFAULT_TIMEOUT = 10000;
const jellyfinConfig = require('../config/jellyfin');

function getFetch() {
  if (typeof fetch !== 'undefined') return fetch;
  try {
    // try to require node-fetch if running on older Node
    // eslint-disable-next-line global-require
    return require('node-fetch');
  } catch (err) {
    throw new Error('Global fetch is not available. Install node-fetch or use Node 18+.');
  }
}

class JellyfinClient {
  constructor(options = {}) {
    const { baseUrl, apiKey, timeout } = options;

    // Prefer explicit constructor options, otherwise load from centralized config and validate
    if (baseUrl || apiKey) {
      this.baseUrl = (baseUrl || process.env.JELLYFIN_BASE_URL || 'http://localhost:8096').replace(/\/+$/,'');
      this.apiKey = apiKey || process.env.JELLYFIN_API_KEY || null;
      this.authMode = options.authMode || process.env.JELLYFIN_AUTH_MODE || 'auto';
      this.timeout = parseInt(timeout || process.env.JELLYFIN_TIMEOUT || DEFAULT_TIMEOUT, 10);
    } else {
      const cfg = jellyfinConfig.getConfig({ strict: true });
      this.baseUrl = cfg.baseUrl;
      this.apiKey = cfg.apiKey;
      this.authMode = cfg.authMode || process.env.JELLYFIN_AUTH_MODE || 'auto';
      this.timeout = parseInt(timeout || cfg.timeout || DEFAULT_TIMEOUT, 10);
    }
    this._fetch = getFetch();
  }

  _buildUrl(path, params) {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const url = new URL(`${this.baseUrl}${normalizedPath}`);
    if (params && typeof params === 'object') {
      Object.keys(params).forEach(k => {
        if (params[k] !== undefined && params[k] !== null) url.searchParams.append(k, String(params[k]));
      });
    }
    return url.toString();
  }

  _getDefaultHeaders() {
    const headers = {
      Accept: 'application/json',
    };


    // Prefer the MediaBrowser Authorization header (recommended) unless authMode forces query
    if (this.apiKey && this.authMode !== 'query') {
      headers.Authorization = `MediaBrowser Token="${this.apiKey}"`;
    }

    return headers;
  }

  async _request(method, path, { params, body, headers: customHeaders, responseType = 'auto' } = {}) {
    // if authMode === 'query', add ApiKey param to initial request
    const paramsWithAuth = Object.assign({}, params || {});
    if (this.apiKey && this.authMode === 'query') {
      paramsWithAuth.ApiKey = this.apiKey;
    }

    let url = this._buildUrl(path, paramsWithAuth);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    const headers = Object.assign({}, this._getDefaultHeaders(), customHeaders || {});
    const opts = {
      method,
      headers,
      signal: controller.signal
    };

    if (body !== undefined && body !== null) {
      if (!(body instanceof Buffer) && typeof body === 'object') {
        opts.body = JSON.stringify(body);
        if (!opts.headers['Content-Type']) opts.headers['Content-Type'] = 'application/json';
      } else {
        opts.body = body;
      }
    }

    let res;
    try {
      res = await this._fetch(url, opts);
    } catch (err) {
      if (err.name === 'AbortError') throw new Error(`Request timed out after ${this.timeout} ms`);
      throw err;
    }

    // If in 'auto' mode and unauthorized and we used Authorization header, retry once using query param auth (ApiKey)
    if (this.authMode === 'auto' && res && res.status === 401 && this.apiKey && opts.headers && opts.headers.Authorization) {
      try {
        // clear previous timeout and create a fresh controller for retry
        clearTimeout(timeoutId);
        const controller2 = new AbortController();
        const timeoutId2 = setTimeout(() => controller2.abort(), this.timeout);

        // build url with api_key param
        const urlObj = new URL(url);
        // Use ApiKey (capitalized) as recommended
        urlObj.searchParams.set('ApiKey', this.apiKey);
        const retryUrl = urlObj.toString();

        const retryOpts = {
          method: opts.method,
          headers: Object.assign({}, opts.headers),
          signal: controller2.signal,
        };
        // remove header auth for retry
        delete retryOpts.headers.Authorization;

        res = await this._fetch(retryUrl, retryOpts);
        clearTimeout(timeoutId2);
      } catch (err) {
        if (err.name === 'AbortError') throw new Error(`Request timed out after ${this.timeout} ms`);
        throw err;
      } finally {
        // ensure original timeout cleared
        clearTimeout(timeoutId);
      }
    } else {
      clearTimeout(timeoutId);
    }

    const contentType = res.headers && res.headers.get ? res.headers.get('content-type') : null;
    const isJson = contentType && contentType.includes('application/json');

    if (!res.ok) {
      const text = isJson ? await res.json().catch(() => null) : await res.text().catch(() => null);
      const msg = text && typeof text === 'object' ? JSON.stringify(text) : String(text);
      const err = new Error(`Jellyfin API error ${res.status} ${res.statusText}: ${msg}`);
      err.status = res.status;
      err.body = text;
      throw err;
    }

    if (responseType === 'buffer') {
      const ab = await res.arrayBuffer();
      return Buffer.from(ab);
    }

    if (responseType === 'text') {
      return res.text();
    }

    if (isJson) return res.json();
    return res.text();
  }

  // Convenience wrappers
  get(path, params) {
    return this._request('GET', path, { params });
  }

  post(path, body) {
    return this._request('POST', path, { body });
  }

  getBinary(path, params, headers) {
    return this._request('GET', path, { params, headers, responseType: 'buffer' });
  }

  postBinary(path, body, { params, headers } = {}) {
    return this._request('POST', path, { body, params, headers, responseType: 'text' });
  }

  // Initial endpoints
  getItems(queryParams) {
    return this.get('/Items', queryParams);
  }

  postItem(id, data) {
    if (!id) throw new Error('postItem requires an id');
    return this.post(`/Items/${encodeURIComponent(id)}`, data);
  }

  getUsers() {
    return this.get('/Users');
  }

  getPrimaryImage(itemId) {
    if (!itemId) throw new Error('getPrimaryImage requires an itemId');
    return this.getBinary(`/Items/${encodeURIComponent(itemId)}/Images/Primary`, { Quality: 90 });
  }

  uploadPrimaryImage(itemId, imageBuffer, format = 'jpeg') {
    if (!itemId) throw new Error('uploadPrimaryImage requires an itemId');
    const mimeType = format === 'jpg' ? 'image/jpeg' : `image/${format}`;
    // Jellyfin expects base64-encoded body with Content-Type: image/*
    // Must use http.request with explicit Content-Length; fetch sends chunked
    // transfer encoding for Buffer bodies which causes FromBase64Transform to fail.
    const base64Buf = Buffer.from(
      Buffer.isBuffer(imageBuffer) ? imageBuffer.toString('base64') : imageBuffer,
      'utf8'
    );
    return this._httpUpload(
      `/Items/${encodeURIComponent(itemId)}/Images/Primary`,
      base64Buf,
      mimeType
    );
  }

  _httpUpload(path, bodyBuffer, contentType) {
    const url = new URL(`${this.baseUrl}${path}`);
    const isHttps = url.protocol === 'https:';
    const transport = isHttps ? require('https') : require('http');

    const headers = {
      'Content-Type': contentType,
      'Content-Length': bodyBuffer.length,
    };
    if (this.apiKey && this.authMode !== 'query') {
      headers.Authorization = `MediaBrowser Token="${this.apiKey}"`;
    } else if (this.apiKey) {
      url.searchParams.set('ApiKey', this.apiKey);
    }

    return new Promise((resolve, reject) => {
      const timeoutMs = this.timeout || DEFAULT_TIMEOUT;
      const req = transport.request(
        {
          hostname: url.hostname,
          port: url.port || (isHttps ? 443 : 80),
          path: url.pathname + url.search,
          method: 'POST',
          headers,
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => { data += chunk; });
          res.on('end', () => {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve(data || null);
            } else {
              const err = new Error(`Jellyfin API error ${res.statusCode}: ${data.slice(0, 200)}`);
              err.status = res.statusCode;
              reject(err);
            }
          });
        }
      );
      req.setTimeout(timeoutMs, () => {
        req.destroy();
        reject(new Error(`Request timed out after ${timeoutMs} ms`));
      });
      req.on('error', reject);
      req.write(bodyBuffer);
      req.end();
    });
  }
}

module.exports = JellyfinClient;
