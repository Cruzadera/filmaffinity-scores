const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
puppeteer.use(StealthPlugin());

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function normalizeSearchText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function matchesRequestedYear(candidateText, requestedYear) {
  if (!requestedYear) {
    return true;
  }

  return candidateText.includes(String(requestedYear));
}

function scoreSearchCandidate(candidate, requestedTitle, requestedYear) {
  const normalizedRequestedTitle = normalizeSearchText(requestedTitle);
  const normalizedCandidateTitle = normalizeSearchText(candidate.titleText);
  const normalizedContext = normalizeSearchText(candidate.contextText);
  let score = 0;

  if (normalizedCandidateTitle === normalizedRequestedTitle) {
    score += 100;
  } else if (normalizedCandidateTitle.includes(normalizedRequestedTitle)) {
    score += 60;
  } else if (normalizedContext.includes(normalizedRequestedTitle)) {
    score += 30;
  }

  if (requestedYear && matchesRequestedYear(candidate.contextText, requestedYear)) {
    score += 40;
  }

  if (candidate.href.includes("/film")) {
    score += 5;
  }

  return score;
}

class ScraperError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = "ScraperError";
    if (cause) this.cause = cause;
  }
}

async function getFilmAffinityRating(title, year) {
  const normalizedTitle = normalizeSearchText(title);
  const encodedTitle = encodeURIComponent(normalizedTitle);
  const searchUrl = `https://www.filmaffinity.com/es/search.php?stext=${encodedTitle}&stype=title`;

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-blink-features=AutomationControlled",
      ],
    });

    const page = await browser.newPage();
    page.setDefaultTimeout(90000);

    await page.setExtraHTTPHeaders({
      "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
    });

    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36"
    );

    // 1. Search for the movie
    console.log(`Searching for: ${normalizedTitle}`);
    await page.goto(searchUrl, { waitUntil: "networkidle2", timeout: 90000 });

    // Give the stealth plugin time to react if Cloudflare blocks the page
    const pageTitle = await page.title();
    if (pageTitle.includes("Verifique que usted es un ser humano")) {
      console.log("Cloudflare challenge detected, waiting 15s...");
      await sleep(15000);
    }

    const filmLink = await page.evaluate((requestedTitle, requestedYear) => {
      const anchors = Array.from(document.querySelectorAll("a[href^='/es/film']"));
      const seen = new Set();
      const candidates = [];

      for (const anchor of anchors) {
        const href = anchor.getAttribute("href");
        if (!href || seen.has(href)) {
          continue;
        }

        seen.add(href);

        const container =
          anchor.closest(".movie-card") ||
          anchor.closest(".fa-shadow") ||
          anchor.closest("li") ||
          anchor.parentElement;
        const contextText = (container?.textContent || anchor.textContent || "")
          .replace(/\s+/g, " ")
          .trim();
        const titleText = (anchor.textContent || "").replace(/\s+/g, " ").trim();

        candidates.push({ href, titleText, contextText });
      }

      return candidates;
    }, title, year);

    const bestCandidate = Array.isArray(filmLink)
      ? filmLink
          .map((candidate) => ({
            ...candidate,
            score: scoreSearchCandidate(candidate, title, year),
          }))
          .sort((left, right) => right.score - left.score)[0]
      : null;

    if (bestCandidate && bestCandidate.score > 0) {
      console.log(
        `Matched search result: ${bestCandidate.titleText || bestCandidate.href}${year ? ` (${year})` : ""}`
      );
    }

    if (!bestCandidate?.href) {
      console.warn(`No result found for "${title}"${year ? ` (${year})` : ""}`);
      await page.screenshot({ path: `debug-${encodedTitle}.png`, fullPage: true });
      await browser.close();
      return null;
    }

    const filmUrl = bestCandidate.href.startsWith("http")
      ? bestCandidate.href
      : `https://www.filmaffinity.com${bestCandidate.href}`;

    // 2. Open the movie detail page
    console.log(`Opening: ${filmUrl}`);
    await page.goto(filmUrl, { waitUntil: "domcontentloaded", timeout: 90000 });

    // Wait up to 30s for the rating to appear
    let ratingReady = false;
    for (let i = 0; i < 15; i++) {
      ratingReady = await page.evaluate(() => {
        const el1 = document.querySelector("#rat-avg-count");
        const el2 = document.querySelector("#movie-rat-avg");
        const el3 = document.querySelector('#rat-avg-container meta[itemprop="ratingValue"]');
        return (
          (el1 && el1.textContent.trim()) ||
          (el2 && el2.textContent.trim()) ||
          (el3 && el3.getAttribute("content"))
        );
      });
      if (ratingReady) break;
      await sleep(2000);
    }

    if (!ratingReady) {
      console.warn("Rating did not appear after waiting 30s");
      await page.screenshot({ path: `debug-${encodedTitle}-timeout.png`, fullPage: true });
    }

    // 3. Extract data
    const data = await page.evaluate(() => {
      const getTxt = (sel) => document.querySelector(sel)?.textContent?.trim() || "";
      const getAttr = (sel, attr) => document.querySelector(sel)?.getAttribute(attr) || "";

      const titleEl = document.querySelector("#main-title");
      const title = titleEl ? titleEl.textContent.trim() : null;

      const ratingStr =
        getTxt("#rat-avg-count") ||
        getTxt("#movie-rat-avg") ||
        getAttr('#rat-avg-container meta[itemprop="ratingValue"]', "content") ||
        "";
      const rating = ratingStr ? parseFloat(ratingStr.replace(",", ".")) : null;

      const votesStr =
        getTxt("#movie-count-rat") ||
        getAttr('#rat-avg-container meta[itemprop="ratingCount"]', "content") ||
        "";
      const votes = votesStr.replace(/\D/g, "") || null;

      const yearStr =
        getTxt(".fa-year") ||
        getTxt('dd[itemprop="datePublished"]') ||
        getAttr('meta[itemprop="datePublished"]', "content") ||
        "";
      const yearMatch = (yearStr.match(/\b(19|20)\d{2}\b/) || [])[0] ||
        (document.body.innerText.match(/\b(19|20)\d{2}\b/) || [])[0] ||
        null;

      return {
        title,
        year: yearMatch,
        rating,
        votes,
        url: location.href,
      };
    });

    await browser.close();

    if (!data || !data.rating) {
      console.warn(`"${title}" was found but no rating is available`);
      return null;
    }

    if (year && data.year && !matchesRequestedYear(String(data.year), String(year))) {
      console.warn(`Result year mismatch for "${title}": expected ${year}, got ${data.year}`);
      return null;
    }

    console.log(
      `Retrieved rating: ${data.title} (${data.year}) -> ${data.rating} (${data.votes || "?"} votes)`
    );
    return data;
  } catch (err) {
    console.error("Error scraping FilmAffinity:", err && err.message ? err.message : err);
    if (browser) await browser.close().catch(() => {});
    throw new ScraperError("Failed to scrape FilmAffinity", err);
  }
}

module.exports = {
  getFilmAffinityRating,
  normalizeSearchText,
  scoreSearchCandidate,
  ScraperError,
};
