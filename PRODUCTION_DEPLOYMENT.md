# WoG MMORPG - Production Deployment Guide (Fly.io)

## 🚨 CRITICAL: In-Memory Storage Issues

**EVERYTHING IS IN-MEMORY RIGHT NOW!** Here's what gets wiped on restart:

### Data Loss on Restart:
1. ❌ **X402 Custodial Wallets** - `custodialWallet.ts` uses `Map<string, string>`
2. ❌ **All Game State** - Zones, entities, player positions
3. ❌ **Party System** - Active parties
4. ❌ **PvP Battles** - Battle state, matchmaking
5. ❌ **Rate Limiting** - Deployment rate limits
6. ✅ **Blockchain State** - Safe (on SKALE chain)

---

## Quick Fix: Add Redis for Session Data

### 1. Add Fly.io Redis

```bash
# Create Redis instance
fly redis create wog-redis --region sjc

# Will output connection URL like:
# redis://default:password@fly-wog-redis.upstash.io
```

### 2. Update `.env` (Production)

```bash
# Add to fly secrets
fly secrets set \
  REDIS_URL="redis://default:password@fly-wog-redis.upstash.io" \
  THIRDWEB_SECRET_KEY="your-prod-key" \
  SERVER_PRIVATE_KEY="your-prod-wallet-key" \
  JWT_SECRET="your-prod-jwt-secret" \
  ENCRYPTION_KEY="$(openssl rand -hex 32)" \
  STRIPE_SECRET_KEY="sk_live_your_live_key"
```

### 3. Install Redis Client

```bash
cd shard
pnpm add ioredis
```

---

## Updated Files for Production

### 1. Fix Client Proxy (Environment-Aware)

Update `client/vite.config.ts`:

```typescript
import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    proxy: {
      // Use environment variable for API URL (defaults to localhost for dev)
      "/health": process.env.VITE_API_URL || "http://localhost:3000",
      "/zones": process.env.VITE_API_URL || "http://localhost:3000",
      "/state": process.env.VITE_API_URL || "http://localhost:3000",
      "/spawn": process.env.VITE_API_URL || "http://localhost:3000",
      "/command": process.env.VITE_API_URL || "http://localhost:3000",
      "/wallet": process.env.VITE_API_URL || "http://localhost:3000",
      "/shop": process.env.VITE_API_URL || "http://localhost:3000",
      "/character": process.env.VITE_API_URL || "http://localhost:3000",
      "/events": process.env.VITE_API_URL || "http://localhost:3000",
      "/techniques": process.env.VITE_API_URL || "http://localhost:3000",
      "/x402": process.env.VITE_API_URL || "http://localhost:3000",
      "/v1": process.env.VITE_API_URL || "http://localhost:3000",
      "/v2": process.env.VITE_API_URL || "http://localhost:3000",
    },
  },
});
```

### 2. Update fly.toml (Add Redis + Secrets)

```toml
# fly.toml app configuration file
app = "wog-mmorpg"
primary_region = "sjc"

[build]

[http_service]
  internal_port = 3000
  force_https = true
  auto_stop_machines = false
  auto_start_machines = true
  min_machines_running = 1
  processes = ["app"]

  [[http_service.checks]]
    grace_period = "10s"
    interval = "30s"
    method = "GET"
    timeout = "5s"
    path = "/health"

[[vm]]
  memory = '1gb'  # Increased from 512mb for Redis + game state
  cpu_kind = 'shared'
  cpus = 1

[env]
  PORT = "3000"
  NODE_ENV = "production"

# NOTE: Secrets are set via `fly secrets set` command, not here!
# Do NOT put sensitive values in this file
```

### 3. Create Redis-Backed Custodial Wallet Storage

Create `shard/src/custodialWalletRedis.ts`:

```typescript
import Redis from "ioredis";
import { encrypt, decrypt } from "./encryption.js";

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY!;
const redis = process.env.REDIS_URL
  ? new Redis(process.env.REDIS_URL)
  : null;

// Fallback to in-memory if Redis not configured (dev mode)
const inMemoryStore = new Map<string, string>();

export async function storeCustodialWallet(address: string, privateKey: string): Promise<void> {
  const encryptedKey = encrypt(privateKey, ENCRYPTION_KEY);

  if (redis) {
    await redis.set(`wallet:${address.toLowerCase()}`, encryptedKey);
  } else {
    inMemoryStore.set(address.toLowerCase(), encryptedKey);
  }
}

export async function getCustodialWallet(address: string): Promise<string | null> {
  const normalizedAddress = address.toLowerCase();

  if (redis) {
    const encryptedKey = await redis.get(`wallet:${normalizedAddress}`);
    return encryptedKey ? decrypt(encryptedKey, ENCRYPTION_KEY) : null;
  } else {
    const encryptedKey = inMemoryStore.get(normalizedAddress);
    return encryptedKey ? decrypt(encryptedKey, ENCRYPTION_KEY) : null;
  }
}

export async function hasCustodialWallet(address: string): Promise<boolean> {
  const normalizedAddress = address.toLowerCase();

  if (redis) {
    return await redis.exists(`wallet:${normalizedAddress}`) === 1;
  } else {
    return inMemoryStore.has(normalizedAddress);
  }
}

export async function deleteCustodialWallet(address: string): Promise<boolean> {
  const normalizedAddress = address.toLowerCase();

  if (redis) {
    return await redis.del(`wallet:${normalizedAddress}`) === 1;
  } else {
    return inMemoryStore.delete(normalizedAddress);
  }
}
```

---

## Deployment Checklist

### Pre-Deployment

