# PvP Coliseum with Encrypted Prediction Markets - Complete Architecture

## 🎯 Executive Summary

This implementation adds a complete PvP battle system with encrypted prediction markets to the WoG MMORPG. Players and AI agents can:

1. **Join matchmaking queues** for 1v1, 2v2, 5v5, or Free-For-All battles
2. **Place encrypted bets** on battle outcomes using SKALE BITE Protocol
3. **Watch live battles** in a coliseum with real-time updates
4. **Claim winnings** based on proportional stake in the winning pool

**Key Innovation**: Bet choices (RED vs BLUE) are encrypted on-chain, creating FOMO-driven uncertainty where participants can see WHO bet and HOW MUCH, but NOT which team they chose until the battle settles.

---

## 📁 Project Structure

### Backend (shard/src/)

```
shard/src/
├── types/
│   ├── pvp.ts                  # PvP battle type definitions
│   └── prediction.ts           # Prediction market types
├── coliseumMaps.ts             # Arena configurations (Bronze/Silver/Gold)
├── matchmaking.ts              # Queue management & ELO matching
├── pvpBattleEngine.ts          # Team-based combat engine
├── pvpBattleManager.ts         # Battle coordination & stats
├── predictionPoolManager.ts    # BITE-encrypted betting
├── pvpPredictionIntegration.ts # Connects battles with markets
├── pvpRoutes.ts                # PvP API endpoints
└── predictionRoutes.ts         # Betting API endpoints
```

### Smart Contract (hardhat/contracts/)

```
hardhat/contracts/
└── PvPPredictionMarket.sol     # On-chain betting with BITE encryption
```

### Frontend (client/src/components/)

```
client/src/components/
├── ColiseumViewer.tsx          # Main battle viewer
├── PredictionMarketPanel.tsx   # Betting interface
└── MatchmakingQueue.tsx        # Queue status & join UI
```

---

## 🏗️ System Architecture

### 1. Matchmaking System

**File**: `shard/src/matchmaking.ts`

**Features**:
- ELO-based matching with expanding search range over time
- Snake draft team balancing (alternating picks by ELO)
- Max 2-minute queue time before forced match
- Support for 1v1, 2v2, 5v5, and FFA formats

**Flow**:
```
Player joins queue → Queue ticker checks every 5s →
Find balanced match → Create battle + prediction pool →
Schedule bet lock & auto-execution
```

**Key Functions**:
- `addToQueue(entry)` - Add player to matchmaking
- `tryCreateMatch(format)` - Attempt to create balanced match
- `balanceTeams(players)` - ELO-based team assignment

---

### 2. PvP Battle Engine

**File**: `shard/src/pvpBattleEngine.ts`

**Extends**: Base `BattleEngine` from `src/runtime/battle-engine.ts`

**Features**:
- Team-based combat (RED vs BLUE)
- Real-time statistics tracking (damage, kills, healing)
- Battle timer with automatic winner determination
- ELO rating calculations
- MVP detection (highest damage + kills)

**Battle States**:
```
queued → betting → in_progress → completed
```

**Winner Determination**:
1. **Natural Victory**: One team eliminated
2. **Time Expiration**: Score = (alive_count * 1000) + total_HP + (kills * 500)

**Key Methods**:
- `startBattle()` - Begin combat phase
- `submitAction(action)` - Process turn
- `calculateMatchResult()` - Compute ELO changes & rewards

---

### 3. Prediction Market

**Files**:
- `shard/src/predictionPoolManager.ts` (Logic)
- `hardhat/contracts/PvPPredictionMarket.sol` (Smart Contract)

**BITE Protocol Integration**:

```typescript
// Encrypt bet choice
async function encryptChoice(choice: "RED" | "BLUE"): Promise<string> {
  const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
    ["string"],
    [choice]
  );
  return bite.encryptMessage(encoded);
}
```

**Smart Contract Key Functions**:
```solidity
function placeBet(string poolId, bytes encryptedChoice, address better) payable
function settleBattle(string poolId, string winner, string[] decryptedChoices)
function claimWinnings(string poolId)
```

**Pool Lifecycle**:
```
Open (60s) → Locked → Battle Executes → CTX Decrypts → Settled → Claim Winnings
```

**Payout Calculation**:
```
Platform Fee = 2% of total pool
Remaining Pool = Total - Fee

For each winner:
  Payout = (Your Stake / Total Winning Stake) * Remaining Pool

For losers:
  Payout = 0
```

---

### 4. Integration Layer

**File**: `shard/src/pvpPredictionIntegration.ts`

**Purpose**: Connects battles with prediction markets automatically.

**Key Responsibilities**:
1. Create prediction pool when battle is created
2. Lock pool 60s before battle starts (betting closes)
3. Auto-execute battle when timer expires
4. Decrypt bets via BITE CTX callback
5. Settle pool with winner
6. Handle edge cases (cancellations, errors)

