const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { after, test } = require("node:test");

const repoRoot = path.join(__dirname, "..");
const cacheFile = path.join(repoRoot, "data", "ratings.json");
const indexPath = path.join(repoRoot, "src", "index.js");
const servicePath = path.join(repoRoot, "src", "services", "filmaffinity.js");

const originalCacheExists = fs.existsSync(cacheFile);
const originalCacheContent = originalCacheExists ? fs.readFileSync(cacheFile, "utf-8") : null;

function restoreCacheFile() {
  if (originalCacheExists) {
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    fs.writeFileSync(cacheFile, originalCacheContent, "utf-8");
    return;
  }

  if (fs.existsSync(cacheFile)) {
    fs.unlinkSync(cacheFile);
  }
}

function loadApp(mockGetFilmAffinityRating) {
  delete require.cache[indexPath];
  delete require.cache[servicePath];

  require.cache[servicePath] = {
    id: servicePath,
    filename: servicePath,
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
  restoreCacheFile();
  delete require.cache[indexPath];
  delete require.cache[servicePath];
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
  restoreCacheFile();

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
    restoreCacheFile();
  });

  const response = await fetch(`${baseUrl}/movie?title=Alien&year=1979`);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), expectedPayload);

  const cacheContent = JSON.parse(fs.readFileSync(cacheFile, "utf-8"));
  assert.deepEqual(cacheContent["alien::1979"], expectedPayload);
});

test("GET /movie normalizes title input before matching", async (t) => {
  restoreCacheFile();

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
    restoreCacheFile();
  });

  const response = await fetch(`${baseUrl}/movie?title=%20%20Am%C3%A9lie%20%20&year=2001`);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), expectedPayload);

  const cacheContent = JSON.parse(fs.readFileSync(cacheFile, "utf-8"));
  assert.deepEqual(cacheContent["amelie::2001"], expectedPayload);
});

test("GET /movie returns 404 when the scraper finds no results", async (t) => {
  restoreCacheFile();

  const app = loadApp(async (title, year) => {
    assert.equal(title, "unknown movie");
    assert.equal(year, "2099");
    return null;
  });
  const { server, baseUrl } = await startServer(app);

  t.after(() => {
    server.close();
    restoreCacheFile();
  });

  const response = await fetch(`${baseUrl}/movie?title=Unknown%20Movie&year=2099`);

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), {
    error: "No result found",
  });
});

test("GET /movie returns 502 when the scraper errors", async (t) => {
  restoreCacheFile();

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
    restoreCacheFile();
  });

  const response = await fetch(`${baseUrl}/movie?title=Some%20Title&year=2000`);

  assert.equal(response.status, 502);
  const json = await response.json();
  assert.equal(json.error, "Scraper error");
  assert.ok(json.message && json.message.includes("timeout"));
});

test("scoreSearchCandidate prioritizes the exact title and requested year", () => {
  delete require.cache[servicePath];
  const { scoreSearchCandidate } = require(servicePath);

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
  delete require.cache[servicePath];
  const { normalizeSearchText } = require(servicePath);

  assert.equal(normalizeSearchText("  Amélie  "), "amelie");
});
