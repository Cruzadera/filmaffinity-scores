# FilmAffinity Scores API

![Node.js](https://img.shields.io/badge/Node.js-20.x-brightgreen?logo=node.js)
![Docker](https://img.shields.io/badge/Docker-ready-blue?logo=docker)
![License](https://img.shields.io/badge/license-MIT-lightgrey)

Servicio Node.js para:

1. Consultar valoraciones de FilmAffinity (scraping con Puppeteer).
2. Exponerlas vía API REST.
3. Guardarlas en caché persistente (SQLite).
4. Publicar un contrato HTTP estable para consumidores externos.

Este repositorio es API-only. El worker externo vive en:
https://github.com/Cruzadera/fa-jellyfin-sync

### Qué hace hoy el proyecto

- API HTTP para consultar una película por título/año.
- Caché en memoria (node-cache) + caché persistente (data/ratings.db).
- Scraper con puppeteer-extra + stealth plugin.

### Arquitectura rápida

- npm start: levanta la API (src/index.js).
- POST /ratings/batch: contrato principal para worker externo.

### Requisitos

- Node.js 20+
- Acceso de red al endpoint API desde tu worker externo

### Instalación

```bash
git clone https://github.com/Cruzadera/filmaffinity-scores.git
cd filmaffinity-scores
npm install
cp .env.example .env
```

Edita .env con tus valores reales antes de ejecutar sincronizaciones.

### Modo API (REST)

Arranque:

```bash
npm start
```

Por defecto expone en http://localhost:8085

Endpoints:

- GET /movie?title=...&year=...
  - title obligatorio
  - year obligatorio (4 dígitos)
  - Devuelve 400/404/502 según validación, no encontrado o fallo de scraping
- GET /rating?title=...&year=...
  - title obligatorio
  - year opcional
- GET /health
- POST /ratings/batch
  - Content-Type: application/json
  - body: { "items": [{ "title": "Alien", "year": "1979" }, ...] }
  - title obligatorio por item
  - year opcional por item (si existe, 4 dígitos)
  - respuesta con estado por item (éxito/error parcial)

Ejemplo:

```bash
curl "http://localhost:8085/movie?title=Alien&year=1979"
```

Respuesta típica:

```json
{
  "title": "Alien",
  "year": "1979",
  "rating": 8.1,
  "votes": "123456",
  "url": "https://www.filmaffinity.com/es/film123456.html"
}
```

### Worker externo

Este repositorio no ejecuta scheduler/sync locales.
Usa el worker externo en:

- https://github.com/Cruzadera/fa-jellyfin-sync

### Variables de entorno (resumen)

Consulta .env.example para lista completa.

- Generales:
  - PORT (default 8085)
  - LOG_LEVEL (debug|info|warn|error, default info)
  - DB_PATH (default data/ratings.db)
  - CACHE_TTL en segundos (default 86400) — valor canónico para la caché en
    memoria (node-cache). Este valor tiene prioridad si está presente. El
    actualizador deriva sus valores por defecto en días a partir de este valor
    y de las opciones `RECENT_*`.

  - RECENT_TTL_DAYS (default 7) — TTL en días aplicado a estrenos recientes
    (se refrescan con más frecuencia).
  - RECENT_YEARS (default 2) — número de años que se consideran "recientes".

Notas rápidas:
- La API usa `CACHE_TTL` (segundos) como TTL canónico de caché en memoria.
- El cálculo de TTL por año se ajusta con `RECENT_TTL_DAYS`/`RECENT_YEARS`.
- Scraping/cache incremental:
  - REQUEST_DELAY_MS
  - RECENT_TTL_DAYS
  - RECENT_YEARS
  - DEBUG_SCREENSHOTS

### Docker

En docker-compose.yml hay un servicio:

- app: API REST

Arrancar stack completo:

```bash
docker compose up -d --build
```

El volumen ./data:/app/data persiste SQLite.

### Tests

```bash
npm test
```

### Notas

- El scraping puede romperse si FilmAffinity cambia HTML o anti-bot.
- Mantén estable el contrato `POST /ratings/batch` para el worker externo.

## Disclaimer

Proyecto orientado a uso personal/autoalojado y fines educativos. Respeta los términos de uso de servicios externos.

## License

Ver LICENSE.
