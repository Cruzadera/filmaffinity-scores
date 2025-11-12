# 🎬 FilmAffinity Scores API

![Node.js](https://img.shields.io/badge/Node.js-20.x-brightgreen?logo=node.js)
![Docker](https://img.shields.io/badge/Docker-ready-blue?logo=docker)
![License](https://img.shields.io/badge/license-MIT-lightgrey)

> Microservicio en Node.js para obtener valoraciones de **[FilmAffinity](https://www.filmaffinity.com/es/)** y exponerlas vía API REST.  
> Pensado para integrarse fácilmente con **Jellyseerr**, **Jellyfin** o cualquier aplicación multimedia que requiera puntuaciones realistas en español.

---


## 🚀 Características

- ✅ Scraping estable mediante **Puppeteer + Stealth Plugin**
- 💾 Cache local en `data/ratings.json` generada a diario
- ⚙️ Endpoint REST `/rating?title=...`
- 🧠 Cache en memoria (NodeCache) + persistente en disco
- 🔗 Integración directa con la **API de Jellyfin**
- 🕓 Cron automático para mantener los datos actualizados

---

## 📦 Instalación

```bash
git clone https://github.com/Cruzadera/filmaffinity-scores.git
cd filmaffinity-scores
npm install
