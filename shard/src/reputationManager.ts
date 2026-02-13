/**
 * Reputation Manager
 * Manages ERC-8004 reputation system for WoG characters
 */

import { ethers } from "ethers";
import { biteWallet, biteProvider } from "./biteChain.js";

const IDENTITY_REGISTRY_ADDRESS = process.env.IDENTITY_REGISTRY_ADDRESS || "";
const REPUTATION_REGISTRY_ADDRESS = process.env.REPUTATION_REGISTRY_ADDRESS || "";

/** Identity Registry ABI */
const IDENTITY_ABI = [
  "function createIdentity(uint256 characterTokenId, address characterOwner, string metadataURI) returns (uint256)",
  "function getIdentityByCharacter(uint256 characterTokenId) view returns (tuple(uint256 characterTokenId, address characterOwner, string metadataURI, uint256 createdAt, bool active))",
  "function identities(uint256 identityId) view returns (uint256 characterTokenId, address characterOwner, string metadataURI, uint256 createdAt, bool active)",
  "function characterToIdentity(uint256 characterTokenId) view returns (uint256)",
  "function isActive(uint256 identityId) view returns (bool)",
  "event IdentityCreated(uint256 indexed identityId, uint256 indexed characterTokenId, address indexed owner, string metadataURI)",
];

/** Reputation Registry ABI */
const REPUTATION_ABI = [
  "function initializeReputation(uint256 identityId)",
  "function submitFeedback(uint256 identityId, uint8 category, int256 delta, string reason)",
  "function batchUpdateReputation(uint256 identityId, int256[5] deltas, string reason)",
  "function getReputation(uint256 identityId) view returns (tuple(uint256 combat, uint256 economic, uint256 social, uint256 crafting, uint256 agent, uint256 overall, uint256 lastUpdated))",
  "function getCategoryScore(uint256 identityId, uint8 category) view returns (uint256)",
  "function getRankName(uint256 score) view returns (string)",
  "function getIdentityFeedback(uint256 identityId) view returns (uint256[])",
  "function getFeedback(uint256 feedbackId) view returns (tuple(address submitter, uint256 identityId, uint8 category, int256 delta, string reason, uint256 timestamp, bool validated))",
  "event ReputationUpdated(uint256 indexed identityId, uint8 category, uint256 newScore, int256 delta)",
];

export enum ReputationCategory {
  Combat = 0,
  Economic = 1,
  Social = 2,
  Crafting = 3,
  Agent = 4,
}

export interface ReputationScore {
  combat: number;
  economic: number;
  social: number;
  crafting: number;
  agent: number;
  overall: number;
  lastUpdated: number;
}

export interface CharacterIdentity {
  identityId: bigint;
  characterTokenId: bigint;
  characterOwner: string;
  metadataURI: string;
  createdAt: number;
  active: boolean;
}

export interface ReputationFeedback {
  submitter: string;
  identityId: bigint;
  category: ReputationCategory;
  delta: number;
  reason: string;
  timestamp: number;
  validated: boolean;
}

export class ReputationManager {
  private identityContract: ethers.Contract;
  private reputationContract: ethers.Contract;
  private identityCache: Map<string, CharacterIdentity>;

  constructor() {
    this.identityContract = new ethers.Contract(
      IDENTITY_REGISTRY_ADDRESS,
      IDENTITY_ABI,
      biteWallet
    );

    this.reputationContract = new ethers.Contract(
      REPUTATION_REGISTRY_ADDRESS,
      REPUTATION_ABI,
      biteWallet
    );

    this.identityCache = new Map();
  }

  /**
   * Create identity for a new character
   */
  async createCharacterIdentity(
    characterTokenId: bigint,
    characterOwner: string,
    characterData: {
      name: string;
      class: string;
      level: number;
    }
  ): Promise<bigint> {
    // Create metadata URI (in production, upload to IPFS)
    const metadata = {
      name: characterData.name,
      characterClass: characterData.class,
      level: characterData.level,
      description: `${characterData.class} character in World of Goo MMORPG`,
      createdAt: Date.now(),
    };

    const metadataURI = `data:application/json;base64,${Buffer.from(
      JSON.stringify(metadata)
    ).toString("base64")}`;

    // Create identity on-chain
    const tx = await this.identityContract.createIdentity(
      characterTokenId,
      characterOwner,
      metadataURI
    );

    const receipt = await tx.wait();

    // Parse IdentityCreated event
    const event = receipt.logs.find(
      (log: any) =>
        log.topics[0] ===
        this.identityContract.interface.getEvent("IdentityCreated").topicHash
    );

    if (!event) {
      throw new Error("IdentityCreated event not found");
    }

    const parsedEvent = this.identityContract.interface.parseLog({
      topics: event.topics,
      data: event.data,
    });

    const identityId = parsedEvent?.args[0];

    // Initialize reputation
    await this.initializeReputation(identityId);

    return identityId;
  }

  /**
   * Initialize reputation for an identity
   */
  async initializeReputation(identityId: bigint): Promise<void> {
    const tx = await this.reputationContract.initializeReputation(identityId);
    await tx.wait();
  }

  /**
   * Get character identity by token ID
   */
  async getCharacterIdentity(characterTokenId: bigint): Promise<CharacterIdentity | null> {
    const cacheKey = characterTokenId.toString();

    // Check cache
    if (this.identityCache.has(cacheKey)) {
      return this.identityCache.get(cacheKey)!;
    }

    try {
      const identityId = await this.identityContract.characterToIdentity(characterTokenId);

      if (identityId === BigInt(0)) {
        return null;
      }

      const identityData = await this.identityContract.identities(identityId);

      const identity: CharacterIdentity = {
        identityId,
        characterTokenId: identityData[0],
        characterOwner: identityData[1],
        metadataURI: identityData[2],
        createdAt: Number(identityData[3]),
        active: identityData[4],
      };

      // Cache it
      this.identityCache.set(cacheKey, identity);

      return identity;
    } catch (error) {
      console.error("Error fetching character identity:", error);
      return null;
    }
  }

