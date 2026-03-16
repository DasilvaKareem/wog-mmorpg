#!/usr/bin/env npx tsx
/**
 * Generate P0 (critical) 3D assets via Tripo3D API.
 * Monsters, crafting stations, resource nodes — the stuff that's currently colored capsules.
 *
 * Usage:
 *   npx tsx src/tools/generate-p0-assets.ts
 *
 * Skips already-generated files. Safe to re-run.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");

// Read .env
try {
  const envFile = fs.readFileSync(path.join(ROOT, ".env"), "utf-8");
  for (const line of envFile.split("\n")) {
    const match = line.match(/^\s*([\w]+)\s*=\s*(.+?)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
  }
} catch { /* no .env */ }

const API_BASE = "https://api.tripo3d.ai/v2/openapi";
const POLL_INTERVAL = 5_000;
const MAX_POLL_TIME = 600_000; // 10 min timeout (slow mode)
const API_KEY = process.argv[2] || process.env.VITE_TRIPO_API_KEY || "";
const OUT_DIR = path.join(ROOT, "assets-source");
const MAX_CONCURRENT = 2; // conservative for slow background run
const DELAY_BETWEEN_BATCHES = 10_000; // 10s between batches to be gentle

if (!API_KEY) {
  console.error("ERROR: No Tripo API key. Set VITE_TRIPO_API_KEY in .env or pass as arg.");
  process.exit(1);
}

// ── Asset definitions: [filename, prompt, scale] ────────────────────────

const STYLE = "anime fantasy style, stylized low-poly, vibrant colors, World of Warcraft meets Genshin Impact aesthetic, single game asset on blank background";

