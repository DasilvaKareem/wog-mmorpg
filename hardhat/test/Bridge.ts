import { loadFixture, time } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

const BASE_CHAIN_ID = 8453n;
const SKALE_CHAIN_ID = 1187947933n;
const FRESH_MINT_SENTINEL = (1n << 256n) - 1n;

async function deployFixture() {
  const [owner, signer, alice, bob, attacker] = await ethers.getSigners();

  const registry = await ethers.deployContract("WoGMockIdentityRegistry");
  await registry.waitForDeployment();

  const adapter = await ethers.deployContract("WoGBridgeAdapter", [
    await registry.getAddress(),
    signer.address,
    BASE_CHAIN_ID, // expectedSourceChainId — Base side
  ]);
  await adapter.waitForDeployment();

  const baseCharacter = await ethers.deployContract("WoGCharacterBase", [
    signer.address,
    SKALE_CHAIN_ID, // expectedSourceChainId — SKALE side
  ]);
  await baseCharacter.waitForDeployment();

  return { owner, signer, alice, bob, attacker, registry, adapter, baseCharacter };
}

function makeNonce(label: string): string {
  return ethers.keccak256(ethers.toUtf8Bytes(label));
}

type Claim = {
  sourceTokenId: bigint;
  destinationTokenId: bigint;
  recipient: string;
  sourceChainId: bigint;
  destinationChainId: bigint;
  metadataURI: string;
  nonce: string;
  expiresAt: bigint;
};

async function signClaim(verifyingContract: string, claim: Claim, signer: any) {
  const network = await ethers.provider.getNetwork();
  return signer.signTypedData(
    {
      name: "WoGBridge",
      version: "1",
      chainId: network.chainId,
      verifyingContract,
    },
    {
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
    },
    claim
  );
}

