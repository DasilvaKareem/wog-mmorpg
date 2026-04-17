/**
 * Arena Manager — In-world PvP using the existing zone runtime combat system.
 *
 * Instead of a parallel battle engine with fabricated stats, the ArenaManager
 * teleports real player entities into a dedicated "coliseum-arena" region and
 * lets the normal worldTick() attack/technique processing handle combat.
 * Statistics are derived each tick by diffing entity HP/alive state.
 */

import { randomUUID } from "crypto";
import type { ColiseumMap } from "../types/pvp.js";
import type { PvPFormat, PvPTeam, MatchStatus } from "../types/pvp.js";
import {
  getOrCreateZone,
  getEntity,
  resolveEntity,
  getWorldTick,
  updateSpawnedWalletZone,
  pickTechnique,
  type Entity,
} from "../world/zoneRuntime.js";
import { logZoneEvent } from "../world/zoneEvents.js";
import { enqueueTransferFromTreasury } from "../blockchain/wallet.js";
import { setGeneratedMap } from "../world/mapGenerator.js";
import { COLISEUM_MAPS } from "./coliseumMaps.js";

// ── Constants ─────────────────────────────────────────────────────────

const ELO_K_FACTOR = 32;
const MVP_REWARD_GOLD = 100;
const TILE_SIZE = 16;
const ARENA_WORLD_OFFSET = { x: 5000, y: 5000 };
const ARENA_REGION = "coliseum-arena";
const BETTING_DURATION_S = 15; // ticks (1 tick = 1s)

/** Match duration in seconds by format. */
const FORMAT_DURATION: Record<PvPFormat, number> = {
  "1v1": 180,
  "2v2": 300,
  "5v5": 420,
  ffa: 420,
};

// ── Per-combatant stat snapshot (for delta tracking) ──────────────────

interface CombatantSnapshot {
  entityId: string;
  team: PvPTeam;
  name: string;
  previousHp: number;
  alive: boolean;
  damageDealt: number;
  damageTaken: number;
  kills: number;
  deaths: number;
}

// ── Arena Match State ─────────────────────────────────────────────────

export interface ArenaMatchConfig {
  /** Entity IDs of players on the red team. */
  teamRedEntityIds: string[];
  /** Entity IDs of players on the blue team. */
  teamBlueEntityIds: string[];
  /** PvP format. */
  format: PvPFormat;
  /** Selected coliseum map. */
  arena: ColiseumMap;
}

export interface ArenaMatchState {
  battleId: string;
  status: MatchStatus;
  format: PvPFormat;
  arenaName: string;
  startedAtTick: number;
  durationTicks: number;
  elapsedTicks: number;

  teamRed: ArenaTeamView[];
  teamBlue: ArenaTeamView[];

  statistics: {
    teamRedDamage: number;
    teamBlueDamage: number;
    teamRedKills: number;
    teamBlueKills: number;
  };

  winner?: PvPTeam;
  mvp?: { entityId: string; name: string; damageDealt: number; kills: number };
}

export interface ArenaTeamView {
  entityId: string;
  name: string;
  hp: number;
  maxHp: number;
  alive: boolean;
  level: number;
}

/** Result payload emitted when an arena match completes. */
export interface ArenaMatchResult {
  battleId: string;
  format: PvPFormat;
  winner: PvPTeam;
  /** Individual winner entity ID (meaningful for FFA). */
  ffaWinnerId?: string;
  duration: number;
  combatants: Array<{
    entityId: string;
    team: PvPTeam;
    name: string;
    walletAddress?: string;
    damageDealt: number;
    kills: number;
    deaths: number;
    alive: boolean;
  }>;
  mvp?: { entityId: string; name: string; damageDealt: number; kills: number };
}

interface ArenaMatch {
  battleId: string;
  status: MatchStatus;
  format: PvPFormat;
  arena: ColiseumMap;
  startedAtTick: number;
  bettingEndsAtTick: number;
  durationTicks: number;
  /** Per-combatant tracking keyed by entity ID. */
  combatants: Map<string, CombatantSnapshot>;
  /** Saved positions so we can teleport players back. */
  savedPositions: Map<string, { x: number; y: number; region: string }>;
  /** Per-match power-up state tracking. */
  powerUpStates: Array<{
    x: number;
    y: number;
    type: "health" | "damage" | "speed";
    respawnTicks: number;
    active: boolean;
    cooldownUntilTick: number;
  }>;

  winner?: PvPTeam;
  /** Individual winner for FFA. */
  ffaWinnerId?: string;
  mvpEntityId?: string;
  completedAt?: number;
}

// ── ArenaManager Singleton ────────────────────────────────────────────

class ArenaManager {
  private matches = new Map<string, ArenaMatch>();
  private onMatchCompleteCallback?: (result: ArenaMatchResult) => void;

  /** Register a callback invoked when any arena match completes. */
  setOnMatchComplete(cb: (result: ArenaMatchResult) => void): void {
    this.onMatchCompleteCallback = cb;
  }

  // ── 1. Start Match ────────────────────────────────────────────────