const ASSETS: [string, string, number][] = [
  // ═══════════════════════════════════════════════════════════════════════
  // MONSTERS — P0 (replace colored capsules)
  // ═══════════════════════════════════════════════════════════════════════

  // Beasts
  ["mob_slime.glb",
   `cute bouncy slime monster, translucent green jelly body, happy menacing face, ${STYLE}`,
   1.0],
  ["mob_rat.glb",
   `giant fantasy rat, glowing red eyes, mangy fur, oversized teeth, ${STYLE}`,
   0.8],
  ["mob_boar.glb",
   `wild boar, large tusks, bristly brown fur, aggressive stance, ${STYLE}`,
   1.2],
  ["mob_bear.glb",
   `massive forest bear, thick brown fur, standing on hind legs, powerful claws, ${STYLE}`,
   1.5],
  ["mob_spider.glb",
   `giant spider, eight legs, glowing green abdomen, venomous fangs, dark purple body, ${STYLE}`,
   1.3],
  ["mob_bat.glb",
   `large cave bat, spread wings, red glowing eyes, dark fur, ${STYLE}`,
   0.8],
  ["mob_snake.glb",
   `giant fantasy serpent, coiled body, hood spread, glowing venom dripping, ${STYLE}`,
   1.0],
  ["mob_hawk.glb",
   `majestic storm hawk, spread wings, lightning crackling on feathers, ${STYLE}`,
   1.0],
  ["mob_beetle.glb",
   `armored giant beetle, iridescent carapace, large mandibles, ${STYLE}`,
   1.0],
  ["mob_scorpion.glb",
   `giant crystal scorpion, translucent body, glowing stinger tail, ${STYLE}`,
   1.2],
  ["mob_drake.glb",
   `young dragon drake, small wings, scales, fire breath, wyvern-like, ${STYLE}`,
   1.5],
  ["mob_stag.glb",
   `mystical spirit stag, glowing ethereal antlers, white fur, magical particles, ${STYLE}`,
   1.3],

  // Undead & Dark
  ["mob_skeleton.glb",
   `skeleton warrior, rusty sword and shield, glowing blue eye sockets, tattered armor, ${STYLE}`,
   1.0],
  ["mob_ghost.glb",
   `floating ghost, translucent flowing robes, eerie blue glow, wailing expression, ${STYLE}`,
   1.0],
  ["mob_zombie.glb",
   `fantasy zombie, decaying flesh, glowing green eyes, torn clothes, shambling, ${STYLE}`,
   1.0],
  ["mob_lich.glb",
   `lich sorcerer, floating, dark crown, glowing soul fire in chest, tattered dark robes, ${STYLE}`,
   1.3],
  ["mob_vampire.glb",
   `vampire lord, pale aristocratic, red eyes, dark cape, elegant but menacing, ${STYLE}`,
   1.1],
  ["mob_death_knight.glb",
   `death knight, dark corrupted plate armor, runed greatsword, glowing red visor, ${STYLE}`,
   1.2],

  // Humanoids
  ["mob_goblin.glb",
   `goblin warrior, green skin, oversized pointy ears, crude wooden club, leather scraps, ${STYLE}`,
   0.7],
  ["mob_bandit.glb",
   `human bandit, hooded, dual daggers, leather armor, scarf over face, ${STYLE}`,
   1.0],
  ["mob_orc.glb",
   `orc berserker, green skin, large tusks, massive muscular build, tribal war paint, ${STYLE}`,
   1.4],
  ["mob_dark_mage.glb",
   `dark mage, hooded robes, floating grimoire book, purple arcane energy hands, ${STYLE}`,
   1.0],
  ["mob_witch.glb",
   `swamp witch, pointed hat, gnarled staff, cauldron, hunched, magical aura, ${STYLE}`,
   1.0],
  ["mob_harpy.glb",
   `harpy, feathered wings for arms, bird talons, screaming face, wind swirling, ${STYLE}`,
   1.1],

  // Elementals & Magical
  ["mob_elemental_fire.glb",
   `fire elemental, living flame humanoid shape, molten rock core, burning bright, ${STYLE}`,
   1.3],
  ["mob_elemental_water.glb",
   `water elemental, flowing liquid humanoid body, glowing blue core, splashing, ${STYLE}`,
   1.3],
  ["mob_elemental_earth.glb",
   `earth elemental, rocky humanoid body, crystal growths, moss patches, heavy, ${STYLE}`,
   1.4],
  ["mob_elemental_lightning.glb",
   `lightning elemental, crackling electric energy humanoid, bright blue-white, sparks, ${STYLE}`,
   1.2],
  ["mob_treant.glb",
   `walking tree monster treant, mossy bark skin, glowing green eyes, branch arms, ${STYLE}`,
   1.5],
  ["mob_mushroom.glb",
   `mushroom monster myconid, large spotted red cap, stubby legs, spore cloud, ${STYLE}`,
   0.8],
  ["mob_wisp.glb",
   `floating magical wisp, orb of blue-white light, fairy-like trailing sparkles, ${STYLE}`,
   0.5],
  ["mob_fairy.glb",
   `dark fairy, butterfly wings, tiny humanoid, magical dust trail, mischievous, ${STYLE}`,
   0.4],

  // Large / Elite
  ["mob_ogre.glb",
   `fat ogre, massive belly, tiny head, huge wooden club, dumb expression, ${STYLE}`,
   1.6],
  ["mob_minotaur.glb",
   `minotaur, bull head, massive muscular humanoid body, giant battle axe, ${STYLE}`,
   1.5],
  ["mob_wyvern.glb",
   `wyvern, bat-like wings, spiked tail, no front legs, flying pose, ${STYLE}`,
   1.8],
  ["mob_centaur.glb",
   `centaur archer, horse body human torso, holding bow, noble warrior, ${STYLE}`,
   1.4],
  ["mob_gargoyle.glb",
   `stone gargoyle, bat wings, perched pose, demonic face, cracked stone texture, ${STYLE}`,
   1.1],

  // ═══════════════════════════════════════════════════════════════════════
  // BOSSES — P0 (unique high-detail)
  // ═══════════════════════════════════════════════════════════════════════

  ["boss_drake.glb",
   `majestic sky dragon, white and gold scales, lightning breath, massive wings spread, royal, ${STYLE}`,
   2.0],
  ["boss_grom.glb",
   `ancient massive tree guardian, treant elder, glowing green rune core in chest, towering, ${STYLE}`,
   2.5],
  ["boss_titan.glb",
   `frost titan giant, ice crystal armor, mountainous, avalanche fists, cold mist, ${STYLE}`,
   2.5],
  ["boss_archdruid.glb",
   `corrupted archdruid, deer antlers growing from head, moonlight aura, half-transformed beast, ${STYLE}`,
   1.8],
  ["boss_infernal.glb",
   `forge demon, molten lava veins across body, giant flaming hammer, dark iron armor, ${STYLE}`,
   2.2],
  ["boss_solaris.glb",
   `solar angel guardian, radiant golden wings, holy sword, blinding light halo, divine armor, ${STYLE}`,
   2.0],
  ["boss_dragon.glb",
   `massive crystal dragon, azure blue scales, gem-encrusted body, crystalline breath, final boss, ${STYLE}`,
   3.0],

  // ═══════════════════════════════════════════════════════════════════════
  // CRAFTING STATIONS — P0 (replace colored boxes)
  // ═══════════════════════════════════════════════════════════════════════

  ["station_forge.glb",
   `blacksmith forge station, glowing hot coals, bellows, anvil, sparks flying, medieval, ${STYLE}`,
   1.0],
  ["station_alchemy_lab.glb",
   `alchemy lab table, bubbling colorful flasks, tubes, distillation equipment, magical, ${STYLE}`,
   0.8],
  ["station_enchanting_altar.glb",
   `enchanting altar, floating runes, purple glowing crystal, arcane magic circle on ground, ${STYLE}`,
   1.0],
  ["station_cooking_fire.glb",
   `cooking campfire, iron cooking pot hanging over fire, stone ring, logs, steam rising, ${STYLE}`,
   0.7],
  ["station_tanning_rack.glb",
   `leather tanning rack, wooden frame with stretched animal hide, tools hanging, ${STYLE}`,
   0.8],
  ["station_jewelers_bench.glb",
   `jeweler workbench, magnifying lens, uncut gems, tiny tools, candle light, ${STYLE}`,
   0.7],
  ["station_essence_forge.glb",
   `magical essence forge, swirling energy vortex, crystal core floating, arcane conduits, ${STYLE}`,
   1.0],

  // ═══════════════════════════════════════════════════════════════════════
  // RESOURCE NODES — P0 (replace dodecahedrons)
  // ═══════════════════════════════════════════════════════════════════════

  ["node_copper_ore.glb",
   `copper ore vein, orange-brown metallic chunks in grey rock, mining node, ${STYLE}`,
   0.6],
  ["node_tin_ore.glb",
   `tin ore deposit, silver-grey crystalline chunks in rock formation, ${STYLE}`,
   0.6],
  ["node_silver_ore.glb",
   `silver ore vein, shimmering silver crystals in dark rock, glowing faintly, ${STYLE}`,
   0.6],
  ["node_gold_ore.glb",
   `gold ore vein, glittering golden chunks in quartz rock, rich and valuable, ${STYLE}`,
   0.7],
  ["node_coal.glb",
   `coal deposit, dark black chunks in cracked rock, dusty, mining node, ${STYLE}`,
   0.5],
  ["node_herb_meadow_lily.glb",
   `cluster of white meadow lilies, delicate petals with dewdrops, harvestable herb, ${STYLE}`,
   0.4],
  ["node_herb_wild_rose.glb",
   `wild rose bush, pink blooming roses, thorny stems, harvestable herb node, ${STYLE}`,
   0.5],
  ["node_herb_moonflower.glb",
   `magical moonflower, glowing silvery petals, ethereal light, night-blooming, ${STYLE}`,
   0.4],
  ["node_herb_starbloom.glb",
   `starbloom flower, star-shaped petals, sparkling with magical energy, rare herb, ${STYLE}`,
   0.4],
  ["node_herb_dragons_breath.glb",
   `dragon's breath plant, fiery red leaves, smoldering embers, rare herb, ${STYLE}`,
   0.5],
  ["node_gem_rough.glb",
   `rough gemstone cluster, uncut crystals of various colors in rock matrix, sparkling, ${STYLE}`,
   0.5],
];