describe("WoGCharacterBase (Base side)", function () {
  it("mints from a valid claim and rejects replay", async function () {
    const { signer, alice, baseCharacter } = await loadFixture(deployFixture);
    const baseAddr = await baseCharacter.getAddress();
    // Force the test runner to think it is on Base mainnet for chain-id checks.
    // (Hardhat's chainId is 31337 by default; mintFromClaim requires
    // claim.destinationChainId == block.chainid.)
    const network = await ethers.provider.getNetwork();

    const claim: Claim = {
      sourceTokenId: 42n,
      destinationTokenId: 42n,
      recipient: alice.address,
      sourceChainId: SKALE_CHAIN_ID,
      destinationChainId: network.chainId,
      metadataURI: "ipfs://bafy/42",
      nonce: makeNonce("nonce-42"),
      expiresAt: BigInt((await time.latest()) + 3600),
    };
    const sig = await signClaim(baseAddr, claim, signer);

    await expect(baseCharacter.mintFromClaim(claim, sig))
      .to.emit(baseCharacter, "BridgeIn")
      .withArgs(42n, alice.address, SKALE_CHAIN_ID, await baseCharacter.claimDigest(claim));

    expect(await baseCharacter.ownerOf(42n)).to.equal(alice.address);
    expect(await baseCharacter.tokenURI(42n)).to.equal("ipfs://bafy/42");

    // Replay should be blocked even after burn.
    await expect(baseCharacter.mintFromClaim(claim, sig)).to.be.revertedWith("claim consumed");
  });

  it("rejects claim signed by anyone other than the bridge signer", async function () {
    const { attacker, alice, baseCharacter } = await loadFixture(deployFixture);
    const baseAddr = await baseCharacter.getAddress();
    const network = await ethers.provider.getNetwork();
    const claim: Claim = {
      sourceTokenId: 1n,
      destinationTokenId: 1n,
      recipient: alice.address,
      sourceChainId: SKALE_CHAIN_ID,
      destinationChainId: network.chainId,
      metadataURI: "ipfs://x",
      nonce: makeNonce("forged"),
      expiresAt: BigInt((await time.latest()) + 3600),
    };
    const sig = await signClaim(baseAddr, claim, attacker);
    await expect(baseCharacter.mintFromClaim(claim, sig)).to.be.revertedWith("invalid signature");
  });

  it("rejects expired claims", async function () {
    const { signer, alice, baseCharacter } = await loadFixture(deployFixture);
    const baseAddr = await baseCharacter.getAddress();
    const network = await ethers.provider.getNetwork();
    const claim: Claim = {
      sourceTokenId: 2n,
      destinationTokenId: 2n,
      recipient: alice.address,
      sourceChainId: SKALE_CHAIN_ID,
      destinationChainId: network.chainId,
      metadataURI: "ipfs://x",
      nonce: makeNonce("expired"),
      expiresAt: BigInt((await time.latest()) - 1),
    };
    const sig = await signClaim(baseAddr, claim, signer);
    await expect(baseCharacter.mintFromClaim(claim, sig)).to.be.revertedWith("claim expired");
  });

  it("rejects cross-chain replay: claim signed for a different destination chain", async function () {
    const { signer, alice, baseCharacter } = await loadFixture(deployFixture);
    const baseAddr = await baseCharacter.getAddress();
    const claim: Claim = {
      sourceTokenId: 7n,
      destinationTokenId: 7n,
      recipient: alice.address,
      sourceChainId: SKALE_CHAIN_ID,
      destinationChainId: 999999n, // not block.chainid
      metadataURI: "ipfs://x",
      nonce: makeNonce("wrong-dest"),
      expiresAt: BigInt((await time.latest()) + 3600),
    };
    const sig = await signClaim(baseAddr, claim, signer);
    await expect(baseCharacter.mintFromClaim(claim, sig)).to.be.revertedWith("wrong chain");
  });

  it("rejects claim with wrong sourceChainId", async function () {
    const { signer, alice, baseCharacter } = await loadFixture(deployFixture);
    const baseAddr = await baseCharacter.getAddress();
    const network = await ethers.provider.getNetwork();
    const claim: Claim = {
      sourceTokenId: 3n,
      destinationTokenId: 3n,
      recipient: alice.address,
      sourceChainId: 1n, // bogus
      destinationChainId: network.chainId,
      metadataURI: "ipfs://x",
      nonce: makeNonce("bad-src"),
      expiresAt: BigInt((await time.latest()) + 3600),
    };
    const sig = await signClaim(baseAddr, claim, signer);
    await expect(baseCharacter.mintFromClaim(claim, sig)).to.be.revertedWith("bad source chain");
  });

  it("burnAndExit emits BridgeOut with current tokenURI and burns the token", async function () {
    const { signer, alice, bob, baseCharacter } = await loadFixture(deployFixture);
    const baseAddr = await baseCharacter.getAddress();
    const network = await ethers.provider.getNetwork();

    // First mint via claim so alice owns tokenId 9.
    const claim: Claim = {
      sourceTokenId: 9n,
      destinationTokenId: 9n,
      recipient: alice.address,
      sourceChainId: SKALE_CHAIN_ID,
      destinationChainId: network.chainId,
      metadataURI: "ipfs://lvl-1",
      nonce: makeNonce("mint-9"),
      expiresAt: BigInt((await time.latest()) + 3600),
    };
    await baseCharacter.mintFromClaim(claim, await signClaim(baseAddr, claim, signer));

    const tx = await baseCharacter.connect(alice).burnAndExit(9n, bob.address);
    const receipt = await tx.wait();
    const event = receipt!.logs
      .map((log) => {
        try { return baseCharacter.interface.parseLog(log); } catch { return null; }
      })
      .find((parsed) => parsed?.name === "BridgeOut");
    expect(event).to.not.be.null;
    expect(event!.args.tokenId).to.equal(9n);
    expect(event!.args.holder).to.equal(alice.address);
    expect(event!.args.destinationRecipient).to.equal(bob.address);
    expect(event!.args.destinationChainId).to.equal(SKALE_CHAIN_ID);
    expect(event!.args.metadataURI).to.equal("ipfs://lvl-1");

    await expect(baseCharacter.ownerOf(9n)).to.be.reverted;
  });

  it("setBridgeSigner can rotate the signer (owner only)", async function () {
    const { owner, alice, attacker, baseCharacter } = await loadFixture(deployFixture);
    await expect(baseCharacter.connect(attacker).setBridgeSigner(alice.address)).to.be.revertedWith(
      "Ownable: caller is not the owner"
    );
    await expect(baseCharacter.connect(owner).setBridgeSigner(alice.address))
      .to.emit(baseCharacter, "BridgeSignerUpdated");
    expect(await baseCharacter.bridgeSigner()).to.equal(alice.address);
  });
});

