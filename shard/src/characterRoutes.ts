import type { FastifyInstance } from "fastify";
import { CLASS_DEFINITIONS } from "./classes.js";
import { RACE_DEFINITIONS } from "./races.js";
import { validateCharacterInput, computeCharacter } from "./characterCreate.js";
import { mintCharacter, getOwnedCharacters } from "./blockchain.js";
import { getAllZones } from "./zoneRuntime.js";

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
      const txHash = await mintCharacter(walletAddress, metadata);
      server.log.info(`Minted character "${character.name}" to ${walletAddress}: ${txHash}`);

      return {
        ok: true,
        txHash,
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
      server.log.error(err, `Character mint failed for ${walletAddress}`);
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
        const nfts = await getOwnedCharacters(walletAddress);

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

        return {
          walletAddress,
          liveEntity,
          characters: nfts.map((nft) => {
            const props = nft.metadata.properties as Record<string, unknown> | undefined;
            // Overlay live data if this character matches the live entity
            if (liveEntity && nft.metadata.name && (nft.metadata.name as string).startsWith(liveEntity.name)) {
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
            return {
              tokenId: nft.id.toString(),
              name: nft.metadata.name,
              description: nft.metadata.description,
              properties: props,
            };
          }),
        };
      } catch (err) {
        server.log.error(err, `Failed to fetch characters for ${walletAddress}`);
        reply.code(500);
        return { error: "Failed to fetch characters" };
      }
    }
  );
}
