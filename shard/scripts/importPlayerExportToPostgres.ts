import "dotenv/config";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { initPostgres } from "../src/db/postgres.js";
import { ensureGameSchema } from "../src/db/gameSchema.js";
import { upsertCharacterProjection } from "../src/character/characterProjectionStore.js";
import type { CharacterSaveData } from "../src/character/characterStore.js";
import { upsertCraftedItemInstance } from "../src/db/itemInstanceStore.js";
import { putWalletRuntimeState } from "../src/db/walletInfraStore.js";
import { replaceFriends } from "../src/db/friendsStore.js";
import { savePersistedParty } from "../src/db/partyStore.js";
import { replaceProfessionStateForWallet } from "../src/db/professionStateStore.js";
import { replaceEquipmentState } from "../src/db/equipmentStateStore.js";

type ExportedCharacter = {
  walletAddress: string;
  characterName: string;
  name?: string;
  classId: string;
  raceId: string;
  level: number;
  xp: number;
  zone?: string;
  x?: number;
  y?: number;
  kills?: number;
  calling?: string | null;
  gender?: string | null;
  skinColor?: string | null;
  hairStyle?: string | null;
  eyeColor?: string | null;
  origin?: string | null;
  activeQuests?: Array<{ questId: string; progress: number; startedAt: number }>;
  completedQuests?: string[];
  storyFlags?: string[];
  learnedTechniques?: string[];
  professions?: string[];
  runEnergy?: number | null;
  maxRunEnergy?: number | null;
  runModeEnabled?: boolean | string | null;
  signatureTechniqueId?: string | null;
  ultimateTechniqueId?: string | null;
  equipment?: Record<string, unknown> | null;
  professionSkills?: Record<string, { xp: number; level: number; actions: number }> | null;
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

function hasRenderableCharacterFields(character: ExportedCharacter): boolean {
  const name = String(character.name ?? character.characterName ?? "").trim();
  return Boolean(name && String(character.raceId ?? "").trim() && String(character.classId ?? "").trim());
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => String(entry));
}

function normalizeActiveQuests(value: unknown): NonNullable<CharacterSaveData["activeQuests"]> {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry) => entry && typeof entry === "object")
    .map((entry) => ({
      questId: String((entry as { questId?: unknown }).questId ?? ""),
      progress: Number((entry as { progress?: unknown }).progress ?? 0) || 0,
      startedAt: Number((entry as { startedAt?: unknown }).startedAt ?? 0) || 0,
    }))
    .filter((entry) => entry.questId.length > 0);
}

function normalizeProfessionSkills(value: unknown): NonNullable<CharacterSaveData["professionSkills"]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const skills: NonNullable<CharacterSaveData["professionSkills"]> = {};
  for (const [professionId, rawSkill] of Object.entries(value)) {
    if (!rawSkill || typeof rawSkill !== "object" || Array.isArray(rawSkill)) continue;
    skills[professionId] = {
      xp: Math.max(0, Number((rawSkill as { xp?: unknown }).xp ?? 0) || 0),
      level: Math.max(1, Number((rawSkill as { level?: unknown }).level ?? 1) || 1),
      actions: Math.max(0, Number((rawSkill as { actions?: unknown }).actions ?? 0) || 0),
    };
  }
  return skills;
}

function normalizeBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value === "true") return true;
    if (value === "false") return false;
  }
  return undefined;
}

function buildCharacterSnapshot(character: ExportedCharacter): CharacterSaveData {
  const name = String(character.name ?? character.characterName ?? "").trim();
  const raceId = String(character.raceId ?? "").trim();
  const classId = String(character.classId ?? "").trim();
  if (!hasRenderableCharacterFields(character) || !raceId || !classId) {
    throw new Error(`incomplete character record for "${name || character.characterName || "<unknown>"}"`);
  }
  return {
    name,
    level: Math.max(1, Number(character.level ?? 1) || 1),
    xp: Math.max(0, Number(character.xp ?? 0) || 0),
    raceId,
    classId,
    calling: character.calling ?? undefined,
    gender: character.gender ?? undefined,
    skinColor: character.skinColor ?? undefined,
    hairStyle: character.hairStyle ?? undefined,
    eyeColor: character.eyeColor ?? undefined,
    origin: character.origin ?? undefined,
    zone: character.zone ?? "village-square",
    x: Number(character.x ?? 0) || 0,
    y: Number(character.y ?? 0) || 0,
    kills: Math.max(0, Number(character.kills ?? 0) || 0),
    activeQuests: normalizeActiveQuests(character.activeQuests),
    completedQuests: normalizeStringArray(character.completedQuests),
    storyFlags: normalizeStringArray(character.storyFlags),
    learnedTechniques: normalizeStringArray(character.learnedTechniques),
    professions: normalizeStringArray(character.professions),
    runEnergy: character.runEnergy != null ? Number(character.runEnergy) || 0 : undefined,
    maxRunEnergy: character.maxRunEnergy != null ? Number(character.maxRunEnergy) || 0 : undefined,
    runModeEnabled: normalizeBoolean(character.runModeEnabled),
    signatureTechniqueId: character.signatureTechniqueId ?? undefined,
    ultimateTechniqueId: character.ultimateTechniqueId ?? undefined,
    equipment: character.equipment && typeof character.equipment === "object" && !Array.isArray(character.equipment)
      ? character.equipment
      : undefined,
    professionSkills: normalizeProfessionSkills(character.professionSkills),
  };
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
  let skippedCharacters = 0;
  for (const character of payload.characters ?? []) {
    if (!hasRenderableCharacterFields(character)) {
      skippedCharacters += 1;
      if (skippedCharacters <= 10) {
        console.warn(
          `[import] skipping incomplete character ${normalizeWallet(character.walletAddress)}:${character.characterName}`
        );
      }
      continue;
    }
    const snapshot = buildCharacterSnapshot(character);
    await upsertCharacterProjection({
      walletAddress: normalizeWallet(character.walletAddress),
      character: {
        name: snapshot.name,
        classId: snapshot.classId,
        raceId: snapshot.raceId,
        level: snapshot.level,
        xp: snapshot.xp,
        zone: snapshot.zone,
        calling: snapshot.calling,
        gender: snapshot.gender,
        skinColor: snapshot.skinColor,
        hairStyle: snapshot.hairStyle,
        eyeColor: snapshot.eyeColor,
        origin: snapshot.origin,
      },
      fullSnapshot: snapshot as unknown as Record<string, unknown>,
      source: "prod-redis-import",
    });
    await replaceProfessionStateForWallet({
      walletAddress: normalizeWallet(character.walletAddress),
      professions: snapshot.professions ?? [],
      skills: snapshot.professionSkills ?? {},
    });
    await replaceEquipmentState({
      walletAddress: normalizeWallet(character.walletAddress),
      characterName: snapshot.name,
      equipment: snapshot.equipment,
    });
    importedCharacters += 1;
    if (importedCharacters % 50 === 0 || importedCharacters === payload.characters.length) {
      console.log(`[import] characters ${importedCharacters}/${payload.characters.length}`);
    }
  }
  if (skippedCharacters > 0) {
    console.log(`[import] skipped incomplete characters ${skippedCharacters}`);
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
