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
import { getDungeonInstances, cleanupDungeonInstance } from "./dungeonGate.js";

// --- Configuration ---
const SURGE_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes between surges
const GATE_LIFETIME_MS = 3 * 60 * 1000; // Gates despawn after 3 min if unopened
const TICK_INTERVAL_MS = 5_000; // Check every 5 seconds
const GATES_PER_SURGE_MIN = 3;
const GATES_PER_SURGE_MAX = 6;
const DANGER_GATE_CHANCE = 0.05; // 5%

type GateRank = "E" | "D" | "C" | "B" | "A" | "S";

// Zone sizes for position randomization (with 40-unit margin)
const ZONE_BOUNDS: Record<string, { width: number; height: number }> = {
  "village-square": { width: 640, height: 640 },
  "wild-meadow": { width: 640, height: 640 },
  "dark-forest": { width: 640, height: 640 },
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

    // Check timeout
    if (now >= instance.expiresAt) {
      console.log(`[dungeon] Instance ${instanceId} timed out — evicting party`);
      cleanupDungeonInstance(instanceId, false);
    }

    // Check if all mobs dead (cleared)
    const dungeonZone = getAllZones().get(instance.dungeonZoneId);
    if (dungeonZone) {
      const remainingMobs = [...dungeonZone.entities.values()].filter(
        (e) => e.type === "mob" && e.hp > 0
      ).length;
      instance.remainingMobs = remainingMobs;

      if (remainingMobs === 0 && !instance.cleared) {
        console.log(`[dungeon] Instance ${instanceId} CLEARED by party!`);
        cleanupDungeonInstance(instanceId, true);
      }
    }
  }
}

export function registerDungeonGateTick(server: FastifyInstance): void {
  lastSurgeTime = Date.now();

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
