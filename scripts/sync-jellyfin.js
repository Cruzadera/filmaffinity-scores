#!/usr/bin/env node
const dotenv = require('dotenv');
dotenv.config({ quiet: true });

const path = require('path');
const logger = require('../src/logging');
const { init: initDb } = require('../src/db/sqlite');
const JellyfinClient = require('../src/services/jellyfinClient');
const { fetchMoviesIterator } = require('../src/services/jellyfinLibrary');
const { getFilmAffinityRating } = require('../src/scraper/filmaffinity');
const { updateMovieMetadata } = require('../src/services/jellyfinUpdater');
const { buildCacheKey } = require('../src/scripts/cacheUtils');
const { processMoviePoster } = require('../src/services/posterProcessor');

const DEFAULT_DB_PATH = path.join(__dirname, '../data/ratings.db');

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const [key, val] = a.slice(2).split('=');
    if (val !== undefined) {
      out[key] = val;
    } else {
      // boolean flag or value in next arg
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        out[key] = next;
        i += 1;
      } else {
        out[key] = true;
      }
    }
  }
  return out;
}

function toBool(v, def = false) {
  if (v === undefined) return def;
  if (typeof v === 'boolean') return v;
  const s = String(v).toLowerCase();
  return s === 'true' || s === '1' || s === 'yes' || s === 'y';
}

function toInt(v, def) {
  if (v === undefined || v === null || String(v).trim() === '') return def;
  const n = Number(v);
  return Number.isNaN(n) ? def : n;
}

function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

async function retry(fn, attempts = 3, delay = 1000) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const backoff = delay * Math.pow(2, i);
      logger.warn(`Attempt ${i + 1} failed, retrying in ${backoff}ms: ${err && err.message ? err.message : err}`);
      await sleep(backoff);
    }
  }
  throw lastErr;
}

async function processBatch(client, batch, opts, counters) {
  const tasks = batch.map((movie) => (async () => {
    // Prefer original title when available (avoids translated labels)
    // But if the original title contains Japanese characters, prefer the localized `name`.
    function containsJapanese(text) {
      if (!text) return false;
      return /[\u3040-\u30ff\u31f0-\u31ff\u3000-\u303f]/.test(String(text));
    }

    let title = '';
    if (movie.originalTitle && !containsJapanese(movie.originalTitle)) {
      title = movie.originalTitle;
    } else if (movie.name) {
      title = movie.name;
    } else if (movie.raw && (movie.raw.OriginalTitle || movie.raw.Name)) {
      title = movie.raw.OriginalTitle || movie.raw.Name;
    } else {
      title = movie.originalTitle || '';
    }
    const year = movie.productionYear || (movie.raw && movie.raw.ProductionYear) || null;
    const cacheKey = buildCacheKey(title, year);
    counters.processed += 1;
    try {
      logger.info(`Processing: ${title} (${year || 'unknown'}) [${movie.id}]`);

      const fa = await retry(() => getFilmAffinityRating(title, year), opts.retries, opts.retryDelay);
      if (!fa) {
        logger.info(`No FilmAffinity rating for ${title}`);
        counters.skipped += 1;
        return;
      }

      const doUpdate = async () => updateMovieMetadata(client, movie.id, fa, {
        dryRun: opts.dryRun,
        setCritic: opts.setCritic,
        force: opts.force,
      });

      const res = await retry(doUpdate, opts.retries, opts.retryDelay);
      if (res.dryRun) {
        logger.info(`DryRun payload for ${title}: ${JSON.stringify(res.payload)}`);
        counters.dryRun += 1;
      } else if (res.updated) {
        logger.info(`Updated ${title}`);
        counters.updated += 1;
      } else {
        logger.info(`No update needed for ${title}: ${res.reason}`);
        counters.noChange += 1;
      }

      const cacheEntry = opts.db.getRating(cacheKey);
      let posterState = null;
      try {
        posterState = await retry(
          () => processMoviePoster(client, movie, fa, cacheEntry, {
            enabled: opts.enablePosterBadges,
            position: opts.posterBadgePosition,
            size: opts.posterBadgeSize,
            dryRun: opts.dryRun,
            force: opts.force,
          }),
          opts.retries,
          opts.retryDelay
        );

        if (posterState.updated) {
          counters.posterUpdated += 1;
        } else {
          counters.posterSkipped += 1;
          if (posterState.reason && posterState.reason !== 'disabled' && posterState.reason !== 'already-processed') {
            logger.info(`Poster skipped for ${title}: ${posterState.reason}`);
          }
        }
      } catch (posterErr) {
        counters.posterFailed += 1;
        logger.error(`Poster update failed for ${title}: ${posterErr && posterErr.message ? posterErr.message : posterErr}`);
      }

      const now = new Date().toISOString();
      opts.db.upsert({
        key: cacheKey,
        title: fa.title || title,
        year: fa.year || year || null,
        rating: fa.rating,
        last_rating: fa.rating,
        votes: fa.votes || null,
        url: fa.url || null,
        last_updated: now,
        poster_processed: posterState && posterState.posterHash ? posterState.posterHash : (cacheEntry && cacheEntry.poster_processed ? cacheEntry.poster_processed : null),
        raw: JSON.stringify(fa),
      });
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      logger.error(`Failed processing ${movie.id}: ${msg}`);
      if (err && err.body) logger.error(`Response body: ${typeof err.body === 'string' ? err.body : JSON.stringify(err.body)}`);
      if (err && err.payload) logger.error(`Payload: ${JSON.stringify(err.payload)}`);
      counters.failed += 1;
    }
  })());

  // limit concurrency: run up to `concurrency` tasks in parallel
  const concurrency = Math.max(1, opts.batchSize || 5);
  const running = [];
  for (const t of tasks) {
    const p = t.finally(() => {
      const idx = running.indexOf(p);
      if (idx >= 0) running.splice(idx, 1);
    });
    running.push(p);
    if (running.length >= concurrency) {
      await Promise.race(running);
    }
  }

  // wait for remaining tasks
  await Promise.allSettled(running);
}

