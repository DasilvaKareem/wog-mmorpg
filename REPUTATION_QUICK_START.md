# ERC-8004 Reputation System - Quick Start Guide

## 🚀 5-Minute Setup

### 1. Deploy Contracts

```bash
# Install dependencies (if needed)
npm install

# Deploy to SKALE
npx hardhat run scripts/deployReputation.ts --network skale
```

**Copy the contract addresses** and add to `.env`:
```env
IDENTITY_REGISTRY_ADDRESS=0x...
REPUTATION_REGISTRY_ADDRESS=0x...
BACKEND_WALLET_ADDRESS=0x...  # Your backend wallet that submits reputation
```

---

### 2. Register API Routes

Add to your main server file (`shard/src/index.ts` or similar):

```typescript
import { registerReputationRoutes } from './reputationRoutes.js';

// After other routes
await registerReputationRoutes(app);
```

---

### 3. Integrate with Character Minting

When a player mints a character, create their identity:

```typescript
import { reputationManager } from './reputationManager.js';

// In your character minting function
async function mintCharacter(owner, name, class, level) {
  // 1. Mint character NFT (your existing code)
  const characterTokenId = await characterNFT.mint(owner, ...);

  // 2. Create ERC-8004 identity
  const identityId = await reputationManager.createCharacterIdentity(
    characterTokenId,
    owner,
    { name, class, level }
  );

  console.log(`Created identity ${identityId} for character ${characterTokenId}`);
}
```

---

### 4. Integrate with PvP Battles

Add reputation updates after battles:

```typescript
import { pvpReputationIntegration } from './pvpReputationIntegration.js';

// In your battle completion handler
async function handleBattleComplete(battleId) {
  // 1. Get battle results (your existing code)
  const result = await pvpBattleManager.calculateMatchResult(battleId);

  // 2. Update reputation
  await pvpReputationIntegration.updateReputationFromBattle(result);
}
```

---

### 5. Add UI Component

Display reputation in character profiles:

```tsx
import { ReputationPanel } from './components/ReputationPanel';

function CharacterProfile({ characterId }) {
  return (
    <div>
      {/* Your existing profile UI */}

      <ReputationPanel characterTokenId={characterId} />
    </div>
  );
}
```

---

## 🧪 Test It Works

### 1. Test API Endpoints

```bash
# Get reputation ranks
curl http://localhost:3000/api/reputation/ranks

# Expected response:
# { "ranks": [{ "score": 900, "name": "Legendary Hero", ... }] }
```

### 2. Create Test Identity

```bash
curl -X POST http://localhost:3000/api/reputation/create-identity \
  -H "Content-Type: application/json" \
  -d '{
    "characterTokenId": "1",
    "characterOwner": "0x...",
    "characterName": "Test Hero",
    "characterClass": "Warrior",
    "level": 1
  }'

# Expected response:
# { "success": true, "identityId": "1" }
```

### 3. Get Reputation

```bash
curl http://localhost:3000/api/reputation/1

# Expected response:
# {
#   "reputation": {
#     "combat": 500,
#     "economic": 500,
#     "social": 500,
#     "crafting": 500,
#     "agent": 500,
#     "overall": 500,
#     "rank": "Average Citizen"
#   }
# }
```

### 4. Submit Feedback

```bash
curl -X POST http://localhost:3000/api/reputation/feedback \
  -H "Content-Type: application/json" \
  -d '{
    "characterTokenId": "1",
    "category": "combat",
    "delta": 20,
    "reason": "Won epic PvP battle"
  }'

# Expected response:
# { "success": true, "message": "Reputation feedback submitted" }
```

### 5. Verify Update

```bash
curl http://localhost:3000/api/reputation/1

# Expected response (combat should be 520 now):
# {
#   "reputation": {
#     "combat": 520,
#     ...
#   }
# }
```

---

## ✅ Verification Checklist

- [ ] Contracts deployed and addresses in `.env`
- [ ] Backend wallet authorized as minter/reporter
- [ ] API routes registered in server
- [ ] Character minting creates identities
- [ ] PvP battles update reputation
- [ ] UI component displays reputation
- [ ] All API endpoints return valid data

---

## 🎯 What Gets Tracked Automatically

Once integrated, the system automatically tracks:

✅ **PvP Combat**
- Win/loss record → Combat reputation
- MVP awards → +25 Combat reputation
- Performance quality → Scaled reputation gain

✅ **Trading** (when you integrate)
- Trade completion → Economic reputation
- Fair pricing → Economic reputation bonus
- Scams/failures → Economic reputation penalty

✅ **Social** (future)
- Guild participation → Social reputation
- Helping new players → Social reputation

✅ **Crafting** (future)
- Item quality → Crafting reputation
- Recipe discoveries → Crafting reputation

---

## 📊 Reputation Benefits

**High Reputation (≥700) Gets**:
- Better matchmaking (matched with honorable players)
- Lower marketplace fees (future)
- Guild leadership eligibility (future)
- Access to elite content (future)
- Increased trust in trades

**Low Reputation (≤400) Faces**:
- Trade warnings shown to other players
- Restricted marketplace access (future)
- Matched with other low-rep players
- Excluded from high-tier guilds

---

## 🔧 Troubleshooting

**Problem**: API returns "Reputation not found"

**Solution**: Character identity not created. Make sure you call `createCharacterIdentity()` during minting.

---

**Problem**: "Unauthorized" error when submitting reputation

**Solution**: Authorize your backend wallet:
```typescript
// Run once after deployment (as contract owner)
await identityRegistry.authorizeMinter(backendWallet);
await reputationRegistry.authorizeReporter(backendWallet);
```

---

**Problem**: Reputation not updating after PvP

**Solution**: Make sure you're calling the integration:
```typescript
await pvpReputationIntegration.updateReputationFromBattle(result);
```

---

## 📚 Next Steps

1. **Read Full Docs**: See `ERC8004_REPUTATION_SYSTEM.md`
2. **Integrate Trades**: Add economic reputation tracking
3. **Add Validation**: Implement zkML proofs for achievements
4. **Reputation-Gated Content**: Restrict dungeons by reputation
5. **Leaderboards**: Show reputation in rankings

---

## 🎮 Example: Full Flow

```typescript
// 1. Player mints character
const characterId = await mintCharacter(wallet, "Aragorn", "Ranger", 1);
// → Creates identity with 500 reputation in all categories

// 2. Player fights PvP battle
await joinPvPQueue(characterId);
// → Matchmaking uses ELO + reputation
// → High-rep players matched together

// 3. Player wins battle
await completeBattle(battleId);
// → Combat reputation increased by +15
// → Overall reputation now 507

// 4. Player wins 10 more battles
// → Combat reputation now 680
// → Overall reputation now 620 → "Reliable Ally" rank

// 5. Player gets MVP
// → +25 Combat reputation
// → Combat now 705, Overall now 645

// 6. Player joins elite guild
if (character.reputation.overall >= 600) {
  await joinGuild(eliteGuildId);  // ✅ Allowed
}

// 7. Player's character NFT value increases
// → High-reputation characters worth more in marketplace
```

---

**Built with ERC-8004 Standard** 🏆

Ready to build? Start with step 1 and you'll have reputation working in 5 minutes!
