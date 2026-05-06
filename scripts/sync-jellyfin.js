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

function containsJapanese(text) {
  if (!text) return false;
  return /[\u3040-\u30ff\u31f0-\u31ff\u3000-\u303f]/.test(String(text));
}

function getMovieLookup(movie) {
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
  return { title, year, cacheKey };
}

function normalizeApiBaseUrl(url) {
  return String(url || '').trim().replace(/\/+$/, '');
}

function buildBatchEndpoint(baseUrl) {
  return `${normalizeApiBaseUrl(baseUrl)}/ratings/batch`;
}

async function fetchRatingsBatchChunkFromApi(apiBaseUrl, lookupChunk, timeoutMs) {
  const endpoint = buildBatchEndpoint(apiBaseUrl);
  const body = {
    items: lookupChunk.map(({ title, year }) => ({
      title,
      year: year || undefined,
    })),
  };

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });

  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    const message = payload && payload.error
      ? payload.error
      : `HTTP ${res.status} calling ${endpoint}`;
    throw new Error(`Ratings API error: ${message}`);
  }

  if (!payload || !Array.isArray(payload.results)) {
    throw new Error('Ratings API contract error: missing "results" array');
  }

  if (payload.results.length !== lookupChunk.length) {
    throw new Error(`Ratings API contract error: expected ${lookupChunk.length} results, received ${payload.results.length}`);
  }

  return payload.results;
}

async function resolveBatchRatings(lookups, opts) {
  if (!opts.ratingsApiUrl) return null;

  const chunkSize = Math.max(1, opts.ratingsApiBatchSize || 50);
  const out = [];

  for (let i = 0; i < lookups.length; i += chunkSize) {
    const chunk = lookups.slice(i, i + chunkSize);
    const chunkResults = await retry(
      () => fetchRatingsBatchChunkFromApi(opts.ratingsApiUrl, chunk, opts.ratingsApiTimeoutMs),
      opts.retries,
      opts.retryDelay
    );
    out.push(...chunkResults);
  }

  return out;
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
  const startFailed = counters.failed;
  const lookups = batch.map((movie) => getMovieLookup(movie));
  const ratingResults = await resolveBatchRatings(lookups, opts);

  const tasks = batch.map((movie, idx) => (async () => {
    const { title, year, cacheKey } = lookups[idx];
    counters.processed += 1;
    try {
      logger.info(`Processing: ${title} (${year || 'unknown'}) [${movie.id}]`);

      let fa = null;
      if (ratingResults) {
        const ratingResult = ratingResults[idx];
        if (ratingResult && ratingResult.ok) {
          fa = ratingResult.data;
        } else {
          const status = ratingResult && ratingResult.status ? Number(ratingResult.status) : 500;
          const errMsg = ratingResult && (ratingResult.error || ratingResult.message)
            ? `${ratingResult.error || ratingResult.message}`
            : 'Unknown ratings API error';
          if (status === 404 || status === 400) {
            logger.info(`No FilmAffinity rating for ${title} (${errMsg})`);
            counters.skipped += 1;
            return;
          }
          throw new Error(`Ratings API failed for ${title}: ${errMsg}`);
        }
      } else {
        fa = await retry(() => getFilmAffinityRating(title, year), opts.retries, opts.retryDelay);
      }

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
      // Only persist poster_processed when the poster was actually uploaded/updated.
      // This prevents dry-run runs (or failed uploads) from marking items as processed
      // and skipping them in subsequent real runs.
      const posterProcessedValue = (posterState && posterState.updated)
        ? posterState.posterHash
        : (cacheEntry && cacheEntry.poster_processed ? cacheEntry.poster_processed : null);

      opts.db.upsert({
        key: cacheKey,
        title: fa.title || title,
        year: fa.year || year || null,
        rating: fa.rating,
        last_rating: fa.rating,
        votes: fa.votes || null,
        url: fa.url || null,
        last_updated: now,
        poster_processed: posterProcessedValue,
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

  // If a large number of failures happened during this batch, attempt recovery
  const failedDuringBatch = counters.failed - startFailed;
  const failureThreshold = Math.max(3, Math.ceil(batch.length / 2));
  if (failedDuringBatch >= failureThreshold) {
    logger.warn(`High failure rate in batch (${failedDuringBatch}/${batch.length}), restarting scraper and backing off`);
    try {
      const scraper = require('../src/scraper/filmaffinity');
      if (typeof scraper.restartBrowser === 'function') await scraper.restartBrowser();
    } catch (e) {
      logger.debug && logger.debug('Failed restarting scraper browser:', e && e.message ? e.message : e);
    }
    // brief backoff to allow remote site to cool down
    await sleep(opts.retryDelay || 2000);
  }
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
    ratingsApiUrl: normalizeApiBaseUrl(args['ratings-api-url'] || process.env.SYNC_RATINGS_API_URL || ''),
    ratingsApiBatchSize: toInt(args['ratings-api-batch-size'] || process.env.SYNC_RATINGS_API_BATCH_SIZE, 50),
    ratingsApiTimeoutMs: toInt(args['ratings-api-timeout-ms'] || process.env.SYNC_RATINGS_API_TIMEOUT_MS, 30000),
    enablePosterBadges: toBool(args['enable-poster-badges'], toBool(process.env.ENABLE_POSTER_BADGES, false)),
    posterBadgePosition: args['poster-badge-position'] || process.env.POSTER_BADGE_POSITION || 'top-right',
    posterBadgeSize: toInt(args['poster-badge-size'] || process.env.POSTER_BADGE_SIZE, 0.2),
  };

  logger.info(
    `Starting Jellyfin sync (dryRun=${opts.dryRun}, posterBadges=${opts.enablePosterBadges}, ` +
    `ratingsProvider=${opts.ratingsApiUrl ? 'api' : 'scraper'})`
  );

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
