const fs = require("fs");
const path = require("path");
const { init: initDb } = require("../db/sqlite");
const dotenv = require("dotenv");
const { getFilmAffinityRating } = require("../services/filmaffinity");

dotenv.config({ quiet: true });

const OUTPUT_FILE = path.join(__dirname, "../../data/ratings.json");
const DEFAULT_DB_PATH = path.join(__dirname, "../../data/ratings.db");
const REQUEST_DELAY_MS = Number(process.env.REQUEST_DELAY_MS || 5000);
const JELLYFIN_URL = (
  process.env.JELLYFIN_BASE_URL || process.env.JELLYFIN_URL || "http://localhost:8096"
).replace(/\/+$/, "");
const JELLYFIN_API_KEY = process.env.JELLYFIN_API_KEY;
const INCLUDE_ITEM_TYPES = (process.env.SYNC_JELLYFIN_INCLUDE_ITEM_TYPES || "Movie")
  .split(",")
  .map((v) => v.trim())
  .filter(Boolean)
  .join(",");

// `CACHE_TTL` (seconds) is the canonical cache TTL used by the app (see .env).
// Legacy variable `CACHE_TTL_DAYS` has been removed to avoid duplication.
const CACHE_TTL_SECONDS = process.env.CACHE_TTL ? Number(process.env.CACHE_TTL) : undefined;
// Internally use days for updater logic; derive from CACHE_TTL if present.
const CACHE_TTL_DAYS = CACHE_TTL_SECONDS ? Math.round(CACHE_TTL_SECONDS / 86400) : 30;
const RECENT_TTL_DAYS = Number(process.env.RECENT_TTL_DAYS || 7);
const RECENT_YEARS = Number(process.env.RECENT_YEARS || 2);

const { isStale, buildCacheKey } = require("./cacheUtils");

if (!JELLYFIN_API_KEY) {
  console.error("Missing Jellyfin API key in .env (JELLYFIN_API_KEY)");
  process.exit(1);
}

async function fetchJellyfin(pathname, searchParams = {}, authMode = "header") {
  const url = new URL(pathname, `${JELLYFIN_URL}/`);

  Object.entries(searchParams).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, value);
    }
  });

  const headers = {};
  if (authMode === "header") {
    headers["Authorization"] = `MediaBrowser Token="${JELLYFIN_API_KEY}"`;
  } else {
    url.searchParams.set("ApiKey", JELLYFIN_API_KEY);
  }

  const res = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(30000),
  });

  if (res.ok) {
    return res.json();
  }

  return { status: res.status, url: url.toString() };
}

async function fetchTitlesFromJellyfin() {
  console.log(`Fetching titles from Jellyfin at ${JELLYFIN_URL}...`);
  console.log(`IncludeItemTypes for cache update: ${INCLUDE_ITEM_TYPES}`);

  const searchParams = {
    IncludeItemTypes: INCLUDE_ITEM_TYPES,
    Recursive: "true",
    Fields: "Name,ProductionYear",
  };

  let data = await fetchJellyfin("/Items", searchParams, "header");
  if (data?.status === 401) {
    console.warn("Jellyfin rejected header-based API authentication, retrying with query auth...");
    data = await fetchJellyfin("/Items", searchParams, "query");
  }

  if (data?.status === 401) {
    throw new Error(
      `Jellyfin authentication failed with the configured API key. Verify JELLYFIN_API_KEY and server permissions for ${JELLYFIN_URL}.`
    );
  }

  if (data?.status) {
    throw new Error(`Jellyfin API error (${data.status}) while requesting ${data.url}`);
  }

  const titles = (data.Items || [])
    .map((i) => ({ title: i.Name, year: i.ProductionYear }))
    .filter((t) => t.title);

  console.log(`Found ${titles.length} titles in Jellyfin.`);
  return titles;
}

function loadExistingCache() {
  // Legacy JSON loader; kept for migration. Prefer DB when available.
  try {
    if (!fs.existsSync(OUTPUT_FILE)) return {};
    const raw = fs.readFileSync(OUTPUT_FILE, "utf-8");
    return JSON.parse(raw) || {};
  } catch (err) {
    console.warn("Failed to read existing cache, starting fresh:", err.message);
    return {};
  }
}

