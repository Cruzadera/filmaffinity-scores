const test = require('node:test');
const assert = require('node:assert/strict');

const syncModule = require('../scripts/sync-jellyfin');

test('resolveBatchRatings keeps chunk ordering when using shared ratings client', async () => {
  const lookups = [
    { title: 'A', year: '2000' },
    { title: 'B', year: '2001' },
    { title: 'C', year: '2002' },
  ];

  const calls = [];
  const ratingsApiClient = {
    async getRatingsBatch({ items }) {
      calls.push(items);
      return items.map((i) => ({ ok: true, status: 200, data: { title: i.title } }));
    },
  };

  const out = await syncModule.__internals.resolveBatchRatings(lookups, {
    ratingsApiClient,
    ratingsApiUrl: 'http://api.local',
    ratingsApiBatchSize: 2,
    ratingsApiTimeoutMs: 1000,
    retries: 2,
    retryDelay: 1,
  });

  assert.equal(calls.length, 2);
  assert.equal(out.length, 3);
  assert.equal(out[0].data.title, 'A');
  assert.equal(out[1].data.title, 'B');
  assert.equal(out[2].data.title, 'C');
});

test('resolveBatchRatings does not retry non-retryable api errors', async () => {
  let attempts = 0;
  const nonRetryableError = Object.assign(new Error('bad request'), { retryable: false });

  const ratingsApiClient = {
    async getRatingsBatch() {
      attempts += 1;
      throw nonRetryableError;
    },
  };

  await assert.rejects(
    () => syncModule.__internals.resolveBatchRatings([{ title: 'A' }], {
      ratingsApiClient,
      ratingsApiUrl: 'http://api.local',
      ratingsApiBatchSize: 10,
      ratingsApiTimeoutMs: 1000,
      retries: 3,
      retryDelay: 1,
    }),
    /bad request/
  );

  assert.equal(attempts, 1);
});
