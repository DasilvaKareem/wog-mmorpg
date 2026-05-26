// Mob AI: tagging, leashing, roaming, aggro. Pulled out of zoneRuntime
// so the tick loop only orchestrates these passes instead of inlining them.
//
// All four functions are pure side-effect-on-zone — no return values.
// Order in the tick loop matters: leash first (so leashing mobs skip aggro),
// roam second (idle wander only when no order), aggro last (engage players).

import type { Entity, ZoneState, SpatialGrid } from "../world/zoneRuntime.js";
import { forEachInRadius } from "../world/zoneRuntime.js";

// ── Aggro / leash / roam tuning ──────────────────────────────────────
const MOB_AGGRO_RANGE = 60;
const BOSS_AGGRO_RANGE = 100;
const MOB_LEASH_RANGE = 150;
const BOSS_LEASH_RANGE = 200;
const LEASH_REGEN_PCT = 0.0125; // 1.25%/tick = 5%/sec at 250ms tick
const MOB_ROAM_RADIUS = 50;
const BOSS_ROAM_RADIUS = 30;
const ROAM_CHANCE_PER_TICK = 0.0075; // ~0.75%/tick → wander roughly every ~33s

/**
 * Tag a mob on first hit. Refresh tick on subsequent hits from the same tagger.
 * Also flips an idle mob into an attack order so aggro engages next tick.
 */
export function trySetMobTag(
  mob: Entity,
  attackerId: string,
  attackerType: string,
  tick: number,
): void {
  if (mob.type !== "mob" && mob.type !== "boss") return;
  if (attackerType !== "player") return;

  if (!mob.taggedBy) {
    mob.taggedBy = attackerId;
    mob.taggedAtTick = tick;
  } else if (mob.taggedBy === attackerId) {
    mob.taggedAtTick = tick;
  }

  // Interrupt roaming so aggro can engage next tick — don't override an
  // existing attack order or a leash-home, and skip if already casting.
  if (mob.leashing) return;
  if (mob.castingIntent) return;
  const currentOrder = mob.order;
  if (!currentOrder || currentOrder.action === "move") {
    mob.order = { action: "attack", targetId: attackerId };
  }
}

/**
 * Mob leash / de-aggro: pull a mob past its leash range and it walks home,
 * regens HP, and clears effects. Reaching spawn fully resets to 100% HP.
 */
export function tickMobLeash(zone: ZoneState): void {
  for (const entity of zone.entities.values()) {
    if (entity.type !== "mob" && entity.type !== "boss") continue;
    if (entity.hp <= 0) continue;
    if (entity.spawnX == null || entity.spawnY == null) continue;

    const dxSpawn = entity.x - entity.spawnX;
    const dySpawn = entity.y - entity.spawnY;
    const distFromSpawn = Math.sqrt(dxSpawn * dxSpawn + dySpawn * dySpawn);
    const leashRange = entity.type === "boss" ? BOSS_LEASH_RANGE : MOB_LEASH_RANGE;

    if (entity.leashing) {
      entity.hp = Math.min(entity.maxHp, entity.hp + Math.ceil(entity.maxHp * LEASH_REGEN_PCT));
      if (entity.activeEffects?.length) entity.activeEffects = [];

      if (distFromSpawn < 5) {
        entity.leashing = false;
        entity.hp = entity.maxHp;
        entity.x = entity.spawnX;
        entity.y = entity.spawnY;
        entity.order = undefined;
      } else {
        entity.order = { action: "move", x: entity.spawnX, y: entity.spawnY };
      }
      continue;
    }

    if (distFromSpawn > leashRange) {
      entity.leashing = true;
      entity.order = { action: "move", x: entity.spawnX, y: entity.spawnY };
      entity.taggedBy = undefined;
      entity.taggedAtTick = undefined;
    }
  }
}

/**
 * Idle mob wander: each tick a small chance to issue a random move order
 * toward a point inside the mob's roam radius around its spawn.
 */
export function tickMobRoam(zone: ZoneState): void {
  for (const entity of zone.entities.values()) {
    if (entity.type !== "mob" && entity.type !== "boss") continue;
    if (entity.order) continue;
    if (entity.castingIntent) continue;
    if (entity.hp <= 0) continue;
    if (entity.leashing) continue;
    if (entity.spawnX == null || entity.spawnY == null) continue;
    if (Math.random() > ROAM_CHANCE_PER_TICK) continue;

    const roamRadius = entity.type === "boss" ? BOSS_ROAM_RADIUS : MOB_ROAM_RADIUS;
    const angle = Math.random() * Math.PI * 2;
    const dist = Math.random() * roamRadius;
    entity.order = {
      action: "move",
      x: entity.spawnX + Math.cos(angle) * dist,
      y: entity.spawnY + Math.sin(angle) * dist,
    };
  }
}

/**
 * Mob aggro: idle mobs scan for nearby players. Prefers the tagger if in
 * 1.5× aggro range, otherwise nearest player in aggro range (grid-scoped).
 */
export function tickMobAggro(zone: ZoneState, spatialGrid: SpatialGrid): void {
  for (const entity of zone.entities.values()) {
    if (entity.type !== "mob" && entity.type !== "boss") continue;
    if (entity.order) continue;
    if (entity.castingIntent) continue;
    if (entity.hp <= 0) continue;
    if (entity.leashing) continue;

    const aggroRange = entity.type === "boss" ? BOSS_AGGRO_RANGE : MOB_AGGRO_RANGE;

    let target: Entity | null = null;
    if (entity.taggedBy) {
      const tagged = zone.entities.get(entity.taggedBy);
      if (tagged && tagged.type === "player" && tagged.hp > 0) {
        const dx = tagged.x - entity.x;
        const dy = tagged.y - entity.y;
        if (Math.sqrt(dx * dx + dy * dy) < aggroRange * 1.5) {
          target = tagged;
        }
      }
    }

    if (!target) {
      let nearestDist = aggroRange;
      forEachInRadius(spatialGrid, entity.x, entity.y, aggroRange, (other) => {
        if (other.type !== "player") return;
        if (other.hp <= 0) return;
        const dx = other.x - entity.x;
        const dy = other.y - entity.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < nearestDist) {
          nearestDist = dist;
          target = other;
        }
      });
    }

    if (!target) continue;
    entity.order = { action: "attack", targetId: target.id };
  }
}
