# 🎬 FilmAffinity Scores API

![Node.js](https://img.shields.io/badge/Node.js-20.x-brightgreen?logo=node.js)
![Docker](https://img.shields.io/badge/Docker-ready-blue?logo=docker)
![License](https://img.shields.io/badge/license-MIT-lightgrey)

> Microservicio en Node.js para obtener valoraciones de **[FilmAffinity](https://www.filmaffinity.com/es/)** y exponerlas vía API REST.  
> Pensado para integrarse fácilmente con **Jellyseerr**, **Jellyfin** o cualquier aplicación multimedia que requiera puntuaciones realistas en español.

---

## 🧩 Características

- 🔍 **Búsqueda por título** directamente en FilmAffinity.  
- ⭐ Devuelve **puntuación media, votos y año de estreno**.  
- ⚡ **Cache automático** configurable (por defecto 24 h).  
- 🐳 Preparado para **Docker / Docker Compose**.  
- 🛠️ Desarrollado en **Node.js + Express + Cheerio** (sin dependencias nativas).  
- 🔒 Código abierto, mantenible y listo para extender con claves API o base de datos local.

---

## 📦 Instalación local (modo desarrollo)

```bash
git clone https://github.com/<tu_usuario>/filmaffinity-scores.git
cd filmaffinity-scores
npm install
npm start
