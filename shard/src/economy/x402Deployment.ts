import { randomUUID } from "crypto";
import { createCustodialWallet } from "../blockchain/custodialWallet.js";
import { mintCharacterWithIdentity, mintGold, distributeSFuel } from "../blockchain/blockchain.js";
import { generateAuthToken } from "../auth/auth.js";
import { computeCharacter, validateCharacterInput } from "../character/characterCreate.js";
import { getOrCreateZone, recalculateEntityVitals, isWalletSpawned, registerSpawnedWallet, type Entity } from "../world/zoneRuntime.js";
import { processPayment, getPricingTier, type PaymentMethod } from "./x402Payment.js";
import { saveCharacter, loadCharacter } from "../character/characterStore.js";
import { reputationManager } from "./reputationManager.js";
import { logDiary, narrativeSpawn } from "../social/diary.js";

export interface DeploymentRequest {
  agentName: string;
  character: {
    name: string;
    race: string;
    class: string;
    skinColor?: string;
    hairStyle?: string;
    eyeColor?: string;
  };
  payment: PaymentMethod;
  deploymentZone?: string;
  deployment_zone?: string;
  metadata?: {
    source?: string;
    version?: string;
    [key: string]: any;
  };
}

export interface DeploymentResponse {
  success: boolean;
  deploymentId: string;
  credentials: {
    walletAddress: string;
    jwtToken: string;
    expiresIn: string;
  };
  character: {
    nftTokenId: string;
    txHash: string;
    name: string;
    race: string;
    class: string;
    level: number;
    stats: any;
  };
  gameState: {
    entityId: string;
    zoneId: string;
    position: { x: number; y: number };
    goldBalance: string;
  };
  a2a: {
    endpoint: string;
    agentCard: string;
    inbox: string;
    protocol: string;
    chainId: number;
  };
  apiDocs: string;
  quickStart: {
    move: string;
    attack: string;
    inventory: string;
  };
}

export interface DeploymentError {
  success: false;
  error: string;
  message: string;
  retry: boolean;
}

/**
 * Rate limiting storage (in-memory)
 * Format: Map<sourceIdentifier, lastDeploymentTimestamp>
 */
const deploymentRateLimit = new Map<string, number>();

/**
 * Check if source is rate-limited (free tier only)
 */
export function checkRateLimit(_source: string, _tier: string): { allowed: boolean; waitTime?: number } {
  const source = _source.trim().toLowerCase();
  const tier = _tier.trim().toLowerCase();
  if (!source || tier !== "free") {
    return { allowed: true };
  }

  const lastDeploymentAt = deploymentRateLimit.get(source);
  if (!lastDeploymentAt) {
    return { allowed: true };
  }

  const elapsedMs = Date.now() - lastDeploymentAt;
  const windowMs = 60 * 60 * 1000;
  if (elapsedMs >= windowMs) {
    return { allowed: true };
  }

  return {
    allowed: false,
    waitTime: Math.ceil((windowMs - elapsedMs) / 60000),
  };
}

/**
 * Record deployment for rate limiting
 */
function recordDeployment(source: string): void {
  deploymentRateLimit.set(source, Date.now());
}

/**
 * Atomic agent deployment - combines all steps into one transaction
 */
