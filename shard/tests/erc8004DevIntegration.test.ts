/**
 * ERC-8004 end-to-end integration test.
 *
 * Supports both:
 * - local DEV mode via the Hardhat deployment manifest fallback
 * - non-DEV mode via explicit RPC + contract address environment variables
 *
 * Run with:
 *   npm run test:erc8004
 * or
 *   DEV=true JWT_SECRET=test npx tsx tests/erc8004DevIntegration.test.ts
 * or
 *   JWT_SECRET=test SKALE_BASE_RPC_URL=... IDENTITY_REGISTRY_ADDRESS=... ... npx tsx tests/erc8004DevIntegration.test.ts
 */

import fs from "node:fs";
import path from "node:path";
import { ethers } from "ethers";

type JsonResult = { status: number; body: any };

const SHARD_URL = process.env.SHARD_URL || "http://127.0.0.1:3000";
const DEFAULT_LOCAL_RPC_URL = "http://127.0.0.1:8545";
const MANIFEST_PATH =
  process.env.HARDHAT_MANIFEST_PATH ||
  path.resolve(process.cwd(), "../hardhat/deployments/localhost.json");

let passed = 0;
let failed = 0;

function section(name: string): void {
  console.log(`\n── ${name} ──`);
}

function assert(condition: boolean, label: string, details?: unknown): void {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
    return;
  }
  console.error(`  ✗ ${label}`);
  if (details !== undefined) {
    console.error(`    ${typeof details === "string" ? details : JSON.stringify(details)}`);
  }
  failed++;
}