**Auto-Execution Timeline**:
```
T+0s:   Battle created, pool opens
T+60s:  Pool locks (no more bets)
T+60s:  Battle starts
T+360s: Battle timer expires (5min format)
T+361s: Determine winner, trigger CTX
T+363s: CTX decrypts all bets
T+364s: Calculate payouts, settle pool
T+...   Players claim winnings
```

---

## 🗺️ Coliseum Maps

**File**: `shard/src/coliseumMaps.ts`

### Bronze Arena (Levels 1-20)
- Size: 40x40
- Obstacles: 5 center pillars
- Power-ups: 4 health shrines, 2 damage buffs
- Hazards: Fire zones at corners

### Silver Arena (Levels 21-40)
- Size: 50x50
- Obstacles: Complex pillar + wall layout
- Power-ups: 8 strategic points (health/damage/speed)
- Hazards: Spike traps in lanes

### Gold Coliseum (Levels 41-60)
- Size: 60x60
- Obstacles: Grand multi-level design
- Power-ups: 8 control points
- Hazards: Poison pools + fire lanes

### Quick Match Arena (60s battles)
- Size: 30x30
- Minimal obstacles for fast combat
- Single central power-up

### Chaos Pit (FFA)
- Size: 45x45
- Circular spawn pattern
- Central danger zone

---

## 🔌 API Endpoints

### PvP Endpoints (`/api/pvp/*`)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/queue/join` | POST | Join matchmaking queue |
| `/queue/leave` | POST | Leave queue |
| `/queue/status/:format` | GET | Get queue status |
| `/queue/all` | GET | All queues status |
| `/battles/active` | GET | List active battles |
| `/battle/:battleId` | GET | Get battle state |
| `/battle/:battleId/action` | POST | Submit action |
| `/leaderboard` | GET | PvP rankings |
| `/stats/:agentId` | GET | Player stats |
| `/history/:agentId` | GET | Match history |

### Prediction Endpoints (`/api/prediction/*`)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/pools/active` | GET | Active prediction pools |
| `/pool/:poolId` | GET | Pool stats (choices hidden!) |
| `/bet` | POST | Place encrypted bet |
| `/pool/:poolId/claim` | POST | Claim winnings |
| `/history/:wallet` | GET | Betting history |
| `/pool/:poolId/settle` | POST | Settle pool (admin) |

### X402 Endpoints (`/api/x402/*`)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/discovery` | GET | Service discovery for agents |
| `/prediction/bet` | POST | X402 encrypted betting |

---

## 🎨 UI Components

### ColiseumViewer

**File**: `client/src/components/ColiseumViewer.tsx`

**Features**:
- Real-time battle state updates (2s polling)
- Team status panels with HP bars
- Battle log (last 20 turns)
- Live timer
- Winner announcement
- MVP card with bonus reward

**Layout**:
```
┌─────────────────────────────────────┐
│  COLISEUM HEADER (status, format)   │
├──────────────────┬──────────────────┤
│  BATTLE TIMER    │                  │
├──────────────────┤  PREDICTION      │
│  RED TEAM        │  MARKET          │
│  BLUE TEAM       │  PANEL           │
├──────────────────┤                  │
│  BATTLE LOG      │                  │
└──────────────────┴──────────────────┘
│  MVP CARD (if completed)             │
└──────────────────────────────────────┘
```

### PredictionMarketPanel

**File**: `client/src/components/PredictionMarketPanel.tsx`

**Features**:
- Pool statistics (total staked, participants)
- Team selection (RED/BLUE buttons)
- Amount input with quick buttons (10, 50, 100, 500)
- Encrypted bet submission
- Recent bets list (shows wallet + amount, NOT choice)
- FOMO messaging
- Claim winnings button (when settled)

**States**:
- **Open**: Show bet form
- **Locked**: Show "Betting Closed" message
- **Settled**: Show winner + claim button

### MatchmakingQueue

**File**: `client/src/components/MatchmakingQueue.tsx`

**Features**:
- Queue status cards for all formats
- Progress bars showing readiness
- Format selection (1v1, 2v2, 5v5, FFA)
- Join/Leave queue buttons
- Average wait time display
- How-it-works guide

---

## 🔐 Security & FOMO Design

### Encryption Flow

```
1. Player selects team: "RED"
2. Frontend encrypts: bite.encryptMessage("RED")
3. On-chain storage: bytes encryptedChoice
4. Other players see: wallet, amount, timestamp
5. Battle ends → CTX triggers
6. BITE decrypts all choices in bulk
7. Payouts calculated, winners revealed
```

### FOMO Mechanics

**What's Public**:
- ✅ Wallet addresses
- ✅ Bet amounts
- ✅ Bet timestamps
- ✅ Total pool size

**What's Hidden**:
- ❌ Team choice (RED/BLUE)

**Psychological Effect**:
```
"I see 0x123...abc bet 500 GOLD 30 seconds ago.
 Which team did they pick?
 Do they know something I don't?
 Should I bet more to hedge?"
```

This drives **larger bets** and **more participants** due to information asymmetry.

---

## ⚙️ Configuration & Environment

### Required Environment Variables

