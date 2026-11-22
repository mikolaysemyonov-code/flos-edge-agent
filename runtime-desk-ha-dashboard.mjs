/**
 * Замороженный рецепт HA-дашборда штор. Генерация всех зон — позже.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));

export function deskHaDashboardRecipe() {
  const file = path.join(DIR, "desk-ha-dashboard-recipe.json");
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function deskHaDashboardYaml() {
  const rec = deskHaDashboardRecipe();
  const file = path.join(DIR, rec.yaml || "desk-ha-dashboard-curtains.yaml");
  return fs.readFileSync(file, "utf8");
}
