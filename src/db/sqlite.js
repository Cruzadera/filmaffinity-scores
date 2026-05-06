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
      last_rating REAL,
      votes INTEGER,
      url TEXT,
      last_updated TEXT,
      poster_processed TEXT,
      raw TEXT
    );
  `);

  // Lightweight forward migration for existing databases.
  const columns = db.prepare('PRAGMA table_info(ratings)').all().map(c => c.name);
  if (!columns.includes('last_rating')) {
    db.exec('ALTER TABLE ratings ADD COLUMN last_rating REAL;');
  }
  if (!columns.includes('poster_processed')) {
    db.exec('ALTER TABLE ratings ADD COLUMN poster_processed TEXT;');
  }

  const getRatingStmt = db.prepare('SELECT * FROM ratings WHERE key = ?');
  const upsertStmt = db.prepare(`
    INSERT INTO ratings (key, title, year, rating, last_rating, votes, url, last_updated, poster_processed, raw)
    VALUES (@key, @title, @year, @rating, @last_rating, @votes, @url, @last_updated, @poster_processed, @raw)
    ON CONFLICT(key) DO UPDATE SET
      title=excluded.title,
      year=excluded.year,
      rating=excluded.rating,
      last_rating=excluded.last_rating,
      votes=excluded.votes,
      url=excluded.url,
      last_updated=excluded.last_updated,
      poster_processed=COALESCE(excluded.poster_processed, poster_processed),
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
        rating: r.rating !== undefined && r.rating !== null ? Number(r.rating) : null,
        last_rating: r.last_rating !== undefined && r.last_rating !== null
          ? Number(r.last_rating)
          : (r.rating !== undefined && r.rating !== null ? Number(r.rating) : null),
        votes: r.votes !== undefined && r.votes !== null ? Number(r.votes) : null,
        url: r.url || null,
        last_updated: r.last_updated || null,
        poster_processed: r.poster_processed || null,
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
