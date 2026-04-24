# FilmAffinity Scores (API + Jellyfin Sync)

![Node.js](https://img.shields.io/badge/Node.js-20.x-brightgreen?logo=node.js)
![Docker](https://img.shields.io/badge/Docker-ready-blue?logo=docker)
![License](https://img.shields.io/badge/license-MIT-lightgrey)

Servicio Node.js para:

1. Consultar valoraciones de FilmAffinity (scraping con Puppeteer).
2. Exponerlas vía API REST.
3. Guardarlas en caché persistente (SQLite).
4. Sincronizar ratings en Jellyfin.
5. Opcionalmente reescribir pósters en Jellyfin con badge visual de nota.

No es solo una API: también incluye un flujo batch y un scheduler para mantener la librería actualizada.

### Qué hace hoy el proyecto

- API HTTP para consultar una película por título/año.
- Caché en memoria (node-cache) + caché persistente (data/ratings.db).
- Scraper con puppeteer-extra + stealth plugin.
- Sincronización de metadatos en Jellyfin (CommunityRating, opcional CriticRating).
- Procesamiento de póster y subida de imagen a Jellyfin.
- Scheduler para ejecutar ciclos automáticos de actualización.

### Arquitectura rápida

- npm start: levanta la API (src/index.js).
- npm run update-cache: recorre la librería de Jellyfin y refresca caché en SQLite.
- npm run sync-jellyfin: sincroniza ratings FilmAffinity -> Jellyfin.
- npm run scheduler: bucle continuo que ejecuta update-cache + sync-jellyfin en cada ciclo.

### Requisitos

- Node.js 20+
- Acceso a una instancia de Jellyfin (si vas a usar sync/scheduler)
- JELLYFIN_API_KEY con permisos para leer y actualizar metadata

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

### Sincronización con Jellyfin

Script recomendado:

```bash
npm run sync-jellyfin
```

Por defecto corre en dry-run (SYNC_JELLYFIN_DRY_RUN=true): calcula cambios pero no los aplica.

Prueba controlada:

```bash
LOG_LEVEL=debug \
SYNC_JELLYFIN_DRY_RUN=true \
node scripts/sync-jellyfin.js --limit=5 --batch-size=2
```

Aplicar cambios reales:

```bash
LOG_LEVEL=debug \
SYNC_JELLYFIN_DRY_RUN=false \
node scripts/sync-jellyfin.js --limit=20 --batch-size=2
```

Sincronizar también pósters con badge:

```bash
LOG_LEVEL=debug \
SYNC_JELLYFIN_DRY_RUN=false \
ENABLE_POSTER_BADGES=true \
POSTER_BADGE_POSITION=top-right \
POSTER_BADGE_SIZE=0.2 \
node scripts/sync-jellyfin.js --limit=20 --batch-size=2
```

### Scheduler automático

```bash
npm run scheduler
```

Ciclo:

1. Ejecuta update-cache
2. Ejecuta sync-jellyfin
3. Espera SLEEP_SECONDS (default 86400)
4. Repite en bucle

SYNC_JELLYFIN_FORCE_ON_STARTUP=true permite forzar la primera pasada.

### Variables de entorno (resumen)

Consulta .env.example para lista completa.

- Generales:
  - PORT (default 8085)
  - LOG_LEVEL (debug|info|warn|error, default info)
  - DB_PATH (default data/ratings.db)
  - CACHE_TTL en segundos (default 86400)
- Jellyfin:
  - JELLYFIN_BASE_URL
  - JELLYFIN_API_KEY
  - JELLYFIN_AUTH_MODE (auto|header|query)
  - JELLYFIN_TIMEOUT
- Sync:
  - SYNC_JELLYFIN_DRY_RUN, SYNC_JELLYFIN_LIMIT, SYNC_JELLYFIN_BATCH_SIZE
  - SYNC_JELLYFIN_DELAY_MS, SYNC_JELLYFIN_RETRIES, SYNC_JELLYFIN_RETRY_DELAY
  - SYNC_JELLYFIN_SET_CRITIC, SYNC_JELLYFIN_FORCE, SYNC_JELLYFIN_PAGE_SIZE
  - SYNC_JELLYFIN_INCLUDE_ITEM_TYPES
- Pósters:
  - ENABLE_POSTER_BADGES
  - POSTER_BADGE_POSITION
  - POSTER_BADGE_SIZE
  - POSTER_PRESERVE_ORIGINAL
  - POSTER_ORIGINALS_DIR
  - POSTER_BADGE_DRY_RUN / POSTER_BADGE_FORCE
- Scraping/cache incremental:
  - REQUEST_DELAY_MS
  - RECENT_TTL_DAYS
  - RECENT_YEARS
  - DEBUG_SCREENSHOTS

### Docker

En docker-compose.yml hay dos servicios:

- app: API REST
- scheduler: ciclo automático cache + sync

Arrancar stack completo:

```bash
docker compose up -d --build
```

Solo scheduler:

```bash
docker compose up -d scheduler
```

El volumen ./data:/app/data persiste SQLite y backups de pósters.

### Tests

```bash
npm test
```

### Notas

- El scraping puede romperse si FilmAffinity cambia HTML o anti-bot.
- Las actualizaciones en Jellyfin dependen de permisos del API key.
- En producción, empezar en dry-run y luego pasar a modo escritura.

## Disclaimer

Proyecto orientado a uso personal/autoalojado y fines educativos. Respeta los términos de uso de servicios externos.

## License

Ver LICENSE.
