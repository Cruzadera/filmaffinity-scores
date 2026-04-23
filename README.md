# 🎬 FilmAffinity Scores API

![Node.js](https://img.shields.io/badge/Node.js-20.x-brightgreen?logo=node.js)
![Docker](https://img.shields.io/badge/Docker-ready-blue?logo=docker)
![License](https://img.shields.io/badge/license-MIT-lightgrey)

> A lightweight Node.js microservice to retrieve movie ratings from **Filmaffinity** and expose them through a REST API.
> Designed to integrate seamlessly with media servers like Jellyfin or request managers such as Jellyseerr.

---

## 🚀 Features

* 🎯 Reliable scraping using **Puppeteer + Stealth Plugin**
* 💾 Daily-generated local cache (`data/ratings.json`)
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

See [DOCKER.md](DOCKER.md) for build and run instructions using Docker and Docker Compose.

**Published image**

Official images are published to GitHub Container Registry at `ghcr.io/cruzadera/filmaffinity-scores` by CI. To pull:

```bash
docker pull ghcr.io/cruzadera/filmaffinity-scores:latest
```

## ⏰ Scheduler service

The `docker-compose.yml` includes a `scheduler` service that performs an initial full library cache population by running `node src/scripts/updateCache.js` on startup, then runs the same update once per day. The scheduler shares the `./data` volume so the generated `data/ratings.json` is persisted and available to the API container.

You can control the interval with the `SLEEP_SECONDS` environment variable (default `86400` seconds = 24h). To run the scheduler with Docker Compose:

```bash
docker compose up -d scheduler
```

Or start the full stack (API + scheduler):

```bash
docker compose up -d
```


---

## 🔗 Integrations

This service is designed to work with:

* Jellyfin
* Jellyseerr

Future integrations may include:

* Kodi
* Plex

---

## 🔌 Jellyfin integration (client)

This project includes a reusable Jellyfin API client at [src/services/jellyfinClient.js](src/services/jellyfinClient.js). The client is configurable via constructor options or environment variables and supports both API key header auth and query-based `ApiKey` authentication.

- File: [src/services/jellyfinClient.js](src/services/jellyfinClient.js)

Environment variables (or pass as options):

- `JELLYFIN_BASE_URL`: base URL of your Jellyfin server (e.g. `http://192.168.1.31:8096`)
- `JELLYFIN_API_KEY`: Jellyfin API key
- `JELLYFIN_TIMEOUT`: request timeout in milliseconds (optional)
- `JELLYFIN_AUTH_MODE`: authentication mode (`auto`|`header`|`query`) — default is `auto`

### Jellyfin configuration via environment variables

You can configure the Jellyfin integration purely via environment variables. The application validates required values and will fail with a clear message if they are missing when strict validation is used (for example by scripts).

- `JELLYFIN_BASE_URL` (required): base URL of your Jellyfin server (e.g. `http://192.168.1.31:8096`).
- `JELLYFIN_API_KEY` (required): Jellyfin API key.
- `JELLYFIN_USER_ID` (optional): a Jellyfin user id to scope queries.
- `JELLYFIN_AUTH_MODE` (optional): `auto`|`header`|`query` (default `auto`).
- `JELLYFIN_TIMEOUT` (optional): request timeout in milliseconds.

Additional environment variables for the incremental cache updater

- `CACHE_TTL_DAYS`: number — default TTL in days for cache entries (used when the movie is not recent). Default: `30`.
- `RECENT_TTL_DAYS`: number — TTL in days for recent releases (shorter TTL to refresh recent movies more often). Default: `7`.
- `RECENT_YEARS`: number — how many years back are considered "recent" (used to pick `RECENT_TTL_DAYS`). Default: `2`.
- `REQUEST_DELAY_MS`: number — milliseconds to wait between scraping requests to FilmAffinity (helps avoid rate-limits/blocks). Default: `5000`.
- `SYNC_JELLYFIN_LIMIT`: integer — maximum number of items to process (useful for testing). Default: no limit.

Examples:

Set values in a `.env` file or export them before running scripts:

```bash
JELLYFIN_BASE_URL=http://192.168.1.31:8096
JELLYFIN_API_KEY=your_api_key_here
```

The sync and updater scripts use a centralized config helper which will throw a helpful error if `JELLYFIN_BASE_URL` or `JELLYFIN_API_KEY` are not set when strict validation is requested.

### Setup Jellyfin API key

To allow this service to update your Jellyfin metadata you need an API key (token) from your Jellyfin server:

1. Log in to Jellyfin web UI with an account that can create API keys (your personal user is fine).
2. Open the user menu (top-right) and click your username, or go to **Dashboard → Users** and select your user.
3. Find the **API Keys** or **API Keys / Manage API Keys** section and create a new key (give it a name like `filmaffinity-sync`).
4. Copy the generated token and store it securely. Use it as the value for `JELLYFIN_API_KEY`.

If you prefer to use query-based auth, set `JELLYFIN_AUTH_MODE=query` and the library will send the token as `ApiKey` query parameter.

### Example workflows

1) Dry-run to preview changes (recommended first):

```bash
JELLYFIN_BASE_URL=http://192.168.1.31:8096 \
JELLYFIN_API_KEY=xxxxxx \
LOG_LEVEL=debug \
SYNC_JELLYFIN_DRY_RUN=true \
  node scripts/sync-jellyfin.js --limit=5 --batch-size=2
```

2) Apply a small real run (careful):

```bash
JELLYFIN_BASE_URL=http://192.168.1.31:8096 \
JELLYFIN_API_KEY=xxxxxx \
SYNC_JELLYFIN_DRY_RUN=false \
  node scripts/sync-jellyfin.js --limit=10 --batch-size=3
```

3) Sync only Series and use a page-size tuning example:

