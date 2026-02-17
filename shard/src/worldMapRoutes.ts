/**
 * World map API — serves zone metadata for the client map overlay.
 * GET /worldmap → WorldMapData (zones + connections)
 */

import type { FastifyInstance } from "fastify";
import { getWorldMapData } from "./worldMapStore.js";

export function registerWorldMapRoutes(server: FastifyInstance) {
  server.get("/worldmap", async (_request, _reply) => {
    return getWorldMapData();
  });
}