  startArenaMatch(config: ArenaMatchConfig): string {
    const battleId = randomUUID();
    const allIds = [...config.teamRedEntityIds, ...config.teamBlueEntityIds];
    console.log(`[pvp-debug] startArenaMatch: battleId=${battleId} format=${config.format} entities=[${allIds.join(",")}]`);

    // Resolve and validate that all entities exist and are alive players
    const resolvedMap = new Map<string, Entity>();
    for (const id of allIds) {
      const entity = resolveEntity(id);
      if (!entity) throw new Error(`Entity ${id} not found`);
      if (entity.type !== "player") throw new Error(`Entity ${id} is not a player (type=${entity.type})`);
      if (entity.hp <= 0) throw new Error(`Entity ${id} is dead (hp=${entity.hp})`);
      if (entity.pvpBattleId) throw new Error(`Entity ${id} is already in a match (${entity.pvpBattleId})`);
      console.log(`[pvp-debug] entity ${id} OK: ${entity.name} L${entity.level} hp=${entity.hp}/${entity.maxHp}`);
      resolvedMap.set(id, entity);
    }

    // Ensure the arena region exists
    getOrCreateZone(ARENA_REGION);

    const savedPositions = new Map<string, { x: number; y: number; region: string }>();
    const combatants = new Map<string, CombatantSnapshot>();

    // Process red team
    for (let i = 0; i < config.teamRedEntityIds.length; i++) {
      const entityId = config.teamRedEntityIds[i];
      const entity = resolvedMap.get(entityId)!;
      this.prepareEntityForArena(entity, battleId, "red", config.arena, i, savedPositions, combatants);
    }

    // Process blue team
    for (let i = 0; i < config.teamBlueEntityIds.length; i++) {
      const entityId = config.teamBlueEntityIds[i];
      const entity = resolvedMap.get(entityId)!;
      this.prepareEntityForArena(entity, battleId, "blue", config.arena, i, savedPositions, combatants);
    }

    // Determine tick-based duration (worldTick runs at ~1 tick/s based on TICK_MS = 1000)
    const durationS = FORMAT_DURATION[config.format] ?? 300;
    const currentTick = this.getCurrentTick();

    const match: ArenaMatch = {
      battleId,
      status: "betting",
      format: config.format,
      arena: config.arena,
      startedAtTick: currentTick,
      bettingEndsAtTick: currentTick + BETTING_DURATION_S,
      durationTicks: durationS,
      combatants,
      savedPositions,
      powerUpStates: config.arena.powerUps.map((pu) => ({
        x: pu.x,
        y: pu.y,
        type: pu.type,
        respawnTicks: pu.respawnTicks,
        active: true,
        cooldownUntilTick: 0,
      })),
    };

    this.matches.set(battleId, match);

    // Log arena event
    logZoneEvent({
      zoneId: ARENA_REGION,
      type: "system",
      tick: currentTick,
      message: `Arena match ${config.format.toUpperCase()} starting! Betting phase: ${BETTING_DURATION_S}s`,
      data: { battleId, format: config.format, arena: config.arena.name },
    });

    return battleId;
  }

  private prepareEntityForArena(
    entity: Entity,
    battleId: string,
    team: "red" | "blue",
    arena: ColiseumMap,
    teamIndex: number,
    savedPositions: Map<string, { x: number; y: number; region: string }>,
    combatants: Map<string, CombatantSnapshot>,
  ): void {
    // Save current position
    savedPositions.set(entity.id, {
      x: entity.x,
      y: entity.y,
      region: entity.region ?? "village-square",
    });
    entity.pvpSavedPosition = {
      x: entity.x,
      y: entity.y,
      region: entity.region ?? "village-square",
    };

    // Determine spawn point from arena map
    const spawnPoints = team === "red" ? arena.spawnPoints.red : arena.spawnPoints.blue;
    const spawn = spawnPoints[teamIndex % spawnPoints.length];

    // Convert tile coordinates to world coordinates and offset into arena space
    entity.x = spawn.x * TILE_SIZE + ARENA_WORLD_OFFSET.x;
    entity.y = spawn.y * TILE_SIZE + ARENA_WORLD_OFFSET.y;

    // Move entity to the arena region
    entity.region = ARENA_REGION;
    if (entity.walletAddress) {
      updateSpawnedWalletZone(entity.walletAddress, ARENA_REGION);
    }

    // Tag with PvP metadata
    entity.pvpBattleId = battleId;
    entity.pvpTeam = team;

    // Full heal
    entity.hp = entity.maxHp;
    if (entity.maxEssence != null) {
      entity.essence = entity.maxEssence;
    }

    // Clear any existing orders/combat state
    entity.order = undefined;
    entity.castingIntent = undefined;
    entity.lastCombatTick = undefined;

    // Track combatant
    combatants.set(entity.id, {
      entityId: entity.id,
      team,
      name: entity.name,
      previousHp: entity.maxHp,
      alive: true,
      damageDealt: 0,
      damageTaken: 0,
      kills: 0,
      deaths: 0,
    });
  }

  // ── 2. Tick Arena Matches ─────────────────────────────────────────

