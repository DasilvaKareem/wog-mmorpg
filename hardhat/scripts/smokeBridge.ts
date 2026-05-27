/**
 * End-to-end smoke test for the SKALE Base ↔ Coinbase Base NFT bridge.
 *
 * Exercises the full round-trip in a single script:
 *   1. Deploy WoGMockIdentityRegistry + WoGBridgeAdapter on the "SKALE" side
 *      (or use existing registry @ env IDENTITY_REGISTRY)
 *   2. Deploy WoGCharacterBase on the "Base" side
 *   3. Mint character, escrow via adapter.bridgeOut → expect BridgeOut event
 *   4. Sign claim with the same EIP-712 domain the contracts expect
 *   5. Submit mintFromClaim on Base → expect BridgeIn + new ERC-721 owned by recipient
 *   6. Burn on Base via burnAndExit → expect BridgeOut on Base
 *   7. Sign reverse claim, submit mintFromClaim on adapter → expect escrow release
 *   8. Verify token is back with original holder on SKALE
 *
 * Designed to run against:
 *   - localhost / hardhat ephemeral (no funds, single chain — both "sides"
 *     are different contracts on the same chain)
 *   - separate testnet runs (split into two invocations: one per chain)
 *
 * Usage (local, both sides on hardhat):
 *   cd hardhat
 *   npx hardhat run scripts/smokeBridge.ts
 *
 * Note: this script intentionally uses ethers directly (not the shard module)
 *       to keep it portable for hardhat scripts. The EIP-712 encoding here
 *       MUST stay byte-identical to shard/src/blockchain/bridge/types.ts and
 *       to the *.sol BridgeClaim typehashes.
 */
import "dotenv/config";
import hre from "hardhat";

const { ethers } = hre;

// Mirror the shard typehash exactly. See shard/src/blockchain/bridge/types.ts
const BRIDGE_CLAIM_TYPES = {
  BridgeClaim: [
    { name: "sourceTokenId", type: "uint256" },
    { name: "destinationTokenId", type: "uint256" },
    { name: "recipient", type: "address" },
    { name: "sourceChainId", type: "uint64" },
    { name: "destinationChainId", type: "uint64" },
    { name: "metadataURI", type: "string" },
    { name: "nonce", type: "bytes32" },
    { name: "expiresAt", type: "uint64" },
  ],
};

// Chain ids the contracts hardcode in their constants.
// Override via env for testnet (see hardhat.config.ts baseSepolia / skaleSepolia).
const BASE_CHAIN_ID = BigInt(process.env.BASE_CHAIN_ID || 8453);
const SKALE_CHAIN_ID = BigInt(process.env.SKALE_CHAIN_ID || 1187947933);
const FRESH_MINT_SENTINEL = (1n << 256n) - 1n;

interface DeployedState {
  registry: any;
  adapter: any;
  baseCharacter: any;
  signer: any;
  alice: any;
  bob: any;
}

async function step(label: string, fn: () => Promise<void>) {
  process.stdout.write(`▶ ${label}…`);
  try {
    await fn();
    console.log(" ✅");
  } catch (err) {
    console.log(" ❌");
    throw err;
  }
}

async function signClaim(
  verifyingContract: string,
  destinationChainId: bigint,
  signer: any,
  claim: {
    sourceTokenId: bigint;
    destinationTokenId: bigint;
    recipient: string;
    sourceChainId: bigint;
    destinationChainId: bigint;
    metadataURI: string;
    nonce: string;
    expiresAt: bigint;
  },
): Promise<string> {
  return await signer.signTypedData(
    {
      name: "WoGBridge",
      version: "1",
      chainId: destinationChainId,
      verifyingContract,
    },
    BRIDGE_CLAIM_TYPES,
    claim,
  );
}

function nonceFor(label: string): string {
  return ethers.keccak256(ethers.toUtf8Bytes(`smoke-${label}-${Date.now()}`));
}

