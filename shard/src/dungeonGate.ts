/**
 * Dungeon Gate System — Core Module
 *
 * Manages dungeon instances, gate opening, key forging, and all API routes.
 * Gate surges are handled by dungeonGateTick.ts.
 */

import type { FastifyInstance } from "fastify";
import { randomUUID } from "crypto";
import {
  getAllZones,
  getOrCreateZone,
  deleteZone,
  type Entity,
} from "./zoneRuntime.js";
import { getPlayerPartyId, getPartyMembers } from "./partySystem.js";
import { getItemBalance, burnItem, mintItem } from "./blockchain.js";
import { getItemByTokenId } from "./itemCatalog.js";
import { authenticateRequest } from "./auth.js";
import { logZoneEvent } from "./zoneEvents.js";

// --- Types ---

type GateRank = "E" | "D" | "C" | "B" | "A" | "S";

export interface DungeonInstance {
  instanceId: string;
  gateRank: GateRank;
  isDangerGate: boolean;
  sourceZoneId: string;
  sourcePosition: { x: number; y: number };
  partyId: string;
  memberIds: string[];
  createdAt: number;
  expiresAt: number;
  dungeonZoneId: string;
  cleared: boolean;
  totalMobs: number;
  remainingMobs: number;
}

// --- Constants ---

const RANK_TO_KEY_TOKEN: Record<GateRank, bigint> = {
  E: 134n,
  D: 135n,
  C: 136n,
  B: 137n,
  A: 138n,
  S: 139n,
};

const RANK_LEVEL_REQUIREMENTS: Record<GateRank, number> = {
  E: 3,
  D: 7,
  C: 12,
  B: 18,
  A: 28,
  S: 40,
};

const REAGENT_TO_KEY: Record<number, number> = {
  128: 134, // Crude Gate Essence → E-Key
  129: 135, // Lesser Gate Essence → D-Key
  130: 136, // Gate Essence → C-Key
  131: 137, // Greater Gate Essence → B-Key
  132: 138, // Superior Gate Essence → A-Key
  133: 139, // Supreme Gate Essence → S-Key
};

interface MobScaling {
  hpMin: number;
  hpMax: number;
  levelMin: number;
  levelMax: number;
  mobCountMin: number;
  mobCountMax: number;
  bossHp: number;
  bossCount: number;
  timeLimitMs: number;
  xpPerMob: number;
  xpPerBoss: number;
}

const RANK_SCALING: Record<GateRank, MobScaling> = {
  E: {
    hpMin: 120, hpMax: 150, levelMin: 3, levelMax: 5,
    mobCountMin: 6, mobCountMax: 8, bossHp: 0, bossCount: 0,
    timeLimitMs: 10 * 60 * 1000, xpPerMob: 25, xpPerBoss: 0,
  },
  D: {
    hpMin: 300, hpMax: 400, levelMin: 7, levelMax: 10,
    mobCountMin: 8, mobCountMax: 10, bossHp: 1200, bossCount: 1,
    timeLimitMs: 10 * 60 * 1000, xpPerMob: 45, xpPerBoss: 200,
  },
  C: {
    hpMin: 600, hpMax: 800, levelMin: 12, levelMax: 16,
    mobCountMin: 10, mobCountMax: 14, bossHp: 2500, bossCount: 1,
    timeLimitMs: 15 * 60 * 1000, xpPerMob: 70, xpPerBoss: 400,
  },
  B: {
    hpMin: 1200, hpMax: 1500, levelMin: 18, levelMax: 24,
    mobCountMin: 12, mobCountMax: 16, bossHp: 5000, bossCount: 1,
    timeLimitMs: 15 * 60 * 1000, xpPerMob: 110, xpPerBoss: 700,
  },
  A: {
    hpMin: 2200, hpMax: 2800, levelMin: 28, levelMax: 36,
    mobCountMin: 14, mobCountMax: 18, bossHp: 10000, bossCount: 2,
    timeLimitMs: 20 * 60 * 1000, xpPerMob: 170, xpPerBoss: 1200,
  },
  S: {
    hpMin: 4000, hpMax: 5000, levelMin: 40, levelMax: 50,
    mobCountMin: 16, mobCountMax: 20, bossHp: 20000, bossCount: 3,
    timeLimitMs: 20 * 60 * 1000, xpPerMob: 250, xpPerBoss: 2000,
  },
};

