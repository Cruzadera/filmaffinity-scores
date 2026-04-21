const test = require('node:test');
const assert = require('assert');
const JellyfinClient = require('../src/services/jellyfinClient');
const dotenv = require("dotenv");

dotenv.config();

const baseUrl = process.env.JELLYFIN_BASE_URL;
const apiKey = process.env.JELLYFIN_API_KEY;

if (!baseUrl || !apiKey) {
  test('Jellyfin integration - skipped (no env vars)', () => {
    test.skip('Set JELLYFIN_BASE_URL and JELLYFIN_API_KEY to run integration test');
  });
} else {
  test('Jellyfin getUsers returns an array', async () => {
    const client = new JellyfinClient({ baseUrl, apiKey, timeout: 5000 });
    const users = await client.getUsers();
    assert.ok(users, 'Expected a response');
    assert.ok(Array.isArray(users), 'Expected users to be an array');
  });

  test('Jellyfin getItems returns an object', async () => {
    const client = new JellyfinClient({ baseUrl, apiKey, timeout: 5000 });
    const res = await client.getItems({ Limit: 1 });
    assert.ok(res, 'Expected a response');
    // Jellyfin /Items can return an object with Items[] or an array depending on server/plugins
  });
}
