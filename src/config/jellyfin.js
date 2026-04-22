const DEFAULT_TIMEOUT = 10000;

function toBool(v, def = false) {
  if (v === undefined || v === null || v === '') return def;
  if (typeof v === 'boolean') return v;
  return String(v).toLowerCase() === 'true';
}

function toInt(v, def) {
  if (v === undefined || v === null || v === '') return def;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
}

function getConfig({ strict = false } = {}) {
  const cfg = {
    baseUrl: process.env.JELLYFIN_BASE_URL || null,
    apiKey: process.env.JELLYFIN_API_KEY || null,
    userId: process.env.JELLYFIN_USER_ID || null,
    authMode: process.env.JELLYFIN_AUTH_MODE || 'auto',
    timeout: toInt(process.env.JELLYFIN_TIMEOUT, DEFAULT_TIMEOUT),
  };

  if (cfg.baseUrl) cfg.baseUrl = String(cfg.baseUrl).replace(/\/+$/, '');

  if (strict) {
    const missing = [];
    if (!cfg.baseUrl) missing.push('JELLYFIN_BASE_URL');
    if (!cfg.apiKey) missing.push('JELLYFIN_API_KEY');
    if (missing.length) {
      const plural = missing.length > 1;
      const err = new Error(
        `Missing required environment variable${plural ? 's' : ''}: ${missing.join(', ')}.\n` +
        `Please set them in your environment or .env file. Example:\n` +
        `JELLYFIN_BASE_URL=http://192.168.1.31:8096\nJELLYFIN_API_KEY=your_api_key_here`
      );
      err.missing = missing;
      throw err;
    }
  }

  return cfg;
}

module.exports = {
  getConfig,
};
