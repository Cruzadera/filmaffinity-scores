# Docker usage

Requirements: Docker and Docker Compose installed.

How to build the image

# Docker Guide

## Requirements

- Docker
- Docker Compose

## Build image

```bash
docker build -t filmaffinity-scores .
```

## Run with Docker Compose

1. Copy `.env.example` to `.env` and configure values.
2. Start services.

Full stack (API + scheduler):

```bash
docker compose up -d --build
```

API only:

```bash
docker compose up -d app
```

Scheduler only:

```bash
docker compose up -d scheduler
```

## Defined services

- `app`:
	- Runs `npm start`
	- Exposes port `8085` in the container
	- Maps `${PORT:-8085}:8085` on the host
- `scheduler`:
	- Runs `node scripts/scheduler.js`
	- Executes recurring `update-cache` + `sync-jellyfin` cycles

## Data persistence

Both services mount:

- `./data:/app/data`

This persists:

- SQLite database (default `data/ratings.db`)
- Original poster backups (default `data/poster-originals`)
- Debug screenshots when `DEBUG_SCREENSHOTS=true`

## Key environment variables (summary)

See `.env.example` for full details.

- General:
	- `PORT` (default `8085`)
	- `LOG_LEVEL` (`debug|info|warn|error`)
	- `DB_PATH` (default `data/ratings.db`)
	- `CACHE_TTL` (seconds)
- Jellyfin:
	- `JELLYFIN_BASE_URL`
	- `JELLYFIN_API_KEY`
	- `JELLYFIN_AUTH_MODE` (`auto|header|query`)
	- `JELLYFIN_TIMEOUT`
- Sync:
	- `SYNC_JELLYFIN_DRY_RUN`
	- `SYNC_JELLYFIN_LIMIT`
	- `SYNC_JELLYFIN_BATCH_SIZE`
	- `SYNC_JELLYFIN_DELAY_MS`
	- `SYNC_JELLYFIN_RETRIES`
	- `SYNC_JELLYFIN_RETRY_DELAY`
	- `SYNC_JELLYFIN_SET_CRITIC`
	- `SYNC_JELLYFIN_FORCE`
	- `SYNC_JELLYFIN_PAGE_SIZE`
	- `SYNC_JELLYFIN_INCLUDE_ITEM_TYPES`
- Poster processing:
	- `ENABLE_POSTER_BADGES`
	- `POSTER_BADGE_POSITION`
	- `POSTER_BADGE_SIZE`
	- `POSTER_PRESERVE_ORIGINAL`
	- `POSTER_ORIGINALS_DIR`
- Scraping:
	- `REQUEST_DELAY_MS`
	- `DEBUG_SCREENSHOTS`
	- `PUPPETEER_EXECUTABLE_PATH` (optional)

## Puppeteer notes for containers

- The `Dockerfile` installs required system packages for Chromium.
- A compatible Chromium is installed during `npm ci`.
- If sandbox issues appear, consider launching Puppeteer with `--no-sandbox --disable-setuid-sandbox` or set `PUPPETEER_EXECUTABLE_PATH` to a system Chromium binary.

## Quick validation

Check the API health endpoint:

```bash
curl "http://localhost:${PORT:-8085}/health"
```

View logs:

```bash
docker compose logs -f app
docker compose logs -f scheduler
```
