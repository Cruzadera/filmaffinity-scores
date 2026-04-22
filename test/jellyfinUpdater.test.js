const test = require('node:test');
const assert = require('assert');
const { mapRatingToJellyfin, shouldUpdate } = require('../src/services/jellyfinUpdater');

test('mapRatingToJellyfin maps numeric rating and critic', () => {
  const fa = { rating: '7.8', criticRating: '6.5' };
  const out = mapRatingToJellyfin(fa);
  assert.strictEqual(out.CommunityRating, 7.8);
  assert.strictEqual(out.CriticRating, 6.5);
});

test('mapRatingToJellyfin returns null on invalid input', () => {
  assert.strictEqual(mapRatingToJellyfin(null), null);
  assert.strictEqual(mapRatingToJellyfin({ rating: 'nope' }), null);
});

test('shouldUpdate compares correctly', () => {
  assert.strictEqual(shouldUpdate(null, 7.5), true);
  assert.strictEqual(shouldUpdate(7.5, 7.5), false);
  assert.strictEqual(shouldUpdate(7.5, 7.51, 0.001), true);
  assert.strictEqual(shouldUpdate(7.5, null), false);
});

const dotenv = require('dotenv');
dotenv.config();

const { updateMovieMetadata } = require('../src/services/jellyfinUpdater');
const { fetchMoviesIterator } = require('../src/services/jellyfinLibrary');
const JellyfinClient = require('../src/services/jellyfinClient');

const baseUrl = process.env.JELLYFIN_BASE_URL;
const apiKey = process.env.JELLYFIN_API_KEY;

if (baseUrl && apiKey) {
  test('updateMovieMetadata dryRun shows payload and optional real update', async () => {
    const client = new JellyfinClient({ baseUrl, apiKey, authMode: 'auto', timeout: 10000 });

    // get first movie
    const iter = fetchMoviesIterator(client, { pageSize: 1 });
    const first = await iter.next();
    if (!first || !first.value) return; // nothing to test against
    const item = first.value;

    // dry run should not modify server, but return payload
    const fakeRating = 8.2;
    const dry = await updateMovieMetadata(client, item.id, { rating: fakeRating }, { dryRun: true, setCritic: false });
    assert.strictEqual(dry.dryRun, true);
    assert.ok(dry.payload, 'expected payload in dryRun result');
    assert.strictEqual(dry.payload.CommunityRating, fakeRating);

    // Optional: perform a real update only when explicitly enabled
    if (process.env.JELLYFIN_APPLY_TEST_UPDATES === 'true') {
      // fetch existing rating
      const existing = await client.get(`/Items/${encodeURIComponent(item.id)}`);
      const original = existing?.CommunityRating;

      const real = await updateMovieMetadata(client, item.id, { rating: fakeRating }, { dryRun: false, setCritic: false });
      assert.strictEqual(real.updated, true);

      // revert to original value
      const revertVal = (original === undefined || original === null) ? 0 : original;
      await client.postItem(item.id, { CommunityRating: revertVal });
    }
  });
}
