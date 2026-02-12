import type { FastifyInstance } from "fastify";
import fs from "fs";
import path from "path";
import { getGeneratedMap, generateAllMaps } from "./mapGenerator.js";

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
}
