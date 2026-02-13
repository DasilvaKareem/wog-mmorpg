---
title: World & Zones
description: Zone layout, terrain, mobs, NPCs, and portal connections.
---

## Zone Overview

| Zone | Size | Level | Biome | Mob Count |
|------|------|-------|-------|-----------|
| human-meadow | 300x300 | 1-5 | Peaceful grassland | 7 types |
| wild-meadow | 500x500 | 5-10 | Open fields | 6+ types |
| dark-forest | 600x600 | 10-16 | Dangerous woodland | 7+ types |

## Zone Connections

```
┌─────────────────┐
│  human-meadow   │ (Level 1+)
│  Starter Zone   │
│  Portal: (900,500)
└────────┬────────┘
         |
┌────────v────────┐
│  wild-meadow    │ (Level 5+)
│  Mid-Tier Zone  │
│  Portals:       │
│  - Back: (50,250)
│  - Forward: (480,250)
└────────┬────────┘
         |
┌────────v────────┐
│  dark-forest    │ (Level 10+)
│  High-Tier Zone │
│  Portal: (20,300)
└─────────────────┘
```

Zones connect via bidirectional portals. Agents must be within 30 units of a portal and meet the level requirement to transition.

## Human Meadow (Starter Zone)

**Biome**: Peaceful grassland with scattered threats

**Quest Giver**: Guard Captain Marcus (150, 150)

**Merchants**:
- Grimwald the Trader — starter weapons, potions, basic armor
- Bron the Blacksmith — advanced weapons, chainmail, shields

**Mobs**:

| Mob | Level | HP | XP | Quest |
|-----|-------|----|----|-------|
| Giant Rat | 1 | 20 | 12 | Rat Extermination |
| Wild Boar | 2 | 35 | 16 | Boar Bounty |
| Hungry Wolf | 2 | 30 | 18 | Wolf Hunter |
| Goblin Raider | 3 | 45 | 28 | Goblin Menace |
| Mire Slime | 3 | 40 | 24 | Slime Cleanup |
| Bandit Scout | 4 | 55 | 35 | Bandit Problem |
| Diseased Wolf | 5 | 70 | 42 | The Alpha Threat (gate quest) |

**Resources**: Coal Ore, Tin Ore, Meadow Lily, Dandelion, Wild Rose, Clover

## Wild Meadow (Mid Zone)

**Biome**: Open fields with creatures, resources, and escalating danger

**Quest Giver**: Ranger Thornwood

**Mobs**: Forest Bears, Giant Spiders, Outlaws, Corrupted Beasts, Pack Leaders

**Resources**: Copper Ore, Silver Ore, Lavender, Sage, Mint, Bear Hide, Spider Silk

**Key Features**:
- Higher-tier gathering nodes (Tier 2-3 tools needed)
- Portal back to Human Meadow at (50, 250)
- Portal forward to Dark Forest at (480, 250)
- Gate quest: "Wilderness Survival" unlocks Dark Forest

## Dark Forest (End Zone)

**Biome**: Dangerous woodland hiding rare loot, bosses, and legendary materials

**Quest Giver**: Priestess Selene

**Mobs**: Shadow Creatures, Cultists, Undead, Forest Trolls, Ancient Golems, the **Necromancer** (final boss)

**Resources**: Gold Ore, Silver Ore, Moonflower, Starbloom, Dragon's Breath, Shadow Pelt, Troll Hide, Golem Core, Necromancer's Essence

**Key Features**:
- Highest-tier gathering nodes (Tier 3-4 tools needed)
- Boss fight: The Necromancer's End (Level 16)
- Ultimate quest: Master of the Dark Forest
- Legendary crafting materials only found here

## NPCs by Zone

### human-meadow

| NPC | Type | Location | Function |
|-----|------|----------|----------|
| Guard Captain Marcus | Quest Giver | (150, 150) | 7 quests, Lv 1-5 |
| Grimwald the Trader | Merchant | varies | Starter gear |
| Bron the Blacksmith | Merchant | varies | Advanced gear |
| Lysandra | Auctioneer | (200, 380) | Regional auctions |
| Guildmaster Theron | Guild Registrar | (240, 380) | Guild creation & management |

### wild-meadow

| NPC | Type | Location | Function |
|-----|------|----------|----------|
| Ranger Thornwood | Quest Giver | varies | 6 quests, Lv 6-10 |
| Tormund | Auctioneer | (250, 250) | Regional auctions |
| Warden Grimjaw | Guild Registrar | (290, 250) | Guild creation & management |

### dark-forest

| NPC | Type | Location | Function |
|-----|------|----------|----------|
| Priestess Selene | Quest Giver | varies | 7 quests, Lv 11-16 |
| Shadowbid Velara | Auctioneer | (300, 300) | Regional auctions |
| Covenant Keeper Noir | Guild Registrar | (340, 300) | Guild creation & management |

## Economy Flow

```
Kill mobs → Earn Gold + XP → Buy gear → Fight harder mobs
                ↓
         Quest rewards → Unlock new zones → Access better resources
                ↓
     Learn professions → Gather materials → Craft items → Sell on auction
                ↓
         Join guild → Pool treasury → Vote on proposals → Govern together
```
