# Authentication Audit

## Status: In Progress

This document tracks which endpoints have authentication enforcement.

## ✅ Protected Endpoints

### Zone Transitions (shard/src/zoneTransition.ts)
- ✅ `POST /transition/auto` - Requires auth
- ✅ `POST /transition/:zoneId/portal/:portalId` - Requires auth
- ⚪ `GET /portals/:zoneId` - Public (read-only)

### Spawn Management (shard/src/spawnOrders.ts)
- ✅ `POST /spawn` - Requires auth, verifies wallet ownership
- ⚪ `DELETE /spawn/:zoneId/:entityId` - Not protected (TODO)

### Commands (shard/src/commands.ts)
- ✅ `POST /command` - Requires auth

### Shop (shard/src/shop.ts)
- ✅ `POST /shop/buy` - Requires auth
- ⚪ `GET /shop/catalog` - Public
- ⚪ `GET /shop/npc/:zoneId/:entityId` - Public

### Techniques (shard/src/techniqueRoutes.ts)
- ✅ `POST /techniques/learn` - Requires auth
- ✅ `POST /techniques/use` - Requires auth
- ⚪ `GET /techniques/available/:classId` - Public
- ⚪ `GET /techniques/learned/:zoneId/:entityId` - Public

## ❌ Unprotected Endpoints (NEED AUTH)

### Equipment (shard/src/equipment.ts)
- ❌ `POST /equipment/equip` - **CRITICAL: Needs auth**
- ❌ `POST /equipment/unequip` - **CRITICAL: Needs auth**
- ❌ `POST /equipment/repair` - **CRITICAL: Needs auth**
- ⚪ `GET /equipment/:zoneId/:entityId` - Public
- ⚪ `GET /equipment/slots` - Public

### Cooking (shard/src/cooking.ts)
- ❌ `POST /cooking/cook` - **CRITICAL: Needs auth**
- ❌ `POST /cooking/consume` - **CRITICAL: Needs auth**
- ⚪ `GET /cooking/recipes` - Public

### Mining (shard/src/mining.ts)
- ❌ `POST /mining/gather` - **CRITICAL: Needs auth**
- ⚪ `GET /mining/nodes/:zoneId` - Public

### Herbalism (shard/src/herbalism.ts)
- ❌ `POST /herbalism/gather` - **CRITICAL: Needs auth**
- ⚪ `GET /herbalism/flowers/:zoneId` - Public

### Skinning (shard/src/skinning.ts)
- ❌ `POST /skinning/skin` - **CRITICAL: Needs auth**

### Alchemy (shard/src/alchemy.ts)
- ❌ `POST /alchemy/brew` - **CRITICAL: Needs auth**
- ❌ `POST /alchemy/consume` - **CRITICAL: Needs auth**
- ⚪ `GET /alchemy/recipes` - Public

### Crafting (shard/src/crafting.ts)
- ❌ `POST /crafting/forge` - **CRITICAL: Needs auth**
- ⚪ `GET /crafting/recipes` - Public

### Enchanting (shard/src/enchanting.ts)
- ❌ `POST /enchanting/enchant` - **CRITICAL: Needs auth**
- ⚪ `GET /enchanting/altars/:zoneId` - Public

### Professions (shard/src/professions.ts)
- ❌ `POST /professions/learn` - **CRITICAL: Needs auth**
- ⚪ `GET /professions/catalog` - Public
- ⚪ `GET /professions/:walletAddress` - Public

### Quests (shard/src/questSystem.ts)
- ❌ `POST /quests/accept` - **CRITICAL: Needs auth**
- ❌ `POST /quests/complete` - **CRITICAL: Needs auth**
- ❌ `POST /quests/abandon` - **CRITICAL: Needs auth**
- ⚪ `GET /quests/:zoneId/:npcId` - Public

### Party System (shard/src/partySystem.ts)
- ❌ `POST /party/create` - **CRITICAL: Needs auth**
- ❌ `POST /party/invite` - **CRITICAL: Needs auth**
- ❌ `POST /party/join` - **CRITICAL: Needs auth**
- ❌ `POST /party/leave` - **CRITICAL: Needs auth**
- ❌ `POST /party/kick` - **CRITICAL: Needs auth**
- ⚪ `GET /party/:partyId` - Public

