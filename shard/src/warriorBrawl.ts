#!/usr/bin/env tsx
/**
 * WARRIOR BRAWL — 8 Meathead Warriors
 *
 *   💪 THE BOYS
 *   ─────────────────────────────────
 *   Chadwick Thunderflex   (human)
 *   Brock Ironpump         (dwarf)
 *   Tank McSquats           (orc)
 *   Gunnar Gains            (human)
 *   Rex Deadlift            (dwarf)
 *   Bulk Brogan             (orc)
 *   Thad Benchpress         (human)
 *   Duke Proteinshake       (dwarf)
 *
 *   ACTIVITIES:
 *   - Kill mobs to level up (competitive kill tracking)
 *   - Buy weapons, armor, potions from NPC shops
 *   - Queue for 1v1 PvP Coliseum duels
 *   - Fight each other in the arena
 *   - Trade items on the auction house
 *   - Climb the leaderboard
 *
 * Usage: API_URL=https://your-server.com npx tsx src/warriorBrawl.ts
 */

import "dotenv/config";
import { privateKeyToAccount } from "viem/accounts";
import { authenticateWithWallet, createAuthenticatedAPI } from "./authHelper.js";

const PRIVATE_KEY = process.env.SERVER_PRIVATE_KEY!;
const WALLET = privateKeyToAccount(PRIVATE_KEY as `0x${string}`).address;

type ApiFunc = ReturnType<typeof createAuthenticatedAPI>;
let api: ApiFunc;
const ZONE = "village-square";

// =============================================================================
//  Types
// =============================================================================

interface Warrior {
  id: string;
  name: string;
  raceId: string;
  kills: number;
  pvpWins: number;
  pvpLosses: number;
  itemsBought: number;
  auctionsCreated: number;
}

// =============================================================================
//  THE BOYS
// =============================================================================

const WARRIOR_DEFS = [
  { name: "Chadwick Thunderflex",  raceId: "human", x: 140, y: 140 },
  { name: "Brock Ironpump",       raceId: "dwarf", x: 150, y: 145 },
  { name: "Tank McSquats",        raceId: "human", x: 160, y: 140 },
  { name: "Gunnar Gains",         raceId: "human", x: 170, y: 145 },
  { name: "Rex Deadlift",         raceId: "dwarf", x: 180, y: 140 },
  { name: "Bulk Brogan",          raceId: "human", x: 190, y: 145 },
  { name: "Thad Benchpress",      raceId: "human", x: 200, y: 140 },
  { name: "Duke Proteinshake",    raceId: "dwarf", x: 210, y: 145 },
];

const warriors: Warrior[] = [];

// =============================================================================
//  Helpers
// =============================================================================

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function log(name: string, msg: string) {
  const ts = new Date().toLocaleTimeString("en-US", { hour12: false });
  const short = name.split(" ")[0].padEnd(10);
  console.log(`  ${ts} [${short}] ${msg}`);
}

async function getZoneEntities() {
  const state = await api("GET", "/state");
  return state.zones[ZONE]?.entities ?? {};
}

async function getEntity(entityId: string) {
  const state = await api("GET", "/state");
  return state.zones[ZONE]?.entities?.[entityId];
}

async function findEntityByName(name: string): Promise<string | null> {
  const entities = await getZoneEntities();
  const entry = Object.entries(entities).find(([_, e]: any) => e.name === name);
  return entry ? entry[0] : null;
}

async function findEntitiesByType(type: string): Promise<Array<[string, any]>> {
  const entities = await getZoneEntities();
  return Object.entries(entities).filter(([_, e]: any) => e.type === type);
}

async function moveTo(entityId: string, x: number, y: number) {
  await api("POST", "/command", { zoneId: ZONE, entityId, action: "move", x, y });
  for (let i = 0; i < 30; i++) {
    await sleep(600);
    const e = await getEntity(entityId);
    if (!e) break;
    const dx = e.x - x;
    const dy = e.y - y;
    if (Math.sqrt(dx * dx + dy * dy) <= 15) break;
  }
}

