/**
 * PvP API Routes
 * Endpoints for matchmaking, battles, and leaderboards
 */

import type { FastifyInstance } from "fastify";
import { authenticateRequest } from "../auth/auth.js";
import { pvpBattleManager } from "./pvpBattleManager.js";
import type { PvPFormat, MatchmakingEntry } from "../types/pvp.js";
import type { BattleAction } from "../types/battle.js";
import { getEntity } from "../world/zoneRuntime.js";
import { COLISEUM_MAPS } from "./coliseumMaps.js";
import { getPartyMembers } from "../social/partySystem.js";

export async function registerPvPRoutes(app: FastifyInstance) {
  /**
   * GET /coliseum/npc/:entityId
   * NPC discovery endpoint for AI agents — the main entry point for PvP.
   * Returns NPC info, available formats, queue status, active battles, arenas, and endpoints.
   */
  const coliseumNpcHandler = async (request: any, reply: any) => {
    const entityId = request.params.entityId;

    const entity = getEntity(entityId);
    if (!entity || entity.type !== "arena-master") {
      reply.code(404);
      return { error: "Arena master not found" };
    }

    const zoneId = request.params.zoneId ?? entity.region ?? "unknown";

    const allQueues = pvpBattleManager.getAllQueuesStatus();
    const activeBattles = pvpBattleManager.getActiveBattles();

    const formats = [
      { format: "1v1", playersPerTeam: 1, duration: "3 min", description: "Duel — test your skill 1-on-1" },
      { format: "2v2", playersPerTeam: 2, duration: "5 min", description: "Tag team — coordinate with a partner" },
      { format: "5v5", playersPerTeam: 5, duration: "5 min", description: "Team battle — full squad warfare" },
      { format: "ffa", playersPerTeam: 1, duration: "7 min", description: "Free-For-All — last agent standing" },
    ];

    const arenas = Object.values(COLISEUM_MAPS).map((m) => ({
      mapId: m.mapId,
      name: m.name,
      size: `${m.width}x${m.height}`,
      obstacles: m.obstacles.length,
      powerUps: m.powerUps.length,
      hazards: m.hazards.length,
    }));

    return {
      npcId: entity.id,
      npcName: entity.name,
      npcType: entity.type,
      zoneId,
      description: `${entity.name} runs the PvP Coliseum in ${zoneId}. Queue up for ranked battles, place encrypted bets on matches, and climb the leaderboard.`,
      formats,
      queueStatus: allQueues,
      activeBattles,
      arenas,
      endpoints: {
        matchmaking: {
          joinQueue: { method: "POST", path: "/api/pvp/queue/join", body: "agentId, walletAddress, characterTokenId, level, format" },
          joinPartyQueue: { method: "POST", path: "/api/pvp/queue/join-party", body: "leaderId, format (2v2|5v5)" },
          leaveQueue: { method: "POST", path: "/api/pvp/queue/leave", body: "agentId, format" },
          queueStatus: { method: "GET", path: "/api/pvp/queue/status/:format" },
          allQueues: { method: "GET", path: "/api/pvp/queue/all" },
        },
        battles: {
          activeBattles: { method: "GET", path: "/api/pvp/battles/active" },
          battleState: { method: "GET", path: "/api/pvp/battle/:battleId" },
          submitAction: { method: "POST", path: "/api/pvp/battle/:battleId/action", body: "actorId, actionId, targetId?" },
        },
        stats: {
          leaderboard: { method: "GET", path: "/api/pvp/leaderboard" },
          playerStats: { method: "GET", path: "/api/pvp/stats/:agentId" },
          matchHistory: { method: "GET", path: "/api/pvp/history/:agentId" },
        },
        predictionMarket: {
          activePools: { method: "GET", path: "/api/prediction/pools/active" },
          poolDetails: { method: "GET", path: "/api/prediction/pool/:poolId" },
          placeBet: { method: "POST", path: "/api/prediction/bet", body: "poolId, choice (RED|BLUE), amount, walletAddress" },
          claimWinnings: { method: "POST", path: "/api/prediction/pool/:poolId/claim", body: "walletAddress" },
          bettingHistory: { method: "GET", path: "/api/prediction/history/:walletAddress" },
          x402Discovery: { method: "GET", path: "/api/x402/discovery" },
        },
      },
    };
  };

  app.get("/coliseum/npc/:entityId", coliseumNpcHandler);
  // Compat alias
  app.get("/coliseum/npc/:zoneId/:entityId", coliseumNpcHandler);

  /**
   * POST /api/pvp/queue/join
   * Join a matchmaking queue
   */
  app.post<{
    Body: {
      agentId: string;
      walletAddress: string;
      characterTokenId: string;
      level: number;
      format: PvPFormat;
      preferredTeam?: "red" | "blue";
    };
  }>("/api/pvp/queue/join", {
    preHandler: authenticateRequest,
  }, async (req, reply) => {
    const { agentId, walletAddress, characterTokenId, level, format, preferredTeam } =
      req.body;
    console.log(`[pvp-debug] queue/join request: agentId=${agentId} wallet=${walletAddress} level=${level} format=${format} tokenId=${characterTokenId}`);

    // Validation
    if (!agentId || !walletAddress || !characterTokenId || !level || !format) {
      console.log(`[pvp-debug] queue/join REJECTED: missing fields`);
      return reply.code(400).send({
        error: "Missing required fields: agentId, walletAddress, characterTokenId, level, format",
      });
    }

    const validFormats: PvPFormat[] = ["1v1", "2v2", "5v5", "ffa"];
    if (!validFormats.includes(format)) {
      return reply.code(400).send({
        error: `Invalid format. Must be one of: ${validFormats.join(", ")}`,
      });
    }

    // Reject if already in an active battle
    if (pvpBattleManager.isInActiveBattle(agentId)) {
      return reply.code(400).send({
        error: "Already in an active PvP battle",
      });
    }

    // Get or create player ELO
    const existingStats = pvpBattleManager.getPlayerStats(agentId);
    const elo = existingStats?.elo || 1000;

    const entry: MatchmakingEntry = {
      agentId,
      walletAddress,
      characterTokenId: BigInt(characterTokenId),
      level,
      elo,
      format,
      queuedAt: Date.now(),
      preferredTeam,
    };

    await pvpBattleManager.joinQueue(entry);
    console.log(`[pvp-debug] queue/join SUCCESS: agentId=${agentId} format=${format} elo=${elo}`);

    return reply.send({
      success: true,
      message: "Added to queue",
      queueStatus: pvpBattleManager.getQueueStatus(format),
    });
  });

  /**
   * POST /api/pvp/queue/join-party
   * Queue an entire party as a team for 2v2 or 5v5
   */
  app.post<{
    Body: {
      leaderId: string;
      format: "2v2" | "5v5";
    };
  }>("/api/pvp/queue/join-party", {
    preHandler: authenticateRequest,
  }, async (req, reply) => {
    const { leaderId, format } = req.body;

    if (!leaderId || !format) {
      return reply.code(400).send({
        error: "Missing required fields: leaderId, format",
      });
    }

    if (format !== "2v2" && format !== "5v5") {
      return reply.code(400).send({
        error: "Party queue only supports 2v2 and 5v5 formats",
      });
    }

    const requiredSize = format === "2v2" ? 2 : 5;
    const memberIds = getPartyMembers(leaderId);

    if (memberIds.length < 2 || (memberIds.length === 1 && memberIds[0] === leaderId)) {
      return reply.code(400).send({
        error: "You must be in a party to use party queue",
      });
    }

    if (memberIds.length !== requiredSize) {
      return reply.code(400).send({
        error: `Party size (${memberIds.length}) does not match format ${format} (requires ${requiredSize} members)`,
      });
    }

    // Resolve all party members from zone entities
    const groupId = `party_${leaderId}_${Date.now()}`;
    const queued: string[] = [];
    const errors: string[] = [];

    for (const memberId of memberIds) {
      // Find this member in the unified entity map
      let memberEntity: any = null;
      const entity = getEntity(memberId);
      if (entity && entity.type === "player") {
        memberEntity = entity;
      }

      if (!memberEntity) {
        errors.push(`Member ${memberId} not found online`);
        continue;
      }

      if (pvpBattleManager.isInActiveBattle(memberId)) {
        errors.push(`${memberEntity.name} is already in an active PvP battle`);
        continue;
      }

      const existingStats = pvpBattleManager.getPlayerStats(memberId);
      const elo = existingStats?.elo || 1000;

      const entry: MatchmakingEntry = {
        agentId: memberId,
        walletAddress: memberEntity.walletAddress ?? "",
        characterTokenId: memberEntity.characterTokenId ?? 0n,
        level: memberEntity.level ?? 1,
        elo,
        format,
        queuedAt: Date.now(),
        groupId,
      };

      await pvpBattleManager.joinQueue(entry);
      queued.push(memberEntity.name);
    }

    if (errors.length > 0 && queued.length === 0) {
      return reply.code(400).send({
        error: "No party members could be queued",
        details: errors,
      });
    }

    return reply.send({
      success: true,
      message: `Party queued for ${format}`,
      groupId,
      queued,
      errors: errors.length > 0 ? errors : undefined,
      queueStatus: pvpBattleManager.getQueueStatus(format),
    });
  });

  /**
   * POST /api/pvp/queue/leave
   * Leave a matchmaking queue
   */
  app.post<{
    Body: {
      agentId: string;
      format: PvPFormat;
    };
  }>("/api/pvp/queue/leave", {
    preHandler: authenticateRequest,
  }, async (req, reply) => {
    const { agentId, format } = req.body;

    if (!agentId || !format) {
      return reply.code(400).send({
        error: "Missing required fields: agentId, format",
      });
    }

    const removed = await pvpBattleManager.leaveQueue(agentId, format);

    return reply.send({
      success: removed,
      message: removed ? "Removed from queue" : "Not in queue",
    });
  });

  /**
   * GET /api/pvp/queue/status/:format
   * Get queue status for a format
   */
  app.get<{
    Params: {
      format: PvPFormat;
    };
  }>("/api/pvp/queue/status/:format", async (req, reply) => {
    const { format } = req.params;

    try {
      const status = pvpBattleManager.getQueueStatus(format);
      return reply.send(status);
    } catch (error) {
      return reply.code(400).send({
        error: (error as Error).message,
      });
    }
  });

  /**
   * GET /api/pvp/queue/all
   * Get status of all queues
   */
  app.get("/api/pvp/queue/all", async (req, reply) => {
    const status = pvpBattleManager.getAllQueuesStatus();
    return reply.send({ queues: status });
  });

  /**
   * GET /api/pvp/battles/active
   * Get all active battles
   */
  app.get("/api/pvp/battles/active", async (req, reply) => {
    const battles = pvpBattleManager.getActiveBattles();
    return reply.send({ battles });
  });

  /**
   * GET /api/pvp/battle/:battleId
   * Get battle state
   */
  app.get<{
    Params: {
      battleId: string;
    };
  }>("/api/pvp/battle/:battleId", async (req, reply) => {
    const { battleId } = req.params;

    const state = pvpBattleManager.getBattleState(battleId);

    if (!state) {
      return reply.code(404).send({
        error: "Battle not found",
      });
    }

    const poolId = pvpBattleManager.getPoolForBattle(battleId);
    return reply.send({ battle: state, poolId: poolId ?? null });
  });

  /**
   * POST /api/pvp/battle/:battleId/action
   * Submit an action to a battle
   */
  app.post<{
    Params: {
      battleId: string;
    };
    Body: BattleAction;
  }>("/api/pvp/battle/:battleId/action", {
    preHandler: authenticateRequest,
  }, async (req, reply) => {
    const { battleId } = req.params;
    const action = req.body;

    // Validation
    if (!action.actorId || !action.type) {
      return reply.code(400).send({
        error: "Missing required fields: actorId, type",
      });
    }

    const state = pvpBattleManager.submitBattleAction(battleId, action);

    if (!state) {
      return reply.code(404).send({
        error: "Battle not found",
      });
    }

    return reply.send({ battle: state });
  });

  /**
   * GET /api/pvp/leaderboard
   * Get PvP leaderboard
   */
  app.get<{
    Querystring: {
      limit?: string;
    };
  }>("/api/pvp/leaderboard", async (req, reply) => {
    const limit = req.query.limit ? parseInt(req.query.limit) : 100;

    const leaderboard = pvpBattleManager.getLeaderboard(limit);

    return reply.send({ leaderboard });
  });

  /**
   * GET /api/pvp/stats/:agentId
   * Get player stats
   */
  app.get<{
    Params: {
      agentId: string;
    };
  }>("/api/pvp/stats/:agentId", async (req, reply) => {
    const { agentId } = req.params;

    const stats = pvpBattleManager.getPlayerStats(agentId);

    if (!stats) {
      return reply.code(404).send({
        error: "Player not found",
      });
    }

    return reply.send({ stats });
  });

  /**
   * GET /api/pvp/history/:agentId
   * Get player match history
   */
  app.get<{
    Params: {
      agentId: string;
    };
    Querystring: {
      limit?: string;
    };
  }>("/api/pvp/history/:agentId", async (req, reply) => {
    const { agentId } = req.params;
    const limit = req.query.limit ? parseInt(req.query.limit) : 20;

    const history = pvpBattleManager.getPlayerMatchHistory(agentId, limit);

    return reply.send({ history });
  });

  /**
   * GET /api/pvp/player/:agentId/current-battle
   * Check if a player is currently in an active battle
   */
  app.get<{
    Params: {
      agentId: string;
    };
  }>("/api/pvp/player/:agentId/current-battle", async (req, reply) => {
    const { agentId } = req.params;

    const activeBattle = pvpBattleManager.getActiveBattleForPlayer(agentId);

    if (!activeBattle) {
      return reply.send({ inBattle: false, battleId: null, status: null });
    }

    const poolId = pvpBattleManager.getPoolForBattle(activeBattle.battleId);
    return reply.send({
      inBattle: true,
      battleId: activeBattle.battleId,
      status: activeBattle.status,
      poolId: poolId ?? null,
    });
  });

  /**
   * POST /api/pvp/battle/:battleId/cancel
   * Cancel a battle (admin only - should add auth)
   */
  app.post<{
    Params: {
      battleId: string;
    };
  }>("/api/pvp/battle/:battleId/cancel", {
    preHandler: authenticateRequest,
  }, async (req, reply) => {
    const { battleId } = req.params;

    const cancelled = pvpBattleManager.cancelBattle(battleId);

    if (!cancelled) {
      return reply.code(404).send({
        error: "Battle not found or already completed",
      });
    }

    return reply.send({
      success: true,
      message: "Battle cancelled",
    });
  });
}
