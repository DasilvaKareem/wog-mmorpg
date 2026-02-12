---
title: Shop & Economy API
description: Buy items from merchants and manage gold.
---

## NPC Merchants

| Zone | Merchant | Specialty |
|------|----------|-----------|
| human-meadow | Grimwald the Trader | Starter gear |
| human-meadow | Bron the Blacksmith | Advanced gear |

## Endpoints

### Get Full Catalog

```bash
GET /shop/catalog
```

Returns all items available across all merchants.

### Get Merchant Inventory

```bash
GET /shop/npc/:zoneId/:entityId
```

Returns items sold by a specific merchant NPC. To find a merchant, look for entities with `type: "merchant"` in the zone data.

**Response:**
```json
{
  "merchant": "Grimwald the Trader",
  "zoneId": "human-meadow",
  "items": [
    {
      "tokenId": 1,
      "name": "Iron Sword",
      "category": "weapon",
      "price": 25,
      "equipSlot": "weapon",
      "statBonuses": { "str": 3 }
    }
  ]
}
```

### Buy Item

```bash
POST /shop/buy
{
  "buyerAddress": "0x...",
  "tokenId": 1,
  "quantity": 1
}
```

Server-authoritative:
- Validates the buyer has enough gold
- Deducts gold from balance
- Mints the item NFT (ERC-1155) to the buyer

### Wallet Balance

```bash
GET /wallet/:address/balance
```

**Response:**
```json
{
  "address": "0x...",
  "gold": "150.0",
  "items": [
    {
      "tokenId": "1",
      "name": "Iron Sword",
      "balance": "1",
      "category": "weapon",
      "equipSlot": "weapon",
      "statBonuses": { "str": 3 },
      "maxDurability": 100
    }
  ]
}
```

### Register Wallet

```bash
POST /wallet/register
{ "address": "0x..." }
```

Registers a new wallet and grants the welcome gold bonus.

## Equipment

### Equip Item

```bash
POST /equipment/equip
{
  "zoneId": "human-meadow",
  "tokenId": 1,
  "walletAddress": "0x..."
}
```

### Unequip Slot

```bash
POST /equipment/unequip
{
  "zoneId": "human-meadow",
  "slot": "weapon",
  "walletAddress": "0x..."
}
```

### Equipment Slots

`weapon`, `chest`, `legs`, `boots`, `helm`, `shoulders`, `gloves`, `belt`

## Professions

### Get Professions

```bash
GET /wallet/:address/professions
```

Returns learned and available professions with costs.
