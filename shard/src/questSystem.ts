import type { FastifyInstance } from "fastify";
import { getOrCreateZone, type Entity, recalculateEntityVitals } from "./zoneRuntime.js";
import { mintGold, mintItem } from "./blockchain.js";
import { xpForLevel, MAX_LEVEL, computeStatsAtLevel } from "./leveling.js";

// Quest definition
export interface Quest {
  id: string;
  title: string;
  description: string;
  npcId: string; // Entity ID of quest giver
  prerequisiteQuestId?: string; // Optional: Quest that must be completed first
  objective: {
    type: "kill" | "talk";
    targetMobType?: string; // kill quests: e.g. "mob" or specific name
    targetMobName?: string; // kill quests: specific mob name like "Hungry Wolf"
    targetNpcName?: string; // talk quests: NPC name to visit
    count: number;
  };
  rewards: {
    gold: number;
    xp: number;
    items?: Array<{ tokenId: number; quantity: number }>; // minted to player on completion
  };
}

// Active quest progress (stored on player entity)
export interface ActiveQuest {
  questId: string;
  progress: number; // kills so far
  startedAt: number;
}

// Predefined quests offered by NPCs
export const QUEST_CATALOG: Quest[] = [
  // === NEWCOMER'S WELCOME — Talk Quest Chain (human-meadow, 8 quests, 900 XP → L3) ===

  {
    id: "welcome_adventurer",
    title: "Welcome, Adventurer",
    description:
      "Guard Captain Marcus wants to greet every new arrival. Speak with him to learn about the meadow.",
    npcId: "Guard Captain Marcus",
    objective: {
      type: "talk",
      targetNpcName: "Guard Captain Marcus",
      count: 1,
    },
    rewards: {
      gold: 10,
      xp: 40,
      items: [{ tokenId: 0, quantity: 3 }], // 3x Health Potion
    },
  },
  {
    id: "traders_bargain",
    title: "The Trader's Bargain",
    description:
      "Grimwald the Trader has a welcome gift for newcomers. Visit his stall near the market square.",
    npcId: "Grimwald the Trader",
    prerequisiteQuestId: "welcome_adventurer",
    objective: {
      type: "talk",
      targetNpcName: "Grimwald the Trader",
      count: 1,
    },
    rewards: {
      gold: 15,
      xp: 60,
      items: [{ tokenId: 2, quantity: 1 }], // 1x Iron Sword
    },
  },
  {
    id: "blacksmiths_offer",
    title: "The Blacksmith's Offer",
    description:
      "Bron the Blacksmith forged a leather vest for you. Pick it up at his anvil.",
    npcId: "Bron the Blacksmith",
    prerequisiteQuestId: "traders_bargain",
    objective: {
      type: "talk",
      targetNpcName: "Bron the Blacksmith",
      count: 1,
    },
    rewards: {
      gold: 15,
      xp: 80,
      items: [{ tokenId: 8, quantity: 1 }], // 1x Leather Vest
    },
  },
  {
    id: "warriors_wisdom",
    title: "Warrior's Wisdom",
    description:
      "Thrain Ironforge wants to share combat wisdom with every new recruit. Find him at the training grounds.",
    npcId: "Thrain Ironforge - Warrior Trainer",
    prerequisiteQuestId: "blacksmiths_offer",
    objective: {
      type: "talk",
      targetNpcName: "Thrain Ironforge - Warrior Trainer",
      count: 1,
    },
    rewards: {
      gold: 10,
      xp: 100,
      items: [{ tokenId: 10, quantity: 1 }], // 1x Iron Helm
    },
  },
  {
    id: "foragers_knowledge",
    title: "Forager's Knowledge",
    description:
      "Herbalist Willow knows every plant in the meadow. She has protective leggings woven from enchanted fibers.",
    npcId: "Herbalist Willow",
    prerequisiteQuestId: "warriors_wisdom",
    objective: {
      type: "talk",
      targetNpcName: "Herbalist Willow",
      count: 1,
    },
    rewards: {
      gold: 10,
      xp: 120,
      items: [{ tokenId: 12, quantity: 1 }], // 1x Leather Leggings
    },
  },
  {
    id: "cooks_secret",
    title: "The Cook's Secret",
    description:
      "Chef Gastron insists every adventurer needs good boots. He has a pair waiting at the campfire.",
    npcId: "Chef Gastron",
    prerequisiteQuestId: "foragers_knowledge",
    objective: {
      type: "talk",
      targetNpcName: "Chef Gastron",
      count: 1,
    },
    rewards: {
      gold: 15,
      xp: 140,
      items: [{ tokenId: 13, quantity: 1 }], // 1x Traveler Boots
    },
  },
  {
    id: "miners_greeting",
    title: "Miner's Greeting",
    description:
      "Grizzled Miner Torvik rewards those brave enough to descend into the mines. Visit him for padded gloves and a sturdy belt.",
    npcId: "Grizzled Miner Torvik",
    prerequisiteQuestId: "cooks_secret",
    objective: {
      type: "talk",
      targetNpcName: "Grizzled Miner Torvik",
      count: 1,
    },
    rewards: {
      gold: 15,
      xp: 160,
      items: [
        { tokenId: 15, quantity: 1 }, // 1x Padded Gloves
        { tokenId: 16, quantity: 1 }, // 1x Guard Belt
      ],
    },
  },
  {
    id: "ready_for_battle",
    title: "Ready for Battle",
    description:
      "Return to Guard Captain Marcus fully equipped. He'll award your shoulder guard and send you to fight.",
    npcId: "Guard Captain Marcus",
    prerequisiteQuestId: "miners_greeting",
    objective: {
      type: "talk",
      targetNpcName: "Guard Captain Marcus",
      count: 1,
    },
    rewards: {
      gold: 20,
      xp: 200,
      items: [
        { tokenId: 14, quantity: 1 }, // 1x Bronze Shoulders
        { tokenId: 0, quantity: 3 },  // 3x Health Potion
      ],
    },
  },

  // === HUMAN MEADOW KILL QUESTS (Levels 1-5) ===

  // Tutorial Quest - Level 1 (No prerequisite - starting quest)
  {
    id: "rat_extermination",
    title: "Rat Extermination",
    description: "The rats in the grain storage are out of control. Clear them out!",
    npcId: "Guard Captain Marcus",
    objective: {
      type: "kill",
      targetMobType: "mob",
      targetMobName: "Giant Rat",
      count: 3,
    },
    rewards: {
      gold: 25,
      xp: 50,
    },
  },

  // Level 2 Quests
  {
    id: "wolf_hunter_1",
    title: "Wolf Hunter",
    description: "The wolves are threatening travelers. Kill 5 Hungry Wolves and return for your reward.",
    npcId: "Guard Captain Marcus",
    prerequisiteQuestId: "rat_extermination",
    objective: {
      type: "kill",
      targetMobType: "mob",
      targetMobName: "Hungry Wolf",
      count: 5,
    },
    rewards: {
      gold: 50,
      xp: 100,
    },
  },
  {
    id: "boar_bounty",
    title: "Boar Bounty",
    description: "Wild boars are destroying farmland. Hunt them down.",
    npcId: "Guard Captain Marcus",
    prerequisiteQuestId: "wolf_hunter_1",
    objective: {
      type: "kill",
      targetMobType: "mob",
      targetMobName: "Wild Boar",
      count: 4,
    },
    rewards: {
      gold: 60,
      xp: 120,
    },
  },

  // Level 3 Quests
  {
    id: "goblin_menace",
    title: "Goblin Menace",
    description: "Goblins have been raiding our supplies. Slay 3 Goblin Raiders.",
    npcId: "Guard Captain Marcus",
    prerequisiteQuestId: "boar_bounty",
    objective: {
      type: "kill",
      targetMobType: "mob",
      targetMobName: "Goblin Raider",
      count: 3,
    },
    rewards: {
      gold: 75,
      xp: 150,
    },
  },
  {
    id: "slime_cleanup",
    title: "Slime Cleanup",
    description: "The slimes are spreading disease. Eliminate 2 Mire Slimes.",
    npcId: "Guard Captain Marcus",
    prerequisiteQuestId: "goblin_menace",
    objective: {
      type: "kill",
      targetMobType: "mob",
      targetMobName: "Mire Slime",
      count: 2,
    },
    rewards: {
      gold: 60,
      xp: 120,
    },
  },

  // Level 4 Quest
  {
    id: "bandit_problem",
    title: "Bandit Problem",
    description: "Bandits spy on our defenses. Hunt them before they report back.",
    npcId: "Guard Captain Marcus",
    prerequisiteQuestId: "slime_cleanup",
    objective: {
      type: "kill",
      targetMobType: "mob",
      targetMobName: "Bandit Scout",
      count: 3,
    },
    rewards: {
      gold: 100,
      xp: 200,
    },
  },

  // Level 5 Elite Quest
  {
    id: "alpha_threat",
    title: "The Alpha Threat",
    description: "A diseased alpha wolf leads the pack. Slay it to break their morale.",
    npcId: "Guard Captain Marcus",
    prerequisiteQuestId: "bandit_problem",
    objective: {
      type: "kill",
      targetMobType: "mob",
      targetMobName: "Diseased Wolf",
      count: 1,
    },
    rewards: {
      gold: 150,
      xp: 300,
    },
  },

  // === WILD MEADOW QUESTS (Levels 5-10) ===

  // Level 6 Quest (Unlocked after completing Human Meadow)
  {
    id: "bear_necessities",
    title: "Bear Necessities",
    description: "Bears guard valuable territory. Clear them so we can expand.",
    npcId: "Ranger Thornwood",
    prerequisiteQuestId: "alpha_threat",
    objective: {
      type: "kill",
      targetMobType: "mob",
      targetMobName: "Forest Bear",
      count: 4,
    },
    rewards: {
      gold: 125,
      xp: 250,
    },
  },

  // Level 7 Quest
  {
    id: "arachnophobia",
    title: "Arachnophobia",
    description: "Giant spiders nest in the meadow. Burn their webs and slay them.",
    npcId: "Ranger Thornwood",
    prerequisiteQuestId: "bear_necessities",
    objective: {
      type: "kill",
      targetMobType: "mob",
      targetMobName: "Venom Spider",
      count: 5,
    },
    rewards: {
      gold: 150,
      xp: 300,
    },
  },

  // Level 8 Quest
  {
    id: "outlaw_justice",
    title: "Outlaw Justice",
    description: "Bandits have established camps in the meadow. Bring them to justice.",
    npcId: "Ranger Thornwood",
    prerequisiteQuestId: "arachnophobia",
    objective: {
      type: "kill",
      targetMobType: "mob",
      targetMobName: "Rogue Bandit",
      count: 4,
    },
    rewards: {
      gold: 175,
      xp: 350,
    },
  },

  // Level 9 Quest
  {
    id: "natures_corruption",
    title: "Nature's Corruption",
    description: "Dark magic twists the forest spirits. Free them from corruption.",
    npcId: "Ranger Thornwood",
    prerequisiteQuestId: "outlaw_justice",
    objective: {
      type: "kill",
      targetMobType: "mob",
      targetMobName: "Corrupted Ent",
      count: 3,
    },
    rewards: {
      gold: 200,
      xp: 400,
    },
  },

  // Level 10 Elite Quest
  {
    id: "pack_leader",
    title: "The Pack Leader",
    description: "A massive dire wolf terrorizes the meadow. Slay the beast.",
    npcId: "Ranger Thornwood",
    prerequisiteQuestId: "natures_corruption",
    objective: {
      type: "kill",
      targetMobType: "mob",
      targetMobName: "Dire Wolf",
      count: 1,
    },
    rewards: {
      gold: 250,
      xp: 500,
    },
  },

  // Mixed Challenge Quest
  {
    id: "wilderness_survival",
    title: "Wilderness Survival",
    description: "Prove your worth by surviving the wild meadow's greatest threats. Hunt bears, spiders, and bandits.",
    npcId: "Ranger Thornwood",
    prerequisiteQuestId: "pack_leader",
    objective: {
      type: "kill",
      targetMobType: "mob",
      targetMobName: "Forest Bear", // Note: This is simplified - tracks only bears, but description mentions all
      count: 7, // 2 bears + 3 spiders + 2 bandits = 7 total (simplified to just bears for now)
    },
    rewards: {
      gold: 300,
      xp: 600,
    },
  },

  // === DARK FOREST QUESTS (Levels 10-15) ===

  // Level 11 Quest (Unlocked after completing Wild Meadow)
  {
    id: "shadows_in_dark",
    title: "Shadows in the Dark",
    description: "Spectral wolves haunt the forest. Banish them to the void.",
    npcId: "Priestess Selene",
    prerequisiteQuestId: "wilderness_survival",
    objective: {
      type: "kill",
      targetMobType: "mob",
      targetMobName: "Shadow Wolf",
      count: 5,
    },
    rewards: {
      gold: 275,
      xp: 550,
    },
  },

  // Level 12 Quest
  {
    id: "cult_cleansing",
    title: "Cult Cleansing",
    description: "Dark cultists perform evil rituals. Stop their blasphemy.",
    npcId: "Priestess Selene",
    prerequisiteQuestId: "shadows_in_dark",
    objective: {
      type: "kill",
      targetMobType: "mob",
      targetMobName: "Dark Cultist",
      count: 4,
    },
    rewards: {
      gold: 325,
      xp: 650,
    },
  },

  // Level 13 Quest
  {
    id: "undead_purge",
    title: "Undead Purge",
    description: "Fallen warriors rise again. Put them to eternal rest.",
    npcId: "Priestess Selene",
    prerequisiteQuestId: "cult_cleansing",
    objective: {
      type: "kill",
      targetMobType: "mob",
      targetMobName: "Undead Knight",
      count: 4,
    },
    rewards: {
      gold: 375,
      xp: 750,
    },
  },

  // Level 14 Quest
  {
    id: "troll_slayer",
    title: "Troll Slayer",
    description: "Trolls block the forest paths. Slay these regenerating beasts.",
    npcId: "Priestess Selene",
    prerequisiteQuestId: "undead_purge",
    objective: {
      type: "kill",
      targetMobType: "mob",
      targetMobName: "Forest Troll",
      count: 3,
    },
    rewards: {
      gold: 425,
      xp: 850,
    },
  },

  // Level 15 Quest
  {
    id: "golem_breaker",
    title: "Golem Breaker",
    description: "Ancient stone golems guard forbidden ruins. Shatter them.",
    npcId: "Priestess Selene",
    prerequisiteQuestId: "troll_slayer",
    objective: {
      type: "kill",
      targetMobType: "mob",
      targetMobName: "Ancient Golem",
      count: 2,
    },
    rewards: {
      gold: 475,
      xp: 950,
    },
  },

  // Level 16 Boss Quest
  {
    id: "necromancer_end",
    title: "The Necromancer's End",
    description: "The necromancer Valdris raises the dead and spreads darkness. End his dark reign once and for all.",
    npcId: "Priestess Selene",
    prerequisiteQuestId: "golem_breaker",
    objective: {
      type: "kill",
      targetMobType: "boss",
      targetMobName: "Necromancer Valdris",
      count: 1,
    },
    rewards: {
      gold: 750,
      xp: 1500,
    },
  },

  // Ultimate Challenge Quest
  {
    id: "dark_forest_master",
    title: "Master of the Dark Forest",
    description: "Prove yourself as the master of the dark forest by conquering all its threats. Only the strongest survive this trial.",
    npcId: "Priestess Selene",
    prerequisiteQuestId: "necromancer_end",
    objective: {
      type: "kill",
      targetMobType: "mob",
      targetMobName: "Shadow Wolf", // Simplified - tracks Shadow Wolves
      count: 10, // 3 Shadow Wolves + 2 Dark Cultists + 2 Undead Knights + 1 Forest Troll + 2 Golems = 10 total
    },
    rewards: {
      gold: 1000,
      xp: 2000,
    },
  },
];

