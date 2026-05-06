const { getFilmAffinityRating, ScraperError } = require("../scraper/filmaffinity");
const { getTTLSeconds } = require("../scripts/cacheUtils");

function normalizeTitle(title) {
  return String(title || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function normalizeYear(year) {
  return String(year || "").trim();
}

function buildCacheKey(title, year) {
  const normalizedTitle = normalizeTitle(title).toLowerCase();
  const normalizedYear = normalizeYear(year);
  return normalizedYear ? `${normalizedTitle}::${normalizedYear}` : normalizedTitle;
}

function validateMovieQuery(query, requireYear = false) {
  const title = normalizeTitle(query && query.title);
  const year = normalizeYear(query && query.year);

  if (!title) {
    return { error: 'Missing "title" query parameter' };
  }

  if (requireYear && !year) {
    return { error: 'Missing "year" query parameter' };
  }

  if (year && !/^\d{4}$/.test(year)) {
    return { error: '"year" query parameter must be a 4-digit year' };
  }

  return { title, year };
}

function mapDbEntry(dbEntry, fallbackYear = "") {
  return dbEntry.raw
    ? JSON.parse(dbEntry.raw)
    : {
        title: dbEntry.title,
        year: dbEntry.year || fallbackYear || null,
        rating: dbEntry.rating,
        votes: dbEntry.votes,
        url: dbEntry.url,
      };
}

async function getRating({ title, year, cache, db }) {
  const cacheKey = buildCacheKey(title, year);

  if (cache.has(cacheKey)) {
    return { ok: true, source: "memory", data: cache.get(cacheKey) };
  }

  // Includes fallback to title-only key for migrated entries.
  let dbEntry = db.getRating(cacheKey);
  if (!dbEntry && year) {
    const legacyEntry = db.getRating(buildCacheKey(title));
    if (legacyEntry && (!legacyEntry.year || String(legacyEntry.year) === year)) dbEntry = legacyEntry;
  }

  if (dbEntry) {
    const hitData = mapDbEntry(dbEntry, year);
    cache.set(cacheKey, hitData, getTTLSeconds(hitData.year || year));
    return { ok: true, source: "db", data: hitData };
  }

  try {
    const data = await getFilmAffinityRating(title, year);
    if (!data || !data.rating) {
      return { ok: false, status: 404, error: "No result found" };
    }

    cache.set(cacheKey, data, getTTLSeconds(data.year || year));
    db.upsert({
      key: cacheKey,
      title: data.title || title,
      year: data.year || year || null,
      rating: data.rating,
      last_rating: data.rating,
      votes: data.votes,
      url: data.url,
      last_updated: new Date().toISOString(),
      raw: JSON.stringify(data),
    });

    return { ok: true, source: "scraper", data };
  } catch (err) {
    const isScraperError = err && (
      err.name === "ScraperError" ||
      (typeof ScraperError === "function" && err instanceof ScraperError)
    );

    if (isScraperError) {
      return { ok: false, status: 502, error: "Scraper error", message: err.message };
    }

    return { ok: false, status: 500, error: "Internal server error" };
  }
}

module.exports = {
  buildCacheKey,
  normalizeTitle,
  normalizeYear,
  validateMovieQuery,
  getRating,
};