  tickArenaMatches(): void {
    const currentTick = this.getCurrentTick();

    for (const [battleId, match] of this.matches) {
      if (match.status === "completed" || match.status === "cancelled") continue;

      // Transition from betting to in_progress
      if (match.status === "betting" && currentTick >= match.bettingEndsAtTick) {
        match.status = "in_progress";
        console.log(`[pvp-debug] ${battleId} betting→in_progress at tick ${currentTick}`);
        logZoneEvent({
          zoneId: ARENA_REGION,
          type: "system",
          tick: currentTick,
          message: `FIGHT! Arena match ${match.format.toUpperCase()} is now in progress!`,
          data: { battleId },
        });
      } else if (match.status === "betting") {
        console.log(`[pvp-debug] ${battleId} still betting: tick=${currentTick} endsAt=${match.bettingEndsAtTick} (${match.bettingEndsAtTick - currentTick} ticks left)`);
      }

      if (match.status === "betting") continue; // Still in betting phase

      // --- In-progress match processing ---

      // Arena auto-combat: idle players attack nearest enemy
      this.tickArenaAutoCombat(match);

      // Update statistics by diffing entity HP
      this.updateMatchStatistics(match, currentTick);

      // Apply hazard damage
      this.applyHazardDamage(match, currentTick);

      // Process power-up pickups
      this.tickPowerUps(match, currentTick);

      // Check win conditions
      const elapsed = currentTick - match.bettingEndsAtTick;

      // Timer expired?
      if (elapsed >= match.durationTicks) {
        if (match.format === "ffa") {
          this.resolveFFAByTimer(match, currentTick);
        } else {
          this.resolveMatchByTimer(match, currentTick);
        }
        continue;
      }

      if (match.format === "ffa") {
        // FFA: last player standing
        const totalAlive = this.countTotalAlive(match);
        if (totalAlive <= 1) {
          let survivorId: string | undefined;
          for (const snap of match.combatants.values()) {
            if (snap.alive) { survivorId = snap.entityId; break; }
          }
          match.winner = "red"; // All FFA players are on "red"
          match.ffaWinnerId = survivorId;
          this.endArenaMatch(battleId, currentTick);
        }
      } else {
        // Team elimination
        const redAlive = this.countAlive(match, "red");
        const blueAlive = this.countAlive(match, "blue");

        if (redAlive === 0 && blueAlive === 0) {
          // Mutual destruction — resolve by damage
          this.resolveMatchByTimer(match, currentTick);
        } else if (redAlive === 0) {
          match.winner = "blue";
          this.endArenaMatch(battleId, currentTick);
        } else if (blueAlive === 0) {
          match.winner = "red";
          this.endArenaMatch(battleId, currentTick);
        }
      }
    }
  }

  private updateMatchStatistics(match: ArenaMatch, currentTick: number): void {
    for (const [entityId, snapshot] of match.combatants) {
      const entity = resolveEntity(entityId);
      if (!entity) {
        // Entity disappeared — treat as dead
        if (snapshot.alive) {
          snapshot.alive = false;
          snapshot.deaths++;
        }
        continue;
      }

      const currentHp = Math.max(0, entity.hp);
      const hpDelta = snapshot.previousHp - currentHp;

      if (hpDelta > 0) {
        // Entity took damage since last tick
        snapshot.damageTaken += hpDelta;

        // Attribute damage dealt to the opposing team
        // (simplified: we attribute all damage taken by red to blue's total and vice versa)
        // For per-entity attribution, we'd need to hook into the combat log.
      }

      // Check if entity just died
      if (entity.hp <= 0 && snapshot.alive) {
        snapshot.alive = false;
        snapshot.deaths++;

        // Try to find who killed them from the attacker's order/last combat
        this.attributeKill(match, entityId, currentTick);
      }

      snapshot.previousHp = currentHp;
    }

    // Recalculate team damage totals from per-combatant tracking
    this.recalcTeamDamage(match);
  }

  private attributeKill(match: ArenaMatch, deadEntityId: string, _currentTick: number): void {
    const deadSnapshot = match.combatants.get(deadEntityId);
    if (!deadSnapshot) return;

    // Find the enemy combatant closest to the dead entity who is alive and recently engaged
    // This is a heuristic — in the real worldTick, the kill event is logged.
    const deadEntity = resolveEntity(deadEntityId);
    const opposingTeam = deadSnapshot.team === "red" ? "blue" : "red";

    let bestKiller: CombatantSnapshot | undefined;
    let bestDist = Infinity;

    for (const [id, snap] of match.combatants) {
      if (snap.team !== opposingTeam || !snap.alive) continue;
      const killer = resolveEntity(id);
      if (!killer) continue;

      if (deadEntity) {
        const dx = killer.x - deadEntity.x;
        const dy = killer.y - deadEntity.y;
        const dist = dx * dx + dy * dy;
        if (dist < bestDist) {
          bestDist = dist;
          bestKiller = snap;
        }
      } else {
        // No dead entity, just pick first alive enemy
        bestKiller = snap;
        break;
      }
    }

    if (bestKiller) {
      bestKiller.kills++;
    }
  }

