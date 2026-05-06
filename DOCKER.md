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

API service:

```bash
docker compose up -d --build
```

Run worker/scheduler externally from https://github.com/Cruzadera/fa-jellyfin-sync.

## Defined service

- `app`:
	- Runs `npm start`
	- Exposes port `8085` in the container
	- Maps `${PORT:-8085}:8085` on the host
	- Acts as the canonical ratings provider for external integrations

## Data persistence

The service mounts:

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

- Scraping/cache:
	- `REQUEST_DELAY_MS`
	- `RECENT_TTL_DAYS`
	- `RECENT_YEARS`
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
```