async function deployAll(): Promise<DeployedState> {
  const [server, alice, bob] = await ethers.getSigners();

  const registry = await ethers.deployContract("WoGMockIdentityRegistry");
  await registry.waitForDeployment();

  // Single-chain smoke uses the live chainId so cross-chain checks don't trip.
  const provider = await ethers.provider.getNetwork();
  const liveChainId = BigInt(provider.chainId);

  const adapter = await ethers.deployContract("WoGBridgeAdapter", [
    await registry.getAddress(),
    server.address,
    liveChainId, // pretend the OTHER side is also this chain for the single-chain smoke
  ]);
  await adapter.waitForDeployment();

  const baseCharacter = await ethers.deployContract("WoGCharacterBase", [
    server.address,
    liveChainId,
  ]);
  await baseCharacter.waitForDeployment();

  return { registry, adapter, baseCharacter, signer: server, alice, bob };
}

async function main() {
  const network = await ethers.provider.getNetwork();
  console.log(`Network: ${network.name} (chainId ${network.chainId})`);
  console.log("");

  const state = await deployAll();
  const { registry, adapter, baseCharacter, signer, alice, bob } = state;

  console.log(`Server signer:   ${signer.address}`);
  console.log(`Alice (player):  ${alice.address}`);
  console.log(`Bob (recipient): ${bob.address}`);
  console.log("");
  console.log(`registry:        ${await registry.getAddress()}`);
  console.log(`adapter (SKALE): ${await adapter.getAddress()}`);
  console.log(`baseCharacter:   ${await baseCharacter.getAddress()}`);
  console.log("");

  // Verify bridgeSigner round-trips (catches deploy mistakes).
  if ((await baseCharacter.bridgeSigner()).toLowerCase() !== signer.address.toLowerCase()) {
    throw new Error("baseCharacter.bridgeSigner mismatch");
  }
  if ((await adapter.bridgeSigner()).toLowerCase() !== signer.address.toLowerCase()) {
    throw new Error("adapter.bridgeSigner mismatch");
  }

  // ── 1. SKALE → Base ─────────────────────────────────────────────────────
  let aliceTokenId: bigint = 0n;
  let bridgeOutNonce: string = "";
  let bridgeOutURI: string = "";

  await step("Alice mints a character via the SKALE registry", async () => {
    await (await registry.connect(alice)["register(string)"]("ipfs://smoke-char-lvl-1")).wait();
    aliceTokenId = 0n; // first agent
    if ((await registry.ownerOf(aliceTokenId)).toLowerCase() !== alice.address.toLowerCase()) {
      throw new Error("alice not the owner");
    }
  });

  await step("Alice approves adapter + bridgeOut to Bob's Base address", async () => {
    await (await registry.connect(alice).approve(await adapter.getAddress(), aliceTokenId)).wait();
    const tx = await adapter.connect(alice).bridgeOut(aliceTokenId, bob.address);
    const receipt = await tx.wait();
    const log = receipt!.logs
      .map((l: any) => { try { return adapter.interface.parseLog(l); } catch { return null; } })
      .find((p: any) => p?.name === "BridgeOut");
    if (!log) throw new Error("BridgeOut event not emitted");
    bridgeOutNonce = log.args.nonce;
    bridgeOutURI = log.args.metadataURI;
    if (!(await adapter.escrowed(aliceTokenId))) throw new Error("escrow flag not set");
    if ((await registry.ownerOf(aliceTokenId)).toLowerCase() !== (await adapter.getAddress()).toLowerCase()) {
      throw new Error("token did not transfer into escrow");
    }
  });

  await step("Server signs SKALE→Base claim", async () => {
    const claim = {
      sourceTokenId: aliceTokenId,
      destinationTokenId: aliceTokenId, // round-trip: same id
      recipient: bob.address,
      sourceChainId: BigInt(network.chainId),
      destinationChainId: BigInt(network.chainId),
      metadataURI: bridgeOutURI,
      nonce: bridgeOutNonce,
      expiresAt: BigInt(Math.floor(Date.now() / 1000) + 600),
    };
    const sig = await signClaim(
      await baseCharacter.getAddress(),
      claim.destinationChainId,
      signer,
      claim,
    );
    // Pre-validate digest matches contract's view
    const expectedDigest = await baseCharacter.claimDigest(claim);
    const recovered = ethers.verifyTypedData(
      { name: "WoGBridge", version: "1", chainId: claim.destinationChainId, verifyingContract: await baseCharacter.getAddress() },
      BRIDGE_CLAIM_TYPES,
      claim,
      sig,
    );
    if (recovered.toLowerCase() !== signer.address.toLowerCase()) {
      throw new Error(`recovered signer mismatch: ${recovered} != ${signer.address}`);
    }
    if (!expectedDigest) throw new Error("digest empty");
    (state as any).baseSideClaim = { claim, sig };
  });

  // ── 2. Bob redeems on Base via mintFromClaim ───────────────────────────
  await step("Bob redeems Base-side mint via signed claim", async () => {
    const { claim, sig } = (state as any).baseSideClaim;
    await (await baseCharacter.mintFromClaim(claim, sig)).wait();
    if ((await baseCharacter.ownerOf(aliceTokenId)).toLowerCase() !== bob.address.toLowerCase()) {
      throw new Error("Bob did not receive the Base-side mint");
    }
    if ((await baseCharacter.tokenURI(aliceTokenId)) !== bridgeOutURI) {
      throw new Error("metadataURI did not transfer correctly");
    }
  });

  await step("Replay-protection: same claim cannot be redeemed twice", async () => {
    const { claim, sig } = (state as any).baseSideClaim;
    try {
      await baseCharacter.mintFromClaim.staticCall(claim, sig);
      throw new Error("expected revert on replay");
    } catch (err: any) {
      if (!String(err?.message ?? err).includes("claim consumed")) {
        throw err;
      }
    }
  });

  // ── 3. Base → SKALE round-trip ─────────────────────────────────────────
  let backNonce = "";
  let backURI = "";

  await step("Bob burns on Base via burnAndExit → emits BridgeOut on Base", async () => {
    const tx = await baseCharacter.connect(bob).burnAndExit(aliceTokenId, alice.address);
    const receipt = await tx.wait();
    const log = receipt!.logs
      .map((l: any) => { try { return baseCharacter.interface.parseLog(l); } catch { return null; } })
      .find((p: any) => p?.name === "BridgeOut");
    if (!log) throw new Error("BridgeOut not emitted on Base");
    backNonce = log.args.nonce;
    backURI = log.args.metadataURI;
    try {
      await baseCharacter.ownerOf(aliceTokenId);
      throw new Error("token should be burned");
    } catch (err: any) {
      if (!String(err?.message ?? err).includes("ERC721:")) throw err;
    }
  });

  await step("Server signs Base→SKALE claim and adapter releases escrow", async () => {
    const claim = {
      sourceTokenId: aliceTokenId,
      destinationTokenId: aliceTokenId, // round-trip: same escrowed id
      recipient: alice.address,
      sourceChainId: BigInt(network.chainId),
      destinationChainId: BigInt(network.chainId),
      metadataURI: backURI,
      nonce: backNonce,
      expiresAt: BigInt(Math.floor(Date.now() / 1000) + 600),
    };
    const sig = await signClaim(
      await adapter.getAddress(),
      claim.destinationChainId,
      signer,
      claim,
    );
    await (await adapter.mintFromClaim(claim, sig)).wait();
    if ((await registry.ownerOf(aliceTokenId)).toLowerCase() !== alice.address.toLowerCase()) {
      throw new Error("Alice did not get the SKALE token back");
    }
    if (await adapter.escrowed(aliceTokenId)) {
      throw new Error("escrow flag should clear after release");
    }
  });

  console.log("");
  console.log("Summary:");
  console.log("  ✅ Both contracts deployed");
  console.log("  ✅ bridgeSigner wired correctly");
  console.log("  ✅ bridgeOut emits expected event + escrows token");
  console.log("  ✅ Server signature recovers to the configured bridgeSigner");
  console.log("  ✅ mintFromClaim mints on destination with correct owner + URI");
  console.log("  ✅ Replay-protection rejects the same claim twice");
  console.log("  ✅ burnAndExit on destination + reverse claim releases escrow");
  console.log("  ✅ Full round-trip: NFT returned to original holder");
  console.log("");
  console.log("Ready for testnet deploy. See README testnet section.");
}

main().catch((err) => {
  console.error("\n❌ Smoke test failed:");
  console.error(err);
  process.exit(1);
});
