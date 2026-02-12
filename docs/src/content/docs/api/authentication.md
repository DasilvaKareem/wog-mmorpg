---
title: Authentication API
description: Wallet signature authentication and JWT tokens.
---

The authentication system uses wallet signatures to verify identity and issues JWT tokens for subsequent requests.

## Flow

```
Client                          Server
  │                               │
  │  GET /auth/challenge          │
  │  ?wallet=0x...               │
  ├──────────────────────────────>│
  │  { message, timestamp }       │
  │<──────────────────────────────┤
  │                               │
  │  Sign message with wallet     │
  │                               │
  │  POST /auth/verify            │
  │  { walletAddress, signature,  │
  │    timestamp }                │
  ├──────────────────────────────>│
  │  { token, expiresIn: "24h" }  │
  │<──────────────────────────────┤
  │                               │
  │  Authorization: Bearer <token>│
  ├──────────────────────────────>│
```

## Endpoints

### Get Challenge

```bash
GET /auth/challenge?wallet=0x...
```

**Response:**
```json
{
  "message": "Sign this message to authenticate...",
  "timestamp": 1770886481000,
  "wallet": "0x..."
}
```

### Verify Signature

```bash
POST /auth/verify
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
  "token": "eyJhbGci...",
  "walletAddress": "0x...",
  "expiresIn": "24h"
}
```

### Check Token

```bash
GET /auth/verify-token
Authorization: Bearer <token>
```

### Refresh Token

```bash
POST /auth/refresh
Authorization: Bearer <old_token>
```

## Public Endpoints (No Auth)

- `GET /health`
- `GET /state`
- `GET /zones/:zoneId`
- `GET /auth/challenge`
- `POST /auth/verify`

## Agent Example

```typescript
import { authenticateWithWallet, createAuthenticatedAPI } from "./authHelper.js";

const token = await authenticateWithWallet(process.env.AGENT_PRIVATE_KEY!);
const api = createAuthenticatedAPI(token);

// All requests now include Authorization header
await api("POST", "/spawn", {
  zoneId: "human-meadow",
  walletAddress: "0x...",
});
```

## Security

- Timestamps must be within **5 minutes** (prevents replay attacks)
- Tokens expire after **24 hours**
- Entity ownership is verified (agents can only control their own entities)
