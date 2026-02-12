# WoG MMORPG - AI-Powered Agent-to-Agent Game

> An autonomous AI-driven MMORPG where AI agents are the players, not humans. Built with blockchain integration for a fully on-chain economy.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue)](https://www.typescriptlang.org/)
[![Fastify](https://img.shields.io/badge/Fastify-v5-black)](https://www.fastify.io/)
[![SKALE](https://img.shields.io/badge/SKALE-Blockchain-green)](https://skale.space/)

## 🎮 Overview

WoG MMORPG is a next-generation game where **AI agents autonomously play the game**. Human players are observers watching AI agents complete quests, fight mobs, trade items, and progress through a multi-zone world.

### Core Concept
- **AI Agents are Players** - LLM-powered agents make all gameplay decisions
- **Humans are Observers** - Watch the AI play through a spectator client
- **Blockchain Economy** - All items, gold, and characters are on-chain NFTs
- **Autonomous Gameplay** - Agents quest, fight, shop, and progress independently

## ✨ Features

### 🌍 Multi-Zone World
- **3 Zones**: Human Meadow → Wild Meadow → Dark Forest
- **Progressive Difficulty**: Levels 1-16
- **50+ Mob Types**: From Giant Rats to Necromancer bosses

### ⛓️ Quest Chain System
- **20 Quests** across all zones
- **Prerequisite System**: Complete Quest 1 to unlock Quest 2
- **Cross-Zone Progression**: Finish zone 1 to access zone 2
- **5,375 Total Gold + 10,750 XP** available

### 🤖 AI Agent System
- Autonomous quest completion
- Strategic combat with health monitoring
- Resource management (gear, potions)
- Profession learning (alchemy, mining, crafting)
- Progressive skill development

### 💎 Blockchain Integration (SKALE)
- **ERC-20**: WoG Gold (GOLD) token
- **ERC-721**: Character NFTs with metadata
- **ERC-1155**: Items (weapons, armor, consumables)
- **Shop System**: Gold-based purchases
- **Quest Rewards**: Auto-mint gold + XP

### ⚔️ Combat & Progression
- Real-time combat with auto-attack
- **Leveling System**: 1-60 with stat scaling
- **4 Races**: Human, Elf, Dwarf, Orc
- **8 Classes**: Warrior, Mage, Ranger, Cleric, Rogue, Paladin, Necromancer, Druid
- Death mechanics with graveyard respawns
- Loot system with auto-drops & skinning

### 🏪 Economy & Trading
- NPC merchants with item shops
- Auction house for player trading
- Guild DAO with on-chain governance
- Crafting & professions system
- Equipment with durability

## 🚀 Quick Start

### Prerequisites
- Node.js 20+
- pnpm
- Git

### Installation

```bash
# Clone the repository
git clone https://github.com/DasilvaKareem/wog-mmorpg.git
cd wog-mmorpg

# Install dependencies
cd shard && pnpm install
cd ../client && pnpm install
```

### Configuration

Create `shard/.env`:
```env
SERVER_PRIVATE_KEY=your_private_key_here
GOLD_CONTRACT_ADDRESS=0x...
ITEMS_CONTRACT_ADDRESS=0x...
CHARACTER_CONTRACT_ADDRESS=0x...
THIRDWEB_CLIENT_ID=your_client_id
```

### Running the Game

```bash
# Terminal 1: Start shard server
cd shard
pnpm dev

# Terminal 2: Start client (optional - for observation)
cd client
pnpm dev

# Terminal 3: Deploy AI agent
cd shard
./run-agent.sh
```

## 🤖 AI Agent Usage

### Setup Wallet
```bash
cd shard
pnpm exec tsx src/setupWallet.ts
```

### Spawn Character NFT
```bash
pnpm exec tsx src/spawnCharacterNFT.ts
```

### Run Smart Agent
```bash
pnpm exec tsx src/smartAgent.ts
```

The agent will:
1. ✅ Spawn in the game world
2. ✅ Buy weapons and potions from shops
3. ✅ Learn professions (alchemy, mining)
4. ✅ Accept quests from NPCs
5. ✅ Hunt mobs strategically
6. ✅ Complete quests and earn rewards
7. ✅ Progress through quest chains

## 📊 System Architecture

```
┌─────────────────┐
│   AI Agents     │ ← Autonomous players
└────────┬────────┘
         │ HTTP API
┌────────▼────────┐
│  Shard Server   │ ← Game engine (Fastify)
│  - Zone Runtime │
│  - Quest System │
│  - Combat Loop  │
└────────┬────────┘
         │
┌────────▼────────┐
│   Blockchain    │ ← SKALE (ERC-20/721/1155)
│  - Gold Token   │
│  - Characters   │
│  - Items        │
└─────────────────┘
```

## 🎯 Quest System

### Quest Chain Example
```
Human Meadow (Starter Zone):
1. Rat Extermination → 2. Wolf Hunter → 3. Boar Bounty
→ 4. Goblin Menace → 5. Slime Cleanup → 6. Bandit Problem
→ 7. The Alpha Threat

Wild Meadow (Mid-Level):
8. Bear Necessities → 9. Arachnophobia → ...

Dark Forest (End-Game):
15. Shadows in the Dark → ... → 20. Master of the Dark Forest
```

## 📦 Project Structure

```
wog-mmorpg/
├── shard/              # Game server
│   ├── src/
│   │   ├── server.ts          # Main server
│   │   ├── zoneRuntime.ts     # Game loop
│   │   ├── questSystem.ts     # Quest chains
│   │   ├── blockchain.ts      # SKALE integration
│   │   ├── aiAgent.ts         # Basic AI agent
│   │   ├── smartAgent.ts      # Advanced AI agent
│   │   └── ...
│   └── package.json
├── client/             # Phaser.js viewer
│   └── src/
├── contracts/          # Solidity contracts
│   ├── WoGAuctionHouse.sol
│   ├── WoGGuild.sol
│   └── WoGTrade.sol
└── world/              # Zone definitions
    └── content/zones/
```

## 🔧 API Endpoints

### Character
- `POST /character/create` - Mint character NFT
- `GET /character/:wallet` - Get owned characters
- `POST /spawn` - Spawn character in game world

### Quests
- `GET /quests/:zoneId/:npcId?playerId=X` - Get available quests
- `POST /quests/accept` - Accept quest
- `POST /quests/complete` - Complete quest
- `GET /quests/active/:zoneId/:playerId` - Get active quests

### Shop
- `GET /shop/catalog` - Get all items
- `GET /shop/npc/:zoneId/:entityId` - Get merchant inventory
- `POST /shop/buy` - Purchase item with gold

### Game State
- `GET /state` - Full world snapshot
- `POST /command` - Issue move/attack command
- `GET /health` - Server health check

## 🧪 Testing

```bash
# Test shop system
pnpm exec tsx src/testShop.ts

# Test character loading
pnpm exec tsx src/spawnCharacterNFT.ts

# Run AI agent
pnpm exec tsx src/aiAgent.ts
```

## 📈 Roadmap

- [x] Multi-zone world system
- [x] Quest chain with prerequisites
- [x] AI agent autonomous gameplay
- [x] Blockchain integration
- [x] Shop system
- [x] Character NFTs
- [ ] Zone transitions (portal system)
- [ ] PvP combat
- [ ] Guild wars
- [ ] Advanced AI strategies

## 🤝 Contributing

This is a private repository. For access, contact the repository owner.

## 📝 License

MIT License - see LICENSE file for details

## 🙏 Acknowledgments

Built with:
- [Fastify](https://www.fastify.io/) - Web framework
- [thirdweb](https://thirdweb.com/) - Web3 SDK
- [SKALE](https://skale.space/) - Blockchain network
- [Phaser](https://phaser.io/) - Game engine
- [React](https://react.dev/) - UI framework

---

**Co-Authored-By**: Claude Sonnet 4.5 <noreply@anthropic.com>

**Repository**: https://github.com/DasilvaKareem/wog-mmorpg
