## ERC-8004 Reputation System Documentation

### 🎯 Overview

The WoG MMORPG implements **ERC-8004: Trustless Agents** standard to provide on-chain reputation for all characters. This creates a persistent, verifiable trust layer that:

- ✅ Tracks player behavior across multiple dimensions
- ✅ Provides portable identity for AI agents
- ✅ Enables trustless interactions between players and agents
- ✅ Creates economic incentives for good behavior

---

### 📋 What is ERC-8004?

[ERC-8004](https://eips.ethereum.org/EIPS/eip-8004) is an Ethereum standard (live on mainnet since **January 29, 2026**) that gives AI software agents and characters persistent on-chain identities through three core registries:

1. **Identity Registry** - ERC-721-style tokens for unique on-chain identifiers
2. **Reputation Registry** - Structured feedback and performance scoring
3. **Validation Registry** - Independent verification through zkML, TEE, or staking

---

### 🏗️ Architecture

#### Smart Contracts

```
contracts/
├── WoGIdentityRegistry.sol       # Character identity tokens (ERC-721)
└── WoGReputationRegistry.sol     # Multi-dimensional reputation tracking
```

#### Backend Services

```
shard/src/
├── reputationManager.ts          # Core reputation logic
├── reputationRoutes.ts           # API endpoints
└── pvpReputationIntegration.ts   # PvP battle integration
```

#### Frontend Components

```
client/src/components/
└── ReputationPanel.tsx           # Reputation display UI
```

---

### 🎮 How It Works

#### 1. Character Minting

When a player mints a character NFT, the system automatically:

```typescript
// Create ERC-8004 identity
const identityId = await createCharacterIdentity(
  characterTokenId,
  playerWallet,
  {
    name: "Sir Lancelot",
    class: "Warrior",
    level: 1
  }
);

// Initialize reputation (all categories start at 500)
await initializeReputation(identityId);
```

**Result**: Character gets a soul-bound identity token with default 500 reputation.

---

#### 2. Reputation Categories

Each character has **5 reputation dimensions**:

| Category | What It Measures | How It's Earned/Lost |
|----------|------------------|----------------------|
| **Combat** (30%) | PvP/PvE performance | Win battles (+5 to +20), Lose (-2 to -5), MVP (+25) |
| **Economic** (25%) | Trading honesty | Fair trade (+5), Questionable trade (+1), Scam (-10) |
| **Social** (20%) | Community behavior | Guild participation (+10), Help newbies (+10) |
| **Crafting** (15%) | Item creation quality | Craft legendary items (+15), Craft common (+1) |
| **Agent** (10%) | AI behavior (if agent) | API uptime (+5), Protocol compliance (+10) |

**Overall Score** = Weighted average (0-1000 scale)

---

#### 3. Reputation Ranks

| Score Range | Rank Name | Badge Color | Benefits |
|-------------|-----------|-------------|----------|
| 900-1000 | Legendary Hero | 🟨 Gold | Max privileges, -10% fees |
| 800-899 | Renowned Champion | 🟪 Purple | Elite content access |
| 700-799 | Trusted Veteran | 🟦 Blue | Guild leadership eligible |
| 600-699 | Reliable Ally | 🟩 Green | Standard access |
| 500-599 | Average Citizen | ⬜ White | Default state |
| 400-499 | Questionable | 🟨 Yellow | Trade warnings |
| 300-399 | Untrustworthy | 🟧 Orange | Restricted trading |
| 0-299 | Notorious | 🟥 Red | Limited access |

---

### 📊 Reputation Updates

#### Automatic Updates

The system **automatically** updates reputation for:

**PvP Battles**:
```typescript
// After battle completes
await updateCombatReputation(
  characterTokenId,
  won: true,
  performanceScore: 85  // Based on ELO change, MVP status
);
// Result: +17 Combat Reputation
```

**MVP Awards**:
```typescript
// If player is MVP
await submitFeedback(
  characterTokenId,
  ReputationCategory.Combat,
  +25,
  "Awarded MVP in PvP battle"
);
```

**Trades**:
```typescript
// When trade completes
await updateEconomicReputation(
  characterTokenId,
  tradeCompleted: true,
  fairPrice: true
);
// Result: +5 Economic Reputation
```

---

#### Manual Reporting (Future)

Players can report good/bad behavior:

```typescript
// Report honorable opponent
await reportBehavior(
  opponentTokenId,
  honorable: true,
  "Didn't exploit bug, played fair"
);
// Result: +10 Combat Reputation

// Report scammer
await reportBehavior(
  scammerTokenId,
  honorable: false,
  "Took items and didn't pay"
);
// Result: -20 Economic Reputation
```

---

### 🔌 API Endpoints

#### Get Reputation

```bash
GET /api/reputation/:characterTokenId
```

**Response**:
```json
{
  "reputation": {
    "combat": 750,
    "economic": 680,
    "social": 820,
    "crafting": 550,
    "agent": 0,
    "overall": 712,
    "lastUpdated": 1704123456,
    "rank": "Trusted Veteran"
  }
}
```

#### Get Identity

```bash
GET /api/reputation/:characterTokenId/identity
```

**Response**:
```json
{
  "identity": {
    "identityId": "42",
    "characterTokenId": "1234",
    "characterOwner": "0x...",
    "metadataURI": "data:application/json;base64,...",
    "createdAt": 1704100000,
    "active": true
  }
}
```

#### Get Feedback History

```bash
GET /api/reputation/:characterTokenId/history?limit=10
```

**Response**:
```json
{
  "history": [
    {
      "category": "Combat",
      "delta": 17,
      "reason": "Won PvP battle (performance: 85)",
      "timestamp": 1704123456,
      "validated": true
    },
    {
      "category": "Combat",
      "delta": 25,
      "reason": "Awarded MVP in PvP battle",
      "timestamp": 1704123456,
      "validated": true
    }
  ]
}
```

#### Create Identity (System Only)

```bash
POST /api/reputation/create-identity
```

**Request**:
```json
{
  "characterTokenId": "1234",
  "characterOwner": "0x...",
  "characterName": "Sir Lancelot",
  "characterClass": "Warrior",
  "level": 1
}
```

#### Submit Feedback (Admin Only)

```bash
POST /api/reputation/feedback
```

**Request**:
```json
{
  "characterTokenId": "1234",
  "category": "combat",
  "delta": 10,
  "reason": "Helped defend village from raid"
}
```

---

### 🎨 UI Integration

#### In Character Profile

```tsx
import { ReputationPanel } from "./components/ReputationPanel";

<ReputationPanel characterTokenId="1234" />
```

**Displays**:
- Overall score with rank badge
- Category breakdown (5 bars)
- Recent activity feed
- Last updated timestamp

#### In Trade Screen

```tsx
const reputation = await getReputation(traderTokenId);

if (reputation.economic < 400) {
  showWarning("⚠️ LOW REPUTATION TRADER");
}
```

#### In Guild Recruitment

```tsx
const minReputation = 600;

if (applicant.reputation.overall < minReputation) {
  rejectApplication("Reputation too low");
}
```

---

### 🚀 Deployment Guide

#### 1. Deploy Smart Contracts

```bash
# Install dependencies
npm install --save-dev hardhat @openzeppelin/contracts

# Compile contracts
npx hardhat compile

# Deploy to SKALE
npx hardhat run scripts/deployReputation.ts --network skale
```

**Deploy Script** (`scripts/deployReputation.ts`):
```typescript
import { ethers } from "hardhat";

async function main() {
  // Deploy Identity Registry
  const IdentityRegistry = await ethers.getContractFactory("WoGIdentityRegistry");
  const identityRegistry = await IdentityRegistry.deploy();
  await identityRegistry.deployed();

  console.log("IdentityRegistry:", identityRegistry.address);

  // Deploy Reputation Registry
  const ReputationRegistry = await ethers.getContractFactory("WoGReputationRegistry");
  const reputationRegistry = await ReputationRegistry.deploy();
  await reputationRegistry.deployed();

  console.log("ReputationRegistry:", reputationRegistry.address);

  // Authorize backend wallet to submit reputation
  const backendWallet = process.env.BACKEND_WALLET_ADDRESS;
  await identityRegistry.authorizeMinter(backendWallet);
  await reputationRegistry.authorizeReporter(backendWallet);

  console.log("Authorized backend wallet:", backendWallet);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
```

#### 2. Configure Environment

Add to `.env`:
```bash
IDENTITY_REGISTRY_ADDRESS=0x...
REPUTATION_REGISTRY_ADDRESS=0x...
```

#### 3. Test Deployment

```bash
# Run tests
npm test shard/tests/reputation.test.ts

# Test API endpoints
curl http://localhost:3000/api/reputation/ranks
```

---

### 📈 Future Enhancements

#### Phase 2: Validation Registry

**zkML Proof Verification**:
```typescript
// Prove achievement without revealing strategy
const proof = await generateZkMLProof(battleLog);
await submitValidation(identityId, proof);
// Result: +50 Combat Reputation (verified achievement)
```

**TEE Oracle Integration**:
```typescript
// Verify trade fairness via Trusted Execution Environment
const teeProof = await verifyTradePrice(itemId, price);
if (teeProof.fair) {
  await submitFeedback(identityId, ReputationCategory.Economic, +10, "TEE verified fair trade");
}
```

**Stake-Based Validation**:
```typescript
// Community validates claims
await requestValidation({
  identityId,
  claim: "First to solo Gold Dragon",
  requiredStake: 100 // GOLD
});

// Validators stake to confirm
await validateClaim(claimId, isValid: true, stake: 100);
```

#### Phase 3: Cross-Game Reputation

```typescript
// Export reputation to other ERC-8004 compatible games
const portableRep = await exportReputation(identityId);

// Import to new game
await otherGame.importReputation(portableRep);
// Character starts new game with existing reputation
```

#### Phase 4: Reputation-Gated Content

```typescript
// Dungeon access requires 800 Combat Reputation
if (character.reputation.combat < 800) {
  revert("Insufficient Combat Reputation");
}

// Elite PvP arena requires 750 Overall Reputation
if (character.reputation.overall < 750) {
  revert("Insufficient Overall Reputation");
}
```

---

### 🔐 Security Considerations

#### Soul-Bound Identities

Identity tokens are **non-transferable** (soul-bound to character):

```solidity
function _beforeTokenTransfer(...) internal override {
  if (from != address(0)) {
    revert("WoGIdentity: Identity tokens are soul-bound");
  }
}
```

**Why**: Prevents reputation buying/selling. Reputation must be earned.

#### Authorized Reporters

Only authorized contracts can submit reputation:

```solidity
if (!authorizedReporters[msg.sender]) revert Unauthorized();
```

**Authorized**:
- PvP Battle Manager (combat reputation)
- Trading System (economic reputation)
- Guild Manager (social reputation)
- Crafting System (crafting reputation)
- Admin wallet (manual adjustments)

#### Score Bounds

All scores clamped to 0-1000:

```typescript
if (newScore > MAX_SCORE) newScore = MAX_SCORE;
if (newScore < MIN_SCORE) newScore = MIN_SCORE;
```

---

### 📚 Resources

- **ERC-8004 Specification**: https://eips.ethereum.org/EIPS/eip-8004
- **Official Contracts**: https://github.com/erc-8004/erc-8004-contracts
- **Example Implementation**: https://github.com/vistara-apps/erc-8004-example
- **SKALE Docs**: https://docs.skale.network

---

### 🤝 Contributing

To extend the reputation system:

1. **Add New Category**: Extend `ReputationCategory` enum
2. **Create Reporter Contract**: Implement feedback submission logic
3. **Authorize Reporter**: Call `authorizeReporter(contractAddress)`
4. **Update Weights**: Adjust `categoryWeights` if needed
5. **Test Thoroughly**: Write tests in `shard/tests/reputation.test.ts`

---

### 🐛 Troubleshooting

**Q: Reputation not updating after battle**

A: Check that:
- PvP integration is calling `pvpReputationIntegration.updateReputationFromBattle()`
- Backend wallet is authorized as reporter
- Contract addresses are correct in `.env`

**Q: "Identity not found" error**

A: Character identity must be created during minting:
```typescript
// In character minting flow
await reputationManager.createCharacterIdentity(...);
```

**Q: Transactions failing with "Unauthorized"**

A: Authorize the backend wallet:
```bash
# On-chain via contract owner
await reputationRegistry.authorizeReporter(backendWalletAddress);
```

---

**Built with ❤️ using ERC-8004 Trustless Agents Standard**
