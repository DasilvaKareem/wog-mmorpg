import "dotenv/config";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { initPostgres } from "../src/db/postgres.js";
import { ensureGameSchema } from "../src/db/gameSchema.js";
import { upsertCharacterProjection } from "../src/character/characterProjectionStore.js";
import { upsertCraftedItemInstance } from "../src/db/itemInstanceStore.js";
import { putWalletRuntimeState } from "../src/db/walletInfraStore.js";
import { replaceFriends } from "../src/db/friendsStore.js";
import { savePersistedParty } from "../src/db/partyStore.js";

type ExportedCharacter = {
  walletAddress: string;
  characterName: string;
  classId: string;
  raceId: string;
  level: number;
  xp: number;
  zone?: string;
  calling?: string | null;
  gender?: string | null;
  skinColor?: string | null;
  hairStyle?: string | null;
  eyeColor?: string | null;
  origin?: string | null;
};

type ExportedItemInstance = {
  instanceId: string;
  ownerWallet: string;
  craftedBy: string;
  baseTokenId: number;
  quality: unknown;
  rolledStats: Record<string, unknown>;
  bonusAffix?: unknown;
  craftedAt: number;
  recipeId: string;
  displayName: string;
  currentDurability: number;
  currentMaxDurability: number;
  rolledMaxDurability: number;
  enchantments?: unknown[];
  generatedName?: unknown;
};

type ExportedFriendList = {
  walletAddress: string;
  friends: Array<{ wallet: string; addedAt: number }>;
};

type ExportedParty = {
  id: string;
  leaderWallet: string;
  memberWallets: string[];
  zoneId: string;
  createdAt: number;
  shareXp: boolean;
  shareGold: boolean;
};

type ExportPayload = {
  counts: Record<string, number>;
  registeredWallets: string[];
  characters: ExportedCharacter[];
  craftedItemInstances: ExportedItemInstance[];
  friends: ExportedFriendList[];
  parties: ExportedParty[];
};

function normalizeWallet(value: string): string {
  return value.trim().toLowerCase();
}

async function main() {
  const sourcePath = process.argv[2];
  if (!sourcePath) {
    throw new Error("Usage: tsx scripts/importPlayerExportToPostgres.ts <export-json-path> [--include-registered-wallets]");
  }
  const includeRegisteredWallets = process.argv.includes("--include-registered-wallets");

  const resolvedPath = path.resolve(process.cwd(), sourcePath);
  const raw = await readFile(resolvedPath, "utf8");
  const payload = JSON.parse(raw) as ExportPayload;

  await initPostgres();
  await ensureGameSchema();

  console.log(`[import] source ${resolvedPath}`);
  console.log(`[import] counts ${JSON.stringify(payload.counts)}`);

  let importedCharacters = 0;
  for (const character of payload.characters ?? []) {
    await upsertCharacterProjection({
      walletAddress: normalizeWallet(character.walletAddress),
      character: {
        name: character.characterName,
        classId: character.classId,
        raceId: character.raceId,
        level: Number(character.level ?? 1) || 1,
        xp: Number(character.xp ?? 0) || 0,
        zone: character.zone ?? "village-square",
        calling: character.calling ?? undefined,
        gender: character.gender ?? undefined,
        skinColor: character.skinColor ?? undefined,
        hairStyle: character.hairStyle ?? undefined,
        eyeColor: character.eyeColor ?? undefined,
        origin: character.origin ?? undefined,
      },
      source: "prod-redis-import",
    });
    importedCharacters += 1;
    if (importedCharacters % 50 === 0 || importedCharacters === payload.characters.length) {
      console.log(`[import] characters ${importedCharacters}/${payload.characters.length}`);
    }
  }

  let importedItems = 0;
  for (const instance of payload.craftedItemInstances ?? []) {
    await upsertCraftedItemInstance({
      ...instance,
      ownerWallet: normalizeWallet(instance.ownerWallet),
      craftedBy: normalizeWallet(instance.craftedBy),
      enchantments: Array.isArray(instance.enchantments) ? instance.enchantments : [],
    });
    importedItems += 1;
    if (importedItems % 250 === 0 || importedItems === payload.craftedItemInstances.length) {
      console.log(`[import] items ${importedItems}/${payload.craftedItemInstances.length}`);
    }
  }

  let importedRegisteredWallets = 0;
  if (includeRegisteredWallets) {
    for (const wallet of payload.registeredWallets ?? []) {
      await putWalletRuntimeState(`wallet:registered:${normalizeWallet(wallet)}`, "1");
      importedRegisteredWallets += 1;
    }
    console.log(`[import] registered wallets ${importedRegisteredWallets}/${payload.registeredWallets.length}`);
  } else {
    console.log(
      `[import] registered wallets skipped (${payload.registeredWallets.length} present in export; pass --include-registered-wallets to restore them)`
    );
  }

  let importedFriends = 0;
  for (const record of payload.friends ?? []) {
    await replaceFriends(
      normalizeWallet(record.walletAddress),
      (record.friends ?? []).map((entry) => ({
        wallet: normalizeWallet(entry.wallet),
        addedAt: Number(entry.addedAt ?? 0) || 0,
      }))
    );
    importedFriends += 1;
  }
  console.log(`[import] friend lists ${importedFriends}/${payload.friends.length}`);

  let importedParties = 0;
  for (const party of payload.parties ?? []) {
    await savePersistedParty({
      id: party.id,
      leaderWallet: normalizeWallet(party.leaderWallet),
      memberWallets: (party.memberWallets ?? []).map(normalizeWallet),
      zoneId: party.zoneId ?? "village-square",
      createdAt: Number(party.createdAt ?? 0) || Date.now(),
      shareXp: Boolean(party.shareXp),
      shareGold: Boolean(party.shareGold),
    });
    importedParties += 1;
  }
  console.log(`[import] parties ${importedParties}/${payload.parties.length}`);

  console.log("[import] done");
}

main().catch((error) => {
  console.error("[import] failed", error);
  process.exit(1);
});
