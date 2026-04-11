import type { FastifyInstance } from "fastify";
import { authenticateRequest, requireWalletMatch } from "../auth/auth.js";
import { CLASS_DEFINITIONS } from "./classes.js";
import { RACE_DEFINITIONS } from "./races.js";
import { validateCharacterInput, computeCharacter } from "./characterCreate.js";
import { getAllEntities, isWalletSpawned } from "../world/zoneRuntime.js";
import { loadAllCharactersForWallet, loadCharacter, saveCharacter, type CharacterCalling, type CharacterSaveData } from "./characterStore.js";
import { computeStatsAtLevel } from "./leveling.js";
import { registerWalletWithWelcomeBonus } from "../blockchain/wallet.js";

// ── Random appearance generation for new player characters ──────────
const PLAYER_SKINS   = ["pale", "fair", "light", "medium", "tan", "olive", "brown", "dark"];
const PLAYER_EYES    = ["brown", "blue", "green", "gold", "amber", "gray", "violet"];
const PLAYER_HAIRS   = ["short", "long", "braided", "mohawk", "ponytail", "bald", "topknot", "bangs"];
const PLAYER_GENDERS: ("male" | "female")[] = ["male", "female"];

function nameHash(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = ((h << 5) - h + name.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/** Generate deterministic random appearance from character name */
function randomPlayerAppearance(name: string) {
  const h = nameHash(name);
  return {
    gender:    PLAYER_GENDERS[h % PLAYER_GENDERS.length],
    skinColor: PLAYER_SKINS[(h >>> 3) % PLAYER_SKINS.length],
    eyeColor:  PLAYER_EYES[(h >>> 6) % PLAYER_EYES.length],
    hairStyle: PLAYER_HAIRS[(h >>> 9) % PLAYER_HAIRS.length],
  };
}
import { getAgentCustodialWallet, getAgentEntityRef } from "../agents/agentConfigStore.js";
import { enqueueCharacterBootstrap, loadCharacterBootstrapJob, processCharacterBootstrapJob } from "./characterBootstrap.js";
import { listCharacterProjectionsForWallets, type CharacterProjectionRecord } from "./characterProjectionStore.js";

type CharacterListEntry = {
  tokenId: string;
  characterTokenId?: string | null;
  agentId?: string | null;
  agentRegistrationTxHash?: string | null;
  chainRegistrationStatus?:
    | "unregistered"
    | "pending_mint"
    | "mint_confirmed"
    | "identity_pending"
    | "registered"
    | "failed_retryable"
    | "failed_permanent";
  chainRegistrationLastError?: string | null;
  bootstrapStatus?:
    | "queued"
    | "pending_mint"
    | "mint_confirmed"
    | "identity_pending"
    | "completed"
    | "failed_retryable"
    | "failed_permanent"
    | null;
  name: string;
  description: string;
  properties: {
    race?: string;
    class?: string;
    level?: number;
    xp?: number;
    stats?: unknown;
  };
};

type LiveCharacterEntity = {
  id: string;
  level: number;
  xp: number;
  hp: number;
  maxHp: number;
  zoneId: string;
  region: string;
  name: string;
  agentId: string | null;
  characterTokenId: string | null;
};

function resolveBootstrapChainRegistrationStatus(
  bootstrapStatus: string | null | undefined,
  fallbackStatus: string | null | undefined,
): CharacterListEntry["chainRegistrationStatus"] {
  switch (bootstrapStatus) {
    case "pending_mint":
    case "pending_mint_receipt":
      return "pending_mint";
    case "mint_confirmed":
      return "mint_confirmed";
    case "identity_pending":
      return "identity_pending";
    case "completed":
      return "registered";
    case "failed_retryable":
      return "failed_retryable";
    case "failed_permanent":
      return "failed_permanent";
    default:
      if (fallbackStatus === "pending_mint_receipt") return "pending_mint";
      if (
        fallbackStatus === "unregistered"
        || fallbackStatus === "pending_mint"
        || fallbackStatus === "mint_confirmed"
        || fallbackStatus === "identity_pending"
        || fallbackStatus === "registered"
        || fallbackStatus === "failed_retryable"
        || fallbackStatus === "failed_permanent"
      ) {
        return fallbackStatus;
      }
      return "unregistered";
  }
}

function collapseCharacterName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function stripCharacterClassSuffix(value: string): string {
  return collapseCharacterName(value).replace(/\s+the\s+\w+$/i, "").trim();
}

function normalizeCharacterKey(name: string, classId?: string | null): string {
  return `${stripCharacterClassSuffix(name).toLowerCase()}::${(classId ?? "").trim().toLowerCase()}`;
}

function serializeLiveCharacterEntity(
  entity: {
    id: string;
    level?: number;
    xp?: number;
    hp: number;
    maxHp: number;
    region?: string;
    name: string;
    agentId?: string | number | bigint | null;
    characterTokenId?: string | number | bigint | null;
  },
  fallbackZoneId?: string | null,
): LiveCharacterEntity {
  const zoneId = entity.region ?? fallbackZoneId ?? "unknown";
  const serializeBigNumberish = (value: string | number | bigint | null | undefined): string | null => {
    if (value == null) return null;
    if (typeof value === "bigint") return value.toString();
    if (typeof value === "number") return Number.isFinite(value) ? Math.trunc(value).toString() : null;
    return value;
  };

  return {
    id: entity.id,
    level: entity.level ?? 1,
    xp: entity.xp ?? 0,
    hp: entity.hp,
    maxHp: entity.maxHp,
    zoneId,
    region: zoneId,
    name: entity.name,
    agentId: serializeBigNumberish(entity.agentId),
    characterTokenId: serializeBigNumberish(entity.characterTokenId),
  };
}

function compareCharacterEntries(left: CharacterListEntry, right: CharacterListEntry): number {
  const leftLevel = Number(left.properties.level ?? 1);
  const rightLevel = Number(right.properties.level ?? 1);
  if (leftLevel !== rightLevel) return leftLevel - rightLevel;

  const leftXp = Number(left.properties.xp ?? 0);
  const rightXp = Number(right.properties.xp ?? 0);
  if (leftXp !== rightXp) return leftXp - rightXp;

  const leftToken = /^\d+$/.test(left.tokenId) ? Number(left.tokenId) : Number.POSITIVE_INFINITY;
  const rightToken = /^\d+$/.test(right.tokenId) ? Number(right.tokenId) : Number.POSITIVE_INFINITY;
  if (leftToken !== rightToken) return rightToken - leftToken;

  return 0;
}

function dedupeCharacterEntries(characters: CharacterListEntry[]): CharacterListEntry[] {
  const deduped = new Map<string, CharacterListEntry>();

  for (const character of characters) {
    const key = normalizeCharacterKey(character.name, character.properties.class);
    const existing = deduped.get(key);
    if (!existing || compareCharacterEntries(existing, character) < 0) {
      deduped.set(key, character);
    }
  }

  return Array.from(deduped.values());
}

function buildCharacterEntryFromProjection(
  projection: CharacterProjectionRecord,
  saved: CharacterSaveData | null,
  bootstrapStatus: CharacterListEntry["bootstrapStatus"],
  liveEntity?: LiveCharacterEntity | null
): CharacterListEntry {
  const liveName = liveEntity?.name ? stripCharacterClassSuffix(liveEntity.name) : null;
  const liveMatches = Boolean(
    liveEntity
    && projection.characterTokenId
    && liveEntity.characterTokenId
    && projection.characterTokenId === liveEntity.characterTokenId
    && liveName
    && stripCharacterClassSuffix(projection.characterName).toLowerCase() === liveName.toLowerCase()
  );
  const level = liveMatches ? liveEntity!.level : projection.level;
  const xp = liveMatches ? liveEntity!.xp : projection.xp;
  const classDef = CLASS_DEFINITIONS.find((entry) => entry.id === projection.classId);
  const fullName = classDef ? `${projection.characterName} the ${classDef.name}` : projection.characterName;

  return {
    tokenId: saved?.characterTokenId ?? projection.characterTokenId ?? `projection-${projection.walletAddress}-${projection.normalizedName}-${projection.classId}`,
    characterTokenId: saved?.characterTokenId ?? projection.characterTokenId ?? null,
    agentId: liveMatches ? liveEntity!.agentId : (saved?.agentId ?? projection.agentId),
    agentRegistrationTxHash: saved?.agentRegistrationTxHash ?? projection.agentRegistrationTxHash,
    chainRegistrationStatus: resolveBootstrapChainRegistrationStatus(
      bootstrapStatus,
      saved?.chainRegistrationStatus ?? projection.chainRegistrationStatus,
    ),
    chainRegistrationLastError: saved?.chainRegistrationLastError ?? projection.chainRegistrationLastError,
    bootstrapStatus,
    name: fullName,
    description: `Level ${level} ${projection.raceId} ${projection.classId}`,
    properties: {
      race: projection.raceId,
      class: projection.classId,
      level,
      xp,
      stats: computeStatsAtLevel(projection.raceId, projection.classId, level),
    },
  };
}

async function buildProjectedCharacterEntries(
  ownerWallet: string,
  custodialWallet: string | null,
  liveEntity?: LiveCharacterEntity | null,
): Promise<CharacterListEntry[]> {
  const wallets = [ownerWallet, custodialWallet].filter((wallet): wallet is string => Boolean(wallet));
  const [projectedCharacters, ownerSavedCharacters, custodialSavedCharacters] = await Promise.all([
    listCharacterProjectionsForWallets(wallets).catch(() => []),
    loadAllCharactersForWallet(ownerWallet).catch(() => []),
    custodialWallet ? loadAllCharactersForWallet(custodialWallet).catch(() => []) : Promise.resolve([]),
  ]);

  const savedByKey = new Map<string, { walletAddress: string; saved: CharacterSaveData }>();
  const rememberSaved = (walletAddress: string, saved: CharacterSaveData) => {
    savedByKey.set(`${walletAddress.toLowerCase()}::${normalizeCharacterKey(saved.name, saved.classId)}`, { walletAddress, saved });
  };
  for (const saved of ownerSavedCharacters) rememberSaved(ownerWallet, saved);
  for (const saved of custodialSavedCharacters) rememberSaved(custodialWallet ?? ownerWallet, saved);

  const projectedEntries = await Promise.all(
    projectedCharacters.map(async (projection) => {
      const savedMatch = savedByKey.get(
        `${projection.walletAddress.toLowerCase()}::${normalizeCharacterKey(projection.characterName, projection.classId)}`
      ) ?? null;
      const job = await loadCharacterBootstrapJob(projection.walletAddress, projection.characterName).catch(() => null);
      const bootstrapStatus = (job?.status ?? null) as CharacterListEntry["bootstrapStatus"];
      return buildCharacterEntryFromProjection(projection, savedMatch?.saved ?? null, bootstrapStatus, liveEntity);
    }),
  );

  const projectionKeys = new Set(
    projectedCharacters.map((projection) => `${projection.walletAddress.toLowerCase()}::${normalizeCharacterKey(projection.characterName, projection.classId)}`),
  );
  const savedOnlyEntries = await Promise.all(
    Array.from(savedByKey.entries())
      .filter(([key]) => !projectionKeys.has(key))
      .map(async ([, savedMatch]) => {
        const { walletAddress: savedWallet, saved } = savedMatch;
        const classDef = CLASS_DEFINITIONS.find((entry) => entry.id === saved.classId);
        const fullName = classDef ? `${saved.name} the ${classDef.name}` : saved.name;
        const job = await loadCharacterBootstrapJob(savedWallet, saved.name).catch(() => null);
        const bootstrapStatus = (job?.status ?? null) as CharacterListEntry["bootstrapStatus"];
        return {
          tokenId: saved.characterTokenId ?? `saved-${savedWallet.toLowerCase()}-${normalizeCharacterKey(saved.name, saved.classId)}`,
          characterTokenId: saved.characterTokenId ?? null,
          agentId: saved.agentId ?? null,
          agentRegistrationTxHash: saved.agentRegistrationTxHash ?? null,
          chainRegistrationStatus: resolveBootstrapChainRegistrationStatus(bootstrapStatus, saved.chainRegistrationStatus),
          chainRegistrationLastError: saved.chainRegistrationLastError ?? null,
          bootstrapStatus,
          name: fullName,
          description: `Level ${saved.level} ${saved.raceId} ${saved.classId}`,
          properties: {
            race: saved.raceId,
            class: saved.classId,
            level: saved.level,
            xp: saved.xp,
            stats: computeStatsAtLevel(saved.raceId, saved.classId, saved.level),
          },
        } satisfies CharacterListEntry;
      }),
  );

  return dedupeCharacterEntries([...projectedEntries, ...savedOnlyEntries]);
}

async function resolveSavedCharacter(
  ownerWallet: string,
  custodialWallet: string | null,
  characterName: string,
): Promise<{ saved: Awaited<ReturnType<typeof loadCharacter>>; savedWallet: string | null }> {
  const ownerSaved = await loadCharacter(ownerWallet, characterName);
  if (ownerSaved) {
    return { saved: ownerSaved, savedWallet: ownerWallet };
  }

  if (custodialWallet) {
    const custodialSaved = await loadCharacter(custodialWallet, characterName);
    if (custodialSaved) {
      return { saved: custodialSaved, savedWallet: custodialWallet };
    }
  }

  return { saved: null, savedWallet: null };
}

export function registerCharacterRoutes(server: FastifyInstance) {
  /**
   * GET /character/classes
   * Returns all 8 classes with their base stats.
   */
  server.get("/character/classes", async () => {
    return CLASS_DEFINITIONS.map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      baseStats: c.baseStats,
    }));
  });

  /**
   * GET /character/races
   * Returns all 4 races with their stat modifiers.
   */
  server.get("/character/races", async () => {
    return RACE_DEFINITIONS.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      statModifiers: r.statModifiers,
    }));
  });

  /**
   * GET /character/callings
   * Returns the 4 callings with descriptions.
   */
  server.get("/character/callings", async () => {
    return [
      { id: "adventurer", name: "Adventurer", description: "Called to fight and slay monsters, explore dungeons, and compete in coliseums" },
      { id: "farmer", name: "Farmer", description: "Cultivates land, prepares food and drinks, designs homes and builds communities" },
      { id: "merchant", name: "Merchant", description: "A trader who handles guild DAOs, runs auctions, and amasses wealth" },
      { id: "craftsman", name: "Craftsman", description: "Enchants weapons, smelts ore, crafts jewelry, and designs gear" },
    ];
  });

  /**
   * POST /character/create
   * { walletAddress, name, race, className, calling?, tier?, paymentProof? } → mint ERC-721 NFT with computed stats
   *
   * Paid tiers (starter/pro) require a paymentProof.transactionHash.
   */
  server.post<{
    Body: {
      walletAddress: string;
      characterName: string;
      characterTokenId?: string;
      raceId?: string;
      classId?: string;
    };
  }>("/character/register", {
    preHandler: authenticateRequest,
  }, async (request, reply) => {
    const authenticatedWallet = (request as any).walletAddress as string;
    const {
      walletAddress,
      characterName,
      characterTokenId,
      raceId,
      classId,
    } = request.body;

    if (!requireWalletMatch(reply, authenticatedWallet, walletAddress, "Not authorized to register a character for this wallet")) {
      return;
    }

    const rawName = stripCharacterClassSuffix(characterName);
    if (!rawName) {
      reply.code(400);
      return { error: "characterName is required" };
    }

    try {
      const custodialWallet = await getAgentCustodialWallet(walletAddress);
      let targetWallet = walletAddress;
      let { saved, savedWallet } = await resolveSavedCharacter(walletAddress, custodialWallet, rawName);

      if (!saved) {
        if (!raceId || !classId) {
          reply.code(400);
          return { error: "raceId and classId are required when the character has no saved registration state" };
        }
        targetWallet = custodialWallet ?? walletAddress;
        const appearance = randomPlayerAppearance(rawName);
        await saveCharacter(targetWallet, rawName, {
          name: rawName,
          level: 1,
          xp: 0,
          ...(characterTokenId ? { characterTokenId } : {}),
          chainRegistrationStatus: characterTokenId ? "mint_confirmed" : "unregistered",
          raceId,
          classId,
          gender: appearance.gender,
          skinColor: appearance.skinColor,
          eyeColor: appearance.eyeColor,
          hairStyle: appearance.hairStyle,
          zone: "village-square",
          x: 0,
          y: 0,
          kills: 0,
          completedQuests: [],
          storyFlags: [],
          learnedTechniques: [],
          professions: [],
        });
        saved = await loadCharacter(targetWallet, rawName);
        savedWallet = targetWallet;
      } else if (savedWallet) {
        targetWallet = savedWallet;
      }

      if (!saved) {
        reply.code(404);
        return { error: "Character save not found" };
      }

      if (saved.agentId) {
        return reply.send({
          ok: true,
          alreadyRegistered: true,
          bootstrap: { status: "completed", chainRegistrationStatus: "registered" },
        });
      }

      const existingJob = await loadCharacterBootstrapJob(targetWallet, rawName);
      const hasActiveJob = existingJob != null
        && !["completed", "failed_retryable", "failed_permanent"].includes(existingJob.status);

      if (hasActiveJob) {
        return reply.send({
          ok: true,
          alreadyQueued: true,
          bootstrap: {
            status: existingJob.status,
            chainRegistrationStatus: resolveBootstrapChainRegistrationStatus(
              existingJob.status,
              saved.chainRegistrationStatus ?? "unregistered",
            ),
          },
        });
      }

      const job = await enqueueCharacterBootstrap(targetWallet, rawName, "character:manual-register", ["wog:a2a-enabled"]);
      void processCharacterBootstrapJob(targetWallet, rawName, server.log);

      return reply.send({
        ok: true,
        bootstrap: {
          status: job.status,
          chainRegistrationStatus: resolveBootstrapChainRegistrationStatus(
            job.status,
            saved.characterTokenId ? "mint_confirmed" : (saved.chainRegistrationStatus ?? "unregistered"),
          ),
        },
      });
    } catch (err) {
      server.log.error(err, `Character manual registration failed for ${walletAddress}:${rawName}`);
      reply.code(500);
      return { error: "Failed to queue character registration" };
    }
  });

  server.post<{
    Body: {
      walletAddress: string;
      name: string;
      race: string;
      className: string;
      calling?: CharacterCalling;
      gender?: "male" | "female";
      skinColor?: string;
      hairStyle?: string;
      eyeColor?: string;
      origin?: string;
      tier?: string;
      paymentProof?: { transactionHash: string };
    };
  }>("/character/create", {
    preHandler: authenticateRequest,
  }, async (request, reply) => {
    const authenticatedWallet = (request as any).walletAddress as string;
    const { walletAddress, name, race, className, calling, gender, skinColor, hairStyle, eyeColor, origin } = request.body;

    if (!requireWalletMatch(reply, authenticatedWallet, walletAddress, "Not authorized to create a character for this wallet")) {
      return;
    }

    // Validate calling if provided
    const validCallings: CharacterCalling[] = ["adventurer", "farmer", "merchant", "craftsman"];
    if (calling && !validCallings.includes(calling)) {
      reply.code(400);
      return { error: `Invalid calling: ${calling}. Must be one of: ${validCallings.join(", ")}` };
    }

    const error = validateCharacterInput({ walletAddress, name, race, className });
    if (error) {
      reply.code(400);
      return { error };
    }

    // Payment gate for paid tiers
    const tier = request.body.tier ?? "free";
    if (tier === "starter" || tier === "pro") {
      if (!request.body.paymentProof?.transactionHash) {
        const pricing: Record<string, { usd: number; description: string }> = {
          starter: { usd: 4.99, description: "Starter tier — AI supervisor, 12h sessions, all zones" },
          pro:     { usd: 9.99, description: "Pro tier — 24/7 sessions, market trading, full access" },
        };
        reply.code(402);
        return {
          error: "Payment required for this tier",
          tier,
          pricing: pricing[tier],
          paymentInfo: {
            chainId: 8453,
            currency: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
            note: "Pay with USDC on Base. Include paymentProof.transactionHash after payment.",
          },
        };
      }
      // TODO: verify paymentProof.transactionHash on-chain
    }

    const character = computeCharacter(name, race, className);
    const existingSave = await loadCharacter(walletAddress, character.name);

    const callingLabel = calling ? calling.charAt(0).toUpperCase() + calling.slice(1) : null;
    const metadata = {
      name: `${character.name} the ${character.class.name}`,
      description: `Level ${character.level} ${character.race.name} ${character.class.name}${callingLabel ? ` (${callingLabel})` : ""}`,
      properties: {
        race: character.race.id,
        class: character.class.id,
        ...(calling && { calling }),
        level: character.level,
        xp: 0,
        stats: character.stats,
      },
    };

    try {
      // Queue wallet onboarding, but don't block character creation on treasury setup.
      void registerWalletWithWelcomeBonus(server, walletAddress).catch((err) => {
        server.log.warn(
          `[character] Wallet onboarding queue failed for ${walletAddress}: ${String((err as Error)?.message ?? err).slice(0, 160)}`
        );
      });

      // Seed character store so level/xp are always in Redis from the start.
      // IMPORTANT: Only seed if no existing save exists — never overwrite progress.
      if (!existingSave) {
        await saveCharacter(walletAddress, character.name, {
          name: character.name,
          level: 1,
          xp: 0,
          chainRegistrationStatus: "unregistered",
          raceId: character.race.id,
          classId: character.class.id,
          calling,
          gender,
          skinColor,
          hairStyle,
          eyeColor,
          origin,
          zone: "village-square",
          x: 0,
          y: 0,
          kills: 0,
          completedQuests: [],
          learnedTechniques: [],
          professions: [],
        });
      } else {
        await saveCharacter(walletAddress, character.name, {
          ...(calling !== undefined && { calling }),
          ...(gender !== undefined && { gender }),
          ...(skinColor !== undefined && { skinColor }),
          ...(hairStyle !== undefined && { hairStyle }),
          ...(eyeColor !== undefined && { eyeColor }),
          ...(origin !== undefined && { origin }),
        });
        server.log.info(`[character] Existing save found for "${character.name}" (L${existingSave.level}) — skipping seed`);
      }

      const needsCharacterMint = !existingSave?.characterTokenId;
      const needsIdentityRegistration = !existingSave?.agentId;
      let bootstrapStatus = "completed";
      let chainRegistrationStatus: CharacterListEntry["chainRegistrationStatus"] = existingSave?.chainRegistrationStatus === "pending_mint_receipt"
        ? "pending_mint"
        : existingSave?.chainRegistrationStatus ?? (
        existingSave?.characterTokenId && existingSave?.agentId ? "registered" : "unregistered"
      );

      if (!existingSave || needsCharacterMint || needsIdentityRegistration) {
        const job = await enqueueCharacterBootstrap(walletAddress, character.name, "character:create", ["wog:a2a-enabled"]);
        bootstrapStatus = job.status;
        chainRegistrationStatus = resolveBootstrapChainRegistrationStatus(
          job.status,
          existingSave?.chainRegistrationStatus ?? "unregistered",
        );
        void processCharacterBootstrapJob(walletAddress, character.name, server.log);
      } else {
        server.log.info(`[character] Existing character "${character.name}" on ${walletAddress} already has NFT + ERC-8004 identity`);
      }

      const responseLevel = existingSave?.level ?? character.level;
      const responseXp = existingSave?.xp ?? 0;
      const responseStats = computeStatsAtLevel(
        existingSave?.raceId ?? character.race.id,
        existingSave?.classId ?? character.class.id,
        responseLevel
      );

      return {
        ok: true,
        existing: Boolean(existingSave),
        walletRegistration: {
          ok: true,
          message: "Wallet registration queued asynchronously",
        },
        character: {
          name: metadata.name,
          description: metadata.description,
          race: existingSave?.raceId ?? character.race.id,
          class: existingSave?.classId ?? character.class.id,
          level: responseLevel,
          xp: responseXp,
          stats: responseStats,
        },
        bootstrap: {
          status: bootstrapStatus,
          sourceOfTruth: "blockchain-eventual",
          chainRegistrationStatus,
        },
      };
    } catch (err) {
      server.log.error(err, `Character creation failed for ${walletAddress}`);
      reply.code(500);
      return { error: "Character creation failed" };
    }
  });

  /**
   * GET /character/:walletAddress
   * Returns all character NFTs owned by the given wallet address.
   */
  server.get<{ Params: { walletAddress: string } }>(
    "/character/:walletAddress",
    async (request, reply) => {
      const { walletAddress } = request.params;

      if (!/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
        reply.code(400);
        return { error: "Invalid wallet address" };
      }

      try {
        // Find live entity for this wallet across all entities
        // Check both the owner wallet and its custodial wallet (agent system)
        const normalizedWallet = walletAddress.toLowerCase();
        const custodialWallet = (await getAgentCustodialWallet(walletAddress))?.toLowerCase() ?? null;
        const agentRef = await getAgentEntityRef(walletAddress);
        let liveEntity: LiveCharacterEntity | null = null;
        if (agentRef?.entityId) {
          const entity = getAllEntities().get(agentRef.entityId);
          if (entity?.type === "player") {
            const ew = entity.walletAddress?.toLowerCase();
            if (ew === normalizedWallet || ew === custodialWallet) {
              liveEntity = serializeLiveCharacterEntity({
                ...entity,
                agentId: entity.agentId ?? agentRef.agentId ?? null,
                characterTokenId: entity.characterTokenId ?? agentRef.characterTokenId ?? null,
              }, agentRef.zoneId);
            }
          }
        }
        if (!liveEntity) {
          for (const candidateWallet of [normalizedWallet, custodialWallet].filter((value): value is string => Boolean(value))) {
            const spawned = isWalletSpawned(candidateWallet);
            if (!spawned) continue;
            const entity = getAllEntities().get(spawned.entityId);
            if (!entity || entity.type !== "player") continue;
            liveEntity = serializeLiveCharacterEntity(entity, spawned.zoneId);
            break;
          }
        }
        if (!liveEntity) {
          const liveWorldEntity = Array.from(getAllEntities().values()).find((entity) => {
            if (entity.type !== "player" || !entity.walletAddress) return false;
            const entityWallet = entity.walletAddress.toLowerCase();
            return entityWallet === normalizedWallet || entityWallet === custodialWallet;
          });
          if (liveWorldEntity) {
            liveEntity = serializeLiveCharacterEntity(liveWorldEntity, liveWorldEntity.region ?? null);
          }
        }
        const deployedCharacterName = liveEntity
          ? liveEntity.name.replace(/\s+the\s+\w+$/i, "").trim()
          : null;

        return {
          walletAddress,
          liveEntity,
          deployedCharacterName,
          characters: await buildProjectedCharacterEntries(walletAddress, custodialWallet, liveEntity),
          sourceOfTruth: "postgres-projection",
        };
      } catch (err) {
        server.log.error(err, `Failed to fetch characters for ${walletAddress}`);
        reply.code(500);
        return { error: "Failed to fetch characters" };
      }
    }
  );
}
