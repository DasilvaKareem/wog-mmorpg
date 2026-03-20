# WoG MMORPG - Blockchain & Crypto Integration Guide

> Complete documentation for the on-chain economy, SKALE Network integration, and cryptographic systems powering WoG MMORPG.

[![SKALE Network](https://img.shields.io/badge/SKALE-Base_Sepolia-green)](https://skale.space/)
[![thirdweb](https://img.shields.io/badge/thirdweb-SDK-purple)](https://thirdweb.com/)
[![Solidity](https://img.shields.io/badge/Solidity-0.8.24-blue)](https://soliditylang.org/)

---

## 📋 Table of Contents

- [Overview](#-overview)
- [SKALE Network Integration](#-skale-network-integration)
- [Smart Contract Architecture](#-smart-contract-architecture)
- [Token Standards](#-token-standards)
- [BITE v2 Encrypted Trading](#-bite-v2-encrypted-trading)
- [Custodial Wallet System](#-custodial-wallet-system)
- [Blockchain Setup](#-blockchain-setup)
- [Deployment Guide](#-deployment-guide)
- [API Reference](#-api-reference)
- [Security Considerations](#-security-considerations)

---

## 🌐 Overview

WoG MMORPG implements a **fully on-chain game economy** using the SKALE Network. All game assets (gold, items, characters) are represented as blockchain tokens, enabling:

- **True Asset Ownership** - Players own their in-game items as NFTs
- **Transparent Economy** - All transactions are on-chain and verifiable
- **Zero Gas Fees** - SKALE's sFUEL provides free transactions
- **Encrypted P2P Trading** - BITE v2 enables private price negotiations
- **Decentralized Governance** - Guild DAOs with on-chain voting

### Why SKALE?

SKALE Network is a **multi-chain Ethereum ecosystem** offering:
- **Zero Gas Fees** via sFUEL (free native token)
- **EVM Compatibility** - Full Ethereum smart contract support
- **High Throughput** - Fast block times for real-time gaming
- **BITE Protocol** - Blockchain-enforced privacy (encrypted transactions)
- **Production Ready** - Battle-tested infrastructure

---

## ⛓️ SKALE Network Integration

### Network Configuration

WoG MMORPG deploys to **SKALE Base Sepolia Testnet**:

```typescript
// shard/src/chain.ts
export const skaleBaseSepolia: Chain = defineChain({
  id: 103698795,
  rpc: "https://base-sepolia-testnet.skalenodes.com/v1/bite-v2-sandbox",
});
```

| Parameter | Value |
|-----------|-------|
| **Chain ID** | `103698795` |
| **RPC Endpoint** | `https://base-sepolia-testnet.skalenodes.com/v1/bite-v2-sandbox` |
| **Network Name** | SKALE Base Sepolia Testnet |
| **Currency** | sFUEL (free gas token) |
| **Block Explorer** | SKALE Explorer |

### sFUEL Distribution

New wallets receive **sFUEL** (SKALE's gas token) automatically:

```typescript
// Distribute sFUEL for gas-free transactions
await distributeSFuel(walletAddress);
```

**sFUEL is completely free** - players never pay gas fees. The server wallet distributes small amounts (0.00001 sFUEL) to enable transactions.

---

## 🏗️ Smart Contract Architecture

### Deployed Contracts

| Contract | Address | Purpose |
|----------|---------|---------|
| **WoG Gold (ERC-20)** | `0x421699e71bBeC7d05FCbc79C690afD5D8585f182` | In-game currency |
| **WoG Items (ERC-1155)** | `0xAe68cdA079fd699780506cc49381EE732837Ec35` | Weapons, armor, consumables |
| **WoG Characters (ERC-721)** | `0x331dAdFFFFC8A126a739CA5CCAd847c29973B642` | Unique character NFTs |
| **WoG Trade (BITE)** | `0x74Ae909712bCa5D8828d5AF9a272a2F7Eb1886A6` | Encrypted P2P trading |
| **WoG Auction House** | `0x1677d33f707F082E21F23821e3074e921b2c301e` | Zone-based auctions |
| **WoG Guild DAO** | `0x0FAd20d1052BC4327D0e07Aa3De64EEC6C3DfF39` | Guild governance |
| **WoG Guild Vault** | `0x71Fa28e9cA4f284A426e17c3E1aff0722D1eb215` | Guild treasury |

All contracts are **server-authoritative** - only the game server can mint/transfer tokens to prevent cheating.

### Contract Breakdown

#### 1. WoG Gold (ERC-20)
Standard fungible token for in-game currency.

**Features:**
- Mintable by server on quest completion
- Burnable for shop purchases
- Transferable between players
- On-chain balance tracking

**Usage:**
```typescript
// Mint 100 gold to player
await mintGold(playerAddress, "100");

// Check balance
const balance = await getGoldBalance(playerAddress);
```

#### 2. WoG Items (ERC-1155)
Multi-token standard for all game items (weapons, armor, potions, materials).

**Features:**
- Single contract manages 100+ item types
- Each item has unique `tokenId` (0-99+)
- Batch transfers supported
- Metadata includes stats, durability, rarity
- Auto-seeding system ensures tokenIds exist

**Item Categories:**
- **Weapons** (swords, axes, staves, daggers)
- **Armor** (helmets, chest, legs, boots, gloves, shields)
- **Consumables** (health/mana potions)
- **Materials** (ores, herbs, leather)
- **Quest Items**

**Usage:**
```typescript
// Mint 5x Health Potions (tokenId: 20)
await mintItem(playerAddress, 20n, 5n);

// Check item balance
const count = await getItemBalance(playerAddress, 20n);
```

#### 3. WoG Characters (ERC-721)
Unique character NFTs with on-chain metadata.

**Features:**
- Each character is a unique NFT
- Metadata stored on IPFS via thirdweb
- Auto-updates on level-up
- Properties: race, class, level, XP, stats

**Character Properties:**
```json
{
  "name": "Korgath the Mighty",
  "description": "Level 12 Orc Warrior",
  "properties": {
    "race": "orc",
    "class": "warrior",
    "level": 12,
    "xp": 8450,
    "stats": {
      "str": 28,
      "agi": 14,
      "int": 10,
      "sta": 24
    }
  }
}
```

**Usage:**
```typescript
// Mint new character
await mintCharacter(playerAddress, {
  name: "Korgath",
  description: "Level 1 Orc Warrior",
  properties: { race: "orc", class: "warrior", level: 1, xp: 0 }
});

// Update on level-up
await updateCharacterMetadata(character);
```

#### 4. WoG Trade (BITE v2)
**Revolutionary encrypted P2P trading** using SKALE's BITE protocol.

**How It Works:**
1. **Seller** encrypts ask price, lists item on-chain
2. **Buyer** encrypts bid price, submits offer
3. **BITE Protocol** decrypts both prices atomically in block N+1
4. **Smart Contract** matches trade if `bid >= ask`
5. **No Price Leakage** - neither party sees the other's price before matching

**Encryption Flow:**
```
Seller: Item + Encrypt(askPrice) → Blockchain
Buyer: Encrypt(bidPrice) → Blockchain
BITE: Decrypt(ask, bid) → Match if bid >= ask
```

**Security:**
- Prices remain encrypted until match
- Prevents front-running and price manipulation
- No trusted third party needed
- Atomic settlement (trade or no trade)

**Contract Code Highlights:**
```solidity
// contracts/WoGTrade.sol
function submitOffer(
    uint256 tradeId,
    bytes calldata encryptedBidPrice,
    address buyer
) external payable onlyOwner returns (address) {
    // Submit both encrypted prices to BITE
    address payable ctxSender = BITELib.submitCTX(
        msg.value / tx.gasprice,
        [t.encryptedAskPrice, encryptedBidPrice],
        [abi.encode(tradeId)]
    );
    // BITE calls onDecrypt() in next block with decrypted prices
}
```

#### 5. WoG Auction House
Zone-based English auction system with anti-snipe protection.

**Features:**
- **Regional Auctions** - scoped by game zone
- **Anti-Snipe Extensions** - auto-extends if bid in last 5 minutes
- **Instant Buyout** - optional buyout price
- **Outbid Refunds** - previous bidders get gold back
- **Bid Increments** - minimum 10 gold over current bid

**Auction Lifecycle:**
```
Created → Active → [Bids] → [Extended if sniped] → Ended → Settled
```

**Usage:**
```typescript
// Create 24-hour auction
await createAuction({
  zoneId: "wild_meadow",
  seller: playerAddress,
  tokenId: 15n, // Epic Sword
  quantity: 1n,
  startPrice: 100, // 100 gold starting bid
  duration: 86400, // 24 hours
  buyoutPrice: 500 // Optional instant buyout
});

// Place bid (server checks player has gold)
await placeBid(auctionId, bidderAddress, 150);
```

#### 6. WoG Guild DAO
On-chain guild governance and treasury management.

**Features:**
- **Member Management** - add/remove members, assign roles
- **Proposal System** - vote on treasury spending, policy changes
- **Treasury** - shared guild vault for items/gold
- **Contribution Tracking** - on-chain record of member donations
- **Quorum Requirements** - proposals need minimum votes to pass

---

## 🪙 Token Standards

### ERC-20 (Gold)
- **Standard**: Fungible token
- **Decimals**: 18
- **Supply**: Unlimited (minted on-demand)
- **Use Cases**: Quest rewards, shop purchases, auction payments

### ERC-721 (Characters)
- **Standard**: Non-fungible token
- **Metadata**: IPFS via thirdweb
- **Uniqueness**: Each character is 1-of-1
- **Use Cases**: Character ownership, trading, progression tracking

### ERC-1155 (Items)
- **Standard**: Multi-token (semi-fungible)
- **Token IDs**: 0-99+ (one per item type)
- **Batch Support**: Transfer multiple item types in one transaction
- **Use Cases**: Equipment, consumables, materials, quest items

---

## 🔐 BITE v2 Encrypted Trading

### What is BITE?

**BITE (Blockchain-enforced Incentivized Transaction Execution)** is SKALE's protocol for **on-chain privacy**. It enables smart contracts to:
- Accept encrypted inputs
- Decrypt them atomically in a later block
- Execute logic based on decrypted values
- **Without revealing private data publicly**

### WoG Trade Implementation

WoG uses BITE for **sealed-bid auctions** in P2P trading:

```typescript
// Server-side: Seller lists item with encrypted price
const askPrice = 150; // Hidden from buyers
const encryptedAsk = await encryptBITE(askPrice);
await createTrade(encryptedAsk, tokenId, quantity, sellerAddress);

// Buyer submits encrypted bid
const bidPrice = 160; // Hidden from seller
const encryptedBid = await encryptBITE(bidPrice);
await submitOffer(tradeId, encryptedBid, buyerAddress);

// BITE decrypts and matches in next block
// Contract: if (decryptedBid >= decryptedAsk) → TRADE MATCHED
```

### BITE Benefits for Gaming
- **Fair Pricing** - No information asymmetry
- **Anti-Sniping** - Can't front-run trades
- **Privacy** - Strategic advantage for traders
- **Trust-Minimized** - No escrow or middleman needed

### Technical Details

**Encryption Method**: SKALE uses **threshold encryption** where validators collectively decrypt without any single validator seeing the plaintext.

**Gas Costs**: CTX (Conditional Transaction) requires sFUEL to fund the callback gas. Server provides this automatically.

**Latency**: Decryption happens in block N+1, adding ~5-10 second delay.

---

## 👛 Custodial Wallet System

For onboarding ease, WoG supports **custodial wallets** managed by the game server.

### How It Works

```typescript
// 1. Server creates wallet for new player
const wallet = createCustodialWallet();
// Returns: { address: "0xabc...", createdAt: 1234567890 }

// 2. Private key encrypted with AES-256 and stored
// Format: Map<address, encryptedPrivateKey>

// 3. Server signs transactions on behalf of player
const account = getCustodialWallet(playerAddress);
const tx = await sendTransaction({ account, ... });

// 4. Player can export wallet later to take custody
const privateKey = exportCustodialWallet(playerAddress);
```

### Storage Options

**In-Memory (Default)**:
```typescript
// shard/src/custodialWallet.ts
const custodialWallets = new Map<string, string>();
```

**Redis (Production)**:
```typescript
// shard/src/custodialWalletRedis.ts
await redis.set(`custodial:${address}`, encryptedPrivateKey);
```

### Security Model

| Layer | Protection |
|-------|------------|
| **Encryption** | AES-256-GCM with unique ENCRYPTION_KEY |
| **Key Management** | Private keys never stored in plaintext |
| **Access Control** | Only server can decrypt and sign |
| **Export Mechanism** | Players can claim custody anytime |
| **Redis Persistence** | Production uses encrypted Redis storage |

**WARNING**: Custodial wallets require **absolute trust** in the server operator. For maximum security, players should:
1. Export their private key
2. Use a self-custody wallet (MetaMask, etc.)
3. Sign transactions client-side

---

## 🛠️ Blockchain Setup

### Prerequisites

1. **Node.js 20+**
2. **pnpm** package manager
3. **SKALE wallet** with sFUEL
4. **thirdweb account** (free)

### Step 1: Get sFUEL

SKALE sFUEL is **completely free**. Get it from:
- [SKALE Faucet](https://www.sfuel.skale.network/)
- Or programmatically via `distributeSFuel()`

### Step 2: Create thirdweb Account

1. Visit [thirdweb.com](https://thirdweb.com/)
2. Create free account
3. Generate API key (Settings → API Keys)
4. Save `THIRDWEB_SECRET_KEY`

### Step 3: Deploy Contracts

```bash
cd shard

# Deploy ERC-20 Gold token
pnpm exec tsx src/deploy.ts

# Deploy Auction House
pnpm exec tsx src/deployAuctionHouse.ts

# Deploy Trade contract (BITE)
pnpm exec tsx src/deployTrade.ts

# Deploy Guild DAO
pnpm exec tsx src/deployGuild.ts
```

Each script outputs the deployed contract address. Save these for `.env` configuration.

### Step 4: Configure Environment

Create `shard/.env`:

```bash
# Blockchain
THIRDWEB_SECRET_KEY=your_thirdweb_secret_key_here
SERVER_PRIVATE_KEY=0x_your_wallet_private_key_here

# Contract Addresses (from deployment)
GOLD_CONTRACT_ADDRESS=0x421699e71bBeC7d05FCbc79C690afD5D8585f182
ITEMS_CONTRACT_ADDRESS=0xAe68cdA079fd699780506cc49381EE732837Ec35
CHARACTER_CONTRACT_ADDRESS=0x331dAdFFFFC8A126a739CA5CCAd847c29973B642
TRADE_CONTRACT_ADDRESS=0x74Ae909712bCa5D8828d5AF9a272a2F7Eb1886A6
AUCTION_HOUSE_CONTRACT_ADDRESS=0x1677d33f707F082E21F23821e3074e921b2c301e
GUILD_CONTRACT_ADDRESS=0x0FAd20d1052BC4327D0e07Aa3De64EEC6C3DfF39
GUILD_VAULT_CONTRACT_ADDRESS=0x71Fa28e9cA4f284A426e17c3E1aff0722D1eb215

# Security (generate with: openssl rand -hex 32)
JWT_SECRET=your_jwt_secret_here
ENCRYPTION_KEY=your_encryption_key_here

# Database (optional)
REDIS_URL=redis://localhost:6379
```

### Step 5: Verify Setup

```bash
# Test blockchain connection
pnpm exec tsx src/testShop.ts

# Create test wallet
pnpm exec tsx src/setupWallet.ts

# Mint test character
pnpm exec tsx src/spawnCharacterNFT.ts
```

---

## 🚀 Deployment Guide

### Local Development

```bash
# Terminal 1: Start server
cd shard
pnpm dev

# Terminal 2: Test AI agent
pnpm exec tsx src/smartAgent.ts
```

---

## 📡 API Reference

### Wallet Endpoints

#### Register Wallet
```http
POST /wallet/register
Content-Type: application/json

{
  "address": "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb"
}
```

**Response:**
```json
{
  "ok": true,
  "message": "Wallet registered",
  "sfuelTx": "0xabc...",
  "goldTx": "0xdef..."
}
```

**Actions:**
- Distributes sFUEL for gas
- Mints 50 welcome gold
- Prevents duplicate bonuses

#### Get Balance
```http
GET /wallet/:address/balance
```

**Response:**
```json
{
  "address": "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb",
  "gold": "150.0",
  "onChainGold": "200.0",
  "spentGold": "50.0",
  "items": [
    {
      "tokenId": "5",
      "name": "Iron Sword",
      "balance": "1",
      "category": "weapon",
      "equipSlot": "mainhand",
      "statBonuses": { "str": 5, "dmg": 12 }
    }
  ]
}
```

### Character Endpoints

#### Create Character NFT
```http
POST /character/create
Content-Type: application/json

{
  "wallet": "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb",
  "name": "Korgath",
  "raceId": "orc",
  "classId": "warrior"
}
```

**Response:**
```json
{
  "ok": true,
  "characterTokenId": "42",
  "txHash": "0xabc..."
}
```

#### Get Owned Characters
```http
GET /character/:wallet
```

**Response:**
```json
{
  "characters": [
    {
      "tokenId": "42",
      "metadata": {
        "name": "Korgath",
        "description": "Level 12 Orc Warrior",
        "properties": {
          "race": "orc",
          "class": "warrior",
          "level": 12,
          "xp": 8450
        }
      }
    }
  ]
}
```

### Shop Endpoints

#### Buy Item
```http
POST /shop/buy
Content-Type: application/json

{
  "playerId": "player123",
  "wallet": "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb",
  "tokenId": 20,
  "quantity": 5
}
```

**Response:**
```json
{
  "ok": true,
  "goldSpent": 25,
  "txHash": "0xdef...",
  "item": {
    "name": "Health Potion",
    "quantity": 5
  }
}
```

### Auction Endpoints

#### Create Auction
```http
POST /auction/create
Content-Type: application/json

{
  "zoneId": "wild_meadow",
  "seller": "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb",
  "tokenId": 15,
  "quantity": 1,
  "startPrice": 100,
  "durationSeconds": 86400,
  "buyoutPrice": 500
}
```

#### Place Bid
```http
POST /auction/bid
Content-Type: application/json

{
  "auctionId": 5,
  "bidder": "0x123...",
  "bidAmount": 150
}
```

#### Get Zone Auctions
```http
GET /auction/zone/:zoneId
```

### Trade Endpoints (BITE)

#### Create Trade Listing
```http
POST /trade/create
Content-Type: application/json

{
  "seller": "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb",
  "tokenId": 25,
  "quantity": 1,
  "encryptedAskPrice": "0x..."
}
```

#### Submit Offer
```http
POST /trade/offer
Content-Type: application/json

{
  "tradeId": 3,
  "buyer": "0x456...",
  "encryptedBidPrice": "0x..."
}
```

#### Get Trade Status
```http
GET /trade/:tradeId
```

**Response:**
```json
{
  "seller": "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb",
  "buyer": "0x456...",
  "tokenId": 25,
  "quantity": 1,
  "status": "Resolved",
  "askPrice": 150,
  "bidPrice": 160,
  "matched": true
}
```

---

## 🔒 Security Considerations

### Smart Contract Security

✅ **Server-Authoritative Design**
- Only server wallet can mint/transfer tokens
- Prevents player cheating and duplication exploits
- `onlyOwner` modifier on all critical functions

✅ **Role-Based Access Control**
- Contracts use OpenZeppelin's `Ownable`
- Owner = server wallet with `SERVER_PRIVATE_KEY`
- Future: Multi-sig for production

✅ **Input Validation**
- All addresses validated (non-zero, checksum)
- Quantity checks (positive, sufficient balance)
- Price checks (above minimum, below maximum)

✅ **Reentrancy Protection**
- SKALE ERC contracts include reentrancy guards
- State updates before external calls
- No delegate calls to untrusted contracts

### Private Key Management

⚠️ **CRITICAL SECURITY REQUIREMENTS:**

1. **Never commit `.env` files to git**
   ```bash
   # .gitignore
   .env
   .env.production
   .env.local
   ```

2. **Use environment variables in production**
   ```bash
   fly secrets set SERVER_PRIVATE_KEY="0x..."
   ```

3. **Rotate keys regularly**
   - Generate new wallet quarterly
   - Update contract ownership
   - Migrate sFUEL balance

4. **Separate dev/prod keys**
   - Dev: Low-value testnet wallet
   - Prod: Hardware wallet or HSM

5. **Custodial wallet encryption**
   ```bash
   # Generate strong encryption key
   openssl rand -hex 32
   ```

### BITE Privacy Considerations

✅ **What BITE Protects:**
- Ask/bid prices remain encrypted until match
- No front-running of trades
- Strategic pricing advantage

⚠️ **What BITE Doesn't Protect:**
- Trade existence is public
- Item type and quantity visible
- Participant addresses visible
- Match outcome public (matched/failed)

### Audit Recommendations

For production deployment:
- [ ] Smart contract audit (CertiK, OpenZeppelin, Quantstamp)
- [ ] Penetration testing on API endpoints
- [ ] Code review of custodial wallet encryption
- [ ] Load testing on SKALE RPC
- [ ] Disaster recovery plan for key loss

---

## 📚 Additional Resources

### SKALE Documentation
- [SKALE Network Docs](https://docs.skale.network/)
- [BITE Protocol Guide](https://docs.skale.network/bite)
- [SKALE Chains Overview](https://skale.space/chains)
- [sFUEL Faucet](https://www.sfuel.skale.network/)

### thirdweb Resources
- [thirdweb SDK Docs](https://portal.thirdweb.com/)
- [ERC-20 Contract](https://thirdweb.com/thirdweb.eth/TokenERC20)
- [ERC-721 Contract](https://thirdweb.com/thirdweb.eth/TokenERC721)
- [ERC-1155 Contract](https://thirdweb.com/thirdweb.eth/TokenERC1155)

### Smart Contract Standards
- [EIP-20: Token Standard](https://eips.ethereum.org/EIPS/eip-20)
- [EIP-721: Non-Fungible Token](https://eips.ethereum.org/EIPS/eip-721)
- [EIP-1155: Multi Token](https://eips.ethereum.org/EIPS/eip-1155)

### WoG MMORPG Documentation
- [Main README](./README.md)
- [Production Deployment](./PRODUCTION_DEPLOYMENT.md)
- [Auction House Guide](./AUCTION_HOUSE.md)
- [Guild DAO Guide](./GUILD_DAO.md)

---

## 🤝 Contributing

Blockchain improvements welcome! Priority areas:
- [ ] Multi-sig wallet support for contract ownership
- [ ] Layer 2 bridge to Ethereum mainnet
- [ ] NFT marketplace integration (OpenSea, Rarible)
- [ ] Cross-chain asset transfers
- [ ] Gasless meta-transactions (EIP-2771)

---

## 📝 License

MIT License - see [LICENSE](./LICENSE) file for details.

---

## 🙏 Acknowledgments

**Built with:**
- [SKALE Network](https://skale.space/) - Zero-gas blockchain infrastructure
- [thirdweb](https://thirdweb.com/) - Web3 development SDK
- [OpenZeppelin](https://openzeppelin.com/) - Secure smart contract libraries
- [Fastify](https://www.fastify.io/) - High-performance web framework

**Special Thanks:**
- SKALE Labs for BITE protocol innovation
- thirdweb team for excellent developer experience
- Ethereum community for ERC standards

---

**Repository**: https://github.com/DasilvaKareem/wog-mmorpg

**Co-Authored-By**: Claude Sonnet 4.5 <noreply@anthropic.com>
