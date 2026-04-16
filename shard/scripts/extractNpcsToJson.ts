/**
 * One-shot migration: read NPC_DEFS from npcSpawner.ts and write one JSON
 * file per zone to world/content/npcs/<zoneId>.json.
 *
 * Run once:  pnpm tsx scripts/extractNpcsToJson.ts
 */
import fs from "node:fs";
import path from "node:path";
import { NPC_DEFS } from "../src/world/npcSpawner.js";

const OUT_DIR = path.resolve(process.cwd(), "..", "world", "content", "npcs");
fs.mkdirSync(OUT_DIR, { recursive: true });

const byZone = new Map<string, any[]>();
for (const def of NPC_DEFS) {
  const arr = byZone.get(def.zoneId) ?? [];
  // Strip zoneId from each entry — it's redundant with the filename.
  const { zoneId: _z, ...rest } = def;
  arr.push(rest);
  byZone.set(def.zoneId, arr);
}

let total = 0;
for (const [zoneId, npcs] of byZone) {
  const file = path.join(OUT_DIR, `${zoneId}.json`);
  fs.writeFileSync(
    file,
    JSON.stringify({ zoneId, npcs }, null, 2) + "\n",
    "utf-8",
  );
  console.log(`  ${zoneId}: ${npcs.length} NPCs → ${file}`);
  total += npcs.length;
}

console.log(`\nExtracted ${total} NPCs across ${byZone.size} zones to ${OUT_DIR}`);