/**
 * Get all quests available from an NPC (by NPC name)
 */
export function getQuestsForNpc(npcName: string): Quest[] {
  return QUEST_CATALOG.filter((q) => q.npcId === npcName);
}

/**
 * Check if a quest is available to a player (prerequisites met)
 */
export function isQuestAvailable(quest: Quest, completedQuestIds: string[]): boolean {
  // If no prerequisite, quest is always available
  if (!quest.prerequisiteQuestId) {
    return true;
  }

  // Check if prerequisite quest has been completed
  return completedQuestIds.includes(quest.prerequisiteQuestId);
}

/**
 * Get quests available to a specific player from an NPC
 */
export function getAvailableQuestsForPlayer(
  npcName: string,
  completedQuestIds: string[],
  activeQuestIds: string[]
): Quest[] {
  const allNpcQuests = getQuestsForNpc(npcName);

  return allNpcQuests.filter((quest) => {
    // Filter out already active or completed quests
    if (activeQuestIds.includes(quest.id) || completedQuestIds.includes(quest.id)) {
      return false;
    }

    // Check if prerequisites are met
    return isQuestAvailable(quest, completedQuestIds);
  });
}

/**
 * Check if player has completed a quest's objective
 */
export function isQuestComplete(quest: Quest, progress: number): boolean {
  return progress >= quest.objective.count;
}

