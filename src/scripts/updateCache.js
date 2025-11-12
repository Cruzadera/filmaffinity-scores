const fs = require("fs");
const path = require("path");
const fetch = require("node-fetch");
const dotenv = require("dotenv");
const { getFilmAffinityRating } = require("../services/filmaffinity");

dotenv.config();

const OUTPUT_FILE = path.join(__dirname, "../../data/ratings.json");

const JELLYFIN_URL = process.env.JELLYFIN_URL || "http://localhost:8096";
const JELLYFIN_API_KEY = process.env.JELLYFIN_API_KEY;

if (!JELLYFIN_API_KEY) {
  console.error("❌ Falta la API key de Jellyfin en .env (JELLYFIN_API_KEY)");
  process.exit(1);
}

async function fetchTitlesFromJellyfin() {
  console.log("📡 Obteniendo títulos desde Jellyfin...");

  const url = `${JELLYFIN_URL}/Items?IncludeItemTypes=Movie&Recursive=true&Fields=Name&api_key=${JELLYFIN_API_KEY}`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Jellyfin API error: ${res.status}`);
  }

  const data = await res.json();
  const titles = data.Items?.map((i) => i.Name)?.filter(Boolean) || [];

  console.log(`🎬 ${titles.length} títulos encontrados en Jellyfin.`);
  return [...new Set(titles)];
}

async function updateCache() {
  console.log("🕓 Iniciando actualización de cache FilmAffinity...");

  const titles = await fetchTitlesFromJellyfin();
  const results = {};
  let count = 0;

  for (const title of titles) {
    console.log(`🔹 Consultando: ${title}`);
    const data = await getFilmAffinityRating(title);
    if (data && data.rating) {
      results[title.toLowerCase()] = data;
      console.log(`✅ ${title} → ${data.rating}`);
      count++;
    } else {
      console.warn(`⚠️ No se obtuvo nota para ${title}`);
    }

    // Espera entre peticiones (para evitar bloqueos de Cloudflare)
    await new Promise((r) => setTimeout(r, 5000));
  }

  fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2), "utf-8");

  console.log(`💾 Cache actualizada: ${count}/${titles.length} títulos guardados.`);
}

updateCache().catch((err) => {
  console.error("❌ Error en updateCache:", err.message);
  process.exit(1);
});