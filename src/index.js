const express = require("express");
const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");
const NodeCache = require("node-cache");
const { getFilmAffinityRating } = require("./services/filmaffinity");
dotenv.config();

const app = express();

// TTL de la cache en memoria (por defecto 1 día)
const cache = new NodeCache({
  stdTTL: parseInt(process.env.CACHE_TTL || "86400"),
  checkperiod: 120,
});

const PORT = process.env.PORT || 8085;
const CACHE_FILE = path.join(__dirname, "../data/ratings.json");

// Middleware de logs
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  next();
});

// Endpoint principal
app.get("/rating", async (req, res) => {
  const { title } = req.query;
  if (!title)
    return res.status(400).json({ error: 'Missing "title" query parameter' });

  const cacheKey = title.toLowerCase();

  // 1️⃣ Revisa primero la cache en memoria
  if (cache.has(cacheKey)) {
    console.log(`🧠 Cache (RAM) hit: ${title}`);
    return res.json(cache.get(cacheKey));
  }

  // 2️⃣ Luego revisa el archivo local (JSON generado por cron)
  if (fs.existsSync(CACHE_FILE)) {
    try {
      const jsonData = JSON.parse(fs.readFileSync(CACHE_FILE, "utf-8"));
      if (jsonData[cacheKey]) {
        console.log(`💾 Cache (file) hit: ${title}`);
        cache.set(cacheKey, jsonData[cacheKey]); // guarda también en RAM
        return res.json(jsonData[cacheKey]);
      }
    } catch (err) {
      console.error("❌ Error leyendo cache local:", err.message);
    }
  }

  // 3️⃣ Si no está cacheado, realiza el scraping directamente (fallback)
  console.log(`🌐 Fetching FilmAffinity rating for: ${title}`);
  try {
    const data = await getFilmAffinityRating(title);

    if (!data || !data.rating) {
      console.warn(`⚠️ No se encontró resultado para "${title}"`);
      return res.status(404).json({ error: "No result found" });
    }

    // guarda en cache en memoria
    cache.set(cacheKey, data);

    // actualiza también el JSON local
    let currentCache = {};
    if (fs.existsSync(CACHE_FILE)) {
      try {
        currentCache = JSON.parse(fs.readFileSync(CACHE_FILE, "utf-8"));
      } catch {}
    }
    currentCache[cacheKey] = data;
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(currentCache, null, 2), "utf-8");

    console.log(`✅ Guardado en cache: ${title} (${data.rating})`);
    res.json(data);
  } catch (err) {
    console.error("❌ Error fetching rating:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Endpoint de estado
app.get("/health", (req, res) =>
  res.json({ status: "ok", cacheTTL: cache.options.stdTTL })
);

// Arranque del servidor
app.listen(PORT, () => {
  console.log(`🚀 FilmAffinity Scores API running on port ${PORT}`);
  console.log(`🧊 Cache TTL: ${cache.options.stdTTL}s`);
});
