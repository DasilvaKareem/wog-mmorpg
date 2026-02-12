import type { FastifyInstance } from "fastify";
import type { OreManager } from "../../runtime/ore-manager.js";
import type { WorldManager } from "../../runtime/world-manager.js";
import { ORE_CATALOG, ORE_RESPAWN_TICKS } from "../../types/ore.js";
import { TILE_SIZE } from "../../types/terrain.js";

export function registerMiningRoutes(
  app: FastifyInstance,
  oreManagers: Map<string, OreManager>,
  world: WorldManager,
): void {

  /** GET /v1/mining/ores — ore catalog reference */
  app.get("/v1/mining/ores", async () => {
    return {
      tileSize: TILE_SIZE,
      respawnTicks: ORE_RESPAWN_TICKS,
      ores: ORE_CATALOG,
    };
  });

  /** GET /v1/mining/deposits — ore deposits near a world position */
  app.get<{ Querystring: { zone: string; x: string; z: string; radius?: string } }>(
    "/v1/mining/deposits",
    async (req, reply) => {
      const { zone, x, z, radius } = req.query;
      const mgr = oreManagers.get(zone);
      if (!mgr) return reply.code(404).send({ error: `unknown zone: ${zone}` });

      const worldX = Number(x);
      const worldZ = Number(z);
      const r = Number(radius ?? 50);

      // Convert radius to tile range
      const halfTiles = Math.ceil(r / TILE_SIZE);
      const centerTx = Math.floor(worldX / TILE_SIZE);
      const centerTz = Math.floor(worldZ / TILE_SIZE);

      const deposits = mgr.getDepositsInRegion(
        centerTx - halfTiles, centerTz - halfTiles,
        centerTx + halfTiles, centerTz + halfTiles,
      );

      return { zone, deposits };
    },
  );

  /** GET /v1/mining/zone/:zoneId — all deposits in a zone */
  app.get<{ Params: { zoneId: string } }>(
    "/v1/mining/zone/:zoneId",
    async (req, reply) => {
      const mgr = oreManagers.get(req.params.zoneId);
      if (!mgr) return reply.code(404).send({ error: `unknown zone: ${req.params.zoneId}` });

      return { zone: req.params.zoneId, deposits: mgr.getAllDeposits() };
    },
  );

  /** POST /v1/mining/mine — mine an ore deposit */
  app.post<{ Body: { agentId: string; zone: string; x: number; z: number } }>(
    "/v1/mining/mine",
    async (req, reply) => {
      const { agentId, zone, x, z } = req.body;

      if (!agentId || !zone || x == null || z == null) {
        return reply.code(400).send({ error: "missing required fields: agentId, zone, x, z" });
      }

      const mgr = oreManagers.get(zone);
      if (!mgr) return reply.code(404).send({ error: `unknown zone: ${zone}` });

      const runtime = world.getRuntime(zone);
      const tick = runtime ? runtime.getStats().tick : 0;
      const result = mgr.mine({ x, z }, tick);
      if (typeof result === "string") {
        return reply.code(400).send({ error: result });
      }

      const itemId = ORE_CATALOG[result.oreType].itemId;

      return {
        oreType: result.oreType,
        quantity: result.quantity,
        chargesRemaining: result.chargesRemaining,
        itemId,
        agentId,
      };
    },
  );
}
