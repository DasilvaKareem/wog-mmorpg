---
name: wog-login
description: Authenticate an Ethereum wallet with the WoG MMORPG shard and obtain a JWT for subsequent API calls.
metadata: {"openclaw":{"emoji":"⚔️","requires":{"bins":["curl","node"],"env":["WOG_WALLET_ADDRESS","WOG_PRIVATE_KEY"]}}}
---

# WoG MMORPG Login

## What it does
Performs the three-step EIP-191 wallet authentication handshake against the WoG MMORPG shard server and stores the resulting JWT so protected endpoints can be called.

## Inputs needed
- `WOG_WALLET_ADDRESS` (env) — `0x`-prefixed Ethereum wallet address
- `WOG_PRIVATE_KEY` (env) — Raw hex private key for that wallet (no `0x` prefix required)
- `WOG_SHARD_URL` (env, optional) — Base URL of the shard. Defaults to `http://localhost:3000`

## Workflow

1. **Resolve the shard URL.**
   Use `$WOG_SHARD_URL` if set, otherwise fall back to `http://localhost:3000`.

2. **Validate inputs.**
   Confirm `WOG_WALLET_ADDRESS` matches `/^0x[a-fA-F0-9]{40}$/`.
   If either required env var is missing, stop and report which one is absent.

3. **Fetch the challenge.**
   ```bash
   curl -s "${SHARD}/auth/challenge?wallet=${WOG_WALLET_ADDRESS}"
   ```
   Parse the JSON response. Extract `message` and `timestamp`.
   If the request fails or returns an error field, stop and report the error.

4. **Sign the message (EIP-191 personal_sign).**
   The exact message string from step 3 must be signed as-is — do not modify it.

   Using `cast` (Foundry) if available:
   ```bash
   cast wallet sign --private-key "$WOG_PRIVATE_KEY" "$MESSAGE"
   ```

   Using `node` as fallback:
   ```bash
   node -e "
   const { Wallet } = require('ethers');
   const w = new Wallet('$WOG_PRIVATE_KEY');
   w.signMessage('$MESSAGE').then(sig => process.stdout.write(sig));
   "
   ```

   Store the resulting hex signature as `SIGNATURE`.

5. **Submit the signature and obtain JWT.**
   ```bash
   curl -s -X POST "${SHARD}/auth/verify" \
     -H "Content-Type: application/json" \
     -d "{\"walletAddress\":\"${WOG_WALLET_ADDRESS}\",\"signature\":\"${SIGNATURE}\",\"timestamp\":${TIMESTAMP}}"
   ```
   Parse the JSON response. Extract `token`.
   If `success` is not `true`, stop and report the error message.

6. **Store the token.**
   Write the token to the session context key `WOG_JWT` so subsequent skills can read it.
   Also print the confirmation line:
   ```
   Authenticated as <walletAddress>. Token valid for 24h.
   ```

## Output format
On success, return:
```
✅ WoG login successful
Wallet:  <walletAddress>
Shard:   <shardUrl>
Token:   <first 20 chars of JWT>...
Expires: 24h from now
```

On failure, return:
```
❌ WoG login failed at step <N>: <error detail>
```

## Guardrails
- Never log or print the full private key at any point.
- Never log or print the full JWT — truncate to the first 20 characters in output.
- The timestamp window is 5 minutes. Do not cache or reuse a challenge; always fetch a fresh one.
- Do not retry more than once on a 401 response — stale challenges are rejected by the server.
- Stop immediately if `WOG_PRIVATE_KEY` is not found in the environment. Do not prompt the user to paste it into chat.

## Failure handling
- **400 on challenge:** wallet address is malformed. Verify it starts with `0x` and is 42 characters.
- **401 on verify:** signature is wrong or timestamp expired (>5 min old). Fetch a new challenge and retry once.
- **ECONNREFUSED / curl error:** shard is not running at the target URL. Report the URL and stop.
- **node/cast not found:** report which binary is missing and suggest `npm i -g ethers` or installing Foundry.

## Examples

User: "Log in to WoG with my wallet"
→ Runs the full 6-step flow, prints the success block.

User: "Authenticate to the shard so I can check my inventory"
→ Same flow, then hands off the token to the next skill.

User: "wog-login"
→ Slash command triggers the full flow directly.
