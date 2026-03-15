#!/usr/bin/env npx tsx
/**
 * Generate reusable environment 3D models via Tripo3D API.
 *
 * Usage:
 *   npx tsx src/tools/generate-environment-models.ts
 *
 * Requires VITE_TRIPO_API_KEY in .env (or pass as first CLI arg).
 * Models are saved to public/models/environment/*.glb
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");

// Read .env manually (no dotenv dep needed)
try {
  const envFile = fs.readFileSync(path.join(ROOT, ".env"), "utf-8");
  for (const line of envFile.split("\n")) {
    const match = line.match(/^\s*([\w]+)\s*=\s*(.+?)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
  }
} catch { /* no .env file */ }

const API_BASE = "https://api.tripo3d.ai/v2/openapi";
const POLL_INTERVAL = 3_000;
const MAX_POLL_TIME = 300_000;
const API_KEY = process.argv[2] || process.env.VITE_TRIPO_API_KEY || "";
const OUT_DIR = path.join(ROOT, "assets-source");

// ── Concurrency control ─────────────────────────────────────────────────
const MAX_CONCURRENT = 3; // Tripo rate-limits, keep this conservative

if (!API_KEY) {
  console.error("ERROR: No Tripo API key. Set VITE_TRIPO_API_KEY in .env or pass as arg.");
  process.exit(1);
}

// ── Asset definitions ───────────────────────────────────────────────────
// Each entry: [filename, prompt, scale]
// Prompts are tuned for low-poly stylized MMORPG environment pieces.

const ASSETS: [string, string, number][] = [
  // ── Trees ──
  ["oak_tree.glb",
   "low-poly stylized oak tree, broad green canopy, thick brown trunk, fantasy MMORPG style, single game asset on blank background",
   1.0],
  ["pine_tree.glb",
   "low-poly stylized pine tree, tall conifer with dark green needles, fantasy RPG style, single game asset on blank background",
   1.0],
  ["dead_tree.glb",
   "low-poly dead tree, leafless gnarly branches, dark bark, spooky fantasy style, single game asset on blank background",
   1.0],
  ["tree_stump.glb",
   "low-poly chopped tree stump with visible rings, mossy, fantasy RPG style, single game asset on blank background",
   0.5],

  // ── Rocks ──
  ["boulder.glb",
   "low-poly large grey boulder, mossy cracks, stylized fantasy RPG style, single game asset on blank background",
   1.0],
  ["rock_cluster.glb",
   "low-poly cluster of 3-4 small grey rocks, stylized fantasy RPG game prop, single asset on blank background",
   0.6],
  ["cliff_face.glb",
   "low-poly vertical cliff rock wall segment, layered stone, stylized fantasy RPG, single modular piece on blank background",
   1.5],

  // ── Vegetation ──
  ["bush.glb",
   "low-poly green leafy bush shrub, round shape, stylized fantasy MMORPG style, single game asset on blank background",
   0.5],
  ["tall_grass.glb",
   "low-poly clump of tall wild grass, green and yellow blades, fantasy RPG style, single game asset on blank background",
   0.4],
  ["flower_patch.glb",
   "low-poly patch of colorful wildflowers, red yellow purple, fantasy RPG style, single game asset on blank background",
   0.4],
  ["reeds.glb",
   "low-poly cattails and reeds, swamp water plant, stylized fantasy RPG, single game asset on blank background",
   0.5],

  // ── Structures ──
  ["stone_wall.glb",
   "low-poly modular stone wall segment, medieval fantasy style, 1 meter wide, single game asset on blank background",
   1.0],
  ["wooden_fence.glb",
   "low-poly wooden plank fence segment, rustic medieval fantasy, single modular piece on blank background",
   0.8],
  ["wooden_door.glb",
   "low-poly medieval wooden door with stone archway frame, fantasy RPG style, single game asset on blank background",
   1.0],
  ["roof_thatch.glb",
   "low-poly thatched roof section, angled medieval cottage roof piece, fantasy RPG style, single asset on blank background",
   1.0],
  ["torch.glb",
   "low-poly wall-mounted torch with flame, medieval fantasy RPG style, single game asset on blank background",
   0.4],
  ["well.glb",
   "low-poly medieval stone water well with wooden bucket and rope, fantasy RPG village prop, single asset on blank background",
   0.7],
  ["crate.glb",
   "low-poly wooden storage crate box, nailed planks, medieval fantasy RPG style, single game asset on blank background",
   0.4],
  ["barrel.glb",
   "low-poly wooden barrel with metal bands, medieval fantasy RPG style, single game asset on blank background",
   0.4],
  ["market_stall.glb",
   "low-poly medieval market stall with fabric canopy and wooden counter, fantasy RPG style, single game asset on blank background",
   0.8],

  // ── World props ──
  ["bridge.glb",
   "low-poly wooden plank bridge segment, rope rails, fantasy RPG style, single modular piece on blank background",
   1.0],
  ["signpost.glb",
   "low-poly wooden signpost with two arrow signs pointing different directions, fantasy RPG style, single game asset on blank background",
   0.5],
  ["campfire.glb",
   "low-poly campfire with stacked logs and stones in a ring, fantasy RPG style, single game asset on blank background",
   0.5],
  ["dock.glb",
   "low-poly wooden dock pier segment with posts, fantasy RPG waterfront, single modular piece on blank background",
   1.0],
  ["portal_frame.glb",
   "low-poly magical stone archway portal with glowing runes, fantasy RPG style, single game asset on blank background",
   1.2],
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
      // Tripo v2 API returns model URL under output.pbr_model (not output.model)
      const url = task.output?.pbr_model ?? task.output?.model ?? task.output?.base_model;
      if (!url) throw new Error(`No model URL in task ${taskId}. Output keys: ${JSON.stringify(Object.keys(task.output ?? {}))}`);
      return url;
    }
    if (task.status === "failed" || task.status === "cancelled") {
      throw new Error(`Task ${taskId} ${task.status}`);
    }

    process.stdout.write(`  ${taskId} — ${task.status} (${task.progress}%)\r`);
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