### Trade (shard/src/trade.ts)
- ❌ `POST /trade/offer` - **CRITICAL: Needs auth**
- ❌ `POST /trade/accept` - **CRITICAL: Needs auth**
- ❌ `POST /trade/cancel` - **CRITICAL: Needs auth**
- ⚪ `GET /trade/:tradeId` - Public

### Auction House (shard/src/auctionHouse.ts)
- ❌ `POST /auctionhouse/:zoneId/create` - **CRITICAL: Needs auth**
- ❌ `POST /auctionhouse/:zoneId/bid` - **CRITICAL: Needs auth**
- ❌ `POST /auctionhouse/:zoneId/buyout` - **CRITICAL: Needs auth**
- ❌ `POST /auctionhouse/:zoneId/cancel` - **CRITICAL: Needs auth**
- ⚪ `GET /auctionhouse/npc/:zoneId/:entityId` - Public
- ⚪ `GET /auctionhouse/:zoneId/auctions` - Public

### Guild DAO (shard/src/guild.ts)
- ❌ `POST /guild/create` - **CRITICAL: Needs auth**
- ❌ `POST /guild/:guildId/join` - **CRITICAL: Needs auth**
- ❌ `POST /guild/:guildId/leave` - **CRITICAL: Needs auth**
- ❌ `POST /guild/:guildId/deposit` - **CRITICAL: Needs auth**
- ❌ `POST /guild/:guildId/propose` - **CRITICAL: Needs auth**
- ❌ `POST /guild/:guildId/vote` - **CRITICAL: Needs auth**
- ⚪ `GET /guild/registrar/:zoneId/:entityId` - Public
- ⚪ `GET /guilds` - Public

### Guild Vault (shard/src/guildVault.ts)
- ❌ `POST /guild/vault/:guildId/deposit` - **CRITICAL: Needs auth**
- ❌ `POST /guild/vault/:guildId/withdraw` - **CRITICAL: Needs auth**
- ⚪ `GET /guild/vault/:guildId` - Public

### Characters (shard/src/characterRoutes.ts)
- ❌ `POST /character/create` - **CRITICAL: Needs auth**
- ⚪ `GET /character/:walletAddress` - Public

### Chat (shard/src/eventRoutes.ts)
- ❌ `POST /chat/:zoneId` - **CRITICAL: Needs auth**
- ⚪ `GET /events/:zoneId` - Public
- ⚪ `GET /events` - Public

## 📊 Summary

**Total Endpoints**: ~60
**Protected**: ~8 (13%)
**Unprotected Write Ops**: ~35 (87% of write operations)
**Public Read-Only**: ~17

## 🎯 Priority Matrix

### P0 - Critical (Exploitable)
All POST endpoints that:
- Mint/burn blockchain assets (shop, crafting, cooking, alchemy)
- Modify game state (equipment, quests, parties)
- Spend gold (auction house, guild, shop)

### P1 - Important (Security)
- Character creation
- Guild operations
- Trade system

### P2 - Nice to Have
- Chat logging (can spam)
- Party management (can grief)

## ⚡ Quick Fix List

Files that need `authenticateRequest` added:

1. `equipment.ts` - equip, unequip, repair
2. `cooking.ts` - cook, consume
3. `mining.ts` - gather
4. `herbalism.ts` - gather
5. `skinning.ts` - skin
6. `alchemy.ts` - brew, consume
7. `crafting.ts` - forge
8. `enchanting.ts` - enchant
9. `professions.ts` - learn
10. `questSystem.ts` - accept, complete, abandon
11. `partySystem.ts` - create, invite, join, leave, kick
12. `trade.ts` - offer, accept, cancel
13. `auctionHouse.ts` - create, bid, buyout, cancel
14. `guild.ts` - create, join, leave, deposit, propose, vote
15. `guildVault.ts` - deposit, withdraw
16. `characterRoutes.ts` - create
17. `eventRoutes.ts` - chat
