import type { FastifyInstance } from "fastify";
import { authenticateRequest } from "../auth/auth.js";
import { getEntity } from "../world/zoneRuntime.js";
import { getGoldBalance } from "../blockchain/blockchain.js";
import { getAvailableGoldAsync, formatGold, recordGoldSpendAsync } from "../blockchain/goldLedger.js";
import { saveCharacter, getProfessionsForWallet } from "../character/characterStore.js";
import { getAgentCustodialWallet } from "../agents/agentConfigStore.js";
import { copperToGold } from "../blockchain/currency.js";
import { getProfessionSkills, restoreProfessionSkills, skillXpProgress } from "./professionXp.js";
import { listProfessionStateForWallet } from "../db/professionStateStore.js";

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

async function controlsWallet(
  authenticatedWallet: string,
  targetWallet: string | undefined | null
): Promise<boolean> {
  if (!targetWallet) return false;
  if (authenticatedWallet.toLowerCase() === targetWallet.toLowerCase()) return true;
  const custodialWallet = await getAgentCustodialWallet(authenticatedWallet);
  return custodialWallet?.toLowerCase() === targetWallet.toLowerCase();
}

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

/** Restore professions from persisted data (called on spawn/login) */
export function restoreProfessions(walletAddress: string, professions: string[]): void {
  const key = walletAddress.toLowerCase();
  const set = new Set<ProfessionType>(professions as ProfessionType[]);
  learnedProfessions.set(key, set);
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

      let learned = getLearnedProfessions(walletAddress);
      let skills = getProfessionSkills(walletAddress);

      const projected = await listProfessionStateForWallet(walletAddress).catch(() => []);
      if (projected.length > 0) {
        restoreProfessions(walletAddress, projected.map((entry) => entry.professionId));
        restoreProfessionSkills(
          walletAddress,
          Object.fromEntries(
            projected.map((entry) => [
              entry.professionId,
              {
                xp: entry.skillXp,
                level: entry.skillLevel,
                actions: entry.actionCount,
              },
            ])
          )
        );
        learned = getLearnedProfessions(walletAddress);
        skills = getProfessionSkills(walletAddress);
      }

      // If in-memory is empty (champion offline / server restarted),
      // fall back to the persisted character data in Redis
      if (learned.length === 0) {
        const fromRedis = await getProfessionsForWallet(walletAddress);
        if (fromRedis.length > 0) {
          restoreProfessions(walletAddress, fromRedis);
          learned = getLearnedProfessions(walletAddress);
        }
      }

      // If still empty, this might be an owner wallet — check the custodial wallet
      // (agents learn professions under their custodial address)
      if (learned.length === 0) {
        const custodial = await getAgentCustodialWallet(walletAddress);
        if (custodial) {
          learned = getLearnedProfessions(custodial);
          if (learned.length === 0) {
            const fromRedis = await getProfessionsForWallet(custodial);
            if (fromRedis.length > 0) {
              restoreProfessions(custodial, fromRedis);
              learned = getLearnedProfessions(custodial);
            }
          }
        }
      }

      // Build per-profession skill details — check both owner and custodial wallets
      if (Object.keys(skills).length === 0) {
        const custodial = await getAgentCustodialWallet(walletAddress);
        if (custodial) {
          const custodialProjected = await listProfessionStateForWallet(custodial).catch(() => []);
          if (custodialProjected.length > 0) {
            restoreProfessions(custodial, custodialProjected.map((entry) => entry.professionId));
            restoreProfessionSkills(
              custodial,
              Object.fromEntries(
                custodialProjected.map((entry) => [
                  entry.professionId,
                  {
                    xp: entry.skillXp,
                    level: entry.skillLevel,
                    actions: entry.actionCount,
                  },
                ])
              )
            );
          }
          skills = getProfessionSkills(custodial);
        }
      }
      const details: Record<string, { level: number; xp: number; actions: number; progress: number }> = {};
      for (const prof of learned) {
        const skill = skills[prof] ?? { xp: 0, level: 1, actions: 0 };
        const prog = skillXpProgress(skill);
        details[prof] = { level: skill.level, xp: skill.xp, actions: skill.actions, progress: prog.pct };
      }

      return {
        walletAddress,
        professions: learned,
        skills: details,
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
  }>("/professions/learn", {
    preHandler: authenticateRequest,
  }, async (request, reply) => {
    const { walletAddress, zoneId, entityId, trainerId, professionId } = request.body;
    const authenticatedWallet = (request as any).walletAddress as string;

    // Validate wallet
    if (!walletAddress || !/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
      reply.code(400);
      return { error: "Invalid wallet address" };
    }
    if (!(await controlsWallet(authenticatedWallet, walletAddress))) {
      reply.code(403);
      return { error: "Not authorized for this wallet address" };
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

    const entity = getEntity(entityId);
    if (!entity) {
      reply.code(404);
      return { error: "Entity not found" };
    }
    if (entity.type !== "player") {
      reply.code(400);
      return { error: "Only player entities can learn professions" };
    }
    if (!(await controlsWallet(authenticatedWallet, entity.walletAddress))) {
      reply.code(403);
      return { error: "Not authorized to control this player" };
    }
    if (entity.walletAddress!.toLowerCase() !== walletAddress.toLowerCase()) {
      reply.code(400);
      return { error: "walletAddress does not match entity owner" };
    }

    const trainer = getEntity(trainerId);
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

    // Check gold balance and deduct learning cost (copper → gold conversion)
    if (professionInfo.cost > 0) {
      const goldCost = copperToGold(professionInfo.cost);
      const onChainGold = parseFloat(await getGoldBalance(walletAddress));
      const safeOnChainGold = Number.isFinite(onChainGold) ? onChainGold : 0;
      const availableGold = await getAvailableGoldAsync(walletAddress, safeOnChainGold);
      if (availableGold < goldCost) {
        reply.code(400);
        return {
          error: "Insufficient gold to learn this profession",
          required: professionInfo.cost,
          available: formatGold(availableGold),
        };
      }
      await recordGoldSpendAsync(walletAddress, goldCost);
    }

    // Learn the profession
    learnProfession(walletAddress, professionId);

    // Persist to Redis — await to ensure it's saved before responding
    try {
      await saveCharacter(walletAddress, entity.name, {
        professions: getLearnedProfessions(walletAddress),
      });
      server.log.info(`[profession] Persisted professions for ${entity.name} (${walletAddress})`);
    } catch (err) {
      server.log.error(err, "[persistence] Failed to save professions");
    }

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
