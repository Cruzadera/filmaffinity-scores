const test = require('node:test');
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { init } = require('../src/db/sqlite');

test('upsert preserves poster_processed when excluded is null', () => {
  const dbPath = path.join(__dirname, 'tmp-ratings.db');
  try { if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath); } catch (e) {}

  const db = init(dbPath);

  const now = new Date().toISOString();

  // Insert initial row with poster_processed
  db.upsert({ key: 'k1', title: 'A', year: 2020, rating: 7.2, last_rating: 7.2, votes: 100, url: 'http://x', last_updated: now, poster_processed: 'hash-1', raw: '{}' });

  // Upsert again without poster_processed (simulating updateCache behavior)
  db.upsert({ key: 'k1', title: 'A2', year: 2020, rating: 7.3, last_rating: 7.3, votes: 101, url: 'http://x2', last_updated: now, raw: '{}' });

  const row = db.getRating('k1');
  assert.strictEqual(row.poster_processed, 'hash-1');

  db.close();
  try { fs.unlinkSync(dbPath); } catch (e) {}
});