  private recalcTeamDamage(match: ArenaMatch): void {
    // Team-level "damage dealt" is derived via getTeamDamageDealt() (sum of
    // damageTaken on the opposing team). Per-combatant damageDealt is an
    // approximation: we evenly split the team total among living contributors.
    for (const team of ["red", "blue"] as const) {
      const totalDealt = this.getTeamDamageDealt(match, team);
      const members = [...match.combatants.values()].filter((s) => s.team === team);
      const aliveMembers = members.filter((s) => s.alive);
      const divisor = aliveMembers.length || members.length || 1;
      for (const snap of members) {
        snap.damageDealt = Math.round(totalDealt / divisor);
      }
    }
  }

  private applyHazardDamage(match: ArenaMatch, currentTick: number): void {
    if (!match.arena.hazards || match.arena.hazards.length === 0) return;

    for (const [entityId, snapshot] of match.combatants) {
      if (!snapshot.alive) continue;
      const entity = resolveEntity(entityId);
      if (!entity || entity.hp <= 0) continue;

      for (const hazard of match.arena.hazards) {
        // Convert hazard tile coords to world coords
        const hx = hazard.x * TILE_SIZE + ARENA_WORLD_OFFSET.x;
        const hy = hazard.y * TILE_SIZE + ARENA_WORLD_OFFSET.y;
        const hw = hazard.width * TILE_SIZE;
        const hh = hazard.height * TILE_SIZE;

        if (
          entity.x >= hx &&
          entity.x <= hx + hw &&
          entity.y >= hy &&
          entity.y <= hy + hh
        ) {
          entity.hp = Math.max(0, entity.hp - hazard.damagePerTick);

          logZoneEvent({
            zoneId: ARENA_REGION,
            type: "combat",
            tick: currentTick,
            message: `${entity.name} takes ${hazard.damagePerTick} damage from ${hazard.type}!`,
            entityId: entity.id,
            entityName: entity.name,
            data: { damage: hazard.damagePerTick, hazardType: hazard.type, battleId: match.battleId },
          });

          if (entity.hp <= 0) {
            snapshot.alive = false;
            snapshot.deaths++;
            snapshot.damageTaken += hazard.damagePerTick;

            logZoneEvent({
              zoneId: ARENA_REGION,
              type: "death",
              tick: currentTick,
              message: `${entity.name} has been slain by ${hazard.type}!`,
              entityId: entity.id,
              entityName: entity.name,
              data: { battleId: match.battleId },
            });
          }
          break; // Only one hazard per tick per entity
        }
      }
    }
  }

  private countAlive(match: ArenaMatch, team: PvPTeam): number {
    let count = 0;
    for (const snap of match.combatants.values()) {
      if (snap.team === team && snap.alive) count++;
    }
    return count;
  }

  private countTotalAlive(match: ArenaMatch): number {
    let count = 0;
    for (const snap of match.combatants.values()) {
      if (snap.alive) count++;
    }
    return count;
  }

  /** FFA timer resolution — score by individual performance, not team. */
  private resolveFFAByTimer(match: ArenaMatch, currentTick: number): void {
    let best: CombatantSnapshot | undefined;
    let bestScore = -1;

    for (const snap of match.combatants.values()) {
      const entity = resolveEntity(snap.entityId);
      const aliveBonus = snap.alive ? 1000 : 0;
      const hp = entity ? Math.max(0, entity.hp) : 0;
      const score = aliveBonus + hp + snap.kills * 500;
      if (score > bestScore) {
        bestScore = score;
        best = snap;
      }
    }

    match.winner = "red"; // All FFA players are on "red"
    match.ffaWinnerId = best?.entityId;
    this.endArenaMatch(match.battleId, currentTick);
  }

  /** Give idle arena combatants an attack order against the nearest enemy. */
  private tickArenaAutoCombat(match: ArenaMatch): void {
    for (const [entityId, snapshot] of match.combatants) {
      if (!snapshot.alive) continue;
      const entity = resolveEntity(entityId);
      if (!entity || entity.hp <= 0) continue;
      if (entity.order) continue;
      if (entity.castingIntent) continue;

      let nearestEnemy: Entity | undefined;
      let nearestDist = Infinity;

      for (const [otherId, otherSnap] of match.combatants) {
        if (otherId === entityId) continue;
        if (!otherSnap.alive) continue;
        // FFA: target anyone; team modes: target different team only
        if (match.format !== "ffa" && otherSnap.team === snapshot.team) continue;

        const other = resolveEntity(otherId);
        if (!other || other.hp <= 0) continue;

        const dx = entity.x - other.x;
        const dy = entity.y - other.y;
        const dist = dx * dx + dy * dy;
        if (dist < nearestDist) {
          nearestDist = dist;
          nearestEnemy = other;
        }
      }

      if (nearestEnemy) {
        // Try to use a technique; fall back to basic attack
        const zone = getOrCreateZone(ARENA_REGION);
        const chosenTech = pickTechnique(entity, nearestEnemy, zone);
        if (chosenTech) {
          const techTarget = (chosenTech.targetType === "self" || chosenTech.targetType === "ally")
            ? entity.id
            : nearestEnemy.id;
          entity.order = { action: "technique", targetId: techTarget, techniqueId: chosenTech.id };
        } else {
          entity.order = { action: "attack", targetId: nearestEnemy.id };
        }
      }
    }
  }

