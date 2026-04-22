const JellyfinClient = require('./jellyfinClient');

function mapRatingToJellyfin(faData) {
  if (!faData) return null;
  const rating = faData.rating !== undefined && faData.rating !== null ? Number(faData.rating) : null;
  if (Number.isNaN(rating)) return null;
  // FilmAffinity ratings are on a 0-10 scale; Jellyfin CommunityRating uses 0-10 as well
  const communityRating = rating;
  const out = { CommunityRating: communityRating };
  if (faData.criticRating !== undefined && faData.criticRating !== null) {
    const critic = Number(faData.criticRating);
    if (!Number.isNaN(critic)) out.CriticRating = critic;
  }
  return out;
}

function shouldUpdate(existingValue, newValue, eps = 0.01) {
  if (newValue === null || newValue === undefined) return false;
  if (existingValue === null || existingValue === undefined) return true;
  const a = Number(existingValue);
  const b = Number(newValue);
  if (Number.isNaN(a) || Number.isNaN(b)) return true;
  return Math.abs(a - b) > eps;
}

/**
 * Update Jellyfin item metadata with FilmAffinity data.
 * By default this runs in `dryRun` mode and does not send updates to the server.
 * Set options.dryRun = false to perform the actual update.
 *
 * @param {JellyfinClient|object} clientOrOpts - JellyfinClient instance or constructor options
 * @param {string} itemId - Jellyfin item id
 * @param {object} faData - FilmAffinity response object (expects `rating`, optionally `criticRating`)
 * @param {object} options - { dryRun=true, setCritic=false, force=false }
 */
async function updateMovieMetadata(clientOrOpts, itemId, faData, options = {}) {
  const { dryRun = true, setCritic = false, force = false } = options;

  if (!itemId) throw new Error('itemId is required');
  if (!faData || (faData.rating === undefined || faData.rating === null)) {
    return { updated: false, reason: 'no-rating' };
  }

  let client = clientOrOpts;
  if (!client || typeof client.getItems !== 'function') {
    client = new JellyfinClient(clientOrOpts);
  }

  const mapped = mapRatingToJellyfin(faData);
  if (!mapped) return { updated: false, reason: 'invalid-rating' };

  const logger = require('../logging');

  // Jellyfin POST /Items/{id} requires the FULL item object, not a partial update.
  // Fetch the complete item via /Items?Ids= (GET /Items/{id} alone requires userId and returns 400).
  let existing = null;
  try {
    const res = await client.getItems({
      Ids: itemId,
      Fields: 'SortName,OriginalTitle,Genres,Tags,Studios,People,Overview,CommunityRating,CriticRating,OfficialRating,PremiereDate,ProductionYear,ProviderIds,ExternalUrls,Taglines,DateCreated',
      Recursive: 'true',
    });
    existing = res && res.Items && res.Items[0] ? res.Items[0] : null;
  } catch (err) {
    existing = null;
  }

  if (!force && existing) {
    const needsCommunity = shouldUpdate(existing.CommunityRating, mapped.CommunityRating);
    const needsCritic = setCritic && mapped.CriticRating !== undefined && shouldUpdate(existing.CriticRating, mapped.CriticRating);
    if (!needsCommunity && !needsCritic) {
      return { updated: false, reason: 'no-change' };
    }
  }

  // Build the updates preview (for dryRun and logging)
  const updates = {};
  if (shouldUpdate(existing?.CommunityRating, mapped.CommunityRating)) {
    updates.CommunityRating = mapped.CommunityRating;
  }
  if (setCritic && mapped.CriticRating !== undefined) {
    if (shouldUpdate(existing?.CriticRating, mapped.CriticRating)) {
      updates.CriticRating = mapped.CriticRating;
    }
  }

  if (Object.keys(updates).length === 0) {
    return { updated: false, reason: 'no-change' };
  }

  if (dryRun) {
    return { updated: false, dryRun: true, payload: updates };
  }

  // Merge updates into full item body — Jellyfin requires the complete object
  const fullBody = Object.assign({}, existing || {}, updates);
  logger.debug(`Updating item ${itemId} with payload: ${JSON.stringify(updates)}`);
  try {
    const res = await client.postItem(itemId, fullBody);
    return { updated: true, response: res };
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    const body = err && err.body ? err.body : null;
    const e = new Error(`Failed to update item ${itemId}: ${msg}`);
    e.body = body;
    e.payload = updates;
    throw e;
  }
}

module.exports = {
  mapRatingToJellyfin,
  shouldUpdate,
  updateMovieMetadata,
};
