import "dotenv/config";
import Redis from "ioredis";
import { findIdentityByCharacterTokenId, resolveIdentityRegistrationTxHash } from "../src/blockchain/blockchain.js";

type CharacterRecord = {
  redisKey: string;
  walletAddress: string;
  characterName: string;
  characterTokenId: string | null;
  agentId: string | null;
  agentRegistrationTxHash: string | null;
  chainRegistrationStatus: string | null;
};

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  return await Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), timeoutMs)),
  ]);
}

function normalizeWallet(wallet: string): string {
  return wallet.trim().toLowerCase();
}

function parseCharacterRecord(redisKey: string, raw: Record<string, string>): CharacterRecord | null {
  const parts = redisKey.split(":");
  if (parts.length < 3) return null;
  if (!/^0x[a-f0-9]{40}$/i.test(parts[1] ?? "")) return null;
  if (!raw.name || !raw.raceId || !raw.classId) return null;
  return {
    redisKey,
    walletAddress: normalizeWallet(parts[1] ?? ""),
    characterName: raw.name,
    characterTokenId: raw.characterTokenId || null,
    agentId: raw.agentId || null,
    agentRegistrationTxHash: raw.agentRegistrationTxHash || null,
    chainRegistrationStatus: raw.chainRegistrationStatus || null,
  };
}

async function scanCharacterRecords(redis: Redis): Promise<CharacterRecord[]> {
  const results: CharacterRecord[] = [];
  let cursor = "0";
  do {
    const [nextCursor, keys] = await redis.scan(cursor, "MATCH", "character:0x*:*", "COUNT", 200);
    cursor = nextCursor;
    for (const redisKey of keys) {
      const raw = await redis.hgetall(redisKey);
      const parsed = parseCharacterRecord(redisKey, raw);
      if (parsed) results.push(parsed);
    }
  } while (cursor !== "0");
  return results;
}

async function main(): Promise<void> {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    throw new Error("REDIS_URL not set");
  }

  const redis = new Redis(redisUrl, {
    maxRetriesPerRequest: 3,
    connectTimeout: 10_000,
    lazyConnect: true,
    ...(redisUrl.startsWith("rediss://") ? { tls: { rejectUnauthorized: false } } : {}),
  });

  await redis.connect();

  const records = await scanCharacterRecords(redis);
  let verified = 0;
  let cleared = 0;
  let txUpdated = 0;
  let skipped = 0;
  const notes: string[] = [];

  for (const [index, record] of records.entries()) {
    if (index > 0 && index % 25 === 0) {
      console.log(`[repair] processed ${index}/${records.length}`);
    }
    if (!record.characterTokenId) {
      skipped++;
      continue;
    }

    const tokenId = BigInt(record.characterTokenId);
    const recovered = await withTimeout(
      findIdentityByCharacterTokenId(tokenId, record.walletAddress).catch(() => null),
      7_500,
      null
    );
    const recoveredAgentId = recovered?.agentId?.toString() ?? null;

    if (record.agentId) {
      if (recoveredAgentId !== record.agentId) {
        const fallbackStatus = record.characterTokenId ? "mint_confirmed" : "unregistered";
        await redis.hdel(record.redisKey, "agentId", "agentRegistrationTxHash");
        await redis.hset(record.redisKey, {
          chainRegistrationStatus: fallbackStatus,
        });
        cleared++;
        notes.push(`cleared ${record.redisKey} stale agentId=${record.agentId} expected=${recoveredAgentId ?? "none"}`);
        continue;
      }

      verified++;
      const resolvedTxHash = await withTimeout(
        resolveIdentityRegistrationTxHash(BigInt(record.agentId)).catch(() => null),
        7_500,
        null
      );
      if (resolvedTxHash && resolvedTxHash !== record.agentRegistrationTxHash) {
        await redis.hset(record.redisKey, { agentRegistrationTxHash: resolvedTxHash });
        txUpdated++;
        notes.push(`updated tx ${record.redisKey} ${record.agentRegistrationTxHash ?? "null"} -> ${resolvedTxHash}`);
      }
      continue;
    }

    if (recoveredAgentId) {
      const resolvedTxHash = await withTimeout(
        resolveIdentityRegistrationTxHash(BigInt(recoveredAgentId)).catch(() => null),
        7_500,
        null
      );
      const patch: Record<string, string> = {
        agentId: recoveredAgentId,
        chainRegistrationStatus: "registered",
      };
      if (resolvedTxHash) patch.agentRegistrationTxHash = resolvedTxHash;
      await redis.hset(record.redisKey, patch);
      verified++;
      txUpdated += resolvedTxHash ? 1 : 0;
      notes.push(`recovered ${record.redisKey} agentId=${recoveredAgentId}${resolvedTxHash ? ` tx=${resolvedTxHash}` : ""}`);
      continue;
    }

    skipped++;
  }

  console.log(JSON.stringify({
    scanned: records.length,
    verified,
    cleared,
    txUpdated,
    skipped,
    notes,
  }, null, 2));

  await redis.quit();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