export async function deployAgent(request: DeploymentRequest): Promise<DeploymentResponse | DeploymentError> {
  const deploymentId = randomUUID();
  const startTime = Date.now();
  // Accept both camelCase and snake_case for deployment zone
  const deploymentZone = request.deploymentZone || request.deployment_zone || "";

  try {
    // 1. Validate character input
    const validation = validateCharacterInput({
      walletAddress: "0x0000000000000000000000000000000000000000", // Temp placeholder for validation
      name: request.character.name,
      race: request.character.race,
      className: request.character.class,
    });

    if (validation !== null) {
      return {
        success: false,
        error: "validation_failed",
        message: validation,
        retry: false,
      };
    }

    // Validate deployment zone
    if (!deploymentZone) {
      return {
        success: false,
        error: "missing_fields",
        message: "deploymentZone (or deployment_zone) is required",
        retry: false,
      };
    }

    // 2. Check rate limit (for free tier)
    const tier = request.payment.method === "free" ? "free" : "starter";
    const source = request.metadata?.source || "unknown";
    const rateLimitCheck = checkRateLimit(source, tier);

    if (!rateLimitCheck.allowed) {
      return {
        success: false,
        error: "rate_limit_exceeded",
        message: `Free tier allows 1 deployment per hour. Please wait ${rateLimitCheck.waitTime} minutes.`,
        retry: true,
      };
    }

    // 3. Process payment
    const paymentResult = await processPayment(request.payment);
    if (!paymentResult.success) {
      return {
        success: false,
        error: "payment_failed",
        message: paymentResult.error || "Payment processing failed",
        retry: true,
      };
    }

    // 4. Create custodial wallet
    console.log(`[x402] ${deploymentId}: Creating custodial wallet...`);
    const wallet = createCustodialWallet();

    // 5. Compute character stats
    const characterData = computeCharacter(
      request.character.name,
      request.character.race,
      request.character.class
    );

    // 6. Generate JWT token (no blockchain dependency)
    const jwtToken = generateAuthToken(wallet.address);

    // 7. Spawn entity in game world FIRST (no blockchain needed)
    console.log(`[x402] ${deploymentId}: Spawning in ${deploymentZone}...`);
    const zone = getOrCreateZone(deploymentZone);

    const spawnX = 150;
    const spawnY = 150;

    // Restore from existing save if the wallet has prior progress
    const existingSave = await loadCharacter(wallet.address, request.character.name);

    const entity: Entity = {
      id: randomUUID(),
      type: "player",
      name: request.character.name,
      x: spawnX,
      y: spawnY,
      hp: characterData.stats.hp,
      maxHp: characterData.stats.hp,
      essence: characterData.stats.essence,
      maxEssence: characterData.stats.essence,
      createdAt: Date.now(),
      walletAddress: wallet.address,
      level: existingSave?.level ?? 1,
      xp: existingSave?.xp ?? 0,
      ...(existingSave?.characterTokenId && { characterTokenId: BigInt(existingSave.characterTokenId) }),
      ...(existingSave?.agentId && { agentId: BigInt(existingSave.agentId) }),
      raceId: request.character.race,
      classId: request.character.class,
      stats: characterData.stats,
      kills: existingSave?.kills ?? 0,
      completedQuests: existingSave?.completedQuests ?? [],
      learnedTechniques: existingSave?.learnedTechniques ?? [],
      ...(request.character.skinColor != null && { skinColor: request.character.skinColor }),
      ...(request.character.hairStyle != null && { hairStyle: request.character.hairStyle }),
      ...(request.character.eyeColor != null && { eyeColor: request.character.eyeColor }),
    };

    recalculateEntityVitals(entity);

    // Enforce one player per wallet across the shard
    const existingSpawn = isWalletSpawned(wallet.address);
    if (existingSpawn) {
      return {
        success: false,
        error: "duplicate_wallet",
        message: "Wallet already has a live character on this shard",
        retry: false,
      };
    }

    zone.entities.set(entity.id, entity);
    registerSpawnedWallet(wallet.address, entity.id, deploymentZone);

    // 8. Save character to persistent store (preserve existing progress if found)
    await saveCharacter(wallet.address, request.character.name, {
      name: request.character.name,
      level: existingSave?.level ?? 1,
      xp: existingSave?.xp ?? 0,
      raceId: request.character.race,
      classId: request.character.class,
      skinColor: request.character.skinColor,
      hairStyle: request.character.hairStyle,
      eyeColor: request.character.eyeColor,
      zone: deploymentZone,
      x: spawnX,
      y: spawnY,
      kills: existingSave?.kills ?? 0,
      completedQuests: existingSave?.completedQuests ?? [],
      learnedTechniques: existingSave?.learnedTechniques ?? [],
      professions: existingSave?.professions ?? [],
    });

    // 9. Initialize reputation if the character already has an ERC-8004 identity
    if (entity.agentId != null) {
      reputationManager.ensureInitialized(entity.agentId);
    }

    // 10. Log diary entry
    const isRestored = !!existingSave;
    const { headline, narrative } = narrativeSpawn(
      entity.name, entity.raceId, entity.classId, deploymentZone, isRestored
    );
    logDiary(wallet.address, entity.name, deploymentZone, spawnX, spawnY,
      "spawn", headline, narrative, {
        restored: isRestored,
        level: entity.level,
        raceId: entity.raceId,
        classId: entity.classId,
      });

    // 11. Record deployment for rate limiting
    recordDeployment(source);

    // 12. Fire blockchain calls (non-blocking — agent is already in-world)
    const pricingTier = getPricingTier(request.payment.method);
    const goldBonus = pricingTier.goldBonus;
    let mintTxHash = "pending";
    let goldTxHash = "pending";
    let sfuelTxHash = "pending";

    // Run blockchain operations in background — don't block the response
    (async () => {
      try {
        console.log(`[x402] ${deploymentId}: Minting character NFT...`);
        const nftMetadata = {
          name: `${characterData.name} the ${characterData.class.name}`,
          description: `Level 1 ${characterData.race.name} ${characterData.class.name}`,
          properties: {
            race: characterData.race.id,
            class: characterData.class.id,
            level: 1,
            xp: 0,
            stats: characterData.stats,
          },
        };
        const mintResult = await mintCharacterWithIdentity(wallet.address, nftMetadata, [
          "wog:a2a-enabled",
          "wog:x402-enabled",
        ]);
        mintTxHash = mintResult.txHash;
        if (mintResult.tokenId != null) {
          entity.characterTokenId = mintResult.tokenId;
        }
        if (mintResult.identity?.agentId != null) {
          entity.agentId = mintResult.identity.agentId;
        }
        await saveCharacter(wallet.address, request.character.name, {
          ...(mintResult.tokenId != null && { characterTokenId: mintResult.tokenId.toString() }),
          ...(mintResult.identity?.agentId != null && { agentId: mintResult.identity.agentId.toString() }),
        });
        if (mintResult.identity?.agentId != null) {
          reputationManager.ensureInitialized(mintResult.identity.agentId);
        }
        console.log(
          `[x402] ${deploymentId}: NFT minted: ${mintTxHash}${mintResult.identity?.agentId != null ? ` agentId=${mintResult.identity.agentId}` : ""}`
        );
      } catch (err) {
        console.error(`[x402] ${deploymentId}: NFT mint failed (non-fatal):`, err instanceof Error ? err.message : err);
      }

      try {
        console.log(`[x402] ${deploymentId}: Distributing ${goldBonus} gold...`);
        goldTxHash = await mintGold(wallet.address, goldBonus.toString());
        console.log(`[x402] ${deploymentId}: Gold distributed: ${goldTxHash}`);
      } catch (err) {
        console.error(`[x402] ${deploymentId}: Gold mint failed (non-fatal):`, err instanceof Error ? err.message : err);
      }

      try {
        console.log(`[x402] ${deploymentId}: Distributing sFUEL...`);
        sfuelTxHash = await distributeSFuel(wallet.address);
        console.log(`[x402] ${deploymentId}: sFUEL distributed: ${sfuelTxHash}`);
      } catch (err) {
        console.error(`[x402] ${deploymentId}: sFUEL failed (non-fatal):`, err instanceof Error ? err.message : err);
      }
    })();

    // 13. Return response immediately — agent is live
    const duration = Date.now() - startTime;
    console.log(`[x402] ${deploymentId}: Deployment complete in ${duration}ms`);

    const shardBase = process.env.WOG_SHARD_URL || "https://wog.urbantech.dev";

    return {
      success: true,
      deploymentId,
      credentials: {
        walletAddress: wallet.address,
        jwtToken,
        expiresIn: "24h",
      },
      character: {
        nftTokenId: "pending",
        txHash: mintTxHash,
        name: request.character.name,
        race: request.character.race,
        class: request.character.class,
        level: 1,
        stats: characterData.stats,
      },
      gameState: {
        entityId: entity.id,
        zoneId: deploymentZone,
        position: { x: spawnX, y: spawnY },
        goldBalance: goldBonus.toString(),
      },
      a2a: {
        endpoint: `${shardBase}/a2a/${wallet.address}`,
        agentCard: `${shardBase}/a2a/${wallet.address}`,
        inbox: `${shardBase}/inbox/${wallet.address}`,
        protocol: "ERC-8004",
        chainId: 103698795,
      },
      apiDocs: "https://github.com/yourusername/wog-mmorpg/blob/master/docs/API.md",
      quickStart: {
        move: "POST /command { entityId, action: 'move', x, y }",
        attack: "POST /command { entityId, action: 'attack', targetId }",
        inventory: `GET /inventory/${wallet.address}`,
      },
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : JSON.stringify(err);
    const errorStack = err instanceof Error ? err.stack : undefined;
    console.error(`[x402] ${deploymentId}: Deployment failed`);
    console.error(`[x402] ${deploymentId}: Error:`, errorMessage);
    if (errorStack) {
      console.error(`[x402] ${deploymentId}: Stack:`, errorStack);
    }
    return {
      success: false,
      error: "deployment_failed",
      message: errorMessage,
      retry: true,
    };
  }
}