```bash
JELLYFIN_BASE_URL=http://192.168.1.31:8096 \
JELLYFIN_API_KEY=xxxxxx \
node scripts/sync-jellyfin.js --include-item-types=Series --page-size=50 --limit=50
```

Notes:

- Start with a dry-run and small `--limit` to confirm payloads look correct.
- Use `SYNC_JELLYFIN_BATCH_SIZE` and `SYNC_JELLYFIN_DELAY_MS` to tune concurrency and avoid overloading your Jellyfin server.
- If you get `401` errors, try `JELLYFIN_AUTH_MODE=query`.


Auth behaviour:

- `auto` (default): the client sends the recommended `Authorization: MediaBrowser Token="..."` header and will retry once using the `ApiKey` query parameter if the server responds `401`.
- `header`: always use the `Authorization: MediaBrowser ...` header.
- `query`: always use the `ApiKey` query parameter and do not send the header.

Basic usage example (prefer query mode for API key-only setups):

```javascript
const JellyfinClient = require('./src/services/jellyfinClient');

const client = new JellyfinClient({
  baseUrl: process.env.JELLYFIN_BASE_URL,
  apiKey: process.env.JELLYFIN_API_KEY,
  authMode: 'query', // 'auto' | 'header' | 'query'
});

async function demo() {
  const users = await client.getUsers();
  console.log('Users:', users);

  const items = await client.getItems({ Limit: 10 });
  console.log('Items:', items);
}

demo().catch(console.error);
```

## 🔁 Update Jellyfin metadata from FilmAffinity

This project includes a helper script to update Jellyfin movie metadata with ratings retrieved from FilmAffinity. The script iterates your Jellyfin movie library, queries FilmAffinity for ratings and updates the Jellyfin item fields when necessary.

Run the updater (by default it runs in dry-run mode):

```bash
npm run update-jellyfin
```

Environment variables used by the updater and the newer `sync-jellyfin` script:

- `UPDATE_JELLYFIN_DRY_RUN` / `SYNC_JELLYFIN_DRY_RUN`: `true`/`false` — when `true` the script will only show the payload it would send to Jellyfin and will not perform updates. Default: `true`.
- `UPDATE_JELLYFIN_SET_CRITIC` / `SYNC_JELLYFIN_SET_CRITIC`: `true`/`false` — when `true` the updater will also set the `CriticRating` field (optional) if available from FilmAffinity. Default: `false`.
- `UPDATE_JELLYFIN_FORCE` / `SYNC_JELLYFIN_FORCE`: `true`/`false` — when `true` the updater will skip fetching existing metadata and forcibly apply updates. Default: `false`.
- `UPDATE_JELLYFIN_PAGE_SIZE` / `SYNC_JELLYFIN_PAGE_SIZE`: integer — page size used when iterating items (default `50` for updater, `100` for sync script).
- `SYNC_JELLYFIN_LIMIT`: integer — maximum number of items to process (useful for testing). Default: no limit.
- `SYNC_JELLYFIN_BATCH_SIZE`: integer — number of concurrent tasks per batch (default `5`).
- `SYNC_JELLYFIN_DELAY_MS`: integer — milliseconds to wait between batches (default `500`).
- `SYNC_JELLYFIN_RETRIES`: integer — number of retries for transient operations (default `3`).
- `SYNC_JELLYFIN_RETRY_DELAY`: integer — base retry delay in milliseconds for exponential backoff (default `1000`).
- `SYNC_JELLYFIN_INCLUDE_ITEM_TYPES`: comma-separated list — include item types to iterate, e.g. `Movie,Series,Episode` (default `Movie`).

Examples

Dry-run (show payloads, do not apply updates):

```bash
LOG_LEVEL=debug SYNC_JELLYFIN_DRY_RUN=true node scripts/sync-jellyfin.js --limit=1 --batch-size=1 --page-size=1
```

Apply real updates (be careful):

```bash
LOG_LEVEL=debug SYNC_JELLYFIN_DRY_RUN=false node scripts/sync-jellyfin.js --limit=1 --batch-size=1 --page-size=1
```

Sync only Series example:

```bash
node scripts/sync-jellyfin.js --include-item-types=Series --limit=10
```

Testing

Set `JELLYFIN_BASE_URL` and `JELLYFIN_API_KEY` in your `.env` and run:

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
