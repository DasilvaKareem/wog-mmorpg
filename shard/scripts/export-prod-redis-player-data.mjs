import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import Redis from "ioredis";

const redisUrl = process.env.REDIS_URL?.trim();

if (!redisUrl) {
  console.error("REDIS_URL is required");
  process.exit(1);
}

const outputDir = path.resolve(process.cwd(), "data", "exports");

const redis = new Redis(redisUrl, {
  lazyConnect: true,
  maxRetriesPerRequest: 3,
  connectTimeout: 15_000,
  ...(redisUrl.startsWith("rediss://") ? { tls: { rejectUnauthorized: false } } : {}),
});

function parseJsonMaybe(value) {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function parseNumberMaybe(value) {
  if (typeof value !== "string") return value;
  if (value.trim() === "") return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : value;
}

function normalizeWallet(wallet) {
  return String(wallet ?? "").toLowerCase();
}

async function scanKeys(pattern, count = 1000) {
  const keys = [];
  let cursor = "0";
  do {
    const [nextCursor, batch] = await redis.scan(cursor, "MATCH", pattern, "COUNT", count);
    cursor = nextCursor;
    if (Array.isArray(batch) && batch.length > 0) {
      keys.push(...batch);
    }
  } while (cursor !== "0");
  return keys;
}

async function fetchStrings(keys, batchSize = 200) {
  const values = new Map();
  for (let i = 0; i < keys.length; i += batchSize) {
    const batch = keys.slice(i, i + batchSize);
    const rawValues = await redis.mget(batch);
    for (let j = 0; j < batch.length; j += 1) {
      values.set(batch[j], rawValues[j]);
    }
    console.log(`[export] fetched ${Math.min(i + batch.length, keys.length)}/${keys.length} string keys`);
  }
  return values;
}

async function fetchHashes(keys, batchSize = 100) {
  const values = new Map();
  for (let i = 0; i < keys.length; i += batchSize) {
    const batch = keys.slice(i, i + batchSize);
    const results = await Promise.all(batch.map((key) => redis.hgetall(key)));
    for (let j = 0; j < batch.length; j += 1) {
      values.set(batch[j], results[j]);
    }
    console.log(`[export] fetched ${Math.min(i + batch.length, keys.length)}/${keys.length} hash keys`);
  }
  return values;
}

function sanitizeCharacterRecord(key, raw) {
  const parts = key.split(":");
  const walletAddress = normalizeWallet(parts[1]);
  const characterName = parts.slice(2).join(":");
  const parsed = {};
  const omittedFields = new Set([
    "agentId",
    "agentRegistrationTxHash",
    "chainRegistrationStatus",
    "chainRegistrationLastError",
    "characterTokenId",
  ]);

  for (const [field, value] of Object.entries(raw)) {
    if (omittedFields.has(field)) continue;
    if (
      field === "activeQuests" ||
      field === "completedQuests" ||
      field === "storyFlags" ||
      field === "learnedTechniques" ||
      field === "professions" ||
      field === "pendingQuestApprovals" ||
      field === "equipment" ||
      field === "professionSkills"
    ) {
      parsed[field] = parseJsonMaybe(value);
      continue;
    }
    parsed[field] = parseNumberMaybe(value);
  }

  return {
    walletAddress,
    characterName,
    ...parsed,
  };
}

function sanitizeItemInstance(instance) {
  if (!instance || typeof instance !== "object") return null;
  return {
    instanceId: instance.instanceId,
    ownerWallet: normalizeWallet(instance.ownerWallet),
    craftedBy: normalizeWallet(instance.craftedBy),
    baseTokenId: Number(instance.baseTokenId),
    recipeId: instance.recipeId ?? null,
    displayName: instance.displayName ?? null,
    quality: instance.quality ?? null,
    rolledStats: instance.rolledStats ?? {},
    bonusAffix: instance.bonusAffix ?? null,
    craftedAt: Number(instance.craftedAt ?? 0),
    currentDurability: Number(instance.currentDurability ?? 0),
    currentMaxDurability: Number(instance.currentMaxDurability ?? 0),
    rolledMaxDurability: Number(instance.rolledMaxDurability ?? 0),
    enchantments: Array.isArray(instance.enchantments) ? instance.enchantments : [],
    generatedName: instance.generatedName ?? null,
  };
}

function buildInventorySummary(items) {
  const byWallet = new Map();
  for (const item of items) {
    if (!item?.ownerWallet) continue;
    const wallet = item.ownerWallet;
    const bucket = byWallet.get(wallet) ?? {
      walletAddress: wallet,
      totalCraftedItems: 0,
      items: [],
    };
    bucket.totalCraftedItems += 1;
    bucket.items.push({
      instanceId: item.instanceId,
      baseTokenId: item.baseTokenId,
      displayName: item.displayName,
      recipeId: item.recipeId,
      qualityTier: item.quality?.tier ?? null,
      currentDurability: item.currentDurability,
      currentMaxDurability: item.currentMaxDurability,
    });
    byWallet.set(wallet, bucket);
  }
  return Array.from(byWallet.values()).sort((a, b) => a.walletAddress.localeCompare(b.walletAddress));
}

async function main() {
  await redis.connect();
  console.log("[export] connected");

  const characterKeys = (await scanKeys("character:0x*:*")).filter((key) => !key.includes(":index:") && !key.includes(":bootstrap:"));
  const itemKeys = await scanKeys("itemrng:instance:*");
  const registeredWalletKeys = await scanKeys("wallet:registered:*");
  const friendKeys = (await scanKeys("friends:*")).filter((key) => !key.startsWith("friends:req:"));
  const partyIds = await redis.smembers("wog:party:ids").catch(() => []);

  console.log(`[export] character keys: ${characterKeys.length}`);
  console.log(`[export] item instance keys: ${itemKeys.length}`);
  console.log(`[export] registered wallet keys: ${registeredWalletKeys.length}`);
  console.log(`[export] friend keys: ${friendKeys.length}`);
  console.log(`[export] party ids: ${partyIds.length}`);

  const [characterHashes, itemValues, friendValues, partyValues] = await Promise.all([
    fetchHashes(characterKeys),
    fetchStrings(itemKeys),
    fetchStrings(friendKeys),
    fetchStrings(partyIds.map((id) => `wog:party:${id}`)),
  ]);

  const characters = characterKeys
    .map((key) => sanitizeCharacterRecord(key, characterHashes.get(key) ?? {}))
    .sort((a, b) => a.walletAddress.localeCompare(b.walletAddress) || a.characterName.localeCompare(b.characterName));

  const registeredWallets = registeredWalletKeys
    .map((key) => normalizeWallet(key.slice("wallet:registered:".length)))
    .sort((a, b) => a.localeCompare(b));

  const itemInstances = itemKeys
    .map((key) => parseJsonMaybe(itemValues.get(key)))
    .map((value) => sanitizeItemInstance(value))
    .filter(Boolean)
    .sort((a, b) => a.ownerWallet.localeCompare(b.ownerWallet) || a.instanceId.localeCompare(b.instanceId));

  const friends = friendKeys
    .map((key) => {
      const walletAddress = normalizeWallet(key.slice("friends:".length));
      const raw = friendValues.get(key);
      const parsed = parseJsonMaybe(raw);
      return {
        walletAddress,
        friends: Array.isArray(parsed)
          ? parsed.map((entry) => ({
              wallet: normalizeWallet(entry.wallet),
              addedAt: Number(entry.addedAt ?? 0),
            }))
          : [],
      };
    })
    .sort((a, b) => a.walletAddress.localeCompare(b.walletAddress));

  const parties = partyIds
    .map((id) => {
      const raw = partyValues.get(`wog:party:${id}`);
      const parsed = parseJsonMaybe(raw);
      if (!parsed || typeof parsed !== "object") return null;
      return {
        id,
        leaderWallet: normalizeWallet(parsed.leaderWallet),
        memberWallets: Array.isArray(parsed.memberWallets) ? parsed.memberWallets.map((value) => normalizeWallet(value)) : [],
        zoneId: parsed.zoneId ?? null,
        createdAt: Number(parsed.createdAt ?? 0),
        shareXp: Boolean(parsed.shareXp),
        shareGold: Boolean(parsed.shareGold),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.id.localeCompare(b.id));

  const exportPayload = {
    exportedAt: new Date().toISOString(),
    source: {
      type: "redis",
      included: [
        "characters",
        "registeredWallets",
        "craftedItemInstances",
        "craftedInventoryByWallet",
        "friends",
        "parties",
      ],
      excluded: [
        "chain transactions and queues",
        "agent ids and agent registration metadata",
        "character token ids",
        "custodial wallet secrets",
        "wallet registration tx details",
        "diary history",
        "friend requests and party invites",
      ],
    },
    counts: {
      characters: characters.length,
      registeredWallets: registeredWallets.length,
      craftedItemInstances: itemInstances.length,
      friends: friends.length,
      parties: parties.length,
    },
    registeredWallets,
    characters,
    craftedItemInstances: itemInstances,
    craftedInventoryByWallet: buildInventorySummary(itemInstances),
    friends,
    parties,
  };

  await mkdir(outputDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:]/g, "-");
  const outputPath = path.join(outputDir, `prod-redis-player-export-${timestamp}.json`);
  await writeFile(outputPath, `${JSON.stringify(exportPayload, null, 2)}\n`, "utf8");
  console.log(`[export] wrote ${outputPath}`);
}

main()
  .catch((error) => {
    console.error("[export] failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await redis.quit();
    } catch {}
  });
