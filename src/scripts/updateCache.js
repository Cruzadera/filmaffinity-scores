import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getFilmAffinityRating } from "../services/filmaffinity.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TITLES_FILE = path.join(__dirname, "../../data/titles.json");
const OUTPUT_FILE = path.join(__dirname, "../../data/ratings.json");

async function updateCache() {
  console.log("🕓 Iniciando actualización de cache FilmAffinity...");

  if (!fs.existsSync(TITLES_FILE)) {
    console.error("❌ No existe data/titles.json con los títulos a consultar.");
    return;
  }

  const titles = JSON.parse(fs.readFileSync(TITLES_FILE, "utf-8"));
  const results = {};

  for (const title of titles) {
    console.log(`🔹 Consultando: ${title}`);
    const data = await getFilmAffinityRating(title);
    if (data && data.rating) {
      results[title.toLowerCase()] = data;
      console.log(`✅ ${title} → ${data.rating}`);
    } else {
      console.warn(`⚠️ No se obtuvo nota para ${title}`);
    }
    await new Promise((r) => setTimeout(r, 5000));
  }

  fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2), "utf-8");

  console.log(`💾 Cache actualizada: ${Object.keys(results).length} títulos guardados.`);
}

updateCache();
