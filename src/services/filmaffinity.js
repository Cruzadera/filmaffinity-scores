const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
puppeteer.use(StealthPlugin());

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getFilmAffinityRating(title) {
  const encodedTitle = encodeURIComponent(title.trim());
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
    console.log(`Searching for: ${title}`);
    await page.goto(searchUrl, { waitUntil: "networkidle2", timeout: 90000 });

    // Give the stealth plugin time to react if Cloudflare blocks the page
    const pageTitle = await page.title();
    if (pageTitle.includes("Verifique que usted es un ser humano")) {
      console.log("Cloudflare challenge detected, waiting 15s...");
      await sleep(15000);
    }

    // Possible selectors for the first matching result
    const selectors = [
      "div.row.movie-card div.fs-6.mc-title a",
      "div.mc-title a",
      "ul.fa-list-group li a",
      "a[href^='/es/film']",
    ];

    let filmLink = null;
    for (const sel of selectors) {
      try {
        await page.waitForSelector(sel, { timeout: 15000 });
        filmLink = await page.$eval(sel, (el) => el.getAttribute("href"));
        if (filmLink) {
          console.log(`Valid selector found: ${sel}`);
          break;
        }
      } catch (_) {}
    }

    if (!filmLink) {
      console.warn(`No result found for "${title}"`);
      await page.screenshot({ path: `debug-${encodedTitle}.png`, fullPage: true });
      await browser.close();
      return null;
    }

    const filmUrl = filmLink.startsWith("http")
      ? filmLink
      : `https://www.filmaffinity.com${filmLink}`;

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

      const yearMatch = (document.body.innerText.match(/\b(19|20)\d{2}\b/) || [])[0] || null;

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

    console.log(
      `Retrieved rating: ${data.title} (${data.year}) -> ${data.rating} (${data.votes || "?"} votes)`
    );
    return data;
  } catch (err) {
    console.error("Error scraping FilmAffinity:", err.message);
    if (browser) await browser.close().catch(() => {});
    return null;
  }
}

module.exports = { getFilmAffinityRating };
