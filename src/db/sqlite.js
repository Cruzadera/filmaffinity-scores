const fs = require('fs');
const path = require('path');

function init(dbPath) {
  const Database = require('better-sqlite3');

  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);

  db.exec(`
    CREATE TABLE IF NOT EXISTS ratings (
      key TEXT PRIMARY KEY,
      title TEXT,
      year INTEGER,
      rating REAL,
      votes INTEGER,
      url TEXT,
      last_updated TEXT,
      raw TEXT
    );
  `);

  const getRatingStmt = db.prepare('SELECT * FROM ratings WHERE key = ?');
  const upsertStmt = db.prepare(`
    INSERT INTO ratings (key, title, year, rating, votes, url, last_updated, raw)
    VALUES (@key, @title, @year, @rating, @votes, @url, @last_updated, @raw)
    ON CONFLICT(key) DO UPDATE SET
      title=excluded.title,
      year=excluded.year,
      rating=excluded.rating,
      votes=excluded.votes,
      url=excluded.url,
      last_updated=excluded.last_updated,
      raw=excluded.raw;
  `);

  const getAllStmt = db.prepare('SELECT * FROM ratings');

  return {
    getRating(key) {
      return getRatingStmt.get(key);
    },
    upsert(r) {
      const row = {
        key: r.key,
        title: r.title || null,
        year: r.year || null,
        rating: r.rating || null,
        votes: r.votes ? Number(r.votes) : null,
        url: r.url || null,
        last_updated: r.last_updated || null,
        raw: r.raw || null,
      };
      return upsertStmt.run(row);
    },
    getAll() {
      return getAllStmt.all();
    },
    close() {
      try { db.close(); } catch (e) { /* ignore */ }
    },
  };
}

module.exports = { init };
