const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");
const { getFilmAffinityRating } = require("../services/filmaffinity");

dotenv.config();

const OUTPUT_FILE = path.join(__dirname, "../../data/ratings.json");
const REQUEST_DELAY_MS = 5000;
const JELLYFIN_URL = (process.env.JELLYFIN_URL || "http://localhost:8096").replace(/\/+$/, "");
const JELLYFIN_API_KEY = process.env.JELLYFIN_API_KEY;

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
    // Use the recommended MediaBrowser Authorization header for Jellyfin
    headers["Authorization"] = `MediaBrowser Token="${JELLYFIN_API_KEY}"`;
  } else {
    // Use ApiKey query parameter (capitalization matches Jellyfin recommendation)
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
    Fields: "Name",
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

  const titles = data.Items?.map((i) => i.Name)?.filter(Boolean) || [];

  console.log(`Found ${titles.length} titles in Jellyfin.`);
  return [...new Set(titles)];
}

async function updateCache() {
  console.log("Starting FilmAffinity cache update...");

  const titles = await fetchTitlesFromJellyfin();
  const results = {};
  let count = 0;

  for (const title of titles) {
    console.log(`Fetching rating for: ${title}`);
    const data = await getFilmAffinityRating(title);
    if (data && data.rating) {
      results[title.toLowerCase()] = data;
      console.log(`Stored rating for ${title}: ${data.rating}`);
      count++;
    } else {
      console.warn(`No rating found for ${title}`);
    }

    // Wait between requests to reduce the chance of Cloudflare blocks
    await new Promise((r) => setTimeout(r, REQUEST_DELAY_MS));
  }

  fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2), "utf-8");

  console.log(`Cache updated: ${count}/${titles.length} titles saved.`);
}

updateCache().catch((err) => {
  console.error("updateCache failed:", err.message);
  process.exit(1);
});
