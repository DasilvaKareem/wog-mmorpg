/**
 * Prediction Market API Routes
 * Endpoints for encrypted betting on PvP battles
 */

import type { FastifyInstance } from "fastify";
import { predictionPoolManager } from "./predictionPoolManager.js";
import type { BetPlacementRequest, BetChoice } from "./types/prediction.js";
import type { PvPTeam } from "./types/pvp.js";

export async function registerPredictionRoutes(app: FastifyInstance) {
  /**
   * GET /api/prediction/pools/active
   * Get all active prediction pools
   */
  app.get("/api/prediction/pools/active", async (req, reply) => {
    const activePoolIds = predictionPoolManager.getActivePools();

    const pools = activePoolIds.map((poolId) => {
      return predictionPoolManager.getPoolStats(poolId);
    });

    return reply.send({ pools });
  });

  /**
   * GET /api/prediction/pool/:poolId
   * Get pool statistics
   */
  app.get<{
    Params: {
      poolId: string;
    };
  }>("/api/prediction/pool/:poolId", async (req, reply) => {
    const { poolId } = req.params;

    try {
      const stats = predictionPoolManager.getPoolStats(poolId);
      return reply.send({ pool: stats });
    } catch (error) {
      return reply.code(404).send({
        error: (error as Error).message,
      });
    }
  });

  /**
   * POST /api/prediction/bet
   * Place an encrypted bet on a pool
   */
  app.post<{
    Body: {
      poolId: string;
      choice: BetChoice;
      amount: number;
      walletAddress: string;
    };
  }>("/api/prediction/bet", async (req, reply) => {
    const { poolId, choice, amount, walletAddress } = req.body;

    // Validation
    if (!poolId || !choice || !amount || !walletAddress) {
      return reply.code(400).send({
        error:
          "Missing required fields: poolId, choice, amount, walletAddress",
      });
    }

    if (choice !== "RED" && choice !== "BLUE") {
      return reply.code(400).send({
        error: 'Invalid choice. Must be "RED" or "BLUE"',
      });
    }

    if (amount <= 0) {
      return reply.code(400).send({
        error: "Amount must be greater than 0",
      });
    }

    try {
      const request: BetPlacementRequest = {
        poolId,
        choice,
        amount,
        betterAddress: walletAddress,
      };

      const result = await predictionPoolManager.placeBet(request);

      return reply.send({
        success: true,
        position: {
          positionId: result.positionId,
          txHash: result.txHash,
          amount: result.amount.toString(),
          timestamp: result.timestamp,
          // Note: choice is NOT returned - it's encrypted!
        },
      });
    } catch (error) {
      return reply.code(400).send({
        error: (error as Error).message,
      });
    }
  });

  /**
   * POST /api/prediction/pool/:poolId/lock
   * Lock a pool (admin only - should add auth)
   */
  app.post<{
    Params: {
      poolId: string;
    };
  }>("/api/prediction/pool/:poolId/lock", async (req, reply) => {
    const { poolId } = req.params;

    try {
      await predictionPoolManager.lockPool(poolId);

      return reply.send({
        success: true,
        message: "Pool locked",
      });
    } catch (error) {
      return reply.code(400).send({
        error: (error as Error).message,
      });
    }
  });

  /**
   * POST /api/prediction/pool/:poolId/settle
   * Settle a pool after battle completes (admin only)
   */
  app.post<{
    Params: {
      poolId: string;
    };
    Body: {
      winner: PvPTeam;
    };
  }>("/api/prediction/pool/:poolId/settle", async (req, reply) => {
    const { poolId } = req.params;
    const { winner } = req.body;

    if (!winner || (winner !== "red" && winner !== "blue")) {
      return reply.code(400).send({
        error: 'Invalid winner. Must be "red" or "blue"',
      });
    }

    try {
      const settlement = await predictionPoolManager.settlePool(poolId, winner);

      return reply.send({
        success: true,
        settlement: {
          poolId: settlement.poolId,
          winner: settlement.winner,
          totalWinningStake: settlement.totalWinningStake.toString(),
          totalLosingStake: settlement.totalLosingStake.toString(),
          totalPayout: settlement.totalPayout.toString(),
          payouts: settlement.payouts.map((p) => ({
            winner: p.winner,
            stake: p.stake.toString(),
            payout: p.payout.toString(),
            profitMultiplier: p.profitMultiplier,
          })),
        },
      });
    } catch (error) {
      return reply.code(400).send({
        error: (error as Error).message,
      });
    }
  });

  /**
   * POST /api/prediction/pool/:poolId/claim
   * Claim winnings from a settled pool
   */
  app.post<{
    Params: {
      poolId: string;
    };
    Body: {
      walletAddress: string;
    };
  }>("/api/prediction/pool/:poolId/claim", async (req, reply) => {
    const { poolId } = req.params;
    const { walletAddress } = req.body;

    if (!walletAddress) {
      return reply.code(400).send({
        error: "Missing required field: walletAddress",
      });
    }

    try {
      const txHash = await predictionPoolManager.claimWinnings(
        poolId,
        walletAddress
      );

      return reply.send({
        success: true,
        txHash,
        message: "Winnings claimed",
      });
    } catch (error) {
      return reply.code(400).send({
        error: (error as Error).message,
      });
    }
  });

  /**
   * GET /api/prediction/history/:walletAddress
   * Get betting history for a wallet
   */
  app.get<{
    Params: {
      walletAddress: string;
    };
  }>("/api/prediction/history/:walletAddress", async (req, reply) => {
    const { walletAddress } = req.params;

    const history = predictionPoolManager.getBettingHistory(walletAddress);

    return reply.send({
      history: {
        ...history,
        totalStaked: history.totalStaked.toString(),
        totalWon: history.totalWon.toString(),
        totalLost: history.totalLost.toString(),
        netProfit: history.netProfit.toString(),
        bets: history.bets.map((bet) => ({
          ...bet,
          amount: bet.amount.toString(),
          payout: bet.payout?.toString(),
          profit: bet.profit?.toString(),
        })),
      },
    });
  });

  /**
   * POST /api/prediction/pool/:poolId/cancel
   * Cancel a pool and refund all bets (admin only)
   */
  app.post<{
    Params: {
      poolId: string;
    };
    Body: {
      reason: string;
    };
  }>("/api/prediction/pool/:poolId/cancel", async (req, reply) => {
    const { poolId } = req.params;
    const { reason } = req.body;

    if (!reason) {
      return reply.code(400).send({
        error: "Missing required field: reason",
      });
    }

    try {
      await predictionPoolManager.cancelPool(poolId, reason);

      return reply.send({
        success: true,
        message: "Pool cancelled and bets refunded",
      });
    } catch (error) {
      return reply.code(400).send({
        error: (error as Error).message,
      });
    }
  });

  /**
   * GET /api/x402/discovery
   * X402 discovery endpoint for agent participation
   */
  app.get("/api/x402/discovery", async (req, reply) => {
    const activePoolIds = predictionPoolManager.getActivePools();

    const activePools = activePoolIds.map((poolId) => {
      const stats = predictionPoolManager.getPoolStats(poolId);
      return {
        poolId: stats.poolId,
        battleId: stats.battleId,
        totalStaked: stats.totalStaked,
        participantCount: stats.participantCount,
        lockTimestamp: stats.lockTimestamp,
        status: stats.status,
      };
    });

    return reply.send({
      service: "pvp-prediction-market",
      version: "1.0.0",
      endpoints: [
        {
          path: "/api/prediction/pools/active",
          method: "GET",
          description: "List active prediction markets",
        },
        {
          path: "/api/prediction/pool/:poolId",
          method: "GET",
          description: "Get pool statistics (choices are hidden)",
        },
        {
          path: "/api/prediction/bet",
          method: "POST",
          encryption: "BITE",
          description: "Place encrypted bet on a pool",
        },
        {
          path: "/api/prediction/pool/:poolId/claim",
          method: "POST",
          description: "Claim winnings from settled pool",
        },
        {
          path: "/api/prediction/history/:walletAddress",
          method: "GET",
          description: "Get betting history for a wallet",
        },
      ],
      activePools,
    });
  });

  /**
   * POST /api/x402/prediction/bet
   * X402 encrypted betting endpoint (bonus feature)
   */
  app.post<{
    Body: {
      encryptedPayload: string;
      agentSignature: string;
    };
  }>("/api/x402/prediction/bet", async (req, reply) => {
    const { encryptedPayload, agentSignature } = req.body;

    // In production, this would decrypt and validate the x402 payload
    // For now, return a placeholder response

    return reply.send({
      success: true,
      message: "X402 encrypted bet accepted",
      note: "This is a placeholder - implement x402 decryption in production",
    });
  });
}
