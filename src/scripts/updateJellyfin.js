const dotenv = require('dotenv');
dotenv.config();

const path = require('path');
const { init: initDb } = require('../db/sqlite');
const JellyfinClient = require('../services/jellyfinClient');
const { fetchMoviesIterator } = require('../services/jellyfinLibrary');
const { getFilmAffinityRating } = require('../scraper/filmaffinity');
const { updateMovieMetadata } = require('../services/jellyfinUpdater');
const { buildCacheKey } = require('./cacheUtils');
const { processMoviePoster } = require('../services/posterProcessor');
const logger = require('../logging');

const DEFAULT_DB_PATH = path.join(__dirname, '../../data/ratings.db');

async function main() {
  const dryRun = process.env.UPDATE_JELLYFIN_DRY_RUN !== 'false'; // default true
  const setCritic = process.env.UPDATE_JELLYFIN_SET_CRITIC === 'true';
  const force = process.env.UPDATE_JELLYFIN_FORCE === 'true';
  const enablePosterBadges = process.env.ENABLE_POSTER_BADGES === 'true';
  const posterBadgePosition = process.env.POSTER_BADGE_POSITION || 'top-right';
  const posterBadgeSize = Number(process.env.POSTER_BADGE_SIZE || 0.2);

  const client = new JellyfinClient({
    baseUrl: process.env.JELLYFIN_BASE_URL,
    apiKey: process.env.JELLYFIN_API_KEY,
    authMode: process.env.JELLYFIN_AUTH_MODE || 'auto',
    timeout: process.env.JELLYFIN_TIMEOUT || undefined,
  });

  const dbPath = process.env.DB_PATH || DEFAULT_DB_PATH;
  const db = initDb(dbPath);
  try {
    const pageSize = Number(process.env.UPDATE_JELLYFIN_PAGE_SIZE || 50);
    let processed = 0;
    for await (const movie of fetchMoviesIterator(client, { pageSize })) {
      processed += 1;
      try {
        const title = movie.name || (movie.raw && movie.raw.Name) || '';
        const year = movie.productionYear || (movie.raw && movie.raw.ProductionYear) || null;
        const cacheKey = buildCacheKey(title, year);
        logger.info(`Processing: ${title} (${year || 'unknown'}) [${movie.id}]`);

        const fa = await getFilmAffinityRating(title, year);
        if (!fa) {
          logger.info(`No FilmAffinity rating for ${title}`);
          continue;
        }

        const res = await updateMovieMetadata(client, movie.id, fa, { dryRun, setCritic, force });
        if (res.dryRun) {
          logger.info(`DryRun payload for ${title}: ${JSON.stringify(res.payload)}`);
        } else if (res.updated) {
          logger.info(`Updated ${title}: ${JSON.stringify(res.response)}`);
        } else {
          logger.info(`No update needed for ${title}: ${res.reason}`);
        }

        try {
          const cacheEntry = db.getRating(cacheKey);
          const posterRes = await processMoviePoster(client, movie, fa, cacheEntry, {
            enabled: enablePosterBadges,
            position: posterBadgePosition,
            size: posterBadgeSize,
            dryRun,
            force,
          });

          if (posterRes.updated) {
            logger.info(`Poster badge uploaded for ${title}`);
          } else if (posterRes.reason && posterRes.reason !== 'disabled' && posterRes.reason !== 'already-processed') {
            logger.info(`Poster skipped for ${title}: ${posterRes.reason}`);
          }

          db.upsert({
            key: cacheKey,
            title: fa.title || title,
            year: fa.year || year || null,
            rating: fa.rating,
            last_rating: fa.rating,
            votes: fa.votes || null,
            url: fa.url || null,
            last_updated: new Date().toISOString(),
            poster_processed: posterRes.posterHash || cacheEntry.poster_processed || null,
            raw: JSON.stringify(fa),
          });
        } catch (posterErr) {
          logger.error(`Poster update failed for ${title}: ${posterErr && posterErr.message ? posterErr.message : posterErr}`);
        }
      } catch (err) {
        logger.error(`Failed processing ${movie.id}: ${err && err.message ? err.message : err}`);
      }
    }

    logger.info(`Done. Processed ${processed} movies.`);
  } finally {
    db.close();
  }
}

if (require.main === module) {
  main().catch(err => {
    logger.error('Unhandled error in updateJellyfin:', err && err.message ? err.message : err);
    process.exit(1);
  });
}

module.exports = main;
