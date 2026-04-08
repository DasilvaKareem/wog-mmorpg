/**
 * Plot Routes — HTTP endpoints for plot claiming and management.
 */

import type { FastifyInstance } from "fastify";
import { getEntity } from "../world/zoneRuntime.js";
import { authenticateRequest } from "../auth/auth.js";
import {
  getPlotsInZoneAsync,
  getOwnedPlotAsync,
  getPlotDef,
  releasePlot,
  transferPlot,
} from "./plotSystem.js";
import { claimPlotForWallet } from "../services/plotService.js";

export function registerPlotRoutes(server: FastifyInstance) {
  // GET /plots/:zoneId — list all plots in a zone with ownership status
  server.get<{ Params: { zoneId: string } }>(
    "/plots/:zoneId",
    async (request) => {
      const { zoneId } = request.params;
      const plots = await getPlotsInZoneAsync(zoneId);
      const defs = plots.map((p) => {
        const def = getPlotDef(p.plotId);
        return {
          plotId: p.plotId,
          zoneId: p.zoneId,
          x: p.x,
          y: p.y,
          cost: def?.cost ?? 0,
          owner: p.owner,
          ownerName: p.ownerName,
          claimed: !!p.owner,
          buildingType: p.buildingType,
          buildingStage: p.buildingStage,
        };
      });
      return { plots: defs, count: defs.length };
    }
  );

  // GET /plots/owned/:walletAddress — get the plot owned by a player
  server.get<{ Params: { walletAddress: string } }>(
    "/plots/owned/:walletAddress",
    async (request) => {
      const { walletAddress } = request.params;
      const plot = await getOwnedPlotAsync(walletAddress);
      if (!plot) return { owned: false, plot: null };
      const def = getPlotDef(plot.plotId);
      return {
        owned: true,
        plot: {
          plotId: plot.plotId,
          zoneId: plot.zoneId,
          x: plot.x,
          y: plot.y,
          cost: def?.cost ?? 0,
          owner: plot.owner,
          ownerName: plot.ownerName,
          claimedAt: plot.claimedAt,
          buildingType: plot.buildingType,
          buildingStage: plot.buildingStage,
        },
      };
    }
  );

  // POST /plots/claim — claim a plot for gold
  server.post<{
    Body: { walletAddress: string; entityId: string; plotId: string };
  }>(
    "/plots/claim",
    { preHandler: authenticateRequest },
    async (request, reply) => {
      const { walletAddress, entityId, plotId } = request.body;

      // Validate player
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

      const def = getPlotDef(plotId);
      if (!def) return reply.code(404).send({ error: "Plot not found" });

      const result = await claimPlotForWallet(plotId, walletAddress, player.name);
      if (!result.ok) {
        return reply.code(400).send({ error: result.error });
      }

      return {
        ok: true,
        plotId,
        cost: def.cost,
        owner: walletAddress,
        plot: result.plot,
      };
    }
  );

  // POST /plots/release — release your plot
  server.post<{
    Body: { walletAddress: string };
  }>(
    "/plots/release",
    { preHandler: authenticateRequest },
    async (request, reply) => {
      const { walletAddress } = request.body;

      const result = await releasePlot(walletAddress);
      if (!result.ok) {
        return reply.code(400).send({ error: result.error });
      }

      return { ok: true, releasedPlotId: result.plotId };
    }
  );

  // POST /plots/transfer — transfer your plot to another player
  server.post<{
    Body: { walletAddress: string; toWalletAddress: string; toName: string };
  }>(
    "/plots/transfer",
    { preHandler: authenticateRequest },
    async (request, reply) => {
      const { walletAddress, toWalletAddress, toName } = request.body;

      const result = await transferPlot(walletAddress, toWalletAddress, toName);
      if (!result.ok) {
        return reply.code(400).send({ error: result.error });
      }

      return { ok: true, transferred: true };
    }
  );
}
