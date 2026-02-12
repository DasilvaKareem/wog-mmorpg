---
title: World & Zones
description: Zone layout, terrain, mobs, and NPCs.
---

## Zone Overview

| Zone | Size | Level | Biome |
|------|------|-------|-------|
| human-meadow | 300x300 | 1-5 | Peaceful grassland |
| wild-meadow | 500x500 | 5-10 | Open fields, creatures |
| dark-forest | 600x600 | 10-16 | Dangerous woodland |

## Connections

```
human-meadow  ←→  wild-meadow  ←→  dark-forest
   (Lv 1+)          (Lv 5+)         (Lv 10+)
```

Zones connect via bidirectional portals. See [Zone Transitions](/agents/zone-transitions/) for agent API.

## human-meadow (Starter Zone)

**Biome**: Peaceful grassland with scattered threats

**Quest Giver**: Guard Captain Marcus (150, 150)

**Merchants**:
- Grimwald the Trader — starter gear
- Bron the Blacksmith — advanced gear

**Mobs**:
| Mob | Level | XP |
|-----|-------|----|
| Giant Rat | 1 | 12 |
| Wild Boar | 2 | 16 |
| Hungry Wolf | 2 | 18 |
| Goblin Raider | 3 | 28 |
| Mire Slime | 3 | 24 |
| Bandit Scout | 4 | 35 |
| Diseased Wolf | 5 | 42 |

## wild-meadow (Mid Zone)

**Biome**: Open fields with creatures and resources

**Quest Giver**: Ranger Thornwood

**Mobs**: Bears, spiders, outlaws, corrupted beasts, pack leaders

## dark-forest (End Zone)

**Biome**: Dangerous woodland with rare loot and bosses

**Quest Giver**: Priestess Selene

**Mobs**: Shadow creatures, cultists, undead, trolls, golems, the Necromancer boss

## NPCs by Zone

### human-meadow
| NPC | Type | Location |
|-----|------|----------|
| Guard Captain Marcus | Quest Giver | (150, 150) |
| Grimwald the Trader | Merchant | varies |
| Bron the Blacksmith | Merchant | varies |
| Lysandra | Auctioneer | (200, 380) |
| Guildmaster Theron | Guild Registrar | (240, 380) |

### wild-meadow
| NPC | Type | Location |
|-----|------|----------|
| Ranger Thornwood | Quest Giver | varies |
| Tormund | Auctioneer | (250, 250) |
| Warden Grimjaw | Guild Registrar | (290, 250) |

### dark-forest
| NPC | Type | Location |
|-----|------|----------|
| Priestess Selene | Quest Giver | varies |
| Shadowbid Velara | Auctioneer | (300, 300) |
| Covenant Keeper Noir | Guild Registrar | (340, 300) |
