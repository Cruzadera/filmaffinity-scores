const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");
const { getFilmAffinityRating } = require("../services/filmaffinity");

dotenv.config();

const OUTPUT_FILE = path.join(__dirname, "../../data/ratings.json");
const REQUEST_DELAY_MS = Number(process.env.REQUEST_DELAY_MS || 5000);
const JELLYFIN_URL = (process.env.JELLYFIN_URL || "http://localhost:8096").replace(/\/+$/, "");
const JELLYFIN_API_KEY = process.env.JELLYFIN_API_KEY;

const CACHE_TTL_DAYS = Number(process.env.CACHE_TTL_DAYS || 30);
const RECENT_TTL_DAYS = Number(process.env.RECENT_TTL_DAYS || 7);
const RECENT_YEARS = Number(process.env.RECENT_YEARS || 2);

const { isStale } = require("./cacheUtils");

if (!JELLYFIN_API_KEY) {
  console.error("Missing Jellyfin API key in .env (JELLYFIN_API_KEY)");
  process.exit(1);
}

function daysSince(iso) {
  return (Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24);
}

function computeTTLForYear(year) {
  if (!year || isNaN(Number(year))) return CACHE_TTL_DAYS;
  const currentYear = new Date().getFullYear();
  if (Number(year) >= currentYear - RECENT_YEARS) return RECENT_TTL_DAYS;
  return CACHE_TTL_DAYS;
}

function isStale(entry, year) {
  if (!entry) return true;
  if (!entry.last_updated) return true;
  const ttl = computeTTLForYear(year);
  return daysSince(entry.last_updated) > ttl;
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

  const searchParams = {
    IncludeItemTypes: "Movie",
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
  const existing = loadExistingCache();

  // Normalize keys to lowercase for consistent lookup
  const cache = { ...existing };

  // Sort recent movies first (prioritize updates)
  titles.sort((a, b) => (Number(b.year || 0) - Number(a.year || 0)));

  let total = titles.length;
  let toUpdate = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (const { title, year } of titles) {
    const key = title.toLowerCase();
    const entry = cache[key];

    if (!isStale(entry, year, { cacheTTL: CACHE_TTL_DAYS, recentTTL: RECENT_TTL_DAYS, recentYears: RECENT_YEARS })) {
      skipped++;
      console.log(`Skipped (fresh): ${title}`);
      continue;
    }

    toUpdate++;
    console.log(`Fetching rating for: ${title} (year: ${year ?? "unknown"})`);

    try {
      const data = await getFilmAffinityRating(title);
      if (data && data.rating) {
        cache[key] = {
          ...data,
          title, // original title casing
          year: year || null,
          last_updated: new Date().toISOString(),
        };
        updated++;
        console.log(`Updated: ${title} => ${data.rating}`);
      } else {
        failed++;
        console.warn(`No rating found for ${title}; keeping existing entry if present`);
      }
    } catch (err) {
      failed++;
      console.error(`Failed to fetch ${title}: ${err.message}`);
    }

    await new Promise((r) => setTimeout(r, REQUEST_DELAY_MS));
  }

  // Persist cache atomically
  try {
    fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
    const tmp = `${OUTPUT_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(cache, null, 2), "utf-8");
    fs.renameSync(tmp, OUTPUT_FILE);
    console.log(`Cache written to ${OUTPUT_FILE}`);
  } catch (err) {
    console.error("Failed to write cache:", err.message);
    process.exit(1);
  }

  console.log(`Summary: total=${total}, toUpdate=${toUpdate}, updated=${updated}, skipped=${skipped}, failed=${failed}`);
}

updateCache().catch((err) => {
  console.error("updateCache failed:", err.message);
  process.exit(1);
});