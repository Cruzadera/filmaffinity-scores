# FilmAffinity Scores (API + Jellyfin Sync)

![Node.js](https://img.shields.io/badge/Node.js-20.x-brightgreen?logo=node.js)
![Docker](https://img.shields.io/badge/Docker-ready-blue?logo=docker)
![License](https://img.shields.io/badge/license-MIT-lightgrey)

## EN

Node.js service for:

1. Retrieving FilmAffinity ratings (Puppeteer-based scraping).
2. Exposing ratings through a REST API.
3. Persisting cache in SQLite.
4. Syncing ratings into Jellyfin.
5. Optionally rewriting posters in Jellyfin with a visual rating badge.

This is not only an API: it also includes batch workflows and a scheduler to keep your media library up to date.

### What the project does today

- HTTP API for movie lookup by title/year.
- In-memory cache (node-cache) + persistent cache (data/ratings.db).
- Scraper powered by puppeteer-extra + stealth plugin.
- Jellyfin metadata sync (CommunityRating, optional CriticRating).
- Poster badge processing and poster upload to Jellyfin.
- Scheduler loop for automated updates.

### Quick architecture

- npm start: starts the API (src/index.js).
- npm run update-cache: scans Jellyfin library and refreshes SQLite cache.
- npm run sync-jellyfin: syncs FilmAffinity ratings into Jellyfin.
- npm run scheduler: infinite loop running update-cache + sync-jellyfin every cycle.

### Requirements

- Node.js 20+
- Access to a Jellyfin instance (for sync/scheduler workflows)
- JELLYFIN_API_KEY with read/update permissions

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

Recommended command:

```bash
npm run sync-jellyfin
```

Default mode is dry-run (SYNC_JELLYFIN_DRY_RUN=true), so changes are computed but not applied.

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
  - CACHE_TTL in seconds (default 86400)
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

- app: REST API
- scheduler: automatic cache + sync cycle

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
- Jellyfin updates depend on API key permissions.
- In production, validate with dry-run before enabling write mode.

## Disclaimer

This project is intended for personal/self-hosted and educational use. Please respect third-party terms of use.

## License

See LICENSE.