async function updateCache() {
  console.log("Starting incremental FilmAffinity cache update...");
  let titles = await fetchTitlesFromJellyfin();
  // Optionally limit number of titles to process (useful for testing)
  const MAX_TITLES = process.env.SYNC_JELLYFIN_LIMIT ? Number(process.env.SYNC_JELLYFIN_LIMIT) : undefined;
  if (MAX_TITLES && Number.isFinite(MAX_TITLES) && MAX_TITLES > 0) {
    console.log(`Limiting titles to first ${MAX_TITLES} for this run (testing mode)`);
    titles = titles.slice(0, MAX_TITLES);
  }
  // Initialize DB
  const DB_PATH = process.env.DB_PATH || DEFAULT_DB_PATH;
  const db = initDb(DB_PATH);

  // Migrate JSON -> SQLite if DB empty and JSON present
  try {
    const rows = db.getAll();
    if (rows.length === 0 && fs.existsSync(OUTPUT_FILE)) {
      console.log("Migrating existing JSON cache into SQLite DB...");
      const existing = loadExistingCache();
      for (const [, v] of Object.entries(existing)) {
        const key = buildCacheKey(v.title, v.year);
        db.upsert({ key, title: v.title, year: v.year, rating: v.rating, last_rating: v.rating, votes: v.votes, url: v.url, last_updated: v.last_updated, raw: JSON.stringify(v) });
      }
      console.log("Migration complete.");
    }
  } catch (e) {
    console.warn("Migration check failed:", e.message);
  }

  // Sort recent movies first (prioritize updates)
  titles.sort((a, b) => (Number(b.year || 0) - Number(a.year || 0)));

  const total = titles.length;
  let toUpdate = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;

  // Pre-count stale entries to show [X/Y] progress during the run
  const staleCount = titles.filter(({ title, year }) =>
    isStale(db.getRating(buildCacheKey(title, year)), year, { cacheTTL: CACHE_TTL_DAYS, recentTTL: RECENT_TTL_DAYS, recentYears: RECENT_YEARS })
  ).length;
  console.log(`${total - staleCount} fresh, ${staleCount} to fetch.`);

  let consecutiveFailures = 0;
  const SCRAPER_RETRIES = Number(process.env.SCRAPER_RETRIES || 3);
  const SCRAPER_RETRY_DELAY = Number(process.env.SCRAPER_RETRY_DELAY || 1000);
  const MAX_CONSECUTIVE_FAILURES = Number(process.env.SCRAPER_MAX_CONSECUTIVE || 5);

  for (const { title, year } of titles) {
    const key = buildCacheKey(title, year);
    const entry = db.getRating(key);

    if (!isStale(entry, year, { cacheTTL: CACHE_TTL_DAYS, recentTTL: RECENT_TTL_DAYS, recentYears: RECENT_YEARS })) {
      skipped++;
      continue;
    }

    toUpdate++;
    console.log(`[${toUpdate}/${staleCount}] Fetching: ${title} (${year ?? "unknown"})`);

    try {
      // Retry transient failures with exponential backoff
      let data = null;
      let lastErr = null;
      for (let attempt = 1; attempt <= SCRAPER_RETRIES; attempt++) {
        try {
          data = await getFilmAffinityRating(title, year);
          lastErr = null;
          break;
        } catch (e) {
          lastErr = e;
          const backoff = SCRAPER_RETRY_DELAY * Math.pow(2, attempt - 1);
          console.warn(`Attempt ${attempt} failed for ${title}, retrying in ${backoff}ms: ${e && e.message ? e.message : e}`);
          await new Promise((r) => setTimeout(r, backoff));
        }
      }

      if (!data && lastErr) throw lastErr;

      if (data && data.rating) {
        const now = new Date().toISOString();
        db.upsert({
          key,
          title,
          year: year || null,
          rating: data.rating,
          last_rating: data.rating,
          votes: data.votes || null,
          url: data.url || null,
          last_updated: now,
          raw: JSON.stringify(data),
        });
        updated++;
        consecutiveFailures = 0;
        console.log(`[${toUpdate}/${staleCount}] Updated: ${title} => ${data.rating}`);
      } else {
        failed++;
        consecutiveFailures++;
        console.warn(`[${toUpdate}/${staleCount}] No rating found for ${title}`);
      }
    } catch (err) {
      failed++;
      consecutiveFailures++;
      console.error(`[${toUpdate}/${staleCount}] Failed: ${title}: ${err && err.message ? err.message : err}`);
    }

    // Backoff if multiple consecutive failures detected
    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      const backoffMs = Math.min(60000, REQUEST_DELAY_MS * consecutiveFailures);
      console.warn(`Detected ${consecutiveFailures} consecutive failures, backing off for ${backoffMs}ms`);
      await new Promise((r) => setTimeout(r, backoffMs));
      // Optionally restart shared browser in scraper to recover from corrupted sessions
      try {
        const scraper = require('../scraper/filmaffinity');
        if (typeof scraper.restartBrowser === 'function') {
          console.info('Restarting shared scraper browser to recover from failures');
          await scraper.restartBrowser();
        }
      } catch (e) {
        // ignore
      }
    }

    await new Promise((r) => setTimeout(r, REQUEST_DELAY_MS));
  }

  db.close();
  console.log(`Done. total=${total}, fetched=${toUpdate}, updated=${updated}, skipped=${skipped}, failed=${failed}`);
}

updateCache()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("updateCache failed:", err.message);
    process.exit(1);
  });