describe("WoGBridgeAdapter (SKALE side)", function () {
  it("escrows the NFT on bridgeOut and emits a BridgeOut event with current URI", async function () {
    const { alice, bob, registry, adapter } = await loadFixture(deployFixture);

    // alice registers a character with a URI directly through the registry
    await registry.connect(alice)["register(string)"]("ipfs://skale-lvl-3");
    const tokenId = 0n;
    expect(await registry.ownerOf(tokenId)).to.equal(alice.address);

    await registry.connect(alice).approve(await adapter.getAddress(), tokenId);
    const tx = await adapter.connect(alice).bridgeOut(tokenId, bob.address);
    const receipt = await tx.wait();
    const event = receipt!.logs
      .map((log) => {
        try { return adapter.interface.parseLog(log); } catch { return null; }
      })
      .find((parsed) => parsed?.name === "BridgeOut");
    expect(event).to.not.be.null;
    expect(event!.args.tokenId).to.equal(tokenId);
    expect(event!.args.holder).to.equal(alice.address);
    expect(event!.args.destinationRecipient).to.equal(bob.address);
    expect(event!.args.destinationChainId).to.equal(BASE_CHAIN_ID);
    expect(event!.args.metadataURI).to.equal("ipfs://skale-lvl-3");

    expect(await adapter.escrowed(tokenId)).to.equal(true);
    expect(await adapter.escrowHolder(tokenId)).to.equal(alice.address);
    expect(await registry.ownerOf(tokenId)).to.equal(await adapter.getAddress());
  });

  it("mintFromClaim releases escrow for round-trip (sourceTokenId from this chain originally)", async function () {
    const { signer, alice, bob, registry, adapter } = await loadFixture(deployFixture);
    const adapterAddr = await adapter.getAddress();

    // Alice mints + bridges out
    await registry.connect(alice)["register(string)"]("ipfs://round-trip");
    const tokenId = 0n;
    await registry.connect(alice).approve(adapterAddr, tokenId);
    await adapter.connect(alice).bridgeOut(tokenId, bob.address);

    // Server signs a bridge-back claim (Base → SKALE)
    const network = await ethers.provider.getNetwork();
    const claim: Claim = {
      sourceTokenId: tokenId,
      destinationTokenId: tokenId, // round-trip: same id
      recipient: alice.address,
      sourceChainId: BASE_CHAIN_ID,
      destinationChainId: network.chainId,
      metadataURI: "ipfs://round-trip",
      nonce: makeNonce("rt-back"),
      expiresAt: BigInt((await time.latest()) + 3600),
    };
    const sig = await signClaim(adapterAddr, claim, signer);

    await expect(adapter.mintFromClaim(claim, sig))
      .to.emit(adapter, "BridgeIn")
      .withArgs(tokenId, alice.address, BASE_CHAIN_ID, await adapter.claimDigest(claim));

    expect(await adapter.escrowed(tokenId)).to.equal(false);
    expect(await registry.ownerOf(tokenId)).to.equal(alice.address);
  });

  it("mintFromClaim fresh-mints when destinationTokenId == FRESH_MINT_SENTINEL (Base-origin character)", async function () {
    const { signer, alice, adapter, registry } = await loadFixture(deployFixture);
    const adapterAddr = await adapter.getAddress();
    const network = await ethers.provider.getNetwork();

    const claim: Claim = {
      sourceTokenId: 777n, // existed on Base
      destinationTokenId: FRESH_MINT_SENTINEL, // sentinel = fresh mint
      recipient: alice.address,
      sourceChainId: BASE_CHAIN_ID,
      destinationChainId: network.chainId,
      metadataURI: "ipfs://from-base",
      nonce: makeNonce("fresh"),
      expiresAt: BigInt((await time.latest()) + 3600),
    };
    const sig = await signClaim(adapterAddr, claim, signer);

    const tx = await adapter.mintFromClaim(claim, sig);
    const receipt = await tx.wait();
    const event = receipt!.logs
      .map((log) => {
        try { return adapter.interface.parseLog(log); } catch { return null; }
      })
      .find((parsed) => parsed?.name === "BridgeIn");
    expect(event).to.not.be.null;
    const mintedTokenId: bigint = event!.args.tokenId;
    // Registry _lastId starts at 0 → first agent is 0
    expect(mintedTokenId).to.equal(0n);
    expect(await registry.ownerOf(mintedTokenId)).to.equal(alice.address);
    expect(await registry.tokenURI(mintedTokenId)).to.equal("ipfs://from-base");
  });

  it("refundEscrow releases token back to original holder (owner only)", async function () {
    const { owner, alice, bob, attacker, registry, adapter } = await loadFixture(deployFixture);
    const adapterAddr = await adapter.getAddress();

    await registry.connect(alice)["register(string)"]("ipfs://refund-me");
    const tokenId = 0n;
    await registry.connect(alice).approve(adapterAddr, tokenId);
    await adapter.connect(alice).bridgeOut(tokenId, bob.address);

    await expect(adapter.connect(attacker).refundEscrow(tokenId)).to.be.revertedWith(
      "Ownable: caller is not the owner"
    );

    await expect(adapter.connect(owner).refundEscrow(tokenId))
      .to.emit(adapter, "EscrowReleased")
      .withArgs(tokenId, alice.address, true);

    expect(await adapter.escrowed(tokenId)).to.equal(false);
    expect(await registry.ownerOf(tokenId)).to.equal(alice.address);
  });

  it("rejects fresh-mint claim when destinationTokenId points at a non-escrowed id", async function () {
    const { signer, alice, adapter } = await loadFixture(deployFixture);
    const adapterAddr = await adapter.getAddress();
    const network = await ethers.provider.getNetwork();
    // Claim pretends to "release escrow" for tokenId 5, but 5 was never escrowed.
    const claim: Claim = {
      sourceTokenId: 5n,
      destinationTokenId: 5n, // non-zero AND not escrowed
      recipient: alice.address,
      sourceChainId: BASE_CHAIN_ID,
      destinationChainId: network.chainId,
      metadataURI: "ipfs://x",
      nonce: makeNonce("fake-release"),
      expiresAt: BigInt((await time.latest()) + 3600),
    };
    const sig = await signClaim(adapterAddr, claim, signer);
    await expect(adapter.mintFromClaim(claim, sig)).to.be.revertedWith("not escrowed");
  });

  it("blocks double-bridge-out of the same tokenId", async function () {
    const { alice, bob, registry, adapter } = await loadFixture(deployFixture);
    const adapterAddr = await adapter.getAddress();
    await registry.connect(alice)["register(string)"]("ipfs://once");
    const tokenId = 0n;
    await registry.connect(alice).approve(adapterAddr, tokenId);
    await adapter.connect(alice).bridgeOut(tokenId, bob.address);
    // Token now owned by adapter; alice can't bridgeOut again, but also adapter
    // refuses if escrowed flag is set.
    await expect(adapter.connect(alice).bridgeOut(tokenId, bob.address)).to.be.reverted;
  });

  it("cross-chain replay: claim signed for a different destinationChainId is rejected", async function () {
    const { signer, alice, adapter } = await loadFixture(deployFixture);
    const adapterAddr = await adapter.getAddress();
    const claim: Claim = {
      sourceTokenId: 1n,
      destinationTokenId: 0n,
      recipient: alice.address,
      sourceChainId: BASE_CHAIN_ID,
      destinationChainId: 31337n + 999n, // not block.chainid
      metadataURI: "ipfs://x",
      nonce: makeNonce("wrong-dest"),
      expiresAt: BigInt((await time.latest()) + 3600),
    };
    const sig = await signClaim(adapterAddr, claim, signer);
    await expect(adapter.mintFromClaim(claim, sig)).to.be.revertedWith("wrong chain");
  });
});
