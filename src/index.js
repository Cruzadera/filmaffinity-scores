const express = require("express");
const path = require("path");
const dotenv = require("dotenv");
const NodeCache = require("node-cache");
const { getFilmAffinityRating, ScraperError } = require("./scraper/filmaffinity");
const logger = require("./logging");
const { init: initDb } = require("./db/sqlite");
dotenv.config();

const app = express();

// In-memory cache TTL (defaults to 1 day)
const cache = new NodeCache({
  stdTTL: parseInt(process.env.CACHE_TTL || "86400"),
  checkperiod: 120,
});

const PORT = process.env.PORT || 8085;
const DB_FILE = process.env.DB_PATH || path.join(__dirname, "../data/ratings.db");
const db = initDb(DB_FILE);

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
  const title = normalizeTitle(query.title);
  const year = normalizeYear(query.year);

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

async function handleRatingRequest(req, res, { requireYear = false } = {}) {
  const validation = validateMovieQuery(req.query, requireYear);
  if (validation.error) {
    return res.status(400).json({ error: validation.error });
  }

  const { title, year } = validation;
  const cacheKey = buildCacheKey(title, year);

  if (cache.has(cacheKey)) {
    logger.info(`In-memory cache hit: ${title}${year ? ` (${year})` : ""}`);
    return res.json(cache.get(cacheKey));
  }

  // DB lookup (includes fallback to title-only key for migrated entries)
  let dbEntry = db.getRating(cacheKey);
  if (!dbEntry && year) {
    const legacyEntry = db.getRating(buildCacheKey(title));
    if (legacyEntry && (!legacyEntry.year || String(legacyEntry.year) === year)) dbEntry = legacyEntry;
  }
  if (dbEntry) {
    const hitData = dbEntry.raw
      ? JSON.parse(dbEntry.raw)
      : { title: dbEntry.title, year: dbEntry.year, rating: dbEntry.rating, votes: dbEntry.votes, url: dbEntry.url };
    logger.info(`DB cache hit: ${title}${year ? ` (${year})` : ""}`);
    cache.set(cacheKey, hitData);
    return res.json(hitData);
  }

  logger.info(`Fetching FilmAffinity rating for: ${title}${year ? ` (${year})` : ""}`);

  try {
    const data = await getFilmAffinityRating(title, year);

    if (!data || !data.rating) {
      logger.warn(`No result found for "${title}"${year ? ` (${year})` : ""}`);
      return res.status(404).json({ error: "No result found" });
    }

    cache.set(cacheKey, data);
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

    logger.info(`Stored in cache: ${title}${year ? ` (${year})` : ""} (${data.rating})`);
    return res.json(data);
  } catch (err) {
    logger.error("Error fetching rating:", err && err.message ? err.message : err);
    if (err && (err.name === "ScraperError" || err instanceof ScraperError)) {
      return res.status(502).json({ error: "Scraper error", message: err.message });
    }
    return res.status(500).json({ error: "Internal server error" });
  }
}

// Request logging middleware
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.url}`);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  next();
});

app.get("/movie", (req, res) => handleRatingRequest(req, res, { requireYear: true }));

app.get("/rating", (req, res) => handleRatingRequest(req, res));

// Health endpoint
app.get("/health", (req, res) =>
  res.json({ status: "ok", cacheTTL: cache.options.stdTTL })
);

// Server startup
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`FilmAffinity Scores API running on port ${PORT}`);
    console.log(`Cache TTL: ${cache.options.stdTTL}s`);
  });
}

module.exports = { app, buildCacheKey, normalizeTitle, validateMovieQuery };