  /** Process power-up pickups: heal, shield, or speed buff. */
  private tickPowerUps(match: ArenaMatch, currentTick: number): void {
    const PICKUP_RANGE_SQ = (2 * TILE_SIZE) * (2 * TILE_SIZE);

    for (const pu of match.powerUpStates) {
      // Respawn cooldown
      if (!pu.active && currentTick >= pu.cooldownUntilTick) {
        pu.active = true;
      }
      if (!pu.active) continue;

      const puX = pu.x * TILE_SIZE + ARENA_WORLD_OFFSET.x;
      const puY = pu.y * TILE_SIZE + ARENA_WORLD_OFFSET.y;

      for (const [entityId, snapshot] of match.combatants) {
        if (!snapshot.alive) continue;
        const entity = resolveEntity(entityId);
        if (!entity || entity.hp <= 0) continue;

        const dx = entity.x - puX;
        const dy = entity.y - puY;
        if (dx * dx + dy * dy > PICKUP_RANGE_SQ) continue;

        // Apply effect
        if (pu.type === "health") {
          entity.hp = Math.min(entity.maxHp, entity.hp + Math.round(entity.maxHp * 0.25));
        } else if (pu.type === "damage") {
          // Grant a temporary shield (absorbs damage, acts as effective HP advantage)
          if (!entity.activeEffects) entity.activeEffects = [];
          entity.activeEffects.push({
            id: `arena_dmg_${currentTick}`,
            techniqueId: "arena_powerup",
            name: "Arena Power",
            type: "shield",
            casterId: entityId,
            appliedAtTick: currentTick,
            durationTicks: 30,
            remainingTicks: 30,
            shieldHp: Math.round(entity.maxHp * 0.15),
            shieldMaxHp: Math.round(entity.maxHp * 0.15),
          });
        } else if (pu.type === "speed") {
          // HoT (heal-over-time) as a sustained advantage
          if (!entity.activeEffects) entity.activeEffects = [];
          entity.activeEffects.push({
            id: `arena_spd_${currentTick}`,
            techniqueId: "arena_powerup",
            name: "Arena Vigor",
            type: "hot",
            casterId: entityId,
            appliedAtTick: currentTick,
            durationTicks: 20,
            remainingTicks: 20,
            hotHealPerTick: Math.round(entity.maxHp * 0.02),
          });
        }

        logZoneEvent({
          zoneId: ARENA_REGION,
          type: "system",
          tick: currentTick,
          message: `${entity.name} picked up ${pu.type} power-up!`,
          entityId,
          entityName: entity.name,
          data: { battleId: match.battleId, powerUpType: pu.type },
        });

        pu.active = false;
        pu.cooldownUntilTick = currentTick + pu.respawnTicks;
        break; // One pickup per tick
      }
    }
  }

  private resolveMatchByTimer(match: ArenaMatch, currentTick: number): void {
    const redScore = this.calculateTeamScore(match, "red");
    const blueScore = this.calculateTeamScore(match, "blue");

    if (redScore > blueScore) {
      match.winner = "red";
    } else if (blueScore > redScore) {
      match.winner = "blue";
    } else {
      // Tiebreaker: total damage dealt
      const redDamageDealt = this.getTeamDamageDealt(match, "red");
      const blueDamageDealt = this.getTeamDamageDealt(match, "blue");
      match.winner = redDamageDealt >= blueDamageDealt ? "red" : "blue";
    }

    this.endArenaMatch(match.battleId, currentTick);
  }

  /**
   * Team score: (alive * 1000) + total HP remaining + (kills * 500)
   */
  private calculateTeamScore(match: ArenaMatch, team: PvPTeam): number {
    let aliveCount = 0;
    let totalHp = 0;
    let totalKills = 0;

    for (const snap of match.combatants.values()) {
      if (snap.team !== team) continue;
      if (snap.alive) {
        aliveCount++;
        const entity = resolveEntity(snap.entityId);
        totalHp += entity ? Math.max(0, entity.hp) : 0;
      }
      totalKills += snap.kills;
    }

    return aliveCount * 1000 + totalHp + totalKills * 500;
  }

  private getTeamDamageDealt(match: ArenaMatch, team: PvPTeam): number {
    // Damage dealt by team X = total damageTaken by the other team
    const opposingTeam = team === "red" ? "blue" : "red";
    let total = 0;
    for (const snap of match.combatants.values()) {
      if (snap.team === opposingTeam) total += snap.damageTaken;
    }
    return total;
  }

  // ── 3. End Match ──────────────────────────────────────────────────

