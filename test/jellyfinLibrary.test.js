const test = require('node:test');
const assert = require('assert');
const dotenv = require('dotenv');

dotenv.config();

const { fetchMoviesIterator, fetchAllMovies } = require('../src/services/jellyfinLibrary');
const JellyfinClient = require('../src/services/jellyfinClient');

const baseUrl = process.env.JELLYFIN_BASE_URL;
const apiKey = process.env.JELLYFIN_API_KEY;

if (!baseUrl || !apiKey) {
  test('Jellyfin library - skipped (no env vars)', () => {
    test.skip('Set JELLYFIN_BASE_URL and JELLYFIN_API_KEY to run integration test');
  });
} else {
  test('fetchMoviesIterator yields movie objects with required fields', async () => {
    const client = new JellyfinClient({ baseUrl, apiKey, authMode: 'auto', timeout: 5000 });
    const iter = fetchMoviesIterator(client, { pageSize: 5 });
    const movies = [];
    for await (const m of iter) {
      movies.push(m);
      if (movies.length >= 5) break; // only sample first 5 for test speed
    }

    assert.ok(Array.isArray(movies), 'Expected an array of movies');
    // If server has no movies the array can be empty; still should not error
    for (const mv of movies) {
      assert.ok(mv.id, 'movie must have id');
      assert.ok(mv.name || mv.raw?.Name, 'movie should have a name');
    }
  });

  test('fetchAllMovies returns an array (sampling with small pageSize)', async () => {
    const client = new JellyfinClient({ baseUrl, apiKey, authMode: 'auto', timeout: 5000 });
    // use small pageSize to exercise pagination logic
    const movies = await fetchAllMovies(client, { pageSize: 10 });
    assert.ok(Array.isArray(movies), 'Expected array');
  });
}
