import type { FastifyInstance } from "fastify";
import { ITEM_CATALOG, getItemRarity } from "./itemCatalog.js";
import { TECHNIQUES } from "./techniques.js";

export function registerItemCatalogRoutes(server: FastifyInstance): void {
  server.get("/items/catalog", async () => {
    return ITEM_CATALOG.map((item) => ({
      ...item,
      tokenId: Number(item.tokenId),
      rarity: getItemRarity(item.copperPrice),
    }));
  });

  server.get("/techniques/catalog", async () => {
    return TECHNIQUES;
  });
}
