import type { FastifyInstance } from "fastify";
import { getAllZones } from "./zoneRuntime.js";

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
    const snapshot: Record<string, unknown> = {};

    for (const [zoneId, zone] of getAllZones()) {
      const serializedEntities = new Map();
      for (const [id, entity] of zone.entities) {
        serializedEntities.set(id, serializeEntity(entity));
      }

      snapshot[zoneId] = {
        tick: zone.tick,
        entities: Object.fromEntries(serializedEntities),
      };
    }

    return {
      timestamp: Date.now(),
      zones: snapshot,
    };
  });
}
