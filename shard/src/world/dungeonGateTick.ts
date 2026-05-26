/**
 * Dungeon Gate Tick System
 *
 * Periodically spawns "gate surges" of dungeon gates across all zones.
 * Manages gate expiry (unopened gates despawn after 3 minutes).
 * Monitors active dungeon instances for timeout eviction.
 */

import type { FastifyInstance } from "fastify";
import { randomUUID } from "crypto";
import { getAllZones, getOrCreateZone, type Entity } from "./zoneRuntime.js";
import { logZoneEvent } from "./zoneEvents.js";
import { getDungeonInstances, cleanupDungeonInstance, advanceToNextRoom, countRoomMobsAlive } from "./dungeonGate.js";

// --- Configuration ---
const SURGE_INTERVAL_MS = Math.max(
  60_000,
  Number.parseInt(process.env.DUNGEON_GATE_SURGE_INTERVAL_MS ?? String(5 * 60 * 1000), 10) || (5 * 60 * 1000)
); // 5 minutes default between surges
const GATE_LIFETIME_MS = 3 * 60 * 1000; // Gates despawn after 3 min if unopened
const TICK_INTERVAL_MS = Math.max(
  1_000,
  Number.parseInt(process.env.DUNGEON_GATE_TICK_INTERVAL_MS ?? "5000", 10) || 5_000
); // Check every 5 seconds default
const GATES_PER_SURGE_MIN = 3;
const GATES_PER_SURGE_MAX = 6;
const DANGER_GATE_CHANCE = 0.05; // 5%

type GateRank = "E" | "D" | "C" | "B" | "A" | "S";

// Zone sizes for position randomization (with 40-unit margin)
// All 10 Arcadia zones — gates surge in every zone so high-level agents
// can find rank-appropriate gates without travelling back to starter zones.
const ZONE_BOUNDS: Record<string, { width: number; height: number }> = {
  "village-square": { width: 640, height: 640 },
  "wild-meadow": { width: 640, height: 640 },
  "dark-forest": { width: 640, height: 640 },
  "emerald-woods": { width: 640, height: 640 },
  "auroral-plains": { width: 640, height: 640 },
  "viridian-range": { width: 640, height: 640 },
  "moondancer-glade": { width: 640, height: 640 },
  "felsrock-citadel": { width: 640, height: 640 },
  "lake-lumina": { width: 640, height: 640 },
  "azurshard-chasm": { width: 640, height: 640 },
};

// Rank distribution per zone (cumulative probability thresholds)
const RANK_DISTRIBUTIONS: Record<string, Array<{ rank: GateRank; threshold: number }>> = {
  "village-square": [
    { rank: "E", threshold: 0.50 },
    { rank: "D", threshold: 0.80 },
    { rank: "C", threshold: 0.95 },
    { rank: "B", threshold: 1.00 },
  ],
  "wild-meadow": [
    { rank: "E", threshold: 0.10 },
    { rank: "D", threshold: 0.40 },
    { rank: "C", threshold: 0.70 },
    { rank: "B", threshold: 0.90 },
    { rank: "A", threshold: 0.98 },
    { rank: "S", threshold: 1.00 },
  ],
  "dark-forest": [
    { rank: "D", threshold: 0.10 },
    { rank: "C", threshold: 0.30 },
    { rank: "B", threshold: 0.60 },
    { rank: "A", threshold: 0.85 },
    { rank: "S", threshold: 1.00 },
  ],
  // Higher-level zones — gates skew toward ranks players in this zone qualify for.
  "auroral-plains": [
    { rank: "C", threshold: 0.20 },
    { rank: "B", threshold: 0.60 },
    { rank: "A", threshold: 0.90 },
    { rank: "S", threshold: 1.00 },
  ],
  "emerald-woods": [
    { rank: "C", threshold: 0.15 },
    { rank: "B", threshold: 0.50 },
    { rank: "A", threshold: 0.85 },
    { rank: "S", threshold: 1.00 },
  ],
  "viridian-range": [
    { rank: "B", threshold: 0.20 },
    { rank: "A", threshold: 0.70 },
    { rank: "S", threshold: 1.00 },
  ],
  "moondancer-glade": [
    { rank: "B", threshold: 0.15 },
    { rank: "A", threshold: 0.65 },
    { rank: "S", threshold: 1.00 },
  ],
  "felsrock-citadel": [
    { rank: "A", threshold: 0.30 },
    { rank: "S", threshold: 1.00 },
  ],
  "lake-lumina": [
    { rank: "A", threshold: 0.20 },
    { rank: "S", threshold: 1.00 },
  ],
  "azurshard-chasm": [
    { rank: "S", threshold: 1.00 },
  ],
};

const RANK_ORDER: GateRank[] = ["E", "D", "C", "B", "A", "S"];

let lastSurgeTime = 0;

function rollRank(zoneId: string): GateRank {
  const dist = RANK_DISTRIBUTIONS[zoneId];
  if (!dist) return "E";
  const roll = Math.random();
  for (const entry of dist) {
    if (roll <= entry.threshold) return entry.rank;
  }
  return dist[dist.length - 1].rank;
}

