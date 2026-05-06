const test = require('node:test');
const assert = require('node:assert/strict');

const updateJellyfin = require('../src/scripts/updateJellyfin');

test('resolveRating uses ratings api client when configured', async () => {
  const calls = [];
  const ratingsApiClient = {
    async getRating({ title, year }) {
      calls.push({ title, year });
      return { title, year, rating: 8.8 };
    },
  };

  const result = await updateJellyfin.__internals.resolveRatingForMovie({
    title: 'Alien',
    year: '1979',
    ratingsApiClient,
    scraperFn: async () => {
      throw new Error('scraper should not be called');
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(result.rating, 8.8);
});

test('resolveRating falls back to scraper when api client is not configured', async () => {
  let scraperCalls = 0;
  const result = await updateJellyfin.__internals.resolveRatingForMovie({
    title: 'Alien',
    year: '1979',
    ratingsApiClient: null,
    scraperFn: async () => {
      scraperCalls += 1;
      return { title: 'Alien', year: '1979', rating: 8.1 };
    },
  });

  assert.equal(scraperCalls, 1);
  assert.equal(result.rating, 8.1);
});