async function main(argv = process.argv) {
  const args = parseArgs(argv);
  const opts = {
    dryRun: toBool(args['dry-run'], toBool(process.env.SYNC_JELLYFIN_DRY_RUN, true)),
    limit: toInt(args.limit || process.env.SYNC_JELLYFIN_LIMIT, Infinity),
    batchSize: toInt(args['batch-size'] || process.env.SYNC_JELLYFIN_BATCH_SIZE, 5),
    delayMs: toInt(args['delay-ms'] || process.env.SYNC_JELLYFIN_DELAY_MS, 500),
    retries: toInt(args.retries || process.env.SYNC_JELLYFIN_RETRIES, 3),
    retryDelay: toInt(args['retry-delay'] || process.env.SYNC_JELLYFIN_RETRY_DELAY, 1000),
    setCritic: toBool(args['set-critic'], toBool(process.env.SYNC_JELLYFIN_SET_CRITIC, false)),
    force: toBool(args.force, toBool(process.env.SYNC_JELLYFIN_FORCE, false)),
    pageSize: toInt(args['page-size'] || process.env.SYNC_JELLYFIN_PAGE_SIZE, 100),
    includeItemTypes: args['include-item-types'] || process.env.SYNC_JELLYFIN_INCLUDE_ITEM_TYPES || 'Movie',
    enablePosterBadges: toBool(args['enable-poster-badges'], toBool(process.env.ENABLE_POSTER_BADGES, false)),
    posterBadgePosition: args['poster-badge-position'] || process.env.POSTER_BADGE_POSITION || 'top-right',
    posterBadgeSize: toInt(args['poster-badge-size'] || process.env.POSTER_BADGE_SIZE, 0.2),
  };

  logger.info(`Starting Jellyfin sync (dryRun=${opts.dryRun}, posterBadges=${opts.enablePosterBadges})`);

  const dbPath = process.env.DB_PATH || DEFAULT_DB_PATH;
  const db = initDb(dbPath);
  opts.db = db;

  const client = new JellyfinClient({
    baseUrl: process.env.JELLYFIN_BASE_URL,
    apiKey: process.env.JELLYFIN_API_KEY,
    // prefer query auth if header-based auth causes 400/401 on some Jellyfin setups
    authMode: process.env.JELLYFIN_AUTH_MODE || 'query',
  });

  try {
    let processedTotal = 0;
    const counters = {
      processed: 0,
      updated: 0,
      skipped: 0,
      dryRun: 0,
      noChange: 0,
      failed: 0,
      posterUpdated: 0,
      posterSkipped: 0,
      posterFailed: 0,
    };

    const batchSize = Math.max(1, opts.batchSize);
    let batch = [];

    for await (const movie of fetchMoviesIterator(client, { pageSize: opts.pageSize, includeItemTypes: opts.includeItemTypes })) {
      if (opts.limit !== Infinity && processedTotal >= opts.limit) break;
      batch.push(movie);
      processedTotal += 1;

      if (batch.length >= batchSize) {
        // process batch
        await processBatch(client, batch.map((m) => ({ ...m })), opts, counters);
        batch = [];
        if (opts.delayMs > 0) await sleep(opts.delayMs);
      }
    }

    if (batch.length > 0) {
      await processBatch(client, batch, opts, counters);
    }

    logger.info(
      `Done. Processed: ${counters.processed}, Updated: ${counters.updated}, DryRun: ${counters.dryRun}, ` +
      `Skipped: ${counters.skipped}, NoChange: ${counters.noChange}, Failed: ${counters.failed}, ` +
      `PosterUpdated: ${counters.posterUpdated}, PosterSkipped: ${counters.posterSkipped}, PosterFailed: ${counters.posterFailed}`
    );
    return counters;
  } finally {
    db.close();
  }
}

if (require.main === module) {
  main().catch((err) => {
    logger.error('Unhandled error in sync-jellyfin:', err && err.message ? err.message : err);
    process.exit(1);
  });
}

module.exports = main;
