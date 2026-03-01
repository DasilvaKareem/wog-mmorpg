import type { FastifyInstance } from "fastify";
import { CLASS_DEFINITIONS } from "./classes.js";
import { RACE_DEFINITIONS } from "./races.js";
import { validateCharacterInput, computeCharacter } from "./characterCreate.js";
import { mintCharacter, getOwnedCharacters } from "../blockchain/blockchain.js";
import { getAllZones } from "../world/zoneRuntime.js";
import { loadCharacter, saveCharacter, loadAllCharactersForWallet } from "./characterStore.js";
import { computeStatsAtLevel } from "./leveling.js";
import { reverseLookupOnChain, registerNameOnChain } from "../blockchain/nameServiceChain.js";
import { registerWalletWithWelcomeBonus } from "../blockchain/wallet.js";

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
   * POST /character/create
   * { walletAddress, name, race, className } → mint ERC-721 NFT with computed stats
   */
  server.post<{
    Body: { walletAddress: string; name: string; race: string; className: string };
  }>("/character/create", async (request, reply) => {
    const { walletAddress, name, race, className } = request.body;

    const error = validateCharacterInput({ walletAddress, name, race, className });
    if (error) {
      reply.code(400);
      return { error };
    }

    const character = computeCharacter(name, race, className);

    const metadata = {
      name: `${character.name} the ${character.class.name}`,
      description: `Level ${character.level} ${character.race.name} ${character.class.name}`,
      properties: {
        race: character.race.id,
        class: character.class.id,
        level: character.level,
        xp: 0,
        stats: character.stats,
      },
    };

    try {
      // Guarantee onboarding grant is applied even if client skipped /wallet/register.
      const registration = await registerWalletWithWelcomeBonus(server, walletAddress);

      // Seed character store so level/xp are always in Redis from the start
      await saveCharacter(walletAddress, character.name, {
        name: character.name,
        level: 1,
        xp: 0,
        raceId: character.race.id,
        classId: character.class.id,
        zone: "village-square",
        x: 0,
        y: 0,
        kills: 0,
        completedQuests: [],
        learnedTechniques: [],
        professions: [],
      });

      // Mint NFT + register name in background — don't block the response
      void (async () => {
        try {
          const txHash = await mintCharacter(walletAddress, metadata);
          server.log.info(`Minted character "${character.name}" to ${walletAddress}: ${txHash}`);
        } catch (err) {
          server.log.warn(`[character] NFT mint failed for ${walletAddress} (non-fatal, Redis has data): ${(err as Error).message}`);
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

      return {
        ok: true,
        walletRegistration: registration,
        character: {
          name: metadata.name,
          description: metadata.description,
          race: character.race.id,
          class: character.class.id,
          level: character.level,
          xp: 0,
          stats: character.stats,
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
        // Find live entity for this wallet across all zones
        const normalizedWallet = walletAddress.toLowerCase();
        let liveEntity: { level: number; xp: number; hp: number; maxHp: number; zoneId: string; name: string } | null = null;
        for (const [zoneId, zone] of getAllZones()) {
          for (const entity of zone.entities.values()) {
            if (entity.type !== "player") continue;
            if (entity.walletAddress?.toLowerCase() !== normalizedWallet) continue;
            liveEntity = {
              level: entity.level ?? 1,
              xp: entity.xp ?? 0,
              hp: entity.hp,
              maxHp: entity.maxHp,
              zoneId,
              name: entity.name,
            };
            break;
          }
          if (liveEntity) break;
        }

        // Try on-chain NFT enumeration first (10s timeout to avoid Cloudflare 524s)
        let nfts: Awaited<ReturnType<typeof getOwnedCharacters>> = [];
        try {
          nfts = await Promise.race([
            getOwnedCharacters(walletAddress),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error("NFT lookup timed out (10s)")), 10_000)
            ),
          ]);
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
                  const saved = await loadCharacter(walletAddress, baseName);
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

          return { walletAddress, liveEntity, characters };
        }

        // Fallback: on-chain returned empty — build characters from Redis
        const savedChars = await loadAllCharactersForWallet(walletAddress);
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

        return { walletAddress, liveEntity, characters };
      } catch (err) {
        server.log.error(err, `Failed to fetch characters for ${walletAddress}`);
        reply.code(500);
        return { error: "Failed to fetch characters" };
      }
    }
  );
}