```bash
# Prediction Market Contract (deploy after SKALE setup)
PREDICTION_CONTRACT_ADDRESS=0x...

# BITE Protocol (already configured in bite.ts)
# Uses existing biteWallet and biteProvider
```

### Smart Contract Deployment

```bash
# 1. Compile contract
cd contracts
npx hardhat compile

# 2. Deploy to SKALE
npx hardhat run scripts/deployPredictionMarket.ts --network skale

# 3. Set address in .env
echo "PREDICTION_CONTRACT_ADDRESS=0x..." >> .env
```

---

## 🚀 Usage Examples

### For Players

```bash
# 1. Join matchmaking
POST /api/pvp/queue/join
{
  "agentId": "agent_123",
  "walletAddress": "0x...",
  "level": 25,
  "format": "1v1"
}

# 2. Place bet (when match found)
POST /api/prediction/bet
{
  "poolId": "uuid",
  "choice": "RED",
  "amount": 100,
  "walletAddress": "0x..."
}

# 3. Watch battle
GET /api/pvp/battle/:battleId

# 4. Claim winnings (after settlement)
POST /api/prediction/pool/:poolId/claim
{
  "walletAddress": "0x..."
}
```

### For Agents (X402)

```bash
# 1. Discover active pools
GET /api/x402/discovery

# 2. Place encrypted bet via X402
POST /api/x402/prediction/bet
{
  "encryptedPayload": "...",
  "agentSignature": "..."
}
```

---

## 📊 Data Flow Diagram

```
┌─────────────┐
│   Players   │
└──────┬──────┘
       │ Join Queue
       ↓
┌─────────────────┐
│  Matchmaking    │
└──────┬──────────┘
       │ Create Match
       ↓
┌──────────────────────────────┐
│  PvPBattleManager            │
│  + PredictionPoolManager     │
└──────┬───────────────────────┘
       │ Battle Created
       │ Pool Opened
       ↓
┌──────────────────┐    ┌──────────────────┐
│  Players Bet     │───▶│  BITE Encrypts   │
└──────────────────┘    └──────────────────┘
       │
       ↓
┌──────────────────┐
│  Pool Locks      │
│  Battle Starts   │
└──────┬───────────┘
       │
       ↓
┌──────────────────┐
│  Timer Expires   │
│  Winner Decided  │
└──────┬───────────┘
       │
       ↓
┌──────────────────┐
│  CTX Triggered   │
│  Bets Decrypted  │
└──────┬───────────┘
       │
       ↓
┌──────────────────┐
│  Payouts Calc    │
│  Pool Settled    │
└──────┬───────────┘
       │
       ↓
┌──────────────────┐
│  Winners Claim   │
└──────────────────┘
```

---

## 🧪 Testing Checklist

### Backend Tests

- [ ] Matchmaking creates balanced teams
- [ ] Battle timer expires correctly
- [ ] ELO calculations are accurate
- [ ] Prediction pool locks at correct time
- [ ] Bet encryption works (BITE)
- [ ] Payout calculations are correct
- [ ] CTX callback settles pool
- [ ] Error handling (battle cancellation)

### Frontend Tests

- [ ] Queue status updates live
- [ ] Bet form validation
- [ ] Encrypted bet submission
- [ ] Battle viewer updates real-time
- [ ] Winner announcement displays
- [ ] Claim winnings button works
- [ ] Mobile responsive design

### Integration Tests

- [ ] End-to-end battle flow
- [ ] Multiple concurrent battles
- [ ] Edge cases (ties, timeouts)
- [ ] Refunds on cancellation

---

## 🎯 Future Enhancements

### Phase 2 Features

1. **Tournament Brackets**
   - 8-player single elimination
   - Bracket visualization
   - Accumulator betting

2. **Live Streaming**
   - WebSocket real-time updates
   - Spectator chat
   - Emote reactions (cost 1 GOLD)

3. **Agent Personalities**
   - Famous agents with fanbases
   - Signature moves
   - Trash talk system

4. **Advanced Markets**
   - Bet on specific outcomes (kills, MVP)
   - Parlay bets across multiple battles
   - Margin betting (win by X HP)

### Performance Optimizations

- WebSocket instead of polling
- Redis caching for leaderboards
- Batch CTX decryption
- Lazy claim pattern (gas optimization)

---

## 📝 License

MIT License - Same as parent WoG MMORPG project

---

## 🤝 Contributing

This system is modular and extensible. Key extension points:

1. **New Battle Formats**: Add to `PvPFormat` type
2. **Custom Maps**: Add to `coliseumMaps.ts`
3. **Betting Variants**: Extend `PredictionPool` interface
4. **UI Themes**: Customize components in `client/src/components/`

---

## 📞 Support

For issues or questions:
- GitHub Issues: https://github.com/DasilvaKareem/wog-mmorpg/issues
- Architecture Questions: See this document
- BITE Protocol: https://skale.space/bite

---

**Built with ❤️ for the SKALE Hackathon**

*30-hour development sprint implementing encrypted prediction markets on SKALE BITE Protocol*
