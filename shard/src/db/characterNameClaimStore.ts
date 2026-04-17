import { postgresQuery } from "./postgres.js";

function normalizeWallet(value: string): string {
  return value.trim().toLowerCase();
}

function collapseName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export async function claimCharacterName(params: {
  normalizedName: string;
  characterName: string;
  walletAddress: string;
  classId: string;
}): Promise<"claimed" | "already_owned" | "taken"> {
  const normalizedName = params.normalizedName.trim().toLowerCase();
  const normalizedWallet = normalizeWallet(params.walletAddress);
  const classId = params.classId.trim();
  const characterName = collapseName(params.characterName);

  if (!normalizedName || !normalizedWallet || !classId || !characterName) {
    throw new Error("claimCharacterName: invalid input");
  }

  const existing = await postgresQuery<{ wallet_address: string; class_id: string }>(
    `
      select wallet_address, class_id
      from game.character_name_claims
      where normalized_name = $1
      limit 1
    `,
    [normalizedName]
  );
  const owner = existing.rows[0];
  if (owner) {
    if (owner.wallet_address === normalizedWallet && owner.class_id === classId) {
      return "already_owned";
    }
    return "taken";
  }

  const inserted = await postgresQuery<{ normalized_name: string }>(
    `
      insert into game.character_name_claims (
        normalized_name,
        character_name,
        wallet_address,
        class_id,
        updated_at
      ) values ($1, $2, $3, $4, now())
      on conflict (normalized_name)
      do nothing
      returning normalized_name
    `,
    [normalizedName, characterName, normalizedWallet, classId]
  );

  if (inserted.rows.length > 0) {
    return "claimed";
  }

  // Lost a race and someone else claimed it between the read and insert.
  const afterRace = await postgresQuery<{ wallet_address: string; class_id: string }>(
    `
      select wallet_address, class_id
      from game.character_name_claims
      where normalized_name = $1
      limit 1
    `,
    [normalizedName]
  );
  const raceOwner = afterRace.rows[0];
  if (raceOwner && raceOwner.wallet_address === normalizedWallet && raceOwner.class_id === classId) {
    return "already_owned";
  }
  return "taken";
}

export async function releaseCharacterNameClaim(params: {
  normalizedName: string;
  walletAddress: string;
  classId: string;
}): Promise<void> {
  const normalizedName = params.normalizedName.trim().toLowerCase();
  const normalizedWallet = normalizeWallet(params.walletAddress);
  const classId = params.classId.trim();
  if (!normalizedName || !normalizedWallet || !classId) return;

  await postgresQuery(
    `
      delete from game.character_name_claims
      where normalized_name = $1
        and wallet_address = $2
        and class_id = $3
    `,
    [normalizedName, normalizedWallet, classId]
  );
}
