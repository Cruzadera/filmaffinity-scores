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

## ⚠️ Disclaimer

This project uses web scraping to retrieve data from Filmaffinity.
It is intended for personal use and educational purposes.

---

## 📄 License

MIT License
