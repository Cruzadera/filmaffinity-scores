import express from 'express';
import dotenv from 'dotenv';
import NodeCache from 'node-cache';
import { getFilmAffinityRating } from './services/filmaffinity.js';

dotenv.config();

const app = express();
const cache = new NodeCache({ stdTTL: parseInt(process.env.CACHE_TTL || '86400') });
const PORT = process.env.PORT || 8085;

app.get('/rating', async (req, res) => {
  const { title } = req.query;
  if (!title) return res.status(400).json({ error: 'Missing title parameter' });

  const cacheKey = title.toLowerCase();
  if (cache.has(cacheKey)) return res.json(cache.get(cacheKey));

  try {
    const data = await getFilmAffinityRating(title);
    if (!data) return res.status(404).json({ error: 'No result found' });
    cache.set(cacheKey, data);
    res.json(data);
  } catch (err) {
    console.error('Error fetching rating:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.listen(PORT, () => console.log(`✅ FilmAffinity Scores API running on port ${PORT}`));
