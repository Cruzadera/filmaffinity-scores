const assert = require('assert');
const test = require('node:test');
const { isStale, computeTTLForYear } = require('../src/scripts/cacheUtils');

test('computeTTLForYear returns recentTTL for recent years', () => {
  const current = new Date().getFullYear();
  const ttl = computeTTLForYear(current, { cacheTTL: 30, recentTTL: 5, recentYears: 2 });
  assert.strictEqual(ttl, 5);
});

test('computeTTLForYear returns cacheTTL for old years', () => {
  const ttl = computeTTLForYear(1990, { cacheTTL: 30, recentTTL: 5, recentYears: 2 });
  assert.strictEqual(ttl, 30);
});

test('isStale true when entry missing', () => {
  assert.strictEqual(isStale(null, 2020, { cacheTTL: 30 }), true);
});

test('isStale true when last_updated older than ttl', () => {
  const oldDate = new Date(Date.now() - (1000 * 60 * 60 * 24 * 40)).toISOString(); // 40 days ago
  const entry = { last_updated: oldDate };
  assert.strictEqual(isStale(entry, 2000, { cacheTTL: 30 }), true);
});

test('isStale false when last_updated within ttl', () => {
  const recentDate = new Date(Date.now() - (1000 * 60 * 60 * 24 * 5)).toISOString(); // 5 days ago
  const entry = { last_updated: recentDate };
  assert.strictEqual(isStale(entry, new Date().getFullYear(), { cacheTTL: 30, recentTTL: 7, recentYears: 2 }), false);
});
