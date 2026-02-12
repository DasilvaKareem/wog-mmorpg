import type { FastifyInstance } from "fastify";
import { getAllZones } from "./zoneRuntime.js";

export type ProfessionType = "mining" | "herbalism" | "skinning" | "blacksmithing" | "alchemy" | "cooking" | "leatherworking" | "jewelcrafting";

export interface ProfessionInfo {
  name: string;
  description: string;
  trainerId?: string; // Entity ID of the trainer NPC
  cost: number; // Gold cost to learn
}

export const PROFESSION_CATALOG: Record<ProfessionType, ProfessionInfo> = {
  mining: {
    name: "Mining",
    description: "Extract valuable ores from mineral deposits scattered across the world.",
    cost: 50,
  },
  herbalism: {
    name: "Herbalism",
    description: "Gather medicinal herbs and magical plants.",
    cost: 50,
  },
  skinning: {
    name: "Skinning",
    description: "Harvest pelts and hides from slain beasts.",
    cost: 50,
  },
  blacksmithing: {
    name: "Blacksmithing",
    description: "Forge weapons and armor from raw materials.",
    cost: 100,
  },
  alchemy: {
    name: "Alchemy",
    description: "Brew potions and elixirs from magical herbs and flowers.",
    cost: 75,
  },
  cooking: {
    name: "Cooking",
    description: "Prepare nourishing meals from raw ingredients to restore health.",
    cost: 40,
  },
  leatherworking: {
    name: "Leatherworking",
    description: "Craft leather armor from tanned hides and pelts.",
    cost: 75,
  },
  jewelcrafting: {
    name: "Jewelcrafting",
    description: "Cut gems and forge rings and amulets of power.",
    cost: 100,
  },
};

// In-memory profession tracking: walletAddress -> Set<ProfessionType>
const learnedProfessions = new Map<string, Set<ProfessionType>>();

export function hasLearnedProfession(
  walletAddress: string,
  profession: ProfessionType
): boolean {
  const professions = learnedProfessions.get(walletAddress.toLowerCase());
  return professions?.has(profession) ?? false;
}

export function learnProfession(
  walletAddress: string,
  profession: ProfessionType
): void {
  const key = walletAddress.toLowerCase();
  if (!learnedProfessions.has(key)) {
    learnedProfessions.set(key, new Set());
  }
  learnedProfessions.get(key)!.add(profession);
}

export function getLearnedProfessions(walletAddress: string): ProfessionType[] {
  const professions = learnedProfessions.get(walletAddress.toLowerCase());
  return professions ? Array.from(professions) : [];
}

export function registerProfessionRoutes(server: FastifyInstance) {
  // GET /professions/catalog - list all available professions
  server.get("/professions/catalog", async () => {
    return Object.entries(PROFESSION_CATALOG).map(([id, info]) => ({
      professionId: id,
      ...info,
    }));
  });

  // GET /professions/:walletAddress - list learned professions for a player
  server.get<{ Params: { walletAddress: string } }>(
    "/professions/:walletAddress",
    async (request, reply) => {
      const { walletAddress } = request.params;

      if (!walletAddress || !/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
        reply.code(400);
        return { error: "Invalid wallet address" };
      }

      const learned = getLearnedProfessions(walletAddress);
      return {
        walletAddress,
        professions: learned,
      };
    }
  );

  // POST /professions/learn - learn a profession from a trainer
  server.post<{
    Body: {
      walletAddress: string;
      zoneId: string;
      entityId: string; // Player entity ID
      trainerId: string; // Trainer NPC entity ID
      professionId: ProfessionType;
    };
  }>("/professions/learn", async (request, reply) => {
    const { walletAddress, zoneId, entityId, trainerId, professionId } = request.body;

    // Validate wallet
    if (!walletAddress || !/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
      reply.code(400);
      return { error: "Invalid wallet address" };
    }

    // Validate profession
    const professionInfo = PROFESSION_CATALOG[professionId];
    if (!professionInfo) {
      reply.code(400);
      return { error: "Invalid profession ID" };
    }

    // Check if already learned
    if (hasLearnedProfession(walletAddress, professionId)) {
      reply.code(400);
      return { error: "You have already learned this profession" };
    }

    const zone = getAllZones().get(zoneId);
    if (!zone) {
      reply.code(404);
      return { error: "Zone not found" };
    }

    const entity = zone.entities.get(entityId);
    if (!entity) {
      reply.code(404);
      return { error: "Entity not found" };
    }

    const trainer = zone.entities.get(trainerId);
    if (!trainer || trainer.type !== "profession-trainer") {
      reply.code(404);
      return { error: "Profession trainer not found" };
    }

    // Check if this trainer teaches this profession
    if (trainer.teachesProfession !== professionId) {
      reply.code(400);
      return {
        error: `This trainer does not teach ${professionInfo.name}`,
        trainerTeaches: trainer.teachesProfession,
      };
    }

    // Check range (must be within 100 units of trainer)
    const dx = trainer.x - entity.x;
    const dy = trainer.y - entity.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > 100) {
      reply.code(400);
      return {
        error: "Too far from trainer",
        distance: Math.round(dist),
        maxRange: 100,
      };
    }

    // TODO: Check gold balance and deduct cost
    // For now, we'll skip the gold check since the gold ledger system is separate

    // Learn the profession
    learnProfession(walletAddress, professionId);

    server.log.info(
      `[profession] ${entity.name} learned ${professionInfo.name} from ${trainer.name}`
    );

    return {
      ok: true,
      profession: professionId,
      professionName: professionInfo.name,
      trainer: trainer.name,
      message: `You have learned ${professionInfo.name}!`,
    };
  });
}
