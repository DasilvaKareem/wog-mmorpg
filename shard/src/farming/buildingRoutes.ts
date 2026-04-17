/**
 * Building Routes — HTTP endpoints for the progressive building system.
 */

import type { FastifyInstance } from "fastify";
import { getEntity } from "../world/zoneRuntime.js";
import { authenticateRequest } from "../auth/auth.js";
import {
  getAllBlueprints,
  getBuildingStatus,
  startBuilding,
  demolishBuilding,
} from "./buildingSystem.js";
import { constructBuildingStage } from "../services/buildingService.js";

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
      const status = await getBuildingStatus(plotId);
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

      const result = await startBuilding(plotId, walletAddress, buildingType);
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

      const result = await constructBuildingStage(plotId, walletAddress);
      if (!result.ok) return reply.code(400).send({ error: result.error });

      return {
        ok: true,
        newStage: result.newStage,
        complete: result.complete,
        status: result.status,
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

      const result = await demolishBuilding(plotId, walletAddress);
      if (!result.ok) return reply.code(400).send({ error: result.error });

      return { ok: true, demolished: true };
    }
  );
}
