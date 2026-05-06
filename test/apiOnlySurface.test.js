const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

function readJson(relPath) {
  return JSON.parse(fs.readFileSync(path.join(root, relPath), 'utf8'));
}

test('package and compose expose API-only surface', () => {
  const pkg = readJson('package.json');
  assert.deepEqual(Object.keys(pkg.scripts).sort(), ['start', 'test']);

  const compose = fs.readFileSync(path.join(root, 'docker-compose.yml'), 'utf8');
  assert.ok(compose.includes('\n  app:\n'));
  assert.equal(compose.includes('\n  scheduler:\n'), false);
});

test('legacy worker files are removed from repository', () => {
  const removedPaths = [
    'scripts/scheduler.js',
    'scripts/sync-jellyfin.js',
    'src/scripts/updateJellyfin.js',
    'src/scripts/updateCache.js',
    'src/services/ratingsApiClient.js',
    'test/ratingsApiClient.test.js',
    'test/syncJellyfinApiClient.test.js',
    'test/updateJellyfinApiGate.test.js',
  ];

  for (const rel of removedPaths) {
    assert.equal(fs.existsSync(path.join(root, rel)), false, `${rel} should be removed`);
  }
});

test('jellyfin-only services and tests are removed from API-only repository', () => {
  const removedPaths = [
    'src/config/jellyfin.js',
    'src/services/jellyfinClient.js',
    'src/services/jellyfinLibrary.js',
    'src/services/jellyfinUpdater.js',
    'src/services/posterProcessor.js',
    'test/jellyfinClient.test.js',
    'test/jellyfinConfig.test.js',
    'test/jellyfinLibrary.test.js',
    'test/jellyfinUpdater.test.js',
    'test/posterProcessor.test.js',
    'test/upsertPosterProcessed.test.js',
  ];

  for (const rel of removedPaths) {
    assert.equal(fs.existsSync(path.join(root, rel)), false, `${rel} should be removed`);
  }
});

test('env example is API-only and has no worker sync variables', () => {
  const envText = fs.readFileSync(path.join(root, '.env.example'), 'utf8');
  const forbidden = ['SYNC_', 'UPDATE_JELLYFIN_', 'POSTER_BADGE_', 'ENABLE_POSTER_BADGES'];
  for (const token of forbidden) {
    assert.equal(envText.includes(token), false, `${token} should not exist in API-only env`);
  }
});
