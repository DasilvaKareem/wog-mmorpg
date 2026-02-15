import type { FastifyInstance } from "fastify";
import type { WorldManager } from "../../runtime/world-manager.js";
import { CHUNK_SIZE } from "../../types/chunk.js";
import { TILE_SIZE } from "../../types/terrain.js";

export function registerChunkRoutes(
  app: FastifyInstance,
  world: WorldManager,
): void {

  /** GET /v1/chunks/info — chunk system constants */
  app.get("/v1/chunks/info", async () => {
    return {
      chunkSize: CHUNK_SIZE,
      tileSize: TILE_SIZE,
      chunkWorldSize: CHUNK_SIZE * TILE_SIZE,
    };
  });

  /** GET /v1/chunks/zone/:zoneId — chunk layout for a zone */
  app.get<{ Params: { zoneId: string } }>(
    "/v1/chunks/zone/:zoneId",
    async (req, reply) => {
      const runtime = world.getRuntime(req.params.zoneId);
      if (!runtime) return reply.code(404).send({ error: `unknown zone: ${req.params.zoneId}` });

      const info = runtime.getChunkInfo();
      if (!info) return reply.code(500).send({ error: "no terrain loaded for zone" });

      return {
        zoneId: req.params.zoneId,
        chunkSize: CHUNK_SIZE,
        tileSize: TILE_SIZE,
        ...info,
      };
    },
  );

  /** GET /v1/chunks/at — single chunk by chunk coordinates */
  app.get<{ Querystring: { zone: string; cx: string; cz: string } }>(
    "/v1/chunks/at",
    async (req, reply) => {
      const { zone, cx: cxStr, cz: czStr } = req.query;
      const runtime = world.getRuntime(zone);
      if (!runtime) return reply.code(404).send({ error: `unknown zone: ${zone}` });

      const cx = parseInt(cxStr, 10);
      const cz = parseInt(czStr, 10);
      if (isNaN(cx) || isNaN(cz)) {
        return reply.code(400).send({ error: "cx and cz must be integers" });
      }

      const payload = runtime.getChunkPayload(cx, cz);
      if (!payload) {
        return reply.code(404).send({ error: `chunk (${cx}, ${cz}) not found in zone ${zone}` });
      }

      return payload;
    },
  );

  /** GET /v1/chunks/stream — stream chunks around a world position (the core streaming endpoint) */
  app.get<{ Querystring: { zone: string; x: string; z: string; radius?: string } }>(
    "/v1/chunks/stream",
    async (req, reply) => {
      const { zone, x: xStr, z: zStr, radius: radiusStr } = req.query;
      const runtime = world.getRuntime(zone);
      if (!runtime) return reply.code(404).send({ error: `unknown zone: ${zone}` });

      const worldX = parseFloat(xStr);
      const worldZ = parseFloat(zStr);
      if (isNaN(worldX) || isNaN(worldZ)) {
        return reply.code(400).send({ error: "x and z are required numeric params" });
      }

      const radius = radiusStr ? parseInt(radiusStr, 10) : 2;
      if (isNaN(radius) || radius < 0 || radius > 5) {
        return reply.code(400).send({ error: "radius must be 0-5" });
      }

      const result = runtime.getChunksAround(worldX, worldZ, radius);
      if (!result) {
        return reply.code(500).send({ error: "no terrain loaded for zone" });
      }

      // Also include nearby entities within the chunk radius (in world units)
      const entityRadius = (radius + 1) * CHUNK_SIZE * TILE_SIZE;
      const entities = runtime.getEntitiesNear({ x: worldX, z: worldZ }, entityRadius);

      return {
        zoneId: zone,
        centerWorld: { x: worldX, z: worldZ },
        chunkRadius: radius,
        ...result,
        entities: entities.entities,
        tick: entities.tick,
      };
    },
  );
}
