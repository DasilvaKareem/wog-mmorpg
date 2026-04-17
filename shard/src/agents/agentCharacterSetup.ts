/**
 * Agent Character Setup
 * Creates a custodial wallet, mints a character NFT, and spawns the entity
 * into village-square for a new user. Links the user wallet → custodial wallet in Redis.
 */

import { createCustodialWallet } from "../blockchain/custodialWalletRedis.js";
import {
  getAgentCustodialWallet,
  setAgentCustodialWallet,
  clearAgentCustodialWallet,
  getAgentEntityRef,
  setAgentEntityRef,
  clearAgentEntityRef,
  getAgentConfig,
  setAgentConfig,
  defaultConfig,
} from "./agentConfigStore.js";
import { authenticateWithWallet } from "../auth/authHelper.js";
import { loadCharacter } from "../character/characterStore.js";
import { buildVerifiedIdentityPatch } from "../character/characterIdentityPersistence.js";
import { getAllEntities, isWalletSpawned } from "../world/zoneRuntime.js";
import { extractRawCharacterName } from "./agentUtils.js";

const API_URL = process.env.API_URL || "http://localhost:3000";

async function apiCall(method: string, path: string, body?: unknown, token?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: any;
  try { data = JSON.parse(text); } catch { data = { error: text }; }
  if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
  return data;
}

function normalizeOnChainTokenId(value: unknown): string | undefined {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value).toString();
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return undefined;
  return trimmed;
}

function normalizeCharacterLookupName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const raw = extractRawCharacterName(value) ?? value;
  const trimmed = raw.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

function selectRequestedCharacter(characters: any[] | undefined, requestedName: string): any | null {
  if (!Array.isArray(characters) || characters.length === 0) return null;
  const normalizedRequested = normalizeCharacterLookupName(requestedName);
  if (!normalizedRequested) {
    const sorted = [...characters].sort((left, right) => {
      const leftLevel = Number(left?.properties?.level ?? 1);
      const rightLevel = Number(right?.properties?.level ?? 1);
      if (leftLevel !== rightLevel) return rightLevel - leftLevel;
      const leftXp = Number(left?.properties?.xp ?? 0);
      const rightXp = Number(right?.properties?.xp ?? 0);
      if (leftXp !== rightXp) return rightXp - leftXp;
      return String(left?.name ?? "").localeCompare(String(right?.name ?? ""));
    });
    return sorted[0] ?? null;
  }

  const exact = characters.find((character) => {
    const candidate = normalizeCharacterLookupName(character?.name);
    return candidate === normalizedRequested;
  });
  return exact ?? null;
}

export interface CharacterSetupResult {
  custodialWallet: string;
  entityId: string;
  zoneId: string;
  characterName: string;
  agentId?: string;
  characterTokenId?: string;
  alreadyExisted: boolean;
}

/**
 * Idempotent setup — safe to call multiple times.
 * Returns the existing setup if already done.
 */
