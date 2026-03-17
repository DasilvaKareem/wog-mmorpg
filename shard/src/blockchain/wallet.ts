import type { FastifyInstance } from "fastify";
import { distributeSFuel, mintGold, getGoldBalance, getItemBalance, transferGoldFrom } from "./blockchain.js";
import { formatGold, getAvailableGold, getSpentGold } from "./goldLedger.js";
import { ITEM_CATALOG, getItemRarity } from "../items/itemCatalog.js";
import { goldToCopper, copperToGold } from "./currency.js";
import { createCustodialWallet, getCustodialWallet } from "./custodialWalletRedis.js";
import { assertRedisAvailable, getRedis, isMemoryFallbackAllowed } from "../redis.js";

// Track registered wallets to avoid duplicate welcome bonuses
const registeredWallets = new Set<string>();
let treasuryAddressCache: string | null = null;
let treasurySeededMem = false;
let treasuryInitPromise: Promise<string> | null = null;

const WELCOME_COPPER = 200;
const TREASURY_SEED_GOLD = "100000";
const TREASURY_ADDRESS_KEY = "wallet:welcome-treasury:address";
const TREASURY_SEEDED_KEY = "wallet:welcome-treasury:seeded";
const REGISTERED_WALLET_KEY_PREFIX = "wallet:registered:";
const WELCOME_GOLD = copperToGold(WELCOME_COPPER);

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function normalizeAddress(address: string): string {
  return address.toLowerCase();
}

async function getStoredTreasuryAddress(): Promise<string | null> {
  if (treasuryAddressCache) return treasuryAddressCache;

  const redis = getRedis();
  if (redis) {
    try {
      const fromRedis = await redis.get(TREASURY_ADDRESS_KEY);
      if (fromRedis) {
        treasuryAddressCache = normalizeAddress(fromRedis);
        return treasuryAddressCache;
      }
      return null;
    } catch (err) {
      if (!isMemoryFallbackAllowed()) throw err;
    }
  } else {
    assertRedisAvailable("getStoredTreasuryAddress");
  }
  return null;
}

async function storeTreasuryAddress(address: string): Promise<void> {
  const normalized = normalizeAddress(address);

  const redis = getRedis();
  if (redis) {
    try {
      await redis.set(TREASURY_ADDRESS_KEY, normalized);
      treasuryAddressCache = normalized;
      return;
    } catch (err) {
      if (!isMemoryFallbackAllowed()) throw err;
    }
  } else {
    assertRedisAvailable("storeTreasuryAddress");
  }

  treasuryAddressCache = normalized;
}

async function isTreasurySeeded(): Promise<boolean> {
  if (treasurySeededMem) return true;

  const redis = getRedis();
  if (redis) {
    try {
      const seeded = await redis.get(TREASURY_SEEDED_KEY);
      if (seeded === "1") {
        treasurySeededMem = true;
        return true;
      }
      return false;
    } catch (err) {
      if (!isMemoryFallbackAllowed()) throw err;
    }
  } else {
    assertRedisAvailable("isTreasurySeeded");
  }
  return false;
}

async function markTreasurySeeded(): Promise<void> {
  const redis = getRedis();
  if (redis) {
    try {
      await redis.set(TREASURY_SEEDED_KEY, "1");
      treasurySeededMem = true;
      return;
    } catch (err) {
      if (!isMemoryFallbackAllowed()) throw err;
    }
  } else {
    assertRedisAvailable("markTreasurySeeded");
  }

  treasurySeededMem = true;
}

async function isWalletRegistered(address: string): Promise<boolean> {
  const normalized = normalizeAddress(address);
  if (registeredWallets.has(normalized)) return true;

  const redis = getRedis();
  if (redis) {
    try {
      const exists = await redis.exists(`${REGISTERED_WALLET_KEY_PREFIX}${normalized}`);
      if (exists === 1) {
        registeredWallets.add(normalized);
        return true;
      }
      return false;
    } catch (err) {
      if (!isMemoryFallbackAllowed()) throw err;
    }
  } else {
    assertRedisAvailable("isWalletRegistered");
  }

  return false;
}

async function markWalletRegistered(address: string): Promise<void> {
  const normalized = normalizeAddress(address);

  const redis = getRedis();
  if (redis) {
    try {
      await redis.set(`${REGISTERED_WALLET_KEY_PREFIX}${normalized}`, "1");
      registeredWallets.add(normalized);
      return;
    } catch (err) {
      if (!isMemoryFallbackAllowed()) throw err;
    }
  } else {
    assertRedisAvailable("markWalletRegistered");
  }

  registeredWallets.add(normalized);
}