// ── API helpers ──────────────────────────────────────────────────────────

function headers(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${API_KEY}`,
  };
}

async function submitTask(prompt: string): Promise<string> {
  const res = await fetch(`${API_BASE}/task`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      type: "text_to_model",
      prompt,
      model_version: "v2.0-20240919",
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Submit failed (${res.status}): ${text}`);
  }
  const json = await res.json();
  if (json.code !== 0) throw new Error(`API error: ${JSON.stringify(json)}`);
  return json.data.task_id;
}

async function pollTask(taskId: string): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < MAX_POLL_TIME) {
    const res = await fetch(`${API_BASE}/task/${taskId}`, { headers: headers() });
    if (!res.ok) throw new Error(`Poll failed (${res.status})`);
    const json = await res.json();
    const task = json.data;

    if (task.status === "success") {
      const url = task.output?.pbr_model ?? task.output?.model ?? task.output?.base_model;
      if (!url) throw new Error(`No model URL in task ${taskId}`);
      return url;
    }
    if (task.status === "failed" || task.status === "cancelled") {
      throw new Error(`Task ${taskId} ${task.status}`);
    }

    process.stdout.write(`  ${taskId} — ${task.status} (${task.progress}%)     \r`);
    await new Promise((r) => setTimeout(r, POLL_INTERVAL));
  }
  throw new Error(`Task ${taskId} timed out`);
}

async function downloadGlb(url: string, outPath: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(outPath, buf);
}

