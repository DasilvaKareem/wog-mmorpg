import type { FastifyInstance } from "fastify";
import type { InventoryManager } from "../../runtime/inventory.js";
import type { LootRoller } from "../../runtime/loot-roller.js";
import type { ItemTemplate } from "../../types/item.js";

interface LootRollBody {
  ownerId: string;
  tableId: string;
}

export function registerInventoryRoutes(
  app: FastifyInstance,
  inventory: InventoryManager,
  lootRoller: LootRoller,
  items: Map<string, ItemTemplate>,
): void {
  // List all item templates
  app.get("/v1/items", (_req, reply) => {
    return reply.send({ items: Array.from(items.values()) });
  });

  // Get a player's inventory
  app.get<{ Params: { ownerId: string } }>("/v1/inventory/:ownerId", (req, reply) => {
    const inv = inventory.getInventory(req.params.ownerId);
    return reply.send(inv);
  });

  // Roll loot and add to inventory (server-authoritative action)
  app.post<{ Body: LootRollBody }>("/v1/loot/roll", (req, reply) => {
    const { ownerId, tableId } = req.body ?? {};

    if (!ownerId || !tableId) {
      return reply.status(400).send({ error: "ownerId and tableId are required" });
    }

    if (!lootRoller.hasTable(tableId)) {
      return reply.status(404).send({ error: "unknown loot table" });
    }

    const drops = lootRoller.roll(tableId);
    const added = inventory.addDrops(ownerId, drops);

    return reply.send({
      ownerId,
      tableId,
      rolled: drops,
      added,
    });
  });
}
