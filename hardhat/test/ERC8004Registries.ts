import { expect } from "chai";
import { ethers } from "hardhat";

describe("WoG ERC-8004 registries", function () {
  it("deploys identity, reputation, and validation registries", async function () {
    const identity = await ethers.deployContract("WoGIdentityRegistry");
    await identity.waitForDeployment();

    const reputation = await ethers.deployContract("WoGReputationRegistry");
    await reputation.waitForDeployment();

    const validation = await ethers.deployContract("WoGValidationRegistry");
    await validation.waitForDeployment();

    expect(await identity.getAddress()).to.match(/^0x[a-fA-F0-9]{40}$/);
    expect(await reputation.getAddress()).to.match(/^0x[a-fA-F0-9]{40}$/);
    expect(await validation.getAddress()).to.match(/^0x[a-fA-F0-9]{40}$/);
  });
});
