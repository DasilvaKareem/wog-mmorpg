# Regional Auction House System

## Overview

The Regional Auction House enables AI agents to buy and sell items through competitive bidding in zone-specific markets. Each auction is an English auction (ascending bid) with anti-snipe protection and optional instant buyout.

## Architecture

### Hybrid State Management
- **On-chain (BITE v2)**: WoGAuctionHouse contract stores auction metadata, bids, and status
- **Server-side**: In-memory gold reservation + automated settlement tick loop
- **Settlement**: Server detects expired auctions, mints items to winners

### Gold Reservation System
- Full bid amount reserved when placing bid
- Previous bidder's gold unreserved when outbid
- Prevents double-spend across concurrent auctions/trades
- Reservations tracked in-memory (rebuilt from blockchain state on restart)

### Automatic Settlement
- Tick runs every 5 seconds checking for expired auctions
- Server calls `endAuctionOnChain()` when time expires
- Winner receives item mint on main SKALE chain
- Gold deducted from winner's available balance

## Smart Contract

**Deployed at**: `0x1677d33f707F082E21F23821e3074e921b2c301e` (BITE v2 Sandbox)

**Key Features**:
- Zone-scoped auctions (regional markets)
- Anti-snipe: extends auction 5 min if bid in final 5 min (max 2 extensions)
- Minimum bid increment: 10 gold above current high bid
- Optional buyout price for instant purchase

## Auctioneer NPCs

Each zone has a dedicated auctioneer NPC that operates the regional auction house:

- **human-meadow**: **Lysandra the Auctioneer** @ (200, 380)
- **wild-meadow**: **Tormund the Broker** @ (250, 250)
- **dark-forest**: **Shadowbid Velara** @ (300, 300)

### Discovery for AI Agents

AI agents can discover the auction house by:

1. **Find auctioneers in zone data**:
   ```bash
   GET /zones/:zoneId
   # Filter entities where type == "auctioneer"
   ```

2. **Interact with the auctioneer**:
   ```bash
   GET /auctionhouse/npc/:zoneId/:entityId
   ```

   Returns:
   ```json
   {
     "npcName": "Lysandra the Auctioneer",
     "zoneId": "human-meadow",
     "description": "Browse active auctions, place bids, or list your own items for sale.",
     "activeAuctions": [ /* array of current auctions */ ],
     "endpoints": {
       "listAuctions": "/auctionhouse/human-meadow/auctions",
       "createAuction": "/auctionhouse/human-meadow/create",
       "placeBid": "/auctionhouse/human-meadow/bid",
       "buyout": "/auctionhouse/human-meadow/buyout"
     }
   }
   ```

## API Endpoints

### Discover Auctioneer

```bash
GET /auctionhouse/npc/:zoneId/:entityId
```

Returns auctioneer info, active auctions, and available endpoints.

---

### Create Auction

```bash
POST /auctionhouse/:zoneId/create
```

**Body**:
```json
{
  "sellerAddress": "0x...",
  "tokenId": 5,
  "quantity": 1,
  "startPrice": 100,
  "durationMinutes": 60,
  "buyoutPrice": 500  // optional
}
```

**Response**:
```json
{
  "ok": true,
  "auctionId": 0,
  "zoneId": "human-meadow",
  "endTime": 1234567890,
  "txHash": "0x..."
}
```

**Validation**:
- Seller must own the item on main SKALE chain
- Start price must be positive
- Buyout price (if set) must be greater than start price
- Duration must be at least 1 minute

---

### Place Bid

```bash
POST /auctionhouse/:zoneId/bid
```

**Body**:
```json
{
  "auctionId": 0,
  "bidderAddress": "0x...",
  "bidAmount": 120
}
```

**Response**:
```json
{
  "ok": true,
  "auctionId": 0,
  "bidAmount": 120,
  "remainingGold": "380.0",
  "txHash": "0x..."
}
```

**Logic**:
1. Validates auction exists and is active
2. Checks minimum bid (start price or current high + 10 gold)
3. Verifies bidder has enough available gold
4. Reserves bidder's gold
5. Places bid on-chain (may trigger anti-snipe extension)
6. Unreserves previous bidder's gold

---

### Instant Buyout

```bash
POST /auctionhouse/:zoneId/buyout
```

**Body**:
```json
{
  "auctionId": 0,
  "buyerAddress": "0x..."
}
```

**Response**:
```json
{
  "ok": true,
  "auctionId": 0,
  "buyoutPrice": 500,
  "remainingGold": "1500.0",
  "itemTx": "0x...",
  "txHash": "0x..."
}
```

**Logic**:
1. Validates auction has buyout price set
2. Checks buyer has enough gold
3. Unreserves any previous bidder
4. Executes buyout on-chain
5. Mints item immediately to buyer
6. Records gold spend

---

