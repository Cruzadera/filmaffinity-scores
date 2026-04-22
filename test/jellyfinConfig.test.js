const test = require('node:test');
const assert = require('assert');

test('jellyfin config - non strict returns object', () => {
  const cfg = require('../src/config/jellyfin').getConfig({ strict: false });
  assert.ok(cfg, 'Expected config object');
  assert.ok('baseUrl' in cfg, 'baseUrl present');
  assert.ok('apiKey' in cfg, 'apiKey present');
});

test('jellyfin config - strict throws when missing required env vars', () => {
  // Temporarily clear env vars
  const oldBase = process.env.JELLYFIN_BASE_URL;
  const oldKey = process.env.JELLYFIN_API_KEY;
  delete process.env.JELLYFIN_BASE_URL;
  delete process.env.JELLYFIN_API_KEY;

  try {
    let thrown = false;
    try {
      require('../src/config/jellyfin').getConfig({ strict: true });
    } catch (err) {
      thrown = true;
      assert.ok(err.message && err.message.includes('Missing required environment'), 'Expected missing env error');
    }
    assert.ok(thrown, 'Expected getConfig to throw in strict mode when env missing');
  } finally {
    if (oldBase !== undefined) process.env.JELLYFIN_BASE_URL = oldBase;
    if (oldKey !== undefined) process.env.JELLYFIN_API_KEY = oldKey;
  }
});

test('jellyfin config - strict passes when env present', () => {
  const oldBase = process.env.JELLYFIN_BASE_URL;
  const oldKey = process.env.JELLYFIN_API_KEY;
  process.env.JELLYFIN_BASE_URL = 'http://localhost:8096';
  process.env.JELLYFIN_API_KEY = 'testkey';
  try {
    const cfg = require('../src/config/jellyfin').getConfig({ strict: true });
    assert.strictEqual(cfg.baseUrl, 'http://localhost:8096');
    assert.strictEqual(cfg.apiKey, 'testkey');
  } finally {
    if (oldBase === undefined) delete process.env.JELLYFIN_BASE_URL; else process.env.JELLYFIN_BASE_URL = oldBase;
    if (oldKey === undefined) delete process.env.JELLYFIN_API_KEY; else process.env.JELLYFIN_API_KEY = oldKey;
  }
});
