import { isPostgresConfigured, postgresQuery } from "./postgres.js";
import type { CraftedItemInstance } from "../items/itemRng.js";

export async function upsertCraftedItemInstance(instance: CraftedItemInstance): Promise<void> {
  if (!isPostgresConfigured()) return;
  await postgresQuery(
    `insert into game.crafted_item_instances (
      instance_id, owner_wallet, base_token_id, instance_json, crafted_at_ms, updated_at
    ) values ($1, $2, $3, $4::jsonb, $5, now())
    on conflict (instance_id) do update set
      owner_wallet = excluded.owner_wallet,
      base_token_id = excluded.base_token_id,
      instance_json = excluded.instance_json,
      crafted_at_ms = excluded.crafted_at_ms,
      updated_at = now()`,
    [
      instance.instanceId,
      instance.ownerWallet.toLowerCase(),
      instance.baseTokenId,
      JSON.stringify(instance),
      instance.craftedAt,
    ]
  );
}

export async function deleteCraftedItemInstance(instanceId: string): Promise<void> {
  if (!isPostgresConfigured()) return;
  await postgresQuery("delete from game.crafted_item_instances where instance_id = $1", [instanceId]);
}

export async function listCraftedItemInstances(): Promise<CraftedItemInstance[]> {
  if (!isPostgresConfigured()) return [];
  const { rows } = await postgresQuery<{ instance_json: CraftedItemInstance }>(
    `select instance_json
       from game.crafted_item_instances
      order by crafted_at_ms asc`
  );
  return rows.map((row) => row.instance_json);
}