/**
 * Check if a killed mob counts toward a quest objective
 */
export function doesKillCountForQuest(
  quest: Quest,
  killedMobType: string,
  killedMobName: string
): boolean {
  if (quest.objective.type !== "kill") return false;

  // Check mob type matches
  if (killedMobType !== quest.objective.targetMobType) return false;

  // If quest specifies a mob name, check it matches
  if (quest.objective.targetMobName) {
    return killedMobName === quest.objective.targetMobName;
  }

  // No specific name required, any mob of this type counts
  return true;
}

/**
 * Award quest rewards to a player
 */
export async function awardQuestRewards(
  player: Entity,
  quest: Quest
): Promise<void> {
  // Award XP
  if (player.xp != null) {
    player.xp += quest.rewards.xp;
  } else {
    player.xp = quest.rewards.xp;
  }

  // Check for level-up(s) after XP award
  if (player.level != null && player.raceId && player.classId) {
    let leveled = false;
    while (player.level < MAX_LEVEL && player.xp >= xpForLevel(player.level + 1)) {
      player.level++;
      leveled = true;
    }
    if (leveled) {
      const newStats = computeStatsAtLevel(player.raceId, player.classId, player.level);
      player.stats = newStats;
      recalculateEntityVitals(player);
      console.log(`[quest] *** ${player.name} leveled up to ${player.level}! ***`);
    }
  }

  // Award gold (async, non-blocking)
  if (player.walletAddress) {
    await mintGold(player.walletAddress, quest.rewards.gold.toString()).catch(
      (err) => console.error(`[quest] Failed to mint gold for ${player.name}:`, err)
    );

    // Award item rewards
    if (quest.rewards.items) {
      for (const item of quest.rewards.items) {
        await mintItem(player.walletAddress, BigInt(item.tokenId), BigInt(item.quantity)).catch(
          (err) =>
            console.error(
              `[quest] Failed to mint item ${item.tokenId} x${item.quantity} for ${player.name}:`,
              err
            )
        );
      }
    }
  }

  console.log(
    `[quest] ${player.name} completed "${quest.title}" - awarded ${quest.rewards.gold} gold + ${quest.rewards.xp} XP` +
      (quest.rewards.items
        ? ` + ${quest.rewards.items.map((i) => `${i.quantity}x tokenId:${i.tokenId}`).join(", ")}`
        : "")
  );
}

