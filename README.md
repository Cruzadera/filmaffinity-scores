# 🎬 FilmAffinity Scores API

![Node.js](https://img.shields.io/badge/Node.js-20.x-brightgreen?logo=node.js)
![Docker](https://img.shields.io/badge/Docker-ready-blue?logo=docker)
![License](https://img.shields.io/badge/license-MIT-lightgrey)

> A lightweight Node.js microservice to retrieve movie ratings from **Filmaffinity** and expose them through a REST API.
> Designed to integrate seamlessly with media servers like Jellyfin or request managers such as Jellyseerr.

---

## 🚀 Features

* 🎯 Reliable scraping using **Puppeteer + Stealth Plugin**
* 💾 Persistent SQLite storage (`data/ratings.db`) with in-memory NodeCache layer
* ⚡ Fast in-memory caching with NodeCache
* 🔌 Simple REST API endpoint: `/movie?title=...&year=...`
* 🔗 Direct integration support with Jellyfin API
* 🕒 Automatic cron job to keep ratings up to date

---

## 📦 Installation

```bash
git clone https://github.com/Cruzadera/filmaffinity-scores.git
cd filmaffinity-scores
npm install
```

---

## ▶️ Usage

Start the service:

```bash
npm start
```

The API will be available at:

```bash
http://localhost:8085
```

---

## 🔌 API

### Get movie rating

```http
GET /movie?title=<title>&year=<year>
```

### Example

```bash
curl "http://localhost:3000/movie?title=Inception&year=2010"
```

### Response

```json
{
  "title": "Inception",
  "year": 2010,
  "rating": 7.3,
  "votes": 120000,
  "url": "https://www.filmaffinity.com/..."
}
```

---

## 🧠 How it works

1. The API receives a movie title (and optional year)
2. It checks the in-memory and local cache
3. If not found, it scrapes Filmaffinity using Puppeteer
4. The result is cached and returned

---

## 🐳 Docker

See [DOCKER.md](DOCKER.md) for build and runtime details.

**Published image**

Official images are published to GitHub Container Registry at `ghcr.io/cruzadera/filmaffinity-scores` by CI.

```bash
docker pull ghcr.io/cruzadera/filmaffinity-scores:latest
```

Run scheduler only:

```bash
docker compose up -d scheduler
```

The scheduler runs `updateCache` and then `sync-jellyfin` on startup and each cycle, so poster badges are updated automatically when enabled.

Run full stack:

```bash
docker compose up -d
```

---

## 🔗 Integrations

This service is designed to work with:

* Jellyfin
* Jellyseerr

---

## 🔌 Jellyfin Sync + Poster Badges

Main scripts:

* `scripts/sync-jellyfin.js` (recommended)
* `src/scripts/updateJellyfin.js` (legacy updater)

Required env vars:

* `JELLYFIN_BASE_URL`
* `JELLYFIN_API_KEY`

Optional env vars:

* `JELLYFIN_AUTH_MODE`: `auto` | `header` | `query`
* `SYNC_JELLYFIN_DRY_RUN`: `true`/`false`
* `SYNC_JELLYFIN_BATCH_SIZE`, `SYNC_JELLYFIN_DELAY_MS`, `SYNC_JELLYFIN_RETRIES`, `SYNC_JELLYFIN_RETRY_DELAY`
* `SYNC_JELLYFIN_PAGE_SIZE`, `SYNC_JELLYFIN_LIMIT`, `SYNC_JELLYFIN_INCLUDE_ITEM_TYPES`

Poster badge env vars:

* `ENABLE_POSTER_BADGES`: `true`/`false` (default `false`)
* `POSTER_BADGE_POSITION`: `top-right` (default), `top-left`, `bottom-right`, `bottom-left`
* `POSTER_BADGE_SIZE`: badge width ratio relative to poster width (default `0.2`)

Example dry-run:

```bash
LOG_LEVEL=debug \
SYNC_JELLYFIN_DRY_RUN=true \
ENABLE_POSTER_BADGES=true \
node scripts/sync-jellyfin.js --limit=5 --batch-size=2
```

Apply updates:

```bash
LOG_LEVEL=debug \
SYNC_JELLYFIN_DRY_RUN=false \
ENABLE_POSTER_BADGES=true \
POSTER_BADGE_POSITION=top-right \
POSTER_BADGE_SIZE=0.2 \
node scripts/sync-jellyfin.js --limit=20 --batch-size=2
```

Poster processing module:

* `src/services/posterProcessor.js`
* `downloadPoster(client, itemId)`
* `generateBadge(rating, options)`
* `applyOverlay(posterBuffer, badgeBuffer, options)`
* `uploadPoster(client, itemId, posterBuffer)`
* `processMoviePoster(client, movie, faData, cacheEntry, options)`

The processor stores `last_rating` and `poster_processed` in SQLite and skips regeneration when unchanged.

Testing:

```bash
npm test
```

---

## ⚠️ Disclaimer

This project uses web scraping to retrieve data from Filmaffinity.
It is intended for personal use and educational purposes.

---

## 📄 License

MIT License