function requireOk(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

async function json(method: string, pathName: string, body?: unknown, token?: string): Promise<JsonResult> {
  const res = await fetch(`${SHARD_URL}${pathName}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    // keep text
  }
  return { status: res.status, body: parsed };
}

function readManifest():
  | {
      chainId?: number;
      environment?: Record<string, string>;
    }
  | null {
  if (!fs.existsSync(MANIFEST_PATH)) return null;
  return JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8")) as {
    chainId?: number;
    environment?: Record<string, string>;
  };
}

function getConfigValue(
  key: string,
  manifestEnv?: Record<string, string>
): string | undefined {
  return process.env[key] || manifestEnv?.[key];
}

async function main() {
  const manifest = readManifest();
  const manifestEnv = manifest?.environment;
  const rpcUrl =
    process.env.SKALE_BASE_RPC_URL ||
    process.env.HARDHAT_RPC_URL ||
    process.env.RPC_URL ||
    DEFAULT_LOCAL_RPC_URL;
  const expectedChainId = Number(
    process.env.EXPECTED_CHAIN_ID || process.env.SKALE_BASE_CHAIN_ID || manifest?.chainId || 0
  );
  const environment = {
    GOLD_CONTRACT_ADDRESS: getConfigValue("GOLD_CONTRACT_ADDRESS", manifestEnv),
    ITEMS_CONTRACT_ADDRESS: getConfigValue("ITEMS_CONTRACT_ADDRESS", manifestEnv),
    CHARACTER_CONTRACT_ADDRESS: getConfigValue("CHARACTER_CONTRACT_ADDRESS", manifestEnv),
    IDENTITY_REGISTRY_ADDRESS: getConfigValue("IDENTITY_REGISTRY_ADDRESS", manifestEnv),
    REPUTATION_REGISTRY_ADDRESS: getConfigValue("REPUTATION_REGISTRY_ADDRESS", manifestEnv),
    VALIDATION_REGISTRY_ADDRESS: getConfigValue("VALIDATION_REGISTRY_ADDRESS", manifestEnv),
  };

  for (const [key, value] of Object.entries(environment)) {
    requireOk(Boolean(value), `Missing required test config: ${key}`);
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = ethers.Wallet.createRandom();
  const walletAddress = await wallet.getAddress();
  const characterName = `Dev${Math.random().toString(36).slice(2, 8)}`;

  const identity = new ethers.Contract(
    environment.IDENTITY_REGISTRY_ADDRESS!,
    [
      "function ownerOf(uint256 tokenId) view returns (address)",
      "function getAgentWallet(uint256 agentId) view returns (address)",
      "function tokenURI(uint256 tokenId) view returns (string)",
      "function getMetadata(uint256 agentId, string metadataKey) view returns (bytes)",
    ],
    provider
  );
  const validation = new ethers.Contract(
    environment.VALIDATION_REGISTRY_ADDRESS!,
    [
      "function getVerifications(uint256 agentId) view returns (tuple(address verifier, string claim, uint256 validUntil)[])",
      "function isVerified(uint256 agentId, string claim) view returns (bool)",
    ],
    provider
  );
  const reputation = new ethers.Contract(
    environment.REPUTATION_REGISTRY_ADDRESS!,
    [
      "function getReputation(uint256 identityId) view returns (tuple(uint256,uint256,uint256,uint256,uint256,uint256,uint256))",
    ],
    provider
  );
  const gold = new ethers.Contract(
    environment.GOLD_CONTRACT_ADDRESS!,
    ["function balanceOf(address owner) view returns (uint256)"],
    provider
  );
  const transferTopic = ethers.id("Transfer(address,address,uint256)");
  const walletTopic = ethers.zeroPadValue(walletAddress.toLowerCase(), 32);

  section("Health");
  const [health, chainIdResponse] = await Promise.all([
    json("GET", "/health"),
    provider.send("eth_chainId", []),
  ]);
  assert(health.status === 200 && health.body?.ok === true, "Shard health endpoint is up", health.body);
  if (expectedChainId > 0) {
    assert(Number(BigInt(chainIdResponse)) === expectedChainId, `RPC chainId matches ${expectedChainId}`, chainIdResponse);
  } else {
    assert(Boolean(chainIdResponse), "RPC returned a chainId", chainIdResponse);
  }

  section("Auth + Wallet");
  const challenge = await json("GET", `/auth/challenge?wallet=${walletAddress}`);
  requireOk(challenge.status === 200, `Challenge failed: ${JSON.stringify(challenge.body)}`);
  const signature = await wallet.signMessage(String(challenge.body.message));
  const verify = await json("POST", "/auth/verify", {
    walletAddress,
    signature,
    timestamp: challenge.body.timestamp,
  });
  requireOk(verify.status === 200 && verify.body?.token, `Verify failed: ${JSON.stringify(verify.body)}`);
  const token = String(verify.body.token);
  assert(true, "Wallet authentication succeeded");

  const walletRegister = await json("POST", "/wallet/register", { walletAddress }, token);
  requireOk(walletRegister.status === 200, `Wallet register failed: ${JSON.stringify(walletRegister.body)}`);
  assert(walletRegister.body?.welcomeBonus?.gold === 0.02, "Welcome bonus response includes 0.02 GOLD", walletRegister.body);

  section("Character + Identity Bootstrap");
  const startBlock = await provider.getBlockNumber();
  const create = await json(
    "POST",
    "/character/create",
    { walletAddress, name: characterName, race: "human", className: "warrior" },
    token
  );
  requireOk(create.status === 200 && create.body?.ok === true, `Character create failed: ${JSON.stringify(create.body)}`);
  assert(create.body.character?.name === `${characterName} the Warrior`, "Character creation returned expected name");

  let agentId: number | null = null;
  let characterTokenId: number | null = null;
  let identityApi: JsonResult | null = null;
  let validationsApi: JsonResult | null = null;
  let nameLookup: JsonResult | null = null;

  for (let i = 0; i < 25; i++) {
    const latestBlock = await provider.getBlockNumber();
    const [identityLogs, characterLogs, currentIdentity, currentValidations, currentNameLookup] = await Promise.all([
      provider.getLogs({
        address: manifest.environment.IDENTITY_REGISTRY_ADDRESS,
        address: environment.IDENTITY_REGISTRY_ADDRESS!,
        fromBlock: startBlock,
        toBlock: latestBlock,
        topics: [transferTopic, null, walletTopic],
      }),
      provider.getLogs({
        address: manifest.environment.CHARACTER_CONTRACT_ADDRESS,
        address: environment.CHARACTER_CONTRACT_ADDRESS!,
        fromBlock: startBlock,
        toBlock: latestBlock,
        topics: [transferTopic, null, walletTopic],
      }),
      agentId != null ? json("GET", `/api/agents/${agentId}/identity`) : Promise.resolve(null),
      agentId != null ? json("GET", `/api/agents/${agentId}/validations`) : Promise.resolve(null),
      json("GET", `/name/lookup/${walletAddress}`),
    ]);

    if (identityLogs.length > 0) {
      agentId = Number(BigInt(identityLogs.at(-1)!.topics[3]));
    }
    if (characterLogs.length > 0) {
      characterTokenId = Number(BigInt(characterLogs.at(-1)!.topics[3]));
    }
    if (currentIdentity) identityApi = currentIdentity;
    if (currentValidations) validationsApi = currentValidations;
    nameLookup = currentNameLookup;

    const ready =
      agentId != null &&
      characterTokenId != null &&
      identityApi?.status === 200 &&
      Array.isArray(validationsApi?.body?.validations) &&
      validationsApi!.body.validations.length > 0 &&
      nameLookup?.status === 200;
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  requireOk(agentId != null, "agentId not discovered from on-chain identity transfer logs");
  requireOk(characterTokenId != null, "characterTokenId not discovered from on-chain character transfer logs");
  requireOk(identityApi?.status === 200, `identity API not ready: ${JSON.stringify(identityApi?.body)}`);
  requireOk(validationsApi?.status === 200, `validations API not ready: ${JSON.stringify(validationsApi?.body)}`);
  requireOk(nameLookup?.status === 200, `name lookup not ready: ${JSON.stringify(nameLookup?.body)}`);

  assert(identityApi!.body.identity.agentId === String(agentId), "Identity API returns the minted agentId", identityApi!.body);
  assert(
    identityApi!.body.identity.characterTokenId === String(characterTokenId),
    "Identity API returns the minted characterTokenId",
    identityApi!.body
  );
  assert(
    validationsApi!.body.validations.some((entry: any) => entry.claim === "wog:a2a-enabled"),
    "Validation API includes wog:a2a-enabled",
    validationsApi!.body
  );
  assert(
    nameLookup!.body?.name === `${characterName}.wog`,
    "Name service auto-registers the character .wog name",
    nameLookup!.body
  );

  section("Direct Contract Reads");
  const [goldBalance, identityOwner, agentWallet, agentUri, rawCharacterMetadata, chainClaims, a2aResolved] =
    await Promise.all([
      gold.balanceOf(walletAddress),
      identity.ownerOf(BigInt(agentId)),
      identity.getAgentWallet(BigInt(agentId)),
      identity.tokenURI(BigInt(agentId)),
      identity.getMetadata(BigInt(agentId), "characterTokenId"),
      validation.getVerifications(BigInt(agentId)),
      json("GET", `/a2a/resolve/${agentId}`),
    ]);
  const decodedCharacterTokenId = ethers.AbiCoder.defaultAbiCoder().decode(["uint256"], rawCharacterMetadata)[0];

  assert(goldBalance === ethers.parseEther("0.02"), "On-chain GOLD balance is 0.02");
  assert(identityOwner === walletAddress, "Identity NFT owner matches player wallet", identityOwner);
  assert(agentWallet === walletAddress, "Identity agent wallet matches player wallet", agentWallet);
  assert(
    agentUri === identityApi!.body.identity.endpoint,
    "Identity tokenURI matches the identity endpoint exposed by the API",
    { agentUri, apiEndpoint: identityApi!.body.identity.endpoint }
  );
  assert(decodedCharacterTokenId === BigInt(characterTokenId), "Identity metadata stores the character tokenId");
  assert(chainClaims.length > 0, "Validation registry has at least one claim");
  assert(a2aResolved.status === 200 && a2aResolved.body?.walletAddress === walletAddress, "A2A resolve returns the owner wallet", a2aResolved.body);

  section("Spawn + Reputation Convergence");
  const spawn = await json(
    "POST",
    "/spawn",
    {
      zoneId: "village-square",
      type: "player",
      name: characterName,
      walletAddress,
      level: 1,
      raceId: "human",
      classId: "warrior",
      characterTokenId,
      agentId,
    },
    token
  );
  requireOk(spawn.status === 200, `Spawn failed: ${JSON.stringify(spawn.body)}`);
  assert(spawn.body?.spawned?.agentId === String(agentId), "Spawn response carries agentId", spawn.body);

  const feedback = await json(
    "POST",
    `/api/agents/${agentId}/reputation/feedback`,
    { category: "social", delta: 7, reason: "dev-integration-test" },
    token
  );
  requireOk(feedback.status === 200, `Feedback submit failed: ${JSON.stringify(feedback.body)}`);

  let converged = false;
  let finalApiReputation: JsonResult | null = null;
  let finalChainReputation: bigint[] = [];
  for (let i = 0; i < 10; i++) {
    const [apiReputation, chainReputation] = await Promise.all([
      json("GET", `/api/agents/${agentId}/reputation`),
      reputation.getReputation(BigInt(agentId)),
    ]);
    finalApiReputation = apiReputation;
    finalChainReputation = Array.from(chainReputation) as bigint[];

    const apiSocial = BigInt(apiReputation.body?.reputation?.social ?? -1);
    const apiOverall = BigInt(apiReputation.body?.reputation?.overall ?? -1);
    if (apiSocial === finalChainReputation[2] && apiOverall === finalChainReputation[5] && apiSocial === 507n) {
      converged = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }

  assert(
    converged,
    "Reputation API converges to the on-chain social/overall scores after batched write",
    {
      api: finalApiReputation?.body,
      chain: finalChainReputation.map((value) => value.toString()),
    }
  );

  console.log("\n==================================================");
  console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
  console.log("==================================================");

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("\nFATAL:", err instanceof Error ? err.message : err);
  process.exit(1);
});