export function registerQuestRoutes(server: FastifyInstance) {
  // GET /quests/:zoneId/:npcId?playerId=X - Get available quests from an NPC (filtered by player progress)
  server.get<{
    Params: { zoneId: string; npcId: string };
    Querystring: { playerId?: string };
  }>("/quests/:zoneId/:npcId", async (request, reply) => {
    const { zoneId, npcId } = request.params;
    const { playerId } = request.query;
    const zone = getOrCreateZone(zoneId);
    const npc = zone.entities.get(npcId);

    if (!npc) {
      reply.code(404);
      return { error: "NPC not found" };
    }

    let quests: Quest[];

    // If playerId provided, filter by prerequisites
    if (playerId) {
      const player = zone.entities.get(playerId);
      if (player && player.type === "player") {
        const completedQuestIds = player.completedQuests ?? [];
        const activeQuestIds = (player.activeQuests ?? []).map((aq) => aq.questId);
        quests = getAvailableQuestsForPlayer(npc.name, completedQuestIds, activeQuestIds);
      } else {
        // Player not found, return all quests (for debugging)
        quests = getQuestsForNpc(npc.name);
      }
    } else {
      // No player filtering, return all quests from this NPC
      quests = getQuestsForNpc(npc.name);
    }

    return { npc: { id: npc.id, name: npc.name }, quests };
  });

  // POST /quests/accept - Accept a quest
  server.post<{
    Body: { zoneId: string; playerId: string; questId: string };
  }>("/quests/accept", async (request, reply) => {
    const { zoneId, playerId, questId } = request.body;
    const zone = getOrCreateZone(zoneId);
    const player = zone.entities.get(playerId);

    if (!player || player.type !== "player") {
      reply.code(404);
      return { error: "Player not found" };
    }

    const quest = QUEST_CATALOG.find((q) => q.id === questId);
    if (!quest) {
      reply.code(404);
      return { error: "Quest not found" };
    }

    // Initialize quest tracking arrays
    if (!player.activeQuests) player.activeQuests = [];
    if (!player.completedQuests) player.completedQuests = [];

    // Check if already active
    const existing = player.activeQuests.find((aq) => aq.questId === questId);
    if (existing) {
      reply.code(400);
      return { error: "Quest already active" };
    }

    // Check if already completed
    if (player.completedQuests.includes(questId)) {
      reply.code(400);
      return { error: "Quest already completed" };
    }

    // Check prerequisites
    if (!isQuestAvailable(quest, player.completedQuests)) {
      reply.code(400);
      return {
        error: "Prerequisite quest not completed",
        prerequisiteQuestId: quest.prerequisiteQuestId,
      };
    }

    // Add quest to player
    player.activeQuests.push({
      questId,
      progress: 0,
      startedAt: Date.now(),
    });

    console.log(`[quest] ${player.name} accepted quest "${quest.title}"`);
    return {
      accepted: true,
      quest: {
        id: quest.id,
        title: quest.title,
        description: quest.description,
        objective: quest.objective,
        rewards: quest.rewards,
        prerequisiteQuestId: quest.prerequisiteQuestId,
      },
    };
  });

  // GET /quests/active/:zoneId/:playerId - Get player's active quests
  server.get<{ Params: { zoneId: string; playerId: string } }>(
    "/quests/active/:zoneId/:playerId",
    async (request, reply) => {
      const { zoneId, playerId } = request.params;
      const zone = getOrCreateZone(zoneId);
      const player = zone.entities.get(playerId);

      if (!player || player.type !== "player") {
        reply.code(404);
        return { error: "Player not found" };
      }

      const activeQuests = (player.activeQuests ?? []).map((aq) => {
        const quest = QUEST_CATALOG.find((q) => q.id === aq.questId);
        return {
          questId: aq.questId,
          progress: aq.progress,
          required: quest?.objective.count ?? 0,
          complete: quest ? isQuestComplete(quest, aq.progress) : false,
          quest,
        };
      });

      return { activeQuests };
    }
  );

  // POST /quests/complete - Turn in a completed quest
  server.post<{
    Body: { zoneId: string; playerId: string; questId: string; npcId: string };
  }>("/quests/complete", async (request, reply) => {
    const { zoneId, playerId, questId, npcId } = request.body;
    const zone = getOrCreateZone(zoneId);
    const player = zone.entities.get(playerId);

    if (!player || player.type !== "player") {
      reply.code(404);
      return { error: "Player not found" };
    }

    const quest = QUEST_CATALOG.find((q) => q.id === questId);
    if (!quest) {
      reply.code(404);
      return { error: "Quest not found" };
    }

    // Verify quest is from this NPC
    const npc = zone.entities.get(npcId);
    if (!npc || quest.npcId !== npc.name) {
      reply.code(400);
      return { error: "This NPC does not offer this quest" };
    }

    // Check if quest is active
    if (!player.activeQuests) player.activeQuests = [];
    const activeIndex = player.activeQuests.findIndex(
      (aq) => aq.questId === questId
    );
    if (activeIndex === -1) {
      reply.code(400);
      return { error: "Quest not active" };
    }

    const activeQuest = player.activeQuests[activeIndex];

    // Check if complete
    if (!isQuestComplete(quest, activeQuest.progress)) {
      reply.code(400);
      return {
        error: "Quest not complete",
        progress: activeQuest.progress,
        required: quest.objective.count,
      };
    }

    // Award rewards
    await awardQuestRewards(player, quest);

    // Remove from active quests
    player.activeQuests.splice(activeIndex, 1);

    // Add to completed quests
    if (!player.completedQuests) player.completedQuests = [];
    player.completedQuests.push(questId);

    console.log(
      `[quest] ${player.name} completed quest "${quest.title}" (${player.completedQuests.length} total completed)`
    );

    return {
      completed: true,
      rewards: quest.rewards,
      questTitle: quest.title,
      totalCompleted: player.completedQuests.length,
    };
  });

  // POST /quests/talk - Auto-accept + auto-complete a talk quest by visiting an NPC
  server.post<{
    Body: { zoneId: string; playerId: string; npcEntityId: string };
  }>("/quests/talk", async (request, reply) => {
    const { zoneId, playerId, npcEntityId } = request.body;
    const zone = getOrCreateZone(zoneId);
    const player = zone.entities.get(playerId);

    if (!player || player.type !== "player") {
      reply.code(404);
      return { error: "Player not found" };
    }

    const npc = zone.entities.get(npcEntityId);
    if (!npc) {
      reply.code(404);
      return { error: "NPC not found" };
    }

    // Range check (50 units)
    const dx = (player.x ?? 0) - (npc.x ?? 0);
    const dz = (player.y ?? 0) - (npc.y ?? 0);
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist > 50) {
      reply.code(400);
      return { error: "Too far from NPC", distance: Math.round(dist), maxRange: 50 };
    }

    // Initialize quest tracking
    if (!player.activeQuests) player.activeQuests = [];
    if (!player.completedQuests) player.completedQuests = [];

    const npcName = npc.name;

    // Find a talk quest targeting this NPC that the player can do:
    // 1. First check active talk quests for this NPC
    const activeEntry = player.activeQuests.find((aq) => {
      const q = QUEST_CATALOG.find((c) => c.id === aq.questId);
      return q && q.objective.type === "talk" && q.objective.targetNpcName === npcName;
    });

    let quest: Quest | undefined;

    if (activeEntry) {
      quest = QUEST_CATALOG.find((q) => q.id === activeEntry.questId);
    } else {
      // 2. Auto-accept the next available talk quest for this NPC
      quest = QUEST_CATALOG.find(
        (q) =>
          q.objective.type === "talk" &&
          q.objective.targetNpcName === npcName &&
          !player.completedQuests!.includes(q.id) &&
          !player.activeQuests!.some((aq) => aq.questId === q.id) &&
          isQuestAvailable(q, player.completedQuests!)
      );

      if (quest) {
        // Auto-accept
        player.activeQuests.push({
          questId: quest.id,
          progress: 0,
          startedAt: Date.now(),
        });
        console.log(`[quest] ${player.name} auto-accepted talk quest "${quest.title}"`);
      }
    }

    if (!quest) {
      reply.code(400);
      return { error: "No talk quest available from this NPC" };
    }

    // Find the active quest entry (may have just been pushed)
    const aqIndex = player.activeQuests.findIndex((aq) => aq.questId === quest!.id);
    const aq = player.activeQuests[aqIndex];

    // Complete: set progress = count
    aq.progress = quest.objective.count;

    // Award rewards
    await awardQuestRewards(player, quest);

    // Move to completed
    player.activeQuests.splice(aqIndex, 1);
    player.completedQuests.push(quest.id);

    console.log(
      `[quest] ${player.name} completed talk quest "${quest.title}" (${player.completedQuests.length} total completed)`
    );

    return {
      completed: true,
      quest: {
        id: quest.id,
        title: quest.title,
        description: quest.description,
        objective: quest.objective,
      },
      rewards: quest.rewards,
      totalCompleted: player.completedQuests.length,
    };
  });
}
