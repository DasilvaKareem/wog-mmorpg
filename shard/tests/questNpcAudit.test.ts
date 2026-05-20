/**
 * Static audit: every quest npcId must resolve to a spawned NPC name in a
 * zone JSON, every prerequisiteQuestId must point to an existing quest, and
 * quest IDs must be unique.
 *
 * Runs without a live server — parses questSystem.ts and zone JSONs as text/JSON.
 * Run: pnpm test:quest-audit
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const QUEST_SRC  = path.resolve(__dirname, "../src/social/questSystem.ts");
const NPC_DIR    = path.resolve(__dirname, "../../world/content/npcs");

// ── 1. Parse quest fields from questSystem.ts source ─────────────────────────

const src = fs.readFileSync(QUEST_SRC, "utf-8");

// Collect all   id: "...",   values from questSystem.ts as the universe of quest IDs.
// Non-quest objects in the file may add false positives but won't cause false failures.
const idMatches = [...src.matchAll(/^\s+id:\s+"([^"]+)"/gm)].map(m => m[1]);
const questIds  = new Set(idMatches);

const npcIdPairs: Array<{ npcId: string; line: number }> = [];
for (const m of src.matchAll(/^\s+npcId:\s+"([^"]+)"/gm)) {
  const line = src.slice(0, m.index).split("\n").length;
  npcIdPairs.push({ npcId: m[1], line });
}

const prereqPairs: Array<{ prereqId: string; line: number }> = [];
for (const m of src.matchAll(/^\s+prerequisiteQuestId:\s+"([^"]+)"/gm)) {
  const line = src.slice(0, m.index).split("\n").length;
  prereqPairs.push({ prereqId: m[1], line });
}

// ── 2. Collect all spawned NPC names from zone JSONs ─────────────────────────

const spawnedNpcNames = new Set<string>();
const npcsByZone = new Map<string, string[]>();

for (const file of fs.readdirSync(NPC_DIR)) {
  if (!file.endsWith(".json")) continue;
  const zoneId = file.replace(/\.json$/, "");
  const data = JSON.parse(fs.readFileSync(path.join(NPC_DIR, file), "utf-8"));
  const names: string[] = [];
  for (const npc of data.npcs ?? []) {
    if (npc.name) {
      spawnedNpcNames.add(npc.name);
      names.push(npc.name);
    }
  }
  npcsByZone.set(zoneId, names);
}

// ── 3. Run checks ─────────────────────────────────────────────────────────────

let failures = 0;
function fail(msg: string) {
  console.error(`  FAIL: ${msg}`);
  failures++;
}

// 3a. Quest ID uniqueness
console.log(`\nChecking ${questIds.size} quest IDs for duplicates…`);
const seenIds = new Map<string, number>();
for (const id of idMatches) {
  seenIds.set(id, (seenIds.get(id) ?? 0) + 1);
}
for (const [id, count] of seenIds) {
  if (count > 1) fail(`Duplicate id "${id}" appears ${count} times`);
}

// 3b. Every npcId resolves to a spawned NPC
console.log(`Checking ${npcIdPairs.length} npcId references against ${spawnedNpcNames.size} spawned NPCs…`);
const missingNpcs = new Map<string, number[]>();
for (const { npcId, line } of npcIdPairs) {
  if (!spawnedNpcNames.has(npcId)) {
    if (!missingNpcs.has(npcId)) missingNpcs.set(npcId, []);
    missingNpcs.get(npcId)!.push(line);
  }
}
for (const [npcId, lines] of missingNpcs) {
  fail(`npcId "${npcId}" has no matching spawned NPC (questSystem.ts lines ${lines.join(", ")})`);
}

// 3c. Every prerequisiteQuestId points to an existing quest
console.log(`Checking ${prereqPairs.length} prerequisiteQuestId references…`);
for (const { prereqId, line } of prereqPairs) {
  if (!questIds.has(prereqId)) {
    fail(`prerequisiteQuestId "${prereqId}" does not match any known quest id (line ${line})`);
  }
}

// ── 4. Summary ────────────────────────────────────────────────────────────────

if (failures > 0) {
  console.error(`\nquestNpcAudit: ${failures} failure(s). Fix them before scattering profession quests.\n`);
  process.exit(1);
}

console.log(`\nquestNpcAudit: all checks passed ✓`);
console.log(`  ${questIds.size} quest IDs — all unique`);
console.log(`  ${npcIdPairs.length} npcId refs — all resolve to spawned NPCs`);
console.log(`  ${prereqPairs.length} prerequisite refs — all valid`);
