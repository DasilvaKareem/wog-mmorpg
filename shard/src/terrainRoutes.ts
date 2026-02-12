import type { FastifyInstance } from "fastify";
import fs from "fs";
import path from "path";

interface ZoneConfig {
  id: string;
  name: string;
  biome: string;
  width: number;
  height: number;
  pois?: string[];
}

const TILE_SIZE = 10; // Server tile size in game units

// Simple terrain generation based on biome
function generateTerrain(zoneConfig: ZoneConfig): string[] {
  const tilesX = Math.floor(zoneConfig.width / TILE_SIZE);
  const tilesY = Math.floor(zoneConfig.height / TILE_SIZE);
  const tiles: string[] = [];

  // Generate terrain based on biome
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
      // Simple pseudo-random terrain based on position
      const seed = x * 7 + y * 13;
      const index = seed % terrainTypes.length;
      tiles.push(terrainTypes[index]);
    }
  }

  return tiles;
}

export function registerTerrainRoutes(server: FastifyInstance): void {
  server.get<{ Params: { zoneId: string } }>(
    "/v1/terrain/zone/:zoneId",
    async (req, reply) => {
      const { zoneId } = req.params;

      try {
        // Load zone config
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
}
