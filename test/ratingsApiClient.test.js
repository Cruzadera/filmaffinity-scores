const test = require('node:test');
const assert = require('node:assert/strict');

const RatingsApiClient = require('../src/services/ratingsApiClient');

test('getRating calls GET /rating with title and year', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    return {
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => ({ title: 'Alien', year: '1979', rating: 8.1 }),
    };
  };

  const client = new RatingsApiClient({
    baseUrl: 'http://api.local',
    fetchImpl,
    timeoutMs: 1000,
  });

  const data = await client.getRating({ title: 'Alien', year: '1979' });
  assert.equal(calls.length, 1);
  assert.match(calls[0], /\/rating\?title=Alien&year=1979/);
  assert.equal(data.rating, 8.1);
});

test('getRatingsBatch posts items and preserves response order', async () => {
  const fetchImpl = async (url, opts) => {
    assert.match(url, /\/ratings\/batch$/);
    assert.equal(opts.method, 'POST');
    const body = JSON.parse(opts.body);
    assert.equal(body.items.length, 2);

    return {
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => ({
        results: [
          { ok: true, status: 200, data: { title: 'B' } },
          { ok: true, status: 200, data: { title: 'A' } },
        ],
      }),
    };
  };

  const client = new RatingsApiClient({ baseUrl: 'http://api.local', fetchImpl });
  const results = await client.getRatingsBatch({
    items: [{ title: 'B' }, { title: 'A' }],
  });

  assert.equal(results.length, 2);
  assert.equal(results[0].data.title, 'B');
  assert.equal(results[1].data.title, 'A');
});

test('getRatingsBatch marks 400 errors as non-retryable', async () => {
  const fetchImpl = async () => ({
    ok: false,
    status: 400,
    headers: { get: () => 'application/json' },
    json: async () => ({ error: 'Missing title' }),
  });

  const client = new RatingsApiClient({ baseUrl: 'http://api.local', fetchImpl });

  await assert.rejects(
    () => client.getRatingsBatch({ items: [{ title: '' }] }),
    (err) => err && err.retryable === false && /Missing title/.test(err.message)
  );
});
