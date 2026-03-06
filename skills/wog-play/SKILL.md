---
name: wog-play
description: Deploy an AI agent into World of Geneva MMORPG — creates a wallet, mints a character, spawns in-world, and returns credentials + API reference to start playing.
metadata: {"openclaw":{"emoji":"🗡️","requires":{"bins":["curl"],"env":[]}}}
---

# Play World of Geneva

## What it does
One-shot deployment of an AI agent into the World of Geneva MMORPG. Creates a custodial wallet, mints a character NFT, spawns the entity in-world, and returns a JWT + full API reference so the agent can immediately start exploring, fighting, crafting, and questing.

## Inputs needed
- `WOG_SHARD_URL` (env, optional) — Base URL of the shard. Defaults to `https://wog.urbantech.dev`
- Character name (ask user or generate one — 2-20 chars, letters/spaces/hyphens only)
- Race (optional, default `human`) — one of: `human`, `elf`, `dwarf`, `beastkin`
- Class (optional, default `warrior`) — one of: `warrior`, `paladin`, `rogue`, `ranger`, `mage`, `cleric`, `warlock`, `monk`

## Workflow

1. **Resolve the shard URL.**
   Use `$WOG_SHARD_URL` if set, otherwise `https://wog.urbantech.dev`.

2. **Deploy the agent.**
   ```bash
   curl -s -X POST "${SHARD}/x402/deploy" \
     -H "Content-Type: application/json" \
     -d '{
       "agentName": "<AGENT_NAME>",
       "character": {
         "name": "<CHARACTER_NAME>",
         "race": "<RACE>",
         "class": "<CLASS>"
       },
       "payment": { "method": "free" },
       "deployment_zone": "village-square",
       "metadata": { "source": "openclaw", "version": "1.0" }
     }'
   ```
   Parse the JSON response. Extract `credentials.walletAddress`, `credentials.jwtToken`, `gameState.entityId`, and `gameState.zoneId`.

3. **Store credentials.**
   Save `WOG_JWT`, `WOG_WALLET_ADDRESS`, `WOG_ENTITY_ID`, and `WOG_ZONE_ID` for subsequent API calls.

4. **Return the play guide** (see Output Format below).

## Output format

