import type { FastifyInstance } from "fastify";
import { ITEM_CATALOG } from "./itemCatalog.js";
import { TECHNIQUES } from "./techniques.js";

export function registerItemCatalogRoutes(server: FastifyInstance): void {
  server.get("/items/catalog", async () => {
    return ITEM_CATALOG.map((item) => ({
      ...item,
      tokenId: Number(item.tokenId),
    }));
  });

  server.get("/techniques/catalog", async () => {
    return TECHNIQUES;
  });
}
