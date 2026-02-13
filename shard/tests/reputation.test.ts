/**
 * Reputation System Tests
 * Tests for ERC-8004 reputation functionality
 */

import { describe, it, expect, beforeAll } from "@jest/globals";
import { reputationManager, ReputationCategory } from "../src/reputationManager";

describe("Reputation System", () => {
  const testCharacterId = BigInt(999);
  const testWallet = "0x" + "1".repeat(40);

  describe("Character Identity", () => {
    it("should create a character identity", async () => {
      // Skip if contracts not deployed
      if (!process.env.IDENTITY_REGISTRY_ADDRESS) {
        console.log("Skipping: IDENTITY_REGISTRY_ADDRESS not set");
        return;
      }

      const identityId = await reputationManager.createCharacterIdentity(
        testCharacterId,
        testWallet,
        {
          name: "Test Hero",
          class: "Warrior",
          level: 10,
        }
      );

      expect(identityId).toBeDefined();
      expect(identityId).toBeGreaterThan(BigInt(0));
    });

    it("should retrieve character identity", async () => {
      if (!process.env.IDENTITY_REGISTRY_ADDRESS) {
        console.log("Skipping: IDENTITY_REGISTRY_ADDRESS not set");
        return;
      }

      const identity = await reputationManager.getCharacterIdentity(testCharacterId);

      expect(identity).toBeDefined();
      expect(identity?.characterTokenId).toBe(testCharacterId);
      expect(identity?.characterOwner).toBe(testWallet);
      expect(identity?.active).toBe(true);
    });
  });

  describe("Reputation Scores", () => {
    it("should get initial reputation (default 500)", async () => {
      if (!process.env.REPUTATION_REGISTRY_ADDRESS) {
        console.log("Skipping: REPUTATION_REGISTRY_ADDRESS not set");
        return;
      }

      const reputation = await reputationManager.getReputation(testCharacterId);

      expect(reputation).toBeDefined();
      expect(reputation?.combat).toBe(500);
      expect(reputation?.economic).toBe(500);
      expect(reputation?.social).toBe(500);
      expect(reputation?.overall).toBe(500);
    });

    it("should update combat reputation for PvP win", async () => {
      if (!process.env.REPUTATION_REGISTRY_ADDRESS) {
        console.log("Skipping: REPUTATION_REGISTRY_ADDRESS not set");
        return;
      }

      await reputationManager.updateCombatReputation(
        testCharacterId,
        true, // won
        80 // performance score
      );

      const reputation = await reputationManager.getReputation(testCharacterId);

      expect(reputation).toBeDefined();
      expect(reputation!.combat).toBeGreaterThan(500);
    });

    it("should get correct reputation rank", async () => {
      if (!process.env.REPUTATION_REGISTRY_ADDRESS) {
        console.log("Skipping: REPUTATION_REGISTRY_ADDRESS not set");
        return;
      }

      const rank500 = await reputationManager.getReputationRank(500);
      expect(rank500).toBe("Average Citizen");

      const rank800 = await reputationManager.getReputationRank(800);
      expect(rank800).toBe("Renowned Champion");

      const rank950 = await reputationManager.getReputationRank(950);
      expect(rank950).toBe("Legendary Hero");
    });
  });

  describe("Reputation Feedback", () => {
    it("should submit feedback and update score", async () => {
      if (!process.env.REPUTATION_REGISTRY_ADDRESS) {
        console.log("Skipping: REPUTATION_REGISTRY_ADDRESS not set");
        return;
      }

      const beforeRep = await reputationManager.getReputation(testCharacterId);

      await reputationManager.submitFeedback(
        testCharacterId,
        ReputationCategory.Social,
        10,
        "Helped a new player"
      );

      const afterRep = await reputationManager.getReputation(testCharacterId);

      expect(afterRep!.social).toBe(beforeRep!.social + 10);
    });

    it("should batch update multiple categories", async () => {
      if (!process.env.REPUTATION_REGISTRY_ADDRESS) {
        console.log("Skipping: REPUTATION_REGISTRY_ADDRESS not set");
        return;
      }

      await reputationManager.batchUpdateReputation(
        testCharacterId,
        {
          combat: 5,
          economic: 3,
          social: 2,
        },
        "Tournament participation"
      );

      const reputation = await reputationManager.getReputation(testCharacterId);

      expect(reputation).toBeDefined();
    });

    it("should retrieve feedback history", async () => {
      if (!process.env.REPUTATION_REGISTRY_ADDRESS) {
        console.log("Skipping: REPUTATION_REGISTRY_ADDRESS not set");
        return;
      }

      const history = await reputationManager.getFeedbackHistory(
        testCharacterId,
        5
      );

      expect(history).toBeDefined();
      expect(Array.isArray(history)).toBe(true);
    });
  });

  describe("Economic Reputation", () => {
    it("should update economic reputation for fair trade", async () => {
      if (!process.env.REPUTATION_REGISTRY_ADDRESS) {
        console.log("Skipping: REPUTATION_REGISTRY_ADDRESS not set");
        return;
      }

      const beforeRep = await reputationManager.getReputation(testCharacterId);

      await reputationManager.updateEconomicReputation(
        testCharacterId,
        true, // trade completed
        true // fair price
      );

      const afterRep = await reputationManager.getReputation(testCharacterId);

      expect(afterRep!.economic).toBeGreaterThan(beforeRep!.economic);
    });

    it("should penalize for failed trade", async () => {
      if (!process.env.REPUTATION_REGISTRY_ADDRESS) {
        console.log("Skipping: REPUTATION_REGISTRY_ADDRESS not set");
        return;
      }

      const beforeRep = await reputationManager.getReputation(testCharacterId);

      await reputationManager.updateEconomicReputation(
        testCharacterId,
        false, // trade failed
        false
      );

      const afterRep = await reputationManager.getReputation(testCharacterId);

      expect(afterRep!.economic).toBeLessThan(beforeRep!.economic);
    });
  });
});

describe("Reputation API", () => {
  it("should return reputation via API endpoint", async () => {
    // This would test the actual API endpoint
    // Requires server to be running
    console.log("API tests require running server - implement in e2e tests");
  });
});

export {};
