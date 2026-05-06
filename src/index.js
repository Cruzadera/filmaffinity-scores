const express = require("express");
const path = require("path");
const dotenv = require("dotenv");
const NodeCache = require("node-cache");
const logger = require("./logging");
const { init: initDb } = require("./db/sqlite");
const {
  buildCacheKey,
  normalizeTitle,
  validateMovieQuery,
  getRating,
} = require("./services/ratingsService");
dotenv.config();

const app = express();
app.use(express.json({ limit: "1mb" }));

// In-memory cache TTL (defaults to 1 day)
const cache = new NodeCache({
  stdTTL: parseInt(process.env.CACHE_TTL || "86400"),
  checkperiod: 120,
});

const PORT = process.env.PORT || 8085;
const DB_FILE = process.env.DB_PATH || path.join(__dirname, "../data/ratings.db");
const db = initDb(DB_FILE);
const BATCH_MAX_ITEMS = Math.max(1, Number(process.env.BATCH_MAX_ITEMS || 100));

async function handleRatingRequest(req, res, { requireYear = false } = {}) {
  const validation = validateMovieQuery(req.query, requireYear);
  if (validation.error) {
    return res.status(400).json({ error: validation.error });
  }

  const { title, year } = validation;

  logger.info(`Resolving rating for: ${title}${year ? ` (${year})` : ""}`);
  const result = await getRating({ title, year, cache, db });

  if (!result.ok) {
    if (result.status === 404) {
      logger.warn(`No result found for "${title}"${year ? ` (${year})` : ""}`);
      return res.status(404).json({ error: "No result found" });
    }

    logger.error(`Error fetching rating for ${title}${year ? ` (${year})` : ""}: ${result.message || result.error}`);
    if (result.status === 502) {
      return res.status(502).json({ error: "Scraper error", message: result.message || "Unknown scraper error" });
    }
    return res.status(500).json({ error: "Internal server error" });
  }

  return res.json(result.data);
}

function validateBatchRequestBody(body) {
  if (!body || typeof body !== "object") {
    return { error: 'Body must be a JSON object with an "items" array' };
  }

  if (!Array.isArray(body.items)) {
    return { error: 'Missing "items" array' };
  }

  if (body.items.length === 0) {
    return { error: '"items" must contain at least one element' };
  }

  if (body.items.length > BATCH_MAX_ITEMS) {
    return { error: `"items" exceeds max size (${BATCH_MAX_ITEMS})` };
  }

  return { items: body.items };
}

async function handleBatchRatingsRequest(req, res) {
  const validated = validateBatchRequestBody(req.body);
  if (validated.error) {
    return res.status(400).json({ error: validated.error });
  }

  const results = [];
  for (const input of validated.items) {
    const check = validateMovieQuery(input || {}, false);
    if (check.error) {
      results.push({ ok: false, status: 400, error: check.error, input: input || {} });
      continue;
    }

    const { title, year } = check;
    const ratingResult = await getRating({ title, year, cache, db });
    if (!ratingResult.ok) {
      results.push({
        ok: false,
        status: ratingResult.status,
        error: ratingResult.error,
        message: ratingResult.message,
        input: { title, year: year || null },
      });
      continue;
    }

    results.push({
      ok: true,
      status: 200,
      source: ratingResult.source,
      input: { title, year: year || null },
      data: ratingResult.data,
    });
  }

  return res.json({
    count: results.length,
    ok: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  });
}

// Request logging middleware
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.url}`);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  next();
});

app.get("/movie", (req, res) => handleRatingRequest(req, res, { requireYear: true }));

app.get("/rating", (req, res) => handleRatingRequest(req, res));
app.post("/ratings/batch", (req, res) => handleBatchRatingsRequest(req, res));

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