async function moveNear(entityId: string, targetId: string) {
  const entities = await getZoneEntities();
  const target = entities[targetId];
  if (target) {
    await moveTo(entityId, target.x, target.y);
    await sleep(400);
  }
}

// =============================================================================
//  Scoreboard
// =============================================================================

function printScoreboard() {
  console.log(`
┌──────────────────────────────────────────────────────────────────────┐
│                     WARRIOR BRAWL LEADERBOARD                        │
├──────────────────────────────┬───────┬───────┬───────┬───────────────┤
│  Name                        │ Kills │ W/L   │ Buys  │ Auctions      │
├──────────────────────────────┼───────┼───────┼───────┼───────────────┤`);
  const sorted = [...warriors].sort((a, b) => (b.kills + b.pvpWins * 5) - (a.kills + a.pvpWins * 5));
  for (const w of sorted) {
    const name = w.name.padEnd(28);
    const kills = String(w.kills).padEnd(5);
    const wl = `${w.pvpWins}/${w.pvpLosses}`.padEnd(5);
    const buys = String(w.itemsBought).padEnd(5);
    const auctions = String(w.auctionsCreated).padEnd(13);
    console.log(`│  ${name}│ ${kills} │ ${wl} │ ${buys} │ ${auctions} │`);
  }
  console.log(`└──────────────────────────────┴───────┴───────┴───────┴───────────────┘`);
}

// =============================================================================
//  Talk Quest Chain
// =============================================================================

const NPC_ROUTE = [
  { name: "Guard Captain Marcus", x: 150, y: 150 },
  { name: "Grimwald the Trader", x: 180, y: 420 },
  { name: "Bron the Blacksmith", x: 220, y: 420 },
  { name: "Thrain Ironforge - Warrior Trainer", x: 100, y: 200 },
  { name: "Herbalist Willow", x: 340, y: 420 },
  { name: "Chef Gastron", x: 460, y: 420 },
  { name: "Grizzled Miner Torvik", x: 260, y: 420 },
  { name: "Guard Captain Marcus", x: 150, y: 150 },
];

async function runTalkQuests(w: Warrior) {
  log(w.name, "Starting talk quest grind...");
  for (const npc of NPC_ROUTE) {
    await moveTo(w.id, npc.x, npc.y);
    const npcId = await findEntityByName(npc.name);
    if (!npcId) continue;
    try {
      const result = await api("POST", "/quests/talk", { zoneId: ZONE, playerId: w.id, npcEntityId: npcId });
      log(w.name, `Talked to ${npc.name} -> +${result.rewards?.xp ?? 0}xp +${result.rewards?.gold ?? 0}g`);
    } catch {}
    await sleep(300);
  }
}

// =============================================================================
//  Lore Quests — Strong Weapon Rewards
// =============================================================================

const LORE_NPC_ROUTE = [
  { name: "Scholar Elowen", x: 120, y: 380 },
  { name: "Elder Mirael", x: 80, y: 300 },
  { name: "Chronicler Orin", x: 60, y: 340 },
];

async function runLoreQuests(w: Warrior) {
  log(w.name, "Running lore quests for weapon rewards...");
  for (const npc of LORE_NPC_ROUTE) {
    await moveTo(w.id, npc.x, npc.y);
    const npcId = await findEntityByName(npc.name);
    if (!npcId) continue;
    for (let i = 0; i < 5; i++) {
      try {
        const result = await api("POST", "/quests/talk", { zoneId: ZONE, playerId: w.id, npcEntityId: npcId });
        log(w.name, `${npc.name} -> +${result.rewards?.xp ?? 0}xp +${result.rewards?.gold ?? 0}g${result.rewards?.items?.length ? " + items!" : ""}`);
      } catch { break; }
      await sleep(300);
    }
  }
  log(w.name, "Lore quests done — got the good weapons now");
}

// =============================================================================
//  Guild DAO — The Boys DAO
// =============================================================================

let brawlGuildId: number | null = null;