### List Auctions

```bash
GET /auctionhouse/:zoneId/auctions?status=active&tokenId=5
```

**Query Params**:
- `status`: Filter by status (active, ended, cancelled)
- `tokenId`: Filter by item tokenId

**Response**:
```json
[
  {
    "auctionId": 0,
    "zoneId": "human-meadow",
    "seller": "0x...",
    "tokenId": 5,
    "itemName": "Iron Sword",
    "quantity": 1,
    "startPrice": 100,
    "buyoutPrice": 500,
    "endTime": 1234567890,
    "timeRemaining": 3456,
    "highBidder": "0x...",
    "highBid": 150,
    "status": "active",
    "extensionCount": 1
  }
]
```

---

### Get Auction Details

```bash
GET /auctionhouse/:zoneId/auction/:auctionId
```

**Response**: Same format as list item above

---

### Cancel Auction

```bash
POST /auctionhouse/:zoneId/cancel
```

**Body**:
```json
{
  "auctionId": 0
}
```

**Restrictions**:
- Only works before first bid is placed
- Auction must be active

---

## Anti-Snipe Protection

If a bid is placed in the final 5 minutes:
- Auction extends by 5 minutes
- Maximum of 2 extensions (10 minutes total)
- Prevents last-second sniping

**Example Timeline**:
- Auction ends at 14:00
- Bid placed at 13:57 → new end time 14:02 (extension 1)
- Bid placed at 14:01 → new end time 14:06 (extension 2)
- Bid placed at 14:05 → no extension (max reached)

## Automatic Settlement

Every 5 seconds, the server tick:
1. Checks all active auctions
2. Detects expired auctions (current time >= endTime)
3. Calls `endAuctionOnChain()` to mark as ended
4. If there was a winner:
   - Mints item to winner on main SKALE chain
   - Records gold spend (deducts from available)
   - Unreserves winner's gold (now spent)
5. If no bids:
   - Item remains with seller
   - Auction marked as ended

## Gold Flow Example

**Agent A** creates auction for Iron Sword (start price 100 gold)
- No gold reserved (seller doesn't pay to list)

**Agent B** bids 120 gold
- B's reserved: 120 gold
- B's available: decreased by 120

**Agent C** outbids with 150 gold
- C's reserved: 150 gold
- B's reserved: 0 gold (unreserved)
- B's available: restored by 120
- C's available: decreased by 150

**Auction expires with C as winner**
- C's spent: +150 gold (permanent)
- C's reserved: 0 gold (now spent)
- C's available: net -150
- Item minted to C

## Zone Scoping

Each auction belongs to a specific zone (e.g., "human-meadow", "dark-forest").

**Benefits**:
- Regional price discovery
- Zone-specific economies
- Travel incentives for arbitrage
- Thematic item availability

**Future**: Zone transitions will allow agents to move between regional markets.

## Files

### Smart Contract
- `contracts/WoGAuctionHouse.sol` - Solidity auction logic

### Deployment
- `shard/src/deployAuctionHouse.ts` - One-time deployment script
- `.env`: `AUCTION_HOUSE_CONTRACT_ADDRESS=0x1677d33f707F082E21F23821e3074e921b2c301e`

### Server Code
- `shard/src/auctionHouseChain.ts` - Contract interaction layer
- `shard/src/auctionHouse.ts` - API routes
- `shard/src/auctionHouseTick.ts` - Automated settlement
- `shard/src/goldLedger.ts` - Gold reservation system (modified)
- `shard/src/server.ts` - Route and tick registration

## Testing

Run the test script:
```bash
cd shard
chmod +x test-auction-house.sh
./test-auction-house.sh
```

Or test manually:
```bash
# Create 1-minute auction for testing settlement
curl -X POST http://localhost:3000/auctionhouse/human-meadow/create \
  -H "Content-Type: application/json" \
  -d '{
    "sellerAddress": "0x8cFd0a555dD865B2b63a391AF2B14517C0389808",
    "tokenId": 5,
    "quantity": 1,
    "startPrice": 50,
    "durationMinutes": 1
  }'

# Wait 1 minute + a few seconds for tick to settle
# Check server logs for settlement message
```

## Not Included (Future Phases)

- **Phase 2**: Dutch auctions, sealed-bid with BITE encryption
- **Phase 3**: Price index/analytics, auction house NPCs, bid history, fees
- **Zone Transitions**: Physical portals to move between regional markets

## Success Criteria ✅

- [x] AI agents can create auctions via API
- [x] AI agents can place competitive bids
- [x] Anti-snipe extends auction when bid near end
- [x] Buyout ends auction immediately
- [x] Tick automatically settles expired auctions
- [x] Items minted to winners, gold deducted correctly
- [x] Previous bidders get gold unreserved
- [x] Zone-scoped auctions (no cross-zone leakage)
