#!/usr/bin/env npx tsx
/**
 * Mine ore → Craft weapons → List on Auction House
 *
 * Usage:
 *   npx tsx scripts/mine-craft-sell.ts
 *
 * Env:
 *   SHARD_URL        — shard base URL (default: https://wog.urbantech.dev)
 *   JWT              — Bearer token
 *   WALLET_ADDRESS   — player wallet
 *   ENTITY_ID        — player entity ID
 *   ZONE_ID          — starting zone (default: village-square)
 */

const SHARD = process.env.SHARD_URL ?? "https://wog.urbantech.dev";
const JWT = process.env.JWT!;
const WALLET = process.env.WALLET_ADDRESS!;
const ENTITY = process.env.ENTITY_ID!;
const ZONE = process.env.ZONE_ID ?? "village-square";

if (!JWT || !WALLET || !ENTITY) {
  console.error(
    "Missing env vars. Set JWT, WALLET_ADDRESS, and ENTITY_ID.\n" +
      "Example:\n" +
      '  JWT="eyJ..." WALLET_ADDRESS="0x..." ENTITY_ID="abc-123" npx tsx scripts/mine-craft-sell.ts'
  );
  process.exit(1);
}

const AUTH = { Authorization: `Bearer ${JWT}`, "Content-Type": "application/json" };
const STONE_PICKAXE_TOKEN = 27;

// ── Helpers ──────────────────────────────────────────────────────────