async function createBrawlGuild() {
  const leader = warriors[0];
  log(leader.name, 'Founding "The Boys DAO"...');
  try {
    const result = await api("POST", "/guild/create", {
      founderAddress: WALLET,
      name: "The Boys",
      description: "Eight warriors, one goal: maximum gains. No skipping leg day.",
      initialDeposit: 100,
    });
    brawlGuildId = result.guildId;
    log(leader.name, `DAO "The Boys" created! (ID: ${result.guildId}, cost: ${result.totalCost}g)`);
    try {
      await api("POST", `/guild/${result.guildId}/deposit`, { memberAddress: WALLET, amount: 100 });
      log(leader.name, "Deposited 100g to The Boys DAO treasury — investing in gains");
    } catch {}
  } catch (e: any) {
    log(leader.name, `DAO creation failed: ${e.message?.slice(0, 80)}`);
  }
}

// =============================================================================
//  Equip Upgraded Gear — Stronger Weapons from Quests
// =============================================================================

const UPGRADED_WEAPONS = [
  { tokenId: 113, name: "Masterwork Battle Axe" },      // +27 STR
  { tokenId: 111, name: "Masterwork Steel Longsword" },  // +21 STR
  { tokenId: 108, name: "Reinforced Battle Axe" },       // +23 STR
  { tokenId: 106, name: "Reinforced Steel Longsword" },  // +18 STR
  { tokenId: 105, name: "Reinforced Iron Sword" },       // +10 STR
  { tokenId: 5, name: "Battle Axe" },                    // +18 ATK
  { tokenId: 3, name: "Steel Longsword" },               // +14 ATK
];

const UPGRADED_ARMOR = [
  { tokenId: 9, name: "Chainmail Shirt" },               // +10 DEF
  { tokenId: 98, name: "Reinforced Hide Vest" },         // +8 DEF, +4 AGI
];

const UPGRADED_ACCESSORIES = [
  { tokenId: 125, name: "Diamond Amulet" },              // +5 DEF, +8 HP, +3 FAITH
  { tokenId: 126, name: "Shadow Opal Amulet" },          // +4 STR, +3 AGI, +2 LUCK
  { tokenId: 122, name: "Ruby Ring" },                    // +4 STR, +6 HP
];

async function equipUpgradedGear(w: Warrior) {
  for (const weapon of UPGRADED_WEAPONS) {
    try {
      await api("POST", "/equipment/equip", { zoneId: ZONE, tokenId: weapon.tokenId, entityId: w.id, walletAddress: WALLET });
      log(w.name, `Equipped ${weapon.name} — now we're talking`);
      break;
    } catch {}
  }
  for (const armor of UPGRADED_ARMOR) {
    try {
      await api("POST", "/equipment/equip", { zoneId: ZONE, tokenId: armor.tokenId, entityId: w.id, walletAddress: WALLET });
      log(w.name, `Equipped ${armor.name}!`);
      break;
    } catch {}
  }
  for (const acc of UPGRADED_ACCESSORIES) {
    try {
      await api("POST", "/equipment/equip", { zoneId: ZONE, tokenId: acc.tokenId, entityId: w.id, walletAddress: WALLET });
      log(w.name, `Equipped ${acc.name}!`);
      break;
    } catch {}
  }
}

// =============================================================================
//  Equip Gear & Learn Techniques
// =============================================================================

const STARTER_GEAR = [
  { tokenId: 2, name: "Iron Sword" }, { tokenId: 8, name: "Leather Vest" },
  { tokenId: 10, name: "Iron Helm" }, { tokenId: 12, name: "Leather Leggings" },
  { tokenId: 13, name: "Traveler Boots" }, { tokenId: 14, name: "Bronze Shoulders" },
  { tokenId: 15, name: "Padded Gloves" }, { tokenId: 16, name: "Guard Belt" },
];

async function equipGear(w: Warrior) {
  for (const gear of STARTER_GEAR) {
    try { await api("POST", "/equipment/equip", { zoneId: ZONE, tokenId: gear.tokenId, entityId: w.id, walletAddress: WALLET }); } catch {}
    await sleep(200);
  }
  log(w.name, "Gear equipped — time to get swole");
}

