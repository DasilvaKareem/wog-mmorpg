---
title: Shop & Economy API
description: Buy gear, learn professions, craft items, and manage gold.
---

## NPC Merchants

Each zone has merchants selling different tiers of gear.

| Zone | NPC | Inventory |
|------|-----|-----------|
| human-meadow | **Grimwald the Trader** | Starter gear — potions, iron weapons, leather armor |
| human-meadow | **Bron the Blacksmith** | Advanced gear — steel weapons, chainmail, shields |

### Discover Merchant

```bash
GET /shop/npc/:zoneId/:entityId
```

Returns the NPC's item catalog with prices, stats, and descriptions.

### Buy Item

```bash
POST /shop/buy
{
  "walletAddress": "0x...",
  "npcEntityId": "npc_grimwald",
  "tokenId": 2,
  "zoneId": "human-meadow"
}
```

Server validates gold balance, deducts gold, and mints the item NFT (ERC-1155) to the buyer's wallet.

### Check Gold Balance

```bash
GET /wallet/:walletAddress/balance
```

### Register Wallet

```bash
POST /wallet/register
{ "address": "0x..." }
```

Grants a **welcome bonus** of gold to new players.

## Weapons

| Item | Token | Price | Stats | Durability |
|------|-------|-------|-------|------------|
| Iron Sword | 2 | 100g | +8 STR | 60 |
| Steel Longsword | 3 | 250g | +14 STR | 80 |
| Hunter's Bow | 4 | 150g | +4 STR, +6 AGI | 70 |
| Battle Axe | 5 | 400g | +18 STR, -1 AGI | 95 |
| Apprentice Staff | 6 | 200g | +12 INT, +3 FAITH | 65 |
| Oak Shield | 7 | 80g | +6 DEF | 85 |

### Upgraded Weapons (via Blacksmithing)

**Reinforced** (+25% stats):

| Item | Price | Stats |
|------|-------|-------|
| Reinforced Iron Sword | 180g | +10 STR |
| Reinforced Steel Longsword | 400g | +18 STR |
| Reinforced Hunter's Bow | 250g | +5 STR, +8 AGI |
| Reinforced Battle Axe | 600g | +23 STR |
| Reinforced Apprentice Staff | 350g | +15 INT, +4 FAITH |

**Masterwork** (+50% stats):

| Item | Price | Stats |
|------|-------|-------|
| Masterwork Iron Sword | 300g | +12 STR |
| Masterwork Steel Longsword | 650g | +21 STR |
| Masterwork Battle Axe | 950g | +27 STR |
| Masterwork Apprentice Staff | 550g | +18 INT, +5 FAITH |

## Armor

### Starter Armor (from merchants)

| Slot | Item | Price | Stats |
|------|------|-------|-------|
| Chest | Leather Vest | 60g | +4 DEF, +4 HP |
| Chest | Chainmail Shirt | 300g | +10 DEF, +12 HP |
| Helm | Iron Helm | 45g | +3 DEF, +3 HP |
| Legs | Leather Leggings | 55g | +2 DEF, +1 AGI |
| Legs | Iron Greaves | 130g | +5 DEF, +6 HP |
| Boots | Traveler Boots | 50g | +1 DEF, +2 AGI |
| Boots | Steel Sabatons | 110g | +3 DEF, +1 AGI |
| Gloves | Padded Gloves | 40g | +1 STR, +1 DEF |
| Gloves | Knight Gauntlets | 150g | +2 STR, +3 DEF |
| Belt | Guard Belt | 60g | +2 DEF, +4 HP |
| Belt | War Belt | 140g | +4 DEF, +8 HP |
| Shoulders | Bronze Shoulders | 70g | +3 DEF |
| Shoulders | Steel Pauldrons | 165g | +5 DEF, +4 HP |

### Crafted Leather Sets (via Leatherworking)

**Tanned Set** — Agility-focused:

| Slot | Item | Price | Stats |
|------|------|-------|-------|
| Chest | Tanned Leather Vest | 80g | +5 DEF, +3 AGI, +5 HP |
| Legs | Tanned Leather Leggings | 65g | +3 DEF, +2 AGI |
| Boots | Tanned Leather Boots | 55g | +2 DEF, +3 AGI |
| Helm | Tanned Leather Helm | 50g | +3 DEF, +1 AGI |
| Shoulders | Tanned Leather Shoulders | 55g | +3 DEF, +1 AGI |
| Gloves | Tanned Leather Gloves | 45g | +1 DEF, +2 AGI |
| Belt | Tanned Leather Belt | 45g | +2 DEF, +3 HP |

**Reinforced Hide Set** — Heavy-duty:

| Slot | Item | Price | Stats |
|------|------|-------|-------|
| Chest | Reinforced Hide Vest | 160g | +8 DEF, +4 AGI, +8 HP |
| Legs | Reinforced Hide Leggings | 130g | +6 DEF, +3 AGI, +4 HP |
| Boots | Reinforced Hide Boots | 110g | +4 DEF, +4 AGI |
| Helm | Reinforced Hide Helm | 100g | +5 DEF, +2 AGI, +3 HP |
| Shoulders | Reinforced Hide Shoulders | 120g | +6 DEF, +2 AGI |
| Gloves | Reinforced Hide Gloves | 90g | +3 DEF, +3 AGI, +1 STR |
| Belt | Reinforced Hide Belt | 95g | +4 DEF, +6 HP |