// Mob names by rank for loot table linkage
const MOB_NAMES: Record<GateRank, { regular: string[]; boss: string }> = {
  E: { regular: ["Dungeon Rat", "Dungeon Bat", "Dungeon Slime"], boss: "" },
  D: { regular: ["Dungeon Skeleton", "Dungeon Spider"], boss: "Dungeon Guardian D" },
  C: { regular: ["Dungeon Wraith", "Dungeon Golem"], boss: "Dungeon Guardian C" },
  B: { regular: ["Dungeon Reaver", "Dungeon Necromancer"], boss: "Dungeon Guardian B" },
  A: { regular: ["Dungeon Abomination", "Dungeon Lich"], boss: "Dungeon Guardian A" },
  S: { regular: ["Dungeon Void Walker", "Dungeon Dread Knight"], boss: "Dungeon Guardian S" },
};

const DUNGEON_SIZE = 400;
const GATE_PROXIMITY = 50; // Must be within 50 units of gate

// --- In-memory dungeon instances ---

const dungeonInstances = new Map<string, DungeonInstance>();

export function getDungeonInstances(): Map<string, DungeonInstance> {
  return dungeonInstances;
}

// --- Helpers ---

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function distance(x1: number, y1: number, x2: number, y2: number): number {
  return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
}

function spawnDungeonMobs(
  dungeonZoneId: string,
  rank: GateRank,
  isDanger: boolean
): { totalMobs: number } {
  const zone = getOrCreateZone(dungeonZoneId);
  const scaling = RANK_SCALING[rank];
  const names = MOB_NAMES[rank];
  const dangerHpMult = isDanger ? 1.5 : 1.0;
  const dangerXpMult = isDanger ? 1.3 : 1.0;

  const mobCount = randomInt(scaling.mobCountMin, scaling.mobCountMax);
  let totalSpawned = 0;

  // Spawn regular mobs in 3 room clusters
  const rooms = [
    { cx: 100, cy: 100 }, // Room 1
    { cx: 300, cy: 100 }, // Room 2
    { cx: 200, cy: 250 }, // Room 3
  ];

  const mobsPerRoom = Math.ceil(mobCount / rooms.length);

  for (const room of rooms) {
    for (let i = 0; i < mobsPerRoom && totalSpawned < mobCount; i++) {
      const mobName = names.regular[Math.floor(Math.random() * names.regular.length)];
      const hp = Math.round(randomInt(scaling.hpMin, scaling.hpMax) * dangerHpMult);
      const level = randomInt(scaling.levelMin, scaling.levelMax);

      const mob: Entity = {
        id: randomUUID(),
        type: "mob",
        name: mobName,
        x: room.cx + randomInt(-40, 40),
        y: room.cy + randomInt(-40, 40),
        hp,
        maxHp: hp,
        createdAt: Date.now(),
        level,
        xpReward: Math.round(scaling.xpPerMob * dangerXpMult),
        mobName: mobName, // for loot table lookup
      };

      zone.entities.set(mob.id, mob);
      totalSpawned++;
    }
  }

  // Spawn boss(es) in boss room
  if (scaling.bossCount > 0 && names.boss) {
    const bossRoom = { cx: 200, cy: 360 };

    for (let i = 0; i < scaling.bossCount; i++) {
      const bossHp = Math.round(scaling.bossHp * dangerHpMult);
      const boss: Entity = {
        id: randomUUID(),
        type: "mob",
        name: names.boss,
        x: bossRoom.cx + randomInt(-30, 30),
        y: bossRoom.cy + randomInt(-20, 20),
        hp: bossHp,
        maxHp: bossHp,
        createdAt: Date.now(),
        level: scaling.levelMax,
        xpReward: Math.round(scaling.xpPerBoss * dangerXpMult),
        mobName: names.boss,
      };

      zone.entities.set(boss.id, boss);
      totalSpawned++;
    }
  }

  return { totalMobs: totalSpawned };
}

/**
 * Cleanup a dungeon instance — teleport players back, delete zone.
 * Called by dungeonGateTick on clear or timeout.
 */