  endArenaMatch(battleId: string, currentTick?: number): void {
    const match = this.matches.get(battleId);
    if (!match) return;
    if (match.status === "completed" || match.status === "cancelled") return;

    const tick = currentTick ?? this.getCurrentTick();
    match.status = "completed";
    match.completedAt = Date.now();

    // Determine MVP
    const mvp = this.determineMVP(match);
    match.mvpEntityId = mvp?.entityId;

    // Calculate ELO changes
    const eloChanges = this.calculateEloChanges(match);

    // Process each combatant: heal, clear PvP state, teleport back
    for (const [entityId, snapshot] of match.combatants) {
      const entity = resolveEntity(entityId);
      if (!entity) continue;

      // Full heal
      entity.hp = entity.maxHp;
      if (entity.maxEssence != null) {
        entity.essence = entity.maxEssence;
      }

      // Clear PvP tags
      entity.pvpBattleId = undefined;
      entity.pvpTeam = undefined;
      entity.order = undefined;
      entity.castingIntent = undefined;
      entity.lastCombatTick = undefined;

      // Teleport back to saved position
      const saved = match.savedPositions.get(entityId) ?? entity.pvpSavedPosition;
      if (saved) {
        entity.x = saved.x;
        entity.y = saved.y;
        entity.region = saved.region;
        if (entity.walletAddress) {
          updateSpawnedWalletZone(entity.walletAddress, saved.region);
        }
      }
      entity.pvpSavedPosition = undefined;
    }

    // Award gold to MVP
    if (mvp) {
        const mvpEntity = resolveEntity(mvp.entityId);
        if (mvpEntity?.walletAddress) {
        void enqueueTransferFromTreasury(mvpEntity.walletAddress, MVP_REWARD_GOLD.toString()).catch(
          (err) => console.error(`[arena] MVP gold transfer failed:`, err)
        );
      }
    }

    // Emit result events
    if (match.format === "ffa") {
      const ffaWinner = match.ffaWinnerId ? match.combatants.get(match.ffaWinnerId) : undefined;
      logZoneEvent({
        zoneId: ARENA_REGION,
        type: "system",
        tick,
        message: `FFA Arena match complete! ${ffaWinner?.name ?? "Unknown"} wins!`,
        data: {
          battleId,
          ffaWinnerId: match.ffaWinnerId,
          mvp: mvp ? { entityId: mvp.entityId, name: mvp.name } : undefined,
          eloChanges,
        },
      });
    } else {
      const winnerNames = this.getTeamNames(match, match.winner ?? "red");
      const loserTeam: PvPTeam = match.winner === "red" ? "blue" : "red";
      const loserNames = this.getTeamNames(match, loserTeam);

      logZoneEvent({
        zoneId: ARENA_REGION,
        type: "system",
        tick,
        message: `Arena match complete! ${match.winner?.toUpperCase()} team wins! (${winnerNames.join(", ")} defeated ${loserNames.join(", ")})`,
        data: {
          battleId,
          winner: match.winner,
          mvp: mvp ? { entityId: mvp.entityId, name: mvp.name } : undefined,
          eloChanges,
        },
      });
    }

    if (mvp) {
      logZoneEvent({
        zoneId: ARENA_REGION,
        type: "system",
        tick,
        message: `MVP: ${mvp.name} — ${mvp.damageDealt} damage, ${mvp.kills} kills! (+${MVP_REWARD_GOLD} gold)`,
        data: { battleId, mvpEntityId: mvp.entityId },
      });
    }

    // Fire completion callback (stats, ELO, match history)
    if (this.onMatchCompleteCallback && match.winner) {
      const combatantResults: ArenaMatchResult["combatants"] = [];
      for (const [entityId, snap] of match.combatants) {
        const entity = resolveEntity(entityId);
        combatantResults.push({
          entityId,
          team: snap.team,
          name: snap.name,
          walletAddress: entity?.walletAddress,
          damageDealt: snap.damageDealt,
          kills: snap.kills,
          deaths: snap.deaths,
          alive: snap.alive,
        });
      }

      const elapsed = tick - match.bettingEndsAtTick;
      this.onMatchCompleteCallback({
        battleId,
        format: match.format,
        winner: match.winner,
        ffaWinnerId: match.ffaWinnerId,
        duration: Math.max(0, elapsed),
        combatants: combatantResults,
        mvp: mvp ? { entityId: mvp.entityId, name: mvp.name, damageDealt: mvp.damageDealt, kills: mvp.kills } : undefined,
      });
    }

    // Auto-cleanup match data after 5 minutes
    setTimeout(() => {
      this.matches.delete(battleId);
    }, 300_000);
  }

  // ── 4. Get Match State ────────────────────────────────────────────