async function createAndSeedTreasury(server: FastifyInstance): Promise<string> {
  const treasury = await createCustodialWallet();
  const treasuryAddress = normalizeAddress(treasury.address);
  await storeTreasuryAddress(treasuryAddress);
  console.log(`[wallet/register] Created treasury wallet ${treasuryAddress}, funding...`);

  try {
    await distributeSFuel(treasuryAddress);
    console.log(`[wallet/register] sFUEL sent to treasury ${treasuryAddress}`);
  } catch (err: any) {
    console.warn(`[wallet/register] Failed to fund treasury gas ${treasuryAddress}: ${err.message}`);
  }

  console.log(`[wallet/register] Minting ${TREASURY_SEED_GOLD} GOLD to treasury...`);
  const seedTx = await mintGold(treasuryAddress, TREASURY_SEED_GOLD);
  await markTreasurySeeded();
  console.log(`[wallet/register] Treasury ${treasuryAddress} seeded with ${TREASURY_SEED_GOLD} GOLD: ${seedTx}`);
  return treasuryAddress;
}

async function ensureWelcomeTreasury(server: FastifyInstance): Promise<string> {
  if (treasuryInitPromise) {
    console.log(`[wallet/register] Treasury init already in progress, waiting...`);
    return treasuryInitPromise;
  }

  treasuryInitPromise = (async () => {
    let treasuryAddress = await getStoredTreasuryAddress();
    console.log(`[wallet/register] Stored treasury address: ${treasuryAddress ?? "none"}`);

    if (treasuryAddress) {
      try {
        await getCustodialWallet(treasuryAddress);
        console.log(`[wallet/register] Treasury wallet ${treasuryAddress} key found`);
      } catch (err: any) {
        console.warn(
          `[wallet/register] Treasury key missing for ${treasuryAddress}; creating new treasury (${err.message})`
        );
        treasuryAddress = null;
        treasurySeededMem = false;
      }
    }

    if (!treasuryAddress) {
      return createAndSeedTreasury(server);
    }

    if (!(await isTreasurySeeded())) {
      console.log(`[wallet/register] Treasury ${treasuryAddress} not seeded, minting ${TREASURY_SEED_GOLD} GOLD...`);
      const seedTx = await mintGold(treasuryAddress, TREASURY_SEED_GOLD);
      await markTreasurySeeded();
      console.log(`[wallet/register] Treasury ${treasuryAddress} seeded: ${seedTx}`);
    }

    return treasuryAddress;
  })();

  try {
    return await treasuryInitPromise;
  } finally {
    treasuryInitPromise = null;
  }
}

async function waitForTreasuryBalance(
  treasuryAddress: string,
  minimumGold: number,
  attempts = 20,
  delayMs = 3000
): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    const balance = parseFloat(await getGoldBalance(treasuryAddress));
    if (Number.isFinite(balance) && balance >= minimumGold) return;
    if (i < attempts - 1) await delay(delayMs);
  }
  throw new Error(
    `Welcome treasury balance not ready for transfer (required ${minimumGold}g)`
  );
}

async function transferWelcomeBonus(
  server: FastifyInstance,
  treasuryAddress: string,
  recipientAddress: string,
  welcomeGold: number
): Promise<string> {
  const treasuryAccount = await getCustodialWallet(treasuryAddress);

  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await transferGoldFrom(treasuryAccount, recipientAddress, welcomeGold.toString());
    } catch (err: any) {
      const msg = String(err?.message ?? err ?? "");
      const insufficientBalance = msg.includes("transfer amount exceeds balance");
      const lowGasBalance =
        msg.includes("Account balance is too low") ||
        msg.includes("insufficient funds for gas");

      if (lowGasBalance) {
        try {
          await distributeSFuel(treasuryAddress);
          server.log.info(`[wallet/register] Topped up treasury gas for ${treasuryAddress} after transfer attempt ${attempt + 1}`);
        } catch (sfuelErr: any) {
          server.log.warn(`[wallet/register] Failed topping up treasury gas ${treasuryAddress}: ${sfuelErr.message}`);
        }
      }

      if ((!insufficientBalance && !lowGasBalance) || attempt === 4) throw err;
      await delay(1200 * (attempt + 1));
    }
  }

  throw new Error("Failed to transfer welcome bonus");
}

export interface WalletRegistrationResult {
  ok: true;
  message: "Already registered" | "Wallet registered";
  sfuelTx?: string;
  goldTx?: string;
  treasuryWallet?: string;
  welcomeBonus?: {
    copper: number;
    gold: number;
  };
}

/**
 * Transfer gold from the treasury to a player wallet (e.g. mob loot rewards).
 * Returns the transaction hash, or throws on failure.
 * The treasury is lazily initialised on first call.
 */
export async function transferFromTreasury(
  toAddress: string,
  goldAmount: string
): Promise<string> {
  // Resolve treasury address (cached after first call)
  if (!treasuryAddressCache) {
    const stored = await getStoredTreasuryAddress();
    if (!stored) throw new Error("Treasury not initialised — call registerWalletWithWelcomeBonus first");
    treasuryAddressCache = stored;
  }
  const treasuryAccount = await getCustodialWallet(treasuryAddressCache);

  // Retry with sFUEL top-up if treasury is out of gas
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await transferGoldFrom(treasuryAccount, toAddress, goldAmount);
    } catch (err: any) {
      const msg = String(err?.message ?? err ?? "");
      const lowGas =
        msg.includes("Account balance is too low") ||
        msg.includes("insufficient funds for gas");
      if (!lowGas || attempt === 2) throw err;

      try {
        await distributeSFuel(treasuryAddressCache);
        console.log(`[treasury] Topped up sFUEL for treasury after attempt ${attempt + 1}`);
      } catch {
        // sFUEL top-up failed — next attempt will likely fail too, but try anyway
      }
    }
  }
  throw new Error("Failed to transfer from treasury");
}

