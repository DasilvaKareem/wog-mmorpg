/**
 * Agent Character Setup
 * Creates a custodial wallet, mints a character NFT, and spawns the entity
 * into village-square for a new user. Links the user wallet → custodial wallet in Redis.
 */

import { createCustodialWallet } from "../blockchain/custodialWalletRedis.js";
import {
  getAgentCustodialWallet,
  setAgentCustodialWallet,
  getAgentEntityRef,
  setAgentEntityRef,
  getAgentConfig,
  setAgentConfig,
  defaultConfig,
} from "./agentConfigStore.js";
import { authenticateWithWallet } from "../auth/authHelper.js";
import { loadCharacter } from "../character/characterStore.js";

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

export interface CharacterSetupResult {
  custodialWallet: string;
  entityId: string;
  zoneId: string;
  characterName: string;
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
  classId: string
): Promise<CharacterSetupResult> {
  const existing = await getAgentCustodialWallet(userWallet);

  // ── Step 1: Get or create custodial wallet ─────────────────────────────
  let custodialAddress: string;
  if (existing) {
    custodialAddress = existing;
    console.log(`[agentSetup] Reusing custodial wallet ${custodialAddress} for ${userWallet}`);
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
          alreadyExisted: true,
        };
      }
    } catch {
      // Zone might not be available, continue to re-spawn
    }
  }

  // ── Step 3: Mint character NFT (only if no saved character exists) ────
  // CRITICAL: /character/create used to overwrite Redis with level 1.
  // Skip it entirely when a saved character already exists to preserve progress.
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
      });
      console.log(`[agentSetup] Minted character "${characterName}" for ${custodialAddress}`);
    } catch (err: any) {
      // Character may already exist (duplicate name or wallet) — that's fine
      console.log(`[agentSetup] Char mint skipped: ${err.message?.slice(0, 80)}`);
    }
  }

  // ── Step 4: Authenticate custodial wallet to get JWT ──────────────────
  const { exportCustodialWallet } = await import("../blockchain/custodialWalletRedis.js");
  const rawPrivateKey = await exportCustodialWallet(custodialAddress);

  const token = await authenticateWithWallet(rawPrivateKey);

  // ── Step 5: Load character NFT to get level/xp/tokenId ────────────────
  let character: any;
  try {
    const charData = await apiCall("GET", `/character/${custodialAddress}`, undefined, token);
    character = charData.characters?.[0];
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
  const spawnTokenId = normalizeOnChainTokenId(character?.tokenId);

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
    raceId: spawnRace,
    classId: spawnClass,
  }, token);

  const entityId: string = spawnResult.spawned?.id;
  if (!entityId) throw new Error("Spawn failed — no entity ID returned");
  const resolvedZoneId: string = spawnResult.zone ?? startZone;

  // ── Step 7: Persist entity ref ────────────────────────────────────────
  await setAgentEntityRef(userWallet, { entityId, zoneId: resolvedZoneId });

  // ── Step 8: Init config if not already set ────────────────────────────
  const existingConfig = await getAgentConfig(userWallet);
  if (!existingConfig) {
    await setAgentConfig(userWallet, defaultConfig());
  }

  console.log(`[agentSetup] Agent ready: entity=${entityId} zone=${resolvedZoneId}`);

  return {
    custodialWallet: custodialAddress,
    entityId,
    zoneId: resolvedZoneId,
    characterName: spawnName,
    alreadyExisted: false,
  };
}
