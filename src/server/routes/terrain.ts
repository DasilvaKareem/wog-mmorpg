import type { FastifyInstance } from "fastify";
import type { TerrainGrid } from "../../runtime/terrain-grid.js";
import { TERRAIN_CATALOG, TILE_SIZE } from "../../types/terrain.js";

export function registerTerrainRoutes(
  app: FastifyInstance,
  terrainGrids: Map<string, TerrainGrid>,
): void {

  /** GET /v1/terrain/types — terrain catalog reference */
  app.get("/v1/terrain/types", async () => {
    return { tileSize: TILE_SIZE, types: TERRAIN_CATALOG };
  });

  /** GET /v1/terrain/at — point query */
  app.get<{ Querystring: { zone: string; x: string; z: string } }>(
    "/v1/terrain/at",
    async (req, reply) => {
      const { zone, x, z } = req.query;
      const grid = terrainGrids.get(zone);
      if (!grid) return reply.code(404).send({ error: `unknown zone: ${zone}` });

      const info = grid.getTileInfo({ x: Number(x), z: Number(z) });
      if (!info) return reply.code(400).send({ error: "position out of bounds" });

      return { zone, worldX: Number(x), worldZ: Number(z), tile: info };
    },
  );

  /** GET /v1/terrain/region — area query (max 20x20 tiles) */
  app.get<{ Querystring: { zone: string; fromX: string; fromZ: string; toX: string; toZ: string } }>(
    "/v1/terrain/region",
    async (req, reply) => {
      const { zone, fromX, fromZ, toX, toZ } = req.query;
      const grid = terrainGrids.get(zone);
      if (!grid) return reply.code(404).send({ error: `unknown zone: ${zone}` });

      const fTx = Math.floor(Number(fromX) / TILE_SIZE);
      const fTz = Math.floor(Number(fromZ) / TILE_SIZE);
      const tTx = Math.floor(Number(toX) / TILE_SIZE);
      const tTz = Math.floor(Number(toZ) / TILE_SIZE);

      const w = Math.abs(tTx - fTx) + 1;
      const h = Math.abs(tTz - fTz) + 1;
      if (w > 20 || h > 20) {
        return reply.code(400).send({ error: "region too large (max 20x20 tiles)" });
      }

      const tiles = grid.getRegion(
        Math.min(fTx, tTx), Math.min(fTz, tTz),
        Math.max(fTx, tTx), Math.max(fTz, tTz),
      );

      return { zone, tiles };
    },
  );

  /** GET /v1/terrain/zone/:zoneId — full grid dump */
  app.get<{ Params: { zoneId: string } }>(
    "/v1/terrain/zone/:zoneId",
    async (req, reply) => {
      const grid = terrainGrids.get(req.params.zoneId);
      if (!grid) return reply.code(404).send({ error: `unknown zone: ${req.params.zoneId}` });

      return grid.toData();
    },
  );
}
