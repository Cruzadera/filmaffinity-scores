# FilmAffinity Scores API

![Node.js](https://img.shields.io/badge/Node.js-20.x-brightgreen?logo=node.js)
![Docker](https://img.shields.io/badge/Docker-ready-blue?logo=docker)
![License](https://img.shields.io/badge/license-MIT-lightgrey)
[![es](https://img.shields.io/badge/lang-es-yellow.svg)](README.es.md)

Node.js service for:

1. Retrieving FilmAffinity ratings (Puppeteer-based scraping).
2. Exposing ratings through a REST API.
3. Persisting cache in SQLite.
4. Providing a stable HTTP contract for external integrations such as Jellyfin sync.
5. Keeping a transitional in-repo Jellyfin compatibility flow while the integration is extracted.

This is in transition to an API-first architecture. Jellyfin sync still exists in this repository for compatibility, but the integration is being separated into an external consumer service.

### What the project does today

- HTTP API for movie lookup by title/year.
- HTTP batch API contract for external integrations.
- In-memory cache (node-cache) + persistent cache (data/ratings.db).
- Scraper powered by puppeteer-extra + stealth plugin.
- Transitional Jellyfin metadata sync compatibility flow.
- Transitional poster badge processing and poster upload for Jellyfin.
- Transitional scheduler loop for compatibility during the split.

### Quick architecture

- npm start: starts the API (src/index.js).
- POST /ratings/batch is the main integration contract for an external Jellyfin sync worker.
- npm run update-cache, npm run sync-jellyfin and npm run scheduler remain available as compatibility tooling during the split.

### Requirements

- Node.js 20+
- Access to a Jellyfin instance only if you still use the transitional sync/scheduler tooling
- JELLYFIN_API_KEY with read/update permissions only for the transitional sync flow

### Installation

```bash
git clone https://github.com/Cruzadera/filmaffinity-scores.git
cd filmaffinity-scores
npm install
cp .env.example .env
```

Update .env with real values before running sync tasks.

### API mode (REST)

Start:

```bash
npm start
```

Default base URL: http://localhost:8085

Endpoints:

- GET /movie?title=...&year=...
  - title is required
  - year is required (4 digits)
  - Returns 400/404/502 depending on validation, no result, or scraper errors
- GET /rating?title=...&year=...
  - title is required
  - year is optional
- GET /health
- POST /ratings/batch
  - Content-Type: application/json
  - body: { "items": [{ "title": "Alien", "year": "1979" }, ...] }
  - title is required per item
  - year is optional per item (if present, must be 4 digits)
  - returns per-item status and data/error (partial success supported)

Batch example:

```bash
curl -X POST "http://localhost:8085/ratings/batch" \
  -H "Content-Type: application/json" \
  -d '{
    "items": [
      { "title": "Alien", "year": "1979" },
      { "title": "Blade Runner", "year": "1982" },
      { "title": "Unknown Movie" }
    ]
  }'
```

Typical batch response:

```json
{
  "count": 3,
  "ok": 2,
  "failed": 1,
  "results": [
    {
      "ok": true,
      "status": 200,
      "source": "db",
      "input": { "title": "alien", "year": "1979" },
      "data": {
        "title": "Alien",
        "year": "1979",
        "rating": 8.1,
        "votes": "123456",
        "url": "https://www.filmaffinity.com/es/film123456.html"
      }
    },
    {
      "ok": false,
      "status": 404,
      "error": "No result found",
      "input": { "title": "unknown movie", "year": null }
    }
  ]
}
```

Example:

```bash
curl "http://localhost:8085/movie?title=Alien&year=1979"
```

Typical response:

```json
{
  "title": "Alien",
  "year": "1979",
  "rating": 8.1,
  "votes": "123456",
  "url": "https://www.filmaffinity.com/es/film123456.html"
}
```

### Jellyfin sync

This section describes the transitional compatibility flow that still lives in this repository. The long-term target is to move this worker into a separate repository that consumes the API.

Recommended command:

```bash
npm run sync-jellyfin
```

Default mode is dry-run (SYNC_JELLYFIN_DRY_RUN=true), so changes are computed but not applied.

By default, ratings are resolved with the local scraper. You can switch sync to API-client mode so it consumes `POST /ratings/batch` instead:

```bash
LOG_LEVEL=debug \
SYNC_JELLYFIN_DRY_RUN=true \
SYNC_RATINGS_API_URL=http://localhost:8085 \
node scripts/sync-jellyfin.js --limit=20 --batch-size=5
```

When using Docker Compose, the `scheduler` service now points to `http://app:8085` by default so the sync path consumes the local API instead of scraping directly.

Dry-run sample:

```bash
LOG_LEVEL=debug \
SYNC_JELLYFIN_DRY_RUN=true \
node scripts/sync-jellyfin.js --limit=5 --batch-size=2
```

Apply real updates:

```bash
LOG_LEVEL=debug \
SYNC_JELLYFIN_DRY_RUN=false \
node scripts/sync-jellyfin.js --limit=20 --batch-size=2
```

Sync and process poster badges:

```bash
LOG_LEVEL=debug \
SYNC_JELLYFIN_DRY_RUN=false \
ENABLE_POSTER_BADGES=true \
POSTER_BADGE_POSITION=top-right \
POSTER_BADGE_SIZE=0.2 \
node scripts/sync-jellyfin.js --limit=20 --batch-size=2
```

### Automatic scheduler

The scheduler is now considered a compatibility bridge. In Compose mode it is wired to use the API contract first, which mirrors how the future external Jellyfin worker will behave.

```bash
npm run scheduler
```

Cycle:

1. Runs update-cache
2. Runs sync-jellyfin
3. Waits SLEEP_SECONDS (default 86400)
4. Repeats forever

Set SYNC_JELLYFIN_FORCE_ON_STARTUP=true to force the first sync pass.

### Environment variables (summary)

See .env.example for full details.

- General:
  - PORT (default 8085)
  - LOG_LEVEL (debug|info|warn|error, default info)
  - DB_PATH (default data/ratings.db)
  - BATCH_MAX_ITEMS (default 100) — max items accepted by POST /ratings/batch
  - CACHE_TTL in seconds (default 86400) — canonical value for the in-memory
    cache (node-cache). This takes precedence if set. The updater derives its
    day-based defaults from this value and from the `RECENT_*` settings.

  - RECENT_TTL_DAYS (default 7) — TTL in days applied to recent releases (they
    are refreshed more often).
  - RECENT_YEARS (default 2) — how many years are considered "recent".

Quick notes:
- The scheduler / updater (`update-cache.js`) uses day-based TTL logic
  (`RECENT_TTL_DAYS` / `RECENT_YEARS`) to determine when database entries are
  stale and should be refreshed.
- The API process configures NodeCache with a global `CACHE_TTL` (seconds), but
  the code now sets per-entry TTLs based on movie year so recent movies are
  refreshed more often while older movies are cached longer.
 
- Jellyfin:
  - JELLYFIN_BASE_URL
  - JELLYFIN_API_KEY
  - JELLYFIN_AUTH_MODE (auto|header|query)
  - JELLYFIN_TIMEOUT
- Sync:
  - SYNC_JELLYFIN_DRY_RUN, SYNC_JELLYFIN_LIMIT, SYNC_JELLYFIN_BATCH_SIZE
  - SYNC_JELLYFIN_DELAY_MS, SYNC_JELLYFIN_RETRIES, SYNC_JELLYFIN_RETRY_DELAY
  - SYNC_JELLYFIN_SET_CRITIC, SYNC_JELLYFIN_FORCE, SYNC_JELLYFIN_PAGE_SIZE
  - SYNC_JELLYFIN_INCLUDE_ITEM_TYPES
  - SYNC_RATINGS_API_URL (if set, sync uses API batch mode instead of local scraper)
  - SYNC_RATINGS_API_BATCH_SIZE, SYNC_RATINGS_API_TIMEOUT_MS
- Poster processing:
  - ENABLE_POSTER_BADGES
  - POSTER_BADGE_POSITION
  - POSTER_BADGE_SIZE
  - POSTER_PRESERVE_ORIGINAL
  - POSTER_ORIGINALS_DIR
  - POSTER_BADGE_DRY_RUN / POSTER_BADGE_FORCE
- Scraping/incremental cache:
  - REQUEST_DELAY_MS
  - RECENT_TTL_DAYS
  - RECENT_YEARS
  - DEBUG_SCREENSHOTS

### Docker

Two services are defined in docker-compose.yml:

- app: REST API and canonical ratings provider
- scheduler: transitional compatibility worker wired to consume the API by default

Start full stack:

```bash
docker compose up -d --build
```

Start scheduler only:

```bash
docker compose up -d scheduler
```

The ./data:/app/data volume persists SQLite and poster backups.

### Tests

```bash
npm test
```

### Notes

- Scraping can break if FilmAffinity changes HTML or anti-bot behavior.
- The main contract to preserve is `POST /ratings/batch`; it is intended to survive the Jellyfin split.
- Jellyfin updates depend on API key permissions.
- In production, validate with dry-run before enabling write mode.

## Disclaimer

This project is intended for personal/self-hosted and educational use. Please respect third-party terms of use.

## License

See LICENSE.
