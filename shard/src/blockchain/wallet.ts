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

  try {
    await distributeSFuel(treasuryAddress);
  } catch (err: any) {
    server.log.warn(`[wallet/register] Failed to fund welcome treasury gas wallet ${treasuryAddress}: ${err.message}`);
  }

  const seedTx = await mintGold(treasuryAddress, TREASURY_SEED_GOLD);
  await markTreasurySeeded();
  server.log.info(`[wallet/register] Welcome treasury ${treasuryAddress} seeded with ${TREASURY_SEED_GOLD} GOLD: ${seedTx}`);
  return treasuryAddress;
}

async function ensureWelcomeTreasury(server: FastifyInstance): Promise<string> {
  if (treasuryInitPromise) return treasuryInitPromise;

  treasuryInitPromise = (async () => {
    let treasuryAddress = await getStoredTreasuryAddress();

    if (treasuryAddress) {
      try {
        await getCustodialWallet(treasuryAddress);
      } catch (err: any) {
        server.log.warn(
          `[wallet/register] Stored welcome treasury key missing for ${treasuryAddress}; creating a new treasury wallet (${err.message})`
        );
        treasuryAddress = null;
        treasurySeededMem = false;
      }
    }

    if (!treasuryAddress) {
      return createAndSeedTreasury(server);
    }

    if (!(await isTreasurySeeded())) {
      const seedTx = await mintGold(treasuryAddress, TREASURY_SEED_GOLD);
      await markTreasurySeeded();
      server.log.info(`[wallet/register] Welcome treasury ${treasuryAddress} seeded with ${TREASURY_SEED_GOLD} GOLD: ${seedTx}`);
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
  attempts = 8,
  delayMs = 1200
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

      const normalized = address.toLowerCase();

      if (await isWalletRegistered(normalized)) {
        return { ok: true, message: "Already registered" };
      }

      try {
        const sfuelTx = await distributeSFuel(address);
        server.log.info(`sFUEL sent to ${address}: ${sfuelTx}`);

        const treasuryAddress = await ensureWelcomeTreasury(server);
        try {
          await distributeSFuel(treasuryAddress);
        } catch (err: any) {
          server.log.warn(`[wallet/register] Failed to top up treasury gas ${treasuryAddress}: ${err.message}`);
        }
        await waitForTreasuryBalance(treasuryAddress, WELCOME_GOLD);
        const goldTx = await transferWelcomeBonus(server, treasuryAddress, address, WELCOME_GOLD);
        server.log.info(
          `[wallet/register] Transferred welcome bonus ${WELCOME_COPPER}c (${WELCOME_GOLD}g) from treasury ${treasuryAddress} to ${address}: ${goldTx}`
        );

        await markWalletRegistered(normalized);

        return {
          ok: true,
          message: "Wallet registered",
          sfuelTx,
          goldTx,
          treasuryWallet: treasuryAddress,
          welcomeBonus: {
            copper: WELCOME_COPPER,
            gold: WELCOME_GOLD,
          },
        };
      } catch (err) {
        server.log.error(err, `Failed to register wallet ${address}`);
        reply.code(500);
        return { error: "Blockchain transaction failed" };
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
