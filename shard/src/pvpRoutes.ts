/**
 * PvP API Routes
 * Endpoints for matchmaking, battles, and leaderboards
 */

import type { FastifyInstance } from "fastify";
import { pvpBattleManager } from "./pvpBattleManager.js";
import type { PvPFormat, MatchmakingEntry } from "./types/pvp.js";
import type { BattleAction } from "./types/battle.js";
import { getAllZones } from "./zoneRuntime.js";
import { COLISEUM_MAPS } from "./coliseumMaps.js";

export async function registerPvPRoutes(app: FastifyInstance) {
  /**
   * GET /coliseum/npc/:zoneId/:entityId
   * NPC discovery endpoint for AI agents — the main entry point for PvP.
   * Returns NPC info, available formats, queue status, active battles, arenas, and endpoints.
   */
  app.get<{ Params: { zoneId: string; entityId: string } }>(
    "/coliseum/npc/:zoneId/:entityId",
    async (request, reply) => {
      const { zoneId, entityId } = request.params;

      const zone = getAllZones().get(zoneId);
      if (!zone) {
        reply.code(404);
        return { error: "Zone not found" };
      }

      const entity = zone.entities.get(entityId);
      if (!entity || entity.type !== "arena-master") {
        reply.code(404);
        return { error: "Arena master not found" };
      }

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
    }
  );

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
  }>("/api/pvp/queue/join", async (req, reply) => {
    const { agentId, walletAddress, characterTokenId, level, format, preferredTeam } =
      req.body;

    // Validation
    if (!agentId || !walletAddress || !characterTokenId || !level || !format) {
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

    pvpBattleManager.joinQueue(entry);

    return reply.send({
      success: true,
      message: "Added to queue",
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
  }>("/api/pvp/queue/leave", async (req, reply) => {
    const { agentId, format } = req.body;

    if (!agentId || !format) {
      return reply.code(400).send({
        error: "Missing required fields: agentId, format",
      });
    }

    const removed = pvpBattleManager.leaveQueue(agentId, format);

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

    return reply.send({ battle: state });
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
  }>("/api/pvp/battle/:battleId/action", async (req, reply) => {
    const { battleId } = req.params;
    const action = req.body;

    // Validation
    if (!action.actorId || !action.actionId) {
      return reply.code(400).send({
        error: "Missing required fields: actorId, actionId",
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
   * POST /api/pvp/battle/:battleId/cancel
   * Cancel a battle (admin only - should add auth)
   */
  app.post<{
    Params: {
      battleId: string;
    };
  }>("/api/pvp/battle/:battleId/cancel", async (req, reply) => {
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
