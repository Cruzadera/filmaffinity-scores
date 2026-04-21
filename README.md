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
