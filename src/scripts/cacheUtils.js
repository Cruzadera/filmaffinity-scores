function daysSince(iso) {
  return (Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24);
}

function computeTTLForYear(year, opts = {}) {
  const { cacheTTL = 30, recentTTL = 7, recentYears = 2 } = opts;
  if (!year || isNaN(Number(year))) return cacheTTL;
  const currentYear = new Date().getFullYear();
  if (Number(year) >= currentYear - recentYears) return recentTTL;
  return cacheTTL;
}

function isStale(entry, year, opts = {}) {
  if (!entry) return true;
  if (!entry.last_updated) return true;
  const ttl = computeTTLForYear(year, opts);
  return daysSince(entry.last_updated) > ttl;
}

function getTTLSeconds(year, opts = {}) {
  // Determine defaults from environment to keep parity with updateCache.js
  const defaultCacheTTLDays = process.env.CACHE_TTL
    ? Math.round(Number(process.env.CACHE_TTL) / 86400)
    : 30;
  const cacheTTL = opts.cacheTTL !== undefined ? opts.cacheTTL : defaultCacheTTLDays;
  const recentTTL = opts.recentTTL !== undefined ? opts.recentTTL : Number(process.env.RECENT_TTL_DAYS || 7);
  const recentYears = opts.recentYears !== undefined ? opts.recentYears : Number(process.env.RECENT_YEARS || 2);

  const days = computeTTLForYear(year, { cacheTTL, recentTTL, recentYears });
  return Math.round(days * 86400);
}

function normalizeTitle(title) {
  return String(title || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function buildCacheKey(title, year) {
  const normalizedTitle = normalizeTitle(title);
  const normalizedYear = String(year || "").trim();
  return normalizedYear ? `${normalizedTitle}::${normalizedYear}` : normalizedTitle;
}

module.exports = {
  daysSince,
  computeTTLForYear,
  isStale,
  getTTLSeconds,
  normalizeTitle,
  buildCacheKey,
};