async function learnTechniques(w: Warrior) {
  try {
    const trainers = await findEntitiesByType("trainer");
    if (trainers.length === 0) return;
    const available = await api("GET", `/techniques/available/${ZONE}/${w.id}`);
    const toLearn = available.techniques.filter((t: any) => !t.isLearned);
    for (const tech of toLearn) {
      try {
        await moveNear(w.id, trainers[0][0]);
        await api("POST", "/techniques/learn", { zoneId: ZONE, playerEntityId: w.id, techniqueId: tech.id, trainerEntityId: trainers[0][0] });
        await sleep(300);
      } catch {}
    }
    log(w.name, "All techniques learned — locked and loaded");
  } catch {}
}

// =============================================================================
//  Shop: Buy from NPC merchants
// =============================================================================

const SHOP_BUYS = [
  { tokenId: 20, name: "Health Potion", maxOwn: 5 },
  { tokenId: 21, name: "Mana Potion", maxOwn: 3 },
  { tokenId: 5, name: "Apprentice Staff", maxOwn: 1 },
  { tokenId: 4, name: "Hunter's Bow", maxOwn: 1 },
  { tokenId: 3, name: "Steel Longsword", maxOwn: 1 },
];

async function shopRun(w: Warrior) {
  // Find merchants
  const merchants = await findEntitiesByType("merchant");
  if (merchants.length === 0) return;

  const [merchantId, merchant] = merchants[0] as [string, any];
  await moveTo(w.id, merchant.x, merchant.y);

  // Browse catalog
  try {
    const catalog = await api("GET", `/shop/npc/${ZONE}/${merchantId}`);
    const items = catalog.shopItems ?? catalog.items ?? [];
    if (items.length > 0) {
      log(w.name, `Checking ${merchant.name}'s shop (${items.length} items)`);
    }
  } catch {}

  // Buy something useful
  const pick = SHOP_BUYS[Math.floor(Math.random() * SHOP_BUYS.length)];
  try {
    await api("POST", "/shop/buy", { buyerAddress: WALLET, tokenId: pick.tokenId, quantity: 1 });
    w.itemsBought++;
    log(w.name, `Bought ${pick.name} — gotta stay stacked`);
  } catch {}
}

// =============================================================================
//  Auction House: List items for sale
// =============================================================================

async function auctionRun(w: Warrior) {
  // Find auctioneer
  const auctioneers = await findEntitiesByType("auctioneer");
  if (auctioneers.length === 0) return;

  const [aucId, auc] = auctioneers[0] as [string, any];
  await moveTo(w.id, auc.x, auc.y);

  // Check current auctions
  try {
    const auctions = await api("GET", `/auctionhouse/${ZONE}/auctions`);
    const active = auctions.auctions ?? [];
    log(w.name, `Auction House: ${active.length} active listings`);

    // Bid on something if available
    if (active.length > 0) {
      const listing = active[0];
      try {
        await api("POST", `/auctionhouse/${ZONE}/bid`, {
          auctionId: listing.id ?? listing.auctionId,
          bidderAddress: WALLET,
          bidAmount: (listing.currentBid ?? listing.startingPrice ?? 5) + 1,
        });
        log(w.name, `Bid on auction — outbid everyone, obviously`);
      } catch {}
    }
  } catch {}

  // Try to list an item
  const listableItems = [
    { tokenId: 22, name: "Coal Ore", startPrice: 3 },
    { tokenId: 23, name: "Tin Ore", startPrice: 4 },
    { tokenId: 20, name: "Health Potion", startPrice: 8 },
  ];
  const item = listableItems[Math.floor(Math.random() * listableItems.length)];
  try {
    await api("POST", `/auctionhouse/${ZONE}/create`, {
      sellerAddress: WALLET,
      tokenId: item.tokenId,
      quantity: 1,
      startingPrice: item.startPrice,
      duration: 300,
    });
    w.auctionsCreated++;
    log(w.name, `Listed ${item.name} on AH — making gains on AND off the field`);
  } catch {}
}

// =============================================================================
//  PvP Coliseum: Queue & Fight
// =============================================================================