async function generateOne(filename: string, prompt: string): Promise<void> {
  const outPath = path.join(OUT_DIR, filename);

  // Skip if already generated
  if (fs.existsSync(outPath)) {
    console.log(`  SKIP  ${filename} (already exists)`);
    return;
  }

  console.log(`  START ${filename}`);
  const taskId = await submitTask(prompt);
  const modelUrl = await pollTask(taskId);
  await downloadGlb(modelUrl, outPath);
  const sizeKb = (fs.statSync(outPath).size / 1024).toFixed(0);
  console.log(`  DONE  ${filename} (${sizeKb} KB)`);
}

async function main() {
  console.log(`\nGenerating ${ASSETS.length} environment models via Tripo3D\n`);
  console.log(`   Output: ${OUT_DIR}`);
  console.log(`   Concurrency: ${MAX_CONCURRENT}\n`);

  fs.mkdirSync(OUT_DIR, { recursive: true });

  // Process in batches of MAX_CONCURRENT
  const queue = [...ASSETS];
  let completed = 0;
  const failed: string[] = [];

  while (queue.length > 0) {
    const batch = queue.splice(0, MAX_CONCURRENT);
    const results = await Promise.allSettled(
      batch.map(([filename, prompt]) => generateOne(filename, prompt)),
    );

    for (let i = 0; i < results.length; i++) {
      completed++;
      if (results[i].status === "rejected") {
        const name = batch[i][0];
        const reason = (results[i] as PromiseRejectedResult).reason;
        console.error(`  FAIL  ${name}: ${reason}`);
        failed.push(name);
      }
    }
    console.log(`\n  Progress: ${completed}/${ASSETS.length}\n`);
  }

  // Write manifest for the loader
  const manifest = ASSETS.map(([filename, , scale]) => ({
    file: filename,
    name: filename.replace(".glb", ""),
    scale,
  }));
  const manifestPath = path.join(OUT_DIR, "manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`\n  Wrote manifest: ${manifestPath}`);

  if (failed.length > 0) {
    console.log(`\n  Failed (${failed.length}): ${failed.join(", ")}`);
    console.log(`  Re-run the script to retry failed assets (existing ones are skipped).`);
  }

  console.log(`\n  Done! ${ASSETS.length - failed.length}/${ASSETS.length} models generated.\n`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