export function cleanupDungeonInstance(instanceId: string, cleared: boolean): void {
  const instance = dungeonInstances.get(instanceId);
  if (!instance) return;

  instance.cleared = cleared;

  // Teleport all surviving party members back to source zone
  const dungeonZone = getAllZones().get(instance.dungeonZoneId);
  const sourceZone = getOrCreateZone(instance.sourceZoneId);

  if (dungeonZone) {
    for (const [entityId, entity] of dungeonZone.entities) {
      if (entity.type === "player") {
        // Move player to source zone
        entity.x = instance.sourcePosition.x + randomInt(-20, 20);
        entity.y = instance.sourcePosition.y + randomInt(-20, 20);
        sourceZone.entities.set(entityId, entity);
      }
    }
  }

  // Log event
  logZoneEvent({
    zoneId: instance.sourceZoneId,
    type: "system",
    tick: sourceZone.tick,
    message: cleared
      ? `A party has conquered the Rank ${instance.gateRank} dungeon!`
      : `A party was expelled from the Rank ${instance.gateRank} dungeon (time expired).`,
  });

  // Delete dungeon zone
  deleteZone(instance.dungeonZoneId);
  dungeonInstances.delete(instanceId);

  console.log(
    `[dungeon] Instance ${instanceId} ${cleared ? "CLEARED" : "TIMED OUT"} and cleaned up`
  );
}

// --- Route Registration ---

