import type { FastifyInstance } from "fastify";
import {
  loadNpcsForZone,
  saveNpcsForZone,
  reloadNpcsForZone,
  type NpcDef,
} from "./npcSpawner.js";

type NpcEntry = Omit<NpcDef, "zoneId">;

function isValidNpc(n: unknown): n is NpcEntry {
  if (!n || typeof n !== "object") return false;
  const o = n as Record<string, unknown>;
  return (
    typeof o.type === "string" &&
    typeof o.name === "string" &&
    typeof o.x === "number" &&
    typeof o.y === "number" &&
    typeof o.hp === "number"
  );
}

export function registerNpcRoutes(server: FastifyInstance): void {
  /** GET /v1/npcs/zone/:zoneId — read the NPC list for a zone from disk. */
  server.get<{ Params: { zoneId: string } }>(
    "/v1/npcs/zone/:zoneId",
    async (req, reply) => {
      const { zoneId } = req.params;
      const npcs = loadNpcsForZone(zoneId).map(({ zoneId: _z, ...rest }) => rest);
      return reply.send({ zoneId, npcs });
    }
  );

  /**
   * PUT /v1/npcs/zone/:zoneId — overwrite the NPC list for a zone.
   * Writes world/content/npcs/<zoneId>.json, then hot-reloads spawns
   * (despawns existing NPCs in the zone and respawns the new set).
   */
  server.put<{
    Params: { zoneId: string };
    Body: { npcs: NpcEntry[] };
  }>("/v1/npcs/zone/:zoneId", async (req, reply) => {
    const { zoneId } = req.params;
    const body = req.body;
    if (!body || !Array.isArray(body.npcs)) {
      return reply.status(400).send({ error: "Body must be { npcs: [...] }" });
    }
    for (const n of body.npcs) {
      if (!isValidNpc(n)) {
        return reply.status(400).send({
          error: "Each NPC requires type, name, x, y, hp",
          offending: n,
        });
      }
    }

    saveNpcsForZone(zoneId, body.npcs);
    const spawned = reloadNpcsForZone(zoneId);

    return reply.send({ ok: true, zoneId, spawned });
  });
}