// ── Main ─────────────────────────────────────────────────────────────────

async function generateOne(filename: string, prompt: string): Promise<boolean> {
  const outPath = path.join(OUT_DIR, filename);

  if (fs.existsSync(outPath)) {
    console.log(`  SKIP  ${filename} (already exists)`);
    return true;
  }

  console.log(`  START ${filename}`);
  try {
    const taskId = await submitTask(prompt);
    const modelUrl = await pollTask(taskId);
    await downloadGlb(modelUrl, outPath);
    const sizeKb = (fs.statSync(outPath).size / 1024).toFixed(0);
    console.log(`  DONE  ${filename} (${sizeKb} KB)`);
    return true;
  } catch (err: any) {
    console.error(`  FAIL  ${filename}: ${err.message}`);
    return false;
  }
}

async function main() {
  const total = ASSETS.length;
  const alreadyDone = ASSETS.filter(([f]) => fs.existsSync(path.join(OUT_DIR, f))).length;

  console.log(`\n╔══════════════════════════════════════════════════════╗`);
  console.log(`║  WoG P0 Asset Generator — Slow Background Mode      ║`);
  console.log(`╠══════════════════════════════════════════════════════╣`);
  console.log(`║  Total assets:    ${String(total).padStart(4)}                              ║`);
  console.log(`║  Already done:    ${String(alreadyDone).padStart(4)}                              ║`);
  console.log(`║  Remaining:       ${String(total - alreadyDone).padStart(4)}                              ║`);
  console.log(`║  Concurrency:     ${String(MAX_CONCURRENT).padStart(4)}                              ║`);
  console.log(`║  Batch delay:     ${String(DELAY_BETWEEN_BATCHES / 1000).padStart(4)}s                             ║`);
  console.log(`║  Output: ${OUT_DIR.padEnd(42)} ║`);
  console.log(`╚══════════════════════════════════════════════════════╝\n`);

  fs.mkdirSync(OUT_DIR, { recursive: true });

  const queue = [...ASSETS];
  let completed = alreadyDone;
  let succeeded = alreadyDone;
  let failed = 0;
  const failedNames: string[] = [];
  const startTime = Date.now();

  while (queue.length > 0) {
    const batch = queue.splice(0, MAX_CONCURRENT);
    const results = await Promise.allSettled(
      batch.map(([filename, prompt]) => generateOne(filename, prompt)),
    );

    for (let i = 0; i < results.length; i++) {
      completed++;
      const result = results[i];
      if (result.status === "fulfilled" && result.value) {
        succeeded++;
      } else {
        failed++;
        failedNames.push(batch[i][0]);
      }
    }

    const elapsed = ((Date.now() - startTime) / 60_000).toFixed(1);
    const remaining = total - completed;
    const avgPerModel = completed > alreadyDone
      ? (Date.now() - startTime) / (completed - alreadyDone) / 60_000
      : 2;
    const eta = (remaining * avgPerModel).toFixed(0);

    console.log(`\n  ── Progress: ${completed}/${total} | OK: ${succeeded} | FAIL: ${failed} | ETA: ~${eta}min | Elapsed: ${elapsed}min ──\n`);

    // Gentle delay between batches
    if (queue.length > 0) {
      console.log(`  Waiting ${DELAY_BETWEEN_BATCHES / 1000}s before next batch...`);
      await new Promise((r) => setTimeout(r, DELAY_BETWEEN_BATCHES));
    }
  }

  // Update manifest
  const allFiles = fs.readdirSync(OUT_DIR).filter((f) => f.endsWith(".glb"));
  const manifest = allFiles.map((f) => {
    const entry = ASSETS.find(([name]) => name === f);
    return {
      file: f,
      name: f.replace(".glb", ""),
      scale: entry ? entry[2] : 1.0,
    };
  });
  fs.writeFileSync(path.join(OUT_DIR, "manifest.json"), JSON.stringify(manifest, null, 2));

  console.log(`\n╔══════════════════════════════════════════════════════╗`);
  console.log(`║  COMPLETE                                            ║`);
  console.log(`║  Succeeded: ${String(succeeded).padStart(4)} / ${String(total).padEnd(37)}║`);
  console.log(`║  Failed:    ${String(failed).padStart(4)}                                    ║`);
  console.log(`╚══════════════════════════════════════════════════════╝`);

  if (failedNames.length > 0) {
    console.log(`\n  Failed assets: ${failedNames.join(", ")}`);
    console.log(`  Re-run to retry (existing files are skipped).\n`);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
