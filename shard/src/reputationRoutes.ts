/**
 * Reputation API Routes
 * ERC-8004 reputation system endpoints (in-memory, keyed by wallet address)
 */

import type { FastifyInstance } from "fastify";
import { reputationManager, ReputationCategory } from "./reputationManager.js";

export async function registerReputationRoutes(app: FastifyInstance) {
  /**
   * GET /api/reputation/:walletAddress
   * Get reputation score for a player
   */
  app.get<{
    Params: { walletAddress: string };
  }>("/api/reputation/:walletAddress", async (req, reply) => {
    const { walletAddress } = req.params;

    const reputation = reputationManager.getReputation(walletAddress);
    if (!reputation) {
      return reply.code(404).send({
        error: "Reputation not found for this wallet",
      });
    }

    const rank = reputationManager.getReputationRank(reputation.overall);

    return reply.send({
      reputation: { ...reputation, rank },
    });
  });

  /**
   * GET /api/reputation/:walletAddress/history
   * Get reputation feedback history
   */
  app.get<{
    Params: { walletAddress: string };
    Querystring: { limit?: string };
  }>("/api/reputation/:walletAddress/history", async (req, reply) => {
    const { walletAddress } = req.params;
    const limit = req.query.limit ? parseInt(req.query.limit) : 20;

    const history = reputationManager.getFeedbackHistory(walletAddress, limit);

    return reply.send({
      history: history.map((feedback) => ({
        submitter: feedback.submitter,
        walletAddress: feedback.walletAddress,
        category: ReputationCategory[feedback.category],
        delta: feedback.delta,
        reason: feedback.reason,
        timestamp: feedback.timestamp,
      })),
    });
  });

  /**
   * POST /api/reputation/feedback
   * Submit reputation feedback (admin/system only)
   */
  app.post<{
    Body: {
      walletAddress: string;
      category: string;
      delta: number;
      reason: string;
    };
  }>("/api/reputation/feedback", async (req, reply) => {
    const { walletAddress, category, delta, reason } = req.body;

    if (!walletAddress || !category || delta === undefined || !reason) {
      return reply.code(400).send({
        error: "Missing required fields: walletAddress, category, delta, reason",
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

    reputationManager.submitFeedback(walletAddress, categoryEnum, delta, reason);

    return reply.send({
      success: true,
      message: "Reputation feedback submitted",
    });
  });

  /**
   * POST /api/reputation/batch-update
   * Batch update multiple reputation categories
   */
  app.post<{
    Body: {
      walletAddress: string;
      deltas: {
        combat?: number;
        economic?: number;
        social?: number;
        crafting?: number;
        agent?: number;
      };
      reason: string;
    };
  }>("/api/reputation/batch-update", async (req, reply) => {
    const { walletAddress, deltas, reason } = req.body;

    if (!walletAddress || !deltas || !reason) {
      return reply.code(400).send({
        error: "Missing required fields: walletAddress, deltas, reason",
      });
    }

    reputationManager.batchUpdateReputation(walletAddress, deltas, reason);

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
