import type { FastifyInstance } from "fastify";
import { authenticateRequest, requireWalletMatch } from "../auth/auth.js";
import { CLASS_DEFINITIONS } from "./classes.js";
import { RACE_DEFINITIONS } from "./races.js";
import { validateCharacterInput, computeCharacter } from "./characterCreate.js";
import { mintCharacterWithIdentity, getOwnedCharacters, registerIdentity } from "../blockchain/blockchain.js";
import { getAllEntities } from "../world/zoneRuntime.js";
import { loadCharacter, saveCharacter, loadAllCharactersForWallet, type CharacterCalling } from "./characterStore.js";
import { computeStatsAtLevel } from "./leveling.js";
import { reverseLookupOnChain, registerNameOnChain } from "../blockchain/nameServiceChain.js";
import { registerWalletWithWelcomeBonus } from "../blockchain/wallet.js";
import { getAgentCustodialWallet, getAgentEntityRef } from "../agents/agentConfigStore.js";
import { reputationManager } from "../economy/reputationManager.js";
import { publishValidationClaim } from "../erc8004/validation.js";

type CharacterListEntry = {
  tokenId: string;
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

      if (!existingSave || needsCharacterMint || needsIdentityRegistration) {
        // Mint NFT + register name in background — don't block the response.
        // Repeated create calls used to remint the same character because Redis was
        // already seeded but we still executed this block unconditionally.
        void (async () => {
          try {
            const mintResult = needsCharacterMint
              ? await mintCharacterWithIdentity(walletAddress, metadata)
              : {
                  txHash: null,
                  tokenId: BigInt(existingSave!.characterTokenId!),
                  identity: await registerIdentity(BigInt(existingSave!.characterTokenId!), walletAddress, ""),
                };

            server.log.info(
              `${needsCharacterMint ? "Minted" : "Recovered identity for"} character "${character.name}" to ${walletAddress}: ${mintResult.txHash ?? "identity-only"}`
            );

            await saveCharacter(walletAddress, character.name, {
              ...(mintResult.tokenId != null && { characterTokenId: mintResult.tokenId.toString() }),
              ...(mintResult.identity?.agentId != null && { agentId: mintResult.identity.agentId.toString() }),
            });
            if (mintResult.identity?.agentId != null) {
              reputationManager.ensureInitialized(mintResult.identity.agentId);
              const validUntil = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;
              void publishValidationClaim(mintResult.identity.agentId, "wog:a2a-enabled", validUntil);
            }

            for (const entity of getAllEntities().values()) {
              if (entity.type !== "player") continue;
              if (entity.walletAddress?.toLowerCase() !== walletAddress.toLowerCase()) continue;
              if (entity.name !== character.name) continue;
              if (mintResult.tokenId != null) entity.characterTokenId = mintResult.tokenId;
              if (mintResult.identity?.agentId != null) entity.agentId = mintResult.identity.agentId;
            }
          } catch (err) {
            server.log.warn(`[character] Character identity bootstrap failed for ${walletAddress} (non-fatal, Redis has data): ${(err as Error).message}`);
          }

          try {
            const existing = await reverseLookupOnChain(walletAddress);
            if (!existing) {
              await registerNameOnChain(walletAddress, character.name);
              server.log.info(`[nameService] Auto-registered "${character.name}.wog" for ${walletAddress}`);
            }
          } catch (err) {
            server.log.warn(`[nameService] Auto-register failed for ${walletAddress}: ${(err as Error).message}`);
          }
        })();
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
        let liveEntity: { level: number; xp: number; hp: number; maxHp: number; zoneId: string; name: string } | null = null;
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

              if (liveEntity && baseName && nftName.startsWith(liveEntity.name)) {
                return {
                  tokenId: nft.id.toString(),
                  name: nft.metadata.name,
                  description: nft.metadata.description,
                  properties: {
                    ...props,
                    level: liveEntity.level,
                    xp: liveEntity.xp,
                    stats: {
                      ...(props?.stats as Record<string, unknown> ?? {}),
                      hp: liveEntity.maxHp,
                    },
                  },
                };
              }

              if (baseName) {
                try {
                  // Try owner wallet first, then custodial wallet
                  const saved = await loadCharacter(walletAddress, baseName)
                    ?? (custodialWallet ? await loadCharacter(custodialWallet, baseName) : null);
                  if (saved) {
                    return {
                      tokenId: nft.id.toString(),
                      name: nft.metadata.name,
                      description: nft.metadata.description,
                      properties: {
                        ...props,
                        level: saved.level,
                        xp: saved.xp,
                      },
                    };
                  }
                } catch {
                  // Redis lookup failed, fall through to raw NFT metadata
                }
              }

              return {
                tokenId: nft.id.toString(),
                name: nft.metadata.name,
                description: nft.metadata.description,
                properties: props,
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

        const characters = savedChars.map((saved, i) => {
          const name = saved.name;
          const classDef = CLASS_DEFINITIONS.find((c) => c.id === saved.classId);
          const fullName = classDef ? `${name} the ${classDef.name}` : name;
          const stats = computeStatsAtLevel(saved.raceId, saved.classId, saved.level);

          // Overlay live entity data if available
          if (liveEntity && (name === liveEntity.name || fullName.startsWith(liveEntity.name))) {
            return {
              tokenId: `redis-${i}`,
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
        });

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
