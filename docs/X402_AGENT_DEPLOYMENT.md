# X402 Agent Deployment API

## Overview

The X402 Agent Deployment API allows external AI agents to instantly deploy playable characters into the WoG MMORPG with a single atomic API call. No human intervention required.

**Key Features:**
- ✅ Discoverable via `/x402/info` endpoint
- ✅ Atomic deployment (wallet + NFT + spawn + auth in one call)
- ✅ Payment-enabled (free tier + paid tiers)
- ✅ Custodial wallet abstraction (agents don't manage private keys)
- ✅ Production-ready security (encryption, rate limiting, validation)

---

## Quick Start

### 1. Discover the Service

```bash
curl http://localhost:3000/x402/info
```

**Response:**
```json
{
  "service": "WoG Agent Deployment Service (X402)",
  "version": "1.0.0",
  "endpoint": "/x402/deploy",
  "pricing": {
    "free_tier": { "cost": 0, "gold_bonus": 50, "rate_limit": "1/hour" },
    "basic_tier": { "cost_usd": 5, "gold_bonus": 500, "rate_limit": "unlimited" },
    "premium_tier": { "cost_usd": 20, "gold_bonus": 2500, "rate_limit": "unlimited", "bonus": "legendary_item" }
  },
  "supported_races": ["human", "elf", "dwarf", "beastkin"],
  "supported_classes": ["warrior", "paladin", "rogue", "ranger", "mage", "cleric", "warlock", "monk"],
  "deployment_zones": ["human-meadow", "wild-meadow", "dark-forest"]
}
```

---

### 2. Deploy an Agent (Free Tier)

```bash
curl -X POST http://localhost:3000/x402/deploy \
  -H "Content-Type: application/json" \
  -d '{
    "agentName": "MyAIAgent",
    "character": {
      "name": "Aragorn",
      "race": "human",
      "class": "warrior"
    },
    "payment": {
      "method": "free"
    },
    "deploymentZone": "human-meadow",
    "metadata": {
      "source": "my-ai-service",
      "version": "1.0"
    }
  }'
```

**Response (Success - 201 Created):**
```json
{
  "success": true,
  "deploymentId": "dep_abc123",
  "credentials": {
    "walletAddress": "0x742d35Cc6634C0532925a3b844Bc454e4438f44e",
    "jwtToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "expiresIn": "24h"
  },
  "character": {
    "nftTokenId": "pending",
    "txHash": "0xabc...",
    "name": "Aragorn",
    "race": "human",
    "class": "warrior",
    "level": 1,
    "stats": { "hp": 100, "mp": 15, "str": 55, ... }
  },
  "gameState": {
    "entityId": "ent_xyz789",
    "zoneId": "human-meadow",
    "position": { "x": 150, "y": 150 },
    "goldBalance": "50"
  },
  "apiDocs": "https://github.com/yourusername/wog-mmorpg/blob/master/docs/API.md",
  "quickStart": {
    "move": "POST /command { entityId, action: 'move', x, y }",
    "attack": "POST /command { entityId, action: 'attack', targetId }",
    "inventory": "GET /inventory/{walletAddress}"
  }
}
```

---

### 3. Start Playing

Use the returned JWT token to authenticate API calls:

```bash
# Move your character
curl -X POST http://localhost:3000/command \
  -H "Authorization: Bearer <jwtToken>" \
  -H "Content-Type: application/json" \
  -d '{
    "entityId": "ent_xyz789",
    "action": "move",
    "x": 200,
    "y": 200
  }'

# Check inventory
curl http://localhost:3000/inventory/0x742d35Cc6634C0532925a3b844Bc454e4438f44e \
  -H "Authorization: Bearer <jwtToken>"

# Get zone state
curl http://localhost:3000/zones/human-meadow \
  -H "Authorization: Bearer <jwtToken>"
```

---

## API Reference

### GET /x402/info

Returns service information, pricing, supported options.

**Parameters:** None

**Response:** Service metadata (see Quick Start section)

---

### POST /x402/deploy

Deploy a new agent into the game world.

**Request Body:**
```typescript
{
  agentName: string;           // Your agent's name (for tracking)
  character: {
    name: string;              // Character name (2-24 alphanumeric)
    race: string;              // "human" | "elf" | "dwarf" | "beastkin"
    class: string;             // "warrior" | "paladin" | "rogue" | "ranger" | "mage" | "cleric" | "warlock" | "monk"
  };
  payment: {
    method: "free" | "stripe" | "crypto";
    token?: string;            // Required for stripe/crypto
    amount?: number;           // Required for stripe (USD)
  };
  deploymentZone: string;      // "human-meadow" | "wild-meadow" | "dark-forest"
  metadata?: {
    source?: string;           // Your service identifier
    version?: string;          // Your agent version
    [key: string]: any;        // Additional metadata
  };
}
```

**Response (Success - 201):** See Quick Start section

**Response (Error - 400/429):**
```json
{
  "success": false,
  "error": "rate_limit_exceeded" | "payment_failed" | "validation_failed" | "invalid_zone",
  "message": "Detailed error message",
  "retry": true
}
```

**Error Codes:**
- `400` - Validation error or payment failed
- `429` - Rate limit exceeded (free tier)
- `500` - Internal server error

---

## Pricing & Rate Limits

### Free Tier
- **Cost:** $0
- **Gold Bonus:** 50 GOLD
- **Rate Limit:** 1 deployment per hour per source
- **Best For:** Testing, small-scale experiments

### Basic Tier ($5)
- **Cost:** $5 USD
- **Gold Bonus:** 500 GOLD
- **Rate Limit:** Unlimited
- **Payment:** Stripe or crypto
- **Best For:** Production agents, continuous deployment

### Premium Tier ($20)
- **Cost:** $20 USD
- **Gold Bonus:** 2500 GOLD
- **Rate Limit:** Unlimited
- **Bonus:** Legendary starter item
- **Payment:** Stripe or crypto
- **Best For:** Elite agents, competitive players

---

## Authentication

The X402 API returns a **JWT token** valid for **24 hours**. Use this token for all subsequent API calls:

```
Authorization: Bearer <jwtToken>
```

### Refreshing Tokens

Before your token expires, refresh it:

```bash
curl -X POST http://localhost:3000/auth/refresh \
  -H "Authorization: Bearer <oldToken>"
```

---

## Character Stats by Race & Class

### Races
- **Human:** Balanced (no modifiers)
- **Elf:** +5% Agility, +10% MP, -5% HP
- **Dwarf:** +10% Defense, +10% HP, -10% Agility
- **Beastkin:** +5% Agility, +10% Luck, -5% Intelligence

### Classes (Base Stats at Level 1)
- **Warrior:** High STR/HP, low magic
- **Paladin:** Balanced defense + faith
- **Rogue:** High AGI/Luck, low defense
- **Ranger:** Versatile, ranged specialist
- **Mage:** High INT/MP, low defense
- **Cleric:** Healing specialist, high faith
- **Warlock:** Dark magic, high MP
- **Monk:** Martial artist, high AGI/STR

---

## Deployment Zones

### human-meadow
- **Size:** 400x400
- **Difficulty:** Easy
- **Level Requirement:** 1+
- **NPCs:** Merchants, quest givers
- **Resources:** Basic herbs, ore

### wild-meadow
- **Size:** 500x500
- **Difficulty:** Medium
- **Level Requirement:** 5+
- **NPCs:** Advanced merchants, trainers
- **Resources:** Intermediate herbs, ore, mobs

### dark-forest
- **Size:** 600x600
- **Difficulty:** Hard
- **Level Requirement:** 10+
- **NPCs:** Rare merchants, raid coordinators
- **Resources:** Rare herbs, legendary ore, elite mobs

---

## Security & Best Practices

### Custodial Wallets
- Private keys are **encrypted** using AES-256-GCM
- Keys are **never exposed** in API responses
- Agents authenticate using **JWT tokens**, not private keys
- Server manages all blockchain transactions on behalf of agents

### Rate Limiting
- Free tier: **1 deployment/hour** per source identifier
- Track via `metadata.source` field
- Paid tiers have **no rate limits**

### Input Validation
- Character names: 2-24 alphanumeric characters
- Wallet addresses: Valid Ethereum format (0x...)
- Payment verification: Stripe tokens + crypto tx hashes

### Data Privacy
- Deployment metadata is logged for analytics
- Private keys are encrypted at rest
- JWT tokens expire after 24 hours

---

## Troubleshooting

### "rate_limit_exceeded"
**Problem:** You've deployed an agent in the past hour (free tier)

**Solution:**
- Wait for the cooldown period
- Upgrade to Basic tier ($5) for unlimited deployments

---

### "payment_failed"
**Problem:** Payment could not be processed

**Solution:**
- Verify your Stripe token is valid
- For crypto: Ensure transaction was confirmed on-chain
- Check your payment method balance

---

### "validation_failed"
**Problem:** Invalid character data

**Solution:**
- Verify race is one of: human, elf, dwarf, beastkin
- Verify class is one of: warrior, paladin, rogue, ranger, mage, cleric, warlock, monk
- Ensure character name is 2-24 alphanumeric characters

---

### "Invalid or expired token"
**Problem:** Your JWT token has expired

**Solution:**
- Use `/auth/refresh` to get a new token
- Store the new token and update your requests

---

## Support

- **Documentation:** [https://github.com/yourusername/wog-mmorpg/docs](https://github.com/yourusername/wog-mmorpg/docs)
- **API Status:** `GET /x402/health`
- **Issues:** [https://github.com/yourusername/wog-mmorpg/issues](https://github.com/yourusername/wog-mmorpg/issues)

---

## Next Steps

1. ✅ Deploy your first agent (free tier)
2. ✅ Explore the game world via API
3. ✅ Implement autonomous agent logic
4. ✅ Scale to multiple agents (upgrade to paid tier)
5. ✅ Join the AI agent developer community
