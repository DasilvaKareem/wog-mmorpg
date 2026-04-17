import type { FastifyInstance } from "fastify";
import fs from "fs";
import path from "path";
import {
  getGeneratedMap,
  setGeneratedMap,
  saveTerrain,
  generateAllMaps,
  getChunkFromMap,
  getChunksAroundPosition,
  getZoneChunkInfo,
  CHUNK_SIZE,
  type GeneratedMap,
} from "./mapGenerator.js";

interface ZoneConfig {
  id: string;
  name: string;
  biome: string;
  width: number;
  height: number;
  pois?: string[];
}

const TILE_SIZE = 10; // Server tile size in game units

// Simple terrain generation based on biome (v1 legacy)
function generateTerrain(zoneConfig: ZoneConfig): string[] {
  const tilesX = Math.floor(zoneConfig.width / TILE_SIZE);
  const tilesY = Math.floor(zoneConfig.height / TILE_SIZE);
  const tiles: string[] = [];

  const biomeMap: Record<string, string[]> = {
    grassland: ["grass", "grass", "grass", "dirt", "forest"],
    forest: ["forest", "forest", "grass", "dirt"],
    desert: ["dirt", "dirt", "rock", "stone"],
    swamp: ["mud", "water", "grass"],
    mountains: ["rock", "stone", "dirt"],
  };

  const terrainTypes = biomeMap[zoneConfig.biome] || ["grass", "dirt"];

  for (let y = 0; y < tilesY; y++) {
    for (let x = 0; x < tilesX; x++) {
      tiles.push(terrainTypes[0]);
    }
  }

  return tiles;
}

export function registerTerrainRoutes(server: FastifyInstance): void {
  // Generate v2 tile maps on startup
  generateAllMaps();

  // ── v1 (legacy) ──────────────────────────────────────────────────
  server.get<{ Params: { zoneId: string } }>(
    "/v1/terrain/zone/:zoneId",
    async (req, reply) => {
      const { zoneId } = req.params;

      try {
        const zonePath = path.join(
          process.cwd(),
          "../world/content/zones",
          `${zoneId}.json`
        );

        if (!fs.existsSync(zonePath)) {
          return reply.status(404).send({ error: "Zone not found" });
        }

        const zoneConfig: ZoneConfig = JSON.parse(
          fs.readFileSync(zonePath, "utf-8")
        );

        const tiles = generateTerrain(zoneConfig);
        const tilesX = Math.floor(zoneConfig.width / TILE_SIZE);
        const tilesY = Math.floor(zoneConfig.height / TILE_SIZE);

        return reply.send({
          zoneId: zoneConfig.id,
          width: tilesX,
          height: tilesY,
          tileSize: TILE_SIZE,
          tiles,
        });
      } catch (error) {
        server.log.error(error);
        return reply.status(500).send({ error: "Failed to load terrain" });
      }
    }
  );

  // ── v2 (tile-atlas indexed) ──────────────────────────────────────
  server.get<{ Params: { zoneId: string } }>(
    "/v2/terrain/zone/:zoneId",
    async (req, reply) => {
      const { zoneId } = req.params;

      const map = getGeneratedMap(zoneId);
      if (!map) {
        return reply.status(404).send({ error: "Zone not found" });
      }

      return reply.send(map);
    }
  );

  // ── v2 save (from map editor) ────────────────────────────────────
  server.put<{ Params: { zoneId: string }; Body: GeneratedMap }>(
    "/v2/terrain/zone/:zoneId",
    async (req, reply) => {
      const { zoneId } = req.params;
      const body = req.body as GeneratedMap;

      if (!body || !Array.isArray(body.ground) || !Array.isArray(body.overlay) || !Array.isArray(body.elevation)) {
        return reply.status(400).send({ error: "Invalid terrain data" });
      }

      const size = body.width * body.height;
      if (body.ground.length !== size || body.overlay.length !== size || body.elevation.length !== size) {
        return reply.status(400).send({ error: `Array length mismatch: expected ${size}` });
      }

      const map: GeneratedMap = {
        zoneId,
        width: body.width,
        height: body.height,
        tileSize: body.tileSize ?? 10,
        ground: body.ground,
        overlay: body.overlay,
        elevation: body.elevation,
        biome: body.biome ?? "temperate",
        props: Array.isArray(body.props) ? body.props : [],
      };

      // Update in-memory cache + write to disk
      setGeneratedMap(map);
      saveTerrain(map);

      return reply.send({ ok: true, zoneId });
    }
  );

  // ── Chunk streaming endpoints ──────────────────────────────────────

  /** GET /v1/chunks/info — chunk system constants */
  server.get("/v1/chunks/info", async () => {
    return {
      chunkSize: CHUNK_SIZE,
      tileSize: TILE_SIZE,
      chunkWorldSize: CHUNK_SIZE * TILE_SIZE,
    };
  });

  /** GET /v1/chunks/zone/:zoneId — chunk layout for a zone */
  server.get<{ Params: { zoneId: string } }>(
    "/v1/chunks/zone/:zoneId",
    async (req, reply) => {
      const info = getZoneChunkInfo(req.params.zoneId);
      if (!info) return reply.status(404).send({ error: `unknown zone: ${req.params.zoneId}` });

      return {
        zoneId: req.params.zoneId,
        chunkSize: CHUNK_SIZE,
        tileSize: TILE_SIZE,
        ...info,
      };
    }
  );

  /** GET /v1/chunks/at — single chunk by chunk coordinates */
  server.get<{ Querystring: { zone: string; cx: string; cz: string } }>(
    "/v1/chunks/at",
    async (req, reply) => {
      const { zone, cx: cxStr, cz: czStr } = req.query;
      const cx = parseInt(cxStr, 10);
      const cz = parseInt(czStr, 10);
      if (isNaN(cx) || isNaN(cz)) {
        return reply.status(400).send({ error: "cx and cz must be integers" });
      }

      const chunk = getChunkFromMap(zone, cx, cz);
      if (!chunk) {
        return reply.status(404).send({ error: `chunk (${cx}, ${cz}) not found in zone ${zone}` });
      }

      return chunk;
    }
  );

  /** GET /v1/chunks/stream — stream chunks around a world position */
  server.get<{ Querystring: { zone: string; x: string; z: string; radius?: string } }>(
    "/v1/chunks/stream",
    async (req, reply) => {
      const { zone, x: xStr, z: zStr, radius: radiusStr } = req.query;

      const worldX = parseFloat(xStr);
      const worldZ = parseFloat(zStr);
      if (isNaN(worldX) || isNaN(worldZ)) {
        return reply.status(400).send({ error: "x and z are required numeric params" });
      }

      const radius = radiusStr ? parseInt(radiusStr, 10) : 2;
      if (isNaN(radius) || radius < 0 || radius > 5) {
        return reply.status(400).send({ error: "radius must be 0-5" });
      }

      const result = getChunksAroundPosition(zone, worldX, worldZ, radius);
      if (!result) {
        return reply.status(404).send({ error: `unknown zone: ${zone}` });
      }

      return {
        zoneId: zone,
        centerWorld: { x: worldX, z: worldZ },
        chunkRadius: radius,
        ...result,
      };
    }
  );
}