## Jewelry (via Jewelcrafting)

| Item | Slot | Price | Stats |
|------|------|-------|-------|
| Ruby Ring | Ring | 120g | +4 STR, +6 HP |
| Sapphire Ring | Ring | 120g | +4 INT, +6 MP |
| Emerald Ring | Ring | 130g | +3 AGI, +2 LUCK, +4 HP |
| Diamond Amulet | Amulet | 200g | +5 DEF, +8 HP, +3 FAITH |
| Shadow Opal Amulet | Amulet | 220g | +4 STR, +3 AGI, +2 LUCK |
| Arcane Crystal Amulet | Amulet | 280g | +6 INT, +8 MP, +3 FAITH |

## Consumables

| Item | Price | Effect |
|------|-------|--------|
| Health Potion | 10g | Restore 50 HP |
| Mana Potion | 15g | Restore 30 Essence |
| Minor Health Potion | 15g | Restore 30 HP |
| Greater Health Potion | 80g | Restore 100 HP |
| Greater Mana Potion | 95g | Restore 70 MP |
| Stamina Elixir | 30g | Stamina regen 5 min |
| Wisdom Potion | 50g | +10 INT for 10 min |
| Swift Step Potion | 25g | +20% move speed 5 min |
| Elixir of Strength | 150g | +15 STR for 15 min |
| Elixir of Vitality | 180g | +20 HP, +10 DEF for 15 min |
| Philosopher's Elixir | 400g | +20 ALL stats for 30 min |

### Enchantment Elixirs (permanent weapon enchants)

| Elixir | Price | Effect |
|--------|-------|--------|
| Fire Enchantment | 150g | +5 STR, +10% fire damage |
| Ice Enchantment | 140g | +3 STR, +2 AGI, 20% slow |
| Lightning Enchantment | 160g | +4 STR, +3 AGI, chain lightning |
| Holy Enchantment | 180g | +4 STR, +2 DEF, heals 5 HP on hit |
| Shadow Enchantment | 170g | +6 STR, +1 AGI, +15% crit |
| Sharpness Elixir | 200g | +8 STR, +20% armor pen |
| Durability Elixir | 190g | +3 DEF, -50% durability loss |
| Disenchanting Scroll | 100g | Removes all enchantments |

### Cooked Food (via Cooking)

| Item | Price | Effect |
|------|-------|--------|
| Cooked Meat | 8g | Restore 30 HP |
| Hearty Stew | 18g | Restore 60 HP |
| Roasted Boar | 35g | Restore 100 HP |
| Bear Feast | 60g | Restore 150 HP |
| Hero's Banquet | 120g | Restore 250 HP + 5 STR 5 min |

## Professions

8 professions to gather resources and craft items.

### Learn Profession

```bash
POST /professions/learn
{ "walletAddress": "0x...", "profession": "mining" }
```

### Get Learned Professions

```bash
GET /wallet/:walletAddress/professions
```

### Gathering Professions

| Profession | Cost | Tools (Tier 1-4) | Resources |
|-----------|------|------------------|-----------|
| **Mining** | 50g | Stone/Iron/Steel/Mithril Pickaxe (30-500g) | Coal, Tin, Copper, Silver, Gold Ore |
| **Herbalism** | 50g | Basic/Iron/Steel/Enchanted Sickle (25-450g) | Dandelion, Lily, Rose, Lavender, Sage, Moonflower, Starbloom, Dragon's Breath |
| **Skinning** | 50g | Rusty/Iron/Steel/Master Knife (25-450g) | Scrap/Light/Medium/Heavy Leather, Pelts, Silk, Bones, Hides |

### Crafting Professions

| Profession | Cost | Inputs | Outputs |
|-----------|------|--------|---------|
| **Blacksmithing** | 100g | Ores, Bars | Weapons, armor, weapon upgrades (Reinforced/Masterwork) |
| **Alchemy** | 75g | Herbs, Flowers | Potions, elixirs, enchantment elixirs |
| **Cooking** | 40g | Raw Meat, ingredients | Cooked food (HP restoration) |
| **Leatherworking** | 75g | Leather, Hides, Pelts | Tanned and Reinforced leather armor sets |
| **Jewelcrafting** | 100g | Gems (Ruby, Sapphire, Emerald, Diamond, Opal, Crystal) | Rings and amulets |

### Smelting Chain (Blacksmithing)

| Input | Output | Value |
|-------|--------|-------|
| Tin Ore | Tin Bar | 18g |
| Copper Ore | Copper Bar | 30g |
| Silver Ore | Silver Bar | 65g |
| Gold Ore | Gold Bar | 150g |
| Mixed metals | Steel Alloy | 200g |

### Gem Materials (Jewelcrafting)

| Gem | Price |
|-----|-------|
| Rough Ruby | 40g |
| Rough Sapphire | 40g |
| Rough Emerald | 40g |
| Flawed Diamond | 80g |
| Shadow Opal | 90g |
| Arcane Crystal | 150g |
