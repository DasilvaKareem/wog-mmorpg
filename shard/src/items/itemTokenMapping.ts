import { getRedis } from "../redis.js";
import { ITEM_CATALOG, getItemByTokenId, type ItemDefinition } from "./itemCatalog.js";

const ITEM_TOKEN_MAPPING_KEY = "items:token-id-mapping:v1";

interface StoredItemTokenMapping {
  version: 1;
  byGameTokenId: Record<string, string>;
  updatedAt: number;
}

export interface ItemTokenMappingEntry {
  item: ItemDefinition;
  gameTokenId: bigint;
  chainTokenId: bigint;
}

let memoryFallbackMapping: StoredItemTokenMapping | null = null;
let mappingPromise: Promise<StoredItemTokenMapping> | null = null;

function buildBootstrapMapping(): StoredItemTokenMapping {
  const byGameTokenId: Record<string, string> = {};
  ITEM_CATALOG.forEach((item, index) => {
    byGameTokenId[item.tokenId.toString()] = index.toString();
  });
  return {
    version: 1,
    byGameTokenId,
    updatedAt: Date.now(),
  };
}

function parseStoredMapping(raw: string | null | undefined): StoredItemTokenMapping | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.version !== 1 || typeof parsed.byGameTokenId !== "object" || !parsed.byGameTokenId) {
      return null;
    }

    const byGameTokenId: Record<string, string> = {};
    for (const [gameTokenId, chainTokenId] of Object.entries(parsed.byGameTokenId as Record<string, unknown>)) {
      if (!/^\d+$/.test(gameTokenId)) continue;
      const normalizedChainTokenId = String(chainTokenId ?? "");
      if (!/^\d+$/.test(normalizedChainTokenId)) continue;
      byGameTokenId[gameTokenId] = normalizedChainTokenId;
    }

    return {
      version: 1,
      byGameTokenId,
      updatedAt: Number(parsed.updatedAt) || Date.now(),
    };
  } catch {
    return null;
  }
}

function normalizeMapping(stored: StoredItemTokenMapping | null): {
  mapping: StoredItemTokenMapping;
  changed: boolean;
} {
  const mapping = stored
    ? {
        version: 1 as const,
        byGameTokenId: { ...stored.byGameTokenId },
        updatedAt: stored.updatedAt,
      }
    : buildBootstrapMapping();

  let changed = !stored;

  const usedChainTokenIds = new Set<string>();
  let maxChainTokenId = -1;
  for (const [gameTokenId, chainTokenId] of Object.entries(mapping.byGameTokenId)) {
    if (!/^\d+$/.test(gameTokenId) || !/^\d+$/.test(chainTokenId)) {
      throw new Error(`[items] Invalid item token mapping entry ${gameTokenId} -> ${chainTokenId}`);
    }
    if (usedChainTokenIds.has(chainTokenId)) {
      throw new Error(`[items] Duplicate chain tokenId ${chainTokenId} in item token mapping`);
    }
    usedChainTokenIds.add(chainTokenId);
    maxChainTokenId = Math.max(maxChainTokenId, Number(chainTokenId));
  }

  for (const item of ITEM_CATALOG) {
    const gameTokenId = item.tokenId.toString();
    if (mapping.byGameTokenId[gameTokenId] !== undefined) continue;
    maxChainTokenId += 1;
    mapping.byGameTokenId[gameTokenId] = maxChainTokenId.toString();
    usedChainTokenIds.add(maxChainTokenId.toString());
    changed = true;
  }

  if (changed) {
    mapping.updatedAt = Date.now();
  }

  return { mapping, changed };
}

async function readStoredMapping(): Promise<StoredItemTokenMapping | null> {
  const redis = getRedis();
  if (redis) {
    try {
      return parseStoredMapping(await redis.get(ITEM_TOKEN_MAPPING_KEY));
    } catch (err: any) {
      console.warn(`[items] Failed to read item token mapping from Redis: ${err?.message ?? err}`);
      return null;
    }
  }
  return memoryFallbackMapping;
}

async function writeStoredMapping(mapping: StoredItemTokenMapping): Promise<void> {
  const redis = getRedis();
  if (redis) {
    try {
      await redis.set(ITEM_TOKEN_MAPPING_KEY, JSON.stringify(mapping));
      return;
    } catch (err: any) {
      console.warn(`[items] Failed to persist item token mapping to Redis: ${err?.message ?? err}`);
    }
  }
  memoryFallbackMapping = mapping;
}

export async function ensureItemTokenMapping(): Promise<StoredItemTokenMapping> {
  if (!mappingPromise) {
    mappingPromise = (async () => {
      const stored = await readStoredMapping();
      const { mapping, changed } = normalizeMapping(stored);
      if (changed) {
        await writeStoredMapping(mapping);
      } else if (!memoryFallbackMapping) {
        memoryFallbackMapping = mapping;
      }
      return mapping;
    })();
  }
  return mappingPromise;
}

export async function getChainTokenIdForGameTokenId(gameTokenId: bigint): Promise<bigint> {
  const mapping = await ensureItemTokenMapping();
  const key = gameTokenId.toString();
  const chainTokenId = mapping.byGameTokenId[key];
  if (chainTokenId === undefined) {
    throw new Error(`[items] No chain token mapping found for game tokenId ${key}`);
  }
  return BigInt(chainTokenId);
}

export async function getCatalogItemsInChainOrder(): Promise<ItemTokenMappingEntry[]> {
  const mapping = await ensureItemTokenMapping();
  return ITEM_CATALOG
    .map((item) => {
      const chainTokenId = mapping.byGameTokenId[item.tokenId.toString()];
      if (chainTokenId === undefined) {
        throw new Error(`[items] Missing chain token mapping for game tokenId ${item.tokenId.toString()}`);
      }
      return {
        item,
        gameTokenId: item.tokenId,
        chainTokenId: BigInt(chainTokenId),
      };
    })
    .sort((left, right) => Number(left.chainTokenId - right.chainTokenId));
}

export async function getItemByChainTokenId(chainTokenId: bigint): Promise<ItemDefinition | undefined> {
  const mapping = await ensureItemTokenMapping();
  const gameTokenId = Object.entries(mapping.byGameTokenId).find(
    ([, mappedChainTokenId]) => mappedChainTokenId === chainTokenId.toString()
  )?.[0];
  if (!gameTokenId) return undefined;
  return getItemByTokenId(BigInt(gameTokenId));
}

export async function getGameTokenIdForChainTokenId(chainTokenId: bigint): Promise<bigint | undefined> {
  const item = await getItemByChainTokenId(chainTokenId);
  return item?.tokenId;
}

export async function getItemTokenMappingSnapshot(): Promise<Array<{
  gameTokenId: number;
  chainTokenId: number;
  name: string;
}>> {
  const entries = await getCatalogItemsInChainOrder();
  return entries.map(({ item, gameTokenId, chainTokenId }) => ({
    gameTokenId: Number(gameTokenId),
    chainTokenId: Number(chainTokenId),
    name: item.name,
  }));
}
