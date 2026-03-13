/**
 * Plot Routes — HTTP endpoints for plot claiming and management.
 */

import type { FastifyInstance } from "fastify";
import { getEntity } from "../world/zoneRuntime.js";
import { authenticateRequest } from "../auth/auth.js";
import { getAvailableGold, recordGoldSpend } from "../blockchain/goldLedger.js";
import { getGoldBalance } from "../blockchain/blockchain.js";
import { copperToGold } from "../blockchain/currency.js";
import {
  getPlotsInZone,
  getOwnedPlot,
  getPlotDef,
  claimPlot,
  releasePlot,
  transferPlot,
} from "./plotSystem.js";

export function registerPlotRoutes(server: FastifyInstance) {
  // GET /plots/:zoneId — list all plots in a zone with ownership status
  server.get<{ Params: { zoneId: string } }>(
    "/plots/:zoneId",
    async (request) => {
      const { zoneId } = request.params;
      const plots = getPlotsInZone(zoneId);
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
      const plot = getOwnedPlot(walletAddress);
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

      // Get plot cost
      const def = getPlotDef(plotId);
      if (!def) return reply.code(404).send({ error: "Plot not found" });

      // Check gold balance (cost is in gold)
      const goldCost = copperToGold(def.cost * 100);
      const onChainGold = parseFloat(await getGoldBalance(walletAddress));
      const safeOnChainGold = Number.isFinite(onChainGold) ? onChainGold : 0;
      const availableGold = getAvailableGold(walletAddress, safeOnChainGold);
      if (availableGold < goldCost) {
        return reply.code(400).send({ error: `Not enough gold. Need ${def.cost} gold.` });
      }
      recordGoldSpend(walletAddress, goldCost);

      // Claim the plot
      const result = claimPlot(plotId, walletAddress, player.name);
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

      const result = releasePlot(walletAddress);
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

      const result = transferPlot(walletAddress, toWalletAddress, toName);
      if (!result.ok) {
        return reply.code(400).send({ error: result.error });
      }

      return { ok: true, transferred: true };
    }
  );
}
