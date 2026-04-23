const test = require('node:test');
const assert = require('assert');

const {
  generateBadge,
  getBadgeColor,
  buildPosterProcessHash,
  needsPosterRegeneration,
} = require('../src/services/posterProcessor');

test('getBadgeColor uses rating thresholds', () => {
  assert.strictEqual(getBadgeColor(8), '#1f9d55');
  assert.strictEqual(getBadgeColor(5.4), '#d97706');
  assert.strictEqual(getBadgeColor(4.9), '#dc2626');
});

test('generateBadge returns SVG buffer with rating text', () => {
  const buf = generateBadge(7.3, { width: 200, height: 80, addFaIndicator: true });
  const svg = buf.toString('utf8');
  assert.ok(svg.includes('7.3'));
  assert.ok(svg.includes('FA'));
});

test('buildPosterProcessHash is deterministic', () => {
  const cfg = { position: 'top-right', size: 0.2, marginRatio: 0.03, addFaIndicator: true };
  const a = buildPosterProcessHash(7.3, cfg);
  const b = buildPosterProcessHash(7.3, cfg);
  assert.strictEqual(a, b);
});

test('needsPosterRegeneration skips when cache matches rating/hash', () => {
  const cacheEntry = { last_rating: 7.3, poster_processed: 'abc' };
  assert.strictEqual(needsPosterRegeneration(cacheEntry, 7.3, 'abc', false), false);
  assert.strictEqual(needsPosterRegeneration(cacheEntry, 7.4, 'abc', false), true);
  assert.strictEqual(needsPosterRegeneration(cacheEntry, 7.3, 'def', false), true);
  assert.strictEqual(needsPosterRegeneration(cacheEntry, 7.3, 'abc', true), true);
});