  getMatchState(battleId: string): ArenaMatchState | null {
    const match = this.matches.get(battleId);
    if (!match) return null;

    const currentTick = this.getCurrentTick();
    const elapsedSinceFight = match.status === "in_progress" || match.status === "completed"
      ? currentTick - match.bettingEndsAtTick
      : 0;

    const teamRed: ArenaTeamView[] = [];
    const teamBlue: ArenaTeamView[] = [];

    for (const [entityId, snap] of match.combatants) {
      const entity = resolveEntity(entityId);
      const view: ArenaTeamView = {
        entityId,
        name: snap.name,
        hp: entity ? Math.max(0, entity.hp) : 0,
        maxHp: entity?.maxHp ?? 0,
        alive: snap.alive && (entity ? entity.hp > 0 : false),
        level: entity?.level ?? 1,
      };

      if (snap.team === "red") teamRed.push(view);
      else teamBlue.push(view);
    }

    const redDamageDealt = this.getTeamDamageDealt(match, "red");
    const blueDamageDealt = this.getTeamDamageDealt(match, "blue");
    let redKills = 0;
    let blueKills = 0;
    for (const snap of match.combatants.values()) {
      if (snap.team === "red") redKills += snap.kills;
      else blueKills += snap.kills;
    }

    const mvp = match.mvpEntityId ? match.combatants.get(match.mvpEntityId) : undefined;

    return {
      battleId,
      status: match.status,
      format: match.format,
      arenaName: match.arena.name,
      startedAtTick: match.startedAtTick,
      durationTicks: match.durationTicks,
      elapsedTicks: Math.max(0, elapsedSinceFight),
      teamRed,
      teamBlue,
      statistics: {
        teamRedDamage: redDamageDealt,
        teamBlueDamage: blueDamageDealt,
        teamRedKills: redKills,
        teamBlueKills: blueKills,
      },
      winner: match.winner,
      mvp: mvp
        ? {
            entityId: mvp.entityId,
            name: mvp.name,
            damageDealt: mvp.damageDealt,
            kills: mvp.kills,
          }
        : undefined,
    };
  }

  // ── 5. Query helpers ──────────────────────────────────────────────

  getActiveMatches(): Array<{ battleId: string; format: PvPFormat; status: MatchStatus; playerCount: number }> {
    const result: Array<{ battleId: string; format: PvPFormat; status: MatchStatus; playerCount: number }> = [];
    for (const [battleId, match] of this.matches) {
      if (match.status === "completed" || match.status === "cancelled") continue;
      result.push({
        battleId,
        format: match.format,
        status: match.status,
        playerCount: match.combatants.size,
      });
    }
    return result;
  }

  getMatchForPlayer(entityId: string): ArenaMatchState | null {
    // Resolve agentId → entity UUID for lookup
    const resolved = resolveEntity(entityId);
    const lookupId = resolved?.id ?? entityId;
    for (const [battleId, match] of this.matches) {
      if (match.status === "completed" || match.status === "cancelled") continue;
      if (match.combatants.has(lookupId) || match.combatants.has(entityId)) {
        return this.getMatchState(battleId);
      }
    }
    return null;
  }

  isInArena(entityId: string): boolean {
    const resolved = resolveEntity(entityId);
    const lookupId = resolved?.id ?? entityId;
    for (const match of this.matches.values()) {
      if (match.status === "completed" || match.status === "cancelled") continue;
      if (match.combatants.has(lookupId) || match.combatants.has(entityId)) return true;
    }
    return false;
  }

  // ── ELO ───────────────────────────────────────────────────────────

  private calculateEloChanges(match: ArenaMatch): Array<{ entityId: string; eloChange: number }> {
    if (!match.winner) return [];

    // Collect team ELOs from entities (use level as proxy — real ELO would come from a DB)
    const redElos: number[] = [];
    const blueElos: number[] = [];

    for (const snap of match.combatants.values()) {
      const entity = resolveEntity(snap.entityId);
      const elo = (entity?.level ?? 1) * 100; // Simplified ELO proxy
      if (snap.team === "red") redElos.push(elo);
      else blueElos.push(elo);
    }

    const avgRedElo = redElos.length > 0 ? redElos.reduce((a, b) => a + b, 0) / redElos.length : 1000;
    const avgBlueElo = blueElos.length > 0 ? blueElos.reduce((a, b) => a + b, 0) / blueElos.length : 1000;

    const changes: Array<{ entityId: string; eloChange: number }> = [];

    for (const snap of match.combatants.values()) {
      const entity = resolveEntity(snap.entityId);
      const playerElo = (entity?.level ?? 1) * 100;
      const opponentAvgElo = snap.team === "red" ? avgBlueElo : avgRedElo;
      const won = snap.team === match.winner;

      const expectedScore = 1 / (1 + Math.pow(10, (opponentAvgElo - playerElo) / 400));
      const actualScore = won ? 1 : 0;
      const eloChange = Math.round(ELO_K_FACTOR * (actualScore - expectedScore));

      changes.push({ entityId: snap.entityId, eloChange });
    }

    return changes;
  }

  // ── MVP ───────────────────────────────────────────────────────────

  private determineMVP(match: ArenaMatch): { entityId: string; name: string; damageDealt: number; kills: number } | undefined {
    let best: CombatantSnapshot | undefined;
    let bestScore = -1;

    for (const snap of match.combatants.values()) {
      // Score: kills carry heavy weight, survival is a bonus
      const survivalBonus = snap.alive ? 100 : 0;
      const adjustedScore = snap.kills * 200 + snap.damageDealt + survivalBonus;

      if (adjustedScore > bestScore) {
        bestScore = adjustedScore;
        best = snap;
      }
    }

    if (!best) return undefined;

    // Calculate this combatant's approximate damage dealt
    const opposingTeam = best.team === "red" ? "blue" : "red";
    const teamSize = [...match.combatants.values()].filter((s) => s.team === best!.team).length;
    const totalDamageDealt = this.getTeamDamageDealt(match, best.team);
    const approxDamageDealt = teamSize > 0 ? Math.round(totalDamageDealt / teamSize) : 0;

    return {
      entityId: best.entityId,
      name: best.name,
      damageDealt: approxDamageDealt,
      kills: best.kills,
    };
  }