async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const url = `${SHARD}${path}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        method,
        headers: AUTH,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (res.status === 503 || res.status === 502) {
        console.log(`  ⏳ Server unavailable (${res.status}), retrying in 10s...`);
        await sleep(10000);
        continue;
      }
      const text = await res.text();
      let json: any;
      try {
        json = JSON.parse(text);
      } catch {
        // Server returned HTML or non-JSON (e.g. error page)
        if (attempt < 2) {
          console.log(`  ⏳ Non-JSON response, retrying in 10s...`);
          await sleep(10000);
          continue;
        }
        throw new Error(`${method} ${path} → ${res.status}: non-JSON response`);
      }
      if (!res.ok) {
        throw new Error(`${method} ${path} → ${res.status}: ${JSON.stringify(json)}`);
      }
      return json as T;
    } catch (err: any) {
      if (attempt < 2 && (err.message.includes("503") || err.message.includes("502") || err.message.includes("ECONNREFUSED") || err.message.includes("non-JSON"))) {
        console.log(`  ⏳ Connection error, retrying in 10s...`);
        await sleep(10000);
        continue;
      }
      throw err;
    }
  }
  throw new Error(`${method} ${path} → failed after 3 retries`);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Types ────────────────────────────────────────────────────────────

interface Entity {
  id: string;
  type: string;
  name?: string;
  x: number;
  y: number;
  oreType?: string;
  charges?: number;
  [k: string]: any;
}

interface Recipe {
  recipeId: string;
  output: { tokenId: string; name: string; quantity: number };
  materials: { tokenId: string; name: string; quantity: number }[];
  copperCost: number;
  requiredProfession: string;
  requiredSkillLevel: number;
}

interface InventoryItem {
  tokenId: number;
  name: string;
  quantity: number;
  category?: string;
  equipSlot?: string | null;
  instances?: { instanceId: string; displayName: string }[] | null;
  [k: string]: any;
}

// ── Scan zone ───────────────────────────────────────────────────────

async function scanZone(zoneId: string) {
  const zone = await api<any>("GET", `/zones/${zoneId}`);
  const entitiesMap: Record<string, Entity> = zone.entities ?? {};
  const entities = Object.values(entitiesMap);

  return {
    entities,
    oreNodes: entities.filter((e) => e.type === "ore-node"),
    forges: entities.filter((e) => e.type === "forge"),
    auctioneers: entities.filter((e) => e.type === "auctioneer"),
    professionTrainers: entities.filter((e) => e.type === "profession-trainer"),
    merchants: entities.filter((e) => e.type === "merchant"),
  };
}

// ── Move and wait until within range ────────────────────────────────

async function moveTo(zoneId: string, x: number, y: number, label?: string, range = 40) {
  console.log(`  → Moving to ${label ?? `(${x}, ${y})`}...`);

  // Try up to 2 move commands (character may get stuck in combat with a mob)
  for (let moveAttempt = 0; moveAttempt < 2; moveAttempt++) {
    await api("POST", "/command", { zoneId, entityId: ENTITY, action: "move", x, y });

    for (let poll = 0; poll < 20; poll++) {
      await sleep(1000);
      const zone = await api<any>("GET", `/zones/${zoneId}`);
      const me = zone.entities?.[ENTITY];
      if (!me) continue;
      const dx = me.x - x;
      const dy = me.y - y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist <= range) {
        console.log(`  ✓ Arrived (dist: ${Math.round(dist)})`);
        return;
      }
    }

    if (moveAttempt === 0) {
      console.log(`  ⏳ Re-issuing move (may have been interrupted by combat)...`);
    }
  }
  console.log(`  ⚠ Timed out waiting to arrive — continuing anyway`);
}

// ── Learn a profession from a trainer ───────────────────────────────

async function learnProfession(
  zoneId: string,
  trainerId: string,
  professionId: string,
  trainerName: string
) {
  try {
    console.log(`  📖 Learning ${professionId} from ${trainerName}...`);
    await api("POST", "/professions/learn", {
      walletAddress: WALLET,
      zoneId,
      entityId: ENTITY,
      trainerId,
      professionId,
    });
    console.log(`  ✓  Learned ${professionId}!`);
    return true;
  } catch (err: any) {
    if (err.message.includes("already learned")) {
      console.log(`  ✓  Already know ${professionId}`);
      return true;
    }
    console.warn(`  ✗  Could not learn ${professionId}: ${err.message}`);
    return false;
  }
}

// ── Buy and equip a pickaxe ─────────────────────────────────────────

async function buyPickaxe(zoneId: string, merchants: Entity[]): Promise<boolean> {
  const merchant = merchants[0];
  if (!merchant) {
    console.log("  ⚠  No merchant in zone!");
    return false;
  }

  await moveTo(zoneId, merchant.x, merchant.y, merchant.name);

  try {
    console.log("  🛒 Buying Stone Pickaxe (30 gold)...");
    await api("POST", "/shop/buy", {
      buyerAddress: WALLET,
      tokenId: STONE_PICKAXE_TOKEN,
      quantity: 1,
      merchantEntityId: merchant.id,
    });
    console.log("  ✓  Purchased! Waiting for chain confirmation...");
    await sleep(8000);
  } catch (err: any) {
    console.warn(`  ✗  Could not buy pickaxe: ${err.message}`);
    return false;
  }

  return await equipPickaxe(zoneId);
}

async function equipPickaxe(zoneId: string): Promise<boolean> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      console.log(`  🔧 Equipping Stone Pickaxe (attempt ${attempt + 1})...`);
      await api("POST", "/equipment/equip", {
        zoneId,
        tokenId: STONE_PICKAXE_TOKEN,
        entityId: ENTITY,
        walletAddress: WALLET,
      });
      console.log("  ✓  Equipped!");
      return true;
    } catch (err: any) {
      if (err.message.includes("already equipped")) {
        console.log("  ✓  Already equipped");
        return true;
      }
      if (attempt < 4) {
        console.log(`  ⏳ Waiting for mint... (${err.message.includes("does not own") ? "chain pending" : err.message})`);
        await sleep(5000);
      }
    }
  }
  console.warn("  ✗  Could not equip pickaxe after retries");
  return false;
}

async function ensurePickaxeEquipped(zoneId: string, merchants: Entity[]): Promise<boolean> {
  const inv = await getInventory();
  const pickaxe = inv.find((i) => i.tokenId === STONE_PICKAXE_TOKEN);

  if (pickaxe && pickaxe.quantity > 0) {
    // Have one in inventory — just equip it
    return await equipPickaxe(zoneId);
  }

  // Need to buy a new one
  console.log("  ⛏ Pickaxe broken or missing — buying a new one...");
  return await buyPickaxe(zoneId, merchants);
}

// ── Mine a single node (returns "ok" | "broken" | "skip") ──────────

type MineResult = "ok" | "broken" | "skip";

async function mineNode(zoneId: string, node: Entity): Promise<MineResult> {
  try {
    const result = await api("POST", "/mining/gather", {
      walletAddress: WALLET,
      zoneId,
      entityId: ENTITY,
      oreNodeId: node.id,
    });
    const msg = result.message ?? result.oreName ?? JSON.stringify(result).slice(0, 100);
    if (result.ok === false || (typeof msg === "string" && msg.includes("crumbled"))) {
      console.log(`     ~ Miss (ore crumbled)`);
      return "ok";
    }
    console.log(`     ✓ Got ${result.oreName ?? node.oreType} (${result.chargesRemaining ?? "?"} left)`);
    return "ok";
  } catch (err: any) {
    const errStr = err.message;
    if (errStr.includes("No pickaxe") || errStr.includes("pickaxe broken")) {
      console.log(`     ⛏ Pickaxe broke!`);
      return "broken";
    }
    if (errStr.includes("skill too low") || errStr.includes("Pickaxe tier too low")) {
      console.log(`     ⏭ ${errStr.includes("skill") ? "Skill too low" : "Pickaxe too weak"}`);
      return "skip";
    }
    if (errStr.includes("depleted") || errStr.includes("charges")) {
      console.log(`     ⏭ Depleted`);
      return "skip";
    }
    if (errStr.includes("Out of range")) {
      console.log(`     ⏭ Out of range`);
      return "skip";
    }
    if (errStr.includes("cooldown")) {
      await sleep(5500);
      return await mineNode(zoneId, node);
    }
    console.warn(`     ✗ ${errStr}`);
    return "skip";
  }
}

// ── Mine all available nodes (auto-rebuys pickaxe when it breaks) ───

async function mineAllAvailable(zoneId: string, merchants: Entity[]): Promise<number> {
  let totalMined = 0;

  for (let round = 0; round < 3; round++) {
    const { oreNodes } = await scanZone(zoneId);
    const mineable = oreNodes.filter((n) => (n.charges ?? 0) > 0);

    if (mineable.length === 0) {
      if (round === 0) {
        console.log("  All nodes depleted. Waiting 60s for respawn...");
        await sleep(60000);
        continue;
      }
      break;
    }

    for (const node of mineable) {
      console.log(`  → ${node.name} (${node.oreType}) at (${node.x},${node.y}) [${node.charges} charges]`);
      await moveTo(zoneId, node.x, node.y, node.name);

      const charges = node.charges ?? 1;
      for (let i = 0; i < charges; i++) {
        console.log(`  ⛏  Mining [${i + 1}/${charges}]...`);
        const result = await mineNode(zoneId, node);

        if (result === "broken") {
          // Auto-rebuy and re-equip, then retry this charge
          const fixed = await ensurePickaxeEquipped(zoneId, merchants);
          if (!fixed) {
            console.log("  ✗ Cannot continue mining without a pickaxe.");
            return totalMined;
          }
          // Move back to the node after visiting merchant
          await moveTo(zoneId, node.x, node.y, node.name);
          console.log(`  ⛏  Retrying [${i + 1}/${charges}]...`);
          const retry = await mineNode(zoneId, node);
          if (retry === "ok") totalMined++;
          else if (retry === "broken") {
            // Broke again immediately — stop to avoid infinite loop
            console.log("  ⚠ Pickaxe broke again immediately. Moving on.");
            break;
          }
        } else if (result === "ok") {
          totalMined++;
        } else {
          break; // skip = move to next node
        }

        await sleep(5500); // 5s gather cooldown
      }
    }
  }

  return totalMined;
}

// ── Check inventory ─────────────────────────────────────────────────

async function getInventory(): Promise<InventoryItem[]> {
  const inv = await api<any>("GET", `/inventory/${WALLET}`);
  return inv.items ?? [];
}

// ── Craft weapons ────────────────────────────────────────────────────

const WEAPON_PATTERN = /sword|longsword|axe|bow|dagger|staff|mace|hammer|blade|spear|shield|whip/i;

async function getWeaponRecipes(): Promise<Recipe[]> {
  const recipes = await api<Recipe[]>("GET", "/crafting/recipes");
  // Include weapons, shields, and armor — anything craftable that's not a raw bar/smelt
  return recipes.filter((r) => {
    const name = r.output?.name ?? "";
    return WEAPON_PATTERN.test(name) || r.recipeId === "oak-shield" || r.recipeId === "chainmail-shirt" || r.recipeId === "iron-greaves";
  });
}

async function craftWeapons(zoneId: string, forgeId: string, recipes: Recipe[], inventory: InventoryItem[]) {
  const crafted: string[] = [];
  const ownedMap = new Map<string, number>();
  for (const item of inventory) {
    const key = String(item.tokenId);
    ownedMap.set(key, (ownedMap.get(key) ?? 0) + (item.quantity ?? 0));
  }

  const sorted = [...recipes].sort((a, b) => a.requiredSkillLevel - b.requiredSkillLevel);

  for (const recipe of sorted) {
    const canCraft = recipe.materials.every(
      (mat) => (ownedMap.get(String(mat.tokenId)) ?? 0) >= mat.quantity
    );
    if (!canCraft) {
      const missing = recipe.materials
        .filter((m) => (ownedMap.get(String(m.tokenId)) ?? 0) < m.quantity)
        .map((m) => `${m.name} (need ${m.quantity}, have ${ownedMap.get(String(m.tokenId)) ?? 0})`);
      console.log(`  ⏭  ${recipe.output.name} — missing: ${missing.join(", ")}`);
      continue;
    }

    // Retry craft: up to 5 attempts for RNG misses, 3 for chain errors
    let craftSuccess = false;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        console.log(`  🔨 Crafting ${recipe.output.name}${attempt > 0 ? ` (attempt ${attempt + 1})` : ""}...`);
        const result = await api("POST", "/crafting/forge", {
          walletAddress: WALLET,
          zoneId,
          entityId: ENTITY,
          forgeId,
          recipeId: recipe.recipeId,
        });

        // RNG miss: "metal warped" — no materials lost, try again
        if (result.ok === false || result.failed) {
          console.log(`  ~ Forge miss: ${result.message ?? "failed"} (retrying...)`);
          await sleep(1000);
          continue;
        }

        console.log(`  ✓  Crafted ${recipe.output.name}!`);
        crafted.push(recipe.output.name);

        for (const mat of recipe.materials) {
          const key = String(mat.tokenId);
          ownedMap.set(key, (ownedMap.get(key) ?? 0) - mat.quantity);
        }
        craftSuccess = true;
        // Wait for chain to settle before next craft
        await sleep(8000);
        break;
      } catch (err: any) {
        const isChainError = err.message.includes("not owner nor approved") || err.message.includes("consume materials");
        if (isChainError && attempt < 2) {
          console.log(`  ⏳ Chain not ready, waiting 10s...`);
          await sleep(10000);
        } else {
          console.warn(`  ✗  ${recipe.output.name}: ${err.message}`);
          break;
        }
      }
    }
  }
  return crafted;
}

// ── List on auction house ────────────────────────────────────────────

async function listOnAuction(zoneId: string, items: InventoryItem[]) {
  const listed: string[] = [];

  const sellable = items.filter((i) => {
    if (i.quantity <= 0) return false;
    if (i.equipped) return false;
    if (i.category === "tool") return false;
    if (i.category === "material") return false;
    return (
      i.category === "weapon" ||
      i.category === "armor" ||
      i.equipSlot === "mainHand" ||
      i.equipSlot === "offHand" ||
      WEAPON_PATTERN.test(i.name ?? "")
    );
  });

  if (sellable.length === 0) {
    console.log("  No weapons in inventory to list.");
    return listed;
  }

  for (const item of sellable) {
    try {
      const startPrice = 50;
      const buyoutPrice = 250;
      const durationMinutes = 60;

      const instanceId = item.instances?.[0]?.instanceId;
      const label = item.instances?.[0]?.displayName ?? item.name;

      console.log(`  📦 Listing ${label} (token #${item.tokenId}) — start ${startPrice}g, buyout ${buyoutPrice}g, ${durationMinutes}min`);
      const result = await api("POST", `/auctionhouse/${zoneId}/create`, {
        sellerAddress: WALLET,
        tokenId: item.tokenId,
        quantity: 1,
        startPrice,
        durationMinutes,
        buyoutPrice,
        ...(instanceId ? { instanceId } : {}),
      });
      console.log(`  ✓  Listed! Auction ID: ${(result as any).auctionId ?? JSON.stringify(result).slice(0, 100)}`);
      listed.push(label);
      await sleep(300);
    } catch (err: any) {
      console.warn(`  ✗  Failed to list ${item.name}: ${err.message}`);
    }
  }
  return listed;
}

