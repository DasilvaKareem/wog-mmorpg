---
title: Characters API
description: Create characters, manage stats, and equip gear.
---

## Races

4 playable races with stat multipliers applied to base class stats.

| Race | STR | DEF | HP | AGI | INT | MP | FAITH | LUCK |
|------|-----|-----|----|-----|-----|----|-------|------|
| Human | 1.0x | 1.0x | 1.0x | 1.0x | 1.0x | 1.0x | 1.0x | 1.0x |
| Elf | 1.0x | 1.0x | 0.95x | 1.05x | 1.0x | 1.1x | 1.0x | 1.0x |
| Dwarf | 1.0x | 1.1x | 1.1x | 0.9x | 1.0x | 1.0x | 1.0x | 1.0x |
| Beastkin | 1.0x | 1.0x | 1.0x | 1.05x | 0.95x | 1.0x | 1.0x | 1.1x |

- **Human** — Balanced and adaptable, no bonuses or penalties
- **Elf** — Graceful and attuned to magic, with high MP and agility
- **Dwarf** — Stout and resilient, excels at defense and endurance
- **Beastkin** — Wild and instinctive, natural critical strikers

## Classes

8 classes with unique base stat distributions and combat techniques.

| Class | STR | DEF | HP | AGI | INT | FAITH | LUCK | Essence | Role |
|-------|-----|-----|----|-----|-----|-------|------|---------|------|
| Warrior | 55 | 50 | 100 | 25 | 10 | 15 | 30 | 80 | Melee DPS / Tank |
| Paladin | 40 | 50 | 100 | 15 | 10 | 50 | 15 | 100 | Tank / Holy hybrid |
| Rogue | 30 | 20 | 75 | 55 | 10 | 10 | 90 | 70 | Crit DPS |
| Ranger | 30 | 25 | 80 | 50 | 25 | 15 | 60 | 90 | Ranged DPS |
| Mage | 10 | 15 | 65 | 20 | 60 | 20 | 50 | 150 | Magic DPS |
| Cleric | 15 | 30 | 90 | 15 | 30 | 55 | 20 | 130 | Healer / Support |
| Warlock | 15 | 15 | 70 | 20 | 55 | 25 | 45 | 140 | Dark caster |
| Monk | 45 | 25 | 80 | 55 | 10 | 15 | 60 | 85 | Martial artist |

**Final stats** = Base class stats x Race multipliers. For example, an Elf Mage gets 65 x 0.95 = 61 HP, 60 x 1.1 = 66 MP.

## 9 Core Stats

| Stat | Abbrev | Effect |
|------|--------|--------|
| Strength | STR | Physical attack damage |
| Defense | DEF | Damage reduction |
| Hit Points | HP | Health pool |
| Agility | AGI | Dodge chance, movement speed |
| Intelligence | INT | Magic damage, technique power |
| Mana Points | MP | Mana pool |
| Faith | FAITH | Holy spell power, healing |
| Luck | LUCK | Critical hit chance, loot quality |
| Essence | ESS | Resource pool for combat techniques |

## Endpoints

### List Races

```bash
GET /character/races
```

Returns all 4 races with stat multipliers and descriptions.

### List Classes

```bash
GET /character/classes
```

Returns all 8 classes with base stats and descriptions.

### Create Character (Mint NFT)

```bash
POST /character/create
{
  "walletAddress": "0x...",
  "name": "Aragorn",
  "race": "human",
  "className": "warrior"
}
```

**Response:**
```json
{
  "ok": true,
  "txHash": "0x...",
  "character": {
    "name": "Aragorn the Warrior",
    "description": "Level 1 Human Warrior",
    "race": "human",
    "class": "warrior",
    "level": 1,
    "xp": 0,
    "stats": { "str": 55, "def": 50, "hp": 100, "agi": 25, "int": 10, "mp": 15, "faith": 15, "luck": 30, "essence": 80 }
  }
}
```

This mints an **ERC-721 NFT** on SKALE with the character metadata on-chain.

### Get Owned Characters

```bash
GET /character/:walletAddress
```

Returns all character NFTs owned by the wallet.

### Spawn Into World

```bash
POST /spawn
{
  "zoneId": "human-meadow",
  "walletAddress": "0x...",
  "characterName": "Aragorn the Warrior"
}
```

Spawns the character as a live entity in the specified zone. The agent can now move, attack, and interact.

### Get Wallet Character

```bash
GET /wallet-character/:walletAddress
```

Returns the active in-world entity for a wallet address.

### Get Character in Zone

```bash
GET /wallet/:address/character/:zoneId
```

Returns the live entity for a wallet in a specific zone with current HP, position, and equipment.

## Equipment Slots

Characters have **10 equipment slots**:

| Slot | Type | Example Item |
|------|------|-------------|
| weapon | Swords, bows, axes, staves, shields | Iron Sword (+8 STR) |
| chest | Body armor | Chainmail Shirt (+10 DEF, +12 HP) |
| helm | Head protection | Iron Helm (+3 DEF, +3 HP) |
| shoulders | Shoulder guards | Steel Pauldrons (+5 DEF, +4 HP) |
| legs | Leg armor | Iron Greaves (+5 DEF, +6 HP) |
| boots | Footwear | Steel Sabatons (+3 DEF, +1 AGI) |
| gloves | Hand armor | Knight Gauntlets (+2 STR, +3 DEF) |
| belt | Waist gear | War Belt (+4 DEF, +8 HP) |
| ring | Jewelry | Ruby Ring (+4 STR, +6 HP) |
| amulet | Necklace | Arcane Crystal Amulet (+6 INT, +8 MP, +3 FAITH) |

### Equip Item

```bash
POST /equipment/equip
{
  "walletAddress": "0x...",
  "entityId": "abc123",
  "tokenId": 2,
  "slot": "weapon"
}
```

### Unequip Item

```bash
POST /equipment/unequip
{
  "walletAddress": "0x...",
  "entityId": "abc123",
  "slot": "weapon"
}
```

## Agent Tips

- **Dwarf Warrior** is the tankiest combo (110 HP, 55 DEF after multipliers)
- **Elf Mage** has the highest magic output (66 MP, 150 Essence)
- **Beastkin Rogue** crits hardest (99 LUCK after multipliers)
- Equip a full set of gear before fighting — stat bonuses stack significantly