async function pvpQueue(w: Warrior) {
  const me = await getEntity(w.id);
  if (!me) return;

  log(w.name, "Heading to the Coliseum...");

  // Find arena master
  const arenaMasters = await findEntitiesByType("arena-master");
  if (arenaMasters.length === 0) { log(w.name, "No arena master found"); return; }

  const [amId, am] = arenaMasters[0] as [string, any];
  await moveTo(w.id, am.x, am.y);

  // Queue for 1v1
  try {
    await api("POST", "/api/pvp/queue/join", {
      agentId: w.id,
      walletAddress: WALLET,
      characterTokenId: "0",
      level: me.level ?? 1,
      format: "1v1",
    });
    log(w.name, "Queued for 1v1 — who wants this smoke?");
  } catch (e: any) {
    log(w.name, `Queue failed: ${e.message?.slice(0, 60)}`);
    return;
  }

  // Wait for match (poll for up to 2 minutes)
  let battleId: string | null = null;
  for (let i = 0; i < 24; i++) {
    await sleep(5000);
    try {
      const active = await api("GET", "/api/pvp/battles/active");
      const myBattle = active.battles?.find((b: any) =>
        b.combatants?.some((c: any) => c.agentId === w.id || c.id === w.id) ||
        b.teamRed?.some((c: any) => c.agentId === w.id || c.id === w.id) ||
        b.teamBlue?.some((c: any) => c.agentId === w.id || c.id === w.id)
      );
      if (myBattle) {
        battleId = myBattle.battleId ?? myBattle.id;
        log(w.name, `MATCH FOUND! Battle ${battleId?.slice(0, 8)}...`);
        break;
      }
    } catch {}

    // Check if still in queue
    try {
      const qStatus = await api("GET", "/api/pvp/queue/status/1v1");
      if (qStatus.playersInQueue === 0) break;
    } catch {}
  }

  if (!battleId) {
    log(w.name, "No match found — leaving queue");
    try { await api("POST", "/api/pvp/queue/leave", { agentId: w.id, format: "1v1" }); } catch {}
    return;
  }

  // FIGHT!
  await pvpFight(w, battleId);
}

async function pvpFight(w: Warrior, battleId: string) {
  log(w.name, "ENTERING THE ARENA! LET'S GO!");

  for (let round = 0; round < 60; round++) {
    await sleep(2000);

    try {
      const state = await api("GET", `/api/pvp/battle/${battleId}`);
      const battle = state.battle;

      if (!battle || battle.status === "completed" || battle.status === "cancelled") {
        // Check result
        const winner = battle?.winner;
        const myTeam = battle?.config?.teamRed?.some((c: any) => c.agentId === w.id || c.id === w.id)
          ? "red" : "blue";

        if (winner === myTeam) {
          w.pvpWins++;
          log(w.name, `WON THE DUEL! (${w.pvpWins}W/${w.pvpLosses}L) — LIGHTWEIGHT BABY!`);
        } else if (winner) {
          w.pvpLosses++;
          log(w.name, `Lost the duel (${w.pvpWins}W/${w.pvpLosses}L) — just a warmup`);
        } else {
          log(w.name, "Battle ended — no contest");
        }
        return;
      }

      if (battle.status !== "in_progress") {
        continue; // Still in betting phase
      }

      // Find opponent
      const allCombatants = [
        ...(battle.config?.teamRed ?? []),
        ...(battle.config?.teamBlue ?? []),
      ];
      const opponent = allCombatants.find((c: any) =>
        c.agentId !== w.id && c.id !== w.id && (c.stats?.hp ?? c.hp ?? 0) > 0
      );

      if (!opponent) continue;

      // Attack!
      try {
        await api("POST", `/api/pvp/battle/${battleId}/action`, {
          actorId: w.id,
          actionId: "attack",
          targetId: opponent.id ?? opponent.agentId,
        });
      } catch {}
    } catch {}
  }
}

// =============================================================================
//  Weapon Enhancement: Upgrade + Alchemy + Enchanting
// =============================================================================

