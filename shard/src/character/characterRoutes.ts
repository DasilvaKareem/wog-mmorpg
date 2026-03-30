import type { FastifyInstance } from "fastify";
import { authenticateRequest, requireWalletMatch } from "../auth/auth.js";
import { CLASS_DEFINITIONS } from "./classes.js";
import { RACE_DEFINITIONS } from "./races.js";
import { validateCharacterInput, computeCharacter } from "./characterCreate.js";
import { getOwnedCharacters } from "../blockchain/blockchain.js";
import { getAllEntities } from "../world/zoneRuntime.js";
import { loadCharacter, saveCharacter, loadAllCharactersForWallet, type CharacterCalling } from "./characterStore.js";
import { computeStatsAtLevel } from "./leveling.js";
import { registerWalletWithWelcomeBonus } from "../blockchain/wallet.js";
import { getAgentCustodialWallet, getAgentEntityRef } from "../agents/agentConfigStore.js";
import { enqueueCharacterBootstrap, loadCharacterBootstrapJob, processCharacterBootstrapJob } from "./characterBootstrap.js";

type CharacterListEntry = {
  tokenId: string;
  characterTokenId?: string | null;
  agentId?: string | null;
  chainRegistrationStatus?:
    | "unregistered"
    | "pending_mint"
    | "mint_confirmed"
    | "identity_pending"
    | "registered"
    | "failed_retryable"
    | "failed_permanent";
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

function collapseCharacterName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function stripCharacterClassSuffix(value: string): string {
  return collapseCharacterName(value).replace(/\s+the\s+\w+$/i, "").trim();
}

function normalizeCharacterKey(name: string, classId?: string | null): string {
  return `${stripCharacterClassSuffix(name).toLowerCase()}::${(classId ?? "").trim().toLowerCase()}`;
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
        await saveCharacter(targetWallet, rawName, {
          name: rawName,
          level: 1,
          xp: 0,
          ...(characterTokenId ? { characterTokenId } : {}),
          chainRegistrationStatus: characterTokenId ? "mint_confirmed" : "unregistered",
          raceId,
          classId,
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
            chainRegistrationStatus: saved.chainRegistrationStatus ?? "unregistered",
          },
        });
      }

      const job = await enqueueCharacterBootstrap(targetWallet, rawName, "character:manual-register", ["wog:a2a-enabled"]);
      void processCharacterBootstrapJob(targetWallet, rawName, server.log);

      return reply.send({
        ok: true,
        bootstrap: {
          status: job.status,
          chainRegistrationStatus: saved.characterTokenId ? "mint_confirmed" : "unregistered",
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
      // Guarantee onboarding grant is applied even if client skipped /wallet/register.
      const registration = await registerWalletWithWelcomeBonus(server, walletAddress);

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
      let chainRegistrationStatus = existingSave?.chainRegistrationStatus ?? (
        existingSave?.characterTokenId && existingSave?.agentId ? "registered" : "unregistered"
      );

      if (!existingSave || needsCharacterMint || needsIdentityRegistration) {
        const job = await enqueueCharacterBootstrap(walletAddress, character.name, "character:create", ["wog:a2a-enabled"]);
        bootstrapStatus = job.status;
        chainRegistrationStatus =
          job.status === "completed"
            ? "registered"
            : job.status === "queued"
              ? "unregistered"
              : job.status;
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
        walletRegistration: registration,
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
        const deployedCharacterName = agentRef?.characterName ?? null;
        let liveEntity: {
          level: number;
          xp: number;
          hp: number;
          maxHp: number;
          zoneId: string;
          name: string;
          agentId: string | null;
          characterTokenId: string | null;
        } | null = null;
        for (const entity of getAllEntities().values()) {
          if (entity.type !== "player") continue;
          const ew = entity.walletAddress?.toLowerCase();
          if (ew !== normalizedWallet && ew !== custodialWallet) continue;
          liveEntity = {
            level: entity.level ?? 1,
            xp: entity.xp ?? 0,
            hp: entity.hp,
            maxHp: entity.maxHp,
            zoneId: entity.region ?? "unknown",
            name: entity.name,
            agentId: entity.agentId != null ? String(entity.agentId) : null,
            characterTokenId: entity.characterTokenId != null ? entity.characterTokenId.toString() : null,
          };
          break;
        }

        // Try on-chain NFT enumeration first (10s timeout to avoid Cloudflare 524s)
        // Query both the owner wallet and the custodial wallet (characters are minted to custodial)
        let nfts: Awaited<ReturnType<typeof getOwnedCharacters>> = [];
        try {
          const lookups: Promise<Awaited<ReturnType<typeof getOwnedCharacters>>>[] = [
            getOwnedCharacters(walletAddress),
          ];
          if (custodialWallet && custodialWallet !== normalizedWallet) {
            lookups.push(getOwnedCharacters(custodialWallet));
          }
          const results = await Promise.race([
            Promise.all(lookups),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error("NFT lookup timed out (10s)")), 10_000)
            ),
          ]);
          // Merge and deduplicate by tokenId
          const seen = new Set<string>();
          for (const list of results) {
            for (const nft of list) {
              const id = nft.id.toString();
              if (!seen.has(id)) {
                seen.add(id);
                nfts.push(nft);
              }
            }
          }
        } catch (nftErr) {
          server.log.warn(`[characters] getOwnedNFTs failed for ${walletAddress}, falling back to Redis: ${(nftErr as Error).message}`);
        }

        // If on-chain returned results, use the NFT-based flow
        if (nfts.length > 0) {
          const characters = await Promise.all(
            nfts.map(async (nft) => {
              const props = nft.metadata.properties as Record<string, unknown> | undefined;
              const nftName = (nft.metadata.name as string) ?? "";
              const strippedName = nftName.replace(/\s+the\s+\w+$/i, "").trim();
              const baseName = strippedName || nftName;

              let saved = null;
              let savedWallet: string | null = null;
              let bootstrapJob = null;
              if (baseName) {
                try {
                  ({ saved, savedWallet } = await resolveSavedCharacter(walletAddress, custodialWallet, baseName));
                  if (saved) {
                    bootstrapJob = await loadCharacterBootstrapJob(savedWallet ?? walletAddress, baseName);
                  }
                } catch {
                  saved = null;
                  savedWallet = null;
                  bootstrapJob = null;
                }
              }

              if (liveEntity && baseName && nftName.startsWith(liveEntity.name)) {
                return {
                  tokenId: nft.id.toString(),
                  characterTokenId: nft.id.toString(),
                  agentId: liveEntity.agentId,
                  chainRegistrationStatus: liveEntity.agentId ? "registered" : saved?.chainRegistrationStatus ?? "unregistered",
                  bootstrapStatus: bootstrapJob?.status ?? null,
                  name: String(nft.metadata.name ?? nft.id.toString()),
                  description: String(nft.metadata.description ?? ""),
                  properties: {
                    ...(props ?? {}),
                    level: liveEntity.level,
                    xp: liveEntity.xp,
                    stats: {
                      ...(props?.stats as Record<string, unknown> ?? {}),
                      hp: liveEntity.maxHp,
                    },
                  },
                };
              }

              if (saved) {
                return {
                  tokenId: nft.id.toString(),
                  characterTokenId: saved.characterTokenId ?? nft.id.toString(),
                  agentId: saved.agentId ?? null,
                  chainRegistrationStatus: saved.chainRegistrationStatus ?? (saved.agentId ? "registered" : "unregistered"),
                  bootstrapStatus: bootstrapJob?.status ?? null,
                  name: String(nft.metadata.name ?? nft.id.toString()),
                  description: String(nft.metadata.description ?? ""),
                  properties: {
                    ...(props ?? {}),
                    level: saved.level,
                    xp: saved.xp,
                  },
                };
              }

              return {
                tokenId: nft.id.toString(),
                characterTokenId: nft.id.toString(),
                agentId: null,
                chainRegistrationStatus: "unregistered",
                bootstrapStatus: null,
                name: String(nft.metadata.name ?? nft.id.toString()),
                description: String(nft.metadata.description ?? ""),
                properties: props ?? {},
              };
            })
          );

          return {
            walletAddress,
            liveEntity,
            deployedCharacterName,
            characters: dedupeCharacterEntries(characters as CharacterListEntry[]),
          };
        }

        // Fallback: on-chain returned empty — build characters from Redis
        // Check both the owner wallet and the custodial wallet
        let savedChars = await loadAllCharactersForWallet(walletAddress);
        if (savedChars.length === 0 && custodialWallet) {
          savedChars = await loadAllCharactersForWallet(custodialWallet);
        }
        if (savedChars.length > 0) {
          server.log.info(`[characters] On-chain empty for ${walletAddress}, serving ${savedChars.length} character(s) from Redis`);
        }

        const characters = await Promise.all(savedChars.map(async (saved, i) => {
          const name = saved.name;
          const classDef = CLASS_DEFINITIONS.find((c) => c.id === saved.classId);
          const fullName = classDef ? `${name} the ${classDef.name}` : name;
          const stats = computeStatsAtLevel(saved.raceId, saved.classId, saved.level);
          const { savedWallet } = await resolveSavedCharacter(walletAddress, custodialWallet, name);
          const bootstrapJob = await loadCharacterBootstrapJob(savedWallet ?? walletAddress, name);

          // Overlay live entity data if available
          if (liveEntity && (name === liveEntity.name || fullName.startsWith(liveEntity.name))) {
            return {
              tokenId: `redis-${i}`,
              characterTokenId: saved.characterTokenId ?? null,
              agentId: saved.agentId ?? null,
              chainRegistrationStatus: saved.chainRegistrationStatus ?? (saved.agentId ? "registered" : "unregistered"),
              bootstrapStatus: bootstrapJob?.status ?? null,
              name: fullName,
              description: `Level ${liveEntity.level} ${saved.raceId} ${saved.classId}`,
              properties: {
                race: saved.raceId,
                class: saved.classId,
                level: liveEntity.level,
                xp: liveEntity.xp,
                stats: computeStatsAtLevel(saved.raceId, saved.classId, liveEntity.level),
              },
            };
          }

          return {
            tokenId: `redis-${i}`,
            characterTokenId: saved.characterTokenId ?? null,
            agentId: saved.agentId ?? null,
            chainRegistrationStatus: saved.chainRegistrationStatus ?? (saved.agentId ? "registered" : "unregistered"),
            bootstrapStatus: bootstrapJob?.status ?? null,
            name: fullName,
            description: `Level ${saved.level} ${saved.raceId} ${saved.classId}`,
            properties: {
              race: saved.raceId,
              class: saved.classId,
              level: saved.level,
              xp: saved.xp,
              stats,
            },
          };
        }));

        return {
          walletAddress,
          liveEntity,
          deployedCharacterName,
          characters: dedupeCharacterEntries(characters as CharacterListEntry[]),
        };
      } catch (err) {
        server.log.error(err, `Failed to fetch characters for ${walletAddress}`);
        reply.code(500);
        return { error: "Failed to fetch characters" };
      }
    }
  );
}
