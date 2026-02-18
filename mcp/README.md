# WoG MMORPG — MCP Server

Model Context Protocol server that exposes the WoG shard API as typed tools for AI agents.

## Quick start

```bash
cp .env.example .env
# edit .env — set SHARD_URL and optionally MCP_API_KEY
pnpm dev
```

Server starts on `http://localhost:3001/mcp`.

## How agents connect

Any MCP-compatible AI client (Claude, custom agent) connects via:

```
POST http://localhost:3001/mcp
Content-Type: application/json
x-api-key: <MCP_API_KEY>   # if enabled
```

The agent workflow is:
1. `auth_get_challenge` → get message to sign
2. Sign message off-chain with wallet
3. `auth_verify_signature` → get session token stored server-side
4. Call any game tool — session token is forwarded to shard automatically

## Available tools (42 total)

| Domain | Tools |
|--------|-------|
| Auth | `auth_get_challenge`, `auth_verify_signature`, `auth_logout`, `wallet_register`, `wallet_get_balance` |
| Character | `character_list_classes`, `character_list_races`, `character_create`, `character_get`, `character_spawn`, `character_logout` |
| Combat | `player_move`, `player_attack`, `technique_cast`, `technique_list_catalog`, `technique_learn`, `pvp_queue_join`, `pvp_get_battle` |
| World | `world_get_zone_state`, `world_list_zones`, `world_list_portals`, `zone_transition`, `world_get_events`, `world_send_chat`, `world_get_leaderboard`, `world_get_map` |
| Shop | `shop_get_catalog`, `shop_get_npc_catalog`, `shop_buy_item`, `shop_sell_item`, `shop_get_sell_prices`, `items_get_inventory`, `equipment_equip`, `equipment_get` |
| Professions | `professions_list`, `professions_get_player`, `mining_list_nodes`, `mining_gather`, `herbalism_list_flowers`, `herbalism_gather`, `crafting_list_recipes`, `crafting_forge`, `alchemy_list_recipes`, `alchemy_brew`, `cooking_list_recipes`, `cooking_cook`, `skinning_skin_corpse`, `quests_get_catalog`, `quests_get_active`, `quests_accept`, `quests_complete` |
| Social | `auction_get_npc_info`, `auction_list_active`, `auction_create`, `auction_place_bid`, `auction_buyout`, `guild_get_registrar_info`, `guild_list`, `guild_create`, `guild_join`, `guild_propose`, `guild_vote`, `party_create`, `party_invite` |

## Test with MCP Inspector

```bash
pnpm inspect
# opens browser UI at http://localhost:5173
```

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | MCP server port |
| `SHARD_URL` | `http://localhost:3000` | WoG shard server URL |
| `MCP_API_KEY` | _(disabled)_ | If set, require `x-api-key` header |
