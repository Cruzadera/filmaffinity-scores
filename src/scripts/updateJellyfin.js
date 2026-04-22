const dotenv = require('dotenv');
dotenv.config();

const JellyfinClient = require('../services/jellyfinClient');
const { fetchMoviesIterator } = require('../services/jellyfinLibrary');
const { getFilmAffinityRating } = require('../scraper/filmaffinity');
const { updateMovieMetadata } = require('../services/jellyfinUpdater');
const logger = require('../logging');

async function main() {
  const dryRun = process.env.UPDATE_JELLYFIN_DRY_RUN !== 'false'; // default true
  const setCritic = process.env.UPDATE_JELLYFIN_SET_CRITIC === 'true';
  const force = process.env.UPDATE_JELLYFIN_FORCE === 'true';

  const client = new JellyfinClient({
    baseUrl: process.env.JELLYFIN_BASE_URL,
    apiKey: process.env.JELLYFIN_API_KEY,
    authMode: process.env.JELLYFIN_AUTH_MODE || 'auto',
    timeout: process.env.JELLYFIN_TIMEOUT || undefined,
  });

  const pageSize = Number(process.env.UPDATE_JELLYFIN_PAGE_SIZE || 50);
  let processed = 0;
  for await (const movie of fetchMoviesIterator(client, { pageSize })) {
    processed += 1;
    try {
      const title = movie.name || (movie.raw && movie.raw.Name) || '';
      const year = movie.productionYear || (movie.raw && movie.raw.ProductionYear) || null;
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
    } catch (err) {
      logger.error(`Failed processing ${movie.id}: ${err && err.message ? err.message : err}`);
    }
  }

  logger.info(`Done. Processed ${processed} movies.`);
}

if (require.main === module) {
  main().catch(err => {
    logger.error('Unhandled error in updateJellyfin:', err && err.message ? err.message : err);
    process.exit(1);
  });
}

module.exports = main;