export async function setupAgentCharacter(
  userWallet: string,
  characterName: string,
  raceId: string,
  classId: string,
  calling?: "adventurer" | "farmer" | "merchant" | "craftsman"
): Promise<CharacterSetupResult> {
  const existing = await getAgentCustodialWallet(userWallet);
  const { exportCustodialWallet } = await import("../blockchain/custodialWalletRedis.js");

  // ── Step 1: Get or create custodial wallet ─────────────────────────────
  let custodialAddress: string;
  if (existing) {
    try {
      await exportCustodialWallet(existing);
      custodialAddress = existing;
      console.log(`[agentSetup] Reusing custodial wallet ${custodialAddress} for ${userWallet}`);
    } catch (err: any) {
      const msg = String(err?.message ?? err ?? "");
      const staleCipher =
        msg.includes("unable to authenticate data") ||
        msg.includes("Unsupported state") ||
        msg.includes("Custodial wallet not found");
      if (!staleCipher) {
        throw err;
      }
      console.warn(`[agentSetup] Stale custodial wallet mapping for ${userWallet}: ${existing} (${msg.slice(0, 120)})`);
      await clearAgentCustodialWallet(userWallet);
      const wallet = await createCustodialWallet();
      custodialAddress = wallet.address.toLowerCase();
      await setAgentCustodialWallet(userWallet, custodialAddress);
      console.log(`[agentSetup] Replaced broken custodial wallet with ${custodialAddress} for ${userWallet}`);
    }
  } else {
    const wallet = await createCustodialWallet();
    custodialAddress = wallet.address.toLowerCase();
    await setAgentCustodialWallet(userWallet, custodialAddress);
    console.log(`[agentSetup] Created custodial wallet ${custodialAddress} for ${userWallet}`);
  }

  // ── Step 2: Check if entity already spawned ────────────────────────────
  const existingRef = await getAgentEntityRef(userWallet);
  if (existingRef) {
    // Verify it still exists in the zone
    try {
      const zoneData = await apiCall("GET", `/zones/${existingRef.zoneId}`);
      if (zoneData?.entities?.[existingRef.entityId]) {
        return {
          custodialWallet: custodialAddress,
          entityId: existingRef.entityId,
          zoneId: existingRef.zoneId,
          characterName,
          agentId: existingRef.agentId,
          characterTokenId: existingRef.characterTokenId,
          alreadyExisted: true,
        };
      }
    } catch {
      // Zone might not be available, continue to re-spawn
    }
    // Entity ref exists but entity is gone — clear stale ref
    await clearAgentEntityRef(userWallet);
    console.log(`[agentSetup] Cleared stale entity ref for ${userWallet.slice(0, 8)}`);
  }

  // If the shard still has a live player entity for this custodial wallet but the
  // Redis agent ref was lost, reattach to it instead of failing a fresh spawn.
  const spawnedEntry = isWalletSpawned(custodialAddress);
  if (spawnedEntry) {
    const liveEntity = getAllEntities().get(spawnedEntry.entityId);
    if (liveEntity?.type === "player") {
      const recoveredTokenId =
        typeof liveEntity.characterTokenId === "bigint"
          ? liveEntity.characterTokenId.toString()
          : typeof liveEntity.characterTokenId === "number"
            ? Math.trunc(liveEntity.characterTokenId).toString()
            : undefined;
      const recoveredAgentId =
        typeof liveEntity.agentId === "bigint"
          ? liveEntity.agentId.toString()
          : typeof liveEntity.agentId === "number"
            ? Math.trunc(liveEntity.agentId).toString()
            : undefined;
      const verifiedLiveIdentity = await buildVerifiedIdentityPatch(custodialAddress, {
        characterTokenId: recoveredTokenId,
        agentId: recoveredAgentId,
      });

      await setAgentEntityRef(userWallet, {
        entityId: spawnedEntry.entityId,
        zoneId: spawnedEntry.zoneId,
        characterName: extractRawCharacterName(liveEntity.name) ?? liveEntity.name,
        ...(verifiedLiveIdentity.characterTokenId ? { characterTokenId: verifiedLiveIdentity.characterTokenId } : {}),
        ...(verifiedLiveIdentity.agentId ? { agentId: verifiedLiveIdentity.agentId } : {}),
      });

      console.log(`[agentSetup] Reattached to live shard entity ${spawnedEntry.entityId} for ${userWallet}`);
      return {
        custodialWallet: custodialAddress,
        entityId: spawnedEntry.entityId,
        zoneId: spawnedEntry.zoneId,
        characterName: extractRawCharacterName(liveEntity.name) ?? liveEntity.name,
        agentId: verifiedLiveIdentity.agentId ?? undefined,
        characterTokenId: verifiedLiveIdentity.characterTokenId ?? undefined,
        alreadyExisted: true,
      };
    }
  }

  // ── Step 3: Mint character NFT (only if no saved character exists) ────
  // CRITICAL: /character/create used to overwrite Redis with level 1.
  // Skip it entirely when a saved character already exists to preserve progress.
  const rawPrivateKey = await exportCustodialWallet(custodialAddress);
  const token = await authenticateWithWallet(rawPrivateKey);

  const existingSave = await loadCharacter(custodialAddress, characterName);
  if (existingSave) {
    console.log(`[agentSetup] Character "${characterName}" already saved (L${existingSave.level}) — skipping create`);
  } else {
    try {
      await apiCall("POST", "/character/create", {
        walletAddress: custodialAddress,
        name: characterName,
        race: raceId,
        className: classId,
        ...(calling && { calling }),
      }, token);
      console.log(`[agentSetup] Minted character "${characterName}" for ${custodialAddress}`);
    } catch (err: any) {
      // Character may already exist (duplicate name or wallet) — that's fine
      console.log(`[agentSetup] Char mint skipped: ${err.message?.slice(0, 80)}`);
    }
  }

  // ── Step 4: Authenticate custodial wallet to get JWT ──────────────────
  // ── Step 5: Load character NFT to get level/xp/tokenId ────────────────
  let character: any;
  try {
    const charData = await apiCall("GET", `/character/${custodialAddress}`, undefined, token);
    character = selectRequestedCharacter(charData.characters, characterName);
  } catch {
    character = null;
  }

  // Use the passed-in characterName (raw, e.g., "Zephyr") for spawning.
  // The character mint formatted it as "Zephyr the Mage" in the NFT, but
  // the spawn route uses the name as-is, so we pass the raw name directly.
  const spawnName = characterName;
  const spawnLevel = character?.properties?.level ?? 1;
  const spawnXp = character?.properties?.xp ?? 0;
  const spawnRace = character?.properties?.race ?? raceId;
  const spawnClass = character?.properties?.class ?? classId;
  const verifiedSpawnIdentity = await buildVerifiedIdentityPatch(custodialAddress, {
    characterTokenId: character?.characterTokenId ?? character?.tokenId ?? existingSave?.characterTokenId,
    agentId: character?.agentId ?? existingSave?.agentId,
    agentRegistrationTxHash: character?.agentRegistrationTxHash ?? existingSave?.agentRegistrationTxHash,
    chainRegistrationStatus: character?.chainRegistrationStatus ?? existingSave?.chainRegistrationStatus,
  });
  const spawnTokenId = verifiedSpawnIdentity.characterTokenId;
  const spawnAgentId = verifiedSpawnIdentity.agentId;

  // ── Step 6: Spawn into last known zone (or village-square for new agents) ──
  const startZone = existingRef?.zoneId ?? "village-square";
  const spawnResult = await apiCall("POST", "/spawn", {
    zoneId: startZone,
    type: "player",
    name: spawnName,
    x: 150,
    y: 150,
    walletAddress: custodialAddress,
    level: spawnLevel,
    xp: spawnXp,
    characterTokenId: spawnTokenId,
    agentId: spawnAgentId,
    raceId: spawnRace,
    classId: spawnClass,
  }, token);

  const entityId: string = spawnResult.spawned?.id;
  if (!entityId) throw new Error("Spawn failed — no entity ID returned");
  const resolvedZoneId: string = spawnResult.zone ?? startZone;

  // ── Step 7: Persist entity ref ────────────────────────────────────────
  await setAgentEntityRef(userWallet, {
    entityId,
    zoneId: resolvedZoneId,
    characterName: spawnName,
    ...(spawnAgentId ? { agentId: spawnAgentId } : {}),
    ...(spawnTokenId ? { characterTokenId: spawnTokenId } : {}),
  });

  // ── Step 8: Init config if not already set ────────────────────────────
  const existingConfig = await getAgentConfig(userWallet);
  if (!existingConfig) {
    const config = defaultConfig();
    // Set initial focus based on calling
    if (calling === "adventurer") config.focus = "combat";
    else if (calling === "farmer") config.focus = "cooking";
    else if (calling === "merchant") config.focus = "trading";
    else if (calling === "craftsman") config.focus = "crafting";
    await setAgentConfig(userWallet, config);
  }

  console.log(`[agentSetup] Agent ready: entity=${entityId} zone=${resolvedZoneId}`);

  return {
    custodialWallet: custodialAddress,
    entityId,
    zoneId: resolvedZoneId,
    characterName: spawnName,
    agentId: spawnAgentId ?? undefined,
    characterTokenId: spawnTokenId ?? undefined,
    alreadyExisted: false,
  };
}
