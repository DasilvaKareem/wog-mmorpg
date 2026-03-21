import { loadFixture, time } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

async function deployFixture() {
  const [server, player, other, validator] = await ethers.getSigners();

  const gold = await ethers.deployContract("WoGMockGold");
  const items = await ethers.deployContract("WoGMockItems");
  const characters = await ethers.deployContract("WoGMockCharacters");
  const identity = await ethers.deployContract("WoGIdentityRegistry");
  const reputation = await ethers.deployContract("WoGReputationRegistry", [await identity.getAddress()]);
  const validation = await ethers.deployContract("WoGValidationRegistry", [await identity.getAddress()]);

  await Promise.all([
    gold.waitForDeployment(),
    items.waitForDeployment(),
    characters.waitForDeployment(),
    identity.waitForDeployment(),
    reputation.waitForDeployment(),
    validation.waitForDeployment(),
  ]);

  return { server, player, other, validator, gold, items, characters, identity, reputation, validation };
}

function encodeUint(value: bigint) {
  return ethers.AbiCoder.defaultAbiCoder().encode(["uint256"], [value]);
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

  it("matches the official identity registry semantics", async function () {
    const { player, other, identity } = await loadFixture(deployFixture);

    const metadata = [
      { metadataKey: "characterTokenId", metadataValue: encodeUint(77n) },
    ];

    await expect(identity.connect(player)["register(string,(string,bytes)[])"]("ipfs://agent-77", metadata))
      .to.emit(identity, "Registered")
      .withArgs(0n, "ipfs://agent-77", player.address);

    expect(await identity.ownerOf(0n)).to.equal(player.address);
    expect(await identity.tokenURI(0n)).to.equal("ipfs://agent-77");
    expect(await identity.getMetadata(0n, "characterTokenId")).to.equal(encodeUint(77n));
    expect(await identity.getAgentWallet(0n)).to.equal(player.address);

    const chainId = (await ethers.provider.getNetwork()).chainId;
    const deadline = BigInt((await time.latest()) + 240);
    const signature = await other.signTypedData(
      {
        name: "ERC8004IdentityRegistry",
        version: "1",
        chainId,
        verifyingContract: await identity.getAddress(),
      },
      {
        AgentWalletSet: [
          { name: "agentId", type: "uint256" },
          { name: "newWallet", type: "address" },
          { name: "owner", type: "address" },
          { name: "deadline", type: "uint256" },
        ],
      },
      {
        agentId: 0n,
        newWallet: other.address,
        owner: player.address,
        deadline,
      }
    );

    await identity.connect(player).setAgentWallet(0n, other.address, deadline, signature);
    expect(await identity.getAgentWallet(0n)).to.equal(other.address);
    expect(await identity.ownerOf(0n)).to.equal(player.address);

    await identity.connect(player).transferFrom(player.address, other.address, 0n);
    expect(await identity.ownerOf(0n)).to.equal(other.address);
    expect(await identity.getAgentWallet(0n)).to.equal(ethers.ZeroAddress);
  });

  it("matches the official reputation registry semantics", async function () {
    const { server, player, other, identity, reputation } = await loadFixture(deployFixture);

    await identity.connect(player)["register(string)"]("ipfs://agent-1");

    await expect(
      reputation.connect(player).giveFeedback(0n, 10, 0, "social", "self", "", "", ethers.ZeroHash)
    ).to.be.revertedWith("Self-feedback not allowed");

    await expect(
      reputation.connect(other).giveFeedback(0n, 12, 0, "social", "helpful", "https://client.example", "ipfs://feedback/1", ethers.ZeroHash)
    ).to.emit(reputation, "NewFeedback");

    await reputation.connect(server).giveFeedback(0n, -2, 0, "social", "minor-issue", "", "", ethers.ZeroHash);

    const clients = Array.from(await reputation.getClients(0n));
    expect(clients).to.deep.equal([other.address, server.address]);

    const summary = await reputation.getSummary(0n, clients, "social", "");
    expect(summary[0]).to.equal(2n);
    expect(summary[1]).to.equal(5n);
    expect(summary[2]).to.equal(0n);

    const feedback = await reputation.readFeedback(0n, other.address, 1n);
    expect(feedback[0]).to.equal(12n);
    expect(feedback[2]).to.equal("social");
    expect(feedback[3]).to.equal("helpful");
    expect(feedback[4]).to.equal(false);

    await reputation.connect(other).appendResponse(0n, other.address, 1n, "ipfs://response/1", ethers.ZeroHash);
    expect(await reputation.getResponseCount(0n, other.address, 1n, [])).to.equal(1n);

    await reputation.connect(other).revokeFeedback(0n, 1n);
    const revoked = await reputation.readFeedback(0n, other.address, 1n);
    expect(revoked[4]).to.equal(true);
  });

  it("matches the official validation registry semantics", async function () {
    const { player, validator, identity, validation } = await loadFixture(deployFixture);

    await identity.connect(player)["register(string)"]("ipfs://agent-validation");
    const requestHash = ethers.keccak256(ethers.toUtf8Bytes("validation-request"));

    await expect(
      validation.connect(player).validationRequest(validator.address, 0n, "ipfs://validation/request/1", requestHash)
    ).to.emit(validation, "ValidationRequest");

    await expect(
      validation.connect(validator).validationResponse(requestHash, 100, "ipfs://validation/response/1", ethers.ZeroHash, "wog:a2a-enabled")
    ).to.emit(validation, "ValidationResponse");

    const status = await validation.getValidationStatus(requestHash);
    expect(status[0]).to.equal(validator.address);
    expect(status[1]).to.equal(0n);
    expect(status[2]).to.equal(100n);
    expect(status[4]).to.equal("wog:a2a-enabled");

    const summary = await validation.getSummary(0n, [validator.address], "wog:a2a-enabled");
    expect(summary[0]).to.equal(1n);
    expect(summary[1]).to.equal(100);

    expect(await validation.getAgentValidations(0n)).to.deep.equal([requestHash]);
    expect(await validation.getValidatorRequests(validator.address)).to.deep.equal([requestHash]);
  });
});
