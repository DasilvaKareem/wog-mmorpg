/**
 * Character Diary System
 *
 * Per-character log of every meaningful game action, with vivid narrative
 * text suitable for image generation prompts, plus structured metadata
 * for filtering/display.
 *
 * Storage: dual-write (in-memory + Redis), fire-and-forget Redis writes.
 * Read: Redis first, in-memory fallback.
 */

import type { FastifyInstance } from "fastify";
import { randomUUID } from "crypto";
import { getRedis } from "./redis.js";

// ── Types ──────────────────────────────────────────────────────────

export type DiaryAction =
  | "spawn"
  | "kill"
  | "death"
  | "level_up"
  | "zone_transition"
  | "equip"
  | "unequip"
  | "repair"
  | "buy"
  | "sell"
  | "craft"
  | "brew"
  | "cook"
  | "consume"
  | "mine"
  | "gather_herb"
  | "skin"
  | "quest_complete";

export interface DiaryEntry {
  id: string;
  timestamp: number;
  walletAddress: string;
  characterName: string;
  zoneId: string;
  x: number;
  y: number;
  action: DiaryAction;
  headline: string;
  narrative: string;
  details: Record<string, unknown>;
}

// ── Constants ──────────────────────────────────────────────────────

const MAX_ENTRIES = 200;
const REDIS_KEY_PREFIX = "diary:";

// ── In-memory store ────────────────────────────────────────────────

const memoryStore = new Map<string, DiaryEntry[]>();

// ── Zone name lookup ───────────────────────────────────────────────

const ZONE_DISPLAY_NAMES: Record<string, string> = {
  "village-square": "the Village Square",
  "wild-meadow": "the Wild Meadow",
  "dark-forest": "the Dark Forest",
  "auroral-plains": "the Auroral Plains",
  "emerald-woods": "the Emerald Woods",
  "viridian-range": "the Viridian Range",
  "moondancer-glade": "Moondancer Glade",
  "felsrock-citadel": "Felsrock Citadel",
  "lake-lumina": "Lake Lumina",
  "azurshard-chasm": "Azurshard Chasm",
};

function zoneName(zoneId: string): string {
  return ZONE_DISPLAY_NAMES[zoneId] ?? zoneId;
}

function charTitle(name: string, raceId?: string, classId?: string): string {
  if (raceId && classId) {
    const race = raceId.charAt(0).toUpperCase() + raceId.slice(1);
    const cls = classId.charAt(0).toUpperCase() + classId.slice(1);
    return `${name} the ${race} ${cls}`;
  }
  return name;
}

// ── Narrative builders ─────────────────────────────────────────────

export function narrativeSpawn(
  name: string,
  raceId: string | undefined,
  classId: string | undefined,
  zoneId: string,
  restored: boolean,
): { headline: string; narrative: string } {
  const title = charTitle(name, raceId, classId);
  if (restored) {
    return {
      headline: `${name} returned to the world`,
      narrative: `${title} materialized once more in ${zoneName(zoneId)}, memories of past adventures flooding back as the familiar sights and sounds of the zone greeted them.`,
    };
  }
  return {
    headline: `${name} entered the world`,
    narrative: `A new adventurer appeared in ${zoneName(zoneId)} — ${title} took their first steps into a vast and dangerous realm, the air thrumming with untold possibility.`,
  };
}

export function narrativeKill(
  name: string,
  raceId: string | undefined,
  classId: string | undefined,
  zoneId: string,
  targetName: string,
  xpReward: number,
): { headline: string; narrative: string } {
  const title = charTitle(name, raceId, classId);
  return {
    headline: `Slew ${targetName}`,
    narrative: `In ${zoneName(zoneId)}, ${title} struck down a fearsome ${targetName}, claiming ${xpReward} experience as the creature collapsed into the dust.`,
  };
}

export function narrativeDeath(
  name: string,
  raceId: string | undefined,
  classId: string | undefined,
  zoneId: string,
  xpLoss: number,
): { headline: string; narrative: string } {
  const title = charTitle(name, raceId, classId);
  return {
    headline: `${name} was slain`,
    narrative: `${title} fell in ${zoneName(zoneId)}, the world dimming as ${xpLoss} experience faded away. They awoke at the graveyard, battered but alive.`,
  };
}

export function narrativeLevelUp(
  name: string,
  raceId: string | undefined,
  classId: string | undefined,
  zoneId: string,
  newLevel: number,
): { headline: string; narrative: string } {
  const title = charTitle(name, raceId, classId);
  return {
    headline: `Reached level ${newLevel}`,
    narrative: `A surge of golden light enveloped ${title} as they ascended to Level ${newLevel} in ${zoneName(zoneId)}, power coursing through every fiber of their being.`,
  };
}

export function narrativeZoneTransition(
  name: string,
  raceId: string | undefined,
  classId: string | undefined,
  fromZone: string,
  toZone: string,
  portalName?: string,
): { headline: string; narrative: string } {
  const title = charTitle(name, raceId, classId);
  const via = portalName ? ` through ${portalName}` : "";
  return {
    headline: `Traveled to ${zoneName(toZone)}`,
    narrative: `${title} departed ${zoneName(fromZone)}${via}, stepping into ${zoneName(toZone)} as new horizons unfolded before them.`,
  };
}

export function narrativeEquip(
  name: string,
  raceId: string | undefined,
  classId: string | undefined,
  zoneId: string,
  itemName: string,
  slot: string,
): { headline: string; narrative: string } {
  const title = charTitle(name, raceId, classId);
  return {
    headline: `Equipped ${itemName}`,
    narrative: `${title} donned ${itemName} in their ${slot} slot while standing in ${zoneName(zoneId)}, the gear fitting snugly as they tested its weight.`,
  };
}

export function narrativeUnequip(
  name: string,
  raceId: string | undefined,
  classId: string | undefined,
  zoneId: string,
  slot: string,
): { headline: string; narrative: string } {
  const title = charTitle(name, raceId, classId);
  return {
    headline: `Removed ${slot} equipment`,
    narrative: `${title} carefully removed their ${slot} gear in ${zoneName(zoneId)}, stowing it away for safekeeping.`,
  };
}

export function narrativeRepair(
  name: string,
  raceId: string | undefined,
  classId: string | undefined,
  zoneId: string,
  blacksmithName: string,
  totalCost: number,
  itemCount: number,
): { headline: string; narrative: string } {
  const title = charTitle(name, raceId, classId);
  return {
    headline: `Repaired ${itemCount} item${itemCount > 1 ? "s" : ""}`,
    narrative: `${title} visited ${blacksmithName} in ${zoneName(zoneId)}, paying ${totalCost} gold to have ${itemCount} piece${itemCount > 1 ? "s" : ""} of equipment restored to pristine condition.`,
  };
}

export function narrativeBuy(
  name: string,
  raceId: string | undefined,
  classId: string | undefined,
  zoneId: string,
  itemName: string,
  quantity: number,
  totalCost: number,
): { headline: string; narrative: string } {
  const title = charTitle(name, raceId, classId);
  return {
    headline: `Purchased ${quantity}x ${itemName}`,
    narrative: `${title} handed over ${totalCost} gold to a merchant in ${zoneName(zoneId)}, receiving ${quantity}x ${itemName} in return.`,
  };
}

export function narrativeSell(
  name: string,
  raceId: string | undefined,
  classId: string | undefined,
  zoneId: string,
  itemName: string,
  quantity: number,
  totalPayout: number,
): { headline: string; narrative: string } {
  const title = charTitle(name, raceId, classId);
  return {
    headline: `Sold ${quantity}x ${itemName}`,
    narrative: `${title} parted with ${quantity}x ${itemName} at a merchant stall in ${zoneName(zoneId)}, pocketing ${totalPayout} gold with a satisfied nod.`,
  };
}

export function narrativeCraft(
  name: string,
  raceId: string | undefined,
  classId: string | undefined,
  zoneId: string,
  itemName: string,
  stationName: string,
): { headline: string; narrative: string } {
  const title = charTitle(name, raceId, classId);
  return {
    headline: `Forged ${itemName}`,
    narrative: `Sparks flew at ${stationName} in ${zoneName(zoneId)} as ${title} hammered ${itemName} into existence, the newly forged creation gleaming in the firelight.`,
  };
}

export function narrativeBrew(
  name: string,
  raceId: string | undefined,
  classId: string | undefined,
  zoneId: string,
  potionName: string,
  labName: string,
): { headline: string; narrative: string } {
  const title = charTitle(name, raceId, classId);
  return {
    headline: `Brewed ${potionName}`,
    narrative: `Wisps of colorful vapor rose from ${labName} in ${zoneName(zoneId)} as ${title} carefully combined reagents, producing a vial of ${potionName}.`,
  };
}

export function narrativeCook(
  name: string,
  raceId: string | undefined,
  classId: string | undefined,
  zoneId: string,
  dishName: string,
  campfireName: string,
): { headline: string; narrative: string } {
  const title = charTitle(name, raceId, classId);
  return {
    headline: `Cooked ${dishName}`,
    narrative: `The aroma of ${dishName} wafted through ${zoneName(zoneId)} as ${title} skillfully prepared the meal over ${campfireName}.`,
  };
}

export function narrativeConsume(
  name: string,
  raceId: string | undefined,
  classId: string | undefined,
  zoneId: string,
  foodName: string,
  hpRestored: number,
): { headline: string; narrative: string } {
  const title = charTitle(name, raceId, classId);
  return {
    headline: `Consumed ${foodName}`,
    narrative: `${title} savored a serving of ${foodName} in ${zoneName(zoneId)}, warmth spreading through their body as ${hpRestored} health was restored.`,
  };
}

export function narrativeMine(
  name: string,
  raceId: string | undefined,
  classId: string | undefined,
  zoneId: string,
  oreName: string,
  pickaxeName: string,
): { headline: string; narrative: string } {
  const title = charTitle(name, raceId, classId);
  return {
    headline: `Mined ${oreName}`,
    narrative: `${title} swung their ${pickaxeName} into a vein of ${oreName} in ${zoneName(zoneId)}, chipping away until a gleaming chunk broke free.`,
  };
}

export function narrativeGatherHerb(
  name: string,
  raceId: string | undefined,
  classId: string | undefined,
  zoneId: string,
  herbName: string,
  sickleName: string,
): { headline: string; narrative: string } {
  const title = charTitle(name, raceId, classId);
  return {
    headline: `Gathered ${herbName}`,
    narrative: `${title} knelt beside a patch of ${herbName} in ${zoneName(zoneId)}, carefully harvesting the delicate plant with their ${sickleName}.`,
  };
}

export function narrativeSkin(
  name: string,
  raceId: string | undefined,
  classId: string | undefined,
  zoneId: string,
  corpseName: string,
  materialsCount: number,
): { headline: string; narrative: string } {
  const title = charTitle(name, raceId, classId);
  return {
    headline: `Skinned ${corpseName}`,
    narrative: `${title} knelt over the remains of ${corpseName} in ${zoneName(zoneId)}, deftly extracting ${materialsCount} material${materialsCount > 1 ? "s" : ""} with practiced hands.`,
  };
}

export function narrativeQuestComplete(
  name: string,
  raceId: string | undefined,
  classId: string | undefined,
  zoneId: string,
  questTitle: string,
  xpReward: number,
  goldReward: number,
): { headline: string; narrative: string } {
  const title = charTitle(name, raceId, classId);
  return {
    headline: `Completed "${questTitle}"`,
    narrative: `${title} completed the quest "${questTitle}" in ${zoneName(zoneId)}, earning ${xpReward} experience and ${goldReward} gold as a grateful quest-giver bestowed their rewards.`,
  };
}

// ── Core logging function ──────────────────────────────────────────

export function logDiary(
  walletAddress: string,
  characterName: string,
  zoneId: string,
  x: number,
  y: number,
  action: DiaryAction,
  headline: string,
  narrative: string,
  details: Record<string, unknown> = {},
): void {
  const entry: DiaryEntry = {
    id: randomUUID(),
    timestamp: Date.now(),
    walletAddress: walletAddress.toLowerCase(),
    characterName,
    zoneId,
    x,
    y,
    action,
    headline,
    narrative,
    details,
  };

  const key = walletAddress.toLowerCase();

  // Synchronous in-memory write
  let entries = memoryStore.get(key);
  if (!entries) {
    entries = [];
    memoryStore.set(key, entries);
  }
  entries.unshift(entry); // newest first
  if (entries.length > MAX_ENTRIES) {
    entries.length = MAX_ENTRIES;
  }

  // Fire-and-forget Redis write
  const redis = getRedis();
  if (redis) {
    const serialized = JSON.stringify(entry);
    redis
      .lpush(`${REDIS_KEY_PREFIX}${key}`, serialized)
      .then(() => redis.ltrim(`${REDIS_KEY_PREFIX}${key}`, 0, MAX_ENTRIES - 1))
      .catch((err: unknown) =>
        console.error(`[diary] Redis write failed for ${key}:`, err),
      );
  }
}

// ── Read functions ─────────────────────────────────────────────────

async function readDiary(
  walletAddress: string,
  limit: number,
  offset: number,
): Promise<DiaryEntry[]> {
  const key = walletAddress.toLowerCase();

  // Try Redis first
  const redis = getRedis();
  if (redis) {
    try {
      const raw: string[] = await redis.lrange(
        `${REDIS_KEY_PREFIX}${key}`,
        offset,
        offset + limit - 1,
      );
      if (raw.length > 0) {
        return raw.map((s: string) => JSON.parse(s) as DiaryEntry);
      }
    } catch {
      // Fall through to in-memory
    }
  }

  // In-memory fallback
  const entries = memoryStore.get(key);
  if (!entries) return [];
  return entries.slice(offset, offset + limit);
}

// ── HTTP routes ────────────────────────────────────────────────────

export function registerDiaryRoutes(server: FastifyInstance): void {
  /**
   * GET /diary/:walletAddress?limit=50&offset=0
   * Paginated diary entries for a character.
   */
  server.get<{
    Params: { walletAddress: string };
    Querystring: { limit?: string; offset?: string };
  }>("/diary/:walletAddress", async (request) => {
    const { walletAddress } = request.params;
    const limit = Math.min(Math.max(parseInt(request.query.limit ?? "50", 10) || 50, 1), 200);
    const offset = Math.max(parseInt(request.query.offset ?? "0", 10) || 0, 0);

    const entries = await readDiary(walletAddress, limit, offset);
    return { entries, count: entries.length, limit, offset };
  });

  /**
   * GET /diary/:walletAddress/recent?count=10
   * Most recent N diary entries.
   */
  server.get<{
    Params: { walletAddress: string };
    Querystring: { count?: string };
  }>("/diary/:walletAddress/recent", async (request) => {
    const { walletAddress } = request.params;
    const count = Math.min(Math.max(parseInt(request.query.count ?? "10", 10) || 10, 1), 200);

    const entries = await readDiary(walletAddress, count, 0);
    return { entries, count: entries.length };
  });
}