- [ ] **Install Redis on Fly.io** (`fly redis create`)
- [ ] **Generate production secrets**:
  ```bash
  # Generate strong secrets
  openssl rand -hex 32  # For JWT_SECRET
  openssl rand -hex 32  # For ENCRYPTION_KEY
  ```
- [ ] **Set Fly secrets** (see commands above)
- [ ] **Update Dockerfile** (if needed for Redis client)
- [ ] **Test locally with Redis**:
  ```bash
  export REDIS_URL="redis://localhost:6379"
  pnpm dev
  ```

### Deployment

```bash
# 1. Deploy shard server
cd shard
fly deploy

# 2. Check logs
fly logs

# 3. Test endpoints
curl https://wog-mmorpg.fly.dev/health
curl https://wog-mmorpg.fly.dev/x402/info

# 4. Deploy client (if separate app)
cd ../client
fly deploy  # or your client deployment command
```

### Post-Deployment Verification

- [ ] **Health check**: `curl https://wog-mmorpg.fly.dev/health`
- [ ] **X402 discovery**: `curl https://wog-mmorpg.fly.dev/x402/info`
- [ ] **Test deployment**:
  ```bash
  curl -X POST https://wog-mmorpg.fly.dev/x402/deploy \
    -H "Content-Type: application/json" \
    -d '{
      "agentName": "ProdTest",
      "character": {"name": "TestChar", "race": "human", "class": "warrior"},
      "payment": {"method": "free"},
      "deploymentZone": "human-meadow"
    }'
  ```
- [ ] **Check Redis**: Verify wallet stored
- [ ] **Test restart**: `fly apps restart wog-mmorpg` → Verify data persists

---

## Environment Variables Reference

### Required for Production

```bash
# Blockchain
THIRDWEB_SECRET_KEY=your-prod-thirdweb-key
SERVER_PRIVATE_KEY=0x...your-prod-wallet-private-key

# Contracts (same as dev, deployed on SKALE testnet)
GOLD_CONTRACT_ADDRESS=0x421699e71bBeC7d05FCbc79C690afD5D8585f182
ITEMS_CONTRACT_ADDRESS=0xAe68cdA079fd699780506cc49381EE732837Ec35
CHARACTER_CONTRACT_ADDRESS=0x331dAdFFFFC8A126a739CA5CCAd847c29973B642
TRADE_CONTRACT_ADDRESS=0x74Ae909712bCa5D8828d5AF9a272a2F7Eb1886A6
AUCTION_HOUSE_CONTRACT_ADDRESS=0x1677d33f707F082E21F23821e3074e921b2c301e
GUILD_CONTRACT_ADDRESS=0x0FAd20d1052BC4327D0e07Aa3De64EEC6C3DfF39
GUILD_VAULT_CONTRACT_ADDRESS=0x71Fa28e9cA4f284A426e17c3E1aff0722D1eb215

# Security
JWT_SECRET=your-prod-jwt-secret-64-chars-min
ENCRYPTION_KEY=your-prod-encryption-key-64-chars-min

# X402
STRIPE_SECRET_KEY=sk_live_your_stripe_live_key

# Database
REDIS_URL=redis://default:password@fly-wog-redis.upstash.io

# Optional (for prediction markets)
PREDICTION_CONTRACT_ADDRESS=0x...if-deployed
```

---

## Localhost References to Fix

### Files with localhost URLs (update for production):

1. **docs/X402_AGENT_DEPLOYMENT.md** - Change `http://localhost:3000` to `https://wog-mmorpg.fly.dev`
2. **docs/X402_EXAMPLES.md** - Update all Python/Node.js examples
3. **docs/X402_IMPLEMENTATION_STATUS.md** - Update test commands
4. **All other docs/** - Search and replace localhost references

### Quick Fix:

```bash
cd /Users/kareemdasilva/wog/mmorpg
find docs -name "*.md" -exec sed -i '' 's|http://localhost:3000|https://wog-mmorpg.fly.dev|g' {} \;
```

---

## Database Strategy (Long-Term)

### Option 1: Redis Only (Simple)
- ✅ Fast
- ✅ Easy to setup
- ❌ Limited query capabilities
- ❌ Higher memory usage

### Option 2: PostgreSQL + Redis (Recommended)
- ✅ Relational data (guilds, quests, etc.)
- ✅ Redis for sessions/cache
- ✅ Better for complex queries
- ❌ More complex setup

```bash
# Add Postgres
fly postgres create wog-db --region sjc
fly postgres attach wog-db

# Will give you DATABASE_URL
```

### Option 3: Fly Volumes (Persistent Storage)
- ✅ Simple
- ✅ Fast local disk
- ❌ Not replicated (single point of failure)

```bash
fly volumes create wog_data --region sjc --size 10
```

---

## Cost Estimate (Fly.io)

- **Shard Server**: ~$5/month (shared-cpu-1x, 1GB RAM)
- **Redis**: ~$2/month (Upstash free tier or Fly Redis)
- **Postgres** (if needed): ~$3/month (1GB storage)
- **Total**: ~$10/month for MVP

---

## Monitoring

```bash
# Real-time logs
fly logs -a wog-mmorpg

# Metrics
fly dashboard

# SSH into machine
fly ssh console

# Check Redis
fly redis connect
```

---

## Rollback

```bash
# List deployments
fly releases

# Rollback to previous version
fly releases rollback <version>
```

---

## Next Steps

1. **Immediate**: Set up Redis for X402 wallets
2. **Week 1**: Test full production deployment
3. **Week 2**: Add Postgres for persistent game state
4. **Week 3**: Set up monitoring & alerting
5. **Week 4**: Load testing & optimization