  /**
   * Get reputation score for a character
   */
  async getReputation(characterTokenId: bigint): Promise<ReputationScore | null> {
    const identity = await this.getCharacterIdentity(characterTokenId);
    if (!identity) {
      return null;
    }

    try {
      const rep = await this.reputationContract.getReputation(identity.identityId);

      return {
        combat: Number(rep.combat),
        economic: Number(rep.economic),
        social: Number(rep.social),
        crafting: Number(rep.crafting),
        agent: Number(rep.agent),
        overall: Number(rep.overall),
        lastUpdated: Number(rep.lastUpdated),
      };
    } catch (error) {
      console.error("Error fetching reputation:", error);
      return null;
    }
  }

  /**
   * Get reputation rank name
   */
  async getReputationRank(score: number): Promise<string> {
    try {
      return await this.reputationContract.getRankName(score);
    } catch (error) {
      console.error("Error fetching rank name:", error);
      return "Unknown";
    }
  }

  /**
   * Submit reputation feedback
   */
  async submitFeedback(
    characterTokenId: bigint,
    category: ReputationCategory,
    delta: number,
    reason: string
  ): Promise<void> {
    const identity = await this.getCharacterIdentity(characterTokenId);
    if (!identity) {
      throw new Error(`No identity found for character ${characterTokenId}`);
    }

    const tx = await this.reputationContract.submitFeedback(
      identity.identityId,
      category,
      delta,
      reason
    );

    await tx.wait();
  }

  /**
   * Batch update reputation (multiple categories at once)
   */
  async batchUpdateReputation(
    characterTokenId: bigint,
    deltas: {
      combat?: number;
      economic?: number;
      social?: number;
      crafting?: number;
      agent?: number;
    },
    reason: string
  ): Promise<void> {
    const identity = await this.getCharacterIdentity(characterTokenId);
    if (!identity) {
      throw new Error(`No identity found for character ${characterTokenId}`);
    }

    // Convert to array format [combat, economic, social, crafting, agent]
    const deltaArray: [number, number, number, number, number] = [
      deltas.combat || 0,
      deltas.economic || 0,
      deltas.social || 0,
      deltas.crafting || 0,
      deltas.agent || 0,
    ];

    const tx = await this.reputationContract.batchUpdateReputation(
      identity.identityId,
      deltaArray,
      reason
    );

    await tx.wait();
  }

  /**
   * Get feedback history for a character
   */
  async getFeedbackHistory(
    characterTokenId: bigint,
    limit: number = 20
  ): Promise<ReputationFeedback[]> {
    const identity = await this.getCharacterIdentity(characterTokenId);
    if (!identity) {
      return [];
    }

    try {
      const feedbackIds = await this.reputationContract.getIdentityFeedback(
        identity.identityId
      );

      const feedbacks: ReputationFeedback[] = [];

      // Get last N feedbacks
      const startIndex = Math.max(0, feedbackIds.length - limit);
      for (let i = feedbackIds.length - 1; i >= startIndex; i--) {
        const feedbackId = feedbackIds[i];
        const feedback = await this.reputationContract.getFeedback(feedbackId);

        feedbacks.push({
          submitter: feedback.submitter,
          identityId: feedback.identityId,
          category: feedback.category as ReputationCategory,
          delta: Number(feedback.delta),
          reason: feedback.reason,
          timestamp: Number(feedback.timestamp),
          validated: feedback.validated,
        });
      }

      return feedbacks;
    } catch (error) {
      console.error("Error fetching feedback history:", error);
      return [];
    }
  }

  /**
   * Update combat reputation based on PvP results
   */
  async updateCombatReputation(
    characterTokenId: bigint,
    won: boolean,
    performanceScore: number // 0-100
  ): Promise<void> {
    let delta = 0;

    if (won) {
      // Winner gets points based on performance
      delta = Math.floor(5 + (performanceScore / 100) * 15); // 5-20 points
    } else {
      // Loser loses fewer points (don't punish too hard)
      delta = Math.floor(-2 - (performanceScore / 100) * 3); // -2 to -5 points
    }

    await this.submitFeedback(
      characterTokenId,
      ReputationCategory.Combat,
      delta,
      won ? `Won PvP battle (performance: ${performanceScore})` : `Lost PvP battle`
    );
  }

  /**
   * Update economic reputation based on trade
   */
  async updateEconomicReputation(
    characterTokenId: bigint,
    tradeCompleted: boolean,
    fairPrice: boolean
  ): Promise<void> {
    let delta = 0;

    if (tradeCompleted && fairPrice) {
      delta = 5; // Fair trade completed
    } else if (tradeCompleted && !fairPrice) {
      delta = 1; // Trade completed but price questionable
    } else {
      delta = -10; // Trade failed/scam
    }

    await this.submitFeedback(
      characterTokenId,
      ReputationCategory.Economic,
      delta,
      tradeCompleted
        ? fairPrice
          ? "Fair trade completed"
          : "Trade completed (price concern)"
        : "Trade failed/cancelled"
    );
  }

  /**
   * Clear identity cache (for testing)
   */
  clearCache(): void {
    this.identityCache.clear();
  }
}

// Global singleton
export const reputationManager = new ReputationManager();
