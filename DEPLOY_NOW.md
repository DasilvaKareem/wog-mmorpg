# 🚀 DEPLOY TO PRODUCTION NOW - Quick Start

## TL;DR

```bash
# 1. Create Redis
fly redis create wog-redis --region sjc

# 2. Set secrets
fly secrets set \
  THIRDWEB_SECRET_KEY="$(grep THIRDWEB_SECRET_KEY shard/.env | cut -d= -f2)" \
  SERVER_PRIVATE_KEY="$(grep SERVER_PRIVATE_KEY shard/.env | cut -d= -f2)" \
  JWT_SECRET="$(openssl rand -hex 32)" \
  ENCRYPTION_KEY="$(openssl rand -hex 32)" \
  REDIS_URL="redis://..." \
  GOLD_CONTRACT_ADDRESS="0x421699e71bBeC7d05FCbc79C690afD5D8585f182" \
  ITEMS_CONTRACT_ADDRESS="0xAe68cdA079fd699780506cc49381EE732837Ec35" \
  CHARACTER_CONTRACT_ADDRESS="0x331dAdFFFFC8A126a739CA5CCAd847c29973B642" \
  TRADE_CONTRACT_ADDRESS="0x74Ae909712bCa5D8828d5AF9a272a2F7Eb1886A6" \
  AUCTION_HOUSE_CONTRACT_ADDRESS="0x1677d33f707F082E21F23821e3074e921b2c301e" \
  GUILD_CONTRACT_ADDRESS="0x0FAd20d1052BC4327D0e07Aa3De64EEC6C3DfF39" \
  GUILD_VAULT_CONTRACT_ADDRESS="0x71Fa28e9cA4f284A426e17c3E1aff0722D1eb215"

# 3. Deploy
./deploy-production.sh
```

---

## Step-by-Step (5 Minutes)

### 1. Install Fly CLI (if not installed)

```bash
curl -L https://fly.io/install.sh | sh
fly auth login
```

### 2. Create Redis (CRITICAL for X402 wallets)

```bash
fly redis create wog-redis --region sjc
```

**Copy the Redis URL** it gives you (looks like `redis://default:password@...`)

### 3. Set Production Secrets

```bash
# Generate secure secrets
JWT_SECRET=$(openssl rand -hex 32)
ENCRYPTION_KEY=$(openssl rand -hex 32)

# Get Redis URL from step 2
REDIS_URL="redis://default:your-password@fly-wog-redis.upstash.io"

# Set all secrets
fly secrets set \
  THIRDWEB_SECRET_KEY="Vp7KuCl817FH2rCXi3NZTL91-pA6X5WvfsjRA_lhIFkGvoHgXd3Qq0ozMJ4e7kOPlbMXnOjpG4YSifuC2WU5Nw" \
  SERVER_PRIVATE_KEY="0xc5a961559e58d5e386dc35335b1cc3d5be9eda8605f333576496247c977937f0" \
  JWT_SECRET="$JWT_SECRET" \
  ENCRYPTION_KEY="$ENCRYPTION_KEY" \
  REDIS_URL="$REDIS_URL" \
  GOLD_CONTRACT_ADDRESS="0x421699e71bBeC7d05FCbc79C690afD5D8585f182" \
  ITEMS_CONTRACT_ADDRESS="0xAe68cdA079fd699780506cc49381EE732837Ec35" \
  CHARACTER_CONTRACT_ADDRESS="0x331dAdFFFFC8A126a739CA5CCAd847c29973B642" \
  TRADE_CONTRACT_ADDRESS="0x74Ae909712bCa5D8828d5AF9a272a2F7Eb1886A6" \
  AUCTION_HOUSE_CONTRACT_ADDRESS="0x1677d33f707F082E21F23821e3074e921b2c301e" \
  GUILD_CONTRACT_ADDRESS="0x0FAd20d1052BC4327D0e07Aa3De64EEC6C3DfF39" \
  GUILD_VAULT_CONTRACT_ADDRESS="0x71Fa28e9cA4f284A426e17c3E1aff0722D1eb215"
```

### 4. Deploy

```bash
cd shard
pnpm run build
fly deploy
```

### 5. Verify

```bash
# Health check
curl https://wog-mmorpg.fly.dev/health

# X402 info
curl https://wog-mmorpg.fly.dev/x402/info

# Test deployment
curl -X POST https://wog-mmorpg.fly.dev/x402/deploy \
  -H "Content-Type: application/json" \
  -d '{
    "agentName": "ProdTest",
    "character": {"name": "Hero", "race": "human", "class": "warrior"},
    "payment": {"method": "free"},
    "deploymentZone": "human-meadow"
  }'
```

---

## ⚠️ Current Limitations (In-Memory Data)

### Will Be Lost on Restart:
- ❌ Zone state (player positions, entities)
- ❌ Party system
- ❌ PvP battles
- ❌ Rate limits

### Safe (Persisted):
- ✅ X402 custodial wallets (if Redis configured)
- ✅ Blockchain data (NFTs, gold, guilds)

---

## 🎯 Production URLs

Once deployed:

- **API**: https://wog-mmorpg.fly.dev
- **Health**: https://wog-mmorpg.fly.dev/health
- **X402**: https://wog-mmorpg.fly.dev/x402/info
- **Zones**: https://wog-mmorpg.fly.dev/zones

---

## 📊 Monitoring

```bash
# Live logs
fly logs -a wog-mmorpg

# Dashboard
fly dashboard

# SSH into server
fly ssh console -a wog-mmorpg

# Restart
fly apps restart wog-mmorpg
```

---

## 🐛 Troubleshooting

### "Connection refused"
```bash
fly logs -a wog-mmorpg
# Check for startup errors
```

### "Secrets not set"
```bash
fly secrets list
# Verify all secrets are set
```

### "Redis connection failed"
```bash
fly redis connect
# Test Redis connection
```

### "X402 wallets not persisting"
```bash
# Check if REDIS_URL is set
fly secrets list | grep REDIS

# Check logs
fly logs | grep custodial
```

---

## 💰 Cost

- **Shard**: ~$5/month (shared-cpu-1x, 1GB RAM)
- **Redis**: Free tier (or ~$2/month)
- **Total**: ~$5-7/month

---

## Next Steps After Deployment

1. **Update docs** with production URLs
2. **Add Postgres** for game state persistence
3. **Set up monitoring** (Sentry, Datadog, etc.)
4. **Enable Stripe** (add live key for payments)
5. **Add CI/CD** (auto-deploy on git push)

---

## 🎉 You're Live!

Your game is now running on Fly.io with:
- ✅ X402 agent deployment API
- ✅ Blockchain integration (SKALE)
- ✅ Redis-backed wallet storage
- ✅ Auto-scaling
- ✅ SSL/HTTPS
- ✅ Health checks
