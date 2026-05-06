// Thin wrapper that delegates to the scraper layer
const scraper = require("../scraper/filmaffinity");

module.exports = {
  getFilmAffinityRating: scraper.getFilmAffinityRating,
  normalizeSearchText: scraper.normalizeSearchText,
  scoreSearchCandidate: scraper.scoreSearchCandidate,
  ScraperError: scraper.ScraperError,
  restartBrowser: typeof scraper.restartBrowser === 'function' ? scraper.restartBrowser : undefined,
};
