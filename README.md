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
5. Serving as API-only provider for external worker consumers.

This repository is API-only. Worker execution is handled externally in https://github.com/Cruzadera/fa-jellyfin-sync

### What the project does today

- HTTP API for movie lookup by title/year.
- HTTP batch API contract for external integrations.
- In-memory cache (node-cache) + persistent cache (data/ratings.db).
- Scraper powered by puppeteer-extra + stealth plugin.

### Quick architecture

- npm start: starts the API (src/index.js).
- POST /ratings/batch is the main integration contract for an external Jellyfin sync worker.

### Requirements

- Node.js 20+
- Access/network to this API from your external worker deployment

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

### External worker

Worker/scheduler logic is out of scope for this repository and lives in:

- https://github.com/Cruzadera/fa-jellyfin-sync

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
- The API process configures NodeCache with a global `CACHE_TTL` (seconds), but
  entries are set with per-entry TTLs based on movie year so recent movies are
  refreshed more often while older movies are cached longer.
 
- Jellyfin:
  - Not used by this API-only repository.
- Scraping/cache:
  - REQUEST_DELAY_MS
  - RECENT_TTL_DAYS
  - RECENT_YEARS
  - DEBUG_SCREENSHOTS

### Docker

One service is defined in docker-compose.yml:

- app: REST API and canonical ratings provider

Start full stack:

```bash
docker compose up -d --build
```

The ./data:/app/data volume persists SQLite data.

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
