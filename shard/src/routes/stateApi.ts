import type { FastifyInstance } from "fastify";
import { getAllEntities } from "../world/zoneRuntime.js";

function serializeEntity(entity: any): any {
  return {
    ...entity,
    ...(entity.characterTokenId != null && {
      characterTokenId: entity.characterTokenId.toString(),
    }),
    ...(entity.cooldowns instanceof Map && {
      cooldowns: Object.fromEntries(entity.cooldowns),
    }),
  };
}

export function registerStateApi(server: FastifyInstance) {
  // GET /state — full snapshot of the world (for persistence / debugging)
  server.get("/state", async () => {
    // Group entities by region for backward-compatible response shape
    const regionMap = new Map<string, Record<string, unknown>>();

    for (const [id, entity] of getAllEntities()) {
      const region = (entity as any).region ?? "unknown";
      if (!regionMap.has(region)) regionMap.set(region, {});
      regionMap.get(region)![id] = serializeEntity(entity);
    }

    const snapshot: Record<string, unknown> = {};
    for (const [region, entities] of regionMap) {
      snapshot[region] = {
        tick: 0,
        entities,
      };
    }

    return {
      timestamp: Date.now(),
      zones: snapshot,
    };
  });
}
