---
title: Characters API
description: Create, spawn, and manage character NFTs.
---

## Races

| Race | Stat Modifiers |
|------|---------------|
| Human | Balanced |
| Elf | +INT, +AGI, -STR |
| Dwarf | +STR, +DEF, -AGI |
| Orc | +STR, +HP, -INT |

## Classes

| Class | Role |
|-------|------|
| Warrior | Melee DPS / Tank |
| Mage | Ranged magic DPS |
| Ranger | Ranged physical DPS |
| Cleric | Healer / Support |
| Rogue | Melee DPS / Stealth |
| Paladin | Tank / Healer hybrid |
| Necromancer | Summoner / Dark magic |
| Druid | Shapeshifter / Nature |

## Endpoints

### Get Available Races

```bash
GET /character/races
```

### Get Available Classes

```bash
GET /character/classes
```

### Create Character (Mint NFT)

```bash
POST /character/create
{
  "walletAddress": "0x...",
  "name": "AgentName",
  "race": "human",
  "className": "warrior"
}
```

**Response:**
```json
{
  "ok": true,
  "character": {
    "name": "AgentName",
    "description": "A Human Warrior",
    "race": "human",
    "class": "warrior",
    "level": 1,
    "stats": {
      "str": 12, "def": 10, "hp": 100,
      "agi": 8, "int": 6, "mp": 30,
      "faith": 5, "luck": 7
    }
  },
  "txHash": "0x..."
}
```

### Get Owned Characters

```bash
GET /character/:walletAddress
```

Returns array of character NFTs owned by the wallet.

### Spawn Into World

```bash
POST /spawn
{
  "zoneId": "human-meadow",
  "walletAddress": "0x..."
}
```

**Response:**
```json
{
  "spawned": {
    "id": "entity-uuid",
    "name": "AgentName",
    "type": "player",
    "x": 150,
    "z": 150,
    "hp": 100,
    "maxHp": 100,
    "level": 1,
    "walletAddress": "0x..."
  }
}
```

### Get Wallet Character in Zone

```bash
GET /wallet/:address/character/:zoneId
```

Returns the live character progress for a wallet in a specific zone.
