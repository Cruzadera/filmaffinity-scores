const express = require("express");
const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");
const NodeCache = require("node-cache");
const { getFilmAffinityRating, ScraperError } = require("./services/filmaffinity");
dotenv.config();

const app = express();

// In-memory cache TTL (defaults to 1 day)
const cache = new NodeCache({
  stdTTL: parseInt(process.env.CACHE_TTL || "86400"),
  checkperiod: 120,
});

const PORT = process.env.PORT || 8085;
const CACHE_FILE = path.join(__dirname, "../data/ratings.json");

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

function readLocalCache() {
  if (!fs.existsSync(CACHE_FILE)) {
    return {};
  }

  try {
    return JSON.parse(fs.readFileSync(CACHE_FILE, "utf-8"));
  } catch (err) {
    console.error("Error reading local cache:", err.message);
    return {};
  }
}

function writeLocalCache(cacheData) {
  fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cacheData, null, 2), "utf-8");
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
  const legacyCacheKey = buildCacheKey(title);

  if (cache.has(cacheKey)) {
    console.log(`In-memory cache hit: ${title}${year ? ` (${year})` : ""}`);
    return res.json(cache.get(cacheKey));
  }

  const localCache = readLocalCache();
  const cachedEntry = localCache[cacheKey];
  const legacyEntry = !year ? null : localCache[legacyCacheKey];
  const cacheHit =
    cachedEntry ||
    (legacyEntry && (!legacyEntry.year || String(legacyEntry.year) === year) ? legacyEntry : null);

  if (cacheHit) {
    console.log(`File cache hit: ${title}${year ? ` (${year})` : ""}`);
    cache.set(cacheKey, cacheHit);
    return res.json(cacheHit);
  }

  console.log(`Fetching FilmAffinity rating for: ${title}${year ? ` (${year})` : ""}`);

  try {
    const data = await getFilmAffinityRating(title, year);

    if (!data || !data.rating) {
      console.warn(`No result found for "${title}"${year ? ` (${year})` : ""}`);
      return res.status(404).json({ error: "No result found" });
    }

    cache.set(cacheKey, data);
    localCache[cacheKey] = data;
    writeLocalCache(localCache);

    console.log(`Stored in cache: ${title}${year ? ` (${year})` : ""} (${data.rating})`);
    return res.json(data);
  } catch (err) {
    console.error("Error fetching rating:", err && err.message ? err.message : err);
    if (err && (err.name === "ScraperError" || err instanceof ScraperError)) {
      return res.status(502).json({ error: "Scraper error", message: err.message });
    }
    return res.status(500).json({ error: "Internal server error" });
  }
}

// Request logging middleware
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
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
