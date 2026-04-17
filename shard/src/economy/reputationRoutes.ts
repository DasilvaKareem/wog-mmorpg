 /**
  * Reputation API Routes
 * ERC-8004 reputation system endpoints keyed by agentId
 */

import type { FastifyInstance } from "fastify";
import { authenticateRequest } from "../auth/auth.js";
import { getEntityAgentId } from "../erc8004/agentResolution.js";
import { reputationManager, ReputationCategory } from "./reputationManager.js";
import { getValidationClaims } from "../erc8004/validation.js";
import { getAllEntities } from "../world/zoneRuntime.js";
import { SKALE_BASE_CHAIN_ID } from "../blockchain/biteChain.js";
import { getCharacterProjectionByAgentId } from "../character/characterProjectionStore.js";

export async function registerReputationRoutes(app: FastifyInstance) {
  /**
   * GET /api/agents/:agentId/identity
   * Get the resolved ERC-8004 identity surface for an agent
   */
  app.get<{
    Params: { agentId: string };
  }>("/api/agents/:agentId/identity", async (req, reply) => {
    const normalizedAgentId = req.params.agentId.trim();
    try {
      BigInt(normalizedAgentId);
    } catch {
      return reply.code(400).send({ error: "Invalid agentId" });
    }

    const liveEntity = Array.from(getAllEntities().values()).find(
      (entity) => entity.type === "player" && getEntityAgentId(entity) === normalizedAgentId
    );
    const projection = await getCharacterProjectionByAgentId(normalizedAgentId);

    if (!projection && !liveEntity) {
      return reply.code(404).send({ error: "Identity not found for this agent" });
    }

    return reply.send({
      identity: {
        agentId: normalizedAgentId,
        ownerWallet: projection?.walletAddress ?? liveEntity?.walletAddress ?? null,
        endpoint: null,
        characterTokenId:
          projection?.characterTokenId ??
          liveEntity?.characterTokenId?.toString() ??
          null,
        registrationTxHash: projection?.agentRegistrationTxHash ?? null,
        chainId: SKALE_BASE_CHAIN_ID,
        name: projection?.characterName ?? liveEntity?.name ?? null,
        classId: projection?.classId ?? liveEntity?.classId ?? null,
        raceId: projection?.raceId ?? liveEntity?.raceId ?? null,
        level: projection?.level ?? liveEntity?.level ?? null,
        zone: projection?.zoneId ?? liveEntity?.region ?? null,
        onChainRegistered: projection?.chainRegistrationStatus === "registered",
      },
    });
  });

  /**
   * GET /api/agents/:agentId/reputation
   * Get reputation score for an agent
   */
  app.get<{
    Params: { agentId: string };
  }>("/api/agents/:agentId/reputation", async (req, reply) => {
    const { agentId } = req.params;

    const reputation = await reputationManager.getEventuallyConsistentReputation(agentId);
    if (!reputation) {
      return reply.code(404).send({
        error: "Reputation not found for this agent",
      });
    }

    const rank = reputationManager.getReputationRank(reputation.overall);

    return reply.send({
      reputation: { ...reputation, rank },
    });
  });

  /**
   * GET /api/agents/:agentId/reputation/history
   * Get reputation feedback history
   */
  app.get<{
    Params: { agentId: string };
    Querystring: { limit?: string };
  }>("/api/agents/:agentId/reputation/history", async (req, reply) => {
    const { agentId } = req.params;
    const limit = req.query.limit ? parseInt(req.query.limit) : 20;

    const history = reputationManager.getFeedbackHistory(agentId, limit);

    return reply.send({
      history: history.map((feedback) => ({
        submitter: feedback.submitter,
        agentId: feedback.agentId,
        category: ReputationCategory[feedback.category],
        delta: feedback.delta,
        reason: feedback.reason,
        timestamp: feedback.timestamp,
      })),
    });
  });

  /**
   * GET /api/agents/:agentId/reputation/timeline
   * Get reputation score snapshots over time (for graph)
   */
  app.get<{
    Params: { agentId: string };
    Querystring: { limit?: string };
  }>("/api/agents/:agentId/reputation/timeline", async (req, reply) => {
    const { agentId } = req.params;
    const limit = req.query.limit ? parseInt(req.query.limit) : 100;
    const timeline = await reputationManager.getTimeline(agentId, limit);
    return reply.send({ timeline });
  });

  /**
   * GET /api/agents/:agentId/validations
   * Get validation claims for an agent
   */
  app.get<{
    Params: { agentId: string };
  }>("/api/agents/:agentId/validations", async (req, reply) => {
    const { agentId } = req.params;
    const validations = await getValidationClaims(agentId);
    return reply.send({ validations });
  });

  /**
   * POST /api/agents/:agentId/reputation/feedback
   * Submit reputation feedback (admin/system only)
   */
  app.post<{
    Params: { agentId: string };
    Body: {
      category: string;
      delta: number;
      reason: string;
    };
  }>("/api/agents/:agentId/reputation/feedback", {
    preHandler: authenticateRequest,
  }, async (req, reply) => {
    const { agentId } = req.params;
    const { category, delta, reason } = req.body;

    if (!agentId || !category || delta === undefined || !reason) {
      return reply.code(400).send({
        error: "Missing required fields: agentId, category, delta, reason",
      });
    }

    let categoryEnum: ReputationCategory;
    switch (category.toLowerCase()) {
      case "combat":
        categoryEnum = ReputationCategory.Combat;
        break;
      case "economic":
        categoryEnum = ReputationCategory.Economic;
        break;
      case "social":
        categoryEnum = ReputationCategory.Social;
        break;
      case "crafting":
        categoryEnum = ReputationCategory.Crafting;
        break;
      case "agent":
        categoryEnum = ReputationCategory.Agent;
        break;
      default:
        return reply.code(400).send({
          error: "Invalid category. Must be: combat, economic, social, crafting, or agent",
        });
    }

    reputationManager.submitFeedback(agentId, categoryEnum, delta, reason);

    return reply.send({
      success: true,
      message: "Reputation feedback submitted",
    });
  });

  /**
   * POST /api/agents/:agentId/reputation/batch-update
   * Batch update multiple reputation categories
   */
  app.post<{
    Params: { agentId: string };
    Body: {
      deltas: {
        combat?: number;
        economic?: number;
        social?: number;
        crafting?: number;
        agent?: number;
      };
      reason: string;
    };
  }>("/api/agents/:agentId/reputation/batch-update", {
    preHandler: authenticateRequest,
  }, async (req, reply) => {
    const { agentId } = req.params;
    const { deltas, reason } = req.body;

    if (!agentId || !deltas || !reason) {
      return reply.code(400).send({
        error: "Missing required fields: agentId, deltas, reason",
      });
    }

    reputationManager.batchUpdateReputation(agentId, deltas, reason);

    return reply.send({
      success: true,
      message: "Reputation batch updated",
    });
  });

  /**
   * GET /api/reputation/ranks
   * Get all reputation rank tiers
   */
  app.get("/api/reputation/ranks", async (_req, reply) => {
    return reply.send({
      ranks: [
        { score: 900, name: "Legendary Hero", color: "#FFD700" },
        { score: 800, name: "Renowned Champion", color: "#9B59B6" },
        { score: 700, name: "Trusted Veteran", color: "#3498DB" },
        { score: 600, name: "Reliable Ally", color: "#2ECC71" },
        { score: 500, name: "Average Citizen", color: "#95A5A6" },
        { score: 400, name: "Questionable", color: "#F39C12" },
        { score: 300, name: "Untrustworthy", color: "#E67E22" },
        { score: 0, name: "Notorious", color: "#E74C3C" },
      ],
    });
  });
}
