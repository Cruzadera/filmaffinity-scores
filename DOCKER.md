# Docker usage

Requirements: Docker and Docker Compose installed.

How to build the image

```bash
docker build -t filmaffinity-scores .
```

How to run with docker-compose

1. Copy `.env.example` to `.env` and edit values if needed.
2. Start the app:

```bash
docker compose up --build
```

This mounts the local `data/` folder into the container to persist cache between runs.


Environment variables reference

- `PORT` : port in container and host mapping (default `8085`).
- `CACHE_TTL` : cache TTL seconds (default `86400`).
- `JELLYFIN_BASE_URL`: your Jellyfin base URL (e.g. `http://192.168.1.31:8096`).
- `JELLYFIN_API_KEY`: your Jellyfin API key.
- `JELLYFIN_AUTH_MODE`: auth mode for Jellyfin client (`auto`|`header`|`query`).
- `PUPPETEER_EXECUTABLE_PATH` : optional — set only if you want to use a system-installed Chromium.
- `DEBUG_SCREENSHOTS` : set to `true` to persist debug screenshots under the `data/` folder inside the container (disabled by default).

Sync script specific variables (see `.env.example`):

- `SYNC_JELLYFIN_DRY_RUN`, `SYNC_JELLYFIN_LIMIT`, `SYNC_JELLYFIN_BATCH_SIZE`, `SYNC_JELLYFIN_DELAY_MS`, `SYNC_JELLYFIN_RETRIES`, `SYNC_JELLYFIN_RETRY_DELAY`, `SYNC_JELLYFIN_SET_CRITIC`, `SYNC_JELLYFIN_FORCE`, `SYNC_JELLYFIN_PAGE_SIZE`, `SYNC_JELLYFIN_INCLUDE_ITEM_TYPES`.

Notes on Puppeteer

- The image installs runtime libraries required by Chromium; Puppeteer will download a compatible Chromium during `npm install` inside the image.
- If you encounter Chromium sandbox issues, try launching Puppeteer with `--no-sandbox --disable-setuid-sandbox` flags or set `PUPPETEER_EXECUTABLE_PATH` to a system Chromium binary.

Validation

- The compose service exposes the app on `http://localhost:PORT`.
- Data is persisted in `./data/ratings.json`.
