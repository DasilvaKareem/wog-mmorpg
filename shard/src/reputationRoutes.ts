/**
 * Reputation API Routes
 * ERC-8004 reputation system endpoints
 */

import type { FastifyInstance } from "fastify";
import { reputationManager, ReputationCategory } from "./reputationManager.js";

export async function registerReputationRoutes(app: FastifyInstance) {
  /**
   * GET /api/reputation/:characterTokenId
   * Get reputation score for a character
   */
  app.get<{
    Params: {
      characterTokenId: string;
    };
  }>("/api/reputation/:characterTokenId", async (req, reply) => {
    const { characterTokenId } = req.params;

    try {
      const tokenId = BigInt(characterTokenId);
      const reputation = await reputationManager.getReputation(tokenId);

      if (!reputation) {
        return reply.code(404).send({
          error: "Reputation not found for this character",
        });
      }

      const rank = await reputationManager.getReputationRank(reputation.overall);

      return reply.send({
        reputation: {
          ...reputation,
          rank,
        },
      });
    } catch (error) {
      return reply.code(400).send({
        error: (error as Error).message,
      });
    }
  });

  /**
   * GET /api/reputation/:characterTokenId/identity
   * Get ERC-8004 identity for a character
   */
  app.get<{
    Params: {
      characterTokenId: string;
    };
  }>("/api/reputation/:characterTokenId/identity", async (req, reply) => {
    const { characterTokenId } = req.params;

    try {
      const tokenId = BigInt(characterTokenId);
      const identity = await reputationManager.getCharacterIdentity(tokenId);

      if (!identity) {
        return reply.code(404).send({
          error: "Identity not found for this character",
        });
      }

      return reply.send({
        identity: {
          identityId: identity.identityId.toString(),
          characterTokenId: identity.characterTokenId.toString(),
          characterOwner: identity.characterOwner,
          metadataURI: identity.metadataURI,
          createdAt: identity.createdAt,
          active: identity.active,
        },
      });
    } catch (error) {
      return reply.code(400).send({
        error: (error as Error).message,
      });
    }
  });

  /**
   * GET /api/reputation/:characterTokenId/history
   * Get reputation feedback history
   */
  app.get<{
    Params: {
      characterTokenId: string;
    };
    Querystring: {
      limit?: string;
    };
  }>("/api/reputation/:characterTokenId/history", async (req, reply) => {
    const { characterTokenId } = req.params;
    const limit = req.query.limit ? parseInt(req.query.limit) : 20;

    try {
      const tokenId = BigInt(characterTokenId);
      const history = await reputationManager.getFeedbackHistory(tokenId, limit);

      return reply.send({
        history: history.map((feedback) => ({
          submitter: feedback.submitter,
          identityId: feedback.identityId.toString(),
          category: ReputationCategory[feedback.category],
          delta: feedback.delta,
          reason: feedback.reason,
          timestamp: feedback.timestamp,
          validated: feedback.validated,
        })),
      });
    } catch (error) {
      return reply.code(400).send({
        error: (error as Error).message,
      });
    }
  });

  /**
   * POST /api/reputation/create-identity
   * Create identity for a character (called during character minting)
   */
  app.post<{
    Body: {
      characterTokenId: string;
      characterOwner: string;
      characterName: string;
      characterClass: string;
      level: number;
    };
  }>("/api/reputation/create-identity", async (req, reply) => {
    const { characterTokenId, characterOwner, characterName, characterClass, level } =
      req.body;

    // Validation
    if (!characterTokenId || !characterOwner || !characterName || !characterClass) {
      return reply.code(400).send({
        error:
          "Missing required fields: characterTokenId, characterOwner, characterName, characterClass",
      });
    }

    try {
      const tokenId = BigInt(characterTokenId);

      const identityId = await reputationManager.createCharacterIdentity(
        tokenId,
        characterOwner,
        {
          name: characterName,
          class: characterClass,
          level: level || 1,
        }
      );

      return reply.send({
        success: true,
        identityId: identityId.toString(),
        message: "Character identity created and reputation initialized",
      });
    } catch (error) {
      return reply.code(400).send({
        error: (error as Error).message,
      });
    }
  });

  /**
   * POST /api/reputation/feedback
   * Submit reputation feedback (admin/system only)
   */
  app.post<{
    Body: {
      characterTokenId: string;
      category: string;
      delta: number;
      reason: string;
    };
  }>("/api/reputation/feedback", async (req, reply) => {
    const { characterTokenId, category, delta, reason } = req.body;

    // Validation
    if (!characterTokenId || !category || delta === undefined || !reason) {
      return reply.code(400).send({
        error: "Missing required fields: characterTokenId, category, delta, reason",
      });
    }

    // Parse category
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

    try {
      const tokenId = BigInt(characterTokenId);

      await reputationManager.submitFeedback(tokenId, categoryEnum, delta, reason);

      return reply.send({
        success: true,
        message: "Reputation feedback submitted",
      });
    } catch (error) {
      return reply.code(400).send({
        error: (error as Error).message,
      });
    }
  });

  /**
   * POST /api/reputation/batch-update
   * Batch update multiple reputation categories (admin/system only)
   */
  app.post<{
    Body: {
      characterTokenId: string;
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
    const { characterTokenId, deltas, reason } = req.body;

    if (!characterTokenId || !deltas || !reason) {
      return reply.code(400).send({
        error: "Missing required fields: characterTokenId, deltas, reason",
      });
    }

    try {
      const tokenId = BigInt(characterTokenId);

      await reputationManager.batchUpdateReputation(tokenId, deltas, reason);

      return reply.send({
        success: true,
        message: "Reputation batch updated",
      });
    } catch (error) {
      return reply.code(400).send({
        error: (error as Error).message,
      });
    }
  });

  /**
   * GET /api/reputation/ranks
   * Get all reputation rank tiers
   */
  app.get("/api/reputation/ranks", async (req, reply) => {
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
