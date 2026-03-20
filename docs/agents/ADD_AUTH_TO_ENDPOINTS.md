# Authentication Enforcement Guide

## Quick Reference

To add authentication to an endpoint, follow these 3 steps:

### Step 1: Import authenticateRequest

```typescript
import { authenticateRequest } from "./auth.js";
```

### Step 2: Add preHandler to endpoint

```typescript
// Before
server.post<{ Body: MyBody }>("/my-endpoint", async (request, reply) => {
  // handler code
});

// After
server.post<{ Body: MyBody }>("/my-endpoint", {
  preHandler: authenticateRequest,
}, async (request, reply) => {
  const authenticatedWallet = (request as any).walletAddress;
  // handler code
});
```

### Step 3: Verify wallet ownership

```typescript
// For endpoints with walletAddress in body
const { walletAddress } = request.body;
if (walletAddress.toLowerCase() !== authenticatedWallet.toLowerCase()) {
  reply.code(403);
  return { error: "Not authorized to use this wallet" };
}

// For endpoints that control entities
const entity = zone.entities.get(entityId);
if (entity.walletAddress?.toLowerCase() !== authenticatedWallet.toLowerCase()) {
  reply.code(403);
  return { error: "Not authorized to control this entity" };
}
```

## Files to Update

Run these commands to batch-update files:

### 1. Equipment (shard/src/equipment.ts)

Add auth to:
- `POST /equipment/equip`
- `POST /equipment/unequip`
- `POST /equipment/repair`

### 2. Cooking (shard/src/cooking.ts)

Add auth to:
- `POST /cooking/cook`
- `POST /cooking/consume`

### 3. Professions (shard/src/professions.ts)

Add auth to:
- `POST /professions/learn`

### 4. Mining/Herbalism/Skinning

Add auth to:
- `POST /mining/gather`
- `POST /herbalism/gather`
- `POST /skinning/skin`

### 5. Crafting (shard/src/crafting.ts)

Add auth to:
- `POST /crafting/forge`

### 6. Alchemy (shard/src/alchemy.ts)

Add auth to:
- `POST /alchemy/brew`
- `POST /alchemy/consume`

### 7. Enchanting (shard/src/enchanting.ts)

Add auth to:
- `POST /enchanting/enchant`

### 8. Quests (shard/src/questSystem.ts)

Add auth to:
- `POST /quests/accept`
- `POST /quests/complete`
- `POST /quests/abandon`

### 9. Party (shard/src/partySystem.ts)

Add auth to:
- `POST /party/create`
- `POST /party/invite`
- `POST /party/join`
- `POST /party/leave`
- `POST /party/kick`

### 10. Trade (shard/src/trade.ts)

Add auth to:
- `POST /trade/offer`
- `POST /trade/accept`
- `POST /trade/cancel`

### 11. Auction House (shard/src/auctionHouse.ts)

Add auth to:
- `POST /auctionhouse/:zoneId/create`
- `POST /auctionhouse/:zoneId/bid`
- `POST /auctionhouse/:zoneId/buyout`
- `POST /auctionhouse/:zoneId/cancel`

### 12. Guild (shard/src/guild.ts)

Add auth to:
- `POST /guild/create`
- `POST /guild/:guildId/join`
- `POST /guild/:guildId/leave`
- `POST /guild/:guildId/deposit`
- `POST /guild/:guildId/propose`
- `POST /guild/:guildId/vote`

### 13. Guild Vault (shard/src/guildVault.ts)

Add auth to:
- `POST /guild/vault/:guildId/deposit`
- `POST /guild/vault/:guildId/withdraw`

### 14. Characters (shard/src/characterRoutes.ts)

Add auth to:
- `POST /character/create`

### 15. Events (shard/src/eventRoutes.ts)

Add auth to:
- `POST /chat/:zoneId`

## Testing After Updates

1. **Get auth token:**
```bash
cd shard
pnpm exec tsx src/authHelper.ts
```

2. **Test protected endpoint:**
```bash
# Without auth (should fail with 401)
curl -X POST http://localhost:3000/cooking/cook \
  -H "Content-Type: application/json" \
  -d '{"walletAddress":"0x...","zoneId":"human-meadow"}'

# With auth (should work)
curl -X POST http://localhost:3000/cooking/cook \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your-token>" \
  -d '{"walletAddress":"0x...","zoneId":"human-meadow"}'
```

## Automated Update Script

Would you like me to create a script that automatically adds authentication to all these endpoints?

The script would:
1. Parse each file
2. Find POST/DELETE endpoints
3. Add `import { authenticateRequest } from "./auth.js"`
4. Add `preHandler: authenticateRequest` to endpoint config
5. Add wallet verification logic
6. Backup original files

This would save ~2-3 hours of manual work.