  // ── Utilities ─────────────────────────────────────────────────────

  private getTeamNames(match: ArenaMatch, team: PvPTeam): string[] {
    const names: string[] = [];
    for (const snap of match.combatants.values()) {
      if (snap.team === team) names.push(snap.name);
    }
    return names;
  }

  private getCurrentTick(): number {
    return getWorldTick();
  }

  /**
   * Cancel a match (admin). Heals and returns all players without rewards.
   */
  cancelMatch(battleId: string): boolean {
    const match = this.matches.get(battleId);
    if (!match) return false;
    if (match.status === "completed" || match.status === "cancelled") return false;

    match.status = "cancelled";

    for (const [entityId] of match.combatants) {
      const entity = resolveEntity(entityId);
      if (!entity) continue;

      entity.hp = entity.maxHp;
      if (entity.maxEssence != null) entity.essence = entity.maxEssence;
      entity.pvpBattleId = undefined;
      entity.pvpTeam = undefined;
      entity.order = undefined;
      entity.castingIntent = undefined;

      const saved = match.savedPositions.get(entityId) ?? entity.pvpSavedPosition;
      if (saved) {
        entity.x = saved.x;
        entity.y = saved.y;
        entity.region = saved.region;
        if (entity.walletAddress) {
          updateSpawnedWalletZone(entity.walletAddress, saved.region);
        }
      }
      entity.pvpSavedPosition = undefined;
    }

    logZoneEvent({
      zoneId: ARENA_REGION,
      type: "system",
      tick: this.getCurrentTick(),
      message: `Arena match cancelled.`,
      data: { battleId },
    });

    setTimeout(() => this.matches.delete(battleId), 60_000);
    return true;
  }
}

// ── Singleton Export ───────────────────────────────────────────────────

export const arenaManager = new ArenaManager();

// ── Generate arena terrain on boot ──────────────────────────────────────

/** Tile indices matching TileAtlas.ts on the client. */
const T = {
  STONE_FLOOR: 14,
  STONE_DARK: 15,
  WALL_STONE_H: 26,
  WALL_STONE_V: 27,
  ROCK_LARGE: 51,
  DIRT_PLAIN: 6,
} as const;

const MAP_TILE_SIZE = 10; // server tile size used by mapGenerator/terrain system

/**
 * Build a GeneratedMap for the coliseum-arena zone by compositing
 * the largest arena definition. Obstacles → stone walls, hazards → dark stone,
 * floor → stone tiles, border → walls.
 */
function generateArenaTerrain(): void {
  // Use the largest arena as the master layout
  const arena = COLISEUM_MAPS.gold_coliseum ?? Object.values(COLISEUM_MAPS)[0];
  if (!arena) return;

  const w = arena.width;
  const h = arena.height;
  const ground = new Array(w * h).fill(T.STONE_FLOOR);
  const overlay = new Array(w * h).fill(-1);
  const elevation = new Array(w * h).fill(0);

  // Border walls
  for (let x = 0; x < w; x++) {
    ground[x] = T.WALL_STONE_H;           // top
    ground[(h - 1) * w + x] = T.WALL_STONE_H; // bottom
  }
  for (let y = 0; y < h; y++) {
    ground[y * w] = T.WALL_STONE_V;           // left
    ground[y * w + (w - 1)] = T.WALL_STONE_V; // right
  }

  // Paint ALL arena obstacles from every map
  for (const map of Object.values(COLISEUM_MAPS)) {
    for (const obs of map.obstacles) {
      for (let dy = 0; dy < obs.height; dy++) {
        for (let dx = 0; dx < obs.width; dx++) {
          const tx = obs.x + dx;
          const ty = obs.y + dy;
          if (tx >= 0 && tx < w && ty >= 0 && ty < h) {
            overlay[ty * w + tx] = T.ROCK_LARGE;
            elevation[ty * w + tx] = 1;
          }
        }
      }
    }
    // Hazards as dark stone
    for (const haz of map.hazards) {
      for (let dy = 0; dy < haz.height; dy++) {
        for (let dx = 0; dx < haz.width; dx++) {
          const tx = haz.x + dx;
          const ty = haz.y + dy;
          if (tx >= 0 && tx < w && ty >= 0 && ty < h) {
            ground[ty * w + tx] = T.STONE_DARK;
          }
        }
      }
    }
    // Power-ups as dirt (visual marker)
    for (const pu of map.powerUps) {
      if (pu.x >= 0 && pu.x < w && pu.y >= 0 && pu.y < h) {
        ground[pu.y * w + pu.x] = T.DIRT_PLAIN;
      }
    }
  }

  setGeneratedMap({
    zoneId: ARENA_REGION,
    width: w,
    height: h,
    tileSize: MAP_TILE_SIZE,
    ground,
    overlay,
    elevation,
    biome: "coliseum",
  });

  console.log(`[arena] Generated ${w}×${h} terrain for ${ARENA_REGION}`);
}

generateArenaTerrain();
