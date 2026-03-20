import { loadFixture, time } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

async function deployFixture() {
  const [server, player, other] = await ethers.getSigners();

  const gold = await ethers.deployContract("WoGMockGold");
  const items = await ethers.deployContract("WoGMockItems");
  const characters = await ethers.deployContract("WoGMockCharacters");
  const identity = await ethers.deployContract("WoGIdentityRegistry");
  const reputation = await ethers.deployContract("WoGReputationRegistry");
  const validation = await ethers.deployContract("WoGValidationRegistry");

  await Promise.all([
    gold.waitForDeployment(),
    items.waitForDeployment(),
    characters.waitForDeployment(),
    identity.waitForDeployment(),
    reputation.waitForDeployment(),
    validation.waitForDeployment(),
  ]);

  return { server, player, other, gold, items, characters, identity, reputation, validation };
}

function encodeUint(value: bigint) {
  return ethers.AbiCoder.defaultAbiCoder().encode(["uint256"], [value]);
}

function encodeString(value: string) {
  return ethers.AbiCoder.defaultAbiCoder().encode(["string"], [value]);
}

describe("WoG ERC-8004 local integration", function () {
  it("deploys the full local dev contract set", async function () {
    const { gold, items, characters, identity, reputation, validation } = await loadFixture(deployFixture);

    expect(await gold.getAddress()).to.match(/^0x[a-fA-F0-9]{40}$/);
    expect(await items.getAddress()).to.match(/^0x[a-fA-F0-9]{40}$/);
    expect(await characters.getAddress()).to.match(/^0x[a-fA-F0-9]{40}$/);
    expect(await identity.getAddress()).to.match(/^0x[a-fA-F0-9]{40}$/);
    expect(await reputation.getAddress()).to.match(/^0x[a-fA-F0-9]{40}$/);
    expect(await validation.getAddress()).to.match(/^0x[a-fA-F0-9]{40}$/);
  });

  it("runs the shard-style bootstrap flow across mock assets and ERC-8004 registries", async function () {
    const { server, player, gold, items, characters, identity, reputation, validation } =
      await loadFixture(deployFixture);

    const characterTokenUri = "data:application/json;base64,character";
    const itemTokenUri = "data:application/json;base64,item";
    const agentUri = `http://127.0.0.1:3000/a2a/${player.address}`;
    const metadataUri = "ipfs://wog/character/0";
    const validUntil = (await time.latest()) + 365 * 24 * 60 * 60;

    await expect(gold.connect(server).mintTo(player.address, ethers.parseEther("0.02")))
      .to.changeTokenBalance(gold, player, ethers.parseEther("0.02"));

    await expect(characters.connect(server).mintTo(player.address, characterTokenUri))
      .to.emit(characters, "Transfer")
      .withArgs(ethers.ZeroAddress, player.address, 0n);
    expect(await characters.nextTokenIdToMint()).to.equal(1n);
    expect(await characters.ownerOf(0n)).to.equal(player.address);
    expect(await characters.tokenURI(0n)).to.equal(characterTokenUri);

    await items.connect(server).mintTo(player.address, ethers.MaxUint256, itemTokenUri, 3n);
    expect(await items.nextTokenIdToMint()).to.equal(1n);
    expect(await items.balanceOf(player.address, 0n)).to.equal(3n);
    expect(await items.uri(0n)).to.equal(itemTokenUri);

    await expect(identity.connect(server).register(agentUri))
      .to.emit(identity, "Registered")
      .withArgs(1n, agentUri, server.address);

    await expect(identity.connect(server).setMetadata(1n, "characterTokenId", encodeUint(0n)))
      .to.emit(identity, "MetadataUpdated")
      .withArgs(1n, "characterTokenId", encodeUint(0n));

    await expect(identity.connect(server).setMetadata(1n, "metadataURI", encodeString(metadataUri)))
      .to.emit(identity, "IdentityUpdated")
      .withArgs(1n, metadataUri);

    await expect(identity.connect(server).transferFrom(server.address, player.address, 1n))
      .to.emit(identity, "AgentWalletUpdated")
      .withArgs(1n, player.address);

    await expect(validation.connect(server).verifyCapability(1n, "wog:a2a-enabled", validUntil))
      .to.emit(validation, "CapabilityVerified")
      .withArgs(1n, server.address, "wog:a2a-enabled", validUntil);

    await expect(reputation.connect(server).initializeReputation(1n))
      .to.emit(reputation, "ReputationInitialized")
      .withArgs(1n);

    await expect(
      reputation.connect(server).batchUpdateReputation(1n, [0, 0, 7, 0, 3], "bootstrap")
    ).to.emit(reputation, "FeedbackSubmitted");

    expect(await identity.ownerOf(1n)).to.equal(player.address);
    expect(await identity.getAgentWallet(1n)).to.equal(player.address);
    expect(await identity.tokenURI(1n)).to.equal(agentUri);
    expect(await identity.characterToIdentity(0n)).to.equal(1n);

    const rawCharacterTokenId = await identity.getMetadata(1n, "characterTokenId");
    const rawMetadataUri = await identity.getMetadata(1n, "metadataURI");
    expect(ethers.AbiCoder.defaultAbiCoder().decode(["uint256"], rawCharacterTokenId)[0]).to.equal(0n);
    expect(ethers.AbiCoder.defaultAbiCoder().decode(["string"], rawMetadataUri)[0]).to.equal(metadataUri);

    const verifications = await validation.getVerifications(1n);
    expect(verifications).to.have.length(1);
    expect(verifications[0].claim).to.equal("wog:a2a-enabled");
    expect(await validation.isVerified(1n, "wog:a2a-enabled")).to.equal(true);

    const score = await reputation.getReputation(1n);
    expect(score.combat).to.equal(500n);
    expect(score.economic).to.equal(500n);
    expect(score.social).to.equal(507n);
    expect(score.crafting).to.equal(500n);
    expect(score.agent).to.equal(503n);
    expect(score.overall).to.equal(501n);

    const [topAgentIds, topScores] = await reputation.getTopAgents(1n);
    expect(topAgentIds).to.deep.equal([1n]);
    expect(topScores[0].overall).to.equal(501n);
    expect(await reputation.getRankName(score.overall)).to.equal("Average Citizen");
  });

  it("supports the WoG helper identity path and keeps ownership-linked metadata consistent", async function () {
    const { server, player, other, identity } = await loadFixture(deployFixture);

    const characterTokenId = 77n;
    const metadataUri = "ipfs://wog/character/77";
    const endpoint = "http://127.0.0.1:3000/a2a/test-helper";

    await expect(
      identity.connect(server).createIdentityWithEndpoint(characterTokenId, player.address, metadataUri, endpoint)
    )
      .to.emit(identity, "IdentityCreated")
      .withArgs(1n, characterTokenId, player.address, metadataUri);

    expect(await identity.ownerOf(1n)).to.equal(player.address);
    expect(await identity.characterToIdentity(characterTokenId)).to.equal(1n);
    expect(await identity.tokenURI(1n)).to.equal(endpoint);

    const helperIdentity = await identity.getIdentityByCharacter(characterTokenId);
    expect(helperIdentity.characterTokenId).to.equal(characterTokenId);
    expect(helperIdentity.characterOwner).to.equal(player.address);
    expect(helperIdentity.metadataURI).to.equal(metadataUri);
    expect(helperIdentity.agentURI).to.equal(endpoint);
    expect(helperIdentity.active).to.equal(true);

    const rawCharacterTokenId = await identity.getMetadata(1n, "characterTokenId");
    expect(ethers.AbiCoder.defaultAbiCoder().decode(["uint256"], rawCharacterTokenId)[0]).to.equal(
      characterTokenId
    );

    await expect(identity.connect(player).setAgentWallet(1n, other.address, (await time.latest()) + 60, "0x"))
      .to.emit(identity, "AgentWalletUpdated")
      .withArgs(1n, other.address);

    expect(await identity.ownerOf(1n)).to.equal(other.address);
    const transferredIdentity = await identity.identities(1n);
    expect(transferredIdentity.characterOwner).to.equal(other.address);
  });

  it("enforces authorization and expiry rules across the registries", async function () {
    const { server, player, other, identity, reputation, validation } = await loadFixture(deployFixture);

    await expect(identity.connect(player).createIdentityWithEndpoint(1n, player.address, "ipfs://meta", ""))
      .to.be.revertedWithCustomError(identity, "Unauthorized");

    await identity.connect(server).register("http://127.0.0.1:3000/a2a/server");
    await identity.connect(server).transferFrom(server.address, player.address, 1n);

    await expect(identity.connect(other).setAgentURI(1n, "http://127.0.0.1:3000/a2a/other"))
      .to.be.revertedWithCustomError(identity, "Unauthorized");

    await expect(identity.connect(player).setAgentWallet(1n, other.address, (await time.latest()) - 1, "0x"))
      .to.be.revertedWithCustomError(identity, "SignatureExpired");

    await expect(reputation.connect(player).initializeReputation(1n))
      .to.be.revertedWithCustomError(reputation, "Unauthorized");

    await expect(validation.connect(player).verifyCapability(1n, "wog:a2a-enabled", (await time.latest()) + 60))
      .to.be.revertedWithCustomError(validation, "Unauthorized");

    await expect(validation.connect(server).verifyCapability(1n, "wog:a2a-enabled", await time.latest()))
      .to.be.revertedWithCustomError(validation, "InvalidExpiry");
  });

  it("expires validation claims and tracks multi-agent reputation ordering", async function () {
    const { server, validation, reputation } = await loadFixture(deployFixture);

    const expiry = (await time.latest()) + 120;
    await validation.connect(server).verifyCapability(5n, "wog:trade-capable", expiry);
    expect(await validation.isVerified(5n, "wog:trade-capable")).to.equal(true);

    await time.increaseTo(expiry + 1);
    expect(await validation.isVerified(5n, "wog:trade-capable")).to.equal(false);

    await reputation.connect(server).initializeReputation(10n);
    await reputation.connect(server).initializeReputation(11n);
    await reputation.connect(server).recordInteraction(10n, true, 50n);
    await reputation.connect(server).recordInteraction(11n, false, 50n);

    const [agentIds, scores] = await reputation.getTopAgents(2n);
    expect(agentIds).to.deep.equal([10n, 11n]);
    expect(scores[0].overall).to.be.greaterThan(scores[1].overall);
  });
});