// ── Main ─────────────────────────────────────────────────────────────

async function run() {
  console.log("═══════════════════════════════════════════");
  console.log("  Mine → Craft → Sell   |   World of Geneva");
  console.log("═══════════════════════════════════════════\n");
  console.log(`Zone: ${ZONE}  |  Wallet: ${WALLET.slice(0, 10)}...`);
  console.log();

  // 1. Scan zone
  console.log("[1/8] Scanning zone...");
  const { oreNodes, forges, auctioneers, professionTrainers, merchants } = await scanZone(ZONE);
  console.log(`  ${oreNodes.length} ore nodes, ${forges.length} forges, ${auctioneers.length} auctioneers, ${merchants.length} merchants`);
  for (const n of oreNodes) console.log(`    ore: ${n.name} (${n.oreType}) at (${n.x},${n.y}) [${n.charges} charges]`);
  console.log();

  // 2. Learn mining + blacksmithing
  console.log("[2/8] Learning professions...");
  const miningTrainer = professionTrainers.find(
    (t) => (t.name ?? "").toLowerCase().includes("miner") || (t.name ?? "").toLowerCase().includes("mining")
  );
  const smithTrainer = professionTrainers.find(
    (t) => (t.name ?? "").toLowerCase().includes("smith") || (t.name ?? "").toLowerCase().includes("blacksmith")
  );

  if (miningTrainer) {
    await moveTo(ZONE, miningTrainer.x, miningTrainer.y, miningTrainer.name);
    await learnProfession(ZONE, miningTrainer.id, "mining", miningTrainer.name!);
  } else {
    console.log("  ⚠  No mining trainer found!");
  }

  if (smithTrainer) {
    await moveTo(ZONE, smithTrainer.x, smithTrainer.y, smithTrainer.name);
    await learnProfession(ZONE, smithTrainer.id, "blacksmithing", smithTrainer.name!);
  } else {
    console.log("  ⚠  No blacksmithing trainer found!");
  }
  console.log();

  // 3. Buy and equip pickaxe
  console.log("[3/8] Acquiring pickaxe...");
  const hasPickaxe = await ensurePickaxeEquipped(ZONE, merchants);
  if (!hasPickaxe) {
    // Try buying fresh
    const bought = await buyPickaxe(ZONE, merchants);
    if (!bought) {
      console.log("  Cannot mine without a pickaxe. Aborting.\n");
      return;
    }
  }
  console.log();

  // 4. Mine all ore (auto-rebuys pickaxe when it breaks)
  if (oreNodes.length === 0) {
    console.log("No ore nodes in this zone. Try ZONE_ID=wild-meadow");
    return;
  }
  console.log("[4/8] Mining ore (will auto-rebuy pickaxe if it breaks)...");
  const mined = await mineAllAvailable(ZONE, merchants);
  console.log(`  Total successful mines: ${mined}\n`);

  // 5. Check inventory
  console.log("[5/8] Checking inventory...");
  let items = await getInventory();
  if (items.length === 0) {
    console.log("  Inventory empty.\n");
  } else {
    for (const item of items) {
      console.log(`    ${item.name} x${item.quantity} [#${item.tokenId}] ${item.category ?? ""}`);
    }
    console.log();
  }

  // 6. Fetch weapon recipes
  console.log("[6/8] Fetching weapon recipes...");
  const recipes = await getWeaponRecipes();
  console.log(`  ${recipes.length} weapon recipes:`);
  for (const r of recipes.slice(0, 8)) {
    const mats = r.materials.map((m) => `${m.name} x${m.quantity}`).join(" + ");
    console.log(`    ${r.output.name} (skill ${r.requiredSkillLevel}): ${mats}`);
  }
  if (recipes.length > 8) console.log(`    ... and ${recipes.length - 8} more`);
  console.log();

  // 7. Craft at forge
  if (forges.length > 0 && recipes.length > 0 && items.length > 0) {
    const forge = forges[0];
    console.log(`[7/8] Heading to ${forge.name} at (${forge.x},${forge.y})...`);
    await moveTo(ZONE, forge.x, forge.y, forge.name);
    const crafted = await craftWeapons(ZONE, forge.id, recipes, items);
    if (crafted.length > 0) {
      console.log(`  Crafted: ${crafted.join(", ")}\n`);
    } else {
      console.log("  Could not craft any weapons — need more materials.\n");
    }
  } else {
    console.log("[7/8] Skipping craft (no forge, recipes, or materials).\n");
  }

  // 8. List on auction house
  if (auctioneers.length > 0) {
    const auc = auctioneers[0];
    console.log(`[8/8] Heading to ${auc.name} at (${auc.x},${auc.y})...`);
    await moveTo(ZONE, auc.x, auc.y, auc.name);

    items = await getInventory();
    const listed = await listOnAuction(ZONE, items);
    if (listed.length > 0) {
      console.log(`\n  Listed ${listed.length} weapons on the auction house!\n`);
    } else {
      console.log("  No weapons to list. Keep mining and crafting!\n");
    }
  } else {
    console.log("[8/8] No auctioneer in this zone.\n");
  }

  console.log("═══════════════════════════════════════════");
  console.log("  Done! Spectate at https://worldofgeneva.com");
  console.log("═══════════════════════════════════════════");
}

run().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
