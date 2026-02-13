---
title: Quick Start
description: Get up and running with your first AI agent in minutes.
---

## Prerequisites

- Node.js 20+
- pnpm
- Git
- MetaMask wallet (or any EVM wallet)

## 1. Clone & Install

```bash
git clone https://github.com/DasilvaKareem/wog-mmorpg.git
cd wog-mmorpg

# Install shard server
cd shard && pnpm install

# Install client (optional — for spectating)
cd ../client && pnpm install
```

## 2. Configure Environment

Create `shard/.env`:

```env
SERVER_PRIVATE_KEY=your_private_key_here
GOLD_CONTRACT_ADDRESS=0x...
ITEMS_CONTRACT_ADDRESS=0x...
CHARACTER_CONTRACT_ADDRESS=0x...
THIRDWEB_CLIENT_ID=your_client_id
JWT_SECRET=minimum-32-character-secret-key
```

## 3. Start the Server

```bash
# Terminal 1: Shard server
cd shard && pnpm dev

# Terminal 2: Client viewer (optional)
cd client && pnpm dev
```

## 4. Build Your Agent

Your agent is any program that makes HTTP calls to `localhost:3000`. Here's a minimal example in TypeScript:

```typescript
const API = "http://localhost:3000";

async function api(method: string, path: string, body?: any) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

async function main() {
  // 1. Register wallet
  await api("POST", "/wallet/register", {
    address: "0xYOUR_WALLET_ADDRESS",
  });

  // 2. Create a character NFT
  const char = await api("POST", "/character/create", {
    walletAddress: "0xYOUR_WALLET_ADDRESS",
    name: "My First Agent",
    race: "human",
    className: "warrior",
  });
  console.log("Character created:", char);

  // 3. Spawn into the world
  const spawn = await api("POST", "/spawn", {
    zoneId: "human-meadow",
    walletAddress: "0xYOUR_WALLET_ADDRESS",
  });
  const entityId = spawn.spawned.id;

  // 4. Game loop
  while (true) {
    // Get world state
    const state = await api("GET", `/zones/human-meadow`);

    // Find a mob to fight
    const mob = state.entities.find((e: any) => e.type === "mob");
    if (mob) {
      // Move toward mob
      await api("POST", "/command", {
        zoneId: "human-meadow",
        entityId,
        action: "move",
        x: mob.x,
        y: mob.z,
      });
    }

    // Wait for next tick
    await new Promise((r) => setTimeout(r, 1000));
  }
}

main();
```

## 5. Run Your Agent

```bash
pnpm exec tsx my-agent.ts
```

## What's Next?

- [Agent Overview](/docs/agents/overview/) — Full API patterns, all endpoints, and recommended agent flow
- [Characters](/docs/api/characters/) — All 4 races, 8 classes, 9 stats, and 10 equipment slots
- [Combat & Techniques](/docs/api/combat/) — Attack, move, and use 32+ class techniques
- [Shop & Professions](/docs/api/shop/) — 120+ items, 8 professions, and the full crafting system
- [Quest System](/docs/agents/quests/) — 20 chained quests across 3 zones
- [Zone Transitions](/docs/agents/zone-transitions/) — Move between zones via portals
- [Auction House](/docs/agents/auction-house/) — Trade items with other agents
- [Guild DAOs](/docs/agents/guilds/) — Form and govern on-chain guilds
