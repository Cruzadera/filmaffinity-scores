const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { after, test } = require("node:test");
const { init: initDb } = require("../src/db/sqlite");

const repoRoot = path.join(__dirname, "..");
const indexPath = path.join(repoRoot, "src", "index.js");
const scraperPath = path.join(repoRoot, "src", "scraper", "filmaffinity.js");

// Use an isolated temp DB per test run so tests never interfere with real data
const tmpDbPath = path.join(os.tmpdir(), `ratings-test-${Date.now()}.db`);
process.env.DB_PATH = tmpDbPath;

function resetDb() {
  if (fs.existsSync(tmpDbPath)) fs.unlinkSync(tmpDbPath);
  // Clear module cache so index.js re-initialises the DB
  delete require.cache[indexPath];
}

function loadApp(mockGetFilmAffinityRating) {
  delete require.cache[indexPath];
  delete require.cache[scraperPath];

  require.cache[scraperPath] = {
    id: scraperPath,
    filename: scraperPath,
    loaded: true,
    exports: {
      getFilmAffinityRating: mockGetFilmAffinityRating,
    },
  };

  return require(indexPath).app;
}

function startServer(app) {
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${port}`,
      });
    });
  });
}

after(() => {
  delete require.cache[indexPath];
  delete require.cache[scraperPath];
  if (fs.existsSync(tmpDbPath)) fs.unlinkSync(tmpDbPath);
});

test('GET /movie returns 400 when "title" is missing', async (t) => {
  const app = loadApp(async () => {
    throw new Error("The scraper should not be called for invalid input");
  });
  const { server, baseUrl } = await startServer(app);

  t.after(() => server.close());

  const response = await fetch(`${baseUrl}/movie?year=1999`);

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: 'Missing "title" query parameter',
  });
});

test('GET /movie returns 400 when "year" is missing', async (t) => {
  const app = loadApp(async () => {
    throw new Error("The scraper should not be called for invalid input");
  });
  const { server, baseUrl } = await startServer(app);

  t.after(() => server.close());

  const response = await fetch(`${baseUrl}/movie?title=Alien`);

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: 'Missing "year" query parameter',
  });
});

test('GET /movie returns 400 when "year" is invalid', async (t) => {
  const app = loadApp(async () => {
    throw new Error("The scraper should not be called for invalid input");
  });
  const { server, baseUrl } = await startServer(app);

  t.after(() => server.close());

  const response = await fetch(`${baseUrl}/movie?title=Alien&year=99`);

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: '"year" query parameter must be a 4-digit year',
  });
});

test("GET /movie returns FilmAffinity data for valid input", async (t) => {
  resetDb();

  const expectedPayload = {
    title: "Alien",
    year: "1979",
    rating: 8.1,
    votes: "123456",
    url: "https://www.filmaffinity.com/es/film123456.html",
  };

  const app = loadApp(async (title, year) => {
    assert.equal(title, "alien");
    assert.equal(year, "1979");
    return expectedPayload;
  });
  const { server, baseUrl } = await startServer(app);

  t.after(() => {
    server.close();
    resetDb();
  });

  const response = await fetch(`${baseUrl}/movie?title=Alien&year=1979`);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), expectedPayload);

  const verifyDb = initDb(tmpDbPath);
  const row = verifyDb.getRating("alien::1979");
  verifyDb.close();
  assert.ok(row, "DB entry should exist for alien::1979");
  assert.deepEqual(JSON.parse(row.raw), expectedPayload);
});

test("GET /movie normalizes title input before matching", async (t) => {
  resetDb();

  const expectedPayload = {
    title: "Amelie",
    year: "2001",
    rating: 7.8,
    votes: "654321",
    url: "https://www.filmaffinity.com/es/film654321.html",
  };

  const app = loadApp(async (title, year) => {
    assert.equal(title, "amelie");
    assert.equal(year, "2001");
    return expectedPayload;
  });
  const { server, baseUrl } = await startServer(app);

  t.after(() => {
    server.close();
    resetDb();
  });

  const response = await fetch(`${baseUrl}/movie?title=%20%20Am%C3%A9lie%20%20&year=2001`);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), expectedPayload);

  const verifyDb = initDb(tmpDbPath);
  const row = verifyDb.getRating("amelie::2001");
  verifyDb.close();
  assert.ok(row, "DB entry should exist for amelie::2001");
  assert.deepEqual(JSON.parse(row.raw), expectedPayload);
});

test("GET /movie returns 404 when the scraper finds no results", async (t) => {
  resetDb();

  const app = loadApp(async (title, year) => {
    assert.equal(title, "unknown movie");
    assert.equal(year, "2099");
    return null;
  });
  const { server, baseUrl } = await startServer(app);

  t.after(() => {
    server.close();
    resetDb();
  });

  const response = await fetch(`${baseUrl}/movie?title=Unknown%20Movie&year=2099`);

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), {
    error: "No result found",
  });
});

test("GET /movie returns 502 when the scraper errors", async (t) => {
  resetDb();

  const app = loadApp(async (title, year) => {
    assert.equal(title, "some title");
    assert.equal(year, "2000");
    const err = new Error("timeout while scraping");
    err.name = "ScraperError";
    throw err;
  });
  const { server, baseUrl } = await startServer(app);

  t.after(() => {
    server.close();
    resetDb();
  });

  const response = await fetch(`${baseUrl}/movie?title=Some%20Title&year=2000`);

  assert.equal(response.status, 502);
  const json = await response.json();
  assert.equal(json.error, "Scraper error");
  assert.ok(json.message && json.message.includes("timeout"));
});

test("scoreSearchCandidate prioritizes the exact title and requested year", () => {
  delete require.cache[scraperPath];
  const { scoreSearchCandidate } = require(scraperPath);

  const exactMatch = {
    href: "/es/film123.html",
    titleText: "Alien",
    contextText: "Alien 1979 Ridley Scott",
  };
  const wrongYear = {
    href: "/es/film456.html",
    titleText: "Alien",
    contextText: "Alien 2003 Director's Cut",
  };
  const partialMatch = {
    href: "/es/film789.html",
    titleText: "Aliens",
    contextText: "Aliens 1986 James Cameron",
  };

  assert.ok(
    scoreSearchCandidate(exactMatch, "Alien", "1979") >
      scoreSearchCandidate(wrongYear, "Alien", "1979")
  );
  assert.ok(
    scoreSearchCandidate(exactMatch, "Alien", "1979") >
      scoreSearchCandidate(partialMatch, "Alien", "1979")
  );
});

test("normalizeSearchText lowercases, removes accents and trims spaces", () => {
  delete require.cache[scraperPath];
  const { normalizeSearchText } = require(scraperPath);

  assert.equal(normalizeSearchText("  Amélie  "), "amelie");
});
