import { randomUUID } from "crypto";
import { createCustodialWallet } from "./custodialWallet.js";
import { mintCharacter, mintGold, distributeSFuel } from "./blockchain.js";
import { generateAuthToken } from "./auth.js";
import { computeCharacter, validateCharacterInput } from "./characterCreate.js";
import { getOrCreateZone, recalculateEntityVitals, type Entity } from "./zoneRuntime.js";
import { processPayment, getPricingTier, type PaymentMethod } from "./x402Payment.js";
import { saveCharacter } from "./characterStore.js";
import { reputationManager } from "./reputationManager.js";
import { logDiary, narrativeSpawn } from "./diary.js";

export interface DeploymentRequest {
  agentName: string;
  character: {
    name: string;
    race: string;
    class: string;
  };
  payment: PaymentMethod;
  deploymentZone: string;
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
export function checkRateLimit(source: string, tier: string): { allowed: boolean; waitTime?: number } {
  if (tier !== "free") {
    return { allowed: true };
  }

  const lastDeployment = deploymentRateLimit.get(source);
  if (!lastDeployment) {
    return { allowed: true };
  }

  const oneHour = 60 * 60 * 1000;
  const timeSinceLastDeployment = Date.now() - lastDeployment;

  if (timeSinceLastDeployment < oneHour) {
    const waitTime = Math.ceil((oneHour - timeSinceLastDeployment) / 1000 / 60); // minutes
    return { allowed: false, waitTime };
  }

  return { allowed: true };
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

    // 2. Check rate limit (for free tier)
    const tier = request.payment.method === "free" ? "free" : "basic";
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
    console.log(`[x402] ${deploymentId}: Spawning in ${request.deploymentZone}...`);
    const zone = getOrCreateZone(request.deploymentZone);

    const spawnX = 150;
    const spawnY = 150;

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
      level: 1,
      xp: 0,
      raceId: request.character.race,
      classId: request.character.class,
      stats: characterData.stats,
      characterTokenId: BigInt(0),
      kills: 0,
      completedQuests: [],
      learnedTechniques: [],
    };

    recalculateEntityVitals(entity);
    zone.entities.set(entity.id, entity);

    // 8. Save character to persistent store
    await saveCharacter(wallet.address, request.character.name, {
      name: request.character.name,
      level: 1,
      xp: 0,
      raceId: request.character.race,
      classId: request.character.class,
      zone: request.deploymentZone,
      x: spawnX,
      y: spawnY,
      kills: 0,
      completedQuests: [],
      learnedTechniques: [],
      professions: [],
    });

    // 9. Initialize reputation
    reputationManager.ensureInitialized(wallet.address);

    // 10. Log diary entry
    const { headline, narrative } = narrativeSpawn(
      entity.name, entity.raceId, entity.classId, request.deploymentZone, false
    );
    logDiary(wallet.address, entity.name, request.deploymentZone, spawnX, spawnY,
      "spawn", headline, narrative, {
        restored: false,
        level: 1,
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
        mintTxHash = await mintCharacter(wallet.address, nftMetadata);
        console.log(`[x402] ${deploymentId}: NFT minted: ${mintTxHash}`);
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
        zoneId: request.deploymentZone,
        position: { x: spawnX, y: spawnY },
        goldBalance: goldBonus.toString(),
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