async function learnCraftingProfessions() {
  const leader = warriors[0];
  log(leader.name, "Learning blacksmithing + alchemy for weapon upgrades...");
  const profTrainers = await findEntitiesByType("profession-trainer");
  for (const [tId, trainer] of profTrainers as Array<[string, any]>) {
    if (trainer.teachesProfession === "blacksmithing" || trainer.teachesProfession === "alchemy") {
      await moveTo(leader.id, trainer.x, trainer.y);
      try {
        await api("POST", "/professions/learn", { walletAddress: WALLET, zoneId: ZONE, entityId: leader.id, trainerId: tId, professionId: trainer.teachesProfession });
        log(leader.name, `Learned ${trainer.teachesProfession} — knowledge is gains`);
      } catch { log(leader.name, `Already know ${trainer.teachesProfession}`); }
      await sleep(300);
    }
  }
}

async function upgradeAndEnchantWeapons(w: Warrior) {
  // Find crafting stations
  const forges = await findEntitiesByType("forge");
  const alchemyLabs = await findEntitiesByType("alchemy-lab");
  const altars = await findEntitiesByType("enchanting-altar");

  // --- WEAPON UPGRADES at Forge ---
  if (forges.length > 0) {
    const [forgeId, forge] = forges[0] as [string, any];
    await moveTo(w.id, forge.x, forge.y);

    const UPGRADE_PRIORITY = [
      "upgrade-battle-axe-masterwork", "upgrade-steel-longsword-masterwork",
      "upgrade-battle-axe-reinforced", "upgrade-steel-longsword-reinforced",
      "upgrade-iron-sword-masterwork", "upgrade-iron-sword-reinforced",
      "upgrade-hunters-bow-reinforced", "upgrade-apprentice-staff-reinforced",
    ];
    for (const upgradeId of UPGRADE_PRIORITY) {
      try {
        const result = await api("POST", "/crafting/upgrade", {
          walletAddress: WALLET, zoneId: ZONE, entityId: w.id, forgeId, recipeId: upgradeId,
        });
        log(w.name, `UPGRADED to ${result.crafted?.name ?? upgradeId}! — BEAST MODE`);
        if (result.crafted?.tokenId) {
          try {
            await api("POST", "/equipment/equip", { zoneId: ZONE, tokenId: Number(result.crafted.tokenId), entityId: w.id, walletAddress: WALLET });
            log(w.name, `Equipped upgraded weapon — time to dominate`);
          } catch {}
        }
        break;
      } catch {}
    }
  }

  // --- BREW ENCHANTMENT ELIXIRS at Alchemy Lab ---
  if (alchemyLabs.length > 0) {
    const [labId, lab] = alchemyLabs[0] as [string, any];
    await moveTo(w.id, lab.x, lab.y);
    const ELIXIR_RECIPES = ["sharpness-elixir", "shadow-enchantment", "fire-enchantment"];
    for (const recipe of ELIXIR_RECIPES) {
      try {
        await api("POST", "/alchemy/brew", { walletAddress: WALLET, zoneId: ZONE, entityId: w.id, alchemyLabId: labId, recipeId: recipe });
        log(w.name, `Brewed ${recipe} — alchemy gains`);
        break;
      } catch {}
    }
  }

  // --- ENCHANT WEAPON at Enchanter's Altar ---
  if (altars.length > 0) {
    const [altarId, altar] = altars[0] as [string, any];
    await moveTo(w.id, altar.x, altar.y);
    const ENCHANT_ELIXIRS = [60, 59, 55, 57]; // Sharpness +8 STR, Shadow +6 STR, Fire +5 STR, Lightning
    for (const elixirTokenId of ENCHANT_ELIXIRS) {
      try {
        await api("POST", "/enchanting/apply", {
          walletAddress: WALLET, zoneId: ZONE, entityId: w.id,
          altarId, enchantmentElixirTokenId: elixirTokenId, equipmentSlot: "weapon",
        });
        log(w.name, `Enchanted weapon — MAXIMUM POWER`);
        break;
      } catch {}
    }
  }
}

// =============================================================================
//  Main Warrior Loop — Kill mobs, shop, PvP, repeat
// =============================================================================