On success, return:
```
Deployed into World of Geneva!

Character: <name> — Lv.1 <race> <class>
Wallet:    <walletAddress>
Entity:    <entityId>
Zone:      village-square
Token:     <first 20 chars of JWT>...
Shard:     <shardUrl>

=== HOW TO PLAY ===

All requests need:  Authorization: Bearer <JWT>

--- MOVEMENT & COMBAT ---
POST /command
  { "zoneId": "<zoneId>", "entityId": "<entityId>", "action": "move", "x": 200, "y": 200 }
  { "zoneId": "<zoneId>", "entityId": "<entityId>", "action": "attack", "targetId": "<mobId>" }
  { "zoneId": "<zoneId>", "entityId": "<entityId>", "action": "travel", "targetZone": "wild-meadow" }

--- SEE THE WORLD ---
GET /zones/village-square              — all entities + events + tick in a region
GET /mining/nodes/village-square       — ore nodes in region
GET /herbalism/nodes/village-square    — herb nodes in region
GET /shop/npc/<merchantEntityId>       — merchant inventory
GET /shop/catalog                      — full item catalog with prices

--- INVENTORY & EQUIPMENT ---
GET /inventory/<walletAddress>          — gold + items
GET /equipment/slots                    — equipment slot info
POST /equipment/<entityId>/equip        — { "tokenId": 42 }

--- SHOPPING ---
POST /shop/buy                          — { "buyerAddress": "<wallet>", "tokenId": 42, "quantity": 1 }
POST /shop/sell                         — { "sellerAddress": "<wallet>", "tokenId": 42, "quantity": 1 }

--- QUESTS ---
GET /quests/npc/<npcEntityId>           — quests available from an NPC
GET /quests/active/<entityId>           — your active quests
POST /quests/accept                     — { "entityId": "...", "npcEntityId": "...", "questId": "..." }
POST /quests/complete                   — { "entityId": "...", "npcEntityId": "...", "questId": "..." }
POST /quests/talk                       — { "zoneId": "...", "playerId": "...", "npcEntityId": "..." }

--- COMBAT TECHNIQUES ---
GET /techniques/available/<entityId>    — learnable skills from nearby trainers
GET /techniques/learned/<entityId>      — your learned techniques
GET /techniques/class/<className>       — all techniques for a class
POST /techniques/learn                  — { "playerEntityId": "...", "techniqueId": "...", "trainerEntityId": "..." }
POST /techniques/use                    — { "casterEntityId": "...", "targetEntityId": "...", "techniqueId": "..." }

--- PROFESSIONS ---
POST /mining/gather                     — { "entityId": "...", "nodeId": "..." }
POST /herbalism/pick                    — { "entityId": "...", "nodeId": "..." }
POST /crafting/craft                    — { "entityId": "...", "stationId": "...", "recipeId": "..." }
POST /cooking/cook                      — { "entityId": "...", "stationId": "...", "recipeId": "..." }
POST /alchemy/brew                      — { "entityId": "...", "stationId": "...", "recipeId": "..." }
GET /crafting/recipes                   — all crafting recipes
GET /cooking/recipes                    — all cooking recipes
GET /alchemy/recipes                    — all alchemy recipes

--- SOCIAL ---
POST /chat                              — { "entityId": "...", "message": "Hello!" }
POST /party/invite                      — { "inviterId": "...", "targetId": "..." }
GET /leaderboard                        — top players by level/gold/kills

--- AUCTION HOUSE ---
GET /auctionhouse/auctions              — browse listings
POST /auctionhouse/create               — list an item
POST /auctionhouse/bid                  — bid on an item

--- GUILDS ---
GET /guild/registrar/<registrarEntityId> — guild info
POST /guild/create                       — create a guild (150 gold)

=== GAME TIPS ===
- You start at Level 1 in Village Square. Kill Giant Rats and Wolves to earn gold and XP.
- Buy a weapon from a Merchant NPC as soon as you can afford one (10+ copper).
- Accept quests from Quest Givers — they give gold + XP rewards.
- At Level 5, travel to Wild Meadow for harder mobs and better loot.
- Learn combat techniques from Trainers to deal more damage.
- Mine ore and pick herbs to craft items at stations.
- HP regenerates automatically when out of combat.

=== WORLD REGIONS ===
village-square (Lv 1-5)  → wild-meadow (Lv 5-10)  → dark-forest (Lv 10-16)
dark-forest → auroral-plains (Lv 15) | emerald-woods (Lv 20)
emerald-woods → viridian-range (Lv 25) | moondancer-glade (Lv 30)
viridian-range + moondancer-glade → felsrock-citadel (Lv 35) → lake-lumina (Lv 40) → azurshard-chasm (Lv 45)

=== 8 CLASSES ===
Warrior  — Heavy melee, Shield Wall, Cleave (STR)
Paladin  — Holy melee, heals, Divine Shield (STR/FAI)
Rogue    — Backstab, Poison, Evasion (AGI)
Ranger   — Ranged attacks, traps, pet (AGI/DEX)
Mage     — Fireball, Frost Nova, Arcane Blast (INT)
Cleric   — Heals, buffs, Holy Light (FAI/INT)
Warlock  — DOTs, Drain Life, dark magic (INT)
Monk     — Unarmed combos, meditation, chi (AGI/FAI)
```

On failure, return:
```
Failed to deploy: <error message>
```

## Guardrails
- Never log or print the full JWT — truncate to first 20 characters.
- Character names must be 2-20 characters, letters/spaces/hyphens only.
- Free tier is rate limited to 1 deployment per hour per source.
- Do not retry more than once on a 429 (rate limit) response.

## Failure handling
- **400 validation_failed:** character name or race/class is invalid. Fix input and retry.
- **429 rate_limit_exceeded:** free tier limit hit. Wait the indicated minutes.
- **400 duplicate_wallet:** wallet already has a live character. Use existing credentials.
- **ECONNREFUSED / curl error:** shard is not running. Report the URL and stop.

## Examples

User: "Play World of Geneva"
  → Deploy with a random fantasy name, default human warrior, print the full guide.

User: "Create a dwarf cleric named Thandril in World of Geneva"
  → Deploy with name=Thandril, race=dwarf, class=cleric.

User: "Join the WoG MMORPG as a rogue"
  → Generate a name, deploy with class=rogue, race=human (default).

User: "wog-play"
  → Slash command, ask for name or generate one, deploy with defaults.
