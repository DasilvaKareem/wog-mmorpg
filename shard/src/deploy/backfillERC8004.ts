/**
 * One-time backfill: register ERC-8004 identity + init reputation for all
 * existing players on the newly deployed contracts.
 *
 * Usage:
 *   cd shard && npx tsx src/deploy/backfillERC8004.ts
 *
 * Uses its own wallet with nonce-collision retry to coexist with the running shard.
 */
import "dotenv/config";
import { ethers } from "ethers";

// ── Direct wallet setup ──
const SKALE_BASE_RPC =
  process.env.SKALE_BASE_RPC_URL || "https://skale-base.skalenodes.com/v1/base";
const provider = new ethers.JsonRpcProvider(SKALE_BASE_RPC);

const pk = process.env.SERVER_PRIVATE_KEY;
if (!pk) { console.error("SERVER_PRIVATE_KEY not set"); process.exit(1); }
const wallet = new ethers.Wallet(pk, provider);

// ── Contracts ──
const IDENTITY_ABI = [
  "function register(string agentURI) external returns (uint256 agentId)",
  "function setMetadata(uint256 agentId, string metadataKey, bytes metadataValue) external",
  "function transferFrom(address from, address to, uint256 tokenId) external",
  "event Registered(uint256 indexed agentId, string agentURI, address indexed owner)",
];
const REPUTATION_ABI = [
  "function initializeReputation(uint256 identityId) external",
];
const VALIDATION_ABI = [
  "function verifyCapability(uint256 agentId, string claim, uint256 expiry) external",
];

const identityContract = new ethers.Contract(process.env.IDENTITY_REGISTRY_ADDRESS!, IDENTITY_ABI, wallet);
const reputationContract = new ethers.Contract(process.env.REPUTATION_REGISTRY_ADDRESS!, REPUTATION_ABI, wallet);
const validationContract = new ethers.Contract(process.env.VALIDATION_REGISTRY_ADDRESS!, VALIDATION_ABI, wallet);

// ── TX helper with nonce-collision retry ──
async function sendTx(
  label: string,
  fn: () => Promise<ethers.ContractTransactionResponse>
): Promise<ethers.ContractTransactionReceipt | null> {
  for (let attempt = 0; attempt < 15; attempt++) {
    try {
      const tx = await fn();
      const receipt = await tx.wait();
      return receipt;
    } catch (err: any) {
      const msg = String(err?.message ?? "");
      if (msg.includes("nonce") || msg.includes("Pending transaction")) {
        console.log(`    [${label}] nonce collision, retry ${attempt + 1}...`);
        await new Promise((r) => setTimeout(r, 2000 + Math.random() * 1000));
        continue;
      }
      if (msg.includes("reverted")) {
        console.warn(`    [${label}] reverted: ${msg.slice(0, 100)}`);
        return null;
      }
      throw err;
    }
  }
  console.warn(`    [${label}] failed after 15 attempts`);
  return null;
}

// ── Redis ──
const REDIS_URL = process.env.REDIS_URL;
if (!REDIS_URL) { console.error("REDIS_URL not set"); process.exit(1); }
const Redis = (await import("ioredis")).default as any;
const redis = new Redis(REDIS_URL);

interface CharacterRecord {
  redisKey: string;
  walletAddress: string;
  name: string;
  characterTokenId: string | undefined;
}

async function scanAllCharacters(): Promise<CharacterRecord[]> {
  const results: CharacterRecord[] = [];
  let cursor = "0";
  do {
    const [nextCursor, keys] = await redis.scan(cursor, "MATCH", "character:*", "COUNT", 200);
    cursor = nextCursor;
    for (const key of keys) {
      const raw = await redis.hgetall(key);
      if (!raw || !raw.name) continue;
      const parts = key.split(":");
      if (parts.length < 3) continue;
      results.push({
        redisKey: key,
        walletAddress: parts[1],
        name: raw.name,
        characterTokenId: raw.characterTokenId || undefined,
      });
    }
  } while (cursor !== "0");
  return results;
}

async function backfillCharacter(char: CharacterRecord): Promise<boolean> {
  const label = `${char.name} (${char.walletAddress.slice(0, 10)}...)`;
  const serverAddress = await wallet.getAddress();
  const base = process.env.WOG_SHARD_URL || "https://wog.urbantech.dev";
  const agentURI = `${base}/a2a/${char.walletAddress}`;

  // 1. Register identity (let ethers auto-manage nonce, retry on collision)
  console.log(`  [${label}] registering...`);
  const receipt = await sendTx("register", () =>
    identityContract["register(string)"](agentURI)
  );

  if (!receipt) {
    console.warn(`  [${label}] FAIL — register failed`);
    return false;
  }

  const registeredEvent = receipt.logs.find(
    (log) => log.topics?.[0] === ethers.id("Registered(uint256,string,address)")
  );
  const agentId = registeredEvent?.topics?.[1]
    ? BigInt(registeredEvent.topics[1])
    : null;

  if (!agentId) {
    console.warn(`  [${label}] FAIL — no agentId in event`);
    return false;
  }

  // 2. Store characterTokenId as metadata (if available)
  if (char.characterTokenId) {
    const tokenBytes = ethers.AbiCoder.defaultAbiCoder().encode(
      ["uint256"], [BigInt(char.characterTokenId)]
    );
    await sendTx("metadata", () =>
      identityContract.setMetadata(agentId, "characterTokenId", tokenBytes)
    );
  }

  // 3. Transfer identity NFT to player
  if (char.walletAddress.toLowerCase() !== serverAddress.toLowerCase()) {
    await sendTx("transfer", () =>
      identityContract.transferFrom(serverAddress, char.walletAddress, agentId)
    );
  }

  // 4. Init reputation on-chain
  await sendTx("initRep", () =>
    reputationContract.initializeReputation(agentId)
  );

  // 5. Publish validation claim (1 year)
  const validUntil = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;
  await sendTx("validation", () =>
    validationContract.verifyCapability(agentId, "wog:a2a-enabled", BigInt(validUntil))
  );

  // 6. Save to Redis
  await redis.hset(char.redisKey, "agentId", agentId.toString());

  const repKey = `reputation:agent:${agentId}`;
  const existing = await redis.hgetall(repKey);
  if (!existing || !existing.overall) {
    await redis.hset(repKey, {
      combat: "500", economic: "500", social: "500",
      crafting: "500", agent: "500", overall: "500",
      lastUpdated: String(Date.now()),
    });
  }

  console.log(`  [${label}] done → agentId ${agentId}`);
  return true;
}

async function main() {
  const addr = await wallet.getAddress();
  console.log(`Deployer: ${addr}`);
  console.log(`Identity: ${process.env.IDENTITY_REGISTRY_ADDRESS}`);
  console.log(`Reputation: ${process.env.REPUTATION_REGISTRY_ADDRESS}`);
  console.log(`Validation: ${process.env.VALIDATION_REGISTRY_ADDRESS}`);

  console.log("\nScanning Redis...");
  const characters = await scanAllCharacters();
  console.log(`Found ${characters.length} characters.\n`);

  let ok = 0, fail = 0;
  for (const char of characters) {
    try {
      if (await backfillCharacter(char)) ok++;
      else fail++;
    } catch (err: any) {
      fail++;
      console.error(`  ERROR ${char.name}: ${err.message?.slice(0, 120)}`);
    }
  }

  console.log(`\nDone: ${ok} registered, ${fail} failed (${characters.length} total)`);
  await redis.quit();
  setTimeout(() => process.exit(0), 3000);
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  redis.quit().then(() => process.exit(1));
});
