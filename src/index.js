const express = require('express');
const dotenv = require('dotenv');
const NodeCache = require('node-cache');
const { getFilmAffinityRating } = require('./services/filmaffinity');
dotenv.config();

const app = express();

// TTL de la cache (por defecto 1 día)
const cache = new NodeCache({
  stdTTL: parseInt(process.env.CACHE_TTL || '86400'),
  checkperiod: 120, // revisa elementos caducados cada 2 minutos
});

const PORT = process.env.PORT || 8085;

// Middleware básico de logs y timeout
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  next();
});

// Endpoint principal
app.get('/rating', async (req, res) => {
  const { title } = req.query;
  if (!title)
    return res.status(400).json({ error: 'Missing "title" query parameter' });

  const cacheKey = title.toLowerCase();

  //Intenta servir desde cache
  if (cache.has(cacheKey)) {
    console.log(`🧠 Cache hit: ${title}`);
    return res.json(cache.get(cacheKey));
  }

  console.log(`🌐 Fetching rating for: ${title}`);

  try {
    const data = await getFilmAffinityRating(title);

    if (!data || !data.rating) {
      console.warn(`⚠️ No se encontró resultado para "${title}"`);
      return res.status(404).json({ error: 'No result found' });
    }

    // Guarda en cache
    cache.set(cacheKey, data);
    console.log(`✅ Cached: ${title} (${data.rating})`);
    res.json(data);
  } catch (err) {
    console.error('❌ Error fetching rating:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Endpoint de estado
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// Arranque del servidor
app.listen(PORT, () => {
  console.log(`🚀 FilmAffinity Scores API running on port ${PORT}`);
  console.log(`🧊 Cache TTL: ${cache.options.stdTTL}s`);
});