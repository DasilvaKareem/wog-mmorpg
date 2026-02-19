/**
 * Agent decision-support tools.
 *
 * These are the highest-leverage tools — designed around how an AI agent
 * actually thinks about the game, not just wrapping individual HTTP endpoints.
 *
 *   get_my_status       → full situational snapshot (position, HP, level, gold, gear, quests)
 *   scan_zone           → curated zone overview sorted for agent decision-making
 *   fight_until_dead    → blocking combat — returns when mob dies or player dies
 *   grind_mobs          → fight multiple mobs in a loop with auto-heal
 *   what_can_i_craft    → cross-reference inventory vs all recipes
 *   find_mobs_for_level → recommend appropriate mobs to fight at current level
 *   get_item_details    → stat lookup for any item token ID
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { shard } from "../shard.js";
import { requireSession } from "../session.js";

// ── Shared helpers ─────────────────────────────────────────────────────────────

async function getZoneState(zoneId: string): Promise<Record<string, any>> {
  const state = await shard.get<any>("/state");
  return state?.zones?.[zoneId] ?? {};
}

async function getEntityInZone(zoneId: string, entityId: string): Promise<any | null> {
  const zone = await getZoneState(zoneId);
  const entities: Record<string, any> = zone.entities ?? {};
  return entities[entityId] ?? null;
}

function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.sqrt((ax - bx) ** 2 + (ay - by) ** 2);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

const POLL_MS = 650;
const ARRIVAL = 15;
const ATTACK_RANGE = 60;

// ── Tool registration ──────────────────────────────────────────────────────────

export function registerAgentTools(server: McpServer): void {

  // ── get_my_status ──────────────────────────────────────────────────────────

  server.registerTool(
    "get_my_status",
    {
      description:
        "Get a full situational snapshot of your character: position, HP/MP, level, XP progress, GOLD balance, equipment with durability warnings, active buffs/debuffs, and active quest names. Call this at the start of every session and whenever you need to make a decision. Much more efficient than calling /state manually.",
      inputSchema: {
        sessionId: z.string().describe("Session ID from auth_verify_signature"),
        entityId: z.string().describe("Your entity ID"),
        zoneId: z.string().describe("Your current zone ID"),
      },
    },
    async ({ sessionId, entityId, zoneId }) => {
      const { walletAddress } = requireSession(sessionId);

      const [zone, balance] = await Promise.all([
        getZoneState(zoneId),
        shard.get<any>(`/wallet/${walletAddress}/balance`).catch(() => null),
      ]);

      const entity = (zone.entities ?? {})[entityId];
      if (!entity) {
        return {
          content: [{ type: "text" as const, text: `Entity ${entityId} not found in ${zoneId}. Did you spawn?` }],
        };
      }

      // Gear condition
      const gearWarnings: string[] = [];
      const equipment = entity.equipment ?? {};
      const gearSummary: Record<string, any> = {};
      for (const [slot, item] of Object.entries<any>(equipment)) {
        const pct = item.maxDurability > 0
          ? Math.round((item.durability / item.maxDurability) * 100)
          : 100;
        gearSummary[slot] = { tokenId: item.tokenId, durabilityPct: pct, broken: item.broken ?? false };
        if (pct < 20) gearWarnings.push(`${slot} critically damaged (${pct}%)`);
        else if (pct < 50) gearWarnings.push(`${slot} damaged (${pct}%)`);
      }

      // Active effects
      const effects = (entity.activeEffects ?? []).map((e: any) => ({
        name: e.name,
        type: e.type,
        remainingTicks: e.remainingTicks,
      }));

      // Quest names
      const activeQuests = (entity.activeQuests ?? []).map((q: any) => ({
        questId: q.questId,
        progress: q.progress,
      }));

      const xpForNext = entity.level != null ? Math.pow(entity.level, 2) * 100 : null;
      const xpPct = (xpForNext && entity.xp != null)
        ? Math.round((entity.xp / xpForNext) * 100)
        : null;

      const status = {
        // Identity
        entityId,
        name: entity.name,
        level: entity.level,
        class: entity.classId,
        race: entity.raceId,
        // Position
        zone: zoneId,
        position: { x: Math.round(entity.x), y: Math.round(entity.y) },
        // Vitals
        hp: entity.hp,
        maxHp: entity.maxHp,
        hpPct: Math.round((entity.hp / entity.maxHp) * 100),
        essence: entity.essence,
        maxEssence: entity.maxEssence,
        // Progression
        xp: entity.xp,
        xpToNextLevel: xpForNext,
        xpPct,
        kills: entity.kills ?? 0,
        // Economy
        goldBalance: balance?.gold ?? "unknown",
        // Gear
        equipment: gearSummary,
        gearWarnings,
        // State
        activeEffects: effects,
        activeQuests,
        isDead: entity.hp <= 0,
        currentAction: entity.order?.action ?? "idle",
      };

      return {
        content: [{ type: "text" as const, text: JSON.stringify(status, null, 2) }],
      };
    }
  );

  // ── scan_zone ──────────────────────────────────────────────────────────────

  server.registerTool(
    "scan_zone",
    {
      description:
        "Get a curated, agent-friendly overview of the current zone. Returns: nearby mobs sorted by best XP value for your level, available resource nodes, NPCs grouped by function (merchant/quest-giver/etc.), portals with destinations, and your nearest threats. Far more useful than raw world_get_zone_state for making decisions.",
      inputSchema: {
        sessionId: z.string().describe("Session ID from auth_verify_signature"),
        entityId: z.string().describe("Your entity ID"),
        zoneId: z.string().describe("Zone to scan"),
      },
    },
    async ({ sessionId, entityId, zoneId }) => {
      requireSession(sessionId);
      const zone = await getZoneState(zoneId);
      const allEntities: any[] = Object.values(zone.entities ?? {});

      const me = allEntities.find((e) => e.id === entityId);
      const myX = me?.x ?? 320;
      const myY = me?.y ?? 320;
      const myLevel = me?.level ?? 1;

      // Mobs — sorted by "goodness" for this player level
      const mobs = allEntities
        .filter((e) => (e.type === "mob" || e.type === "boss") && e.hp > 0)
        .map((e) => {
          const d = dist(myX, myY, e.x, e.y);
          const levelDiff = Math.abs((e.level ?? 1) - myLevel);
          return {
            id: e.id,
            name: e.name,
            type: e.type,
            level: e.level,
            hp: e.hp,
            maxHp: e.maxHp,
            hpPct: Math.round((e.hp / e.maxHp) * 100),
            distance: Math.round(d),
            taggedBy: e.taggedBy ?? null,
            levelDiff,
          };
        })
        // Sort: untagged mobs at appropriate level, closest first
        .sort((a, b) => {
          const aScore = a.levelDiff * 200 + a.distance + (a.taggedBy ? 500 : 0);
          const bScore = b.levelDiff * 200 + b.distance + (b.taggedBy ? 500 : 0);
          return aScore - bScore;
        });

      // Corpses (skinnables)
      const corpses = allEntities
        .filter((e) => e.type === "corpse" && !e.skinned && e.skinnableUntil > Date.now())
        .map((e) => ({
          id: e.id,
          name: e.mobName ?? e.name,
          distance: Math.round(dist(myX, myY, e.x, e.y)),
          secondsRemaining: Math.round((e.skinnableUntil - Date.now()) / 1000),
        }));

      // NPCs by function
      const npcsByType: Record<string, any[]> = {};
      for (const e of allEntities) {
        if (["player", "mob", "boss", "ore_node", "flower_node", "corpse"].includes(e.type)) continue;
        const key = e.type;
        if (!npcsByType[key]) npcsByType[key] = [];
        npcsByType[key].push({
          id: e.id,
          name: e.name,
          x: Math.round(e.x),
          y: Math.round(e.y),
          distance: Math.round(dist(myX, myY, e.x, e.y)),
        });
      }
      // Sort each NPC group by distance
      for (const group of Object.values(npcsByType)) {
        group.sort((a, b) => a.distance - b.distance);
      }

      // Ore nodes with charges
      const oreNodes = allEntities
        .filter((e) => e.type === "ore_node" && (e.charges ?? 0) > 0)
        .map((e) => ({
          id: e.id,
          oreType: e.oreType,
          charges: e.charges,
          maxCharges: e.maxCharges,
          distance: Math.round(dist(myX, myY, e.x, e.y)),
        }))
        .sort((a, b) => a.distance - b.distance);

      // Flower nodes with charges
      const flowerNodes = allEntities
        .filter((e) => e.type === "flower_node" && (e.charges ?? 0) > 0)
        .map((e) => ({
          id: e.id,
          flowerType: e.flowerType,
          charges: e.charges,
          distance: Math.round(dist(myX, myY, e.x, e.y)),
        }))
        .sort((a, b) => a.distance - b.distance);

      // Players (others)
      const players = allEntities
        .filter((e) => e.type === "player" && e.id !== entityId)
        .map((e) => ({
          id: e.id,
          name: e.name,
          level: e.level,
          class: e.classId,
          hpPct: Math.round((e.hp / e.maxHp) * 100),
          distance: Math.round(dist(myX, myY, e.x, e.y)),
        }));

      const summary = {
        zone: zoneId,
        myPosition: { x: Math.round(myX), y: Math.round(myY) },
        myLevel,
        myHpPct: me ? Math.round((me.hp / me.maxHp) * 100) : null,
        mobs: { count: mobs.length, list: mobs.slice(0, 20) },
        skinnableCorpses: corpses,
        npcs: npcsByType,
        oreNodes: { count: oreNodes.length, list: oreNodes },
        flowerNodes: { count: flowerNodes.length, list: flowerNodes },
        otherPlayers: players,
        tip: mobs.length === 0
          ? "No mobs in zone. Consider: gathering resources, questing, or traveling to another zone."
          : `Best mob target: ${mobs[0]?.name} (L${mobs[0]?.level}, ${mobs[0]?.distance} units away)`,
      };

      return {
        content: [{ type: "text" as const, text: JSON.stringify(summary, null, 2) }],
      };
    }
  );

  // ── fight_until_dead ───────────────────────────────────────────────────────

  server.registerTool(
    "fight_until_dead",
    {
      description:
        "Attack a mob and WAIT until it dies or your character dies (blocking). Issues the attack order and polls every 650ms until the mob disappears from zone state. Returns: killed, XP gained, whether a skinnable corpse was left, and your remaining HP. This is the core combat tool — use it instead of player_attack.",
      inputSchema: {
        sessionId: z.string().describe("Session ID from auth_verify_signature"),
        entityId: z.string().describe("Your entity ID"),
        zoneId: z.string().describe("Current zone ID"),
        targetId: z.string().describe("Target mob entity ID from scan_zone or find_nearby"),
        timeoutSeconds: z.number().min(10).max(120).default(60).describe("Max combat duration in seconds"),
      },
    },
    async ({ sessionId, entityId, zoneId, targetId, timeoutSeconds }) => {
      const { token } = requireSession(sessionId);

      // Snapshot player XP before combat
      const meBefore = await getEntityInZone(zoneId, entityId);
      if (!meBefore) {
        return { content: [{ type: "text" as const, text: `Your entity ${entityId} not found in ${zoneId}` }] };
      }
      const xpBefore = meBefore.xp ?? 0;
      const levelBefore = meBefore.level ?? 1;

      // Get initial target info
      const targetBefore = await getEntityInZone(zoneId, targetId);
      if (!targetBefore) {
        return { content: [{ type: "text" as const, text: `Target ${targetId} not found. Already dead?` }] };
      }
      const targetName = targetBefore.name;
      const targetLevel = targetBefore.level;
      const targetStartHp = targetBefore.hp;

      // Issue attack order
      await shard.post("/command", { entityId, zoneId, action: "attack", targetId }, token);

      const deadline = Date.now() + timeoutSeconds * 1000;
      let killed = false;
      let playerDied = false;
      let lastReissue = Date.now();

      while (Date.now() < deadline) {
        await sleep(POLL_MS);

        const zone = await getZoneState(zoneId);
        const entities: Record<string, any> = zone.entities ?? {};
        const me = entities[entityId];
        const target = entities[targetId];

        // Player died (respawned at graveyard — HP may be low but position changed drastically)
        if (!me || me.hp <= 0) {
          playerDied = true;
          break;
        }

        // Target dead
        if (!target || target.hp <= 0) {
          killed = true;
          break;
        }

        // Re-issue attack every 5s in case order was cleared
        if (Date.now() - lastReissue > 5_000) {
          await shard.post("/command", { entityId, zoneId, action: "attack", targetId }, token).catch(() => {});
          lastReissue = Date.now();
        }
      }

      // Read final state
      const zone = await getZoneState(zoneId);
      const entities: Record<string, any> = zone.entities ?? {};
      const meAfter = entities[entityId];
      const xpAfter = meAfter?.xp ?? xpBefore;
      const levelAfter = meAfter?.level ?? levelBefore;
      const xpGained = xpAfter - xpBefore;
      const leveledUp = levelAfter > levelBefore;

      // Look for skinnable corpse
      const corpse = Object.values(entities).find(
        (e: any) =>
          e.type === "corpse" &&
          e.mobName &&
          targetName.toLowerCase().includes(e.mobName.toLowerCase().split(" ")[0])
      ) as any;

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            killed,
            playerDied,
            timedOut: !killed && !playerDied,
            target: { id: targetId, name: targetName, level: targetLevel },
            xpGained,
            leveledUp,
            newLevel: levelAfter,
            yourHp: meAfter ? `${meAfter.hp}/${meAfter.maxHp}` : "unknown",
            yourHpPct: meAfter ? Math.round((meAfter.hp / meAfter.maxHp) * 100) : 0,
            skinnableCorpse: corpse
              ? { id: corpse.id, name: corpse.mobName, secondsRemaining: Math.round((corpse.skinnableUntil - Date.now()) / 1000) }
              : null,
            tip: playerDied
              ? "You died! You've respawned at the zone graveyard. Repair your gear and restore HP before fighting again."
              : killed
              ? leveledUp
                ? `Killed ${targetName} and leveled up to ${levelAfter}!`
                : `Killed ${targetName}. +${xpGained} XP.`
              : `Combat timed out — ${targetName} may still be alive. Check scan_zone.`,
          }, null, 2),
        }],
      };
    }
  );

  // ── grind_mobs ─────────────────────────────────────────────────────────────

  server.registerTool(
    "grind_mobs",
    {
      description:
        "Fight multiple mobs in a row. Automatically: finds the best nearby mob for your level, walks to it, fights until dead, optionally consumes food when HP is low. Stops when requested count is reached, HP is critically low, or all mobs are cleared. Returns a full session summary.",
      inputSchema: {
        sessionId: z.string().describe("Session ID from auth_verify_signature"),
        entityId: z.string().describe("Your entity ID"),
        zoneId: z.string().describe("Current zone ID"),
        count: z.number().min(1).max(20).default(5).describe("Max mobs to kill"),
        stopAtHpPct: z.number().min(5).max(80).default(20).describe("Stop grinding when HP drops below this % (default 20)"),
        foodTokenId: z.number().optional().describe("Token ID of food to auto-consume when HP < 50%"),
      },
    },
    async ({ sessionId, entityId, zoneId, count, stopAtHpPct, foodTokenId }) => {
      const { walletAddress, token } = requireSession(sessionId);

      const log: string[] = [];
      let killed = 0;
      let totalXp = 0;
      let playerDeaths = 0;
      let stoppedReason = "count_reached";

      for (let i = 0; i < count; i++) {
        // Get current state
        const zone = await getZoneState(zoneId);
        const entities: Record<string, any> = zone.entities ?? {};
        const me = entities[entityId];

        if (!me || me.hp <= 0) {
          stoppedReason = "player_dead";
          log.push(`You died. Stopping grind.`);
          playerDeaths++;
          break;
        }

        const hpPct = Math.round((me.hp / me.maxHp) * 100);

        // Auto-consume food if HP is low and food specified
        if (foodTokenId && hpPct < 50) {
          log.push(`HP at ${hpPct}% — consuming food (tokenId ${foodTokenId})`);
          await shard.post("/cooking/consume", { walletAddress, zoneId, entityId, foodTokenId }, token)
            .catch((err: Error) => log.push(`Food consume failed: ${err.message}`));
          await sleep(700);
        }

        // Stop if HP critically low even without food
        const freshMe = entities[entityId];
        const freshHpPct = freshMe ? Math.round((freshMe.hp / freshMe.maxHp) * 100) : 0;
        if (freshHpPct < stopAtHpPct) {
          stoppedReason = "low_hp";
          log.push(`HP at ${freshHpPct}% — below stop threshold (${stopAtHpPct}%). Stopping.`);
          break;
        }

        // Find best mob
        const myLevel = me.level ?? 1;
        const mob = Object.values(entities)
          .filter((e: any) => (e.type === "mob" || e.type === "boss") && e.hp > 0 && !e.taggedBy)
          .map((e: any) => ({
            ...e,
            distance: dist(me.x, me.y, e.x, e.y),
            levelDiff: Math.abs((e.level ?? 1) - myLevel),
          }))
          .sort((a: any, b: any) => a.levelDiff * 200 + a.distance - (b.levelDiff * 200 + b.distance))[0] as any;

        if (!mob) {
          stoppedReason = "no_mobs";
          log.push(`No available mobs in ${zoneId}.`);
          break;
        }

        log.push(`[${i + 1}/${count}] Targeting ${mob.name} (L${mob.level}, ${Math.round(mob.distance)} units away)`);

        // Walk to mob if too far
        if (mob.distance > ATTACK_RANGE * 1.5) {
          await shard.post("/command", { entityId, zoneId, action: "move", x: mob.x, y: mob.y }, token).catch(() => {});
          // Wait until close enough
          let walkDeadline = Date.now() + 15_000;
          while (Date.now() < walkDeadline) {
            await sleep(POLL_MS);
            const pos = ((await getZoneState(zoneId)).entities ?? {})[entityId];
            if (!pos) break;
            if (dist(pos.x, pos.y, mob.x, mob.y) <= ATTACK_RANGE) break;
          }
        }

        // Fight
        const xpSnapshot = me.xp ?? 0;
        await shard.post("/command", { entityId, zoneId, action: "attack", targetId: mob.id }, token).catch(() => {});

        const combatDeadline = Date.now() + 60_000;
        let mobKilled = false;
        let lastReissue = Date.now();

        while (Date.now() < combatDeadline) {
          await sleep(POLL_MS);
          const cZone = await getZoneState(zoneId);
          const cEntities: Record<string, any> = cZone.entities ?? {};
          const cMe = cEntities[entityId];
          const cTarget = cEntities[mob.id];

          if (!cMe || cMe.hp <= 0) {
            playerDeaths++;
            log.push(`Died fighting ${mob.name}. Respawned at graveyard.`);
            stoppedReason = "player_dead";
            break;
          }
          if (!cTarget || cTarget.hp <= 0) {
            mobKilled = true;
            const xpGained = (cMe.xp ?? xpSnapshot) - xpSnapshot;
            totalXp += xpGained;
            killed++;
            log.push(`Killed ${mob.name}. +${xpGained} XP. HP: ${cMe.hp}/${cMe.maxHp}`);
            if (cMe.level > (me.level ?? 1)) {
              log.push(`*** LEVEL UP! Now level ${cMe.level} ***`);
            }
            break;
          }

          if (Date.now() - lastReissue > 5_000) {
            await shard.post("/command", { entityId, zoneId, action: "attack", targetId: mob.id }, token).catch(() => {});
            lastReissue = Date.now();
          }
        }

        if (stoppedReason === "player_dead") break;
        if (!mobKilled) {
          log.push(`Combat timed out on ${mob.name}. Stopping.`);
          stoppedReason = "combat_timeout";
          break;
        }

        // Brief rest between kills
        await sleep(500);
      }

      const finalMe = ((await getZoneState(zoneId)).entities ?? {})[entityId];

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            summary: {
              mobsKilled: killed,
              totalXpGained: totalXp,
              playerDeaths,
              stoppedReason,
            },
            finalStatus: finalMe ? {
              hp: `${finalMe.hp}/${finalMe.maxHp}`,
              hpPct: Math.round((finalMe.hp / finalMe.maxHp) * 100),
              level: finalMe.level,
              xp: finalMe.xp,
            } : null,
            log,
          }, null, 2),
        }],
      };
    }
  );

  // ── what_can_i_craft ───────────────────────────────────────────────────────

  server.registerTool(
    "what_can_i_craft",
    {
      description:
        "Cross-reference your current inventory against all crafting/alchemy/cooking/leatherworking/jewelcrafting recipes to find what you can craft right now. Returns craftable items grouped by profession.",
      inputSchema: {
        sessionId: z.string().describe("Session ID from auth_verify_signature"),
      },
    },
    async ({ sessionId }) => {
      const { walletAddress } = requireSession(sessionId);

      const [inventoryData, craftingRecipes, alchemyRecipes, cookingRecipes] = await Promise.all([
        shard.get<any>(`/items/${walletAddress}`).catch(() => null),
        shard.get<any>("/crafting/recipes").catch(() => []),
        shard.get<any>("/alchemy/recipes").catch(() => []),
        shard.get<any>("/cooking/recipes").catch(() => []),
      ]);

      // Build inventory map: tokenId (as number) → quantity
      const inventory: Record<number, number> = {};
      const rawItems: any[] = Array.isArray(inventoryData)
        ? inventoryData
        : inventoryData?.items ?? inventoryData?.tokens ?? [];

      for (const item of rawItems) {
        const id = Number(item.tokenId ?? item.id ?? item.token_id);
        const qty = Number(item.balance ?? item.quantity ?? item.amount ?? 1);
        if (!isNaN(id)) inventory[id] = (inventory[id] ?? 0) + qty;
      }

      function canCraft(recipe: any): boolean {
        const materials: any[] = recipe.requiredMaterials ?? recipe.materials ?? recipe.ingredients ?? [];
        if (materials.length === 0) return false;
        return materials.every((mat: any) => {
          const id = Number(mat.tokenId ?? mat.token_id ?? mat.id);
          const needed = Number(mat.quantity ?? mat.amount ?? 1);
          return (inventory[id] ?? 0) >= needed;
        });
      }

      function describeMaterials(recipe: any): string {
        const materials: any[] = recipe.requiredMaterials ?? recipe.materials ?? recipe.ingredients ?? [];
        return materials.map((m: any) =>
          `${Number(m.quantity ?? 1)}x tokenId:${Number(m.tokenId ?? m.id)}`
        ).join(", ");
      }

      const allRecipes = [
        ...((Array.isArray(craftingRecipes) ? craftingRecipes : craftingRecipes?.recipes ?? []).map((r: any) => ({ ...r, profession: "crafting" }))),
        ...((Array.isArray(alchemyRecipes) ? alchemyRecipes : alchemyRecipes?.recipes ?? []).map((r: any) => ({ ...r, profession: "alchemy" }))),
        ...((Array.isArray(cookingRecipes) ? cookingRecipes : cookingRecipes?.recipes ?? []).map((r: any) => ({ ...r, profession: "cooking" }))),
      ];

      const craftable: Record<string, any[]> = {};
      const almostCraftable: any[] = [];

      for (const recipe of allRecipes) {
        if (canCraft(recipe)) {
          const prof = recipe.profession;
          if (!craftable[prof]) craftable[prof] = [];
          craftable[prof].push({
            id: recipe.recipeId ?? recipe.id,
            name: recipe.name,
            outputTokenId: recipe.outputTokenId,
            materials: describeMaterials(recipe),
          });
        } else {
          // Check "almost craftable" — missing only 1 material type
          const materials: any[] = recipe.requiredMaterials ?? recipe.materials ?? recipe.ingredients ?? [];
          const missing = materials.filter((m: any) => {
            const id = Number(m.tokenId ?? m.id);
            const needed = Number(m.quantity ?? 1);
            return (inventory[id] ?? 0) < needed;
          });
          if (missing.length === 1) {
            almostCraftable.push({
              name: recipe.name,
              profession: recipe.profession,
              missingMaterial: `${Number(missing[0].quantity ?? 1) - (inventory[Number(missing[0].tokenId ?? missing[0].id)] ?? 0)}x tokenId:${Number(missing[0].tokenId ?? missing[0].id)}`,
            });
          }
        }
      }

      const totalCraftable = Object.values(craftable).reduce((s, a) => s + a.length, 0);

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            canCraftNow: craftable,
            totalCraftable,
            almostCraftable: almostCraftable.slice(0, 10),
            inventorySnapshot: Object.entries(inventory).map(([id, qty]) => ({ tokenId: Number(id), quantity: qty })),
            tip: totalCraftable === 0
              ? "Nothing craftable. Gather materials by mining, herbalism, or skinning."
              : `${totalCraftable} item(s) ready to craft. Use crafting_forge, alchemy_brew, or cooking_cook.`,
          }, null, 2),
        }],
      };
    }
  );

  // ── find_mobs_for_level ────────────────────────────────────────────────────

  server.registerTool(
    "find_mobs_for_level",
    {
      description:
        "Find the best mobs to fight at your current level in the current zone. Returns mobs sorted by XP efficiency: same level = best XP, too high = dangerous, too low = poor XP.",
      inputSchema: {
        entityId: z.string().describe("Your entity ID"),
        zoneId: z.string().describe("Zone to search in"),
        maxLevelDiff: z.number().min(1).max(10).default(3).describe("Max level difference to include (default ±3)"),
      },
    },
    async ({ entityId, zoneId, maxLevelDiff }) => {
      const zone = await getZoneState(zoneId);
      const entities: Record<string, any> = zone.entities ?? {};
      const me = entities[entityId];
      const myLevel = me?.level ?? 1;
      const myX = me?.x ?? 320;
      const myY = me?.y ?? 320;

      const mobs = Object.values(entities)
        .filter((e: any) => (e.type === "mob" || e.type === "boss") && e.hp > 0)
        .map((e: any) => {
          const levelDiff = (e.level ?? 1) - myLevel;
          const d = dist(myX, myY, e.x, e.y);
          let rating = "good";
          if (levelDiff > 3) rating = "dangerous";
          else if (levelDiff > 0) rating = "challenging";
          else if (levelDiff < -5) rating = "trivial";
          else if (levelDiff < -2) rating = "easy";
          return { id: e.id, name: e.name, level: e.level, levelDiff, distance: Math.round(d), hp: e.hp, maxHp: e.maxHp, rating, tagged: !!e.taggedBy };
        })
        .filter((e) => Math.abs(e.levelDiff) <= maxLevelDiff)
        .sort((a, b) => Math.abs(a.levelDiff) - Math.abs(b.levelDiff) || a.distance - b.distance);

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            myLevel,
            mobs,
            recommendation: mobs.find((m) => !m.tagged) ?? null,
            tip: mobs.length === 0
              ? `No mobs within ±${maxLevelDiff} levels in ${zoneId}. Try increasing maxLevelDiff or traveling to another zone.`
              : `Best target: ${mobs.find(m => !m.tagged)?.name ?? "all mobs are tagged"} — use fight_until_dead to engage.`,
          }, null, 2),
        }],
      };
    }
  );

  // ── get_item_details ───────────────────────────────────────────────────────

  server.registerTool(
    "get_item_details",
    {
      description:
        "Look up the stats, description, and category for any item by its ERC-1155 token ID. Use before buying, equipping, or crafting to understand what you're getting.",
      inputSchema: {
        tokenId: z.number().describe("ERC-1155 token ID of the item"),
      },
    },
    async ({ tokenId }) => {
      const catalog = await shard.get<any>("/shop/catalog");
      const items: any[] = Array.isArray(catalog) ? catalog : catalog?.items ?? [];
      const item = items.find((i: any) => Number(i.tokenId ?? i.id) === tokenId);

      if (!item) {
        return {
          content: [{ type: "text" as const, text: `Item tokenId ${tokenId} not found in catalog.` }],
        };
      }

      return {
        content: [{ type: "text" as const, text: JSON.stringify(item, null, 2) }],
      };
    }
  );
}
