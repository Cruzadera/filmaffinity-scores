import axios from "axios";
import * as cheerio from "cheerio";

export async function getFilmAffinityRating(title) {
  const encodedTitle = encodeURIComponent(title.trim());
  const searchUrl = `https://www.filmaffinity.com/es/search.php?stext=${encodedTitle}&stype=title`;

  const searchRes = await axios.get(searchUrl);
  const $ = cheerio.load(searchRes.data);
  const filmLink = $("div.mc-title a").first().attr("href");
  if (!filmLink) return null;

  const filmUrl = `https://www.filmaffinity.com${filmLink}`;
  const filmRes = await axios.get(filmUrl);
  const $$ = cheerio.load(filmRes.data);

  const rating = parseFloat($$("#movie-rat-avg").text().trim()) || null;
  const votes = $$("#movie-count-rat").text().trim().replace(/\D/g, "") || null;
  const titleText = $$("#main-title").text().trim();
  const year =
    $$("#left-column .card div").first().text().match(/\d{4}/)?.[0] || null;

  return { title: titleText || title, year, rating, votes, url: filmUrl };
}