/**
 * Idempotent wallet registration flow:
 * - first call gives sFUEL + marks registered immediately
 * - welcome gold bonus is sent in the background (non-blocking)
 * - subsequent calls return "Already registered"
 */
export async function registerWalletWithWelcomeBonus(
  server: FastifyInstance,
  address: string
): Promise<WalletRegistrationResult> {
  const normalized = address.toLowerCase();
  if (await isWalletRegistered(normalized)) {
    return { ok: true, message: "Already registered" };
  }

  // Mark registered immediately so the API responds fast — never block on blockchain
  await markWalletRegistered(normalized);

  // sFUEL + welcome gold both run in background — don't block the response
  void (async () => {
    try {
      const sfuelTx = await distributeSFuel(address);
      console.log(`[wallet/register] sFUEL sent to ${address}: ${sfuelTx}`);
    } catch (err: any) {
      console.warn(`[wallet/register] sFUEL distribution failed for ${address}: ${String(err?.message ?? "").slice(0, 150)}`);
    }

    try {
      const treasuryAddress = await ensureWelcomeTreasury(server);
      try { await distributeSFuel(treasuryAddress); } catch {}
      await waitForTreasuryBalance(treasuryAddress, WELCOME_GOLD);
      const goldTx = await transferWelcomeBonus(server, treasuryAddress, address, WELCOME_GOLD);
      console.log(
        `[wallet/register] Welcome bonus ${WELCOME_COPPER}c sent to ${address}: ${goldTx}`
      );
    } catch (err: any) {
      console.warn(`[wallet/register] Background welcome bonus failed for ${address}: ${String(err?.message ?? "").slice(0, 150)}`);
    }
  })();

  return {
    ok: true,
    message: "Wallet registered",
    welcomeBonus: {
      copper: WELCOME_COPPER,
      gold: WELCOME_GOLD,
    },
  };
}

export function registerWalletRoutes(server: FastifyInstance) {
  /**
   * POST /wallet/register { address } (or { walletAddress })
   * First-time wallet setup: distributes sFUEL + transfers 200 copper from welcome treasury.
   */
  server.post<{ Body: { address?: string; walletAddress?: string } }>(
    "/wallet/register",
    async (request, reply) => {
      const address = request.body.address ?? request.body.walletAddress;

      if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
        reply.code(400);
        return { error: "Invalid Ethereum address" };
      }

      try {
        return await registerWalletWithWelcomeBonus(server, address);
      } catch (err: any) {
        const msg = String(err?.message ?? err ?? "").slice(0, 300);
        console.error(`[wallet/register] FAILED for ${address}: ${msg}`);
        server.log.error(err, `Failed to register wallet ${address}`);
        reply.code(500);
        return { error: "Blockchain transaction failed", detail: msg };
      }
    }
  );

  /**
   * GET /wallet/:address/balance
   * Returns gold balance + all item balances from chain.
   */
  server.get<{ Params: { address: string } }>(
    "/wallet/:address/balance",
    async (request, reply) => {
      const { address } = request.params;

      if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
        reply.code(400);
        return { error: "Invalid Ethereum address" };
      }

      try {
        const onChainGold = parseFloat(await getGoldBalance(address));
        const safeOnChainGold = Number.isFinite(onChainGold) ? onChainGold : 0;
        const spentGold = getSpentGold(address);
        const availableGold = getAvailableGold(address, safeOnChainGold);

        // Fetch all item balances in parallel (cached 10s in blockchain.ts)
        const balanceResults = await Promise.all(
          ITEM_CATALOG.map((item) => getItemBalance(address, item.tokenId))
        );

        const items: {
          tokenId: string;
          name: string;
          balance: string;
          category: string;
          rarity: string;
          equipSlot: string | null;
          armorSlot: string | null;
          statBonuses: Record<string, number>;
          maxDurability: number | null;
        }[] = [];
        for (let i = 0; i < ITEM_CATALOG.length; i++) {
          const balance = balanceResults[i];
          if (balance > 0n) {
            const item = ITEM_CATALOG[i];
            items.push({
              tokenId: item.tokenId.toString(),
              name: item.name,
              balance: balance.toString(),
              category: item.category,
              rarity: getItemRarity(item.copperPrice),
              equipSlot: item.equipSlot ?? null,
              armorSlot: item.armorSlot ?? null,
              statBonuses: item.statBonuses ?? {},
              maxDurability: item.maxDurability ?? null,
            });
          }
        }

        return {
          address,
          copper: goldToCopper(availableGold),
          gold: formatGold(availableGold),
          onChainGold: formatGold(safeOnChainGold),
          spentGold: formatGold(spentGold),
          items,
        };
      } catch (err) {
        server.log.error(err, `Failed to fetch balance for ${address}`);
        reply.code(500);
        return { error: "Failed to read blockchain state" };
      }
    }
  );
}
