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

import * as fs from "node:fs";
import * as path from "node:path";
import { ethers } from "ethers";
import { getOfficialErc8004Addresses } from "../src/erc8004/official.js";

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

function assertPresent<T>(value: T, message: string): asserts value is NonNullable<T> {
  if (value == null) {
    throw new Error(message);
  }
}

function extractTransferTokenId(logs: Array<{ topics: readonly string[] }>): number | null {
  const transferLog = [...logs].reverse().find((log) => log.topics.length > 3 && Boolean(log.topics[3]));
  if (!transferLog?.topics[3]) return null;
  return Number(BigInt(transferLog.topics[3]));
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
  manifestEnv?: Record<string, string>,
  preferManifest = false
): string | undefined {
  return preferManifest ? (manifestEnv?.[key] || process.env[key]) : (process.env[key] || manifestEnv?.[key]);
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
  const preferManifestConfig = process.env.DEV === "true" || expectedChainId === 31337;
  const officialRegistries = getOfficialErc8004Addresses(expectedChainId);
  const environment = {
    GOLD_CONTRACT_ADDRESS: getConfigValue("GOLD_CONTRACT_ADDRESS", manifestEnv, preferManifestConfig),
    ITEMS_CONTRACT_ADDRESS: getConfigValue("ITEMS_CONTRACT_ADDRESS", manifestEnv, preferManifestConfig),
    CHARACTER_CONTRACT_ADDRESS: getConfigValue("CHARACTER_CONTRACT_ADDRESS", manifestEnv, preferManifestConfig),
    IDENTITY_REGISTRY_ADDRESS:
      getConfigValue("IDENTITY_REGISTRY_ADDRESS", manifestEnv, preferManifestConfig) || officialRegistries?.identity,
    REPUTATION_REGISTRY_ADDRESS:
      getConfigValue("REPUTATION_REGISTRY_ADDRESS", manifestEnv, preferManifestConfig) || officialRegistries?.reputation,
    VALIDATION_REGISTRY_ADDRESS:
      getConfigValue("VALIDATION_REGISTRY_ADDRESS", manifestEnv, preferManifestConfig) || officialRegistries?.validation,
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
      "function getAgentValidations(uint256 agentId) view returns (bytes32[] memory requestHashes)",
      "function getValidationStatus(bytes32 requestHash) view returns (address validatorAddress, uint256 agentId, uint8 response, bytes32 responseHash, string tag, uint256 lastUpdate)",
    ],
    provider
  );
  const reputation = new ethers.Contract(
    environment.REPUTATION_REGISTRY_ADDRESS!,
    [
      "function getClients(uint256 agentId) view returns (address[])",
      "function getSummary(uint256 agentId, address[] clientAddresses, string tag1, string tag2) view returns (uint64 count, int128 summaryValue, uint8 summaryValueDecimals)",
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
  let welcomeBonusSettled = false;
  for (let i = 0; i < 25; i++) {
    const balance = await json("GET", `/wallet/${walletAddress}/balance`, undefined, token);
    if (balance.status === 200 && Number(balance.body?.onChainGold ?? balance.body?.gold) === 0.02) {
      welcomeBonusSettled = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  requireOk(welcomeBonusSettled, "welcome bonus did not settle on-chain before character creation");
  assert(welcomeBonusSettled, "Welcome bonus settles on-chain before character creation");

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
  let charactersApi: JsonResult | null = null;

  for (let i = 0; i < 25; i++) {
    const latestBlock = await provider.getBlockNumber();
    const [identityTransferLogs, characterLogs, currentIdentity, currentValidations, currentNameLookup, currentCharacters] = await Promise.all([
      provider.getLogs({
        address: environment.IDENTITY_REGISTRY_ADDRESS!,
        fromBlock: Math.max(0, startBlock - 20),
        toBlock: latestBlock,
        topics: [transferTopic, null, walletTopic],
      }),
      provider.getLogs({
        address: environment.CHARACTER_CONTRACT_ADDRESS!,
        fromBlock: Math.max(0, startBlock - 20),
        toBlock: latestBlock,
        topics: [transferTopic, null, walletTopic],
      }),
      agentId != null ? json("GET", `/api/agents/${agentId}/identity`) : Promise.resolve(null),
      agentId != null ? json("GET", `/api/agents/${agentId}/validations`) : Promise.resolve(null),
      json("GET", `/name/lookup/${walletAddress}`).catch(() => null),
      json("GET", `/character/${walletAddress}`).catch(() => null),
    ]);

    const discoveredAgentId = extractTransferTokenId(identityTransferLogs);
    const discoveredCharacterTokenId = extractTransferTokenId(characterLogs);
    if (discoveredAgentId != null) {
      agentId = discoveredAgentId;
    }
    if (discoveredCharacterTokenId != null) {
      characterTokenId = discoveredCharacterTokenId;
    }
    if (currentIdentity) identityApi = currentIdentity;
    if (currentValidations) validationsApi = currentValidations;
    nameLookup = currentNameLookup;
    charactersApi = currentCharacters;
    const apiAgentId = Number(currentIdentity?.body?.identity?.agentId);
    const apiCharacterTokenId = Number(currentIdentity?.body?.identity?.characterTokenId);
    const listedCharacter = currentCharacters?.body?.characters?.find?.((entry: any) =>
      entry?.name === `${characterName} the Warrior` || entry?.name === characterName
    );
    const listedCharacterTokenId = Number(listedCharacter?.characterTokenId);
    if (Number.isInteger(apiAgentId) && apiAgentId >= 0) {
      agentId = apiAgentId;
    }
    if (Number.isInteger(apiCharacterTokenId) && apiCharacterTokenId >= 0) {
      characterTokenId = apiCharacterTokenId;
    }
    if (characterTokenId == null && Number.isInteger(listedCharacterTokenId) && listedCharacterTokenId >= 0) {
      characterTokenId = listedCharacterTokenId;
    }

    const ready =
      agentId != null &&
      characterTokenId != null &&
      identityApi?.status === 200 &&
      Array.isArray(validationsApi?.body?.validations) &&
      validationsApi!.body.validations.length > 0;
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  assertPresent(agentId, "agentId not discovered from chain logs or identity API");
  assertPresent(characterTokenId, "characterTokenId not discovered from chain logs or identity API");
  requireOk(identityApi?.status === 200, `identity API not ready: ${JSON.stringify(identityApi?.body)}`);
  requireOk(validationsApi?.status === 200, `validations API not ready: ${JSON.stringify(validationsApi?.body)}`);
  const mintedAgentId = agentId;
  const mintedCharacterTokenId = characterTokenId;

  assert(identityApi!.body.identity.agentId === String(mintedAgentId), "Identity API returns the minted agentId", identityApi!.body);
  assert(
    identityApi!.body.identity.characterTokenId === String(mintedCharacterTokenId),
    "Identity API returns the minted characterTokenId",
    identityApi!.body
  );
  assert(
    validationsApi!.body.validations.some((entry: any) => entry.claimType === "wog:a2a-enabled"),
    "Validation API includes wog:a2a-enabled",
    validationsApi!.body
  );
  if (nameLookup?.status === 200) {
    assert(
      nameLookup.body?.name === `${characterName}.wog`,
      "Name service auto-registers the character .wog name",
      nameLookup.body
    );
  }

  section("Direct Contract Reads");
  const [goldBalance, identityOwner, agentWallet, agentUri, rawCharacterMetadata, validationHashes, a2aResolved] =
    await Promise.all([
      gold.balanceOf(walletAddress),
      identity.ownerOf(BigInt(mintedAgentId)),
      identity.getAgentWallet(BigInt(mintedAgentId)),
      identity.tokenURI(BigInt(mintedAgentId)),
      identity.getMetadata(BigInt(mintedAgentId), "characterTokenId"),
      validation.getAgentValidations(BigInt(mintedAgentId)),
      json("GET", `/a2a/resolve/${mintedAgentId}`),
    ]);
  const decodedCharacterTokenId = ethers.AbiCoder.defaultAbiCoder().decode(["uint256"], rawCharacterMetadata)[0];
  const validationStatus = validationHashes.length > 0
    ? await validation.getValidationStatus(validationHashes[0])
    : null;

  assert(goldBalance === ethers.parseEther("0.02"), "On-chain GOLD balance is 0.02");
  assert(identityOwner.toLowerCase() === walletAddress.toLowerCase(), "Identity NFT owner matches player wallet", identityOwner);
  assert(agentWallet === ethers.ZeroAddress, "Identity agent wallet is cleared after ownership transfer", agentWallet);
  assert(
    agentUri === identityApi!.body.identity.endpoint,
    "Identity tokenURI matches the identity endpoint exposed by the API",
    { agentUri, apiEndpoint: identityApi!.body.identity.endpoint }
  );
  assert(decodedCharacterTokenId === BigInt(mintedCharacterTokenId), "Identity metadata stores the character tokenId");
  assert(validationHashes.length > 0, "Validation registry has at least one validation request");
  assert(validationStatus?.[4] === "wog:a2a-enabled", "Validation status tag matches wog:a2a-enabled", validationStatus);
  assert(
    a2aResolved.status === 200 &&
      String(a2aResolved.body?.walletAddress ?? "").toLowerCase() === walletAddress.toLowerCase(),
    "A2A resolve returns the owner wallet",
    a2aResolved.body
  );

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
      characterTokenId: String(mintedCharacterTokenId),
      agentId: String(mintedAgentId),
    },
    token
  );
  requireOk(spawn.status === 200, `Spawn failed: ${JSON.stringify(spawn.body)}`);
  assert(spawn.body?.spawned?.agentId === String(mintedAgentId), "Spawn response carries agentId", spawn.body);

  const feedback = await json(
    "POST",
    `/api/agents/${mintedAgentId}/reputation/feedback`,
    { category: "social", delta: 7, reason: "dev-integration-test" },
    token
  );
  requireOk(feedback.status === 200, `Feedback submit failed: ${JSON.stringify(feedback.body)}`);

  let converged = false;
  let finalApiReputation: JsonResult | null = null;
  let finalChainSummary: [bigint, bigint, bigint] | null = null;
  for (let i = 0; i < 10; i++) {
    const clients = Array.from(await reputation.getClients(BigInt(mintedAgentId)));
    const [apiReputation, chainSummary] = await Promise.all([
      json("GET", `/api/agents/${mintedAgentId}/reputation`),
      clients.length > 0
        ? reputation.getSummary(BigInt(mintedAgentId), clients, "social", "")
        : Promise.resolve([BigInt(0), BigInt(0), BigInt(0)] as [bigint, bigint, bigint]),
    ]);
    finalApiReputation = apiReputation;
    finalChainSummary = chainSummary as [bigint, bigint, bigint];

    const apiSocial = BigInt(apiReputation.body?.reputation?.social ?? -1);
    if (apiSocial === BigInt(507) && finalChainSummary[1] === BigInt(7)) {
      converged = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }

  assert(
    converged,
    "Reputation API converges to the official on-chain social summary after feedback write",
    {
      api: finalApiReputation?.body,
      chain: finalChainSummary?.map((value) => value.toString()),
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
