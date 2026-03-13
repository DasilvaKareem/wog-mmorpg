/**
 * Building Routes — HTTP endpoints for the progressive building system.
 */

import type { FastifyInstance } from "fastify";
import { getEntity } from "../world/zoneRuntime.js";
import { authenticateRequest } from "../auth/auth.js";
import { getAvailableGold, recordGoldSpend } from "../blockchain/goldLedger.js";
import { burnItem, getItemBalance, getGoldBalance } from "../blockchain/blockchain.js";
import { copperToGold } from "../blockchain/currency.js";
import {
  getAllBlueprints,
  getBuildingStatus,
  getNextStageRequirements,
  startBuilding,
  advanceBuildingStage,
  demolishBuilding,
} from "./buildingSystem.js";

export function registerBuildingRoutes(server: FastifyInstance) {
  // GET /building/blueprints — list all building types and their stage requirements
  server.get("/building/blueprints", async () => {
    return getAllBlueprints().map((bp) => ({
      type: bp.type,
      name: bp.name,
      description: bp.description,
      stages: bp.stages.map((s) => ({
        stage: s.stage,
        name: s.name,
        copperCost: s.copperCost,
        materials: s.materials.map((m) => ({
          tokenId: m.tokenId.toString(),
          name: m.name,
          quantity: m.quantity,
        })),
      })),
    }));
  });

  // GET /building/status/:plotId — get building status on a plot
  server.get<{ Params: { plotId: string } }>(
    "/building/status/:plotId",
    async (request, reply) => {
      const { plotId } = request.params;
      const status = getBuildingStatus(plotId);
      if (!status) return reply.code(404).send({ error: "Plot not found" });
      return status;
    }
  );

  // POST /building/start — begin a building on your plot
  server.post<{
    Body: { walletAddress: string; entityId: string; plotId: string; buildingType: string };
  }>(
    "/building/start",
    { preHandler: authenticateRequest },
    async (request, reply) => {
      const { walletAddress, entityId, plotId, buildingType } = request.body;

      const player = getEntity(entityId);
      if (!player || player.type !== "player") {
        return reply.code(404).send({ error: "Player not found" });
      }
      if (
        !player.walletAddress ||
        player.walletAddress.toLowerCase() !== walletAddress.toLowerCase()
      ) {
        return reply.code(403).send({ error: "Not your character" });
      }

      const result = startBuilding(plotId, walletAddress, buildingType);
      if (!result.ok) return reply.code(400).send({ error: result.error });

      return { ok: true, plot: result.plot, buildingType };
    }
  );

  // POST /building/construct — advance building to next stage (burns materials + gold)
  server.post<{
    Body: { walletAddress: string; entityId: string; plotId: string };
  }>(
    "/building/construct",
    { preHandler: authenticateRequest },
    async (request, reply) => {
      const { walletAddress, entityId, plotId } = request.body;

      const player = getEntity(entityId);
      if (!player || player.type !== "player") {
        return reply.code(404).send({ error: "Player not found" });
      }
      if (
        !player.walletAddress ||
        player.walletAddress.toLowerCase() !== walletAddress.toLowerCase()
      ) {
        return reply.code(403).send({ error: "Not your character" });
      }

      // Get stage requirements
      const req = getNextStageRequirements(plotId);
      if (!req.ok || !req.stage) {
        return reply.code(400).send({ error: req.error });
      }

      // Check and deduct gold
      const copperCost = req.stage.copperCost;
      if (copperCost > 0) {
        const goldCost = copperToGold(copperCost);
        const onChainGold = parseFloat(await getGoldBalance(walletAddress));
        const safeOnChainGold = Number.isFinite(onChainGold) ? onChainGold : 0;
        const availableGold = getAvailableGold(walletAddress, safeOnChainGold);
        if (availableGold < goldCost) {
          return reply.code(400).send({ error: `Not enough gold. Need ${copperCost} copper.` });
        }
        recordGoldSpend(walletAddress, goldCost);
      }

      // Check material balances
      for (const mat of req.stage.materials) {
        const balance = await getItemBalance(walletAddress, mat.tokenId);
        if (balance < BigInt(mat.quantity)) {
          return reply.code(400).send({
            error: `Not enough ${mat.name}. Need ${mat.quantity}, have ${balance.toString()}.`,
          });
        }
      }

      // Burn materials
      for (const mat of req.stage.materials) {
        try {
          await burnItem(walletAddress, mat.tokenId, BigInt(mat.quantity));
        } catch (err: any) {
          return reply.code(500).send({ error: `Failed to burn ${mat.name}: ${err.message}` });
        }
      }

      // Advance stage
      const result = advanceBuildingStage(plotId, walletAddress);
      if (!result.ok) return reply.code(400).send({ error: result.error });

      return {
        ok: true,
        newStage: result.newStage,
        complete: result.complete,
        status: getBuildingStatus(plotId),
      };
    }
  );

  // POST /building/demolish — destroy a building on your plot
  server.post<{
    Body: { walletAddress: string; entityId: string; plotId: string };
  }>(
    "/building/demolish",
    { preHandler: authenticateRequest },
    async (request, reply) => {
      const { walletAddress, entityId, plotId } = request.body;

      const player = getEntity(entityId);
      if (!player || player.type !== "player") {
        return reply.code(404).send({ error: "Player not found" });
      }
      if (
        !player.walletAddress ||
        player.walletAddress.toLowerCase() !== walletAddress.toLowerCase()
      ) {
        return reply.code(403).send({ error: "Not your character" });
      }

      const result = demolishBuilding(plotId, walletAddress);
      if (!result.ok) return reply.code(400).send({ error: result.error });

      return { ok: true, demolished: true };
    }
  );
}
