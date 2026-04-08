import { postgresQuery, withPostgresClient } from "./postgres.js";

export interface EquipmentStateRecord {
  walletAddress: string;
  normalizedName: string;
  slotId: string;
  itemState: Record<string, unknown>;
  updatedAt: string;
}

function normalizeWallet(walletAddress: string): string {
  return walletAddress.trim().toLowerCase();
}

function normalizeCharacterName(value: string): string {
  return value.trim().replace(/\s+/g, " ").replace(/\s+the\s+\w+$/i, "").trim().toLowerCase();
}

export async function replaceEquipmentState(params: {
  walletAddress: string;
  characterName: string;
  equipment: Record<string, unknown> | undefined;
}): Promise<void> {
  const walletAddress = normalizeWallet(params.walletAddress);
  const normalizedName = normalizeCharacterName(params.characterName);
  const equipmentEntries = Object.entries(params.equipment ?? {}).filter(([, value]) => value && typeof value === "object");

  await withPostgresClient(async (client) => {
    await client.query("begin");
    try {
      await client.query(
        `delete from game.character_equipment where wallet_address = $1 and normalized_name = $2`,
        [walletAddress, normalizedName]
      );
      for (const [slotId, itemState] of equipmentEntries) {
        await client.query(
          `
            insert into game.character_equipment (
              wallet_address,
              normalized_name,
              slot_id,
              item_state_json,
              updated_at
            ) values ($1, $2, $3, $4::jsonb, now())
          `,
          [walletAddress, normalizedName, slotId, JSON.stringify(itemState)]
        );
      }
      await client.query("commit");
    } catch (err) {
      await client.query("rollback");
      throw err;
    }
  });
}

export async function listEquipmentStateForWallet(walletAddress: string): Promise<EquipmentStateRecord[]> {
  const { rows } = await postgresQuery<{
    wallet_address: string;
    normalized_name: string;
    slot_id: string;
    item_state_json: Record<string, unknown> | null;
    updated_at: string;
  }>(
    `
      select
        wallet_address,
        normalized_name,
        slot_id,
        item_state_json,
        updated_at::text as updated_at
      from game.character_equipment
      where wallet_address = $1
      order by normalized_name asc, slot_id asc
    `,
    [normalizeWallet(walletAddress)]
  );

  return rows.map((row) => ({
    walletAddress: row.wallet_address,
    normalizedName: row.normalized_name,
    slotId: row.slot_id,
    itemState: row.item_state_json ?? {},
    updatedAt: row.updated_at,
  }));
}
