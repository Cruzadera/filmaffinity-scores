const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const sharp = require('sharp');
const logger = require('../logging');

const DEFAULTS = {
  enabled: false,
  position: 'top-right',
  size: 0.2,
  marginRatio: 0.03,
  dryRun: false,
  force: false,
  addFaIndicator: true,
  preserveOriginal: true,
};

function toBool(v, def = false) {
  if (v === undefined || v === null || v === '') return def;
  if (typeof v === 'boolean') return v;
  const s = String(v).toLowerCase();
  return s === 'true' || s === '1' || s === 'yes' || s === 'y';
}

function toNumber(v, def) {
  if (v === undefined || v === null || v === '') return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function getPosterBadgeConfig(overrides = {}) {
  const rawSize = overrides.size ?? process.env.POSTER_BADGE_SIZE;
  const parsedSize = toNumber(rawSize, DEFAULTS.size);
  const safeSize = Math.min(0.35, Math.max(0.12, parsedSize));
  const originalsDir = String(
    overrides.originalsDir
      ?? process.env.POSTER_ORIGINALS_DIR
      ?? path.join(process.cwd(), 'data', 'poster-originals')
  );

  return {
    enabled: toBool(overrides.enabled ?? process.env.ENABLE_POSTER_BADGES, DEFAULTS.enabled),
    position: String(overrides.position ?? process.env.POSTER_BADGE_POSITION ?? DEFAULTS.position).toLowerCase(),
    size: safeSize,
    marginRatio: Math.min(0.08, Math.max(0.01, toNumber(overrides.marginRatio, DEFAULTS.marginRatio))),
    dryRun: toBool(overrides.dryRun ?? process.env.POSTER_BADGE_DRY_RUN, DEFAULTS.dryRun),
    force: toBool(overrides.force ?? process.env.POSTER_BADGE_FORCE, DEFAULTS.force),
    addFaIndicator: toBool(overrides.addFaIndicator, DEFAULTS.addFaIndicator),
    preserveOriginal: toBool(overrides.preserveOriginal ?? process.env.POSTER_PRESERVE_ORIGINAL, DEFAULTS.preserveOriginal),
    originalsDir,
  };
}

function getOriginalPosterPath(itemId, cfg) {
  return path.join(cfg.originalsDir, `${String(itemId)}.jpg`);
}

async function readOriginalPoster(itemId, cfg) {
  const p = getOriginalPosterPath(itemId, cfg);
  try {
    const buf = await fs.readFile(p);
    if (Buffer.isBuffer(buf) && buf.length > 0) {
      return buf;
    }
  } catch (err) {
    if (err && err.code !== 'ENOENT') {
      logger.warn(`Could not read original poster backup for ${itemId}: ${err.message}`);
    }
  }
  return null;
}

async function saveOriginalPoster(itemId, cfg, posterBuffer) {
  const p = getOriginalPosterPath(itemId, cfg);
  try {
    await fs.mkdir(cfg.originalsDir, { recursive: true });
    await fs.writeFile(p, posterBuffer);
  } catch (err) {
    logger.warn(`Could not save original poster backup for ${itemId}: ${err.message}`);
  }
}

function normalizePosition(position) {
  const allowed = new Set(['top-right', 'top-left', 'bottom-right', 'bottom-left']);
  if (!allowed.has(position)) return 'top-right';
  return position;
}

function normalizeRating(rating) {
  const n = Number(rating);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(10, Math.round(n * 10) / 10));
}

function getBadgeColor(rating) {
  if (rating >= 7) return '#1f9d55';
  if (rating >= 5) return '#d97706';
  return '#dc2626';
}

function buildPosterProcessHash(rating, cfg) {
  const basis = {
    rating,
    position: cfg.position,
    size: cfg.size,
    marginRatio: cfg.marginRatio,
    addFaIndicator: cfg.addFaIndicator,
    badgeVersion: 'v1',
  };

  return crypto.createHash('sha1').update(JSON.stringify(basis)).digest('hex');
}

async function downloadPoster(client, itemId) {
  if (!itemId) throw new Error('downloadPoster requires itemId');

  const encodedId = encodeURIComponent(itemId);
  const candidates = [
    `/Items/${encodedId}/Images/Primary`,
    `/Items/${encodedId}/Images/Primary/0`,
    `/Items/${encodedId}/Images/Thumb`,
    `/Items/${encodedId}/Images/Thumb/0`,
    `/Items/${encodedId}/Images/Backdrop/0`,
  ];

  for (const path of candidates) {
    try {
      const buf = await client.getBinary(path, { Quality: 90 });
      if (buf && Buffer.isBuffer(buf) && buf.length > 0) {
        return buf;
      }
    } catch (err) {
      if (err && (err.status === 404 || err.status === 400)) {
        continue;
      }
      throw err;
    }
  }

  return null;
}

