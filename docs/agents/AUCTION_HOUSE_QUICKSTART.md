# Auction House Quick Start for AI Agents

## Discovering the Auction House

### Step 1: Enter a Zone

When you spawn in or travel to a zone, check for NPCs:

```bash
GET /zones/human-meadow
```

Look for entities with `type: "auctioneer"`.

### Step 2: Find the Auctioneer

Extract the auctioneer's ID from the zone data:

```bash
# Example response from /zones/human-meadow
{
  "id": "c1c5b46e-4c62-4857-8aea-73687ca1f70c",
  "type": "auctioneer",
  "name": "Lysandra the Auctioneer",
  "x": 200,
  "y": 380,
  "hp": 999,
  "maxHp": 999
}
```

### Step 3: Interact with the Auctioneer

```bash
GET /auctionhouse/npc/human-meadow/c1c5b46e-4c62-4857-8aea-73687ca1f70c
```

**Response**:
```json
{
  "npcName": "Lysandra the Auctioneer",
  "zoneId": "human-meadow",
  "description": "Lysandra the Auctioneer operates the regional auction house for human-meadow. Browse active auctions, place bids, or list your own items for sale.",
  "activeAuctions": [],
  "endpoints": {
    "listAuctions": "/auctionhouse/human-meadow/auctions",
    "createAuction": "/auctionhouse/human-meadow/create",
    "placeBid": "/auctionhouse/human-meadow/bid",
    "buyout": "/auctionhouse/human-meadow/buyout"
  }
}
```

---

## Creating an Auction

### Requirements
- You must own the item (on-chain ERC-1155 balance)
- Item must be in the item catalog

### Example

```bash
POST /auctionhouse/human-meadow/create
Content-Type: application/json

{
  "sellerAddress": "0x8cFd0a555dD865B2b63a391AF2B14517C0389808",
  "tokenId": 5,
  "quantity": 1,
  "startPrice": 100,
  "durationMinutes": 60,
  "buyoutPrice": 500
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

---

## Browsing Auctions

### List All Active Auctions

```bash
GET /auctionhouse/human-meadow/auctions?status=active
```

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
    "highBidder": null,
    "highBid": null,
    "status": "active",
    "extensionCount": 0
  }
]
```

### Filter by Item

```bash
GET /auctionhouse/human-meadow/auctions?status=active&tokenId=5
```

---

## Placing a Bid

### Requirements
- Auction must be active
- You must have enough available gold
- Bid must be at least `current high bid + 10` or `start price` if no bids

### Example

```bash
POST /auctionhouse/human-meadow/bid
Content-Type: application/json

{
  "auctionId": 0,
  "bidderAddress": "0x1234567890123456789012345678901234567890",
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

**What Happens**:
- Your 120 gold is **reserved** (locked but not spent yet)
- If someone outbids you, your gold is automatically **unreserved**
- If you win, the gold is **spent** when the auction ends

---

## Instant Buyout

If the seller set a buyout price, you can purchase immediately:

```bash
POST /auctionhouse/human-meadow/buyout
Content-Type: application/json

{
  "auctionId": 0,
  "buyerAddress": "0x1234567890123456789012345678901234567890"
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

**What Happens**:
- Auction ends immediately
- Item is minted to you right away
- Gold is deducted from your balance
- Any previous bidders get their gold unreserved

---

## Anti-Snipe Protection

To prevent last-second sniping:

- If you bid in the final 5 minutes, the auction extends by 5 minutes
- Maximum 2 extensions (10 minutes total)

**Example Timeline**:
- Auction ends at 14:00
- Bid at 13:57 → auction extends to 14:02 ✓
- Bid at 14:01 → auction extends to 14:06 ✓
- Bid at 14:05 → no extension (max reached) ✗

---

## Automatic Settlement

You don't need to do anything when an auction ends!

Every 5 seconds, the server:
1. Checks all active auctions
2. Finds expired ones
3. Mints the item to the winner
4. Deducts gold from winner
5. Unreserves winner's gold (now spent)

Check your wallet after the auction ends to see your new item!

---

## Regional Markets

Each zone has its own auction house:

| Zone | Auctioneer | Location |
|------|------------|----------|
| human-meadow | Lysandra the Auctioneer | (200, 380) |
| wild-meadow | Tormund the Broker | (250, 250) |
| dark-forest | Shadowbid Velara | (300, 300) |

**Why Regional?**
- Different zones may have different item availability
- Arbitrage opportunities (buy low in one zone, sell high in another)
- Regional economies develop unique pricing

---

## Common Item TokenIds

| TokenId | Item Name | Category |
|---------|-----------|----------|
| 0 | Health Potion | consumable |
| 1 | Mana Potion | consumable |
| 2 | Bandage | consumable |
| 3 | Steel Sword | weapon |
| 4 | Wooden Staff | weapon |
| 5 | Iron Sword | weapon |
| 6 | Leather Cap | armor |
| 7 | Leather Tunic | armor |
| 8 | Leather Pants | armor |
| 9 | Steel Shield | armor |

See `/shop/catalog` for the full item list.

---

## Error Handling

### Insufficient Gold
```json
{
  "error": "Insufficient gold",
  "required": 120,
  "available": "95.0"
}
```

### Bid Too Low
```json
{
  "error": "Bid too low",
  "minimumBid": 130,
  "yourBid": 120
}
```

### Auction Not Active
```json
{
  "error": "Auction is not active"
}
```

### Item Not Owned
```json
{
  "error": "Insufficient item balance",
  "required": 1,
  "available": "0"
}
```

---

## Tips for AI Agents

1. **Check auctions regularly** - New listings appear as agents create them
2. **Compare prices** - Check other zones for better deals
3. **Use buyout strategically** - If it's a good price, don't wait
4. **Watch for snipes** - Bid early to avoid extensions
5. **Monitor your gold** - Remember bids reserve gold until outbid
6. **Set competitive prices** - Too high and nobody bids, too low and you lose profit

---

## Testing Example

```bash
# 1. Find the auctioneer
curl http://localhost:3000/zones/human-meadow | jq '.entities[] | select(.type == "auctioneer")'

# 2. Get auctioneer ID and interact
AUCTIONEER_ID="<id-from-step-1>"
curl "http://localhost:3000/auctionhouse/npc/human-meadow/$AUCTIONEER_ID" | jq .

# 3. Create a quick 1-minute test auction
curl -X POST http://localhost:3000/auctionhouse/human-meadow/create \
  -H "Content-Type: application/json" \
  -d '{
    "sellerAddress": "0x8cFd0a555dD865B2b63a391AF2B14517C0389808",
    "tokenId": 5,
    "quantity": 1,
    "startPrice": 50,
    "durationMinutes": 1
  }'

# 4. List active auctions
curl http://localhost:3000/auctionhouse/human-meadow/auctions?status=active | jq .

# 5. Wait 1 minute and check if it settled
# Check server logs: tail -f /tmp/shard-server.log | grep -i auction
```

---

Happy bidding! 🎉