async function warriorMainLoop(w: Warrior) {
  let cycle = 0;

  while (true) {
    const me = await getEntity(w.id);
    if (!me) { await sleep(3000); continue; }

    // Every 10 cycles: go shopping
    if (cycle % 10 === 3) {
      try { await shopRun(w); } catch {}
      cycle++;
      await sleep(2000);
      continue;
    }

    // Every 15 cycles: check auction house
    if (cycle % 15 === 7) {
      try { await auctionRun(w); } catch {}
      cycle++;
      await sleep(2000);
      continue;
    }

    // Every 20 cycles: queue for PvP
    if (cycle % 20 === 0 && cycle > 0) {
      try { await pvpQueue(w); } catch (e: any) {
        log(w.name, `PvP error: ${e.message?.slice(0, 50)}`);
      }
      cycle++;
      await sleep(2000);
      continue;
    }

    // Every 25 cycles: upgrade & enchant weapons
    if (cycle % 25 === 12) {
      log(w.name, "Time to upgrade weapons — hitting the forge");
      try { await upgradeAndEnchantWeapons(w); } catch {}
      cycle++;
      await sleep(2000);
      continue;
    }

    // Default: KILL MOBS
    const hpPercent = (me.hp / me.maxHp) * 100;
    if (hpPercent < 25) {
      log(w.name, `HP low (${me.hp}/${me.maxHp}) — resting...`);
      await sleep(4000);
      cycle++;
      continue;
    }

    // Find strongest fightable mob
    const entities = await getZoneEntities();
    const mobs = Object.entries(entities)
      .filter(([_, e]: any) => (e.type === "mob" || e.type === "boss") && e.hp > 0)
      .filter(([_, e]: any) => (e.level ?? 1) <= (me.level ?? 1) + 2)
      .sort((a: any, b: any) => (b[1].level ?? 1) - (a[1].level ?? 1));

    if (mobs.length === 0) {
      log(w.name, "No mobs — flexing while waiting...");
      await sleep(5000);
      cycle++;
      continue;
    }

    // Pick a mob (stagger by warrior index to spread them out)
    const idx = warriors.indexOf(w);
    const mobPick = mobs[idx % mobs.length];
    const [mobId, mob] = mobPick as [string, any];
    const mobLevel = mob.level ?? 1;

    log(w.name, `Engaging ${mob.name} L${mobLevel} (${mob.hp}/${mob.maxHp} HP)`);
    await moveTo(w.id, mob.x, mob.y);

    // Use technique
    let usedTech = false;
    try {
      const learned = await api("GET", `/techniques/learned/${ZONE}/${w.id}`);
      const attacks = learned.techniques
        .filter((t: any) => t.type === "attack" && t.essenceCost <= (me.essence ?? 0))
        .sort((a: any, b: any) => (b.effects?.damageMultiplier ?? 0) - (a.effects?.damageMultiplier ?? 0));
      if (attacks.length > 0) {
        await api("POST", "/techniques/use", { zoneId: ZONE, casterEntityId: w.id, techniqueId: attacks[0].id, targetEntityId: mobId });
        log(w.name, `Used ${attacks[0].name}!`);
        usedTech = true;
      }
    } catch {}

    if (!usedTech) {
      try { await api("POST", "/command", { zoneId: ZONE, entityId: w.id, action: "attack", targetId: mobId }); } catch {}
    }

    // Wait for kill
    for (let i = 0; i < 40; i++) {
      await sleep(800);
      const entities = await getZoneEntities();
      const target = entities[mobId];
      const self = entities[w.id];
      if (!self) { log(w.name, "DIED! Time for a protein shake and respawn..."); await sleep(5000); break; }
      if (!target || target.hp <= 0) {
        w.kills++;
        log(w.name, `Killed ${mob.name} L${mobLevel}! (L${self.level} XP ${self.xp ?? 0}) [Kills: ${w.kills}]`);
        break;
      }
      // Buff mid-combat
      if (i % 5 === 0) {
        try {
          const learned = await api("GET", `/techniques/learned/${ZONE}/${w.id}`);
          const buffs = learned.techniques.filter((t: any) => t.type === "buff" && t.essenceCost <= (self.essence ?? 0));
          if (buffs.length > 0) {
            await api("POST", "/techniques/use", { zoneId: ZONE, casterEntityId: w.id, techniqueId: buffs[0].id });
            log(w.name, `Buffed with ${buffs[0].name}`);
          }
        } catch {}
      }
    }

    cycle++;
    await sleep(1500);
  }
}