function bumpRank(rank: GateRank): GateRank {
  const idx = RANK_ORDER.indexOf(rank);
  if (idx < RANK_ORDER.length - 1) return RANK_ORDER[idx + 1];
  return rank; // S can't go higher
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Force-spawn a single dungeon gate (admin/test). Returns the spawned gate's entity ID.
 * Throws if zoneId isn't a valid surge zone.
 */
export function spawnGateInZone(zoneId: string, rank?: GateRank, isDanger = false): string {
  const bounds = ZONE_BOUNDS[zoneId];
  if (!bounds) throw new Error(`Zone "${zoneId}" is not a surge zone`);
  const margin = 40;
  const finalRank = rank ?? rollRank(zoneId);
  const now = Date.now();
  const gateEntity: Entity = {
    id: randomUUID(),
    type: "dungeon-gate",
    name: isDanger ? `Danger Gate [${finalRank}]` : `Dungeon Gate [${finalRank}]`,
    x: randomInt(margin, bounds.width - margin),
    y: randomInt(margin, bounds.height - margin),
    hp: 9999,
    maxHp: 9999,
    createdAt: now,
    gateRank: finalRank,
    isDangerGate: isDanger,
    gateExpiresAt: now + GATE_LIFETIME_MS,
    gateOpened: false,
  };
  const zone = getOrCreateZone(zoneId);
  zone.entities.set(gateEntity.id, gateEntity);
  console.log(
    `[dungeon] ADMIN spawned ${isDanger ? "DANGER " : ""}Rank ${finalRank} gate in ${zoneId} at (${gateEntity.x}, ${gateEntity.y})`
  );
  return gateEntity.id;
}

function spawnGateSurge(): void {
  const zoneIds = Object.keys(ZONE_BOUNDS);
  const gateCount = randomInt(GATES_PER_SURGE_MIN, GATES_PER_SURGE_MAX);
  const now = Date.now();

  for (let i = 0; i < gateCount; i++) {
    // Pick a random zone for each gate
    const zoneId = zoneIds[Math.floor(Math.random() * zoneIds.length)];
    const bounds = ZONE_BOUNDS[zoneId];
    const margin = 40;

    let rank = rollRank(zoneId);
    let isDanger = false;

    if (Math.random() < DANGER_GATE_CHANCE) {
      isDanger = true;
      rank = bumpRank(rank);
    }

    const gateEntity: Entity = {
      id: randomUUID(),
      type: "dungeon-gate",
      name: isDanger ? `Danger Gate [${rank}]` : `Dungeon Gate [${rank}]`,
      x: randomInt(margin, bounds.width - margin),
      y: randomInt(margin, bounds.height - margin),
      hp: 9999,
      maxHp: 9999,
      createdAt: now,
      gateRank: rank,
      isDangerGate: isDanger,
      gateExpiresAt: now + GATE_LIFETIME_MS,
      gateOpened: false,
    };

    const zone = getOrCreateZone(zoneId);
    zone.entities.set(gateEntity.id, gateEntity);

    console.log(
      `[dungeon] Spawned ${isDanger ? "DANGER " : ""}Rank ${rank} gate in ${zoneId} at (${gateEntity.x}, ${gateEntity.y})`
    );
  }

  // Announce surge in all zones that have gates
  for (const zoneId of zoneIds) {
    const zone = getAllZones().get(zoneId);
    if (!zone) continue;
    const hasGates = [...zone.entities.values()].some(
      (e) => e.type === "dungeon-gate" && !e.gateOpened
    );
    if (hasGates) {
      logZoneEvent({
        zoneId,
        type: "system",
        tick: zone.tick,
        message: "*** GATE SURGE! Dungeon gates have appeared! ***",
      });
    }
  }
}

function expireOldGates(): void {
  const now = Date.now();

  for (const [zoneId, zone] of getAllZones()) {
    // Skip dungeon instances
    if (zoneId.startsWith("dungeon-")) continue;

    for (const [entityId, entity] of zone.entities) {
      if (
        entity.type === "dungeon-gate" &&
        !entity.gateOpened &&
        entity.gateExpiresAt &&
        entity.gateExpiresAt < now
      ) {
        zone.entities.delete(entityId);
        logZoneEvent({
          zoneId,
          type: "system",
          tick: zone.tick,
          message: `A Rank ${entity.gateRank} gate has faded away...`,
        });
        console.log(`[dungeon] Gate ${entity.gateRank} expired in ${zoneId}`);
      }
    }
  }
}

function monitorDungeonInstances(): void {
  const now = Date.now();

  for (const [instanceId, instance] of getDungeonInstances()) {
    if (instance.cleared) continue;

    // Check timeout first — applies regardless of room state
    if (now >= instance.expiresAt) {
      console.log(`[dungeon] Instance ${instanceId} timed out — evicting party`);
      cleanupDungeonInstance(instanceId, false);
      continue;
    }

    // Check current room — advance or full clear
    const dungeonZone = getAllZones().get(instance.dungeonZoneId);
    if (!dungeonZone) continue;

    const roomMobsAlive = countRoomMobsAlive(instance);
    instance.remainingMobs = roomMobsAlive;

    if (roomMobsAlive === 0) {
      // Current room cleared — advance, or finish if last room
      if (instance.currentRoomIdx + 1 < instance.rooms.length) {
        advanceToNextRoom(instance);
      } else {
        console.log(`[dungeon] Instance ${instanceId} CLEARED by party (all rooms done)!`);
        cleanupDungeonInstance(instanceId, true);
      }
    }
  }
}

export function registerDungeonGateTick(server: FastifyInstance): void {
  // First surge fires ~30s after boot (give zones time to populate),
  // not 5 minutes — agents shouldn't wait through an empty world.
  lastSurgeTime = Date.now() - SURGE_INTERVAL_MS + 30_000;

  setInterval(() => {
    const now = Date.now();

    // Check if it's time for a new surge
    if (now - lastSurgeTime >= SURGE_INTERVAL_MS) {
      lastSurgeTime = now;
      spawnGateSurge();
    }

    // Expire old gates
    expireOldGates();

    // Monitor active instances
    monitorDungeonInstances();
  }, TICK_INTERVAL_MS);

  server.log.info("[dungeon] Gate tick system registered (surge every 5 min, tick every 5s)");
}
