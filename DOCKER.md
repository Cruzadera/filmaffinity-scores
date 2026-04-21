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
- `JELLYFIN_URL`: your jellyfin url.
- `JELLYFIN_API_KEY`: your jellyfin api key.
- `PUPPETEER_EXECUTABLE_PATH` : optional — set only if you want to use a system-installed Chromium.
- `DEBUG_SCREENSHOTS` : set to `true` to persist debug screenshots under the `data/` folder inside the container (disabled by default).

Notes on Puppeteer

- The image installs runtime libraries required by Chromium; Puppeteer will download a compatible Chromium during `npm install` inside the image.
- If you encounter Chromium sandbox issues, try launching Puppeteer with `--no-sandbox --disable-setuid-sandbox` flags or set `PUPPETEER_EXECUTABLE_PATH` to a system Chromium binary.

Validation

- The compose service exposes the app on `http://localhost:PORT`.
- Data is persisted in `./data/ratings.json`.