function generateBadge(rating, options = {}) {
  const width = Math.max(120, Math.round(Number(options.width) || 180));
  const height = Math.max(48, Math.round(Number(options.height) || 72));
  const color = options.color || getBadgeColor(rating);
  const showFa = options.addFaIndicator !== false;
  const fontSize = Math.round(height * 0.52);
  const faSize = Math.round(height * 0.2);
  const displayRating = normalizeRating(rating);

  if (displayRating === null) {
    throw new Error('generateBadge requires a numeric rating');
  }

  const ratingText = displayRating.toFixed(1);
  const faText = showFa ? '<text x="50%" y="88%" text-anchor="middle" font-family="Arial, sans-serif" font-size="' + faSize + '" fill="#ffffff" fill-opacity="0.90" letter-spacing="1">FA</text>' : '';

  const svg = [
    `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">`,
    `  <rect x="0" y="0" width="${width}" height="${height}" rx="${Math.round(height * 0.16)}" fill="#000000" fill-opacity="0.45"/>`,
    `  <rect x="0" y="0" width="${Math.round(width * 0.16)}" height="${height}" rx="${Math.round(height * 0.16)}" fill="${color}" fill-opacity="0.92"/>`,
    `  <text x="58%" y="58%" text-anchor="middle" font-family="Arial, sans-serif" font-size="${fontSize}" font-weight="700" fill="#ffffff">${ratingText}</text>`,
    `  ${faText}`,
    '</svg>',
  ].join('\n');

  return Buffer.from(svg);
}

function getOverlayGravity(position) {
  const map = {
    'top-right': 'northeast',
    'top-left': 'northwest',
    'bottom-right': 'southeast',
    'bottom-left': 'southwest',
  };
  return map[position] || 'northeast';
}

async function applyOverlay(posterBuffer, badgeBuffer, options = {}) {
  if (!posterBuffer || !Buffer.isBuffer(posterBuffer)) {
    throw new Error('applyOverlay requires posterBuffer');
  }

  const position = normalizePosition(options.position || DEFAULTS.position);
  const marginRatio = Number.isFinite(options.marginRatio) ? options.marginRatio : DEFAULTS.marginRatio;

  const image = sharp(posterBuffer);
  const meta = await image.metadata();
  const width = meta.width || 1000;
  const height = meta.height || 1500;
  const margin = Math.round(Math.min(width, height) * marginRatio);

  const out = await image
    .composite([
      {
        input: badgeBuffer,
        gravity: getOverlayGravity(position),
        top: margin,
        left: margin,
      },
    ])
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer();

  return out;
}

async function uploadPoster(client, itemId, posterBuffer) {
  if (!itemId) throw new Error('uploadPoster requires itemId');
  if (!Buffer.isBuffer(posterBuffer) || posterBuffer.length === 0) {
    throw new Error('uploadPoster received empty image payload');
  }

  await client.uploadPrimaryImage(itemId, posterBuffer, 'jpeg');
  return { uploaded: true };
}

function needsPosterRegeneration(cacheEntry, rating, posterHash, force = false) {
  if (force) return true;
  if (!cacheEntry) return true;

  const lastRating = normalizeRating(cacheEntry.last_rating);
  const currentRating = normalizeRating(rating);

  if (lastRating === null || currentRating === null) return true;
  if (Math.abs(lastRating - currentRating) > 0.01) return true;

  return cacheEntry.poster_processed !== posterHash;
}

async function processMoviePoster(client, movie, faData, cacheEntry, options = {}) {
  const cfg = getPosterBadgeConfig(options);

  if (!cfg.enabled) {
    return { skipped: true, reason: 'disabled' };
  }

  const itemId = movie && movie.id;
  if (!itemId) {
    return { skipped: true, reason: 'missing-item-id' };
  }

  const rating = normalizeRating(faData && faData.rating);
  if (rating === null) {
    return { skipped: true, reason: 'missing-rating' };
  }

  const posterHash = buildPosterProcessHash(rating, cfg);
  const shouldRegenerate = needsPosterRegeneration(cacheEntry, rating, posterHash, cfg.force);

  if (!shouldRegenerate) {
    return {
      skipped: true,
      reason: 'already-processed',
      posterHash,
      lastRating: rating,
    };
  }

  let sourcePoster = null;

  if (cfg.preserveOriginal) {
    sourcePoster = await readOriginalPoster(itemId, cfg);
  }

  if (!sourcePoster) {
    sourcePoster = await downloadPoster(client, itemId);
    // Save original only before first badge processing for this item.
    if (
      cfg.preserveOriginal
      && sourcePoster
      && (!cacheEntry || !cacheEntry.poster_processed)
    ) {
      await saveOriginalPoster(itemId, cfg, sourcePoster);
    }
  }

  if (!sourcePoster) {
    return { skipped: true, reason: 'missing-poster', posterHash, lastRating: rating };
  }

  const meta = await sharp(sourcePoster).metadata();
  const badgeWidth = Math.round((meta.width || 1000) * cfg.size);
  const badgeHeight = Math.max(48, Math.round(badgeWidth * 0.42));

  const badge = generateBadge(rating, {
    width: badgeWidth,
    height: badgeHeight,
    color: getBadgeColor(rating),
    addFaIndicator: cfg.addFaIndicator,
  });

  const outputPoster = await applyOverlay(sourcePoster, badge, {
    position: cfg.position,
    marginRatio: cfg.marginRatio,
  });

  if (cfg.dryRun) {
    return {
      updated: false,
      dryRun: true,
      posterHash,
      lastRating: rating,
      reason: 'dry-run',
    };
  }

  const uploadResult = await uploadPoster(client, itemId, outputPoster);
  logger.info(`Poster updated for item ${itemId} with FilmAffinity badge ${rating.toFixed(1)}`);

  return {
    updated: true,
    posterHash,
    lastRating: rating,
    uploadResult,
  };
}

module.exports = {
  getPosterBadgeConfig,
  downloadPoster,
  generateBadge,
  applyOverlay,
  uploadPoster,
  processMoviePoster,
  getBadgeColor,
  buildPosterProcessHash,
  needsPosterRegeneration,
};