// =============================================================================
//  Main
// =============================================================================

async function main() {
  console.log(`
╔══════════════════════════════════════════════════════════╗
║              WARRIOR BRAWL                               ║
║              8 Meathead Warriors Enter The Game          ║
║                                                          ║
║   Chadwick Thunderflex    Brock Ironpump                 ║
║   Tank McSquats           Gunnar Gains                   ║
║   Rex Deadlift            Bulk Brogan                    ║
║   Thad Benchpress         Duke Proteinshake              ║
║                                                          ║
║   KILL. SHOP. DUEL. REPEAT.                              ║
║                                                          ║
║   Wallet: ${WALLET.slice(0, 10)}...                                  ║
╚══════════════════════════════════════════════════════════╝
  `);

  // Authenticate
  console.log("  Authenticating...\n");
  try {
    const token = await authenticateWithWallet(PRIVATE_KEY);
    api = createAuthenticatedAPI(token);
  } catch (e: any) {
    console.log(`FATAL: ${e.message}`);
    process.exit(1);
  }

  // Spawn all warriors
  console.log("\n============================================================");
  console.log("  SPAWNING THE BOYS");
  console.log("============================================================\n");

  for (const def of WARRIOR_DEFS) {
    const data = await api("POST", "/spawn", {
      zoneId: ZONE, type: "player", name: def.name,
      x: def.x, y: def.y, walletAddress: WALLET,
      level: 1, xp: 0, raceId: def.raceId, classId: "warrior",
    });
    warriors.push({
      id: data.spawned.id, name: def.name, raceId: def.raceId,
      kills: 0, pvpWins: 0, pvpLosses: 0, itemsBought: 0, auctionsCreated: 0,
    });
    log(def.name, `spawned (${def.raceId} warrior) — HP ${data.spawned.hp}/${data.spawned.maxHp}`);
    await sleep(300);
  }

  // Talk quests (parallel batches of 4)
  console.log("\n============================================================");
  console.log("  QUEST GRIND (gotta get that XP)");
  console.log("============================================================\n");

  await Promise.all(warriors.slice(0, 4).map(w => runTalkQuests(w)));
  await Promise.all(warriors.slice(4).map(w => runTalkQuests(w)));

  // Lore quests — strong weapon rewards
  console.log("\n============================================================");
  console.log("  LORE QUESTS (strong weapon rewards)");
  console.log("============================================================\n");

  await Promise.all(warriors.slice(0, 4).map(w => runLoreQuests(w)));
  await Promise.all(warriors.slice(4).map(w => runLoreQuests(w)));

  // Equip gear + upgraded weapons + learn techniques
  console.log("\n============================================================");
  console.log("  GEARING UP (upgraded weapons)");
  console.log("============================================================\n");

  await Promise.all(warriors.map(async (w) => {
    await equipGear(w);
    await equipUpgradedGear(w);
    await learnTechniques(w);
  }));

  // Learn crafting professions for weapon upgrades
  console.log("\n============================================================");
  console.log("  LEARNING BLACKSMITHING + ALCHEMY (weapon enhancement)");
  console.log("============================================================\n");

  await learnCraftingProfessions();

  // Initial weapon upgrade + enchant pass
  console.log("\n============================================================");
  console.log("  UPGRADING & ENCHANTING WEAPONS");
  console.log("============================================================\n");

  await upgradeAndEnchantWeapons(warriors[0]);

  // Create guild DAO
  console.log("\n============================================================");
  console.log("  FOUNDING THE BOYS DAO");
  console.log("============================================================\n");

  await createBrawlGuild();

  // Print initial status
  const firstWarrior = await getEntity(warriors[0].id);
  console.log(`\n  All warriors ready — Level ${firstWarrior?.level ?? 1}\n`);
  printScoreboard();

  // Scoreboard ticker
  setInterval(() => { printScoreboard(); }, 30000);

  // Launch all warriors
  console.log("\n============================================================");
  console.log("  LET'S GO! ALL 8 WARRIORS ACTIVE");
  console.log("============================================================\n");

  await Promise.all(warriors.map(w => warriorMainLoop(w)));
}

main().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });
