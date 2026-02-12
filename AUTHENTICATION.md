# 🔐 Authentication System

## Overview

The WoG MMORPG now has **wallet signature authentication** to prevent unauthorized API access. Only verified wallet owners can control their characters.

## How It Works

1. **Challenge**: Client requests a message to sign
2. **Sign**: User signs the message with their wallet
3. **Verify**: Server verifies the signature and issues a JWT token
4. **Authorize**: Client includes JWT token in all API requests

## Authentication Flow

```
┌─────────┐                    ┌─────────┐
│ Client  │                    │ Server  │
└────┬────┘                    └────┬────┘
     │                              │
     │  GET /auth/challenge         │
     │  ?wallet=0x...              │
     ├─────────────────────────────>│
     │                              │
     │  { message, timestamp }      │
     │<─────────────────────────────┤
     │                              │
     │  Sign message with wallet    │
     │  (using private key)         │
     │                              │
     │  POST /auth/verify           │
     │  { walletAddress, signature, │
     │    timestamp }               │
     ├─────────────────────────────>│
     │                              │
     │  { token, expiresIn: "24h" } │
     │<─────────────────────────────┤
     │                              │
     │  All future requests:        │
     │  Authorization: Bearer <token>│
     ├─────────────────────────────>│
     │                              │
```

## API Endpoints

### Public Endpoints (No Auth Required)
- `GET /health` - Server health check
- `GET /state` - View game state
- `GET /auth/challenge` - Get authentication challenge
- `POST /auth/verify` - Verify signature and get token

### Protected Endpoints (Auth Required)
When enabled, these endpoints will require authentication:
- `POST /spawn` - Spawn characters (must own the wallet)
- `POST /command` - Control entities (must own the entity)
- `POST /shop/buy` - Purchase items (must own the buyer wallet)
- `POST /techniques/learn` - Learn techniques (must own the character)
- `POST /techniques/use` - Use techniques (must own the caster)
- `POST /quests/accept` - Accept quests (must own the player)
- `POST /quests/complete` - Complete quests (must own the player)
- `POST /party/create` - Create party (must own the leader)
- All write operations

## Setup

### 1. Add JWT Secret to .env

```bash
# In shard/.env
JWT_SECRET=your-super-secret-key-change-this-in-production-min-32-chars
```

### 2. Test Authentication

```bash
cd shard
pnpm exec tsx src/authHelper.ts
```

Expected output:
```
🔐 Testing wallet authentication...

✅ Authenticated: 0xf6f0f8ca2ef85deb9eEBdBc4BC541d2D57832D4b
🔑 Token expires in: 24h

✅ Testing token verification...
✅ Token valid for wallet: 0xf6f0f8ca2ef85deb9eEBdBc4BC541d2D57832D4b

🎉 Authentication system working!
```

## Using Authentication in Agents

### Example: Authenticated Agent

```typescript
import { authenticateWithWallet, createAuthenticatedAPI } from "./authHelper.js";

const PRIVATE_KEY = process.env.AGENT_PRIVATE_KEY!;

async function runAgent() {
  // 1. Authenticate and get token
  const token = await authenticateWithWallet(PRIVATE_KEY);

  // 2. Create authenticated API client
  const api = createAuthenticatedAPI(token);

  // 3. Make authenticated requests
  const spawn = await api("POST", "/spawn", {
    zoneId: "human-meadow",
    type: "player",
    name: "Authenticated Agent",
    walletAddress: "0x...",
    // ... other params
  });

  // Token is automatically included in Authorization header
  await api("POST", "/command", {
    zoneId: "human-meadow",
    entityId: spawn.spawned.id,
    action: "move",
    x: 100,
    y: 100,
  });
}
```

### Token Refresh

Tokens expire after 24 hours. Refresh before expiry:

```typescript
const newToken = await api("POST", "/auth/refresh");
```

## Enabling Authentication on Endpoints

To protect an endpoint, add the `authenticateRequest` middleware:

```typescript
import { authenticateRequest, verifyEntityOwnership } from "./auth.js";

// Before (unprotected)
server.post<{ Body: CommandBody }>("/command", async (request, reply) => {
  // ... handle command
});

// After (protected)
server.post<{ Body: CommandBody }>("/command", {
  preHandler: authenticateRequest,
}, async (request, reply) => {
  const authenticatedWallet = (request as any).walletAddress;

  // Verify the user owns the entity they're trying to control
  const entity = zone.entities.get(entityId);
  if (!verifyEntityOwnership(entity.walletAddress, authenticatedWallet)) {
    return reply.status(403).send({ error: "Not authorized to control this entity" });
  }

  // ... handle command
});
```

## Security Features

### ✅ Implemented
- **Wallet signature verification** - Proves wallet ownership
- **JWT tokens** - Stateless authentication
- **Token expiry** - 24 hour lifespan
- **Timestamp validation** - Prevents replay attacks (5 minute window)
- **Entity ownership verification** - Users can only control their own entities

### 🔒 Best Practices
1. **Never share private keys** - Each agent should have its own wallet
2. **Use HTTPS in production** - Encrypt all traffic
3. **Rotate JWT secrets** - Change JWT_SECRET periodically
4. **Monitor API usage** - Watch for suspicious patterns
5. **Rate limiting** - Add rate limits to prevent abuse (not yet implemented)

## Rate Limiting (Future)

```typescript
// Coming soon
import rateLimit from '@fastify/rate-limit';

server.register(rateLimit, {
  max: 100, // 100 requests
  timeWindow: '1 minute', // per minute
});
```

## Environment Variables

```bash
# Required
JWT_SECRET=minimum-32-character-secret-key-for-production

# Optional
API_URL=http://localhost:3000  # Default
```

## Testing Checklist

- [ ] JWT_SECRET is set in .env
- [ ] `pnpm exec tsx src/authHelper.ts` passes
- [ ] Agents can authenticate and get tokens
- [ ] Protected endpoints reject requests without tokens
- [ ] Protected endpoints reject invalid/expired tokens
- [ ] Users can only control their own entities

## Migration Guide

### For Existing Agents

1. Add authentication to your agent:

```typescript
import { authenticateWithWallet, createAuthenticatedAPI } from "./authHelper.js";

// Old (before authentication)
async function api(method: string, path: string, body?: any) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

// New (with authentication)
const PRIVATE_KEY = process.env.AGENT_PRIVATE_KEY!;
const token = await authenticateWithWallet(PRIVATE_KEY);
const api = createAuthenticatedAPI(token);
```

2. Add agent wallet private key to .env:

```bash
AGENT_PRIVATE_KEY=0x...your_agent_private_key...
```

### Gradual Rollout

You can enable authentication gradually:

1. **Phase 1** (Current): Auth system available but optional
2. **Phase 2**: Protect sensitive endpoints (spawn, shop, techniques)
3. **Phase 3**: Require auth for all write operations
4. **Phase 4**: Add rate limiting and advanced security

## Troubleshooting

### "Invalid signature"
- Check that the wallet address matches the signer
- Verify timestamp is recent (within 5 minutes)
- Ensure message format matches exactly

### "Token expired"
- Tokens last 24 hours
- Use `/auth/refresh` to get a new token
- Re-authenticate with wallet signature

### "Not authorized to control this entity"
- Entity's walletAddress must match authenticated wallet
- Check that you spawned the entity with the correct wallet

## API Reference

### GET /auth/challenge
Get a message to sign for authentication.

**Query Parameters:**
- `wallet` (string, required): Wallet address (0x...)

**Response:**
```json
{
  "message": "Sign this message to authenticate...",
  "timestamp": 1770886481000,
  "wallet": "0x..."
}
```

### POST /auth/verify
Verify signature and get JWT token.

**Body:**
```json
{
  "walletAddress": "0x...",
  "signature": "0x...",
  "timestamp": 1770886481000
}
```

**Response:**
```json
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "walletAddress": "0x...",
  "expiresIn": "24h"
}
```

### GET /auth/verify-token
Check if token is still valid (requires auth).

**Headers:**
```
Authorization: Bearer <token>
```

**Response:**
```json
{
  "valid": true,
  "walletAddress": "0x..."
}
```

### POST /auth/refresh
Get a new token before expiry (requires auth).

**Headers:**
```
Authorization: Bearer <old_token>
```

**Response:**
```json
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "walletAddress": "0x...",
  "expiresIn": "24h"
}
```

---

**Security is a journey, not a destination. Keep your game safe!** 🛡️
