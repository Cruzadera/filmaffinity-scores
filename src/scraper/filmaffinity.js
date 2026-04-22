const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
puppeteer.use(StealthPlugin());
const fs = require("fs");
const path = require("path");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function normalizeSearchText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[[\u0300-\u036f]/g, "")
    .replace(/[-]/g, "")
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
    const logger = require("../logging");
    logger.info(`Searching for: ${normalizedTitle}`);
    await page.goto(searchUrl, { waitUntil: "networkidle2", timeout: 90000 });

    // Try to accept cookie/privacy banners that block search results (click ACEPTO / Aceptar / Accept)
    try {
      const clicked = await page.evaluate(() => {
        const nodes = Array.from(document.querySelectorAll('button, a, input, div, span'));
        const re = /(acepto|aceptar|accept|i agree)/i;
        for (const el of nodes) {
          const txt = (el.innerText || el.textContent || el.value || "").trim();
          if (!txt) continue;
          if (re.test(txt)) {
            try { el.click(); } catch (e) {
              try { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); } catch (e2) {}
            }
            return true;
          }
        }
        return false;
      });
      if (clicked) {
        logger.info("Cookie/banner accept clicked on search page");
        await sleep(1200);
      }
    } catch (e) {
      logger.debug && logger.debug("Cookie click attempt failed", e && e.message ? e.message : e);
    }

    // Attempt to hide/remove common cookie/consent overlays that may remain
    try {
      await page.evaluate(() => {
        const overlaySelectors = [
          '[id*="cookie"]', '[class*="cookie"]', '[id*="consent"]', '[class*="consent"]',
          '[id*="gdpr"]', '[class*="gdpr"]', '[id*="privacy"]', '[class*="privacy"]',
          '.cc-window', '.qc-cmp2-container', '.qc-cmp2-modal', '.cookie-consent'
        ];
        overlaySelectors.forEach((sel) => {
          Array.from(document.querySelectorAll(sel)).forEach((el) => {
            try { el.style.pointerEvents = 'none'; el.style.display = 'none'; el.remove(); } catch (e) {}
          });
        });
      });
      await sleep(300);
    } catch (e) {
      logger.debug && logger.debug("Overlay cleanup failed", e && e.message ? e.message : e);
    }

    // Give the stealth plugin time to react if Cloudflare blocks the page
    const pageTitle = await page.title();
    if (pageTitle.includes("Verifique que usted es un ser humano")) {
      logger.warn("Cloudflare challenge detected, waiting 15s...");
      await sleep(15000);
    }

    try { await page.waitForSelector('a[href]', { timeout: 3000 }); } catch (e) {}

    const filmLink = await page.evaluate((requestedTitle, requestedYear) => {
      const anchors = Array.from(document.querySelectorAll('a[href]'));
      const seen = new Set();
      const candidates = [];

      const filmRe = /film\d+\.html/i;
      for (const anchor of anchors) {
        const href = anchor.getAttribute('href');
        if (!href || seen.has(href)) continue;
        // keep only FilmAffinity film pages (e.g. /es/film774513.html or https://www.filmaffinity.com/es/film774513.html)
        const isRelative = href.startsWith('/');
        const isFAHost = href.includes('filmaffinity.com');
        const isFilmPage = filmRe.test(href);
        if (!isFilmPage) continue;
        if (!isFAHost && !isRelative) continue;
        seen.add(href);

        const container =
          anchor.closest('.movie-card') ||
          anchor.closest('.fa-shadow') ||
          anchor.closest('li') ||
          anchor.parentElement;
        const contextText = (container?.textContent || anchor.textContent || '')
          .replace(/\s+/g, ' ')
          .trim();
        const titleText = (anchor.textContent || '').replace(/\s+/g, ' ').trim();

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

    // If we have a good match (title + year), use it. Otherwise try a fallback:
    // Re-score by title only and then filter the top candidates by year in their context.
    if (!(bestCandidate && bestCandidate.score > 0)) {
      if (Array.isArray(filmLink) && filmLink.length > 0) {
        const rescored = filmLink
          .map((candidate) => ({
            ...candidate,
            score: scoreSearchCandidate(candidate, title, null),
          }))
          .sort((a, b) => b.score - a.score);

        if (year) {
          const byYear = rescored.filter((c) => matchesRequestedYear(c.contextText, year));
          if (byYear.length > 0) {
            // pick highest title-score among those matching the year
            const pick = byYear.sort((a, b) => b.score - a.score)[0];
            if (pick) {
              logger.info(`Fallback matched by title then filtered by year: ${pick.titleText || pick.href}${year ? ` (${year})` : ''}`);
              bestCandidate = pick; // eslint-disable-line no-param-reassign
            }
          }
        }
      }
    }

    if (bestCandidate && bestCandidate.score > 0) {
      logger.info(
        `Matched search result: ${bestCandidate.titleText || bestCandidate.href}${year ? ` (${year})` : ""}`
      );
    }

    if (!bestCandidate?.href) {
      logger.warn(`No result found for "${title}"${year ? ` (${year})` : ""}`);
      if (process.env.DEBUG_SCREENSHOTS === "true") {
        try {
          const debugDir = path.join(__dirname, "../../data");
          fs.mkdirSync(debugDir, { recursive: true });
          const screenshotPath = path.join(debugDir, `debug-${encodedTitle}.png`);
          await page.screenshot({ path: screenshotPath, fullPage: true });
          logger.info(`Saved debug screenshot: ${screenshotPath}`);
        } catch (e) {
          logger.warn("Failed saving debug screenshot:", e && e.message ? e.message : e);
        }
      }
      await browser.close();
      return null;
    }

    const filmUrl = bestCandidate.href.startsWith("http")
      ? bestCandidate.href
      : `https://www.filmaffinity.com${bestCandidate.href}`;

    // 2. Open the movie detail page
    logger.info(`Opening: ${filmUrl}`);
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
      logger.warn("Rating did not appear after waiting 30s");
      if (process.env.DEBUG_SCREENSHOTS === "true") {
        try {
          const debugDir = path.join(__dirname, "../../data");
          fs.mkdirSync(debugDir, { recursive: true });
          const screenshotPath = path.join(debugDir, `debug-${encodedTitle}-timeout.png`);
          await page.screenshot({ path: screenshotPath, fullPage: true });
          logger.info(`Saved debug screenshot: ${screenshotPath}`);
        } catch (e) {
          logger.warn("Failed saving debug timeout screenshot:", e && e.message ? e.message : e);
        }
      }
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
      logger.warn(`"${title}" was found but no rating is available`);
      return null;
    }

    if (year && data.year && !matchesRequestedYear(String(data.year), String(year))) {
      logger.warn(`Result year mismatch for "${title}": expected ${year}, got ${data.year}`);
      return null;
    }

    logger.info(
      `Retrieved rating: ${data.title} (${data.year}) -> ${data.rating} (${data.votes || "?"} votes)`
    );
    return data;
  } catch (err) {
    const logger = require("../logging");
    logger.error("Error scraping FilmAffinity:", err && err.message ? err.message : err);
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