export function registerDungeonGateRoutes(server: FastifyInstance): void {
  // GET /dungeon/gates/:zoneId — List active gates in zone
  server.get<{ Params: { zoneId: string } }>(
    "/dungeon/gates/:zoneId",
    async (request, reply) => {
      const { zoneId } = request.params;
      const zone = getAllZones().get(zoneId);
      if (!zone) {
        reply.code(404);
        return { error: "Zone not found" };
      }

      const gates = [...zone.entities.values()]
        .filter((e) => e.type === "dungeon-gate" && !e.gateOpened)
        .map((e) => ({
          entityId: e.id,
          rank: e.gateRank,
          isDangerGate: e.isDangerGate ?? false,
          x: e.x,
          y: e.y,
          expiresAt: e.gateExpiresAt,
          requiredKeyTokenId: e.gateRank ? RANK_TO_KEY_TOKEN[e.gateRank].toString() : undefined,
          requiredLevel: e.gateRank ? RANK_LEVEL_REQUIREMENTS[e.gateRank] : undefined,
        }));

      return { zoneId, gates };
    }
  );

  // GET /dungeon/keys — Discovery: key recipes + requirements
  server.get("/dungeon/keys", async () => {
    const ranks: GateRank[] = ["E", "D", "C", "B", "A", "S"];
    return ranks.map((rank) => {
      const keyTokenId = RANK_TO_KEY_TOKEN[rank];
      const keyItem = getItemByTokenId(keyTokenId);
      const reagentTokenId = keyTokenId - 6n;
      const reagentItem = getItemByTokenId(reagentTokenId);

      return {
        rank,
        requiredLevel: RANK_LEVEL_REQUIREMENTS[rank],
        key: {
          tokenId: keyTokenId.toString(),
          name: keyItem?.name ?? "Unknown",
        },
        reagent: {
          tokenId: reagentTokenId.toString(),
          name: reagentItem?.name ?? "Unknown",
        },
        forgeEndpoint: "POST /dungeon/forge-key",
        timeLimit: RANK_SCALING[rank].timeLimitMs / 1000 + "s",
        mobCount: `${RANK_SCALING[rank].mobCountMin}-${RANK_SCALING[rank].mobCountMax}`,
        bossCount: RANK_SCALING[rank].bossCount,
      };
    });
  });

  // POST /dungeon/forge-key — Enchant reagent into key at altar
  server.post<{
    Body: {
      walletAddress: string;
      zoneId: string;
      entityId: string;
      altarId: string;
      reagentTokenId: number;
    };
  }>("/dungeon/forge-key", {
    preHandler: authenticateRequest,
  }, async (request, reply) => {
    const { walletAddress, zoneId, entityId, altarId, reagentTokenId } = request.body;
    const authenticatedWallet = (request as any).walletAddress;

    if (!walletAddress || !/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
      reply.code(400);
      return { error: "Invalid wallet address" };
    }

    if (walletAddress.toLowerCase() !== authenticatedWallet.toLowerCase()) {
      reply.code(403);
      return { error: "Not authorized to use this wallet" };
    }

    // Validate reagent token ID
    const keyTokenId = REAGENT_TO_KEY[reagentTokenId];
    if (!keyTokenId) {
      reply.code(400);
      return {
        error: "Invalid reagent token ID",
        validReagents: Object.keys(REAGENT_TO_KEY).map(Number),
      };
    }

    const zone = getAllZones().get(zoneId);
    if (!zone) {
      reply.code(404);
      return { error: "Zone not found" };
    }

    const entity = zone.entities.get(entityId);
    if (!entity || entity.type !== "player") {
      reply.code(404);
      return { error: "Player entity not found" };
    }

    // Find enchanting altar
    const altar = zone.entities.get(altarId);
    if (!altar || altar.type !== "enchanting-altar") {
      reply.code(404);
      return { error: "Enchanting altar not found" };
    }

    // Proximity check
    const dist = distance(entity.x, entity.y, altar.x, altar.y);
    if (dist > 100) {
      reply.code(400);
      return {
        error: "Too far from enchanting altar",
        distance: Math.round(dist),
        maxRange: 100,
      };
    }

    // Burn reagent
    try {
      await burnItem(walletAddress, BigInt(reagentTokenId), 1n);
    } catch (err) {
      server.log.error(err, `[dungeon] Failed to burn reagent ${reagentTokenId}`);
      reply.code(500);
      return { error: "Failed to consume reagent — you may not have one" };
    }

    // Mint key
    try {
      const tx = await mintItem(walletAddress, BigInt(keyTokenId), 1n);
      const keyItem = getItemByTokenId(BigInt(keyTokenId));
      const reagentItem = getItemByTokenId(BigInt(reagentTokenId));

      server.log.info(
        `[dungeon] ${entity.name} forged ${keyItem?.name} from ${reagentItem?.name} → ${tx}`
      );

      return {
        ok: true,
        forged: {
          tokenId: keyTokenId.toString(),
          name: keyItem?.name ?? "Unknown",
          tx,
        },
        consumed: {
          tokenId: reagentTokenId.toString(),
          name: reagentItem?.name ?? "Unknown",
        },
      };
    } catch (err) {
      server.log.error(err, `[dungeon] Failed to mint key ${keyTokenId}`);
      reply.code(500);
      return {
        error: "Key forging failed — reagent was consumed but key creation failed",
        warning: "Contact support for refund",
      };
    }
  });

  // POST /dungeon/open — Open gate and enter dungeon
  server.post<{
    Body: {
      walletAddress: string;
      zoneId: string;
      entityId: string;
      gateEntityId: string;
    };
  }>("/dungeon/open", {
    preHandler: authenticateRequest,
  }, async (request, reply) => {
    const { walletAddress, zoneId, entityId, gateEntityId } = request.body;
    const authenticatedWallet = (request as any).walletAddress;

    if (!walletAddress || !/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
      reply.code(400);
      return { error: "Invalid wallet address" };
    }

    if (walletAddress.toLowerCase() !== authenticatedWallet.toLowerCase()) {
      reply.code(403);
      return { error: "Not authorized to use this wallet" };
    }

    const zone = getAllZones().get(zoneId);
    if (!zone) {
      reply.code(404);
      return { error: "Zone not found" };
    }

    // Validate gate
    const gate = zone.entities.get(gateEntityId);
    if (!gate || gate.type !== "dungeon-gate") {
      reply.code(404);
      return { error: "Dungeon gate not found" };
    }

    if (gate.gateOpened) {
      reply.code(400);
      return { error: "Gate has already been opened" };
    }

    if (gate.gateExpiresAt && gate.gateExpiresAt < Date.now()) {
      reply.code(400);
      return { error: "Gate has expired" };
    }

    const rank = gate.gateRank!;
    const isDanger = gate.isDangerGate ?? false;

    // Validate player entity
    const player = zone.entities.get(entityId);
    if (!player || player.type !== "player") {
      reply.code(404);
      return { error: "Player entity not found" };
    }

    // Player must be in a party
    const partyId = getPlayerPartyId(entityId);
    if (!partyId) {
      reply.code(400);
      return { error: "You must be in a party to open a dungeon gate" };
    }

    // Get all party members
    const memberIds = getPartyMembers(entityId);

    // Validate all party members
    const minLevel = RANK_LEVEL_REQUIREMENTS[rank];
    const keyTokenId = RANK_TO_KEY_TOKEN[rank];

    for (const memberId of memberIds) {
      const member = zone.entities.get(memberId);
      if (!member) {
        reply.code(400);
        return { error: `Party member ${memberId} is not in this zone` };
      }

      // Check proximity to gate
      const dist = distance(member.x, member.y, gate.x, gate.y);
      if (dist > GATE_PROXIMITY) {
        reply.code(400);
        return {
          error: `Party member ${member.name} is too far from the gate`,
          memberName: member.name,
          distance: Math.round(dist),
          maxRange: GATE_PROXIMITY,
        };
      }

      // Check level
      if ((member.level ?? 1) < minLevel) {
        reply.code(400);
        return {
          error: `Party member ${member.name} does not meet level requirement`,
          memberName: member.name,
          memberLevel: member.level ?? 1,
          requiredLevel: minLevel,
        };
      }
    }

    // Check key balance
    const keyBalance = await getItemBalance(walletAddress, keyTokenId);
    if (keyBalance < 1n) {
      const keyItem = getItemByTokenId(keyTokenId);
      reply.code(400);
      return {
        error: `You need a ${keyItem?.name ?? "key"} to open this gate`,
        requiredKeyTokenId: keyTokenId.toString(),
      };
    }

    // Burn key
    try {
      await burnItem(walletAddress, keyTokenId, 1n);
    } catch (err) {
      server.log.error(err, `[dungeon] Failed to burn key ${keyTokenId}`);
      reply.code(500);
      return { error: "Failed to consume key" };
    }

    // Create dungeon instance
    const instanceId = randomUUID();
    const dungeonZoneId = `dungeon-${instanceId}`;
    const scaling = RANK_SCALING[rank];

    // Spawn mobs in dungeon zone
    const { totalMobs } = spawnDungeonMobs(dungeonZoneId, rank, isDanger);

    const instance: DungeonInstance = {
      instanceId,
      gateRank: rank,
      isDangerGate: isDanger,
      sourceZoneId: zoneId,
      sourcePosition: { x: gate.x, y: gate.y },
      partyId,
      memberIds: [...memberIds],
      createdAt: Date.now(),
      expiresAt: Date.now() + scaling.timeLimitMs,
      dungeonZoneId,
      cleared: false,
      totalMobs,
      remainingMobs: totalMobs,
    };

    dungeonInstances.set(instanceId, instance);

    // Mark gate as opened
    gate.gateOpened = true;

    // Teleport all party members into dungeon
    const dungeonZone = getOrCreateZone(dungeonZoneId);
    const spawnX = 200;
    const spawnY = 20;

    for (const memberId of memberIds) {
      const member = zone.entities.get(memberId);
      if (member) {
        zone.entities.delete(memberId);
        member.x = spawnX + randomInt(-15, 15);
        member.y = spawnY + randomInt(-10, 10);
        dungeonZone.entities.set(memberId, member);
      }
    }

    // Log events
    logZoneEvent({
      zoneId,
      type: "system",
      tick: zone.tick,
      message: `A party has entered a Rank ${rank}${isDanger ? " DANGER" : ""} dungeon gate!`,
    });

    logZoneEvent({
      zoneId: dungeonZoneId,
      type: "system",
      tick: 0,
      message: `Dungeon instance started! ${totalMobs} enemies await. Time limit: ${scaling.timeLimitMs / 60000} minutes.`,
    });

    server.log.info(
      `[dungeon] Instance ${instanceId} created: Rank ${rank}${isDanger ? " DANGER" : ""}, ${totalMobs} mobs, ${memberIds.length} players`
    );

    return {
      ok: true,
      instanceId,
      dungeonZoneId,
      rank,
      isDangerGate: isDanger,
      totalMobs,
      timeLimitSeconds: scaling.timeLimitMs / 1000,
      expiresAt: instance.expiresAt,
      members: memberIds,
    };
  });

  // GET /dungeon/instance/:instanceId — Dungeon instance status
  server.get<{ Params: { instanceId: string } }>(
    "/dungeon/instance/:instanceId",
    async (request, reply) => {
      const { instanceId } = request.params;
      const instance = dungeonInstances.get(instanceId);

      if (!instance) {
        reply.code(404);
        return { error: "Dungeon instance not found" };
      }

      const dungeonZone = getAllZones().get(instance.dungeonZoneId);
      const remainingMobs = dungeonZone
        ? [...dungeonZone.entities.values()].filter((e) => e.type === "mob" && e.hp > 0).length
        : 0;

      return {
        instanceId: instance.instanceId,
        rank: instance.gateRank,
        isDangerGate: instance.isDangerGate,
        dungeonZoneId: instance.dungeonZoneId,
        sourceZoneId: instance.sourceZoneId,
        members: instance.memberIds,
        totalMobs: instance.totalMobs,
        remainingMobs,
        cleared: instance.cleared,
        createdAt: instance.createdAt,
        expiresAt: instance.expiresAt,
        timeRemainingMs: Math.max(0, instance.expiresAt - Date.now()),
      };
    }
  );

  // GET /dungeon/active — List all active instances
  server.get("/dungeon/active", async () => {
    const instances = [...dungeonInstances.values()].map((inst) => {
      const dungeonZone = getAllZones().get(inst.dungeonZoneId);
      const remainingMobs = dungeonZone
        ? [...dungeonZone.entities.values()].filter((e) => e.type === "mob" && e.hp > 0).length
        : 0;

      return {
        instanceId: inst.instanceId,
        rank: inst.gateRank,
        isDangerGate: inst.isDangerGate,
        members: inst.memberIds,
        totalMobs: inst.totalMobs,
        remainingMobs,
        cleared: inst.cleared,
        timeRemainingMs: Math.max(0, inst.expiresAt - Date.now()),
      };
    });

    return { active: instances, count: instances.length };
  });

  // POST /dungeon/leave — Leave dungeon early
  server.post<{
    Body: {
      walletAddress: string;
      entityId: string;
    };
  }>("/dungeon/leave", {
    preHandler: authenticateRequest,
  }, async (request, reply) => {
    const { walletAddress, entityId } = request.body;
    const authenticatedWallet = (request as any).walletAddress;

    if (!walletAddress || !/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
      reply.code(400);
      return { error: "Invalid wallet address" };
    }

    if (walletAddress.toLowerCase() !== authenticatedWallet.toLowerCase()) {
      reply.code(403);
      return { error: "Not authorized to use this wallet" };
    }

    // Find which dungeon instance this player is in
    let foundInstance: DungeonInstance | undefined;
    let foundZoneId: string | undefined;

    for (const [zoneId, zone] of getAllZones()) {
      if (zoneId.startsWith("dungeon-") && zone.entities.has(entityId)) {
        foundZoneId = zoneId;
        // Find the instance for this dungeon zone
        for (const inst of dungeonInstances.values()) {
          if (inst.dungeonZoneId === zoneId) {
            foundInstance = inst;
            break;
          }
        }
        break;
      }
    }

    if (!foundInstance || !foundZoneId) {
      reply.code(400);
      return { error: "You are not in a dungeon" };
    }

    const dungeonZone = getAllZones().get(foundZoneId);
    if (!dungeonZone) {
      reply.code(500);
      return { error: "Dungeon zone not found" };
    }

    const player = dungeonZone.entities.get(entityId);
    if (!player) {
      reply.code(404);
      return { error: "Player entity not found in dungeon" };
    }

    // Verify wallet
    if (player.walletAddress?.toLowerCase() !== walletAddress.toLowerCase()) {
      reply.code(403);
      return { error: "Not authorized to control this entity" };
    }

    // Teleport player back to source zone
    const sourceZone = getOrCreateZone(foundInstance.sourceZoneId);
    dungeonZone.entities.delete(entityId);
    player.x = foundInstance.sourcePosition.x + randomInt(-20, 20);
    player.y = foundInstance.sourcePosition.y + randomInt(-20, 20);
    sourceZone.entities.set(entityId, player);

    // Remove from instance members
    foundInstance.memberIds = foundInstance.memberIds.filter((id) => id !== entityId);

    logZoneEvent({
      zoneId: foundInstance.dungeonZoneId,
      type: "system",
      tick: 0,
      message: `${player.name} has left the dungeon.`,
    });

    // If no players left, clean up
    const remainingPlayers = [...dungeonZone.entities.values()].filter(
      (e) => e.type === "player"
    );
    if (remainingPlayers.length === 0) {
      cleanupDungeonInstance(foundInstance.instanceId, false);
    }

    return {
      ok: true,
      returnedToZone: foundInstance.sourceZoneId,
      position: { x: player.x, y: player.y },
    };
  });

  server.log.info("[dungeon] Gate routes registered");
}
