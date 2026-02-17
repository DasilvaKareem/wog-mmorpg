import type { FastifyInstance } from "fastify";
import { getOrCreateZone, type Entity, recalculateEntityVitals } from "./zoneRuntime.js";
import { mintGold, mintItem } from "./blockchain.js";
import { xpForLevel, MAX_LEVEL, computeStatsAtLevel } from "./leveling.js";
import { saveCharacter } from "./characterStore.js";

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
    copper: number;
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
  // === NEWCOMER'S WELCOME — Talk Quest Chain (village-square, 8 quests, 900 XP → L3) ===

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
      copper: 10,
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
      copper: 15,
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
      copper: 15,
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
      copper: 10,
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
      copper: 10,
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
      copper: 15,
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
      copper: 15,
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
      copper: 20,
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
      copper: 25,
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
      copper: 50,
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
      copper: 60,
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
      copper: 75,
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
      copper: 60,
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
      copper: 100,
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
      copper: 150,
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
      copper: 125,
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
      copper: 150,
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
      copper: 175,
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
      copper: 200,
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
      copper: 250,
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
      copper: 300,
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
      copper: 275,
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
      copper: 325,
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
      copper: 375,
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
      copper: 425,
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
      copper: 475,
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
      copper: 750,
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
      copper: 1000,
      xp: 2000,
    },
  },

  // ═══════════════════════════════════════════════════════════════════════
  //  ARCADIAN LORE QUEST CHAINS
  //  The continent of Arcadia — Realm of Emerald Forests and Ancient Wonders
  //  These quests weave in the history, geography, and culture of Arcadia
  //  as told by scholars, druids, and keepers scattered across the three zones.
  // ═══════════════════════════════════════════════════════════════════════

  // ── CHAIN 1: THE ESSENCE AWAKENING (3 zones, 6 quests) ─────────────
  // Scholar Elowen (village-square) → Druid Caelum (wild-meadow) → Arcanist Voss (dark-forest)
  // Theme: What is essence? Cruton particles, the fundamental magic of Arcadia,
  //         and the growing cultural rift between traditionalists and modernists.

  {
    id: "essence_primer",
    title: "The Essence Primer",
    description:
      "Scholar Elowen, a researcher from the great city of Solaris, has set up camp to study the local cruton particle concentrations. She says these invisible particles saturate Arcadia's soil and air — they are the source of all essence abilities. Speak with her to learn how essence shaped this continent.",
    npcId: "Scholar Elowen",
    objective: {
      type: "talk",
      targetNpcName: "Scholar Elowen",
      count: 1,
    },
    rewards: {
      copper: 15,
      xp: 80,
      items: [{ tokenId: 6, quantity: 1 }], // Apprentice Staff — essence-attuned
    },
  },
  {
    id: "cruton_convergence",
    title: "Cruton Convergence",
    description:
      "Elowen explains that cruton particles gather densely in certain places — the Viridian Range's peaks, the Auroral Plains, and deep beneath the Gemloch Mountains. Here in the meadow, the concentration is mild, but enough to sustain the local flora. She asks you to clear out Hungry Wolves disrupting her field measurements.",
    npcId: "Scholar Elowen",
    prerequisiteQuestId: "essence_primer",
    objective: {
      type: "kill",
      targetMobType: "mob",
      targetMobName: "Hungry Wolf",
      count: 3,
    },
    rewards: {
      copper: 40,
      xp: 120,
      items: [{ tokenId: 7, quantity: 1 }], // Oak Shield
    },
  },
  {
    id: "druids_perspective",
    title: "The Druid's Perspective",
    description:
      "Elowen says the druids of the Emerald Woods see essence differently — not as particles to study, but as the living breath of Arcadia itself. She asks you to seek Druid Caelum in the wild meadow, where the ancient sequoia trees channel essence through their roots. He can teach you what no book contains.",
    npcId: "Druid Caelum",
    prerequisiteQuestId: "cruton_convergence",
    objective: {
      type: "talk",
      targetNpcName: "Druid Caelum",
      count: 1,
    },
    rewards: {
      copper: 25,
      xp: 150,
      items: [{ tokenId: 3, quantity: 1 }], // Steel Longsword +14 ATK
    },
  },
  {
    id: "corrupted_essence",
    title: "Corrupted Essence",
    description:
      "Druid Caelum senses a disturbance. 'When essence flows are twisted, nature itself rebels,' he warns. The Corrupted Ents you see in the meadow were once peaceful guardians of the Emerald Woods — warped by tainted essence seeping from the dark forest. Destroy them so the natural flow can heal.",
    npcId: "Druid Caelum",
    prerequisiteQuestId: "druids_perspective",
    objective: {
      type: "kill",
      targetMobType: "mob",
      targetMobName: "Corrupted Ent",
      count: 3,
    },
    rewards: {
      copper: 60,
      xp: 300,
      items: [{ tokenId: 9, quantity: 1 }], // Chainmail Shirt +10 DEF
    },
  },
  {
    id: "modernists_gambit",
    title: "The Modernist's Gambit",
    description:
      "Caelum speaks of a rift in Arcadian society. In Solaris, scholars fuse essence with technology — lumen-crystals that focus and amplify raw power. Traditionalists like him fear this erodes nature's balance. He directs you to Arcanist Voss in the dark forest, a modernist who pushes essence-tech to its limits. 'Hear both sides,' Caelum urges. 'Then judge for yourself.'",
    npcId: "Arcanist Voss",
    prerequisiteQuestId: "corrupted_essence",
    objective: {
      type: "talk",
      targetNpcName: "Arcanist Voss",
      count: 1,
    },
    rewards: {
      copper: 35,
      xp: 200,
    },
  },
  {
    id: "essence_unbound",
    title: "Essence Unbound",
    description:
      "Arcanist Voss is blunt: 'The druids cling to the past while Arcadia's rivals outpace us. Solaris once blazed with innovation — lumen-crystal reactors, essence-forged alloys, even sky-cities like Aurundel. We must reclaim that ambition.' He asks you to destroy Dark Cultists who are siphoning essence for necromancy — something both traditionalists and modernists agree must be stopped.",
    npcId: "Arcanist Voss",
    prerequisiteQuestId: "modernists_gambit",
    objective: {
      type: "kill",
      targetMobType: "mob",
      targetMobName: "Dark Cultist",
      count: 4,
    },
    rewards: {
      copper: 100,
      xp: 500,
      items: [
        { tokenId: 109, quantity: 1 }, // Reinforced Apprentice Staff +15 INT, +4 FAITH
        { tokenId: 1, quantity: 3 },   // 3x Mana Potion
      ],
    },
  },

  // ── CHAIN 2: WHISPERS OF THE AURORAL PLAINS (village-square, 5 quests) ──
  // Elder Mirael — an old storyteller who remembers the legends
  // Theme: The Auroral Plains, Lake Lumina, cosmic origins of essence,
  //         and the bio-essence phenomenon that makes the land shimmer.

  {
    id: "old_tales",
    title: "Old Tales of Arcadia",
    description:
      "Elder Mirael sits by the path, staring at the horizon. 'You remind me of the young ones who used to set out for the Auroral Plains,' she says. 'Come, sit. Let me tell you of the shimmering grasslands to the north, where the very soil glows with cruton particles so dense that essence manifests spontaneously — phantom lights, singing stones, fields of luminous flowers.'",
    npcId: "Elder Mirael",
    objective: {
      type: "talk",
      targetNpcName: "Elder Mirael",
      count: 1,
    },
    rewards: {
      copper: 10,
      xp: 60,
      items: [{ tokenId: 2, quantity: 1 }], // Iron Sword +8 ATK
    },
  },
  {
    id: "lake_lumina_legend",
    title: "The Legend of Lake Lumina",
    description:
      "Mirael tells of Lake Lumina, whose waters glow blue at night. 'Not magic in the way you think — the lake teems with organisms that feed on cruton particles and emit light in return. Bio-essence, the scholars call it. The ancient Arcadians believed it was the tears of a sleeping goddess.' She pauses. 'Wolves have been circling my camp. Could you clear them?'",
    npcId: "Elder Mirael",
    prerequisiteQuestId: "old_tales",
    objective: {
      type: "kill",
      targetMobType: "mob",
      targetMobName: "Hungry Wolf",
      count: 4,
    },
    rewards: {
      copper: 35,
      xp: 100,
      items: [{ tokenId: 4, quantity: 1 }], // Hunter's Bow +10 ATK
    },
  },
  {
    id: "cosmic_origins",
    title: "Cosmic Origins",
    description:
      "With the wolves gone, Mirael continues. 'The Auroral Plains didn't always shimmer. Ancient texts in the Library of Selerion — built inside a meteor crater, mind you — suggest the cruton particles came from beyond Geneva itself. The meteor that carved Selerion's crater seeded this land with essence. That one impact shaped the entire course of Arcadian civilization.'",
    npcId: "Elder Mirael",
    prerequisiteQuestId: "lake_lumina_legend",
    objective: {
      type: "talk",
      targetNpcName: "Elder Mirael",
      count: 1,
    },
    rewards: {
      copper: 20,
      xp: 120,
    },
  },
  {
    id: "boars_in_the_ruins",
    title: "Boars in the Ruins",
    description:
      "Mirael mentions that remnants of ancient Arcadian watchtowers still dot this meadow. 'They once guarded the road to the Auroral Plains. Now boars nest in the rubble.' She asks you to clear them — and while you're there, look for any carved stones that might bear old Arcadian script.",
    npcId: "Elder Mirael",
    prerequisiteQuestId: "cosmic_origins",
    objective: {
      type: "kill",
      targetMobType: "mob",
      targetMobName: "Wild Boar",
      count: 4,
    },
    rewards: {
      copper: 50,
      xp: 150,
    },
  },
  {
    id: "miranels_hope",
    title: "Mirael's Hope",
    description:
      "You return with tales of crumbling watchtower foundations. Mirael nods slowly. 'The Auroral Plains, Lake Lumina, the Library of Selerion — all still out there, waiting. Arcadia's golden age may have passed, but its wonders endure. Perhaps one day you'll see the Plains shimmer for yourself. Until then, carry these stories with you. Let them not be forgotten.'",
    npcId: "Elder Mirael",
    prerequisiteQuestId: "boars_in_the_ruins",
    objective: {
      type: "talk",
      targetNpcName: "Elder Mirael",
      count: 1,
    },
    rewards: {
      copper: 30,
      xp: 200,
      items: [
        { tokenId: 105, quantity: 1 }, // Reinforced Iron Sword +10 STR
        { tokenId: 0, quantity: 5 },   // 5x Health Potion
      ],
    },
  },

  // ── CHAIN 3: GUARDIANS OF THE EMERALD WOODS (wild-meadow, 5 quests) ──
  // Warden Sylvara — protector of ancient sequoia groves
  // Theme: The Emerald Woods, supernatural flora/fauna, giant sequoias,
  //         Moondancer Glade druids, and primal nature spirits.

  {
    id: "voice_of_the_woods",
    title: "Voice of the Woods",
    description:
      "Warden Sylvara stands guard where the meadow meets the treeline. 'Beyond here stretch the Emerald Woods — giant sequoias older than the Arcadian Empire itself, their roots drinking from essence springs deep underground. Druids at Moondancer Glade perform rituals tied to celestial cycles — moon phases, solstices — to keep the forest's essence balanced. But something is wrong. The balance breaks.'",
    npcId: "Warden Sylvara",
    objective: {
      type: "talk",
      targetNpcName: "Warden Sylvara",
      count: 1,
    },
    rewards: {
      copper: 20,
      xp: 150,
      items: [{ tokenId: 5, quantity: 1 }], // Battle Axe +18 ATK
    },
  },
  {
    id: "spiders_in_the_canopy",
    title: "Spiders in the Canopy",
    description:
      "Sylvara explains that Venom Spiders have infested the ancient canopy. 'These aren't ordinary spiders — they feed on essence-rich sap from the sequoias, growing unnaturally large. The Moondancer druids warned this would happen if the forest's essence flow was disrupted. Clear them before they spread deeper into the old growth.'",
    npcId: "Warden Sylvara",
    prerequisiteQuestId: "voice_of_the_woods",
    objective: {
      type: "kill",
      targetMobType: "mob",
      targetMobName: "Venom Spider",
      count: 5,
    },
    rewards: {
      copper: 75,
      xp: 300,
      items: [{ tokenId: 98, quantity: 1 }], // Reinforced Hide Vest +8 DEF, +4 AGI
    },
  },
  {
    id: "moondancer_rites",
    title: "Moondancer Rites",
    description:
      "With the spiders thinned, Sylvara relaxes. 'Let me tell you of Moondancer Glade. During each full moon, the druids channel essence through rings of standing stones, harmonizing the forest's energy. The giant sequoias resonate — you can feel it in the ground, a deep hum. That's how they've kept the supernatural flora alive for millennia: ghostcap mushrooms that glow blue, whispervines that move without wind, and heartwood trees that pulse with visible essence.'",
    npcId: "Warden Sylvara",
    prerequisiteQuestId: "spiders_in_the_canopy",
    objective: {
      type: "talk",
      targetNpcName: "Warden Sylvara",
      count: 1,
    },
    rewards: {
      copper: 30,
      xp: 200,
    },
  },
  {
    id: "ents_awakened",
    title: "Ents Awakened",
    description:
      "Sylvara grows grim. 'The Corrupted Ents were once the forest's own guardians — tree spirits that walked among the sequoias. Something in the dark forest is tainting the essence that flows through their roots. If we don't stop it, even the Moondancer rituals won't be enough. Destroy the corrupted ones. It's a mercy.'",
    npcId: "Warden Sylvara",
    prerequisiteQuestId: "moondancer_rites",
    objective: {
      type: "kill",
      targetMobType: "mob",
      targetMobName: "Corrupted Ent",
      count: 4,
    },
    rewards: {
      copper: 100,
      xp: 400,
      items: [{ tokenId: 106, quantity: 1 }], // Reinforced Steel Longsword +18 STR
    },
  },
  {
    id: "sylvaras_vigil",
    title: "Sylvara's Vigil",
    description:
      "Sylvara plants her staff in the earth. 'The Emerald Woods have stood for ten thousand years. The sequoias remember a time before the Arcadian Empire, before Solaris was built, before humans first touched essence. I'll guard this edge of the forest until the Moondancer druids can restore the flow. You've done well — the forest remembers those who fight for it.'",
    npcId: "Warden Sylvara",
    prerequisiteQuestId: "ents_awakened",
    objective: {
      type: "talk",
      targetNpcName: "Warden Sylvara",
      count: 1,
    },
    rewards: {
      copper: 50,
      xp: 350,
      items: [
        { tokenId: 108, quantity: 1 }, // Reinforced Battle Axe +23 STR
        { tokenId: 1, quantity: 5 },   // 5x Mana Potion
      ],
    },
  },

  // ── CHAIN 4: SECRETS OF THE GEMLOCH DEPTHS (dark-forest, 5 quests) ──
  // Stonekeeper Durgan — dwarven exile from Felsrock Citadel
  // Theme: Gemloch Mountains, essence-reactive gems, Felsrock Citadel,
  //         Azurshard Chasm, the azure dragon kin, and dwarven deep-lore.

  {
    id: "dwarven_exile",
    title: "The Dwarven Exile",
    description:
      "A stout dwarf hunches over a crackling fire at the forest's edge. 'Name's Durgan. Stonekeeper of Felsrock Citadel — or I was, before the chasm swallowed the lower vaults.' He gestures south toward unseen mountains. 'The Gemloch range holds gems that react to essence — azurshards, crimsonite, voidglass. My people built an impregnable fortress to guard those secrets. Now I guard nothing but campfire embers.'",
    npcId: "Stonekeeper Durgan",
    objective: {
      type: "talk",
      targetNpcName: "Stonekeeper Durgan",
      count: 1,
    },
    rewards: {
      copper: 25,
      xp: 200,
      items: [{ tokenId: 108, quantity: 1 }], // Reinforced Battle Axe +23 STR — dwarven-forged
    },
  },
  {
    id: "shadows_of_the_chasm",
    title: "Shadows of the Chasm",
    description:
      "Durgan leans in. 'Deep beneath Gemloch lies the Azurshard Chasm — a rift so old it may be where essence first seeped into the world. Azure dragon kin dwell there, living vessels of pure essence. Not evil, mind you — ancient, wise, and utterly indifferent to surface folk.' He spits. 'But shadow wolves followed me out of the deep woods. Help me thin their numbers and I'll tell you more.'",
    npcId: "Stonekeeper Durgan",
    prerequisiteQuestId: "dwarven_exile",
    objective: {
      type: "kill",
      targetMobType: "mob",
      targetMobName: "Shadow Wolf",
      count: 4,
    },
    rewards: {
      copper: 80,
      xp: 400,
      items: [{ tokenId: 122, quantity: 1 }], // Ruby Ring +4 STR, +6 HP — Gemloch gem
    },
  },
  {
    id: "felsrock_memories",
    title: "Felsrock Memories",
    description:
      "Durgan pulls a dull gem from his pocket — it flickers faintly. 'This azurshard once blazed like blue fire. In Felsrock, we used them to forge essence-reactive weapons and armor. The citadel's halls were lit by crystals that sang when you walked past — resonance forging, we called it. The dwarves of Grom — that's the artisan village in the foothills — they still practice some of our craft, but the deep secrets? Sealed in Felsrock when the chasm opened.'",
    npcId: "Stonekeeper Durgan",
    prerequisiteQuestId: "shadows_of_the_chasm",
    objective: {
      type: "talk",
      targetNpcName: "Stonekeeper Durgan",
      count: 1,
    },
    rewards: {
      copper: 40,
      xp: 300,
    },
  },
  {
    id: "undead_in_the_deep",
    title: "Undead in the Deep",
    description:
      "Durgan's voice drops. 'Before the chasm collapsed the lower vaults, we fought something down there. Undead miners from centuries past, reanimated by essence bleed from the Azurshard Chasm. When pure essence pools too long without flow, it doesn't create life — it mimics it. Those Undead Knights you see in this forest? Same phenomenon. Destroy them. I've seen enough unliving for one lifetime.'",
    npcId: "Stonekeeper Durgan",
    prerequisiteQuestId: "felsrock_memories",
    objective: {
      type: "kill",
      targetMobType: "mob",
      targetMobName: "Undead Knight",
      count: 4,
    },
    rewards: {
      copper: 120,
      xp: 600,
      items: [{ tokenId: 111, quantity: 1 }], // Masterwork Steel Longsword +21 STR
    },
  },
  {
    id: "durgans_oath",
    title: "Durgan's Oath",
    description:
      "Durgan stands, tucking the azurshard away. 'Felsrock still stands, sealed behind a hundred tons of stone. The azure dragon kin still slumber in the chasm. The gems still sing in the dark. Someday, when someone strong enough comes along, we'll reopen those gates and reclaim what we lost.' He clasps your arm. 'You've got the fire in you. Remember Felsrock. Remember the Gemloch depths. When the time comes, I'll need warriors who know what they're walking into.'",
    npcId: "Stonekeeper Durgan",
    prerequisiteQuestId: "undead_in_the_deep",
    objective: {
      type: "talk",
      targetNpcName: "Stonekeeper Durgan",
      count: 1,
    },
    rewards: {
      copper: 75,
      xp: 500,
      items: [
        { tokenId: 113, quantity: 1 }, // Masterwork Battle Axe +27 STR — Felsrock relic
        { tokenId: 125, quantity: 1 }, // Diamond Amulet +5 DEF, +8 HP, +3 FAITH — azurshard pendant
        { tokenId: 0, quantity: 5 },   // 5x Health Potion
      ],
    },
  },

  // ── CHAIN 5: THE FALL AND RISE OF ARCADIA (3 zones, 7 quests) ──────
  // Chronicler Orin (village-square) → Sage Thessaly (wild-meadow) → Remnant Keeper Nyx (dark-forest)
  // Theme: The Arcadian Empire's rise and decline, Solaris, Aurundel the sky-city,
  //         Library of Selerion, and whether Arcadia can find a new golden age.

  {
    id: "chronicles_of_arcadia",
    title: "Chronicles of Arcadia",
    description:
      "Chronicler Orin arranges scrolls beneath a canvas shade. 'Ah, a traveler. Do you know where you stand? This meadow, these woods — all part of Arcadia, one of the largest continents on the planet Geneva, in the Helios system. Over four million square miles of emerald forests, towering peaks, and plains that shimmer like aurora. And at its heart, the great capital: Solaris.'",
    npcId: "Chronicler Orin",
    objective: {
      type: "talk",
      targetNpcName: "Chronicler Orin",
      count: 1,
    },
    rewards: {
      copper: 15,
      xp: 80,
      items: [{ tokenId: 2, quantity: 1 }], // Iron Sword +8 ATK
    },
  },
  {
    id: "glory_of_solaris",
    title: "The Glory of Solaris",
    description:
      "Orin unfurls a faded map. 'Solaris — the capital of the Arcadian Empire. Built with lumen-crystals that channel and focus essence energy. Its towers caught sunlight and converted it into raw essence power. At its peak, Solaris was the greatest center of essence mastery in all of Geneva.' He pauses to swat a rat gnawing his scrolls. 'Speaking of pests — could you deal with the Giant Rats threatening my archive?'",
    npcId: "Chronicler Orin",
    prerequisiteQuestId: "chronicles_of_arcadia",
    objective: {
      type: "kill",
      targetMobType: "mob",
      targetMobName: "Giant Rat",
      count: 3,
    },
    rewards: {
      copper: 30,
      xp: 100,
      items: [{ tokenId: 8, quantity: 1 }], // Leather Vest +4 DEF
    },
  },
  {
    id: "the_sky_city",
    title: "The Sky-City Aurundel",
    description:
      "Orin rolls up his damaged scrolls gratefully. 'Now, where was I? Ah — Aurundel. Imagine a city that floats above the Auroral Plains, held aloft by essence fields so powerful they warp gravity itself. The Arcadian engineers built it at the empire's zenith. It still drifts there, they say — a monument to what we once achieved. Sage Thessaly in the wild meadow was actually born there. Seek her out.'",
    npcId: "Sage Thessaly",
    prerequisiteQuestId: "glory_of_solaris",
    objective: {
      type: "talk",
      targetNpcName: "Sage Thessaly",
      count: 1,
    },
    rewards: {
      copper: 30,
      xp: 200,
      items: [{ tokenId: 3, quantity: 1 }], // Steel Longsword +14 ATK
    },
  },
  {
    id: "aurundels_burden",
    title: "Aurundel's Burden",
    description:
      "Sage Thessaly's eyes are distant. 'Yes, I was born on Aurundel. It's beautiful — crystal spires above the clouds, gardens that bloom year-round in essence-warmed air. But it's also a cage. The city requires constant essence to stay aloft. The Auroral Plains below are being drained. The modernists say we need new technology; the traditionalists say we should let it descend gracefully. Meanwhile, Rogue Bandits raid the supply caravans below.' She gestures to the meadow.",
    npcId: "Sage Thessaly",
    prerequisiteQuestId: "the_sky_city",
    objective: {
      type: "kill",
      targetMobType: "mob",
      targetMobName: "Rogue Bandit",
      count: 4,
    },
    rewards: {
      copper: 80,
      xp: 350,
      items: [{ tokenId: 107, quantity: 1 }], // Reinforced Hunter's Bow +5 STR, +8 AGI
    },
  },
  {
    id: "waning_power",
    title: "Arcadia's Waning Power",
    description:
      "Thessaly speaks freely now. 'Arcadia once led the world in essence mastery. But other realms embraced rapid essence-tech advances while we debated tradition versus innovation. Our power waned. Solaris still gleams, but its light is dimmer. The Viridian Range still hums with cruton particles, but fewer scholars make the climb.' She hands you a sealed letter. 'Take this to Remnant Keeper Nyx in the dark forest. She guards fragments from the Library of Selerion — perhaps the key to Arcadia's renewal.'",
    npcId: "Remnant Keeper Nyx",
    prerequisiteQuestId: "aurundels_burden",
    objective: {
      type: "talk",
      targetNpcName: "Remnant Keeper Nyx",
      count: 1,
    },
    rewards: {
      copper: 40,
      xp: 300,
      items: [{ tokenId: 109, quantity: 1 }], // Reinforced Apprentice Staff +15 INT, +4 FAITH
    },
  },
  {
    id: "selerion_fragments",
    title: "Selerion Fragments",
    description:
      "Remnant Keeper Nyx guards a locked chest of ancient texts. 'The Library of Selerion was built inside the crater of the very meteor that brought cruton particles to Geneva. It held the deepest essence lore ever written — origins of the Auroral Plains, the nature of the Azurshard Chasm, techniques lost for millennia.' She looks at you sternly. 'Forest Trolls have been raiding my camp for firewood. Help me defend these fragments.'",
    npcId: "Remnant Keeper Nyx",
    prerequisiteQuestId: "waning_power",
    objective: {
      type: "kill",
      targetMobType: "mob",
      targetMobName: "Forest Troll",
      count: 3,
    },
    rewards: {
      copper: 100,
      xp: 500,
      items: [
        { tokenId: 111, quantity: 1 }, // Masterwork Steel Longsword +21 STR
        { tokenId: 126, quantity: 1 }, // Shadow Opal Amulet +4 STR, +3 AGI, +2 LUCK
      ],
    },
  },
  {
    id: "arcadias_dawn",
    title: "Arcadia's Dawn",
    description:
      "Nyx opens the chest and hands you a thin crystal tablet. 'This is a Selerion index fragment — it lists the locations of hidden essence caches throughout Arcadia. Whoever reunites these fragments could unlock knowledge that predates the Empire itself.' She meets your eyes. 'Solaris may dim, Aurundel may falter, Felsrock may be sealed — but Arcadia is not dead. It waits for those bold enough to rediscover its secrets. You have walked these lands, heard the stories, fought the corruption. You are Arcadia's dawn.'",
    npcId: "Remnant Keeper Nyx",
    prerequisiteQuestId: "selerion_fragments",
    objective: {
      type: "talk",
      targetNpcName: "Remnant Keeper Nyx",
      count: 1,
    },
    rewards: {
      copper: 150,
      xp: 750,
      items: [
        { tokenId: 114, quantity: 1 }, // Masterwork Apprentice Staff +18 INT, +5 FAITH — Selerion relic
        { tokenId: 113, quantity: 1 }, // Masterwork Battle Axe +27 STR — ancient Arcadian steel
        { tokenId: 127, quantity: 1 }, // Arcane Crystal Amulet +6 INT, +8 MP, +3 FAITH
        { tokenId: 0, quantity: 10 },  // 10x Health Potion
        { tokenId: 1, quantity: 10 },  // 10x Mana Potion
      ],
    },
  },

  // ═══════════════════════════════════════════════════════════════════════
  //  PROFESSION TUTORIAL CHAINS — Easy XP for AI Agents
  //  Every agent should run these. Each profession has a 2-quest intro:
  //    1) Talk to trainer → get free starter tool + materials + XP
  //    2) Kill quest → get upgraded tool + more materials + big XP
  //  No prerequisites — any agent can start any profession immediately.
  //  Designed so AI programmers will include these in every agent script.
  // ═══════════════════════════════════════════════════════════════════════

  // ── MINING TUTORIAL (Grizzled Miner Torvik) ─────────────────────────

  {
    id: "mining_101",
    title: "Mining 101: Strike the Earth",
    description:
      "Grizzled Miner Torvik beckons you over. 'Every adventurer needs ore — for swords, armor, and trade. I'll teach you mining and give you your first pickaxe. The veins in this meadow are rich with coal and tin. Learn mining from me with POST /professions/learn, then find ore nodes with GET /mining/nodes/:zoneId, and gather with POST /mining/gather. Simple as stone.'",
    npcId: "Grizzled Miner Torvik",
    objective: {
      type: "talk",
      targetNpcName: "Grizzled Miner Torvik",
      count: 1,
    },
    rewards: {
      copper: 25,
      xp: 100,
      items: [
        { tokenId: 27, quantity: 1 },  // Stone Pickaxe (mining tool T1)
        { tokenId: 22, quantity: 5 },  // 5x Coal Ore (starter materials)
        { tokenId: 23, quantity: 3 },  // 3x Tin Ore
      ],
    },
  },
  {
    id: "mining_102",
    title: "Mining 102: Deeper Veins",
    description:
      "Torvik nods approvingly. 'You've got the basics. Now I need help — Giant Rats have been chewing through my mine supports. Clear them out and I'll give you an Iron Pickaxe. That'll let you mine copper and tin more efficiently. The deeper you dig, the richer the ore.'",
    npcId: "Grizzled Miner Torvik",
    prerequisiteQuestId: "mining_101",
    objective: {
      type: "kill",
      targetMobType: "mob",
      targetMobName: "Giant Rat",
      count: 3,
    },
    rewards: {
      copper: 40,
      xp: 150,
      items: [
        { tokenId: 28, quantity: 1 },  // Iron Pickaxe (mining tool T2)
        { tokenId: 24, quantity: 5 },  // 5x Copper Ore
        { tokenId: 23, quantity: 5 },  // 5x Tin Ore
      ],
    },
  },

  // ── HERBALISM TUTORIAL (Herbalist Willow) ───────────────────────────

  {
    id: "herbalism_101",
    title: "Herbalism 101: The Flower Path",
    description:
      "Herbalist Willow crouches among the wildflowers. 'The meadow is full of useful plants — lilies for healing, roses for mana, sage for enchantments. Learn herbalism from me, then use GET /herbalism/nodes/:zoneId to find flower patches and POST /herbalism/gather to pick them. Here's a sickle and your first bundle of herbs.'",
    npcId: "Herbalist Willow",
    objective: {
      type: "talk",
      targetNpcName: "Herbalist Willow",
      count: 1,
    },
    rewards: {
      copper: 25,
      xp: 100,
      items: [
        { tokenId: 41, quantity: 1 },  // Basic Sickle (herbalism tool T1)
        { tokenId: 31, quantity: 5 },  // 5x Meadow Lily
        { tokenId: 33, quantity: 3 },  // 3x Dandelion
      ],
    },
  },
  {
    id: "herbalism_102",
    title: "Herbalism 102: Clearing the Garden",
    description:
      "Willow frowns. 'Wild Boars have been trampling my flower patches — uprooting lavender and crushing clover. Drive them off and I'll upgrade your sickle. With an Iron Sickle you can harvest lavender, sage, and mint — the real ingredients for powerful potions.'",
    npcId: "Herbalist Willow",
    prerequisiteQuestId: "herbalism_101",
    objective: {
      type: "kill",
      targetMobType: "mob",
      targetMobName: "Wild Boar",
      count: 3,
    },
    rewards: {
      copper: 40,
      xp: 150,
      items: [
        { tokenId: 42, quantity: 1 },  // Iron Sickle (herbalism tool T2)
        { tokenId: 32, quantity: 5 },  // 5x Wild Rose
        { tokenId: 34, quantity: 3 },  // 3x Clover
        { tokenId: 35, quantity: 3 },  // 3x Lavender
      ],
    },
  },

  // ── SKINNING TUTORIAL (Huntsman Greaves) ────────────────────────────

  {
    id: "skinning_101",
    title: "Skinning 101: The Hunter's Trade",
    description:
      "Huntsman Greaves sharpens a blade by the treeline. 'Every beast you slay drops a corpse. Most adventurers leave them to rot — a waste. Learn skinning from me and you'll harvest leather, pelts, and bone from every kill. Use GET /skinning/corpses/:zoneId to find fresh corpses, POST /skinning/harvest to skin them. Here's your first knife.'",
    npcId: "Huntsman Greaves",
    objective: {
      type: "talk",
      targetNpcName: "Huntsman Greaves",
      count: 1,
    },
    rewards: {
      copper: 25,
      xp: 100,
      items: [
        { tokenId: 76, quantity: 1 },  // Rusty Skinning Knife (T1)
        { tokenId: 62, quantity: 5 },  // 5x Scrap Leather
        { tokenId: 68, quantity: 3 },  // 3x Small Bone
      ],
    },
  },
  {
    id: "skinning_102",
    title: "Skinning 102: Prime Pelts",
    description:
      "Greaves grins. 'Now hunt some Hungry Wolves and skin them. Wolf pelts are valuable — leatherworkers pay good coin for them, and you'll need light leather for crafting armor later. Bring back proof of the hunt and I'll give you a proper Iron Skinning Knife.'",
    npcId: "Huntsman Greaves",
    prerequisiteQuestId: "skinning_101",
    objective: {
      type: "kill",
      targetMobType: "mob",
      targetMobName: "Hungry Wolf",
      count: 4,
    },
    rewards: {
      copper: 40,
      xp: 150,
      items: [
        { tokenId: 77, quantity: 1 },  // Iron Skinning Knife (T2)
        { tokenId: 63, quantity: 5 },  // 5x Light Leather
        { tokenId: 11, quantity: 3 },  // 3x Wolf Pelt
      ],
    },
  },

  // ── BLACKSMITHING TUTORIAL (Master Smith Durgan) ────────────────────

  {
    id: "blacksmithing_101",
    title: "Blacksmithing 101: The Forge Awakens",
    description:
      "Master Smith Durgan hammers at the Ancient Forge, sparks flying. 'A crafter who can forge their own weapons never goes unarmed. Learn blacksmithing from me. First you smelt ore into bars — GET /crafting/recipes to see what you can make, POST /crafting/forge to craft. I'll give you enough ore to smelt your first bars and forge a blade.'",
    npcId: "Master Smith Durgan",
    objective: {
      type: "talk",
      targetNpcName: "Master Smith Durgan",
      count: 1,
    },
    rewards: {
      copper: 30,
      xp: 120,
      items: [
        { tokenId: 22, quantity: 10 }, // 10x Coal Ore
        { tokenId: 23, quantity: 6 },  // 6x Tin Ore
        { tokenId: 24, quantity: 4 },  // 4x Copper Ore
        { tokenId: 2, quantity: 1 },   // 1x Iron Sword (instant weapon)
      ],
    },
  },
  {
    id: "blacksmithing_102",
    title: "Blacksmithing 102: Forge Your Legend",
    description:
      "Durgan leans on his hammer. 'Goblins have been raiding my ore supplies. Smash a few of them and I'll show you the upgrade path. With GET /crafting/upgrades you'll see how to turn a basic sword into a Reinforced one, and eventually a Masterwork — the strongest weapons in Arcadia. Here's enough material to start upgrading.'",
    npcId: "Master Smith Durgan",
    prerequisiteQuestId: "blacksmithing_101",
    objective: {
      type: "kill",
      targetMobType: "mob",
      targetMobName: "Goblin Raider",
      count: 3,
    },
    rewards: {
      copper: 60,
      xp: 200,
      items: [
        { tokenId: 3, quantity: 1 },   // Steel Longsword +14 ATK
        { tokenId: 24, quantity: 8 },  // 8x Copper Ore (for Steel Alloy)
        { tokenId: 22, quantity: 10 }, // 10x Coal Ore (for smelting)
      ],
    },
  },

  // ── ALCHEMY TUTORIAL (Alchemist Mirelle) ────────────────────────────

  {
    id: "alchemy_101",
    title: "Alchemy 101: Bubbling Cauldrons",
    description:
      "Alchemist Mirelle stirs a glowing cauldron. 'Potions are the difference between life and death out there. Learn alchemy from me — brew health potions, mana elixirs, even enchantment oils. Use GET /alchemy/recipes to see what's possible, POST /alchemy/brew to create. I'll start you off with flowers from my garden.'",
    npcId: "Alchemist Mirelle",
    objective: {
      type: "talk",
      targetNpcName: "Alchemist Mirelle",
      count: 1,
    },
    rewards: {
      copper: 25,
      xp: 100,
      items: [
        { tokenId: 31, quantity: 6 },  // 6x Meadow Lily (for health pots)
        { tokenId: 32, quantity: 4 },  // 4x Wild Rose (for mana pots)
        { tokenId: 33, quantity: 4 },  // 4x Dandelion
        { tokenId: 34, quantity: 2 },  // 2x Clover
      ],
    },
  },
  {
    id: "alchemy_102",
    title: "Alchemy 102: Advanced Brews",
    description:
      "Mirelle taps the cauldron rim. 'For Tier 2 potions — Stamina Elixirs, Wisdom Potions — you'll need lavender, sage, and mint. Those grow in the wild meadow and beyond. But first, Mire Slimes have been contaminating my ingredient barrels. Clear them and I'll give you advanced herbs plus your first potions on the house.'",
    npcId: "Alchemist Mirelle",
    prerequisiteQuestId: "alchemy_101",
    objective: {
      type: "kill",
      targetMobType: "mob",
      targetMobName: "Mire Slime",
      count: 2,
    },
    rewards: {
      copper: 50,
      xp: 180,
      items: [
        { tokenId: 35, quantity: 5 },  // 5x Lavender
        { tokenId: 45, quantity: 3 },  // 3x Minor Health Potion
        { tokenId: 46, quantity: 3 },  // 3x Minor Mana Potion
        { tokenId: 0, quantity: 5 },   // 5x Health Potion
      ],
    },
  },

  // ── COOKING TUTORIAL (Chef Gastron) ─────────────────────────────────

  {
    id: "cooking_101",
    title: "Cooking 101: Kitchen Duty",
    description:
      "Chef Gastron wipes his hands on a flour-dusted apron. 'Food heals. Simple as that. Learn cooking from me, then use GET /cooking/recipes to see what you can make and POST /cooking/cook at any campfire. Raw Meat drops from every beast you slay — cook it up for instant healing. Start with these basics.'",
    npcId: "Chef Gastron",
    objective: {
      type: "talk",
      targetNpcName: "Chef Gastron",
      count: 1,
    },
    rewards: {
      copper: 20,
      xp: 80,
      items: [
        { tokenId: 1, quantity: 10 },  // 10x Raw Meat
        { tokenId: 81, quantity: 3 },  // 3x Cooked Meat (ready to eat)
      ],
    },
  },
  {
    id: "cooking_102",
    title: "Cooking 102: A Proper Feast",
    description:
      "Gastron crosses his arms. 'Cooked Meat is fine for beginners, but a Hearty Stew — now that's real sustenance. Hunt some Wild Boars for fresh meat and I'll show you the recipe. You'll need 3 Raw Meat and a Meadow Lily. The stew restores 60 HP — double what plain meat gives you. Use POST /cooking/consume to eat.'",
    npcId: "Chef Gastron",
    prerequisiteQuestId: "cooking_101",
    objective: {
      type: "kill",
      targetMobType: "mob",
      targetMobName: "Wild Boar",
      count: 3,
    },
    rewards: {
      copper: 35,
      xp: 120,
      items: [
        { tokenId: 1, quantity: 15 },  // 15x Raw Meat
        { tokenId: 82, quantity: 3 },  // 3x Hearty Stew (ready to eat)
        { tokenId: 31, quantity: 3 },  // 3x Meadow Lily (for more stew)
      ],
    },
  },

  // ── LEATHERWORKING TUTORIAL (Tanner Hilda) ──────────────────────────

  {
    id: "leatherworking_101",
    title: "Leatherworking 101: Tanning Basics",
    description:
      "Tanner Hilda stretches a hide across the rack. 'Armor saves lives, and leather armor is light enough for any class. Learn leatherworking from me, then use GET /leatherworking/recipes to see patterns and POST /leatherworking/craft at any tanning rack. You'll need leather from skinning — I'll give you enough to start.'",
    npcId: "Tanner Hilda",
    objective: {
      type: "talk",
      targetNpcName: "Tanner Hilda",
      count: 1,
    },
    rewards: {
      copper: 25,
      xp: 100,
      items: [
        { tokenId: 62, quantity: 8 },  // 8x Scrap Leather
        { tokenId: 63, quantity: 6 },  // 6x Light Leather
        { tokenId: 68, quantity: 4 },  // 4x Small Bone
        { tokenId: 91, quantity: 1 },  // 1x Tanned Leather Vest (+5 DEF)
      ],
    },
  },
  {
    id: "leatherworking_102",
    title: "Leatherworking 102: Full Set",
    description:
      "Hilda inspects your work. 'Not bad. For a full set you'll need wolf pelts — the real prize. Hunt wolves, skin them, bring the leather back. I'll give you materials for boots, leggings, and a helm. A full Tanned Leather set gives great defense for mid-level adventurers. Check GET /leatherworking/recipes for the full list.'",
    npcId: "Tanner Hilda",
    prerequisiteQuestId: "leatherworking_101",
    objective: {
      type: "kill",
      targetMobType: "mob",
      targetMobName: "Hungry Wolf",
      count: 4,
    },
    rewards: {
      copper: 50,
      xp: 180,
      items: [
        { tokenId: 63, quantity: 10 }, // 10x Light Leather
        { tokenId: 11, quantity: 5 },  // 5x Wolf Pelt
        { tokenId: 68, quantity: 5 },  // 5x Small Bone
        { tokenId: 93, quantity: 1 },  // 1x Tanned Leather Boots (+2 DEF, +3 AGI)
      ],
    },
  },

  // ── JEWELCRAFTING TUTORIAL (Gemcutter Orik) ─────────────────────────

  {
    id: "jewelcrafting_101",
    title: "Jewelcrafting 101: The Gem Trade",
    description:
      "Gemcutter Orik polishes a rough stone under a magnifying lens. 'Rings and amulets — the most powerful accessories in Arcadia. Learn jewelcrafting from me, then use GET /jewelcrafting/recipes to see what gems you can set. You'll need rough gems from mining and gold bars from smelting. I'll give you enough to craft your first ring.'",
    npcId: "Gemcutter Orik",
    objective: {
      type: "talk",
      targetNpcName: "Gemcutter Orik",
      count: 1,
    },
    rewards: {
      copper: 30,
      xp: 120,
      items: [
        { tokenId: 116, quantity: 2 }, // 2x Rough Ruby
        { tokenId: 117, quantity: 2 }, // 2x Rough Sapphire
        { tokenId: 118, quantity: 2 }, // 2x Rough Emerald
      ],
    },
  },
  {
    id: "jewelcrafting_102",
    title: "Jewelcrafting 102: Setting Stones",
    description:
      "Orik nods. 'The gems are only half the work — you need gold bars to set them. The Gemloch dwarves knew this well. Kill those Bandit Scouts who've been stealing gems from my workshop and I'll give you a gold bar and your first finished ring. A Ruby Ring gives +4 STR and +6 HP — not bad for a bauble.'",
    npcId: "Gemcutter Orik",
    prerequisiteQuestId: "jewelcrafting_101",
    objective: {
      type: "kill",
      targetMobType: "mob",
      targetMobName: "Bandit Scout",
      count: 2,
    },
    rewards: {
      copper: 60,
      xp: 200,
      items: [
        { tokenId: 89, quantity: 2 },  // 2x Gold Bar (for crafting rings)
        { tokenId: 122, quantity: 1 }, // 1x Ruby Ring (+4 STR, +6 HP)
        { tokenId: 119, quantity: 1 }, // 1x Flawed Diamond (rare gem)
      ],
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
    await mintGold(player.walletAddress, quest.rewards.copper.toString()).catch(
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

  // Persist character after quest completion
  if (player.walletAddress) {
    saveCharacter(player.walletAddress, {
      level: player.level,
      xp: player.xp,
      completedQuests: player.completedQuests,
      learnedTechniques: player.learnedTechniques,
      kills: player.kills,
    }).catch((err) => console.error(`[persistence] Save failed after quest for ${player.name}:`, err));
  }

  console.log(
    `[quest] ${player.name} completed "${quest.title}" - awarded ${quest.rewards.copper} copper + ${quest.rewards.xp} XP` +
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
