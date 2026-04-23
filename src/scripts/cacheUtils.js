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

module.exports = {
  daysSince,
  computeTTLForYear,
  isStale,
};
